import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  type Phase2PromptAnswer,
} from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { useScreenTrace } from '@/lib/devTrace';

const C = INCOGNITO_COLORS;

// Step 4 surface ladder — keeps a single dark-blue family so question cards
// and option chips form a clear elevation hierarchy.
// Page (C.background #1A1A2E) → SURFACE_RAISED → SURFACE_RAISED_HIGH.
const SURFACE_RAISED = '#202544';
const SURFACE_RAISED_HIGH = '#2A3060';
const HAIRLINE = 'rgba(255,255,255,0.06)';
const SELECTED_FILL = 'rgba(233,69,96,0.16)';

export default function Phase2PromptsScreen() {
  useScreenTrace('P2_ONB_PROMPTS');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const isEditingFromReview = returnTo === 'review';
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

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

  // Progress calculations — Section 1 only.
  const section1Answered = PHASE2_SECTION1_PROMPTS.filter(
    (p) => getAnswer(p.id).length > 0,
  ).length;
  const section1Complete = section1Answered === PHASE2_SECTION1_PROMPTS.length;

  const canContinue = !!userId && section1Complete && !isSaving;

  const handleContinue = useCallback(async () => {
    if (!userId || !token || !canContinue) return;

    // Build a Section-1-only payload. Any previously-saved Section 2/3
    // answers stay intact on the server because we merge them back in.
    const section1Ids = new Set<string>(PHASE2_SECTION1_PROMPTS.map((p) => p.id));
    const payload: Phase2PromptAnswer[] = [];

    PHASE2_SECTION1_PROMPTS.forEach((p) => {
      const answer = getAnswer(p.id).trim();
      if (answer) {
        payload.push({ promptId: p.id, question: p.question, answer });
      }
    });

    // Preserve any existing non-Section-1 answers the user may have written
    // earlier (e.g. from Edit Prompts) — we never delete those here.
    promptAnswers.forEach((existing) => {
      if (!section1Ids.has(existing.promptId)) {
        payload.push(existing);
      }
    });

    setIsSaving(true);
    try {
      const result = await saveOnboardingPrompts({
        token,
        authUserId: userId,
        promptAnswers: payload,
      });

      if (!result?.success) {
        throw new Error('Prompt answers could not be saved');
      }

      setPromptAnswers(payload);
      if (isEditingFromReview) {
        router.replace('/(main)/phase2-onboarding/profile-setup' as any);
      } else {
        router.push('/(main)/phase2-onboarding/profile-setup' as any);
      }
    } catch (error) {
      Alert.alert(
        'Unable to continue',
        'We could not save your answers. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  }, [userId, token, canContinue, getAnswer, promptAnswers, saveOnboardingPrompts, setPromptAnswers, router]);

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

  const totalQuickQuestions = PHASE2_SECTION1_PROMPTS.length;

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
          <Text style={styles.headerTitle}>Quick Questions</Text>
          <Text style={styles.stepLabel}>Step 4 of 5</Text>
        </View>
        <View style={styles.headerRight}>
          {section1Complete ? (
            <View style={[styles.totalBadge, styles.totalBadgeComplete]}>
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
            </View>
          ) : (
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>
                {section1Answered}/{totalQuickQuestions}
              </Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Intro */}
        <View style={styles.introCard}>
          <Ionicons name="chatbubbles-outline" size={24} color={C.primary} />
          <View style={styles.introContent}>
            <Text style={styles.introTitle}>Three quick taps.</Text>
            <Text style={styles.introText}>
              Choose what feels right. You can add deeper answers later from your private profile.
            </Text>
          </View>
        </View>

        {/* ============================================================ */}
        {/* SECTION 1: Quick Questions (Multiple Choice - Inline Options) */}
        {/* ============================================================ */}
        <View style={styles.section}>
          <View style={styles.sectionContent}>
            {PHASE2_SECTION1_PROMPTS.map(renderSection1Question)}
          </View>
        </View>

        {/* Continue CTA — inline below the third question, no floating bar */}
        <TouchableOpacity
          style={[
            styles.continueButton,
            canContinue ? styles.continueButtonActive : styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!canContinue || isSaving}
          activeOpacity={0.85}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text
                style={canContinue ? styles.continueButtonText : styles.continueButtonTextDisabled}
              >
                {isEditingFromReview ? 'Save changes' : 'Continue to review'}
              </Text>
              <Ionicons
                name={isEditingFromReview ? 'checkmark' : 'arrow-forward'}
                size={18}
                color={canContinue ? '#FFFFFF' : C.textLight}
              />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
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
  sectionContent: {
    gap: 12,
  },

  // ============================================================
  // Section 1: Multiple Choice Styles
  // ============================================================
  s1QuestionCard: {
    backgroundColor: SURFACE_RAISED,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
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
    backgroundColor: SURFACE_RAISED_HIGH,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  s1OptionChipSelected: {
    backgroundColor: SELECTED_FILL,
    borderColor: C.primary,
  },
  s1OptionText: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '500',
    flexShrink: 1,
  },
  s1OptionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  s1CheckCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Inline Continue CTA
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    borderRadius: 14,
    marginTop: 16,
  },
  continueButtonActive: {
    backgroundColor: C.primary,
  },
  continueButtonDisabled: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
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
