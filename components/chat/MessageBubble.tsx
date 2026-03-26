import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image, TouchableOpacity, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import MediaMessage from './MediaMessage';
import { ProtectedMediaBubble } from './ProtectedMediaBubble';
import { SystemMessage } from './SystemMessage';
import { VoiceMessageBubble } from './VoiceMessageBubble';
import { formatTime } from '@/utils/chatTime';

// Avatar size constant for consistent spacing
// AVATAR-ENLARGE: Increased from 28 to 34 for better visibility
const AVATAR_SIZE = 34;
const AVATAR_GAP = 8;

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
    // Video message fields (demo mode)
    videoUri?: string;
    videoDurationMs?: number;
    isProtected?: boolean;
    protectedMedia?: {
      localUri?: string;
      mediaType?: 'photo' | 'video';
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
    // SENDER-TIMER-FIX: New fields for sender status display
    viewOnce?: boolean;         // Whether this is view-once media
    recipientOpened?: boolean;  // Whether recipient has opened the media
    // MESSAGE-TICKS-FIX: Delivered status
    deliveredAt?: number;
    // Voice message fields
    audioUri?: string;      // Demo mode local URI
    audioUrl?: string;      // Production mode Convex URL
    durationMs?: number;
    audioDurationMs?: number; // Production mode duration
    // SECURE-REWRITE: Pending/optimistic message indicator
    isPending?: boolean;
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
  /** Whether to show the timestamp (for grouping). Defaults to true. */
  showTimestamp?: boolean;
  // AVATAR GROUPING: Show avatar only on last message of group for received messages
  /** Whether to show avatar (only for received messages, last in group) */
  showAvatar?: boolean;
  /** Avatar URL for the other user */
  avatarUrl?: string;
  /** Whether this is the last message in a sender group (for spacing) */
  isLastInGroup?: boolean;
  /** Callback when avatar is pressed (to open profile) */
  onAvatarPress?: () => void;
}

// Detect messages that are only emoji (1–8 emoji, no other text)
const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F]{1,8}$/u;

// System message marker for Convex mode (hidden from UI, used to detect system messages)
// Format: [SYSTEM:subtype]actual message content
const SYSTEM_MARKER_RE = /^\[SYSTEM:(\w+)\]/;

// MESSAGE-TICKS-FIX: Helper to determine message status and tick appearance
type TickStatus = 'sent' | 'delivered' | 'read';

function getTickStatus(message: { readAt?: number; deliveredAt?: number }): TickStatus {
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
}

function getTickIcon(status: TickStatus): 'checkmark' | 'checkmark-done' {
  return status === 'sent' ? 'checkmark' : 'checkmark-done';
}

