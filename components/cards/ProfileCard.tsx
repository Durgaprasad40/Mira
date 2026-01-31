import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';
import { MatchQualityIndicator } from './MatchQualityIndicator';
import type { IntentCompat } from '@/lib/intentCompat';
import type { TrustBadge } from '@/lib/trustBadges';

export interface ProfileCardProps {
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  distance?: number;
  photos: { url: string }[];
  matchQuality?: number;
  /** Shared activity labels between current user and this profile */
  sharedInterests?: string[];
  /** Relationship intent display */
  intentLabel?: string;
  intentEmoji?: string;
  intentCompat?: IntentCompat;
  /** Trust badges computed via getTrustBadges() */
  trustBadges?: TrustBadge[];
  /** Enable photo carousel + swipe mode (Discover card) */
  showCarousel?: boolean;
  /** When "dark", uses INCOGNITO_COLORS for Face 2 dark theme */
  theme?: 'light' | 'dark';
  /** Called when user taps the arrow to view full profile */
  onOpenProfile?: () => void;
  // Legacy props for non-Discover usage (explore grid etc.)
  user?: any;
  onPress?: () => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  name,
  age,
  bio,
  city,
  isVerified,
  distance,
  photos,
  matchQuality,
  sharedInterests,
  intentLabel,
  intentEmoji,
  intentCompat,
  trustBadges,
  showCarousel = false,
  theme = 'light',
  onOpenProfile,
  user,
  onPress,
}) => {
  const dark = theme === 'dark';
  const TC = dark ? INCOGNITO_COLORS : COLORS;
  const [photoIndex, setPhotoIndex] = useState(0);

  const photoCount = photos?.length || 0;
  const currentPhoto = photos?.[photoIndex] || photos?.[0];

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
        {currentPhoto ? (
          <Image source={{ uri: currentPhoto.url }} style={styles.gridImage} contentFit="cover" />
        ) : null}
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
        {currentPhoto ? (
          <Image
            source={{ uri: currentPhoto.url }}
            style={styles.image}
            contentFit="cover"
          />
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
        {showCarousel && photoCount > 1 && (
          <View style={styles.barsRow} pointerEvents="none">
            {photos.map((_, i) => (
              <View
                key={i}
                style={[styles.bar, i === photoIndex && styles.barActive]}
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

      {/* Info overlay at bottom — gradient style */}
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
          </View>
          {!!distance && (
            <Text style={styles.distance}>{distance.toFixed(0)} km away</Text>
          )}
        </View>

        {trustBadges && trustBadges.length > 0 && (
          <View style={styles.trustBadgeRow}>
            {trustBadges.map((badge) => (
              <View key={badge.key} style={[styles.trustBadgeCompact, { backgroundColor: badge.color + '30' }]}>
                <Ionicons name={badge.icon as any} size={11} color={COLORS.white} />
                <Text style={styles.trustBadgeLabel}>{badge.label}</Text>
              </View>
            ))}
          </View>
        )}

        {!!intentLabel && (
          <View style={[
            styles.intentChip,
            intentCompat === 'match' && styles.intentMatch,
            intentCompat === 'partial' && styles.intentPartial,
            intentCompat === 'mismatch' && styles.intentMismatch,
          ]}>
            <Text style={styles.intentText}>
              {intentEmoji} {intentLabel}
            </Text>
          </View>
        )}

        {!!bio && (
          <Text style={styles.bio} numberOfLines={2}>
            {bio}
          </Text>
        )}
        {sharedInterests && sharedInterests.length > 0 && (
          <View style={styles.sharedRow}>
            <Ionicons name="heart-half" size={13} color={COLORS.secondary} />
            <Text style={styles.sharedText}>
              {sharedInterests.length} shared {sharedInterests.length === 1 ? 'interest' : 'interests'}
              {' \u00B7 '}
              {sharedInterests.slice(0, 3).join(', ')}
            </Text>
          </View>
        )}
        {matchQuality !== undefined && (
          <View style={styles.matchQualityContainer}>
            <MatchQualityIndicator score={matchQuality} showLabel={false} />
          </View>
        )}
      </View>
    </View>
  );
};

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
    bottom: 130,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  // Info overlay — sits above floating action buttons
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 24,
    paddingHorizontal: 16,
    paddingBottom: 110, // room for floating action buttons overlay
    backgroundColor: 'transparent',
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
  distance: {
    fontSize: 14,
    color: COLORS.white,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bio: {
    fontSize: 14,
    color: COLORS.white,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  intentChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  intentMatch: {
    backgroundColor: 'rgba(76,175,80,0.25)',
  },
  intentPartial: {
    backgroundColor: 'rgba(255,152,0,0.25)',
  },
  intentMismatch: {
    backgroundColor: 'rgba(244,67,54,0.25)',
  },
  intentText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    backgroundColor: 'rgba(78,205,196,0.18)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sharedText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  matchQualityContainer: {
    marginTop: 8,
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
});
