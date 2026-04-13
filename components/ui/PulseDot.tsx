/**
 * PulseDot - Subtle animated status indicator
 *
 * A tiny pulsing dot for online/active status indicators.
 * Uses react-native-reanimated for smooth 60fps animation.
 *
 * UI-ONLY: No logic, just visual indicator.
 */
import React, { useEffect } from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '@/lib/constants';

interface PulseDotProps {
  /** Size of the dot in pixels (default: 8) */
  size?: number;
  /** Color of the dot (default: success green) */
  color?: string;
  /** Whether to animate (default: true) */
  animated?: boolean;
  /** Custom style overrides */
  style?: ViewStyle;
}

/**
 * A subtle pulsing status indicator dot.
 *
 * @example
 * // Online status indicator
 * <PulseDot size={8} color="#34C759" />
 *
 * @example
 * // Static dot (no animation)
 * <PulseDot size={6} animated={false} />
 */
export function PulseDot({
  size = 8,
  color = COLORS.success || '#34C759',
  animated = true,
  style,
}: PulseDotProps) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (animated) {
      // Subtle opacity pulse: 1 -> 0.5 -> 1
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1, // infinite
        false
      );

      // Very subtle scale pulse: 1 -> 1.1 -> 1
      scale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1, // infinite
        false
      );
    } else {
      opacity.value = 1;
      scale.value = 1;
    }
  }, [animated, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    // Base styles - size/color set via props
  },
});

export default PulseDot;
