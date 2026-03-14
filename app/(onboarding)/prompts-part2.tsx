/**
 * Phase-1 Onboarding: Prompts Part 2 (Section Prompts)
 *
 * 3-level accordion interaction:
 * Level 1: Section cards (only ONE open at a time)
 * Level 2: Question boxes (cards, not bullets)
 * Level 3: TextInput inside expanded question box
 *
 * Minimum 1 answer per section required to continue.
 * 200 character limit per answer.
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
  UIManager,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  SECTION_PROMPTS,
  PROMPT_ANSWER_MAX_LENGTH,
  MIN_ANSWERS_PER_SECTION,
  PromptSectionKey,
  SectionPromptAnswer,
} from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SECTION_KEYS: PromptSectionKey[] = ['builder', 'performer', 'seeker', 'grounded'];

// Minimal section labels for Level 1
const SECTION_NUMBERS: Record<PromptSectionKey, string> = {
  builder: 'Section 1',
  performer: 'Section 2',
  seeker: 'Section 3',
  grounded: 'Section 4',
};

export default function PromptsPart2Screen() {
  useScreenTrace('ONB_PROMPTS_PART2');

  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ editFromReview?: string }>();
  const isEditFromReview = params.editFromReview === 'true';

  // Auth and persistence
  const { userId } = useAuthStore();
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);

  // Store state and actions
  const {
    sectionPrompts,
    setSectionPromptAnswer,
    removeSectionPromptAnswer,
    setStep,
  } = useOnboardingStore();
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);

  // Level 1: Only ONE section can be open at a time
  const [expandedSection, setExpandedSection] = useState<PromptSectionKey | null>(null);

  // Level 3: Only ONE question input can be open at a time
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);

  // Local answers state for immediate feedback
  const [localAnswers, setLocalAnswers] = useState<Record<PromptSectionKey, Record<string, string>>>({
    builder: {},
    performer: {},
    seeker: {},
    grounded: {},
  });

  // Initialize local state from store
  useEffect(() => {
    const initial: Record<PromptSectionKey, Record<string, string>> = {
      builder: {},
      performer: {},
      seeker: {},
      grounded: {},
    };
    SECTION_KEYS.forEach((key) => {
      sectionPrompts[key].forEach((item: SectionPromptAnswer) => {
        initial[key][item.question] = item.answer;
      });
    });
    setLocalAnswers(initial);
  }, []);

  // STABILITY FIX: Sync from store AFTER Convex hydration completes
  // This ensures previously entered values are visible when user returns
  useEffect(() => {
    if (!isDemoMode && convexHydrated) {
      const initial: Record<PromptSectionKey, Record<string, string>> = {
        builder: {},
        performer: {},
        seeker: {},
        grounded: {},
      };
      SECTION_KEYS.forEach((key) => {
        sectionPrompts[key].forEach((item: SectionPromptAnswer) => {
          initial[key][item.question] = item.answer;
        });
      });
      setLocalAnswers(initial);
      if (__DEV__) {
        const counts = SECTION_KEYS.map(k => `${k}=${sectionPrompts[k].length}`).join(', ');
        console.log('[PROMPTS_PART2] Synced from hydrated store:', counts);
      }
    }
  }, [convexHydrated]);

  // Toggle section (Level 1 → Level 2)
  // Only one section open at a time
  const toggleSection = useCallback((section: PromptSectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection((prev) => (prev === section ? null : section));
    // Close any active question when switching sections
    setActiveQuestionId(null);
  }, []);

  // Toggle question input (Level 2 → Level 3)
  // Only one question input open at a time
  const toggleQuestion = useCallback((questionId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveQuestionId((prev) => (prev === questionId ? null : questionId));
  }, []);

  // Update answer for a prompt
  const handleAnswerChange = useCallback((section: PromptSectionKey, question: string, answer: string) => {
    setLocalAnswers((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [question]: answer,
      },
    }));
  }, []);

  // Count filled answers per section
  const getFilledCount = (section: PromptSectionKey): number => {
    return Object.values(localAnswers[section]).filter((a) => a.trim().length > 0).length;
  };

  // Validation: at least 1 answer per section
  const canContinue = SECTION_KEYS.every((key) => getFilledCount(key) >= MIN_ANSWERS_PER_SECTION);

  // Check if a section has at least 1 answer
  const isSectionValid = (section: PromptSectionKey): boolean => {
    return getFilledCount(section) >= MIN_ANSWERS_PER_SECTION;
  };

  const handleContinue = () => {
    if (!canContinue) return;

    // Build sectionPrompts data for saving
    const sectionPromptsData: Record<string, { question: string; answer: string }[]> = {
      builder: [],
      performer: [],
      seeker: [],
      grounded: [],
    };

    // Save all answers to store and build data for draft
    SECTION_KEYS.forEach((section) => {
      // First clear existing answers for this section
      sectionPrompts[section].forEach((item: SectionPromptAnswer) => {
        if (!localAnswers[section][item.question]?.trim()) {
          removeSectionPromptAnswer(section, item.question);
        }
      });

      // Then add/update current answers
      Object.entries(localAnswers[section]).forEach(([question, answer]) => {
        if (answer.trim().length > 0) {
          setSectionPromptAnswer(section, question, answer.trim());
          sectionPromptsData[section].push({ question, answer: answer.trim() });
        }
      });
    });

    // LIVE MODE: Persist sectionPrompts to Convex onboarding draft
    if (!isDemoMode && userId) {
      upsertDraft({
        userId,
        patch: {
          profileDetails: { sectionPrompts: sectionPromptsData },
          progress: { lastStepKey: 'prompts_part2' },
        },
      }).catch((error) => {
        if (__DEV__) console.error('[PROMPTS_PART2] Failed to save draft:', error);
      });
      if (__DEV__) {
        const counts = SECTION_KEYS.map(k => `${k}=${sectionPromptsData[k].length}`).join(', ');
        console.log('[ONB_DRAFT] Saved sectionPrompts:', counts);
      }
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
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] prompts-part2 -> back');
    router.back();
  };

  // STABILITY FIX: Wait for Convex hydration before rendering form
  // This prevents showing empty prompts when user returns with incomplete onboarding
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
          <Text style={styles.title}>Tell us more</Text>
          <Text style={styles.subtitle}>
            Answer at least 1 prompt from each section to continue. These help others know you better.
          </Text>

          {/* Level 1: Section Cards */}
          {SECTION_KEYS.map((sectionKey) => {
            const prompts = SECTION_PROMPTS[sectionKey];
            const isExpanded = expandedSection === sectionKey;
            const isValid = isSectionValid(sectionKey);

            return (
              <View key={sectionKey} style={styles.sectionCard}>
                {/* Section Header */}
                <TouchableOpacity
                  style={[
                    styles.sectionHeader,
                    isExpanded && styles.sectionHeaderExpanded,
                    isValid && styles.sectionHeaderComplete,
                  ]}
                  onPress={() => toggleSection(sectionKey)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sectionTitle}>{SECTION_NUMBERS[sectionKey]}</Text>
                  <View style={styles.sectionRight}>
                    {isValid && (
                      <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                    )}
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={COLORS.textMuted}
                    />
                  </View>
                </TouchableOpacity>

                {/* Level 2: Question Boxes */}
                {isExpanded && (
                  <View style={styles.questionsContainer}>
                    {prompts.map((prompt) => {
                      const answer = localAnswers[sectionKey][prompt.text] || '';
                      const isActive = activeQuestionId === prompt.id;
                      const hasAnswer = answer.trim().length > 0;

                      return (
                        <TouchableOpacity
                          key={prompt.id}
                          style={[
                            styles.questionBox,
                            hasAnswer && styles.questionBoxAnswered,
                            isActive && styles.questionBoxActive,
                          ]}
                          onPress={() => toggleQuestion(prompt.id)}
                          activeOpacity={0.7}
                        >
                          {/* Question text */}
                          <View style={styles.questionHeader}>
                            <Text style={[
                              styles.questionText,
                              hasAnswer && styles.questionTextAnswered,
                            ]}>
                              {prompt.text}
                            </Text>
                            {hasAnswer && !isActive && (
                              <Ionicons name="checkmark-circle" size={18} color={COLORS.success} style={styles.questionCheck} />
                            )}
                          </View>

                          {/* Level 3: Input box inside expanded question */}
                          {isActive && (
                            <View style={styles.inputContainer}>
                              <TextInput
                                style={styles.textInput}
                                value={answer}
                                onChangeText={(text) => handleAnswerChange(sectionKey, prompt.text, text)}
                                placeholder="Type your answer..."
                                placeholderTextColor={COLORS.textMuted}
                                multiline
                                maxLength={PROMPT_ANSWER_MAX_LENGTH}
                                textAlignVertical="top"
                                autoFocus
                              />
                              <Text style={styles.charCount}>
                                {answer.length}/{PROMPT_ANSWER_MAX_LENGTH}
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          {/* Validation hint */}
          {!canContinue && (
            <View style={styles.validationHint}>
              <Ionicons name="information-circle" size={18} color={COLORS.warning} />
              <Text style={styles.validationHintText}>
                Answer at least 1 prompt in each section to continue
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
    paddingHorizontal: 16,  // Reduced from 24 → 16 for wider cards
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
    marginBottom: 20,  // Reduced from 24
    lineHeight: 21,
  },
  // Level 1: Section card
  sectionCard: {
    marginBottom: 10,  // Reduced from 12
    borderRadius: 10,  // Slightly tighter radius
    backgroundColor: COLORS.backgroundDark,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,  // Reduced from 16
    paddingHorizontal: 14,
  },
  sectionHeaderExpanded: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeaderComplete: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  sectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Level 2: Question boxes
  questionsContainer: {
    padding: 8,  // Reduced from 12 for wider question boxes
    gap: 6,     // Reduced from 10 for tighter spacing
  },
  questionBox: {
    backgroundColor: COLORS.background,
    borderRadius: 8,  // Slightly tighter
    paddingVertical: 10,   // Reduced from 14
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  questionBoxAnswered: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '08',
  },
  questionBoxActive: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    paddingVertical: 9,    // Compensate for thicker border
    paddingHorizontal: 11,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  questionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 19,
  },
  questionTextAnswered: {
    color: COLORS.textLight,
  },
  questionCheck: {
    marginLeft: 6,
    marginTop: 0,
  },
  // Level 3: Input inside question box
  inputContainer: {
    marginTop: 8,   // Reduced from 12
    paddingTop: 8,  // Reduced from 12
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  textInput: {
    fontSize: 14,
    color: COLORS.text,
    minHeight: 36,   // Reduced from 80 → compact default
    maxHeight: 100,  // Reduced from 120
    lineHeight: 18,
    padding: 0,
  },
  charCount: {
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,  // Reduced from 8
  },
  // Validation hint
  validationHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '15',
    padding: 10,  // Reduced from 12
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
    marginTop: 20,  // Reduced from 24
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