function getTickColor(status: TickStatus, isOwn: boolean): string {
  if (status === 'read') {
    return '#34B7F1'; // Blue for read (WhatsApp-style)
  }
  // Gray/white for sent and delivered
  return isOwn ? 'rgba(255,255,255,0.8)' : COLORS.textLight;
}

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
  showTimestamp = true,
  showAvatar = false,
  avatarUrl,
  isLastInGroup = true,
  onAvatarPress,
}: MessageBubbleProps) {
  const isEmojiOnly = message.type === 'text' && EMOJI_ONLY_RE.test(message.content.trim());

  // Avatar rendering helper for received messages - tappable to open profile
  const renderAvatar = () => {
    if (isOwn) return null; // No avatar for sent messages

    // Only render avatar on last message in group (showAvatar=true)
    if (showAvatar) {
      // Compute initials fallback from otherUserName
      const initials = (() => {
        const name = otherUserName || '';
        const parts = name.split(' ').filter(Boolean);
        if (parts.length >= 2) {
          return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase() || '?';
      })();

      if (avatarUrl) {
        return (
          <TouchableOpacity
            onPress={onAvatarPress}
            activeOpacity={0.7}
            disabled={!onAvatarPress}
          >
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
            />
          </TouchableOpacity>
        );
      }
      // Fallback: show initials avatar when photoUrl is missing
      return (
        <TouchableOpacity
          onPress={onAvatarPress}
          activeOpacity={0.7}
          disabled={!onAvatarPress}
        >
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        </TouchableOpacity>
      );
    }
    // Spacer to maintain alignment when avatar is not shown (not last in group)
    return <View style={styles.avatarSpacer} />;
  };

  // System messages (native type) - no avatar, centered
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

  // SECURE-REWRITE: Pending/optimistic message (uploading secure photo)
  // Always own message, no avatar needed
  if (message.isPending) {
    return (
      <View style={[styles.container, styles.ownContainer]}>
        <View style={[styles.bubble, styles.ownBubble, styles.pendingBubble]}>
          <View style={styles.pendingContent}>
            <ActivityIndicator size="small" color={COLORS.white} />
            <Text style={styles.pendingText}>Sending secure photo...</Text>
          </View>
        </View>
      </View>
    );
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

    // TOUCH-FIX: Wrap protected media with Pressable for sender long-press delete
    // Receiver uses ProtectedMediaBubble's internal PanResponder for tap/hold to view
    const protectedMediaContent = (
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
          viewOnce={message.viewOnce}
          recipientOpened={message.recipientOpened}
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
            {isOwn && (() => {
              const tickStatus = getTickStatus(message);
              return (
                <Ionicons
                  name={getTickIcon(tickStatus)}
                  size={14}
                  color={getTickColor(tickStatus, isOwn)}
                  style={styles.readIcon}
                />
              );
            })()}
          </View>
        )}
      </View>
    );

    return (
      <View style={[
        styles.container,
        isOwn ? styles.ownContainer : styles.otherContainer,
        !isLastInGroup && styles.groupedContainer,
      ]}>
        {!isOwn && renderAvatar()}
        {protectedMediaContent}
      </View>
    );
  }

  // Unified media rendering for image, video
  // Check multiple possible URI fields: mediaUrl, imageUrl, videoUri
  const mediaUrl = message.mediaUrl || message.imageUrl || message.videoUri;
  const isMedia = (message.type === 'image' || message.type === 'video') && mediaUrl;

  if (isMedia) {
    return (
      <View style={[
        styles.container,
        isOwn ? styles.ownContainer : styles.otherContainer,
        !isLastInGroup && styles.groupedContainer,
      ]}>
        {!isOwn && renderAvatar()}
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
              {isOwn && (() => {
                const tickStatus = getTickStatus(message);
                return (
                  <Ionicons
                    name={getTickIcon(tickStatus)}
                    size={14}
                    color={getTickColor(tickStatus, isOwn)}
                    style={styles.readIcon}
                  />
                );
              })()}
            </View>
          </View>
      </View>
    );
  }

  // Voice message rendering (supports both demo audioUri and production audioUrl)
  // VOICE-FIX: Always render VoiceMessageBubble for voice type, even if audio source is missing
  // VoiceMessageBubble will show "Unavailable" state if URI is invalid
  const voiceAudioSource = message.audioUri || message.audioUrl || '';
  const voiceDuration = message.durationMs || message.audioDurationMs || 0;
  if (message.type === 'voice') {
    return (
      <View style={[
        styles.container,
        isOwn ? styles.ownContainer : styles.otherContainer,
        !isLastInGroup && styles.groupedContainer,
      ]}>
        {!isOwn && renderAvatar()}
        <VoiceMessageBubble
          messageId={message.id}
          audioUri={voiceAudioSource}
          durationMs={voiceDuration}
          isOwn={isOwn}
          timestamp={message.createdAt}
          onDelete={isOwn && onVoiceDelete ? () => onVoiceDelete(message.id) : undefined}
        />
      </View>
    );
  }

  if (message.type === 'dare') {
    return (
      <View style={[
        styles.container,
        isOwn ? styles.ownContainer : styles.otherContainer,
        !isLastInGroup && styles.groupedContainer,
      ]}>
        {!isOwn && renderAvatar()}
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
    <View style={[
      styles.container,
      isOwn ? styles.ownContainer : styles.otherContainer,
      !isLastInGroup && styles.groupedContainer,
    ]}>
      {/* Avatar for received messages */}
      {!isOwn && renderAvatar()}

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
        {showTimestamp && (
          <View style={styles.footer}>
            <Text style={[styles.time, isOwn && styles.ownTime]}>
              {formatTime(message.createdAt)}
            </Text>
            {isOwn && (() => {
              const tickStatus = getTickStatus(message);
              return (
                <Ionicons
                  name={getTickIcon(tickStatus)}
                  size={14}
                  color={getTickColor(tickStatus, isOwn)}
                  style={styles.readIcon}
                />
              );
            })()}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 3,
    paddingHorizontal: 12,
  },
  ownContainer: {
    justifyContent: 'flex-end',
  },
  otherContainer: {
    justifyContent: 'flex-start',
  },
  groupedContainer: {
    marginVertical: 1, // Tighter spacing for grouped messages
  },
  // Avatar styles
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    marginRight: AVATAR_GAP,
    backgroundColor: COLORS.backgroundDark,
  },
  avatarSpacer: {
    width: AVATAR_SIZE,
    marginRight: AVATAR_GAP,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  bubble: {
    maxWidth: '70%',
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    maxWidth: '70%',
  },
  protectedBubble: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: 'transparent',
  },
  // SECURE-REWRITE: Pending/uploading secure photo styles
  pendingBubble: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pendingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pendingText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '500',
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
    marginTop: 2,
    justifyContent: 'flex-end',
  },
  time: {
    fontSize: 11,
    color: COLORS.textLight,
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
