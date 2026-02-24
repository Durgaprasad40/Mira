import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';

export default function BioScreen() {
  const { bio, setBio, setStep } = useOnboardingStore();
  const router = useRouter();
  const [error, setError] = useState('');

  const handleNext = () => {
    if (!bio || bio.trim().length < VALIDATION.BIO_MIN_LENGTH) {
      setError(`Bio must be at least ${VALIDATION.BIO_MIN_LENGTH} characters`);
      return;
    }
    if (bio.length > VALIDATION.BIO_MAX_LENGTH) {
      setError(`Bio must be no more than ${VALIDATION.BIO_MAX_LENGTH} characters`);
      return;
    }

    // TODO: Profanity filter check
    // TODO: Link detection check

    if (__DEV__) console.log('[ONB] bio → prompts (continue)');
    setStep('prompts');
    router.push('/(onboarding)/prompts' as any);
  };

  // POST-VERIFICATION: Skip advances to next step
  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] bio → prompts (skip)');
    setStep('prompts');
    router.push('/(onboarding)/prompts' as any);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Write your bio</Text>
      <Text style={styles.subtitle}>
        Tell people about yourself. What makes you unique?
      </Text>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={bio}
          onChangeText={(text) => {
            setBio(text);
            setError('');
          }}
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
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

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
          disabled={bio.length < VALIDATION.BIO_MIN_LENGTH}
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
  error: {
    fontSize: 14,
    color: COLORS.error,
    marginBottom: 16,
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
