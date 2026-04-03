import React, { memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { CHAT_SIZES, CHAT_FONTS, SPACING, SIZES } from '@/lib/responsive';

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

// P0-002 FIX: Calculate marginLeft dynamically based on avatar size + gap
// This ensures proper alignment across devices regardless of avatar scaling
const REACTION_MARGIN_LEFT = CHAT_SIZES.messageAvatar + SPACING.sm;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
    // P0-002 FIX: Dynamic margin based on avatar size instead of hardcoded 42
    marginLeft: REACTION_MARGIN_LEFT,
  },
  containerMe: {
    marginLeft: 0,
    marginRight: 0,
    justifyContent: 'flex-end',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: SIZES.radius.md,
    gap: SPACING.xs,
  },
  chipMe: {
    backgroundColor: 'rgba(109, 40, 217, 0.2)',
  },
  chipUserReacted: {
    backgroundColor: 'rgba(109, 40, 217, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(109, 40, 217, 0.5)',
  },
  emoji: {
    // P0-002 FIX: Responsive emoji size for chips
    fontSize: CHAT_SIZES.emojiChipSize,
  },
  count: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.reactionCount,
    fontWeight: '600',
    color: C.textLight,
  },
  countUserReacted: {
    color: '#A78BFA',
  },
});
