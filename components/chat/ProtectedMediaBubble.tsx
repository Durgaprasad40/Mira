import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { log } from '@/utils/logger';

// Phase-1 tile sizing (matches MediaMessage.tsx)
const THUMB_WIDTH = 100;
const THUMB_HEIGHT = 75;
const AUTO_REMOVE_DELAY = 60_000; // 60 seconds after expiry

// Check if URI is a local content:// URI (Android gallery) which doesn't work well with blur
const isContentUri = (uri: string) => uri?.startsWith('content://');

interface ProtectedMediaBubbleProps {
  messageId: string;
  mediaId?: string;
  userId?: string;
  // Phase-1 demo mode props
  protectedMedia?: {
    localUri?: string;
    mediaType?: 'photo' | 'video';
    timer: number;
    viewingMode: 'tap' | 'hold';
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
    isMirrored?: boolean;
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

  // Live countdown state — must match Phase2ProtectedMediaViewer exactly
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRemainingSec = useRef<number | null>(null);

  // Calculate remaining time from wall-clock (same logic as viewer)
  useEffect(() => {
    if (isExpired || !timerEndsAt) {
      setRemainingSec(null);
      prevRemainingSec.current = null;
      return;
    }

    const updateRemaining = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((timerEndsAt - now) / 1000));

      // Only update state when value changes (reduces rerenders, matches viewer)
      if (remaining !== prevRemainingSec.current) {
        prevRemainingSec.current = remaining;
        setRemainingSec(remaining);
      }

      // Check if expired
      if (remaining <= 0 && onExpire) {
        log.info('[SECURE_BUBBLE]', 'timer expired', { messageId });
        onExpire();
      }
    };

    // Initial update
    updateRemaining();

    // Update every 100ms to match viewer interval exactly
    intervalRef.current = setInterval(updateRemaining, 100);

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

  // Phase-1 style: Blurred tile matching MediaMessage.tsx exactly
  const localUri = protectedMedia?.localUri;
  const isVideo = protectedMedia?.mediaType === 'video';
  const canBlur = localUri ? !isContentUri(localUri) : true;
  const isMirrored = protectedMedia?.isMirrored === true;

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        pressed && !isHoldMode && styles.pressed,
      ]}
    >
      {/* Blurred thumbnail image */}
      {localUri && (
        <Image
          source={{ uri: localUri }}
          style={[styles.thumbnail, isMirrored && styles.mirrored]}
          contentFit="cover"
          blurRadius={canBlur ? 25 : 0}
        />
      )}

      {/* Video indicator (top-right badge) */}
      {isVideo && (
        <View style={styles.videoIndicator}>
          <Ionicons name="play" size={14} color="#FFFFFF" />
        </View>
      )}

      {/* Timer badge (bottom-left) - matches viewer countdown exactly */}
      {timerLabel && (
        <View style={styles.timerBadge}>
          <Ionicons name="time-outline" size={10} color="#FFFFFF" />
          <Text style={styles.timerText}>{timerLabel}</Text>
        </View>
      )}

      {/* Hold/Tap to view hint - centered */}
      <View style={styles.hintOverlay}>
        <Text style={styles.hintText}>
          {isHoldMode ? 'Hold to view' : 'Tap to view'}
        </Text>
      </View>

      {/* Semi-transparent overlay */}
      <View style={[styles.blurOverlay, !canBlur && styles.darkOverlay]} />
    </Pressable>
  );
}

// Phase-1 styles matching MediaMessage.tsx exactly
const styles = StyleSheet.create({
  container: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1E1E2E',
  },
  pressed: {
    opacity: 0.7,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 30, 46, 0.4)',
  },
  darkOverlay: {
    backgroundColor: 'rgba(30, 30, 46, 0.7)',
  },
  videoIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
  },
  timerText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  hintOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
    textAlign: 'center',
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
