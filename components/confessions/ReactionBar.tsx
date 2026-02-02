import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';

export interface EmojiCount {
  emoji: string;
  count: number;
}

interface ReactionBarProps {
  topEmojis: EmojiCount[];
  userEmoji: string | null;
  reactionCount: number;
  /** Opens the emoji picker (for the add button) */
  onReact: () => void;
  /** Directly toggle a specific emoji as the user's reaction */
  onToggleEmoji?: (emoji: string) => void;
  /** Use larger sizing for detail/thread views */
  size?: 'compact' | 'regular';
}

export default function ReactionBar({
  topEmojis,
  userEmoji,
  reactionCount,
  onReact,
  onToggleEmoji,
  size = 'compact',
}: ReactionBarProps) {
  const s = size === 'regular' ? regularOverrides : null;

  const validEmojis = topEmojis.filter((e) => isProbablyEmoji(e.emoji));
  const visibleCount = validEmojis.reduce((sum, e) => sum + e.count, 0);
  const remaining = reactionCount - visibleCount;

  return (
    <View style={styles.row}>
      {validEmojis.map((e, i) => {
        const isSelected = userEmoji === e.emoji;
        return (
          <TouchableOpacity
            key={i}
            style={[
              styles.chip,
              s?.chip,
              isSelected && styles.chipSelected,
            ]}
            onPress={() => onToggleEmoji ? onToggleEmoji(e.emoji) : onReact()}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipEmoji, s?.chipEmoji]}>{e.emoji}</Text>
            <Text
              style={[
                styles.chipCount,
                s?.chipCount,
                isSelected && styles.chipCountSelected,
              ]}
            >
              {e.count}
            </Text>
          </TouchableOpacity>
        );
      })}

      {remaining > 0 && validEmojis.length > 0 && (
        <Text style={styles.moreCount}>+{remaining}</Text>
      )}

      <TouchableOpacity
        style={[
          styles.addButton,
          s?.addButton,
          userEmoji ? styles.addButtonActive : null,
        ]}
        onPress={onReact}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        {userEmoji ? (
          <Text style={[styles.addButtonEmoji, s?.addButtonEmoji]}>
            {userEmoji}
          </Text>
        ) : (
          <Text style={[styles.addButtonIcon, s?.addButtonIcon]}>🙂</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // ── Emoji chip ──
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderColor: COLORS.primary,
  },
  chipEmoji: {
    fontSize: 13,
  },
  chipCount: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  chipCountSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  // ── "+N more" label ──
  moreCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginLeft: 2,
  },

  // ── Add / user-reaction button ──
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  addButtonActive: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderColor: COLORS.primary,
  },
  addButtonEmoji: {
    fontSize: 14,
  },
  addButtonIcon: {
    fontSize: 15,
  },
});

/** Size overrides for the "regular" (detail/thread) variant */
const regularOverrides = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipCount: {
    fontSize: 12,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  addButtonEmoji: {
    fontSize: 16,
  },
  addButtonIcon: {
    fontSize: 16,
  },
});
