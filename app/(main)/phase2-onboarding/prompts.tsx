import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  PHASE2_SECTION2_PROMPTS,
  PHASE2_SECTION3_PROMPTS,
  PHASE2_PROMPT_MIN_TEXT_LENGTH,
  PHASE2_PROMPT_MAX_TEXT_LENGTH,
  type Phase2PromptAnswer,
} from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { useScreenTrace } from '@/lib/devTrace';

const C = INCOGNITO_COLORS;

type SectionKey = 'section1' | 'section2' | 'section3';

const SECTION1_PROMPT_IDS = new Set<string>(PHASE2_SECTION1_PROMPTS.map((prompt) => prompt.id));
const SECTION2_PROMPT_IDS = new Set<string>(PHASE2_SECTION2_PROMPTS.map((prompt) => prompt.id));
const SECTION3_PROMPT_IDS = new Set<string>(PHASE2_SECTION3_PROMPTS.map((prompt) => prompt.id));

function isValidTextAnswer(answer: string) {
  const length = answer.trim().length;
  return length >= PHASE2_PROMPT_MIN_TEXT_LENGTH && length <= PHASE2_PROMPT_MAX_TEXT_LENGTH;
}

function getInitialDraftPromptAnswers(promptAnswers: Phase2PromptAnswer[]) {
  return promptAnswers
    .filter((answer) =>
      SECTION1_PROMPT_IDS.has(answer.promptId) ||
      SECTION2_PROMPT_IDS.has(answer.promptId) ||
      SECTION3_PROMPT_IDS.has(answer.promptId)
    )
    .map((answer) => ({ ...answer }));
}

