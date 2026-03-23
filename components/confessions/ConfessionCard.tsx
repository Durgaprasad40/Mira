import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  SIZES,
  FONT_SIZE,
  FONT_WEIGHT,
  HAIRLINE,
  moderateScale,
} from '@/lib/constants';
import { ConfessionMood, ConfessionAuthorVisibility } from '@/types';
import ReactionBar, { EmojiCount } from './ReactionBar';

// Blur radius for blur_photo mode
const BLUR_PHOTO_RADIUS = 20;

// Responsive avatar size
const AVATAR_SIZE = moderateScale(22, 0.3);

interface ReplyPreview {
  text: string;
  isAnonymous: boolean;
  type: string;
  createdAt: number;
}

// Gender labels for display
const GENDER_LABELS: Record<string, string> = {
  male: 'M',
  female: 'F',
  non_binary: 'NB',
  lesbian: 'F',
  other: '',
};

interface ConfessionCardProps {
  id: string;
  text: string;
  isAnonymous: boolean;
  authorVisibility?: ConfessionAuthorVisibility; // New 3-mode visibility
  mood: ConfessionMood;
  topEmojis: EmojiCount[];
  userEmoji: string | null;
  replyCount: number;
  replyPreviews: ReplyPreview[];
  reactionCount: number;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
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
  onReport?: () => void;
  onViewProfile?: () => void; // one-time profile preview for tagged receivers
  onLongPress?: () => void; // for author manual delete
  onTagPress?: () => void; // tap @tag to open profile preview
  onConnect?: () => void; // tagged user connects to start chat
  onAuthorPress?: () => void; // tap author identity to open full profile preview
}

