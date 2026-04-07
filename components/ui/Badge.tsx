import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ViewStyle, Animated } from 'react-native';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_WEIGHT,
  moderateScale,
} from '@/lib/constants';

// Badge sizes - scaled for cross-device consistency
const BADGE_SIZE = moderateScale(18, 0.3);
const DOT_SIZE = moderateScale(10, 0.3);

interface BadgeProps {
  count?: number;
  dot?: boolean;
  style?: ViewStyle;
  maxCount?: number;
  /** Enable subtle scale-in animation when badge appears */
  animate?: boolean;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
}

export function Badge({
  count,
  dot = false,
  style,
  maxCount = 99,
  animate = false,
  size = 'medium',
}: BadgeProps) {
  const scaleAnim = useRef(new Animated.Value(animate ? 0.9 : 1)).current;
  const hasAnimatedRef = useRef(false);

  // Subtle pulse animation on mount (scale 0.9 → 1.0)
  useEffect(() => {
    if (!animate || hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    scaleAnim.setValue(0.9);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 6,
      tension: 150,
      useNativeDriver: true,
    }).start();
  }, [animate, scaleAnim]);

  if (!dot && (!count || count <= 0)) {
    return null;
  }

  // Get size-specific styles
  const sizeStyle = SIZE_STYLES[size];

  if (dot) {
    if (animate) {
      return (
        <Animated.View
          style={[styles.dot, sizeStyle.dot, style, { transform: [{ scale: scaleAnim }] }]}
        />
      );
    }
    return <View style={[styles.dot, sizeStyle.dot, style]} />;
  }

  const displayCount = count && count > maxCount ? `${maxCount}+` : count;

  if (animate) {
    return (
      <Animated.View style={[styles.badge, sizeStyle.badge, style, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={[styles.text, sizeStyle.text]}>{displayCount}</Text>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.badge, sizeStyle.badge, style]}>
      <Text style={[styles.text, sizeStyle.text]}>{displayCount}</Text>
    </View>
  );
}

// Size variant styles
const SIZE_STYLES = {
  small: StyleSheet.create({
    badge: {
      minWidth: moderateScale(14, 0.3),
      height: moderateScale(14, 0.3),
      borderRadius: moderateScale(7, 0.3),
      paddingHorizontal: SPACING.xxs,
    },
    text: {
      fontSize: FONT_SIZE.xxs,
    },
    dot: {
      width: moderateScale(6, 0.3),
      height: moderateScale(6, 0.3),
      borderRadius: moderateScale(3, 0.3),
    },
  }),
  medium: StyleSheet.create({
    badge: {
      minWidth: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: BADGE_SIZE / 2,
      paddingHorizontal: SPACING.xs,
    },
    text: {
      fontSize: FONT_SIZE.sm,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
  }),
  large: StyleSheet.create({
    badge: {
      minWidth: moderateScale(22, 0.3),
      height: moderateScale(22, 0.3),
      borderRadius: moderateScale(11, 0.3),
      paddingHorizontal: SPACING.xs + 2,
    },
    text: {
      fontSize: FONT_SIZE.caption,
    },
    dot: {
      width: moderateScale(12, 0.3),
      height: moderateScale(12, 0.3),
      borderRadius: moderateScale(6, 0.3),
    },
  }),
};

const styles = StyleSheet.create({
  badge: {
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0, // Prevent badge from shrinking
  },
  text: {
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.white,
    textAlign: 'center',
  },
  dot: {
    backgroundColor: COLORS.error,
    flexShrink: 0, // Prevent dot from shrinking
  },
});
