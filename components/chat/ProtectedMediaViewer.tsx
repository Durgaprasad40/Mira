import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
  BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useScreenshotDetection } from '@/hooks/useScreenshotDetection';
import { useScreenProtection } from '@/hooks/useScreenProtection';
import { deleteCachedMedia, getMediaUri } from '@/lib/mediaCache';
import { useAuthStore } from '@/stores/authStore';
import type { Id } from '@/convex/_generated/dataModel';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// SECURE-REWRITE: Explicit viewer states
type ViewerState = 'loading' | 'ready' | 'error' | 'expired';

function getSafeIdTail(value?: string | null): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(-6) : undefined;
}

const asMessageId = (value: string): Id<'messages'> => value as Id<'messages'>;
const asMediaId = (value: string): Id<'media'> => value as Id<'media'>;
const asUserId = (value: string): Id<'users'> => value as Id<'users'>;

interface ProtectedMediaViewerProps {
  visible: boolean;
  messageId: string;
  userId: string;
  viewerName: string;
  onClose: () => void;
  onReport?: () => void;
  // VIDEO-MIRROR-FIX: Pass through mirrored flag for front camera video
  isMirrored?: boolean;
  // HOLD-MODE-FIX: When true, viewer closes on ANY touch release (finger up)
  isHoldMode?: boolean;
  // SECURE_TIMER: True when the current user sent this message. When true,
  // the viewer skips markViewed, skips the countdown UI, and skips markExpired
  // so the sender can review their own media without consuming the recipient's
  // timer or globally expiring view-once media.
  isSender?: boolean;
  // LOAD-FIRST: Local app-cache URI already downloaded by the bubble's load
  // gate. Optional for backward compatibility; viewer falls back to caching
  // the signed remote URL on open when absent.
  prefetchedLocalUri?: string;
}

