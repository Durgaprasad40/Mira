import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { validateRequired, scrollToFirstInvalid, createRules } from '@/lib/onboardingValidation';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

export default function BioScreen() {
  const { bio, setBio, setStep } = useOnboardingStore();
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTopError, setShowTopError] = useState(false);

  // Refs for scroll-to-invalid behavior
  const scrollRef = useRef<ScrollView>(null);
  const bioInputRef = useRef<TextInput>(null);

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

  const handleNext = () => {
    // Run validation
    const result = validateRequired({ bio }, validationRules);

    if (!result.ok) {
      setErrors(result.errors as Record<string, string>);
      setShowTopError(true);
      // Scroll to first invalid field
      scrollToFirstInvalid(scrollRef, { bio: bioInputRef }, result.firstInvalidKey as string);
      return;
    }

    // Clear errors and proceed
    setErrors({});
    setShowTopError(false);

    // SAVE-AS-YOU-GO: Persist to demoProfiles immediately
    if (isDemoMode && userId && bio.trim()) {
      const demoStore = useDemoStore.getState();
      demoStore.saveDemoProfile(userId, { bio: bio.trim() });
      console.log(`[BIO] saved bio (${bio.trim().length} chars)`);
    }

    // TODO: Profanity filter check
    // TODO: Link detection check

    if (__DEV__) console.log('[ONB] bio → permissions (continue)');
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
        Tell people about yourself. What makes you unique?
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
