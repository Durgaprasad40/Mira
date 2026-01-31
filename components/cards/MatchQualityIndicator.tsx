import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants';

interface MatchQualityIndicatorProps {
  score: number; // 0-5
  showLabel?: boolean;
}

export function MatchQualityIndicator({ score, showLabel = true }: MatchQualityIndicatorProps) {
  const getLabel = () => {
    if (score >= 4.5) return 'Perfect Match!';
    if (score >= 4) return 'Great Match!';
    if (score >= 3.5) return 'Good Match';
    if (score >= 3) return 'Decent Match';
    return 'Potential Match';
  };

  const getLabelColor = () => {
    if (score >= 4.5) return COLORS.primary;
    if (score >= 4) return COLORS.secondary;
    if (score >= 3.5) return COLORS.gold;
    if (score >= 3) return COLORS.textLight;
    return COLORS.textLight;
  };

  if (!showLabel) {
    // Compact mode: just a small colored label chip
    return (
      <View style={[styles.chip, { backgroundColor: getLabelColor() + '30' }]}>
        <Text style={[styles.chipText, { color: COLORS.white }]}>{getLabel()}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: getLabelColor() }]}>{getLabel()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
