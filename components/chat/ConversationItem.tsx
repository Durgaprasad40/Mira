import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { Badge } from '@/components/ui';

interface ConversationItemProps {
  id: string;
  otherUser: {
    id: string;
    name: string;
    photoUrl?: string;
    lastActive: number;
    isVerified: boolean;
  };
  lastMessage?: {
    content: string;
    type: string;
    senderId: string;
    createdAt: number;
  } | null;
  unreadCount: number;
  isPreMatch: boolean;
  onPress: () => void;
}

export function ConversationItem({
  otherUser,
  lastMessage,
  unreadCount,
  isPreMatch,
  onPress,
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

  const getMessagePreview = () => {
    if (!lastMessage) return 'No messages yet';
    if (lastMessage.type === 'image') return '📷 Photo';
    if (lastMessage.type === 'template') return lastMessage.content;
    if (lastMessage.type === 'dare') return '🎲 Dare sent';
    return lastMessage.content;
  };

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarContainer}>
        {otherUser.photoUrl ? (
          <Image source={{ uri: otherUser.photoUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={24} color={COLORS.textLight} />
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
      </View>

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
