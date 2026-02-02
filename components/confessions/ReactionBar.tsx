import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, CONFESSION_REACTIONS } from '@/lib/constants';
import { ConfessionReactionType } from '@/types';

const REACTION_KEYS: ConfessionReactionType[] = ['relatable', 'feel_you', 'bold', 'curious'];

interface ReactionBarProps {
  reactions: Record<ConfessionReactionType, number>;
  userReactions: ConfessionReactionType[];
  onToggleReaction: (type: ConfessionReactionType) => void;
  compact?: boolean;
}

export default function ReactionBar({
  reactions,
  userReactions,
  onToggleReaction,
  compact,
}: ReactionBarProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {REACTION_KEYS.map((key) => {
        const config = CONFESSION_REACTIONS[key];
        const count = reactions[key] || 0;
        const isActive = userReactions.includes(key);

        return (
          <TouchableOpacity
            key={key}
            style={[styles.button, isActive && styles.buttonActive]}
            onPress={() => onToggleReaction(key)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            activeOpacity={0.7}
          >
            <Text style={[styles.emoji, compact && styles.emojiCompact]}>{config.emoji}</Text>
            <Text style={[styles.count, isActive && styles.countActive, compact && styles.countCompact]}>
              {count}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  containerCompact: {
    gap: 4,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttonActive: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderColor: COLORS.primary,
  },
  emoji: {
    fontSize: 14,
  },
  emojiCompact: {
    fontSize: 12,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  countActive: {
    color: COLORS.primary,
  },
  countCompact: {
    fontSize: 11,
  },
});
