/**
 * SecureMediaViewer
 *
 * Full-screen, privacy-first media viewer for chat rooms.
 * - Hold-to-view: Media only visible while finger is pressed
 * - Screenshot detection (Android): Blurs media and shows toast
 * - Solid dark background, isolated from chat UI
 * - No download/save/share options
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Dimensions,
  Platform,
  ToastAndroid,
  StatusBar,
  PanResponder,
  PanResponderInstance,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// CR-001: Validate URI before creating video player
function isValidMediaUri(uri: string | undefined | null): boolean {
  if (!uri || typeof uri !== 'string') return false;
  return (
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('file://') ||
    uri.startsWith('content://')
  );
}

interface SecureMediaViewerProps {
  visible: boolean;
  mediaUri: string;
  type: 'image' | 'video';
  /** Controlled hold state - media is visible while true */
  isHolding: boolean;
  /** Called when touch ends on viewer surface (finger lifted) */
  onClose: () => void;
  /** Called when touch starts directly on viewer surface */
  onHoldStart?: () => void;
}

/**
 * Separate video player component to ensure useVideoPlayer is called with stable URI.
 * Only mounted when type === 'video', preventing hook call with null/changing sources.
 */
interface SecureVideoPlayerProps {
  mediaUri: string;
  isPlaying: boolean;
  visible: boolean;
}

/**
 * CR-001: Inner component that contains the useVideoPlayer hook.
 * Only rendered when URI is valid (via wrapper).
 */
