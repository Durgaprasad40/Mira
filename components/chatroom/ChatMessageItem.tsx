import React, { useCallback, useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { INCOGNITO_COLORS } from '@/lib/constants';
import MediaMessage from '@/components/chat/MediaMessage';

const C = INCOGNITO_COLORS;

/**
 * CR-010: Validate media URI for playback safety
 * Returns true if:
 * - URI is a valid remote URL (http/https)
 * - URI is a local file that exists
 */
async function isValidMediaUri(uri: string | undefined): Promise<boolean> {
  if (!uri || typeof uri !== 'string') return false;

  // Remote URLs are valid (cloud storage)
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return true;
  }

  // Local file paths need existence check
  if (uri.startsWith('file://') || uri.startsWith('/')) {
    try {
      const fileUri = uri.startsWith('/') ? `file://${uri}` : uri;
      const info = await FileSystem.getInfoAsync(fileUri);
      return info.exists;
    } catch (e) {
      if (__DEV__) console.log('[MediaValidation] File check failed:', uri, e);
      return false;
    }
  }

  // content:// URIs (Android media) - assume valid
  if (uri.startsWith('content://')) {
    return true;
  }

  return false;
}

interface ChatMessageItemProps {
  /** Unique message ID (required for media view tracking) */
  messageId: string;
  senderName: string;
  senderId: string;
  senderAvatar?: string;
  text: string;
  timestamp: number;
  isMe?: boolean;
  /** Called on long-press with position for anchored popup */
  onLongPress?: (pageX: number, pageY: number) => void;
  onAvatarPress?: () => void;
  onNamePress?: () => void;
  dimmed?: boolean;
  /** Message type for media rendering */
  messageType?: 'text' | 'image' | 'video' | 'doodle' | 'audio';
  /** Media URL for image/video/doodle messages */
  mediaUrl?: string;
  /** Audio URL for audio messages */
  audioUrl?: string;
  /** Called when user starts holding media (opens viewer) - only for image/video */
  onMediaHoldStart?: (messageId: string, mediaUrl: string, type: 'image' | 'video') => void;
  /** Called when user releases hold (closes viewer) */
  onMediaHoldEnd?: () => void;
  /** Whether to show the timestamp (for grouping). Defaults to true. */
  showTimestamp?: boolean;
}

