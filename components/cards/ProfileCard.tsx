/**
 * 🔒 LOCKED: Phase-1 Discover (Production Ready)
 *
 * This feature has completed full audit and production hardening.
 * Do NOT modify without explicit approval.
 *
 * Locked scope includes:
 * - auth flow
 * - ranking logic
 * - pagination
 * - swipe behavior
 * - card rendering rules
 * - presence handling
 * - distance logic
 * - empty state logic
 *
 * If changes are required:
 * - open a new audit
 * - do not modify directly
 */
import React, { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  FadeIn,
  FadeOut,
  Layout,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
// P0-FIX: Haptic feedback for premium interactions
import * as Haptics from 'expo-haptics';
import { cmToFeetInches } from '@/lib/utils';
import { trackAction } from '@/lib/sentry';
import { getRenderableProfilePhotos } from '@/lib/profileData';
import { formatPhase2DistanceMiles } from '@/lib/phase2Distance';
import { getVerificationDisplay } from '@/lib/verificationStatus';
import {
  DEBUG_PHOTO_RENDER,
  DEBUG_DISCOVER_PLANNER,
  DEBUG_CARD_PRESENCE,
  DEBUG_CONTENT_RENDER,
  DEBUG_P2_UI,
} from '@/lib/debugFlags';
import type { PresenceStatus } from '@/hooks/usePresence';

import {
  COLORS,
  INCOGNITO_COLORS,
  RELATIONSHIP_INTENTS,
  ACTIVITY_FILTERS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from '@/lib/constants';
import type { TrustBadge } from '@/lib/trustBadges';
import {
  PRIVATE_INTENT_CATEGORIES,
  PRIVATE_DESIRE_TAGS,
  PHASE2_PROMPT_PRIORITY,
  PHASE2_PROMPT_SECTION_LABEL,
  getPhase2PromptSection,
  type Phase2PromptSection,
} from '@/lib/privateConstants';
// Phase-1 only premium light/shaded theme tokens. Phase-2 surfaces must
// not import this file.
import { PHASE1_DISCOVER_THEME } from '@/components/screens/_internal/phase1DiscoverTheme.tokens';

const PHASE1_ACTIVE_CARD_LOOKAHEAD = 2;
const PHASE2_ACTIVE_CARD_LOOKAHEAD = 4;
const PHASE2_ACTIVE_CARD_PREVIOUS = 2;
const PHASE1_PREFETCH_AHEAD = 2;
const PHASE2_PREFETCH_COUNT = 8;

function getDistanceDebugValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}

// Gender labels for "Looking for" display
const GENDER_LABELS: Record<string, string> = {
  male: 'Men',
  female: 'Women',
  non_binary: 'Non-binary',
  lesbian: 'Women',
  other: 'Everyone',
};

// Phase-2 Deep Connect chip-label display aliases.
// Render-only: shorter, premium presentation. The underlying data values
// (used by filters, queries, analytics, schema) are NEVER changed — only
// the visible chip text inside the Deep Connect profile card.
const PHASE2_CHIP_LABEL_ALIASES: Record<string, string> = {
  'Friends with Benefits': 'FWB',
};
const phase2ChipDisplayLabel = (label: string): string =>
  PHASE2_CHIP_LABEL_ALIASES[label] ?? label;

// Gender icon mapping for identity display
const GENDER_ICONS: Record<string, { icon: string; color: string }> = {
  male: { icon: 'male', color: '#3B82F6' }, // Blue
  female: { icon: 'female', color: '#EC4899' }, // Pink
  non_binary: { icon: 'male-female', color: '#A855F7' }, // Purple
  other: { icon: 'person', color: '#6B7280' }, // Gray
};

export interface ProfileCardProps {
  /**
   * Explicit phase context for rendering.
   * When set to "phase2", Phase-2 card logic MUST be used even if optional data is missing.
   * When unset, legacy inference is used for backward compatibility.
   */
  phase?: 'phase1' | 'phase2';
  name: string;
  // IDENTITY SIMPLIFICATION: firstName/lastName removed - use single `name` field
  age?: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  verificationStatus?: string | null;
  distance?: number;
  photos: { url: string }[];
  /** First profile prompt to display on discover card */
  profilePrompt?: { promptId?: string | null; question: string; answer: string };
  /** All profile prompts for Phase-2 photo-index reveal */
  profilePrompts?: { promptId?: string | null; question: string; answer: string }[];
  /** Trust badges computed via getTrustBadges() */
  trustBadges?: TrustBadge[];
  /** Enable photo carousel + swipe mode (Discover card) */
  showCarousel?: boolean;
  /** When "dark", uses INCOGNITO_COLORS for Face 2 dark theme */
  theme?: 'light' | 'dark';
  /** Called when user taps the arrow to view full profile */
  onOpenProfile?: () => void;
  /** When true, photos are rendered with a blur effect (user-controlled privacy) */
  photoBlurred?: boolean;
  /** Phase-2: master enable for per-photo blur (independent of which slots are blurred). */
  photoBlurEnabled?: boolean;
  /** Phase-2: per-photo blur slots aligned with `photos[]` indices (true = blurred). */
  photoBlurSlots?: boolean[];
  /**
   * P1-009: True when viewer and profile-owner have mutually matched in Deep Connect.
   * When true, the card skips blur for this exact pair (never global).
   * Only source: `isRevealed` field from Phase-2 discover queries.
   */
  isRevealed?: boolean;
  /** Face 2 only: intent category keys from PRIVATE_INTENT_CATEGORIES (array) */
  privateIntentKeys?: string[];
  /** Phase-2 only: desire tag keys from PRIVATE_DESIRE_TAGS */
  desireTagKeys?: string[];
  /** Phase-1 only: Gender preferences (looking for) */
  lookingFor?: string[];
  /** Phase-1 only: Relationship intent keys */
  relationshipIntent?: string[];
  /** Activities/interests keys */
  activities?: string[];
  /** User's gender for identity display */
  gender?: string;
  /** Viewer profile data for computing common points (Phase-1 only) */
  viewerProfile?: {
    activities?: string[];
    relationshipIntent?: string[];
    lookingFor?: string[];
    smoking?: string;
    drinking?: string;
    height?: number;
  };
  /** True if user has incognito mode enabled (shows badge) */
  isIncognito?: boolean;
  /** Explore category tag - shows "Why this profile" label above name */
  exploreTag?: string;
  /** P0 UNIFIED PRESENCE: Presence status from unified presence system */
  presenceStatus?: PresenceStatus;
  /** @deprecated Use presenceStatus instead. Legacy lastActive timestamp. */
  lastActive?: number;
  /** Phase-2 only: Lifestyle data */
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  education?: string | null;
  religion?: string | null;
  /** Optional profile/user id for DEV-only diagnostics. */
  profileId?: string;
  // Legacy props for non-Discover usage (explore grid etc.)
  user?: any;
  onPress?: () => void;
  /** GROWTH: Match percentage (60-95%) from compatibility scoring */
  matchScore?: number;
  /** GROWTH: True if this person has already liked the viewer */
  theyLikedMe?: boolean;
}

const BLUR_RADIUS = 25; // Strong but recognisable blur

/**
 * PERF: Memoized photo stack for instant switching
 * Renders all photos in a stack with only opacity changes on index change.
 * This prevents remounting images and keeps them warm in memory.
 */
interface PhotoStackProps {
  photos: { url: string }[];
  activeIndex: number;
  photoBlurred?: boolean;
  photoBlurEnabled?: boolean;
  photoBlurSlots?: boolean[];
  onError?: () => void;
  lookaheadCount: number;
  previousCount?: number;
}

// P1-FIX: Individual photo component with blur transition animation
// Optimized for Android performance - uses single worklet-driven opacity animation
const AnimatedPhoto = memo(function AnimatedPhoto({
  photo,
  isActive,
  shouldBlur,
  onError,
}: {
  photo: { url: string };
  isActive: boolean;
  shouldBlur: boolean;
  onError?: () => void;
}) {
  // P1-FIX: Single shared value for blur overlay opacity (Android-safe)
  const blurOverlayOpacity = useSharedValue(shouldBlur ? 1 : 0);

  // Animate blur overlay when state changes
  useEffect(() => {
    // Use faster timing for better perceived responsiveness
    blurOverlayOpacity.value = withTiming(shouldBlur ? 1 : 0, { duration: 200 });
  }, [shouldBlur, blurOverlayOpacity]);

  // Worklet-driven styles for maximum performance
  const containerStyle = useAnimatedStyle(() => ({
    opacity: isActive ? 1 : 0,
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: blurOverlayOpacity.value * 0.15, // Subtle overlay effect
  }));

  return (
    <Animated.View style={[styles.image, containerStyle]}>
      <Image
        source={{ uri: photo.url }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        cachePolicy="memory-disk"
        blurRadius={shouldBlur ? BLUR_RADIUS : undefined}
        onError={isActive ? onError : undefined}
      />
      {/* P1-FIX: Always-mounted blur overlay with animated opacity (avoids mount/unmount) */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }, overlayStyle]}
        pointerEvents="none"
      />
    </Animated.View>
  );
});

const PhotoStack = memo(function PhotoStack({
  photos,
  activeIndex,
  photoBlurred,
  photoBlurEnabled,
  photoBlurSlots,
  onError,
  lookaheadCount,
  previousCount = 0,
}: PhotoStackProps) {
  const windowStart = Math.max(0, activeIndex - previousCount);
  const windowEnd = Math.min(photos.length, activeIndex + 1 + lookaheadCount);
  const visiblePhotos = photos.slice(windowStart, windowEnd);
  const indexOffset = windowStart; // Offset to map local index to global

  // LOG_NOISE_FIX: Gated behind DEBUG_PHOTO_RENDER flag (default: false)
  if (__DEV__ && DEBUG_PHOTO_RENDER) {
    console.log(`[PHOTO_RENDER] idx=${activeIndex}/${photos.length} win=${windowStart}-${windowEnd}`);
  }

  return (
    <>
      {visiblePhotos.map((photo, localIdx) => {
        const globalIdx = localIdx + indexOffset;
        const shouldBlur =
          // Phase-2: master enable + per-slot blur
          photoBlurEnabled === true
            ? Boolean(photoBlurSlots?.[globalIdx])
            // Phase-1 (and legacy): single boolean
            : photoBlurred === true;
        return (
          <AnimatedPhoto
            key={photo.url}
            photo={photo}
            isActive={globalIdx === activeIndex}
            shouldBlur={shouldBlur}
            onError={globalIdx === activeIndex ? onError : undefined}
          />
        );
      })}
    </>
  );
});

