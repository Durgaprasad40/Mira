/**
 * DM Audio Bubble
 *
 * Audio message bubble for 1-on-1 DM chats.
 * Uses shared audio player store for single-audio playback.
 */
import React, { useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayerStore } from '@/stores/audioPlayerStore';

interface DmAudioBubbleProps {
  messageId: string;
  audioUrl: string;
  isMe: boolean;
  bubbleColor: string;
}

export default function DmAudioBubble({
  messageId,
  audioUrl,
  isMe,
  bubbleColor,
}: DmAudioBubbleProps) {
  const audioStore = useAudioPlayerStore();
  const isThisAudioActive = audioStore.currentMessageId === messageId;
  const isPlaying = isThisAudioActive && audioStore.isPlaying;
  const isLoading = isThisAudioActive && audioStore.isLoading;
  const audioProgress = isThisAudioActive ? audioStore.progress : 0;

  const handlePress = useCallback(async () => {
    await audioStore.toggle(messageId, audioUrl);
  }, [messageId, audioUrl, audioStore]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[styles.container, { backgroundColor: bubbleColor }]}
    >
      {/* Play/Pause button */}
      {isLoading ? (
        <View style={[styles.playButton, isMe && styles.playButtonMe]}>
          <ActivityIndicator size="small" color={isMe ? '#6D28D9' : '#FFFFFF'} />
        </View>
      ) : (
        <View style={[styles.playButton, isMe && styles.playButtonMe]}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={16}
            color={isMe ? '#6D28D9' : '#FFFFFF'}
          />
        </View>
      )}

      {/* Waveform with progress */}
      <View style={styles.waveformContainer}>
        <View style={styles.waveform}>
          {[4, 8, 12, 6, 14, 8, 16, 10, 12, 7, 14, 9, 11, 7, 10, 5, 8, 12].map((h, i) => {
            const barProgress = (i + 1) / 18;
            const isPlayed = audioProgress >= barProgress;
            return (
              <View
                key={i}
                style={[
                  styles.waveformBar,
                  { height: h },
                  isMe
                    ? (isPlayed ? styles.waveformBarMePlayed : styles.waveformBarMe)
                    : (isPlayed ? styles.waveformBarOtherPlayed : styles.waveformBarOther),
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Mic badge */}
      <View style={[styles.micBadge, isMe && styles.micBadgeMe]}>
        <Ionicons
          name="mic"
          size={10}
          color={isMe ? 'rgba(255,255,255,0.8)' : '#6D28D9'}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    minWidth: 200,
    maxWidth: 260,
    gap: 10,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playButtonMe: {
    backgroundColor: '#FFFFFF',
  },
  waveformContainer: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
    paddingHorizontal: 2,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
  },
  waveformBarMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  waveformBarOther: {
    backgroundColor: 'rgba(109, 40, 217, 0.35)',
  },
  waveformBarMePlayed: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  waveformBarOtherPlayed: {
    backgroundColor: '#6D28D9',
  },
  micBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(109, 40, 217, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  micBadgeMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
});
