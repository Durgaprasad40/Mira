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
import {
  DEBUG_PHOTO_RENDER,
  DEBUG_DISCOVER_PLANNER,
  DEBUG_CARD_PRESENCE,
  DEBUG_CONTENT_RENDER,
  DEBUG_P2_UI,
} from '@/lib/debugFlags';
import type { PresenceStatus } from '@/hooks/usePresence';

import { COLORS, INCOGNITO_COLORS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import type { TrustBadge } from '@/lib/trustBadges';
import { PRIVATE_INTENT_CATEGORIES, PRIVATE_DESIRE_TAGS } from '@/lib/privateConstants';
import { MatchSignalBadge } from './MatchSignalBadge';

const PHASE1_ACTIVE_CARD_LOOKAHEAD = 2;
const PHASE2_ACTIVE_CARD_LOOKAHEAD = 4;
const PHASE2_ACTIVE_CARD_PREVIOUS = 2;
const PHASE1_PREFETCH_AHEAD = 2;
const PHASE2_PREFETCH_COUNT = 8;

// Gender labels for "Looking for" display
const GENDER_LABELS: Record<string, string> = {
  male: 'Men',
  female: 'Women',
  non_binary: 'Non-binary',
  lesbian: 'Women',
  other: 'Everyone',
};

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
  distance?: number;
  photos: { url: string }[];
  /** First profile prompt to display on discover card */
  profilePrompt?: { question: string; answer: string };
  /** All profile prompts for Phase-2 photo-index reveal */
  profilePrompts?: { question: string; answer: string }[];
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
  city,
  isVerified,
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
  const displayName = useMemo(() => {
    return name || 'Anonymous';
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
  const phase2AreaLabel = isPhase2 && city ? 'Nearby area' : null;
  const phase2DistanceLabel = useMemo(() => {
    if (!isPhase2 || distance === undefined || distance < 0) return null;
    if (distance < 5) return 'Nearby';
    if (distance < 25) return 'In your city';
    if (distance < 80) return 'Same region';
    return 'Far away';
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
  type DisplayUnitType = 'bio' | 'prompt' | 'basics' | 'interests' | 'essentials' | 'relationship';

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

    // Unit 1: Bio (priority 1, weight based on length)
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

    // Unit 2: Prompt 1 (priority 2)
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

    // Unit 4: Prompt 2 (priority 4)
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

    // Unit 6+: Prompt 3+ omitted — max 2 prompts total (spec)

    // Unit 7: Relationship Intent (priority 7)
    // Display what user is looking for to help swipe decisions
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

    // Unit 8: Interests Part 2 (second chunk of 3, if available)
    if (interestChunks.length > 1) {
      units.push({
        key: 'interests_part2',
        type: 'interests',
        priority: priority++,
        payload: { chips: interestChunks[1] },
        weight: 1,
      });
    }

    // Unit 9: Prompt 4 omitted — max 2 prompts total (spec)

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

    // Unit 11: Prompt 5 omitted — max 2 prompts total (spec)

    // ═══════════════════════════════════════════════════════════════════════
    // STRICT UNIQUE-CONTENT PLANNER: NO cycling, NO repetition
    // Each unit used AT MOST ONCE. Later photos fall back to identity-only.
    // CORE RULE: Never repeat bio, prompts, interests, lifestyle, etc.
    // ═══════════════════════════════════════════════════════════════════════
    const usedUnitKeys = new Set<string>();

    // Helper: Get next N unused units (STRICT - NO cycling)
    // When unique content exhausts, returns empty array (identity-only fallback)
    const getNextUnits = (count: number): DisplayUnit[] => {
      const result: DisplayUnit[] = [];
      let totalWeight = 0;

      for (const unit of units) {
        if (usedUnitKeys.has(unit.key)) continue;
        if (result.length >= count) break;
        // Don't exceed weight of 3 per photo
        if (totalWeight + unit.weight > 3 && result.length > 0) break;
        result.push(unit);
        totalWeight += unit.weight;
        usedUnitKeys.add(unit.key);
      }

      // NO CYCLING - return only unique content
      // Empty result means this photo will show identity-only
      return result;
    };

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

    // Helper: Apply units to content item
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
            content.lifestyle = unit.payload.items;
            break;
          case 'interests':
            content.interests = unit.payload.chips;
            break;
          case 'relationship':
            // Relationship intent displayed as interest-style chips
            // Merge with existing interests if any
            content.interests = [...content.interests, ...unit.payload.chips];
            break;
          case 'essentials':
            // Essentials displayed as lifestyle-style items
            content.lifestyle = [...content.lifestyle, ...unit.payload.items];
            break;
        }
      }
      content.waveUnits = unitsToApply;
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SOFT FALLBACK: one variant per late slide (no duplicate interests/intent/bio across photos)
    // Prompts excluded here (wave handles prompts; max 2 total)
    // ═══════════════════════════════════════════════════════════════════════
    const usedSoftFallbackKinds = new Set<string>();
    const nextSoftFallback = (): Phase1PhotoContentItem['softFallback'] | undefined => {
      if (activities && activities.length > 0 && !usedSoftFallbackKinds.has('interests')) {
        usedSoftFallbackKinds.add('interests');
        const topChips = activities.slice(0, 3).map(key => {
          const activity = ACTIVITY_FILTERS.find(a => a.value === key);
          return activity ? { emoji: activity.emoji, label: activity.label } : null;
        }).filter(Boolean) as { emoji: string; label: string }[];
        if (topChips.length > 0) {
          return { type: 'interests', interestChips: topChips };
        }
      }

      if (relationshipIntent && relationshipIntent.length > 0 && !usedSoftFallbackKinds.has('intent')) {
        usedSoftFallbackKinds.add('intent');
        const intentMap: Record<string, string> = {
          serious_vibes: 'Looking for something real',
          keep_it_casual: 'Keeping it casual',
          exploring_vibes: 'Exploring connections',
          see_where_it_goes: 'See where it goes',
          open_to_vibes: 'Open to anything',
          just_friends: 'Looking for friends',
          open_to_anything: 'Open to all vibes',
          single_parent: 'Single parent life',
          new_to_dating: 'New to dating',
        };
        const intentLine = intentMap[relationshipIntent[0]] || null;
        if (intentLine) {
          return { type: 'intent', intentLine };
        }
      }

      if (hasBio && bio && !usedSoftFallbackKinds.has('bio')) {
        usedSoftFallbackKinds.add('bio');
        const firstLine = bio.split(/[.\n]/)[0].trim();
        const snippet = firstLine.length > 50 ? firstLine.slice(0, 47) + '...' : firstLine;
        if (snippet.length > 10) {
          return { type: 'bio', bioSnippet: snippet };
        }
      }

      if (!usedSoftFallbackKinds.has('new_here')) {
        usedSoftFallbackKinds.add('new_here');
        return { type: 'new_here' };
      }

      return { type: 'cta' };
    };

    // ═══════════════════════════════════════════════════════════════════════
    // DISTRIBUTION RULES BY PHOTO COUNT
    // ═══════════════════════════════════════════════════════════════════════

    if (totalPhotos === 1) {
      // Single slide = Photo 1 spec: identity overlay only (name/age/gender/presence/distance in chrome)
      const content = createEmptyContent();
      content.slotType = 'identity';
      content.waveDensity = 'low';
      contents.push(content);

    } else if (totalPhotos === 2) {
      // ─────────────────────────────────────────────────────────────────────
      // 2 PHOTOS: P1 = identity only, P2 = bio + prompt/basics
      // UX FIX: Clean first impression - no text overload on Photo 1
      // ─────────────────────────────────────────────────────────────────────
      // Photo 1: Identity ONLY (clean visual first impression)
      const p1 = createEmptyContent();
      p1.slotType = 'identity';
      p1.waveDensity = 'low';
      contents.push(p1);

      // Photo 2: Bio + remaining units (prompt + basics) - with soft fallback for sparse profiles
      const p2 = createEmptyContent();
      if (hasBio) {
        const bioUnit = units.find(u => u.key === 'bio');
        if (bioUnit) {
          p2.bio = bioUnit.payload.text;
          p2.waveUnits = [bioUnit];
          usedUnitKeys.add('bio');
        }
      }
      const p2Units = getNextUnits(2);
      applyUnitsToContent(p2, p2Units);

      if (hasBio || p2Units.length > 0) {
        p2.slotType = 'wave_content';
        p2.waveDensity = (hasBio || p2Units.length >= 2) ? 'medium' : 'low';
      } else {
        p2.slotType = 'soft_fallback';
        p2.softFallback = nextSoftFallback();
        p2.waveDensity = 'low';
      }
      contents.push(p2);

    } else if (totalPhotos === 3) {
      // ─────────────────────────────────────────────────────────────────────
      // 3 PHOTOS: P1 = identity only, P2 = bio + prompt, P3 = remaining
      // UX FIX: Clean first impression - no text overload on Photo 1
      // ─────────────────────────────────────────────────────────────────────
      // Photo 1: Identity ONLY (clean visual first impression)
      const p1 = createEmptyContent();
      p1.slotType = 'identity';
      p1.waveDensity = 'low';
      contents.push(p1);

      // Photo 2: Bio + prompt/basics - with soft fallback for sparse profiles
      const p2 = createEmptyContent();
      if (hasBio) {
        const bioUnit = units.find(u => u.key === 'bio');
        if (bioUnit) {
          p2.bio = bioUnit.payload.text;
          p2.waveUnits = [bioUnit];
          usedUnitKeys.add('bio');
        }
      }
      const p2Units = getNextUnits(2);
      applyUnitsToContent(p2, p2Units);

      if (hasBio || p2Units.length > 0) {
        p2.slotType = 'wave_content';
        p2.waveDensity = 'medium';
      } else {
        p2.slotType = 'soft_fallback';
        p2.softFallback = nextSoftFallback();
        p2.waveDensity = 'low';
      }
      contents.push(p2);

      // Photo 3: MEDIUM (remaining content) - with soft fallback
      const p3 = createEmptyContent();
      const p3Units = getNextUnits(2);
      applyUnitsToContent(p3, p3Units);
      if (p3Units.length > 0) {
        p3.slotType = 'wave_content';
        p3.waveDensity = 'medium';
      } else {
        p3.slotType = 'soft_fallback';
        p3.softFallback = nextSoftFallback();
        p3.waveDensity = 'low';
      }
      contents.push(p3);

    } else if (totalPhotos === 4) {
      // ─────────────────────────────────────────────────────────────────────
      // 4 PHOTOS: P1 = identity only, P2 = bio, P3 = MEDIUM, P4 = MEDIUM
      // UX FIX: Clean first impression - no text overload on Photo 1
      // ─────────────────────────────────────────────────────────────────────
      // Photo 1: Identity ONLY (clean visual first impression)
      const p1 = createEmptyContent();
      p1.slotType = 'identity';
      p1.waveDensity = 'low';
      contents.push(p1);

      // Photo 2: Bio + some content
      const p2 = createEmptyContent();
      if (hasBio) {
        const bioUnit = units.find(u => u.key === 'bio');
        if (bioUnit) {
          p2.bio = bioUnit.payload.text;
          p2.waveUnits = [bioUnit];
          usedUnitKeys.add('bio');
        }
      }
      const p2Units = getNextUnits(1); // Get 1 unit to pair with bio
      applyUnitsToContent(p2, p2Units);

      if (hasBio || p2Units.length > 0) {
        p2.slotType = 'wave_content';
        p2.waveDensity = 'medium';
      } else {
        p2.slotType = 'soft_fallback';
        p2.softFallback = nextSoftFallback();
        p2.waveDensity = 'low';
      }
      contents.push(p2);

      // Photos 3-4: Distribute remaining units evenly - with soft fallback
      for (let i = 2; i < 4; i++) {
        const content = createEmptyContent();
        const photoUnits = getNextUnits(2);
        applyUnitsToContent(content, photoUnits);

        if (photoUnits.length > 0) {
          content.slotType = 'wave_content';
          content.waveDensity = 'medium';
        } else {
          content.slotType = 'soft_fallback';
          content.softFallback = nextSoftFallback();
          content.waveDensity = 'low';
        }
        contents.push(content);
      }

    } else {
      // ─────────────────────────────────────────────────────────────────────
      // 5+ PHOTOS: STRICT LOCKED DISTRIBUTION ORDER
      // Photo 1: identity only (NO bio, NO prompt)
      // Photo 2: bio only
      // Photo 3: prompt1 + basics_compact
      // Photo 4: prompt2 + interests
      // Photo 5: remaining content (prompt3, etc.)
      // Photo 6+: continue with remaining unique content
      // ─────────────────────────────────────────────────────────────────────

      // Helper: Get specific unit by key
      const getUnitByKey = (key: string): DisplayUnit | undefined => {
        const unit = units.find(u => u.key === key && !usedUnitKeys.has(u.key));
        if (unit) usedUnitKeys.add(unit.key);
        return unit;
      };

      // Photo 1: Identity only (NO bio, NO prompt)
      const p1 = createEmptyContent();
      p1.slotType = 'identity';
      p1.waveDensity = 'low';
      contents.push(p1);

      // Photo 2: Bio only
      const p2 = createEmptyContent();
      const bioUnit = getUnitByKey('bio');
      if (bioUnit) {
        p2.bio = bioUnit.payload.text;
        p2.waveUnits = [bioUnit];
        p2.slotType = 'wave_content';
        p2.waveDensity = 'medium';
      } else {
        p2.slotType = 'identity';
        p2.waveDensity = 'low';
      }
      contents.push(p2);

      // Photo 3: prompt1 + basics_compact
      const p3 = createEmptyContent();
      const p3Units: DisplayUnit[] = [];
      const prompt1Unit = getUnitByKey('prompt1');
      if (prompt1Unit) {
        p3.prompts.push(prompt1Unit.payload.prompt);
        p3Units.push(prompt1Unit);
      }
      const basicsUnit = getUnitByKey('basics_compact');
      if (basicsUnit) {
        p3.lifestyle = basicsUnit.payload.items;
        p3Units.push(basicsUnit);
      }
      p3.waveUnits = p3Units;
      p3.slotType = p3Units.length > 0 ? 'wave_content' : 'identity';
      p3.waveDensity = p3Units.length >= 2 ? 'high' : (p3Units.length > 0 ? 'medium' : 'low');
      contents.push(p3);

      // Photo 4: prompt2 + interests_part1
      const p4 = createEmptyContent();
      const p4Units: DisplayUnit[] = [];
      const prompt2Unit = getUnitByKey('prompt2');
      if (prompt2Unit) {
        p4.prompts.push(prompt2Unit.payload.prompt);
        p4Units.push(prompt2Unit);
      }
      const interestsUnit = getUnitByKey('interests_part1');
      if (interestsUnit) {
        p4.interests = interestsUnit.payload.chips;
        p4Units.push(interestsUnit);
      }
      p4.waveUnits = p4Units;
      p4.slotType = p4Units.length > 0 ? 'wave_content' : 'identity';
      p4.waveDensity = p4Units.length >= 2 ? 'high' : (p4Units.length > 0 ? 'medium' : 'low');
      contents.push(p4);

      // Photo 5+: Remaining unique units (no extra prompts beyond prompt1/prompt2) + soft fallbacks
      // REDESIGN: Use soft fallback for late photos when unique content exhausts
      for (let i = 4; i < totalPhotos; i++) {
        const content = createEmptyContent();
        const photoUnits = getNextUnits(2); // Get up to 2 remaining units
        applyUnitsToContent(content, photoUnits);
        content.waveUnits = photoUnits;

        if (photoUnits.length > 0) {
          // Has unique content - show it
          content.slotType = 'wave_content';
          content.waveDensity = photoUnits.length >= 2 ? 'medium' : 'low';
        } else {
          content.slotType = 'soft_fallback';
          content.softFallback = nextSoftFallback();
          content.waveDensity = 'low';
        }
        contents.push(content);
      }
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
  }, [isPhase2, photos?.length, bio, selectedPrompts, phase1Lifestyle, activities, name, relationshipIntent]);

  // NOTE: currentPhotoContent is computed after photoIndex state declaration (see below)

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-2: DATA-AWARE CONTENT QUEUE
  // Builds an ordered list of available content sections, then maps photoIndex
  // to the queue so every photo shows meaningful content (not nothing)
  // ═══════════════════════════════════════════════════════════════════════════

  // Phase-2: Get interests as chip labels (max 4 for card)
  const phase2Interests = useMemo(() => {
    if (!isPhase2 || !activities || activities.length === 0) return [];
    return activities
      .map(key => ACTIVITY_FILTERS.find(a => a.value === key))
      .filter(Boolean)
      .slice(0, 4)
      .map(a => ({ emoji: a!.emoji, label: a!.label }));
  }, [isPhase2, activities]);

  // Phase-2: Get desire tags as chip labels (max 2 for card - secondary info)
  const phase2Desires = useMemo(() => {
    if (!isPhase2 || !desireTagKeys || desireTagKeys.length === 0) return [];
    return desireTagKeys
      .map(key => PRIVATE_DESIRE_TAGS.find(d => d.key === key))
      .filter(Boolean)
      .slice(0, 2)
      .map(d => d!.label);
  }, [isPhase2, desireTagKeys]);

  // Phase-2: Get first intent label for identity slide
  const phase2IntentLabel = useMemo(() => {
    if (!isPhase2 || !privateIntentKeys || privateIntentKeys.length === 0) {
      // LOG_NOISE_FIX: Gated behind DEBUG_P2_UI
      if (__DEV__ && DEBUG_P2_UI && isPhase2) {
        console.log(`[P2_INTENT] ${name}: no intent`);
      }
      return null;
    }
    const category = PRIVATE_INTENT_CATEGORIES.find(c => c.key === privateIntentKeys[0]);
    const label = category?.label ?? (privateIntentKeys[0] ? 'Other' : null);

    // LOG_NOISE_FIX: Gated behind DEBUG_P2_UI
    if (__DEV__ && DEBUG_P2_UI) {
      console.log(`[P2_INTENT] ${name}: ${label || 'none'}`);
    }

    return label;
  }, [isPhase2, privateIntentKeys, name]);

  const phase2IntentChips = useMemo(() => {
    if (!isPhase2 || !privateIntentKeys || privateIntentKeys.length === 0) return [];
    return privateIntentKeys
      .map((key) => {
        const category = PRIVATE_INTENT_CATEGORIES.find((item) => item.key === key);
        return category ? { key, label: category.label } : null;
      })
      .filter(Boolean)
      .slice(0, 2) as { key: string; label: string }[];
  }, [isPhase2, privateIntentKeys]);

  // Phase-2: Lifestyle chips (height, smoking, drinking)
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
        socially: 'Social smoker',
        regularly: 'Smoker',
      };
      if (smokingLabels[smoking]) items.push({ icon: 'flame-outline', label: smokingLabels[smoking] });
    }
    if (drinking && drinking !== 'prefer_not_to_say') {
      const drinkingLabels: Record<string, string> = {
        never: "Doesn't drink",
        socially: 'Social drinker',
        regularly: 'Regular drinker',
      };
      if (drinkingLabels[drinking]) items.push({ icon: 'wine-outline', label: drinkingLabels[drinking] });
    }
    return items;
  }, [isPhase2, profileHeight, smoking, drinking]);

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
  // PHASE-2: ADAPTIVE PHOTO-STORY DISTRIBUTION
  // - Identity (name + age + badge) is ALWAYS visible on every photo
  // - Secondary content is DISTRIBUTED across photos based on photo count
  // - Priority: intent → desires → interests → prompt1 → lifestyle → prompt2 → bio
  // - STRICT: No repetition of informational units across photos (identity excluded)
  // - 5+ photos: after unique units are exhausted, use tasteful non-duplicative fallback
  // ═══════════════════════════════════════════════════════════════════════════
  type ContentSlot = 'intent' | 'desires' | 'interests' | 'prompt1' | 'lifestyle' | 'prompt2' | 'bio' | 'fallback';

  // Priority-ordered content slots (same priority for ALL users = premium consistency)
  const CONTENT_PRIORITY: ContentSlot[] = [
    'intent',     // 1. What they're looking for
    'desires',    // 2. What they desire in a connection
    'interests',  // 3. Shared hobbies/activities
    'prompt1',    // 4. First personality prompt
    'lifestyle',  // 5. Height/smoking/drinking
    'prompt2',    // 6. Second personality prompt (if available)
    'bio',        // 7. Bio snippet
  ];

  // Get first prompt (for prompt1 slot)
  const phase2Prompt1 = useMemo(() => {
    if (!isPhase2) return null;
    if (profilePrompts && profilePrompts.length > 0) return profilePrompts[0];
    return profilePrompt ?? null;
  }, [isPhase2, profilePrompts, profilePrompt]);

  // Get second prompt (for prompt2 slot) - only if different from first
  const phase2Prompt2 = useMemo(() => {
    if (!isPhase2) return null;
    if (profilePrompts && profilePrompts.length > 1) return profilePrompts[1];
    return null;
  }, [isPhase2, profilePrompts]);

  // Check if a slot has data
  const slotHasData = useCallback((slot: ContentSlot): boolean => {
    switch (slot) {
      case 'intent': return !!phase2IntentLabel;
      case 'desires': return phase2Desires.length > 0;
      case 'interests': return phase2Interests.length > 0;
      case 'prompt1': return !!phase2Prompt1;
      case 'lifestyle': return phase2Lifestyle.length > 0;
      case 'prompt2': return !!phase2Prompt2;
      case 'bio': return !!bio && bio.length > 0;
      case 'fallback': return true;
      default: return false;
    }
  }, [phase2IntentLabel, phase2Desires, phase2Interests, phase2Prompt1, phase2Lifestyle, phase2Prompt2, bio]);

  type Phase2PlannedSlot =
    | { slot: Exclude<ContentSlot, 'fallback'> }
    | { slot: 'fallback'; index: number; total: number };

  // Build a strict no-repeat plan for Phase-2 content slots.
  // 2/3/4 photos: show the strongest distinct units first.
  // 5+ photos: after unique units exhaust, use per-photo fallback (no restating earlier sections).
  const phase2Plan = useMemo((): Phase2PlannedSlot[] => {
    if (!isPhase2) return [];

    const uniqueSlots = CONTENT_PRIORITY
      .filter((slot) => slot !== 'fallback')
      .filter((slot) => slotHasData(slot));

    // If nothing exists, fall back for all photos (and at least 1 photo).
    if (uniqueSlots.length === 0) {
      const total = Math.max(photoCount, 1);
      return Array.from({ length: total }, (_, i) => ({
        slot: 'fallback' as const,
        index: i,
        total,
      }));
    }

    const plan: Phase2PlannedSlot[] = [];
    const total = Math.max(photoCount, 1);

    for (let i = 0; i < total; i++) {
      if (i < uniqueSlots.length) {
        plan.push({ slot: uniqueSlots[i] as Exclude<ContentSlot, 'fallback'> });
      } else {
        plan.push({ slot: 'fallback', index: i, total });
      }
    }

    if (__DEV__ && DEBUG_P2_UI) {
      const debug = plan.map((p) => (p.slot === 'fallback' ? 'fallback' : p.slot)).join(',');
      console.log(`[P2_PLAN] ${name} ${total}p: ${debug}`);
    }

    return plan;
  }, [isPhase2, slotHasData, photoCount, name]);

  const currentPlanned = useMemo((): Phase2PlannedSlot | null => {
    if (!isPhase2 || phase2Plan.length === 0) return null;
    return phase2Plan[photoIndex] ?? phase2Plan[phase2Plan.length - 1] ?? { slot: 'fallback', index: photoIndex, total: Math.max(photoCount, 1) };
  }, [isPhase2, phase2Plan, photoIndex]);

  const currentContentSlot = useMemo((): ContentSlot | null => {
    return currentPlanned?.slot ?? null;
  }, [currentPlanned]);

  const phase2FallbackCopy = useMemo(() => {
    if (currentPlanned?.slot !== 'fallback') return null;
    const idx = currentPlanned.index;
    const total = currentPlanned.total;

    // Premium, non-informational microcopy (never repeats profile content).
    // Deterministic per slide; safe to reuse across users.
    const lines = [
      'Deep Connect • Private profile',
      'Private Mode • More to explore',
      'Deep Connect • Keep swiping',
      'Private profile • Gallery',
    ];
    const line = lines[idx % lines.length] ?? 'Deep Connect • Private profile';

    // Subtle progress hint without being mechanical.
    // Example: "Slide 5/7"
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
          <Text style={styles.gridName} numberOfLines={1}>
            {displayName}{ageLabel ? `, ${ageLabel}` : ''}
          </Text>
          {isVerified && <Ionicons name="checkmark-circle" size={14} color={COLORS.superLike} />}
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

        {/* Premium gradient overlay - top (elegant, subtle vignette) */}
        <LinearGradient
          colors={dark
            ? ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.15)', 'transparent']
            : ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.08)', 'transparent']}
          locations={[0, 0.5, 1]}
          style={styles.topGradient}
          pointerEvents="none"
        />

        {/* Premium gradient overlay - bottom (smooth, cinematic fade for immersive feel) */}
        <LinearGradient
          colors={dark
            ? ['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.95)']
            : ['transparent', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.65)', 'rgba(0,0,0,0.85)']}
          locations={dark ? [0, 0.15, 0.4, 0.7, 1] : [0, 0.12, 0.35, 0.6, 1]}
          style={styles.bottomGradient}
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

        {/* Arrow button to open full profile */}
        {showCarousel && onOpenProfile && (
          <TouchableOpacity
            style={[styles.arrowBtn, dark && styles.arrowBtnDark, { bottom: arrowButtonBottom }]}
            onPress={onOpenProfile}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-up" size={22} color={COLORS.white} />
          </TouchableOpacity>
        )}
      </View>
      </GestureDetector>

      {/* Info overlay at bottom - uses gradient instead of solid bg */}
      {/* PHASE-2: Photo-index-based content reveal system */}
      {/* PREMIUM UX: Fixed gradient, stable identity, smooth content transitions */}
      {isPhase2 ? (
        <View style={[styles.overlay, styles.overlayDark, styles.phase2Overlay]} pointerEvents="none">
          {/* ═══════════════════════════════════════════════════════════════════════════
              PHASE-2 PARITY: ENHANCED IDENTITY LAYER
              Name + Age + Gender + Badge = always visible (persistent anchor)
              Photo-1 only: Presence status + city
              ═══════════════════════════════════════════════════════════════════════════ */}
          <View style={styles.phase2IdentitySection}>
            {/* LAYER A: PERSISTENT IDENTITY (ALL PHOTOS) - Name + Age + Gender */}
            <View style={styles.phase2IdentityRow}>
              <Text style={styles.phase2Name}>{name}</Text>
              {ageLabel && <Text style={styles.phase2Age}>{ageLabel}</Text>}
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
              {isVerified ? (
                <Ionicons name="checkmark-circle" size={16} color="#7dd3fc" style={styles.phase2VerifiedIcon} />
              ) : null}
            </View>

            {/* LAYER B: PHOTO-1-ONLY METADATA - Presence + Area */}
            {photoIndex === 0 && (
              <View style={styles.phase2MetadataRow}>
                {/* Online/recently active status badges */}
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
                {/* Privacy-preserving area */}
                {phase2AreaLabel && (
                  <View style={styles.phase2CityBadge}>
                    <Ionicons name="location-outline" size={10} color="rgba(255,255,255,0.6)" />
                    <Text style={styles.phase2CityText}>{phase2AreaLabel}</Text>
                  </View>
                )}
                {phase2DistanceLabel && (
                  <View style={styles.phase2CityBadge}>
                    <Text style={styles.phase2CityText}>{phase2DistanceLabel}</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* ═══════════════════════════════════════════════════════════════════════════
              PREMIUM UX: DATA-AWARE CONTENT REVEAL
              - Maps photoIndex to content queue (not fixed indices)
              - Every photo shows meaningful content (no empty states)
              - First render: No animation (prevents flicker)
              - Subsequent: Smooth 150ms fade transitions
              ═══════════════════════════════════════════════════════════════════════════ */}

          {/* Intent slot */}
          {currentContentSlot === 'intent' && phase2IntentLabel && photoIndex > 0 && (
            <Animated.View
              key={`intent-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2IntentChip}>
                <Text style={styles.phase2IntentChipText}>{phase2IntentLabel}</Text>
              </View>
            </Animated.View>
          )}

          {/* Desires slot - What they're looking for in a connection */}
          {currentContentSlot === 'desires' && phase2Desires.length > 0 && (
            <Animated.View
              key={`desires-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2ChipsRow}>
                {phase2Desires.map((label, idx) => (
                  <View key={idx} style={styles.phase2DesireChip}>
                    <Text style={styles.phase2DesireText}>{label}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Interests slot */}
          {currentContentSlot === 'interests' && phase2Interests.length > 0 && (
            <Animated.View
              key={`interests-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2ChipsRow}>
                {phase2Interests.map((item, idx) => (
                  <View key={idx} style={styles.phase2InterestChip}>
                    <Text style={styles.phase2InterestText}>{item.emoji} {item.label}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Prompt1 slot - First personality prompt */}
          {currentContentSlot === 'prompt1' && phase2Prompt1 && (
            <Animated.View
              key={`prompt1-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2PromptCard}>
                <Text style={styles.phase2PromptQuestion} numberOfLines={1}>
                  {phase2Prompt1.question}
                </Text>
                <Text style={styles.phase2PromptAnswer} numberOfLines={2}>
                  {phase2Prompt1.answer}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Lifestyle slot */}
          {currentContentSlot === 'lifestyle' && phase2Lifestyle.length > 0 && (
            <Animated.View
              key={`lifestyle-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2ChipsRow}>
                {phase2Lifestyle.map((item, idx) => (
                  <View key={idx} style={styles.phase2LifestyleChip}>
                    <Ionicons name={item.icon as any} size={12} color="rgba(255,255,255,0.8)" />
                    <Text style={styles.phase2LifestyleText}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Prompt2 slot - Second personality prompt */}
          {currentContentSlot === 'prompt2' && phase2Prompt2 && (
            <Animated.View
              key={`prompt2-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2PromptCard}>
                <Text style={styles.phase2PromptQuestion} numberOfLines={1}>
                  {phase2Prompt2.question}
                </Text>
                <Text style={styles.phase2PromptAnswer} numberOfLines={2}>
                  {phase2Prompt2.answer}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Bio slot - Short bio snippet */}
          {currentContentSlot === 'bio' && bio && bio.length > 0 && (
            <Animated.View
              key={`bio-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2BioCard}>
                <Text style={styles.phase2BioText} numberOfLines={2}>
                  {bio}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Fallback slot - premium non-duplicative late-photo behavior */}
          {currentContentSlot === 'fallback' && (
            <Animated.View
              key={`fallback-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
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
            </Animated.View>
          )}
        </View>
      ) : (
        /* PHASE-1: PREMIUM PROGRESSIVE REVEAL OVERLAY */
        <View style={[styles.overlay, styles.phase1PremiumOverlay]} pointerEvents="none">
          {/* P1A: Match Signal Badge - Top-right hook on Photo 1 */}
          {/* GROWTH: Now shows "Why You're Seeing This" with match reasons */}
          <MatchSignalBadge
            commonCount={matchSignalCount}
            sameRelationshipIntent={hasSameRelationshipIntent}
            visible={photoIndex > 0 && !isPhase2}
            matchScore={matchScore}
          />

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
                LAYER A: IDENTITY ROW (Name + Age + Verified Tick + Presence)
                REQUIREMENT: Visible on ALL photos for consistent identity
                ───────────────────────────────────────────────────────────────────────── */}
            <View style={styles.phase1NameRow}>
              <Text style={styles.phase1Name} numberOfLines={1}>
                {displayName}
              </Text>
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
              {/* Verified tick: shown on ALL photos (including Photo 1) next to name/age.
                  Product rule: small verified check beside identity, never a separate "Face Verified" badge. */}
              {isVerified && (
                <View style={styles.phase1VerifiedTick}>
                  <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                </View>
              )}
              {/* Presence indicator - only when online or active today */}
              {isActiveNow && (
                <View style={styles.phase1PresencePill}>
                  <View style={styles.phase1PresenceDotInline} />
                  <Text style={styles.phase1PresenceText}>Online Now</Text>
                </View>
              )}
              {isActiveToday && !isActiveNow && (
                <View style={styles.phase1PresencePillMuted}>
                  <Text style={styles.phase1PresenceTextMuted}>Active Today</Text>
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

            {/* Distance row - visible on FIRST photo only (no repetition) */}
            {!isPhase2 && photoIndex === 0 && distance !== undefined && distance >= 0 && (
              <View style={styles.phase1DistanceRowPersistent}>
                <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={styles.phase1DistanceTextPersistent}>
                  {distance < 1 ? '< 1 km away' : `${distance.toFixed(0)} km away`}
                </Text>
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
                    <View key={item.key} style={styles.phase1LifestyleChip}>
                      <Ionicons name={item.icon as any} size={14} color="rgba(255,255,255,0.8)" />
                      <Text style={styles.phase1LifestyleChipText}>{item.label}</Text>
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
                    <View key={item.key} style={styles.phase1InterestChip}>
                      <Text style={styles.phase1InterestText}>{item.emoji} {item.label}</Text>
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
                    <View key={`soft-interest-${idx}`} style={styles.phase1SoftFallbackChip}>
                      <Text style={styles.phase1SoftFallbackChipText}>{chip.emoji} {chip.label}</Text>
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
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    zIndex: 2,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '65%', // Extended for more content coverage
    zIndex: 2,
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
  // Arrow button (opens full profile) - REDESIGNED: smaller, more integrated
  // NOTE: `bottom` is computed dynamically via arrowButtonBottom for device responsiveness
  arrowBtn: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  arrowBtnDark: {
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 16,
  },
  phase2IdentityRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  phase2Name: {
    fontSize: 30,
    fontWeight: '700',
    color: COLORS.white,
    marginRight: 10,
    letterSpacing: -0.5,
  },
  phase2Age: {
    fontSize: 26,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.75)',
    marginRight: 10,
  },
  phase2VerifiedIcon: {
    marginLeft: 2,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  // PHASE2_PARITY: Metadata row (presence + city)
  phase2MetadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
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
  // Photo 3 & 5: Chips row (interests, lifestyle)
  phase2ChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  // Photo 4 & 6+: Prompt card
  phase2PromptCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  phase2PromptQuestion: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  phase2PromptAnswer: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
  },
  // Bio slot styles
  phase2BioCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  phase2BioText: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    fontStyle: 'italic',
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  phase1Name: {
    fontSize: 34,
    fontWeight: '700',
    color: COLORS.white,
    marginRight: 8,
    flexShrink: 1,
    letterSpacing: -0.8,
    // Strong shadow for readability on any photo
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  phase1Age: {
    fontSize: 30,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.95)',
    marginRight: 8,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  // P1A: Presence dot styles - compact indicator next to name
  phase1PresenceDotOnline: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e', // green-500
    marginLeft: 6,
    alignSelf: 'center',
    // Shadow for depth
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 2,
  },
  phase1PresenceDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#86efac', // green-300 (lighter for active today)
    marginLeft: 6,
    alignSelf: 'center',
    opacity: 0.8,
  },
  // Compact verified tick - inline with name/age
  phase1VerifiedTick: {
    marginLeft: 4,
    alignSelf: 'center',
  },
  // Presence pill - compact "Online Now" indicator
  phase1PresencePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 8,
    gap: 4,
  },
  phase1PresenceDotInline: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  phase1PresenceText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },
  phase1PresencePillMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 8,
  },
  phase1PresenceTextMuted: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
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
  // Distance row - persistent on all photos
  phase1DistanceRowPersistent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  phase1DistanceTextPersistent: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.75)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1VerifiedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
  phase1BadgePillOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  phase1OnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
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
  phase1BadgeTextOnline: {
    color: '#34D399',
  },
  // Distance row - clean inline text
  phase1DistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phase1IdentityDistanceText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  // Distance card - LEGACY (not used, replaced by inline distance row)
  phase1DistanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  phase1DistanceText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Bio section - REDESIGNED: elegant text, no box
  phase1BioCard: {
    // NO background, NO border - pure typography
    maxHeight: 90,
    paddingRight: 12,
  },
  phase1BioLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1BioText: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 21,
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Lifestyle row - REDESIGNED: subtle inline items, no heavy chips
  phase1LifestyleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  phase1LifestyleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    // NO background - inline text with icon
  },
  phase1LifestyleChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Smaller lifestyle chips for compact view
  phase1LifestyleChipSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // NO background
  },
  phase1LifestyleChipTextSmall: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
  // Small interests row for compact view - subtle inline
  phase1InterestsRowSmall: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  phase1InterestChipSmall: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  phase1InterestTextSmall: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1InterestOverflowSmall: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
  },
  phase1InterestOverflowTextSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
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

  // Prompt as THE moment - conversation starter, emphasized
  phase1PromptMoment: {
    // More breathing room for emphasis
    paddingVertical: 4,
  },
  phase1PromptQuestionMoment: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1PromptAnswerMoment: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.98)',
    lineHeight: 22,
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  phase1LifestyleChipCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
  },
  phase1LifestyleChipTextCompact: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1InterestsRowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    maxHeight: 60,
    overflow: 'hidden',
  },
  phase1InterestChipCompact: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  phase1InterestTextCompact: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1InterestOverflowCompact: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 10,
  },
  phase1InterestOverflowTextCompact: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  phase1PromptCardCompact: {
    maxHeight: 80,
  },
  phase1PromptQuestionCompact: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1PromptAnswerCompact: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 19,
    fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
  // Interests row - REDESIGNED: subtle minimal chips
  phase1InterestsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    maxHeight: 70,
    overflow: 'hidden',
  },
  phase1InterestChip: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  phase1InterestText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Overflow indicator for interests - subtle
  phase1InterestOverflow: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  phase1InterestOverflowText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  // Prompt section - REDESIGNED: elegant typography, no box
  phase1PromptCard: {
    // NO background, NO border - pure text hierarchy
    maxHeight: 90,
    paddingRight: 12,
  },
  phase1PromptQuestion: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  phase1PromptAnswer: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 21,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  phase1SoftFallbackChip: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  phase1SoftFallbackChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
