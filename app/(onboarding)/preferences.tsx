/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/preferences.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  // PHASE-1 RESTRUCTURE: TextInput, Keyboard, useWindowDimensions removed - age/distance inputs removed
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, GENDER_OPTIONS, RELATIONSHIP_INTENTS } from '@/lib/constants';
// PHASE-1 RESTRUCTURE: ACTIVITY_FILTERS, VALIDATION removed - activities/age/distance removed from onboarding
import { Button } from '@/components/ui';
// PHASE-1 RESTRUCTURE: Input removed - age/distance inputs removed
import { Toast } from '@/components/ui/Toast';
import { useOnboardingStore, LGBTQ_OPTIONS, LgbtqOption } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
// FIX: Import faceVerificationPassed to skip verification if already passed
import { isDemoMode } from '@/hooks/useConvex';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Gender, RelationshipIntent } from '@/types';
// PHASE-1 RESTRUCTURE: ActivityFilter removed - activities removed from onboarding
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';
import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_DISTANCE_KM,
  DEFAULT_MIN_AGE,
} from '@/lib/discoveryDefaults';

// PHASE-1 RESTRUCTURE: Age/distance/interests constants removed from onboarding
// Auto-set distance to 50 miles (stored as km) when saving preferences
const DISTANCE_DEFAULT = DEFAULT_MAX_DISTANCE_KM;

const MAX_RELATIONSHIP_INTENTS = 3;

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const ALLOWED_RELATIONSHIP_INTENTS = new Set([
  'serious_vibes', 'keep_it_casual', 'exploring_vibes', 'see_where_it_goes',
  'open_to_vibes', 'just_friends', 'open_to_anything', 'single_parent', 'new_to_dating'
]);

// Legacy → Current mapping for relationshipIntent values
// These old values may exist in cached drafts or older user profiles
const LEGACY_INTENT_MAP: Record<string, string> = {
  'long_term': 'serious_vibes',
  'short_term': 'keep_it_casual',
  'fwb': 'keep_it_casual',
  'figuring_out': 'exploring_vibes',
  'short_to_long': 'see_where_it_goes',
  'long_to_short': 'open_to_vibes',
  'casual': 'keep_it_casual',
  'serious': 'serious_vibes',
  'marriage': 'serious_vibes',
  'friendship': 'just_friends',
  'open': 'open_to_anything',
};

// Sanitize relationshipIntent: map legacy values AND filter invalid ones
function sanitizeRelationshipIntent(arr: string[]): string[] {
  // Step 1: Map legacy values to current valid values
  const mapped = arr.map(v => LEGACY_INTENT_MAP[v] || v);

  // Step 2: Filter to only valid values
  const sanitized = mapped.filter(v => ALLOWED_RELATIONSHIP_INTENTS.has(v));

  // Step 3: Deduplicate (multiple legacy values might map to same current value)
  const deduped = [...new Set(sanitized)];

  if (__DEV__ && (arr.length !== deduped.length || arr.some((v, i) => v !== mapped[i]))) {
    console.log('[PREFERENCES] relationshipIntent normalization:', {
      original: arr,
      mapped,
      final: deduped,
    });
  }
  return deduped;
}

