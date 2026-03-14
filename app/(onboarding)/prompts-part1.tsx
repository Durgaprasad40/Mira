/**
 * Phase-1 Onboarding: Prompts Part 1 (Seed Questions)
 *
 * 3 required questions that define core personality traits:
 * 1. Identity Anchor - "Which best describes you right now?" (4 options with subtitles)
 * 2. Social Battery - "Your plans got cancelled..." (slider: Relieved to Restless)
 * 3. Value Trigger - "On a first date, what tells you..." (4 options)
 *
 * All 3 must be answered to continue.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  IDENTITY_ANCHOR_PROMPT,
  IDENTITY_ANCHOR_OPTIONS,
  SOCIAL_BATTERY_PROMPT,
  SOCIAL_BATTERY_LEFT_LABEL,
  SOCIAL_BATTERY_RIGHT_LABEL,
  VALUE_TRIGGER_PROMPT,
  VALUE_TRIGGER_OPTIONS,
  IdentityAnchorValue,
  SocialBatteryValue,
  ValueTriggerValue,
} from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

export default function PromptsPart1Screen() {
  useScreenTrace('ONB_PROMPTS_PART1');

  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();
  const isEditFromReview = params.editFromReview === 'true';

  // Auth and persistence
  const { userId } = useAuthStore();
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);

  // Store state and actions
  const {
    seedQuestions,
    setIdentityAnchor,
    setSocialBattery,
    setValueTrigger,
    setStep,
  } = useOnboardingStore();
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);

  // Local state for immediate UI feedback
  const [identityAnchor, setLocalIdentityAnchor] = useState<IdentityAnchorValue | null>(
    seedQuestions.identityAnchor
  );
  const [socialBattery, setLocalSocialBattery] = useState<SocialBatteryValue | null>(
    seedQuestions.socialBattery
  );
  const [valueTrigger, setLocalValueTrigger] = useState<ValueTriggerValue | null>(
    seedQuestions.valueTrigger
  );

  // STABILITY FIX: Sync from store AFTER Convex hydration completes
  // This ensures previously entered values are visible when user returns
  useEffect(() => {
    if (!isDemoMode && convexHydrated) {
      if (seedQuestions.identityAnchor) setLocalIdentityAnchor(seedQuestions.identityAnchor);
      if (seedQuestions.socialBattery) setLocalSocialBattery(seedQuestions.socialBattery);
      if (seedQuestions.valueTrigger) setLocalValueTrigger(seedQuestions.valueTrigger);
      if (__DEV__) {
        console.log('[PROMPTS_PART1] Synced from hydrated store:', seedQuestions);
      }
    }
  }, [convexHydrated]);

  // Sync from store on mount (for edit flow and demo mode)
  useEffect(() => {
    if (seedQuestions.identityAnchor) setLocalIdentityAnchor(seedQuestions.identityAnchor);
    if (seedQuestions.socialBattery) setLocalSocialBattery(seedQuestions.socialBattery);
    if (seedQuestions.valueTrigger) setLocalValueTrigger(seedQuestions.valueTrigger);
  }, []);

  // Validation: all 3 questions must be answered
  const canContinue =
    identityAnchor !== null &&
    socialBattery !== null &&
    valueTrigger !== null;

  const handleContinue = () => {
    if (!canContinue) return;

    // Save to store
    setIdentityAnchor(identityAnchor);
    setSocialBattery(socialBattery);
    setValueTrigger(valueTrigger);

    // LIVE MODE: Persist seedQuestions to Convex onboarding draft
    if (!isDemoMode && userId) {
      const seedQuestionsData = {
        identityAnchor,
        socialBattery,
        valueTrigger,
      };
      upsertDraft({
        userId,
        patch: {
          profileDetails: { seedQuestions: seedQuestionsData },
          progress: { lastStepKey: 'prompts_part1' },
        },
      }).catch((error) => {
        if (__DEV__) console.error('[PROMPTS_PART1] Failed to save draft:', error);
      });
      if (__DEV__) console.log('[ONB_DRAFT] Saved seedQuestions:', seedQuestionsData);
    }

    // Navigate
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] prompts-part1 -> review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
    } else {
      if (__DEV__) console.log('[ONB] prompts-part1 -> prompts-part2');
      setStep('prompts_part2');
      router.push('/(onboarding)/prompts-part2' as any);
    }
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] prompts-part1 -> back');
    router.back();
  };

  // Handle slider tap on track positions
  const handleSliderTap = useCallback((position: number) => {
    // position 0-4 maps to values 1-5
    const value = (position + 1) as SocialBatteryValue;
    setLocalSocialBattery(value);
  }, []);

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
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Let's get to know you</Text>
        <Text style={styles.subtitle}>
          Answer these 3 quick questions to help us find your best matches.
        </Text>

        {/* Q1: Identity Anchor */}
        <View style={styles.questionSection}>
          <Text style={styles.questionLabel}>{IDENTITY_ANCHOR_PROMPT}</Text>
          <View style={styles.verticalOptionContainer}>
            {IDENTITY_ANCHOR_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.optionCard,
                  identityAnchor === option.value && styles.optionCardSelected,
                ]}
                onPress={() => setLocalIdentityAnchor(option.value)}
              >
                <View style={styles.optionContent}>
                  <Text
                    style={[
                      styles.optionLabel,
                      identityAnchor === option.value && styles.optionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.optionSubtitle,
                      identityAnchor === option.value && styles.optionSubtitleSelected,
                    ]}
                  >
                    {option.subtitle}
                  </Text>
                </View>
                {identityAnchor === option.value && (
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
                )}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Q2: Social Battery - Slider */}
        <View style={styles.questionSection}>
          <Text style={styles.questionLabel}>{SOCIAL_BATTERY_PROMPT}</Text>
          <View style={styles.sliderContainer}>
            {/* Custom slider track with tappable dots */}
            <View style={styles.sliderTrack}>
              {[1, 2, 3, 4, 5].map((value, index) => (
                <Pressable
                  key={value}
                  style={styles.sliderDotHitArea}
                  onPress={() => handleSliderTap(index)}
                >
                  <View
                    style={[
                      styles.sliderDot,
                      socialBattery !== null && value <= socialBattery && styles.sliderDotActive,
                      socialBattery === value && styles.sliderDotCurrent,
                    ]}
                  />
                </Pressable>
              ))}
              {/* Active track fill */}
              {socialBattery !== null && (
                <View
                  style={[
                    styles.sliderActiveFill,
                    { width: `${((socialBattery - 1) / 4) * 100}%` },
                  ]}
                />
              )}
            </View>
            {/* Labels */}
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabelText}>{SOCIAL_BATTERY_LEFT_LABEL}</Text>
              <Text style={styles.sliderLabelText}>{SOCIAL_BATTERY_RIGHT_LABEL}</Text>
            </View>
          </View>
        </View>

        {/* Q3: Value Trigger */}
        <View style={styles.questionSection}>
          <Text style={styles.questionLabel}>{VALUE_TRIGGER_PROMPT}</Text>
          <View style={styles.verticalOptionContainer}>
            {VALUE_TRIGGER_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.optionSimple,
                  valueTrigger === option.value && styles.optionSimpleSelected,
                ]}
                onPress={() => setLocalValueTrigger(option.value)}
              >
                <Text
                  style={[
                    styles.optionSimpleText,
                    valueTrigger === option.value && styles.optionSimpleTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {valueTrigger === option.value && (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                )}
              </Pressable>
            ))}
          </View>
        </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 28,
    lineHeight: 22,
  },
  questionSection: {
    marginBottom: 28,
  },
  questionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 14,
  },
  verticalOptionContainer: {
    gap: 10,
  },
  // Identity Anchor option cards with subtitle
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionCardSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primaryDark,
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  optionLabelSelected: {
    color: COLORS.white,
  },
  optionSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  optionSubtitleSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  // Simple option buttons (Value Trigger)
  optionSimple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSimpleSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primaryDark,
  },
  optionSimpleText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  optionSimpleTextSelected: {
    color: COLORS.white,
  },
  // Slider styles (Social Battery)
  sliderContainer: {
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  sliderTrack: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    backgroundColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 16,
  },
  sliderActiveFill: {
    position: 'absolute',
    left: 16,
    height: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 3,
    top: 17,
  },
  sliderDotHitArea: {
    padding: 8,
    zIndex: 2,
  },
  sliderDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  sliderDotActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  sliderDotCurrent: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 8,
  },
  sliderLabelText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  footer: {
    marginTop: 32,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  navButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
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