function ChatMessageItem({
  messageId,
  senderName,
  senderAvatar,
  text,
  isMe = false,
  onLongPress,
  onAvatarPress,
  onNamePress,
  dimmed = false,
  messageType = 'text',
  mediaUrl,
  audioUrl,
  onMediaHoldStart,
  onMediaHoldEnd,
}: ChatMessageItemProps) {
  const isMedia = (messageType === 'image' || messageType === 'video' || messageType === 'doodle') && mediaUrl;
  const isSecureMedia = messageType === 'image' || messageType === 'video';
  const isAudio = messageType === 'audio' && audioUrl;

  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioError, setAudioError] = useState(false); // CR-010: Track audio load errors
  const soundRef = useRef<Audio.Sound | null>(null);

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // CR-010: Reset error state when audioUrl changes
  useEffect(() => {
    setAudioError(false);
  }, [audioUrl]);

  // Handle audio play/pause
  // CR-010: Validate URL before playback to handle stale local cache paths
  const handleAudioPress = useCallback(async () => {
    if (!audioUrl) return;

    // CR-010: If we already know the audio is unavailable, don't retry
    if (audioError) return;

    try {
      if (isPlaying && soundRef.current) {
        // Pause
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }

      if (soundRef.current) {
        // Resume
        await soundRef.current.playAsync();
        setIsPlaying(true);
        return;
      }

      // CR-010: Validate URL before attempting to load
      setIsLoading(true);
      const isValid = await isValidMediaUri(audioUrl);
      if (!isValid) {
        if (__DEV__) console.log('[AudioPlayback] Invalid/missing audio URI:', audioUrl);
        setAudioError(true);
        setIsLoading(false);
        return;
      }

      // Load and play
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        }
      );
      soundRef.current = sound;
      setIsPlaying(true);
      setIsLoading(false);
    } catch (error) {
      console.error('[AudioPlayback] Error:', error);
      setAudioError(true); // CR-010: Mark as error so we show unavailable state
      setIsLoading(false);
      setIsPlaying(false);
    }
  }, [audioUrl, isPlaying, audioError]);

  // Memoize hold callbacks to prevent re-renders (only for secure media)
  const handleHoldStart = useCallback(() => {
    if (isSecureMedia && mediaUrl) {
      onMediaHoldStart?.(messageId, mediaUrl, messageType as 'image' | 'video');
    }
  }, [messageId, mediaUrl, messageType, isSecureMedia, onMediaHoldStart]);

  const handleHoldEnd = useCallback(() => {
    onMediaHoldEnd?.();
  }, [onMediaHoldEnd]);

  // Handle long press with position for anchored popup
  const handleLongPress = useCallback((event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    onLongPress?.(pageX, pageY);
  }, [onLongPress]);

  // Dense layout: Avatar on LEFT for others, RIGHT for me
  // Small name above bubble for others only, no timestamps
  return (
    <TouchableOpacity
      style={[styles.container, isMe && styles.containerMe, dimmed && styles.dimmed]}
      onLongPress={handleLongPress}
      activeOpacity={0.8}
      delayLongPress={400}
    >
      {/* Avatar - use Pressable for better nested touch handling */}
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          if (__DEV__) console.log('[TAP] ChatMessageItem avatar onPress fired');
          onAvatarPress?.();
        }}
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
      >
        {senderAvatar ? (
          <Image source={{ uri: senderAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarPlaceholder, isMe && styles.avatarPlaceholderMe]}>
            <Ionicons name="person" size={14} color={isMe ? '#FFFFFF' : C.textLight} />
          </View>
        )}
      </Pressable>

      {/* Content: Bubble with name inside for others */}
      <View style={[styles.content, isMe && styles.contentMe]}>
        {/* Message bubble */}
        {isMedia ? (
          <View style={styles.mediaContainer}>
            <MediaMessage
              messageId={messageId}
              mediaUrl={mediaUrl!}
              type={messageType as 'image' | 'video' | 'doodle'}
              onHoldStart={isSecureMedia ? handleHoldStart : undefined}
              onHoldEnd={isSecureMedia ? handleHoldEnd : undefined}
            />
          </View>
        ) : isAudio ? (
          <TouchableOpacity
            onPress={handleAudioPress}
            activeOpacity={0.7}
            disabled={audioError} // CR-010: Disable tap if audio unavailable
            style={[styles.bubble, styles.audioBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}
          >
            {/* Name inside bubble - only for other users */}
            {!isMe && (
              <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
                <Text style={styles.senderName}>{senderName}</Text>
              </TouchableOpacity>
            )}
            {/* CR-010: Show unavailable state if audio file is missing */}
            {audioError ? (
              <View style={styles.audioRow}>
                <View style={[styles.playButton, styles.playButtonError]}>
                  <Ionicons name="alert-circle" size={18} color={C.textLight} />
                </View>
                <Text style={styles.audioErrorText}>Audio unavailable</Text>
              </View>
            ) : (
              /* Audio message with play button */
              <View style={styles.audioRow}>
                {isLoading ? (
                  <ActivityIndicator size="small" color={isMe ? '#FFFFFF' : C.primary} />
                ) : (
                  <View style={[styles.playButton, isMe && styles.playButtonMe]}>
                    <Ionicons
                      name={isPlaying ? 'pause' : 'play'}
                      size={18}
                      color={isMe ? C.primary : '#FFFFFF'}
                    />
                  </View>
                )}
                <View style={styles.audioWaveform}>
                  {/* Simple waveform visualization - static heights */}
                  {[6, 10, 14, 8, 16, 12, 10, 6].map((h, i) => (
                    <View
                      key={i}
                      style={[
                        styles.waveformBar,
                        { height: h },
                        isMe ? styles.waveformBarMe : styles.waveformBarOther,
                        isPlaying && styles.waveformBarPlaying,
                      ]}
                    />
                  ))}
                </View>
                <Ionicons
                  name="mic"
                  size={14}
                  color={isMe ? 'rgba(255,255,255,0.7)' : C.textLight}
                />
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
            {/* Name inside bubble - only for other users */}
            {!isMe && (
              <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
                <Text style={styles.senderName}>{senderName}</Text>
              </TouchableOpacity>
            )}
            <Text style={[styles.messageText, isMe && styles.messageTextMe]}>{text}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(ChatMessageItem);

const styles = StyleSheet.create({
  // ── Dense message row ──
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
    paddingVertical: 3,
    gap: 6,
  },
  containerMe: {
    flexDirection: 'row-reverse',
  },
  dimmed: {
    opacity: 0.3,
  },
  // ── Avatar: compact size ──
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderMe: {
    backgroundColor: C.primary,
  },
  // ── Content area ──
  content: {
    maxWidth: '75%',
    gap: 2,
  },
  contentMe: {
    alignItems: 'flex-end',
  },
  // ── Sender name (inside bubble, others only) ──
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    color: C.primary,
    marginBottom: 2,
  },
  // ── Message bubble ──
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleOther: {
    backgroundColor: C.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: C.primary,
    borderBottomRightRadius: 4,
  },
  // ── Message text ──
  messageText: {
    fontSize: 13,
    lineHeight: 18,
    color: C.text,
  },
  messageTextMe: {
    color: '#FFFFFF',
  },
  // ── Media container (small thumbnails) ──
  mediaContainer: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  // ── Audio message ──
  audioBubble: {
    minWidth: 160,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonMe: {
    backgroundColor: '#FFFFFF',
  },
  // CR-010: Error state for unavailable audio
  playButtonError: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  audioErrorText: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic',
  },
  audioWaveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 24,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: C.textLight,
  },
  waveformBarMe: {
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  waveformBarOther: {
    backgroundColor: C.textLight,
  },
  waveformBarPlaying: {
    backgroundColor: C.primary,
  },
});
