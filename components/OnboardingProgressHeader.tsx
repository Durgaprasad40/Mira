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
 * OnboardingProgressHeader - Displays progress bar for onboarding flow.
 * Uses current route path for per-screen progress tracking.
 * When editFromReview=true, keeps progress at 100% (review state).
 * Features smooth animated progress fill.
 */
export function OnboardingProgressHeader() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // Check if editing from review - keep progress at 100%
  const isEditFromReview = params.editFromReview === 'true';

  // Get progress based on current route path
  const { percentage } = getProgressFromRoute(pathname, isEditFromReview);

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
        <Animated.View style={[styles.progressBarFill, animatedFillStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: COLORS.background,
  },
  textRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  stepText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  percentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    letterSpacing: 0.3,
  },
  progressBarBackground: {
    height: 5,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
    // Subtle glow effect on iOS
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 4,
      },
    }),
  },
});
