import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, PanResponder, GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { Video, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { log } from '@/utils/logger';
import { calculateProtectedMediaCountdown } from '@/utils/protectedMediaCountdown';

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
  // SENDER-TIMER-FIX: New props for sender status display
  viewOnce?: boolean;         // Whether this is view-once media
  recipientOpened?: boolean;  // Whether recipient has opened the media
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
  viewOnce: viewOnceProp,
  recipientOpened: recipientOpenedProp,
  onPress,
  onHoldStart,
  onHoldEnd,
  onExpire,
}: ProtectedMediaBubbleProps) {
  // ============================================================================
  // HOOKS-FIX: ALL hooks must be declared at the top, BEFORE any early returns
  // This ensures hooks are called in the same order on every render
  // ============================================================================

  // Fetch media info from Convex if mediaId is provided
  const mediaInfo = useQuery(
    api.media.getMediaInfo,
    mediaId && userId ? { mediaId: mediaId as any, userId: userId as any } : 'skip'
  );

  // PREFETCH-FIX: Fetch media URL for prefetching (only if not expired and mediaId exists)
  // Note: We use isExpiredProp here since isExpired derived value isn't available yet
  const mediaUrlData = useQuery(
    api.protectedMedia.getMediaUrl,
    mediaId && userId && !isExpiredProp
      ? { messageId: messageId as any, userId: userId as any }
      : 'skip'
  );

  // PREFETCH-FIX-V2: Refs for prefetching
  const hasPrefetchedRef = useRef(false);
  const videoPrefetchRef = useRef<Video | null>(null);
  const prefetchStartTimeRef = useRef<number>(0);

  // P1-FIX: Lock the first valid timer value to prevent jump when query hydrates
  const lockedTimerSecondsRef = useRef<number | null>(null);

  // Live countdown state
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [timerLabel, setTimerLabel] = useState<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRemainingSec = useRef<number | null>(null);

  // AUTO-HIDE: State to hide expired messages after 60s
  const [isAutoHidden, setIsAutoHidden] = useState(false);
  const autoHideTimerStartedRef = useRef(false);

  // HOLD-FIX-V2: Refs for PanResponder (must be before useMemo)
  const holdActiveRef = useRef(false);
  const touchStartTimeRef = useRef(0);

  // Use fetched data or fall back to props (derived values, not hooks)
  // P1-FIX: Lock first valid timer value to prevent visual jump when query hydrates
  const rawTimerSeconds = mediaInfo?.timerSeconds ?? protectedMedia?.timer ?? 0;
  if (lockedTimerSecondsRef.current === null && rawTimerSeconds > 0) {
    lockedTimerSecondsRef.current = rawTimerSeconds;
  }
  const timerSeconds = lockedTimerSecondsRef.current ?? rawTimerSeconds;
  const viewingMode = protectedMedia?.viewingMode ?? mediaInfo?.viewMode ?? 'tap';
  const isHoldMode = viewingMode === 'hold';
  const viewOnce = mediaInfo?.viewOnce ?? protectedMedia?.viewOnce ?? false;
  const canScreenshot = mediaInfo?.canScreenshot ?? protectedMedia?.screenshotAllowed ?? false;
  const watermark = mediaInfo?.watermarkEnabled ?? protectedMedia?.watermark ?? false;
  const isExpired = mediaInfo?.isExpired ?? isExpiredProp ?? false;

  // PanResponder for hold mode - must be declared before any early returns
  // TOUCH-FIX: Enhanced logging for debugging touch interactions
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => {
      log.info('[TOUCH_DEBUG]', 'onStartShouldSetPanResponder', { messageId, isOwn, isHoldMode });
      return true;
    },
    onMoveShouldSetPanResponder: () => false,
    onPanResponderTerminationRequest: () => false,

    onPanResponderGrant: (_evt: GestureResponderEvent) => {
      touchStartTimeRef.current = Date.now();
      log.info('[TOUCH_DEBUG]', 'onPanResponderGrant', {
        messageId,
        isOwn,
        isHoldMode,
        hasOnPress: !!onPress,
        hasOnHoldStart: !!onHoldStart,
      });

      if (isHoldMode && onHoldStart) {
        holdActiveRef.current = true;
        log.info('[SECURE_HOLD]', 'grant (hold start)', { messageId });
        onHoldStart();
      }
    },

    onPanResponderMove: () => {
      // HOLD-FIX-V2: Do nothing on move - hold stays active
    },

    onPanResponderRelease: () => {
      const touchDuration = Date.now() - touchStartTimeRef.current;
      log.info('[TOUCH_DEBUG]', 'onPanResponderRelease', {
        messageId,
        touchDuration,
        isHoldMode,
        holdActive: holdActiveRef.current,
      });

      if (isHoldMode && holdActiveRef.current && onHoldEnd) {
        holdActiveRef.current = false;
        log.info('[SECURE_HOLD]', 'release (hold end)', { messageId, touchDuration });
        onHoldEnd();
      } else if (!isHoldMode && onPress && touchDuration < 300) {
        log.info('[SECURE_TAP]', 'tap detected, calling onPress', { messageId, touchDuration });
        onPress();
      } else {
        log.info('[TOUCH_DEBUG]', 'release - no action', {
          messageId,
          touchDuration,
          isHoldMode,
          hasOnPress: !!onPress,
          reason: touchDuration >= 300 ? 'touchDuration >= 300ms' : 'no handler',
        });
      }
    },

    onPanResponderTerminate: () => {
      log.info('[TOUCH_DEBUG]', 'onPanResponderTerminate', { messageId });
      if (isHoldMode && holdActiveRef.current && onHoldEnd) {
        holdActiveRef.current = false;
        log.info('[SECURE_HOLD]', 'terminated', { messageId });
        onHoldEnd();
      }
    },
  }), [isHoldMode, onHoldStart, onHoldEnd, onPress, messageId, isOwn]);

  // VIDEO-PREFETCH: Callback when video is preloaded
  const handleVideoPrefetchLoad = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      const prefetchTime = Date.now() - prefetchStartTimeRef.current;
      log.info('[SECURE_BUBBLE]', 'video prefetch complete', { messageId, prefetchTime });
    }
  }, [messageId]);

  // PREFETCH-FIX-V3: Prefetch from BOTH Convex URL and local URI
  // This ensures instant open in both demo mode (local URI) and Convex mode (remote URL)
  useEffect(() => {
    if (hasPrefetchedRef.current || isExpired) return;

    // Determine the URI to prefetch - prioritize Convex URL, fall back to local URI
    const urlToFetch = mediaUrlData?.url || protectedMedia?.localUri;
    const isVideoMedia = mediaUrlData?.mediaType === 'video' || protectedMedia?.mediaType === 'video';

    if (!urlToFetch) {
      log.info('[SECURE_PREFETCH]', 'no URL available yet', { messageId, hasMediaUrlData: !!mediaUrlData, hasLocalUri: !!protectedMedia?.localUri });
      return;
    }

    hasPrefetchedRef.current = true;
    prefetchStartTimeRef.current = Date.now();

    if (isVideoMedia) {
      // For videos, we log but actual prefetch happens via hidden Video component
      log.info('[SECURE_PREFETCH]', 'video prefetch queued', {
        messageId,
        source: mediaUrlData?.url ? 'convex' : 'local',
        url: urlToFetch.substring(0, 50),
      });
    } else {
      // For photos, use Image.prefetch for instant load
      Image.prefetch(urlToFetch)
        .then(() => {
          const prefetchTime = Date.now() - prefetchStartTimeRef.current;
          log.info('[SECURE_PREFETCH]', 'image prefetch complete', { messageId, prefetchTime });
        })
        .catch((err) => {
          log.info('[SECURE_PREFETCH]', 'image prefetch failed', { messageId, error: err?.message });
        });
      log.info('[SECURE_PREFETCH]', 'image prefetch started', {
        messageId,
        source: mediaUrlData?.url ? 'convex' : 'local',
      });
    }
  }, [mediaUrlData?.url, mediaUrlData?.mediaType, protectedMedia?.localUri, protectedMedia?.mediaType, isExpired, messageId]);

  // Calculate remaining time from wall-clock using shared countdown helper
  useEffect(() => {
    if (isExpired || !timerEndsAt) {
      setRemainingSec(null);
      setTimerLabel('');
      prevRemainingSec.current = null;
      return;
    }

    const updateRemaining = () => {
      const countdown = calculateProtectedMediaCountdown(timerEndsAt);

      if (countdown.remainingSeconds !== prevRemainingSec.current) {
        prevRemainingSec.current = countdown.remainingSeconds;
        setRemainingSec(countdown.remainingSeconds);
        setTimerLabel(countdown.label);
      }

      if (countdown.expired && onExpire) {
        log.info('[SECURE_BUBBLE]', 'timer expired', { messageId });
        onExpire();
      }
    };

    updateRemaining();
    intervalRef.current = setInterval(updateRemaining, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [timerEndsAt, isExpired, messageId, onExpire]);

  // Log render for debugging (production logging only)
  useEffect(() => {
    log.info('[SECURE_BUBBLE]', 'render', {
      messageId,
      mode: viewingMode,
      remainingSec,
      isExpired,
      expiredAt,
      isOwn,
    });
  }, [messageId, viewingMode, remainingSec, isExpired, expiredAt, isOwn]);

  // AUTO-HIDE: Start 60-second timer when message expires to auto-remove from UI
  useEffect(() => {
    // Only start timer once when expired
    if (!isExpired || autoHideTimerStartedRef.current) {
      return;
    }

    autoHideTimerStartedRef.current = true;

    // Calculate remaining time until auto-hide
    // If expiredAt is provided, account for time already passed
    const alreadyExpiredFor = expiredAt ? Date.now() - expiredAt : 0;
    const remainingDelay = Math.max(0, AUTO_REMOVE_DELAY - alreadyExpiredFor);

    // If already past 60s, hide immediately
    if (remainingDelay === 0) {
      log.info('[SECURE_BUBBLE]', 'auto-hide immediate', { messageId, alreadyExpiredFor });
      setIsAutoHidden(true);
      return;
    }

    log.info('[SECURE_BUBBLE]', 'auto-hide timer started', { messageId, remainingDelay });

    const timer = setTimeout(() => {
      log.info('[SECURE_BUBBLE]', 'auto-hide triggered', { messageId });
      setIsAutoHidden(true);
    }, remainingDelay);

    return () => {
      clearTimeout(timer);
    };
  }, [isExpired, expiredAt, messageId]);

  // ============================================================================
  // END OF HOOKS - Early returns are safe below this point
  // ============================================================================

  // Determine if we should show hidden video prefetcher
  const shouldPrefetchVideo = mediaUrlData?.url &&
    mediaUrlData?.mediaType === 'video' &&
    hasPrefetchedRef.current &&
    !isExpired;

  // Determine timer display using shared countdown formatting
  const hasActiveTimer = remainingSec !== null && remainingSec > 0;
  const displayTimerLabel = hasActiveTimer ? timerLabel : null;

  // TIMER-PREVIEW-FIX: Show configured timer BEFORE opening for receiver
  // Format: 30 → "30s", 60 → "1m"
  const formatTimerPreview = (seconds: number): string => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60);
      return `${mins}m`;
    }
    return `${seconds}s`;
  };
  // Show preview when timer is configured but not yet started (receiver hasn't opened)
  const showTimerPreview = !isOwn && timerSeconds > 0 && !timerEndsAt && !hasActiveTimer;

  // SENDER-TIMER-FIX: Improved sender status display
  // Show for sender when:
  // 1. Recipient has opened (recipientOpenedProp) AND timer is active, OR
  // 2. View-once was opened (recipientOpenedProp but no timer)
  const isViewOnceMedia = viewOnceProp ?? viewOnce;
  const recipientHasOpened = recipientOpenedProp ?? false;

  // Sender sees timer countdown if recipient opened timed media
  const showSenderTimer = isOwn && hasActiveTimer && recipientHasOpened;
  // Sender sees "Opened" indicator for view-once (no timer, but opened)
  const showSenderViewOnceOpened = isOwn && isViewOnceMedia && recipientHasOpened && !hasActiveTimer;

  // AUTO-HIDE: Return null when auto-hide timer has fired (60s after expiry)
  if (isAutoHidden) {
    return null;
  }

  // Expired state: compact pill (shows for up to 60s after expiry)
  if (isExpired) {
    return (
      <View style={styles.expiredPill}>
        <Ionicons name="lock-closed" size={14} color={COLORS.textMuted} />
        <Text style={styles.expiredText}>Expired</Text>
      </View>
    );
  }

  // Phase-1 style: Blurred tile matching MediaMessage.tsx exactly
  const localUri = protectedMedia?.localUri;
  const isVideo = protectedMedia?.mediaType === 'video';
  const canBlur = localUri ? !isContentUri(localUri) : true;
  const isMirrored = protectedMedia?.isMirrored === true;

  // DEBUG: Log media type to trace video detection issues
  log.info('[PROTECTED_BUBBLE]', 'render', {
    messageId,
    isOwn,
    mediaType: protectedMedia?.mediaType,
    isVideo,
    hasLocalUri: !!localUri,
    hasProtectedMedia: !!protectedMedia,
  });

  // SENDER-UI-FIX: Completely separate render paths for sender vs receiver
  // This ensures no overlay leakage between paths

  // ═══════════════════════════════════════════════════════════════════════════
  // SENDER PATH: Clear thumbnail with type indicator and shield badge
  // ═══════════════════════════════════════════════════════════════════════════
  if (isOwn === true) {
    const senderBubble = (
      <View style={styles.container}>
        {/* Clear thumbnail (no blur) */}
        {localUri && (
          <Image
            source={{ uri: localUri }}
            style={[styles.thumbnail, isMirrored && styles.mirrored]}
            contentFit="cover"
          />
        )}

        {/* Media type indicator (top-left) */}
        <View style={styles.senderTypeIndicator}>
          <Ionicons
            name={isVideo ? 'videocam' : 'image'}
            size={12}
            color="#FFFFFF"
          />
        </View>

        {/* Shield badge (bottom-right) */}
        <View style={styles.senderShieldBadge}>
          <Ionicons name="shield-checkmark" size={10} color="#FFFFFF" />
        </View>
      </View>
    );

    // Wrap with sender status if applicable
    if (showSenderTimer) {
      return (
        <View style={styles.senderWrapper}>
          {senderBubble}
          <View style={styles.senderTimerBadge}>
            <Ionicons name="eye" size={10} color={COLORS.primary} />
            <Text style={styles.senderTimerText}>Viewing • {timerLabel}</Text>
          </View>
        </View>
      );
    }

    if (showSenderViewOnceOpened) {
      return (
        <View style={styles.senderWrapper}>
          {senderBubble}
          <View style={styles.senderOpenedBadge}>
            <Ionicons name="eye" size={10} color={COLORS.success} />
            <Text style={styles.senderOpenedText}>Opened</Text>
          </View>
        </View>
      );
    }

    return senderBubble;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECEIVER PATH: Blurred thumbnail with "Tap/Hold to view" hint
  // TOUCH-FIX: All overlay Views must have pointerEvents="none" to allow
  // touch events to pass through to the parent container with PanResponder
  // ═══════════════════════════════════════════════════════════════════════════
  const receiverBubble = (
    <View
      {...panResponder.panHandlers}
      style={styles.container}
    >
      {/* Blurred thumbnail */}
      {localUri && (
        <Image
          source={{ uri: localUri }}
          style={[styles.thumbnail, isMirrored && styles.mirrored]}
          contentFit="cover"
          blurRadius={canBlur ? 25 : 0}
        />
      )}

      {/* Semi-transparent overlay - MUST be first overlay for blur effect */}
      <View
        style={[styles.blurOverlay, !canBlur && styles.darkOverlay]}
        pointerEvents="none"
      />

      {/* Media type indicator (top-left) - shows photo or video icon */}
      <View style={styles.receiverTypeIndicator} pointerEvents="none">
        <Ionicons
          name={isVideo ? 'videocam' : 'image'}
          size={12}
          color="#FFFFFF"
        />
      </View>

      {/* Timer preview badge (top-right) - shows BEFORE opening */}
      {showTimerPreview && (
        <View style={styles.timerPreviewBadge} pointerEvents="none">
          <Ionicons name="time-outline" size={10} color="#FFFFFF" />
          <Text style={styles.timerPreviewText}>{formatTimerPreview(timerSeconds)}</Text>
        </View>
      )}

      {/* Live countdown timer badge (bottom-left) - shows DURING viewing */}
      {displayTimerLabel && (
        <View style={styles.timerBadge} pointerEvents="none">
          <Ionicons name="time-outline" size={10} color="#FFFFFF" />
          <Text style={styles.timerText}>{displayTimerLabel}</Text>
        </View>
      )}

      {/* Tap/Hold to view hint */}
      <View style={styles.hintOverlay} pointerEvents="none">
        <Text style={styles.hintText}>
          {isHoldMode ? 'Hold to view' : 'Tap to view'}
        </Text>
      </View>

      {/* VIDEO-PREFETCH: Hidden video for preloading */}
      {shouldPrefetchVideo && (
        <Video
          ref={videoPrefetchRef}
          source={{ uri: mediaUrlData!.url }}
          style={styles.hiddenPrefetch}
          shouldPlay={false}
          isMuted={true}
          onLoad={handleVideoPrefetchLoad}
        />
      )}
    </View>
  );

  return receiverBubble;
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
  // SENDER-UI-FIX: Media type indicator for sender (top-left)
  senderTypeIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // RECEIVER-UI-FIX: Media type indicator for receiver (top-left)
  receiverTypeIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10, // Above blur overlay
  },
  // TIMER-PREVIEW-FIX: Timer preview badge for receiver (top-right) - shows BEFORE opening
  timerPreviewBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(155, 125, 196, 0.8)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    zIndex: 10, // Above blur overlay
  },
  timerPreviewText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  // SENDER-UI-FIX: Shield badge for sender (bottom-right)
  senderShieldBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(155, 125, 196, 0.8)',
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
    zIndex: 5, // Above blur overlay but below badges
  },
  hintText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
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
  // VIDEO-PREFETCH: Hidden element for preloading video
  hiddenPrefetch: {
    width: 1,
    height: 1,
    position: 'absolute',
    opacity: 0,
  },
  // SENDER-TIMER: Wrapper for bubble + external timer
  senderWrapper: {
    alignItems: 'flex-end',
  },
  // SENDER-TIMER: External timer badge below bubble
  senderTimerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(155, 125, 196, 0.15)',
    borderRadius: 10,
  },
  senderTimerText: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '600',
  },
  // SENDER-TIMER-FIX: "Opened" badge for view-once media
  senderOpenedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderRadius: 10,
  },
  senderOpenedText: {
    fontSize: 10,
    color: COLORS.success,
    fontWeight: '600',
  },
});
