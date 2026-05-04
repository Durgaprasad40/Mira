import React, { useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  GestureResponderEvent,
  Animated,
  PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { SPACING, CHAT_SIZES, CHAT_FONTS, SIZES, GENDER_COLORS } from '@/lib/responsive';
import MediaMessage from '@/components/chat/MediaMessage';
import ReactionChips, { ReactionGroup } from './ReactionChips';
import { formatTime } from '@/utils/chatTime';
import { useAudioPlayerStore } from '@/stores/audioPlayerStore';
import UploadProgressRing from '@/components/chatroom/UploadProgressRing';

const C = INCOGNITO_COLORS;

// Swipe gesture constants
const SWIPE_THRESHOLD = 60; // Minimum swipe distance to trigger reply
const SWIPE_MAX = 80; // Maximum swipe distance

/** Reply-to data for rendering quoted block */
interface ReplyToData {
  messageId: string;
  senderNickname: string;
  snippet: string;
  type?: 'text' | 'image' | 'video' | 'doodle' | 'audio';
  /** Whether the original message was deleted */
  isDeleted?: boolean;
}

/** Mention data for highlighting */
interface MentionData {
  userId: string;
  nickname: string;
  startIndex: number;
  endIndex: number;
}

/** Format media type label for reply quotes (no emojis) */
function formatMediaLabel(type?: string): string {
  switch (type) {
    case 'image': return 'Photo';
    case 'video': return 'Video';
    case 'doodle': return 'Doodle';
    case 'audio': return 'Voice message';
    default: return '';
  }
}

interface ChatMessageItemProps {
  /** Unique message ID (required for media view tracking) */
  messageId: string;
  senderName: string;
  senderId: string;
  senderAvatar?: string;
  /** Sender's age for "Anonymous, 25" display */
  senderAge?: number;
  /** Sender's gender for avatar ring color */
  senderGender?: 'male' | 'female' | 'other';
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
  /** Backend-enforced one-time room visual that must be claimed before URL access */
  hasOneTimeVisualMedia?: boolean;
  /** Current viewer has already consumed this one-time room visual */
  visualMediaConsumed?: boolean;
  /** Local media URI for pending uploads (Phase-1 UX) */
  localUri?: string;
  /** Upload status for pending media (Phase-1 UX) */
  uploadStatus?: 'uploading' | 'sending' | 'upload_failed' | 'send_failed';
  /** Real upload progress (0-100) for pending media */
  uploadProgress?: number;
  /** Called when user taps failed pending media to retry */
  onUploadStatusPress?: () => void;
  /** Audio URL for audio messages */
  audioUrl?: string;
  /** TAP-TO-VIEW-FIX: Called when user taps media (opens viewer) - for image/video */
  onMediaPress?: (messageId: string, mediaUrl: string, type: 'image' | 'video') => void;
  /** Whether to show the timestamp (for grouping). Defaults to true. */
  showTimestamp?: boolean;
  /** Whether to show avatar (for consecutive message grouping). Defaults to true. */
  showAvatar?: boolean;
  /** Reply-to data for quoted reply block */
  replyTo?: ReplyToData | null;
  /** Called when user taps the reply quote (to scroll to original message) */
  onReplyTap?: (messageId: string) => void;
  /** Called when user swipes to reply */
  onSwipeReply?: () => void;
  /** Whether this message is highlighted (e.g., after scrolling to it) */
  isHighlighted?: boolean;
  /** Mentions in this message for highlighting */
  mentions?: MentionData[];
  /** Current user's ID for self-mention detection */
  currentUserId?: string;
  /** Reactions on this message for display */
  reactions?: ReactionGroup[];
  /** Called when user taps a reaction chip */
  onReactionTap?: (emoji: string) => void;
}

function ChatMessageItem({
  messageId,
  senderName,
  senderAvatar,
  senderAge,
  senderGender,
  text,
  timestamp,
  isMe = false,
  onLongPress,
  onAvatarPress,
  onNamePress,
  dimmed = false,
  messageType = 'text',
  mediaUrl,
  hasOneTimeVisualMedia,
  visualMediaConsumed,
  localUri,
  uploadStatus,
  uploadProgress,
  onUploadStatusPress,
  audioUrl,
  onMediaPress,
  showTimestamp = true,
  showAvatar = true,
  replyTo,
  onReplyTap,
  onSwipeReply,
  isHighlighted = false,
  mentions = [],
  currentUserId,
  reactions = [],
  onReactionTap,
}: ChatMessageItemProps) {
  const effectiveMediaUrl = uploadStatus && localUri ? localUri : mediaUrl;
  const hasClaimOnlyVisualMedia =
    (messageType === 'image' || messageType === 'video') &&
    !!hasOneTimeVisualMedia &&
    !effectiveMediaUrl;
  const isMedia =
    ((messageType === 'image' || messageType === 'video' || messageType === 'doodle') && !!effectiveMediaUrl) ||
    hasClaimOnlyVisualMedia;
  const isSecureMedia = messageType === 'image' || messageType === 'video';
  const isAudio = messageType === 'audio' && audioUrl;

  // Get gender-based ring color
  const ringColor = GENDER_COLORS[senderGender || 'default'];

  // Format display name with age: "Anonymous, 25" or just "Anonymous"
  const displayName = senderAge ? `${senderName}, ${senderAge}` : senderName;

  // AUDIO-UX-FIX: Use shared audio player store for single-audio playback
  const audioStore = useAudioPlayerStore();
  const isThisAudioActive = audioStore.currentMessageId === messageId;
  const isPlaying = isThisAudioActive && audioStore.isPlaying;
  const isLoading = isThisAudioActive && audioStore.isLoading;
  const audioProgress = isThisAudioActive ? audioStore.progress : 0;

  // Swipe-to-reply animation
  const swipeAnim = useRef(new Animated.Value(0)).current;
  const replyIconOpacity = swipeAnim.interpolate({
    inputRange: [0, SWIPE_THRESHOLD * 0.5, SWIPE_THRESHOLD],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });

  // P1-006 FIX: Highlight animation using opacity (supports native driver)
  // Changed from backgroundColor interpolation to opacity for smoother animation
  const highlightAnim = useRef(new Animated.Value(0)).current;

  // Animate highlight when isHighlighted changes
  useEffect(() => {
    if (isHighlighted) {
      console.log('[CHAT_MENTION_HIGHLIGHT] Highlighting message:', messageId.slice(-8));
      // Flash highlight animation - now uses native driver
      Animated.sequence([
        Animated.timing(highlightAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(600),
        Animated.timing(highlightAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isHighlighted, highlightAnim, messageId]);

  // Swipe gesture responder
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal swipes
        const { dx, dy } = gestureState;
        return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 2;
      },
      onPanResponderMove: (_, gestureState) => {
        // Swipe right for receiver messages, left for sender messages
        const swipeDistance = isMe ? -gestureState.dx : gestureState.dx;
        if (swipeDistance > 0) {
          // Apply resistance as we approach max
          const resistedDistance = Math.min(swipeDistance, SWIPE_MAX);
          swipeAnim.setValue(resistedDistance);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const swipeDistance = isMe ? -gestureState.dx : gestureState.dx;

        if (swipeDistance >= SWIPE_THRESHOLD && onSwipeReply) {
          // Trigger reply
          onSwipeReply();
        }

        // Snap back
        Animated.spring(swipeAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      },
      onPanResponderTerminate: () => {
        // Snap back on cancel
        Animated.spring(swipeAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      },
    })
  ).current;

  // AUDIO-UX-FIX: Handle audio play/pause via shared store
  const handleAudioPress = useCallback(async () => {
    if (!audioUrl) return;
    await audioStore.toggle(messageId, audioUrl);
  }, [audioUrl, messageId, audioStore]);

  // TAP-TO-VIEW-FIX: Handle media tap to open viewer (replaces hold-to-view)
  const handleMediaTap = useCallback(() => {
    if (isSecureMedia && effectiveMediaUrl) {
      // For pending media, disable secure viewer until upload completes.
      if (uploadStatus) return;
      onMediaPress?.(messageId, effectiveMediaUrl, messageType as 'image' | 'video');
    }
  }, [messageId, effectiveMediaUrl, messageType, isSecureMedia, onMediaPress, uploadStatus]);

  const handleLongPress = useCallback((event: GestureResponderEvent) => {
    // P2-014: Haptic feedback on long press for tactile confirmation
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { pageX, pageY } = event.nativeEvent;
    onLongPress?.(pageX, pageY);
  }, [onLongPress]);

  // Calculate swipe transform
  const swipeTransform = isMe
    ? { transform: [{ translateX: Animated.multiply(swipeAnim, -1) }] }
    : { transform: [{ translateX: swipeAnim }] };

  // Get snippet text for reply quote (handle deleted messages and media types)
  const getReplySnippet = () => {
    if (!replyTo) return '';
    if (replyTo.isDeleted) return 'Message unavailable';
    if (replyTo.type && replyTo.type !== 'text') {
      return formatMediaLabel(replyTo.type);
    }
    return replyTo.snippet;
  };

  // Render text with highlighted mentions
  const renderTextWithMentions = useCallback(() => {
    if (!mentions || mentions.length === 0) {
      return <Text style={[styles.messageText, isMe && styles.messageTextMe]}>{text}</Text>;
    }

    // Sort mentions by startIndex
    const sortedMentions = [...mentions].sort((a, b) => a.startIndex - b.startIndex);
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    sortedMentions.forEach((mention, idx) => {
      // Add text before this mention
      if (mention.startIndex > lastIndex) {
        parts.push(
          <Text key={`text-${idx}`} style={[styles.messageText, isMe && styles.messageTextMe]}>
            {text.substring(lastIndex, mention.startIndex)}
          </Text>
        );
      }

      // Check if this is a self-mention
      const isSelfMention = currentUserId && mention.userId === currentUserId;

      // Add the mention (highlighted)
      parts.push(
        <Text
          key={`mention-${idx}`}
          style={[
            styles.messageText,
            isMe && styles.messageTextMe,
            styles.mention,
            isMe && styles.mentionMe,
            isSelfMention && styles.selfMention,
          ]}
        >
          {text.substring(mention.startIndex, mention.endIndex)}
        </Text>
      );

      lastIndex = mention.endIndex;
    });

    // Add remaining text after last mention
    if (lastIndex < text.length) {
      parts.push(
        <Text key="text-end" style={[styles.messageText, isMe && styles.messageTextMe]}>
          {text.substring(lastIndex)}
        </Text>
      );
    }

    return <Text style={[styles.messageText, isMe && styles.messageTextMe]}>{parts}</Text>;
  }, [text, mentions, isMe, currentUserId]);

  return (
    <View style={styles.wrapper}>
      {/* P1-006 FIX: Highlight overlay with opacity animation (native driver compatible) */}
      <Animated.View
        style={[styles.highlightOverlay, { opacity: highlightAnim }]}
        pointerEvents="none"
      />
      {/* Swipe reply icon - shows behind the message during swipe */}
      <Animated.View
        style={[
          styles.swipeReplyIcon,
          isMe ? styles.swipeReplyIconMe : styles.swipeReplyIconOther,
          { opacity: replyIconOpacity },
        ]}
      >
        <Ionicons name="arrow-undo" size={20} color="#6D28D9" />
      </Animated.View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[swipeTransform]}
      >
        <TouchableOpacity
          style={[styles.container, isMe && styles.containerMe, dimmed && styles.dimmed]}
          onLongPress={handleLongPress}
          activeOpacity={0.8}
          delayLongPress={400}
        >
          {/* Avatar with gender-based ring (receiver side only, hidden for grouped consecutive messages) */}
          {!isMe && (
            showAvatar ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onAvatarPress?.();
                }}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                {senderAvatar ? (
                  <Image
                    source={{ uri: senderAvatar }}
                    style={[styles.avatar, { borderColor: ringColor }]}
                  />
                ) : (
                  <View style={[styles.avatarPlaceholder, { borderColor: ringColor }]}>
                    <Ionicons name="person" size={14} color={C.textLight} />
                  </View>
                )}
              </Pressable>
            ) : (
              // Spacer to maintain alignment when avatar is hidden (receiver side only)
              <View style={styles.avatarSpacer} />
            )
          )}

          {/* Content: Bubble with name inside for others */}
          {/* REPLY-INTEGRATED: Single unified bubble with embedded reply preview */}
          {/* REACTION-FIX: Wrap content in relative container for reaction positioning */}
          <View style={[styles.content, isMe && styles.contentMe]}>
        {isMedia ? (
          <View style={[styles.mediaWrapper, replyTo && styles.mediaWrapperWithReply]}>
            {/* REPLY-INTEGRATED: Embedded reply preview for media messages */}
            {replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyEmbedded,
                  isMe && styles.replyEmbeddedMe,
                  replyTo.isDeleted && styles.replyEmbeddedDeleted,
                ]}
                onPress={() => {
                  if (!replyTo.isDeleted) {
                    console.log('[CHAT_REPLY_NAVIGATION] Tapped reply preview:', {
                      fromMessageId: messageId.slice(-8),
                      toMessageId: replyTo.messageId.slice(-8),
                    });
                    onReplyTap?.(replyTo.messageId);
                  }
                }}
                activeOpacity={replyTo.isDeleted ? 1 : 0.7}
                disabled={replyTo.isDeleted}
              >
                <View style={[
                  styles.replyEmbeddedAccent,
                  isMe && styles.replyEmbeddedAccentMe,
                  replyTo.isDeleted && styles.replyEmbeddedAccentDeleted,
                ]} />
                <View style={styles.replyEmbeddedContent}>
                  {!replyTo.isDeleted && (
                    <Text
                      style={[styles.replyEmbeddedName, isMe && styles.replyEmbeddedNameMe]}
                      numberOfLines={1}
                    >
                      {replyTo.senderNickname}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.replyEmbeddedSnippet,
                      isMe && styles.replyEmbeddedSnippetMe,
                      replyTo.isDeleted && styles.replyEmbeddedTextDeleted,
                    ]}
                    numberOfLines={2}
                  >
                    {getReplySnippet()}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            <Pressable
              style={styles.mediaContainer}
              onPress={() => {
                if (uploadStatus === 'upload_failed' || uploadStatus === 'send_failed') {
                  onUploadStatusPress?.();
                }
              }}
            >
              {hasClaimOnlyVisualMedia ? (
                <Pressable
                  style={[
                    styles.oneTimeMediaCard,
                    visualMediaConsumed && styles.oneTimeMediaCardViewed,
                  ]}
                  onPress={() => {
                    if (!visualMediaConsumed && !uploadStatus) {
                      onMediaPress?.(messageId, '', messageType as 'image' | 'video');
                    }
                  }}
                  disabled={!!visualMediaConsumed || !!uploadStatus}
                  accessibilityRole="button"
                  accessibilityLabel={
                    visualMediaConsumed
                      ? `${messageType === 'video' ? 'Video' : 'Photo'} already viewed`
                      : `Open one-time ${messageType === 'video' ? 'video' : 'photo'}`
                  }
                >
                  <Ionicons
                    name={visualMediaConsumed ? 'checkmark-circle' : messageType === 'video' ? 'videocam' : 'image'}
                    size={24}
                    color={visualMediaConsumed ? C.textLight : C.primary}
                  />
                  <Text style={[
                    styles.oneTimeMediaTitle,
                    visualMediaConsumed && styles.oneTimeMediaTitleViewed,
                  ]}>
                    {visualMediaConsumed ? 'Already viewed' : 'Tap to view once'}
                  </Text>
                </Pressable>
              ) : (
                // TAP-TO-VIEW-FIX: Use onPress for tap-to-view instead of onHoldStart/End
                <MediaMessage
                  messageId={messageId}
                  mediaUrl={effectiveMediaUrl!}
                  type={messageType as 'image' | 'video' | 'doodle'}
                  onPress={isSecureMedia ? handleMediaTap : undefined}
                />
              )}
              {!!uploadStatus && (
                <View style={styles.pendingOverlay}>
                  {uploadStatus === 'uploading' ? (
                    <View style={styles.pendingCol}>
                      <UploadProgressRing progress={typeof uploadProgress === 'number' ? uploadProgress : 0} />
                      <Text style={styles.pendingSubtext}>Uploading…</Text>
                    </View>
                  ) : uploadStatus === 'sending' ? (
                    <View style={styles.pendingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.pendingText}>
                        Sending…
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.pendingRow}>
                      <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
                      <Text style={styles.pendingText}>Tap to retry</Text>
                    </View>
                  )}
                </View>
              )}
              {/* GROUP-TIMESTAMP: Timestamp overlay on media, bottom-right */}
              {showTimestamp && timestamp && (
                <View style={styles.mediaTimestampOverlay}>
                  <Text style={styles.mediaTimestampText}>{formatTime(timestamp)}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : isAudio ? (
          <View style={[styles.bubble, styles.audioBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
            {/* REPLY-INTEGRATED: Embedded reply preview for audio messages */}
            {replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyEmbedded,
                  isMe && styles.replyEmbeddedMe,
                  replyTo.isDeleted && styles.replyEmbeddedDeleted,
                ]}
                onPress={() => {
                  if (!replyTo.isDeleted) {
                    console.log('[CHAT_REPLY_NAVIGATION] Tapped reply preview:', {
                      fromMessageId: messageId.slice(-8),
                      toMessageId: replyTo.messageId.slice(-8),
                    });
                    onReplyTap?.(replyTo.messageId);
                  }
                }}
                activeOpacity={replyTo.isDeleted ? 1 : 0.7}
                disabled={replyTo.isDeleted}
              >
                <View style={[
                  styles.replyEmbeddedAccent,
                  isMe && styles.replyEmbeddedAccentMe,
                  replyTo.isDeleted && styles.replyEmbeddedAccentDeleted,
                ]} />
                <View style={styles.replyEmbeddedContent}>
                  {!replyTo.isDeleted && (
                    <Text
                      style={[styles.replyEmbeddedName, isMe && styles.replyEmbeddedNameMe]}
                      numberOfLines={1}
                    >
                      {replyTo.senderNickname}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.replyEmbeddedSnippet,
                      isMe && styles.replyEmbeddedSnippetMe,
                      replyTo.isDeleted && styles.replyEmbeddedTextDeleted,
                    ]}
                    numberOfLines={2}
                  >
                    {getReplySnippet()}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            {!isMe && showAvatar && (
              <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
                <Text style={styles.senderName}>{displayName}</Text>
              </TouchableOpacity>
            )}
            {/* AUDIO-UX-FIX: Improved audio row with progress visualization */}
            <TouchableOpacity onPress={handleAudioPress} activeOpacity={0.7} style={styles.audioTouchable}>
              <View style={styles.audioRow}>
                {/* Play/Pause button */}
                {isLoading ? (
                  <View style={[styles.playButton, isMe && styles.playButtonMe]}>
                    <ActivityIndicator size="small" color={isMe ? '#6D28D9' : '#FFFFFF'} />
                  </View>
                ) : (
                  <View style={[styles.playButton, isMe && styles.playButtonMe]}>
                    <Ionicons
                      name={isPlaying ? 'pause' : 'play'}
                      size={16}
                      color={isMe ? '#6D28D9' : '#FFFFFF'}
                    />
                  </View>
                )}
                {/* Waveform with progress overlay */}
                <View style={styles.audioWaveformContainer}>
                  {/* Progress underlay - shows played portion */}
                  <View style={[styles.audioProgressTrack, { width: `${audioProgress * 100}%` }]}>
                    <View style={[styles.audioProgressFill, isMe && styles.audioProgressFillMe]} />
                  </View>
                  {/* Waveform bars */}
                  <View style={styles.audioWaveform}>
                    {[4, 8, 12, 6, 14, 8, 16, 10, 12, 7, 14, 9, 11, 7, 10, 5, 8, 12].map((h, i) => {
                      // Calculate if this bar is in the "played" portion
                      const barProgress = (i + 1) / 18;
                      const isPlayed = audioProgress >= barProgress;
                      return (
                        <View
                          key={i}
                          style={[
                            styles.waveformBar,
                            { height: h },
                            isMe
                              ? (isPlayed ? styles.waveformBarMePlayed : styles.waveformBarMe)
                              : (isPlayed ? styles.waveformBarOtherPlayed : styles.waveformBarOther),
                          ]}
                        />
                      );
                    })}
                  </View>
                </View>
                {/* Mic badge at far right */}
                <View style={[styles.micBadge, isMe && styles.micBadgeMe]}>
                  <Ionicons
                    name="mic"
                    size={10}
                    color={isMe ? 'rgba(255,255,255,0.8)' : '#6D28D9'}
                  />
                </View>
              </View>
            </TouchableOpacity>
            {/* Timestamp below audio row */}
            {showTimestamp && timestamp && (
              <Text style={[styles.audioTimestamp, isMe && styles.audioTimestampMe]}>
                {formatTime(timestamp)}
              </Text>
            )}
          </View>
        ) : (
          /* REPLY-INTEGRATED: Single bubble with embedded reply preview for text messages */
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
            {/* Embedded reply preview at TOP of bubble */}
            {replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyEmbedded,
                  isMe && styles.replyEmbeddedMe,
                  replyTo.isDeleted && styles.replyEmbeddedDeleted,
                ]}
                onPress={() => {
                  if (!replyTo.isDeleted) {
                    console.log('[CHAT_REPLY_NAVIGATION] Tapped reply preview:', {
                      fromMessageId: messageId.slice(-8),
                      toMessageId: replyTo.messageId.slice(-8),
                    });
                    onReplyTap?.(replyTo.messageId);
                  }
                }}
                activeOpacity={replyTo.isDeleted ? 1 : 0.7}
                disabled={replyTo.isDeleted}
              >
                <View style={[
                  styles.replyEmbeddedAccent,
                  isMe && styles.replyEmbeddedAccentMe,
                  replyTo.isDeleted && styles.replyEmbeddedAccentDeleted,
                ]} />
                <View style={styles.replyEmbeddedContent}>
                  {!replyTo.isDeleted && (
                    <Text
                      style={[styles.replyEmbeddedName, isMe && styles.replyEmbeddedNameMe]}
                      numberOfLines={1}
                    >
                      {replyTo.senderNickname}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.replyEmbeddedSnippet,
                      isMe && styles.replyEmbeddedSnippetMe,
                      replyTo.isDeleted && styles.replyEmbeddedTextDeleted,
                    ]}
                    numberOfLines={2}
                  >
                    {getReplySnippet()}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            {/* Sender name (for received messages with avatar shown) */}
            {!isMe && showAvatar && (
              <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
                <Text style={styles.senderName}>{displayName}</Text>
              </TouchableOpacity>
            )}
            {/* GROUP-TIMESTAMP-FIX: Row layout for text + timestamp inline */}
            <View style={styles.textTimestampRow}>
              <View style={styles.textWrapper}>
                {renderTextWithMentions()}
              </View>
              {showTimestamp && timestamp && (
                <Text style={[styles.timestampInline, isMe && styles.timestampInlineMe]}>
                  {formatTime(timestamp)}
                </Text>
              )}
            </View>
          </View>
        )}
          {/* REACTION-FIX: Render reaction chips attached to message bubble */}
          {reactions.length > 0 && onReactionTap && (
            <View style={[styles.reactionWrapper, isMe && styles.reactionWrapperMe]}>
              <ReactionChips
                reactions={reactions}
                onReactionTap={onReactionTap}
                isMe={isMe}
              />
            </View>
          )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default React.memo(ChatMessageItem);

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  // P1-006 FIX: Highlight overlay for native-driver-compatible animation
  highlightOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(109, 40, 217, 0.15)',
    zIndex: -1, // Behind the message content
  },
  swipeReplyIcon: {
    position: 'absolute',
    top: '50%',
    marginTop: -15,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(109, 40, 217, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeReplyIconOther: {
    left: 50, // Position to the right of avatar
  },
  swipeReplyIconMe: {
    right: 8, // Position on the right side
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs + 1,
    gap: SPACING.sm,
    backgroundColor: 'transparent', // Ensure clean swipe
  },
  containerMe: {
    flexDirection: 'row-reverse',
  },
  dimmed: {
    opacity: 0.35,
  },
  avatar: {
    width: CHAT_SIZES.messageAvatar,
    height: CHAT_SIZES.messageAvatar,
    borderRadius: CHAT_SIZES.messageAvatar / 2,
    borderWidth: 2.5, // Thicker ring for better visibility
  },
  avatarPlaceholder: {
    width: CHAT_SIZES.messageAvatar,
    height: CHAT_SIZES.messageAvatar,
    borderRadius: CHAT_SIZES.messageAvatar / 2,
    backgroundColor: '#1A2238', // Solid dark to match bubble
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5, // Thicker ring for better visibility
  },
  avatarSpacer: {
    width: CHAT_SIZES.messageAvatar, // Same as avatar width for alignment
    height: CHAT_SIZES.messageAvatar,
  },
  content: {
    maxWidth: '75%',
    minWidth: 0, // Enable text truncation in flex children
    gap: 2,
  },
  contentMe: {
    alignItems: 'flex-end',
  },
  // REACTION-FIX: Position reactions attached to bubble edge
  reactionWrapper: {
    marginTop: -6, // Overlap with bubble slightly
    marginLeft: 8, // Offset from bubble edge
    alignSelf: 'flex-start',
  },
  reactionWrapperMe: {
    marginRight: 8,
    marginLeft: 0,
    alignSelf: 'flex-end',
  },
  senderName: {
    // P0-002 FIX: Responsive font size for sender name
    fontSize: CHAT_FONTS.senderName,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 2,
  },
  bubble: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: CHAT_SIZES.bubbleRadius,
    // Subtle elevation for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  bubbleOther: {
    backgroundColor: '#1A2238', // Deep premium dark blue
    borderWidth: 1,
    borderColor: '#252D42', // Subtle border for definition
    borderBottomLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: '#6D28D9',
    borderBottomRightRadius: 4,
  },
  messageText: {
    // P0-002 FIX: Responsive font size for message text
    fontSize: CHAT_FONTS.messageText,
    lineHeight: Math.round(CHAT_FONTS.messageText * 1.43), // ~20px line height at 14px base
    color: C.text,
  },
  messageTextMe: {
    color: '#FFFFFF',
  },
  // @Mention highlighting
  mention: {
    color: '#A78BFA', // Purple for mentions (lighter shade for visibility)
    fontWeight: '600',
  },
  mentionMe: {
    color: '#DDD6FE', // Even lighter purple on sender's purple bubble
  },
  selfMention: {
    backgroundColor: 'rgba(167, 139, 250, 0.2)', // Subtle background for self-mentions
    borderRadius: 2,
  },
  mediaContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  oneTimeMediaCard: {
    width: 180,
    height: 132,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  oneTimeMediaCardViewed: {
    opacity: 0.65,
  },
  oneTimeMediaTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
  },
  oneTimeMediaTitleViewed: {
    color: C.textLight,
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingCol: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pendingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingSubtext: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
  },
  // AUDIO-UX-FIX: Wider audio bubble with proper layout
  audioBubble: {
    minWidth: 220,
    maxWidth: 280,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  // AUDIO-COMPACT-FIX: Remove flex:1 which was causing vertical expansion
  audioTouchable: {
    // No flex - let it size to content
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playButtonMe: {
    backgroundColor: '#FFFFFF',
  },
  // AUDIO-UX-FIX: Container for waveform with progress overlay
  audioWaveformContainer: {
    flex: 1,
    height: 28,
    position: 'relative',
    justifyContent: 'center',
  },
  audioProgressTrack: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  audioProgressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 1000, // Large enough to cover
    backgroundColor: 'rgba(109, 40, 217, 0.1)',
  },
  audioProgressFillMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  // AUDIO-UX-FIX: Waveform spans full width
  audioWaveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
    paddingHorizontal: 2,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
  },
  // Unplayed bars - subtle
  waveformBarMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  waveformBarOther: {
    backgroundColor: 'rgba(109, 40, 217, 0.35)',
  },
  // Played bars - vivid (progress indicator)
  waveformBarMePlayed: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  waveformBarOtherPlayed: {
    backgroundColor: '#6D28D9',
  },
  // AUDIO-UX-FIX: Mic badge at far right
  micBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(109, 40, 217, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  micBadgeMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  // AUDIO-UX-FIX: Timestamp below audio row
  audioTimestamp: {
    fontSize: 10,
    color: 'rgba(158, 158, 158, 0.7)',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  audioTimestampMe: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  // REPLY-INTEGRATED: Media wrapper for replies to media messages
  mediaWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  mediaWrapperWithReply: {
    backgroundColor: '#1A2238',
    borderWidth: 1,
    borderColor: '#252D42',
  },
  // REPLY-INTEGRATED: Embedded reply preview styles (inside the bubble)
  // Creates a lighter section at the top of the bubble for the quoted message
  replyEmbedded: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // Lighter shade background for contrast within bubble
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    minWidth: 140,
  },
  replyEmbeddedMe: {
    // Darker shade for sender's purple bubble
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  replyEmbeddedAccent: {
    width: 3,
    minHeight: 24,
    borderRadius: 1.5,
    backgroundColor: '#6D28D9',
    marginRight: 10,
    flexShrink: 0,
  },
  replyEmbeddedAccentMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  replyEmbeddedContent: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  replyEmbeddedName: {
    fontSize: CHAT_FONTS.senderName,
    fontWeight: '600',
    color: '#A78BFA',
    marginBottom: 2,
  },
  replyEmbeddedNameMe: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  replyEmbeddedSnippet: {
    fontSize: CHAT_FONTS.label,
    lineHeight: Math.round(CHAT_FONTS.label * 1.35),
    color: C.textLight,
  },
  replyEmbeddedSnippetMe: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  replyEmbeddedDeleted: {
    opacity: 0.7,
  },
  replyEmbeddedAccentDeleted: {
    backgroundColor: '#4B5563',
  },
  replyEmbeddedTextDeleted: {
    fontStyle: 'italic',
    color: '#6B7280',
  },
  // GROUP-TIMESTAMP-FIX: Row layout for text + timestamp inline
  textTimestampRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 6,
  },
  textWrapper: {
    flexShrink: 1,
    flexGrow: 1,
  },
  // GROUP-TIMESTAMP: Inline timestamp styles (bottom-right, compact)
  timestampInline: {
    fontSize: 10,
    color: 'rgba(158, 158, 158, 0.7)', // Subtle gray
    marginLeft: 4,
    letterSpacing: 0.1,
    alignSelf: 'flex-end',
    paddingBottom: 1,
  },
  timestampInlineMe: {
    color: 'rgba(255, 255, 255, 0.5)', // Subtle white for sent bubbles
  },
  // GROUP-TIMESTAMP: Media timestamp overlay (bottom-right corner)
  mediaTimestampOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mediaTimestampText: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.2,
  },
});
