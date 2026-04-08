import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { COLORS, FONT_SIZE, FONT_WEIGHT, moderateScale } from '@/lib/constants';
import { DEMO_PROFILES } from '@/lib/demoData';

interface ConversationItemProps {
  id: string;
  otherUser: {
    id: string;
    name: string;
    photoUrl?: string;
    lastActive: number;
    isVerified: boolean;
    photoBlurred?: boolean;
  };
  lastMessage?: {
    content: string;
    type: string;
    senderId: string;
    createdAt: number;
    isProtected?: boolean;
  } | null;
  unreadCount: number;
  isPreMatch: boolean;
  onPress: () => void;
  /** DM-FIX: Tap avatar to view profile (optional, falls back to onPress if not provided) */
  onAvatarPress?: () => void;
  currentUserId?: string;
}

const PRESENCE_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function ConversationItemComponent({
  otherUser,
  lastMessage,
  unreadCount,
  isPreMatch,
  onPress,
  onAvatarPress,
  currentUserId,
}: ConversationItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const highlightAnim = useRef(new Animated.Value(0)).current;
  const hasUnread = unreadCount > 0;

  // Subtle highlight pulse for new/unread messages on mount
  useEffect(() => {
    if (hasUnread) {
      // Brief pulse: 0 → 1 → 0 to highlight the row
      Animated.sequence([
        Animated.timing(highlightAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: false, // backgroundColor doesn't support native driver
        }),
        Animated.timing(highlightAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, []);

  // Press feedback animation (subtle, no bounce)
  const handlePressIn = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 0.98,
      duration: 80,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  // Format time - cleaner, more compact
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 7) {
      // Short date format
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (days > 0) {
      return `${days}d`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes > 0 ? `${minutes}m` : 'Now';
    }
  };

  // P1-MSG: Resolve photo URL with DEMO_PROFILES fallback
  const resolvedPhotoUrl = useMemo(() => {
    if (otherUser.photoUrl) return otherUser.photoUrl;
    // Fallback: lookup from DEMO_PROFILES by user ID
    const demoProfile = DEMO_PROFILES.find((p: any) => p._id === otherUser.id);
    return demoProfile?.photos?.[0]?.url;
  }, [otherUser.photoUrl, otherUser.id]);

  // P1-MSG: Compute initials for avatar placeholder
  const avatarInitials = useMemo(() => {
    const name = otherUser.name || '';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || '??';
  }, [otherUser.name]);

  // System message marker regex (matches [SYSTEM:subtype] prefix)
  const SYSTEM_MARKER_RE = /^\[SYSTEM:(\w+)\]/;
  const isActiveNow = useMemo(() => {
    if (!otherUser.lastActive) return false;
    return Date.now() - otherUser.lastActive < PRESENCE_ACTIVE_WINDOW_MS;
  }, [otherUser.lastActive]);

  // 5-7: Safe fallback for corrupted/missing preview content
  // TASK-2: Strip system message markers from preview
  const messagePreview = useMemo(() => {
    if (!lastMessage) return 'Say hi 👋';
    const previewPrefix = currentUserId && lastMessage.senderId === currentUserId ? 'You: ' : '';
    if (lastMessage.isProtected) {
      return `${previewPrefix}${lastMessage.type === 'video' ? '🔒 Secure video' : '🔒 Secure photo'}`;
    }
    if (lastMessage.type === 'image') return `${previewPrefix}📷 Photo`;
    if (lastMessage.type === 'video') return `${previewPrefix}🎬 Video`;
    if (lastMessage.type === 'voice') return `${previewPrefix}🎤 Voice message`;
    if (lastMessage.type === 'dare') return `${previewPrefix}🎲 Dare sent`;
    // 5-7: Check for valid content before returning
    const content = lastMessage.content;
    if (typeof content === 'string' && content.trim()) {
      // TASK-2: Strip [SYSTEM:...] prefix from system messages
      const markerMatch = content.match(SYSTEM_MARKER_RE);
      if (markerMatch) {
        const cleanContent = content.slice(markerMatch[0].length).trim();
        return cleanContent || 'New message';
      }
      return `${previewPrefix}${content}`;
    }
    // Fallback for corrupted/missing content
    return 'New message';
  }, [currentUserId, lastMessage]);

  // Interpolate highlight animation for subtle background pulse
  const highlightBgColor = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      hasUnread ? COLORS.primarySubtle : COLORS.background,
      COLORS.primary + '20', // Slightly more vibrant pulse
    ],
  });

  // Entry animation for new items
  const enteringAnimation = FadeIn.duration(200);

  return (
    <Reanimated.View entering={enteringAnimation}>
      <TouchableOpacity
        style={styles.container}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <Animated.View style={[
          styles.innerContainer,
          { transform: [{ scale: scaleAnim }] },
          hasUnread && { backgroundColor: highlightBgColor },
        ]}>
          {/* Avatar Section */}
        <TouchableOpacity
          style={styles.avatarContainer}
          onPress={onAvatarPress}
          activeOpacity={onAvatarPress ? 0.7 : 1}
          disabled={!onAvatarPress}
        >
          {resolvedPhotoUrl ? (
            <Image
              source={{ uri: resolvedPhotoUrl }}
              style={styles.avatar}
              contentFit="cover"
              blurRadius={otherUser.photoBlurred ? 20 : undefined}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitials}>{avatarInitials}</Text>
            </View>
          )}
          {isActiveNow && <View style={styles.activeNowDot} />}
          {isPreMatch && (
            <View style={styles.preMatchBadge}>
              <Text style={styles.preMatchText}>Pre-Match</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Content Section */}
          <View style={styles.content}>
          {/* Top row: Name + Time */}
          <View style={styles.header}>
            <View style={styles.nameRow}>
              <Text
                style={[styles.name, hasUnread && styles.nameUnread]}
                numberOfLines={1}
              >
                {otherUser.name}
              </Text>
              {otherUser.isVerified && (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedBadgeText}>✓</Text>
                </View>
              )}
            </View>
            {lastMessage && (
              <Text style={styles.time}>
                {formatTime(lastMessage.createdAt)}
              </Text>
            )}
          </View>

          {/* Bottom row: Message preview + Unread indicator */}
          <View style={styles.messageRow}>
            <Text
              style={[styles.message, hasUnread && styles.unreadMessage]}
              numberOfLines={1}
            >
              {messagePreview}
            </Text>
            {hasUnread && (
              <View style={styles.unreadDot}>
                {unreadCount > 1 && (
                  <Text style={styles.unreadDotText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
        </Animated.View>
      </TouchableOpacity>
    </Reanimated.View>
  );
}

function areConversationItemPropsEqual(
  prev: Readonly<ConversationItemProps>,
  next: Readonly<ConversationItemProps>
) {
  return (
    prev.id === next.id &&
    prev.unreadCount === next.unreadCount &&
    prev.isPreMatch === next.isPreMatch &&
    prev.currentUserId === next.currentUserId &&
    prev.otherUser.id === next.otherUser.id &&
    prev.otherUser.name === next.otherUser.name &&
    prev.otherUser.photoUrl === next.otherUser.photoUrl &&
    prev.otherUser.lastActive === next.otherUser.lastActive &&
    prev.otherUser.isVerified === next.otherUser.isVerified &&
    prev.otherUser.photoBlurred === next.otherUser.photoBlurred &&
    prev.lastMessage?.content === next.lastMessage?.content &&
    prev.lastMessage?.type === next.lastMessage?.type &&
    prev.lastMessage?.senderId === next.lastMessage?.senderId &&
    prev.lastMessage?.createdAt === next.lastMessage?.createdAt &&
    prev.lastMessage?.isProtected === next.lastMessage?.isProtected
  );
}

export const ConversationItem = React.memo(ConversationItemComponent, areConversationItemPropsEqual);
ConversationItem.displayName = 'ConversationItem';

// Responsive avatar size (48-52px range for comfortable touch)
const AVATAR_SIZE = moderateScale(52, 0.3);

const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════════════════
  // CONTAINER - Clean, modern chat row
  // ═══════════════════════════════════════════════════════════════════════════
  container: {
    backgroundColor: COLORS.background,
  },
  containerUnread: {
    // Subtle highlight for unread chats (proper theme constant)
    backgroundColor: COLORS.primarySubtle,
  },
  innerContainer: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    // Use spacing instead of visible divider for premium feel
    marginBottom: 1,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AVATAR - Circular profile image (48-52px)
  // ═══════════════════════════════════════════════════════════════════════════
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: COLORS.backgroundDark,
    flexShrink: 0,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  avatarInitials: {
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.white,
  },
  preMatchBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: COLORS.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    flexShrink: 0,
  },
  preMatchText: {
    fontSize: 9,
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.white,
    letterSpacing: 0.3,
  },
  activeNowDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: COLORS.background,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTENT - Text hierarchy: Name (bold) > Message (light) > Time (subtle)
  // ═══════════════════════════════════════════════════════════════════════════
  content: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0, // Enable text truncation
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 1,
    letterSpacing: -0.2,
  },
  nameUnread: {
    fontWeight: '700',
    color: COLORS.text,
  },
  time: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginLeft: 8,
    flexShrink: 0,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  message: {
    fontSize: 14,
    color: COLORS.textLight,
    flex: 1,
    marginRight: 8,
    flexShrink: 1,
    lineHeight: 20,
  },
  unreadMessage: {
    fontWeight: '600',
    color: COLORS.text,
  },
  verifiedBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UNREAD INDICATOR - Subtle dot with optional count
  // ═══════════════════════════════════════════════════════════════════════════
  unreadDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    flexShrink: 0,
  },
  unreadDotText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
});
