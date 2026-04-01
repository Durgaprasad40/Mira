/**
 * VoiceMessageBubble — Voice message playback UI with play/pause and progress
 *
 * Features:
 * - Play/pause button with progress indicator
 * - Duration label
 * - Only one voice message plays at a time (global singleton)
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { COLORS } from '@/lib/constants';

// Global reference to currently playing sound (ensures only one plays at a time)
let currentPlayingSound: Audio.Sound | null = null;
let currentPlayingId: string | null = null;

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
  // VOICE-PRELOAD: Track preload state for subtle UX indicator
  const [isPreloaded, setIsPreloaded] = useState(false);
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

    let isMounted = true;
    isPreloadingRef.current = true;

    const preloadAudio = async () => {
      try {
        if (__DEV__) console.log('[VOICE-PRELOAD] Preloading:', messageId.slice(-6));

        // Configure audio mode
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: false } // DO NOT auto-play on preload
        );

        // Check if still mounted before storing
        if (!isMounted || !isMountedRef.current) {
          if (__DEV__) console.log('[VOICE-PRELOAD] Unmounted during preload, cleaning up:', messageId.slice(-6));
          await sound.unloadAsync();
          return;
        }

        soundRef.current = sound;
        setIsPreloaded(true);

        if (__DEV__) console.log('[VOICE-PRELOAD] Ready:', messageId.slice(-6));
      } catch (e) {
        if (__DEV__) console.log('[VOICE-PRELOAD] Error:', messageId.slice(-6), e);
        // Don't mark as unavailable - will fallback to load on play
      } finally {
        isPreloadingRef.current = false;
      }
    };

    preloadAudio();

    return () => {
      isMounted = false;
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
          if (__DEV__) console.log('[VOICE-LOOP-FIX] Playback finished - stopping cleanly:', messageId.slice(-6));

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
      if (__DEV__) console.log('[VOICE-LOOP-FIX] Blocked: isLoading=true', messageId.slice(-6));
      return;
    }

    // VOICE-LOOP-FIX: Use ref for accurate playing state check
    if (__DEV__) {
      console.log('[VOICE-FIX-STATE]', {
        messageId: messageId.slice(-6),
        isPlaying,
        isPlayingRef: isPlayingRef.current,
        isLoading: isLoadingRef.current,
        hasFinished: hasFinishedRef.current,
        hasSoundRef: !!soundRef.current,
        isPreloaded, // VOICE-PRELOAD: Include preload state
      });
    }

    try {
      // VOICE-LOOP-FIX: Check ref state, not React state (can be stale)
      if (isPlayingRef.current && soundRef.current) {
        // Pause - user explicitly requested pause
        if (__DEV__) console.log('[VOICE-LOOP-FIX] User pause:', messageId.slice(-6));
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
        if (__DEV__) console.log('[VOICE-LOOP-FIX] Resetting finished sound to start:', messageId.slice(-6));
        await soundRef.current.setPositionAsync(0);
        hasFinishedRef.current = false;
      }

      if (soundRef.current) {
        // VOICE-PRELOAD: Use preloaded sound - instant play!
        if (__DEV__) console.log('[VOICE-PRELOAD] Instant play (preloaded):', messageId.slice(-6));

        // Attach status callback for progress and finish handling
        soundRef.current.setOnPlaybackStatusUpdate(createStatusCallback());

        await soundRef.current.playAsync();
        isPlayingRef.current = true;
        setIsPlaying(true);
        currentPlayingSound = soundRef.current;
        currentPlayingId = messageId;
      } else {
        // VOICE-PRELOAD: Fallback - load and play if not preloaded
        if (__DEV__) console.log('[VOICE-PRELOAD] Fallback load (not preloaded):', messageId.slice(-6));
        hasFinishedRef.current = false;

        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: true },
          createStatusCallback()
        );

        soundRef.current = sound;
        currentPlayingSound = sound;
        currentPlayingId = messageId;
        isPlayingRef.current = true;
        setIsPlaying(true);
        setIsPreloaded(true); // Now loaded
        if (__DEV__) console.log('[VOICE-LOOP-FIX] Now playing:', messageId.slice(-6));
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
      }
    : {
        // Phase-1 light theme
        bubbleBg: isOwn ? COLORS.primary : '#F0F2F5',
        bubbleGradient: isOwn ? '#7B5BA6' : '#E8EAED',
        text: isOwn ? '#FFFFFF' : COLORS.text,
        textLight: isOwn ? 'rgba(255,255,255,0.75)' : COLORS.textLight,
        playBtnBg: isOwn ? 'rgba(255,255,255,0.25)' : COLORS.primary,
        playBtnIcon: '#FFFFFF',
        waveformActive: isOwn ? '#FFFFFF' : COLORS.primary,
        waveformInactive: isOwn ? 'rgba(255,255,255,0.4)' : 'rgba(107,74,148,0.3)',
        progressBg: isOwn ? 'rgba(255,255,255,0.25)' : 'rgba(107,74,148,0.15)',
        progressFill: isOwn ? '#FFFFFF' : COLORS.primary,
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
        {/* VOICE-UI-UPGRADE: Modern circular play button */}
        <View style={[styles.playButton, { backgroundColor: C.playBtnBg }]}>
          <Ionicons
            name={isUnavailable ? 'alert-circle' : isPlaying ? 'pause' : 'play'}
            size={22}
            color={isUnavailable ? C.textLight : C.playBtnIcon}
            style={!isUnavailable && !isPlaying ? { marginLeft: 2 } : undefined}
          />
        </View>

        {/* VOICE-UI-UPGRADE: Waveform visualization with progress overlay */}
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
                      height: 4 + height * 18, // 4-22px height range
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
  container: {
    maxWidth: '75%',
    minWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 18,
  },
  containerOwn: {
    borderBottomRightRadius: 6,
    alignSelf: 'flex-end',
  },
  containerOther: {
    borderBottomLeftRadius: 6,
    alignSelf: 'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // VOICE-UI-UPGRADE: Larger, more prominent play button
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // VOICE-UI-UPGRADE: Waveform container
  waveformContainer: {
    flex: 1,
    gap: 6,
  },
  waveformBars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
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
  // VOICE-TICKS: Footer for timestamp + tick alignment
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  timestamp: {
    fontSize: 10,
  },
  tickIcon: {
    marginLeft: 2,
  },
});
