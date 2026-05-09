/**
 * VOICE MESSAGE BUBBLE
 *
 * STATUS:
 * - Feature is stable and production-tested
 * - P0 audit passed: uses backend storage URLs, no local file paths
 * - Used by Phase-1 Messages (DM flow) via MessageBubble
 *   (Phase-2 Chat Rooms now uses DmAudioBubble)
 *
 * [P1_VOICE_UI_UPGRADE] — Premium look pass:
 *   - Palette now matches Phase-1 text-bubble theme (#E94E77 rose / white)
 *   - Compact 34x34 play button (down from 42x42)
 *   - Mic badge (copied from Phase-2 DmAudioBubble design)
 *   - Tighter bubble dimensions (minWidth 200, maxWidth 260, padding 9/12)
 *   - Behavior preserved (playback, preload, ticks, delete, duration)
 *
 * Features:
 * - Waveform-style UI with play/pause
 * - Background preload for instant first playback
 * - Loop bug fixed with ref-based state tracking
 * - Sender/receiver visual distinction
 * - Long-press for delete action sheet
 */
import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActionSheetIOS,
  Platform,
  Alert,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { COLORS } from '@/lib/constants';

// Global reference to currently playing sound (ensures only one plays at a time)
let currentPlayingSound: Audio.Sound | null = null;
let currentPlayingId: string | null = null;
let playbackTransitionInFlight = false;

// VOICE-PRELOAD-DEDUPE: Module-level set of audio URIs currently being preloaded.
// Prevents duplicate Audio.Sound.createAsync() calls when a VoiceMessageBubble briefly
// unmounts and remounts during thread hydration — the most common trigger is the
// optimistic-id → backend-id swap inside FlashList (keyExtractor uses item.id, so the
// row is destroyed and recreated). The "second" instance simply skips its preload and
// will load on first user tap via the existing handlePlayPause fallback.
const inFlightPreloads = new Set<string>();
const AUDIO_CREATE_TIMEOUT_MS = 8000;

async function createAudioSoundWithTimeout(
  source: Parameters<typeof Audio.Sound.createAsync>[0],
  initialStatus?: Parameters<typeof Audio.Sound.createAsync>[1],
  onPlaybackStatusUpdate?: Parameters<typeof Audio.Sound.createAsync>[2]
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Audio load timed out'));
    }, AUDIO_CREATE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      Audio.Sound.createAsync(source, initialStatus, onPlaybackStatusUpdate),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// VOICE-TICKS: Tick status helper types (same as MessageBubble)
type TickStatus = 'sent' | 'delivered' | 'read';

interface VoiceMessageBubbleProps {
  messageId: string;
  audioUri: string;
  durationMs: number;
  isOwn: boolean;
  timestamp: number;
  onDelete?: () => void;
  /** For Phase-2 dark theme */
  darkTheme?: boolean;
  // VOICE-TICKS: Tick status props for sent/delivered/read indicators
  deliveredAt?: number;
  readAt?: number;
}

// VOICE-TICKS: Helper functions for tick rendering
function getTickStatus(deliveredAt?: number, readAt?: number): TickStatus {
  if (readAt) return 'read';
  if (deliveredAt) return 'delivered';
  return 'sent';
}

function getTickIcon(status: TickStatus): 'checkmark' | 'checkmark-done' {
  return status === 'sent' ? 'checkmark' : 'checkmark-done';
}

function getTickColor(status: TickStatus): string {
  if (status === 'read') {
    return '#34B7F1'; // Blue for read (WhatsApp-style)
  }
  return 'rgba(255,255,255,0.8)'; // Gray/white for sent and delivered
}

