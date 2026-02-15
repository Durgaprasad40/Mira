import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { log } from '@/utils/logger';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BUBBLE_WIDTH = Math.floor(SCREEN_WIDTH * 0.28); // ~28% of screen width
const AUTO_REMOVE_DELAY = 60_000; // 60 seconds after expiry

interface ProtectedMediaBubbleProps {
  messageId: string;
  mediaId?: string;
  userId?: string;
  // Phase-1 demo mode props
  protectedMedia?: {
    timer: number;
    viewingMode: 'tap' | 'hold';
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
  };
  timerEndsAt?: number;  // Wall-clock timestamp when timer expires
  isExpired?: boolean;
  expiredAt?: number;    // Wall-clock timestamp when expired (for auto-removal)
  isOwn: boolean;
  // Handlers
  onPress?: () => void;           // Tap mode: open viewer
  onHoldStart?: () => void;       // Hold mode: press in => open viewer
  onHoldEnd?: () => void;         // Hold mode: press out => close viewer
  onExpire?: () => void;          // Called when countdown reaches 0
}

export function ProtectedMediaBubble({
  messageId,
  mediaId,
  userId,
  protectedMedia,
  timerEndsAt,
  isExpired: isExpiredProp,
  expiredAt,
  isOwn,
  onPress,
  onHoldStart,
  onHoldEnd,
  onExpire,
}: ProtectedMediaBubbleProps) {
  // Fetch media info from Convex if mediaId is provided
  const mediaInfo = useQuery(
    api.media.getMediaInfo,
    mediaId && userId ? { mediaId: mediaId as any, userId: userId as any } : 'skip'
  );

  // Use fetched data or fall back to props
  const timerSeconds = mediaInfo?.timerSeconds ?? protectedMedia?.timer ?? 0;
  const viewingMode = protectedMedia?.viewingMode ?? 'tap';
  const isHoldMode = viewingMode === 'hold';
  const viewOnce = mediaInfo?.viewOnce ?? protectedMedia?.viewOnce ?? false;
  const canScreenshot = mediaInfo?.canScreenshot ?? protectedMedia?.screenshotAllowed ?? false;
  const watermark = mediaInfo?.watermarkEnabled ?? protectedMedia?.watermark ?? false;
  const isExpired = mediaInfo?.isExpired ?? isExpiredProp ?? false;

  // Live countdown state
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Calculate remaining time from wall-clock
  useEffect(() => {
    if (isExpired || !timerEndsAt) {
      setRemainingSec(null);
      return;
    }

    const updateRemaining = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((timerEndsAt - now) / 1000));
      setRemainingSec(remaining);

      // Check if expired
      if (remaining <= 0 && onExpire) {
        log.info('[SECURE_BUBBLE]', 'timer expired', { messageId });
        onExpire();
      }
    };

    // Initial update
    updateRemaining();

    // Update every 250ms for smooth countdown
    intervalRef.current = setInterval(updateRemaining, 250);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timerEndsAt, isExpired, messageId, onExpire]);

  // Log render for debugging
  useEffect(() => {
    log.info('[SECURE_BUBBLE]', 'render', {
      messageId,
      mode: viewingMode,
      remainingSec,
      isExpired,
      expiredAt,
    });
  }, [messageId, viewingMode, remainingSec, isExpired, expiredAt]);

  // Auto-hide after 60 seconds post-expiry
  if (isExpired && expiredAt) {
    const timeSinceExpiry = Date.now() - expiredAt;
    if (timeSinceExpiry > AUTO_REMOVE_DELAY) {
      // Return null to hide the message entirely
      return null;
    }
  }

  // Expired state: compact pill
  if (isExpired) {
    return (
      <View style={styles.expiredPill}>
        <Ionicons name="lock-closed" size={14} color={COLORS.textMuted} />
        <Text style={styles.expiredText}>Expired</Text>
      </View>
    );
  }

  // Determine timer display
  const hasActiveTimer = remainingSec !== null && remainingSec > 0;
  const timerLabel = hasActiveTimer
    ? `${remainingSec}s`
    : timerSeconds > 0
    ? `${timerSeconds}s`
    : null;

  // Handle press events based on mode
  const handlePressIn = () => {
    if (isHoldMode && onHoldStart) {
      log.info('[SECURE_HOLD]', 'pressIn', { messageId });
      onHoldStart();
    }
  };

  const handlePressOut = () => {
    if (isHoldMode && onHoldEnd) {
      log.info('[SECURE_HOLD]', 'pressOut', { messageId });
      onHoldEnd();
    }
  };

  const handlePress = () => {
    if (!isHoldMode && onPress) {
      onPress();
    }
  };

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.pressable,
        pressed && !isHoldMode && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={['#2C2C3A', '#1E1E2E']}
        style={styles.container}
      >
        {/* Icon */}
        <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />

        {/* Timer badge (live countdown or initial) */}
        {timerLabel && (
          <View style={[styles.timerBadge, hasActiveTimer && styles.timerActive]}>
            <Ionicons name="timer-outline" size={10} color={COLORS.white} />
            <Text style={styles.timerText}>{timerLabel}</Text>
          </View>
        )}

        {/* Once badge */}
        {viewOnce && !timerLabel && (
          <View style={styles.onceBadge}>
            <Text style={styles.onceText}>1x</Text>
          </View>
        )}

        {/* Hint */}
        <Text style={styles.hint}>
          {isHoldMode ? 'Hold' : 'Tap'}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
  container: {
    width: BUBBLE_WIDTH,
    height: BUBBLE_WIDTH, // Square aspect ratio
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  timerActive: {
    backgroundColor: COLORS.primary,
  },
  timerText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  onceBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  onceText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },
  hint: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  expiredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  expiredText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
});
