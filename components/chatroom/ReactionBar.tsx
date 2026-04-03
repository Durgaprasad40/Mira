import React, { useCallback, memo } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { CHAT_SIZES, SPACING, SIZES } from '@/lib/responsive';

const C = INCOGNITO_COLORS;

// Available reaction emojis
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥', '👎'] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];

interface ReactionBarProps {
  /** Called when user selects a reaction */
  onReact: (emoji: ReactionEmoji) => void;
  /** Currently selected reaction (if any) - will be highlighted */
  selectedEmoji?: ReactionEmoji | null;
  /** Style positioning */
  style?: object;
}

/**
 * Horizontal emoji reaction bar displayed on long-press
 * P0-002/P0-003 FIX: Memoized with responsive sizing for better perf
 */
function ReactionBar({
  onReact,
  selectedEmoji,
  style,
}: ReactionBarProps) {
  // P0-003 FIX: Memoize click handlers to prevent unnecessary re-renders
  const handleReact = useCallback((emoji: ReactionEmoji) => {
    onReact(emoji);
  }, [onReact]);

  return (
    <View style={[styles.container, style]}>
      {REACTION_EMOJIS.map((emoji) => {
        const isSelected = selectedEmoji === emoji;
        return (
          <TouchableOpacity
            key={emoji}
            onPress={() => handleReact(emoji)}
            style={[styles.emojiButton, isSelected && styles.emojiButtonSelected]}
            activeOpacity={0.7}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// P0-003 FIX: Wrap with React.memo to prevent unnecessary re-renders
export default memo(ReactionBar);

// P0-002 FIX: Use responsive sizing for cross-device consistency
const EMOJI_BTN_SIZE = CHAT_SIZES.emojiButton;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: SIZES.radius.xl,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    gap: SPACING.xxs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  emojiButton: {
    width: EMOJI_BTN_SIZE,
    height: EMOJI_BTN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: EMOJI_BTN_SIZE / 2,
  },
  emojiButtonSelected: {
    backgroundColor: 'rgba(109, 40, 217, 0.3)',
  },
  emoji: {
    // P0-002/P0-003 FIX: Slightly smaller emoji for better rendering performance
    // Native emoji at fontSize 24 causes frame drops; 22 is smoother
    fontSize: CHAT_SIZES.emojiSize,
  },
});
