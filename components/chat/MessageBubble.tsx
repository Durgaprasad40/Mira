import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import MediaMessage from './MediaMessage';
import { ProtectedMediaBubble } from './ProtectedMediaBubble';
import { SystemMessage } from './SystemMessage';

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    type: 'text' | 'image' | 'video' | 'template' | 'dare' | 'system';
    senderId: string;
    createdAt: number;
    readAt?: number;
    imageUrl?: string;
    mediaUrl?: string;
    isProtected?: boolean;
    protectedMedia?: {
      timer: number;
      screenshotAllowed: boolean;
      viewOnce: boolean;
      watermark: boolean;
    };
    isExpired?: boolean;
    viewedAt?: number;
    systemSubtype?: string;
    mediaId?: string;
  };
  isOwn: boolean;
  otherUserName?: string;
  currentUserId?: string;
  onMediaPress?: (mediaUrl: string, type: 'image' | 'video') => void;
  onProtectedMediaPress?: (messageId: string) => void;
}

export function MessageBubble({ message, isOwn, otherUserName, currentUserId, onMediaPress, onProtectedMediaPress }: MessageBubbleProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // System messages
  if (message.type === 'system') {
    return <SystemMessage text={message.content} subtype={message.systemSubtype as any} />;
  }

  // Protected media messages (detected via mediaId or isProtected flag)
  if (message.isProtected || message.mediaId) {
    return (
      <View style={[styles.container, isOwn && styles.ownContainer]}>
        <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
          <ProtectedMediaBubble
            mediaId={message.mediaId}
            userId={currentUserId}
            protectedMedia={message.protectedMedia}
            isExpired={!!message.isExpired}
            isOwn={isOwn}
            onPress={() => onProtectedMediaPress?.(message.id)}
          />
          <View style={styles.imageFooter}>
            <Text style={[styles.time, isOwn && styles.ownTime]}>
              {formatTime(message.createdAt)}
            </Text>
            {isOwn && (
              <Ionicons
                name={message.readAt ? 'checkmark-done' : 'checkmark'}
                size={14}
                color={isOwn ? COLORS.white : COLORS.textLight}
                style={styles.readIcon}
              />
            )}
          </View>
        </View>
      </View>
    );
  }

  // Unified media rendering for image, video
  const mediaUrl = message.mediaUrl || message.imageUrl;
  const isMedia = (message.type === 'image' || message.type === 'video') && mediaUrl;

  if (isMedia) {
    return (
      <View style={[styles.container, isOwn && styles.ownContainer]}>
        <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
          <MediaMessage
            mediaUrl={mediaUrl!}
            type={message.type as 'image' | 'video'}
            onPress={() => onMediaPress?.(mediaUrl!, message.type as 'image' | 'video')}
          />
          <View style={styles.imageFooter}>
            <Text style={[styles.time, isOwn && styles.ownTime]}>
              {formatTime(message.createdAt)}
            </Text>
            {isOwn && (
              <Ionicons
                name={message.readAt ? 'checkmark-done' : 'checkmark'}
                size={14}
                color={isOwn ? COLORS.white : COLORS.textLight}
                style={styles.readIcon}
              />
            )}
          </View>
        </View>
      </View>
    );
  }

  if (message.type === 'dare') {
    return (
      <View style={[styles.container, isOwn && styles.ownContainer]}>
        <View style={[styles.bubble, styles.dareBubble, isOwn && styles.ownBubble]}>
          <View style={styles.dareHeader}>
            <Ionicons name="dice" size={20} color={COLORS.white} />
            <Text style={styles.dareTitle}>
              {isOwn ? 'Dare Sent' : `${otherUserName || 'Someone'} sent a dare`}
            </Text>
          </View>
          <Text style={styles.dareContent}>{message.content}</Text>
          <Text style={[styles.time, styles.dareTime]}>{formatTime(message.createdAt)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isOwn && styles.ownContainer]}>
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
        <Text style={[styles.text, isOwn && styles.ownText]}>{message.content}</Text>
        <View style={styles.footer}>
          <Text style={[styles.time, isOwn && styles.ownTime]}>
            {formatTime(message.createdAt)}
          </Text>
          {isOwn && (
            <Ionicons
              name={message.readAt ? 'checkmark-done' : 'checkmark'}
              size={14}
              color={isOwn ? COLORS.white : COLORS.textLight}
              style={styles.readIcon}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  ownContainer: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
  },
  ownBubble: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: COLORS.backgroundDark,
    borderBottomLeftRadius: 4,
  },
  dareBubble: {
    backgroundColor: COLORS.secondary,
    maxWidth: '85%',
  },
  text: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
  },
  ownText: {
    color: COLORS.white,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    justifyContent: 'flex-end',
  },
  time: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 4,
  },
  ownTime: {
    color: COLORS.white,
    opacity: 0.8,
  },
  readIcon: {
    marginLeft: 4,
  },
  imageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dareTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
    marginLeft: 8,
  },
  dareContent: {
    fontSize: 15,
    color: COLORS.white,
    lineHeight: 20,
    marginBottom: 8,
  },
  dareTime: {
    color: COLORS.white,
    opacity: 0.8,
  },
});
