/**
 * Phase-1 Onboarding: Prompts Part 2 (Profile Prompts)
 *
 * Unified prompt system - same as Edit Profile:
 * - Select from 16 prompt questions
 * - Min 1, max 5 prompts required
 * - 20-200 character answers
 * - Saves directly to user.profilePrompts (not onboardingDraft)
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
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  PROFILE_PROMPT_QUESTIONS,
  PROFILE_PROMPTS_MIN,
  PROFILE_PROMPTS_MAX,
  PROMPT_ANSWER_MIN_LENGTH,
  PROMPT_ANSWER_MAX_LENGTH,
} from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type PromptEntry = { question: string; answer: string };

export default function PromptsPart2Screen() {
  useScreenTrace('ONB_PROMPTS_PART2');

  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ editFromReview?: string }>();
  const isEditFromReview = params.editFromReview === 'true';

  // MIGRATION: Track if sectionPrompts → profilePrompts migration has been attempted
  const hasMigratedRef = useRef(false);

  // Auth and persistence
  const { userId, token } = useAuthStore();
  const updateProfilePrompts = useMutation(api.users.updateProfilePrompts);

  // Store state and actions
  const { profilePrompts, setProfilePrompts, setStep } = useOnboardingStore();
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);

  // Local state for prompts
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);

  // Track which prompt is being edited
  const [activePromptIndex, setActivePromptIndex] = useState<number | null>(null);

  // P0 STABILITY: Prevent double-submission on rapid taps
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Query existing profilePrompts from user (for edit flow or resumption)
  const currentUser = useQuery(api.users.getCurrentUser, userId ? { userId } : 'skip');

  // Initialize from existing data + MIGRATION from old sectionPrompts
  useEffect(() => {
    // Priority: currentUser.profilePrompts > onboardingStore.profilePrompts
    const existingPrompts = (currentUser as any)?.profilePrompts ?? profilePrompts ?? [];

    // Check for old sectionPrompts that need migration
    const draft = (currentUser as any)?.onboardingDraft;
    const sectionPrompts = draft?.profileDetails?.sectionPrompts;

    // Flatten old section prompts if they exist
    const flatSectionPrompts: PromptEntry[] = [];
    if (sectionPrompts) {
      ['builder', 'performer', 'seeker', 'grounded'].forEach((section) => {
        const sectionArr = sectionPrompts[section];
        if (Array.isArray(sectionArr)) {
          sectionArr.forEach((p: PromptEntry) => {
            if (p.question && p.answer?.trim()) {
              flatSectionPrompts.push(p);
            }
          });
        }
      });
    }

    // MIGRATION: If profilePrompts is empty but sectionPrompts exists, auto-migrate
    const needsMigration =
      existingPrompts.length === 0 &&
      flatSectionPrompts.length > 0 &&
      !hasMigratedRef.current;

    if (needsMigration && !isDemoMode && token) {
      hasMigratedRef.current = true;

      // Limit to PROFILE_PROMPTS_MAX (5) prompts, filter by min length
      const migratedPrompts = flatSectionPrompts
        .filter((p) => p.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH)
        .slice(0, PROFILE_PROMPTS_MAX)
        .map((p) => ({
          question: p.question,
          answer: p.answer.trim().slice(0, PROMPT_ANSWER_MAX_LENGTH),
        }));

      if (migratedPrompts.length > 0) {
        // Set local state immediately
        setPrompts(migratedPrompts);

        // Persist to backend
        updateProfilePrompts({ token, prompts: migratedPrompts })
          .then(() => {
            console.log('[PROMPTS MIGRATED]', {
              count: migratedPrompts.length,
              source: 'onboardingDraft.sectionPrompts',
              destination: 'user.profilePrompts',
            });
          })
          .catch((err) => {
            console.error('[PROMPTS MIGRATION FAILED]', err);
          });
      }
    } else if (existingPrompts.length > 0) {
      // Normal case: use existing profilePrompts
      const validPrompts = existingPrompts.filter((p: PromptEntry) => {
        return p.answer && p.answer.trim().length > 0;
      }).slice(0, PROFILE_PROMPTS_MAX);
      setPrompts(validPrompts);
      if (__DEV__) {
        console.log('[PROMPTS_PART2] Initialized with', validPrompts.length, 'prompts');
      }
    } else if (flatSectionPrompts.length > 0 && prompts.length === 0) {
      // Fallback: show old sectionPrompts in UI (even if migration failed)
      const validPrompts = flatSectionPrompts
        .filter((p) => p.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH)
        .slice(0, PROFILE_PROMPTS_MAX);
      setPrompts(validPrompts);
      if (__DEV__) {
        console.log('[PROMPTS_PART2] Loaded from sectionPrompts fallback:', validPrompts.length);
      }
    }
  }, [currentUser]);

  // STABILITY FIX: Sync from store AFTER Convex hydration completes
  useEffect(() => {
    if (!isDemoMode && convexHydrated && profilePrompts.length > 0) {
      const validPrompts = profilePrompts.filter((p: PromptEntry) => {
        return p.answer && p.answer.trim().length > 0;
      }).slice(0, PROFILE_PROMPTS_MAX);
      if (validPrompts.length > 0 && prompts.length === 0) {
        setPrompts(validPrompts);
        if (__DEV__) {
          console.log('[PROMPTS_PART2] Synced from hydrated store:', validPrompts.length, 'prompts');
        }
      }
    }
  }, [convexHydrated]);

  // Get list of questions that haven't been answered yet
  const availableQuestions = PROFILE_PROMPT_QUESTIONS.filter(
    (q) => !prompts.some((p) => p.question === q.text)
  );

  // Check if answer meets minimum length requirement
  const isAnswerValid = (answer: string): boolean => {
    return answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH;
  };

  // Count valid prompts (20+ char answers)
  const filledCount = prompts.filter((p) => isAnswerValid(p.answer)).length;

  // Validation: at least 1 valid prompt
  const canContinue = filledCount >= PROFILE_PROMPTS_MIN;
  const canAddMore = prompts.length < PROFILE_PROMPTS_MAX && availableQuestions.length > 0;

  // Add a new prompt with a selected question
  const addPrompt = useCallback((questionText: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const newPrompt = { question: questionText, answer: '' };
    setPrompts((prev) => [...prev, newPrompt]);
    // Automatically expand the new prompt for editing
    setActivePromptIndex(prompts.length);
  }, [prompts.length]);

  // Remove a prompt
  const removePrompt = useCallback((index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPrompts((prev) => prev.filter((_, i) => i !== index));
    if (activePromptIndex === index) {
      setActivePromptIndex(null);
    } else if (activePromptIndex !== null && activePromptIndex > index) {
      setActivePromptIndex(activePromptIndex - 1);
    }
  }, [activePromptIndex]);

  // Update answer for a prompt
  const updateAnswer = useCallback((index: number, answer: string) => {
    setPrompts((prev) => {
      const newPrompts = [...prev];
      newPrompts[index] = { ...newPrompts[index], answer };
      return newPrompts;
    });
  }, []);

  // Toggle prompt editing
  const togglePrompt = useCallback((index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActivePromptIndex((prev) => (prev === index ? null : index));
  }, []);

  const handleContinue = async () => {
    // P0 STABILITY: Prevent double-tap
    if (!canContinue || isSubmitting) return;
    setIsSubmitting(true);

    // Filter to only prompts with valid answers (20+ chars)
    const validPrompts = prompts.filter((p) => isAnswerValid(p.answer)).map((p) => ({
      question: p.question,
      answer: p.answer.trim().slice(0, PROMPT_ANSWER_MAX_LENGTH),
    }));

    // Save to local store
    setProfilePrompts(validPrompts);

    // LIVE MODE: Save directly to user.profilePrompts (NOT onboardingDraft)
    if (!isDemoMode && token) {
      try {
        await updateProfilePrompts({ token, prompts: validPrompts });
        if (__DEV__) {
          console.log('[PROMPTS_PART2] Saved', validPrompts.length, 'prompts to user.profilePrompts');
        }
      } catch (error) {
        if (__DEV__) console.error('[PROMPTS_PART2] Failed to save prompts:', error);
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
            Pick {PROFILE_PROMPTS_MIN}-{PROFILE_PROMPTS_MAX} prompts and share your answers. These help others get to know you.
          </Text>

          {/* Progress indicator */}
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {filledCount} of {PROFILE_PROMPTS_MIN}-{PROFILE_PROMPTS_MAX} prompts completed
            </Text>
            {filledCount >= PROFILE_PROMPTS_MIN && (
              <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
            )}
          </View>

          {/* Selected prompts */}
          {prompts.map((prompt, index) => {
            const isActive = activePromptIndex === index;
            const hasValidAnswer = isAnswerValid(prompt.answer);

            return (
              <View
                key={`${prompt.question}-${index}`}
                style={[
                  styles.promptCard,
                  hasValidAnswer && styles.promptCardValid,
                  isActive && styles.promptCardActive,
                ]}
              >
                <TouchableOpacity
                  style={styles.promptHeader}
                  onPress={() => togglePrompt(index)}
                  activeOpacity={0.7}
                >
                  <View style={styles.promptHeaderLeft}>
                    <Text style={styles.promptQuestion}>{prompt.question}</Text>
                    {!isActive && prompt.answer.length > 0 && (
                      <Text style={styles.promptPreview} numberOfLines={1}>
                        {prompt.answer}
                      </Text>
                    )}
                  </View>
                  <View style={styles.promptHeaderRight}>
                    {hasValidAnswer && !isActive && (
                      <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                    )}
                    <Ionicons
                      name={isActive ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={COLORS.textMuted}
                    />
                  </View>
                </TouchableOpacity>

                {/* Expanded input area */}
                {isActive && (
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={prompt.answer}
                      onChangeText={(text) => updateAnswer(index, text)}
                      placeholder="Type your answer..."
                      placeholderTextColor={COLORS.textMuted}
                      multiline
                      maxLength={PROMPT_ANSWER_MAX_LENGTH}
                      textAlignVertical="top"
                      autoFocus
                    />
                    <View style={styles.inputFooter}>
                      {/* Inline validation message */}
                      {prompt.answer.trim().length > 0 &&
                        prompt.answer.trim().length < PROMPT_ANSWER_MIN_LENGTH ? (
                        <Text style={styles.minCharWarning}>
                          {PROMPT_ANSWER_MIN_LENGTH - prompt.answer.trim().length} more chars needed
                        </Text>
                      ) : (
                        <TouchableOpacity onPress={() => removePrompt(index)}>
                          <Text style={styles.removeText}>Remove</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.charCount}>
                        {prompt.answer.length}/{PROMPT_ANSWER_MAX_LENGTH}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {/* Add prompt button */}
          {canAddMore && (
            <View style={styles.addSection}>
              <Text style={styles.addLabel}>Add a prompt:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.questionChips}
              >
                {availableQuestions.slice(0, 8).map((q) => (
                  <Pressable
                    key={q.id}
                    style={styles.questionChip}
                    onPress={() => addPrompt(q.text)}
                  >
                    <Text style={styles.questionChipText} numberOfLines={1}>
                      {q.text}
                    </Text>
                    <Ionicons name="add" size={16} color={COLORS.primary} />
                  </Pressable>
                ))}
              </ScrollView>
              {availableQuestions.length > 8 && (
                <Text style={styles.morePromptsHint}>
                  + {availableQuestions.length - 8} more prompts available
                </Text>
              )}
            </View>
          )}

          {/* Validation hint */}
          {!canContinue && prompts.length > 0 && (
            <View style={styles.validationHint}>
              <Ionicons name="information-circle" size={18} color={COLORS.warning} />
              <Text style={styles.validationHintText}>
                Complete at least {PROFILE_PROMPTS_MIN} prompt ({PROMPT_ANSWER_MIN_LENGTH}+ chars) to continue
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
    marginBottom: 16,
  },
  progressText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  // Prompt cards
  promptCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  promptCardValid: {
    borderColor: COLORS.success,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
  },
  promptCardActive: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  promptHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  promptHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  promptQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 19,
  },
  promptPreview: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  // Input container
  inputContainer: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  textInput: {
    fontSize: 14,
    color: COLORS.text,
    minHeight: 60,
    maxHeight: 120,
    lineHeight: 20,
    paddingTop: 12,
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
  removeText: {
    fontSize: 13,
    color: COLORS.error,
    fontWeight: '500',
  },
  // Add section
  addSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  addLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
    marginBottom: 10,
  },
  questionChips: {
    paddingVertical: 2,
    gap: 8,
  },
  questionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
    maxWidth: 200,
    gap: 4,
  },
  questionChipText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
    flex: 1,
  },
  morePromptsHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
    marginLeft: 4,
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
