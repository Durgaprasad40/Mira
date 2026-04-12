/**
 * MatchSignalBadge - Phase 1A Discover Redesign
 *
 * Shows "Why You're Seeing This" badges on Photo 1 for engagement.
 * GROWTH: Enhanced to show multiple match reasons.
 *
 * DISPLAY CONDITIONS:
 * - commonCount >= 2 (shared interests)
 * - OR sameRelationshipIntent === true
 * - OR matchScore >= 80
 *
 * POSITION: Top-right of card, only on photoIndex === 0
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

interface MatchSignalBadgeProps {
  /** Number of common interests/activities */
  commonCount: number;
  /** Whether relationship intent matches */
  sameRelationshipIntent: boolean;
  /** Whether to show the badge (typically photoIndex === 0) */
  visible: boolean;
  /** GROWTH: Match score (60-95%) for high compatibility signal */
  matchScore?: number;
}

export function MatchSignalBadge({
  commonCount,
  sameRelationshipIntent,
  visible,
  matchScore,
}: MatchSignalBadgeProps) {
  // Only show if we have meaningful compatibility signal
  const hasHighMatch = matchScore && matchScore >= 85;
  const hasGoodCommon = commonCount >= 2;
  const shouldShow = visible && (hasGoodCommon || sameRelationshipIntent || hasHighMatch);

  if (!shouldShow) {
    return null;
  }

  // GROWTH: Determine best label based on strongest signal
  let label: string;
  let emoji: string;

  if (hasHighMatch) {
    // High compatibility takes priority
    label = `${matchScore}% Match`;
    emoji = '💫';
  } else if (sameRelationshipIntent && commonCount >= 2) {
    // Both signals - show combined
    label = `Same goals • ${commonCount} in common`;
    emoji = '✨';
  } else if (commonCount >= 3) {
    label = `${commonCount} in common`;
    emoji = '✨';
  } else if (sameRelationshipIntent) {
    label = 'Same goals';
    emoji = '🎯';
  } else if (commonCount >= 2) {
    label = `${commonCount} shared interests`;
    emoji = '✨';
  } else {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.delay(400).duration(250)}
      exiting={FadeOut.duration(150)}
      style={styles.container}
    >
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 48, // Below photo indicator bars
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    backdropFilter: 'blur(10px)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    // Shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  emoji: {
    fontSize: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});

export default MatchSignalBadge;
