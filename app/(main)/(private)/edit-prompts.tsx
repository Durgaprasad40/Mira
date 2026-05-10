/**
 * Phase-2 Edit Prompts Screen
 *
 * Edit prompt answers from profile WITHOUT going through onboarding flow.
 * This is a dedicated edit screen that loads existing answers and saves changes.
 *
 * IMPORTANT:
 * - No onboarding progress indicators
 * - No step navigation
 * - Just edit and save
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  PHASE2_SECTION2_PROMPTS,
  PHASE2_SECTION3_PROMPTS,
  PHASE2_PROMPT_MIN_TEXT_LENGTH,
  PHASE2_PROMPT_MAX_TEXT_LENGTH,
  Phase2PromptAnswer,
} from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

type SectionKey = 'section1' | 'section2' | 'section3';

// Map deep-link `section` query param onto our internal SectionKey. Anything
// outside the known set falls back to Section 1 (the original default), so
// stale or malformed links never produce a blank screen.
function resolveInitialSection(
  raw: string | string[] | undefined,
): SectionKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'values') return 'section2';
  if (value === 'personality') return 'section3';
  return 'section1';
}

export default function EditPromptsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const scrollViewRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ section?: 'quick' | 'values' | 'personality' }>();

  // Auth
  const { userId, token } = useAuthStore();
  const updatePrivateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);

  // Store
  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);
  const setPromptAnswers = usePrivateProfileStore((s) => s.setPromptAnswers);

  // Local state — initial expanded section honours the optional `section`
  // deep-link param, but default behaviour (no param) remains unchanged.
  const [expandedSection, setExpandedSection] = useState<SectionKey | null>(
    () => resolveInitialSection(params.section),
  );
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [draftPromptAnswers, setDraftPromptAnswers] = useState<Phase2PromptAnswer[]>(
    () => promptAnswers.map((answer) => ({ ...answer }))
  );

  const updateDraftPromptAnswer = useCallback((promptId: string, question: string, answer: string) => {
    const trimmedAnswer = answer.trim();
    setDraftPromptAnswers((current) => {
      const existingIndex = current.findIndex((item) => item.promptId === promptId);

      if (trimmedAnswer.length === 0) {
        if (existingIndex === -1) {
          return current;
        }
        return current.filter((item) => item.promptId !== promptId);
      }

      const nextAnswer: Phase2PromptAnswer = { promptId, question, answer: trimmedAnswer };
      if (existingIndex === -1) {
        return [...current, nextAnswer];
      }

      const next = [...current];
      next[existingIndex] = nextAnswer;
      return next;
    });
  }, []);

  const removeDraftPromptAnswer = useCallback((promptId: string) => {
    setDraftPromptAnswers((current) => current.filter((item) => item.promptId !== promptId));
  }, []);

  // Get current answer for a prompt
  const getAnswer = useCallback(
    (promptId: string) => {
      return draftPromptAnswers.find((a) => a.promptId === promptId)?.answer || '';
    },
    [draftPromptAnswers]
  );

  // Check if prompt is answered
  const isAnswered = useCallback(
    (promptId: string) => {
      const answer = getAnswer(promptId);
      return answer.trim().length > 0;
    },
    [getAnswer]
  );

  // Lookup table for the typed sections (2 + 3) so we can rehydrate the
  // question label when committing a draft answer.
  const ALL_TEXT_PROMPTS = useMemo(
    () => [...PHASE2_SECTION2_PROMPTS, ...PHASE2_SECTION3_PROMPTS],
    [],
  );

  // Toggle section expansion
  const toggleSection = (section: SectionKey) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  /**
   * Synchronously fold any in-progress inline edit into a fresh answers list.
   *
   * - Returns `{ ok: false }` and shows a single premium alert when the
   *   in-progress text is non-empty but shorter than the minimum length.
   * - Returns `{ ok: true, answers }` otherwise; `answers` is the merged list
   *   the caller can persist to backend / state without waiting on
   *   `setDraftPromptAnswers` to flush.
   */
  const applyDraftCommit = useCallback((): {
    answers: Phase2PromptAnswer[];
    ok: boolean;
  } => {
    let answers = draftPromptAnswers;
    if (!editingPrompt) return { answers, ok: true };

    const promptInfo = ALL_TEXT_PROMPTS.find((p) => p.id === editingPrompt);
    if (!promptInfo) {
      // Defensive: only typed prompts ever enter `editingPrompt`.
      return { answers, ok: true };
    }

    const trimmed = draftAnswer.trim();
    if (trimmed.length === 0) {
      answers = answers.filter((a) => a.promptId !== editingPrompt);
      return { answers, ok: true };
    }
    if (trimmed.length < PHASE2_PROMPT_MIN_TEXT_LENGTH) {
      Alert.alert(
        'Answer is too short',
        `Each answer needs at least ${PHASE2_PROMPT_MIN_TEXT_LENGTH} characters, or leave it empty.`,
      );
      return { answers, ok: false };
    }

    const next: Phase2PromptAnswer = {
      promptId: editingPrompt,
      question: promptInfo.question,
      answer: trimmed,
    };
    const idx = answers.findIndex((a) => a.promptId === editingPrompt);
    if (idx === -1) {
      answers = [...answers, next];
    } else {
      answers = [...answers];
      answers[idx] = next;
    }
    return { answers, ok: true };
  }, [ALL_TEXT_PROMPTS, draftAnswer, draftPromptAnswers, editingPrompt]);

  // Start editing a prompt. Switching away from another in-progress prompt
  // commits its draft first; if the previous draft is invalid, we keep the
  // user on the current prompt instead of silently losing their text.
  const startEditing = (promptId: string) => {
    if (editingPrompt && editingPrompt !== promptId) {
      const { answers, ok } = applyDraftCommit();
      if (!ok) return;
      setDraftPromptAnswers(answers);
    }
    setEditingPrompt(promptId);
    setDraftAnswer(getAnswer(promptId));
  };

  // Select answer for multiple choice (Section 1). MC selections never enter
  // `editingPrompt`, so they're independent of the typed-prompt commit flow.
  const selectMultipleChoiceAnswer = (promptId: string, question: string, option: string) => {
    const current = getAnswer(promptId);
    if (current === option) {
      removeDraftPromptAnswer(promptId);
    } else {
      updateDraftPromptAnswer(promptId, question, option);
    }
  };

  // Scroll the focused TextInput safely above the keyboard while keeping the
  // question text visible just above it. Uses ScrollView's responder API,
  // which works on both iOS and Android with a single code path.
  const handleInputFocus = useCallback((event: any) => {
    const sv: any = scrollViewRef.current;
    if (!sv) return;
    const reactTag = event?.target;
    if (reactTag == null) return;
    // Wait for the keyboard animation + KeyboardAvoidingView resize to
    // settle before measuring; otherwise the scroll target is computed
    // against the pre-keyboard layout.
    setTimeout(() => {
      const scrollResponder = sv.getScrollResponder?.();
      scrollResponder?.scrollResponderScrollNativeHandleToKeyboard?.(
        reactTag,
        120, // additional offset above keyboard so the question stays visible
        true,
      );
    }, 80);
  }, []);

  const normalizedSavedAnswers = useMemo(
    () =>
      JSON.stringify(
        [...promptAnswers]
          .map((answer) => ({ ...answer }))
          .sort((a, b) => a.promptId.localeCompare(b.promptId))
      ),
    [promptAnswers]
  );

  const normalizedDraftAnswers = useMemo(
    () =>
      JSON.stringify(
        [...draftPromptAnswers]
          .map((answer) => ({ ...answer }))
          .sort((a, b) => a.promptId.localeCompare(b.promptId))
      ),
    [draftPromptAnswers]
  );

  const hasPendingInlineEdit = useMemo(() => {
    if (!editingPrompt) {
      return false;
    }

    return draftAnswer.trim() !== getAnswer(editingPrompt).trim();
  }, [draftAnswer, editingPrompt, getAnswer]);

  const hasUnsavedChanges = normalizedDraftAnswers !== normalizedSavedAnswers || hasPendingInlineEdit;

  /**
   * Persist the given answers to the Convex backend (or store, in demo mode).
   * Returns true on success so the caller can continue with navigation.
   */
  const persistAnswers = useCallback(
    async (answers: Phase2PromptAnswer[]): Promise<boolean> => {
      if (isDemoMode) {
        setPromptAnswers(answers);
        return true;
      }

      if (!userId || !token) {
        Alert.alert('Error', 'Please sign in to save changes.');
        return false;
      }

      setIsSaving(true);
      try {
        await updatePrivateProfile({
          token,
          authUserId: userId,
          promptAnswers: answers,
        });
        setPromptAnswers(answers);
        return true;
      } catch (error) {
        if (__DEV__) {
          console.error('[EditPrompts] Save failed:', error);
        }
        Alert.alert("Couldn't save", 'Failed to save changes. Please try again.');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [setPromptAnswers, token, updatePrivateProfile, userId],
  );

  // Auto-save on back: commit any in-progress inline edit, then persist the
  // resulting list and let the navigation action proceed. Validation failure
  // keeps the user on the screen with a clear message — we never silently
  // drop typed text.
  usePreventRemove(hasUnsavedChanges && !isSaving, ({ data }) => {
    const { answers, ok } = applyDraftCommit();
    if (!ok) return;

    setDraftPromptAnswers(answers);
    setEditingPrompt(null);
    setDraftAnswer('');
    Keyboard.dismiss();

    void (async () => {
      const saved = await persistAnswers(answers);
      if (saved) {
        navigation.dispatch(data.action);
      }
    })();
  });

  // Save all changes to backend (top-right Save button).
  const handleSave = async () => {
    const { answers, ok } = applyDraftCommit();
    if (!ok) return;

    setDraftPromptAnswers(answers);
    setEditingPrompt(null);
    setDraftAnswer('');
    Keyboard.dismiss();

    const saved = await persistAnswers(answers);
    if (saved) {
      router.back();
    }
  };

  // Count answered prompts per section
  const getAnsweredCount = (prompts: ReadonlyArray<{ readonly id: string }>) => {
    return prompts.filter((p) => isAnswered(p.id)).length;
  };

  // Render Section 1 (Multiple Choice)
  const renderSection1 = () => {
    const isExpanded = expandedSection === 'section1';
    const answeredCount = getAnsweredCount(PHASE2_SECTION1_PROMPTS);

    return (
      <View style={styles.sectionCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleSection('section1')}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionTitle}>Quick Questions</Text>
            <Text style={styles.sectionSubtitle}>{answeredCount}/3 answered</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={C.textLight}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.sectionContent}>
            {PHASE2_SECTION1_PROMPTS.map((prompt) => {
              const currentAnswer = getAnswer(prompt.id);
              return (
                <View key={prompt.id} style={styles.promptBlock}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>
                  <View style={styles.optionsGrid}>
                    {prompt.options.map((option) => (
                      <TouchableOpacity
                        key={option}
                        style={[
                          styles.optionChip,
                          currentAnswer === option && styles.optionChipSelected,
                        ]}
                        onPress={() => selectMultipleChoiceAnswer(prompt.id, prompt.question, option)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            currentAnswer === option && styles.optionTextSelected,
                          ]}
                        >
                          {option}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  // Render text input sections (Section 2 & 3)
  const renderTextSection = (
    sectionKey: 'section2' | 'section3',
    title: string,
    prompts: ReadonlyArray<{ readonly id: string; readonly question: string }>
  ) => {
    const isExpanded = expandedSection === sectionKey;
    const answeredCount = getAnsweredCount(prompts);

    return (
      <View style={styles.sectionCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleSection(sectionKey)}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionSubtitle}>{answeredCount}/3 answered</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={C.textLight}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.sectionContent}>
            {prompts.map((prompt) => {
              const currentAnswer = getAnswer(prompt.id);
              const isEditing = editingPrompt === prompt.id;

              return (
                <View key={prompt.id} style={styles.promptBlock}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>

                  {isEditing ? (
                    <View style={styles.editArea}>
                      <TextInput
                        style={styles.textInput}
                        value={draftAnswer}
                        onChangeText={setDraftAnswer}
                        onFocus={handleInputFocus}
                        placeholder="Type your answer..."
                        placeholderTextColor={C.textLight}
                        multiline
                        maxLength={PHASE2_PROMPT_MAX_TEXT_LENGTH}
                        autoFocus
                      />
                      <Text style={styles.charCount}>
                        {draftAnswer.length}/{PHASE2_PROMPT_MAX_TEXT_LENGTH}
                      </Text>
                      <Text style={styles.editHint}>
                        Tap Save in the top right or back to save your answer.
                      </Text>
                    </View>
                  ) : currentAnswer ? (
                    <TouchableOpacity
                      style={styles.answerCard}
                      onPress={() => startEditing(prompt.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.answerText} numberOfLines={3}>
                        {currentAnswer}
                      </Text>
                      <Ionicons name="pencil" size={14} color={C.primary} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.addAnswerBtn}
                      onPress={() => startEditing(prompt.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={18} color={C.primary} />
                      <Text style={styles.addAnswerText}>Add answer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Answers</Text>
          <TouchableOpacity
            style={[styles.doneBtn, isSaving && styles.doneBtnDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            <Text style={styles.doneBtnText}>{isSaving ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderSection1()}
          {renderTextSection('section2', 'Your Values', PHASE2_SECTION2_PROMPTS)}
          {renderTextSection('section3', 'Your Personality', PHASE2_SECTION3_PROMPTS)}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  doneBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: C.primary,
    borderRadius: 16,
  },
  doneBtnDisabled: {
    opacity: 0.6,
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 240,
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
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 2,
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  promptBlock: {
    marginBottom: 20,
  },
  promptQuestion: {
    fontSize: 14,
    fontWeight: '500',
    color: C.text,
    marginBottom: 10,
    lineHeight: 20,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.border,
  },
  optionChipSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  optionText: {
    fontSize: 13,
    color: C.text,
  },
  optionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  editArea: {
    backgroundColor: C.accent,
    borderRadius: 12,
    padding: 12,
  },
  textInput: {
    fontSize: 15,
    color: C.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  editHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 8,
    lineHeight: 16,
  },
  answerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.accent,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },
  answerText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
    marginRight: 8,
  },
  addAnswerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
  },
  addAnswerText: {
    fontSize: 14,
    color: C.primary,
    fontWeight: '500',
  },
});
