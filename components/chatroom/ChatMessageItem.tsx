import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import MediaMessage from '@/components/chat/MediaMessage';
import { formatSmartTimestamp } from '@/utils/chatTime';

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
  /** Whether to show the timestamp (for grouping). Defaults to true. */
  showTimestamp?: boolean;
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
  showTimestamp = true,
}: ChatMessageItemProps) {
  const isMedia = (messageType === 'image' || messageType === 'video') && mediaUrl;

  // Layout: Avatar + Name/Time/Message
  // Others: avatar left, content right (row)
  // Me: avatar right, content left (row-reverse), aligned to right edge
  return (
    <TouchableOpacity
      style={[styles.container, isMe && styles.containerMe, dimmed && styles.dimmed]}
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
          {showTimestamp && (
            <Text style={styles.timeLabel}>{formatSmartTimestamp(timestamp)}</Text>
          )}
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
  containerMe: {
    flexDirection: 'row-reverse',
    alignSelf: 'flex-end',
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
