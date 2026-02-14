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

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes < 10 ? `0${minutes}` : minutes;
  const timeStr = `${h}:${m} ${ampm}`;

  if (isToday) {
    return timeStr;
  }

  // Show date + time for older messages
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${timeStr}`;
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

  // Layout: Avatar (left) | Name + Time (line 1), Message (line 2)
  // Same layout for both "me" and "others" - only styling differs
  return (
    <TouchableOpacity
      style={[styles.container, dimmed && styles.dimmed]}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      delayLongPress={400}
    >
      {/* Avatar */}
      <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.7}>
        {senderAvatar ? (
          <Image source={{ uri: senderAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarPlaceholder, isMe && styles.avatarPlaceholderMe]}>
            <Ionicons name="person" size={16} color={isMe ? '#FFFFFF' : C.textLight} />
          </View>
        )}
      </TouchableOpacity>

      {/* Content: Name + Time (row 1), Message (row 2) */}
      <View style={styles.content}>
        {/* Row 1: Name (bold) + Time (right) */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
            <Text style={[styles.senderName, isMe && styles.senderNameMe]}>
              {isMe ? 'You' : senderName}
            </Text>
          </TouchableOpacity>
          <Text style={styles.timeLabel}>{formatDateTime(timestamp)}</Text>
        </View>

        {/* Row 2: Message text or media */}
        {isMedia ? (
          <View style={styles.mediaContainer}>
            <MediaMessage
              mediaUrl={mediaUrl!}
              type={messageType as 'image' | 'video'}
              onPress={() => onMediaPress?.(mediaUrl!, messageType as 'image' | 'video')}
            />
          </View>
        ) : (
          <Text style={styles.messageText}>{text}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(ChatMessageItem);

const styles = StyleSheet.create({
  // ── Message row with MEDIUM spacing ──
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },
  dimmed: {
    opacity: 0.3,
  },
  // ── Avatar: slightly larger for better visibility ──
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderMe: {
    backgroundColor: C.primary,
  },
  // ── Content area ──
  content: {
    flex: 1,
    gap: 4,
  },
  // ── Header row: Name (bold, left) + Time (right) ──
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  senderName: {
    fontSize: 14,
    fontWeight: '700',
    color: C.primary,
  },
  senderNameMe: {
    color: '#6B5CE7',
  },
  timeLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  // ── Message text ──
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    color: C.text,
  },
  // ── Media container ──
  mediaContainer: {
    marginTop: 4,
    maxWidth: '85%',
  },
});
