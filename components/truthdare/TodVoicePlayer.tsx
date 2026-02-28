/**
 * TodVoicePlayer — Simple voice playback for Truth/Dare answers
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { create } from 'zustand';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

// ============================================================
// Singleton store for voice playback state (replaces module globals)
// Ensures only one voice plays at a time across all TodVoicePlayer instances
// ============================================================
interface VoicePlaybackState {
  currentSound: Audio.Sound | null;
  currentId: string | null;
  setPlaying: (sound: Audio.Sound, id: string) => void;
  clearPlaying: (id: string) => void;
  stopCurrentAndSet: (newSound: Audio.Sound, newId: string) => Promise<void>;
}

const useVoicePlaybackStore = create<VoicePlaybackState>((set, get) => ({
  currentSound: null,
  currentId: null,

  setPlaying: (sound, id) => {
    set({ currentSound: sound, currentId: id });
  },

  clearPlaying: (id) => {
    const state = get();
    if (state.currentId === id) {
      set({ currentSound: null, currentId: null });
    }
  },

  stopCurrentAndSet: async (newSound, newId) => {
    const state = get();
    const prevId = state.currentId;

    // Stop previous sound if different from new one
    if (state.currentSound && state.currentId !== newId) {
      const prevIdPrefix = prevId?.substring(0, 8) ?? 'none';
      const newIdPrefix = newId.substring(0, 8);
      console.log(`[T/D VOICE] switch from=${prevIdPrefix} to=${newIdPrefix}`);

      try {
        await state.currentSound.stopAsync();
        await state.currentSound.unloadAsync();
      } catch {
        // Ignore cleanup errors
      }
    }

    set({ currentSound: newSound, currentId: newId });
  },
}))

interface TodVoicePlayerProps {
  answerId: string;
  audioUrl: string;
  durationSec: number;
}

export function TodVoicePlayer({ answerId, audioUrl, durationSec }: TodVoicePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isMountedRef = useRef(true);

  // Access store actions (stable references via getState)
  const { clearPlaying, stopCurrentAndSet } = useVoicePlaybackStore.getState();

  const formatDuration = (sec: number) => {
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}:${s.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        clearPlaying(answerId);
      }
    };
  }, [answerId, clearPlaying]);

  const handlePlayPause = useCallback(async () => {
    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (soundRef.current) {
        // Resume existing sound - stop any other playing first
        await stopCurrentAndSet(soundRef.current, answerId);
        await soundRef.current.playAsync();
        setIsPlaying(true);
      } else {
        // Load and play new sound
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          (status) => {
            if (!isMountedRef.current) return;
            if (status.isLoaded) {
              const pos = status.positionMillis || 0;
              const dur = status.durationMillis || (durationSec * 1000);
              setProgress(dur > 0 ? pos / dur : 0);

              if (status.didJustFinish) {
                setIsPlaying(false);
                setProgress(0);
                soundRef.current?.unloadAsync().catch(() => {});
                soundRef.current = null;
                clearPlaying(answerId);
              }
            }
          }
        );

        soundRef.current = sound;
        // Stop any other playing sound and register this one
        await stopCurrentAndSet(sound, answerId);
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('[TodVoicePlayer] Playback error:', error);
      setIsPlaying(false);
    }
  }, [isPlaying, audioUrl, answerId, durationSec, clearPlaying, stopCurrentAndSet]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handlePlayPause} style={styles.playBtn}>
        <Ionicons
          name={isPlaying ? 'pause-circle' : 'play-circle'}
          size={36}
          color={C.primary}
        />
      </TouchableOpacity>
      <View style={styles.waveform}>
        {Array.from({ length: 16 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.waveBar,
              {
                height: 4 + (i % 4) * 6,
                opacity: progress > i / 16 ? 1 : 0.4,
              },
            ]}
          />
        ))}
      </View>
      <Text style={styles.duration}>{formatDuration(durationSec)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
    marginBottom: 8,
  },
  playBtn: {
    padding: 2,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: C.primary,
  },
  duration: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
});
