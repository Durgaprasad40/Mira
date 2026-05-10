/*
 * LOCKED (TRUTH OR DARE SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 *
 * UI REDESIGN v2: Premium dark theme with energetic feel
 */
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Platform, Animated, Pressable, Alert, Modal,
  Dimensions, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { Audio, Video, ResizeMode } from 'expo-av';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { TodAvatar } from '@/components/truthdare/TodAvatar';
import {
  TodPromptMediaTile,
  type TodPromptMediaPreloadStatus,
} from '@/components/truthdare/TodPromptMediaTile';
import { TodConnectRequestsIndicator } from '@/components/truthdare/TodConnectRequestsIndicator';
import { TodConnectRequestsSheet } from '@/components/truthdare/TodConnectRequestsSheet';
import { PendingPromptCard } from '@/components/truthdare/PendingPromptCard';
import {
  DraggableTodFab,
  PHASE2_TOD_FAB_STORAGE_KEYS,
} from '@/components/truthdare/DraggableTodFab';
import { useAuthStore } from '@/stores/authStore';
import {
  TruthDarePendingPromptUpload,
  useTruthDarePromptUploadStore,
} from '@/stores/truthDarePromptUploadStore';
import { useScreenTrace } from '@/lib/devTrace';
import { resolveAnswerPreviewIdentity } from '@/lib/todAnswerIdentity';

// Premium color palette - softer, more energetic dark theme
const PREMIUM = {
  // Softer dark backgrounds with depth
  bgDeep: '#0D0D1A',      // Deepest layer
  bgBase: '#141428',       // Main background
  bgElevated: '#1C1C36',   // Card surface
  bgHighlight: '#252545',  // Hover/active states

  // Accent colors
  coral: '#E94560',        // Primary accent (existing)
  coralSoft: '#FF6B8A',    // Lighter coral for gradients
  coralGlow: 'rgba(233, 69, 96, 0.25)', // Glow effect

  // Type badges
  truthPurple: '#7C6AEF',  // Refined purple for Truth
  truthPurpleLight: '#9D8FFF',
  dareOrange: '#FF7849',   // Warmer orange for Dare
  dareOrangeLight: '#FF9A70',

  // Text hierarchy
  textPrimary: '#F5F5F7',  // Bright white for headlines
  textSecondary: '#B8B8C7', // Softer for secondary
  textMuted: '#6E6E82',    // Muted for metadata

  // Borders and dividers
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderAccent: 'rgba(233, 69, 96, 0.3)',

  // Gender accent colors (subtle)
  genderFemale: '#FF8FA3',   // Soft pink
  genderMale: '#7DB9FF',     // Soft blue
  genderOther: '#B8B8C7',    // Neutral

  // Shadows
  shadowColor: '#000',
};

const debugTodLog = (...args: unknown[]) => {
  if (__DEV__) {
    console.log(...args);
  }
};

// Format millis as `m:ss` for the voice prompt scrubber readout.
function formatVoiceTime(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type TodFeedCacheEntry = {
  prompts: any[];
  trending: { trendingDarePrompt: any; trendingTruthPrompt: any } | null;
};

// Module-level cache is keyed by authenticated user to avoid cross-user leakage.
let _todFeedCacheByUser: Record<string, TodFeedCacheEntry> = {};

/**
 * Clear the T&D cache on logout to prevent data leak between users.
 * Called from authStore.logout() to ensure clean state.
 */
export function clearTodCache() {
  _todFeedCacheByUser = {};
  if (__DEV__) {
    debugTodLog('[T/D] Cache cleared on logout');
  }
}

// Timing for diagnostics
let _tabOpenTime = 0;

// M-001 FIX: Reset cache on HMR to prevent stale data in development
if (__DEV__ && typeof module !== 'undefined' && (module as any).hot) {
  (module as any).hot.accept(() => {
    _todFeedCacheByUser = {};
    _tabOpenTime = 0;
    debugTodLog('[T/D HMR] Cache cleared on hot reload');
  });
}

/** Prewarm is intentionally disabled until it can be keyed by authenticated user. */
export function prewarmTodCache(prompts: any[] | undefined, trending: any | undefined) {
  if (__DEV__ && (prompts !== undefined || trending !== undefined)) {
    debugTodLog('[T/D PREWARM] skipped until user-scoped prewarm is re-enabled');
  }
}

/** Get URL prefix for diagnostics */
function getUrlPrefix(url?: string): string {
  if (!url) return 'none';
  if (url.startsWith('https://')) return 'https';
  if (url.startsWith('http://')) return 'http';
  if (url.startsWith('file://')) return 'file';
  if (url.startsWith('convex://')) return 'convex';
  return 'unknown';
}

/** Check if URL is valid for display:
 * - Accept https/http always
 * - Accept file:// if NOT from unstable cache (ImagePicker cache)
 * - Reject content:// (not directly displayable)
 * P0-003 FIX: Case-insensitive path matching for cross-device Android consistency
 */
function isValidPhotoUrl(url?: string): boolean {
  if (!url) return false;
  // Accept remote URLs always
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  // Accept file:// if not from unstable cache
  if (url.startsWith('file://')) {
    // P0-003 FIX: Normalize to lowercase for case-insensitive matching
    // Samsung uses /cache/ImagePicker/, OnePlus may use /Cache/ImagePicker/
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/cache/imagepicker/')) {
      return false;
    }
    return true;
  }
  return false;
}

const C = INCOGNITO_COLORS;

/**
 * Photo display mode for Truth or Dare cards
 */
type PhotoMode = 'clear' | 'blur' | 'none';

/**
 * Determine photo display mode:
 * - anonymous => 'none' (no photo at all)
 * - public with valid photo AND photoBlurMode='blur' => 'blur' (show blurred photo)
 * - public with valid photo AND photoBlurMode='none' => 'clear' (show clear photo)
 * - public with no valid photo => 'none' (placeholder)
 */
function getPhotoMode(prompt: { isAnonymous?: boolean; photoBlurMode?: string; ownerPhotoUrl?: string }): PhotoMode {
  // Anonymous => no photo
  if (prompt.isAnonymous) return 'none';

  // Check if we have a valid photo URL
  const hasValidPhoto = prompt.ownerPhotoUrl && isValidPhotoUrl(prompt.ownerPhotoUrl);

  // Blur mode with valid photo => show blurred
  if (prompt.photoBlurMode === 'blur' && hasValidPhoto) return 'blur';

  // Clear photo available => show clear
  if (hasValidPhoto) return 'clear';

  // No valid photo => placeholder
  return 'none';
}

// Gender icon helper
function getGenderIcon(gender?: string): keyof typeof Ionicons.glyphMap | null {
  if (!gender) return null;
  const g = gender.toLowerCase();
  if (g === 'male') return 'male';
  if (g === 'female') return 'female';
  if (
    g === 'non_binary' ||
    g === 'non-binary' ||
    g === 'nonbinary' ||
    g === 'nb' ||
    g === 'other'
  ) {
    return 'male-female';
  }
  return null;
}

// Gender color helper
function getGenderColor(gender?: string): string {
  if (!gender) return PREMIUM.genderOther;
  const g = gender.toLowerCase();
  if (g === 'female') return PREMIUM.genderFemale;
  if (g === 'male') return PREMIUM.genderMale;
  return PREMIUM.genderOther;
}

/* ─── Skeleton Card (placeholder while loading) - Premium animated ─── */
const SkeletonCard = React.memo(function SkeletonCard() {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => {
      pulse.stop();
      pulseAnim.stopAnimation(() => {
        pulseAnim.setValue(0.4);
      });
    };
  }, [pulseAnim]);

  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonHeader}>
          <Animated.View style={[styles.skeletonAvatar, { opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonName, { opacity: pulseAnim }]} />
          <Animated.View style={[styles.skeletonPill, { opacity: pulseAnim }]} />
        </View>
        <Animated.View style={[styles.skeletonText, { opacity: pulseAnim }]} />
        <Animated.View style={[styles.skeletonTextShort, { opacity: pulseAnim }]} />
      </View>
      <Animated.View style={[styles.skeletonButton, { opacity: pulseAnim }]} />
    </View>
  );
});

/* ─── Compact Comment Preview Row - Premium styling ─── */
//
// Feed/homepage preview line for a single answer/comment. Shape:
//   text-only:       Name: comment snippet…
//   text + media:    Name: comment snippet…  ◐   ← per-type colored chip
//   media-only:      Name  ◐                     ← chip, never the word
//
// The trailing media glyph reuses the SAME premium palette and Ionicons
// names that `components/truthdare/AnswerComposerSheet.tsx` (the answer
// composer plus-menu) already uses for the same media types — so the
// homepage preview, the composer, and the answer-card tile all share
// one visual language:
//
//   photo  → camera-outline   coral  (#E94560)
//   video  → videocam-outline green  (#00B894)
//   voice  → mic-outline      orange (#FF9800)
//
// Each glyph is wrapped in a small rounded tinted chip so it reads as a
// deliberate badge instead of a free-floating system glyph. Chip tint
// is the per-type color at ~12% alpha (suffix `1F` on the hex), which
// gives a subtle colored backdrop against the dark feed card while
// keeping the foreground glyph crisp at full saturation.
//
// Layout notes:
//   • The chip is a flex sibling AFTER the `numberOfLines={1}` Text
//     with `flexShrink: 0` — text truncates first, the chip is never
//     eaten by the ellipsis on narrow Android screens.
//   • `commentRow` already lays children out in a row with gap:6 so
//     the chip visually sits one gap-unit after the truncated text.
type CommentMediaStyleEntry = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const COMMENT_MEDIA_ICON_MAP: Record<'photo' | 'video' | 'voice', CommentMediaStyleEntry> = {
  photo: { icon: 'camera-outline', color: '#E94560' },
  video: { icon: 'videocam-outline', color: '#00B894' },
  voice: { icon: 'mic-outline', color: '#FF9800' },
};

const CommentPreviewRow = React.memo(function CommentPreviewRow({ answer }: { answer: any }) {
  const identity = resolveAnswerPreviewIdentity(answer);
  const trimmedText = typeof answer.text === 'string' ? answer.text.trim() : '';
  const hasText = trimmedText.length > 0;

  const mediaStyleEntry =
    answer.type === 'photo' || answer.type === 'video' || answer.type === 'voice'
      ? COMMENT_MEDIA_ICON_MAP[answer.type as 'photo' | 'video' | 'voice']
      : null;

  return (
    <View style={styles.commentRow}>
      <TodAvatar
        size={18}
        photoUrl={identity.photoUrl}
        isAnonymous={identity.isAnonymous}
        photoBlurMode={identity.photoBlurMode}
        label={identity.displayName}
        style={styles.commentAvatar}
        backgroundColor={PREMIUM.bgHighlight}
        iconColor={PREMIUM.textMuted}
        textColor={PREMIUM.textPrimary}
        iconSize={10}
      />
      <Text
        style={styles.commentText}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={1.15}
      >
        <Text style={styles.commentName}>{identity.displayName}</Text>
        {hasText ? (
          <>
            <Text style={styles.commentName}>{': '}</Text>
            <Text style={styles.commentSnippet}>{trimmedText}</Text>
          </>
        ) : null}
      </Text>
      {mediaStyleEntry ? (
        <View
          style={[
            styles.commentMediaIcon,
            { backgroundColor: `${mediaStyleEntry.color}1F` },
          ]}
        >
          <Ionicons
            name={mediaStyleEntry.icon}
            size={12}
            color={mediaStyleEntry.color}
          />
        </View>
      ) : null}
    </View>
  );
});

