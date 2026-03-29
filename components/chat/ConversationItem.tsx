import React, { useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
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
}

export function ConversationItem({
  otherUser,
  lastMessage,
  unreadCount,
  isPreMatch,
  onPress,
  onAvatarPress,
}: ConversationItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const hasUnread = unreadCount > 0;

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

  // 5-7: Safe fallback for corrupted/missing preview content
  // TASK-2: Strip system message markers from preview
  const getMessagePreview = () => {
    if (!lastMessage) return 'Say hi 👋';
    if (lastMessage.isProtected) return '🔒 Protected Photo';
    if (lastMessage.type === 'image') return '📷 Photo';
    if (lastMessage.type === 'video') return '🎬 Video';
    if (lastMessage.type === 'voice') return '🎤 Voice message';
    if (lastMessage.type === 'dare') return '🎲 Dare sent';
    // 5-7: Check for valid content before returning
    const content = lastMessage.content;
    if (typeof content === 'string' && content.trim()) {
      // TASK-2: Strip [SYSTEM:...] prefix from system messages
      const markerMatch = content.match(SYSTEM_MARKER_RE);
      if (markerMatch) {
        const cleanContent = content.slice(markerMatch[0].length).trim();
        return cleanContent || 'New message';
      }
      return content;
    }
    // Fallback for corrupted/missing content
    return 'New message';
  };

  return (
    <TouchableOpacity
      style={[styles.container, hasUnread && styles.containerUnread]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
    >
      <Animated.View style={[styles.innerContainer, { transform: [{ scale: scaleAnim }] }]}>
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
          {/* Online indicator could go here */}
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
            <Text
              style={[styles.name, hasUnread && styles.nameUnread]}
              numberOfLines={1}
            >
              {otherUser.name}
            </Text>
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
              {getMessagePreview()}
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
  );
}

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
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
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
