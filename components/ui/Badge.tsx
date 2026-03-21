import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ViewStyle, Animated } from 'react-native';
import { COLORS } from '@/lib/constants';

interface BadgeProps {
  count?: number;
  dot?: boolean;
  style?: ViewStyle;
  maxCount?: number;
  /** Enable subtle scale-in animation when badge appears */
  animate?: boolean;
}

export function Badge({ count, dot = false, style, maxCount = 99, animate = false }: BadgeProps) {
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

  if (dot) {
    if (animate) {
      return (
        <Animated.View
          style={[styles.dot, style, { transform: [{ scale: scaleAnim }] }]}
        />
      );
    }
    return <View style={[styles.dot, style]} />;
  }

  const displayCount = count && count > maxCount ? `${maxCount}+` : count;

  if (animate) {
    return (
      <Animated.View style={[styles.badge, style, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={styles.text}>{displayCount}</Text>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.text}>{displayCount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.error,
  },
});
