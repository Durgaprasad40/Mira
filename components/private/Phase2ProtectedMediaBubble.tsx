/**
 * Phase-2 Protected Media Bubble (pure-visual)
 *
 * STRICT ISOLATION:
 *   - No Convex queries / mutations.
 *   - No Phase-1 backend (`api.media.*`, `api.protectedMedia.*`).
 *   - All state is delivered by the parent via props (which sources Phase-2
 *     fields from `api.privateConversations.getPrivateMessages`).
 *
 * Rendering rules:
 *   - Not yet viewed (no viewedAt)            → locked / "Tap to view" state
 *   - Currently viewing (timerEndsAt > now)   → "Viewing…" state with shield
 *   - Expired (isExpired)                     → "Expired" state, non-interactive
 *
 * VISUAL PARITY (border + size polish):
 *   The placeholder card matches normal Phase-2 media in `MediaMessage`
 *   legacy mode — 220×165 with borderRadius 16 — so once-view / 30s / 60s
 *   bubbles share the SAME outer card footprint as normal photo/video. A
 *   visible 2px accent border (rose for own, light slate for received)
 *   replaces the previous near-invisible hairline so the secure frame is
 *   obvious against the dark chat background. All three states (locked,
 *   viewing, expired) use identical dimensions.
 *
 * The actual media is rendered by Phase2ProtectedMediaViewer (modal); this
 * bubble is a chat-row tile that triggers the viewer via onPress.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

// Phase-2 compact media card: ~50% W × 50% H of the previous 220×165 size,
// so total area is ~1/4. Matches the Phase-2 normal-media card rendered
// inline by `app/(main)/(private)/(tabs)/chats/[id].tsx`. Equal for ALL
// secure states (locked / viewing / expired).
const CARD_WIDTH = 110;
const CARD_HEIGHT = 82;
const CARD_RADIUS = 10;

// Border visible against the dark Phase-2 chat background (#1A1A2E).
const BORDER_WIDTH = 2;
// Inner fill — distinctly lighter than chat bg so the rounded card stands out
// even before the colored border draws attention.
const CARD_FILL = '#22223A';

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
    typeof protectedMediaTimer === 'number' && protectedMediaTimer > 0
      ? `${protectedMediaTimer}s`
      : 'Once';
  const modeLabel = protectedMediaViewingMode === 'hold' ? 'Hold' : 'Tap';

  // Frame styling shared by all states so the OUTER card looks identical
  // (size + border + radius) regardless of locked / viewing / expired.
  const frameStyle = [
    styles.card,
    isOwn ? styles.cardOwn : styles.cardOther,
  ];

  // EXPIRED — same frame, dimmed inner.
  if (state === 'expired') {
    return (
      <View
        style={[...frameStyle, styles.cardExpired]}
        accessibilityRole="image"
        accessibilityLabel="Secure media expired"
      >
        <Ionicons name="lock-closed" size={18} color="rgba(255,255,255,0.55)" />
        <Text style={styles.expiredText}>Expired</Text>
        <View style={styles.timerBadge}>
          <Text style={styles.timerBadgeText}>{timerLabel}</Text>
        </View>
      </View>
    );
  }

  // VIEWING — same frame, animated shield + countdown badge.
  if (state === 'viewing') {
    return (
      <View
        style={frameStyle}
        accessibilityRole="image"
        accessibilityLabel="Secure media currently viewing"
      >
        <Ionicons name="shield-checkmark" size={20} color={C.primary} />
        <Text style={styles.titleText}>Viewing…</Text>
        <View style={styles.timerBadge}>
          <Text style={styles.timerBadgeText}>{timerLabel}</Text>
        </View>
      </View>
    );
  }

  // LOCKED — Tap to view (or "Tap to preview" for sender).
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [...frameStyle, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={
        isOwn ? 'Preview your secure photo' : 'Tap to view secure photo'
      }
    >
      <Ionicons name="shield-outline" size={20} color={C.primary} />
      <Text style={styles.titleText}>
        {isOwn ? 'Tap to preview' : `${modeLabel} to view`}
      </Text>
      <View style={styles.timerBadge}>
        <Text style={styles.timerBadgeText}>{timerLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: CARD_RADIUS,
    backgroundColor: CARD_FILL,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BORDER_WIDTH,
    overflow: 'hidden',
  },
  // Visible accent matching MessageBubble own/other framing aesthetic:
  //   own  → rose primary (mirrors Phase-1 ownBubble #E94E77 / Phase-2 #E94560)
  //   other→ light slate (clearly visible against dark chat bg)
  cardOwn: {
    borderColor: C.primary,
    borderBottomRightRadius: 4,
  },
  cardOther: {
    borderColor: '#4A5568',
    borderBottomLeftRadius: 4,
  },
  cardExpired: {
    opacity: 0.65,
  },
  cardPressed: { opacity: 0.88 },
  titleText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 4,
    textAlign: 'center',
  },
  expiredText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.65)',
    fontStyle: 'italic',
    marginTop: 4,
  },
  timerBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  timerBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
