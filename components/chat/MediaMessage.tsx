import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useMediaViewStore } from '@/stores/mediaViewStore';

// Thumbnail size: ~1/4th of original (was 200x150, now 100x75)
const THUMB_WIDTH = 100;
const THUMB_HEIGHT = 75;

interface MediaMessageProps {
  /**
   * Unique message ID for tracking view state.
   * When provided, enables secure hold-to-view behavior.
   * When omitted, uses legacy tap-to-view behavior (for DMs).
   */
  messageId?: string;
  mediaUrl: string;
  type: 'image' | 'video' | 'doodle';
  /** Called immediately when user starts holding (opens viewer) */
  onHoldStart?: () => void;
  /** Called immediately when user releases hold (closes viewer) */
  onHoldEnd?: () => void;
  /** Legacy: Called on tap (when messageId not provided) */
  onPress?: () => void;
  /** Optional: is this a "view once" media (future feature) */
  viewOnce?: boolean;
}

export default function MediaMessage({
  messageId,
  mediaUrl,
  type,
  onHoldStart,
  onHoldEnd,
  onPress,
  viewOnce = false,
}: MediaMessageProps) {
  const markViewedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Secure mode: only when messageId is provided (chat rooms)
  const isSecureMode = !!messageId;

  // Secure media = image/video (NOT doodle) - doodles show normally without blur/hold
  const isSecureMedia = type === 'image' || type === 'video';

  // Track viewed state (only in secure mode)
  const hasBeenViewed = useMediaViewStore((s) => messageId ? s.hasBeenViewed(messageId) : true);
  const isConsumed = useMediaViewStore((s) => messageId ? s.isConsumed(messageId) : false);
  const markViewed = useMediaViewStore((s) => s.markViewed);
  const markConsumed = useMediaViewStore((s) => s.markConsumed);

  // If view-once and already consumed, show permanently unavailable
  if (isSecureMode && viewOnce && isConsumed) {
    return (
      <View style={styles.container}>
        <View style={styles.consumedOverlay}>
          <Ionicons name="eye-off" size={20} color="rgba(255,255,255,0.5)" />
          <Text style={styles.consumedText}>Viewed</Text>
        </View>
      </View>
    );
  }

  // Legacy mode (DMs): simple tap-to-view
  if (!isSecureMode) {
    return (
      <Pressable style={styles.legacyContainer} onPress={onPress}>
        <Image
          source={{ uri: mediaUrl }}
          style={styles.legacyThumbnail}
          contentFit="cover"
        />
        {type === 'video' && (
          <View style={styles.legacyPlayOverlay}>
            <Ionicons name="play-circle" size={36} color="rgba(255,255,255,0.9)" />
          </View>
        )}
      </Pressable>
    );
  }

  // Doodle in secure mode: show normally without blur/hold-to-view
  if (!isSecureMedia) {
    return (
      <Pressable style={styles.container} onPress={onPress}>
        <Image
          source={{ uri: mediaUrl }}
          style={styles.thumbnail}
          contentFit="cover"
        />
      </Pressable>
    );
  }

  // Secure mode handlers - IMMEDIATE open/close
  const handlePressIn = useCallback((_e: GestureResponderEvent) => {
    // Immediately open full-screen viewer
    onHoldStart?.();

    // After 300ms of holding, mark as "viewed" (hides hint on future views)
    markViewedTimeoutRef.current = setTimeout(() => {
      if (!hasBeenViewed && messageId) {
        markViewed(messageId);
      }
      // For view-once, mark as consumed after viewing
      if (viewOnce && messageId) {
        markConsumed(messageId);
      }
    }, 300);
  }, [messageId, hasBeenViewed, markViewed, viewOnce, markConsumed, onHoldStart]);

  const handlePressOut = useCallback(() => {
    // Cancel "mark as viewed" timeout if released too quickly
    if (markViewedTimeoutRef.current) {
      clearTimeout(markViewedTimeoutRef.current);
      markViewedTimeoutRef.current = null;
    }

    // Immediately close viewer
    onHoldEnd?.();
  }, [onHoldEnd]);

  return (
    <Pressable
      style={styles.container}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      {/* Media thumbnail - always blurred in chat list */}
      <Image
        source={{ uri: mediaUrl }}
        style={styles.thumbnail}
        contentFit="cover"
        blurRadius={25}
      />

      {/* Video indicator (always visible) */}
      {type === 'video' && (
        <View style={styles.videoIndicator}>
          <Ionicons name="play" size={14} color="#FFFFFF" />
        </View>
      )}

      {/* Hold to view hint - always visible on blurred thumbnails */}
      <View style={styles.hintOverlay}>
        <Text style={styles.hintText}>Hold to view</Text>
      </View>

      {/* Blur overlay */}
      <View style={styles.blurOverlay} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Secure mode (chat rooms) - small thumbnails
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
  blurred: {
    // Additional blur styling handled by blurRadius prop
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 30, 46, 0.4)',
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
  consumedOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2C2C3A',
  },
  consumedText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  // Legacy mode (DMs) - larger previews
  legacyContainer: {
    width: 200,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1E1E2E',
  },
  legacyThumbnail: {
    width: '100%',
    height: '100%',
  },
  legacyPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});
