import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionReactionType, ConfessionMood } from '@/types';
import ReactionBar from './ReactionBar';

interface ConfessionCardProps {
  id: string;
  text: string;
  isAnonymous: boolean;
  mood: ConfessionMood;
  topic?: any; // accepted but unused — no categories
  reactions: Record<ConfessionReactionType, number>;
  userReactions: ConfessionReactionType[];
  replyCount: number;
  createdAt: number;
  onPress?: () => void;
  onReact: (type: ConfessionReactionType) => void;
  onReplyAnonymously?: () => void;
  onReport?: () => void;
}

function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ConfessionCard({
  text,
  isAnonymous,
  reactions,
  userReactions,
  replyCount,
  createdAt,
  onPress,
  onReact,
  onReplyAnonymously,
  onReport,
}: ConfessionCardProps) {
  const handleMenu = () => {
    Alert.alert('Options', undefined, [
      { text: 'Report', style: 'destructive', onPress: onReport },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Author row */}
      <View style={styles.authorRow}>
        <View style={[styles.avatar, isAnonymous && styles.avatarAnonymous]}>
          <Ionicons
            name={isAnonymous ? 'eye-off' : 'person'}
            size={12}
            color={isAnonymous ? COLORS.textMuted : COLORS.primary}
          />
        </View>
        <Text style={styles.authorName}>
          {isAnonymous ? 'Anonymous' : 'Someone'}
        </Text>
        <Text style={styles.timeAgo}>{getTimeAgo(createdAt)}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={handleMenu}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-horizontal" size={14} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Body */}
      <Text style={styles.confessionText} numberOfLines={4}>
        {text}
      </Text>

      {/* Reaction Bar */}
      <ReactionBar
        reactions={reactions}
        userReactions={userReactions}
        onToggleReaction={(type) => onReact(type)}
        compact
      />

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerButton}
          onPress={(e) => {
            e.stopPropagation?.();
            onReplyAnonymously?.();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chatbubble-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.footerCount}>{replyCount}</Text>
          <Text style={styles.footerLabel}>Reply</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    marginHorizontal: 10,
    marginVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  authorName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  confessionText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    color: COLORS.text,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingTop: 6,
    marginTop: 4,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  footerLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
});