// VOICE-PLAYBACK-FIX: Memoize component to prevent unnecessary re-renders
// from FlashList extraData changes (e.g., 'now' updating every 250ms)
export const VoiceMessageBubble = memo(function VoiceMessageBubble({
  messageId,
  audioUri,
  durationMs,
  isOwn,
  timestamp,
  onDelete,
  darkTheme = false,
  deliveredAt,
  readAt,
}: VoiceMessageBubbleProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  // VOICE-FIX: Check for missing/empty URI upfront
  const [isUnavailable, setIsUnavailable] = useState(!audioUri || audioUri.trim() === '');
  const soundRef = useRef<Audio.Sound | null>(null);
  const isMountedRef = useRef(true);
  // VOICE-PLAYBACK-FIX: Guard against concurrent play/load operations
  const isLoadingRef = useRef(false);
  // VOICE-LOOP-FIX: Sync ref for actual playing state (React state can be stale in callbacks)
  const isPlayingRef = useRef(false);
  // VOICE-LOOP-FIX: Track if playback just finished to prevent auto-resume
  const hasFinishedRef = useRef(false);
  // VOICE-PRELOAD: Track if preload is in progress to prevent double load
  const isPreloadingRef = useRef(false);

  // Format duration as 0:xx
  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // Format timestamp
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        if (currentPlayingId === messageId) {
          currentPlayingSound = null;
          currentPlayingId = null;
        }
        soundRef.current = null;
      }
    };
  }, [messageId]);

  // VOICE-PRELOAD: Preload audio on mount for instant playback
  useEffect(() => {
    // Skip if no valid URI or already loaded/loading
    if (!audioUri || audioUri.trim() === '') return;
    if (soundRef.current) return;
    if (isPreloadingRef.current) return;
    // VOICE-PRELOAD-DEDUPE: If another bubble instance is already preloading this
    // exact URI (typical during the brief optimistic→backend message-id swap on
    // thread open), skip our own preload. The bubble will still play on first
    // tap via the existing handlePlayPause fallback (lines below).
    if (inFlightPreloads.has(audioUri)) return;

    let isMounted = true;
    let preloadStarted = false;
    isPreloadingRef.current = true;
    inFlightPreloads.add(audioUri);

    const preloadAudio = async () => {
      preloadStarted = true;
      try {
        // Configure audio mode
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        const { sound } = await createAudioSoundWithTimeout(
          { uri: audioUri },
          { shouldPlay: false } // DO NOT auto-play on preload
        );

        // Check if still mounted before storing
        if (!isMounted || !isMountedRef.current) {
          await sound.unloadAsync();
          return;
        }

        soundRef.current = sound;
      } catch {
        // Don't mark as unavailable - will fallback to load on play
      } finally {
        isPreloadingRef.current = false;
        inFlightPreloads.delete(audioUri);
      }
    };

    // VOICE-PRELOAD-DEFER: Wait for navigation/interaction to settle before
    // touching the native audio bridge so thread-open animation stays smooth.
    // VOICE-PRELOAD-STABILIZE: After interactions, also require the bubble to
    // remain mounted for ~700ms before starting native createAsync. This skips
    // preload entirely during the unstable thread-open hydration window where
    // the optimistic→backend message-id swap unmounts/remounts FlashList rows.
    // If the bubble survives the window, we preload as before; if it does not,
    // tap-to-play in handlePlayPause loads on demand (existing fallback).
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (!isMounted) return;
      stabilityTimer = setTimeout(() => {
        stabilityTimer = null;
        if (!isMounted) return;
        preloadAudio();
      }, 700);
    });

    return () => {
      isMounted = false;
      interactionHandle?.cancel?.();
      if (stabilityTimer) {
        clearTimeout(stabilityTimer);
        stabilityTimer = null;
      }
      // If the deferred preload never started, release the locks so a future
      // mount with the same URI is free to retry.
      if (!preloadStarted) {
        isPreloadingRef.current = false;
        inFlightPreloads.delete(audioUri);
      }
      // Note: Main cleanup is handled by the other useEffect
    };
  }, [audioUri, messageId]);

  // Stop any currently playing sound
  const stopCurrentPlaying = async () => {
    if (currentPlayingSound && currentPlayingId !== messageId) {
      try {
        await currentPlayingSound.stopAsync();
        await currentPlayingSound.unloadAsync();
      } catch {}
      currentPlayingSound = null;
      currentPlayingId = null;
    }
  };

  // VOICE-PRELOAD: Shared status callback for both preloaded and fresh sounds
  const createStatusCallback = useCallback(() => {
    return (status: any) => {
      // VOICE-LOOP-FIX: Status callback - only update state, NEVER trigger play
      if (!isMountedRef.current) return;

      if (status.isLoaded) {
        // Update progress position
        if (!status.didJustFinish) {
          setPlaybackPosition(status.positionMillis || 0);
        }

        // VOICE-LOOP-FIX: Handle playback completion
        if (status.didJustFinish) {
          // Mark as finished FIRST to prevent any auto-resume
          hasFinishedRef.current = true;
          isPlayingRef.current = false;

          // Update React state
          setIsPlaying(false);
          setPlaybackPosition(0);

          // Clear global singleton
          currentPlayingSound = null;
          currentPlayingId = null;

          // DO NOT call playAsync, DO NOT auto-replay
          // User must tap again to replay
        }
      }
    };
  }, [messageId]);

  const handlePlayPause = useCallback(async () => {
    // VOICE-FIX: Early return if no valid audio URI
    if (!audioUri || audioUri.trim() === '') {
      setIsUnavailable(true);
      return;
    }

    // VOICE-PLAYBACK-FIX: Prevent concurrent play attempts (race condition guard)
    if (isLoadingRef.current) {
      return;
    }
    if (playbackTransitionInFlight) {
      return;
    }

    try {
      playbackTransitionInFlight = true;
      // VOICE-LOOP-FIX: Check ref state, not React state (can be stale)
      if (isPlayingRef.current && soundRef.current) {
        // Pause - user explicitly requested pause
        await soundRef.current.pauseAsync();
        isPlayingRef.current = false;
        setIsPlaying(false);
        return;
      }

      // Stop any other playing voice message
      await stopCurrentPlaying();

      // VOICE-PLAYBACK-FIX: Set loading guard before async operations
      isLoadingRef.current = true;

      // Configure audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      // VOICE-LOOP-FIX: If sound exists but playback finished, reset position first
      if (soundRef.current && hasFinishedRef.current) {
        await soundRef.current.setPositionAsync(0);
        hasFinishedRef.current = false;
      }

      if (soundRef.current) {
        // VOICE-PRELOAD: Use preloaded sound - instant play!
        // Attach status callback for progress and finish handling
        soundRef.current.setOnPlaybackStatusUpdate(createStatusCallback());

        await soundRef.current.playAsync();
        isPlayingRef.current = true;
        setIsPlaying(true);
        currentPlayingSound = soundRef.current;
        currentPlayingId = messageId;
      } else {
        // VOICE-PRELOAD: Fallback - load and play if not preloaded
        hasFinishedRef.current = false;

        const { sound } = await createAudioSoundWithTimeout(
          { uri: audioUri },
          { shouldPlay: true },
          createStatusCallback()
        );

        soundRef.current = sound;
        currentPlayingSound = sound;
        currentPlayingId = messageId;
        isPlayingRef.current = true;
        setIsPlaying(true);
      }
    } catch (error) {
      if (__DEV__) console.error('[VOICE-LOOP-FIX] Play error:', messageId.slice(-6), error);
      // Ensure cleanup on error - unload sound to prevent resource leak
      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
      }
      if (currentPlayingId === messageId) {
        currentPlayingSound = null;
        currentPlayingId = null;
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsUnavailable(true);
    } finally {
      // VOICE-PLAYBACK-FIX: Always reset loading guard
      isLoadingRef.current = false;
      playbackTransitionInFlight = false;
    }
  }, [audioUri, messageId, createStatusCallback]); // VOICE-PRELOAD: Added createStatusCallback

  // Handle long press for delete
  const handleLongPress = useCallback(() => {
    if (!onDelete) return;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Delete'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            onDelete();
          }
        }
      );
    } else {
      // Android fallback
      Alert.alert(
        'Voice Message',
        'What would you like to do?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onDelete },
        ],
        { cancelable: true }
      );
    }
  }, [onDelete]);

  // Progress percentage for visual indicator
  const progress = durationMs > 0 ? playbackPosition / durationMs : 0;

  // VOICE-UI-UPGRADE: Modern theme colors with better sender/receiver distinction
  const C = darkTheme
    ? {
        // Phase-2 dark theme (incognito mode)
        bubbleBg: isOwn ? '#4A3F6B' : '#2D2D42', // Own: warm purple, Other: cool gray
        bubbleGradient: isOwn ? '#5B4B7C' : '#363650',
        text: '#FFFFFF',
        textLight: 'rgba(255,255,255,0.65)',
        playBtnBg: isOwn ? '#9B7DC4' : 'rgba(255,255,255,0.15)',
        playBtnIcon: isOwn ? '#FFFFFF' : '#B8B8D0',
        waveformActive: isOwn ? '#B794E0' : '#7B7B9E',
        waveformInactive: isOwn ? 'rgba(183,148,224,0.35)' : 'rgba(123,123,158,0.35)',
        progressBg: 'rgba(255,255,255,0.12)',
        progressFill: isOwn ? '#B794E0' : '#8E8EAE',
        micBadgeBg: isOwn ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
        micBadgeIcon: isOwn ? '#FFFFFF' : '#B8B8D0',
      }
    : {
        // [P1_VOICE_UI_UPGRADE] Phase-1 light theme, colour-matched to the
        // rose-on-white Messages text bubbles (MessageBubble ownBubble=#E94E77,
        // otherBubble=#FFFFFF). Previously used COLORS.primary (#FF6B6B) which
        // looked like "a large red block" next to the rose text bubbles.
        bubbleBg: isOwn ? '#E94E77' : '#FFFFFF',
        bubbleGradient: isOwn ? '#D63E67' : '#F5F5F7',
        text: isOwn ? '#FFFFFF' : COLORS.text,
        textLight: isOwn ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.45)',
        playBtnBg: isOwn ? 'rgba(255,255,255,0.22)' : '#E94E77',
        playBtnIcon: '#FFFFFF',
        waveformActive: isOwn ? '#FFFFFF' : '#E94E77',
        waveformInactive: isOwn ? 'rgba(255,255,255,0.42)' : 'rgba(233,78,119,0.25)',
        progressBg: isOwn ? 'rgba(255,255,255,0.22)' : 'rgba(233,78,119,0.12)',
        progressFill: isOwn ? '#FFFFFF' : '#E94E77',
        micBadgeBg: isOwn ? 'rgba(255,255,255,0.18)' : 'rgba(233,78,119,0.12)',
        micBadgeIcon: isOwn ? '#FFFFFF' : '#E94E77',
      };

  // VOICE-UI-UPGRADE: Generate waveform bar heights (deterministic based on messageId)
  const waveformBars = React.useMemo(() => {
    const bars: number[] = [];
    const seed = messageId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    for (let i = 0; i < 20; i++) {
      // Generate pseudo-random heights between 0.3 and 1.0
      const height = 0.3 + (((seed * (i + 1) * 7) % 70) / 100);
      bars.push(Math.min(1, height));
    }
    return bars;
  }, [messageId]);

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: C.bubbleBg, opacity: isUnavailable ? 0.6 : 1 },
        isOwn ? styles.containerOwn : styles.containerOther,
      ]}
      onPress={isUnavailable ? undefined : handlePlayPause}
      onLongPress={handleLongPress}
      delayLongPress={400}
      activeOpacity={isUnavailable ? 1 : 0.8}
      disabled={isUnavailable}
    >
      <View style={styles.content}>
        {/* [P1_VOICE_UI_UPGRADE] Compact 34x34 play button (was 42x42) */}
        <View style={[styles.playButton, { backgroundColor: C.playBtnBg }]}>
          <Ionicons
            name={isUnavailable ? 'alert-circle' : isPlaying ? 'pause' : 'play'}
            size={18}
            color={isUnavailable ? C.textLight : C.playBtnIcon}
            style={!isUnavailable && !isPlaying ? { marginLeft: 1.5 } : undefined}
          />
        </View>

        {/* Waveform visualization with per-bar progress coloring */}
        <View style={styles.waveformContainer}>
          <View style={styles.waveformBars}>
            {waveformBars.map((height, index) => {
              // Calculate if this bar is "played" based on progress
              const barProgress = (index + 1) / waveformBars.length;
              const isPlayed = progress >= barProgress;
              return (
                <View
                  key={index}
                  style={[
                    styles.waveformBar,
                    {
                      height: 4 + height * 16, // 4-20px range (slightly tighter)
                      backgroundColor: isPlayed ? C.waveformActive : C.waveformInactive,
                    },
                  ]}
                />
              );
            })}
          </View>
          {/* Duration label */}
          <Text style={[styles.duration, { color: C.textLight }]}>
            {isUnavailable ? 'Unavailable' : isPlaying ? formatDuration(playbackPosition) : formatDuration(durationMs)}
          </Text>
        </View>

        {/* [P1_VOICE_UI_UPGRADE] Mic badge (adapted from Phase-2 DmAudioBubble)
            — gives the bubble a premium voice-note glyph and balances the row */}
        <View style={[styles.micBadge, { backgroundColor: C.micBadgeBg }]}>
          <Ionicons name="mic" size={10} color={C.micBadgeIcon} />
        </View>
      </View>

      {/* Timestamp and tick status */}
      <View style={styles.footer}>
        <Text style={[styles.timestamp, { color: C.textLight }]}>
          {formatTime(timestamp)}
        </Text>
        {/* VOICE-TICKS: Show tick for own messages */}
        {isOwn && (() => {
          const tickStatus = getTickStatus(deliveredAt, readAt);
          return (
            <Ionicons
              name={getTickIcon(tickStatus)}
              size={14}
              color={getTickColor(tickStatus)}
              style={styles.tickIcon}
            />
          );
        })()}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  // [P1_VOICE_UI_UPGRADE] Tighter premium bubble:
  //   - maxWidth 260 (was 75% of screen) → consistent on small + large Android
  //   - paddingVertical 9, horizontal 12 (was 10/10) → matches text-bubble feel
  //   - borderRadius 18 with 6px tail on sender side (matches MessageBubble)
  //   - subtle shadow on own-side rose, hairline border on other-side white
  container: {
    maxWidth: 260,
    minWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
  },
  containerOwn: {
    borderBottomRightRadius: 6,
    alignSelf: 'flex-end',
    shadowColor: '#E94E77',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  containerOther: {
    borderBottomLeftRadius: 6,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // [P1_VOICE_UI_UPGRADE] Compact 34x34 circular play button (was 42x42),
  // matching the Phase-2 DmAudioBubble proportions.
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformContainer: {
    flex: 1,
    gap: 4,
  },
  waveformBars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 22,
    gap: 2,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    minHeight: 4,
  },
  duration: {
    fontSize: 11,
    fontWeight: '500',
  },
  // [P1_VOICE_UI_UPGRADE] Mic badge — subtle 22x22 glyph that anchors the
  // right edge of the row and signals "voice note" at a glance. Matches the
  // Phase-2 DmAudioBubble mic badge but sized for the tighter Phase-1 row.
  micBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // VOICE-TICKS: Footer for timestamp + tick alignment
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timestamp: {
    fontSize: 10,
  },
  tickIcon: {
    marginLeft: 2,
  },
});
