import React, { memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Whether the current user reacted with this emoji */
  isUserReaction: boolean;
}

interface ReactionChipsProps {
  reactions: ReactionGroup[];
  /** Called when user taps a reaction chip (to add/remove) */
  onReactionTap: (emoji: string) => void;
  /** Whether this is the sender's message (for styling) */
  isMe?: boolean;
}

/**
 * Displays reaction chips below a message
 * Shows emoji + count, highlights if user reacted
 * P0-002/P0-003 FIX: Memoized with responsive sizing
 */
function ReactionChips({
  reactions,
  onReactionTap,
  isMe = false,
}: ReactionChipsProps) {
  // P0-003 FIX: Memoize tap handler
  const handleTap = useCallback((emoji: string) => {
    onReactionTap(emoji);
  }, [onReactionTap]);

  if (reactions.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, isMe && styles.containerMe]}>
      {reactions.map((reaction) => (
        <TouchableOpacity
          key={reaction.emoji}
          onPress={() => handleTap(reaction.emoji)}
          style={[
            styles.chip,
            reaction.isUserReaction && styles.chipUserReacted,
            isMe && styles.chipMe,
          ]}
          activeOpacity={0.7}
        >
          <Text style={styles.emoji}>{reaction.emoji}</Text>
          <Text
            style={[
              styles.count,
              reaction.isUserReaction && styles.countUserReacted,
            ]}
          >
            {reaction.count}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// P0-003 FIX: Wrap with React.memo to prevent unnecessary re-renders when parent re-renders
export default memo(ReactionChips);

// REACTION-FIX: Compact badge-like styling
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  containerMe: {
    justifyContent: 'flex-end',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    // REACTION-FIX: Compact badge styling with shadow for depth
    backgroundColor: '#1E1E2E',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 3,
    // Subtle shadow for floating effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  chipMe: {
    backgroundColor: '#2D1B4E',
    borderColor: 'rgba(109, 40, 217, 0.3)',
  },
  chipUserReacted: {
    backgroundColor: 'rgba(109, 40, 217, 0.4)',
    borderWidth: 1,
    borderColor: '#6D28D9',
  },
  emoji: {
    // Compact emoji size
    fontSize: 14,
  },
  count: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textLight,
  },
  countUserReacted: {
    color: '#A78BFA',
  },
});
