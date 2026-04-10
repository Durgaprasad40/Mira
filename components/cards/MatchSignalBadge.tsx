/**
 * MatchSignalBadge - Phase 1A Discover Redesign
 *
 * Shows a subtle "X in common" badge on Photo 1 when there's meaningful compatibility.
 * Provides an immediate hook to engage users.
 *
 * DISPLAY CONDITIONS:
 * - commonCount >= 3 (shared interests)
 * - OR sameRelationshipIntent === true
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
}

export function MatchSignalBadge({
  commonCount,
  sameRelationshipIntent,
  visible,
}: MatchSignalBadgeProps) {
  // Only show if we have meaningful compatibility signal
  const shouldShow = visible && (commonCount >= 3 || sameRelationshipIntent);

  if (!shouldShow) {
    return null;
  }

  // Determine label
  let label: string;
  if (commonCount >= 3) {
    label = `${commonCount} in common`;
  } else if (sameRelationshipIntent) {
    label = 'Same goals';
  } else {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.delay(400).duration(250)}
      exiting={FadeOut.duration(150)}
      style={styles.container}
    >
      <Text style={styles.emoji}>✨</Text>
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
