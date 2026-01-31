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
  /** Verification status: 'unverified' | 'pending_verification' | 'verified' */
  verificationStatus?: string;
  /** Unix-ms timestamp of last activity */
  lastActive?: number;
  /** Unix-ms timestamp of account creation */
  createdAt?: number;
  /** Number of photos the user has uploaded */
  photoCount?: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

/**
 * Returns an array of 0-4 trust badges based on the available profile data.
 * Safe to call with partial data — missing fields simply skip that badge.
 */
export function getTrustBadges(input: TrustBadgeInput): TrustBadge[] {
  const badges: TrustBadge[] = [];
  const now = Date.now();

  // 1. Verification status badge
  const verificationStatus = input.verificationStatus;
  if (verificationStatus === 'verified' || input.isVerified) {
    badges.push({
      key: 'verified',
      label: 'ID Verified',
      icon: 'shield-checkmark',
      color: COLORS.primary,
    });
  } else if (verificationStatus === 'pending_verification') {
    badges.push({
      key: 'pending_verification',
      label: 'Verification Pending',
      icon: 'shield-half-outline',
      color: COLORS.warning,
    });
  }

  // 2. Recently Active — active within the last 24 hours
  if (input.lastActive && now - input.lastActive < ONE_DAY_MS) {
    badges.push({
      key: 'active',
      label: 'Recently Active',
      icon: 'time-outline',
      color: COLORS.success,
    });
  }

  // 3. Established Member — account older than 30 days
  if (input.createdAt && now - input.createdAt >= THIRTY_DAYS_MS) {
    badges.push({
      key: 'established',
      label: 'Established',
      icon: 'calendar-outline',
      color: COLORS.secondary,
    });
  }

  // 4. Photo Rich — 3 or more photos uploaded
  if (input.photoCount && input.photoCount >= 3) {
    badges.push({
      key: 'photos',
      label: 'Photo Rich',
      icon: 'images-outline',
      color: COLORS.superLike,
    });
  }

  return badges;
}
