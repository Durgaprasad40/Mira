// lib/distanceRules.ts

/**
 * Single source of truth for distance-based filtering.
 * DO NOT hardcode distance checks anywhere else in the app.
 */

export const DEFAULT_MAX_DISTANCE_KM = 50;

/** "Near Me" threshold in km for Explore categories */
export const NEAR_ME_DISTANCE_KM = 5;

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
