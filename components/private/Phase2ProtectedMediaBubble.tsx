/**
 * Phase-2 Protected Media Bubble (pure-visual)
 *
 * STRICT ISOLATION:
 *   - No Convex queries / mutations.
 *   - No Phase-1 backend (`api.media.*`, `api.protectedMedia.*`).
 *   - All state is delivered by the parent via props (which sources Phase-2
 *     fields from `api.privateConversations.getPrivateMessages`).
 *
 * Rendering rules (Step 3 of the Wave 2 plan):
 *   - Not yet viewed (no viewedAt)            → locked / "Tap to view" state
 *   - Currently viewing (timerEndsAt > now)   → "Viewing…" state with shield
 *   - Expired (isExpired)                     → "Expired" state, non-interactive
 *
 * The actual media is rendered by Phase2ProtectedMediaViewer (modal); this
 * bubble is a small chat-row tile that triggers the viewer via onPress.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT_SIZE } from '@/lib/constants';

interface Phase2ProtectedMediaBubbleProps {
  isOwn: boolean;
  isProtected: boolean;
  isExpired?: boolean;
  viewedAt?: number;
  timerEndsAt?: number;
  protectedMediaTimer?: number; // seconds; 0 = view-once
  protectedMediaViewingMode?: 'tap' | 'hold';
  onOpen: () => void;
}

export function Phase2ProtectedMediaBubble({
  isOwn,
  isProtected,
  isExpired,
  viewedAt,
  timerEndsAt,
  protectedMediaTimer,
  protectedMediaViewingMode,
  onOpen,
}: Phase2ProtectedMediaBubbleProps) {
  const state = useMemo<'expired' | 'viewing' | 'locked'>(() => {
    if (isExpired) return 'expired';
    if (viewedAt && timerEndsAt && timerEndsAt > Date.now()) return 'viewing';
    return 'locked';
  }, [isExpired, viewedAt, timerEndsAt]);

  if (!isProtected) return null;

  const timerLabel =
    protectedMediaTimer && protectedMediaTimer > 0
      ? `${protectedMediaTimer}s`
      : 'View once';
  const modeLabel = protectedMediaViewingMode === 'hold' ? 'Hold' : 'Tap';

  const titleColor = isOwn ? '#FFFFFF' : COLORS.text;
  const subColor = isOwn ? 'rgba(255,255,255,0.85)' : COLORS.textMuted;
  const iconColor = isOwn ? '#FFFFFF' : COLORS.primary;

  if (state === 'expired') {
    return (
      <View
        style={[
          styles.tile,
          isOwn ? styles.tileOwn : styles.tileOther,
          styles.tileExpired,
        ]}
        accessibilityRole="image"
        accessibilityLabel="Secure media expired"
      >
        <Ionicons name="lock-closed" size={20} color={subColor} />
        <Text style={[styles.expiredText, { color: subColor }]}>Expired</Text>
      </View>
    );
  }

  if (state === 'viewing') {
    return (
      <View
        style={[styles.tile, isOwn ? styles.tileOwn : styles.tileOther]}
        accessibilityRole="image"
        accessibilityLabel="Secure media currently viewing"
      >
        <Ionicons name="shield-checkmark" size={22} color={iconColor} />
        <Text style={[styles.titleText, { color: titleColor }]}>Secure photo</Text>
        <Text style={[styles.subText, { color: subColor }]}>Viewing…</Text>
      </View>
    );
  }

  // locked
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.tile,
        isOwn ? styles.tileOwn : styles.tileOther,
        pressed && styles.tilePressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={isOwn ? 'View your secure photo' : 'Tap to view secure photo'}
    >
      <Ionicons name="shield-outline" size={22} color={iconColor} />
      <Text style={[styles.titleText, { color: titleColor }]}>Secure photo</Text>
      <Text style={[styles.subText, { color: subColor }]}>
        {isOwn ? 'Tap to preview' : `${modeLabel} to view · ${timerLabel}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 180,
    maxWidth: 260,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
  },
  tileOwn: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  tileOther: {
    backgroundColor: COLORS.backgroundDark,
    borderBottomLeftRadius: 4,
  },
  tilePressed: { opacity: 0.85 },
  tileExpired: {
    opacity: 0.7,
  },
  titleText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.text,
    marginLeft: 4,
  },
  subText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  expiredText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginLeft: 4,
  },
});
