/**
 * VoiceMessageBubble — Voice message playback UI with play/pause and progress
 *
 * Features:
 * - Play/pause button with progress indicator
 * - Duration label
 * - Only one voice message plays at a time (global singleton)
 * - Long-press for delete action sheet
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
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

interface VoiceMessageBubbleProps {
  messageId: string;
  audioUri: string;
  durationMs: number;
  isOwn: boolean;
  timestamp: number;
  onDelete?: () => void;
  /** For Phase-2 dark theme */
  darkTheme?: boolean;
}

export function VoiceMessageBubble({
  messageId,
  audioUri,
  durationMs,
  isOwn,
  timestamp,
  onDelete,
  darkTheme = false,
}: VoiceMessageBubbleProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isMountedRef = useRef(true);

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
      }
    };
  }, [messageId]);

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

  const handlePlayPause = useCallback(async () => {
    try {
      if (isPlaying && soundRef.current) {
        // Pause
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }

      // Stop any other playing voice message
      await stopCurrentPlaying();

      // Configure audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (soundRef.current) {
        // Resume
        await soundRef.current.playAsync();
        setIsPlaying(true);
        currentPlayingSound = soundRef.current;
        currentPlayingId = messageId;
      } else {
        // Load and play
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: true },
          (status) => {
            if (!isMountedRef.current) return;
            if (status.isLoaded) {
              setPlaybackPosition(status.positionMillis || 0);
              if (status.didJustFinish) {
                setIsPlaying(false);
                setPlaybackPosition(0);
                currentPlayingSound = null;
                currentPlayingId = null;
              }
            }
          }
        );

        soundRef.current = sound;
        currentPlayingSound = sound;
        currentPlayingId = messageId;
        setIsPlaying(true);
      }
    } catch (error) {
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
      setIsPlaying(false);
    }
  }, [isPlaying, audioUri, messageId]);

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

  // Theme colors
  const C = darkTheme
    ? {
        bubbleBg: isOwn ? '#3D3255' : '#2A2A3E',
        text: '#FFFFFF',
        textLight: 'rgba(255,255,255,0.6)',
        accent: '#9B7DC4',
        progressBg: 'rgba(255,255,255,0.2)',
        progressFill: '#9B7DC4',
      }
    : {
        bubbleBg: isOwn ? COLORS.primary : COLORS.backgroundDark,
        text: isOwn ? '#FFFFFF' : COLORS.text,
        textLight: isOwn ? 'rgba(255,255,255,0.7)' : COLORS.textLight,
        accent: isOwn ? '#FFFFFF' : COLORS.primary,
        progressBg: isOwn ? 'rgba(255,255,255,0.3)' : COLORS.border,
        progressFill: isOwn ? '#FFFFFF' : COLORS.primary,
      };

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: C.bubbleBg },
        isOwn ? styles.containerOwn : styles.containerOther,
      ]}
      onPress={handlePlayPause}
      onLongPress={handleLongPress}
      delayLongPress={400}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        {/* Play/Pause button */}
        <View style={[styles.playButton, { backgroundColor: C.accent + '30' }]}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={20}
            color={C.accent}
          />
        </View>

        {/* Progress bar and duration */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: C.progressBg }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: C.progressFill, width: `${progress * 100}%` },
              ]}
            />
          </View>
          <Text style={[styles.duration, { color: C.textLight }]}>
            {isPlaying ? formatDuration(playbackPosition) : formatDuration(durationMs)}
          </Text>
        </View>

        {/* Mic icon indicator */}
        <Ionicons name="mic" size={14} color={C.textLight} style={styles.micIcon} />
      </View>

      {/* Timestamp */}
      <Text style={[styles.timestamp, { color: C.textLight }]}>
        {formatTime(timestamp)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    maxWidth: '75%',
    minWidth: 180,
    padding: 10,
    borderRadius: 16,
  },
  containerOwn: {
    borderBottomRightRadius: 4,
  },
  containerOther: {
    borderBottomLeftRadius: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    flex: 1,
    gap: 4,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  duration: {
    fontSize: 11,
    fontWeight: '500',
  },
  micIcon: {
    marginLeft: 4,
  },
  timestamp: {
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
  },
});
