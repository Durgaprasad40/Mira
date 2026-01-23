import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

interface MatchQualityIndicatorProps {
  score: number; // 0-5
  showLabel?: boolean;
}

export function MatchQualityIndicator({ score, showLabel = true }: MatchQualityIndicatorProps) {
  const stars = Math.round(score);
  const percentage = (score / 5) * 100;

  const getLabel = () => {
    if (score >= 4.5) return 'Perfect Match!';
    if (score >= 4) return 'Great Match!';
    if (score >= 3.5) return 'Good Match';
    if (score >= 3) return 'Decent Match';
    return 'Potential Match';
  };

  return (
    <View style={styles.container}>
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Ionicons
            key={star}
            name={star <= stars ? 'star' : 'star-outline'}
            size={16}
            color={star <= stars ? COLORS.gold : COLORS.border}
          />
        ))}
      </View>
      {showLabel && (
        <Text style={styles.label}>{getLabel()}</Text>
      )}
      {showLabel && (
        <Text style={styles.score}>{percentage.toFixed(0)}% match</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 8,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  score: {
    fontSize: 12,
    color: COLORS.textLight,
  },
});