export default function PreferencesScreen() {
  useScreenTrace("ONB_PREFERENCES");
  // PHASE-1 RESTRUCTURE: Simplified to only lookingFor, lgbtqPreference, relationshipIntent
  const {
    lookingFor,
    relationshipIntent,
    lgbtqPreference,
    toggleRelationshipIntent,
    toggleLgbtqPreference,
    setMinAge,
    setMaxAge,
    setMaxDistance,
    setLookingFor,
    setRelationshipIntent,
    setLgbtqPreference,
    setStep,
  } = useOnboardingStore();
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);
  const { userId, faceVerificationPassed } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // CENTRAL EDIT HUB: Detect if editing from Review screen
  const isEditFromReview = params.editFromReview === 'true';
  const scrollRef = useRef<ScrollView>(null);
  // PHASE-1 RESTRUCTURE: distanceSectionRef, interestsSectionRef removed
  const relationshipIntentSectionRef = useRef<View>(null);

  // PHASE-1 RESTRUCTURE: Simplified validation state
  const [showTopError, setShowTopError] = useState(false);
  const [relationshipIntentError, setRelationshipIntentError] = useState('');
  const [lgbtqError, setLgbtqError] = useState('');

  // P1 STABILITY: Prevent double-submission on rapid taps
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Y position for relationship intent section (for error scrolling)
  const [relationshipIntentSectionY, setRelationshipIntentSectionY] = useState<number | null>(null);

  // PHASE-1 RESTRUCTURE: Keyboard height, activities sanitization, and age/distance sync removed

  // PHASE-1 RESTRUCTURE: Simplified prefill - only lookingFor, relationshipIntent, lgbtqPreference
  useEffect(() => {
    if (isDemoMode && demoHydrated && demoProfile) {
      let loaded = false;
      if (demoProfile.lookingFor && demoProfile.lookingFor.length > 0 && lookingFor.length === 0) {
        setLookingFor(demoProfile.lookingFor as Gender[]);
        loaded = true;
      }
      if (demoProfile.relationshipIntent && demoProfile.relationshipIntent.length > 0 && relationshipIntent.length === 0) {
        setRelationshipIntent(demoProfile.relationshipIntent as RelationshipIntent[]);
        loaded = true;
      }
      // Prefill LGBTQ Preference if available
      if (demoProfile.lgbtqPreference && demoProfile.lgbtqPreference.length > 0 && lgbtqPreference.length === 0) {
        setLgbtqPreference(demoProfile.lgbtqPreference as LgbtqOption[]);
        loaded = true;
      }
      if (loaded) console.log('[PREFERENCES] prefilled preferences from demoProfile');
    }
  }, [demoHydrated, demoProfile]);

  // PHASE-1 RESTRUCTURE: Distance/age handlers removed

  // A) Looking For: SINGLE-SELECT only
  const handleLookingForSelect = (gender: Gender) => {
    // If already selected, keep it selected (don't allow empty)
    if (lookingFor.includes(gender) && lookingFor.length === 1) {
      return; // Already selected, do nothing
    }
    // Replace with single selection
    setLookingFor([gender]);
  };

  // C) Relationship Goal: MIN 1, MAX 3
  const handleRelationshipIntentToggle = (intentValue: RelationshipIntent) => {
    const isSelected = relationshipIntent.includes(intentValue);

    // If trying to add and already at max, ignore tap
    if (!isSelected && relationshipIntent.length >= MAX_RELATIONSHIP_INTENTS) {
      Toast.show(`Maximum ${MAX_RELATIONSHIP_INTENTS} relationship goals allowed`);
      return;
    }

    toggleRelationshipIntent(intentValue);

    // Clear error when user selects at least 1 intent
    // PHASE-1 RESTRUCTURE: Simplified - no interestsError to check
    if (!isSelected && relationshipIntentError) {
      setRelationshipIntentError('');
      setShowTopError(false);
    }
  };

  const handleNext = async () => {
    // P1 STABILITY: Prevent double-submission on rapid taps
    if (isSubmitting) return;

    if (lookingFor.length === 0) {
      Alert.alert('Required', 'Please select who you\'re looking for');
      return;
    }

    let hasError = false;
    let firstErrorY: number | null = null;

    // Validate relationship intent: require 1-3
    if (relationshipIntent.length < 1) {
      setRelationshipIntentError('Select at least 1 relationship goal to continue.');
      hasError = true;
      if (firstErrorY === null) firstErrorY = relationshipIntentSectionY;
    } else if (relationshipIntent.length > MAX_RELATIONSHIP_INTENTS) {
      setRelationshipIntentError(`Select up to ${MAX_RELATIONSHIP_INTENTS} relationship goals.`);
      hasError = true;
      if (firstErrorY === null) firstErrorY = relationshipIntentSectionY;
    } else {
      setRelationshipIntentError('');
    }

    // PHASE-1 RESTRUCTURE: Activities/distance/age validation removed

    if (hasError) {
      setShowTopError(true);
      // Scroll to first error section
      if (firstErrorY !== null) {
        scrollRef.current?.scrollTo({ y: firstErrorY - 100, animated: true });
      }
      return;
    }

    setShowTopError(false);

    // P1 STABILITY: Mark as submitting after validation passes
    setIsSubmitting(true);

    // PHASE-1 RESTRUCTURE: Auto-set safe discovery defaults
    setMinAge(DEFAULT_MIN_AGE);
    setMaxAge(DEFAULT_MAX_AGE);
    setMaxDistance(DISTANCE_DEFAULT);

    // SAVE-AS-YOU-GO: Persist to demoProfiles immediately in demo mode
    // PHASE-1 RESTRUCTURE: Simplified - only lookingFor, relationshipIntent, lgbtqPreference
    if (isDemoMode && userId) {
      const demoStore = useDemoStore.getState();
      const dataToSave: Record<string, any> = {};
      if (lookingFor.length > 0) dataToSave.lookingFor = lookingFor;
      if (relationshipIntent.length > 0) dataToSave.relationshipIntent = relationshipIntent;
      // LGBTQ Preference is optional - only save if user selected any
      if (lgbtqPreference.length > 0) dataToSave.lgbtqPreference = lgbtqPreference;
      dataToSave.minAge = DEFAULT_MIN_AGE;
      dataToSave.maxAge = DEFAULT_MAX_AGE;
      dataToSave.maxDistance = DISTANCE_DEFAULT; // Auto-set
      demoStore.saveDemoProfile(userId, dataToSave);
      console.log(`[PREFERENCES] saved: lookingFor=${lookingFor.length}, intent=${relationshipIntent.length}, lgbtqPref=${lgbtqPreference.length}, dist=${DISTANCE_DEFAULT}`);
    }

    // LIVE MODE: Persist to Convex onboarding draft
    if (!isDemoMode && userId) {
      const preferences: Record<string, any> = {};
      if (lookingFor.length > 0) preferences.lookingFor = lookingFor;
      // STABILITY FIX: Sanitize relationshipIntent before sending to Convex
      const sanitizedIntent = sanitizeRelationshipIntent(relationshipIntent);
      if (sanitizedIntent.length > 0) preferences.relationshipIntent = sanitizedIntent;
      // LGBTQ Preference is optional - only save if user selected any
      if (lgbtqPreference.length > 0) preferences.lgbtqPreference = lgbtqPreference;
      preferences.minAge = DEFAULT_MIN_AGE;
      preferences.maxAge = DEFAULT_MAX_AGE;
      preferences.maxDistance = DISTANCE_DEFAULT; // Auto-set

      try {
        await upsertDraft({
          userId,
          patch: {
            preferences,
            progress: { lastStepKey: 'preferences' },
          },
        });
        if (__DEV__) console.log(`[ONB_DRAFT] Saved preferences: lookingFor=${lookingFor.length}, intent=${relationshipIntent.length}, lgbtqPref=${lgbtqPreference.length}, dist=${DISTANCE_DEFAULT}`);
      } catch (error) {
        if (__DEV__) console.error('[PREFERENCES] Failed to save draft:', error);
        // P1 STABILITY: Re-enable button on failure
        setIsSubmitting(false);
        return;
      }
    }

    // CENTRAL EDIT HUB: Return to Review if editing from there
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] preferences → review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
      // P1 STABILITY: Reset after navigation completes
      setIsSubmitting(false);
      return;
    }

    // PHASE-1 RESTRUCTURE: Go to photo-upload (step 3)
    if (__DEV__) console.log('[ONB] preferences → photo-upload (continue)');
    setStep('photo_upload');
    router.push('/(onboarding)/photo-upload' as any);
    // P1 STABILITY: Reset after navigation completes
    setIsSubmitting(false);
  };

  // PHASE-1 RESTRUCTURE: Previous goes back to basic-info (step 1)
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] preferences → basic-info (previous)');
    setStep('basic_info');
    router.push('/(onboarding)/basic-info' as any);
  };

  // P1 STABILITY: Include isSubmitting in disabled check
  // PHASE-1 RESTRUCTURE: Only check lookingFor and relationshipIntent
  const canContinue = !isSubmitting && lookingFor.length > 0 && relationshipIntent.length >= 1;

  // STABILITY FIX: Wait for Convex hydration before rendering form
  // This prevents showing empty preferences when user returns with incomplete onboarding
  if (!isDemoMode && !convexHydrated) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OnboardingProgressHeader />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your preferences...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // STABILITY FIX: Wait for Convex hydration before rendering form
  // This prevents showing empty preferences when user returns with incomplete onboarding
  if (!isDemoMode && !convexHydrated) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OnboardingProgressHeader />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your preferences...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <OnboardingProgressHeader />
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {showTopError && (
        <View style={styles.topErrorBanner}>
          <Text style={styles.topErrorText}>Please complete highlighted fields.</Text>
        </View>
      )}
      <Text style={styles.title}>Match Preferences</Text>
      <Text style={styles.subtitle}>
        Tell us what you're looking for. You can change these anytime.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Looking For</Text>
        <Text style={styles.sectionSubtitle}>Select one</Text>
        <View style={styles.chipsContainer}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, lookingFor.includes(option.value as Gender) && styles.chipSelected]}
              onPress={() => handleLookingForSelect(option.value as Gender)}
            >
              <Text style={[styles.chipText, lookingFor.includes(option.value as Gender) && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* LGBTQ Preference (Optional) - "What I need?" */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LGBTQ (Optional) — What I need</Text>
        <Text style={styles.sectionSubtitle}>Select up to 2 options</Text>
        <View style={styles.chipsContainer}>
          {LGBTQ_OPTIONS.map((option) => {
            const isSelected = lgbtqPreference.includes(option.value);
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => {
                  const success = toggleLgbtqPreference(option.value);
                  if (!success) {
                    setLgbtqError('You can select up to 2 options');
                    setTimeout(() => setLgbtqError(''), 2000);
                  } else {
                    setLgbtqError('');
                    // Save-as-you-go: update demoProfile immediately
                    if (isDemoMode && userId) {
                      const newLgbtqPref = lgbtqPreference.includes(option.value)
                        ? lgbtqPreference.filter((o) => o !== option.value)
                        : [...lgbtqPreference, option.value];
                      useDemoStore.getState().saveDemoProfile(userId, { lgbtqPreference: newLgbtqPref });
                    }
                  }
                }}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {lgbtqError ? <Text style={styles.fieldError}>{lgbtqError}</Text> : null}
      </View>

      <View
        ref={relationshipIntentSectionRef}
        style={styles.section}
        onLayout={(e) => setRelationshipIntentSectionY(e.nativeEvent.layout.y)}
      >
        <Text style={styles.sectionTitle}>Relationship Goal</Text>
        <Text style={styles.sectionSubtitle}>Select 1 to {MAX_RELATIONSHIP_INTENTS}</Text>
        <View style={[styles.chipsContainer, relationshipIntentError ? styles.chipsContainerError : null]}>
          {RELATIONSHIP_INTENTS.map((intent) => (
            <TouchableOpacity
              key={intent.value}
              style={[styles.chip, relationshipIntent.includes(intent.value) && styles.chipSelected]}
              onPress={() => handleRelationshipIntentToggle(intent.value)}
            >
              <Text style={styles.chipEmoji}>{intent.emoji}</Text>
              <Text style={[styles.chipText, relationshipIntent.includes(intent.value) && styles.chipTextSelected]}>
                {intent.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {relationshipIntentError ? <Text style={styles.fieldError}>{relationshipIntentError}</Text> : null}
      </View>

      {/* PHASE-1 RESTRUCTURE: Interests, Age Range, and Distance sections removed */}

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          disabled={!canContinue}
          loading={isSubmitting}
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
  keyboardAvoid: {
    flex: 1,
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
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 28,
    lineHeight: 24,
  },
  section: {
    marginBottom: 34,
  },
  topErrorBanner: {
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '40',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  topErrorText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: '500',
    textAlign: 'center',
  },
  fieldError: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 8,
  },
  interestsGridError: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.error,
    padding: 4,
    margin: -4,
  },
  chipsContainerError: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.error,
    padding: 4,
    margin: -4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 18,
    lineHeight: 20,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 8,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primaryDark,
  },
  chipEmoji: {
    fontSize: 16,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: -0.1,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  interestsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  interestsCounter: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  interestsCounterValid: {
    color: COLORS.success,
  },
  interestsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 5,
  },
  interestChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primaryDark,
  },
  interestEmoji: {
    fontSize: 14,
  },
  interestLabel: {
    fontSize: 13,
    color: COLORS.text,
  },
  interestLabelSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  ageRowError: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.error,
    padding: 8,
    margin: -8,
  },
  ageInputContainer: {
    flex: 1,
  },
  ageLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  ageInput: {
    width: '100%',
  },
  ageSeparator: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 24,
  },
  distanceInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 18,
    height: 56,
  },
  distanceInputError: {
    borderColor: COLORS.error,
    borderWidth: 1.5,
  },
  distanceTextInput: {
    flex: 1,
    fontSize: 17,
    color: COLORS.text,
    paddingVertical: 0,
  },
  distanceSuffixContainer: {
    marginLeft: 10,
  },
  distanceSuffix: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  footer: {
    marginTop: 24,
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
