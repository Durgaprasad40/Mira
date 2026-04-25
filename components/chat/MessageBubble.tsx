/**
 * LOCKED (MESSAGE BUBBLE)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - P0 audit passed: renders backend message data correctly
 * - Used by Phase-1 messaging (ChatScreenInner)
 */
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image, TouchableOpacity, Alert, Pressable, Dimensions } from 'react-native';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import MediaMessage from './MediaMessage';
import { ProtectedMediaBubble } from './ProtectedMediaBubble';
import { SystemMessage } from './SystemMessage';
import { VoiceMessageBubble } from './VoiceMessageBubble';
import UploadProgressRing from '@/components/chatroom/UploadProgressRing';
import { formatTime } from '@/utils/chatTime';

// ═══════════════════════════════════════════════════════════════════════════
// LAYOUT CONSTANTS - Tight, modern chat layout (WhatsApp/Telegram density)
// ═══════════════════════════════════════════════════════════════════════════
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Avatar sizing - larger, premium presence; left-side uses real estate well.
// AVATAR-PREMIUM: bumped from 26 → 34 so received messages have a clear
// identity anchor without crowding the bubble.
const AVATAR_SIZE = 34;
// LEFT-TIGHTEN: gap from 6 → 4 so the bubble hugs the avatar more closely
// without losing visual breathing room.
const AVATAR_GAP = 4;

// Bubble constraints - maximize usable width.
// LEFT-SIDE-USE: bumped from 0.80 → 0.86 so received messages can take
// closer to ~90% of usable width once avatar gutter is accounted for.
const MAX_BUBBLE_WIDTH = Math.min(SCREEN_WIDTH * 0.86, 340);

// Border radius for premium rounded look
const BUBBLE_RADIUS = 18;
const BUBBLE_TAIL_RADIUS = 4; // Smaller radius for the tail corner

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    type: 'text' | 'image' | 'video' | 'template' | 'dare' | 'system' | 'voice';
    senderId: string;
    createdAt: number;
    readAt?: number;
    readReceiptVisible?: boolean;
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
    // [P1_MEDIA_UPLOAD] pending secure media optimistic preview + progress
    localUri?: string;
    uploadStatus?: 'uploading' | 'sending' | 'upload_failed' | 'send_failed';
    uploadProgress?: number;
    errorMessage?: string;
  };
  isOwn: boolean;
  otherUserName?: string;
  currentUserId?: string;
  currentUserToken?: string;
  onMediaPress?: (mediaUrl: string, type: 'image' | 'video') => void;
  onProtectedMediaPress?: (messageId: string) => void;
  onProtectedMediaHoldStart?: (messageId: string) => void;
  onProtectedMediaHoldEnd?: (messageId: string) => void;
  onProtectedMediaExpire?: (messageId: string) => void;
  onVoiceDelete?: (messageId: string) => void;
  // [P1_MEDIA_UPLOAD] tap-to-retry handler for failed pending media
  onRetryPendingMedia?: (messageId: string) => void;
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

