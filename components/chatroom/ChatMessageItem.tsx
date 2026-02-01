import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

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
  messageType?: 'text' | 'image' | 'gif' | 'video';
  /** Media URL for image/gif/video messages */
  mediaUrl?: string;
  /** Called when user taps a media bubble (image/gif for preview, video for playback) */
  onMediaPress?: (mediaUrl: string, type: 'image' | 'gif' | 'video') => void;
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

function MediaBubble({
  mediaUrl,
  messageType,
  onPress,
}: {
  mediaUrl: string;
  messageType: 'image' | 'gif' | 'video';
  onPress?: () => void;
}) {
  if (messageType === 'video') {
    return (
      <TouchableOpacity style={styles.mediaBubble} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.videoThumb}>
          <Ionicons name="play-circle" size={44} color="rgba(255,255,255,0.9)" />
          <Text style={styles.videoLabel}>Video</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // image or gif
  return (
    <TouchableOpacity style={styles.mediaBubble} onPress={onPress} activeOpacity={0.8}>
      <Image
        source={{ uri: mediaUrl }}
        style={styles.mediaImage}
        contentFit="cover"
        recyclingKey={mediaUrl}
      />
      {messageType === 'gif' && (
        <View style={styles.gifBadge}>
          <Text style={styles.gifBadgeText}>GIF</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ChatMessageItem({
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
  const isMedia = (messageType === 'image' || messageType === 'gif' || messageType === 'video') && mediaUrl;

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
            <MediaBubble
              mediaUrl={mediaUrl!}
              messageType={messageType as 'image' | 'gif' | 'video'}
              onPress={() => onMediaPress?.(mediaUrl!, messageType as 'image' | 'gif' | 'video')}
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
          <MediaBubble
            mediaUrl={mediaUrl!}
            messageType={messageType as 'image' | 'gif' | 'video'}
            onPress={() => onMediaPress?.(mediaUrl!, messageType as 'image' | 'gif' | 'video')}
          />
        ) : (
          <Text style={styles.messageText}>{text}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

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
  // ── Media bubbles ──
  mediaBubble: {
    width: 200,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.surface,
    marginTop: 2,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  gifBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gifBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  videoThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2C2C3A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  videoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textLight,
  },
});
