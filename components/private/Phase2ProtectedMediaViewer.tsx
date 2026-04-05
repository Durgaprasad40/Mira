/**
 * Phase-2 protected media viewer.
 * Based on DemoProtectedMediaViewer but uses usePrivateChatStore.
 *
 * Timer logic:
 * - Subscribes to LIVE message from Zustand store (not stale prop)
 * - timerEndsAt is set in store ONCE on first open via markSecurePhotoViewed
 * - Timer persists across close/reopen - remaining time continues from stored timerEndsAt
 * - Interval reads timerEndsAt via ref to avoid stale closure issues
 *
 * Hold mode (Telegram-style):
 * - Bubble handles press-and-hold to open/close viewer
 * - Viewer just displays; closing is controlled by parent via visible prop
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Platform,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useAuthStore } from '@/stores/authStore';
import { calculateProtectedMediaCountdown } from '@/utils/protectedMediaCountdown';
import { useScreenProtection } from '@/hooks/useScreenProtection';
import { useScreenshotDetection } from '@/hooks/useScreenshotDetection';

// PHASE-1 PARITY FIX: Message data passed from parent for backend messages
interface MessageData {
  id: string;
  isProtected?: boolean;
  isExpired?: boolean;
  viewedAt?: number;
  timerEndsAt?: number;
  protectedMedia?: {
    localUri?: string;
    mediaType?: 'photo' | 'video';
    timer?: number;
    viewingMode?: 'tap' | 'hold';
    isMirrored?: boolean;
    expiresDurationMs?: number;
  };
}

interface Phase2ProtectedMediaViewerProps {
  visible: boolean;
  conversationId: string;
  messageId: string;
  onClose: () => void;
  // PHASE-1 PARITY FIX: Accept message data from parent (for backend messages)
  messageData?: MessageData | null;
  // SENDER-VIEW-FIX: When sender opens, show media but DON'T trigger timer/expiry
  isSenderViewing?: boolean;
}

// Module-level Set to track ONCE + HOLD messages that have been viewed.
// Persists across component unmounts to prevent re-viewing.
const viewedOnceHoldMessages = new Set<string>();

// Secure Video Player component using expo-video with wall-clock resume
// TIMER-FIX: Now reports when video is ready to play via onReady callback
interface SecureVideoPlayerProps {
  uri: string;
  elapsedMs: number; // How long since first view (for resume calculation)
  onReady?: () => void; // TIMER-FIX: Called when video is ready to play
}

function SecureVideoPlayer({ uri, elapsedMs, onReady }: SecureVideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLoading, setIsLoading] = useState(true); // TIMER-FIX: Track loading state
  const hasSeekRef = useRef(false); // Only seek once on mount
  const hasReportedReadyRef = useRef(false); // TIMER-FIX: Only report ready once
  const mountedRef = useRef(true);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    // Don't auto-play yet; wait for seek
  });

  // Track mounted state for safe operations
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Handle seek to correct position based on elapsed time
  useEffect(() => {
    if (!player || hasSeekRef.current) return;

    // Get video duration when available
    const checkAndSeek = () => {
      if (!mountedRef.current) return;
      const videoDurationMs = player.duration * 1000; // duration is in seconds

      if (videoDurationMs > 0 && !hasSeekRef.current) {
        hasSeekRef.current = true;

        // Calculate resume position: elapsedMs mod videoDurationMs
        const resumeMs = elapsedMs > 0 ? elapsedMs % videoDurationMs : 0;
        const resumeSec = resumeMs / 1000;

        // Seek to resume position and play
        if (mountedRef.current) {
          player.currentTime = resumeSec;
          player.play();

          // TIMER-FIX: Report video is ready to play
          if (!hasReportedReadyRef.current && onReady) {
            hasReportedReadyRef.current = true;
            setIsLoading(false);
            onReady();
          }
        }
      }
    };

    // Check immediately (player might already have duration)
    checkAndSeek();

    // Also listen for status changes in case duration wasn't ready
    const subscription = player.addListener('statusChange', (status) => {
      if (status.status === 'readyToPlay') {
        checkAndSeek();
      }
    });

    return () => subscription.remove();
  }, [player, elapsedMs, onReady]);

  // Track playing state for UI
  useEffect(() => {
    if (!player) return;

    const subscription = player.addListener('playingChange', (event) => {
      if (!mountedRef.current) return;
      setIsPlaying(event.isPlaying);
    });

    return () => subscription.remove();
  }, [player]);

  const togglePlayback = () => {
    if (!player) return;
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  // Guard: never render VideoView with null/released player
  if (!player) return null;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={togglePlayback}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      {/* TIMER-FIX: Show loading indicator while video loads */}
      {isLoading && (
        <View style={secureVideoStyles.loadingOverlay}>
          <Text style={secureVideoStyles.loadingText}>Loading video...</Text>
        </View>
      )}
      {!isPlaying && !isLoading && (
        <View style={secureVideoStyles.playOverlay}>
          <Ionicons name="play-circle" size={64} color="rgba(255,255,255,0.9)" />
        </View>
      )}
    </Pressable>
  );
}