function getTickStatus(message: { readAt?: number; deliveredAt?: number; readReceiptVisible?: boolean }): TickStatus {
  if (message.readReceiptVisible !== false && message.readAt) return 'read';
  if (message.deliveredAt || message.readAt) return 'delivered';
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

function MessageBubbleComponent({
  message,
  isOwn,
  otherUserName,
  currentUserId,
  currentUserToken,
  onMediaPress,
  onProtectedMediaPress,
  onProtectedMediaHoldStart,
  onProtectedMediaHoldEnd,
  onProtectedMediaExpire,
  onVoiceDelete,
  onRetryPendingMedia,
  showTimestamp = true,
  showAvatar = false,
  avatarUrl,
  isLastInGroup = true,
  onAvatarPress,
}: MessageBubbleProps) {
  const isEmojiOnly = message.type === 'text' && EMOJI_ONLY_RE.test(message.content.trim());

  // Entry animation: subtle fade + slide up for new messages
  const enteringAnimation = FadeIn.duration(180).withInitialValues({
    opacity: 0,
    transform: [{ translateY: 6 }],
  });

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

      // TD-AUTO-HIDE: All Truth/Dare system notifications are transient by
      // design. Once the recipient has seen the message (readAt set), hide
      // it after 1 minute. Hard cap at 3 minutes from creation regardless
      // of read state so abandoned T/D banners don't linger forever.
      // UI-only suppression — the underlying message still exists in DB.
      if (subtype === 'truthdare') {
        const ONE_MIN = 60 * 1000;
        const THREE_MIN = 3 * 60 * 1000;
        const now = Date.now();
        if (message.readAt && now - message.readAt > ONE_MIN) {
          return null;
        }
        if (now - message.createdAt > THREE_MIN) {
          return null;
        }
      }

      return <SystemMessage text={displayText} subtype={subtype as any} />;
    }
  }

  // SECURE-REWRITE: Pending/optimistic message (uploading secure photo)
  // Always own message, no avatar needed
  // [P1_MEDIA_UPLOAD] When a localUri is available we render a real preview
  // thumbnail plus a progress ring (uploading) / spinner (sending) /
  // "Tap to retry" pill (upload_failed or send_failed), mirroring the
  // Phase-2 chat-rooms UX. Legacy code path (no localUri) falls through to
  // the original text-only bubble.
  if (message.isPending) {
    const pendingLabel = message.content.trim().length > 0
      ? message.content
      : message.type === 'video'
        ? 'Sending secure video...'
        : 'Sending secure photo...';

    if (message.localUri) {
      const isUploading = message.uploadStatus === 'uploading';
      const isSending = message.uploadStatus === 'sending';
      const hasFailed =
        message.uploadStatus === 'upload_failed' || message.uploadStatus === 'send_failed';
      const progress = Math.max(0, Math.min(100, message.uploadProgress ?? 0));
      const previewContent = (
        <View style={styles.pendingMediaFrame}>
          <Image
            source={{ uri: message.localUri }}
            style={styles.pendingMediaImage}
            resizeMode="cover"
          />
          {message.type === 'video' && (
            <View style={styles.pendingVideoGlyph}>
              <Ionicons name="play-circle" size={20} color="rgba(255,255,255,0.92)" />
            </View>
          )}
          <View style={styles.pendingOverlay}>
            {isUploading ? (
              <View style={styles.pendingCol}>
                {/* SIZE-REDUCE: smaller ring to match the shrunken frame */}
                <UploadProgressRing progress={progress} size={36} strokeWidth={3} />
              </View>
            ) : isSending ? (
              <View style={styles.pendingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.pendingSubtext}>Sending…</Text>
              </View>
            ) : hasFailed ? (
              <View style={styles.pendingRow}>
                <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
                <Text style={styles.pendingSubtext}>Tap to retry</Text>
              </View>
            ) : (
              <View style={styles.pendingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.pendingSubtext}>{pendingLabel}</Text>
              </View>
            )}
          </View>
        </View>
      );

      return (
        <View style={[styles.container, styles.ownContainer]}>
          <View style={[styles.bubble, styles.ownBubble, styles.pendingMediaBubble]}>
            {hasFailed && onRetryPendingMedia ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onRetryPendingMedia(message.id)}
                accessibilityRole="button"
                accessibilityLabel="Tap to retry sending"
              >
                {previewContent}
              </TouchableOpacity>
            ) : (
              previewContent
            )}
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.container, styles.ownContainer]}>
        <View style={[styles.bubble, styles.ownBubble, styles.pendingBubble]}>
          <View style={styles.pendingContent}>
            <ActivityIndicator size="small" color={COLORS.white} />
            <Text style={styles.pendingText}>{pendingLabel}</Text>
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
          authToken={currentUserToken}
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
        {!message.isExpired && (showTimestamp || isOwn) && (
          <View style={[styles.imageFooter, !showTimestamp && styles.statusOnlyFooter]}>
            {showTimestamp && (
              <Text style={[styles.time, isOwn && styles.ownTime]}>
                {formatTime(message.createdAt)}
              </Text>
            )}
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
      <Animated.View
        entering={enteringAnimation}
        style={[
          styles.container,
          isOwn ? styles.ownContainer : styles.otherContainer,
          !isLastInGroup && styles.groupedContainer,
        ]}
      >
        {!isOwn && renderAvatar()}
        {protectedMediaContent}
      </Animated.View>
    );
  }

  // Unified media rendering for image, video
  // Check multiple possible URI fields: mediaUrl, imageUrl, videoUri
  const mediaUrl = message.mediaUrl || message.imageUrl || message.videoUri;
  const isMedia = (message.type === 'image' || message.type === 'video') && mediaUrl;

  if (isMedia) {
    return (
      <Animated.View
        entering={enteringAnimation}
        style={[
          styles.container,
          isOwn ? styles.ownContainer : styles.otherContainer,
          !isLastInGroup && styles.groupedContainer,
        ]}
      >
        {!isOwn && renderAvatar()}
        <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
            <MediaMessage
              mediaUrl={mediaUrl!}
              type={message.type as 'image' | 'video'}
              onPress={() => onMediaPress?.(mediaUrl!, message.type as 'image' | 'video')}
            />
            {(showTimestamp || isOwn) && (
              <View style={[styles.imageFooter, !showTimestamp && styles.statusOnlyFooter]}>
                {showTimestamp && (
                  <Text style={[styles.time, isOwn && styles.ownTime]}>
                    {formatTime(message.createdAt)}
                  </Text>
                )}
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
      </Animated.View>
    );
  }

  // Voice message rendering (supports both demo audioUri and production audioUrl)
  // VOICE-FIX: Always render VoiceMessageBubble for voice type, even if audio source is missing
  // VoiceMessageBubble will show "Unavailable" state if URI is invalid
  const voiceAudioSource = message.audioUri || message.audioUrl || '';
  const voiceDuration = message.durationMs || message.audioDurationMs || 0;
  if (message.type === 'voice') {
    return (
      <Animated.View
        entering={enteringAnimation}
        style={[
          styles.container,
          isOwn ? styles.ownContainer : styles.otherContainer,
          !isLastInGroup && styles.groupedContainer,
        ]}
      >
        {!isOwn && renderAvatar()}
        <VoiceMessageBubble
          messageId={message.id}
          audioUri={voiceAudioSource}
          durationMs={voiceDuration}
          isOwn={isOwn}
          timestamp={message.createdAt}
          onDelete={isOwn && onVoiceDelete ? () => onVoiceDelete(message.id) : undefined}
          // VOICE-TICKS: Pass tick status props for sent/delivered/read indicators
          deliveredAt={message.deliveredAt}
          readAt={message.readAt}
        />
      </Animated.View>
    );
  }

  if (message.type === 'dare') {
    return (
      <Animated.View
        entering={enteringAnimation}
        style={[
          styles.container,
          isOwn ? styles.ownContainer : styles.otherContainer,
          !isLastInGroup && styles.groupedContainer,
        ]}
      >
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
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={enteringAnimation}
      style={[
        styles.container,
        isOwn ? styles.ownContainer : styles.otherContainer,
        !isLastInGroup && styles.groupedContainer,
      ]}
    >
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
          // INLINE-TIME: reserve space at bottom-right of the bubble for the
          // floating timestamp/tick (WhatsApp-style). Skip for emoji-only.
          (showTimestamp || isOwn) && !isEmojiOnly && styles.textWithInlineMeta,
        ]}>
          {message.content}
        </Text>
        {(showTimestamp || isOwn) && !isEmojiOnly && (
          <View style={styles.inlineMeta}>
            {showTimestamp && (
              <Text style={[styles.time, isOwn && styles.ownTime]}>
                {formatTime(message.createdAt)}
              </Text>
            )}
            {isOwn && (() => {
              const tickStatus = getTickStatus(message);
              return (
                <Ionicons
                  name={getTickIcon(tickStatus)}
                  size={12}
                  color={getTickColor(tickStatus, isOwn)}
                  style={styles.readIcon}
                />
              );
            })()}
          </View>
        )}
        {isEmojiOnly && (showTimestamp || isOwn) && (
          <View style={styles.footer}>
            {showTimestamp && (
              <Text style={[styles.time, isOwn && styles.ownTime]}>
                {formatTime(message.createdAt)}
              </Text>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function areMessageBubblePropsEqual(
  prev: Readonly<MessageBubbleProps>,
  next: Readonly<MessageBubbleProps>
) {
  const prevMedia = prev.message.protectedMedia;
  const nextMedia = next.message.protectedMedia;

  return (
    prev.isOwn === next.isOwn &&
    prev.otherUserName === next.otherUserName &&
    prev.currentUserId === next.currentUserId &&
    prev.currentUserToken === next.currentUserToken &&
    prev.showTimestamp === next.showTimestamp &&
    prev.showAvatar === next.showAvatar &&
    prev.avatarUrl === next.avatarUrl &&
    prev.isLastInGroup === next.isLastInGroup &&
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.type === next.message.type &&
    prev.message.senderId === next.message.senderId &&
    prev.message.createdAt === next.message.createdAt &&
    prev.message.readAt === next.message.readAt &&
    prev.message.deliveredAt === next.message.deliveredAt &&
    prev.message.imageUrl === next.message.imageUrl &&
    prev.message.mediaUrl === next.message.mediaUrl &&
    prev.message.videoUri === next.message.videoUri &&
    prev.message.isProtected === next.message.isProtected &&
    prev.message.isExpired === next.message.isExpired &&
    prev.message.timerEndsAt === next.message.timerEndsAt &&
    prev.message.expiredAt === next.message.expiredAt &&
    prev.message.viewedAt === next.message.viewedAt &&
    prev.message.systemSubtype === next.message.systemSubtype &&
    prev.message.mediaId === next.message.mediaId &&
    prev.message.viewOnce === next.message.viewOnce &&
    prev.message.recipientOpened === next.message.recipientOpened &&
    prev.message.audioUri === next.message.audioUri &&
    prev.message.audioUrl === next.message.audioUrl &&
    prev.message.durationMs === next.message.durationMs &&
    prev.message.audioDurationMs === next.message.audioDurationMs &&
    prev.message.isPending === next.message.isPending &&
    // [P1_MEDIA_UPLOAD] progress-overlay fields must re-render bubble
    prev.message.localUri === next.message.localUri &&
    prev.message.uploadStatus === next.message.uploadStatus &&
    prev.message.uploadProgress === next.message.uploadProgress &&
    prev.onRetryPendingMedia === next.onRetryPendingMedia &&
    prevMedia?.localUri === nextMedia?.localUri &&
    prevMedia?.mediaType === nextMedia?.mediaType &&
    prevMedia?.timer === nextMedia?.timer &&
    prevMedia?.viewingMode === nextMedia?.viewingMode &&
    prevMedia?.screenshotAllowed === nextMedia?.screenshotAllowed &&
    prevMedia?.viewOnce === nextMedia?.viewOnce &&
    prevMedia?.watermark === nextMedia?.watermark
  );
}

export const MessageBubble = React.memo(MessageBubbleComponent, areMessageBubblePropsEqual);
MessageBubble.displayName = 'MessageBubble';

const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════════════════
  // CONTAINER - Tight message row layout (WhatsApp-style density)
  // ═══════════════════════════════════════════════════════════════════════════
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    // PREMIUM-RHYTHM: 6px breathing room between sender groups (last-in-group);
    // groupedContainer overrides to 1px for tight consecutive messages.
    marginVertical: 6,
    paddingHorizontal: 8, // Tight horizontal padding
  },
  ownContainer: {
    justifyContent: 'flex-end',
  },
  otherContainer: {
    justifyContent: 'flex-start',
    // LEFT-TIGHTEN: override container's paddingHorizontal:8 on the left only
    // so received messages sit closer to the screen edge. Outgoing keeps the
    // original 8px right padding via container default — no visual change.
    paddingLeft: 2,
  },
  groupedContainer: {
    marginVertical: 1, // Minimal gap for grouped messages
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AVATAR - Compact circular profile image for received messages
  // ═══════════════════════════════════════════════════════════════════════════
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
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BUBBLE - Compact, modern message container
  // ═══════════════════════════════════════════════════════════════════════════
  bubble: {
    maxWidth: MAX_BUBBLE_WIDTH,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: BUBBLE_RADIUS,
    backgroundColor: COLORS.backgroundDark,
  },
  // PREMIUM-BUBBLE-PAIR (reverted): Own bubble deep-rose #E94E77 — brand-on
  // rose that feels sophisticated against the clean-white received bubble.
  // Matching shadow tint gives it subtle premium depth.
  ownBubble: {
    backgroundColor: '#E94E77',
    borderBottomRightRadius: BUBBLE_TAIL_RADIUS,
    shadowColor: '#E94E77',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  // PREMIUM-BUBBLE-PAIR (reverted): Received bubble clean white with a
  // hairline border — iMessage-style premium ghost bubble that pairs
  // cleanly with the rose-tinted own bubble.
  otherBubble: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: BUBBLE_TAIL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  dareBubble: {
    backgroundColor: COLORS.secondary,
    maxWidth: MAX_BUBBLE_WIDTH,
  },
  protectedBubble: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: 'transparent',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PENDING - Uploading secure photo state
  // ═══════════════════════════════════════════════════════════════════════════
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
  // [P1_MEDIA_UPLOAD] Rich pending preview (photo/video thumb + progress/retry)
  // SIZE-REDUCE: Shrink pending preview to ~1/2 linear dims (≈1/4 visual area)
  // so the in-flight upload bubble feels lightweight while keeping the
  // progress ring + "Uploading…"/"Sending…"/"Tap to retry" states readable.
  pendingMediaBubble: {
    padding: 2,
    overflow: 'hidden',
  },
  pendingMediaFrame: {
    width: Math.min(MAX_BUBBLE_WIDTH - 10, 120),
    height: Math.min(MAX_BUBBLE_WIDTH - 10, 120) * 0.75,
    borderRadius: BUBBLE_RADIUS - 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  pendingMediaImage: {
    width: '100%',
    height: '100%',
  },
  pendingVideoGlyph: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCol: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingSubtext: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EMOJI - Large emoji-only messages
  // ═══════════════════════════════════════════════════════════════════════════
  emojiBubble: {
    backgroundColor: 'transparent',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  emojiText: {
    fontSize: 34,
    lineHeight: 42,
    textAlign: 'center',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT - Readable, clean typography
  // ═══════════════════════════════════════════════════════════════════════════
  text: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 22,
  },
  ownText: {
    color: COLORS.white,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FOOTER - Compact timestamp and read status (WhatsApp-style)
  // ═══════════════════════════════════════════════════════════════════════════
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    justifyContent: 'flex-end',
  },
  // INLINE-TIME: WhatsApp-style floating timestamp at bubble bottom-right.
  // Sits absolutely inside the bubble; the text reserves padding-right so
  // they don't overlap on the last line.
  textWithInlineMeta: {
    // COMPACT-TIME: trim reservation from 52 → 48 so short bubbles are less
    // puffy while preserving safe non-overlap with the floating
    // timestamp/tick block on outgoing messages (which carry an extra tick).
    paddingRight: 48,
    paddingBottom: 2,
  },
  inlineMeta: {
    position: 'absolute',
    // COMPACT-TIME: pull the timestamp tighter to the bubble's right edge
    // (8 → 6) so it visually clings to the text end.
    right: 6,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  time: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: -0.2,
  },
  ownTime: {
    color: 'rgba(255, 255, 255, 0.55)',
  },
  readIcon: {
    marginLeft: 2,
  },
  imageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 3,
  },
  statusOnlyFooter: {
    marginTop: 4,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DARE - Special dare message styling
  // ═══════════════════════════════════════════════════════════════════════════
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
    lineHeight: 21,
    marginBottom: 6,
  },
  dareTime: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.55)',
  },
});
