import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';
import { ConfessionMood } from '@/types';

interface ReplyPreview {
  text: string;
  isAnonymous: boolean;
  type: string;
  createdAt: number;
}

interface EmojiCount {
  emoji: string;
  count: number;
}

interface ConfessionCardProps {
  id: string;
  text: string;
  isAnonymous: boolean;
  mood: ConfessionMood;
  topEmojis: EmojiCount[];
  userEmoji: string | null;
  replyCount: number;
  replyPreviews: ReplyPreview[];
  reactionCount: number;
  authorName?: string;
  authorPhotoUrl?: string;
  createdAt: number;
  onPress?: () => void;
  onReact: () => void; // opens emoji picker
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
  topEmojis,
  userEmoji,
  replyCount,
  replyPreviews,
  reactionCount,
  authorName,
  createdAt,
  onPress,
  onReact,
  onReplyAnonymously,
  onReport,
}: ConfessionCardProps) {
  const handleMenu = () => {
    Alert.alert('Options', undefined, [
      {
        text: 'Copy Text',
        onPress: async () => {
          await Clipboard.setStringAsync(text);
        },
      },
      { text: 'Report', style: 'destructive', onPress: onReport },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const displayName = isAnonymous ? 'Anonymous' : (authorName || 'Someone');

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
        <Text style={styles.authorName}>{displayName}</Text>
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

      {/* Emoji Reactions Display */}
      <View style={styles.emojiRow}>
        {topEmojis.filter((e) => isProbablyEmoji(e.emoji)).map((e, i) => (
          <View key={i} style={styles.emojiChip}>
            <Text style={styles.emojiText}>{e.emoji}</Text>
            <Text style={styles.emojiCount}>{e.count}</Text>
          </View>
        ))}
        {(() => {
          const valid = topEmojis.filter((e) => isProbablyEmoji(e.emoji));
          const visibleCount = valid.reduce((s, e) => s + e.count, 0);
          const remaining = reactionCount - visibleCount;
          return remaining > 0 && valid.length > 0 ? (
            <Text style={styles.moreReactions}>+{remaining}</Text>
          ) : null;
        })()}
        <TouchableOpacity
          style={[styles.addEmojiButton, userEmoji ? styles.addEmojiButtonActive : null]}
          onPress={onReact}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          {userEmoji ? (
            <Text style={styles.userEmojiText}>{userEmoji}</Text>
          ) : (
            <Ionicons name="happy-outline" size={16} color={COLORS.textMuted} />
          )}
        </TouchableOpacity>
      </View>

      {/* Reply Previews (first 2 replies) */}
      {replyPreviews.length > 0 && (
        <View style={styles.replyPreviewSection}>
          {replyPreviews.map((r, i) => (
            <View key={i} style={styles.replyPreviewRow}>
              <View style={styles.replyPreviewAvatar}>
                <Ionicons name="chatbubble" size={8} color={COLORS.textMuted} />
              </View>
              <Text style={styles.replyPreviewText} numberOfLines={1}>
                {r.type === 'voice' ? '🎙️ Voice reply' : r.text}
              </Text>
            </View>
          ))}
          {replyCount > 2 && (
            <TouchableOpacity onPress={onPress}>
              <Text style={styles.viewAllReplies}>View all {replyCount} replies</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  emojiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
  },
  emojiText: {
    fontSize: 13,
  },
  emojiCount: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  moreReactions: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginLeft: 2,
  },
  addEmojiButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  addEmojiButtonActive: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderColor: COLORS.primary,
  },
  userEmojiText: {
    fontSize: 14,
  },
  replyPreviewSection: {
    marginBottom: 6,
    gap: 4,
  },
  replyPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
  },
  replyPreviewAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(153,153,153,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyPreviewText: {
    fontSize: 12,
    color: COLORS.textMuted,
    flex: 1,
  },
  viewAllReplies: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    paddingLeft: 26,
    marginTop: 2,
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
