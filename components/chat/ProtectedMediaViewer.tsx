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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// SECURE-REWRITE: Explicit viewer states
type ViewerState = 'loading' | 'ready' | 'error' | 'expired';

interface ProtectedMediaViewerProps {
  visible: boolean;
  messageId: string;
  authToken: string;
  viewerName: string;
  onClose: () => void;
  onReport?: () => void;
  // VIDEO-MIRROR-FIX: Pass through mirrored flag for front camera video
  isMirrored?: boolean;
  // HOLD-MODE-FIX: When true, viewer closes on ANY touch release (finger up)
  isHoldMode?: boolean;
}

export function ProtectedMediaViewer({
  visible,
  messageId,
  authToken,
  viewerName,
  onClose,
  onReport,
  isMirrored = false,
  isHoldMode = false,
}: ProtectedMediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMarkedViewed = useRef(false);
  // 5-2: Prevent duplicate markExpired calls
  const hasExpired = useRef(false);
  // 5-1: Track mounted state to prevent setState after unmount
  const mountedRef = useRef(true);
  const [requestedAccess, setRequestedAccess] = useState(false);
  // PERF-FIX: Track open time for performance logging
  const openTimeRef = useRef<number>(0);

  // SECURE-REWRITE: Track explicit viewer state
  // loading = waiting for URL or image load
  // ready = image successfully loaded and visible
  // error = image failed to load or storage unavailable
  // expired = media expired or revoked
  const [viewerState, setViewerState] = useState<ViewerState>('loading');

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
    visible && messageId && authToken ? { messageId: messageId as any, token: authToken } : 'skip'
  );

  // SECURE-REWRITE: Reset viewer state when opening
  React.useEffect(() => {
    if (visible) {
      openTimeRef.current = Date.now();
      setMediaUrl(null);
      setTimeLeft(null);
      setRequestedAccess(false);
      setViewerState('loading');
      hasMarkedViewed.current = false;
      hasExpired.current = false;
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

  // SECURE-REWRITE: Debug logging for viewer state
  React.useEffect(() => {
    if (visible) {
      console.log('[SECURE-VIEWER] State:', {
        viewerState,
        messageId,
        mediaType: mediaData?.mediaType ?? 'unknown',
        isVideo: mediaData?.mediaType === 'video',
        hasUrl: !!mediaData?.url,
        isExpired: mediaData?.isExpired,
        error: mediaData?.error,
        // VIDEO-MIRROR-FIX: Log isMirrored from backend and effective value
        backendIsMirrored: mediaData?.isMirrored,
        propIsMirrored: isMirrored,
        effectiveIsMirrored,
        // ONCE-VIEW-FIX: Log view-once status
        isViewOnce,
      });
    }
  }, [visible, viewerState, messageId, mediaData, isMirrored, effectiveIsMirrored, isViewOnce]);

  // Screen protection (Android FLAG_SECURE) — block when screenshots not allowed
  useScreenProtection(!allowScreenshot && visible);

  // Screenshot detection — fires on both platforms
  const handleScreenshot = useCallback(() => {
    if (messageId && authToken) {
      logScreenshot({
        messageId: messageId as any,
        token: authToken,
        wasTaken: true,
      });
    }
  }, [messageId, authToken, logScreenshot]);

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
    if (mediaData?.viewOnce && hasMarkedViewed.current && !hasExpired.current) {
      hasExpired.current = true;
      markExpired({
        messageId: messageId as any,
        token: authToken,
      });
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
  }, [mediaData, messageId, authToken, markExpired, onClose]);

  // SECURE-REWRITE: Process mediaData and set viewerState
  // Protected media is only consumed after the asset actually loads and becomes visible.
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

    if (mediaData?.url) {
      setMediaUrl(mediaData.url);
    }
  }, [visible, mediaData]);

  const applyCountdownFromResult = useCallback((expiresAt?: number | null) => {
    if (expiresAt) {
      const remainingMs = expiresAt - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      setTimeLeft(remainingSec > 0 ? remainingSec : 0);
      return;
    }

    if (mediaData?.timerSeconds && mediaData.timerSeconds > 0) {
      setTimeLeft(mediaData.timerSeconds);
      return;
    }

    setTimeLeft(null);
  }, [mediaData?.timerSeconds]);

  const handleProtectedMediaReady = useCallback(async () => {
    const loadTime = Date.now() - openTimeRef.current;
    if (!mountedRef.current) return;

    console.log('[SECURE-VIEWER] media-ready:', {
      messageId,
      loadTime,
      mediaType: mediaData?.mediaType ?? 'unknown',
    });

    if (hasMarkedViewed.current) {
      setViewerState('ready');
      return;
    }

    hasMarkedViewed.current = true;

    try {
      const result = await markViewed({
        messageId: messageId as any,
        token: authToken,
      });

      if (!mountedRef.current) return;

      setViewerState('ready');
      if (mediaData?.viewOnce) {
        setTimeLeft(null);
      } else {
        applyCountdownFromResult(result?.expiresAt ?? mediaData?.expiresAt ?? null);
      }
    } catch (error) {
      console.log('[SECURE-VIEWER] markViewed failed:', error);
      if (mountedRef.current) {
        setViewerState('error');
      }
    }
  }, [messageId, authToken, mediaData?.mediaType, mediaData?.viewOnce, mediaData?.expiresAt, markViewed, applyCountdownFromResult]);

  // 6-2: handleExpire now includes handleClose in deps (no stale closure)
  const handleExpire = useCallback(() => {
    if (hasExpired.current) return; // Already expired
    hasExpired.current = true;
    markExpired({
      messageId: messageId as any,
      token: authToken,
    });
    handleClose();
  }, [messageId, authToken, markExpired, handleClose]);

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

  const handleRequestAccess = useCallback(() => {
    if (mediaId && authToken) {
      requestAccess({
        mediaId: mediaId as any,
        token: authToken,
      });
      setRequestedAccess(true);
    }
  }, [mediaId, authToken, requestAccess]);

  // SECURE-REWRITE: Image load handlers (ONLY for images, not videos)
  const handleImageLoad = useCallback(() => {
    handleProtectedMediaReady();
  }, [handleProtectedMediaReady]);

  const handleImageError = useCallback((e: any) => {
    console.log('[SECURE-VIEWER] image-error: Image load failed', e);
    if (mountedRef.current) {
      setViewerState('error');
    }
  }, []);

  // VIDEO-FIX: Separate video load handler using expo-av
  const handleVideoLoad = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      handleProtectedMediaReady();
    }
  }, [handleProtectedMediaReady]);

  const handleVideoError = useCallback((error: string) => {
    console.log('[SECURE-VIEWER] video-error: Video load failed', error);
    if (mountedRef.current) {
      setViewerState('error');
    }
  }, []);

  // HOLD-MODE-FIX: Close viewer immediately when finger is released in hold mode
  // This is critical because the Modal captures touch events, preventing the
  // original PanResponder from receiving onPanResponderRelease
  const handleHoldModeRelease = useCallback(() => {
    if (isHoldMode) {
      console.log('[SECURE-VIEWER] hold-mode: Touch released, closing viewer');
      handleClose();
    }
  }, [isHoldMode, handleClose]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
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
            {timeLeft !== null && timeLeft > 0 && (
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

        {/* Trust signal banner - only show when ready */}
        {viewerState === 'ready' && (
          <View style={styles.trustBanner}>
            {allowScreenshot ? (
              <View style={styles.trustRow}>
                <Ionicons name="shield-checkmark-outline" size={14} color="#4CAF50" />
                <Text style={[styles.trustText, { color: '#4CAF50' }]}>Capture allowed by sender</Text>
              </View>
            ) : (
              <View style={styles.trustRow}>
                <Ionicons name="shield" size={14} color={COLORS.primary} />
                <Text style={[styles.trustText, { color: COLORS.primary }]}>Capture restricted</Text>
              </View>
            )}
          </View>
        )}

        {/* SECURE-REWRITE: State-based content rendering */}
        {viewerState === 'loading' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>
              Opening protected {isVideo ? 'video' : 'photo'}...
            </Text>
            {/* VIDEO-FIX: ONLY use hidden Image preload for IMAGES, never for videos */}
            {mediaUrl && !isVideo && (
              <>
                {console.log('[SECURE-VIEWER] image-loading: Mounting hidden Image preloader')}
                <Image
                  source={{ uri: mediaUrl }}
                  style={styles.hiddenImage}
                  contentFit="contain"
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              </>
            )}
            {/* VIDEO-FIX: For video, directly transition to ready (no preload needed) */}
            {mediaUrl && isVideo && (
              <>
                {console.log('[SECURE-VIEWER] video-loading: Skipping preload, using direct Video mount')}
                {/* Video loads directly in ready state - trigger transition */}
                <Video
                  source={{ uri: mediaUrl }}
                  style={styles.hiddenImage}
                  shouldPlay={false}
                  isMuted={true}
                  onLoad={handleVideoLoad}
                  onError={handleVideoError}
                />
              </>
            )}
          </View>
        )}

        {viewerState === 'error' && (
          <View style={styles.expiredContainer}>
            <Ionicons name="cloud-offline" size={48} color={COLORS.textMuted} />
            <Text style={styles.expiredText}>
              This protected {isVideo ? 'video' : 'photo'} couldn't be opened
            </Text>
            <Text style={[styles.loadingText, { marginTop: 8 }]}>
              It may no longer be available, or your connection may have dropped.
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

        {viewerState === 'ready' && mediaUrl && (
          <View style={styles.imageContainer}>
            {/* VIDEO-FIX: Branch rendering based on mediaType */}
            {isVideo ? (
              // VIDEO-FIX: Render expo-av Video for video content (stable lifecycle)
              // VIDEO-MIRROR-FIX: Apply horizontal flip for front-camera videos
              <>
                {console.log('[SECURE-VIEWER] video-ready: Rendering expo-av Video player, isMirrored:', effectiveIsMirrored, 'url:', mediaUrl?.substring(0, 50))}
                <Video
                  source={{ uri: mediaUrl }}
                  style={[styles.videoPlayer, effectiveIsMirrored && styles.mirrored]}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={true}
                  isLooping={true}
                  isMuted={false}
                  useNativeControls={false}
                  onReadyForDisplay={() => console.log('[SECURE-VIEWER] video-ready: onReadyForDisplay fired')}
                  onPlaybackStatusUpdate={(status) => {
                    if (status.isLoaded && !status.isBuffering) {
                      console.log('[SECURE-VIEWER] video-ready: Playing, duration:', status.durationMillis);
                    }
                  }}
                />
              </>
            ) : shouldBlur && Platform.OS === 'ios' ? (
              // Blur overlay when screenshots not allowed (iOS) - IMAGE
              <>
                {console.log('[SECURE-VIEWER] image-ready: Rendering blurred Image (iOS screenshot blocked)')}
                <View style={styles.blurWrapper}>
                  <Image
                    source={{ uri: mediaUrl }}
                    style={styles.image}
                    contentFit="contain"
                    blurRadius={20}
                  />
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
                </View>
              </>
            ) : (
              // Android: FLAG_SECURE blocks screenshot; iOS screenshot allowed: show clear image
              <>
                {console.log('[SECURE-VIEWER] image-ready: Rendering clear Image')}
                <Image
                  source={{ uri: mediaUrl }}
                  style={styles.image}
                  contentFit="contain"
                />
              </>
            )}

            {/* Watermark overlay */}
            {watermarkText && (
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
              <Text style={styles.infoSubtext}>Capture attempts may be logged</Text>
            </View>
          )}
          {mediaData?.viewOnce && (
            <View style={styles.infoRow}>
              <Ionicons name="eye-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.infoSubtext}>View once — closes after a successful view</Text>
            </View>
          )}
          {!mediaData?.viewOnce && !!mediaData?.timerSeconds && mediaData.timerSeconds > 0 && (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.infoSubtext}>Timer starts after it opens</Text>
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
    backgroundColor: 'rgba(0,0,0,0.95)',
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
    position: 'relative',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
  },
  // VIDEO-FIX: Explicit video player style for visibility
  videoPlayer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
    backgroundColor: '#000',
  },
  // VIDEO-MIRROR-FIX: Horizontal flip for front-camera videos
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  // SECURE-REWRITE: Hidden image for background loading
  hiddenImage: {
    width: 1,
    height: 1,
    position: 'absolute',
    opacity: 0,
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
