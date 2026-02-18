import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
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
  // Legacy props for non-Discover usage (explore grid etc.)
  user?: any;
  onPress?: () => void;
  /** Performance: Called when card is rendered (for timing) */
  onCardRendered?: () => void;
  /** Performance: Called when image loads (for timing) */
  onImageLoad?: () => void;
}

const BLUR_RADIUS = 25; // Strong but recognisable blur

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
  onPress,
  onCardRendered,
  onImageLoad,
}) => {
  const dark = theme === 'dark';
  const TC = dark ? INCOGNITO_COLORS : COLORS;

  // Performance: Track card render once
  const cardRenderedRef = useRef(false);
  useEffect(() => {
    if (!cardRenderedRef.current && onCardRendered) {
      cardRenderedRef.current = true;
      onCardRendered();
    }
  }, [onCardRendered]);

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

  const photoCount = photos?.length || 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // HOLD-LAST-FRAME PHOTO SWITCHING
  // ═══════════════════════════════════════════════════════════════════════════
  // - `targetIndex`: The photo index the user wants to see (changes on tap)
  // - `displayedIndex`: The photo currently shown (only updates when image loads)
  // - When user taps, we set targetIndex but keep showing displayedIndex
  // - A hidden Image preloads targetIndex, and on load success we swap
  // - This ensures NO blank frames, NO skeleton, NO fade between photos
  // ═══════════════════════════════════════════════════════════════════════════

  const [targetIndex, setTargetIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const imageLoadTrackedRef = useRef(false);
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());

  // Clamp indices when photos array changes
  useEffect(() => {
    if (photoCount === 0) {
      setTargetIndex(0);
      setDisplayedIndex(0);
    } else {
      if (targetIndex >= photoCount) setTargetIndex(photoCount - 1);
      if (displayedIndex >= photoCount) setDisplayedIndex(photoCount - 1);
    }
  }, [photoCount, targetIndex, displayedIndex]);

  // Safe access for displayed and target photos
  const safeDisplayedIndex = Math.min(Math.max(0, displayedIndex), Math.max(0, photoCount - 1));
  const safeTargetIndex = Math.min(Math.max(0, targetIndex), Math.max(0, photoCount - 1));
  const displayedPhoto = photos?.[safeDisplayedIndex] || photos?.[0];
  const targetPhoto = photos?.[safeTargetIndex] || photos?.[0];
  const isPending = targetIndex !== displayedIndex;

  // When pending image loads successfully, swap to it
  const handlePendingLoad = useCallback(() => {
    setDisplayedIndex(targetIndex);
    setImageError(false);
    // Track first image load for performance timing
    if (!imageLoadTrackedRef.current && onImageLoad) {
      imageLoadTrackedRef.current = true;
      onImageLoad();
    }
  }, [targetIndex, onImageLoad]);

  // Handle load error for pending image - revert to displayed
  const handlePendingError = useCallback(() => {
    setTargetIndex(displayedIndex);
  }, [displayedIndex]);

  // Handle error on displayed image
  const handleDisplayedError = useCallback(() => {
    setImageError(true);
  }, []);

  // Navigation handlers
  const goNextPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setTargetIndex((i) => (i + 1 < photoCount ? i + 1 : i));
  }, [photoCount]);

  const goPrevPhoto = useCallback(() => {
    if (photoCount <= 1) return;
    setTargetIndex((i) => (i > 0 ? i - 1 : i));
  }, [photoCount]);

  // Aggressive prefetch: preload adjacent photos on mount and index change
  useEffect(() => {
    if (photoCount <= 1) return;

    const prefetchAdjacent = async () => {
      const indicesToPrefetch = [
        targetIndex - 1,
        targetIndex + 1,
        targetIndex + 2,
      ].filter(i => i >= 0 && i < photoCount);

      for (const idx of indicesToPrefetch) {
        const url = photos?.[idx]?.url;
        if (url && !prefetchedUrlsRef.current.has(url)) {
          prefetchedUrlsRef.current.add(url);
          // Fire and forget - don't block
          Image.prefetch(url).catch(() => {});
        }
      }
    };

    // Slight delay to not compete with current image
    const timer = setTimeout(prefetchAdjacent, 50);
    return () => clearTimeout(timer);
  }, [targetIndex, photoCount, photos]);

  // Non-discover mode (explore grid, etc.) — simple card with onPress
  if (!showCarousel && onPress) {
    return (
      <TouchableOpacity style={styles.gridCard} onPress={onPress} activeOpacity={0.8}>
        {/* Show placeholder on image error or missing photo */}
        {displayedPhoto && !imageError ? (
          <Image
            source={{ uri: displayedPhoto.url }}
            style={styles.gridImage}
            contentFit="cover"
            blurRadius={photoBlurred ? BLUR_RADIUS : undefined}
            onError={handleDisplayedError}
            cachePolicy="memory-disk"
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
    <View style={[styles.card, dark && { backgroundColor: INCOGNITO_COLORS.surface }]}>
      {/* Photo area fills entire card */}
      <View style={styles.photoContainer}>
        {/* ═══════════════════════════════════════════════════════════════════
            HOLD-LAST-FRAME RENDERING
            ═══════════════════════════════════════════════════════════════════
            1. Always show displayedPhoto (the last successfully loaded image)
            2. When isPending, mount a HIDDEN image to preload targetPhoto
            3. When hidden image fires onLoad, swap displayedIndex = targetIndex
            4. NO transition, NO skeleton, NO blank frames
            ═══════════════════════════════════════════════════════════════════ */}
        {displayedPhoto && !imageError ? (
          <>
            {/* VISIBLE: Currently displayed image (stable, no changes until swap) */}
            <Image
              source={{ uri: displayedPhoto.url }}
              style={styles.image}
              contentFit="cover"
              blurRadius={photoBlurred ? BLUR_RADIUS : undefined}
              onError={handleDisplayedError}
              cachePolicy="memory-disk"
            />

            {/* HIDDEN PRELOADER: Loads target image in background, triggers swap on success */}
            {isPending && targetPhoto && (
              <Image
                source={{ uri: targetPhoto.url }}
                style={styles.hiddenPreloader}
                contentFit="cover"
                onLoad={handlePendingLoad}
                onError={handlePendingError}
                cachePolicy="memory-disk"
              />
            )}
          </>
        ) : (
          <View style={[styles.photoPlaceholder, dark && { backgroundColor: INCOGNITO_COLORS.accent }]}>
            <Ionicons name="image-outline" size={48} color={TC.textLight} />
          </View>
        )}

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
        {/* Highlight the TARGET index so user sees immediate visual feedback */}
        {showCarousel && photoCount > 1 && (
          <View style={styles.barsRow} pointerEvents="none">
            {photos?.map((_, i) => (
              <View
                key={i}
                style={[styles.bar, i === targetIndex && styles.barActive]}
              />
            ))}
          </View>
        )}

        {/* Arrow button to open full profile */}
        {showCarousel && onOpenProfile && (
          <TouchableOpacity style={styles.arrowBtn} onPress={onOpenProfile} activeOpacity={0.7}>
            <Ionicons name="arrow-up" size={20} color={COLORS.white} />
          </TouchableOpacity>
        )}
      </View>

      {/* Info overlay at bottom */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>
                {name}, {age}
              </Text>
              {isVerified && <Text style={styles.verified}>✔︎</Text>}
            </View>
            {!!city && <Text style={styles.city}>{city}</Text>}
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
            {/* Face 2 only: Intent category chips (up to 2 + overflow) */}
            {dark && phase2VisibleLabels.length > 0 && (
              <View style={styles.phase2IntentRow}>
                {phase2VisibleLabels.map((label, idx) => (
                  <View key={idx} style={styles.phase2IntentChip}>
                    <Text style={styles.phase2IntentText}>{label}</Text>
                  </View>
                ))}
                {phase2OverflowCount > 0 && (
                  <View style={styles.phase2IntentChip}>
                    <Text style={styles.phase2IntentText}>+{phase2OverflowCount}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          {!!distance && (
            <Text style={styles.distance}>{distance.toFixed(0)} km away</Text>
          )}
        </View>

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

        {showCarousel && (
          <Text style={styles.bio} numberOfLines={3}>
            {bio || 'No bio yet'}
          </Text>
        )}

        {profilePrompt && (
          <View style={styles.promptCard}>
            <Text style={styles.promptQuestion} numberOfLines={1}>
              {profilePrompt.question}
            </Text>
            <Text style={styles.promptAnswer} numberOfLines={2}>
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
  photoContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
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
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    gap: 4,
    zIndex: 10,
  },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  barActive: {
    backgroundColor: COLORS.white,
  },
  // Arrow button (opens full profile)
  arrowBtn: {
    position: 'absolute',
    bottom: 140,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  // Info overlay — gradient backdrop for text legibility
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 32,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  verified: {
    fontSize: 18,
    color: COLORS.primary,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  city: {
    fontSize: 14,
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    gap: 4,
    marginTop: 4,
  },
  phase2IntentChip: {
    backgroundColor: 'rgba(155,89,182,0.3)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  phase2IntentText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
  bio: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 20,
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Profile prompt card
  promptCard: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
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
  promptAnswer: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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

  // HOLD-LAST-FRAME: Hidden preloader image (offscreen, 1x1 pixel)
  // Loads the target image in background without being visible
  hiddenPreloader: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    // Position offscreen as extra safety
    left: -9999,
    top: -9999,
  },
});
