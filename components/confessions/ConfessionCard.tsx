import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionMood } from '@/types';

const MOOD_CONFIG: Record<ConfessionMood, { emoji: string; label: string; color: string; bg: string }> = {
  romantic: { emoji: '\u2764\uFE0F', label: 'Romantic', color: '#E91E63', bg: 'rgba(233,30,99,0.12)' },
  spicy: { emoji: '\uD83D\uDD25', label: 'Spicy', color: '#FF5722', bg: 'rgba(255,87,34,0.12)' },
  emotional: { emoji: '\uD83D\uDE22', label: 'Emotional', color: '#2196F3', bg: 'rgba(33,150,243,0.12)' },
  funny: { emoji: '\uD83D\uDE02', label: 'Funny', color: '#FF9800', bg: 'rgba(255,152,0,0.12)' },
};

interface ConfessionCardProps {
  id: string;
  text: string;
  isAnonymous: boolean;
  mood: ConfessionMood;
  replyCount: number;
  reactionCount: number;
  createdAt: number;
  hasReacted?: boolean;
  onPress?: () => void;
  onReact?: () => void;
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
  mood,
  replyCount,
  reactionCount,
  createdAt,
  hasReacted,
  onPress,
  onReact,
}: ConfessionCardProps) {
  const moodInfo = MOOD_CONFIG[mood];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.authorRow}>
          <View style={[styles.avatar, isAnonymous && styles.avatarAnonymous]}>
            <Ionicons
              name={isAnonymous ? 'eye-off' : 'person'}
              size={16}
              color={isAnonymous ? COLORS.textMuted : COLORS.primary}
            />
          </View>
          <Text style={styles.authorName}>
            {isAnonymous ? 'Anonymous' : 'Someone'}
          </Text>
          <Text style={styles.timeAgo}>{getTimeAgo(createdAt)}</Text>
        </View>
        <View style={[styles.moodBadge, { backgroundColor: moodInfo.bg }]}>
          <Text style={styles.moodEmoji}>{moodInfo.emoji}</Text>
          <Text style={[styles.moodLabel, { color: moodInfo.color }]}>{moodInfo.label}</Text>
        </View>
      </View>

      {/* Body */}
      <Text style={styles.confessionText} numberOfLines={4}>
        {text}
      </Text>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.footerButton}
          onPress={(e) => {
            e.stopPropagation?.();
            onReact?.();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={hasReacted ? 'heart' : 'heart-outline'}
            size={20}
            color={hasReacted ? COLORS.primary : COLORS.textMuted}
          />
          <Text style={[styles.footerCount, hasReacted && { color: COLORS.primary }]}>
            {reactionCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.footerButton} onPress={onPress}>
          <Ionicons name="chatbubble-outline" size={18} color={COLORS.textMuted} />
          <Text style={styles.footerCount}>{replyCount}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  moodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  moodEmoji: {
    fontSize: 12,
  },
  moodLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  confessionText: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
    marginBottom: 14,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerCount: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
});