export default function Phase2PromptsScreen() {
  useScreenTrace('P2_ONB_PROMPTS');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);

  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);
  const setPromptAnswers = usePrivateProfileStore((s) => s.setPromptAnswers);
  const saveOnboardingPrompts = useMutation(api.privateProfiles.saveOnboardingPrompts);

  const [expandedSection, setExpandedSection] = useState<SectionKey>('section1');
  const [activeTextPromptId, setActiveTextPromptId] = useState<string | null>(null);
  const [draftPromptAnswers, setDraftPromptAnswers] = useState<Phase2PromptAnswer[]>(
    () => getInitialDraftPromptAnswers(promptAnswers)
  );
  const [isSaving, setIsSaving] = useState(false);

  const getAnswer = useCallback(
    (promptId: string) => draftPromptAnswers.find((answer) => answer.promptId === promptId)?.answer || '',
    [draftPromptAnswers]
  );

  const updateDraftPromptAnswer = useCallback((promptId: string, question: string, answer: string) => {
    setDraftPromptAnswers((current) => {
      const nextAnswer = answer;
      const existingIndex = current.findIndex((item) => item.promptId === promptId);

      if (nextAnswer.trim().length === 0) {
        if (existingIndex === -1) {
          return current;
        }
        return current.filter((item) => item.promptId !== promptId);
      }

      const nextEntry: Phase2PromptAnswer = { promptId, question, answer: nextAnswer };
      if (existingIndex === -1) {
        return [...current, nextEntry];
      }

      const next = [...current];
      next[existingIndex] = nextEntry;
      return next;
    });
  }, []);

  const removeDraftPromptAnswer = useCallback((promptId: string) => {
    setDraftPromptAnswers((current) => current.filter((item) => item.promptId !== promptId));
  }, []);

  const toggleSection = useCallback((section: SectionKey) => {
    setExpandedSection((current) => (current === section ? current : section));
  }, []);

  const selectMultipleChoiceAnswer = useCallback(
    (promptId: string, question: string, option: string) => {
      const currentAnswer = getAnswer(promptId);
      if (currentAnswer === option) {
        removeDraftPromptAnswer(promptId);
        return;
      }
      updateDraftPromptAnswer(promptId, question, option);
    },
    [getAnswer, removeDraftPromptAnswer, updateDraftPromptAnswer]
  );

  const toggleTextPrompt = useCallback((promptId: string) => {
    setActiveTextPromptId((current) => (current === promptId ? null : promptId));
  }, []);

  const buildPayload = useCallback(() => {
    const payload: Phase2PromptAnswer[] = [];

    for (const prompt of PHASE2_SECTION1_PROMPTS) {
      const answer = getAnswer(prompt.id).trim();
      if (!answer) continue;
      payload.push({
        promptId: prompt.id,
        question: prompt.question,
        answer,
      });
    }

    for (const prompt of [...PHASE2_SECTION2_PROMPTS, ...PHASE2_SECTION3_PROMPTS]) {
      const answer = getAnswer(prompt.id).trim();
      if (!isValidTextAnswer(answer)) continue;
      payload.push({
        promptId: prompt.id,
        question: prompt.question,
        answer,
      });
    }

    return payload;
  }, [getAnswer]);

  const section1AnsweredCount = useMemo(
    () => PHASE2_SECTION1_PROMPTS.filter((prompt) => getAnswer(prompt.id).trim().length > 0).length,
    [getAnswer]
  );
  const section2AnsweredCount = useMemo(
    () => PHASE2_SECTION2_PROMPTS.filter((prompt) => isValidTextAnswer(getAnswer(prompt.id))).length,
    [getAnswer]
  );
  const section3AnsweredCount = useMemo(
    () => PHASE2_SECTION3_PROMPTS.filter((prompt) => isValidTextAnswer(getAnswer(prompt.id))).length,
    [getAnswer]
  );

  const section1Complete = section1AnsweredCount > 0;
  const section2Complete = section2AnsweredCount > 0;
  const section3Complete = section3AnsweredCount > 0;
  const canContinue = !!token && section1Complete && section2Complete && section3Complete && !isSaving;

  const handleContinue = useCallback(async () => {
    if (!token || !canContinue) return;

    const payload = buildPayload();
    setIsSaving(true);
    try {
      const result = await saveOnboardingPrompts({
        token,
        promptAnswers: payload,
      });

      if (!result?.success) {
        throw new Error('Prompt answers could not be saved');
      }

      setPromptAnswers(payload);
      router.push('/(main)/phase2-onboarding/profile-setup' as any);
    } catch (error) {
      Alert.alert(
        'Unable to continue',
        'We could not save your prompt answers. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  }, [buildPayload, canContinue, router, saveOnboardingPrompts, setPromptAnswers, token]);

  const renderSectionHeader = (
    sectionKey: SectionKey,
    title: string,
    subtitle: string,
    complete: boolean
  ) => {
    const isExpanded = expandedSection === sectionKey;
    return (
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection(sectionKey)}
        activeOpacity={0.75}
      >
        <View style={styles.sectionHeaderLeft}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {complete ? (
              <Ionicons name="checkmark-circle" size={18} color={C.primary} />
            ) : null}
          </View>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={C.textLight}
        />
      </TouchableOpacity>
    );
  };

  const renderQuickQuestions = () => {
    const isExpanded = expandedSection === 'section1';
    return (
      <View style={styles.sectionCard}>
        {renderSectionHeader(
          'section1',
          'Quick Questions',
          `${section1AnsweredCount}/3 answered`,
          section1Complete
        )}
        {isExpanded ? (
          <View style={styles.sectionContent}>
            {PHASE2_SECTION1_PROMPTS.map((prompt) => {
              const currentAnswer = getAnswer(prompt.id);
              return (
                <View key={prompt.id} style={styles.promptBlock}>
                  <View style={styles.promptHeaderRow}>
                    <Text style={styles.promptQuestion}>{prompt.question}</Text>
                    {currentAnswer ? (
                      <Ionicons name="checkmark-circle" size={18} color={C.primary} />
                    ) : null}
                  </View>
                  <View style={styles.optionsGrid}>
                    {prompt.options.map((option) => {
                      const selected = currentAnswer === option;
                      return (
                        <TouchableOpacity
                          key={option}
                          style={[styles.optionChip, selected && styles.optionChipSelected]}
                          onPress={() => selectMultipleChoiceAnswer(prompt.id, prompt.question, option)}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                            {option}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  const renderTextSection = (
    sectionKey: 'section2' | 'section3',
    title: string,
    prompts: ReadonlyArray<{ readonly id: string; readonly question: string }>,
    answeredCount: number,
    complete: boolean
  ) => {
    const isExpanded = expandedSection === sectionKey;

    return (
      <View style={styles.sectionCard}>
        {renderSectionHeader(
          sectionKey,
          title,
          `${answeredCount}/3 answered`,
          complete
        )}
        {isExpanded ? (
          <View style={styles.sectionContent}>
            {prompts.map((prompt) => {
              const answer = getAnswer(prompt.id);
              const isOpen = activeTextPromptId === prompt.id;
              const valid = isValidTextAnswer(answer);
              const answerLength = answer.trim().length;

              return (
                <View key={prompt.id} style={styles.promptBlock}>
                  <TouchableOpacity
                    style={styles.textPromptHeader}
                    onPress={() => toggleTextPrompt(prompt.id)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.promptHeaderCopy}>
                      <Text style={styles.promptQuestion}>{prompt.question}</Text>
                      {!isOpen && answer.trim().length > 0 ? (
                        <Text style={styles.answerPreview} numberOfLines={2}>
                          {answer.trim()}
                        </Text>
                      ) : (
                        <Text style={styles.answerPlaceholder}>
                          Tap to answer
                        </Text>
                      )}
                    </View>
                    <View style={styles.promptHeaderIcons}>
                      {valid ? (
                        <Ionicons name="checkmark-circle" size={18} color={C.primary} />
                      ) : null}
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={C.textLight}
                      />
                    </View>
                  </TouchableOpacity>

                  {isOpen ? (
                    <View style={styles.textAnswerCard}>
                      <TextInput
                        style={styles.textInput}
                        value={answer}
                        onChangeText={(text) => updateDraftPromptAnswer(prompt.id, prompt.question, text)}
                        placeholder="Type your answer..."
                        placeholderTextColor={C.textLight}
                        multiline
                        maxLength={PHASE2_PROMPT_MAX_TEXT_LENGTH}
                        textAlignVertical="top"
                      />
                      <View style={styles.inputFooter}>
                        <Text style={styles.charCount}>
                          {answerLength}/{PHASE2_PROMPT_MAX_TEXT_LENGTH}
                        </Text>
                        {valid ? (
                          <View style={styles.validBadge}>
                            <Ionicons name="checkmark-circle" size={16} color={C.primary} />
                            <Text style={styles.validBadgeText}>Ready</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  const bottomHint = useMemo(() => {
    if (canContinue) {
      return 'Continue saves this entire prompt step at once.';
    }

    const missing: string[] = [];
    if (!section1Complete) missing.push('Quick Questions');
    if (!section2Complete) missing.push('Your Values');
    if (!section3Complete) missing.push('Your Personality');
    return `Finish: ${missing.join(', ')}`;
  }, [canContinue, section1Complete, section2Complete, section3Complete]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Prompt answers</Text>
        <Text style={styles.stepLabel}>Step 4 of 5</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.introCard}>
            <Text style={styles.introTitle}>Answer a few questions before review</Text>
            <Text style={styles.introText}>
              Pick at least one answer in each section. We will save this whole step only when you continue.
            </Text>
          </View>

          {renderQuickQuestions()}
          {renderTextSection('section2', 'Your Values', PHASE2_SECTION2_PROMPTS, section2AnsweredCount, section2Complete)}
          {renderTextSection('section3', 'Your Personality', PHASE2_SECTION3_PROMPTS, section3AnsweredCount, section3Complete)}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Text style={styles.bottomHint}>{bottomHint}</Text>
        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue || isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.continueButtonText}>Continue to review</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stepLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  keyboard: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  introCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  introTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
  },
  introText: {
    fontSize: 14,
    lineHeight: 20,
    color: C.textLight,
  },
  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  sectionHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 4,
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  promptBlock: {
    marginBottom: 18,
  },
  promptHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  promptQuestion: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: C.text,
    fontWeight: '600',
  },
  optionsGrid: {
    gap: 8,
  },
  optionChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: C.background,
  },
  optionChipSelected: {
    borderColor: C.primary,
    backgroundColor: `${C.primary}14`,
  },
  optionText: {
    color: C.text,
    fontSize: 14,
    lineHeight: 19,
  },
  optionTextSelected: {
    color: C.primary,
    fontWeight: '600',
  },
  textPromptHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  promptHeaderCopy: {
    flex: 1,
  },
  promptHeaderIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  answerPreview: {
    fontSize: 13,
    lineHeight: 19,
    color: C.textLight,
    marginTop: 6,
  },
  answerPlaceholder: {
    fontSize: 13,
    lineHeight: 19,
    color: C.textLight,
    marginTop: 6,
  },
  textAnswerCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.background,
    padding: 12,
  },
  textInput: {
    minHeight: 112,
    fontSize: 14,
    lineHeight: 20,
    color: C.text,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
  },
  validBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  validBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  bottomHint: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 10,
  },
  continueButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  continueButtonDisabled: {
    opacity: 0.55,
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
