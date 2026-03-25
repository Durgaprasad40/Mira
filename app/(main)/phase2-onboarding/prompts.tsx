/**
 * Phase-2 Onboarding Step 3: Prompts/Questions
 *
 * Four collapsible sections:
 * - Section 1: Multiple choice prompts (1-3)
 * - Section 2: Text input prompts (4-6)
 * - Section 3: Text input prompts (7-9)
 * - Section 4: Preference Strength (ranking signal)
 *
 * Validation:
 * - At least 1 answered prompt per section (1-3) required
 * - All 3 preference strength items required
 */
import React, { useState, useCallback, useRef } from 'react';
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
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  PHASE2_SECTION2_PROMPTS,
  PHASE2_SECTION3_PROMPTS,
  PHASE2_PROMPT_MIN_TEXT_LENGTH,
  PHASE2_PROMPT_MAX_TEXT_LENGTH,
  Phase2PromptAnswer,
  PREFERENCE_STRENGTH_OPTIONS,
  INTENT_MATCH_OPTIONS,
  PreferenceStrengthValue,
  IntentMatchValue,
} from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { Button } from '@/components/ui';

// P2-PHOTO-001: Updated step numbers for 5-step flow
const TOTAL_STEPS = 5;
const CURRENT_STEP = 4;

type SectionKey = 'section1' | 'section2' | 'section3' | 'section4';

