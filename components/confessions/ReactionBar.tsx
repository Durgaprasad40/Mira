import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { COLORS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';

// Animated pressable for scale feedback
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Standard reaction emojis for confessions
export const CONFESSION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];
const REACTION_TAP_DEBOUNCE_MS = 250;
const MAX_REACTION_COUNT_LABEL = 999;

function formatReactionCountLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  return count > MAX_REACTION_COUNT_LABEL ? `${MAX_REACTION_COUNT_LABEL}+` : String(count);
}

export interface EmojiCount {
  emoji: string;
  count: number;
}

interface ReactionBarProps {
  topEmojis: EmojiCount[];
  userEmoji: string | null;
  reactionCount: number;
  /** Opens the emoji picker (for the add button) - fallback if onToggleEmoji not provided */
  onReact: () => void;
  /** Directly toggle a specific emoji as the user's reaction */
  onToggleEmoji?: (emoji: string) => void;
  /** Use larger sizing for detail/thread views */
  size?: 'compact' | 'regular';
}

// ══════════════════════════════════════════════════════════════════════════
// ANIMATED EMOJI CHIP - Scale animation on tap
// ══════════════════════════════════════════════════════════════════════════
interface AnimatedChipProps {
  emoji: string;
  count: number;
  isSelected: boolean;
  onPress: () => void;
  size: 'compact' | 'regular';
}

