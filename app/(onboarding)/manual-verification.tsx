import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

export default function ManualVerificationScreen() {
  const { setStep } = useOnboardingStore();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmitForReview = async () => {
    setIsSubmitting(true);

    // Simulate submission delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    setIsSubmitting(false);
    setSubmitted(true);

    // STRICT: Do NOT set verificationPassed(true)
    // User stays on this screen until manual review completes
    // In production: would call backend to submit for manual review
    console.log('[ManualVerification] Submitted for review - staying on waiting screen');
  };

  const handleRetry = () => {
    setStep('face_verification');
    router.replace('/(onboarding)/face-verification' as any);
  };

  // STRICT: After submit, show waiting screen and do NOT proceed
  if (submitted) {
    return (
      <View style={styles.container}>
        <Ionicons name="time-outline" size={80} color={COLORS.primary} />
        <Text style={styles.title}>Review in Progress</Text>
        <Text style={styles.subtitle}>
          Your verification has been submitted for manual review.{'\n\n'}
          This usually takes 24-48 hours. You'll receive a notification when complete.
        </Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>What now?</Text>
          <Text style={styles.infoText}>
            • Please check back later{'\n'}
            • You cannot proceed until review is complete{'\n'}
            • We'll notify you once approved
          </Text>
        </View>
        <Button
          title="Try Verification Again"
          variant="outline"
          onPress={handleRetry}
          fullWidth
          style={styles.retryButton}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Ionicons name="person-circle-outline" size={80} color={COLORS.textLight} />

      <Text style={styles.title}>Manual Verification Required</Text>

      <Text style={styles.subtitle}>
        We couldn't automatically verify your identity. This can happen due to lighting, image quality, or other factors.
      </Text>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>What happens next?</Text>
        <Text style={styles.infoText}>
          • Our team will manually review your photos{'\n'}
          • This usually takes 24-48 hours{'\n'}
          • You'll receive a notification when complete
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          title={isSubmitting ? "Submitting..." : "Submit for Review"}
          variant="primary"
          onPress={handleSubmitForReview}
          disabled={isSubmitting}
          fullWidth
          style={styles.primaryButton}
        />

        <Button
          title="Try Verification Again"
          variant="outline"
          onPress={handleRetry}
          fullWidth
          style={styles.secondaryButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 24,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  infoBox: {
    backgroundColor: COLORS.backgroundDark,
    padding: 20,
    borderRadius: 12,
    width: '100%',
    marginBottom: 32,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 24,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    marginBottom: 8,
  },
  secondaryButton: {},
  retryButton: {
    marginTop: 24,
  },
});
