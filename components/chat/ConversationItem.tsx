import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, SIZES, FONT_SIZE, FONT_WEIGHT, HAIRLINE, moderateScale } from '@/lib/constants';
import { Badge } from '@/components/ui';
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
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return date.toLocaleDateString();
    } else if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes > 0 ? `${minutes}m ago` : 'Just now';
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
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
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
{/* TASK-1: Removed verified badge checkmark from Messages list avatars */}
        {isPreMatch && (
          <View style={styles.preMatchBadge}>
            <Text style={styles.preMatchText}>Pre-Match</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>
            {otherUser.name}
          </Text>
          {lastMessage && (
            <Text style={styles.time}>{formatTime(lastMessage.createdAt)}</Text>
          )}
        </View>
        <View style={styles.messageRow}>
          <Text
            style={[styles.message, unreadCount > 0 && styles.unreadMessage]}
            numberOfLines={1}
          >
            {getMessagePreview()}
          </Text>
          {unreadCount > 0 && <Badge count={unreadCount} />}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Responsive avatar size
const AVATAR_SIZE = moderateScale(56, 0.3);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: SPACING.base,
    backgroundColor: COLORS.background,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLORS.border,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: SPACING.md,
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
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.white,
  },
  // TASK-1: Removed verifiedBadge style (badge removed from Messages list)
  preMatchBadge: {
    position: 'absolute',
    top: -SPACING.xs,
    right: -SPACING.xs,
    backgroundColor: COLORS.warning,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.sm,
    flexShrink: 0,
  },
  preMatchText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.white,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0, // Allow text truncation
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  name: {
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
    flex: 1,
    flexShrink: 1,
  },
  time: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    marginLeft: SPACING.sm,
    flexShrink: 0,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  message: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    flex: 1,
    marginRight: SPACING.sm,
    flexShrink: 1,
  },
  unreadMessage: {
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
  },
});