// P1-004 FIX: Guard against undefined/null timestamp (legacy data)
function getTimeAgo(timestamp: number | undefined | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return 'just now';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now'; // Future timestamp protection
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
  authorVisibility,
  topEmojis,
  userEmoji,
  replyCount,
  replyPreviews,
  reactionCount,
  authorName,
  authorPhotoUrl,
  authorAge,
  authorGender,
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
  onReport,
  onViewProfile,
  onLongPress,
  onTagPress,
  onConnect,
  onAuthorPress,
}: ConfessionCardProps) {
  // Determine effective visibility mode (backward compat: use isAnonymous if authorVisibility not set)
  const effectiveVisibility: ConfessionAuthorVisibility = authorVisibility || (isAnonymous ? 'anonymous' : 'open');
  const isFullyAnonymous = effectiveVisibility === 'anonymous';
  const isBlurPhoto = effectiveVisibility === 'blur_photo';
  // Tag display logic - show actual tagged user name to all viewers
  // Author remains anonymous, but target is visible
  const getTagDisplayText = (): string | null => {
    if (!taggedUserId) return null;
    if (viewerId === taggedUserId) return 'You';
    // Show actual name to all viewers if available
    if (taggedUserName) return taggedUserName;
    return 'Someone';
  };
  const tagDisplayText = getTagDisplayText();
  const handleMenu = () => {
    // Now handled by parent component via onReport (shows Report/Block menu)
    onReport?.();
  };

  // Build display name with age and gender based on visibility mode
  const getDisplayName = (): string => {
    if (isFullyAnonymous) return 'Anonymous';
    if (!authorName) return 'Someone';

    let name = authorName;
    // For blur_photo and open modes, show age and gender
    if (authorAge) {
      name += `, ${authorAge}`;
    }
    if (authorGender && GENDER_LABELS[authorGender]) {
      name += ` ${GENDER_LABELS[authorGender]}`;
    }
    return name;
  };
  const displayName = getDisplayName();

  // Check if we have a tappable tag to display
  const hasTag = taggedUserId && taggedUserName;

  // Non-anonymous confessions can have tappable author area (open and blur_photo modes)
  const isAuthorTappable = !isFullyAnonymous && authorId && onAuthorPress;

  // Render the author identity content based on visibility mode
  const renderAuthorIdentity = () => (
    <>
      {/* Photo rendering based on visibility mode */}
      {isFullyAnonymous ? (
        // Anonymous: no photo, just icon
        <View style={[styles.avatar, styles.avatarAnonymous]}>
          <Ionicons name="eye-off" size={SIZES.icon.xs} color={COLORS.textMuted} />
        </View>
      ) : isBlurPhoto && authorPhotoUrl ? (
        // Blur photo: show blurred image
        <Image
          source={{ uri: authorPhotoUrl }}
          style={styles.avatarImage}
          contentFit="cover"
          blurRadius={BLUR_PHOTO_RADIUS}
        />
      ) : authorPhotoUrl ? (
        // Open: show clear photo
        <Image
          source={{ uri: authorPhotoUrl }}
          style={styles.avatarImage}
          contentFit="cover"
        />
      ) : (
        // No photo available: show person icon
        <View style={styles.avatar}>
          <Ionicons name="person" size={SIZES.icon.xs} color={COLORS.primary} />
        </View>
      )}
      <Text style={[styles.authorName, !isFullyAnonymous && styles.authorNamePublic]}>{displayName}</Text>
      {/* Blur indicator badge */}
      {isBlurPhoto && (
        <View style={styles.blurBadge}>
          <Ionicons name="eye-off-outline" size={SIZES.icon.xs - 2} color={COLORS.textMuted} />
        </View>
      )}
    </>
  );

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
        {isAuthorTappable ? (
          <TouchableOpacity
            style={styles.authorIdentityTappable}
            onPress={(e) => {
              e.stopPropagation?.();
              onAuthorPress?.();
            }}
            activeOpacity={0.7}
          >
            {renderAuthorIdentity()}
          </TouchableOpacity>
        ) : (
          <View style={styles.authorIdentity}>
            {renderAuthorIdentity()}
          </View>
        )}
        <Text style={styles.timeAgo}>{getTimeAgo(createdAt)}</Text>
        {isTaggedForMe && (
          <View style={styles.forYouBadge}>
            <Ionicons name="heart" size={FONT_SIZE.xxs} color={COLORS.primary} />
            <Text style={styles.forYouText}>For you</Text>
          </View>
        )}
        {isExpired && (
          <View style={styles.expiredBadge}>
            <Text style={styles.expiredText}>Expired</Text>
          </View>
        )}
        <View style={styles.headerSpacer} />
        {onReport && (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={handleMenu}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-horizontal" size={SIZES.icon.sm} color={COLORS.textMuted} />
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

      {/* Tagged user display - tappable to open profile */}
      {tagDisplayText && (
        <TouchableOpacity
          style={styles.taggedRow}
          onPress={(e) => {
            e.stopPropagation?.();
            onTagPress?.();
          }}
          disabled={!onTagPress}
          activeOpacity={onTagPress ? 0.7 : 1}
        >
          <Ionicons name="heart" size={SIZES.icon.xs} color={COLORS.primary} />
          <Text style={styles.taggedLabel}>Confess-to:</Text>
          <Text style={[styles.taggedName, onTagPress && styles.taggedNameTappable]}>{tagDisplayText}</Text>
        </TouchableOpacity>
      )}

      {/* NOTE: View Profile and Connect buttons removed from homepage cards.
          Actions now only appear inside the thread screen for cleaner UX. */}

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
          {/* Show "View all" only if more replies than previews shown */}
          {replyCount > replyPreviews.length && (
            <TouchableOpacity onPress={onPress}>
              <Text style={styles.viewAllReplies}>
                View all {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Footer - only show reply count if no previews displayed (avoids duplicate) */}
      {replyPreviews.length === 0 && replyCount > 0 && (
        <View style={styles.footer}>
          <View style={styles.footerButton} pointerEvents="none">
            <Ionicons name="chatbubble-outline" size={SIZES.icon.sm - 2} color={COLORS.textMuted} />
            <Text style={styles.footerCount}>{replyCount}</Text>
            <Text style={styles.footerLabel}>{replyCount === 1 ? 'Reply' : 'Replies'}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', // Explicit white, never override
    borderRadius: SIZES.radius.md,
    paddingHorizontal: SPACING.sm + 2,
    paddingTop: SPACING.sm + 2,
    paddingBottom: SPACING.sm,
    marginHorizontal: SPACING.sm + 2,
    marginVertical: SPACING.xs,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    // Elevation for Android
    elevation: 3,
  },
  cardHighlighted: {
    // Keep white background, add subtle left accent only
    borderLeftWidth: HAIRLINE * 3,
    borderLeftColor: COLORS.primary,
  },
  forYouBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs,
    backgroundColor: 'rgba(255,107,107,0.08)',
    paddingHorizontal: SPACING.xs + 1,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.xs,
    marginLeft: SPACING.xs,
    flexShrink: 0, // Prevent badge from shrinking
  },
  forYouText: {
    fontSize: FONT_SIZE.xxs,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.primary,
    letterSpacing: 0.1,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs, // Clean spacing, no arbitrary additions
    marginBottom: SPACING.xs,
    minHeight: moderateScale(24, 0.3),
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  authorIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs, // Clean spacing
    flexShrink: 1,
  },
  authorIdentityTappable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs, // Clean spacing
    paddingVertical: SPACING.xxs,
    paddingRight: SPACING.xs,
    borderRadius: SIZES.radius.xs,
    flexShrink: 1,
  },
  authorName: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
    flexShrink: 1, // Allow name to truncate if needed
  },
  authorNamePublic: {
    color: COLORS.primary,
  },
  blurBadge: {
    marginLeft: SPACING.xs,
    padding: SPACING.xxs,
    backgroundColor: 'rgba(153,153,153,0.15)',
    borderRadius: SIZES.radius.xs,
  },
  timeAgo: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    flexShrink: 0, // Prevent time from shrinking
  },
  headerSpacer: {
    flex: 1,
    minWidth: SPACING.xs, // Minimum spacing
  },
  menuButton: {
    flexShrink: 0,
    minWidth: moderateScale(24, 0.3),
    minHeight: moderateScale(24, 0.3),
    justifyContent: 'center',
    alignItems: 'center',
  },
  expiredBadge: {
    backgroundColor: 'rgba(153,153,153,0.15)',
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.xs,
    marginLeft: SPACING.xs,
  },
  expiredText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.textMuted,
  },
  confessionText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.medium, // Lighter than semibold for Android
    lineHeight: Math.round(FONT_SIZE.body2 * 1.3), // Fixed ratio, no double-scaling
    color: COLORS.text,
    marginBottom: SPACING.xs + 2, // Tightened from SPACING.sm
  },
  tagLink: {
    color: COLORS.primary,
    fontWeight: FONT_WEIGHT.semibold, // Lighter than bold for Android
    textDecorationLine: 'underline',
  },
  taggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 1,
    marginBottom: SPACING.xs + 2, // Tightened from SPACING.sm
    paddingVertical: SPACING.xxs + 1, // Tightened from SPACING.xs + 1
    paddingHorizontal: SPACING.sm + 2,
    backgroundColor: 'rgba(255,107,107,0.05)',
    borderRadius: SIZES.radius.sm,
    alignSelf: 'flex-start',
  },
  taggedLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontWeight: FONT_WEIGHT.medium,
  },
  taggedName: {
    fontSize: FONT_SIZE.sm,
    fontWeight: FONT_WEIGHT.semibold, // Lighter than bold for Android
    color: COLORS.primary,
  },
  taggedNameTappable: {
    textDecorationLine: 'underline',
  },
  viewProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: SIZES.radius.sm,
    marginBottom: SPACING.sm,
  },
  viewProfileButtonUsed: {
    backgroundColor: 'rgba(153,153,153,0.1)',
  },
  viewProfileText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.primary,
  },
  viewProfileTextUsed: {
    color: COLORS.textMuted,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md + 2,
    paddingVertical: SPACING.sm,
    borderRadius: SIZES.radius.sm,
    marginBottom: SPACING.sm,
  },
  connectButtonConnected: {
    backgroundColor: 'rgba(153,153,153,0.1)',
  },
  connectButtonText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.white,
  },
  connectButtonTextConnected: {
    color: COLORS.textMuted,
  },
  reactionBarWrap: {
    marginBottom: SPACING.xs, // Tightened from SPACING.xs + 2
  },
  replyPreviewSection: {
    marginBottom: SPACING.xs + 2,
    gap: SPACING.xs,
  },
  replyPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingLeft: SPACING.xs,
  },
  replyPreviewAvatar: {
    width: moderateScale(16, 0.3),
    height: moderateScale(16, 0.3),
    borderRadius: moderateScale(8, 0.3),
    backgroundColor: 'rgba(153,153,153,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyPreviewText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    flex: 1,
  },
  viewAllReplies: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.medium, // Lighter than semibold for Android
    color: COLORS.primary,
    paddingLeft: moderateScale(26, 0.3),
    marginTop: SPACING.xxs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.base,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.xs + 2,
    marginTop: SPACING.xs,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  footerCount: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    fontWeight: FONT_WEIGHT.medium,
  },
  footerLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },
});
