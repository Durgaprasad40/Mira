import React, { useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  PanResponder,
  PanResponderInstance,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useMediaViewStore } from '@/stores/mediaViewStore';
import { COLORS } from '@/lib/constants';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA SIZING - Consistent with bubble styling
// ═══════════════════════════════════════════════════════════════════════════
// DM-SECURE-FIX: Compact thumbnail size for DM secure mode (about 1/4 of legacy size)
const THUMB_WIDTH = 100;
const THUMB_HEIGHT = 75;
// Border radius consistent with message bubbles
const MEDIA_RADIUS = 12;

// Check if URI is a local content:// URI (Android gallery) which doesn't work well with blur
const isContentUri = (uri: string) => uri.startsWith('content://');

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

  // Cleanup timeout on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (markViewedTimeoutRef.current) {
        clearTimeout(markViewedTimeoutRef.current);
        markViewedTimeoutRef.current = null;
      }
    };
  }, []);

  // DOODLE-UNBLUR-FIX: Doodles ALWAYS render without blur, regardless of context
  // Early return ensures doodles never enter secure/blur flow
  if (type === 'doodle') {
    return (
      <Pressable style={styles.legacyContainer} onPress={onPress}>
        <Image
          source={{ uri: mediaUrl }}
          style={styles.legacyThumbnail}
          contentFit="cover"
        />
      </Pressable>
    );
  }

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

  // DM-SECURE-FIX: Determine interaction mode
  // - If onPress is provided (and no onHoldStart): Use TAP-to-view with blur
  // - If onHoldStart is provided: Use HOLD-to-view with blur (original group chat behavior)
  const useTapMode = !!onPress && !onHoldStart;

  // For content:// URIs (Android gallery), skip blur as expo-image can't render them properly with blur
  const canBlur = !isContentUri(mediaUrl);

  // DM-SECURE-FIX: TAP-to-view mode - blurred thumbnail, opens on tap
  if (useTapMode) {
    const handleTap = () => {
      // Mark as viewed on tap
      if (!hasBeenViewed && messageId) {
        markViewed(messageId);
      }
      // For view-once, mark as consumed
      if (viewOnce && messageId) {
        markConsumed(messageId);
      }
      // Open viewer
      onPress?.();
    };

    return (
      <Pressable style={styles.container} onPress={handleTap}>
        {/* Media thumbnail - blurred for privacy */}
        <Image
          source={{ uri: mediaUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          blurRadius={canBlur ? 25 : 0}
        />

        {/* Video indicator */}
        {type === 'video' && (
          <View style={styles.videoIndicator}>
            <Ionicons name="play" size={14} color="#FFFFFF" />
          </View>
        )}

        {/* Tap to view hint */}
        <View style={styles.hintOverlay}>
          <Text style={styles.hintText}>Tap to view</Text>
        </View>

        {/* Privacy overlay */}
        <View style={[styles.blurOverlay, !canBlur && styles.darkOverlay]} />
      </Pressable>
    );
  }

  // HOLD-to-view mode (original group chat behavior)
  // PanResponder for secure media - handles hold without releasing on finger movement
  const onHoldStartRef = useRef(onHoldStart);
  const onHoldEndRef = useRef(onHoldEnd);
  const hasBeenViewedRef = useRef(hasBeenViewed);
  const messageIdRef = useRef(messageId);
  const viewOnceRef = useRef(viewOnce);
  const markViewedRef = useRef(markViewed);
  const markConsumedRef = useRef(markConsumed);

  // Keep refs updated
  onHoldStartRef.current = onHoldStart;
  onHoldEndRef.current = onHoldEnd;
  hasBeenViewedRef.current = hasBeenViewed;
  messageIdRef.current = messageId;
  viewOnceRef.current = viewOnce;
  markViewedRef.current = markViewed;
  markConsumedRef.current = markConsumed;

  const panResponder: PanResponderInstance = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => false,

    onPanResponderGrant: () => {
      onHoldStartRef.current?.();
      markViewedTimeoutRef.current = setTimeout(() => {
        const msgId = messageIdRef.current;
        if (!hasBeenViewedRef.current && msgId) {
          markViewedRef.current(msgId);
        }
        if (viewOnceRef.current && msgId) {
          markConsumedRef.current(msgId);
        }
      }, 300);
    },

    onPanResponderRelease: () => {
      if (markViewedTimeoutRef.current) {
        clearTimeout(markViewedTimeoutRef.current);
        markViewedTimeoutRef.current = null;
      }
      onHoldEndRef.current?.();
    },

    onPanResponderTerminate: () => {
      if (markViewedTimeoutRef.current) {
        clearTimeout(markViewedTimeoutRef.current);
        markViewedTimeoutRef.current = null;
      }
      onHoldEndRef.current?.();
    },

    onPanResponderTerminationRequest: () => false,
  }), []);

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Image
        source={{ uri: mediaUrl }}
        style={styles.thumbnail}
        contentFit="cover"
        blurRadius={canBlur ? 25 : 0}
      />

      {type === 'video' && (
        <View style={styles.videoIndicator}>
          <Ionicons name="play" size={14} color="#FFFFFF" />
        </View>
      )}

      <View style={styles.hintOverlay}>
        <Text style={styles.hintText}>Hold to view</Text>
      </View>

      <View style={[styles.blurOverlay, !canBlur && styles.darkOverlay]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════════════════
  // SECURE MODE - Small thumbnails for chat rooms
  // ═══════════════════════════════════════════════════════════════════════════
  container: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: MEDIA_RADIUS,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
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
  darkOverlay: {
    backgroundColor: 'rgba(30, 30, 46, 0.7)',
  },
  videoIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
    textAlign: 'center',
  },
  consumedOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.border,
  },
  consumedText: {
    fontSize: 10,
    color: 'rgba(0, 0, 0, 0.4)',
    marginTop: 3,
    fontWeight: '500',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LEGACY MODE - Larger previews for DMs
  // ═══════════════════════════════════════════════════════════════════════════
  legacyContainer: {
    width: 220,
    height: 165,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  legacyThumbnail: {
    width: '100%',
    height: '100%',
  },
  legacyPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
});
