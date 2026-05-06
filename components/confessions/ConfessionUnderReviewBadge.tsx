import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FONT_SIZE, FONT_WEIGHT, SPACING } from '@/lib/constants';

export type ConfessionModerationStatus =
  | 'normal'
  | 'under_review'
  | 'hidden_by_reports'
  | undefined;

interface ConfessionUnderReviewBadgeProps {
  status?: ConfessionModerationStatus;
}

const REVIEW_AMBER = '#B7791F';

export default function ConfessionUnderReviewBadge({
  status,
}: ConfessionUnderReviewBadgeProps) {
  if (!status || status === 'normal') return null;

  return (
    <View style={styles.badge} accessibilityLabel="Under review">
      <Ionicons name="lock-closed-outline" size={13} color={REVIEW_AMBER} />
      <Text maxFontSizeMultiplier={1.2} style={styles.text}>
        Under review
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xxs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(183, 121, 31, 0.36)',
    backgroundColor: 'rgba(183, 121, 31, 0.1)',
  },
  text: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: REVIEW_AMBER,
  },
});