/* ─── Section Header Component - Premium styling ─── */
function SectionHeader({
  label,
  isTrending,
  rightSlot,
}: {
  label: string;
  isTrending: boolean;
  rightSlot?: React.ReactNode;
}) {
  if (isTrending) {
    return (
      <View style={styles.trendingSectionHeader}>
        <View style={styles.trendingSectionHeaderLeft}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.trendingIconBg}
          >
            <Ionicons name="flame" size={12} color="#FFF" />
          </LinearGradient>
          <Text style={styles.trendingSectionLabel} maxFontSizeMultiplier={1.2}>Trending</Text>
        </View>
        {rightSlot}
      </View>
    );
  }

  return (
    <View style={styles.sectionHeaderContainer}>
      <View style={styles.sectionDivider} />
      <Text style={styles.sectionLabel} maxFontSizeMultiplier={1.15}>{label}</Text>
      <View style={styles.sectionDivider} />
    </View>
  );
}

/* ─── Prompt-owner media payload passed from a card to the feed-level
       PromptMediaViewerModal. Decoupled from any card prompt shape so both
       TrendingCard and PromptCard can call the same handler.

       Phase 4 fields:
        - `promptId`        : required to invoke `openPromptMedia` for non-
                              owner photo/video first opens.
        - `isPromptMediaOwner`         : owner can open inline (URL is in
                                         payload) without consuming a view.
        - `viewerHasViewedPromptMedia` : non-owner already-viewed flag —
                                         tap should surface a friendly
                                         "already viewed" message instead
                                         of opening the viewer.
*/
type PromptMediaPayload = {
  promptId?: string;
  mediaUrl?: string;
  mediaKind?: 'photo' | 'video' | 'voice';
  durationSec?: number;
  isFrontCamera?: boolean;
  isPromptMediaOwner?: boolean;
  viewerHasViewedPromptMedia?: boolean;
};

/* ─── Trending Prompt Data Type ─── */
type TrendingPromptData = {
  _id: any;
  type: 'truth' | 'dare';
  text: string;
  isTrending: boolean;
  expiresAt: number;
  answerCount: number;
  totalAnswers?: number;
  isAnonymous?: boolean;
  photoBlurMode?: 'none' | 'blur';
  ownerName?: string;
  ownerPhotoUrl?: string;
  ownerAge?: number;
  ownerGender?: string;
  // Phase 4: prompt-owner media (Phase 2 backend projection — feed shape).
  hasMedia?: boolean;
  mediaUrl?: string;
  mediaKind?: 'photo' | 'video' | 'voice';
  mediaMime?: string;
  durationSec?: number;
  isFrontCamera?: boolean;
  // Phase 4: prompt-owner media one-time-view metadata.
  promptMediaViewCount?: number;
  viewerHasViewedPromptMedia?: boolean;
  isPromptMediaOwner?: boolean;
  // Viewer-state: did the current viewer already answer this prompt?
  // Backend-derived in `getTrendingTruthAndDare` for the "Answered"
  // indicator. Optional because legacy/cached responses may omit it.
  hasAnswered?: boolean;
};

