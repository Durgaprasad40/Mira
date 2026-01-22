import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '@/lib/constants';

interface BadgeProps {
  count?: number;
  dot?: boolean;
  style?: ViewStyle;
  maxCount?: number;
}

export function Badge({ count, dot = false, style, maxCount = 99 }: BadgeProps) {
  if (!dot && (!count || count <= 0)) {
    return null;
  }

  if (dot) {
    return <View style={[styles.dot, style]} />;
  }

  const displayCount = count && count > maxCount ? `${maxCount}+` : count;

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
