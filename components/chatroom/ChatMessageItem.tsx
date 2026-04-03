import React, { useCallback, useState, useRef, useEffect } from 'react';
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
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { SPACING, CHAT_SIZES, CHAT_FONTS, SIZES, GENDER_COLORS } from '@/lib/responsive';
import MediaMessage from '@/components/chat/MediaMessage';
import ReactionChips, { ReactionGroup } from './ReactionChips';

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
  /** Audio URL for audio messages */
  audioUrl?: string;
  /** Called when user starts holding media (opens viewer) - only for image/video */
  onMediaHoldStart?: (messageId: string, mediaUrl: string, type: 'image' | 'video') => void;
  /** Called when user releases hold (closes viewer) */
  onMediaHoldEnd?: () => void;
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
  isMe = false,
  onLongPress,
  onAvatarPress,
  onNamePress,
  dimmed = false,
  messageType = 'text',
  mediaUrl,
  audioUrl,
  onMediaHoldStart,
  onMediaHoldEnd,
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
  const isMedia = (messageType === 'image' || messageType === 'video' || messageType === 'doodle') && mediaUrl;
  const isSecureMedia = messageType === 'image' || messageType === 'video';
  const isAudio = messageType === 'audio' && audioUrl;

  // Get gender-based ring color
  const ringColor = GENDER_COLORS[senderGender || 'default'];

  // Format display name with age: "Anonymous, 25" or just "Anonymous"
  const displayName = senderAge ? `${senderName}, ${senderAge}` : senderName;

  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

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
  }, [isHighlighted, highlightAnim]);

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

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // Handle audio play/pause
  const handleAudioPress = useCallback(async () => {
    if (!audioUrl) return;

    try {
      if (isPlaying && soundRef.current) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
        return;
      }

      if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        return;
      }

      setIsLoading(true);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        }
      );
      soundRef.current = sound;
      setIsPlaying(true);
      setIsLoading(false);
    } catch (error) {
      console.error('[AudioPlayback] Error:', error);
      setIsLoading(false);
      setIsPlaying(false);
    }
  }, [audioUrl, isPlaying]);

  const handleHoldStart = useCallback(() => {
    if (isSecureMedia && mediaUrl) {
      onMediaHoldStart?.(messageId, mediaUrl, messageType as 'image' | 'video');
    }
  }, [messageId, mediaUrl, messageType, isSecureMedia, onMediaHoldStart]);

  const handleHoldEnd = useCallback(() => {
    onMediaHoldEnd?.();
  }, [onMediaHoldEnd]);

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
          <View style={[styles.content, isMe && styles.contentMe]}>
            {/* Reply Quote Block (when this message is a reply) */}
            {replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyQuote,
                  isMe && styles.replyQuoteMe,
                  replyTo.isDeleted && styles.replyQuoteDeleted,
                ]}
                onPress={() => !replyTo.isDeleted && onReplyTap?.(replyTo.messageId)}
                activeOpacity={replyTo.isDeleted ? 1 : 0.7}
                disabled={replyTo.isDeleted}
              >
                <View style={[
                  styles.replyQuoteAccent,
                  isMe && styles.replyQuoteAccentMe,
                  replyTo.isDeleted && styles.replyQuoteAccentDeleted,
                ]} />
                <View style={styles.replyQuoteContent}>
                  <Text
                    style={[
                      styles.replyQuoteName,
                      isMe && styles.replyQuoteNameMe,
                      replyTo.isDeleted && styles.replyQuoteTextDeleted,
                    ]}
                    numberOfLines={1}
                  >
                    {replyTo.isDeleted ? '' : replyTo.senderNickname}
                  </Text>
                  <Text
                    style={[
                      styles.replyQuoteSnippet,
                      isMe && styles.replyQuoteSnippetMe,
                      replyTo.isDeleted && styles.replyQuoteTextDeleted,
                    ]}
                    numberOfLines={CHAT_SIZES.replyPreviewLines}
                    ellipsizeMode="tail"
                  >
                    {getReplySnippet()}
                  </Text>
                </View>
              </TouchableOpacity>
            )}

        {isMedia ? (
          <View style={styles.mediaContainer}>
            <MediaMessage
              messageId={messageId}
              mediaUrl={mediaUrl!}
              type={messageType as 'image' | 'video' | 'doodle'}
              onHoldStart={isSecureMedia ? handleHoldStart : undefined}
              onHoldEnd={isSecureMedia ? handleHoldEnd : undefined}
            />
          </View>
        ) : isAudio ? (
          <TouchableOpacity
            onPress={handleAudioPress}
            activeOpacity={0.7}
            style={[styles.bubble, styles.audioBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}
          >
            {!isMe && showAvatar && (
              <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
                <Text style={styles.senderName}>{displayName}</Text>
              </TouchableOpacity>
            )}
            <View style={styles.audioRow}>
              {isLoading ? (
                <ActivityIndicator size="small" color={isMe ? '#FFFFFF' : '#6D28D9'} />
              ) : (
                <View style={[styles.playButton, isMe && styles.playButtonMe]}>
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={16}
                    color={isMe ? '#6D28D9' : '#FFFFFF'}
                  />
                </View>
              )}
              <View style={styles.audioWaveform}>
                {[5, 8, 12, 7, 14, 10, 8, 5].map((h, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveformBar,
                      { height: h },
                      isMe ? styles.waveformBarMe : styles.waveformBarOther,
                      isPlaying && styles.waveformBarPlaying,
                    ]}
                  />
                ))}
              </View>
              <Ionicons
                name="mic"
                size={12}
                color={isMe ? 'rgba(255,255,255,0.6)' : C.textLight}
              />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
            {!isMe && showAvatar && (
              <TouchableOpacity onPress={onNamePress} activeOpacity={0.7}>
                <Text style={styles.senderName}>{displayName}</Text>
              </TouchableOpacity>
            )}
            {renderTextWithMentions()}
          </View>
        )}
          </View>
        </TouchableOpacity>

        {/* P0-FIX: Render reaction chips below message */}
        {reactions.length > 0 && onReactionTap && (
          <ReactionChips
            reactions={reactions}
            onReactionTap={onReactionTap}
            isMe={isMe}
          />
        )}
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
  audioBubble: {
    minWidth: 160,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonMe: {
    backgroundColor: '#FFFFFF',
  },
  audioWaveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 22,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: C.textLight,
  },
  waveformBarMe: {
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  waveformBarOther: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  waveformBarPlaying: {
    backgroundColor: '#6D28D9',
  },
  // P2-008: Reply Quote Block styles - improved visual hierarchy
  // Structure: [Accent Bar (fixed width)] [Text Container (flex: 1)]
  replyQuote: {
    flexDirection: 'row',
    alignItems: 'stretch', // Stretch accent bar to match text height
    // P2-008: Slightly more prominent background
    backgroundColor: '#252D45',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
    width: '100%',
    // P2-008: Subtle border for better definition
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.15)',
  },
  replyQuoteMe: {
    backgroundColor: '#7C3AED',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  replyQuoteAccent: {
    // P2-008: Thicker, more visible accent bar
    width: 4,
    minHeight: 24,
    borderRadius: 2,
    backgroundColor: 'rgba(167, 139, 250, 0.6)',
    marginRight: 10,
    flexShrink: 0, // Never shrink the accent bar
  },
  replyQuoteAccentMe: {
    backgroundColor: '#DDD6FE',
  },
  replyQuoteContent: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0, // Critical for text truncation/wrapping
  },
  replyQuoteName: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.senderName,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 2,
  },
  replyQuoteNameMe: {
    color: '#E9D5FF',
  },
  replyQuoteSnippet: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.label,
    color: C.textLight,
    // Text wraps naturally based on container width - no flexWrap needed
  },
  replyQuoteSnippetMe: {
    color: '#DDD6FE',
  },
  // Deleted message styles
  replyQuoteDeleted: {
    opacity: 0.6,
  },
  replyQuoteAccentDeleted: {
    backgroundColor: '#4B5563', // Solid gray for deleted
  },
  replyQuoteTextDeleted: {
    fontStyle: 'italic',
    color: '#6B7280', // Solid muted gray
  },
});