export default function Phase2PromptsScreen() {
  const router = useRouter();
  const isNavigating = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const inputLayoutRef = useRef<{ y: number; height: number } | null>(null);

  // Check if opened from review screen (Step 5)
  const { fromReview } = useLocalSearchParams<{ fromReview?: string }>();
  const isFromReview = fromReview === 'true';

  // Store
  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);
  const setPromptAnswer = usePrivateProfileStore((s) => s.setPromptAnswer);
  const removePromptAnswer = usePrivateProfileStore((s) => s.removePromptAnswer);
  const preferenceStrength = usePrivateProfileStore((s) => s.preferenceStrength);
  const setPreferenceStrength = usePrivateProfileStore((s) => s.setPreferenceStrength);

  // Local state for accordion expansion
  const [expandedSection, setExpandedSection] = useState<SectionKey | null>('section1');

  // Local state for editing (which prompt is being answered)
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [draftAnswer, setDraftAnswer] = useState('');

  // Track selected sub-question per text section (Q2/Q3)
  // Only the selected sub-question shows its input area
  const [selectedSubQuestion, setSelectedSubQuestion] = useState<{
    section2: string | null;
    section3: string | null;
  }>({ section2: null, section3: null });

  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Track input height for auto-grow
  const [inputHeight, setInputHeight] = useState(40);

  // Scroll to input when focused (fixes keyboard overlap on Android)
  const handleInputFocus = useCallback(() => {
    // Delay slightly to let keyboard appear
    setTimeout(() => {
      if (inputLayoutRef.current && scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          y: inputLayoutRef.current.y - 100, // Scroll with some padding above
          animated: true,
        });
      }
    }, 300);
  }, []);

  // Track input container layout for scroll targeting
  const handleInputLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    inputLayoutRef.current = { y, height };
  }, []);

  // Helper: get answer for a prompt
  const getAnswer = useCallback((promptId: string): string | undefined => {
    const found = promptAnswers.find((a) => a.promptId === promptId);
    return found?.answer;
  }, [promptAnswers]);

  // Helper: count answered prompts in a section
  const countAnswered = useCallback((sectionPrompts: readonly { id: string }[]): number => {
    return sectionPrompts.filter((p) => {
      const answer = getAnswer(p.id);
      return answer && answer.trim().length > 0;
    }).length;
  }, [getAnswer]);

  // Section counts
  const section1Count = countAnswered(PHASE2_SECTION1_PROMPTS);
  const section2Count = countAnswered(PHASE2_SECTION2_PROMPTS);
  const section3Count = countAnswered(PHASE2_SECTION3_PROMPTS);

  // Preference strength completeness check (done in-screen, not via store selector)
  const prefStrengthCount =
    (preferenceStrength.smoking ? 1 : 0) +
    (preferenceStrength.drinking ? 1 : 0) +
    (preferenceStrength.intent ? 1 : 0);
  const isPrefStrengthComplete = prefStrengthCount === 3;

  // Toggle section expansion
  const toggleSection = (section: SectionKey) => {
    setExpandedSection((prev) => (prev === section ? null : section));
    setEditingPrompt(null);
    setDraftAnswer('');
    // P2-003 FIX: Clear validation error when changing sections
    setValidationError(null);
    // Reset selected sub-question when collapsing
    if (expandedSection === section) {
      setSelectedSubQuestion({ section2: null, section3: null });
    }
    Keyboard.dismiss();
  };

  // Handle selecting a sub-question in Q2/Q3 (Phase-1 style)
  // When user taps a sub-question, select it and show its input
  // If another sub-question was previously answered in same section, it gets replaced
  const handleSelectSubQuestion = (
    sectionKey: 'section2' | 'section3',
    promptId: string,
    question: string
  ) => {
    // Update selected sub-question for this section
    setSelectedSubQuestion((prev) => ({
      ...prev,
      [sectionKey]: promptId,
    }));

    // Load existing answer if any
    const existingAnswer = getAnswer(promptId) || '';
    setEditingPrompt(promptId);
    setDraftAnswer(existingAnswer);

    // P2-003 FIX: Clear validation error when switching sub-questions
    setValidationError(null);

    // Reset input height to compact (will grow if existing answer is long)
    setInputHeight(existingAnswer ? 60 : 40);
  };

  // Save text answer for Q2/Q3 (clears other answers in same section - only 1 allowed)
  const saveTextAnswerForSection = (
    sectionKey: 'section2' | 'section3',
    promptId: string,
    question: string,
    sectionPrompts: readonly { id: string; question: string }[]
  ) => {
    const trimmed = draftAnswer.trim();

    // Validation: require minimum length
    if (trimmed.length > 0 && trimmed.length < PHASE2_PROMPT_MIN_TEXT_LENGTH) {
      // Don't save if too short - show validation feedback
      setValidationError(`Answer must be at least ${PHASE2_PROMPT_MIN_TEXT_LENGTH} characters`);
      return;
    }

    // Clear any other answers in the same section first (only 1 answer allowed)
    sectionPrompts.forEach((p) => {
      if (p.id !== promptId) {
        removePromptAnswer(p.id);
      }
    });

    if (trimmed.length >= PHASE2_PROMPT_MIN_TEXT_LENGTH) {
      setPromptAnswer(promptId, question, trimmed);
      setValidationError(null);
    } else if (trimmed.length === 0) {
      removePromptAnswer(promptId);
      setValidationError(null);
    }

    // FIX: Reset selected sub-question so UI closes the input area
    setSelectedSubQuestion((prev) => ({ ...prev, [sectionKey]: null }));
    setEditingPrompt(null);
    setDraftAnswer('');
    setInputHeight(40); // Reset to compact
    Keyboard.dismiss();
  };

  // Handle multiple choice selection (Section 1)
  const handleChoiceSelect = (promptId: string, question: string, option: string) => {
    setPromptAnswer(promptId, question, option);
    setValidationError(null);
  };

  // Start editing a text prompt (Section 2/3)
  const startTextEdit = (promptId: string) => {
    const existingAnswer = getAnswer(promptId) || '';
    setEditingPrompt(promptId);
    setDraftAnswer(existingAnswer);
  };

  // Save text answer
  const saveTextAnswer = (promptId: string, question: string) => {
    const trimmed = draftAnswer.trim();
    if (trimmed.length >= PHASE2_PROMPT_MIN_TEXT_LENGTH) {
      setPromptAnswer(promptId, question, trimmed);
      setValidationError(null);
    } else if (trimmed.length === 0) {
      removePromptAnswer(promptId);
    }
    setEditingPrompt(null);
    setDraftAnswer('');
    Keyboard.dismiss();
  };

  // Cancel text editing
  const cancelTextEdit = () => {
    setEditingPrompt(null);
    setDraftAnswer('');
    Keyboard.dismiss();
  };

  // Validate all sections and continue
  const handleContinue = () => {
    if (isNavigating.current) return;

    // Validation: at least 1 answered per section
    if (section1Count < 1) {
      setValidationError('Please answer at least 1 question in "Question 1"');
      setExpandedSection('section1');
      return;
    }
    if (section2Count < 1) {
      setValidationError('Please answer at least 1 question in "Question 2"');
      setExpandedSection('section2');
      return;
    }
    if (section3Count < 1) {
      setValidationError('Please answer at least 1 question in "Question 3"');
      setExpandedSection('section3');
      return;
    }
    // Validation: all 3 preference strength items required
    if (!isPrefStrengthComplete) {
      setValidationError('Please complete all preference strength selections');
      setExpandedSection('section4');
      return;
    }

    setValidationError(null);
    isNavigating.current = true;

    // FIX: If opened from review, go back to review instead of pushing again
    if (isFromReview) {
      router.back();
    } else {
      // Navigate to Step 5 (review)
      router.push('/(main)/phase2-onboarding/profile-setup' as any);
    }

    // Reset navigation lock after delay
    setTimeout(() => {
      isNavigating.current = false;
    }, 1000);
  };

  // Go back to Step 2
  const handleBack = () => {
    if (isNavigating.current) return;
    isNavigating.current = true;
    router.back();
    setTimeout(() => {
      isNavigating.current = false;
    }, 1000);
  };

  // Render Section 1 (Multiple Choice)
  const renderSection1 = () => (
    <View style={styles.sectionContent}>
      {PHASE2_SECTION1_PROMPTS.map((prompt) => {
        const currentAnswer = getAnswer(prompt.id);
        return (
          <View key={prompt.id} style={styles.promptCard}>
            <Text style={styles.promptQuestion}>{prompt.question}</Text>
            <View style={styles.optionsContainer}>
              {prompt.options.map((option) => {
                const isSelected = currentAnswer === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.optionChip, isSelected && styles.optionChipSelected]}
                    onPress={() => handleChoiceSelect(prompt.id, prompt.question, option)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                      {option}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={18} color={COLORS.background} style={styles.checkIcon} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );

  // Render Text Input Section (Section 2/3) - Phase-1 Style
  // Sub-questions shown as collapsed list with radio buttons
  // Tap a sub-question to select it and reveal its input area
  // Only ONE answer allowed per section
  const renderTextSection = (
    sectionKey: 'section2' | 'section3',
    sectionPrompts: readonly { id: string; question: string }[]
  ) => {
    const selectedId = selectedSubQuestion[sectionKey];
    // Find the answered prompt in this section (if any)
    const answeredPrompt = sectionPrompts.find((p) => {
      const answer = getAnswer(p.id);
      return answer && answer.trim().length > 0;
    });

    return (
      <View style={styles.sectionContent}>
        <Text style={styles.subQuestionHint}>Tap a question to answer (1 answer only):</Text>
        {sectionPrompts.map((prompt) => {
          const currentAnswer = getAnswer(prompt.id);
          const isSelected = selectedId === prompt.id;
          const hasAnswer = currentAnswer && currentAnswer.trim().length > 0;
          const isEditing = editingPrompt === prompt.id;
          // Show checkmark if this prompt has a saved valid answer
          const hasValidAnswer = hasAnswer && currentAnswer.trim().length >= PHASE2_PROMPT_MIN_TEXT_LENGTH;

          return (
            <View key={prompt.id} style={styles.subQuestionContainer}>
              {/* Sub-question row with radio button */}
              <TouchableOpacity
                style={[styles.subQuestionRow, isSelected && styles.subQuestionRowSelected]}
                onPress={() => handleSelectSubQuestion(sectionKey, prompt.id, prompt.question)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={isSelected ? COLORS.primary : COLORS.textMuted}
                />
                <Text
                  style={[styles.subQuestionText, isSelected && styles.subQuestionTextSelected]}
                  numberOfLines={isSelected ? undefined : 2}
                >
                  {prompt.question}
                </Text>
                {hasValidAnswer && !isSelected && (
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                )}
              </TouchableOpacity>

              {/* Input area - only shown when this sub-question is selected */}
              {isSelected && (
                <View
                  style={styles.subQuestionInputContainer}
                  onLayout={handleInputLayout}
                >
                  <TextInput
                    style={[
                      styles.subQuestionInput,
                      { height: Math.max(40, Math.min(inputHeight, 120)) }, // Compact with auto-grow, max 120
                    ]}
                    value={draftAnswer}
                    onChangeText={setDraftAnswer}
                    onContentSizeChange={(e) => {
                      // Auto-grow input as user types
                      setInputHeight(e.nativeEvent.contentSize.height);
                    }}
                    onFocus={handleInputFocus}
                    placeholder="Type your answer..."
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                    maxLength={PHASE2_PROMPT_MAX_TEXT_LENGTH}
                    autoFocus
                    scrollEnabled={inputHeight > 120} // Enable scroll when at max height
                  />
                  <View style={styles.subQuestionInputFooter}>
                    <View style={styles.charCountRow}>
                      {draftAnswer.length > 0 && draftAnswer.length < PHASE2_PROMPT_MIN_TEXT_LENGTH && (
                        <Text style={styles.minRequired}>
                          {PHASE2_PROMPT_MIN_TEXT_LENGTH - draftAnswer.length} more chars
                        </Text>
                      )}
                      <Text style={styles.charCount}>
                        {draftAnswer.length}/{PHASE2_PROMPT_MAX_TEXT_LENGTH}
                      </Text>
                    </View>
                    <View style={styles.textButtonRow}>
                      <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={() => {
                          setSelectedSubQuestion((prev) => ({ ...prev, [sectionKey]: null }));
                          setEditingPrompt(null);
                          setDraftAnswer('');
                          setInputHeight(40); // Reset to compact
                          Keyboard.dismiss();
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.saveButton,
                          draftAnswer.trim().length < PHASE2_PROMPT_MIN_TEXT_LENGTH &&
                            draftAnswer.trim().length > 0 &&
                            styles.saveButtonDisabled,
                        ]}
                        onPress={() =>
                          saveTextAnswerForSection(sectionKey, prompt.id, prompt.question, sectionPrompts)
                        }
                        disabled={
                          draftAnswer.trim().length > 0 &&
                          draftAnswer.trim().length < PHASE2_PROMPT_MIN_TEXT_LENGTH
                        }
                      >
                        <Text style={styles.saveButtonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {/* Show saved answer preview when not selected */}
              {!isSelected && hasValidAnswer && (
                <View style={styles.savedAnswerPreview}>
                  <Text style={styles.savedAnswerText} numberOfLines={2}>
                    {currentAnswer}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  // Render collapsible section header
  const renderSectionHeader = (
    title: string,
    sectionKey: SectionKey,
    answered: number,
    total: number
  ) => {
    const isExpanded = expandedSection === sectionKey;
    const hasMinimum = answered >= 1;

    return (
      <TouchableOpacity
        style={[styles.sectionHeader, isExpanded && styles.sectionHeaderExpanded]}
        onPress={() => toggleSection(sectionKey)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={[styles.countBadge, hasMinimum && styles.countBadgeComplete]}>
            <Text style={[styles.countText, hasMinimum && styles.countTextComplete]}>
              {answered}/{total} answered
            </Text>
          </View>
        </View>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={COLORS.text}
        />
      </TouchableOpacity>
    );
  };

  // Render Preference Strength section header
  const renderPrefStrengthHeader = () => {
    const isExpanded = expandedSection === 'section4';

    return (
      <TouchableOpacity
        style={[styles.sectionHeader, isExpanded && styles.sectionHeaderExpanded]}
        onPress={() => toggleSection('section4')}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionTitle}>Preference Strength</Text>
          <View style={[styles.countBadge, isPrefStrengthComplete && styles.countBadgeComplete]}>
            <Text style={[styles.countText, isPrefStrengthComplete && styles.countTextComplete]}>
              {prefStrengthCount}/3 selected
            </Text>
          </View>
        </View>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={COLORS.text}
        />
      </TouchableOpacity>
    );
  };

  // Render Preference Strength section content
  const renderPrefStrengthSection = () => (
    <View style={styles.sectionContent}>
      {/* Smoking preference */}
      <View style={styles.promptCard}>
        <Text style={styles.promptQuestion}>How important is smoking compatibility?</Text>
        <View style={styles.optionsContainer}>
          {PREFERENCE_STRENGTH_OPTIONS.map((opt) => {
            const isSelected = preferenceStrength.smoking === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, isSelected && styles.optionChipSelected]}
                onPress={() => {
                  setPreferenceStrength('smoking', opt.value as PreferenceStrengthValue);
                  setValidationError(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.background} style={styles.checkIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Drinking preference */}
      <View style={styles.promptCard}>
        <Text style={styles.promptQuestion}>How important is drinking compatibility?</Text>
        <View style={styles.optionsContainer}>
          {PREFERENCE_STRENGTH_OPTIONS.map((opt) => {
            const isSelected = preferenceStrength.drinking === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, isSelected && styles.optionChipSelected]}
                onPress={() => {
                  setPreferenceStrength('drinking', opt.value as PreferenceStrengthValue);
                  setValidationError(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.background} style={styles.checkIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Intent match preference */}
      <View style={styles.promptCard}>
        <Text style={styles.promptQuestion}>How important is relationship intent compatibility?</Text>
        <View style={styles.optionsContainer}>
          {INTENT_MATCH_OPTIONS.map((opt) => {
            const isSelected = preferenceStrength.intent === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, isSelected && styles.optionChipSelected]}
                onPress={() => {
                  setPreferenceStrength('intent', opt.value as IntentMatchValue);
                  setValidationError(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt.label}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.background} style={styles.checkIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.stepIndicator}>Step {CURRENT_STEP} of {TOTAL_STEPS}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        >
          {/* Title */}
          <Text style={styles.title}>Tell us about yourself</Text>
          <Text style={styles.subtitle}>
            Answer at least 1 question in each section to continue.
          </Text>

          {/* Validation Error */}
          {validationError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color={COLORS.error} />
              <Text style={styles.errorText}>{validationError}</Text>
            </View>
          )}

          {/* Section 1: Multiple Choice */}
          <View style={styles.section}>
            {renderSectionHeader('Question 1', 'section1', section1Count, PHASE2_SECTION1_PROMPTS.length)}
            {expandedSection === 'section1' && renderSection1()}
          </View>

          {/* Section 2: Text Input (1 answer only) */}
          <View style={styles.section}>
            {renderSectionHeader('Question 2', 'section2', Math.min(section2Count, 1), 1)}
            {expandedSection === 'section2' && renderTextSection('section2', PHASE2_SECTION2_PROMPTS)}
          </View>

          {/* Section 3: Text Input (1 answer only) */}
          <View style={styles.section}>
            {renderSectionHeader('Question 3', 'section3', Math.min(section3Count, 1), 1)}
            {expandedSection === 'section3' && renderTextSection('section3', PHASE2_SECTION3_PROMPTS)}
          </View>

          {/* Section 4: Preference Strength */}
          <View style={styles.section}>
            {renderPrefStrengthHeader()}
            {expandedSection === 'section4' && renderPrefStrengthSection()}
          </View>

          {/* Spacer for button */}
          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Button
            title={isFromReview ? 'Save & Return' : 'Continue'}
            variant="primary"
            onPress={handleContinue}
            fullWidth
            disabled={section1Count < 1 || section2Count < 1 || section3Count < 1 || !isPrefStrengthComplete}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  stepIndicator: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    marginBottom: 20,
    lineHeight: 21,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '40',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.error,
    flex: 1,
  },
  section: {
    marginBottom: 12,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  sectionHeaderExpanded: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  countBadge: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  countBadgeComplete: {
    backgroundColor: COLORS.primary + '20',
  },
  countText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  countTextComplete: {
    color: COLORS.primary,
  },
  sectionContent: {
    padding: 16,
    paddingTop: 12,
  },
  promptCard: {
    marginBottom: 16,
  },
  promptQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
    lineHeight: 21,
  },
  optionsContainer: {
    gap: 8,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  optionChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  optionTextSelected: {
    color: COLORS.background,
    fontWeight: '600',
  },
  checkIcon: {
    marginLeft: 8,
  },
  textInputContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },
  textInput: {
    fontSize: 15,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
    lineHeight: 21,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 6,
  },
  minRequired: {
    color: COLORS.error,
  },
  textButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  saveButtonText: {
    fontSize: 14,
    color: COLORS.background,
    fontWeight: '600',
  },
  answeredContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
    padding: 12,
  },
  answeredText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
    lineHeight: 20,
  },
  addAnswerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    gap: 8,
  },
  addAnswerText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  bottomSpacer: {
    height: 20,
  },
  footer: {
    padding: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  // Phase-1 style sub-question styles for Q2/Q3
  subQuestionHint: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 12,
    fontWeight: '500',
  },
  subQuestionContainer: {
    marginBottom: 8,
  },
  subQuestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  subQuestionRowSelected: {
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  subQuestionText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
    lineHeight: 20,
  },
  subQuestionTextSelected: {
    fontWeight: '500',
    color: COLORS.primary,
  },
  subQuestionInputContainer: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: COLORS.primary,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    padding: 12,
  },
  subQuestionInput: {
    fontSize: 14,
    color: COLORS.text,
    // Height is now controlled dynamically via inline style for auto-grow
    // Starts compact (40px), grows up to 120px max
    textAlignVertical: 'top',
    lineHeight: 20,
    padding: 0,
  },
  subQuestionInputFooter: {
    marginTop: 8,
  },
  charCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  savedAnswerPreview: {
    marginLeft: 30,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.background,
    borderRadius: 6,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.success,
  },
  savedAnswerText: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },
});