export function ProtectedMediaViewer({
  visible,
  messageId,
  userId,
  viewerName,
  onClose,
  onReport,
  isMirrored = false,
  isHoldMode = false,
  isSender = false,
  prefetchedLocalUri,
}: ProtectedMediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMarkedViewed = useRef(false);
  const processedRemoteUrlRef = useRef<string | null>(null);
  // 5-2: Prevent duplicate markExpired calls
  const hasExpired = useRef(false);
  // 5-1: Track mounted state to prevent setState after unmount
  const mountedRef = useRef(true);
  const [requestedAccess, setRequestedAccess] = useState(false);
  const messageRef = getSafeIdTail(messageId);

  // CACHE-FIX: Cache URL per messageId to avoid reload on re-open
  const urlCacheRef = useRef<Map<string, string>>(new Map());
  // SECURE-REWRITE: Track explicit viewer state
  // loading = waiting for URL or image load
  // ready = image successfully loaded and visible
  // error = image failed to load or storage unavailable
  // expired = media expired or revoked
  const [viewerState, setViewerState] = useState<ViewerState>('loading');
  const token = useAuthStore((s) => s.token);

  // 5-1: Track mounted state
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 5-1: Clear any pending timers on unmount
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const mediaData = useQuery(
    api.protectedMedia.getMediaUrl,
    visible && messageId && token
      ? { messageId: asMessageId(messageId), token }
      : 'skip'
  );

  // SECURE-REWRITE: Reset viewer state when opening
  React.useEffect(() => {
    if (visible) {
      // CACHE-FIX: Check if we have a cached URL for this message
      const cachedUrl = urlCacheRef.current.get(messageId);
      processedRemoteUrlRef.current = null;
      if (cachedUrl) {
        setMediaUrl(cachedUrl);
        // Still need to go through loading to trigger onLoad callbacks
        setViewerState('loading');
      } else {
        setViewerState('loading');
      }
    }
  }, [visible, messageId]);

  const markViewed = useMutation(api.protectedMedia.markViewed);
  const markExpired = useMutation(api.protectedMedia.markExpired);
  const logScreenshot = useMutation(api.protectedMedia.logScreenshotEvent);
  const requestAccess = useMutation(api.permissions.requestScreenshotAccess);

  const allowScreenshot = mediaData?.allowScreenshot ?? false;
  const shouldBlur = mediaData?.shouldBlur ?? true;
  const watermarkText = mediaData?.watermarkText ?? null;
  const mediaId = mediaData?.mediaId ?? null;
  // VIDEO-FIX: Check if media is video for rendering branch
  const isVideo = mediaData?.mediaType === 'video';
  // VIDEO-MIRROR-FIX: Prefer backend isMirrored, fall back to prop for demo mode
  const effectiveIsMirrored = mediaData?.isMirrored ?? isMirrored;
  // ONCE-VIEW-FIX: Detect view-once mode - NO timer, only expire on close
  const isViewOnce = mediaData?.viewOnce === true;

  const cleanupCachedMedia = useCallback(() => {
    const remoteUrl = mediaData?.url;
    if (!remoteUrl || !remoteUrl.startsWith('http')) return;
    const kind = mediaData?.mediaType === 'video' ? 'video' : 'image';
    void deleteCachedMedia(remoteUrl, kind).catch(() => {});
  }, [mediaData?.url, mediaData?.mediaType]);

  // Screen protection — always block screenshots + screen recording while the
  // viewer is visible (photos AND videos). Enables FLAG_SECURE on Android and
  // preventScreenCaptureAsync on iOS for the lifetime of the open viewer.
  useScreenProtection(visible);

  // Screenshot detection — fires on both platforms
  // [P1_MEDIA_FIX] Backend validator for `logScreenshotEvent` accepts
  // `{ token, messageId, wasTaken }`. The server resolves the user via
  // `validateSessionToken` and enforces a per-user rate limit.
  const handleScreenshot = useCallback(() => {
    if (messageId && userId && token) {
      void logScreenshot({
        token,
        messageId: asMessageId(messageId),
        wasTaken: true,
      }).catch(() => {});
    }
  }, [messageId, userId, token, logScreenshot]);

  useScreenshotDetection({
    enabled: visible,
    onScreenshot: handleScreenshot,
  });

  // 6-2: Define handleClose BEFORE other callbacks that reference it
  const handleClose = useCallback(() => {
    // 5-1: Clear timer before any state changes
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 5-2: If view-once, expire on close (only once)
    // SECURE_TIMER: `markExpired` is token-bound; only sender/recipient can expire.
    // SECURE_TIMER: sender must never consume the timer on their own media —
    // skip markExpired entirely when the current user is the sender.
    if (mediaData?.viewOnce && !hasExpired.current && !isSender && token) {
      hasExpired.current = true;
      if (__DEV__) console.log('[SECURE_TIMER] markExpired', { messageRef, reason: 'viewonce_close' });
      void markExpired({
        messageId: asMessageId(messageId),
        token,
      }).catch(() => {});
      cleanupCachedMedia();
    } else if (mediaData?.viewOnce && isSender) {
      if (__DEV__) console.log('[SECURE_TIMER] skip_sender_timer', { messageRef, reason: 'viewonce_close' });
    }

    // 5-1: Only update state if still mounted
    if (mountedRef.current) {
      setMediaUrl(null);
      setTimeLeft(null);
      setRequestedAccess(false);
      setViewerState('loading'); // SECURE-REWRITE: Reset state for next open
    }
    hasMarkedViewed.current = false;
    hasExpired.current = false; // Reset for next open
    onClose();
  }, [mediaData, messageId, messageRef, token, markExpired, onClose, isSender, cleanupCachedMedia]);

  // P1_SECURE_BACK: Android hardware back must close the secure viewer (and
  // funnel through handleClose so view-once expiry / timer cleanup runs)
  // instead of falling through to the screen-level BackHandler that would
  // exit the entire chat. Mirrors Phase-2 Phase2ProtectedMediaViewer.tsx
  // back-handler pattern. Registered only while the viewer is visible so it
  // does not steal back presses when the modal is dismissed.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, handleClose]);

  // SECURE-REWRITE: Process mediaData and resolve the render URI.
  // The bubble may hand us a local cache URI; otherwise we download to app
  // cache here while the viewer shows an explicit loading state.
  useEffect(() => {
    if (!visible) return;

    // Handle expired state
    if (mediaData?.isExpired) {
      setViewerState('expired');
      return;
    }

    // Handle storage error
    if (mediaData?.error === 'storage_unavailable') {
      setViewerState('error');
      return;
    }

    // Handle URL received - stay in loading until image/video is actually ready.
    if (mediaData?.url && processedRemoteUrlRef.current !== mediaData.url) {
      processedRemoteUrlRef.current = mediaData.url;
      const processUrl = async () => {
        let finalUrl = prefetchedLocalUri;

        if (!finalUrl) {
          try {
            finalUrl = await getMediaUri(
              mediaData.url,
              mediaData.mediaType === 'video' ? 'video' : 'image'
            );
          } catch {
            finalUrl = mediaData.url;
          }
        }

        // CACHE-FIX: Store URL in cache for faster re-opens
        urlCacheRef.current.set(messageId, finalUrl || mediaData.url);
        if (mountedRef.current) {
          setMediaUrl(finalUrl || mediaData.url);
        }
      };

      processUrl();

      // SECURE_TIMER: log open context for diagnostics
      if (__DEV__) console.log('[SECURE_TIMER] viewer_open', {
        messageRef,
        hasCurrentUser: !!userId,
        isSender,
        timerSeconds: mediaData.timerSeconds ?? null,
        hasExpiresAt: typeof mediaData.expiresAt === 'number',
        viewOnce: mediaData.viewOnce === true,
      });
    }
  }, [visible, mediaData, messageId, messageRef, userId, isSender, prefetchedLocalUri]);

  // Start secure view/timer semantics only after the media has actually loaded
  // into the fullscreen viewer. Preloading/downloading never marks viewed.
  useEffect(() => {
    if (!visible || !mediaData?.url || !mediaUrl) return;
    if (viewerState !== 'ready') return;
    if (hasMarkedViewed.current) return;
    hasMarkedViewed.current = true;

    if (isSender) {
      // SECURE_TIMER: sender is reviewing their own media. Do NOT call
      // markViewed and do NOT set timeLeft. Timer UI stays hidden; sender
      // can review safely without consuming the recipient's timer or
      // triggering global expiry.
      if (__DEV__) console.log('[SECURE_TIMER] skip_sender_timer', { messageRef, reason: 'media_ready' });
      return;
    }

    if (!token) return;
    if (__DEV__) console.log('[SECURE_TIMER] markViewed', { messageRef });
    void markViewed({
      messageId: asMessageId(messageId),
      token,
    }).catch(() => {});

    // ONCE-VIEW-FIX: Skip timer for view-once media
    // View-once media has NO timer - user can view as long as they want
    // Expiration happens ONLY when user closes the viewer
    if (mediaData.viewOnce) {
      if (__DEV__) console.log('[SECURE-VIEWER] view-once mode: no timer', { messageRef });
      return;
    }

    if (mediaData.expiresAt) {
      // TIMER-FIX: Use absolute deadline (expiresAt) instead of resetting to timerSeconds
      // This ensures timer continues even if viewer is closed and reopened
      const remainingMs = mediaData.expiresAt - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      if (remainingSec > 0) {
        if (__DEV__) console.log('[SECURE_TIMER] receiver_timer_start', { messageRef, remainingSec });
        setTimeLeft(remainingSec);
      } else {
        // Already expired by deadline
        setTimeLeft(0);
      }
    } else if (mediaData.timerSeconds && mediaData.timerSeconds > 0) {
      // First open - use timerSeconds (markViewed will set expiresAt on backend)
      if (__DEV__) console.log('[SECURE_TIMER] receiver_timer_start', {
        messageRef,
        remainingSec: mediaData.timerSeconds,
      });
      setTimeLeft(mediaData.timerSeconds);
    }
  }, [visible, mediaData, mediaUrl, viewerState, markViewed, messageId, messageRef, token, isSender]);

  // 6-2: handleExpire now includes handleClose in deps (no stale closure)
  // MSG-006 FIX: Use the session token for server-side verification.
  const handleExpire = useCallback(() => {
    if (hasExpired.current) return; // Already expired
    hasExpired.current = true;
    // SECURE_TIMER: sender must never trigger global expiry from the viewer.
    if (isSender) {
      if (__DEV__) console.log('[SECURE_TIMER] skip_sender_timer', { messageRef, reason: 'expire' });
      handleClose();
      return;
    }
    if (!token) {
      handleClose();
      return;
    }
    if (__DEV__) console.log('[SECURE_TIMER] markExpired', { messageRef, reason: 'timer_zero' });
    void markExpired({
      messageId: asMessageId(messageId),
      token,
    }).catch(() => {});
    cleanupCachedMedia();
    handleClose();
  }, [messageId, messageRef, token, markExpired, handleClose, isSender, cleanupCachedMedia]);

  // STABILITY FIX: C-5 - Fix timer infinite loop by using proper dependency pattern
  // Compute stable boolean outside effect to avoid expression in dependency array
  const shouldRunTimer = timeLeft !== null && timeLeft > 0;

  useEffect(() => {
    // Clear any existing interval first to ensure only ONE interval exists
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Only start interval when we have a valid positive timer value
    if (!shouldRunTimer) {
      return;
    }

    timerRef.current = setInterval(() => {
      // Guard against setState after unmount
      if (!mountedRef.current) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          // Clear interval when timer reaches 0
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [shouldRunTimer]);

  // 6-3: Separate effect to handle timer expiry (fixes bug where timer hitting 0 never called handleExpire)
  // ONCE-VIEW-FIX: Skip timer-based expiry for view-once media
  useEffect(() => {
    if (timeLeft === 0 && !isViewOnce) {
      handleExpire();
    }
  }, [timeLeft, handleExpire, isViewOnce]);

  // [P1_MEDIA_FIX] `requestScreenshotAccess` validator expects
  // `{ mediaId, requesterId: Id<'users'> }` — not `{ token, authUserId }`.
  const handleRequestAccess = useCallback(() => {
    if (mediaId && userId) {
      void requestAccess({
        mediaId: asMediaId(mediaId),
        requesterId: asUserId(userId),
      })
        .then(() => setRequestedAccess(true))
        .catch(() => {});
    }
  }, [mediaId, userId, requestAccess]);

  // SECURE-REWRITE: Image load handlers (ONLY for images, not videos)
  const handleImageLoad = useCallback(() => {
    if (mountedRef.current) {
      setViewerState('ready');
    }
  }, []);

  const handleImageError = useCallback(() => {
    if (mountedRef.current) {
      setViewerState('error');
    }
  }, []);

  // VIDEO-FIX: Keep metadata load separate from visual readiness. The spinner
  // is hidden by onReadyForDisplay, not by this metadata event.
  const handleVideoLoad = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded && __DEV__) {
      console.log('[SECURE-VIEWER] video metadata loaded', { messageRef });
    }
  }, [messageRef]);

  const handleVideoReadyForDisplay = useCallback(() => {
    if (mountedRef.current) {
      setViewerState('ready');
    }
  }, []);

  const handleVideoError = useCallback(() => {
    if (mountedRef.current) {
      setViewerState('error');
    }
  }, []);

  const renderMediaLayer = () => {
    if (!mediaUrl || viewerState === 'error' || viewerState === 'expired') return null;

    if (isVideo) {
      return (
        <View style={styles.imageContainer}>
          <Video
            source={{ uri: mediaUrl }}
            style={[styles.videoPlayer, effectiveIsMirrored && styles.mirrored]}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={true}
            isLooping={true}
            isMuted={false}
            useNativeControls={false}
            onLoad={handleVideoLoad}
            onReadyForDisplay={handleVideoReadyForDisplay}
            onError={handleVideoError}
          />
        </View>
      );
    }

    return (
      <View style={styles.imageContainer}>
        {shouldBlur && Platform.OS === 'ios' ? (
          // Blur overlay when screenshots not allowed (iOS) - IMAGE
          <View style={styles.blurWrapper}>
            <Image
              source={{ uri: mediaUrl }}
              style={styles.image}
              contentFit="contain"
              blurRadius={20}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
            {viewerState === 'ready' && (
              <View style={styles.blurOverlay}>
                <Ionicons name="eye-off" size={32} color={COLORS.white} />
                <Text style={styles.blurText}>Screenshot not allowed by sender</Text>
                {!requestedAccess ? (
                  <TouchableOpacity
                    style={styles.requestAccessButton}
                    onPress={handleRequestAccess}
                  >
                    <Text style={styles.requestAccessText}>Request Access</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.accessRequestedText}>Access requested</Text>
                )}
              </View>
            )}
          </View>
        ) : (
          // Android: FLAG_SECURE blocks screenshot; iOS screenshot allowed: show clear image
          <Image
            source={{ uri: mediaUrl }}
            style={styles.image}
            contentFit="contain"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}
      </View>
    );
  };

  const mediaLayer = renderMediaLayer();

  const showLoadingOverlay = viewerState === 'loading';

  const handleHoldModeRelease = useCallback(() => {
    if (isHoldMode) {
      handleClose();
    }
  }, [isHoldMode, handleClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // P1_SECURE_BACK: Modal-level Android back handler. React Native fires
      // onRequestClose for hardware back / system gesture even when the
      // BackHandler subscription order is awkward; routing through the same
      // handleClose funnel guarantees view-once expiry and timer cleanup
      // always run before the modal unmounts.
      onRequestClose={handleClose}
    >
      <View
        style={styles.container}
        // HOLD-MODE-FIX: Detect touch end to close viewer when finger is released
        onTouchEnd={isHoldMode ? handleHoldModeRelease : undefined}
        onTouchCancel={isHoldMode ? handleHoldModeRelease : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>

          <View style={styles.headerRight}>
            {/* SECURE_TIMER: hide countdown badge when sender is reviewing own media */}
            {!isSender && timeLeft !== null && timeLeft > 0 && (
              <View style={styles.timerBadge}>
                <Ionicons name="timer-outline" size={16} color={COLORS.white} />
                <Text style={styles.timerText}>{timeLeft}s</Text>
              </View>
            )}

            {onReport && (
              <TouchableOpacity onPress={onReport} style={styles.reportButton}>
                <Ionicons name="flag-outline" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {mediaLayer}

        {showLoadingOverlay && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>
              Loading protected {isVideo ? 'video' : 'photo'}...
            </Text>
          </View>
        )}

        {viewerState === 'error' && (
          <View style={styles.expiredContainer}>
            <Ionicons name="cloud-offline" size={48} color={COLORS.textMuted} />
            <Text style={styles.expiredText}>
              Unable to load this {isVideo ? 'video' : 'photo'}
            </Text>
            <Text style={[styles.loadingText, { marginTop: 8 }]}>
              The {isVideo ? 'video' : 'photo'} may no longer be available
            </Text>
            <TouchableOpacity onPress={handleClose} style={styles.expiredButton}>
              <Text style={styles.expiredButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewerState === 'expired' && (
          <View style={styles.expiredContainer}>
            <Ionicons name="lock-closed" size={48} color={COLORS.textMuted} />
            <Text style={styles.expiredText}>This media has expired</Text>
            <TouchableOpacity onPress={handleClose} style={styles.expiredButton}>
              <Text style={styles.expiredButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Watermark overlay */}
        {viewerState === 'ready' && watermarkText && (
          <View style={styles.watermarkContainer} pointerEvents="none">
            {Array.from({ length: 5 }).map((_, i) => (
              <Text
                key={i}
                style={[
                  styles.watermarkText,
                  {
                    top: 80 + i * 140,
                    transform: [{ rotate: '-30deg' }],
                  },
                ]}
              >
                {watermarkText}
              </Text>
            ))}
          </View>
        )}

        {/* Footer info */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
            <Text style={styles.infoText}>Protected {isVideo ? 'Video' : 'Photo'}</Text>
          </View>
          {!allowScreenshot && (
            <View style={styles.infoRow}>
              <Ionicons name="eye-off-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.infoSubtext}>Screenshots are monitored</Text>
            </View>
          )}
          {mediaData?.viewOnce && (
            <View style={styles.infoRow}>
              <Ionicons name="eye-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.infoSubtext}>View once — closes after viewing</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  reportButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustBanner: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  trustText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  expiredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  expiredText: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  expiredButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  expiredButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  // VIDEO-FIX: Explicit video player style for visibility
  videoPlayer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  // VIDEO-MIRROR-FIX: Horizontal flip for front-camera videos
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  blurText: {
    fontSize: 14,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.8,
  },
  requestAccessButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  requestAccessText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  accessRequestedText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  watermarkContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  watermarkText: {
    position: 'absolute',
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.08)',
    left: 20,
    width: SCREEN_WIDTH * 1.5,
    textAlign: 'center',
  },
  footer: {
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
    color: COLORS.white,
    fontWeight: '500',
  },
  infoSubtext: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
});
