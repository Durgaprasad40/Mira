/**
 * Soft Trust Indicators — compute qualitative trust badges from profile data.
 *
 * Each badge has: key, label, icon (Ionicons name), color.
 * Only badges whose criteria are met are returned.
 */

import { COLORS } from './constants';
import type { PresenceStatus } from '@/hooks/usePresence';

export interface TrustBadge {
  key: string;
  label: string;
  icon: string; // Ionicons name
  color: string;
}

interface TrustBadgeInput {
  isVerified?: boolean;
  /** P0-FIX: Face verification status (selfie-verified identity) */
  faceVerified?: boolean;
  /** P0 UNIFIED PRESENCE: Presence status from unified system */
  presenceStatus?: PresenceStatus;
  /** @deprecated Use presenceStatus instead. Unix-ms timestamp of last activity */
  lastActive?: number;
  /** Number of photos the user has uploaded */
  photoCount?: number;
  /** User bio text */
  bio?: string;
  /** GROWTH: True if user is popular (high likes received in area) */
  isPopular?: boolean;
}

/**
 * Returns an array of 0-4 trust badges based on the available profile data.
 * Safe to call with partial data — missing fields simply skip that badge.
 */
export function getTrustBadges(input: TrustBadgeInput): TrustBadge[] {
  const badges: TrustBadge[] = [];

  // P0-FIX: 1. Face Verified — highest priority trust signal (selfie verification)
  if (input.faceVerified) {
    badges.push({
      key: 'face_verified',
      label: 'Face Verified',
      icon: 'checkmark-circle',
      color: '#3B82F6', // Blue - distinguishes from other badges
    });
  }

  // 2. Active Today — from P0 unified presence status
  // Shows for both 'online' and 'active_today' status
  if (input.presenceStatus === 'online' || input.presenceStatus === 'active_today') {
    badges.push({
      key: 'active',
      label: 'Active Today',
      icon: 'flash-outline',
      color: COLORS.success,
    });
  }

  // 3. Photos Added — 2 or more photos uploaded
  if (input.photoCount && input.photoCount >= 2) {
    badges.push({
      key: 'photos',
      label: 'Photos Added',
      icon: 'images-outline',
      color: COLORS.secondary,
    });
  }

  // 4. Profile Complete — bio >= 20 chars AND photoCount >= 2
  if (
    input.bio &&
    input.bio.length >= 20 &&
    input.photoCount &&
    input.photoCount >= 2
  ) {
    badges.push({
      key: 'complete',
      label: 'Profile Complete',
      icon: 'checkmark-done-outline',
      color: COLORS.primary,
    });
  }

  // 5. Identity Verified (phone verification) — P0-FIX: updated wording
  if (input.isVerified) {
    badges.push({
      key: 'verified',
      label: 'Identity Verified',
      icon: 'shield-checkmark',
      color: COLORS.superLike,
    });
  }

  // GROWTH: 6. Popular - high engagement in area (likes received)
  if (input.isPopular) {
    badges.push({
      key: 'popular',
      label: 'Popular',
      icon: 'trending-up',
      color: '#F59E0B', // Amber - attention-grabbing
    });
  }

  return badges;
}
