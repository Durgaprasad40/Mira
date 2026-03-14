import React, { useCallback, useRef, useMemo, useEffect, useState } from 'react';
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

/**
 * CR-011: Media source classification for debugging
 */
type MediaSourceType =
  | 'remote_url'        // http:// or https:// - durable cloud storage
  | 'local_cache_temp'  // file:// or content:// - temporary device cache
  | 'invalid'           // empty, null, or malformed
  | 'stale_cache';      // local path that no longer exists (detected by onError)

/**
 * CR-011: Classify media URI source type
 * Used for logging and determining render behavior
 */
function classifyMediaSource(uri: string | undefined): MediaSourceType {
  if (!uri || typeof uri !== 'string' || uri.trim() === '') {
    return 'invalid';
  }

  // Remote URLs are durable - preferred source
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return 'remote_url';
  }

  // Local cache paths - transient, may not exist
  if (uri.startsWith('file://') || uri.startsWith('/') || uri.startsWith('content://')) {
    return 'local_cache_temp';
  }

  return 'invalid';
}

/**
 * CR-011: Check if URI is a durable remote URL (http/https)
 * Only remote URLs should be used for persisted message display
 */
function isDurableMediaUri(uri: string | undefined): boolean {
  if (!uri || typeof uri !== 'string') return false;
  return uri.startsWith('http://') || uri.startsWith('https://');
}

// Thumbnail size: ~1/4th of original (was 200x150, now 100x75)
const THUMB_WIDTH = 100;
const THUMB_HEIGHT = 75;

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
  // ═══════════════════════════════════════════════════════════════════════════
  // HOOKS MUST ALL BE AT TOP LEVEL - NO CONDITIONAL RETURNS BEFORE HOOKS
  // CR-011: Fixed "Rendered fewer hooks than expected" by moving all hooks up
  // ═══════════════════════════════════════════════════════════════════════════

  // --- State hooks ---
  const [mediaError, setMediaError] = useState(false);

  // --- Ref hooks ---
  const markViewedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHoldStartRef = useRef(onHoldStart);
  const onHoldEndRef = useRef(onHoldEnd);
  const messageIdRef = useRef(messageId);
  const viewOnceRef = useRef(viewOnce);

  // --- Store hooks (must be called unconditionally) ---
  const hasBeenViewed = useMediaViewStore((s) => messageId ? s.hasBeenViewed(messageId) : true);
  const isConsumed = useMediaViewStore((s) => messageId ? s.isConsumed(messageId) : false);
  const markViewed = useMediaViewStore((s) => s.markViewed);
  const markConsumed = useMediaViewStore((s) => s.markConsumed);

  // --- More refs that depend on store values ---
  const hasBeenViewedRef = useRef(hasBeenViewed);
  const markViewedRef = useRef(markViewed);
  const markConsumedRef = useRef(markConsumed);

  // --- Effect hooks ---
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (markViewedTimeoutRef.current) {
        clearTimeout(markViewedTimeoutRef.current);
        markViewedTimeoutRef.current = null;
      }
    };
  }, []);

  // Reset error state when mediaUrl changes
  useEffect(() => {
    setMediaError(false);
  }, [mediaUrl]);

  // Keep refs updated (must run every render, unconditionally)
  useEffect(() => {
    onHoldStartRef.current = onHoldStart;
    onHoldEndRef.current = onHoldEnd;
    hasBeenViewedRef.current = hasBeenViewed;
    messageIdRef.current = messageId;
    viewOnceRef.current = viewOnce;
    markViewedRef.current = markViewed;
    markConsumedRef.current = markConsumed;
  });

  // --- Callback hooks ---
  const handleImageError = useCallback(() => {
    const sourceType = classifyMediaSource(mediaUrl);
    if (__DEV__) {
      console.log('[MediaMessage] Image load failed:', {
        uri: mediaUrl,
        source: sourceType === 'local_cache_temp' ? 'stale_cache' : sourceType,
      });
    }
    setMediaError(true);
  }, [mediaUrl]);

  // --- Memo hooks (PanResponder) ---
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ALL HOOKS COMPLETE - NOW SAFE TO DO CONDITIONAL RETURNS
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Derived values (not hooks) ---
  const sourceType = classifyMediaSource(mediaUrl);
  const isSecureMode = !!messageId;
  const isSecureMedia = type === 'image' || type === 'video';

  // CR-011: Log source classification in dev mode
  if (__DEV__ && sourceType !== 'remote_url') {
    // Only log non-remote sources to identify pollution
    console.log('[MediaMessage] Non-remote source:', {
      messageId,
      type,
      source: sourceType,
      uri: mediaUrl?.substring(0, 80),
    });
  }

  // --- Conditional renders (safe after all hooks) ---

  // CR-011: Invalid or error state
  if (sourceType === 'invalid' || mediaError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorOverlay}>
          <Ionicons name="image-outline" size={24} color="rgba(255,255,255,0.4)" />
          <Text style={styles.errorText}>Media unavailable</Text>
        </View>
      </View>
    );
  }

  // View-once consumed state
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
          onError={handleImageError}
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
          onError={handleImageError}
        />
      </Pressable>
    );
  }

  // Secure media (image/video) with hold-to-view
  const canBlur = !isContentUri(mediaUrl);

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Image
        source={{ uri: mediaUrl }}
        style={styles.thumbnail}
        contentFit="cover"
        blurRadius={canBlur ? 25 : 0}
        onError={handleImageError}
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
  errorOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2C2C3A',
  },
  errorText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
  },
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
