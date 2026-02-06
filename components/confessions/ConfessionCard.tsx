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
import { ConfessionMood } from '@/types';
import ReactionBar, { EmojiCount } from './ReactionBar';

interface ReplyPreview {
  text: string;
  isAnonymous: boolean;
  type: string;
  createdAt: number;
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
  isExpired?: boolean; // true if confession has expired from public feed
  isTaggedForMe?: boolean; // true if current user is tagged in this confession
  // Tagged user display (privacy-safe)
  taggedUserId?: string;
  authorId?: string;
  viewerId?: string;
  taggedUserName?: string; // only provided when viewer is author
  onPress?: () => void;
  onReact: () => void; // opens emoji picker
  onToggleEmoji?: (emoji: string) => void; // directly toggle a specific emoji
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
  isExpired,
  isTaggedForMe,
  taggedUserId,
  authorId,
  viewerId,
  taggedUserName,
  onPress,
  onReact,
  onToggleEmoji,
  onReplyAnonymously,
  onReport,
}: ConfessionCardProps) {
  // Privacy-safe tag display logic
  const getTagDisplayText = (): string | null => {
    if (!taggedUserId) return null;
    if (viewerId === taggedUserId) return 'You';
    if (viewerId === authorId && taggedUserName) return taggedUserName;
    return 'Someone';
  };
  const tagDisplayText = getTagDisplayText();
  const handleMenu = () => {
    Alert.alert('Report Confession', 'Are you sure you want to report this confession?', [
      { text: 'Report', style: 'destructive', onPress: onReport },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const displayName = isAnonymous ? 'Anonymous' : (authorName || 'Someone');

  return (
    <TouchableOpacity
      style={[styles.card, isTaggedForMe && styles.cardHighlighted]}
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
        {isTaggedForMe && (
          <View style={styles.forYouBadge}>
            <Ionicons name="heart" size={9} color={COLORS.primary} />
            <Text style={styles.forYouText}>For you</Text>
          </View>
        )}
        {isExpired && (
          <View style={styles.expiredBadge}>
            <Text style={styles.expiredText}>Expired</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {onReport && (
          <TouchableOpacity
            onPress={handleMenu}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="ellipsis-horizontal" size={14} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Body */}
      <Text style={styles.confessionText} numberOfLines={4}>
        {text}
      </Text>

      {/* Tagged user display (non-clickable, privacy-safe) */}
      {tagDisplayText && (
        <View style={styles.taggedRow}>
          <Ionicons name="heart" size={12} color={COLORS.primary} />
          <Text style={styles.taggedLabel}>Confess-to:</Text>
          <Text style={styles.taggedName}>{tagDisplayText}</Text>
        </View>
      )}

      {/* Emoji Reactions */}
      <View style={styles.reactionBarWrap}>
        <ReactionBar
          topEmojis={topEmojis}
          userEmoji={userEmoji}
          reactionCount={reactionCount}
          onReact={onReact}
          onToggleEmoji={onToggleEmoji}
          size="compact"
        />
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
  cardHighlighted: {
    backgroundColor: 'rgba(255,107,107,0.04)', // Subtle pink tint
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.15)', // Soft border
  },
  forYouBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  forYouText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
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
  expiredBadge: {
    backgroundColor: 'rgba(153,153,153,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  expiredText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  confessionText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    color: COLORS.text,
    marginBottom: 8,
  },
  taggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,107,107,0.06)',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  taggedLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  taggedName: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  reactionBarWrap: {
    marginBottom: 6,
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