const secureVideoStyles = StyleSheet.create({
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  // TIMER-FIX: Loading overlay while video buffers
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  loadingText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
});

export function Phase2ProtectedMediaViewer({
  visible,
  conversationId,
  messageId,
  onClose,
  messageData,
  isSenderViewing = false,
}: Phase2ProtectedMediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timerLabel, setTimerLabel] = useState<string>('');
  // Phase-2 Fix B: Track media load state for graceful error handling
  const [mediaLoadError, setMediaLoadError] = useState(false);
  // TIMER-FIX: Track when media is actually ready to display
  // Timer should NOT start until media is loaded and playable
  const [isMediaReady, setIsMediaReady] = useState(false);

  // PHASE-1 PARITY FIX: Track local state for viewedAt/timerEndsAt/isExpired
  // This allows immediate UI updates without waiting for backend query refresh
  const [localViewedAt, setLocalViewedAt] = useState<number | undefined>(undefined);
  const [localTimerEndsAt, setLocalTimerEndsAt] = useState<number | undefined>(undefined);
  const [localIsExpired, setLocalIsExpired] = useState(false);

  // TEMPORARILY DISABLED: Screen protection for testing
  // useScreenProtection(visible);

  // TEMPORARILY DISABLED: Screenshot detection for testing
  // useScreenshotDetection({
  //   enabled: visible,
  //   onScreenshot: () => {
  //     if (__DEV__) {
  //       console.log('[SECURITY] Screenshot detected on protected media:', messageId);
  //     }
  //   },
  // });

  // PHASE-1 PARITY FIX: Get auth token for backend mutations
  const token = useAuthStore((s) => s.token);

  // PHASE-1 PARITY FIX: Backend mutations for secure media state
  const markViewedMutation = useMutation(api.privateConversations.markPrivateSecureMediaViewed);
  const markExpiredMutation = useMutation(api.privateConversations.markPrivateSecureMediaExpired);

  // Subscribe to LIVE message from Zustand store (fallback for local messages)
  const storeMessage = usePrivateChatStore((s) => {
    const msgs = s.messages[conversationId];
    return msgs?.find((m) => m.id === messageId) ?? null;
  });

  // Store actions (fallback for local messages)
  const markSecurePhotoViewed = usePrivateChatStore((s) => s.markSecurePhotoViewed);
  const markSecurePhotoExpired = usePrivateChatStore((s) => s.markSecurePhotoExpired);

  // PHASE-1 PARITY FIX: Use messageData prop if available, otherwise fall back to store
  // This handles both backend messages (via prop) and local messages (via store)
  const message = messageData ?? storeMessage;
  const isBackendMessage = !!messageData;

  // PHASE-1 PARITY FIX: Merge local state with message data for immediate UI updates
  const effectiveViewedAt = localViewedAt ?? message?.viewedAt;
  const effectiveTimerEndsAt = localTimerEndsAt ?? message?.timerEndsAt;
  const effectiveIsExpired = localIsExpired || message?.isExpired;

  // Refs to avoid stale closures in interval
  const timerEndsAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasExpiredRef = useRef(false);
  const hasMarkedViewedRef = useRef(false); // PHASE-1 PARITY FIX: Prevent duplicate markViewed calls
  const onCloseRef = useRef(onClose);
  // Stability fix: track prev displayed time to avoid unnecessary rerenders
  const prevTimeLeftRef = useRef<number | null>(null);

  // Keep refs up to date
  useEffect(() => {
    timerEndsAtRef.current = effectiveTimerEndsAt ?? null;
  }, [effectiveTimerEndsAt]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Get message properties
  const timerSeconds = message?.protectedMedia?.timer ?? 0;
  const viewingMode = message?.protectedMedia?.viewingMode ?? 'tap';
  const isHoldMode = viewingMode === 'hold';
  const mediaUri = message?.protectedMedia?.localUri;
  const isVideo = message?.protectedMedia?.mediaType === 'video';
  const isMirrored = message?.protectedMedia?.isMirrored === true;
  const expiresDurationMs = message?.protectedMedia?.expiresDurationMs ?? (timerSeconds * 1000);

  // ONCE view detection: timer === 0 means view once then expire
  const isOnce = timerSeconds === 0;

  // Calculate elapsed time for video resume (wall-clock based)
  // elapsedMs = how long since first view started
  const computeElapsedMs = useCallback((): number => {
    const timerEndsAt = effectiveTimerEndsAt;
    if (!timerEndsAt || !expiresDurationMs || expiresDurationMs <= 0) return 0;

    const now = Date.now();
    const remainingMs = Math.max(0, timerEndsAt - now);
    const elapsedMs = expiresDurationMs - remainingMs;

    return Math.max(0, elapsedMs);
  }, [effectiveTimerEndsAt, expiresDurationMs]);

  // Compute elapsed once when viewer opens (stable for the session)
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (visible && effectiveTimerEndsAt) {
      setElapsedMs(computeElapsedMs());
    }
  }, [visible, effectiveTimerEndsAt, computeElapsedMs]);

  // Track if photo was viewed this session (for ONCE expiration on close)
  const wasViewedThisSessionRef = useRef(false);

  // Clear interval helper
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // PHASE-1 PARITY FIX: Helper to mark media as expired (uses backend for backend messages)
  const doMarkExpired = useCallback(() => {
    if (hasExpiredRef.current) return;
    hasExpiredRef.current = true;
    setLocalIsExpired(true);

    if (isBackendMessage && token) {
      // Backend message: call mutation
      markExpiredMutation({ token, messageId: messageId as Id<'privateMessages'> })
        .catch((err) => {
          if (__DEV__) console.warn('[SECURE_VIEWER] markExpired error:', err);
        });
    } else {
      // Local message: use store action
      markSecurePhotoExpired(conversationId, messageId);
    }
  }, [isBackendMessage, token, messageId, conversationId, markExpiredMutation, markSecurePhotoExpired]);

  // Handle close (close button or back gesture) - only for tap mode
  // SENDER-VIEW-FIX: Skip ONCE expiration when sender closes viewer
  const handleClose = useCallback(() => {
    clearTimer();

    // ONCE view: expire immediately on close (but NOT for sender viewing their own media)
    if (isOnce && !isSenderViewing && !hasExpiredRef.current && message && !effectiveIsExpired) {
      doMarkExpired();
    }

    onClose();
  }, [isOnce, isSenderViewing, message, effectiveIsExpired, clearTimer, doMarkExpired, onClose]);

  // Android back button handler (only for tap mode)
  useEffect(() => {
    if (!visible || Platform.OS !== 'android' || isHoldMode) return;

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });

    return () => backHandler.remove();
  }, [visible, isHoldMode, handleClose]);

  // CRITICAL FIX: ONCE + HOLD must expire on FIRST release, block all subsequent holds.
  // Uses module-level Set to persist across component unmounts.
  // SENDER-VIEW-FIX: Skip expiration logic when sender is viewing
  useEffect(() => {
    if (!visible || !isOnce || !isHoldMode) return;
    // SENDER-VIEW-FIX: Sender viewing should never trigger ONCE expiration
    if (isSenderViewing) return;

    // If already viewed in a previous hold, expire and close immediately
    if (viewedOnceHoldMessages.has(messageId)) {
      doMarkExpired();
      onCloseRef.current();
      return;
    }

    // First hold - mark as viewed
    // Stability fix: cap Set growth to prevent unbounded memory usage
    if (viewedOnceHoldMessages.size > 3000) {
      viewedOnceHoldMessages.clear();
    }
    viewedOnceHoldMessages.add(messageId);

    // Cleanup: expire on release (component unmount)
    // P0-FIX: Guard with hasExpiredRef to prevent duplicate expiration
    // (handleClose may have already expired via onTouchEnd)
    return () => {
      doMarkExpired();
    };
  }, [visible, isOnce, isHoldMode, messageId, doMarkExpired, isSenderViewing]);

  // SAFETY GUARD: If viewer opens but message is already expired, close immediately
  // This prevents any race condition from showing an expired photo
  // P2-003 FIX: Also respond when backend updates isExpired while viewer is open
  useEffect(() => {
    if (visible && effectiveIsExpired) {
      // Clear timer to prevent further countdown
      clearTimer();
      onCloseRef.current();
    }
  }, [visible, effectiveIsExpired, clearTimer]);

  // P2-003 FIX: If backend timerEndsAt changes (e.g., was corrected), update local ref immediately
  // This ensures the countdown timer uses the authoritative backend value
  useEffect(() => {
    if (messageData?.timerEndsAt && messageData.timerEndsAt !== timerEndsAtRef.current) {
      timerEndsAtRef.current = messageData.timerEndsAt;
    }
  }, [messageData?.timerEndsAt]);

  // Mark as viewed when viewer opens (for ONCE expiration tracking - tap mode)
  useEffect(() => {
    if (visible && message && !effectiveIsExpired) {
      wasViewedThisSessionRef.current = true;
    }
  }, [visible, message, effectiveIsExpired]);

  // Handle close for TAP mode (button, back gesture)
  // ONCE + HOLD is handled by the dedicated effect above
  // SENDER-VIEW-FIX: Skip ONCE expiration when sender closes
  useEffect(() => {
    if (!visible && wasViewedThisSessionRef.current) {
      // ONCE + TAP: expire on close (but NOT for sender viewing their own media)
      if (isOnce && !isHoldMode && !isSenderViewing && !hasExpiredRef.current) {
        doMarkExpired();
      }

      // Reset session state
      wasViewedThisSessionRef.current = false;
      hasExpiredRef.current = false;
      hasMarkedViewedRef.current = false; // PHASE-1 PARITY FIX: Reset for next open
      prevTimeLeftRef.current = null; // Reset for next open
      setTimeLeft(null);
      setTimerLabel('');
      setMediaLoadError(false); // Phase-2 Fix B: Reset error state
      setIsMediaReady(false); // TIMER-FIX: Reset media ready state for next open
      setLocalViewedAt(undefined); // PHASE-1 PARITY FIX: Reset local state
      setLocalTimerEndsAt(undefined);
      setLocalIsExpired(false);
      clearTimer();
    }
  }, [visible, isOnce, isHoldMode, isSenderViewing, clearTimer, doMarkExpired]);

  // TIMER-FIX: Mark as viewed ONLY when media is actually ready to display
  // For videos: wait for SecureVideoPlayer.onReady callback
  // For photos: wait for Image.onLoad callback
  // This ensures the countdown timer doesn't consume time while media loads
  // SENDER-VIEW-FIX: Skip markViewed entirely when sender is viewing their own sent media
  useEffect(() => {
    if (!visible || !message) return;
    if (effectiveIsExpired) return;
    // SENDER-VIEW-FIX: Sender viewing their own media should NOT trigger timer
    if (isSenderViewing) return;
    // TIMER-FIX: Wait for media to be ready before starting timer
    if (!isMediaReady) return;
    // PHASE-1 PARITY FIX: Prevent duplicate calls
    if (hasMarkedViewedRef.current) return;

    // Only set timerEndsAt if not already set
    if (!effectiveViewedAt && !effectiveTimerEndsAt) {
      hasMarkedViewedRef.current = true;

      if (isBackendMessage && token) {
        // Backend message: call mutation
        markViewedMutation({ token, messageId: messageId as Id<'privateMessages'> })
          .then((result: any) => {
            if (result?.success) {
              // Update local state for immediate UI update
              setLocalViewedAt(result.viewedAt);
              setLocalTimerEndsAt(result.timerEndsAt);
            }
          })
          .catch((err) => {
            if (__DEV__) console.warn('[SECURE_VIEWER] markViewed error:', err);
          });
      } else {
        // Local message: use store action
        markSecurePhotoViewed(conversationId, messageId);
      }
    }
  }, [visible, message, effectiveIsExpired, effectiveViewedAt, effectiveTimerEndsAt, isMediaReady, isBackendMessage, token, messageId, conversationId, markViewedMutation, markSecurePhotoViewed, isSenderViewing]);

  // Countdown timer - uses ref to read timerEndsAt (avoids stale closure)
  useEffect(() => {
    if (!visible || !message) return;

    // Already expired
    if (effectiveIsExpired) {
      setTimeLeft(0);
      setTimerLabel('0:00');
      return;
    }

    // If timerEndsAt not set yet, wait for it
    if (!effectiveTimerEndsAt) {
      if (timerSeconds === 0) {
        setTimeLeft(null);
        setTimerLabel('');
      }
      return;
    }

    // Timer is set - start countdown using the ref and shared helper
    const updateTimeLeft = () => {
      const endTime = timerEndsAtRef.current;
      if (!endTime) return;

      // Use shared countdown calculation
      const countdown = calculateProtectedMediaCountdown(endTime);

      // Stability fix: only update state when displayed value changes (reduces rerenders)
      if (countdown.remainingSeconds !== prevTimeLeftRef.current) {
        prevTimeLeftRef.current = countdown.remainingSeconds;
        setTimeLeft(countdown.remainingSeconds);
        setTimerLabel(countdown.label);
      }

      if (countdown.expired && !hasExpiredRef.current) {
        clearTimer();
        doMarkExpired();
        onCloseRef.current();
      }
    };

    updateTimeLeft();
    timerRef.current = setInterval(updateTimeLeft, 100);

    return () => clearTimer();
  }, [visible, effectiveTimerEndsAt, effectiveIsExpired, timerSeconds, clearTimer, doMarkExpired]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  // HOLD-MODE-FIX: Close viewer immediately when finger is released in hold mode
  // This is critical because the Modal captures touch events, preventing the
  // original PanResponder from receiving onPanResponderRelease
  // BUG-FIX: Must call handleClose() (not onClose) to trigger once-view expiry logic
  const handleHoldModeRelease = useCallback(() => {
    if (isHoldMode) {
      handleClose();
    }
  }, [isHoldMode, handleClose]);

  // TIMER-FIX: Callback when media is ready to display
  // This triggers the timer to start only after loading is complete
  const handleMediaReady = useCallback(() => {
    if (!isMediaReady) {
      setIsMediaReady(true);
    }
  }, [isMediaReady]);

  if (!visible || !message) return null;

  // Check if already expired
  if (effectiveIsExpired) {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
        <StatusBar hidden />
        <View style={styles.container}>
          <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={28} color={C.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.expiredContainer}>
            <Ionicons name="lock-closed" size={48} color={C.textLight} />
            <Text style={styles.expiredText}>This media has expired</Text>
            <TouchableOpacity onPress={handleClose} style={styles.expiredButton}>
              <Text style={styles.expiredButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const hasActiveTimer = timeLeft !== null && timeLeft > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <StatusBar hidden />
      <View
        style={styles.container}
        // HOLD-MODE-FIX: Detect touch end to close viewer when finger is released
        onTouchEnd={isHoldMode ? handleHoldModeRelease : undefined}
        onTouchCancel={isHoldMode ? handleHoldModeRelease : undefined}
      >
        {/* Media layer - fullscreen (photo or video) */}
        {/* TIMER-FIX: Pass onReady/onLoad callbacks to start timer only when media is playable */}
        {mediaUri && !mediaLoadError ? (
          <View style={[StyleSheet.absoluteFill, isMirrored && styles.mirrored]}>
            {isVideo ? (
              <SecureVideoPlayer
                uri={mediaUri}
                elapsedMs={elapsedMs}
                onReady={handleMediaReady}
              />
            ) : (
              <Image
                source={{ uri: mediaUri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                onLoad={handleMediaReady}
                onError={() => setMediaLoadError(true)}
              />
            )}
            {/* Corner countdown badge - only UI for timer */}
            {hasActiveTimer && (
              <View style={[styles.cornerBadge, { top: insets.top + 16 }, isMirrored && styles.mirroredBadge]}>
                <Text style={styles.cornerBadgeText}>{timerLabel}</Text>
              </View>
            )}
          </View>
        ) : mediaLoadError ? (
          // Phase-2 Fix B: Graceful "unavailable" state when URI is stale
          <View style={styles.placeholder}>
            <Ionicons name="alert-circle-outline" size={64} color={C.textLight} />
            <Text style={styles.placeholderText}>Media unavailable</Text>
            <Text style={styles.placeholderSubtext}>The file may have been deleted from your device</Text>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name={isVideo ? "videocam-outline" : "image-outline"} size={64} color={C.textLight} />
            <Text style={styles.placeholderText}>Loading...</Text>
          </View>
        )}

        {/* Header overlay - close button only (no timer badge here) */}
        {!isHoldMode && (
          <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={28} color={C.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* Footer overlay - minimal info */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]} pointerEvents="none">
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark" size={16} color={SOFT_ACCENT} />
            <Text style={styles.infoText}>{isVideo ? 'Secure Video' : 'Secure Photo'}</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const C = INCOGNITO_COLORS;

// GOAL C: Softer accent color for Phase-2 (not harsh pink)
const SOFT_ACCENT = '#7B68A6';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerBadge: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  cornerBadgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  mirroredBadge: {
    transform: [{ scaleX: -1 }], // Counter-flip to keep text readable
  },
  expiredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  expiredText: {
    fontSize: 16,
    color: C.textLight,
  },
  expiredButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: SOFT_ACCENT,
  },
  expiredButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  placeholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textLight,
  },
  placeholderSubtext: {
    fontSize: 13,
    color: C.textLight,
    opacity: 0.7,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    gap: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    fontSize: 13,
    color: C.text,
    fontWeight: '500',
  },
});
