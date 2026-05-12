/**
 * Phase-1 Onboarding: Prompts Part 2 (Section-Based Prompts)
 *
 * Fixed 4-prompt section system:
 * - 4 sections displayed as Section 1, Section 2, Section 3, Section 4
 * - Each section has 4 predefined questions
 * - User selects exactly 1 question per section (replace behavior)
 * - Total: 4 answered prompts (one per section)
 * - 20-200 character answers required
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  BUILDER_PROMPTS,
  PERFORMER_PROMPTS,
  SEEKER_PROMPTS,
  GROUNDED_PROMPTS,
  PROMPT_ANSWER_MIN_LENGTH,
  PROMPT_ANSWER_MAX_LENGTH,
  TOTAL_SECTIONS,
} from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

// Note: LayoutAnimation is enabled by default on Android since React Native 0.62+
// The setLayoutAnimationEnabledExperimental call is no longer needed

// Section key type
type SectionKey = 'builder' | 'performer' | 'seeker' | 'grounded';

// Prompt entry with section identity
type SectionPromptEntry = {
  section: SectionKey;
  question: string;
  answer: string;
};

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'builder' || value === 'performer' || value === 'seeker' || value === 'grounded';
}

// Section configuration with display labels (Section 1-4)
const SECTIONS: { key: SectionKey; label: string; questions: { id: string; text: string }[] }[] = [
  { key: 'builder', label: 'Section 1', questions: BUILDER_PROMPTS },
  { key: 'performer', label: 'Section 2', questions: PERFORMER_PROMPTS },
  { key: 'seeker', label: 'Section 3', questions: SEEKER_PROMPTS },
  { key: 'grounded', label: 'Section 4', questions: GROUNDED_PROMPTS },
];

export default function PromptsPart2Screen() {
  useScreenTrace('ONB_PROMPTS_PART2');

  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ editFromReview?: string }>();
  const isEditFromReview = params.editFromReview === 'true';

  // Auth and persistence
  const { userId, token } = useAuthStore();
  const updateProfilePrompts = useMutation(api.users.updateProfilePrompts);

  // Store state and actions
  const { profilePrompts, setProfilePrompts, setStep } = useOnboardingStore();
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);

  // Local state: one answer per section (keyed by section)
  const [sectionAnswers, setSectionAnswers] = useState<Record<SectionKey, SectionPromptEntry | null>>({
    builder: null,
    performer: null,
    seeker: null,
    grounded: null,
  });

  // Track which section is currently expanded for editing
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);

  // P0 STABILITY: Prevent double-submission on rapid taps
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Query existing profilePrompts from user (for edit flow or resumption)
  const currentUser = useQuery(api.users.getCurrentUser, token ? { token } : 'skip');

  // Initialize from existing data
  useEffect(() => {
    // Priority: currentUser.profilePrompts > onboardingStore.profilePrompts
    const existingPrompts = (currentUser as any)?.profilePrompts ?? profilePrompts ?? [];

    if (__DEV__) {
      console.log('[PROMPTS_HYDRATE] Source: currentUser.profilePrompts =', (currentUser as any)?.profilePrompts?.length ?? 'null');
      console.log('[PROMPTS_HYDRATE] Source: onboardingStore.profilePrompts =', profilePrompts?.length ?? 'null');
      console.log('[PROMPTS_HYDRATE] Using existingPrompts count =', existingPrompts.length);
      existingPrompts.forEach((p: any, i: number) => {
        console.log(`[PROMPTS_HYDRATE] Prompt[${i}]:`, {
          section: p.section ?? 'NONE',
          question: p.question?.substring(0, 40) + '...',
          answerLen: p.answer?.length ?? 0,
        });
      });
    }

    if (existingPrompts.length > 0) {
      // Reconstruct sectionAnswers from stored prompts
      const newSectionAnswers: Record<SectionKey, SectionPromptEntry | null> = {
        builder: null,
        performer: null,
        seeker: null,
        grounded: null,
      };

      // Try to match prompts to sections by question text
      existingPrompts.forEach((prompt: { question: string; answer: string; section?: string }, idx: number) => {
        // If prompt has section field, use it directly
        if (isSectionKey(prompt.section)) {
          if (__DEV__) console.log(`[PROMPTS_HYDRATE] Prompt[${idx}] matched by SECTION field:`, prompt.section);
          newSectionAnswers[prompt.section] = {
            section: prompt.section,
            question: prompt.question,
            answer: prompt.answer,
          };
          return;
        }

        // Otherwise, try to find the section by matching question text
        let matched = false;
        for (const section of SECTIONS) {
          const matchingQuestion = section.questions.find(q => q.text === prompt.question);
          if (matchingQuestion && !newSectionAnswers[section.key]) {
            if (__DEV__) console.log(`[PROMPTS_HYDRATE] Prompt[${idx}] matched by QUESTION TEXT to section:`, section.key);
            newSectionAnswers[section.key] = {
              section: section.key,
              question: prompt.question,
              answer: prompt.answer,
            };
            matched = true;
            break;
          }
        }
        if (!matched && __DEV__) {
          console.log(`[PROMPTS_HYDRATE] Prompt[${idx}] UNMATCHED! Question:`, prompt.question);
        }
      });

      setSectionAnswers(newSectionAnswers);
      if (__DEV__) {
        const filledCount = Object.values(newSectionAnswers).filter(Boolean).length;
        console.log('[PROMPTS_HYDRATE] Result: filledSections =', filledCount, '/', TOTAL_SECTIONS);
        Object.entries(newSectionAnswers).forEach(([key, val]) => {
          console.log(`[PROMPTS_HYDRATE] Section[${key}]:`, val ? 'FILLED' : 'EMPTY');
        });
      }
    } else if (__DEV__) {
      console.log('[PROMPTS_HYDRATE] No existing prompts to hydrate');
    }
  }, [currentUser]);

  // STABILITY FIX: Sync from store AFTER Convex hydration completes
  useEffect(() => {
    if (!isDemoMode && convexHydrated && profilePrompts.length > 0) {
      const newSectionAnswers: Record<SectionKey, SectionPromptEntry | null> = {
        builder: null,
        performer: null,
        seeker: null,
        grounded: null,
      };

      profilePrompts.forEach((prompt: { question: string; answer: string; section?: string }) => {
        if (isSectionKey(prompt.section)) {
          newSectionAnswers[prompt.section] = {
            section: prompt.section,
            question: prompt.question,
            answer: prompt.answer,
          };
          return;
        }

        for (const section of SECTIONS) {
          const matchingQuestion = section.questions.find(q => q.text === prompt.question);
          if (matchingQuestion && !newSectionAnswers[section.key]) {
            newSectionAnswers[section.key] = {
              section: section.key,
              question: prompt.question,
              answer: prompt.answer,
            };
            break;
          }
        }
      });

      // Only update if we found some prompts
      const filledCount = Object.values(newSectionAnswers).filter(Boolean).length;
      if (filledCount > 0) {
        setSectionAnswers(newSectionAnswers);
        if (__DEV__) {
          console.log('[PROMPTS_PART2] Synced from hydrated store:', filledCount, 'prompts');
        }
      }
    }
  }, [convexHydrated]);

  // Check if answer meets minimum length requirement
  const isAnswerValid = (answer: string): boolean => {
    return answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH;
  };

  // Count valid sections (with 20+ char answers)
  const filledSections = Object.values(sectionAnswers).filter(
    (entry) => entry && isAnswerValid(entry.answer)
  ).length;

  // Validation: all 4 sections must have valid prompts
  const canContinue = filledSections === TOTAL_SECTIONS;

  // Debug: Log validation state when sectionAnswers changes
  useEffect(() => {
    if (__DEV__) {
      console.log('[PROMPTS_VALIDATE] filledSections =', filledSections, '/', TOTAL_SECTIONS, 'canContinue =', canContinue);
      Object.entries(sectionAnswers).forEach(([key, val]) => {
        if (val) {
          const answerLen = val.answer?.length ?? 0;
          const isValid = isAnswerValid(val.answer);
          console.log(`[PROMPTS_VALIDATE] ${key}: len=${answerLen}, valid=${isValid}, question="${val.question.substring(0, 30)}..."`);
        } else {
          console.log(`[PROMPTS_VALIDATE] ${key}: EMPTY`);
        }
      });
    }
  }, [sectionAnswers, filledSections, canContinue]);

  // Select a question in a section (replaces any existing selection in that section)
  const selectQuestion = useCallback((sectionKey: SectionKey, questionText: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    setSectionAnswers((prev) => ({
      ...prev,
      [sectionKey]: {
        section: sectionKey,
        question: questionText,
        answer: prev[sectionKey]?.question === questionText ? (prev[sectionKey]?.answer || '') : '',
      },
    }));
    setActiveSection(sectionKey);
  }, []);

  // Update answer for a section
  const updateSectionAnswer = useCallback((sectionKey: SectionKey, answer: string) => {
    setSectionAnswers((prev) => ({
      ...prev,
      [sectionKey]: prev[sectionKey]
        ? { ...prev[sectionKey]!, answer }
        : null,
    }));
  }, []);

  // Toggle section expansion
  const toggleSection = useCallback((sectionKey: SectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveSection((prev) => (prev === sectionKey ? null : sectionKey));
  }, []);

  const handleContinue = async () => {
    // P0 STABILITY: Prevent double-tap
    if (!canContinue || isSubmitting) return;
    setIsSubmitting(true);

    if (__DEV__) {
      console.log('[PROMPTS_SAVE] handleContinue called');
      console.log('[PROMPTS_SAVE] Current sectionAnswers:', Object.entries(sectionAnswers).map(([k, v]) => ({
        section: k,
        hasEntry: !!v,
        answerLen: v?.answer?.length ?? 0,
        isValid: v ? isAnswerValid(v.answer) : false,
      })));
    }

    // Convert sectionAnswers to array format for storage
    const validPrompts = Object.values(sectionAnswers)
      .filter((entry): entry is SectionPromptEntry => entry !== null && isAnswerValid(entry.answer))
      .map((entry) => ({
        section: entry.section,
        question: entry.question,
        answer: entry.answer.trim().slice(0, PROMPT_ANSWER_MAX_LENGTH),
      }));

    if (__DEV__) {
      console.log('[PROMPTS_SAVE] validPrompts count:', validPrompts.length);
      validPrompts.forEach((p, i) => {
        console.log(`[PROMPTS_SAVE] validPrompt[${i}]:`, {
          section: p.section,
          question: p.question.substring(0, 40) + '...',
          answerLen: p.answer.length,
        });
      });
    }

    // BUGFIX: Include section field for reliable hydration
    // This ensures prompts can be correctly matched to sections when re-loading
    const storagePrompts = validPrompts.map((p) => ({
      section: p.section,
      question: p.question,
      answer: p.answer,
    }));
    setProfilePrompts(storagePrompts);

    if (__DEV__) {
      console.log('[PROMPTS_SAVE] storagePrompts (with section):', storagePrompts.length);
    }

    // LIVE MODE: Save directly to user.profilePrompts
    if (!isDemoMode && token) {
      try {
        if (__DEV__) console.log('[PROMPTS_SAVE] Calling updateProfilePrompts mutation...');
        await updateProfilePrompts({ token, prompts: storagePrompts });
        if (__DEV__) {
          console.log('[PROMPTS_SAVE] SUCCESS: Saved', validPrompts.length, 'prompts to user.profilePrompts');
        }
      } catch (error) {
        if (__DEV__) console.error('[PROMPTS_SAVE] FAILED:', error);
      }
    } else if (__DEV__) {
      console.log('[PROMPTS_SAVE] Skipped mutation: isDemoMode=', isDemoMode, 'token=', !!token);
    }

    // Navigate
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] prompts-part2 -> review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
    } else {
      if (__DEV__) console.log('[ONB] prompts-part2 -> profile-details');
      setStep('profile_details');
      router.push('/(onboarding)/profile-details' as any);
    }
    setIsSubmitting(false);
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] prompts-part2 -> back');
    router.back();
  };

  // STABILITY FIX: Wait for Convex hydration before rendering form
  if (!isDemoMode && !convexHydrated) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OnboardingProgressHeader />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your answers...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <OnboardingProgressHeader />
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Tell us about you</Text>
          <Text style={styles.subtitle}>
            Choose 1 question from each section and share your answer.
          </Text>

          {/* Progress indicator */}
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {filledSections} of {TOTAL_SECTIONS} sections completed
            </Text>
            {canContinue && (
              <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
            )}
          </View>

          {/* Render each section as accordion */}
          {SECTIONS.map((section) => {
            const currentAnswer = sectionAnswers[section.key];
            const isExpanded = activeSection === section.key;
            const hasValidAnswer = currentAnswer && isAnswerValid(currentAnswer.answer);

            return (
              <View key={section.key} style={styles.sectionContainer}>
                {/* Section Header - simple accordion style */}
                <TouchableOpacity
                  style={[
                    styles.sectionHeader,
                    hasValidAnswer && styles.sectionHeaderComplete,
                  ]}
                  onPress={() => toggleSection(section.key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionHeaderLeft}>
                    <Text style={styles.sectionTitle}>{section.label}</Text>
                    {hasValidAnswer && (
                      <Ionicons name="checkmark-circle" size={16} color={COLORS.success} style={{ marginLeft: 8 }} />
                    )}
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={COLORS.textMuted}
                  />
                </TouchableOpacity>

                {/* Section Content (expanded) */}
                {isExpanded && (
                  <View style={styles.sectionContent}>
                    <Text style={styles.sectionInstruction}>
                      Choose 1 question from this section:
                    </Text>

                    {/* Question options */}
                    {section.questions.map((question) => {
                      const isSelected = currentAnswer?.question === question.text;

                      return (
                        <View key={question.id}>
                          <TouchableOpacity
                            style={[
                              styles.questionOption,
                              isSelected && styles.questionOptionSelected,
                            ]}
                            onPress={() => selectQuestion(section.key, question.text)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.questionRadio}>
                              {isSelected ? (
                                <Ionicons name="radio-button-on" size={20} color={COLORS.primary} />
                              ) : (
                                <Ionicons name="radio-button-off" size={20} color={COLORS.textMuted} />
                              )}
                            </View>
                            <Text
                              style={[
                                styles.questionText,
                                isSelected && styles.questionTextSelected,
                              ]}
                            >
                              {question.text}
                            </Text>
                          </TouchableOpacity>

                          {/* Answer input (only for selected question) */}
                          {isSelected && (
                            <View style={styles.answerContainer}>
                              <TextInput
                                style={styles.textInput}
                                value={currentAnswer?.answer || ''}
                                onChangeText={(text) => updateSectionAnswer(section.key, text)}
                                placeholder="Type your answer..."
                                placeholderTextColor={COLORS.textMuted}
                                multiline
                                maxLength={PROMPT_ANSWER_MAX_LENGTH}
                                textAlignVertical="top"
                                autoFocus
                              />
                              <View style={styles.inputFooter}>
                                {currentAnswer?.answer &&
                                  currentAnswer.answer.trim().length > 0 &&
                                  currentAnswer.answer.trim().length < PROMPT_ANSWER_MIN_LENGTH ? (
                                  <Text style={styles.minCharWarning}>
                                    {PROMPT_ANSWER_MIN_LENGTH - currentAnswer.answer.trim().length} more chars needed
                                  </Text>
                                ) : (
                                  <View />
                                )}
                                <Text style={styles.charCount}>
                                  {currentAnswer?.answer?.length || 0}/{PROMPT_ANSWER_MAX_LENGTH}
                                </Text>
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Collapsed preview (show selected question if any) */}
                {!isExpanded && currentAnswer && (
                  <View style={styles.collapsedPreview}>
                    <Text style={styles.collapsedQuestion} numberOfLines={2}>
                      {currentAnswer.question}
                    </Text>
                    {currentAnswer.answer && (
                      <Text style={styles.collapsedAnswer} numberOfLines={1}>
                        {currentAnswer.answer}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Validation hint */}
          {!canContinue && filledSections > 0 && (
            <View style={styles.validationHint}>
              <Ionicons name="information-circle" size={18} color={COLORS.warning} />
              <Text style={styles.validationHintText}>
                Complete all {TOTAL_SECTIONS} sections ({PROMPT_ANSWER_MIN_LENGTH}+ chars each) to continue
              </Text>
            </View>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Button
              title="Continue"
              variant="primary"
              onPress={handleContinue}
              disabled={!canContinue}
              fullWidth
            />
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
                <Text style={styles.navText}>Previous</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex1: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    marginBottom: 16,
    lineHeight: 21,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  progressText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  // Section container - accordion style
  sectionContainer: {
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  sectionHeaderComplete: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  // Section content (expanded)
  sectionContent: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sectionInstruction: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
    marginVertical: 12,
  },
  // Question options
  questionOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 6,
  },
  questionOptionSelected: {
    backgroundColor: COLORS.primary + '15',
  },
  questionRadio: {
    marginRight: 10,
    marginTop: 1,
  },
  questionText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
    lineHeight: 20,
  },
  questionTextSelected: {
    fontWeight: '500',
    color: COLORS.primary,
  },
  // Answer input
  answerContainer: {
    marginLeft: 30,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  textInput: {
    fontSize: 14,
    color: COLORS.text,
    minHeight: 60,
    maxHeight: 120,
    lineHeight: 20,
    padding: 0,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  charCount: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  minCharWarning: {
    fontSize: 12,
    color: COLORS.warning,
    fontWeight: '500',
  },
  // Collapsed preview
  collapsedPreview: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  collapsedQuestion: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
    lineHeight: 18,
  },
  collapsedAnswer: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  // Validation hint
  validationHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '15',
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
    gap: 6,
  },
  validationHintText: {
    fontSize: 13,
    color: COLORS.warning,
    flex: 1,
  },
  // Footer
  footer: {
    marginTop: 20,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  navButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  navText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
});
