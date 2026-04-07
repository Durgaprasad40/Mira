/**
 * Invisible Profile Ranking System
 *
 * Improves profile ordering without any visible UI changes.
 * Scoring is based on:
 * - Recent activity (how recently user was active)
 * - Profile completeness (photos, bio, interests)
 * - Stable randomness (seeded per profile for consistency)
 *
 * RULES:
 * - No UI changes
 * - No backend changes
 * - Invisible to users
 * - Stable during session
 */

// Seeded random for stable randomness per profile
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Convert to 0-1 range
  return Math.abs(Math.sin(hash) * 10000) % 1;
}

/**
 * Calculate recent activity boost
 * - < 10 min: +50
 * - < 1 hour: +30
 * - < 24 hours: +10
 */
function getActivityBoost(lastActive?: number): number {
  if (!lastActive) return 0;

  const now = Date.now();
  const diffMs = now - lastActive;
  const diffMinutes = diffMs / (1000 * 60);

  if (diffMinutes < 10) return 50;
  if (diffMinutes < 60) return 30;
  if (diffMinutes < 24 * 60) return 10;

  return 0;
}

/**
 * Calculate profile completeness boost
 * - ≥2 photos: +20
 * - bio present: +10
 * - interests/activities present: +10
 */
function getCompletenessBoost(profile: {
  photos?: { url: string }[];
  bio?: string;
  interests?: string[];
  activities?: string[];
}): number {
  let score = 0;

  // Photo boost
  const photoCount = profile.photos?.length ?? 0;
  if (photoCount >= 2) score += 20;

  // Bio boost
  if (profile.bio && profile.bio.trim().length > 0) score += 10;

  // Interests/activities boost
  const hasInterests = (profile.interests?.length ?? 0) > 0;
  const hasActivities = (profile.activities?.length ?? 0) > 0;
  if (hasInterests || hasActivities) score += 10;

  return score;
}

/**
 * Calculate stable randomness boost (0-15)
 * Uses profile ID as seed for consistency during session
 */
function getRandomnessBoost(profileId: string): number {
  return seededRandom(profileId) * 15;
}

/**
 * Calculate total invisible score for a profile
 */
export function calculateProfileScore(profile: {
  id?: string;
  _id?: string;
  lastActive?: number;
  lastActiveAt?: number;
  photos?: { url: string }[];
  bio?: string;
  interests?: string[];
  activities?: string[];
}): number {
  const id = profile.id ?? profile._id ?? '';
  const lastActive = profile.lastActive ?? profile.lastActiveAt;

  const activityBoost = getActivityBoost(lastActive);
  const completenessBoost = getCompletenessBoost(profile);
  const randomnessBoost = getRandomnessBoost(id);

  return activityBoost + completenessBoost + randomnessBoost;
}

/**
 * Sort profiles by invisible score (descending)
 * Returns a new sorted array, does not mutate input
 */
export function sortProfilesByScore<T extends {
  id?: string;
  _id?: string;
  lastActive?: number;
  lastActiveAt?: number;
  photos?: { url: string }[];
  bio?: string;
  interests?: string[];
  activities?: string[];
}>(profiles: T[]): T[] {
  // Calculate scores once
  const scored = profiles.map(p => ({
    profile: p,
    score: calculateProfileScore(p),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return sorted profiles
  return scored.map(s => s.profile);
}
