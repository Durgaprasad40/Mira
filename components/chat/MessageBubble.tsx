import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import MediaMessage from './MediaMessage';
import { ProtectedMediaBubble } from './ProtectedMediaBubble';
import { SystemMessage } from './SystemMessage';
import { VoiceMessageBubble } from './VoiceMessageBubble';

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    type: 'text' | 'image' | 'video' | 'template' | 'dare' | 'system' | 'voice';
    senderId: string;
    createdAt: number;
    readAt?: number;
    imageUrl?: string;
    mediaUrl?: string;
    isProtected?: boolean;
    protectedMedia?: {
      timer: number;
      viewingMode?: 'tap' | 'hold';
      screenshotAllowed: boolean;
      viewOnce: boolean;
      watermark: boolean;
    };
    isExpired?: boolean;
    timerEndsAt?: number;   // Wall-clock time when timer expires
    expiredAt?: number;     // Wall-clock time when expired (for auto-removal)
    viewedAt?: number;
    systemSubtype?: string;
    mediaId?: string;
    // Voice message fields
    audioUri?: string;
    durationMs?: number;
  };
  isOwn: boolean;
  otherUserName?: string;
  currentUserId?: string;
  onMediaPress?: (mediaUrl: string, type: 'image' | 'video') => void;
  onProtectedMediaPress?: (messageId: string) => void;
  onProtectedMediaHoldStart?: (messageId: string) => void;
  onProtectedMediaHoldEnd?: (messageId: string) => void;
  onProtectedMediaExpire?: (messageId: string) => void;
  onVoiceDelete?: (messageId: string) => void;
}

// Detect messages that are only emoji (1–8 emoji, no other text)
const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]{1,8}$/u;

// System message marker for Convex mode (hidden from UI, used to detect system messages)
// Format: [SYSTEM:subtype]actual message content
const SYSTEM_MARKER_RE = /^\[SYSTEM:(\w+)\]/;

export function MessageBubble({
  message,
  isOwn,
  otherUserName,
  currentUserId,
  onMediaPress,
  onProtectedMediaPress,
  onProtectedMediaHoldStart,
  onProtectedMediaHoldEnd,
  onProtectedMediaExpire,
  onVoiceDelete,
}: MessageBubbleProps) {
  const isEmojiOnly = message.type === 'text' && EMOJI_ONLY_RE.test(message.content.trim());

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // System messages (native type)
  if (message.type === 'system') {
    return <SystemMessage text={message.content} subtype={message.systemSubtype as any} />;
  }

  // Detect system messages via hidden marker (Convex fallback)
  // Format: [SYSTEM:subtype]actual message content
  if (message.type === 'text') {
    const markerMatch = message.content.match(SYSTEM_MARKER_RE);
    if (markerMatch) {
      const subtype = markerMatch[1];
      const displayText = message.content.slice(markerMatch[0].length);
      return <SystemMessage text={displayText} subtype={subtype as any} />;
    }
  }

  // Protected media messages (detected via mediaId or isProtected flag)
  if (message.isProtected || message.mediaId) {
    // Auto-hide expired messages after 60s
    if (message.isExpired && message.expiredAt) {
      const timeSinceExpiry = Date.now() - message.expiredAt;
      if (timeSinceExpiry > 60_000) {
        return null; // Hide entirely
      }
    }

    return (
      <View style={[styles.container, isOwn && styles.ownContainer]}>
        <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble, styles.protectedBubble]}>
          <ProtectedMediaBubble
            messageId={message.id}
            mediaId={message.mediaId}
            userId={currentUserId}
            protectedMedia={message.protectedMedia as any}
            timerEndsAt={message.timerEndsAt}
            isExpired={!!message.isExpired}
            expiredAt={message.expiredAt}
            isOwn={isOwn}
            onPress={() => onProtectedMediaPress?.(message.id)}
            onHoldStart={() => onProtectedMediaHoldStart?.(message.id)}
            onHoldEnd={() => onProtectedMediaHoldEnd?.(message.id)}
            onExpire={() => onProtectedMediaExpire?.(message.id)}
          />
          {!message.isExpired && (
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
          )}
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

  // Voice message rendering
  if (message.type === 'voice' && message.audioUri) {
    return (
      <View style={[styles.container, isOwn && styles.ownContainer]}>
        <VoiceMessageBubble
          messageId={message.id}
          audioUri={message.audioUri}
          durationMs={message.durationMs || 0}
          isOwn={isOwn}
          timestamp={message.createdAt}
          onDelete={isOwn && onVoiceDelete ? () => onVoiceDelete(message.id) : undefined}
        />
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
      <View style={[
        styles.bubble,
        isOwn ? styles.ownBubble : styles.otherBubble,
        isEmojiOnly && styles.emojiBubble,
      ]}>
        <Text style={[
          styles.text,
          isOwn && styles.ownText,
          isEmojiOnly && styles.emojiText,
        ]}>
          {message.content}
        </Text>
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
  protectedBubble: {
    padding: 6,
    backgroundColor: 'transparent',
  },
  emojiBubble: {
    backgroundColor: 'transparent',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  text: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
    flexShrink: 1,
  },
  ownText: {
    color: COLORS.white,
  },
  emojiText: {
    fontSize: 36,
    lineHeight: 44,
    textAlign: 'center',
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
