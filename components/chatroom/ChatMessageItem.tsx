import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import MediaMessage from '@/components/chat/MediaMessage';

const C = INCOGNITO_COLORS;

interface ChatMessageItemProps {
  /** Unique message ID (required for media view tracking) */
  messageId: string;
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
  messageType?: 'text' | 'image' | 'video' | 'doodle';
  /** Media URL for image/video/doodle messages */
  mediaUrl?: string;
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
  onMediaHoldStart,
  onMediaHoldEnd,
}: ChatMessageItemProps) {
  const isMedia = (messageType === 'image' || messageType === 'video' || messageType === 'doodle') && mediaUrl;
  const isSecureMedia = messageType === 'image' || messageType === 'video';

  // Dense layout: Avatar on LEFT for others, RIGHT for me
  // Small name above bubble for others only, no timestamps
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
            <Ionicons name="person" size={14} color={isMe ? '#FFFFFF' : C.textLight} />
          </View>
        )}
      </TouchableOpacity>

      {/* Content: Bubble with name inside for others */}
      <View style={[styles.content, isMe && styles.contentMe]}>
        {/* Message bubble */}
        {isMedia ? (
          <View style={styles.mediaContainer}>
            <MediaMessage
              messageId={messageId}
              mediaUrl={mediaUrl!}
              type={messageType as 'image' | 'video' | 'doodle'}
              onHoldStart={isSecureMedia ? () => onMediaHoldStart?.(messageId, mediaUrl!, messageType as 'image' | 'video') : undefined}
              onHoldEnd={isSecureMedia ? onMediaHoldEnd : undefined}
            />
          </View>
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
});
