/**
 * Soft Trust Indicators — compute qualitative trust badges from profile data.
 *
 * Each badge has: key, label, icon (Ionicons name), color.
 * Only badges whose criteria are met are returned.
 */

import { COLORS } from './constants';

export interface TrustBadge {
  key: string;
  label: string;
  icon: string; // Ionicons name
  color: string;
}

interface TrustBadgeInput {
  isVerified?: boolean;
  /** Unix-ms timestamp of last activity */
  lastActive?: number;
  /** Number of photos the user has uploaded */
  photoCount?: number;
  /** User bio text */
  bio?: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns an array of 0-4 trust badges based on the available profile data.
 * Safe to call with partial data — missing fields simply skip that badge.
 */
export function getTrustBadges(input: TrustBadgeInput): TrustBadge[] {
  const badges: TrustBadge[] = [];
  const now = Date.now();

  // 1. Active Today — active within the last 24 hours
  if (input.lastActive && now - input.lastActive < ONE_DAY_MS) {
    badges.push({
      key: 'active',
      label: 'Active Today',
      icon: 'flash-outline',
      color: COLORS.success,
    });
  }

  // 2. Photos Added — 2 or more photos uploaded
  if (input.photoCount && input.photoCount >= 2) {
    badges.push({
      key: 'photos',
      label: 'Photos Added',
      icon: 'images-outline',
      color: COLORS.secondary,
    });
  }

  // 3. Profile Complete — bio >= 20 chars AND photoCount >= 2
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

  // 4. Phone Verified
  if (input.isVerified) {
    badges.push({
      key: 'verified',
      label: 'Phone Verified',
      icon: 'shield-checkmark',
      color: COLORS.superLike,
    });
  }

  return badges;
}