export const ProfileCard: React.FC<ProfileCardProps> = React.memo(({
  phase,
  name,
  // IDENTITY SIMPLIFICATION: firstName/lastName removed
  age,
  bio,
  isVerified,
  verificationStatus,
  distance,
  photos,
  profilePrompt,
  profilePrompts,
  trustBadges,
  showCarousel = false,
  theme = 'light',
  onOpenProfile,
  photoBlurred = false,
  photoBlurEnabled,
  photoBlurSlots,
  isRevealed = false,
  privateIntentKeys,
  desireTagKeys,
  lookingFor,
  relationshipIntent,
  activities,
  gender,
  viewerProfile,
  isIncognito,
  exploreTag,
  presenceStatus,
  lastActive, // @deprecated - use presenceStatus
  height: profileHeight,
  smoking,
  drinking,
  education = null,
  religion = null,
  profileId,
  onPress,
  matchScore,
  theyLikedMe,
}) => {
  const dark = theme === 'dark';
  // PHASE-2 DETECTION: Check for non-empty privateIntentKeys array
  // IMPORTANT: Empty array [] is truthy, so we must check length > 0
  const isPhase2 =
    phase === 'phase2'
      ? true
      : phase === 'phase1'
        ? false
        : (Array.isArray(privateIntentKeys) && privateIntentKeys.length > 0);
  // P1-009: When this pair has mutually revealed (matched in Deep Connect),
  // force-disable blur for that pair only. `isRevealed` is scoped per-viewer
  // and never leaks photos globally.
  const effectivePhotoBlurEnabled = isRevealed ? false : photoBlurEnabled;
  const effectivePhotoBlurred = isRevealed ? false : photoBlurred;
  const effectivePhotoBlurSlots = isRevealed ? undefined : photoBlurSlots;
  const shouldBlurPhoto = isPhase2 ? (effectivePhotoBlurEnabled === true) : effectivePhotoBlurred === true;

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY SIMPLIFICATION: Single `name` field for all phases
  // Phase-1 shows full name, Phase-2 shows nickname (via name field)
  // ═══════════════════════════════════════════════════════════════════════════
  // ANON-LOADING-FIX: empty string is the "name not yet known" sentinel.
  // The render sites below show a small skeleton bar in that case rather
  // than printing the literal word "Anonymous", which is reserved for
  // intentional anonymous product modes.
  const displayName = useMemo(() => {
    return name || '';
  }, [name]);
  const ageLabel = useMemo(() => {
    return typeof age === 'number' && age > 0 ? String(age) : null;
  }, [age]);
  const TC = dark ? INCOGNITO_COLORS : COLORS;
  const { height: windowHeight } = useWindowDimensions();

  // Responsive bottom offset for arrow button (was hardcoded 140px)
  // On ~850px device, 140px ≈ 16.5% from bottom — scale proportionally
  const arrowButtonBottom = Math.round(windowHeight * 0.165);

  // P0 UNIFIED PRESENCE: Derive presence from presenceStatus prop (single source of truth)
  // Standardized thresholds: Online Now = 10 min, recently active = 24h
  const isActiveNow = presenceStatus === 'online';
  const isActiveToday = presenceStatus === 'active_today';
  const verificationDisplay = useMemo(
    () => getVerificationDisplay({ isVerified, verificationStatus }),
    [isVerified, verificationStatus],
  );
  // Phase-2 Deep Connect: distance only (miles), no city / area / "Nearby"
  // bucket. If `distance` is undefined / negative / hidden, the formatter
  // returns null and the row renders nothing — privacy is honoured by the
  // backend simply omitting `distance`.
  const phase2DistanceLabel = useMemo(() => {
    return isPhase2 ? formatPhase2DistanceMiles(distance) : null;
  }, [distance, isPhase2]);
  // Phase-1 Discover: same miles formatter so the public swipe deck and the
  // Deep Connect deck use identical distance language ("< 1 mi" / "N mi").
  // Reuses the SAME `distance` prop Phase-1 already had (no Phase-2 backend
  // coupling) and inherits the formatter's privacy behaviour: when distance
  // is missing / negative / invalid the formatter returns null and the
  // metadata row's distance pill renders nothing.
  const phase1DistanceLabel = useMemo(() => {
    return !isPhase2 ? formatPhase2DistanceMiles(distance) : null;
  }, [distance, isPhase2]);

  // LOG_NOISE_FIX: Presence logging gated behind DEBUG_CARD_PRESENCE (default: false)
  useEffect(() => {
    if (__DEV__ && DEBUG_CARD_PRESENCE && showCarousel && !isPhase2) {
      console.log(`[PRESENCE] ${name}: ${presenceStatus ?? 'none'}`);
    }
  }, [name, presenceStatus, showCarousel, isPhase2]);

  // Phase-1 only: Compute "Looking for" text
  const lookingForText = useMemo(() => {
    if (isPhase2 || !lookingFor || lookingFor.length === 0) return null;
    if (lookingFor.length >= 3) return 'Looking for: Everyone';
    const labels = lookingFor.map(g => GENDER_LABELS[g] || g).filter(Boolean);
    const unique = [...new Set(labels)];
    return unique.length > 0 ? `Looking for: ${unique.join(', ')}` : null;
  }, [isPhase2, lookingFor]);

  // Phase-1 only: Get relationship intent labels
  const intentLabels = useMemo(() => {
    if (isPhase2) return [];
    // P1-5: Tolerate undefined / non-array relationshipIntent payloads.
    const safeIntents: string[] = Array.isArray(relationshipIntent) ? relationshipIntent : [];
    if (safeIntents.length === 0) return [];
    return safeIntents
      .map(key => RELATIONSHIP_INTENTS.find(i => i.value === key))
      .filter(Boolean)
      .slice(0, 2) // Show max 2 on card
      .map(i => i!.label);
  }, [isPhase2, relationshipIntent]);

  // Phase-1 only: Get activity labels with emojis
  const activityItems = useMemo(() => {
    if (isPhase2) return [];
    // P1-5: Guard against non-array activities payloads.
    const safeActivities: string[] = Array.isArray(activities) ? activities : [];
    if (safeActivities.length === 0) return [];
    return safeActivities
      .map(key => ACTIVITY_FILTERS.find(a => a.value === key))
      .filter(Boolean)
      .slice(0, 5) // Show max 5 on reveal photo
      .map(a => ({ emoji: a!.emoji, label: a!.label }));
  }, [isPhase2, activities]);

  const phase1SupplementalTrustBadges = useMemo(() => {
    if (isPhase2 || !trustBadges || trustBadges.length === 0) return [];
    // Exclude presence ('active'), identity-verified ('verified'), the
    // legacy "Face Verified" pill ('face_verified'), and the utility/status
    // tags 'photos' (Photos Added) and 'complete' (Profile Complete) which
    // are meta-completeness indicators, not trust signals shown on Discover.
    // Product rule: only show a small verified tick next to name/age — never
    // a separate Face Verified badge; never show meta profile-completeness pills.
    return trustBadges
      .filter((badge) =>
        badge.key !== 'active' &&
        badge.key !== 'verified' &&
        badge.key !== 'face_verified' &&
        badge.key !== 'photos' &&
        badge.key !== 'complete'
      )
      .slice(0, 2);
  }, [isPhase2, trustBadges]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1: PROMPT-FIRST DISCOVERY MODEL (UX REFACTOR)
  // Priority in wave units: bio → prompts (max 2 total) → basics → interests → relationship
  //
  // Photo 1 = IDENTITY ONLY: name, age, gender, presence, distance (no bio/prompts on P1)
  // Later photos: wave-distributed content; soft fallbacks use distinct variants (no duplicate blocks)
  //
  // ADAPTIVE FALLBACKS (based on photo count; see planner branches):
  // - 1 photo: P1 identity only
  // - 2–4+ photos: P1 identity; later slides per 2/3/4/5+ branch
  //
  // NO "Both..." comparison text, NO redundancy across photos
  //
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1 WAVE DISTRIBUTION: BALANCED CONTENT ACROSS PHOTOS
  // ═══════════════════════════════════════════════════════════════════════════
  // Wave density pattern: LOW → MEDIUM → HIGH → MEDIUM → HIGH...
  // Each content unit used at MOST ONCE (no repetition except identity)
  // Identity (name, age, gender, badges, distance) always on Photo 1
  // ═══════════════════════════════════════════════════════════════════════════

  // Display unit types for wave distribution
  type DisplayUnitType =
    | 'bio'
    | 'prompt'
    | 'basics'
    | 'interests'
    | 'essentials'
    | 'relationship'
    | 'education'
    | 'religion';

  interface DisplayUnit {
    key: string;
    type: DisplayUnitType;
    priority: number;
    payload: any;
    weight: number; // 1 = small, 2 = medium (long content)
  }

  // Density levels for wave pattern
  type WaveDensity = 'low' | 'medium' | 'high';

  // Photo content plan from distribution engine
  interface PhotoContentPlan {
    photoIndex: number;
    includeIdentity: boolean;
    density: WaveDensity;
    units: DisplayUnit[];
  }

  // Slot types for rendering
  type Phase1ContentSlot =
    | 'identity'           // Photo 1: name, age, gender, badges, distance
    | 'identity_bio'       // Identity + bio (for 2-4 photo profiles)
    | 'wave_content'       // Wave-distributed content units
    | 'soft_fallback';     // Compact reinforcement for late photos when unique content exhausted

  // Get primary intent as a single elegant line
  const phase1IntentLine = useMemo(() => {
    if (isPhase2 || !relationshipIntent || relationshipIntent.length === 0) return null;
    const primaryIntent = RELATIONSHIP_INTENTS.find(i => i.value === relationshipIntent[0]);
    if (!primaryIntent) return null;
    // Create elegant phrasing
    const intentPhrases: Record<string, string> = {
      'serious_vibes': 'Looking for something serious',
      'keep_it_casual': 'Keeping things casual',
      'exploring_vibes': 'Still figuring things out',
      'see_where_it_goes': 'Open to see where it goes',
      'open_to_vibes': 'Open to different vibes',
      'just_friends': 'Looking for friendship',
      'open_to_anything': 'Open to anything',
      'single_parent': 'Single parent looking for love',
      'new_to_dating': 'New to the dating scene',
    };
    return intentPhrases[primaryIntent.value] || primaryIntent.label;
  }, [isPhase2, relationshipIntent]);

  // Get ALL prompts for Phase-1 (not just the best one)
  const phase1AllPrompts = useMemo(() => {
    if (isPhase2) return [];
    const prompts: { question: string; answer: string }[] = [];
    if (profilePrompts && profilePrompts.length > 0) {
      prompts.push(...profilePrompts);
    } else if (profilePrompt) {
      prompts.push(profilePrompt);
    }
    return prompts;
  }, [isPhase2, profilePrompts, profilePrompt]);

  // Legacy alias for backward compatibility
  const phase1BestPrompt = phase1AllPrompts.length > 0 ? phase1AllPrompts[0] : null;

  // Phase-1: Lifestyle data (height, smoking, drinking) - ALL fields rendered
  const phase1Lifestyle = useMemo(() => {
    if (isPhase2) return [];
    const items: { icon: string; label: string }[] = [];

    // Height
    if (profileHeight && profileHeight > 0) {
      const heightStr = cmToFeetInches(profileHeight);
      if (heightStr) items.push({ icon: 'resize-outline', label: heightStr });
    }

    // Smoking - ALL values
    if (smoking && smoking !== 'prefer_not_to_say') {
      const smokingLabels: Record<string, string> = {
        never: 'Non-smoker',
        sometimes: 'Sometimes smokes',
        socially: 'Social smoker',
        regularly: 'Smoker',
        trying_to_quit: 'Quitting smoking',
      };
      if (smokingLabels[smoking]) items.push({ icon: 'flame-outline', label: smokingLabels[smoking] });
    }

    // Drinking - ALL values
    if (drinking && drinking !== 'prefer_not_to_say') {
      const drinkingLabels: Record<string, string> = {
        never: "Doesn't drink",
        socially: 'Social drinker',
        regularly: 'Regular drinker',
        sober: 'Sober',
      };
      if (drinkingLabels[drinking]) items.push({ icon: 'wine-outline', label: drinkingLabels[drinking] });
    }

    return items;
  }, [isPhase2, profileHeight, smoking, drinking]);

  // Phase-1: Education (single lifestyle-style item, mirrors Phase-2 pattern)
  const phase1Education = useMemo(() => {
    if (isPhase2) return null;
    if (!education || education === 'prefer_not_to_say') return null;
    const label =
      EDUCATION_OPTIONS.find((option) => option.value === education)?.label ?? education;
    return { icon: 'school-outline', label, key: `edu-${education}` };
  }, [isPhase2, education]);

  // Phase-1: Religion (single lifestyle-style item, mirrors Phase-2 pattern)
  const phase1Religion = useMemo(() => {
    if (isPhase2) return null;
    if (!religion || religion === 'prefer_not_to_say') return null;
    const label =
      RELIGION_OPTIONS.find((option) => option.value === religion)?.label ?? religion;
    return { icon: 'sparkles-outline', label, key: `rel-${religion}` };
  }, [isPhase2, religion]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1: SHARED INTERESTS (NO comparison text, just matching activities)
  // Shows candidate's interests that viewer ALSO has - displayed as simple labels
  // NO "Both..." or "You have in common..." text - just the interest itself
  // ═══════════════════════════════════════════════════════════════════════════
  const phase1SharedInterests = useMemo(() => {
    if (isPhase2 || !viewerProfile) return [];

    // P1-5: Harden against malformed payloads — activities may arrive as undefined
    // or a non-array if the backend schema drifts.
    const viewerActivities: string[] = Array.isArray(viewerProfile.activities)
      ? viewerProfile.activities
      : [];
    const candidateActivities: string[] = Array.isArray(activities) ? activities : [];

    // Find activities that both have
    const sharedActivities = viewerActivities.filter(a => candidateActivities.includes(a));

    // Return as simple labeled items (NO comparison text)
    return sharedActivities
      .map(key => ACTIVITY_FILTERS.find(a => a.value === key))
      .filter(Boolean)
      .slice(0, 3) // Max 3 shared interests
      .map(a => ({ emoji: a!.emoji, label: a!.label }));
  }, [isPhase2, viewerProfile, activities]);

  // LEGACY: phase1CommonPointsLegacy - DEPRECATED, kept for compatibility but returns empty
  // All "Both..." comparison text has been removed per UX refactor
  const phase1CommonPointsLegacy: { icon: string; text: string; priority: number }[] = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1: COMMON POINTS (CRITICAL - SHOW FIRST WHEN EXISTS)
  // Priority highlights: shared interests, matching intent, lifestyle compatibility
  // Format: ⭐ Label (e.g., "⭐ Gym", "⭐ Serious relationship")
  // Max 2 items, no sentences, no "you both"
  // ═══════════════════════════════════════════════════════════════════════════
  const phase1CommonPoints = useMemo((): string[] => {
    if (isPhase2 || !viewerProfile) return [];

    const commonItems: string[] = [];

    // Priority 1: Shared interests (most valuable)
    if (phase1SharedInterests.length > 0) {
      phase1SharedInterests.slice(0, 2).forEach(item => {
        commonItems.push(item.label);
      });
    }

    // Priority 2: Matching relationship intent
    if (commonItems.length < 2 && viewerProfile.relationshipIntent && relationshipIntent) {
      const viewerIntents = viewerProfile.relationshipIntent;
      const matchingIntent = relationshipIntent.find(intent => viewerIntents.includes(intent));
      if (matchingIntent) {
        const intentLabels: Record<string, string> = {
          'serious_vibes': 'Serious relationship',
          'keep_it_casual': 'Casual dating',
          'exploring_vibes': 'Exploring',
          'see_where_it_goes': 'Open-minded',
          'open_to_vibes': 'Open to anything',
          'just_friends': 'Friendship',
          'open_to_anything': 'Open to anything',
        };
        if (intentLabels[matchingIntent]) {
          commonItems.push(intentLabels[matchingIntent]);
        }
      }
    }

    // Priority 3: Matching lifestyle (if still space)
    if (commonItems.length < 2) {
      // Matching drinking
      if (viewerProfile.drinking && drinking && viewerProfile.drinking === drinking) {
        const drinkingLabels: Record<string, string> = {
          never: 'Non-drinker',
          socially: 'Social drinker',
          regularly: 'Drinks often',
          sober: 'Sober',
        };
        if (drinkingLabels[drinking] && commonItems.length < 2) {
          commonItems.push(drinkingLabels[drinking]);
        }
      }
      // Matching smoking
      if (viewerProfile.smoking && smoking && viewerProfile.smoking === smoking) {
        const smokingLabels: Record<string, string> = {
          never: 'Non-smoker',
          sometimes: 'Sometimes smokes',
          regularly: 'Smoker',
          trying_to_quit: 'Quitting smoking',
        };
        if (smokingLabels[smoking] && commonItems.length < 2) {
          commonItems.push(smokingLabels[smoking]);
        }
      }
    }

    return commonItems.slice(0, 2); // Strict max 2
  }, [isPhase2, viewerProfile, phase1SharedInterests, relationshipIntent, drinking, smoking]);

  // Alias for backward compatibility
  const phase1SubtleHighlights = phase1CommonPoints;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1A: MATCH SIGNAL BADGE COMPUTATIONS
  // For the "X in common" badge on Photo 1
  // ═══════════════════════════════════════════════════════════════════════════
  const matchSignalCount = phase1SharedInterests.length;
  const hasSameRelationshipIntent = useMemo(() => {
    if (isPhase2) return false;
    const viewerIntents = Array.isArray(viewerProfile?.relationshipIntent)
      ? viewerProfile!.relationshipIntent
      : [];
    const candidateIntents = Array.isArray(relationshipIntent) ? relationshipIntent : [];
    if (viewerIntents.length === 0 || candidateIntents.length === 0) return false;
    return viewerIntents.some(intent => candidateIntents.includes(intent));
  }, [isPhase2, viewerProfile?.relationshipIntent, relationshipIntent]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1: WAVE DISTRIBUTION CONTENT MODEL
  // ═══════════════════════════════════════════════════════════════════════════
  // Wave density: LOW(1) → MEDIUM(2) → HIGH(3) → MEDIUM(2) → HIGH(3)...
  // Photo 1 is special: identity only (no bio/prompt on first slide when multi-photo)
  // Each content unit used AT MOST ONCE - NO repetition
  // ═══════════════════════════════════════════════════════════════════════════
  interface Phase1PhotoContentItem {
    bio?: string;
    intent?: string;
    prompts: { question: string; shortLabel: string; answer: string; id: number }[];
    lifestyle: { icon: string; label: string; key: string }[];
    interests: { emoji: string; label: string; key: string }[];
    commonPoints: { text: string; key: string }[];
    slotType: Phase1ContentSlot;
    // Wave distribution data
    waveUnits: DisplayUnit[];
    waveDensity: WaveDensity;
    // Soft fallback data for late photos (compact reinforcement)
    // P0-FIX: Added 'new_here' type for sparse profiles
    softFallback?: {
      type: 'prompt' | 'interests' | 'intent' | 'bio' | 'cta' | 'new_here';
      promptSnippet?: string;  // Shortened prompt answer
      interestChips?: { emoji: string; label: string }[];  // Top 2-3 interests
      intentLine?: string;     // Relationship intent
      bioSnippet?: string;     // First line of bio
    };
  }

  // Helper: Convert prompt question to short label (4-5 words max)
  const toShortLabel = (question: string): string => {
    // Remove trailing punctuation and common prefixes
    let label = question
      .replace(/[?!.,]+$/, '')
      .replace(/^(What|How|Why|When|Where|Who|Tell us about|Describe|Share)\s+/i, '')
      .trim();

    // Take first 4-5 words
    const words = label.split(/\s+/);
    if (words.length > 5) {
      label = words.slice(0, 5).join(' ');
    }

    // Capitalize first letter
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  // Phase-1 spec: max 2 prompts total across the card experience
  const selectedPrompts = useMemo(() => {
    if (isPhase2 || phase1AllPrompts.length === 0) return [];
    return phase1AllPrompts.slice(0, 2).map((p, idx) => ({
      ...p,
      id: idx,
      shortLabel: toShortLabel(p.question),
    }));
  }, [isPhase2, phase1AllPrompts]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1 WAVE DISTRIBUTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVACY: "Looking for" / intent NEVER shown in public UI
  // RULE: Each content unit used AT MOST ONCE - NO repetition except identity
  //
  // WAVE DENSITY PATTERN:
  //   LOW(1 unit) → MEDIUM(2 units) → HIGH(3 units) → MEDIUM → HIGH...
  //
  // PHOTO-COUNT SPECIFIC RULES (see branches below; max 2 prompts total):
  //   1 photo:  P1 = identity only
  //   2–4 photos: P1 = identity; P2+ = wave / soft_fallback per branch
  //   5+ photos: P1 identity, P2 bio, P3 prompt1+basics, P4 prompt2+interests, then remaining + soft fallbacks
  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 LOCKED: Do not change Phase-1 card distribution / photo rules without audit approval
  const phase1PhotoContents = useMemo((): Phase1PhotoContentItem[] => {
    if (isPhase2) return [];

    const contents: Phase1PhotoContentItem[] = [];
    const totalPhotos = photos?.length || 1;

    // ═══════════════════════════════════════════════════════════════════════
    // TASK 1: UNIT GENERATOR - Build ordered unique display units
    // Priority: bio → prompt1 → basics → prompt2 → interests → prompt3
    // ═══════════════════════════════════════════════════════════════════════
    const units: DisplayUnit[] = [];
    let priority = 0;

    // Prepare data
    const lifestyleWithKeys = phase1Lifestyle.map((l, idx) => ({ ...l, key: `ls-${idx}-${l.label}` }));
    const hasBio = !!bio && bio.trim().length > 0;
    const hasBasics = lifestyleWithKeys.length > 0;
    const hasInterests = activities && activities.length > 0;

    // Convert ALL activities to interest chips (up to 8) for splitting into chunks
    const allInterestChips = hasInterests
      ? activities!.slice(0, 8).map((key, idx) => {
          const activity = ACTIVITY_FILTERS.find(a => a.value === key);
          return activity
            ? { emoji: activity.emoji, label: activity.label, key: `int-${idx}-${key}` }
            : null;
        }).filter(Boolean) as { emoji: string; label: string; key: string }[]
      : [];

    // Split interests into chunks of 3 for finer-grained distribution
    const interestChunks: { emoji: string; label: string; key: string }[][] = [];
    for (let i = 0; i < allInterestChips.length; i += 3) {
      interestChunks.push(allInterestChips.slice(i, i + 3));
    }

    // Unit 1: Bio (highest priority, weight based on length)
    if (hasBio) {
      const bioWeight = bio!.length > 100 ? 2 : 1;
      units.push({
        key: 'bio',
        type: 'bio',
        priority: priority++,
        payload: { text: bio },
        weight: bioWeight,
      });
    }

    // Unit 2: Prompt 1
    if (selectedPrompts.length > 0) {
      const promptWeight = selectedPrompts[0].answer.length > 80 ? 2 : 1;
      units.push({
        key: 'prompt1',
        type: 'prompt',
        priority: priority++,
        payload: { prompt: selectedPrompts[0] },
        weight: promptWeight,
      });
    }

    // Unit 3: Basics compact (height/smoking/drinking combined)
    if (hasBasics) {
      units.push({
        key: 'basics_compact',
        type: 'basics',
        priority: priority++,
        payload: { items: lifestyleWithKeys },
        weight: 1,
      });
    }

    // Unit 4: Relationship Intent — what user is looking for
    if (relationshipIntent && relationshipIntent.length > 0) {
      const intentLabels = relationshipIntent
        .slice(0, 3)
        .map((key) => {
          const intent = RELATIONSHIP_INTENTS.find((r) => r.value === key);
          return intent ? { emoji: intent.emoji || '💫', label: intent.label, key: `rel-${key}` } : null;
        })
        .filter(Boolean) as { emoji: string; label: string; key: string }[];

      if (intentLabels.length > 0) {
        units.push({
          key: 'relationship',
          type: 'relationship',
          priority: priority++,
          payload: { chips: intentLabels },
          weight: 1,
        });
      }
    }

    // Unit 5: Interests Part 1 (first chunk of 3)
    if (interestChunks.length > 0) {
      units.push({
        key: 'interests_part1',
        type: 'interests',
        priority: priority++,
        payload: { chips: interestChunks[0] },
        weight: 1,
      });
    }

    // Unit 6: Prompt 2
    if (selectedPrompts.length > 1) {
      const promptWeight = selectedPrompts[1].answer.length > 80 ? 2 : 1;
      units.push({
        key: 'prompt2',
        type: 'prompt',
        priority: priority++,
        payload: { prompt: selectedPrompts[1] },
        weight: promptWeight,
      });
    }

    // Unit 7: Education (single lifestyle-style item)
    if (phase1Education) {
      units.push({
        key: phase1Education.key,
        type: 'education',
        priority: priority++,
        payload: { item: { icon: phase1Education.icon, label: phase1Education.label } },
        weight: 1,
      });
    }

    // Unit 8: Religion (single lifestyle-style item)
    if (phase1Religion) {
      units.push({
        key: phase1Religion.key,
        type: 'religion',
        priority: priority++,
        payload: { item: { icon: phase1Religion.icon, label: phase1Religion.label } },
        weight: 1,
      });
    }

    // Unit 9: Interests Part 2 (second chunk of 3, if available)
    if (interestChunks.length > 1) {
      units.push({
        key: 'interests_part2',
        type: 'interests',
        priority: priority++,
        payload: { chips: interestChunks[1] },
        weight: 1,
      });
    }

    // Unit 10: Interests Part 3 (third chunk of 3, if available)
    if (interestChunks.length > 2) {
      units.push({
        key: 'interests_part3',
        type: 'interests',
        priority: priority++,
        payload: { chips: interestChunks[2] },
        weight: 1,
      });
    }

    // Note: max 2 prompts total per spec.

    // ═══════════════════════════════════════════════════════════════════════
    // STRICT UNIQUE-CONTENT TRACKING: each unit used AT MOST ONCE.
    // The smart linear planner below selects units one slide at a time and
    // marks them via `usedUnitKeys` so no semantic data point repeats.
    // ═══════════════════════════════════════════════════════════════════════
    const usedUnitKeys = new Set<string>();

    // Helper: Create empty content item
    const createEmptyContent = (): Phase1PhotoContentItem => ({
      prompts: [],
      lifestyle: [],
      interests: [],
      commonPoints: [],
      slotType: 'identity',
      waveUnits: [],
      waveDensity: 'low',
    });

    // Helper: Apply units to content item (additive — never overwrites)
    const applyUnitsToContent = (content: Phase1PhotoContentItem, unitsToApply: DisplayUnit[]) => {
      for (const unit of unitsToApply) {
        switch (unit.type) {
          case 'bio':
            content.bio = unit.payload.text;
            break;
          case 'prompt':
            content.prompts.push(unit.payload.prompt);
            break;
          case 'basics':
            content.lifestyle = [...content.lifestyle, ...unit.payload.items];
            break;
          case 'interests':
            content.interests = [...content.interests, ...unit.payload.chips];
            break;
          case 'relationship':
            // Relationship intent displayed as interest-style chips, additive
            content.interests = [...content.interests, ...unit.payload.chips];
            break;
          case 'essentials':
            // Essentials displayed as lifestyle-style items, additive
            content.lifestyle = [...content.lifestyle, ...unit.payload.items];
            break;
          case 'education':
          case 'religion':
            // Single lifestyle-style item, additive
            content.lifestyle = [...content.lifestyle, unit.payload.item];
            break;
        }
      }
      content.waveUnits = [...content.waveUnits, ...unitsToApply];
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SMART LINEAR PLANNER (Batch Q):
    //   - Photo 1: identity-only (clean visual first impression).
    //   - Photo 2: prefers bio if available, else next-best primary alone.
    //   - Photo 3+: next-best primary; if not bio, optionally pair with one
    //     small secondary (basics / relationship / education / religion).
    //   - Each unit appears at most once across the full slide stack.
    //   - new_here only when there is truly no displayable content.
    //   - cta appears at most once after content is exhausted.
    //   - Remaining empty photos fall back to identity (no repeat noise).
    // ═══════════════════════════════════════════════════════════════════════
    const hasAnyDisplayableContent = units.length > 0;
    const SMALL_SECONDARY_TYPES = new Set<DisplayUnitType>([
      'basics',
      'relationship',
      'education',
      'religion',
    ]);

    let ctaUsed = false;
    let newHereUsed = false;

    // Helper: pick the next available unit, optionally preferring a key.
    const pickNext = (preferKey?: string): DisplayUnit | undefined => {
      if (preferKey) {
        const preferred = units.find(
          (u) => u.key === preferKey && !usedUnitKeys.has(u.key)
        );
        if (preferred) {
          usedUnitKeys.add(preferred.key);
          return preferred;
        }
      }
      const next = units.find((u) => !usedUnitKeys.has(u.key));
      if (next) usedUnitKeys.add(next.key);
      return next;
    };

    // Helper: pick a small secondary (basics/relationship/education/religion)
    // that isn't the same type as the primary.
    const pickSmallSecondary = (
      primaryType: DisplayUnitType
    ): DisplayUnit | undefined => {
      const next = units.find(
        (u) =>
          !usedUnitKeys.has(u.key) &&
          SMALL_SECONDARY_TYPES.has(u.type) &&
          u.type !== primaryType
      );
      if (next) usedUnitKeys.add(next.key);
      return next;
    };

    // Photo 1: Identity ONLY (clean visual first impression)
    {
      const p1 = createEmptyContent();
      p1.slotType = 'identity';
      p1.waveDensity = 'low';
      contents.push(p1);
    }

    // Photos 2..N: smart linear fill
    for (let i = 1; i < totalPhotos; i++) {
      const content = createEmptyContent();

      // Photo 2 prefers bio (when available); later photos take next-best.
      const primary = i === 1 ? pickNext('bio') : pickNext();

      if (primary) {
        const applied: DisplayUnit[] = [primary];
        // Don't pair anything with bio (Photo 2 stays a clean bio slide).
        // For later photos with non-bio primary, optionally add one small
        // secondary so dense profiles don't waste real estate.
        if (i >= 2 && primary.type !== 'bio') {
          const secondary = pickSmallSecondary(primary.type);
          if (secondary) applied.push(secondary);
        }
        applyUnitsToContent(content, applied);
        content.slotType = 'wave_content';
        content.waveDensity = applied.length >= 2 ? 'medium' : 'low';
      } else if (!hasAnyDisplayableContent && !newHereUsed) {
        // Truly empty profile — surface the new_here nudge once.
        content.slotType = 'soft_fallback';
        content.softFallback = { type: 'new_here' };
        content.waveDensity = 'low';
        newHereUsed = true;
      } else if (!ctaUsed) {
        // Content exhausted — show the CTA once.
        content.slotType = 'soft_fallback';
        content.softFallback = { type: 'cta' };
        content.waveDensity = 'low';
        ctaUsed = true;
      } else {
        // Already showed CTA — fall back to identity to avoid repetition.
        content.slotType = 'identity';
        content.waveDensity = 'low';
      }

      contents.push(content);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LOG_NOISE_FIX: Planner debugging gated behind DEBUG_DISCOVER_PLANNER (default: false)
    if (__DEV__ && DEBUG_DISCOVER_PLANNER) {
      const plan = contents.map((c, idx) => {
        if (c.slotType === 'identity') return `P${idx}:id`;
        if (c.slotType === 'soft_fallback') return `P${idx}:soft(${c.softFallback?.type || 'cta'})`;
        const keys = c.waveUnits.map(u => u.key).join('+') || (c.bio ? 'bio' : '');
        return `P${idx}:${keys || 'empty'}`;
      });
      console.log(`[PLANNER] ${name} ${totalPhotos}p units=${units.length} => ${plan.join(' ')}`);
    }

    return contents;
  }, [
    isPhase2,
    photos?.length,
    bio,
    selectedPrompts,
    phase1Lifestyle,
    activities,
    name,
    relationshipIntent,
    phase1Education,
    phase1Religion,
  ]);

  // NOTE: currentPhotoContent is computed after photoIndex state declaration (see below)

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-2: DATA-AWARE CONTENT QUEUE
  // Builds an ordered list of available content sections, then maps photoIndex
  // to the queue so every photo shows meaningful content (not nothing)
  // ═══════════════════════════════════════════════════════════════════════════

  // Phase-2: Get interests as chip labels (max 4 for card)
  // Dedupe input keys first so duplicate `activities` entries don't yield
  // duplicate chips on screen.
  const phase2Interests = useMemo(() => {
    if (!isPhase2 || !activities || activities.length === 0) return [];
    const uniqueActivities = Array.from(new Set(activities));
    return uniqueActivities
      .map(key => ACTIVITY_FILTERS.find(a => a.value === key))
      .filter(Boolean)
      .slice(0, 4)
      .map(a => ({ emoji: a!.emoji, label: a!.label }));
  }, [isPhase2, activities]);

  // Phase-2: Desire tag chip labels.
  // Dedupe input keys; preserve the order the user selected them.
  // No silent cap here — the card row uses `flexWrap: 'wrap'`, and an
  // overflow guard is applied in the merged Looking-For row below.
  const phase2Desires = useMemo(() => {
    if (!isPhase2 || !desireTagKeys || desireTagKeys.length === 0) return [];
    const uniqueDesireKeys = Array.from(new Set(desireTagKeys));
    return uniqueDesireKeys
      .map(key => PRIVATE_DESIRE_TAGS.find(d => d.key === key))
      .filter(Boolean)
      .map(d => d!.label);
  }, [isPhase2, desireTagKeys]);

  // Phase-2: Looking-For intent chips. Dedupe; preserve selection order.
  // No silent cap — show every selected intent. Overflow is handled by
  // wrap + a single "+N" pill in the render path if the combined
  // intent + desire row exceeds PHASE2_LOOKING_FOR_VISIBLE_CHIPS.
  const phase2IntentChips = useMemo(() => {
    if (!isPhase2 || !privateIntentKeys || privateIntentKeys.length === 0) return [];
    const uniqueIntentKeys = Array.from(new Set(privateIntentKeys));
    return uniqueIntentKeys
      .map((key) => {
        const category = PRIVATE_INTENT_CATEGORIES.find((item) => item.key === key);
        return category ? { key, label: category.label } : null;
      })
      .filter(Boolean) as { key: string; label: string }[];
  }, [isPhase2, privateIntentKeys]);

  // Phase-2: Lifestyle chips (height, smoking, drinking). Each lifestyle
  // dimension is independent — a non-empty value for one MUST NOT hide
  // the others. Labels are conversational per V4 typography pass.
  const phase2Lifestyle = useMemo(() => {
    if (!isPhase2) return [];
    const items: { icon: string; label: string }[] = [];
    if (profileHeight && profileHeight > 0) {
      const heightStr = cmToFeetInches(profileHeight);
      if (heightStr) items.push({ icon: 'resize-outline', label: heightStr });
    }
    if (smoking && smoking !== 'prefer_not_to_say') {
      const smokingLabels: Record<string, string> = {
        never: 'Non-smoker',
        socially: 'Smokes sometimes',
        regularly: 'Smokes regularly',
      };
      if (smokingLabels[smoking]) items.push({ icon: 'flame-outline', label: smokingLabels[smoking] });
    }
    if (drinking && drinking !== 'prefer_not_to_say') {
      const drinkingLabels: Record<string, string> = {
        never: "Doesn't drink",
        socially: 'Drinks sometimes',
        regularly: 'Drinks regularly',
      };
      if (drinkingLabels[drinking]) items.push({ icon: 'wine-outline', label: drinkingLabels[drinking] });
    }
    return items;
  }, [isPhase2, profileHeight, smoking, drinking]);

  // Phase-2: Merged Looking-For chip list (intents first, then desires).
  // Visible cap is only an overflow safety; with 3-4 selections everything
  // shows. If the user selects an unusually large number of tags, the row
  // wraps and a single "+N" pill stands in for the remainder so the card
  // never blows past two lines.
  const PHASE2_LOOKING_FOR_VISIBLE_CHIPS = 8;
  const phase2LookingForChips = useMemo(() => {
    if (!isPhase2) return { visible: [] as Array<
      | { type: 'intent'; key: string; label: string }
      | { type: 'desire'; label: string }
    >, overflow: 0 };
    const merged: Array<
      | { type: 'intent'; key: string; label: string }
      | { type: 'desire'; label: string }
    > = [
      ...phase2IntentChips.map((c) => ({ type: 'intent' as const, key: c.key, label: c.label })),
      ...phase2Desires.map((label) => ({ type: 'desire' as const, label })),
    ];
    if (merged.length <= PHASE2_LOOKING_FOR_VISIBLE_CHIPS) {
      return { visible: merged, overflow: 0 };
    }
    return {
      visible: merged.slice(0, PHASE2_LOOKING_FOR_VISIBLE_CHIPS),
      overflow: merged.length - PHASE2_LOOKING_FOR_VISIBLE_CHIPS,
    };
  }, [isPhase2, phase2IntentChips, phase2Desires]);

  if (__DEV__ && isPhase2) {
    // [P2_LOOKING_FOR_CHIPS] Verifies all selected intent + desire
    // keys are reaching the renderer (cap was previously slice(0,2)).
    console.log('[P2_LOOKING_FOR_CHIPS]', {
      profileId,
      rawIntentKeys: privateIntentKeys ?? [],
      rawDesireTagKeys: desireTagKeys ?? [],
      renderedLabels: [
        ...phase2IntentChips.map((c) => c.label),
        ...phase2Desires,
      ],
    });
    // [P2_LIFESTYLE_CHIPS] Verifies smoking & drinking both render
    // independently when both are set.
    console.log('[P2_LIFESTYLE_CHIPS]', {
      profileId,
      height: profileHeight ?? null,
      smoking: smoking ?? null,
      drinking: drinking ?? null,
      renderedLabels: phase2Lifestyle.map((item) => item.label),
    });
  }

  // State must be declared before useMemo that depends on it
  const [photoIndex, setPhotoIndex] = useState(0);
  // 7-1: Track image load errors to show placeholder on failure
  const [imageError, setImageError] = useState(false);
  const failedPhotoIndexesRef = useRef<Set<number>>(new Set());
  const displayPhotos = useMemo(() => getRenderableProfilePhotos(photos), [photos]);

  // Photo count needed for distribution logic
  const photoCount = displayPhotos.length;

  if (__DEV__) {
    // [PHOTO_DEBUG] P0: verify backendCount === renderCount in ProfileCard
    // (used by Discover & Explore card surfaces). Remove after validation.
    console.log('[PHOTO_DEBUG][profile-card]', {
      backendCount: Array.isArray(photos) ? photos.length : 0,
      renderCount: displayPhotos.length,
    });
  }

  const phase1MetadataRowShouldRender =
    !isPhase2 &&
    photoIndex === 0 &&
    Boolean(isActiveNow || isActiveToday || phase1DistanceLabel || verificationDisplay.label);
  const phase1DistancePillShouldRender =
    !isPhase2 && photoIndex === 0 && Boolean(phase1DistanceLabel);
  const lastPhase1DistanceDebugRef = useRef<string | null>(null);

  useEffect(() => {
    if (!__DEV__ || isPhase2) return;

    const hasRawDistance = typeof distance === 'number' && Number.isFinite(distance);
    const payload = {
      userId: profileId,
      photoIndex,
      hasRawDistance,
      rawDistanceValue: getDistanceDebugValue(distance),
      phase1DistanceLabel,
      verificationLabel: verificationDisplay.label,
      metadataRowShouldRender: phase1MetadataRowShouldRender,
      distancePillShouldRender: phase1DistancePillShouldRender,
    };
    const debugKey = JSON.stringify(payload);
    if (lastPhase1DistanceDebugRef.current === debugKey) return;
    lastPhase1DistanceDebugRef.current = debugKey;
    console.log('[P1_DISTANCE_DEBUG][card]', payload);
  }, [
    distance,
    isPhase2,
    phase1DistanceLabel,
    phase1DistancePillShouldRender,
    phase1MetadataRowShouldRender,
    verificationDisplay.label,
    photoIndex,
    profileId,
  ]);

  // Get content for current photo (consumption-based, no repetition)
  // Note: phase1PhotoContents handles all slot distribution - no separate phase1ContentSlot needed
  const currentPhotoContent = phase1PhotoContents[photoIndex] || {
    prompts: [],
    lifestyle: [],
    interests: [],
    commonPoints: [],
    slotType: 'identity' as Phase1ContentSlot, // Use identity as fallback (clean photo)
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-2: PHOTO-BY-PHOTO CONTENT DISTRIBUTION V3 (COMPOSITE)
  // - Photo 0 is identity-only (presence + distance pill on the right).
  // - Photos 1..N are composite: { primary, secondary }.
  //   * primary = bio (once) | prompt (each used once) | leftover secondary
  //     promoted to primary | fallback.
  //   * secondary = compact chip row picked from a per-photo preference list,
  //     each kind consumed at most once across the deck.
  // - Prompt answers are deduped by promptId, falling back to normalized question.
  // ═══════════════════════════════════════════════════════════════════════════
  type Phase2Prompt = {
    promptId?: string | null;
    question: string;
    answer: string;
    key: string;
    section: Phase2PromptSection;
    sectionLabel: string;
  };

  type Phase2SecondaryKind =
    | 'lifestyle'
    | 'lookingFor'
    | 'interests'
    | 'education'
    | 'religion';

  type Phase2Primary =
    | { kind: 'identity' }
    | { kind: 'bio'; text: string }
    | { kind: 'prompt'; prompt: Phase2Prompt }
    | { kind: 'lifestyle' }
    | { kind: 'lookingFor' }
    | { kind: 'interests' }
    | { kind: 'education' }
    | { kind: 'religion' }
    | { kind: 'fallback'; index: number; total: number };

  type Phase2PlannedPhoto = {
    primary: Phase2Primary;
    secondary: Phase2SecondaryKind | null;
  };

  const phase2UniquePrompts = useMemo<Phase2Prompt[]>(() => {
    if (!isPhase2) return [];

    const rawPrompts =
      Array.isArray(profilePrompts) && profilePrompts.length > 0
        ? profilePrompts
        : profilePrompt
          ? [profilePrompt]
          : [];
    const seen = new Set<string>();
    const normalized: Phase2Prompt[] = [];

    for (const prompt of rawPrompts) {
      const question = typeof prompt?.question === 'string' ? prompt.question.trim() : '';
      const answer = typeof prompt?.answer === 'string' ? prompt.answer.trim() : '';
      if (!question || !answer) continue;

      const promptId =
        typeof prompt.promptId === 'string' && prompt.promptId.trim().length > 0
          ? prompt.promptId.trim()
          : null;
      const normalizedQuestion = question.toLowerCase().replace(/\s+/g, ' ');
      const key = promptId ? `id:${promptId}` : `q:${normalizedQuestion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const section = getPhase2PromptSection(promptId);
      const sectionLabel = PHASE2_PROMPT_SECTION_LABEL[section];
      normalized.push({ promptId, question, answer, key, section, sectionLabel });
    }

    // Stable priority sort: Personality (0) → Values (1) → Quick (2) → Unknown (3).
    // Index-tracking keeps original order intact within each priority bucket.
    const indexed = normalized.map((item, index) => ({ item, index }));
    indexed.sort((a, b) => {
      const pa = PHASE2_PROMPT_PRIORITY[a.item.section];
      const pb = PHASE2_PROMPT_PRIORITY[b.item.section];
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.item);
  }, [isPhase2, profilePrompts, profilePrompt]);

  const phase2EducationItem = useMemo(() => {
    if (!isPhase2) return null;
    if (!education || education === 'prefer_not_to_say') return null;
    const label =
      EDUCATION_OPTIONS.find((option) => option.value === education)?.label ?? education;
    return { icon: 'school-outline', label };
  }, [isPhase2, education]);

  const phase2ReligionItem = useMemo(() => {
    if (!isPhase2) return null;
    if (!religion || religion === 'prefer_not_to_say') return null;
    const label =
      RELIGION_OPTIONS.find((option) => option.value === religion)?.label ?? religion;
    return { icon: 'sparkles-outline', label };
  }, [isPhase2, religion]);

  const hasPhase2LookingFor =
    phase2IntentChips.length > 0 || phase2Desires.length > 0;

  const phase2Plan = useMemo((): Phase2PlannedPhoto[] => {
    if (!isPhase2) return [];

    const total = Math.max(photoCount, 1);
    const photos: Phase2PlannedPhoto[] = [];
    const consumedPromptKeys = new Set<string>();
    const consumedSecondaries = new Set<Phase2SecondaryKind>();
    let bioConsumed = false;
    const bioText = typeof bio === 'string' ? bio.trim() : '';
    const hasBio = bioText.length > 0;

    const isAvailable = (kind: Phase2SecondaryKind): boolean => {
      if (consumedSecondaries.has(kind)) return false;
      switch (kind) {
        case 'lifestyle':
          return phase2Lifestyle.length > 0;
        case 'lookingFor':
          return hasPhase2LookingFor;
        case 'interests':
          return phase2Interests.length > 0;
        case 'education':
          return !!phase2EducationItem;
        case 'religion':
          return !!phase2ReligionItem;
      }
    };

    const consumePrompt = (): Phase2Prompt | null => {
      const next = phase2UniquePrompts.find((p) => !consumedPromptKeys.has(p.key));
      if (!next) return null;
      consumedPromptKeys.add(next.key);
      return next;
    };

    const consumeSecondary = (
      preference: Phase2SecondaryKind[],
    ): Phase2SecondaryKind | null => {
      for (const kind of preference) {
        if (isAvailable(kind)) {
          consumedSecondaries.add(kind);
          return kind;
        }
      }
      return null;
    };

    // Build a primary for the next non-identity photo. Bio is preferred first,
    // then prompts in order, then leftover secondaries promoted to primary, then
    // a neutral fallback pill.
    const buildPrimary = (): Phase2Primary => {
      if (hasBio && !bioConsumed) {
        bioConsumed = true;
        return { kind: 'bio', text: bioText };
      }
      const prompt = consumePrompt();
      if (prompt) return { kind: 'prompt', prompt };
      const promotion = consumeSecondary([
        'lookingFor',
        'interests',
        'lifestyle',
        'education',
        'religion',
      ]);
      if (promotion) return { kind: promotion } as Phase2Primary;
      return { kind: 'fallback', index: photos.length, total };
    };

    // Photo 0: identity only — presence + distance handled in identity layer.
    photos.push({ primary: { kind: 'identity' }, secondary: null });

    // Photo 1: bio (or first prompt) + lifestyle.
    if (total >= 2) {
      photos.push({
        primary: buildPrimary(),
        secondary: consumeSecondary([
          'lifestyle',
          'lookingFor',
          'interests',
          'education',
          'religion',
        ]),
      });
    }

    // Photo 2: prompt + Looking For (intent + desires).
    if (total >= 3) {
      photos.push({
        primary: buildPrimary(),
        secondary: consumeSecondary([
          'lookingFor',
          'interests',
          'lifestyle',
          'education',
          'religion',
        ]),
      });
    }

    // Photo 3: prompt + interests (fallback to education/religion).
    if (total >= 4) {
      photos.push({
        primary: buildPrimary(),
        secondary: consumeSecondary([
          'interests',
          'education',
          'religion',
          'lifestyle',
          'lookingFor',
        ]),
      });
    }

    // Photo 4: prompt + education.
    if (total >= 5) {
      photos.push({
        primary: buildPrimary(),
        secondary: consumeSecondary([
          'education',
          'religion',
          'interests',
          'lifestyle',
          'lookingFor',
        ]),
      });
    }

    // Photo 5: prompt + religion.
    if (total >= 6) {
      photos.push({
        primary: buildPrimary(),
        secondary: consumeSecondary([
          'religion',
          'education',
          'interests',
          'lifestyle',
          'lookingFor',
        ]),
      });
    }

    // Photo 6+: prompt-only photos. If prompts are exhausted, buildPrimary will
    // promote any leftover unused secondary, then fall back to neutral pill.
    while (photos.length < total) {
      photos.push({ primary: buildPrimary(), secondary: null });
    }

    return photos;
  }, [
    isPhase2,
    photoCount,
    bio,
    phase2UniquePrompts,
    phase2Lifestyle,
    phase2Interests,
    hasPhase2LookingFor,
    phase2EducationItem,
    phase2ReligionItem,
  ]);

  const currentPlanned = useMemo((): Phase2PlannedPhoto | null => {
    if (!isPhase2 || phase2Plan.length === 0) return null;
    return (
      phase2Plan[photoIndex] ??
      phase2Plan[phase2Plan.length - 1] ??
      { primary: { kind: 'identity' }, secondary: null }
    );
  }, [isPhase2, phase2Plan, photoIndex]);

  const describePhase2Primary = useCallback((primary: Phase2Primary): string => {
    if (primary.kind === 'bio') return 'bio';
    if (primary.kind === 'prompt') return `prompt:${primary.prompt.key}`;
    if (primary.kind === 'fallback') return `fallback:${primary.index}`;
    return primary.kind;
  }, []);

  const describePhase2Photo = useCallback(
    (photo: Phase2PlannedPhoto): string => {
      const primary = describePhase2Primary(photo.primary);
      const secondary = photo.secondary ?? '∅';
      return `${primary}+${secondary}`;
    },
    [describePhase2Primary],
  );

  const phase2PlanLogKey = useMemo(() => {
    if (!isPhase2) return '';
    return phase2Plan.map(describePhase2Photo).join('|');
  }, [isPhase2, phase2Plan, describePhase2Photo]);
  const lastPhase2PlanLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (!__DEV__ || !DEBUG_P2_UI || !isPhase2 || !phase2PlanLogKey) return;
    if (lastPhase2PlanLogRef.current === phase2PlanLogKey) return;
    lastPhase2PlanLogRef.current = phase2PlanLogKey;

    const promptKeys = phase2Plan.flatMap((photo) =>
      photo.primary.kind === 'prompt' ? [photo.primary.prompt.key] : [],
    );
    const duplicatePromptKeys = promptKeys.filter(
      (key, index) => promptKeys.indexOf(key) !== index,
    );

    console.log('[P2_PLAN_V3]', {
      profile: name,
      idTail: profileId?.slice?.(-6) ?? null,
      photoCount: Math.max(photoCount, 1),
      slots: phase2Plan.map(describePhase2Photo),
    });
    if (duplicatePromptKeys.length > 0) {
      console.warn('[P2_PLAN_V3_DUP_PROMPT]', {
        profile: name,
        idTail: profileId?.slice?.(-6) ?? null,
        duplicatePromptKeys,
      });
    }
  }, [
    describePhase2Photo,
    isPhase2,
    name,
    phase2Plan,
    phase2PlanLogKey,
    photoCount,
    profileId,
  ]);

  const phase2FallbackCopy = useMemo(() => {
    if (currentPlanned?.primary.kind !== 'fallback') return null;
    const idx = currentPlanned.primary.index;
    const total = currentPlanned.primary.total;

    const lines = [
      'Deep Connect • Private profile',
      'Private Mode • More to explore',
      'Deep Connect • Keep swiping',
      'Private profile • Gallery',
    ];
    const line = lines[idx % lines.length] ?? 'Deep Connect • Private profile';
    const progress = total > 1 ? `Slide ${idx + 1}/${total}` : null;
    return { line, progress };
  }, [currentPlanned]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PREMIUM UX: First-render tracking to skip entrance animation on mount
  // This ensures first frame = final UI (no flicker)
  // ═══════════════════════════════════════════════════════════════════════════
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    // Mark first render complete after initial mount
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
    }
  }, []);

  // Track previous photo index for transition direction
  const prevPhotoIndexRef = useRef(photoIndex);
  useEffect(() => {
    prevPhotoIndexRef.current = photoIndex;
  }, [photoIndex]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PREMIUM UX: Tap feedback animations (subtle scale on press)
  // ═══════════════════════════════════════════════════════════════════════════
  const leftTapScale = useSharedValue(1);
  const rightTapScale = useSharedValue(1);

  const leftTapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftTapScale.value }],
    opacity: leftTapScale.value < 1 ? 0.8 : 1,
  }));

  const rightTapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightTapScale.value }],
    opacity: rightTapScale.value < 1 ? 0.8 : 1,
  }));

  const onLeftPressIn = useCallback(() => {
    leftTapScale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  }, [leftTapScale]);

  const onLeftPressOut = useCallback(() => {
    leftTapScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [leftTapScale]);

  const onRightPressIn = useCallback(() => {
    rightTapScale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  }, [rightTapScale]);

  const onRightPressOut = useCallback(() => {
    rightTapScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [rightTapScale]);

  // 3B-2: Clamp photoIndex when photos array changes (prevents out-of-bounds)
  useEffect(() => {
    failedPhotoIndexesRef.current.clear();
    if (photoIndex >= photoCount && photoCount > 0) {
      setPhotoIndex(photoCount - 1);
    } else if (photoCount === 0) {
      setPhotoIndex(0);
    }
  }, [photoCount, photoIndex]);

  // 7-1: Reset error state when photo changes
  useEffect(() => {
    setImageError(false);
  }, [photoIndex]);

  const prefetchedPhotoUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!showCarousel || displayPhotos.length === 0) return;

    const toPrefetch = isPhase2
      ? displayPhotos.slice(0, PHASE2_PREFETCH_COUNT)
      : displayPhotos.slice(photoIndex + 1, photoIndex + 1 + PHASE1_PREFETCH_AHEAD);

    toPrefetch.forEach((photo, index) => {
      if (photo?.url) {
        if (prefetchedPhotoUrlsRef.current.has(photo.url)) {
          return;
        }
        prefetchedPhotoUrlsRef.current.add(photo.url);
        Image.prefetch(photo.url).catch((error) => {
          // P2-005 FIX: Log prefetch failures for debugging (dev only)
          // Image will still load on-demand, but logging helps identify CDN/network issues
          if (__DEV__) {
            console.warn(`[ProfileCard] Prefetch failed for photo ${index}:`, photo.url.slice(0, 60), error?.message || error);
          }
        });
      }
    });
  }, [displayPhotos, isPhase2, photoIndex, showCarousel]);

  // 3B-2: Safe access with clamping
  const safeIndex = Math.min(Math.max(0, photoIndex), Math.max(0, photoCount - 1));
  const currentPhoto = displayPhotos[safeIndex] || displayPhotos[0];
  // P1-009: Use effective* flags so reveal short-circuits the lock-hint overlay too.
  const currentPhotoLocked = isPhase2
    ? (effectivePhotoBlurEnabled === true ? Boolean(effectivePhotoBlurSlots?.[safeIndex]) : effectivePhotoBlurred === true)
    : false;
  const blurHintSheen = useSharedValue(-140);

  useEffect(() => {
    if (!currentPhotoLocked) {
      blurHintSheen.value = -140;
      return;
    }
    blurHintSheen.value = -140;
    blurHintSheen.value = withRepeat(
      withTiming(140, {
        duration: 2400,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );
  }, [blurHintSheen, currentPhotoLocked]);

  const blurHintSheenStyle = useAnimatedStyle(() => ({
    opacity: currentPhotoLocked ? 0.6 : 0,
    transform: [{ translateX: blurHintSheen.value }],
  }));

  const handleImageError = useCallback(() => {
    failedPhotoIndexesRef.current.add(safeIndex);

    if (photoCount > 1) {
      const nextValidIndex = displayPhotos.findIndex((_, index) => !failedPhotoIndexesRef.current.has(index));
      if (nextValidIndex >= 0 && nextValidIndex !== safeIndex) {
        setPhotoIndex(nextValidIndex);
        return;
      }
    }

    setImageError(true);
  }, [displayPhotos, photoCount, safeIndex]);

  // P1-FIX: Retry all photos when all have failed
  const handleRetryPhotos = useCallback(() => {
    failedPhotoIndexesRef.current.clear();
    setImageError(false);
    setPhotoIndex(0);
  }, []);

  const goNextPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setPhotoIndex((i) => {
      const newIndex = i + 1 < photoCount ? i + 1 : i;
      // P0-FIX: Haptic feedback on photo tap
      if (newIndex !== i) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Track photo navigation for user journey replay
        if (isPhase2) {
          trackAction('photo_next', { index: newIndex, name });
        }
      }
      return newIndex;
    });
  }, [photoCount, isPhase2, name]);

  const goPrevPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setPhotoIndex((i) => {
      const newIndex = i > 0 ? i - 1 : i;
      // P0-FIX: Haptic feedback on photo tap
      if (newIndex !== i) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Track photo navigation for user journey replay
        if (isPhase2) {
          trackAction('photo_prev', { index: newIndex, name });
        }
      }
      return newIndex;
    });
  }, [photoCount, isPhase2, name]);

  // P1-FIX: Horizontal swipe gesture for photo navigation
  // Uses directional locking to avoid conflict with card swipe gesture
  const photoSwipeGesture = useMemo(() => {
    if (!showCarousel || photoCount <= 1) {
      // Return a no-op gesture if not in carousel mode or single photo
      return Gesture.Pan().enabled(false);
    }

    return Gesture.Pan()
      // Only activate for clear horizontal movement (20px horizontal before 12px vertical)
      .activeOffsetX([-20, 20])
      .failOffsetY([-12, 12])
      // Minimum distance before gesture activates
      .minDistance(15)
      .onEnd((event) => {
        const { translationX, velocityX } = event;
        // Require meaningful horizontal movement or velocity
        const isValidSwipe = Math.abs(translationX) > 30 || Math.abs(velocityX) > 300;

        if (!isValidSwipe) return;

        if (translationX < -30 || velocityX < -300) {
          // Swipe left = next photo
          runOnJS(goNextPhoto)();
        } else if (translationX > 30 || velocityX > 300) {
          // Swipe right = previous photo
          runOnJS(goPrevPhoto)();
        }
      });
  }, [showCarousel, photoCount, goNextPhoto, goPrevPhoto]);

  // Non-discover mode (explore grid, etc.) — simple card with onPress
  if (!showCarousel && onPress) {
    return (
      <TouchableOpacity style={styles.gridCard} onPress={onPress} activeOpacity={0.8}>
        {/* 7-1: Show placeholder on image error or missing photo */}
        {currentPhoto && !imageError ? (
          <Image
            source={{ uri: currentPhoto.url }}
            style={styles.gridImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            blurRadius={shouldBlurPhoto ? BLUR_RADIUS : undefined}
            onError={handleImageError}
          />
        ) : (
          <View style={[styles.gridImage, styles.gridPlaceholder]}>
            <Ionicons name="image-outline" size={32} color={COLORS.textLight} />
          </View>
        )}
        <View style={styles.gridOverlay}>
          {/* ANON-LOADING-FIX: empty displayName means "not yet known" — show
              a skeleton bar instead of the literal word "Anonymous". */}
          {displayName ? (
            <Text style={styles.gridName} numberOfLines={1}>
              {displayName}{ageLabel ? `, ${ageLabel}` : ''}
            </Text>
          ) : (
            <View
              style={{
                width: 80,
                height: 14,
                borderRadius: 4,
                backgroundColor: TC.border,
              }}
            />
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // --- Discover card mode ---
  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      {/* Photo area fills entire card - wrapped in gesture detector for horizontal swipe */}
      <GestureDetector gesture={photoSwipeGesture}>
      <View style={styles.photoContainer}>
        {/* PERF: Memoized photo stack for instant switching */}
        {/* P1-FIX: Clear distinction between no-photo (profile has none) vs failed-photo (load error) */}
        {displayPhotos.length > 0 && !imageError ? (
          <PhotoStack
            photos={displayPhotos}
            activeIndex={safeIndex}
            photoBlurred={shouldBlurPhoto}
            photoBlurEnabled={isPhase2 ? effectivePhotoBlurEnabled : undefined}
            photoBlurSlots={isPhase2 ? effectivePhotoBlurSlots : undefined}
            onError={handleImageError}
            lookaheadCount={isPhase2 ? PHASE2_ACTIVE_CARD_LOOKAHEAD : PHASE1_ACTIVE_CARD_LOOKAHEAD}
            previousCount={isPhase2 ? PHASE2_ACTIVE_CARD_PREVIOUS : 0}
          />
        ) : displayPhotos.length === 0 ? (
          // STATE 1: No photos uploaded - profile genuinely has no photos
          <View style={[styles.photoPlaceholder, styles.noPhotoPlaceholder, dark && styles.photoPlaceholderDark]}>
            <View style={[styles.placeholderIconContainer, styles.noPhotoIconContainer, dark && styles.placeholderIconContainerDark]}>
              <Ionicons name="person" size={56} color={dark ? 'rgba(255,255,255,0.35)' : TC.textLight} />
            </View>
            <Text style={[styles.placeholderText, dark && styles.placeholderTextDark]}>No photo yet</Text>
            <Text style={[styles.placeholderSubtext, dark && styles.placeholderSubtextDark]}>
              This profile hasn't added photos
            </Text>
          </View>
        ) : (
          // STATE 2: Photos exist but failed to load - network/CDN error
          <View style={[styles.photoPlaceholder, styles.failedPhotoPlaceholder, dark && styles.photoPlaceholderDark]}>
            <View style={[styles.placeholderIconContainer, styles.failedPhotoIconContainer, dark && styles.placeholderIconContainerDark]}>
              <Ionicons name="cloud-offline-outline" size={48} color={dark ? 'rgba(255,255,255,0.4)' : '#9CA3AF'} />
            </View>
            <Text style={[styles.placeholderText, dark && styles.placeholderTextDark, { marginTop: 12 }]}>
              Couldn't load photos
            </Text>
            <Text style={[styles.placeholderSubtext, dark && styles.placeholderSubtextDark]}>
              Check your connection and try again
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetryPhotos}>
              <Ionicons name="refresh-outline" size={16} color={COLORS.white} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Premium gradient overlay - top (elegant, subtle vignette).
            Phase-2 (Deep Connect): lighter + shorter so the photo top stays clean.
            Phase-1 (Batch C polish): softened to read closer to Phase-2. The
            top vignette is a quiet horizon shade, not a heavy block — earlier
            Phase-1 values (0.45 / 0.25) made the top of every photo feel
            "ceilinged", and the height is reduced from 120 → 80 in styles
            below so the gradient no longer runs into the face area. */}
        <LinearGradient
          colors={
            isPhase2
              ? (dark
                  ? ['rgba(0,0,0,0.30)', 'rgba(0,0,0,0.06)', 'transparent']
                  : ['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.04)', 'transparent'])
              : (dark
                  ? ['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.10)', 'transparent']
                  : ['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.05)', 'transparent'])
          }
          locations={[0, 0.5, 1]}
          style={[styles.topGradient, isPhase2 && styles.topGradientPhase2]}
          pointerEvents="none"
        />

        {/* Premium gradient overlay - bottom (smooth, cinematic fade for immersive feel).
            Phase-2 (Deep Connect): shorter + softer so the photo dominates and the dark
            zone only sits behind the lower info area, not across the middle of the photo.
            Phase-1 (post-QA tune): the previous refine pushed the curve too late
            and the cocoa hue (lighter than pure black at any given alpha) made
            the lower info band lose readable support. This pass keeps the
            late-starting Phase-2-style curve but bumps the mid/bottom stops
            and pulls the anchor slightly earlier — moderate shading that
            still photo-prioritizes but reliably anchors the metadata + miles
            pill + wave-content text near the bottom. Hue stays warm cocoa so
            Phase-1's identity does not collapse into Phase-2 dark glass. */}
        <LinearGradient
          colors={
            isPhase2
              ? (dark
                  ? ['transparent', 'rgba(0,0,0,0.20)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.80)']
                  : ['transparent', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.70)'])
              : (dark
                  ? ['transparent', 'rgba(27,14,4,0.20)', 'rgba(27,14,4,0.60)', 'rgba(27,14,4,0.85)']
                  : ['transparent', 'rgba(27,14,4,0.18)', 'rgba(27,14,4,0.58)', 'rgba(27,14,4,0.82)'])
          }
          locations={
            isPhase2
              ? [0, 0.45, 0.80, 1]
              : [0, 0.40, 0.75, 1]
          }
          style={[styles.bottomGradient, isPhase2 && styles.bottomGradientPhase2]}
          pointerEvents="none"
        />

        {/* Tap zones for photo navigation — left third = prev, right third = next */}
        {/* PREMIUM UX: Animated tap feedback with subtle scale */}
        {showCarousel && photoCount > 1 && (
          <>
            <Animated.View style={[styles.tapZoneLeft, leftTapStyle]}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={goPrevPhoto}
                onPressIn={onLeftPressIn}
                onPressOut={onLeftPressOut}
              />
            </Animated.View>
            <Animated.View style={[styles.tapZoneRight, rightTapStyle]}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={goNextPhoto}
                onPressIn={onRightPressIn}
                onPressOut={onRightPressOut}
              />
            </Animated.View>
          </>
        )}

        {/* Photo indicator bars (Tinder-style) at top */}
        {/* 7-2: Optional chaining for photos array null safety */}
        {showCarousel && photoCount > 1 && (
          <View style={[styles.barsRow, dark && styles.barsRowDark]} pointerEvents="none">
            {photos?.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.bar,
                  dark && styles.barDark,
                  i === photoIndex && styles.barActive,
                  i === photoIndex && dark && styles.barActiveDark,
                ]}
              />
            ))}
          </View>
        )}

        {/* Incognito badge (top-right) */}
        {isIncognito && (
          <View style={[styles.incognitoBadge, dark && styles.incognitoBadgeDark]} pointerEvents="none">
            <Ionicons name="eye-off" size={14} color={COLORS.white} />
          </View>
        )}

        {isPhase2 && currentPhotoLocked && (
          <View
            style={[styles.phase2LockedHint, { bottom: arrowButtonBottom + 52 }]}
            pointerEvents="none"
          >
            <Animated.View style={[styles.phase2LockedHintSheen, blurHintSheenStyle]}>
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.24)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View style={styles.phase2LockedHintRow}>
              <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.88)" />
              <Text style={styles.phase2LockedHintTitle}>Unlocks on match</Text>
            </View>
            <Text style={styles.phase2LockedHintSubtitle}>
              Private photos stay blurred until you both connect
            </Text>
          </View>
        )}

      </View>
      </GestureDetector>

      {/* Info overlay at bottom - uses gradient instead of solid bg */}
      {/* PHASE-2: Photo-index-based content reveal system */}
      {/* PREMIUM UX: Fixed gradient, stable identity, smooth content transitions */}
      {isPhase2 && (
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.40)', 'rgba(0,0,0,0.68)']}
          locations={[0, 0.55, 1]}
          style={styles.phase2Scrim}
          pointerEvents="none"
        />
      )}
      {/* Phase-1 Batch D shading-refine: localized warm-cocoa scrim behind
          the lower information area. Previously rendered as a solid View
          (rgba(27,14,4,0.28) over height 32%), which produced a faint but
          visible HARD edge at the top of the scrim where the constant tint
          met the un-tinted photo above. The audit called this out as the
          fade "starting too high". Switched to a LinearGradient that
          mirrors the structural role of `phase2Scrim`: transparent at the
          top, growing to warm cocoa at the bottom, height shrunk
          32% → 28% to match Phase-2 spatial behavior. The result is a
          smooth, edgeless fade — the photo stays clean above the name
          row and the cocoa wash only emerges where it's actually needed
          for glyph readability. Hue stays Phase-1 (rgb(27,14,4)) so the
          identity stays warm/light, not Phase-2 dark glass. */}
      {!isPhase2 && (
        <LinearGradient
          colors={['transparent', 'rgba(27,14,4,0.32)', 'rgba(27,14,4,0.62)']}
          locations={[0, 0.50, 1]}
          style={styles.phase1Scrim}
          pointerEvents="none"
        />
      )}
      {isPhase2 ? (
        // box-none lets the arrow inside the identity row receive taps while
        // text/badge children remain non-interactive (they have no handlers).
        <View style={[styles.overlay, styles.overlayDark, styles.phase2Overlay]} pointerEvents="box-none">
          {/* ═══════════════════════════════════════════════════════════════════════════
              PHASE-2 PARITY: ENHANCED IDENTITY LAYER
              Name + Age + Gender + Badge = always visible (persistent anchor)
              Photo-1 only: Presence status + distance
              ═══════════════════════════════════════════════════════════════════════════ */}
          <View style={styles.phase2IdentitySection} pointerEvents="box-none">
            {/* LAYER A: PERSISTENT IDENTITY (ALL PHOTOS) - Name + Age + Gender + Arrow */}
            <View style={styles.phase2IdentityRow} pointerEvents="box-none">
              <View style={styles.phase2IdentityLeft} pointerEvents="none">
                <Text style={styles.phase2Name} numberOfLines={1}>{name}</Text>
                {ageLabel && <Text style={styles.phase2Age} numberOfLines={1}>{ageLabel}</Text>}
                {/* Gender icon - matches Phase-1 styling */}
                {gender && GENDER_ICONS[gender] && (
                  <View style={[styles.phase2GenderIcon, { backgroundColor: `${GENDER_ICONS[gender].color}30` }]}>
                    <Ionicons
                      name={GENDER_ICONS[gender].icon as any}
                      size={12}
                      color={GENDER_ICONS[gender].color}
                    />
                  </View>
                )}
              </View>
              {/* Arrow button: aligned with the name row on the right edge.
                  hitSlop keeps a comfortable touch target even though the
                  visible button is compact (36x36). */}
              {showCarousel && onOpenProfile && (
                <TouchableOpacity
                  style={styles.phase2ArrowBtn}
                  onPress={onOpenProfile}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Open full profile"
                >
                  <Ionicons name="chevron-up" size={20} color={COLORS.white} />
                </TouchableOpacity>
              )}
            </View>

            {/* LAYER B: PHOTO-1-ONLY METADATA — left: presence, right: distance */}
            {photoIndex === 0 && (
              <View style={styles.phase2MetadataRow}>
                {/* Left: Online / Recently active */}
                <View style={styles.phase2MetadataLeft}>
                  {isActiveNow && (
                    <View style={styles.phase2StatusBadge}>
                      <View style={styles.phase2OnlineDot} />
                      <Text style={styles.phase2StatusText}>Online</Text>
                    </View>
                  )}
                  {isActiveToday && !isActiveNow && (
                    <View style={styles.phase2StatusBadge}>
                      <Text style={styles.phase2StatusText}>Recently active</Text>
                    </View>
                  )}
                  <View style={styles.verificationMetaRow}>
                    <View
                      style={[
                        styles.verificationMetaDot,
                        verificationDisplay.tone === 'verified' && styles.verificationMetaDotVerified,
                        verificationDisplay.tone === 'pending' && styles.verificationMetaDotPending,
                        verificationDisplay.tone === 'unverified' && styles.verificationMetaDotUnverified,
                      ]}
                    />
                    <Text
                      style={[
                        styles.verificationMetaText,
                        styles.phase2VerificationMetaText,
                        verificationDisplay.tone === 'verified' && styles.verificationMetaTextVerified,
                        verificationDisplay.tone === 'pending' && styles.verificationMetaTextPending,
                        verificationDisplay.tone === 'unverified' && styles.verificationMetaTextUnverified,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {verificationDisplay.label}
                    </Text>
                  </View>
                </View>
                {/* Right: distance only (miles) — pushed to the right corner.
                    No city / locality / "Nearby". Renders nothing if hidden. */}
                {phase2DistanceLabel && (
                  <View style={styles.phase2DistancePill}>
                    <Text style={styles.phase2DistanceText}>{phase2DistanceLabel}</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* ═══════════════════════════════════════════════════════════════════════════
              PHASE-2 V3 COMPOSITE REVEAL
              - Photo 0: identity only (handled in identity layer above).
              - Photos 1..N: primary on top + compact secondary chip row below.
              - First render: no animation (prevents flicker).
              - Subsequent: smooth 150ms fade transitions.
              ═══════════════════════════════════════════════════════════════════════════ */}

          {currentPlanned && currentPlanned.primary.kind !== 'identity' && (
            <Animated.View
              key={`p2v3-${photoIndex}-${describePhase2Photo(currentPlanned)}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              {/* PRIMARY: bio | prompt | promoted-secondary | fallback
                  Section labels (BIO / PROMPT / LOOKING FOR / etc.) are kept
                  only as `accessibilityLabel` on the wrapper so screen readers
                  still announce the section, but no visual chrome is rendered
                  — body text floats over the bottom scrim for a premium feel. */}
              {currentPlanned.primary.kind === 'bio' && (
                <View style={styles.phase2PrimaryBlock} accessibilityLabel="Bio">
                  <Text style={styles.phase2BioBody} numberOfLines={2} ellipsizeMode="tail">
                    {currentPlanned.primary.text}
                  </Text>
                </View>
              )}

              {currentPlanned.primary.kind === 'prompt' && (
                <View
                  style={styles.phase2PrimaryBlock}
                  accessibilityLabel={currentPlanned.primary.prompt.sectionLabel}
                >
                  <Text style={styles.phase2PromptQuestionV4} numberOfLines={1}>
                    {currentPlanned.primary.prompt.question}
                  </Text>
                  <Text style={styles.phase2PromptAnswerV4} numberOfLines={2} ellipsizeMode="tail">
                    {currentPlanned.primary.prompt.answer}
                  </Text>
                </View>
              )}

              {currentPlanned.primary.kind === 'lifestyle' &&
                phase2Lifestyle.length > 0 && (
                  <View style={styles.phase2PrimaryBlock} accessibilityLabel="Lifestyle">
                    <View style={styles.phase2ChipsRow}>
                      {phase2Lifestyle.map((item) => (
                        <View key={`pri-life-${item.label}`} style={styles.phase2ChipUnified}>
                          <Ionicons name={item.icon as any} size={11} color="rgba(255,255,255,0.92)" />
                          <Text style={styles.phase2ChipUnifiedText}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

              {currentPlanned.primary.kind === 'lookingFor' && hasPhase2LookingFor && (
                <View style={styles.phase2PrimaryBlock} accessibilityLabel="Looking for">
                  <View style={styles.phase2ChipsRow}>
                    {phase2LookingForChips.visible.map((item) => (
                      <View
                        key={
                          item.type === 'intent'
                            ? `pri-intent-${item.key}`
                            : `pri-desire-${item.label}`
                        }
                        style={styles.phase2ChipUnified}
                      >
                        <Text style={styles.phase2ChipUnifiedText}>
                          {phase2ChipDisplayLabel(item.label)}
                        </Text>
                      </View>
                    ))}
                    {phase2LookingForChips.overflow > 0 && (
                      <View key="pri-lf-overflow" style={styles.phase2ChipUnified}>
                        <Text style={styles.phase2ChipUnifiedText}>
                          +{phase2LookingForChips.overflow}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {currentPlanned.primary.kind === 'interests' &&
                phase2Interests.length > 0 && (
                  <View style={styles.phase2PrimaryBlock} accessibilityLabel="Interests">
                    <View style={styles.phase2ChipsRow}>
                      {phase2Interests.map((item) => (
                        <View key={`pri-int-${item.label}`} style={styles.phase2ChipUnified}>
                          <Text style={styles.phase2ChipUnifiedText}>
                            {item.emoji} {item.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

              {currentPlanned.primary.kind === 'education' && phase2EducationItem && (
                <View style={styles.phase2PrimaryBlock} accessibilityLabel="Education">
                  <View style={styles.phase2ChipsRow}>
                    <View style={styles.phase2ChipUnified}>
                      <Ionicons
                        name={phase2EducationItem.icon as any}
                        size={11}
                        color="rgba(255,255,255,0.92)"
                      />
                      <Text style={styles.phase2ChipUnifiedText}>{phase2EducationItem.label}</Text>
                    </View>
                  </View>
                </View>
              )}

              {currentPlanned.primary.kind === 'religion' && phase2ReligionItem && (
                <View style={styles.phase2PrimaryBlock} accessibilityLabel="Religion">
                  <View style={styles.phase2ChipsRow}>
                    <View style={styles.phase2ChipUnified}>
                      <Ionicons
                        name={phase2ReligionItem.icon as any}
                        size={11}
                        color="rgba(255,255,255,0.92)"
                      />
                      <Text style={styles.phase2ChipUnifiedText}>{phase2ReligionItem.label}</Text>
                    </View>
                  </View>
                </View>
              )}

              {currentPlanned.primary.kind === 'fallback' && (
                <View style={styles.phase2FallbackPill}>
                  <Ionicons name="lock-closed-outline" size={12} color="rgba(255,255,255,0.72)" />
                  <View style={styles.phase2FallbackTextBlock}>
                    <Text style={styles.phase2FallbackText} numberOfLines={1}>
                      {phase2FallbackCopy?.line ?? 'Deep Connect • Private profile'}
                    </Text>
                    {phase2FallbackCopy?.progress ? (
                      <Text style={styles.phase2FallbackSubtext} numberOfLines={1}>
                        {phase2FallbackCopy.progress}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )}

              {/* SECONDARY: compact chip row below primary, one per photo.
                  Visible section labels are removed for a clean premium feel;
                  the dimension is conveyed by the chip content + accessibilityLabel. */}
              {currentPlanned.secondary === 'lifestyle' && phase2Lifestyle.length > 0 && (
                <View style={styles.phase2SecondaryRow} accessibilityLabel="Lifestyle">
                  <View style={styles.phase2ChipsRow}>
                    {phase2Lifestyle.map((item) => (
                      <View key={`sec-life-${item.label}`} style={styles.phase2ChipUnified}>
                        <Ionicons name={item.icon as any} size={11} color="rgba(255,255,255,0.92)" />
                        <Text style={styles.phase2ChipUnifiedText}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {currentPlanned.secondary === 'lookingFor' && hasPhase2LookingFor && (
                <View style={styles.phase2SecondaryRow} accessibilityLabel="Looking for">
                  <View style={styles.phase2ChipsRow}>
                    {phase2LookingForChips.visible.map((item) => (
                      <View
                        key={
                          item.type === 'intent'
                            ? `sec-intent-${item.key}`
                            : `sec-desire-${item.label}`
                        }
                        style={styles.phase2ChipUnified}
                      >
                        <Text style={styles.phase2ChipUnifiedText}>
                          {phase2ChipDisplayLabel(item.label)}
                        </Text>
                      </View>
                    ))}
                    {phase2LookingForChips.overflow > 0 && (
                      <View key="sec-lf-overflow" style={styles.phase2ChipUnified}>
                        <Text style={styles.phase2ChipUnifiedText}>
                          +{phase2LookingForChips.overflow}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {currentPlanned.secondary === 'interests' && phase2Interests.length > 0 && (
                <View style={styles.phase2SecondaryRow} accessibilityLabel="Interests">
                  <View style={styles.phase2ChipsRow}>
                    {phase2Interests.map((item) => (
                      <View key={`sec-int-${item.label}`} style={styles.phase2ChipUnified}>
                        <Text style={styles.phase2ChipUnifiedText}>
                          {item.emoji} {item.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {currentPlanned.secondary === 'education' && phase2EducationItem && (
                <View style={styles.phase2SecondaryRow} accessibilityLabel="Education">
                  <View style={styles.phase2ChipsRow}>
                    <View style={styles.phase2ChipUnified}>
                      <Ionicons
                        name={phase2EducationItem.icon as any}
                        size={11}
                        color="rgba(255,255,255,0.92)"
                      />
                      <Text style={styles.phase2ChipUnifiedText}>{phase2EducationItem.label}</Text>
                    </View>
                  </View>
                </View>
              )}

              {currentPlanned.secondary === 'religion' && phase2ReligionItem && (
                <View style={styles.phase2SecondaryRow} accessibilityLabel="Religion">
                  <View style={styles.phase2ChipsRow}>
                    <View style={styles.phase2ChipUnified}>
                      <Ionicons
                        name={phase2ReligionItem.icon as any}
                        size={11}
                        color="rgba(255,255,255,0.92)"
                      />
                      <Text style={styles.phase2ChipUnifiedText}>{phase2ReligionItem.label}</Text>
                    </View>
                  </View>
                </View>
              )}
            </Animated.View>
          )}
        </View>
      ) : (
        /* PHASE-1: PREMIUM PROGRESSIVE REVEAL OVERLAY
           box-none lets the inline open-profile chevron in the name row
           receive taps while text/badge children remain non-interactive. */
        <View style={[styles.overlay, styles.phase1PremiumOverlay]} pointerEvents="box-none">
          {/* ═══════════════════════════════════════════════════════════════════════════
              IDENTITY LAYER - Split into two parts:
              A) Persistent (ALL photos): name + age + gender icon
              B) Photo-1-only: badge row + distance row
              ═══════════════════════════════════════════════════════════════════════════ */}
          <View style={styles.phase1IdentitySection}>
            {/* Explore category tag - only when present (Photo 1 only) */}
            {exploreTag && photoIndex > 0 && (
              <View style={styles.phase1ExploreTag}>
                <Text style={styles.phase1ExploreTagText}>{exploreTag}</Text>
              </View>
            )}

            {/* ─────────────────────────────────────────────────────────────────────────
                LAYER A: IDENTITY ROW (Name + Age + Gender)
                REQUIREMENT: Visible on ALL photos for consistent identity
                ───────────────────────────────────────────────────────────────────────── */}
            <View style={styles.phase1NameRow} pointerEvents="box-none">
              {/* Left group: name + age + gender + verified + pills.
                  Mirrors Phase-2 identity-row pattern. flexWrap on the
                  inner group preserves the existing pill-wrap behavior. */}
              <View style={styles.phase1NameRowLeft} pointerEvents="none">
                {/* ANON-LOADING-FIX: empty displayName means "not yet known" —
                    show a skeleton bar instead of the literal word "Anonymous". */}
                {displayName ? (
                  <Text style={styles.phase1Name} numberOfLines={1}>
                    {displayName}
                  </Text>
                ) : (
                  <View
                    style={{
                      width: 120,
                      height: 18,
                      borderRadius: 4,
                      backgroundColor: TC.border,
                    }}
                  />
                )}
                {ageLabel && <Text style={styles.phase1Age}>{ageLabel}</Text>}
                {gender && GENDER_ICONS[gender] && (
                  <View style={[styles.phase1GenderIcon, { backgroundColor: `${GENDER_ICONS[gender].color}26` }]}>
                    <Ionicons
                      name={GENDER_ICONS[gender].icon as any}
                      size={12}
                      color={GENDER_ICONS[gender].color}
                    />
                  </View>
                )}
                {matchScore && matchScore >= 60 && photoIndex > 0 && (
                  <View style={styles.matchScorePill}>
                    <Ionicons name="heart" size={10} color="#EC4899" />
                    <Text style={styles.matchScoreText}>{matchScore}%</Text>
                  </View>
                )}
                {theyLikedMe && photoIndex > 0 && (
                  <View style={styles.theyLikedYouPill}>
                    <Ionicons name="heart" size={11} color="#FFFFFF" />
                    <Text style={styles.theyLikedYouText}>Likes You</Text>
                  </View>
                )}
              </View>
              {/* Open-profile chevron: aligned with the name row on the
                  right edge (mirrors Phase-2). hitSlop expands the touch
                  target while keeping the visible button compact (36x36). */}
              {showCarousel && onOpenProfile && (
                <TouchableOpacity
                  style={styles.phase1ArrowBtn}
                  onPress={onOpenProfile}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Open full profile"
                >
                  <Ionicons name="chevron-up" size={20} color={COLORS.white} />
                </TouchableOpacity>
              )}
            </View>

            {/* ─────────────────────────────────────────────────────────────────────────
                LAYER A.1: Phase-1 metadata row (Photo 1 only)
                Mirrors Phase-2 phase2MetadataRow structure: a single compact row
                directly below the name row that carries:
                  - left: status badge (Online / Recently active), if present
                  - right: distance pill in miles, if present
                Gated on photoIndex === 0 so it does not repeat on every photo.
                Renders nothing if neither status nor distance is available so we
                don't leave an empty row eating vertical space.
                Privacy: distance is null whenever backend hides/omits it (the
                pure `formatPhase2DistanceMiles` returns null) — no pill renders.
                ───────────────────────────────────────────────────────────────────────── */}
            {phase1MetadataRowShouldRender && (
              <View style={styles.phase1MetadataRow} pointerEvents="none">
                <View style={styles.phase1MetadataLeft}>
                  {isActiveNow ? (
                    <View style={styles.phase1StatusBadge}>
                      <View style={styles.phase1StatusDot} />
                      <Text style={styles.phase1StatusText}>Online</Text>
                    </View>
                  ) : isActiveToday ? (
                    <View style={styles.phase1StatusBadge}>
                      <Text style={styles.phase1StatusText}>Recently active</Text>
                    </View>
                  ) : null}
                  <View style={styles.verificationMetaRow}>
                    <View
                      style={[
                        styles.verificationMetaDot,
                        verificationDisplay.tone === 'verified' && styles.verificationMetaDotVerified,
                        verificationDisplay.tone === 'pending' && styles.verificationMetaDotPending,
                        verificationDisplay.tone === 'unverified' && styles.verificationMetaDotUnverified,
                      ]}
                    />
                    <Text
                      style={[
                        styles.verificationMetaText,
                        styles.phase1VerificationMetaText,
                        verificationDisplay.tone === 'verified' && styles.verificationMetaTextVerified,
                        verificationDisplay.tone === 'pending' && styles.verificationMetaTextPending,
                        verificationDisplay.tone === 'unverified' && styles.verificationMetaTextUnverified,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {verificationDisplay.label}
                    </Text>
                  </View>
                </View>
                {phase1DistanceLabel && (
                  <View style={styles.phase1DistancePill}>
                    <Text style={styles.phase1DistanceText}>{phase1DistanceLabel}</Text>
                  </View>
                )}
              </View>
            )}

            {photoIndex > 0 && phase1SupplementalTrustBadges.length > 0 && (
              <View style={styles.phase1BadgeRow}>
                {phase1SupplementalTrustBadges.map((badge) => (
                  <View key={badge.key} style={styles.phase1BadgePill}>
                    <Ionicons name={badge.icon as any} size={12} color={badge.color} />
                    <Text style={styles.phase1BadgeText}>{badge.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ─────────────────────────────────────────────────────────────────────────
                LAYER B: Wave distribution handles content below
                Identity, verified tick, presence, and distance are now in LAYER A (all photos)
                ───────────────────────────────────────────────────────────────────────── */}
          </View>

          {/* ═══════════════════════════════════════════════════════════════════════════
              PHASE-1 UX FLOW: PROGRESSIVE ENGAGING REVEAL
              Priority: identity > bestPrompt > bio > intent > secondPrompt > lifestyle > interests
              - Photo 1: identity (always)
              - Photo 2: bestPrompt (personality hook - CRITICAL)
              - Photo 3: intent
              - Photo 4: secondPrompt OR bio
              - Photo 5: lifestyle
              - Photo 6+: reinforcement cycling (no empty slides!)
              ═══════════════════════════════════════════════════════════════════════════ */}

          {/* ═══════════════════════════════════════════════════════════════════════════
              WAVE DISTRIBUTION RENDERING
              Slot types: identity, identity_bio, wave_content
              Each photo shows balanced content without repetition
              BIO RENDER RULE: Bio ONLY renders from currentPhotoContent.bio (never direct bio prop)
              ═══════════════════════════════════════════════════════════════════════════ */}

          {/* LOG_NOISE_FIX: Bio render debugging removed - was extremely noisy */}

          {/* IDENTITY + BIO SLOT — never on Photo 1 (spec) */}
          {photoIndex > 0 && currentPhotoContent.slotType === 'identity_bio' && currentPhotoContent.bio && (
            <Animated.View
              key={`p1-identity-bio-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(180)}
              exiting={FadeOut.duration(150)}
              style={styles.phase1RevealSection}
            >
              <View style={styles.phase1BioCard}>
                <Text style={styles.phase1BioText} numberOfLines={3}>
                  {currentPhotoContent.bio}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* WAVE CONTENT — never on Photo 1 (spec: no bio/prompts on first slide) */}
          {photoIndex > 0 && currentPhotoContent.slotType === 'wave_content' && (
            <Animated.View
              key={`p1-wave-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(180)}
              exiting={FadeOut.duration(150)}
              style={styles.phase1RevealSection}
            >
              {/* Bio unit */}
              {currentPhotoContent.bio && (
                <View style={styles.phase1BioCard}>
                  <Text style={styles.phase1BioText} numberOfLines={3}>
                    {currentPhotoContent.bio}
                  </Text>
                </View>
              )}

              {/* Prompt units (render each prompt in sequence) */}
              {currentPhotoContent.prompts.slice(0, 2).map((prompt, idx) => (
                <View
                  key={`prompt-${idx}-${prompt.id}`}
                  style={[styles.phase1PromptCard, { marginTop: (currentPhotoContent.bio || idx > 0) ? 12 : 0 }]}
                >
                  <Text style={styles.phase1PromptQuestion} numberOfLines={1}>
                    {prompt.shortLabel}
                  </Text>
                  <Text style={styles.phase1PromptAnswer} numberOfLines={2}>
                    {prompt.answer}
                  </Text>
                </View>
              ))}

              {/* Basics/Lifestyle chips */}
              {currentPhotoContent.lifestyle.length > 0 && (
                <View style={[
                  styles.phase1LifestyleRow,
                  { marginTop: (currentPhotoContent.bio || currentPhotoContent.prompts.length > 0) ? 12 : 0 }
                ]}>
                  {currentPhotoContent.lifestyle.map((item) => (
                    // Batch D: lifestyle items now use the Phase-1 unified chip
                    // (same geometry as interests / soft-fallback / Phase-2 chips).
                    // Ionicon shrinks 14 → 11 to sit on the chip's 11px text baseline.
                    <View key={item.key} style={styles.phase1ChipUnified}>
                      <Ionicons name={item.icon as any} size={11} color="rgba(255,255,255,0.85)" />
                      <Text style={styles.phase1ChipUnifiedText}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Interest chips */}
              {currentPhotoContent.interests.length > 0 && (
                <View style={[
                  styles.phase1InterestsRow,
                  { marginTop: (currentPhotoContent.bio || currentPhotoContent.prompts.length > 0 || currentPhotoContent.lifestyle.length > 0) ? 10 : 0 }
                ]}>
                  {currentPhotoContent.interests.map((item) => (
                    // Batch D: interests now use the Phase-1 unified chip.
                    // Emoji + label live in a single Text so the chip width
                    // tracks the natural label length (no extra icon node).
                    <View key={item.key} style={styles.phase1ChipUnified}>
                      <Text style={styles.phase1ChipUnifiedText}>{item.emoji} {item.label}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Fallback if no content (shouldn't happen with wave distribution) */}
              {!currentPhotoContent.bio &&
               currentPhotoContent.prompts.length === 0 &&
               currentPhotoContent.lifestyle.length === 0 &&
               currentPhotoContent.interests.length === 0 && (
                <View style={styles.phase1ViewProfileCue}>
                  <Ionicons name="chevron-up" size={18} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.phase1ViewProfileText}>View full profile</Text>
                </View>
              )}
            </Animated.View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════════
              SOFT FALLBACK SLOT: Compact reinforcement for late photos
              Shows lightweight recap content when unique content is exhausted
              Visually lighter than wave_content to feel like continuity, not repetition
              ═══════════════════════════════════════════════════════════════════════════ */}
          {photoIndex > 0 && currentPhotoContent.slotType === 'soft_fallback' && currentPhotoContent.softFallback && (
            <Animated.View
              key={`p1-softfallback-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(180)}
              exiting={FadeOut.duration(150)}
              style={styles.phase1SoftFallbackSection}
            >
              {/* Prompt snippet - compact single-line */}
              {currentPhotoContent.softFallback.type === 'prompt' && currentPhotoContent.softFallback.promptSnippet && (
                <View style={styles.phase1SoftFallbackCard}>
                  <Text style={styles.phase1SoftFallbackText} numberOfLines={2}>
                    "{currentPhotoContent.softFallback.promptSnippet}"
                  </Text>
                </View>
              )}

              {/* Interest chips - compact 2-3 chips */}
              {currentPhotoContent.softFallback.type === 'interests' && currentPhotoContent.softFallback.interestChips && (
                <View style={styles.phase1SoftFallbackChipsRow}>
                  {currentPhotoContent.softFallback.interestChips.map((chip, idx) => (
                    // Batch D: soft-fallback interest chips collapse onto the
                    // Phase-1 unified chip so the recap row does not visually
                    // diverge from the wave_content interest row above it.
                    <View key={`soft-interest-${idx}`} style={styles.phase1ChipUnified}>
                      <Text style={styles.phase1ChipUnifiedText}>{chip.emoji} {chip.label}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Intent line - single elegant line */}
              {currentPhotoContent.softFallback.type === 'intent' && currentPhotoContent.softFallback.intentLine && (
                <View style={styles.phase1SoftFallbackCard}>
                  <Text style={styles.phase1SoftFallbackIntentText}>
                    {currentPhotoContent.softFallback.intentLine}
                  </Text>
                </View>
              )}

              {/* Bio snippet - first line of bio */}
              {currentPhotoContent.softFallback.type === 'bio' && currentPhotoContent.softFallback.bioSnippet && (
                <View style={styles.phase1SoftFallbackCard}>
                  <Text style={styles.phase1SoftFallbackText} numberOfLines={1}>
                    {currentPhotoContent.softFallback.bioSnippet}
                  </Text>
                </View>
              )}

              {/* P0-FIX: New here message - friendly fallback for sparse profiles */}
              {currentPhotoContent.softFallback.type === 'new_here' && (
                <View style={styles.phase1NewHereCard}>
                  <View style={styles.phase1NewHereIconRow}>
                    <Ionicons name="sparkles" size={16} color="rgba(255,255,255,0.7)" />
                    <Text style={styles.phase1NewHereText}>New here — still building profile</Text>
                  </View>
                  <Text style={styles.phase1NewHereSubtext}>Tap to learn more about {name}</Text>
                </View>
              )}

              {/* CTA - minimal view profile cue (legacy, rarely used now) */}
              {currentPhotoContent.softFallback.type === 'cta' && (
                <View style={styles.phase1ViewProfileCue}>
                  <Ionicons name="chevron-up" size={18} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.phase1ViewProfileText}>View full profile</Text>
                </View>
              )}
            </Animated.View>
          )}

          {/* NOTE: Old slot types (bio, prompt, lifestyle, prompt_lifestyle) replaced by wave_content */}
          {/* NOTE: Photos with slotType='identity' show no overlay content - just the photo */}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // --- Discover card ---
  card: {
    borderRadius: 0,
    overflow: 'hidden' as const,
    backgroundColor: COLORS.backgroundDark,
    flex: 1,
  },
  cardDark: {
    backgroundColor: '#0a0a0a',
  },
  photoContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  // Premium gradient overlays - REDESIGNED for immersive full-photo feel
  // Batch C polish: Phase-1 base height reduced 120 → 80 to match Phase-2's
  // tighter top vignette. Combined with the softened color stops in JSX,
  // this stops the gradient from running into the upper face area on
  // typical 9:16 portrait photos.
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80,
    zIndex: 2,
  },
  // Phase-2 (Deep Connect): top vignette uses the same height as Phase-1
  // post-polish (80). Kept as a no-op modifier so existing JSX class
  // composition remains untouched and we don't have to thread phase logic
  // back into the StyleSheet.
  topGradientPhase2: {
    height: 80,
  },
  // Phase-1 bottom gradient height. History:
  //   - 65% (legacy heavy)    — eats half the photo, harsh
  //   - 50% (Batch C)         — better but still climbs into mid-band
  //   - 40% (Batch D refine)  — too low coverage, lower info band lost support
  //   - 44% (post-QA tune)    — moderate setting that anchors the metadata
  //                              + miles pill + wave content without climbing
  //                              into the photo's middle band; sits between
  //                              Phase-2's 35% and the legacy heavy values.
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '44%',
    zIndex: 2,
  },
  // Phase-2 (Deep Connect): bottom gradient is reduced to 35% so the photo
  // dominates and the dark zone only sits behind the lower info area.
  bottomGradientPhase2: {
    height: '35%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  photoPlaceholderDark: {
    backgroundColor: '#0d0d0d',
  },
  placeholderIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  placeholderIconContainerDark: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  placeholderText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  placeholderTextDark: {
    color: 'rgba(255,255,255,0.3)',
  },
  // P1-FIX: Subtext for placeholder states
  placeholderSubtext: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
    textAlign: 'center',
  },
  placeholderSubtextDark: {
    color: 'rgba(255,255,255,0.25)',
  },
  // P1-FIX: Distinct styling for no-photo state (profile has no photos)
  noPhotoPlaceholder: {
    // Slightly warmer background to indicate "profile state" not error
  },
  noPhotoIconContainer: {
    // Default styling works well - person icon is clear
  },
  // P1-FIX: Distinct styling for failed-photo state (network error)
  failedPhotoPlaceholder: {
    // Slightly different to indicate "error state"
  },
  failedPhotoIconContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)', // Subtle red tint for error
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
  },
  // P1-FIX: Retry button for all-photos-failed state
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  // Tap zones for photo navigation (invisible, overlaid on photo)
  tapZoneLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '33%',
    zIndex: 5,
  },
  tapZoneRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '33%',
    zIndex: 5,
  },
  // Photo progress bars - REDESIGNED: more elegant, minimal
  barsRow: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    gap: 4,
    zIndex: 10,
  },
  barsRowDark: {
    top: 16,
    left: 16,
    right: 16,
  },
  bar: {
    flex: 1,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  barDark: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  barActive: {
    backgroundColor: COLORS.white,
  },
  barActiveDark: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  // Info overlay - REDESIGNED: transparent, relies on gradient for readability
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 12, // Reduced to sit closer to action buttons
    backgroundColor: 'transparent',
    zIndex: 3,
  },
  overlayDark: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  headerRowDark: {
    marginBottom: 10,
  },
  headerContent: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.white,
    marginRight: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  nameDark: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginRight: 8,
  },
  age: {
    fontSize: 24,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.9)',
    marginRight: 8,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  ageDark: {
    fontSize: 26,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.75)',
  },
  verified: {
    fontSize: 18,
    color: COLORS.primary,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  verifiedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadgeDark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#9b59b6',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  exploreTagContainer: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  exploreTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  activeNowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 6,
    gap: 6,
  },
  activeNowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  activeNowText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
  },
  activeNowBadgeDark: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  city: {
    fontSize: 14,
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cityDark: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '400',
  },
  intentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Phase-2 intent chips row (up to 2 + overflow)
  phase2IntentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  // phase2IntentChip moved to bottom with phase2 reveal styles
  phase2IntentChipDark: {
    backgroundColor: 'rgba(155,89,182,0.25)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(155,89,182,0.35)',
  },
  phase2IntentChipOverflow: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  phase2IntentText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase2IntentTextDark: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.2,
  },
  // Phase-1 intent chips row
  intentChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  intentChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  intentChipText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Phase-1 activity chips row
  activityChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  activityChip: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activityChipText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  distance: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  distanceDark: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '400',
  },
  bio: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 20,
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bioDark: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 0,
  },
  // Profile prompt card
  promptCard: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  promptCardDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  promptQuestion: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 3,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  promptQuestionDark: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  promptAnswer: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  promptAnswerDark: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
  },
  // Trust badge compact row (Discover overlay)
  trustBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 4,
  },
  trustBadgeCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  trustBadgeLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },

  // --- Grid card (Explore usage) ---
  gridCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
    margin: 4,
    flex: 1,
    height: 220,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  // 7-1: Placeholder style for failed/missing images
  gridPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  gridOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  gridName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Incognito badge (top-right of photo)
  incognitoBadge: {
    position: 'absolute',
    top: 48, // Below photo indicator bars
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  incognitoBadgeDark: {
    top: 52,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  phase2LockedHint: {
    position: 'absolute',
    left: 16,
    right: 70,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(7, 11, 24, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 14,
  },
  phase2LockedHintSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -60,
    width: 72,
  },
  phase2LockedHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phase2LockedHintTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 0.2,
  },
  phase2LockedHintSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.62)',
    lineHeight: 15,
    marginTop: 4,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-2: Premium photo-index-based overlay styles
  // ═══════════════════════════════════════════════════════════════════════════
  phase2Overlay: {
    // Compressed padding: photo-first feel, info hugs the bottom edge.
    paddingHorizontal: 18,
    paddingBottom: 10,
    paddingTop: 8,
  },
  phase2IdentityRow: {
    // Row hosts: [name+age+gender+verified group] + [arrow button on the right].
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  // Left side of the identity row — text/badges flexShrink to make room
  // for the arrow button without overflowing on narrow devices.
  phase2IdentityLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  phase2Name: {
    fontSize: 25,
    fontWeight: '700',
    color: COLORS.white,
    marginRight: 8,
    letterSpacing: -0.4,
    flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  phase2Age: {
    fontSize: 21,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.75)',
    marginRight: 8,
  },
  // Compact arrow that sits on the right edge of the name row in Phase-2.
  // Visible button is 36x36; hitSlop on the JSX expands the touch target.
  phase2ArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  // PHASE2_PARITY: Identity section wrapper
  phase2IdentitySection: {
    marginBottom: 4,
  },
  // PHASE2_PARITY: Gender icon (matches Phase-1)
  phase2GenderIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginRight: 4,
  },
  // PHASE2_PARITY: Metadata row — left = presence badges, right = distance pill
  phase2MetadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  // Left half of the metadata row holds the Online / Recently active badges
  // and preserves their original 8px inter-badge gap.
  phase2MetadataLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  // Right-corner distance pill. `marginLeft: 'auto'` pushes it to the right
  // edge even if the left group is empty (e.g. user is offline and not
  // recently active). Slightly bigger horizontal padding + a touch more
  // backdrop opacity so the bumped text reads cleanly without the pill
  // feeling crowded.
  phase2DistancePill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // +2px over the previous 11px so the label is glanceable, but kept at
  // weight 500 (not bold) to stay premium-secondary, not shouty.
  phase2DistanceText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    letterSpacing: 0.2,
  },
  // PHASE2_PARITY: Status badge (Online/recently active)
  phase2StatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  // PHASE2_PARITY: Online dot (green indicator)
  phase2OnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  // PHASE2_PARITY: Status text
  phase2StatusText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  // Wrapper for verification status: small colored dot + textual label.
  // Lives next to the Online/Recently active chip in the metadata row.
  verificationMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  verificationMetaDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  verificationMetaDotVerified: {
    backgroundColor: '#34D399',
  },
  verificationMetaDotPending: {
    backgroundColor: '#FBBF24',
  },
  verificationMetaDotUnverified: {
    backgroundColor: '#F87171',
  },
  verificationMetaText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 128,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  phase2VerificationMetaText: {
    color: 'rgba(255,255,255,0.72)',
  },
  phase1VerificationMetaText: {
    color: 'rgba(255,255,255,0.78)',
  },
  // Premium tone-driven colors for verification status. Slightly lighter
  // tones than the opened-profile palette so the labels stay readable
  // against the darker photo scrims used on swipe cards (Phase-1 cocoa
  // gradient + Phase-2 dark glass).
  //   Verified: soft mint green (#34D399)
  //   Pending:  warm amber (#FBBF24)
  //   Not verified: muted red (#F87171)
  verificationMetaTextVerified: {
    color: '#34D399',
  },
  verificationMetaTextPending: {
    color: '#FBBF24',
  },
  verificationMetaTextUnverified: {
    color: '#F87171',
  },
  // PHASE2_PARITY: City badge
  phase2CityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // PHASE2_PARITY: City text
  phase2CityText: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.6)',
  },
  phase2IntentMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  phase2IntentMetaChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  phase2IntentMetaText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.86)',
    letterSpacing: 0.18,
  },
  phase2RevealSection: {
    marginTop: 4,
  },
  // Photo 1: Intent chip
  phase2IntentChip: {
    backgroundColor: 'rgba(155,89,182,0.25)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(155,89,182,0.35)',
  },
  phase2IntentChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.2,
  },
  // Photo 3 & 5: Chips row (interests, lifestyle) — tighter for premium density
  phase2ChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  // V3 composite: secondary chip row sits below the primary block
  phase2SecondaryRow: {
    marginTop: 6,
  },
  phase2InterestChip: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  phase2InterestText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
  },
  phase2DesireChip: {
    backgroundColor: 'rgba(236,72,153,0.12)', // Subtle rose tint - secondary info
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(236,72,153,0.2)',
  },
  phase2DesireText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  phase2LifestyleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  phase2LifestyleText: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.75)',
  },
  // V4 PREMIUM TYPOGRAPHY — text-on-gradient, no heavy boxes
  // Uppercase section label (kept in styles for any legacy references but
  // no longer rendered visually in primary/secondary blocks — section context
  // is conveyed via accessibilityLabel on the wrapper).
  phase2SectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  // Wrapper for primary text (bio / prompt) — no background, no border.
  phase2PrimaryBlock: {
    paddingVertical: 2,
  },
  // Bio body — premium compact size (was 16/22).
  phase2BioBody: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.96)',
    lineHeight: 19,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Prompt question — sentence case, low-weight context line (was 13/18).
  phase2PromptQuestionV4: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.70)',
    lineHeight: 16,
    marginBottom: 3,
    letterSpacing: 0.1,
  },
  // Prompt answer — premium hero line (was 17/23 weight 500).
  phase2PromptAnswerV4: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.97)',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Unified chip palette — compact premium pill (was 12/6 with 1px border).
  phase2ChipUnified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  phase2ChipUnifiedText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 0.1,
  },
  // Bottom gradient scrim — sits behind the entire phase-2 overlay for legibility.
  // Reduced from 55% → 28%: the scrim now only sits behind the lower info area,
  // not across the middle of the photo.
  phase2Scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '28%',
    zIndex: 2,
  },
  // Phase-1 scrim height. History:
  //   - 32% solid (Batch C)        — visible hard top edge
  //   - 28% gradient (Batch D)     — edgeless but too low coverage; under
  //                                   bright photos the metadata pill and
  //                                   miles pill lost contrast
  //   - 32% gradient (post-QA tune) — restores comfort margin for the lower
  //                                   info band while keeping the gradient's
  //                                   transparent top edge so there is no
  //                                   detectable seam. JSX gradient stops
  //                                   carry the cocoa hue (rgb(27,14,4)),
  //                                   so Phase-1 keeps its warm identity
  //                                   rather than copying Phase-2 pure-black.
  phase1Scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '32%',
    zIndex: 2,
  },
  // Legacy V3 styles kept so any incidental reference still resolves.
  phase2PromptCard: {
    paddingVertical: 2,
  },
  phase2PromptQuestion: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 4,
  },
  phase2PromptAnswer: {
    fontSize: 17,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.97)',
    lineHeight: 23,
  },
  phase2BioCard: {
    paddingVertical: 2,
  },
  phase2BioText: {
    fontSize: 16,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.96)',
    lineHeight: 22,
  },

  // Phase-2 fallback (late photos after unique content exhausts)
  phase2FallbackPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignSelf: 'flex-start',
  },
  phase2FallbackTextBlock: {
    flexDirection: 'column',
    gap: 2,
  },
  phase2FallbackText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.2,
    maxWidth: 220,
  },
  phase2FallbackSubtext: {
    fontSize: 10,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.2,
    maxWidth: 220,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1: PREMIUM IMMERSIVE OVERLAY STYLES
  // Full-photo experience with elegant text hierarchy - no boxed elements
  // ═══════════════════════════════════════════════════════════════════════════
  phase1PremiumOverlay: {
    paddingHorizontal: 18,
    paddingBottom: 14, // Reduced to integrate with button area
    paddingTop: 20,
  },
  phase1IdentitySection: {
    marginBottom: 6,
  },
  // Active Now badge (legacy - kept for compatibility)
  phase1ActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 6,
    gap: 5,
  },
  phase1ActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  phase1ActiveText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },
  // Explore tag - subtle, elegant
  phase1ExploreTag: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  phase1ExploreTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Name + Age row - Premium typography, larger and bolder
  phase1NameRow: {
    // Outer row: 2-column layout (text-group | chevron). Mirrors the
    // Phase-2 `phase2IdentityRow` pattern. flexWrap is intentionally
    // moved to the inner left group so the chevron stays pinned right.
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  phase1NameRowLeft: {
    // Inner left group: name + age + gender + verified + pills.
    // Keeps the original baseline alignment + wrap behaviour for pills,
    // while flexShrink/flexGrow allow it to share the row with the
    // fixed-size chevron without crowding long names.
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  // Compact open-profile chevron pinned to the right of the name row.
  // 36x36 visible button + hitSlop matches the Phase-2 pattern. Sits on
  // top of the photo so a translucent black surface keeps it readable
  // against light or dark photos.
  phase1ArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  phase1Name: {
    fontSize: 30,
    fontWeight: '700',
    color: COLORS.white,
    marginRight: 8,
    flexShrink: 1,
    letterSpacing: -0.4,
    // Premium foundation: softer/richer photo-readability scrim driven by
    // the Phase-1 token (light/shaded premium theme).
    textShadowColor: PHASE1_DISCOVER_THEME.scrimText,
    textShadowOffset: { width: 0, height: 2 },
    // Batch C polish: 12 → 6. The previous radius produced a wide black
    // halo around glyphs that read as cheap on a light/premium photo.
    textShadowRadius: 6,
  },
  phase1Age: {
    fontSize: 24,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.95)',
    marginRight: 8,
    letterSpacing: -0.4,
    textShadowColor: PHASE1_DISCOVER_THEME.scrimText,
    textShadowOffset: { width: 0, height: 2 },
    // Batch C polish: 12 → 6. The previous radius produced a wide black
    // halo around glyphs that read as cheap on a light/premium photo.
    textShadowRadius: 6,
  },
  // Phase-1 metadata row — sits directly below the name row, mirrors the
  // structural role of Phase-2's `phase2MetadataRow`. Hosts the unified
  // status badge (left) and the distance pill (right). `space-between`
  // keeps the distance pill anchored to the right edge regardless of
  // whether status is present. Kept transparent so it inherits the photo
  // scrim instead of fighting it with its own background.
  phase1MetadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  // Left half of the metadata row holds the Online / Recently active badge.
  // Mirrors Phase-2's `phase2MetadataLeft` structure so the two phases share
  // the same row geometry.
  phase1MetadataLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  // Single neutral premium chip used for both Online and Recently active.
  // Replaces the previous loud green-tinted pill + separate muted pill —
  // one consistent surface, the only difference is the optional green dot.
  phase1StatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Tiny green dot, only rendered for the "Online" variant. Matches the
  // Phase-2 status dot colour (#4ade80) so the two phases read identically.
  phase1StatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  // 11/500 neutral white at 0.85 opacity — same scale as Phase-2's
  // `phase2StatusText`. Drops the bold green tone of the previous design.
  phase1StatusText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  // Right-corner distance pill (miles). Mirrors Phase-2's
  // `phase2DistancePill` geometry. Phase-1 sits in a lighter shading
  // environment than Phase-2 (warm cocoa scrim instead of dark glass),
  // so the pill needs slightly more standalone contrast to remain
  // glanceable on bright photo zones near the metadata row:
  //   - backgroundColor 0.36 → 0.48 (still subtle, not a black slab)
  //   - hairline border rgba(255,255,255,0.14) gives the pill a defined
  //     edge against any photo without darkening it further
  //   - 1px shadow at 0.45 opacity anchors the glyphs over light photos
  // `marginLeft: 'auto'` is a defensive nudge — `space-between` on the
  // parent already anchors the pill to the right edge, but the explicit
  // auto-margin keeps placement correct even on rare frames where the
  // left container collapses to zero width.
  phase1DistancePill: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // 13/500 with a touch of letter spacing — same scale as Phase-2's
  // `phase2DistanceText`, glanceable against the photo scrim. Soft
  // text shadow added so the label stays legible on the rare bright
  // photos that defeat the pill backdrop.
  phase1DistanceText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.97)',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // GROWTH: Match score pill - subtle compatibility indicator
  matchScorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(236, 72, 153, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 8,
    gap: 3,
  },
  matchScoreText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F472B6',
  },
  // GROWTH: "They Liked You" pill - prominent inbound interest
  theyLikedYouPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EC4899',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
    gap: 4,
    // Subtle glow effect
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  theyLikedYouText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  // Gender icon badge - subtle, integrated
  phase1GenderIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  // Premium Badge Row - Minimal, elegant pills
  phase1BadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  phase1BadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.24)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  phase1BadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Compact Preview - Photo 1 personality snapshot
  phase1CompactPreview: {
    marginTop: 8,
    gap: 6,
  },
  // NOTE: phase1CompactBioText is defined below (line ~3195) to avoid duplication
  phase1CompactLookingFor: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  phase1CompactInterests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  phase1CompactInterestChip: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  phase1CompactInterestText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Legacy location row (for fallback)
  phase1LocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phase1LocationText: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.7)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Common points row (Photo 1 hook) - LEGACY, not used in new design
  phase1CommonPointsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  phase1CommonPointChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  phase1CommonPointText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Common points row - ⭐ format for shared interests/intent
  phase1CommonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  phase1CommonText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Content reveal section - tighter spacing for immersive feel
  phase1RevealSection: {
    marginTop: 14,
  },
  // Intent display - NO box, just elegant inline text with icon
  phase1IntentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    // NO background, NO border - text only
  },
  phase1IntentText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Common Points Card - REDESIGNED as elegant list, no box
  phase1CommonPointsCard: {
    // NO background, NO border - pure text hierarchy
  },
  phase1CommonPointsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1CommonPointsList: {
    gap: 8,
  },
  phase1CommonPointItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phase1CommonPointItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Bio section - REDESIGNED: elegant text, no box
  phase1BioCard: {
    // NO background, NO border - pure typography
    maxHeight: 90,
    paddingRight: 12,
  },
  phase1BioText: {
    // Batch D polish: compact bio typography mirroring Phase-2 phase2BioBody
    // geometry (14 / 400 / lineHeight 19) so that bio paragraphs settle in
    // the photo overlay instead of dominating it. Italic was dropped because
    // it added a literary tone the rest of the overlay does not carry, and
    // because at 14px italic glyphs antialiased poorly over photos. Shadow
    // values are inherited from Batch C (0.55 / 3) — already balanced with
    // the `phase1Scrim` view behind the text and intentionally not touched.
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 19,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Phase-1 Unified Chip System (Batch D)
  //
  // Single chip geometry shared across Phase-1 photo-overlay surfaces
  // (lifestyle, interests, soft-fallback interests). Mirrors Phase-2's
  // phase2ChipUnified geometry — paddingX 10 / paddingY 4 / radius 11 /
  // text 11 / 600 / letterSpacing 0.1 — so the two phases feel like one
  // design language. The visual identity stays Phase-1 (light/shaded
  // overlay) instead of Phase-2's dark glass: a soft white tint
  // rgba(255,255,255,0.14) with a hairline border rgba(255,255,255,0.10)
  // so chips read as raised-from-photo rather than flat black wells.
  //
  // Replaces the previous fragmented chip families (phase1LifestyleChip,
  // phase1InterestChip, phase1SoftFallbackChip and their dead Small /
  // Compact variants). Old families had three different paddings, three
  // different radii, three different font sizes, and three different
  // shadow strengths — which is why interests were reading as heavier
  // pills than lifestyle items even though they sat in the same overlay.
  // ─────────────────────────────────────────────────────────────────────────
  phase1ChipUnified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  phase1ChipUnifiedText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Lifestyle row - holds unified chips, gap matches Phase-2 phase2ChipsRow.
  phase1LifestyleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  // Compact bio for 2-photo profiles - REDESIGNED: no box
  phase1CompactBio: {
    // NO background, NO border
    maxHeight: 50,
  },
  phase1CompactBioText: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 18,
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Small intent for compact view - NO box
  phase1IntentCardSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    // NO background, NO border
  },
  phase1IntentTextSmall: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT MODE STYLES (≤4 photos) - Natural, flowing, human feel
  // ═══════════════════════════════════════════════════════════════════════════

  // Bio + Intent flowing content (no boxes, natural text)
  phase1FlowingContent: {
    // Natural text flow, no visual separation
  },
  phase1FlowingBio: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  phase1FlowingIntent: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Unified attributes row (max 2+2 items)
  phase1AttributesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  phase1AttributeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 5,
  },
  phase1AttributeText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Subtle highlights - minimal, inline text
  phase1HighlightsRowSubtle: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  phase1HighlightTextSubtle: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,235,180,0.85)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Legacy compact styles (kept for backward compatibility)
  phase1IntentCardCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  phase1IntentTextCompact: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1HighlightsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  phase1HighlightChip: {
    backgroundColor: 'rgba(255,215,0,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  phase1HighlightText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,235,150,0.95)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Empty slot - REDESIGNED: minimal, no dashed border
  phase1EmptySlot: {
    paddingVertical: 8,
  },
  phase1EmptyText: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.35)',
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Interests row - holds unified chips, gap matches Phase-2 phase2ChipsRow.
  phase1InterestsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    maxHeight: 70,
    overflow: 'hidden',
  },
  // Prompt section - REDESIGNED: elegant typography, no box
  phase1PromptCard: {
    // NO background, NO border - pure text hierarchy
    maxHeight: 90,
    paddingRight: 12,
  },
  phase1PromptQuestion: {
    // Batch D polish: prompt-question label settles into the same role its
    // Phase-2 counterpart (phase2PromptQuestionV4) plays — a quiet eyebrow
    // that introduces the answer rather than shouting at it. Previous values
    // (10 / 700 / uppercase / letterSpacing 1 / opacity 0.55) read as a
    // small-caps marketing tag and competed with the answer below it. New
    // values widen to 12px regular-weight (500), drop uppercase, lift the
    // opacity to 0.70 so the question is legible without dominating, and
    // tighten marginBottom so the question/answer pair feels like one unit.
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.70)',
    lineHeight: 16,
    marginBottom: 3,
    letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1PromptAnswer: {
    // Batch D polish: prompt answer mirrors phase2PromptAnswerV4 (15 / 600 /
    // lineHeight 20). Bumping weight 500 → 600 gives the answer a clear
    // hierarchical edge over the new lighter question label, while the
    // tighter lineHeight (21 → 20) keeps two-line answers visually compact.
    // Shadow values inherited from Batch C (0.55 / 3) and intentionally
    // unchanged.
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.97)',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // SOFT FALLBACK STYLES: Compact reinforcement for late photos
  // Visually lighter than wave_content - feels like continuity, not repetition
  // ═══════════════════════════════════════════════════════════════════════════
  phase1SoftFallbackSection: {
    marginTop: 12,
  },
  phase1SoftFallbackCard: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(255,255,255,0.15)',
  },
  phase1SoftFallbackText: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.75)',
    fontStyle: 'italic',
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1SoftFallbackIntentText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1SoftFallbackChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  // P0-FIX: New here card - friendly fallback for sparse profiles
  phase1NewHereCard: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,255,255,0.2)',
  },
  phase1NewHereIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  phase1NewHereText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  phase1NewHereSubtext: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginLeft: 24, // Align with text above
  },
  // View profile cue - REDESIGNED: subtle, minimal
  phase1ViewProfileCue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    // NO background - just subtle text
  },
  phase1ViewProfileText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
