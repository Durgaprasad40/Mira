import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

// Debug logging for device verification - CRITICAL for Android debugging
const DEBUG_CONFESS = __DEV__;
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
  // ══════════════════════════════════════════════════════════════════════════
  // PRODUCTION FIX: GestureDetector with direct Animated.View child
  // Previous bug: Pressable between GestureDetector and Animated.View blocked native gestures
  // Fix: GestureDetector -> Animated.View (direct child) with composed Tap + LongPress
  // ══════════════════════════════════════════════════════════════════════════

  // Resolve handlers (new props take precedence over legacy)
  const tapHandler = onCardPress || onPress;
  const longPressHandler = onCardLongPress || onLongPress;
  // Disable gestures when in edit mode to allow TextInput interaction
  const tapEnabled = !isEditing && (enableTapToOpenThread || !!onPress);
  const longPressEnabled = !isEditing && (enableLongPressMenu || !!onLongPress);

  // Animation
  const cardScale = useSharedValue(1);
  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  // CRITICAL: Track if long-press fired to block tap navigation
  const longPressTriggeredRef = useRef(false);

  // Owner check for logging
  const isOwner = authorId === viewerId;

  // ══════════════════════════════════════════════════════════════════════════
  // JS CALLBACKS - Called from native gesture handlers via runOnJS
  // ══════════════════════════════════════════════════════════════════════════

  const handleTap = useCallback(() => {
    // Check if long-press already handled this gesture
    if (longPressTriggeredRef.current) {
      if (__DEV__) console.log(`[CONFESS_TAP] blocked after long press`);
      return;
    }
    if (!tapEnabled) {
      if (__DEV__) console.log(`[CONFESS_CARD] screen=${screenContext} tap disabled`);
      return;
    }
    if (__DEV__) console.log(`[CONFESS_TAP] screen=${screenContext}`);
    tapHandler?.();
  }, [tapEnabled, screenContext, tapHandler]);

  const handleLongPressActivate = useCallback(() => {
    // Set flag FIRST to block any subsequent tap
    longPressTriggeredRef.current = true;

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
  }, [screenContext, isOwner, longPressHandler]);

  const handleGestureReset = useCallback(() => {
    // Reset flag after gesture completes
    longPressTriggeredRef.current = false;
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // NATIVE GESTURE CONFIGURATION - Tap and LongPress composed with Exclusive
  // Exclusive ensures only ONE gesture wins - LongPress listed first has priority
  // ══════════════════════════════════════════════════════════════════════════

  // Long press gesture - 300ms threshold
  const longPressGesture = Gesture.LongPress()
    .minDuration(300)
    .enabled(longPressEnabled)
    .onBegin(() => {
      'worklet';
      // Reset flag at start of gesture
      runOnJS(handleGestureReset)();
      // Visual feedback
      cardScale.value = withTiming(0.985, { duration: 60 });
      if (__DEV__) {
        runOnJS(console.log)(`[CONFESS_CARD] screen=${screenContext} gesture BEGIN`);
      }
    })
    .onStart(() => {
      'worklet';
      // Long press threshold reached - SUCCESS
      runOnJS(handleLongPressActivate)();
    })
    .onFinalize(() => {
      'worklet';
      // Reset animation
      cardScale.value = withTiming(1, { duration: 150 });
    });

  // Tap gesture - for opening thread
  const tapGesture = Gesture.Tap()
    .enabled(tapEnabled)
    .maxDuration(299) // Must be shorter than long-press threshold
    .onBegin(() => {
      'worklet';
      // Reset flag at start of gesture
      runOnJS(handleGestureReset)();
      // Visual feedback
      cardScale.value = withTiming(0.985, { duration: 60 });
      if (__DEV__) {
        runOnJS(console.log)(`[CONFESS_CARD] screen=${screenContext} tap BEGIN`);
      }
    })
    .onEnd((_, success) => {
      'worklet';
      // Reset animation
      cardScale.value = withTiming(1, { duration: 150 });
      if (success) {
        runOnJS(handleTap)();
      }
    });

  // Composed gesture: LongPress takes priority (listed first in Exclusive)
  const composedGesture = Gesture.Exclusive(longPressGesture, tapGesture);

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

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER - GestureDetector with DIRECT Animated.View child (CRITICAL for Android)
  // Previous bug: Pressable between GestureDetector and Animated.View blocked native gestures
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.card, isTaggedForMe && styles.cardHighlighted, cardAnimatedStyle]}>
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
              <Text style={styles.editButtonCancelText}>Cancel</Text>
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
                <Text style={styles.editButtonSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // NORMAL VIEW MODE
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
              <Text style={styles.taggedLabel}>Confess-to:</Text>
              <Text style={[styles.taggedName, onTagPress && styles.taggedNameTappable]}>{tagDisplayText}</Text>
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
              <Text style={[styles.viewProfileText, previewUsed && styles.viewProfileTextUsed]}>
                {previewUsed ? 'Profile preview used' : 'View Profile'}
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
              {/* Show "View all" only if more replies than previews shown */}
              {replyCount > replyPreviews.length && (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    tapHandler?.();
                  }}
                >
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
        </>
      )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    marginHorizontal: 12,
    marginVertical: 6,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    // Elevation for Android (proper cross-platform shadow)
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
    gap: 8,
    marginBottom: 10,
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
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    flexShrink: 1,
  },
  authorNamePublic: {
    color: COLORS.primary,
  },
  blurBadge: {
    marginLeft: 6,
    padding: 3,
    backgroundColor: 'rgba(153,153,153,0.12)',
    borderRadius: 4,
  },
  timeAgo: {
    fontSize: 12,
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
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    color: COLORS.text,
    marginBottom: 14,
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
    marginBottom: 8,
    marginTop: 2,
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
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
    marginTop: 6,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  footerCount: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  footerLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE EDIT MODE STYLES
  // ═══════════════════════════════════════════════════════════════════════════
  editModeContainer: {
    gap: 12,
  },
  editTextInput: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  editButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
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
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  editButtonSave: {
    backgroundColor: COLORS.primary,
  },
  editButtonSaveText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  editButtonDisabled: {
    opacity: 0.6,
  },
});