function AnimatedChip({ emoji, count, isSelected, onPress, size }: AnimatedChipProps) {
  const scale = useSharedValue(1);
  const s = size === 'regular' ? regularOverrides : null;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    // Haptic feedback on reaction selection (meaningful action)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    // Scale animation: 1 → 1.08 → 1.0 (subtle, premium)
    scale.value = withSequence(
      withTiming(1.08, { duration: 80 }),
      withSpring(1, { damping: 15, stiffness: 350 })
    );

    onPress();
  }, [onPress, scale]);

  return (
    <AnimatedPressable
      style={[
        styles.chip,
        s?.chip,
        isSelected && styles.chipSelected,
        animatedStyle,
      ]}
      onPress={handlePress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={`React with ${emoji}`}
    >
      <Text style={[styles.chipEmoji, s?.chipEmoji]}>{emoji}</Text>
      <Text
        style={[
          styles.chipCount,
          s?.chipCount,
          isSelected && styles.chipCountSelected,
        ]}
      >
        {formatReactionCountLabel(count)}
      </Text>
    </AnimatedPressable>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ANIMATED ADD BUTTON - Scale + haptic feedback
// ══════════════════════════════════════════════════════════════════════════
interface AnimatedAddButtonProps {
  userEmoji: string | null;
  onPress: () => void;
  size: 'compact' | 'regular';
}

function AnimatedAddButton({ userEmoji, onPress, size }: AnimatedAddButtonProps) {
  const scale = useSharedValue(1);
  const s = size === 'regular' ? regularOverrides : null;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.95, { duration: 60 });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 120 });
  }, [scale]);

  const handlePress = useCallback(() => {
    // No haptic for opening picker (minor action)
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      style={[
        styles.addButton,
        s?.addButton,
        userEmoji ? styles.addButtonActive : null,
        animatedStyle,
      ]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={userEmoji ? `Current reaction ${userEmoji}` : 'Add reaction'}
    >
      {userEmoji ? (
        <Text style={[styles.addButtonEmoji, s?.addButtonEmoji]}>
          {userEmoji}
        </Text>
      ) : (
        <Text style={[styles.addButtonIcon, s?.addButtonIcon]}>👍</Text>
      )}
    </AnimatedPressable>
  );
}

export default function ReactionBar({
  topEmojis,
  userEmoji,
  reactionCount,
  onReact,
  onToggleEmoji,
  size = 'compact',
}: ReactionBarProps) {
  const [showQuickPicker, setShowQuickPicker] = useState(false);
  const lastReactionTapAtRef = useRef<Record<string, number>>({});

  const validEmojis = topEmojis.filter((e) => isProbablyEmoji(e.emoji));
  const visibleCount = validEmojis.reduce((sum, e) => sum + e.count, 0);
  const remaining = Math.max(0, reactionCount - visibleCount);

  const runDebouncedEmojiToggle = useCallback((emoji: string) => {
    const now = Date.now();
    const lastTapAt = lastReactionTapAtRef.current[emoji] ?? 0;
    if (now - lastTapAt < REACTION_TAP_DEBOUNCE_MS) return;
    lastReactionTapAtRef.current[emoji] = now;

    if (onToggleEmoji) {
      onToggleEmoji(emoji);
    } else {
      onReact();
    }
  }, [onToggleEmoji, onReact]);

  const handleQuickSelect = useCallback((emoji: string) => {
    // Haptic feedback on reaction selection (meaningful action)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    setShowQuickPicker(false);
    runDebouncedEmojiToggle(emoji);
  }, [runDebouncedEmojiToggle]);

  const handleOpenPicker = useCallback(() => {
    // No haptic for opening picker (minor action)
    setShowQuickPicker(true);
  }, []);

  return (
    <View style={styles.row}>
      {validEmojis.map((e, i) => (
        <AnimatedChip
          key={`${e.emoji}-${i}`}
          emoji={e.emoji}
          count={e.count}
          isSelected={userEmoji === e.emoji}
          onPress={() => runDebouncedEmojiToggle(e.emoji)}
          size={size}
        />
      ))}

      {remaining > 0 && validEmojis.length > 0 && (
        <Text style={styles.moreCount}>+{formatReactionCountLabel(remaining)}</Text>
      )}

      <AnimatedAddButton
        userEmoji={userEmoji}
        onPress={handleOpenPicker}
        size={size}
      />

      {/* Quick Emoji Picker Modal */}
      <Modal
        visible={showQuickPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQuickPicker(false)}
      >
        <Pressable
          style={styles.quickPickerOverlay}
          onPress={() => setShowQuickPicker(false)}
        >
          <View style={styles.quickPickerContainer}>
            {CONFESSION_EMOJIS.map((emoji) => {
              const isSelected = userEmoji === emoji;
              return (
                <QuickPickerEmoji
                  key={emoji}
                  emoji={emoji}
                  isSelected={isSelected}
                  onPress={() => handleQuickSelect(emoji)}
                />
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// QUICK PICKER EMOJI - Scale animation on tap
// ══════════════════════════════════════════════════════════════════════════
interface QuickPickerEmojiProps {
  emoji: string;
  isSelected: boolean;
  onPress: () => void;
}

function QuickPickerEmoji({ emoji, isSelected, onPress }: QuickPickerEmojiProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.92, { duration: 50 });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 100 });
  }, [scale]);

  return (
    <AnimatedPressable
      style={[
        styles.quickPickerEmoji,
        isSelected && styles.quickPickerEmojiSelected,
        animatedStyle,
      ]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`React with ${emoji}`}
    >
      <Text style={styles.quickPickerEmojiText}>{emoji}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // ── Emoji chip ──
  // Minimum 44px touch target via padding
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderColor: COLORS.primary,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipCount: {
    fontSize: 12,
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
  // 36px visible, hitSlop extends beyond the 44px mobile touch target.
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  addButtonActive: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderColor: COLORS.primary,
  },
  addButtonEmoji: {
    fontSize: 16,
  },
  addButtonIcon: {
    fontSize: 17,
  },

  // Quick emoji picker modal
  quickPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickPickerContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  quickPickerEmoji: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  quickPickerEmojiSelected: {
    backgroundColor: 'rgba(255,107,107,0.2)',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  quickPickerEmojiText: {
    fontSize: 24,
  },
});

/** Size overrides for the "regular" (detail/thread) variant */
const regularOverrides = StyleSheet.create({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    borderRadius: 20,
  },
  chipEmoji: {
    fontSize: 16,
  },
  chipCount: {
    fontSize: 13,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  addButtonEmoji: {
    fontSize: 18,
  },
  addButtonIcon: {
    fontSize: 18,
  },
});
