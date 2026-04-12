import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { usePathname, useLocalSearchParams } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '@/lib/constants';
import { getProgressFromRoute } from '@/lib/onboardingProgress';
import { ANIMATION_DURATION, ANIMATION_EASING } from '@/lib/animations';

/**
 * OnboardingProgressHeader - Displays STEPWISE progress for onboarding flow.
 * Shows "Step X of Y" as primary indicator with subtle progress bar secondary.
 * Uses current route path for per-screen progress tracking.
 * When editFromReview=true, keeps progress at 100% (review state).
 */
export function OnboardingProgressHeader() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // Check if editing from review - keep progress at 100%
  const isEditFromReview = params.editFromReview === 'true';

  // Get progress based on current route path
  const { stepNumber, totalSteps, percentage } = getProgressFromRoute(pathname, isEditFromReview);

  // Animated progress width
  const progressWidth = useSharedValue(percentage ?? 0);

  // Update progress animation when percentage changes
  useEffect(() => {
    if (percentage !== null) {
      progressWidth.value = withTiming(percentage, {
        duration: ANIMATION_DURATION.smooth,
        easing: ANIMATION_EASING.smooth,
      });
    }
  }, [percentage, progressWidth]);

  const animatedFillStyle = useAnimatedStyle(() => {
    return {
      width: `${progressWidth.value}%`,
    };
  });

  // Don't render if route is not in progress flow (e.g., welcome, tutorial)
  if (percentage === null || stepNumber === null) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Primary: Stepwise indicator */}
      <Text style={styles.stepText}>Step {stepNumber} of {totalSteps}</Text>
      {/* Secondary: Subtle progress bar */}
      <View style={styles.progressBarBackground}>
        <Animated.View style={[styles.progressBarFill, animatedFillStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: COLORS.background,
  },
  // Primary: Stepwise text (prominent)
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  // Secondary: Subtle thin progress bar
  progressBarBackground: {
    height: 3,
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
