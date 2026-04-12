/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/bio.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { validateRequired, scrollToFirstInvalid, createRules } from '@/lib/onboardingValidation';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';

export default function BioScreen() {
  useScreenTrace("ONB_BIO");
  const { bio, setBio, setStep } = useOnboardingStore();
  const { userId } = useAuthStore();
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTopError, setShowTopError] = useState(false);

  // P0 STABILITY: Prevent double-submission on rapid taps
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for scroll-to-invalid behavior
  const scrollRef = useRef<ScrollView>(null);
  const bioInputRef = useRef<TextInput>(null);

  // P1 STABILITY: Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Prefill from demoProfiles if onboardingStore is empty
  useEffect(() => {
    if (isDemoMode && demoHydrated && demoProfile?.bio && !bio) {
      setBio(demoProfile.bio);
      console.log('[BIO] prefilled bio from demoProfile');
    }
  }, [demoHydrated, demoProfile]);

  // Validation rules
  const validationRules = {
    bio: createRules.combine(
      createRules.minLength(VALIDATION.BIO_MIN_LENGTH, 'Bio'),
      createRules.maxLength(VALIDATION.BIO_MAX_LENGTH, 'Bio')
    ),
  };

  const handleNext = async () => {
    // P0 STABILITY: Prevent double-tap
    if (isSubmitting) return;

    const trimmedBio = bio.trim();

    // Bio is optional. Only validate if the user entered something.
    if (trimmedBio.length > 0) {
      const result = validateRequired({ bio: trimmedBio }, validationRules);

      if (!result.ok) {
        setErrors(result.errors as Record<string, string>);
        setShowTopError(true);
        // Scroll to first invalid field
        scrollToFirstInvalid(scrollRef, { bio: bioInputRef }, result.firstInvalidKey as string);
        return;
      }
    }

    setIsSubmitting(true);

    // Clear errors and proceed
    setErrors({});
    setShowTopError(false);

    // SAVE-AS-YOU-GO: Persist to demoProfiles immediately
    if (isDemoMode && userId && trimmedBio) {
      const demoStore = useDemoStore.getState();
      demoStore.saveDemoProfile(userId, { bio: trimmedBio });
      console.log(`[BIO] saved bio (${trimmedBio.length} chars)`);
    }

    // LIVE MODE: Persist bio to onboarding draft in Convex
    // P1 STABILITY: Await and handle failure with user-visible alert
    if (!isDemoMode && userId && trimmedBio) {
      try {
        await upsertDraft({
          userId: userId as any,
          patch: {
            profileDetails: { bio: trimmedBio },
            progress: { lastStepKey: 'bio' },
          },
        });
        if (__DEV__) console.log(`[ONB_DRAFT] Saved bio: ${trimmedBio.length} chars`);
      } catch (error) {
        if (__DEV__) console.error('[BIO] Failed to save draft:', error);
        // P1 STABILITY: Alert user but allow continue (non-blocking)
        Alert.alert(
          'Save Warning',
          'Your bio could not be saved to the server. You can continue, but please check your connection.',
          [{ text: 'OK' }]
        );
      }
    }

    // TODO: Profanity filter check
    // TODO: Link detection check

    if (__DEV__) console.log('[ONB] bio → permissions (continue)');
    setStep('permissions');
    router.push('/(onboarding)/permissions' as any);
    // P1 STABILITY: Guard setState after navigation
    if (isMountedRef.current) setIsSubmitting(false);
  };

  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] bio skipped → permissions');
    setErrors({});
    setShowTopError(false);
    setStep('permissions');
    router.push('/(onboarding)/permissions' as any);
  };

  // Clear field error when user types
  const handleBioChange = (text: string) => {
    setBio(text);
    if (errors.bio) {
      setErrors((prev) => ({ ...prev, bio: '' }));
      setShowTopError(false);
    }
  };

  // POST-VERIFICATION: Previous goes back (within post-verify screens only)
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] bio → additional-photos (previous)');
    setStep('additional_photos');
    router.push('/(onboarding)/additional-photos' as any);
  };

  const tips = [
    'Be authentic and genuine',
    'Share your interests and hobbies',
    'Mention what you\'re looking for',
    'Keep it positive and friendly',
    'Avoid sharing personal contact info',
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <OnboardingProgressHeader />
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>
      {/* Top error banner */}
      {showTopError && (
        <View style={styles.topErrorBanner}>
          <Text style={styles.topErrorText}>Please complete highlighted fields.</Text>
        </View>
      )}

      <Text style={styles.title}>Write your bio</Text>
      <Text style={styles.subtitle}>
        Tell people about yourself. You can also skip this for now and add it later.
      </Text>

      <View style={styles.inputContainer}>
        <TextInput
          ref={bioInputRef}
          style={[styles.input, errors.bio ? styles.inputError : null]}
          value={bio}
          onChangeText={handleBioChange}
          placeholder="Write a few sentences about yourself..."
          multiline
          numberOfLines={6}
          maxLength={VALIDATION.BIO_MAX_LENGTH}
          textAlignVertical="top"
        />
        <View style={styles.charCount}>
          <Text style={[styles.charCountText, bio.length < VALIDATION.BIO_MIN_LENGTH && styles.charCountWarning]}>
            {bio.length}/{VALIDATION.BIO_MAX_LENGTH}
          </Text>
        </View>
        {/* Inline field error */}
        {errors.bio ? <Text style={styles.fieldError}>{errors.bio}</Text> : null}
      </View>

      <View style={styles.tipsContainer}>
        <Text style={styles.tipsTitle}>Tips for a great bio:</Text>
        {tips.map((tip, index) => (
          <View key={index} style={styles.tipItem}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          fullWidth
        />
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
            <Text style={styles.navText}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={handleSkip}>
            <Text style={styles.navText}>Skip</Text>
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
    marginBottom: 24,
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 20,
  },
  input: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 150,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  charCount: {
    alignItems: 'flex-end',
    marginTop: 8,
  },
  charCountText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  charCountWarning: {
    color: COLORS.error,
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
  inputError: {
    borderColor: COLORS.error,
    borderWidth: 2,
  },
  fieldError: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 6,
  },
  tipsContainer: {
    backgroundColor: COLORS.backgroundDark,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tipBullet: {
    fontSize: 16,
    color: COLORS.primary,
    marginRight: 8,
  },
  tipText: {
    fontSize: 13,
    color: COLORS.textLight,
    flex: 1,
    lineHeight: 18,
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
});
