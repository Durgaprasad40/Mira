import React, { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  PanResponder,
  PanResponderInstance,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useMediaViewStore } from '@/stores/mediaViewStore';
import { COLORS } from '@/lib/constants';
import { CHAT_TYPOGRAPHY } from '@/lib/chatTypography';
import {
  getCachedMediaUri,
  getMediaUri,
  isMediaCachedOnDisk,
  type MediaKind,
} from '@/lib/mediaCache';

// PHASE-2 PREMIUM PALETTE (additive — only applied when theme === 'phase2').
// Phase-1 visuals are byte-identical when this prop is omitted.
const PHASE2 = {
  containerBg: '#22223A',
  legacyBg: '#22223A',
  placeholderOverlay: 'rgba(20, 18, 36, 0.55)',
  securePlaceholderOverlay: 'rgba(20, 18, 36, 0.65)',
} as const;

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
const isRemoteUri = (uri: string) => uri.startsWith('http://') || uri.startsWith('https://');

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
  /**
   * Load-first gate: when true and no cached local URI exists, render a
   * download-arrow placeholder instead of mounting <Image> with the remote URL.
   * The user must tap the arrow to start the download. Tapping the arrow does
   * NOT call onPress/onHoldStart and does NOT trigger any view-marking.
   */
  requireDownloadBeforeOpen?: boolean;
  /**
   * If true and gated, kicks off the download automatically on mount instead of
   * waiting for a tap. Defaults to false. (Used by surfaces that prefer eager
   * download but still want the placeholder until the file is local.)
   */
  autoDownload?: boolean;
  /** Called after a successful download with the resolved local URI. */
  onDownloaded?: (localUri: string) => void;
  /** Called when a download attempt fails. */
  onDownloadError?: (error: unknown) => void;
  /**
   * PHASE-2 PREMIUM THEME (UI-only, additive). When 'phase2', the placeholder
   * card and the legacy/secure container backgrounds blend with the dark
   * Phase-2 chat thread. Default 'phase1' preserves the legacy look exactly
   * (no behavioral change).
   */
  theme?: 'phase1' | 'phase2';
}

