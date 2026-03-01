/**
 * SecureMediaViewer
 *
 * Full-screen, privacy-first media viewer for chat rooms.
 * - Hold-to-view: Media only visible while finger is pressed
 * - Screenshot detection (Android): Blurs media and shows toast
 * - Solid dark background, isolated from chat UI
 * - No download/save/share options
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface SecureMediaViewerProps {
  visible: boolean;
  mediaUri: string;
  type: 'image' | 'video';
  /** Controlled hold state - media is visible while true */
  isHolding: boolean;
  onClose: () => void;
}

/**
 * Safe pause helper to avoid crashes from stale player references
 */
function safePause(player: VideoPlayer | null | undefined): void {
  if (!player) return;
  if (typeof player !== 'object' || typeof (player as any).pause !== 'function') {
    return;
  }
  try {
    player.pause();
  } catch {
    // Ignore errors from already-released shared objects
  }
}

export default function SecureMediaViewer({
  visible,
  mediaUri,
  type,
  isHolding,
  onClose,
}: SecureMediaViewerProps) {
  const [screenshotBlocked, setScreenshotBlocked] = useState(false);
  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Video player (only initialized for video type)
  const player = useVideoPlayer(
    type === 'video' ? mediaUri : '',
    (p) => {
      p.loop = true;
    }
  );
  const playerRef = useRef<VideoPlayer | null>(null);

  useEffect(() => {
    playerRef.current = player ?? null;
  }, [player]);

  // Cleanup video on close/unmount
  useEffect(() => {
    if (!visible) {
      safePause(playerRef.current);
      setScreenshotBlocked(false);
    }
    return () => {
      safePause(playerRef.current);
    };
  }, [visible]);

  // Control video playback based on hold state
  useEffect(() => {
    if (type !== 'video' || !player) return;

    if (isHolding && visible && !screenshotBlocked) {
      try {
        player.play();
      } catch {
        // Ignore
      }
    } else {
      safePause(player);
    }
  }, [isHolding, visible, screenshotBlocked, type, player]);

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

        {/* Media display area (hold controlled by parent) */}
        <View style={styles.mediaArea}>
          {type === 'image' ? (
            <Image
              source={{ uri: mediaUri }}
              style={styles.media}
              contentFit="contain"
              blurRadius={showMedia ? 0 : 50}
            />
          ) : (
            <View style={styles.videoContainer}>
              {player && (
                <VideoView
                  player={player}
                  style={[
                    styles.video,
                    !showMedia && styles.videoHidden,
                  ]}
                  contentFit="contain"
                  nativeControls={false}
                />
              )}
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
});
