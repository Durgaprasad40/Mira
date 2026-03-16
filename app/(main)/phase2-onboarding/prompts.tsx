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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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

  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null);

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

    // Navigate to Step 4 (review)
    router.push('/(main)/phase2-onboarding/profile-setup' as any);

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

  // Render Text Input Section (Section 2/3)
  const renderTextSection = (sectionPrompts: readonly { id: string; question: string }[]) => (
    <View style={styles.sectionContent}>
      {sectionPrompts.map((prompt) => {
        const currentAnswer = getAnswer(prompt.id);
        const isEditing = editingPrompt === prompt.id;
        const hasAnswer = currentAnswer && currentAnswer.trim().length > 0;

        return (
          <View key={prompt.id} style={styles.promptCard}>
            <Text style={styles.promptQuestion}>{prompt.question}</Text>

            {isEditing ? (
              <View style={styles.textInputContainer}>
                <TextInput
                  style={styles.textInput}
                  value={draftAnswer}
                  onChangeText={setDraftAnswer}
                  placeholder="Type your answer..."
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  maxLength={PHASE2_PROMPT_MAX_TEXT_LENGTH}
                  autoFocus
                />
                <Text style={styles.charCount}>
                  {draftAnswer.length}/{PHASE2_PROMPT_MAX_TEXT_LENGTH}
                  {draftAnswer.length > 0 && draftAnswer.length < PHASE2_PROMPT_MIN_TEXT_LENGTH && (
                    <Text style={styles.minRequired}> (min {PHASE2_PROMPT_MIN_TEXT_LENGTH})</Text>
                  )}
                </Text>
                <View style={styles.textButtonRow}>
                  <TouchableOpacity style={styles.cancelButton} onPress={cancelTextEdit}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.saveButton,
                      draftAnswer.trim().length < PHASE2_PROMPT_MIN_TEXT_LENGTH && draftAnswer.trim().length > 0 && styles.saveButtonDisabled,
                    ]}
                    onPress={() => saveTextAnswer(prompt.id, prompt.question)}
                    disabled={draftAnswer.trim().length > 0 && draftAnswer.trim().length < PHASE2_PROMPT_MIN_TEXT_LENGTH}
                  >
                    <Text style={styles.saveButtonText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : hasAnswer ? (
              <TouchableOpacity style={styles.answeredContainer} onPress={() => startTextEdit(prompt.id)}>
                <Text style={styles.answeredText} numberOfLines={3}>{currentAnswer}</Text>
                <Ionicons name="pencil" size={16} color={COLORS.primary} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.addAnswerButton} onPress={() => startTextEdit(prompt.id)}>
                <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                <Text style={styles.addAnswerText}>Add your answer</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );

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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
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
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
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

          {/* Section 2: Text Input */}
          <View style={styles.section}>
            {renderSectionHeader('Question 2', 'section2', section2Count, PHASE2_SECTION2_PROMPTS.length)}
            {expandedSection === 'section2' && renderTextSection(PHASE2_SECTION2_PROMPTS)}
          </View>

          {/* Section 3: Text Input */}
          <View style={styles.section}>
            {renderSectionHeader('Question 3', 'section3', section3Count, PHASE2_SECTION3_PROMPTS.length)}
            {expandedSection === 'section3' && renderTextSection(PHASE2_SECTION3_PROMPTS)}
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
            title="Continue"
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
});
