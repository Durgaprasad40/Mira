import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants';
import { useOnboardingStore } from '@/stores/onboardingStore';
import {
  getStepNumber,
  getProgressPercentage,
  ONBOARDING_TOTAL_STEPS,
} from '@/lib/onboardingProgress';

/**
 * OnboardingProgressHeader - Displays progress bar for onboarding flow.
 * Shows "Step X of Y" on left, percentage on right, with thin progress bar.
 */
export function OnboardingProgressHeader() {
  const currentStep = useOnboardingStore((state) => state.currentStep);

  const stepNumber = getStepNumber(currentStep);
  const percentage = getProgressPercentage(currentStep);

  // Don't render if step is not in progress flow (e.g., welcome)
  if (stepNumber === null || percentage === null) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.textRow}>
        <Text style={styles.stepText}>
          Step {stepNumber} of {ONBOARDING_TOTAL_STEPS}
        </Text>
        <Text style={styles.percentText}>{percentage}%</Text>
      </View>
      <View style={styles.progressBarBackground}>
        <View style={[styles.progressBarFill, { width: `${percentage}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
  },
  textRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  percentText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
});
