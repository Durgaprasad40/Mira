/**
 * NearbyPreviewCard
 *
 * Phase-3 lightweight preview card shown when a Nearby pin is tapped.
 * Presents a single-step confirmation surface BEFORE opening the full
 * profile screen, so users can decide whether to invest in a deeper view.
 *
 * Privacy contract (inherited from Phase-2.5):
 *   - No coordinates or numeric distance are rendered anywhere here.
 *   - Only freshnessLabel, tagline (short), and sharedInterests (up to 3)
 *     from the existing Nearby payload.
 *
 * Design rules:
 *   - Pure RN Modal (consistent with other modals in the app — see
 *     components/chatroom/ViewProfileModal.tsx).
 *   - No network calls of its own; all fields are props.
 *   - Minimal surface area: name + age, 1 photo, freshness chip, tagline,
 *     shared-interest chips, and two CTAs ("View profile", "Like").
 */
import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

export interface NearbyPreviewData {
  id: string;
  name: string;
  age: number;
  photoUrl: string | null;
  freshnessLabel?: 'recent' | 'earlier' | 'stale';
  tagline?: string;
  sharedInterests?: string[];
  isVerified?: boolean;
}

interface NearbyPreviewCardProps {
  visible: boolean;
  user: NearbyPreviewData | null;
  onClose: () => void;
  onViewProfile: (user: NearbyPreviewData) => void;
  onLike?: (user: NearbyPreviewData) => void;
}

const FRESHNESS_COPY: Record<'recent' | 'earlier' | 'stale', { text: string; icon: keyof typeof Ionicons.glyphMap }> = {
  recent: { text: 'Recently here', icon: 'time-outline' },
  earlier: { text: 'Earlier', icon: 'hourglass-outline' },
  stale: { text: 'A while ago', icon: 'calendar-outline' },
};

function prettifyInterest(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function NearbyPreviewCard({
  visible,
  user,
  onClose,
  onViewProfile,
  onLike,
}: NearbyPreviewCardProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      opacity.setValue(0);
      translateY.setValue(16);
    }
  }, [visible, opacity, translateY]);

  if (!user) return null;

  const freshness = user.freshnessLabel ? FRESHNESS_COPY[user.freshnessLabel] : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop propagation so taps inside the card don't dismiss it */}
        <Pressable>
          <Animated.View style={[styles.card, { opacity, transform: [{ translateY }] }]}>
            <View style={styles.photoWrap}>
              {user.photoUrl ? (
                <Image source={{ uri: user.photoUrl }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoFallback]}>
                  <Ionicons name="person-outline" size={42} color={COLORS.textMuted} />
                </View>
              )}
              {user.isVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                </View>
              )}
            </View>

            <View style={styles.titleRow}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
                <Text style={styles.age}>{`, ${user.age}`}</Text>
              </Text>
              {freshness && (
                <View style={styles.freshnessChip}>
                  <Ionicons name={freshness.icon} size={12} color={COLORS.textMuted} />
                  <Text style={styles.freshnessChipText}>{freshness.text}</Text>
                </View>
              )}
            </View>

            {user.tagline ? (
              <Text style={styles.tagline} numberOfLines={2}>
                {user.tagline}
              </Text>
            ) : null}

            {user.sharedInterests && user.sharedInterests.length > 0 && (
              <View style={styles.chipsRow}>
                {user.sharedInterests.slice(0, 3).map((interest) => (
                  <View key={interest} style={styles.interestChip}>
                    <Ionicons name="sparkles-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.interestChipText}>{prettifyInterest(interest)}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.ctaRow}>
              <TouchableOpacity
                style={[styles.ctaButton, styles.ctaSecondary]}
                onPress={() => onViewProfile(user)}
                accessibilityRole="button"
                accessibilityLabel="View profile"
              >
                <Ionicons name="person-circle-outline" size={18} color={COLORS.text} />
                <Text style={styles.ctaSecondaryText}>View profile</Text>
              </TouchableOpacity>

              {onLike && (
                <TouchableOpacity
                  style={[styles.ctaButton, styles.ctaPrimary]}
                  onPress={() => onLike(user)}
                  accessibilityRole="button"
                  accessibilityLabel="Like"
                >
                  <Ionicons name="heart" size={18} color="#fff" />
                  <Text style={styles.ctaPrimaryText}>Like</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
    paddingBottom: 48,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  photoWrap: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  photo: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: COLORS.backgroundDark,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: -2,
    backgroundColor: COLORS.background,
    borderRadius: 10,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 1,
  },
  age: {
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  freshnessChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  freshnessChipText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  tagline: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  interestChipText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ctaButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 22,
  },
  ctaSecondary: {
    backgroundColor: COLORS.backgroundDark,
  },
  ctaSecondaryText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ctaPrimary: {
    backgroundColor: COLORS.primary,
  },
  ctaPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default NearbyPreviewCard;
