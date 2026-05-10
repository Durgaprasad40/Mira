import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, PanResponder, GestureResponderEvent, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Video, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { CHAT_TYPOGRAPHY } from '@/lib/chatTypography';
import { log } from '@/utils/logger';
import { calculateProtectedMediaCountdown } from '@/utils/protectedMediaCountdown';
import { useAuthStore } from '@/stores/authStore';
import type { Id } from '@/convex/_generated/dataModel';

// Phase-1 tile sizing (matches MediaMessage.tsx)
const THUMB_WIDTH = 100;
const THUMB_HEIGHT = 75;
const AUTO_REMOVE_DELAY = 60_000; // 60 seconds after expiry

// Check if URI is a local content:// URI (Android gallery) which doesn't work well with blur
const isContentUri = (uri: string) => uri?.startsWith('content://');

function getSafeIdTail(value?: string | null): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(-6) : undefined;
}

const asMediaId = (value: string): Id<'media'> => value as Id<'media'>;
const asMessageId = (value: string): Id<'messages'> => value as Id<'messages'>;
const asUserId = (value: string): Id<'users'> => value as Id<'users'>;

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
  // [P1_MEDIA_FIX] Backend validators require `userId` (media.getMediaInfo)
  // and `authUserId` (protectedMedia.getMediaUrl). They do NOT accept a
  // `token` field — passing it triggers ArgumentValidationError and crashes
  // the chat. Read the authenticated user ID from the auth store and use
  // the prop form only if nothing is available from the store.
  const authUserId = useAuthStore((s) => s.userId) ?? userId ?? null;
  const messageRef = getSafeIdTail(messageId);

  // ============================================================================
  // HOOKS-FIX: ALL hooks must be declared at the top, BEFORE any early returns
  // This ensures hooks are called in the same order on every render
  // ============================================================================

  // Fetch media info from Convex if mediaId is provided
  const mediaInfo = useQuery(
    api.media.getMediaInfo,
    mediaId && authUserId ? { mediaId: asMediaId(mediaId), userId: asUserId(authUserId) } : 'skip'
  );

  // LOAD-FIRST: Receivers must explicitly tap to load before any URL fetch or
  // prefetch. Senders bypass the gate (they already have local state from
  // upload). Tapping the load arrow flips this flag — it does NOT call
  // onPress/onHoldStart, so no view is registered yet.
  const [loadRequested, setLoadRequested] = useState(false);
  const isReceiver = !isOwn;
  const gateOpen = loadRequested || !isReceiver;

  // PREFETCH-FIX: Fetch media URL for prefetching (only if not expired and mediaId exists)
  // Note: We use isExpiredProp here since isExpired derived value isn't available yet
  // LOAD-FIRST: Skip the URL query for receivers until they tap the load arrow.
  const mediaUrlData = useQuery(
    api.protectedMedia.getMediaUrl,
    mediaId && authUserId && !isExpiredProp && gateOpen
      ? { messageId: asMessageId(messageId), authUserId }
      : 'skip'
  );

  // PREFETCH-FIX-V2: Refs for prefetching
  const hasPrefetchedRef = useRef(false);
  const prefetchStartTimeRef = useRef<number>(0);

  // P1-FIX: Lock the first valid timer value to prevent jump when query hydrates
  const [lockedTimerSeconds, setLockedTimerSeconds] = useState<number | null>(null);

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
  useEffect(() => {
    if (lockedTimerSeconds === null && rawTimerSeconds > 0) {
      setLockedTimerSeconds(rawTimerSeconds);
    }
  }, [lockedTimerSeconds, rawTimerSeconds]);
  const timerSeconds = lockedTimerSeconds ?? rawTimerSeconds;
  const viewingMode = protectedMedia?.viewingMode ?? mediaInfo?.viewMode ?? 'tap';
  const isHoldMode = viewingMode === 'hold';
  const viewOnce = mediaInfo?.viewOnce ?? protectedMedia?.viewOnce ?? false;
  const canScreenshot = mediaInfo?.canScreenshot ?? protectedMedia?.screenshotAllowed ?? false;
  const watermark = mediaInfo?.watermarkEnabled ?? protectedMedia?.watermark ?? false;
  const isExpired = mediaInfo?.isExpired ?? isExpiredProp ?? false;

  // PanResponder for hold mode - must be declared before any early returns
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderTerminationRequest: () => false,

    onPanResponderGrant: (_evt: GestureResponderEvent) => {
      touchStartTimeRef.current = Date.now();
      if (isHoldMode && onHoldStart) {
        holdActiveRef.current = true;
        if (__DEV__) log.info('[SECURE_HOLD]', 'grant (hold start)', { messageRef });
        onHoldStart();
      }
    },

    onPanResponderMove: () => {
      // HOLD-FIX-V2: Do nothing on move - hold stays active
    },

    onPanResponderRelease: () => {
      const touchDuration = Date.now() - touchStartTimeRef.current;

      if (isHoldMode && holdActiveRef.current && onHoldEnd) {
        holdActiveRef.current = false;
        if (__DEV__) log.info('[SECURE_HOLD]', 'release (hold end)', { messageRef, touchDuration });
        onHoldEnd();
      } else if (!isHoldMode && onPress && touchDuration < 300) {
        if (__DEV__) log.info('[SECURE_TAP]', 'tap', { messageRef, touchDuration });
        onPress();
      }
    },

    onPanResponderTerminate: () => {
      if (isHoldMode && holdActiveRef.current && onHoldEnd) {
        holdActiveRef.current = false;
        if (__DEV__) log.info('[SECURE_HOLD]', 'terminated', { messageRef });
        onHoldEnd();
      }
    },
  }), [isHoldMode, onHoldStart, onHoldEnd, onPress, messageRef]);

  // VIDEO-PREFETCH: Callback when video is preloaded
  const handleVideoPrefetchLoad = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      const prefetchTime = Date.now() - prefetchStartTimeRef.current;
      if (__DEV__) log.info('[SECURE_BUBBLE]', 'video prefetch complete', { messageRef, prefetchTime });
    }
  }, [messageRef]);

  // Prefetch effect
  useEffect(() => {
    if (mediaUrlData?.url && !hasPrefetchedRef.current && !isExpired) {
      hasPrefetchedRef.current = true;
      prefetchStartTimeRef.current = Date.now();

      const isVideoMedia = mediaUrlData?.mediaType === 'video';

      if (isVideoMedia) {
        if (__DEV__) log.info('[SECURE_BUBBLE]', 'video prefetch started', { messageRef });
      } else {
        Image.prefetch(mediaUrlData.url).catch(() => {});
        if (__DEV__) log.info('[SECURE_BUBBLE]', 'image prefetch started', { messageRef });
      }
    }
  }, [mediaUrlData?.url, mediaUrlData?.mediaType, isExpired, messageRef]);

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
        if (__DEV__) log.info('[SECURE_BUBBLE]', 'timer expired', { messageRef });
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
  }, [timerEndsAt, isExpired, messageRef, onExpire]);

  // Log render for debugging
  useEffect(() => {
    if (!__DEV__) return;
    log.info('[SECURE_BUBBLE]', 'render', {
      messageRef,
      mode: viewingMode,
      remainingSec,
      isExpired,
      hasExpiredAt: typeof expiredAt === 'number',
      isOwn,
    });
  }, [messageRef, viewingMode, remainingSec, isExpired, expiredAt, isOwn]);

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
      if (__DEV__) log.info('[SECURE_BUBBLE]', 'auto-hide immediate', { messageRef, alreadyExpiredFor });
      setIsAutoHidden(true);
      return;
    }

    if (__DEV__) log.info('[SECURE_BUBBLE]', 'auto-hide timer started', { messageRef, remainingDelay });

    const timer = setTimeout(() => {
      if (__DEV__) log.info('[SECURE_BUBBLE]', 'auto-hide triggered', { messageRef });
      setIsAutoHidden(true);
    }, remainingDelay);

    return () => {
      clearTimeout(timer);
    };
  }, [isExpired, expiredAt, messageRef]);

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
        <Text
          maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
          style={styles.expiredText}
        >Expired</Text>
      </View>
    );
  }

  // LOAD-FIRST: Receiver placeholder — show download arrow until tap.
  // Tapping ONLY flips loadRequested; it does NOT call onPress/onHoldStart,
  // so no view is registered until the user explicitly opens the viewer.
  if (isReceiver && !loadRequested) {
    return (
      <Pressable onPress={() => setLoadRequested(true)} style={styles.container}>
        <View style={styles.placeholderInner}>
          <Ionicons name="arrow-down-circle" size={26} color="#FFFFFF" />
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.mediaCaption.maxFontSizeMultiplier}
            style={styles.placeholderText}
          >Tap to load</Text>
        </View>
      </Pressable>
    );
  }

  // LOAD-FIRST: Receiver loading state — once tapped, show spinner until the
  // Convex URL query hydrates and the prefetch begins.
  if (isReceiver && !mediaUrlData) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderInner}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.mediaCaption.maxFontSizeMultiplier}
            style={styles.placeholderText}
          >Loading…</Text>
        </View>
      </View>
    );
  }

  // Phase-1 style: Blurred tile matching MediaMessage.tsx exactly
  const localUri = protectedMedia?.localUri;
  const isVideo = protectedMedia?.mediaType === 'video';
  const canBlur = localUri ? !isContentUri(localUri) : true;
  const isMirrored = protectedMedia?.isMirrored === true;

  // Main bubble content
  const bubbleContent = (
    <View
      {...panResponder.panHandlers}
      style={styles.container}
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

      {/* Timer badge (bottom-left) - for RECEIVER only, matches viewer countdown */}
      {displayTimerLabel && !isOwn && (
        <View style={styles.timerBadge}>
          <Ionicons name="time-outline" size={10} color="#FFFFFF" />
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
            style={styles.timerText}
          >{displayTimerLabel}</Text>
        </View>
      )}

      {/* Hold/Tap to view hint - centered */}
      <View style={styles.hintOverlay}>
        <Text
          maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
          style={styles.hintText}
        >
          {isHoldMode ? 'Hold to view' : 'Tap to view'}
        </Text>
      </View>

      {/* Semi-transparent overlay */}
      <View style={[styles.blurOverlay, !canBlur && styles.darkOverlay]} />

      {/* VIDEO-PREFETCH: Hidden video for preloading */}
      {shouldPrefetchVideo && (
        <Video
          source={{ uri: mediaUrlData!.url }}
          style={styles.hiddenPrefetch}
          shouldPlay={false}
          isMuted={true}
          onLoad={handleVideoPrefetchLoad}
        />
      )}
    </View>
  );

  // SENDER-TIMER-FIX: Wrap with status indicator for sender
  if (showSenderTimer) {
    return (
      <View style={styles.senderWrapper}>
        {bubbleContent}
        {/* Timer countdown badge for sender */}
        <View style={styles.senderTimerBadge}>
          <Ionicons name="eye" size={10} color={COLORS.primary} />
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
            style={styles.senderTimerText}
          >Viewing • {timerLabel}</Text>
        </View>
      </View>
    );
  }

  // SENDER-TIMER-FIX: Show "Opened" for view-once media that was opened
  if (showSenderViewOnceOpened) {
    return (
      <View style={styles.senderWrapper}>
        {bubbleContent}
        <View style={styles.senderOpenedBadge}>
          <Ionicons name="eye" size={10} color={COLORS.success} />
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
            style={styles.senderOpenedText}
          >Opened</Text>
        </View>
      </View>
    );
  }

  return bubbleContent;
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
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  hintOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
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
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
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
  // LOAD-FIRST: Download-arrow / loading placeholder
  placeholderInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    gap: 4,
  },
  placeholderText: {
    color: '#FFFFFF',
    fontSize: CHAT_TYPOGRAPHY.mediaCaption.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.mediaCaption.lineHeight,
    fontWeight: '600',
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
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
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
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
    color: COLORS.success,
    fontWeight: '600',
  },
});
