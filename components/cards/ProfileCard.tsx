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
  /** Phase-1 only: Activities/interests keys */
  activities?: string[];
  /** True if user has incognito mode enabled (shows badge) */
  isIncognito?: boolean;
  /** Explore category tag - shows "Why this profile" label above name */
  exploreTag?: string;
  /** Last active timestamp for "Active Now" badge */
  lastActive?: number;
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
  onPress,
}) => {
  const dark = theme === 'dark';
  const TC = dark ? INCOGNITO_COLORS : COLORS;
  const { height: windowHeight } = useWindowDimensions();

  // Responsive bottom offset for arrow button (was hardcoded 140px)
  // On ~850px device, 140px ≈ 16.5% from bottom — scale proportionally
  const arrowButtonBottom = Math.round(windowHeight * 0.165);

  // Face 2 only: Look up intent category labels from keys (array)
  const phase2IntentLabels = useMemo(() => {
    if (!dark || !privateIntentKeys || privateIntentKeys.length === 0) return [];
    return privateIntentKeys
      .map(key => PRIVATE_INTENT_CATEGORIES.find(c => c.key === key))
      .filter(Boolean)
      .map(c => c!.label);
  }, [dark, privateIntentKeys]);

  // Phase-2: Show max 2 labels + overflow count
  const phase2VisibleLabels = phase2IntentLabels.slice(0, 2);
  const phase2OverflowCount = phase2IntentLabels.length > 2 ? phase2IntentLabels.length - 2 : 0;

  // Check if user is active now (within 10 minutes)
  const isActiveNow = useMemo(() => {
    if (!lastActive) return false;
    const tenMinutesMs = 10 * 60 * 1000;
    return (Date.now() - lastActive) < tenMinutesMs;
  }, [lastActive]);

  // Phase-1 only: Compute "Looking for" text
  const lookingForText = useMemo(() => {
    if (dark || !lookingFor || lookingFor.length === 0) return null;
    if (lookingFor.length >= 3) return 'Looking for: Everyone';
    const labels = lookingFor.map(g => GENDER_LABELS[g] || g).filter(Boolean);
    const unique = [...new Set(labels)];
    return unique.length > 0 ? `Looking for: ${unique.join(', ')}` : null;
  }, [dark, lookingFor]);

  // Phase-1 only: Get relationship intent labels
  const intentLabels = useMemo(() => {
    if (dark || !relationshipIntent || relationshipIntent.length === 0) return [];
    return relationshipIntent
      .map(key => RELATIONSHIP_INTENTS.find(i => i.value === key))
      .filter(Boolean)
      .slice(0, 2) // Show max 2 on card
      .map(i => i!.label);
  }, [dark, relationshipIntent]);

  // Phase-1 only: Get activity labels with emojis
  const activityItems = useMemo(() => {
    if (dark || !activities || activities.length === 0) return [];
    return activities
      .map(key => ACTIVITY_FILTERS.find(a => a.value === key))
      .filter(Boolean)
      .slice(0, 3) // Show max 3 on card
      .map(a => ({ emoji: a!.emoji, label: a!.label }));
  }, [dark, activities]);

  const [photoIndex, setPhotoIndex] = useState(0);
  // 7-1: Track image load errors to show placeholder on failure
  const [imageError, setImageError] = useState(false);

  const photoCount = photos?.length || 0;

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
    setPhotoIndex((i) => (i + 1 < photoCount ? i + 1 : i));
  }, [photoCount]);

  const goPrevPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setPhotoIndex((i) => (i > 0 ? i - 1 : i));
  }, [photoCount]);

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
        {showCarousel && photoCount > 1 && (
          <>
            <Pressable
              style={styles.tapZoneLeft}
              onPress={goPrevPhoto}
            />
            <Pressable
              style={styles.tapZoneRight}
              onPress={goNextPhoto}
            />
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
            {/* City - subtler styling */}
            {!!city && (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={13} color={dark ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.8)'} />
                <Text style={[styles.city, dark && styles.cityDark]}>{city}</Text>
              </View>
            )}
            {/* Phase-1 only: Looking for + intent chips */}
            {!dark && (lookingForText || intentLabels.length > 0) && (
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
            {!dark && activityItems.length > 0 && (
              <View style={styles.activityChipRow}>
                {activityItems.map((item, idx) => (
                  <View key={idx} style={styles.activityChip}>
                    <Text style={styles.activityChipText}>{item.emoji} {item.label}</Text>
                  </View>
                ))}
              </View>
            )}
            {/* Phase-2 (Dark): Premium intent chips */}
            {dark && phase2VisibleLabels.length > 0 && (
              <View style={styles.phase2IntentRow}>
                {phase2VisibleLabels.map((label, idx) => (
                  <View key={idx} style={styles.phase2IntentChipDark}>
                    <Text style={styles.phase2IntentTextDark}>{label}</Text>
                  </View>
                ))}
                {phase2OverflowCount > 0 && (
                  <View style={styles.phase2IntentChipOverflow}>
                    <Text style={styles.phase2IntentTextDark}>+{phase2OverflowCount}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          {!!distance && (
            <Text style={[styles.distance, dark && styles.distanceDark]}>{distance.toFixed(0)} km</Text>
          )}
        </View>

        {/* Trust badges - only show in light mode (Phase-1) */}
        {!dark && trustBadges && trustBadges.length > 0 && (
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

        {/* Bio - improved readability */}
        {showCarousel && bio && (
          <Text style={[styles.bio, dark && styles.bioDark]} numberOfLines={2}>
            {bio}
          </Text>
        )}

        {/* Profile prompt - premium card styling for dark mode */}
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
  phase2IntentChip: {
    backgroundColor: 'rgba(155,89,182,0.3)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
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
});
