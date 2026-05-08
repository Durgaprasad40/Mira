// lib/distanceRules.ts

/**
 * Single source of truth for distance-based filtering.
 * DO NOT hardcode distance checks anywhere else in the app.
 */

export const DEFAULT_MAX_DISTANCE_KM = 50;

/** Phase-1 Vibes / Explore Nearby threshold in km */
export const EXPLORE_NEARBY_RADIUS_KM = 5;
/** "Near Me" threshold in km for Explore categories */
export const NEAR_ME_DISTANCE_KM = EXPLORE_NEARBY_RADIUS_KM;

export type ProfileWithDistance = {
  distance?: number | null;
};

/**
 * Returns true if profile is within allowed distance.
 * Profiles without distance are allowed (safe default).
 */
export function isWithinAllowedDistance(
  profile: ProfileWithDistance,
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): boolean {
  if (profile.distance == null) return true;

  if (typeof profile.distance !== "number") return true;

  return profile.distance <= maxDistanceKm;
}

/**
 * Filter an array of profiles to only include those within allowed distance.
 * Profiles without distance are included (safe default).
 */
export function filterProfilesByDistance<T extends ProfileWithDistance>(
  profiles: T[],
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): T[] {
  return profiles.filter((p) => isWithinAllowedDistance(p, maxDistanceKm));
}

/**
 * Format a profile distance value for Phase-1 Discover UI.
 * Backend distance values are stored and returned in kilometers.
 */
export function formatDiscoverDistanceKm(distance?: number | null): string | null {
  if (typeof distance !== "number" || !Number.isFinite(distance)) return null;
  if (distance < 0) return null;
  // Sub-1km: show "< 1 km away" instead of "0 km away" to avoid misleading UX
  // when candidates are very close (Codex P2-3).
  if (distance < 1) return "< 1 km away";
  return `${distance.toFixed(0)} km away`;
}
