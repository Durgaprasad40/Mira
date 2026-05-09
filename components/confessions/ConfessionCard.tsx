import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  SIZES,
  FONT_SIZE,
  FONT_WEIGHT,
  moderateScale,
  lineHeight,
} from '@/lib/constants';
import { ConfessionMood, ConfessionAuthorVisibility } from '@/types';
import ReactionBar, { EmojiCount } from './ReactionBar';

// Blur radius for blur_photo mode (matches T/D blurred-identity strength so
// blurred photos read with the same intensity across both surfaces).
const BLUR_PHOTO_RADIUS = 24;

// Responsive avatar size
const AVATAR_SIZE = moderateScale(22, 0.3);

interface ReplyPreview {
  text: string;
  isAnonymous: boolean;
  type: string;
  createdAt: number;
}

function getConfessGenderSymbol(gender?: string): { symbol: string; color: string } | null {
  if (!gender) return null;
  const normalized = gender.trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm') return { symbol: '♂', color: '#4A90D9' };
  if (normalized === 'female' || normalized === 'f' || normalized === 'lesbian') {
    return { symbol: '♀', color: COLORS.primary };
  }
  return null;
}

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
  expiredDateLabel?: string; // owner-only My Confessions absolute expiry label
  reactionsReadOnly?: boolean; // show counts only; no picker/toggle affordance
  isTaggedForMe?: boolean; // true if current user is tagged in this confession
  previewUsed?: boolean; // true if one-time profile preview has been used
  isConnected?: boolean; // true if tagged user has connected (chat created)
  // Tagged user display (privacy-safe)
  taggedUserId?: string;
  authorId?: string;
  viewerId?: string;
  taggedUserName?: string; // only provided when viewer is author

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPLICIT INTERACTION CONTRACT - No ambiguous defaults
  // ═══════════════════════════════════════════════════════════════════════════
  screenContext?: string; // e.g., 'confessions', 'my-confessions' - for logging
  enableTapToOpenThread?: boolean; // Must be explicitly true to enable tap navigation
  enableLongPressMenu?: boolean; // Must be explicitly true to enable long-press menu

  // Handlers - only called if corresponding enable flag is true
  onCardPress?: () => void; // Called on tap if enableTapToOpenThread=true
  onCardLongPress?: () => void; // Called on long-press if enableLongPressMenu=true

  // Legacy props for backward compatibility (deprecated - use explicit contract above)
  onPress?: () => void;
  onLongPress?: () => void;

  onReact: () => void; // opens emoji picker
  onToggleEmoji?: (emoji: string) => void; // directly toggle a specific emoji
  onViewProfile?: () => void; // one-time profile preview for tagged receivers
  onTagPress?: () => void; // tap @tag to open profile preview
  onConnect?: () => void; // tagged user connects to start chat
  onAuthorPress?: () => void; // tap author identity to open full profile preview

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE EDIT MODE - Edit confession without navigation
  // ═══════════════════════════════════════════════════════════════════════════
  isEditing?: boolean; // true when card is in edit mode
  editText?: string; // current edit text (controlled externally)
  onEditTextChange?: (text: string) => void; // text changed callback
  onSaveEdit?: () => void; // save button pressed
  onCancelEdit?: () => void; // cancel button pressed
  isSaving?: boolean; // true while save is in progress
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
  expiredDateLabel,
  reactionsReadOnly = false,
  isTaggedForMe,
  previewUsed,
  isConnected,
  taggedUserId,
  authorId,
  viewerId,
  taggedUserName,
  // New explicit interaction contract
  screenContext = 'unknown',
  enableTapToOpenThread = false,
  enableLongPressMenu = false,
  onCardPress,
  onCardLongPress,
  // Legacy props (deprecated but still supported)
  onPress,
  onLongPress,
  onReact,
  onToggleEmoji,
  onViewProfile,
  onTagPress,
  onConnect,
  onAuthorPress,
  // Inline edit mode
  isEditing = false,
  editText,
  onEditTextChange,
  onSaveEdit,
  onCancelEdit,
  isSaving = false,
  id,
}: ConfessionCardProps) {
  // DEBUG: Log edit mode state
  if (isEditing) {
    console.log('[EDIT_RENDER] Card in edit mode:', { id, isEditing, editTextLength: editText?.length });
  }
  // Resolve handlers (new props take precedence over legacy)
  const tapHandler = onCardPress || onPress;
  const longPressHandler = onCardLongPress || onLongPress;
  const tapEnabled = !isEditing && (enableTapToOpenThread || !!onPress);
  const longPressEnabled = !isEditing && (enableLongPressMenu || !!onLongPress);

  // CRITICAL: Track if long-press fired to block tap navigation
  const longPressTriggeredRef = useRef(false);
  const isOwner = authorId === viewerId;

  const handleCardPress = useCallback(() => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (!tapEnabled) {
      return;
    }
    if (!id) {
      if (__DEV__) {
        console.warn('[CONFESS_CARD_PRESS_BLOCKED_MISSING_ID]', { screen: screenContext });
      }
      return;
    }
    if (__DEV__) {
      console.log('[CONFESS_CARD_PRESS]', { screen: screenContext, hasId: true });
    }
    tapHandler?.();
  }, [id, screenContext, tapEnabled, tapHandler]);

  const handleCardLongPress = useCallback(() => {
    if (!longPressEnabled) {
      return;
    }
    longPressTriggeredRef.current = true;
    setTimeout(() => {
      longPressTriggeredRef.current = false;
    }, 1000);

    if (__DEV__) {
      console.log(`[CONFESS_LONG_PRESS] triggered screen=${screenContext} owner=${isOwner}`);
    }

    // Haptic feedback
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Call menu handler
    if (longPressHandler) {
      longPressHandler();
      if (__DEV__) console.log(`[CONFESS_LONG_PRESS] menu opened`);
    }
  }, [isOwner, longPressEnabled, longPressHandler, screenContext]);

  // Determine effective visibility mode (backward compat: use isAnonymous if authorVisibility not set)
  const effectiveVisibility: ConfessionAuthorVisibility = authorVisibility || (isAnonymous ? 'anonymous' : 'open');
  const isFullyAnonymous = effectiveVisibility === 'anonymous';
  // Handle both 'blur_photo' (current) and 'blur' (legacy schema value)
  const isBlurPhoto = effectiveVisibility === 'blur_photo' || (effectiveVisibility as string) === 'blur';
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

  const displayName = isFullyAnonymous ? 'Anonymous' : authorName || 'Someone';
  const authorGenderSymbol = !isFullyAnonymous ? getConfessGenderSymbol(authorGender) : null;

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
      <View style={styles.authorIdentityText}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={[styles.authorName, !isFullyAnonymous && styles.authorNamePublic]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        {!isFullyAnonymous && authorAge ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={[styles.authorAge, styles.authorNamePublic]}
          >
            , {authorAge}
          </Text>
        ) : null}
        {authorGenderSymbol ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={[styles.authorGenderSymbol, { color: authorGenderSymbol.color }]}
          >
            {authorGenderSymbol.symbol}
          </Text>
        ) : null}
      </View>
      {/* Blur indicator badge */}
      {isBlurPhoto && (
        <View style={styles.blurBadge}>
          <Ionicons name="eye-off-outline" size={SIZES.icon.xs - 2} color={COLORS.textMuted} />
        </View>
      )}
    </>
  );

  return (
    <Pressable
      onPress={tapEnabled ? handleCardPress : undefined}
      onLongPress={longPressEnabled ? handleCardLongPress : undefined}
      delayLongPress={300}
      style={({ pressed }) => [
        styles.card,
        isTaggedForMe && styles.cardHighlighted,
        pressed && tapEnabled && styles.cardPressed,
      ]}
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
        <Text maxFontSizeMultiplier={1.2} style={styles.timeAgo}>{getTimeAgo(createdAt)}</Text>
        {isTaggedForMe && (
          <View style={styles.forYouBadge}>
            <Ionicons name="heart" size={FONT_SIZE.xxs} color={COLORS.primary} />
            <Text maxFontSizeMultiplier={1.2} style={styles.forYouText}>For you</Text>
          </View>
        )}
        {isExpired && (
          <View style={styles.expiredBadge}>
            <Text maxFontSizeMultiplier={1.2} style={styles.expiredText}>
              {expiredDateLabel ?? 'Expired'}
            </Text>
          </View>
        )}
      </View>

      {/* Body - text with tappable @tag OR edit mode */}
      {isEditing ? (
        // INLINE EDIT MODE
        <View style={styles.editModeContainer}>
          <TextInput
            style={styles.editTextInput}
            value={editText}
            onChangeText={onEditTextChange}
            placeholder="Write your confession..."
            placeholderTextColor={COLORS.textMuted}
            multiline
            autoFocus
            editable={!isSaving}
            maxLength={500}
          />
          <View style={styles.editActionsRow}>
            <TouchableOpacity
              style={[styles.editButton, styles.editButtonCancel]}
              onPress={onCancelEdit}
              disabled={isSaving}
              activeOpacity={0.7}
            >
              <Text maxFontSizeMultiplier={1.2} style={styles.editButtonCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.editButton, styles.editButtonSave, isSaving && styles.editButtonDisabled]}
              onPress={onSaveEdit}
              disabled={isSaving || !editText?.trim()}
              activeOpacity={0.7}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text maxFontSizeMultiplier={1.2} style={styles.editButtonSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // NORMAL VIEW MODE
        <Text maxFontSizeMultiplier={1.2} style={styles.confessionText} numberOfLines={4}>
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
      )}

      {/* Hide all below sections when in edit mode */}
      {!isEditing && (
        <>
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
              <Text maxFontSizeMultiplier={1.2} style={styles.taggedLabel}>Confess-to:</Text>
              <Text maxFontSizeMultiplier={1.2} style={[styles.taggedName, onTagPress && styles.taggedNameTappable]}>{tagDisplayText}</Text>
            </TouchableOpacity>
          )}

          {onViewProfile && (
            <TouchableOpacity
              style={[styles.viewProfileButton, previewUsed && styles.viewProfileButtonUsed]}
              onPress={(e) => {
                e.stopPropagation?.();
                if (!previewUsed) {
                  onViewProfile();
                }
              }}
              activeOpacity={previewUsed ? 1 : 0.7}
            >
              <Ionicons
                name="person-circle-outline"
                size={16}
                color={previewUsed ? COLORS.textMuted : COLORS.primary}
              />
              <Text maxFontSizeMultiplier={1.2} style={[styles.viewProfileText, previewUsed && styles.viewProfileTextUsed]}>
                {previewUsed ? 'Profile preview used' : 'View Profile'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Emoji Reactions */}
          <View style={styles.reactionBarWrap}>
            {reactionsReadOnly ? (
              <View style={styles.readOnlyReactionRow}>
                <Ionicons name="heart-outline" size={SIZES.icon.sm - 2} color={COLORS.textMuted} />
                <Text maxFontSizeMultiplier={1.2} style={styles.readOnlyReactionCount}>
                  {reactionCount}
                </Text>
                <Text maxFontSizeMultiplier={1.2} style={styles.readOnlyReactionLabel}>
                  {reactionCount === 1 ? 'Reaction' : 'Reactions'}
                </Text>
              </View>
            ) : (
              <ReactionBar
                topEmojis={topEmojis}
                userEmoji={userEmoji}
                reactionCount={reactionCount}
                onReact={onReact}
                onToggleEmoji={onToggleEmoji}
                size="compact"
              />
            )}
          </View>

          {/* Reply Previews (first 2 replies) */}
          {replyPreviews.length > 0 && (
            <View style={styles.replyPreviewSection}>
              {replyPreviews.map((r, i) => (
                <View key={i} style={styles.replyPreviewRow}>
                  <View style={styles.replyPreviewAvatar}>
                    <Ionicons name="chatbubble" size={8} color={COLORS.textMuted} />
                  </View>
                  <Text maxFontSizeMultiplier={1.2} style={styles.replyPreviewText} numberOfLines={1}>
                    {r.type === 'voice' ? '🎙️ Voice reply' : r.text}
                  </Text>
                </View>
              ))}
              {/* Show "View all" only if more replies than previews shown */}
              {replyCount > replyPreviews.length && (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleCardPress();
                  }}
                >
                  <Text maxFontSizeMultiplier={1.2} style={styles.viewAllReplies}>
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
                <Text maxFontSizeMultiplier={1.2} style={styles.footerCount}>{replyCount}</Text>
                <Text maxFontSizeMultiplier={1.2} style={styles.footerLabel}>{replyCount === 1 ? 'Reply' : 'Replies'}</Text>
              </View>
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
    // Crisp hairline border for refined definition on white backgrounds —
    // replaces the cheap outline-only look with a premium editorial edge.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    // Layered neutral shadow — deeper spread, lower opacity = more lift,
    // less cheap bloom. No colored shadow bleed.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  cardHighlighted: {
    // Single-edge accent — quiet, authorial. No full outline.
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    paddingLeft: 18 - 3 + StyleSheet.hairlineWidth,
  },
  cardPressed: {
    opacity: 0.98,
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
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    minHeight: 26,
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
    flex: 1,
    minWidth: 0,
  },
  authorIdentityTappable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs, // Clean spacing
    paddingVertical: SPACING.xxs,
    paddingRight: SPACING.xs,
    borderRadius: SIZES.radius.xs,
    flex: 1,
    minWidth: 0,
  },
  authorIdentityText: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  authorName: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  // Public (open / blur_photo) name uses the premium readable text color.
  // Identity color (pink/blue) is reserved for the gender symbol only.
  authorNamePublic: {
    color: COLORS.text,
  },
  authorAge: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 0,
  },
  authorGenderSymbol: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '700',
    marginLeft: SPACING.xxs,
    flexShrink: 0,
  },
  blurBadge: {
    marginLeft: SPACING.xs,
    padding: SPACING.xxs,
    backgroundColor: 'rgba(153,153,153,0.12)',
    borderRadius: 4,
  },
  timeAgo: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    flexShrink: 0,
    marginLeft: 'auto', // Push to right side
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
    fontSize: FONT_SIZE.lg,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    color: COLORS.text,
    marginBottom: SPACING.md,
    letterSpacing: 0.1,
    // Text wrapping safety - works with card padding for proper line length
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
    marginBottom: SPACING.sm,
    marginTop: SPACING.xxs,
  },
  readOnlyReactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs,
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: SPACING.xxs + 1,
    borderRadius: SIZES.radius.xs,
    backgroundColor: COLORS.backgroundDark,
  },
  readOnlyReactionCount: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.textMuted,
  },
  readOnlyReactionLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
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
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.xs,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.xxs,
  },
  footerCount: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  footerLabel: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE EDIT MODE STYLES
  // ═══════════════════════════════════════════════════════════════════════════
  editModeContainer: {
    gap: SPACING.md,
  },
  editTextInput: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
  editButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 10,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editButtonCancelText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  editButtonSave: {
    backgroundColor: COLORS.primary,
  },
  editButtonSaveText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  editButtonDisabled: {
    opacity: 0.6,
  },
});
