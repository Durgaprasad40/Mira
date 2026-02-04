/**
 * Client-side profile ranking — sorts profiles by weighted signals.
 *
 * Pure function: no side-effects, no state, no filtering.
 * Returns a new sorted array; the original is not mutated.
 *
 * Signals & weights (higher = shown first):
 *   1. Active Today  (lastActive < 24h)     → +100
 *   2. Distance      (nearer first)          → up to +50  (linear decay over 100 km)
 *   3. Trust badges  (more = slight boost)   → +10 per badge (max +40)
 *   4. Recency       (createdAt freshness)   → up to +30  (linear decay over 90 days)
 */

import type { ProfileData } from './profileData';
import { getTrustBadges } from './trustBadges';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * ONE_DAY_MS;

// Weight caps
const W_ACTIVE = 100;
const W_DISTANCE_MAX = 50;
const W_BADGE = 10; // per badge
const W_RECENCY_MAX = 30;

// Distance ceiling — profiles beyond this get 0 distance points
const DISTANCE_CEIL_KM = 100;

function scoreProfile(p: ProfileData, now: number): number {
  let score = 0;

  // 1. Active Today — binary boost
  if (p.lastActive && now - p.lastActive < ONE_DAY_MS) {
    score += W_ACTIVE;
  }

  // 2. Distance — linear: 0 km → +50, ≥100 km → +0
  if (p.distance != null && p.distance >= 0) {
    score += W_DISTANCE_MAX * Math.max(0, 1 - p.distance / DISTANCE_CEIL_KM);
  }

  // 3. Trust badge count
  const badges = getTrustBadges({
    isVerified: p.isVerified,
    lastActive: p.lastActive,
    photoCount: p.photos?.length,
    bio: p.bio,
  });
  score += badges.length * W_BADGE;

  // 4. Recency — linear: just created → +30, ≥90 days old → +0
  if (p.createdAt) {
    const age = now - p.createdAt;
    score += W_RECENCY_MAX * Math.max(0, 1 - age / NINETY_DAYS_MS);
  }

  return score;
}

/**
 * Sort ProfileData[] by weighted ranking score (descending).
 * Stable sort preserves original order for profiles with equal scores.
 */
export function rankProfiles(profiles: ProfileData[]): ProfileData[] {
  if (profiles.length <= 1) return profiles;
  const now = Date.now();
  // Cache scores to avoid recomputation during sort
  const scores = new Map<string, number>();
  for (const p of profiles) {
    scores.set(p.id, scoreProfile(p, now));
  }
  return [...profiles].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Nearby-specific ranking
// ---------------------------------------------------------------------------

interface NearbyRankable {
  _id: string;
  freshness: 'solid' | 'faded';
  isVerified?: boolean;
  lastLocationUpdatedAt?: number;
}

/**
 * Rank nearby profiles: solid freshness first, then by recency of location update.
 */
export function rankNearbyProfiles<T extends NearbyRankable>(profiles: T[]): T[] {
  if (profiles.length <= 1) return profiles;
  return [...profiles].sort((a, b) => {
    // Solid before faded (+1 vs 0)
    const fa = a.freshness === 'solid' ? 1 : 0;
    const fb = b.freshness === 'solid' ? 1 : 0;
    if (fa !== fb) return fb - fa;
    // More recent location update first
    const la = a.lastLocationUpdatedAt ?? 0;
    const lb = b.lastLocationUpdatedAt ?? 0;
    return lb - la;
  });
}
