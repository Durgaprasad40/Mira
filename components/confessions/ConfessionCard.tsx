import React, { useMemo } from 'react';
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
  previewUsed?: boolean; // true if one-time profile preview has been used
  isConnected?: boolean; // true if tagged user has connected (chat created)
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
  onViewProfile?: () => void; // one-time profile preview for tagged receivers
  onLongPress?: () => void; // for author manual delete
  onTagPress?: () => void; // tap @tag to open profile preview
  onConnect?: () => void; // tagged user connects to start chat
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
  previewUsed,
  isConnected,
  taggedUserId,
  authorId,
  viewerId,
  taggedUserName,
  onPress,
  onReact,
  onToggleEmoji,
  onReplyAnonymously,
  onReport,
  onViewProfile,
  onLongPress,
  onTagPress,
  onConnect,
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
    // Now handled by parent component via onReport (shows Report/Block menu)
    onReport?.();
  };

  const displayName = isAnonymous ? 'Anonymous' : (authorName || 'Someone');

  // Check if we have a tappable tag to display
  const hasTag = taggedUserId && taggedUserName;

  return (
    <TouchableOpacity
      style={[styles.card, isTaggedForMe && styles.cardHighlighted]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={700}
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

      {/* Body - text with tappable @tag */}
      <Text style={styles.confessionText} numberOfLines={4}>
        {text}
        {hasTag && (
          <>
            {' '}
            <Text
              style={styles.tagLink}
              onPress={(e) => {
                e.stopPropagation?.();
                onTagPress?.();
              }}
            >
              @{taggedUserName}
            </Text>
          </>
        )}
      </Text>

      {/* Tagged user display (non-clickable, privacy-safe) */}
      {tagDisplayText && (
        <View style={styles.taggedRow}>
          <Ionicons name="heart" size={12} color={COLORS.primary} />
          <Text style={styles.taggedLabel}>Confess-to:</Text>
          <Text style={styles.taggedName}>{tagDisplayText}</Text>
        </View>
      )}

      {/* View Profile button for tagged receivers (one-time use) */}
      {isTaggedForMe && onViewProfile && (
        <TouchableOpacity
          style={[
            styles.viewProfileButton,
            previewUsed && styles.viewProfileButtonUsed,
          ]}
          onPress={previewUsed ? undefined : onViewProfile}
          activeOpacity={previewUsed ? 1 : 0.7}
          disabled={previewUsed}
        >
          <Ionicons
            name={previewUsed ? 'checkmark-circle' : 'eye-outline'}
            size={14}
            color={previewUsed ? COLORS.textMuted : COLORS.primary}
          />
          <Text
            style={[
              styles.viewProfileText,
              previewUsed && styles.viewProfileTextUsed,
            ]}
          >
            {previewUsed ? 'Preview used' : 'View their profile'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Connect button - ONLY for the tagged user */}
      {isTaggedForMe && onConnect && (
        <TouchableOpacity
          style={[
            styles.connectButton,
            isConnected && styles.connectButtonConnected,
          ]}
          onPress={isConnected ? undefined : onConnect}
          activeOpacity={isConnected ? 1 : 0.7}
          disabled={isConnected}
        >
          <Ionicons
            name={isConnected ? 'checkmark-circle' : 'chatbubbles-outline'}
            size={14}
            color={isConnected ? COLORS.textMuted : COLORS.white}
          />
          <Text
            style={[
              styles.connectButtonText,
              isConnected && styles.connectButtonTextConnected,
            ]}
          >
            {isConnected ? 'Chat unlocked' : 'Accept & start chat'}
          </Text>
        </TouchableOpacity>
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
  tagLink: {
    color: COLORS.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
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
  viewProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  viewProfileButtonUsed: {
    backgroundColor: 'rgba(153,153,153,0.1)',
  },
  viewProfileText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  viewProfileTextUsed: {
    color: COLORS.textMuted,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  connectButtonConnected: {
    backgroundColor: 'rgba(153,153,153,0.1)',
  },
  connectButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  connectButtonTextConnected: {
    color: COLORS.textMuted,
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
