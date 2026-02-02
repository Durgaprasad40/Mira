import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import MediaMessage from '@/components/chat/MediaMessage';

const C = INCOGNITO_COLORS;

interface ChatMessageItemProps {
  senderName: string;
  senderId: string;
  senderAvatar?: string;
  text: string;
  timestamp: number;
  isMe?: boolean;
  onLongPress?: () => void;
  onAvatarPress?: () => void;
  onNamePress?: () => void;
  dimmed?: boolean;
  /** Message type for media rendering */
  messageType?: 'text' | 'image' | 'video';
  /** Media URL for image/video messages */
  mediaUrl?: string;
  /** Called when user taps a media bubble (image for preview, video for playback) */
  onMediaPress?: (mediaUrl: string, type: 'image' | 'video') => void;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes < 10 ? `0${minutes}` : minutes;
  return `${h}:${m} ${ampm}`;
}

function ChatMessageItem({
  senderName,
  senderId,
  senderAvatar,
  text,
  timestamp,
  isMe = false,
  onLongPress,
  onAvatarPress,
  onNamePress,
  dimmed = false,
  messageType = 'text',
  mediaUrl,
  onMediaPress,
}: ChatMessageItemProps) {
  const isMedia = (messageType === 'image' || messageType === 'video') && mediaUrl;

  if (isMe) {
    return (
      <TouchableOpacity
        style={[styles.containerMe, dimmed && styles.dimmed]}
        onLongPress={onLongPress}
        activeOpacity={0.8}
        delayLongPress={400}
      >
        <View style={styles.contentMe}>
          <Text style={styles.meTime}>{formatTime(timestamp)}</Text>
          {isMedia ? (
            <MediaMessage
              mediaUrl={mediaUrl!}
              type={messageType as 'image' | 'video'}
              onPress={() => onMediaPress?.(mediaUrl!, messageType as 'image' | 'video')}
            />
          ) : (
            <View style={styles.bubbleMe}>
              <Text style={styles.messageTextMe}>{text}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.container, dimmed && styles.dimmed]}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      delayLongPress={400}
    >
      <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.7}>
        {senderAvatar ? (
          <Image source={{ uri: senderAvatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={12} color={C.textLight} />
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Name + time on same line */}
        <TouchableOpacity onPress={onNamePress} activeOpacity={0.7} style={styles.nameRow}>
          <Text style={styles.senderName}>{senderName}</Text>
          <Text style={styles.timeLabel}>{formatTime(timestamp)}</Text>
        </TouchableOpacity>
        {isMedia ? (
          <MediaMessage
            mediaUrl={mediaUrl!}
            type={messageType as 'image' | 'video'}
            onPress={() => onMediaPress?.(mediaUrl!, messageType as 'image' | 'video')}
          />
        ) : (
          <Text style={styles.messageText}>{text}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(ChatMessageItem);

const styles = StyleSheet.create({
  // ── Other users: left-aligned ──
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  dimmed: {
    opacity: 0.3,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 6,
    marginTop: 2,
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '700',
    color: C.primary,
  },
  timeLabel: {
    fontSize: 10,
    color: C.textLight,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 18,
    color: C.text,
    marginTop: 1,
  },
  // ── My messages: right-aligned ──
  containerMe: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  contentMe: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    maxWidth: '80%',
    gap: 4,
  },
  meTime: {
    fontSize: 10,
    color: C.textLight,
    marginBottom: 2,
  },
  bubbleMe: {
    backgroundColor: C.accent,
    borderRadius: 12,
    borderTopRightRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  messageTextMe: {
    fontSize: 14,
    lineHeight: 18,
    color: C.text,
  },
});