function SecureVideoPlayerInner({ mediaUri, isPlaying, visible }: SecureVideoPlayerProps) {
  const player = useVideoPlayer(mediaUri, (p) => {
    p.loop = true;
  });

  // Control playback based on hold state
  useEffect(() => {
    if (!player) return;

    try {
      if (isPlaying && visible) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // Ignore errors from released player during unmount race
    }
  }, [isPlaying, visible, player]);

  // Pause on unmount
  useEffect(() => {
    return () => {
      try {
        player?.pause();
      } catch {
        // Ignore
      }
    };
  }, [player]);

  // CR-002: Guard against rendering VideoView with released player.
  // When visible=false, return null BEFORE unmount to ensure native view
  // is removed from hierarchy before player is released.
  if (!player || !visible) return null;

  return (
    <VideoView
      player={player}
      style={[styles.video, !isPlaying && styles.videoHidden]}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

/**
 * CR-001: Wrapper that validates URI before rendering inner component.
 * Prevents useVideoPlayer from being called with invalid URI.
 */
function SecureVideoPlayer({ mediaUri, isPlaying, visible }: SecureVideoPlayerProps) {
  if (!isValidMediaUri(mediaUri)) {
    return null;
  }
  return <SecureVideoPlayerInner mediaUri={mediaUri} isPlaying={isPlaying} visible={visible} />;
}

export default function SecureMediaViewer({
  visible,
  mediaUri,
  type,
  isHolding,
  onClose,
  onHoldStart,
}: SecureMediaViewerProps) {
  const [screenshotBlocked, setScreenshotBlocked] = useState(false);
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup screenshot timeout on unmount to prevent setState after unmount
  useEffect(() => {
    return () => {
      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
        screenshotTimeoutRef.current = null;
      }
    };
  }, []);

  // Use refs for callbacks to avoid recreating PanResponder
  const onCloseRef = useRef(onClose);
  const onHoldStartRef = useRef(onHoldStart);
  onCloseRef.current = onClose;
  onHoldStartRef.current = onHoldStart;

  // PanResponder for the full-screen viewer surface
  // This handles the case where finger moves onto viewer or user touches viewer directly
  const viewerPanResponder: PanResponderInstance = useMemo(() => PanResponder.create({
    // Capture touch events on the viewer surface
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => false,

    // Touch started on viewer surface
    onPanResponderGrant: () => {
      onHoldStartRef.current?.();
    },

    // Touch ended (finger lifted) - close the viewer
    onPanResponderRelease: () => {
      onCloseRef.current?.();
    },

    // Touch interrupted - also close
    onPanResponderTerminate: () => {
      onCloseRef.current?.();
    },

    // Don't release on movement - key for hold-to-view
    onPanResponderTerminationRequest: () => false,
  }), []);

  // Reset states when viewer closes or mediaUri changes
  useEffect(() => {
    if (!visible) {
      setScreenshotBlocked(false);
      setMediaLoadError(false);
    }
  }, [visible]);

  // Reset error state when mediaUri changes
  useEffect(() => {
    setMediaLoadError(false);
  }, [mediaUri]);

  // Android screenshot detection
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;

    // Use addScreenshotListener if available (Expo SDK 50+)
    let subscription: any = null;

    const setupScreenshotListener = async () => {
      try {
        // Dynamic import to avoid crashes on older SDKs
        const ScreenCapture = await import('expo-screen-capture');
        if (ScreenCapture.addScreenshotListener) {
          subscription = ScreenCapture.addScreenshotListener(() => {
            handleScreenshotDetected();
          });
        }
      } catch {
        // expo-screen-capture not available, skip
      }
    };

    setupScreenshotListener();

    return () => {
      if (subscription?.remove) {
        subscription.remove();
      }
    };
  }, [visible]);

  const handleScreenshotDetected = useCallback(() => {
    // Immediately blur the media (screenshot blocked state)
    setScreenshotBlocked(true);

    // Show toast on Android
    if (Platform.OS === 'android') {
      ToastAndroid.show('Screenshot blocked', ToastAndroid.SHORT);
    }

    // Clear previous timeout
    if (screenshotTimeoutRef.current) {
      clearTimeout(screenshotTimeoutRef.current);
    }

    // Allow viewing again after 2 seconds
    screenshotTimeoutRef.current = setTimeout(() => {
      setScreenshotBlocked(false);
    }, 2000);
  }, []);

  if (!visible || !mediaUri) return null;

  const showMedia = isHolding && !screenshotBlocked;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Close button - always visible */}
        <Pressable
          style={styles.closeBtn}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </Pressable>

        {/* Media display area with PanResponder for hold-to-view */}
        <View style={styles.mediaArea} {...viewerPanResponder.panHandlers}>
          {type === 'image' ? (
            mediaLoadError ? (
              <View style={styles.errorOverlay}>
                <Ionicons name="image-outline" size={48} color="rgba(255,255,255,0.4)" />
                <Text style={styles.errorText}>Media unavailable</Text>
              </View>
            ) : (
              <Image
                source={{ uri: mediaUri }}
                style={styles.media}
                contentFit="contain"
                blurRadius={showMedia ? 0 : 50}
                onError={() => setMediaLoadError(true)}
              />
            )
          ) : (
            <View style={styles.videoContainer}>
              {/* Video player mounted only for video type with stable URI */}
              <SecureVideoPlayer
                mediaUri={mediaUri}
                isPlaying={showMedia}
                visible={visible}
              />
              {/* Blur overlay for video */}
              {!showMedia && (
                <View style={styles.videoBlurOverlay}>
                  <View style={styles.blurPlaceholder} />
                </View>
              )}
            </View>
          )}

          {/* Instruction overlay when not holding */}
          {!isHolding && !screenshotBlocked && (
            <View style={styles.instructionOverlay}>
              <Ionicons name="finger-print" size={48} color="rgba(255,255,255,0.3)" />
              <Text style={styles.instructionText}>Hold to view</Text>
            </View>
          )}

          {/* Screenshot blocked overlay */}
          {screenshotBlocked && (
            <View style={styles.blockedOverlay}>
              <Ionicons name="shield" size={48} color="rgba(255,255,255,0.5)" />
              <Text style={styles.blockedText}>Screenshot blocked</Text>
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
    backgroundColor: '#000000',
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  videoContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoHidden: {
    opacity: 0,
  },
  videoBlurOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  blurPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  instructionOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  instructionText: {
    marginTop: 12,
    fontSize: 16,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  blockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  blockedText: {
    marginTop: 12,
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
  },
  errorOverlay: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
  },
});
