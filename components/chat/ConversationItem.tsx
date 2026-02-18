import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
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

  // 5-7: Safe fallback for corrupted/missing preview content
  const getMessagePreview = () => {
    if (!lastMessage) return 'Say hi 👋';
    if (lastMessage.isProtected) return '🔒 Protected Photo';
    if (lastMessage.type === 'image') return '📷 Photo';
    if (lastMessage.type === 'dare') return '🎲 Dare sent';
    // 5-7: Check for valid content before returning
    const content = lastMessage.content;
    if (typeof content === 'string' && content.trim()) {
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
        {otherUser.isVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
          </View>
        )}
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

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.backgroundDark,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: COLORS.background,
    borderRadius: 10,
  },
  preMatchBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: COLORS.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  preMatchText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
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
  },
  time: {
    fontSize: 12,
    color: COLORS.textLight,
    marginLeft: 8,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  message: {
    fontSize: 14,
    color: COLORS.textLight,
    flex: 1,
    marginRight: 8,
  },
  unreadMessage: {
    fontWeight: '600',
    color: COLORS.text,
  },
});