export default function MediaMessage({
  messageId,
  mediaUrl,
  type,
  onHoldStart,
  onHoldEnd,
  onPress,
  viewOnce = false,
  requireDownloadBeforeOpen = false,
  autoDownload = false,
  onDownloaded,
  onDownloadError,
  theme = 'phase1',
}: MediaMessageProps) {
  // PHASE-2 PREMIUM: precomputed style overlays. Null in phase1 so the style
  // arrays below are no-ops (Phase-1 visuals preserved exactly).
  const isPhase2 = theme === 'phase2';
  const containerOverlay = isPhase2 ? { backgroundColor: PHASE2.containerBg } : null;
  const legacyContainerOverlay = isPhase2 ? { backgroundColor: PHASE2.legacyBg } : null;
  const legacyPlaceholderOverlay = isPhase2 ? { backgroundColor: PHASE2.placeholderOverlay } : null;
  const securePlaceholderOverlay = isPhase2 ? { backgroundColor: PHASE2.securePlaceholderOverlay } : null;
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

  // ─── Load-first cache state ──────────────────────────────────────────────
  // Doodles bypass entirely (small, fast, no privacy gate).
  const isDoodle = type === 'doodle';
  // Local URIs need no caching, render directly.
  const remote = !!mediaUrl && isRemoteUri(mediaUrl);
  const gateActive = requireDownloadBeforeOpen && remote && !isDoodle;

  const initialCached = remote ? getCachedMediaUri(mediaUrl) : mediaUrl;
  const [localUri, setLocalUri] = useState<string | undefined>(initialCached || (remote ? undefined : mediaUrl));
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const mediaKind: MediaKind = type === 'video' ? 'video' : 'image';

  // Stable callbacks for callers via refs (avoid re-running effects).
  const onDownloadedRef = useRef(onDownloaded);
  const onDownloadErrorRef = useRef(onDownloadError);
  onDownloadedRef.current = onDownloaded;
  onDownloadErrorRef.current = onDownloadError;

  const startDownload = useCallback(async () => {
    if (!remote) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const uri = await getMediaUri(mediaUrl, mediaKind);
      // If getMediaUri fell back to the remote URL (download failed), treat as error
      if (!uri || uri === mediaUrl) {
        setDownloadError(true);
        onDownloadErrorRef.current?.(new Error('Download failed'));
      } else {
        setLocalUri(uri);
        onDownloadedRef.current?.(uri);
      }
    } catch (err) {
      setDownloadError(true);
      onDownloadErrorRef.current?.(err);
    } finally {
      setDownloading(false);
    }
  }, [mediaUrl, mediaKind, remote]);

  // On mount / mediaUrl change: re-check sync cache, then disk cache, then
  // optionally auto-download when the gate is active.
  useEffect(() => {
    if (!remote) {
      setLocalUri(mediaUrl);
      return;
    }
    const sync = getCachedMediaUri(mediaUrl);
    if (sync) {
      setLocalUri(sync);
      return;
    }
    setLocalUri(undefined);
    let cancelled = false;
    (async () => {
      const onDisk = await isMediaCachedOnDisk(mediaUrl, mediaKind);
      if (cancelled) return;
      if (onDisk) {
        setLocalUri(getCachedMediaUri(mediaUrl));
        return;
      }
      if (gateActive && autoDownload) {
        startDownload();
      } else if (!gateActive) {
        // No gate: legacy behavior — render the remote URL directly.
        setLocalUri(mediaUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, mediaKind, gateActive, autoDownload]);

  // Effective URI to feed expo-image / Video — never the raw remote URL when
  // the gate is active and we haven't downloaded yet.
  const effectiveUri = localUri;
  const isLoaded = !!effectiveUri;

  // DOODLE-UNBLUR-FIX: Doodles ALWAYS render without blur, regardless of context
  // Early return ensures doodles never enter secure/blur flow
  if (type === 'doodle') {
    return (
      <Pressable style={[styles.legacyContainer, legacyContainerOverlay]} onPress={onPress}>
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
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
            style={styles.consumedText}
          >Viewed</Text>
        </View>
      </View>
    );
  }

  // ─── Load-first placeholder renderers ────────────────────────────────────
  // Tap-to-load handler shared by all modes; download tap NEVER calls onPress
  // or marks viewed.
  const handleDownloadTap = () => {
    if (downloading) return;
    startDownload();
  };

  const renderLegacyPlaceholder = () => (
    <Pressable style={[styles.legacyContainer, legacyContainerOverlay]} onPress={handleDownloadTap}>
      <View style={[styles.legacyPlaceholderInner, legacyPlaceholderOverlay]}>
        {downloading ? (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text
              maxFontSizeMultiplier={CHAT_TYPOGRAPHY.mediaCaption.maxFontSizeMultiplier}
              style={styles.placeholderText}
            >Loading…</Text>
          </>
        ) : downloadError ? (
          <>
            <Ionicons name="refresh" size={28} color="#FFFFFF" />
            <Text
              maxFontSizeMultiplier={CHAT_TYPOGRAPHY.mediaCaption.maxFontSizeMultiplier}
              style={styles.placeholderText}
            >Tap to retry</Text>
          </>
        ) : (
          <>
            <Ionicons name="arrow-down-circle" size={36} color="#FFFFFF" />
            <Text
              maxFontSizeMultiplier={CHAT_TYPOGRAPHY.mediaCaption.maxFontSizeMultiplier}
              style={styles.placeholderText}
            >
              {type === 'video' ? 'Tap to load video' : 'Tap to load'}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );

  const renderSecurePlaceholder = (label: string) => (
    <Pressable style={[styles.container, containerOverlay]} onPress={handleDownloadTap}>
      <View style={[styles.securePlaceholderInner, securePlaceholderOverlay]}>
        {downloading ? (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text
              maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
              style={styles.placeholderTextSmall}
            >Loading…</Text>
          </>
        ) : downloadError ? (
          <>
            <Ionicons name="refresh" size={20} color="#FFFFFF" />
            <Text
              maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
              style={styles.placeholderTextSmall}
            >Tap to retry</Text>
          </>
        ) : (
          <>
            <Ionicons name="arrow-down-circle" size={26} color="#FFFFFF" />
            <Text
              maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
              style={styles.placeholderTextSmall}
            >{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );

  // Legacy mode (DMs): simple tap-to-view
  if (!isSecureMode) {
    if (gateActive && !isLoaded) {
      return renderLegacyPlaceholder();
    }
    return (
      <Pressable style={[styles.legacyContainer, legacyContainerOverlay]} onPress={onPress}>
        <Image
          source={{ uri: effectiveUri || mediaUrl }}
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
      <Pressable style={[styles.container, containerOverlay]} onPress={onPress}>
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
    if (gateActive && !isLoaded) {
      return renderSecurePlaceholder('Tap to load');
    }
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
      <Pressable style={[styles.container, containerOverlay]} onPress={handleTap}>
        {/* Media thumbnail - blurred for privacy */}
        <Image
          source={{ uri: effectiveUri || mediaUrl }}
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
          <Text
            maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
            style={styles.hintText}
          >Tap to view</Text>
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

  // HOLD mode: when not yet downloaded, swap PanResponder for a tap-to-load
  // placeholder so the hold gesture can never open an unloaded viewer.
  if (gateActive && !isLoaded) {
    return renderSecurePlaceholder('Tap to load');
  }

  return (
    <View style={[styles.container, containerOverlay]} {...panResponder.panHandlers}>
      <Image
        source={{ uri: effectiveUri || mediaUrl }}
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
        <Text
          maxFontSizeMultiplier={CHAT_TYPOGRAPHY.bubbleMeta.maxFontSizeMultiplier}
          style={styles.hintText}
        >Hold to view</Text>
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
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
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
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD-FIRST PLACEHOLDERS
  // ═══════════════════════════════════════════════════════════════════════════
  legacyPlaceholderInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    gap: 6,
  },
  securePlaceholderInner: {
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
  placeholderTextSmall: {
    color: '#FFFFFF',
    fontSize: CHAT_TYPOGRAPHY.bubbleMeta.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.bubbleMeta.lineHeight,
    fontWeight: '600',
  },
});
