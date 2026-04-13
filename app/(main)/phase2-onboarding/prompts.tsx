import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { LinearGradient } from 'expo-linear-gradient';
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

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const C = INCOGNITO_COLORS;

// Card backgrounds
const CARD_BG = '#1E2128';
const CARD_BG_ACTIVE = '#252932';

function isValidTextAnswer(answer: string) {
  const length = answer.trim().length;
  return length >= PHASE2_PROMPT_MIN_TEXT_LENGTH && length <= PHASE2_PROMPT_MAX_TEXT_LENGTH;
}

export default function Phase2PromptsScreen() {
  useScreenTrace('P2_ONB_PROMPTS');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const scrollViewRef = useRef<ScrollView>(null);
  const questionRefs = useRef<Record<string, View | null>>({});

  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);
  const setPromptAnswers = usePrivateProfileStore((s) => s.setPromptAnswers);
  const saveOnboardingPrompts = useMutation(api.privateProfiles.updateFieldsByAuthId);

  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    promptAnswers.forEach((a) => {
      initial[a.promptId] = a.answer;
    });
    return initial;
  });

  const [isSaving, setIsSaving] = useState(false);

  // Track which text prompt is currently expanded (for Section 2 & 3)
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  const getAnswer = useCallback(
    (promptId: string) => draftAnswers[promptId] || '',
    [draftAnswers]
  );

  const setAnswer = useCallback((promptId: string, answer: string) => {
    setDraftAnswers((prev) => ({ ...prev, [promptId]: answer }));
  }, []);

  // Toggle option for Section 1 (multiple choice)
  const toggleOption = useCallback((promptId: string, option: string) => {
    const current = draftAnswers[promptId];
    if (current === option) {
      // Deselect
      setDraftAnswers((prev) => {
        const next = { ...prev };
        delete next[promptId];
        return next;
      });
    } else {
      setAnswer(promptId, option);
    }
  }, [draftAnswers, setAnswer]);

  // Expand/collapse text prompt (Section 2 & 3)
  const toggleTextPrompt = useCallback((promptId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedPromptId((current) => {
      if (current === promptId) {
        // Collapsing - dismiss keyboard
        Keyboard.dismiss();
        return null;
      }
      return promptId;
    });
  }, []);

  // Auto-scroll to active input when expanded
  useEffect(() => {
    if (expandedPromptId) {
      // Small delay to let layout animation complete
      const timer = setTimeout(() => {
        const ref = questionRefs.current[expandedPromptId];
        if (ref && scrollViewRef.current) {
          ref.measureLayout(
            scrollViewRef.current as any,
            (_x, y) => {
              // Scroll to position with some offset from top
              scrollViewRef.current?.scrollTo({
                y: Math.max(0, y - 100),
                animated: true,
              });
            },
            () => {} // Error callback
          );
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [expandedPromptId]);

  // Progress calculations
  const section1Answered = PHASE2_SECTION1_PROMPTS.filter((p) => getAnswer(p.id).length > 0).length;
  const section2Answered = PHASE2_SECTION2_PROMPTS.filter((p) => isValidTextAnswer(getAnswer(p.id))).length;
  const section3Answered = PHASE2_SECTION3_PROMPTS.filter((p) => isValidTextAnswer(getAnswer(p.id))).length;

  // STRICT COMPLETION RULES:
  // - Section 1: ALL 3 questions required
  // - Section 2: At least 1 question required
  // - Section 3: At least 1 question required
  const section1Complete = section1Answered === 3;
  const section2Complete = section2Answered >= 1;
  const section3Complete = section3Answered >= 1;

  const canContinue = !!userId && section1Complete && section2Complete && section3Complete && !isSaving;

  const handleContinue = useCallback(async () => {
    if (!userId || !canContinue) return;

    const payload: Phase2PromptAnswer[] = [];

    // Section 1 - multiple choice
    PHASE2_SECTION1_PROMPTS.forEach((p) => {
      const answer = getAnswer(p.id).trim();
      if (answer) {
        payload.push({ promptId: p.id, question: p.question, answer });
      }
    });

    // Section 2 & 3 - text
    [...PHASE2_SECTION2_PROMPTS, ...PHASE2_SECTION3_PROMPTS].forEach((p) => {
      const answer = getAnswer(p.id).trim();
      if (isValidTextAnswer(answer)) {
        payload.push({ promptId: p.id, question: p.question, answer });
      }
    });

    setIsSaving(true);
    try {
      const result = await saveOnboardingPrompts({
        authUserId: userId,
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
        'We could not save your answers. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  }, [userId, canContinue, getAnswer, saveOnboardingPrompts, setPromptAnswers, router]);

  // ============================================================
  // SECTION 1: Inline Multiple Choice
  // All 3 questions visible with options directly below each
  // ============================================================
  const renderSection1Question = (prompt: typeof PHASE2_SECTION1_PROMPTS[number]) => {
    const selectedOption = getAnswer(prompt.id);
    const hasAnswer = selectedOption.length > 0;

    return (
      <View key={prompt.id} style={styles.s1QuestionCard}>
        <View style={styles.s1QuestionHeader}>
          <Text style={styles.s1QuestionText}>{prompt.question}</Text>
          {hasAnswer && (
            <View style={styles.miniCheckBadge}>
              <Ionicons name="checkmark" size={12} color="#FFFFFF" />
            </View>
          )}
        </View>
        <View style={styles.s1OptionsContainer}>
          {prompt.options.map((option) => {
            const isSelected = selectedOption === option;
            return (
              <TouchableOpacity
                key={option}
                style={[
                  styles.s1OptionChip,
                  isSelected && styles.s1OptionChipSelected,
                ]}
                onPress={() => toggleOption(prompt.id, option)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.s1OptionText,
                    isSelected && styles.s1OptionTextSelected,
                  ]}
                  numberOfLines={2}
                >
                  {option}
                </Text>
                {isSelected && (
                  <View style={styles.s1CheckCircle}>
                    <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  // ============================================================
  // SECTION 2 & 3: Inline Text Input (Expandable)
  // Tap question -> inline text box expands below it
  // ============================================================
  const renderTextQuestion = (prompt: { id: string; question: string }) => {
    const answer = getAnswer(prompt.id);
    const isExpanded = expandedPromptId === prompt.id;
    const hasValidAnswer = isValidTextAnswer(answer);
    const charCount = answer.trim().length;

    return (
      <View
        key={prompt.id}
        ref={(ref) => { questionRefs.current[prompt.id] = ref; }}
        style={styles.textQuestionWrapper}
      >
        {/* Question Card (Tap to expand) */}
        <TouchableOpacity
          style={[
            styles.textQuestionCard,
            isExpanded && styles.textQuestionCardExpanded,
            hasValidAnswer && !isExpanded && styles.textQuestionCardAnswered,
          ]}
          onPress={() => toggleTextPrompt(prompt.id)}
          activeOpacity={0.7}
        >
          <View style={styles.textQuestionContent}>
            <Text style={styles.textQuestionText}>{prompt.question}</Text>
            {!isExpanded && hasValidAnswer && (
              <Text style={styles.textAnswerPreview} numberOfLines={1}>
                {answer}
              </Text>
            )}
            {!isExpanded && !hasValidAnswer && (
              <Text style={styles.textPlaceholder}>Tap to answer</Text>
            )}
          </View>
          <View style={styles.textQuestionRight}>
            {hasValidAnswer && !isExpanded ? (
              <View style={styles.checkBadge}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
            ) : (
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={isExpanded ? C.primary : C.textLight}
              />
            )}
          </View>
        </TouchableOpacity>

        {/* Inline Text Input (Only visible when expanded) */}
        {isExpanded && (
          <View style={styles.inlineInputContainer}>
            <TextInput
              style={styles.inlineTextInput}
              value={answer}
              onChangeText={(text) => setAnswer(prompt.id, text)}
              placeholder="Type your answer here..."
              placeholderTextColor={C.textLight}
              multiline
              maxLength={PHASE2_PROMPT_MAX_TEXT_LENGTH}
              textAlignVertical="top"
              autoFocus
              blurOnSubmit={false}
            />
            <View style={styles.inputFooter}>
              <Text
                style={[
                  styles.charCount,
                  charCount >= PHASE2_PROMPT_MIN_TEXT_LENGTH && styles.charCountValid,
                ]}
              >
                {charCount}/{PHASE2_PROMPT_MAX_TEXT_LENGTH}
              </Text>
              {charCount > 0 && charCount < PHASE2_PROMPT_MIN_TEXT_LENGTH && (
                <Text style={styles.minHint}>
                  {PHASE2_PROMPT_MIN_TEXT_LENGTH - charCount} more
                </Text>
              )}
              {hasValidAnswer && (
                <View style={styles.validIndicator}>
                  <Ionicons name="checkmark-circle" size={14} color={C.primary} />
                  <Text style={styles.validText}>Ready</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  // ============================================================
  // Section Header Component
  // ============================================================
  const renderSectionHeader = (
    title: string,
    subtitle: string,
    answered: number,
    total: number,
    complete: boolean
  ) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {complete && (
          <View style={styles.sectionCheckBadge}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        )}
      </View>
      <View style={styles.sectionMeta}>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        <View style={[styles.progressBadge, complete && styles.progressBadgeComplete]}>
          <Text style={[styles.progressText, complete && styles.progressTextComplete]}>
            {answered}/{total}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Your Answers</Text>
          <Text style={styles.stepLabel}>Step 4 of 5</Text>
        </View>
        <View style={styles.headerRight}>
          {section1Complete && section2Complete && section3Complete ? (
            <View style={[styles.totalBadge, styles.totalBadgeComplete]}>
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
            </View>
          ) : (
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>
                {(section1Complete ? 1 : 0) + (section2Complete ? 1 : 0) + (section3Complete ? 1 : 0)}/3
              </Text>
            </View>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 10 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[styles.content, { paddingBottom: 140 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Intro */}
          <View style={styles.introCard}>
            <Ionicons name="chatbubbles-outline" size={24} color={C.primary} />
            <View style={styles.introContent}>
              <Text style={styles.introTitle}>Complete all sections to continue</Text>
              <Text style={styles.introText}>
                Quick Questions: all 3 required{'\n'}
                Values & Personality: at least 1 each
              </Text>
            </View>
          </View>

          {/* ============================================================ */}
          {/* SECTION 1: Quick Questions (Multiple Choice - Inline Options) */}
          {/* ============================================================ */}
          <View style={styles.section}>
            {renderSectionHeader(
              'Quick Questions',
              'Answer all 3 questions',
              section1Answered,
              3,
              section1Complete
            )}
            <View style={styles.sectionContent}>
              {PHASE2_SECTION1_PROMPTS.map(renderSection1Question)}
            </View>
          </View>

          {/* ============================================================ */}
          {/* SECTION 2: Your Values (Text Input - Inline Expandable) */}
          {/* ============================================================ */}
          <View style={styles.section}>
            {renderSectionHeader(
              'Your Values',
              'Answer at least 1 question',
              section2Answered,
              3,
              section2Complete
            )}
            <View style={styles.sectionContent}>
              {PHASE2_SECTION2_PROMPTS.map(renderTextQuestion)}
            </View>
          </View>

          {/* ============================================================ */}
          {/* SECTION 3: Your Personality (Text Input - Inline Expandable) */}
          {/* ============================================================ */}
          <View style={styles.section}>
            {renderSectionHeader(
              'Your Personality',
              'Answer at least 1 question',
              section3Answered,
              3,
              section3Complete
            )}
            <View style={styles.sectionContent}>
              {PHASE2_SECTION3_PROMPTS.map(renderTextQuestion)}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom CTA */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <View style={styles.progressRow}>
          <View style={styles.progressItem}>
            <Ionicons
              name={section1Complete ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={section1Complete ? C.primary : C.textLight}
            />
            <Text style={[styles.progressLabel, section1Complete && styles.progressLabelDone]}>
              Quick
            </Text>
          </View>
          <View style={styles.progressDot} />
          <View style={styles.progressItem}>
            <Ionicons
              name={section2Complete ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={section2Complete ? C.primary : C.textLight}
            />
            <Text style={[styles.progressLabel, section2Complete && styles.progressLabelDone]}>
              Values
            </Text>
          </View>
          <View style={styles.progressDot} />
          <View style={styles.progressItem}>
            <Ionicons
              name={section3Complete ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={section3Complete ? C.primary : C.textLight}
            />
            <Text style={[styles.progressLabel, section3Complete && styles.progressLabelDone]}>
              Personality
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue || isSaving}
          activeOpacity={0.85}
        >
          {canContinue ? (
            <LinearGradient
              colors={[C.primary, '#9333EA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradient}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.continueButtonText}>Continue to review</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </>
              )}
            </LinearGradient>
          ) : (
            <View style={styles.buttonDisabledInner}>
              <Text style={styles.continueButtonTextDisabled}>Continue to review</Text>
              <Ionicons name="arrow-forward" size={18} color={C.textLight} />
            </View>
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
    paddingVertical: 14,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: C.surface,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stepLabel: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  totalBadge: {
    backgroundColor: C.primary + '25',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalBadgeComplete: {
    backgroundColor: C.primary,
  },
  totalBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.primary,
  },
  keyboard: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  introCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.primary + '12',
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: C.primary + '25',
  },
  introContent: {
    flex: 1,
  },
  introTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
    marginBottom: 2,
  },
  introText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },

  // Section Styles
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  sectionCheckBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
  },
  progressBadge: {
    backgroundColor: C.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  progressBadgeComplete: {
    backgroundColor: C.primary + '20',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textLight,
  },
  progressTextComplete: {
    color: C.primary,
  },
  sectionContent: {
    gap: 12,
  },

  // ============================================================
  // Section 1: Multiple Choice Styles
  // ============================================================
  s1QuestionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 16,
  },
  s1QuestionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  s1QuestionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    lineHeight: 22,
    marginRight: 8,
  },
  miniCheckBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  s1OptionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  s1OptionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  s1OptionChipSelected: {
    backgroundColor: C.primary + '18',
    borderColor: C.primary,
  },
  s1OptionText: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '500',
    flexShrink: 1,
  },
  s1OptionTextSelected: {
    color: C.text,
    fontWeight: '600',
  },
  s1CheckCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ============================================================
  // Section 2 & 3: Text Input Styles
  // ============================================================
  textQuestionWrapper: {
    marginBottom: 2,
  },
  textQuestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  textQuestionCardExpanded: {
    borderColor: C.primary + '60',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  textQuestionCardAnswered: {
    borderColor: C.primary + '40',
  },
  textQuestionContent: {
    flex: 1,
    marginRight: 12,
  },
  textQuestionText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    lineHeight: 20,
    marginBottom: 4,
  },
  textAnswerPreview: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },
  textPlaceholder: {
    fontSize: 13,
    color: C.textLight,
  },
  textQuestionRight: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Inline Input Container - Compact WhatsApp-style
  inlineInputContainer: {
    backgroundColor: CARD_BG_ACTIVE,
    borderWidth: 1,
    borderColor: C.primary + '60',
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
  },
  inlineTextInput: {
    fontSize: 15,
    color: C.text,
    lineHeight: 20,
    minHeight: 80,
    maxHeight: 140,
    textAlignVertical: 'top',
    paddingTop: 0,
    paddingBottom: 0,
  },
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.surface,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '500',
  },
  charCountValid: {
    color: C.primary,
  },
  minHint: {
    fontSize: 12,
    color: C.textLight,
  },
  validIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  validText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '600',
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    gap: 10,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  progressLabel: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '500',
  },
  progressLabelDone: {
    color: C.text,
  },
  progressDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surface,
  },
  continueButton: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  continueButtonDisabled: {
    backgroundColor: C.surface,
  },
  buttonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  buttonDisabledInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 14,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  continueButtonTextDisabled: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textLight,
  },
});
