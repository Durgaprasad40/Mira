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
import { getVerificationDisplay } from '@/lib/verificationStatus';

export interface NearbyPreviewData {
  id: string;
  historyId?: string;
  name: string;
  age: number;
  photoUrl: string | null;
  freshnessLabel?: 'recent' | 'earlier' | 'stale';
  tagline?: string;
  sharedInterests?: string[];
  isVerified?: boolean;
  verificationStatus?: string | null;
  crossingCount?: number;
  // Capped display ("1" / "2" / "3+") — clients should prefer this over
  // crossingCount for any UI string (Fix 4: no raw counts to displays).
  crossingCountDisplay?: string;
  lastCrossedAt?: number;
  areaName?: string;
  strongPrivacyMode?: boolean;
  hideDistance?: boolean;
}

interface NearbyPreviewCardProps {
  visible: boolean;
  user: NearbyPreviewData | null;
  onClose: () => void;
  onViewProfile: (user: NearbyPreviewData) => void;
  onLike?: (user: NearbyPreviewData) => void;
  onRemove?: (user: NearbyPreviewData) => void;
}

const FRESHNESS_COPY: Record<'recent' | 'earlier' | 'stale', { text: string; icon: keyof typeof Ionicons.glyphMap }> = {
  recent: { text: 'Crossed nearby', icon: 'time-outline' },
  earlier: { text: 'Crossed earlier', icon: 'hourglass-outline' },
  stale: { text: 'Crossed last week', icon: 'calendar-outline' },
};

function prettifyInterest(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatCrossingCount(count?: number, display?: string): string | null {
  if (typeof count !== 'number' || count < 1) return null;
  const safeCount = Math.floor(count);
  if (safeCount === 1) return 'Crossed once';
  // Prefer the server-provided bucketed display ("2" / "3+") so we never leak
  // raw counts in user-visible strings (Fix 4).
  const label = display && display.trim().length > 0 ? display : String(safeCount);
  return `Crossed ${label} times`;
}

function formatLastCrossed(timestamp?: number): string | null {
  if (typeof timestamp !== 'number') return null;
  const now = new Date();
  const crossed = new Date(timestamp);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const crossedStart = new Date(
    crossed.getFullYear(),
    crossed.getMonth(),
    crossed.getDate(),
  ).getTime();
  const daysAgo = Math.max(0, Math.floor((todayStart - crossedStart) / (24 * 60 * 60 * 1000)));

  if (daysAgo === 0) return 'Last crossed today';
  if (daysAgo < 7) return `Last crossed ${daysAgo}d ago`;
  return 'Last crossed last week';
}

export function NearbyPreviewCard({
  visible,
  user,
  onClose,
  onViewProfile,
  onLike,
  onRemove,
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
  const crossingCountText = formatCrossingCount(user.crossingCount, user.crossingCountDisplay);
  const lastCrossedText = formatLastCrossed(user.lastCrossedAt);
  const areaName = user.areaName?.trim();
  const privacyDisclosureText = user.hideDistance
    ? 'Distance hidden for privacy'
    : user.strongPrivacyMode
    ? 'Approximate area'
    : null;
  const hasCrossingMeta = Boolean(crossingCountText || areaName || lastCrossedText || privacyDisclosureText);
  const verificationDisplay = getVerificationDisplay({
    isVerified: user.isVerified,
    verificationStatus: user.verificationStatus,
  });

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
            </View>

            <View style={styles.titleRow}>
              <View style={styles.titleTextGroup}>
                <Text style={styles.name} numberOfLines={1}>
                  {user.name}
                  <Text style={styles.age}>{`, ${user.age}`}</Text>
                </Text>
                <View style={styles.verificationRow}>
                  <View
                    style={[
                      styles.verificationDot,
                      verificationDisplay.tone === 'verified' && styles.verificationDotVerified,
                      verificationDisplay.tone === 'pending' && styles.verificationDotPending,
                      verificationDisplay.tone === 'unverified' && styles.verificationDotUnverified,
                    ]}
                  />
                  <Text
                    style={[
                      styles.verificationText,
                      verificationDisplay.tone === 'verified' && styles.verificationTextVerified,
                      verificationDisplay.tone === 'pending' && styles.verificationTextPending,
                      verificationDisplay.tone === 'unverified' && styles.verificationTextUnverified,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {verificationDisplay.label}
                  </Text>
                </View>
              </View>
              {freshness && (
                <View style={styles.freshnessChip}>
                  <Ionicons name={freshness.icon} size={12} color={COLORS.textMuted} />
                  <Text style={styles.freshnessChipText}>{freshness.text}</Text>
                </View>
              )}
            </View>

            {hasCrossingMeta && (
              <View style={styles.crossingMeta}>
                <View style={styles.crossingMetaTop}>
                  {crossingCountText && (
                    <View style={styles.crossingCountPill}>
                      <Ionicons name="repeat-outline" size={12} color={COLORS.primary} />
                      <Text style={styles.crossingCountText}>{crossingCountText}</Text>
                    </View>
                  )}
                  {areaName ? (
                    <Text style={styles.areaNameText} numberOfLines={1}>
                      {areaName}
                    </Text>
                  ) : null}
                </View>
                {lastCrossedText ? (
                  <Text style={styles.lastCrossedText}>{lastCrossedText}</Text>
                ) : null}
                {privacyDisclosureText ? (
                  <View style={styles.privacyDisclosureRow}>
                    <Ionicons
                      name={user.hideDistance ? 'eye-off-outline' : 'shield-checkmark-outline'}
                      size={12}
                      color={COLORS.textMuted}
                    />
                    <Text style={styles.privacyDisclosureText}>{privacyDisclosureText}</Text>
                  </View>
                ) : null}
              </View>
            )}

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

            {onRemove && (
              <TouchableOpacity
                style={styles.removeAction}
                onPress={() => onRemove(user)}
                accessibilityRole="button"
                accessibilityLabel="Remove from Nearby"
              >
                <Text style={styles.removeActionText}>Remove</Text>
              </TouchableOpacity>
            )}
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
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  titleTextGroup: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  age: {
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  // Row that hosts the verification status dot + label below the name.
  verificationRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  verificationDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.textMuted,
  },
  verificationDotVerified: {
    backgroundColor: '#10B981',
  },
  verificationDotPending: {
    backgroundColor: '#F59E0B',
  },
  verificationDotUnverified: {
    backgroundColor: '#EF4444',
  },
  verificationText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  // Premium tone-driven verification colors on the light Nearby surface.
  //   Verified: emerald (#10B981)
  //   Pending:  amber (#F59E0B)
  //   Not verified: red (#EF4444)
  verificationTextVerified: {
    color: '#10B981',
  },
  verificationTextPending: {
    color: '#F59E0B',
  },
  verificationTextUnverified: {
    color: '#EF4444',
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
  crossingMeta: {
    marginBottom: 10,
    gap: 5,
  },
  crossingMetaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crossingCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  crossingCountText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
  },
  areaNameText: {
    flexShrink: 1,
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  lastCrossedText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  privacyDisclosureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  privacyDisclosureText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
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
  removeAction: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeActionText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '600',
  },
});

export default NearbyPreviewCard;
