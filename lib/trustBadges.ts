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
  /** P0 UNIFIED PRESENCE: Presence status from unified system */
  presenceStatus?: PresenceStatus;
  /** @deprecated Use presenceStatus instead. Unix-ms timestamp of last activity */
  lastActive?: number;
  /** Number of photos the user has uploaded */
  photoCount?: number;
  /** User bio text */
  bio?: string;
}

/**
 * Returns an array of 0-4 trust badges based on the available profile data.
 * Safe to call with partial data — missing fields simply skip that badge.
 */
export function getTrustBadges(input: TrustBadgeInput): TrustBadge[] {
  const badges: TrustBadge[] = [];

  // 1. Active Today — from P0 unified presence status
  // Shows for both 'online' and 'active_today' status
  if (input.presenceStatus === 'online' || input.presenceStatus === 'active_today') {
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
