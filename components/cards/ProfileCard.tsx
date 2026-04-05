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
  FadeIn,
  FadeOut,
  Layout,
} from 'react-native-reanimated';
import { cmToFeetInches } from '@/lib/utils';
import { trackAction } from '@/lib/sentry';

// PERF: Max photos to prefetch when card becomes visible
const PREFETCH_COUNT = 5;
import { COLORS, INCOGNITO_COLORS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import type { TrustBadge } from '@/lib/trustBadges';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';

// Gender labels for "Looking for" display
const GENDER_LABELS: Record<string, string> = {
  male: 'Men',
  female: 'Women',
  non_binary: 'Non-binary',
  lesbian: 'Women',
  other: 'Everyone',
};

export interface ProfileCardProps {
  name: string;
  age: number;
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
  /** Face 2 only: intent category keys from PRIVATE_INTENT_CATEGORIES (array) */
  privateIntentKeys?: string[];
  /** Phase-1 only: Gender preferences (looking for) */
  lookingFor?: string[];
  /** Phase-1 only: Relationship intent keys */
  relationshipIntent?: string[];
  /** Activities/interests keys */
  activities?: string[];
  /** True if user has incognito mode enabled (shows badge) */
  isIncognito?: boolean;
  /** Explore category tag - shows "Why this profile" label above name */
  exploreTag?: string;
  /** Last active timestamp for "Active Now" badge */
  lastActive?: number;
  /** Phase-2 only: Lifestyle data */
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  // Legacy props for non-Discover usage (explore grid etc.)
  user?: any;
  onPress?: () => void;
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
  onError?: () => void;
}

const PhotoStack = memo(function PhotoStack({
  photos,
  activeIndex,
  photoBlurred,
  onError,
}: PhotoStackProps) {
  // Only render up to PREFETCH_COUNT photos to limit memory usage
  const visiblePhotos = photos.slice(0, PREFETCH_COUNT);

  return (
    <>
      {visiblePhotos.map((photo, idx) => (
        <Image
          key={photo.url}
          source={{ uri: photo.url }}
          style={[
            styles.image,
            // PERF: Only current photo is visible; others are pre-rendered but hidden
            { opacity: idx === activeIndex ? 1 : 0 },
          ]}
          contentFit="cover"
          cachePolicy="memory-disk"
          blurRadius={photoBlurred ? BLUR_RADIUS : undefined}
          // Only attach error handler to active photo
          onError={idx === activeIndex ? onError : undefined}
        />
      ))}
    </>
  );
});

export const ProfileCard: React.FC<ProfileCardProps> = React.memo(({
  name,
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
  privateIntentKeys,
  lookingFor,
  relationshipIntent,
  activities,
  isIncognito,
  exploreTag,
  lastActive,
  height: profileHeight,
  smoking,
  drinking,
  onPress,
}) => {
  const dark = theme === 'dark';
  // PHASE-2 DETECTION: Use privateIntentKeys presence, NOT theme
  const isPhase2 = !!privateIntentKeys;
  const TC = dark ? INCOGNITO_COLORS : COLORS;
  const { height: windowHeight } = useWindowDimensions();

  // Responsive bottom offset for arrow button (was hardcoded 140px)
  // On ~850px device, 140px ≈ 16.5% from bottom — scale proportionally
  const arrowButtonBottom = Math.round(windowHeight * 0.165);

  // Check if user is active now (within 10 minutes)
  const isActiveNow = useMemo(() => {
    if (!lastActive) return false;
    const tenMinutesMs = 10 * 60 * 1000;
    return (Date.now() - lastActive) < tenMinutesMs;
  }, [lastActive]);

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
    if (isPhase2 || !relationshipIntent || relationshipIntent.length === 0) return [];
    return relationshipIntent
      .map(key => RELATIONSHIP_INTENTS.find(i => i.value === key))
      .filter(Boolean)
      .slice(0, 2) // Show max 2 on card
      .map(i => i!.label);
  }, [isPhase2, relationshipIntent]);

  // Phase-1 only: Get activity labels with emojis
  const activityItems = useMemo(() => {
    if (isPhase2 || !activities || activities.length === 0) return [];
    return activities
      .map(key => ACTIVITY_FILTERS.find(a => a.value === key))
      .filter(Boolean)
      .slice(0, 3) // Show max 3 on card
      .map(a => ({ emoji: a!.emoji, label: a!.label }));
  }, [isPhase2, activities]);

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

  // Phase-2: Get first intent label for identity slide
  const phase2IntentLabel = useMemo(() => {
    if (!isPhase2 || !privateIntentKeys || privateIntentKeys.length === 0) {
      // [P2_UI_INTENT] Debug: No intent data
      if (__DEV__ && isPhase2) {
        console.log('[P2_UI_INTENT] No intent data', { name, privateIntentKeys });
      }
      return null;
    }
    const category = PRIVATE_INTENT_CATEGORIES.find(c => c.key === privateIntentKeys[0]);
    const label = category?.label ?? null;

    // [P2_UI_INTENT] Debug logging for intent resolution
    if (__DEV__) {
      console.log('[P2_UI_INTENT]', {
        name,
        intentKey: privateIntentKeys[0],
        resolvedLabel: label,
        allKeys: privateIntentKeys,
        categoryFound: !!category,
      });
    }

    return label;
  }, [isPhase2, privateIntentKeys, name]);

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

  // Photo count needed for distribution logic
  const photoCount = photos?.length || 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-2: ADAPTIVE PHOTO-STORY DISTRIBUTION
  // - Identity (name + age + badge) is ALWAYS visible on every photo
  // - Secondary content is DISTRIBUTED across photos based on photo count
  // - Priority: intent → interests → prompt1 → lifestyle → distance → prompt2 → bio
  // - If more photos than content, stay on last meaningful section
  // - NO modulo cycling, NO rigid photo-number hardcoding
  // ═══════════════════════════════════════════════════════════════════════════
  type ContentSlot = 'intent' | 'interests' | 'prompt1' | 'lifestyle' | 'distance' | 'prompt2' | 'bio' | 'fallback';

  // Priority-ordered content slots (same priority for ALL users = premium consistency)
  const CONTENT_PRIORITY: ContentSlot[] = [
    'intent',     // 1. What they're looking for
    'interests',  // 2. Shared hobbies/activities
    'prompt1',    // 3. First personality prompt
    'lifestyle',  // 4. Height/smoking/drinking
    'distance',   // 5. How far away
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
      case 'interests': return phase2Interests.length > 0;
      case 'prompt1': return !!phase2Prompt1;
      case 'lifestyle': return phase2Lifestyle.length > 0;
      case 'distance': return distance !== undefined && distance > 0;
      case 'prompt2': return !!phase2Prompt2;
      case 'bio': return !!bio && bio.length > 0;
      case 'fallback': return true;
      default: return false;
    }
  }, [phase2IntentLabel, phase2Interests, phase2Prompt1, phase2Lifestyle, distance, phase2Prompt2, bio]);

  // Build DISTRIBUTED content slots based on photo count
  // Key insight: We distribute N content sections across M photos
  const phase2DistributedSlots = useMemo((): ContentSlot[] => {
    if (!isPhase2) return [];

    // 1. Get all available content sections (in priority order)
    const availableContent = CONTENT_PRIORITY.filter(slot => slotHasData(slot));

    // 2. If no content available, use fallback
    if (availableContent.length === 0) {
      return ['fallback'];
    }

    // 3. Distribute content across photos with smart cycling
    // - If photoCount <= availableContent.length: show top N sections
    // - If photoCount > availableContent.length: cycle through strongest slots (top 3)
    // - This maintains variety instead of repeating last slot
    const distributed: ContentSlot[] = [];
    const strongSlots = availableContent.slice(0, Math.min(3, availableContent.length)); // Top 3 strongest

    for (let i = 0; i < photoCount; i++) {
      if (i < availableContent.length) {
        // We have unique content for this photo
        distributed.push(availableContent[i]);
      } else {
        // More photos than content - cycle through strong slots for variety
        const repeatIndex = (i - availableContent.length) % strongSlots.length;
        distributed.push(strongSlots[repeatIndex]);
      }
    }

    // [P2_UI_DISTRIBUTION] Debug logging
    if (__DEV__) {
      console.log('[P2_UI_DISTRIBUTION]', {
        name,
        photoCount,
        availableContent,
        distributed,
        contentCount: availableContent.length,
      });
    }

    return distributed;
  }, [isPhase2, slotHasData, photoCount, name]);

  // Get the content slot for current photo index
  // Direct mapping from distributed slots array
  const currentContentSlot = useMemo((): ContentSlot | null => {
    if (!isPhase2 || phase2DistributedSlots.length === 0) return null;

    // Safe access - should always have a slot for each photoIndex
    const slot = phase2DistributedSlots[photoIndex] ?? phase2DistributedSlots[phase2DistributedSlots.length - 1] ?? 'fallback';

    // [P2_UI_CONTENT_SLOT] Debug logging
    if (__DEV__) {
      console.log('[P2_UI_CONTENT_SLOT]', {
        name,
        photoIndex,
        photoCount,
        slot,
        totalSlots: phase2DistributedSlots.length,
      });
    }

    return slot;
  }, [isPhase2, phase2DistributedSlots, photoIndex, photoCount, name]);

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

  // PERF: Prefetch first N photos on mount for instant switching
  const prefetchedRef = useRef(false);
  useEffect(() => {
    if (prefetchedRef.current || !photos || photos.length === 0) return;
    prefetchedRef.current = true;

    // Prefetch first PREFETCH_COUNT photos (or all if fewer)
    const toPrefetch = photos.slice(0, PREFETCH_COUNT);
    toPrefetch.forEach((photo) => {
      if (photo?.url) {
        Image.prefetch(photo.url).catch(() => {
          // Silently ignore prefetch failures - image will load on-demand
        });
      }
    });
  }, [photos]);

  // 3B-2: Safe access with clamping
  const safeIndex = Math.min(Math.max(0, photoIndex), Math.max(0, photoCount - 1));
  const currentPhoto = photos?.[safeIndex] || photos?.[0];

  const goNextPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setPhotoIndex((i) => {
      const newIndex = i + 1 < photoCount ? i + 1 : i;
      // Track photo navigation for user journey replay
      if (newIndex !== i && isPhase2) {
        trackAction('photo_next', { index: newIndex, name });
      }
      return newIndex;
    });
  }, [photoCount, isPhase2, name]);

  const goPrevPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setPhotoIndex((i) => {
      const newIndex = i > 0 ? i - 1 : i;
      // Track photo navigation for user journey replay
      if (newIndex !== i && isPhase2) {
        trackAction('photo_prev', { index: newIndex, name });
      }
      return newIndex;
    });
  }, [photoCount, isPhase2, name]);

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
            blurRadius={photoBlurred ? BLUR_RADIUS : undefined}
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={[styles.gridImage, styles.gridPlaceholder]}>
            <Ionicons name="image-outline" size={32} color={COLORS.textLight} />
          </View>
        )}
        <View style={styles.gridOverlay}>
          <Text style={styles.gridName} numberOfLines={1}>
            {name}, {age}
          </Text>
          {isVerified && <Ionicons name="checkmark-circle" size={14} color={COLORS.superLike} />}
        </View>
      </TouchableOpacity>
    );
  }

  // --- Discover card mode ---
  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      {/* Photo area fills entire card */}
      <View style={styles.photoContainer}>
        {/* PERF: Memoized photo stack for instant switching */}
        {photos && photos.length > 0 ? (
          <PhotoStack
            photos={photos}
            activeIndex={safeIndex}
            photoBlurred={photoBlurred}
            onError={() => setImageError(true)}
          />
        ) : (
          // Premium placeholder for no-photo state
          <View style={[styles.photoPlaceholder, dark && styles.photoPlaceholderDark]}>
            <View style={[styles.placeholderIconContainer, dark && styles.placeholderIconContainerDark]}>
              <Ionicons name="person" size={56} color={dark ? 'rgba(255,255,255,0.3)' : TC.textLight} />
            </View>
            <Text style={[styles.placeholderText, dark && styles.placeholderTextDark]}>No photo yet</Text>
          </View>
        )}
        {/* Fallback placeholder for error state */}
        {imageError && (
          <View style={[styles.photoPlaceholder, dark && styles.photoPlaceholderDark, StyleSheet.absoluteFillObject]}>
            <View style={[styles.placeholderIconContainer, dark && styles.placeholderIconContainerDark]}>
              <Ionicons name="image-outline" size={48} color={dark ? 'rgba(255,255,255,0.3)' : TC.textLight} />
            </View>
          </View>
        )}

        {/* Premium gradient overlay - top (subtle, for status bar area) */}
        <LinearGradient
          colors={dark
            ? ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.2)', 'transparent']
            : ['rgba(0,0,0,0.3)', 'transparent']}
          style={styles.topGradient}
          pointerEvents="none"
        />

        {/* Premium gradient overlay - bottom (stronger, for text readability) */}
        <LinearGradient
          colors={dark
            ? ['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.95)']
            : ['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)']}
          locations={dark ? [0, 0.3, 0.7, 1] : [0, 0.4, 1]}
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

      {/* Info overlay at bottom - uses gradient instead of solid bg */}
      {/* PHASE-2: Photo-index-based content reveal system */}
      {/* PREMIUM UX: Fixed gradient, stable identity, smooth content transitions */}
      {isPhase2 ? (
        <View style={[styles.overlay, styles.overlayDark, styles.phase2Overlay]} pointerEvents="none">
          {/* ═══════════════════════════════════════════════════════════════════════════
              PREMIUM UX: LOCKED IDENTITY LAYER
              Name + Age + Badge = always visible, no animation, no layout shift
              This is the stable anchor that never changes
              ═══════════════════════════════════════════════════════════════════════════ */}
          <View style={styles.phase2IdentityRow}>
            <Text style={styles.phase2Name}>{name}</Text>
            <Text style={styles.phase2Age}>{age}</Text>
            {isVerified && (
              <View style={styles.phase2VerifiedBadge}>
                <Ionicons name="checkmark" size={10} color={COLORS.white} />
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
          {currentContentSlot === 'intent' && phase2IntentLabel && (
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

          {/* Distance slot */}
          {currentContentSlot === 'distance' && distance !== undefined && distance > 0 && (
            <Animated.View
              key={`distance-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2DistanceRow}>
                <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.7)" />
                <Text style={styles.phase2DistanceText}>{distance.toFixed(0)} km away</Text>
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

          {/* Fallback slot - when no other content is available */}
          {currentContentSlot === 'fallback' && profilePrompt && (
            <Animated.View
              key={`fallback-${photoIndex}`}
              entering={isFirstRenderRef.current ? undefined : FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.phase2RevealSection}
            >
              <View style={styles.phase2PromptCard}>
                <Text style={styles.phase2PromptQuestion} numberOfLines={1}>
                  {profilePrompt.question}
                </Text>
                <Text style={styles.phase2PromptAnswer} numberOfLines={2}>
                  {profilePrompt.answer}
                </Text>
              </View>
            </Animated.View>
          )}
        </View>
      ) : (
        /* PHASE-1: Original overlay (unchanged) */
        <View style={[styles.overlay, dark && styles.overlayDark]} pointerEvents="none">
          <View style={[styles.headerRow, dark && styles.headerRowDark]}>
            <View style={styles.headerContent}>
              {/* Active Now badge */}
              {isActiveNow && (
                <View style={[styles.activeNowBadge, dark && styles.activeNowBadgeDark]}>
                  <View style={styles.activeNowDot} />
                  <Text style={styles.activeNowText}>Active now</Text>
                </View>
              )}
              {/* Explore category tag - "Why this profile" */}
              {exploreTag && !isActiveNow && (
                <View style={styles.exploreTagContainer}>
                  <Text style={styles.exploreTagText}>{exploreTag}</Text>
                </View>
              )}
              {/* Name and Age - improved hierarchy */}
              <View style={styles.nameRow}>
                <Text style={[styles.name, dark && styles.nameDark]}>{name}</Text>
                <Text style={[styles.age, dark && styles.ageDark]}>{age}</Text>
                {isVerified && (
                  <View style={[styles.verifiedBadge, dark && styles.verifiedBadgeDark]}>
                    <Ionicons name="checkmark" size={12} color={COLORS.white} />
                  </View>
                )}
              </View>
              {/* City - Phase-1 only */}
              {!!city && (
                <View style={styles.locationRow}>
                  <Ionicons name="location-outline" size={13} color={'rgba(255,255,255,0.8)'} />
                  <Text style={styles.city}>{city}</Text>
                </View>
              )}
              {/* Phase-1 only: Looking for + intent chips */}
              {(lookingForText || intentLabels.length > 0) && (
                <View style={styles.intentChipRow}>
                  {lookingForText && (
                    <View style={styles.intentChip}>
                      <Text style={styles.intentChipText}>{lookingForText}</Text>
                    </View>
                  )}
                  {intentLabels.map((label, idx) => (
                    <View key={idx} style={styles.intentChip}>
                      <Text style={styles.intentChipText}>{label}</Text>
                    </View>
                  ))}
                </View>
              )}
              {/* Phase-1 only: Activities/interests chips */}
              {activityItems.length > 0 && (
                <View style={styles.activityChipRow}>
                  {activityItems.map((item, idx) => (
                    <View key={idx} style={styles.activityChip}>
                      <Text style={styles.activityChipText}>{item.emoji} {item.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            {!!distance && (
              <Text style={[styles.distance, dark && styles.distanceDark]}>{distance.toFixed(0)} km</Text>
            )}
          </View>

          {/* Trust badges - Phase-1 only */}
          {trustBadges && trustBadges.length > 0 && (
            <View style={styles.trustBadgeRow}>
              {trustBadges.slice(0, 3).map((badge) => (
                <View key={badge.key} style={[styles.trustBadgeCompact, { backgroundColor: badge.color + '30' }]}>
                  <Ionicons name={badge.icon as any} size={11} color={COLORS.white} />
                  <Text style={styles.trustBadgeLabel}>{badge.label}</Text>
                </View>
              ))}
              {trustBadges.length > 3 && (
                <View style={[styles.trustBadgeCompact, { backgroundColor: COLORS.textMuted + '30' }]}>
                  <Text style={styles.trustBadgeLabel}>+{trustBadges.length - 3}</Text>
                </View>
              )}
            </View>
          )}

          {/* Bio - Phase-1 only */}
          {showCarousel && bio && (
            <Text style={[styles.bio]} numberOfLines={2}>
              {bio}
            </Text>
          )}

          {/* Profile prompt - Phase-1 */}
          {profilePrompt && (
            <View style={[styles.promptCard, dark && styles.promptCardDark]}>
              <Text style={[styles.promptQuestion, dark && styles.promptQuestionDark]} numberOfLines={1}>
                {profilePrompt.question}
              </Text>
              <Text style={[styles.promptAnswer, dark && styles.promptAnswerDark]} numberOfLines={2}>
                {profilePrompt.answer}
              </Text>
            </View>
          )}
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
  // Premium gradient overlays
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 100,
    zIndex: 2,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '55%',
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
  // Photo progress bars (Tinder-style)
  barsRow: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 4,
    zIndex: 10,
  },
  barsRowDark: {
    top: 12,
    left: 16,
    right: 16,
  },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  barDark: {
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  barActive: {
    backgroundColor: COLORS.white,
  },
  barActiveDark: {
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  // Arrow button (opens full profile)
  // NOTE: `bottom` is computed dynamically via arrowButtonBottom for device responsiveness
  arrowBtn: {
    position: 'absolute',
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  arrowBtnDark: {
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  // Info overlay — now transparent (gradient handles background)
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 32,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    zIndex: 3,
  },
  overlayDark: {
    paddingHorizontal: 20,
    paddingBottom: 20,
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
  phase2VerifiedBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#9b59b6',
    alignItems: 'center',
    justifyContent: 'center',
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
  // Photo 2: Distance
  phase2DistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phase2DistanceText: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.7)',
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
});
