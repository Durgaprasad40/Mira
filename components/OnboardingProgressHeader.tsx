import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePathname, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { getProgressFromRoute } from '@/lib/onboardingProgress';

/**
 * OnboardingProgressHeader - Displays progress bar for onboarding flow.
 * Uses current route path for per-screen progress tracking.
 * When editFromReview=true, keeps progress at 100% (review state).
 */
export function OnboardingProgressHeader() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // Check if editing from review - keep progress at 100%
  const isEditFromReview = params.editFromReview === 'true';

  // Get progress based on current route path
  const { percentage } = getProgressFromRoute(pathname, isEditFromReview);

  // Don't render if route is not in progress flow (e.g., welcome, tutorial)
  if (percentage === null) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.textRow}>
        <View />
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