/* ─── Animated Press Wrapper for premium feel ─── */
function AnimatedPressCard({
  children,
  onPress,
  onLongPress,
  style,
  isTrending = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: any;
  isTrending?: boolean;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      delayLongPress={400}
    >
      <Animated.View style={[style, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/* ─── Trending Card (premium styling with glow accent) ─── */
// P2-002 FIX: Accept promptId prop and call handlers with ID to avoid inline arrow functions in renderItem
const TrendingCard = React.memo(function TrendingCard({
  prompt,
  promptId,
  onOpenThread,
  onOpenPromptMedia,
  onLongPress,
  isOwner,
  mediaPreloadStatus,
}: {
  prompt: TrendingPromptData;
  promptId: string;
  onOpenThread: (id: string) => void;
  onOpenPromptMedia: (payload: PromptMediaPayload) => void;
  onLongPress?: (id: string) => void;
  isOwner?: boolean;
  // Phase 4 (prompt-owner preload): drives the two-tap tile UX.
  // Computed at the screen level from a per-promptId state map so the
  // card itself stays oblivious to preload bookkeeping.
  mediaPreloadStatus?: TodPromptMediaPreloadStatus;
}) {
  // P2-002: Stable callback references
  const handleOpenThread = useCallback(() => onOpenThread(promptId), [onOpenThread, promptId]);
  const handleLongPress = useCallback(() => onLongPress?.(promptId), [onLongPress, promptId]);
  const handleOpenPromptMedia = useCallback(
    () =>
      onOpenPromptMedia({
        promptId,
        mediaUrl: prompt.mediaUrl,
        mediaKind: prompt.mediaKind,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera,
        isPromptMediaOwner: prompt.isPromptMediaOwner,
        viewerHasViewedPromptMedia: prompt.viewerHasViewedPromptMedia,
      }),
    [
      onOpenPromptMedia,
      promptId,
      prompt.mediaUrl,
      prompt.mediaKind,
      prompt.durationSec,
      prompt.isFrontCamera,
      prompt.isPromptMediaOwner,
      prompt.viewerHasViewedPromptMedia,
    ]
  );
  const isTruth = prompt.type === 'truth';
  const isAnon = prompt.isAnonymous ?? true;
  const answerCount = prompt.totalAnswers ?? prompt.answerCount ?? 0;
  const photoMode = getPhotoMode(prompt);
  const ownerGenderIcon = getGenderIcon(prompt.ownerGender);
  const genderColor = getGenderColor(prompt.ownerGender);

  const pillColors: readonly [string, string] = isTruth
    ? [PREMIUM.truthPurple, PREMIUM.truthPurpleLight]
    : [PREMIUM.dareOrange, PREMIUM.dareOrangeLight];

  return (
    <AnimatedPressCard
      onPress={handleOpenThread}
      onLongPress={isOwner ? handleLongPress : undefined}
      style={styles.trendingCard}
      isTrending
    >
      {/* Accent glow border effect */}
      <LinearGradient
        colors={[isTruth ? 'rgba(124,106,239,0.15)' : 'rgba(255,120,73,0.15)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.trendingGlow}
      />

      {/* Card content wrapper */}
      <View style={styles.cardContent}>
        {/* Header Row: Owner Identity */}
        <View style={styles.cardHeader}>
          <View style={styles.ownerIdentity}>
            <TodAvatar
              size={28}
              photoUrl={prompt.ownerPhotoUrl ?? null}
              isAnonymous={isAnon}
              photoBlurMode={prompt.photoBlurMode ?? (photoMode === 'blur' ? 'blur' : 'none')}
              label={prompt.ownerName || 'User'}
              borderWidth={1.5}
              borderColor={PREMIUM.borderSubtle}
              backgroundColor={PREMIUM.bgHighlight}
              iconColor={PREMIUM.textMuted}
            />
            {/* Identity: Name + Age/Gender on SAME ROW */}
            <View style={styles.ownerInfoRow}>
              <Text style={styles.ownerNamePremium} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {isAnon ? 'Anonymous' : (prompt.ownerName || 'User')}
              </Text>
              {!isAnon && (prompt.ownerAge || prompt.ownerGender) && (
                <View style={styles.ownerMetaInline}>
                  {prompt.ownerAge && (
                    <Text style={styles.ownerAgeInline} maxFontSizeMultiplier={1.15}>{prompt.ownerAge}</Text>
                  )}
                  {prompt.ownerGender && ownerGenderIcon && (
                    <>
                      <View style={[styles.genderDotInline, { backgroundColor: genderColor }]} />
                      <Ionicons name={ownerGenderIcon} size={11} color={genderColor} />
                    </>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Prompt text - Hero element. Text always uses the full content
            width on the left; any owner-attached media tile lives in the
            right column directly below the Truth/Dare pill. */}
        <Text style={styles.promptTextHero} numberOfLines={3} maxFontSizeMultiplier={1.2}>{prompt.text}</Text>

        {/* Engagement row */}
        <View style={styles.engagementRow}>
          <View style={styles.answerBadge}>
            <Ionicons name="chatbubble" size={11} color={PREMIUM.textMuted} />
            <Text style={styles.answerCountText} maxFontSizeMultiplier={1.15}>
              {answerCount === 1 ? '1 comment' : `${answerCount} comments`}
            </Text>
          </View>
          {/* Viewer-state indicator placed inline next to the answer count so
              the existing trending "Hot" pill on the right is never replaced
              or hidden. Backend-derived (`prompt.hasAnswered`); no temporary
              frontend state. */}
          {prompt.hasAnswered ? (
            <View style={styles.answeredBadge}>
              <Ionicons name="checkmark-circle" size={11} color={PREMIUM.coral} />
              <Text style={styles.answeredBadgeText} maxFontSizeMultiplier={1.15}>
                Commented
              </Text>
            </View>
          ) : null}
          <View style={styles.trendingBadge}>
            <Ionicons name="flame" size={11} color={PREMIUM.coral} />
            <Text style={styles.trendingBadgeText}>Hot</Text>
          </View>
        </View>
      </View>

      {/* Right column: Type pill on top; owner media tile (if any) directly
          below the pill so the right side reads as a clean media column. */}
      <View style={styles.cardRightColumn}>
        <LinearGradient
          colors={pillColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.typePillGradient}
        >
          <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={12} color="#FFF" />
          <Text style={styles.typePillText} maxFontSizeMultiplier={1.15}>{isTruth ? 'Truth' : 'Dare'}</Text>
        </LinearGradient>
        {prompt.hasMedia && prompt.mediaKind ? (
          <TodPromptMediaTile
            hasMedia={prompt.hasMedia}
            mediaUrl={prompt.mediaUrl}
            mediaKind={prompt.mediaKind}
            durationSec={prompt.durationSec}
            size={64}
            covered
            ownerViewCount={
              prompt.isPromptMediaOwner &&
              (prompt.mediaKind === 'photo' || prompt.mediaKind === 'video')
                ? prompt.promptMediaViewCount
                : undefined
            }
            showViewedBadge={
              !prompt.isPromptMediaOwner &&
              !!prompt.viewerHasViewedPromptMedia &&
              (prompt.mediaKind === 'photo' || prompt.mediaKind === 'video')
            }
            preloadStatus={mediaPreloadStatus}
            onPress={handleOpenPromptMedia}
            accessibilityLabel={
              prompt.mediaKind === 'voice'
                ? 'Open prompt voice attachment'
                : `Open covered prompt ${prompt.mediaKind}`
            }
          />
        ) : null}
      </View>
    </AnimatedPressCard>
  );
});

/* ─── Prompt Card (with comment previews) - Premium redesign ─── */
// P2-002 FIX: Accept promptId prop and call handlers with ID to avoid inline arrow functions in renderItem
const PromptCard = React.memo(function PromptCard({
  prompt,
  promptId,
  onOpenThread,
  onOpenPromptMedia,
  onLongPress,
  isOwner,
  mediaPreloadStatus,
}: {
  prompt: {
    _id: any;
    type: 'truth' | 'dare';
    text: string;
    isTrending: boolean;
    expiresAt: number;
    top2Answers: any[];
    totalAnswers: number;
    hasAnswered: boolean;
    myAnswerId: string | null;
    isAnonymous?: boolean;
    photoBlurMode?: 'none' | 'blur';
    ownerName?: string;
    ownerPhotoUrl?: string;
    ownerAge?: number;
    ownerGender?: string;
    answerCount?: number;
    // Phase 4: prompt-owner media (Phase 2 backend projection — feed shape).
    hasMedia?: boolean;
    mediaUrl?: string;
    mediaKind?: 'photo' | 'video' | 'voice';
    mediaMime?: string;
    durationSec?: number;
    isFrontCamera?: boolean;
    // Phase 4: prompt-owner media one-time-view metadata.
    promptMediaViewCount?: number;
    viewerHasViewedPromptMedia?: boolean;
    isPromptMediaOwner?: boolean;
  };
  promptId: string;
  onOpenThread: (id: string) => void;
  onOpenPromptMedia: (payload: PromptMediaPayload) => void;
  onLongPress?: (id: string) => void;
  isOwner?: boolean;
  // Phase 4 (prompt-owner preload): see TrendingCard for full rationale.
  mediaPreloadStatus?: TodPromptMediaPreloadStatus;
}) {
  // P2-002: Stable callback references
  const handleOpenThread = useCallback(() => onOpenThread(promptId), [onOpenThread, promptId]);
  const handleLongPress = useCallback(() => onLongPress?.(promptId), [onLongPress, promptId]);
  const handleOpenPromptMedia = useCallback(
    () =>
      onOpenPromptMedia({
        promptId,
        mediaUrl: prompt.mediaUrl,
        mediaKind: prompt.mediaKind,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera,
        isPromptMediaOwner: prompt.isPromptMediaOwner,
        viewerHasViewedPromptMedia: prompt.viewerHasViewedPromptMedia,
      }),
    [
      onOpenPromptMedia,
      promptId,
      prompt.mediaUrl,
      prompt.mediaKind,
      prompt.durationSec,
      prompt.isFrontCamera,
      prompt.isPromptMediaOwner,
      prompt.viewerHasViewedPromptMedia,
    ]
  );

  const isTruth = prompt.type === 'truth';
  const isAnon = prompt.isAnonymous ?? true;
  const answerCount = prompt.totalAnswers ?? prompt.answerCount ?? 0;
  const previewCount = prompt.top2Answers?.length ?? 0;
  const photoMode = getPhotoMode(prompt);
  const ownerGenderIcon = getGenderIcon(prompt.ownerGender);
  const genderColor = getGenderColor(prompt.ownerGender);

  const pillColors: readonly [string, string] = isTruth
    ? [PREMIUM.truthPurple, PREMIUM.truthPurpleLight]
    : [PREMIUM.dareOrange, PREMIUM.dareOrangeLight];

  return (
    <AnimatedPressCard
      onPress={handleOpenThread}
      onLongPress={isOwner ? handleLongPress : undefined}
      style={styles.card}
    >
      {/* Card content wrapper */}
      <View style={styles.cardContent}>
        {/* Header Row: Owner Identity */}
        <View style={styles.cardHeader}>
          <View style={styles.ownerIdentity}>
            <TodAvatar
              size={28}
              photoUrl={prompt.ownerPhotoUrl ?? null}
              isAnonymous={isAnon}
              photoBlurMode={prompt.photoBlurMode ?? (photoMode === 'blur' ? 'blur' : 'none')}
              label={prompt.ownerName || 'User'}
              borderWidth={1.5}
              borderColor={PREMIUM.borderSubtle}
              backgroundColor={PREMIUM.bgHighlight}
              iconColor={PREMIUM.textMuted}
            />
            {/* Identity: Name + Age/Gender on SAME ROW */}
            <View style={styles.ownerInfoRow}>
              <Text style={styles.ownerNamePremium} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {isAnon ? 'Anonymous' : (prompt.ownerName || 'User')}
              </Text>
              {!isAnon && (prompt.ownerAge || prompt.ownerGender) && (
                <View style={styles.ownerMetaInline}>
                  {prompt.ownerAge && (
                    <Text style={styles.ownerAgeInline} maxFontSizeMultiplier={1.15}>{prompt.ownerAge}</Text>
                  )}
                  {prompt.ownerGender && ownerGenderIcon && (
                    <>
                      <View style={[styles.genderDotInline, { backgroundColor: genderColor }]} />
                      <Ionicons name={ownerGenderIcon} size={11} color={genderColor} />
                    </>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Prompt text - Hero element. Text always uses the full content
            width on the left; any owner-attached media tile lives in the
            right column directly below the Truth/Dare pill. */}
        <Text style={styles.promptTextHero} numberOfLines={3} maxFontSizeMultiplier={1.2}>{prompt.text}</Text>

        {/* Comment previews (up to 2) */}
        {/* P1-006 FIX: Added optional chaining to prevent crash if top2Answers becomes undefined */}
        {previewCount > 0 && prompt.top2Answers && (
          <View style={styles.previewSection}>
            {prompt.top2Answers.map((answer) => (
              <CommentPreviewRow key={answer._id} answer={answer} />
            ))}
          </View>
        )}

        {/* Engagement row */}
        <View style={styles.engagementRow}>
          <View style={styles.answerBadge}>
            <Ionicons name="chatbubble" size={11} color={PREMIUM.textMuted} />
            <Text style={styles.answerCountText} maxFontSizeMultiplier={1.15}>
              {answerCount === 1 ? '1 comment' : `${answerCount} comments`}
            </Text>
          </View>
          {/* Viewer-state indicator: shown on the right side of the row when
              the current viewer has already submitted an answer to this
              prompt. Backend-derived (`prompt.hasAnswered`) so the badge
              persists across sessions/devices/reinstalls. Subtle text-only
              treatment (coral accent) to avoid a heavy badge look. */}
          {prompt.hasAnswered ? (
            <View style={[styles.answeredBadge, styles.answeredBadgeRight]}>
              <Ionicons name="checkmark-circle" size={11} color={PREMIUM.coral} />
              <Text style={styles.answeredBadgeText} maxFontSizeMultiplier={1.15}>
                Commented
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Right column: Type pill on top; owner media tile (if any) directly
          below the pill so the right side reads as a clean media column. */}
      <View style={styles.cardRightColumn}>
        <LinearGradient
          colors={pillColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.typePillGradient}
        >
          <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={12} color="#FFF" />
          <Text style={styles.typePillText} maxFontSizeMultiplier={1.15}>{isTruth ? 'Truth' : 'Dare'}</Text>
        </LinearGradient>
        {prompt.hasMedia && prompt.mediaKind ? (
          <TodPromptMediaTile
            hasMedia={prompt.hasMedia}
            mediaUrl={prompt.mediaUrl}
            mediaKind={prompt.mediaKind}
            durationSec={prompt.durationSec}
            size={64}
            covered
            ownerViewCount={
              prompt.isPromptMediaOwner &&
              (prompt.mediaKind === 'photo' || prompt.mediaKind === 'video')
                ? prompt.promptMediaViewCount
                : undefined
            }
            showViewedBadge={
              !prompt.isPromptMediaOwner &&
              !!prompt.viewerHasViewedPromptMedia &&
              (prompt.mediaKind === 'photo' || prompt.mediaKind === 'video')
            }
            preloadStatus={mediaPreloadStatus}
            onPress={handleOpenPromptMedia}
            accessibilityLabel={
              prompt.mediaKind === 'voice'
                ? 'Open prompt voice attachment'
                : `Open covered prompt ${prompt.mediaKind}`
            }
          />
        ) : null}
      </View>
    </AnimatedPressCard>
  );
});

/* ─── Prompt Media Viewer Modal ─── */
// Lightweight, feed-local viewer for prompt-owner media. Reused by both the
// trending and prompt cards. Intentionally NOT coupled to the prompt-thread
// answer-side viewer (which carries one-time-view / claim state) because
// prompt-owner media follows prompt visibility only — there is no claim
// flow, no todPromptViews mutation, no answer-side tracking.
//
// Behavior:
//  - photo: full preview using expo-image with contentFit="contain".
//  - video: expo-av Video with native controls; no autoplay-on-mount.
//  - voice: covered placeholder + microcopy explaining playback isn't
//    available in the feed (intentional limitation).
function PromptMediaViewerModal({
  payload,
  onClose,
  onConsumed,
}: {
  payload: PromptMediaPayload | null;
  onClose: () => void;
  // Fires at most once per opened payload, only for non-owner photo/video,
  // and ONLY after actual consumption:
  //   • photo  → image successfully rendered (onLoadEnd) AND viewer closed
  //   • video  → playback ran to completion (didJustFinish)
  // The parent uses this to call `markPromptMediaViewed` so the one-time
  // view ledger row is inserted only after real consumption — never on the
  // first preload tap.
  onConsumed?: (promptId: string) => void;
}) {
  const visible = !!payload?.mediaUrl && !!payload?.mediaKind;
  const insets = useSafeAreaInsets();
  const screen = Dimensions.get('window');
  const kind = payload?.mediaKind;
  const mediaUrl = payload?.mediaUrl;
  const isFrontCamera = !!payload?.isFrontCamera;
  const [imageLoading, setImageLoading] = useState(true);

  // ─── Voice playback state ───
  // Voice prompts are inline-played inside this viewer using expo-av's
  // Audio.Sound. We hold the Sound on a ref (so unload cleanups can run
  // without stale closures) plus mirrored state for the play/pause UI
  // and progress scrubber. Voice is replayable: there is no view ledger
  // burn for voice (server-side `markPromptMediaViewed` no-ops voice).
  const voiceSoundRef = useRef<Audio.Sound | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voicePosMs, setVoicePosMs] = useState(0);
  const [voiceDurMs, setVoiceDurMs] = useState(0);
  const [voiceFailed, setVoiceFailed] = useState(false);

  // Consumption tracking — refs so they don't trigger re-renders. The
  // owner branch (and voice) never burns a view; we gate firing on the
  // payload's `isPromptMediaOwner` and `mediaKind` below.
  const imageRenderedRef = useRef(false);
  const consumedFiredRef = useRef(false);
  const promptIdRef = useRef<string | undefined>(undefined);

  const isOwner = !!payload?.isPromptMediaOwner;
  const promptId = payload?.promptId;
  const shouldTrackConsumption =
    !!promptId && !isOwner && (kind === 'photo' || kind === 'video');

  const fireConsumed = useCallback(() => {
    if (consumedFiredRef.current) return;
    if (!shouldTrackConsumption) return;
    if (!promptIdRef.current) return;
    consumedFiredRef.current = true;
    onConsumed?.(promptIdRef.current);
  }, [onConsumed, shouldTrackConsumption]);

  // Reset loading + consumption state whenever the source changes so a
  // stale flag doesn't suppress the spinner OR pre-fire mark-viewed on
  // the next open.
  useEffect(() => {
    if (visible && kind === 'photo') {
      setImageLoading(true);
    }
    if (visible) {
      imageRenderedRef.current = false;
      consumedFiredRef.current = false;
      promptIdRef.current = promptId;
    }
  }, [visible, kind, mediaUrl, promptId]);

  // Unload any in-flight voice Sound. Safe to call when there's nothing
  // loaded — guards on the ref. Resets the mirrored UI state so a later
  // open starts in a clean idle-not-playing state.
  const unloadVoice = useCallback(async () => {
    const s = voiceSoundRef.current;
    voiceSoundRef.current = null;
    if (s) {
      try {
        await s.setOnPlaybackStatusUpdate(null);
      } catch {
        // best-effort
      }
      try {
        await s.unloadAsync();
      } catch {
        // best-effort
      }
    }
    setVoicePlaying(false);
    setVoicePosMs(0);
    setVoiceDurMs(0);
    setVoiceLoading(false);
    setVoiceFailed(false);
  }, []);

  // Load the voice Sound when the viewer opens onto a voice payload.
  // We do NOT autoplay — the user must tap play. This matches the
  // photo/video first-tap-preload UX (no surprise audio bursts) and
  // gives us a clean place to set the audio mode for silent-mode iPhones.
  useEffect(() => {
    if (!visible || kind !== 'voice' || !mediaUrl) {
      // Effect won't load anything; cleanup below handles teardown when
      // the viewer transitions OUT of a voice payload.
      return;
    }
    let cancelled = false;
    setVoiceLoading(true);
    setVoiceFailed(false);
    setVoicePlaying(false);
    setVoicePosMs(0);
    setVoiceDurMs(0);
    (async () => {
      try {
        // Make sure playback works even when the device is on silent
        // (iOS) and respects other apps' audio sessions sensibly.
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          staysActiveInBackground: false,
        });
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: mediaUrl },
          { shouldPlay: false },
          (s) => {
            if (!s.isLoaded) return;
            setVoicePosMs(s.positionMillis ?? 0);
            if (typeof s.durationMillis === 'number') {
              setVoiceDurMs(s.durationMillis);
            }
            setVoicePlaying(!!s.isPlaying);
            if (s.didJustFinish) {
              setVoicePlaying(false);
              // Reset to start so the next play begins from 0 instead
              // of being stuck at duration.
              sound.setPositionAsync(0).catch(() => {});
            }
          }
        );
        if (cancelled) {
          try {
            await sound.unloadAsync();
          } catch {
            // best-effort
          }
          return;
        }
        voiceSoundRef.current = sound;
        if ('isLoaded' in status && status.isLoaded) {
          if (typeof status.durationMillis === 'number') {
            setVoiceDurMs(status.durationMillis);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setVoiceFailed(true);
          debugTodLog('[T/D] voice load failed', err);
        }
      } finally {
        if (!cancelled) {
          setVoiceLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      // Tear down whatever was loaded for THIS payload; the next render
      // will reload if/when the viewer is shown again.
      unloadVoice();
    };
  }, [visible, kind, mediaUrl, unloadVoice]);

  // Toggle play/pause for the loaded voice Sound. Silently no-ops if
  // nothing is loaded (e.g. mid-load), which keeps the UI from flapping
  // on rapid taps.
  const handleToggleVoice = useCallback(async () => {
    const s = voiceSoundRef.current;
    if (!s) return;
    try {
      const status = await s.getStatusAsync();
      if (!('isLoaded' in status) || !status.isLoaded) return;
      if (status.isPlaying) {
        await s.pauseAsync();
      } else {
        // If we previously hit the end, restart from 0. Otherwise resume
        // from the last paused position.
        if (
          typeof status.durationMillis === 'number' &&
          status.positionMillis >= status.durationMillis - 50
        ) {
          await s.setPositionAsync(0);
        }
        await s.playAsync();
      }
    } catch (err) {
      debugTodLog('[T/D] voice toggle failed', err);
    }
  }, []);

  // Wrap close so photo consumption (rendered → closed) fires on the way
  // out. Video consumption fires from `onPlaybackStatusUpdate` instead, so
  // closing mid-playback intentionally does NOT mark the video viewed.
  // Voice is replayable (no consumption tracking), but we still unload
  // its Sound so audio doesn't keep playing after the modal dismisses.
  const handleClose = useCallback(() => {
    if (kind === 'photo' && imageRenderedRef.current) {
      fireConsumed();
    }
    if (kind === 'voice') {
      unloadVoice();
    }
    onClose();
  }, [kind, fireConsumed, onClose, unloadVoice]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.promptMediaViewerBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close media viewer"
        />

        {/* Media surface — sized to fit within safe-area, centered. Pressing
            inside the surface does NOT dismiss; only the backdrop and the
            top-right close button dismiss. For photo/video we give the
            surface an explicit height so the media frame can actually fill
            most of the screen (without it the surface would shrink to its
            content and look tiny in the middle of the backdrop). For voice,
            we keep the surface auto-sized so the compact placeholder box
            doesn't get stretched into a giant empty surface. */}
        <Pressable
          style={[
            styles.promptMediaViewerSurface,
            {
              maxWidth: Math.min(screen.width - 24, 720),
              maxHeight: Math.min(
                screen.height - insets.top - insets.bottom - 80,
                Math.round(screen.height * 0.86)
              ),
            },
            (kind === 'photo' || kind === 'video') && {
              height: Math.min(
                screen.height - insets.top - insets.bottom - 80,
                Math.round(screen.height * 0.86)
              ),
            },
          ]}
          onPress={() => {}}
        >
          {kind === 'photo' && mediaUrl ? (
            <>
              <ExpoImage
                source={{ uri: mediaUrl }}
                style={[
                  styles.promptMediaViewerImage,
                  isFrontCamera ? { transform: [{ scaleX: -1 }] } : null,
                ]}
                contentFit="contain"
                transition={150}
                onLoadEnd={() => {
                  setImageLoading(false);
                  // Mark "image actually rendered" — this is the gate for
                  // photo consumption. Mark-viewed only fires later, when
                  // the user closes the viewer (handleClose).
                  imageRenderedRef.current = true;
                }}
              />
              {imageLoading ? (
                <View style={styles.promptMediaViewerSpinnerWrap} pointerEvents="none">
                  <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
              ) : null}
            </>
          ) : null}

          {kind === 'video' && mediaUrl ? (
            <Video
              source={{ uri: mediaUrl }}
              style={[
                styles.promptMediaViewerVideo,
                isFrontCamera ? { transform: [{ scaleX: -1 }] } : null,
              ]}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              // Phase 4: autoplay on viewer open. The tile preloaded the URL
              // via HEAD on the first tap so the second tap (which mounts
              // this Video) starts playing with a warm CDN edge / OS HTTP
              // cache instead of a black "buffering" frame.
              shouldPlay={true}
              isLooping={false}
              onPlaybackStatusUpdate={(status) => {
                // Phase 4 part-2: video consumption fires ONLY when
                // playback actually completes (didJustFinish). Closing
                // mid-playback does NOT mark the video viewed.
                if ('isLoaded' in status && status.isLoaded && status.didJustFinish) {
                  fireConsumed();
                }
              }}
            />
          ) : null}

          {kind === 'voice' && mediaUrl ? (
            <View style={styles.promptMediaViewerVoiceBox}>
              <View style={styles.promptMediaViewerVoiceIcon}>
                <Ionicons name="mic" size={36} color={PREMIUM.coral} />
              </View>
              <Text style={styles.promptMediaViewerVoiceTitle}>Voice prompt</Text>
              {voiceFailed ? (
                <Text style={styles.promptMediaViewerVoiceSubtitle}>
                  Couldn’t load this voice prompt. Please try again.
                </Text>
              ) : (
                <View style={styles.promptMediaViewerVoiceControls}>
                  <TouchableOpacity
                    style={[
                      styles.promptMediaViewerVoicePlayBtn,
                      voiceLoading && styles.promptMediaViewerVoicePlayBtnDisabled,
                    ]}
                    onPress={handleToggleVoice}
                    disabled={voiceLoading}
                    accessibilityRole="button"
                    accessibilityLabel={voicePlaying ? 'Pause voice' : 'Play voice'}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    {voiceLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons
                        name={voicePlaying ? 'pause' : 'play'}
                        size={26}
                        color="#FFFFFF"
                      />
                    )}
                  </TouchableOpacity>
                  <View style={styles.promptMediaViewerVoiceProgressTrack}>
                    <View
                      style={[
                        styles.promptMediaViewerVoiceProgressFill,
                        {
                          width:
                            voiceDurMs > 0
                              ? `${Math.min(100, Math.max(0, (voicePosMs / voiceDurMs) * 100))}%`
                              : '0%',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.promptMediaViewerVoiceTime} maxFontSizeMultiplier={1.1}>
                    {formatVoiceTime(voicePosMs)} / {formatVoiceTime(voiceDurMs)}
                  </Text>
                </View>
              )}
            </View>
          ) : null}
        </Pressable>

        {/* Close button — pinned top-right, above safe-area inset. */}
        <TouchableOpacity
          style={[
            styles.promptMediaViewerCloseBtn,
            { top: insets.top + 12 },
          ]}
          onPress={handleClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close media viewer"
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

/* ─── Main Screen ─── */
export default function TruthOrDareScreen() {
  useScreenTrace("P2_TRUTH_OR_DARE");
  const router = useRouter();
  const params = useLocalSearchParams<{
    openRequests?: string;
    focusRequestId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [queryPaused, setQueryPaused] = useState(false);
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);
  const [requestInboxVisible, setRequestInboxVisible] = useState(false);
  const [focusedRequestId, setFocusedRequestId] = useState<string | null>(null);
  const firstRenderRef = useRef(true);
  const dataReceivedRef = useRef(false);
  const lastOpenRequestsKeyRef = useRef<string | null>(null);

  // B2-HIGH FIX: Prevent stuck spinner and setState-after-unmount
  const mountedRef = useRef(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // B2-HIGH FIX: Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (queryResumeTimeoutRef.current) {
        clearTimeout(queryResumeTimeoutRef.current);
        queryResumeTimeoutRef.current = null;
      }
    };
  }, []);

  // DIAGNOSTIC: Log when tab opens
  useEffect(() => {
    _tabOpenTime = Date.now();
    debugTodLog(`[T/D REPORT] open_start=${_tabOpenTime}`);
    return () => { _tabOpenTime = 0; };
  }, []);

  // DIAGNOSTIC: Log first render timing
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      const renderMs = _tabOpenTime > 0 ? Date.now() - _tabOpenTime : 0;
      debugTodLog(`[T/D REPORT] first_render_ms=${renderMs}`);
    }
  }, []);

  const userId = useAuthStore((s) => s.userId);

  // Delete popup state
  const [deletePopupPromptId, setDeletePopupPromptId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Prompt-owner media viewer state. Tapping the covered media tile on a feed
  // card opens this modal. For non-owner photo/video the URL is NOT present
  // in the inline payload (server-side redaction). We resolve the URL via
  // `preparePromptMedia` on the first (preload) tap WITHOUT burning the
  // one-time view; the view ledger row is inserted only after the user
  // actually consumes the media (photo render + close, or video finishes
  // playback) by calling `markPromptMediaViewed`. Voice and owner branches
  // never burn a view.
  const [viewingPromptMedia, setViewingPromptMedia] = useState<PromptMediaPayload | null>(null);
  const preparePromptMediaMutation = useMutation(api.truthDare.preparePromptMedia);
  const markPromptMediaViewedMutation = useMutation(api.truthDare.markPromptMediaViewed);

  // Phase 4 (prompt-owner preload state machine):
  // Per-prompt preload entry. Drives the two-tap UX on TodPromptMediaTile:
  //   1) idle    → tile shows download/arrow affordance
  //   2) loading → tile shows inline spinner; URL is being resolved + asset
  //                warmed in the background; viewer is NOT opened
  //   3) ready   → tile shows the kind glyph; next tap opens the viewer
  //                INSTANTLY using the cached resolved data (no extra
  //                mutation, no extra network roundtrip)
  //   4) failed  → tile shows refresh affordance; next tap retries
  //
  // We persist the resolved URL/kind/duration/isFrontCamera on the entry so
  // a re-tap during the same screen mount opens the viewer with cached
  // data even if the live prompt list later refetches and now reports
  // `viewerHasViewedPromptMedia: true` (the user already burned the view
  // on the preload tap; we must let them actually watch what they paid for).
  type PromptMediaPreloadEntry = {
    status: TodPromptMediaPreloadStatus;
    resolvedUrl?: string;
    resolvedKind?: 'photo' | 'video' | 'voice';
    resolvedDurationSec?: number;
    resolvedIsFrontCamera?: boolean;
  };
  const [promptMediaPreloadMap, setPromptMediaPreloadMap] = useState<
    Record<string, PromptMediaPreloadEntry>
  >({});
  const updatePromptMediaPreloadEntry = useCallback(
    (promptId: string, patch: Partial<PromptMediaPreloadEntry>) => {
      setPromptMediaPreloadMap((prev) => ({
        ...prev,
        [promptId]: {
          ...(prev[promptId] ?? { status: 'idle' as TodPromptMediaPreloadStatus }),
          ...patch,
        },
      }));
    },
    []
  );

  const handleOpenPromptMedia = useCallback(
    async (payload: PromptMediaPayload) => {
      if (!payload.mediaKind || !payload.promptId) return;
      const promptId = payload.promptId;
      const isPhotoOrVideo =
        payload.mediaKind === 'photo' || payload.mediaKind === 'video';

      const entry = promptMediaPreloadMap[promptId];
      const status: TodPromptMediaPreloadStatus = entry?.status ?? 'idle';

      // Second tap (or later) on a preloaded tile: open the viewer
      // instantly with the cached resolved data. Bypasses the
      // already-viewed gate on purpose — see entry comment above.
      if (status === 'ready' && entry?.resolvedUrl && entry?.resolvedKind) {
        setViewingPromptMedia({
          promptId,
          mediaUrl: entry.resolvedUrl,
          mediaKind: entry.resolvedKind,
          durationSec: entry.resolvedDurationSec,
          isFrontCamera: entry.resolvedIsFrontCamera,
          isPromptMediaOwner: payload.isPromptMediaOwner,
          viewerHasViewedPromptMedia: payload.viewerHasViewedPromptMedia,
        });
        return;
      }

      // Voice: there's no big asset to preload and the viewer just shows a
      // placeholder; keep single-tap behavior so users don't have to
      // double-tap a voice tile that won't even play in the feed.
      if (payload.mediaKind === 'voice') {
        if (!payload.mediaUrl) return;
        setViewingPromptMedia(payload);
        return;
      }

      // Non-owner photo/video that the server already records as viewed
      // (and we have no preloaded entry): friendly alert, no view burn.
      if (
        !payload.isPromptMediaOwner &&
        payload.viewerHasViewedPromptMedia &&
        isPhotoOrVideo
      ) {
        Alert.alert(
          'Already viewed',
          payload.mediaKind === 'video'
            ? 'You can only watch this video once.'
            : 'You can only view this photo once.'
        );
        return;
      }

      // Already preloading this exact tile: swallow extra taps.
      if (status === 'loading') return;

      // First tap (idle) or retry (failed): start the preload.
      updatePromptMediaPreloadEntry(promptId, { status: 'loading' });
      try {
        let resolvedUrl: string | undefined;
        let resolvedKind: 'photo' | 'video' | 'voice' = payload.mediaKind;
        let resolvedDurationSec: number | undefined = payload.durationSec;
        let resolvedIsFrontCamera: boolean | undefined = payload.isFrontCamera;

        if (payload.isPromptMediaOwner) {
          // Owner branch: payload already carries the URL; no view consumption.
          resolvedUrl = payload.mediaUrl;
        } else {
          // Non-owner first-view: round-trip `preparePromptMedia` to resolve
          // a fresh URL WITHOUT burning the one-time view. The view ledger
          // row is inserted later, by `markPromptMediaViewed`, only when
          // the user actually consumes the media (photo: viewer closed
          // after the image rendered; video: playback finished). This is
          // the entire point of Phase 4 part-2 — preload != viewed.
          if (!userId) {
            updatePromptMediaPreloadEntry(promptId, { status: 'failed' });
            return;
          }
          const result = await preparePromptMediaMutation({
            promptId,
            viewerUserId: userId,
          });
          if (result.status === 'already_viewed') {
            // Reset to idle so the badge takes over visually; the parent
            // card already shows "Viewed" via showViewedBadge after the
            // next list refetch.
            updatePromptMediaPreloadEntry(promptId, { status: 'idle' });
            Alert.alert(
              'Already viewed',
              payload.mediaKind === 'video'
                ? 'You can only watch this video once.'
                : 'You can only view this photo once.'
            );
            return;
          }
          if (result.status !== 'ok' || !result.mediaUrl) {
            updatePromptMediaPreloadEntry(promptId, { status: 'failed' });
            Alert.alert("Can't open", 'This media is no longer available.');
            return;
          }
          resolvedUrl = result.mediaUrl;
          resolvedKind = (result.mediaKind ?? payload.mediaKind) as
            | 'photo'
            | 'video'
            | 'voice';
          resolvedDurationSec = result.durationSec ?? payload.durationSec;
          resolvedIsFrontCamera =
            result.isFrontCamera ?? payload.isFrontCamera ?? false;
        }

        if (!resolvedUrl) {
          updatePromptMediaPreloadEntry(promptId, { status: 'failed' });
          return;
        }

        // Best-effort asset warm-up. For photos we use expo-image's
        // prefetch which decodes into the disk + memory cache; for video we
        // issue a HEAD against the playback URL so the OS HTTP cache + CDN
        // edge are warm. Failures are non-fatal — the URL is still valid
        // and the viewer falls back to its own loading state.
        try {
          if (resolvedKind === 'photo') {
            await ExpoImage.prefetch(resolvedUrl);
          } else if (resolvedKind === 'video') {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            try {
              await fetch(resolvedUrl, {
                method: 'HEAD',
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timer);
            }
          }
        } catch {
          // swallow prefetch errors; asset will load when the viewer opens.
        }

        updatePromptMediaPreloadEntry(promptId, {
          status: 'ready',
          resolvedUrl,
          resolvedKind,
          resolvedDurationSec,
          resolvedIsFrontCamera,
        });
      } catch (err) {
        updatePromptMediaPreloadEntry(promptId, { status: 'failed' });
        Alert.alert("Can't open", 'Something went wrong. Please try again.');
      }
    },
    [
      preparePromptMediaMutation,
      userId,
      promptMediaPreloadMap,
      updatePromptMediaPreloadEntry,
    ]
  );
  const handleClosePromptMedia = useCallback(() => {
    setViewingPromptMedia(null);
  }, []);

  // Fired by the viewer when the user actually consumed the media:
  //   • photo  → image rendered + viewer closed
  //   • video  → playback finished (didJustFinish)
  // For owner / voice / already-viewed branches the viewer never invokes
  // this. Calls `markPromptMediaViewed` server-side (idempotent) so the
  // one-time view ledger row is inserted only on real consumption.
  const handlePromptMediaConsumed = useCallback(
    (promptId: string) => {
      if (!userId) return;
      // Best-effort; we already know the asset was consumed, so any
      // network failure here just leaves the ledger row missing — which
      // means the user could re-view next session. That's an acceptable
      // failure mode (lenient, never blocks playback).
      markPromptMediaViewedMutation({
        promptId,
        viewerUserId: userId,
      }).catch(() => {});
    },
    [markPromptMediaViewedMutation, userId]
  );

  // Resolves the visual preload status for a given prompt. Voice and
  // already-viewed states intentionally bypass the preload visuals so the
  // tile still reads as "regular kind icon" + the existing "Viewed" badge.
  const getPromptMediaPreloadStatus = useCallback(
    (
      promptId: string,
      prompt: {
        mediaKind?: 'photo' | 'video' | 'voice';
        isPromptMediaOwner?: boolean;
        viewerHasViewedPromptMedia?: boolean;
      }
    ): TodPromptMediaPreloadStatus | undefined => {
      const entry = promptMediaPreloadMap[promptId];
      // Voice: keep the legacy single-tap UX → undefined (renders as ready).
      if (prompt.mediaKind === 'voice') return undefined;
      // Non-owner already-viewed (and we don't have a cached URL from this
      // session): also render as ready so the existing Viewed badge wins.
      if (
        !prompt.isPromptMediaOwner &&
        prompt.viewerHasViewedPromptMedia &&
        entry?.status !== 'ready'
      ) {
        return undefined;
      }
      return entry?.status ?? 'idle';
    },
    [promptMediaPreloadMap]
  );

  // Delete mutation - for owner prompt deletion from homepage
  const deletePromptMutation = useMutation(api.truthDare.deleteMyPrompt);

  // Get trending prompts (1 Dare + 1 Truth) using viewerUserId
  const trendingDataQuery = useQuery(
    api.truthDare.getTrendingTruthAndDare,
    userId && !queryPaused ? { viewerUserId: userId } : 'skip'
  );

  // Get all prompts (sorted by engagement)
  const promptsDataQuery = useQuery(
    api.truthDare.listActivePromptsWithTop2Answers,
    userId && !queryPaused ? { viewerUserId: userId } : 'skip'
  );

  const pendingConnectRequestCount = useQuery(
    api.truthDare.getPendingTodConnectRequestsCount,
    userId ? { authUserId: userId } : 'skip'
  );
  const connectRequestCount = pendingConnectRequestCount ?? 0;

  const openConnectRequests = useCallback((focusRequestId?: string | null) => {
    setFocusedRequestId(focusRequestId ?? null);
    setRequestInboxVisible(true);
  }, []);

  const openConnectRequestsFromTray = useCallback(() => {
    openConnectRequests(null);
  }, [openConnectRequests]);

  const closeConnectRequests = useCallback(() => {
    setRequestInboxVisible(false);
  }, []);

  useEffect(() => {
    if (params.openRequests !== '1') return;
    const focusParam =
      typeof params.focusRequestId === 'string' && params.focusRequestId.length > 0
        ? params.focusRequestId
        : null;
    const openKey = `${params.openRequests}:${focusParam ?? ''}`;
    if (lastOpenRequestsKeyRef.current === openKey) return;
    lastOpenRequestsKeyRef.current = openKey;
    openConnectRequests(focusParam);
  }, [openConnectRequests, params.focusRequestId, params.openRequests]);

  // Update cache when data arrives + log diagnostics
  useEffect(() => {
    if (userId && promptsDataQuery !== undefined) {
      _todFeedCacheByUser[userId] = {
        prompts: promptsDataQuery,
        trending: _todFeedCacheByUser[userId]?.trending ?? null,
      };
      // B2-HIGH FIX: Guard setState and clear timeout when data arrives
      if (mountedRef.current) {
        setIsRefreshing(false);
        setBootstrapTimedOut(false);
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
          refreshTimeoutRef.current = null;
        }
      }

      // DIAGNOSTIC: Log first data received timing
      if (!dataReceivedRef.current) {
        dataReceivedRef.current = true;
        const dataMs = _tabOpenTime > 0 ? Date.now() - _tabOpenTime : 0;
        debugTodLog(`[T/D REPORT] first_data_ms=${dataMs}`);
        debugTodLog(`[T/D REPORT] feed_count=${promptsDataQuery.length}`);

        // Log latest 3 prompts details
        promptsDataQuery.slice(0, 3).forEach((p: any, idx: number) => {
          const visibility = p.isAnonymous ? 'anonymous' : (p.photoBlurMode === 'blur' ? 'blurred' : 'everyone');
          debugTodLog(`[T/D REPORT] item${idx + 1} id=${String(p._id).slice(-6)} visibility=${visibility} hasName=${!!p.ownerName} hasPhoto=${!!p.ownerPhotoUrl} photoPrefix=${getUrlPrefix(p.ownerPhotoUrl)} blurMode=${p.photoBlurMode || 'none'}`);
        });
      }
    }
  }, [promptsDataQuery, userId]);

  useEffect(() => {
    if (userId && trendingDataQuery !== undefined) {
      _todFeedCacheByUser[userId] = {
        prompts: _todFeedCacheByUser[userId]?.prompts ?? [],
        trending: trendingDataQuery,
      };
    }
  }, [trendingDataQuery, userId]);

  const cachedFeed = userId ? _todFeedCacheByUser[userId] : undefined;

  // Use only the current user's cached data for instant render.
  const prompts = promptsDataQuery ?? cachedFeed?.prompts ?? [];
  const trendingData = trendingDataQuery ?? cachedFeed?.trending ?? null;

  useEffect(() => {
    if (!userId || prompts.length > 0 || promptsDataQuery !== undefined) {
      if (bootstrapTimedOut) {
        setBootstrapTimedOut(false);
      }
      return;
    }

    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setBootstrapTimedOut(true);
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [userId, prompts.length, promptsDataQuery, bootstrapTimedOut]);

  // Get trending prompt IDs to exclude from normal list
  const trendingIds = useMemo(() => {
    const ids = new Set<string>();
    if (trendingData?.trendingDarePrompt) {
      ids.add(trendingData.trendingDarePrompt._id as unknown as string);
    }
    if (trendingData?.trendingTruthPrompt) {
      ids.add(trendingData.trendingTruthPrompt._id as unknown as string);
    }
    return ids;
  }, [trendingData]);

  // Filter out trending prompts from normal list
  const normalPrompts = useMemo(() => {
    return prompts.filter((p) => !trendingIds.has(p._id as unknown as string));
  }, [prompts, trendingIds]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setBootstrapTimedOut(false);
    setQueryPaused(true);

    // B2-HIGH FIX: Timeout fallback to prevent stuck spinner (10s)
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    if (queryResumeTimeoutRef.current) {
      clearTimeout(queryResumeTimeoutRef.current);
    }
    queryResumeTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setQueryPaused(false);
      }
      queryResumeTimeoutRef.current = null;
    }, 80);
    refreshTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setIsRefreshing(false);
      }
    }, 10000);
  }, []);

  const openThread = useCallback((promptId: string) => {
    router.push({
      pathname: '/(main)/prompt-thread' as any,
      params: { promptId, source: 'phase2-tod' },
    });
  }, [router]);

  const openCreateTod = useCallback(() => {
    router.push('/(main)/incognito-create-tod' as any);
  }, [router]);

  const openMyTruthDare = useCallback(() => {
    router.push('/(main)/(private)/my-truth-or-dare' as any);
  }, [router]);

  // Long-press to show delete popup (owner only)
  const handleLongPressPrompt = useCallback((promptId: string) => {
    setDeletePopupPromptId(promptId);
  }, []);

  // Handle delete confirmation
  const handleDeletePrompt = useCallback(async () => {
    if (!deletePopupPromptId || !userId) return;

    setIsDeleting(true);
    try {
      await deletePromptMutation({
        promptId: deletePopupPromptId,
        authUserId: userId,
      });
      setDeletePopupPromptId(null);
      // Feed will auto-refresh via Convex reactivity
    } catch (error: any) {
      console.error('[T/D] Delete prompt failed:', error);
      Alert.alert('Error', error?.message || 'Failed to delete. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }, [deletePopupPromptId, userId, deletePromptMutation]);

  // Close delete popup
  const handleCloseDeletePopup = useCallback(() => {
    setDeletePopupPromptId(null);
  }, []);

  // Owner: route to the prompt thread with autoEditPrompt='1' so the thread
  // opens its inline text editor. Edits are intentionally text-only —
  // type/identity/media are locked after posting because prompt slots are
  // scarce (weekly/monthly/subscription gated) and we don't want owners to
  // recycle a slot to swap out media or change Truth↔Dare after the fact.
  const handleEditPrompt = useCallback(() => {
    if (!deletePopupPromptId) return;
    const id = deletePopupPromptId;
    setDeletePopupPromptId(null);
    router.push({
      pathname: '/(main)/prompt-thread' as any,
      params: { promptId: id, source: 'phase2-tod', autoEditPrompt: '1' },
    });
  }, [deletePopupPromptId, router]);

  // Pending optimistic prompt uploads for the current user. These appear
  // ABOVE the real "More Truths & Dares" list as soon as the composer
  // hands them off, and are replaced by their Convex post once the
  // background `TruthDarePromptUploadManager` reports success. We filter
  // strictly by `userId` so other users never see another user's
  // in-flight pending media — security: no pending state is sent to
  // the network, this is purely a local in-memory render.
  const pendingPromptItems = useTruthDarePromptUploadStore((state) => state.items);
  const removePendingPromptItem = useTruthDarePromptUploadStore((state) => state.remove);
  const retryPendingPromptItem = useTruthDarePromptUploadStore((state) => state.retry);

  const myPendingPrompts = useMemo<TruthDarePendingPromptUpload[]>(() => {
    if (!userId) return [];
    return pendingPromptItems
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [pendingPromptItems, userId]);

  // Auto-cleanup: when a pending item finishes successfully and its real
  // Convex post is now present in the feed, drop the pending entry to
  // prevent showing both the pending card and the real card.
  const promptIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of prompts) {
      set.add(p._id as unknown as string);
    }
    if (trendingData?.trendingDarePrompt) {
      set.add(trendingData.trendingDarePrompt._id as unknown as string);
    }
    if (trendingData?.trendingTruthPrompt) {
      set.add(trendingData.trendingTruthPrompt._id as unknown as string);
    }
    return set;
  }, [prompts, trendingData]);

  useEffect(() => {
    for (const item of myPendingPrompts) {
      if (item.status !== 'success') continue;
      // If the server post is already visible in the feed, retire the
      // pending card. If it's not yet present (Convex reactivity tick),
      // we leave the pending card up showing 100% / "Posted" until it
      // arrives — this keeps the slot stable and avoids flicker.
      if (item.serverPromptId && promptIdSet.has(item.serverPromptId)) {
        removePendingPromptItem(item.clientId);
      }
    }
  }, [myPendingPrompts, promptIdSet, removePendingPromptItem]);

  // Hide pending items whose real Convex post is already present (defense
  // in depth: if the cleanup effect hasn't run yet, never render both).
  const visiblePendingPrompts = useMemo(() => {
    return myPendingPrompts.filter(
      (item) => !item.serverPromptId || !promptIdSet.has(item.serverPromptId)
    );
  }, [myPendingPrompts, promptIdSet]);

  type FeedItem =
    | { type: 'section'; label: string }
    | { type: 'trending'; prompt: TrendingPromptData }
    | { type: 'prompt'; prompt: typeof prompts[0] }
    | { type: 'pending'; pending: TruthDarePendingPromptUpload };

  const feedData: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];

    // Trending section (Dare first, then Truth)
    const hasTrendingDare = !!trendingData?.trendingDarePrompt;
    const hasTrendingTruth = !!trendingData?.trendingTruthPrompt;

    if (hasTrendingDare || hasTrendingTruth) {
      items.push({ type: 'section', label: '🔥 Trending' });
      if (hasTrendingDare) {
        items.push({ type: 'trending', prompt: trendingData!.trendingDarePrompt! });
      }
      if (hasTrendingTruth) {
        items.push({ type: 'trending', prompt: trendingData!.trendingTruthPrompt! });
      }
    }

    // Pending optimistic posts (current user only) sit at the very top of
    // "More Truths & Dares" so they appear immediately after POST. The
    // section header is shown if either a pending or a real prompt exists
    // so the layout doesn't shift when the feed catches up.
    const hasPending = visiblePendingPrompts.length > 0;
    const hasNormal = normalPrompts.length > 0;
    if (hasPending || hasNormal) {
      items.push({ type: 'section', label: 'More Truths & Dares' });
      visiblePendingPrompts.forEach((pending) => items.push({ type: 'pending', pending }));
      normalPrompts.forEach((p) => items.push({ type: 'prompt', prompt: p }));
    }

    return items;
  }, [trendingData, normalPrompts, visiblePendingPrompts]);

  // P2-002 FIX: Pass promptId and stable callbacks to cards (no inline arrow functions)
  const renderItem = useCallback(({ item }: { item: FeedItem }) => {
    if (item.type === 'section') {
      const isTrending = item.label.toLowerCase().includes('trending');
      const rightSlot = isTrending && connectRequestCount > 0 ? (
        <TodConnectRequestsIndicator
          count={connectRequestCount}
          onPress={openConnectRequestsFromTray}
        />
      ) : null;
      return <SectionHeader label={item.label} isTrending={isTrending} rightSlot={rightSlot} />;
    }

    if (item.type === 'trending') {
      const promptId = item.prompt._id as unknown as string;
      const isOwner = (item.prompt as any).ownerUserId === userId;
      const preloadStatus = getPromptMediaPreloadStatus(promptId, item.prompt);
      return (
        <TrendingCard
          prompt={item.prompt}
          promptId={promptId}
          onOpenThread={openThread}
          onOpenPromptMedia={handleOpenPromptMedia}
          onLongPress={handleLongPressPrompt}
          isOwner={isOwner}
          mediaPreloadStatus={preloadStatus}
        />
      );
    }

    if (item.type === 'pending') {
      return (
        <PendingPromptCard
          item={item.pending}
          onRetry={retryPendingPromptItem}
          onRemove={removePendingPromptItem}
        />
      );
    }

    const promptId = item.prompt._id as unknown as string;
    const isOwner = (item.prompt as any).ownerUserId === userId;
    const preloadStatus = getPromptMediaPreloadStatus(promptId, item.prompt);
    return (
      <PromptCard
        prompt={item.prompt}
        promptId={promptId}
        onOpenThread={openThread}
        onOpenPromptMedia={handleOpenPromptMedia}
        onLongPress={handleLongPressPrompt}
        isOwner={isOwner}
        mediaPreloadStatus={preloadStatus}
      />
    );
  }, [
    connectRequestCount,
    openConnectRequestsFromTray,
    openThread,
    handleOpenPromptMedia,
    handleLongPressPrompt,
    retryPendingPromptItem,
    removePendingPromptItem,
    userId,
    getPromptMediaPreloadStatus,
  ]);

  const getKey = useCallback((item: FeedItem, idx: number) => {
    if (item.type === 'section') return `section_${idx}`;
    if (item.type === 'trending') return `trending_${item.prompt._id}`;
    if (item.type === 'pending') return `pending_${item.pending.clientId}`;
    return `prompt_${item.prompt._id}`;
  }, []);

  // Check if we're in initial loading state (no data yet, cache empty)
  const isInitialLoading = promptsDataQuery === undefined && prompts.length === 0;

  if (bootstrapTimedOut && prompts.length === 0) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.headerIconBg}
          >
            <Ionicons name="flame" size={14} color="#FFF" />
          </LinearGradient>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2}>Truth or Dare</Text>
          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={openMyTruthDare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="My Truth and Dare"
          >
            <Ionicons name="list-outline" size={20} color={PREMIUM.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="refresh-circle-outline" size={52} color={PREMIUM.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Couldn&apos;t load Truth or Dare</Text>
          <Text style={styles.emptySubtitle}>Pull to refresh or try again now.</Text>
          <TouchableOpacity style={styles.createFirstBtn} onPress={onRefresh} activeOpacity={0.85}>
            <LinearGradient
              colors={[PREMIUM.coral, PREMIUM.coralSoft]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createFirstBtnGradient}
            >
              <Ionicons name="refresh" size={18} color="#FFF" />
              <Text style={styles.createFirstBtnText}>Retry</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  // Show skeleton cards while first load is happening
  if (isInitialLoading) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.headerIconBg}
          >
            <Ionicons name="flame" size={14} color="#FFF" />
          </LinearGradient>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2}>Truth or Dare</Text>
          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={openMyTruthDare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="My Truth and Dare"
          >
            <Ionicons name="list-outline" size={20} color={PREMIUM.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.listContent}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
        <DraggableTodFab
          storageKey={PHASE2_TOD_FAB_STORAGE_KEYS.mainList}
          buttonSize={56}
          defaultRight={18}
          defaultBottom={28}
          topInset={insets.top + 60}
          bottomInset={28}
          positionStyle={styles.fab}
          onPress={openCreateTod}
          activeOpacity={0.85}
          accessibilityLabel="Create Truth or Dare post"
        >
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.fabGradient}
          >
            <Ionicons name="create" size={24} color="#FFF" />
          </LinearGradient>
        </DraggableTodFab>
      </LinearGradient>
    );
  }

  // Empty state only after data has loaded and is actually empty
  if (prompts.length === 0 && promptsDataQuery !== undefined) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <LinearGradient
            colors={[PREMIUM.coral, PREMIUM.coralSoft]}
            style={styles.headerIconBg}
          >
            <Ionicons name="flame" size={14} color="#FFF" />
          </LinearGradient>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2}>Truth or Dare</Text>
          <TouchableOpacity
            style={styles.headerActionButton}
            onPress={openMyTruthDare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="My Truth and Dare"
          >
            <Ionicons name="list-outline" size={20} color={PREMIUM.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyHero}>
          <View style={styles.emptyHeroContent}>
            <View style={styles.emptyHeroIconRing}>
              <Ionicons name="sparkles" size={56} color={PREMIUM.coralSoft} />
            </View>
            <Text style={styles.emptyHeroTitle} maxFontSizeMultiplier={1.2}>
              Start a Truth or Dare
            </Text>
            <Text style={styles.emptyHeroSubtitle} maxFontSizeMultiplier={1.2}>
              Drop a playful prompt and see who answers. If their reply clicks, tap to connect.
            </Text>

            <View style={styles.emptyHeroSteps}>
              <View style={styles.emptyHeroStepRow}>
                <View style={styles.emptyHeroStepIconWrap}>
                  <Ionicons name="pencil-outline" size={16} color={PREMIUM.coralSoft} />
                </View>
                <View style={styles.emptyHeroStepText}>
                  <Text style={styles.emptyHeroStepLabel} maxFontSizeMultiplier={1.2}>
                    Post a prompt
                  </Text>
                  <Text style={styles.emptyHeroStepDesc} maxFontSizeMultiplier={1.2}>
                    A truth question or a fun dare.
                  </Text>
                </View>
              </View>
              <View style={styles.emptyHeroStepRow}>
                <View style={styles.emptyHeroStepIconWrap}>
                  <Ionicons name="chatbubbles-outline" size={16} color={PREMIUM.coralSoft} />
                </View>
                <View style={styles.emptyHeroStepText}>
                  <Text style={styles.emptyHeroStepLabel} maxFontSizeMultiplier={1.2}>
                    Get playful answers
                  </Text>
                  <Text style={styles.emptyHeroStepDesc} maxFontSizeMultiplier={1.2}>
                    People reply in the thread.
                  </Text>
                </View>
              </View>
              <View style={styles.emptyHeroStepRow}>
                <View style={styles.emptyHeroStepIconWrap}>
                  <Ionicons name="heart-outline" size={16} color={PREMIUM.coralSoft} />
                </View>
                <View style={styles.emptyHeroStepText}>
                  <Text style={styles.emptyHeroStepLabel} maxFontSizeMultiplier={1.2}>
                    Tap to connect
                  </Text>
                  <Text style={styles.emptyHeroStepDesc} maxFontSizeMultiplier={1.2}>
                    Like an answer? Send a request.
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.emptyHeroExampleChip}>
              <Text style={styles.emptyHeroExampleChipText} maxFontSizeMultiplier={1.15}>
                Try: “Confess your worst dance move.”
              </Text>
            </View>

            <TouchableOpacity
              style={styles.emptyHeroCta}
              onPress={openCreateTod}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Create Truth or Dare post"
            >
              <LinearGradient
                colors={[PREMIUM.coral, PREMIUM.coralSoft]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.emptyHeroCtaGradient}
              >
                <Ionicons name="sparkles" size={18} color="#FFF" />
                <Text style={styles.emptyHeroCtaText} maxFontSizeMultiplier={1.15}>
                  Create Truth or Dare
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[PREMIUM.bgDeep, PREMIUM.bgBase]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <LinearGradient
          colors={[PREMIUM.coral, PREMIUM.coralSoft]}
          style={styles.headerIconBg}
        >
          <Ionicons name="flame" size={14} color="#FFF" />
        </LinearGradient>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2}>Truth or Dare</Text>
        <TouchableOpacity
          style={styles.headerActionButton}
          onPress={openMyTruthDare}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="My Truth and Dare"
        >
          <Ionicons name="list-outline" size={20} color={PREMIUM.textPrimary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={feedData}
        keyExtractor={getKey}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={PREMIUM.coral}
            colors={[PREMIUM.coral]}
          />
        }
        // Performance props
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      <DraggableTodFab
        storageKey={PHASE2_TOD_FAB_STORAGE_KEYS.mainList}
        buttonSize={56}
        defaultRight={18}
        defaultBottom={28}
        topInset={insets.top + 60}
        bottomInset={28}
        positionStyle={styles.fab}
        onPress={openCreateTod}
        activeOpacity={0.85}
        accessibilityLabel="Create Truth or Dare post"
      >
        <LinearGradient
          colors={[PREMIUM.coral, PREMIUM.coralSoft]}
          style={styles.fabGradient}
        >
          <Ionicons name="create" size={24} color="#FFF" />
        </LinearGradient>
      </DraggableTodFab>

      <TodConnectRequestsSheet
        visible={requestInboxVisible}
        authUserId={userId}
        focusRequestId={focusedRequestId}
        onClose={closeConnectRequests}
      />

      {/* Prompt-owner media viewer — opens when the user taps a covered
          media tile on a feed card. Does not navigate to the prompt thread. */}
      <PromptMediaViewerModal
        payload={viewingPromptMedia}
        onClose={handleClosePromptMedia}
        onConsumed={handlePromptMediaConsumed}
      />

      {/* Delete confirmation popup - compact and contextual */}
      <Modal
        visible={!!deletePopupPromptId}
        transparent
        animationType="fade"
        onRequestClose={handleCloseDeletePopup}
      >
        <Pressable style={styles.deletePopupOverlay} onPress={handleCloseDeletePopup}>
          <Pressable style={styles.deletePopupContainer} onPress={() => {}}>
            <Text style={styles.deletePopupTitle} maxFontSizeMultiplier={1.2}>Post options</Text>
            <Text style={styles.deletePopupSubtitle} maxFontSizeMultiplier={1.2}>
              Edit or delete your post.
            </Text>
            <View style={styles.deletePopupActions}>
              <TouchableOpacity
                style={styles.deletePopupCancelBtn}
                onPress={handleCloseDeletePopup}
                disabled={isDeleting}
              >
                <Text style={styles.deletePopupCancelText} numberOfLines={1} maxFontSizeMultiplier={1.15}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deletePopupEditBtn}
                onPress={handleEditPrompt}
                disabled={isDeleting}
              >
                <Ionicons name="pencil-outline" size={14} color={PREMIUM.textPrimary} />
                <Text style={styles.deletePopupEditText} numberOfLines={1} maxFontSizeMultiplier={1.15}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deletePopupDeleteBtn}
                onPress={handleDeletePrompt}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Text style={styles.deletePopupDeleteText} numberOfLines={1} maxFontSizeMultiplier={1.15}>Deleting...</Text>
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={14} color="#FFF" />
                    <Text style={styles.deletePopupDeleteText} numberOfLines={1} maxFontSizeMultiplier={1.15}>Delete</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════════════════════
  // PREMIUM DARK THEME - Energetic, Modern, Polished
  // ═══════════════════════════════════════════════════════════════════════════════

  container: {
    flex: 1,
  },

  // ─── Header ───
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PREMIUM.borderSubtle,
  },
  headerIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.3,
  },
  headerActionButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PREMIUM.bgElevated,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },

  // ─── Section Headers ───
  sectionHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 12,
  },
  sectionDivider: {
    flex: 1,
    height: 1,
    backgroundColor: PREMIUM.borderSubtle,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: PREMIUM.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  trendingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  trendingSectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trendingIconBg: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendingSectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.5,
  },

  listContent: {
    paddingBottom: 100,
    paddingTop: 4,
  },

  // ─── Normal Card - Premium styling ───
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    // Subtle shadow for depth
    shadowColor: PREMIUM.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },

  // ─── Trending Card - Distinct premium styling with glow ───
  trendingCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: PREMIUM.borderAccent,
    // Enhanced shadow for trending
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
    overflow: 'hidden',
  },
  trendingGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
  },

  // ─── Card Content ───
  cardContent: {
    flex: 1,
    paddingRight: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },

  // ─── Owner Identity ───
  ownerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  ownerPhotoWrapper: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: PREMIUM.borderSubtle,
    overflow: 'hidden',
  },
  ownerPhoto: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
  },
  ownerPhotoPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  ownerInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
    flex: 1,
  },
  ownerName: {
    fontSize: 13,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  ownerNamePremium: {
    fontSize: 13,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.2,
  },
  ownerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerAge: {
    fontSize: 11,
    fontWeight: '500',
    color: PREMIUM.textMuted,
  },
  genderDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    opacity: 0.7,
  },

  // ─── Owner Info Row Layout (name + age/gender inline) ───
  ownerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  ownerMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerAgeInline: {
    fontSize: 11,
    fontWeight: '500',
    color: PREMIUM.textMuted,
  },
  genderDotInline: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    opacity: 0.7,
  },

  // ─── Blurred Photo Container ───
  ownerPhotoBlurContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: PREMIUM.bgHighlight,
  },
  blurDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)', // Dark overlay for Android fallback
  },
  blurOverlayIcon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Card Right Column - Type pill on top; owner media tile (when
  //     present) directly below the pill. Top-aligned so the tile reads
  //     as a clean right-side media column rather than floating in the
  //     middle. When the prompt has no media the column collapses to the
  //     pill alone and reserves no extra vertical space.
  cardRightColumn: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 12,
    paddingVertical: 2,
  },

  // ─── Type Pills - Gradient styling ───
  typePillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
  },

  // ─── Prompt Text - Hero element ───
  promptTextHero: {
    fontSize: 16,
    fontWeight: '600',
    color: PREMIUM.textPrimary,
    lineHeight: 22,
    marginBottom: 10,
    letterSpacing: 0.2,
  },

  // ─── Engagement Row ───
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  answerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  answerCountText: {
    fontSize: 12,
    color: PREMIUM.textMuted,
    fontWeight: '500',
  },
  trendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(233, 69, 96, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  trendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: PREMIUM.coral,
    letterSpacing: 0.5,
  },
  // Subtle viewer-state indicator: same fontSize as the answer count so it
  // sits at the same typographic level (per Rule 1), but in PREMIUM.coral
  // for accent. No background fill, no border — keeps it premium and
  // non-shouty (Rule 3). Reused by both TrendingCard (inline) and PromptCard
  // (right-aligned via `answeredBadgeRight`).
  answeredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  answeredBadgeRight: {
    marginLeft: 'auto',
  },
  answeredBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: PREMIUM.coral,
    letterSpacing: 0.2,
  },

  // ─── Comment Previews ───
  previewSection: {
    gap: 6,
    marginBottom: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: PREMIUM.borderSubtle,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentText: {
    flex: 1,
    fontSize: 12,
    color: PREMIUM.textSecondary,
    lineHeight: 16,
  },
  commentName: {
    fontWeight: '600',
    color: PREMIUM.textPrimary,
  },
  commentSnippet: {
    color: PREMIUM.textMuted,
  },
  // Trailing media chip wrapping the per-type Ionicons glyph. The chip
  // is a small rounded square (matches the `todMediaTileIconChip` size
  // language used on answer-card tiles, scaled down for feed previews)
  // with a translucent per-type backdrop applied inline at the call
  // site (`mediaStyleEntry.color + '1F'`). `flexShrink: 0` keeps the
  // chip at full size while the adjacent `commentText` (flex: 1)
  // truncates with `ellipsizeMode="tail"` — without this the chip
  // would be the first thing the layout chops on narrow screens.
  commentMediaIcon: {
    flexShrink: 0,
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Empty State ───
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 16,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: PREMIUM.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: PREMIUM.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  createFirstBtn: {
    marginTop: 12,
    borderRadius: 24,
    overflow: 'hidden',
  },
  createFirstBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  createFirstBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
  },

  // ─── Redesigned empty-state hero (no-prompts branch only) ───
  // Uses brand-new style names so the error branch above keeps reusing
  // `emptyState` / `emptyIconContainer` / `emptyTitle` / `emptySubtitle` /
  // `createFirstBtn` / `createFirstBtnGradient` / `createFirstBtnText`
  // unchanged.
  emptyHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyHeroContent: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  emptyHeroIconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PREMIUM.bgElevated,
    borderWidth: 1,
    borderColor: PREMIUM.borderAccent,
    marginBottom: 20,
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  emptyHeroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  emptyHeroSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: PREMIUM.textSecondary,
    textAlign: 'center',
  },
  emptyHeroSteps: {
    alignSelf: 'stretch',
    marginTop: 22,
    gap: 12,
  },
  emptyHeroStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  emptyHeroStepIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(233, 69, 96, 0.10)',
    marginTop: 1,
  },
  emptyHeroStepText: {
    flex: 1,
    flexShrink: 1,
  },
  emptyHeroStepLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
  },
  emptyHeroStepDesc: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: PREMIUM.textSecondary,
  },
  emptyHeroExampleChip: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    backgroundColor: PREMIUM.bgElevated,
  },
  emptyHeroExampleChipText: {
    fontSize: 12,
    color: PREMIUM.textMuted,
    letterSpacing: 0.1,
  },
  emptyHeroCta: {
    alignSelf: 'stretch',
    marginTop: 22,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  emptyHeroCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  emptyHeroCtaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.4,
  },

  // ─── FAB - Premium floating action button ───
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    borderRadius: 28,
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Skeleton Cards - Animated loading placeholders ───
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  skeletonContent: {
    flex: 1,
    paddingRight: 10,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  skeletonAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
  },
  skeletonName: {
    width: 90,
    height: 14,
    borderRadius: 7,
    backgroundColor: PREMIUM.bgHighlight,
    marginLeft: 10,
  },
  skeletonPill: {
    width: 60,
    height: 22,
    borderRadius: 11,
    backgroundColor: PREMIUM.bgHighlight,
    marginLeft: 'auto',
  },
  skeletonText: {
    width: '100%',
    height: 16,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
    marginBottom: 8,
  },
  skeletonTextShort: {
    width: '65%',
    height: 16,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
  },
  skeletonButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: PREMIUM.bgHighlight,
    marginLeft: 6,
  },

  // ─── Delete Popup - Compact contextual menu ───
  deletePopupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deletePopupContainer: {
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    padding: 20,
    width: 320,
    maxWidth: '92%',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  deletePopupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  deletePopupSubtitle: {
    fontSize: 13,
    color: PREMIUM.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  deletePopupActions: {
    flexDirection: 'row',
    gap: 10,
  },
  deletePopupEditBtn: {
    flex: 1,
    backgroundColor: PREMIUM.bgHighlight,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  deletePopupEditText: {
    fontSize: 14,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
  },
  deletePopupCancelBtn: {
    flex: 1,
    backgroundColor: PREMIUM.bgHighlight,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletePopupCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  deletePopupDeleteBtn: {
    flex: 1,
    backgroundColor: PREMIUM.coral,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  deletePopupDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  // Prompt-owner media viewer modal (feed-local; not coupled to prompt-thread).
  promptMediaViewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptMediaViewerSurface: {
    width: '92%',
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  // Photo + video fill the explicit height set on the surface (see inline
  // height in PromptMediaViewerModal). `flex: 1` lets the media stretch to
  // the full surface; `contentFit="contain"` (photo) and ResizeMode.CONTAIN
  // (video) preserve aspect ratio with letterboxing — portrait media
  // becomes tall and fills the screen, landscape media fits to width.
  // Earlier `aspectRatio: 1` capped both at a square that looked tiny on
  // tall phones.
  promptMediaViewerImage: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  promptMediaViewerVideo: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  promptMediaViewerVoiceBox: {
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  promptMediaViewerVoiceIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${PREMIUM.coral}1F`,
    borderWidth: 1,
    borderColor: `${PREMIUM.coral}40`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptMediaViewerVoiceTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    textAlign: 'center',
  },
  promptMediaViewerVoiceSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: PREMIUM.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  promptMediaViewerVoiceControls: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  promptMediaViewerVoicePlayBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PREMIUM.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptMediaViewerVoicePlayBtnDisabled: {
    opacity: 0.6,
  },
  promptMediaViewerVoiceProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    overflow: 'hidden',
  },
  promptMediaViewerVoiceProgressFill: {
    height: '100%',
    backgroundColor: PREMIUM.coral,
  },
  promptMediaViewerVoiceTime: {
    fontSize: 12,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
    minWidth: 64,
    textAlign: 'right',
  },
  promptMediaViewerCloseBtn: {
    position: 'absolute',
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  promptMediaViewerSpinnerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
