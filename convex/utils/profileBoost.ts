/**
 * Profile Completion Boost Utility
 *
 * SAFE, LIGHTWEIGHT ranking boost based on profile completion.
 *
 * CRITICAL RULES:
 * - Boost is ADDITIVE only (0-4 points max)
 * - Does NOT dominate base score
 * - Does NOT penalize low-completion users
 * - Does NOT change eligibility/filtering
 * - Null-safe with graceful fallbacks
 *
 * BOOST MODEL:
 * - < 50% completion → +0
 * - 50-64% → +1
 * - 65-79% → +2
 * - 80-89% → +3
 * - 90-100% → +4
 *
 * NEW USER PROTECTION:
 * - Users created within 48 hours get minimum boost of +1
 * - This neutralizes completion disadvantage for new users
 */

import { CandidateProfile } from '../discoverRanking';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum boost value (HARD LIMIT - never exceeded)
 */
const MAX_BOOST = 4;

/**
 * New user protection threshold (48 hours in ms)
 */
const NEW_USER_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/**
 * Minimum boost for new users (neutralizes completion disadvantage)
 */
const NEW_USER_MIN_BOOST = 1;

// ---------------------------------------------------------------------------
// Profile Completion Calculation (Server-Side)
// ---------------------------------------------------------------------------

/**
 * Profile field weights for completion scoring.
 * Total: 100 points
 *
 * BASE PROFILE (50 points - from onboarding):
 * - name: 8 points
 * - dateOfBirth: 5 points (implicit - age exists)
 * - gender: 5 points (implicit - gender exists)
 * - faceVerification: 10 points
 * - photos (min 2): 12 points
 * - lookingFor: 5 points
 * - relationshipIntent: 5 points
 *
 * OPTIONAL PROFILE (50 points):
 * - bio: 10 points
 * - prompt 1: 8 points
 * - prompt 2: 8 points
 * - prompt 3: 8 points
 * - 3rd photo: 5 points
 * - 4th photo: 5 points
 * - education: 3 points
 * - job: 3 points
 */

interface ProfileCompletionWeights {
  name: number;
  age: number;
  gender: number;
  verification: number;
  photosBase: number;
  lookingFor: number;
  relationshipIntent: number;
  bio: number;
  prompt1: number;
  prompt2: number;
  prompt3: number;
  photo3: number;
  photo4: number;
  education: number;
  job: number;
}

const WEIGHTS: ProfileCompletionWeights = {
  name: 8,
  age: 5,
  gender: 5,
  verification: 10,
  photosBase: 12,
  lookingFor: 5,
  relationshipIntent: 5,
  bio: 10,
  prompt1: 8,
  prompt2: 8,
  prompt3: 8,
  photo3: 5,
  photo4: 5,
  education: 3,
  job: 3,
};

/**
 * Calculate profile completion percentage for a candidate.
 * Returns a value between 0 and 100.
 *
 * @param profile - Candidate profile from discover ranking
 * @returns Completion percentage (0-100)
 */
export function calculateProfileCompletionScore(
  profile: CandidateProfile | null | undefined
): number {
  // Null safety - return 0 for missing data
  if (!profile) {
    return 0;
  }

  let score = 0;

  // BASE PROFILE (50 points)

  // Name (8 points)
  if (profile.name && profile.name.trim().length > 0) {
    score += WEIGHTS.name;
  }

  // Age/DOB (5 points) - implicit if age exists and > 0
  if (profile.age && profile.age > 0) {
    score += WEIGHTS.age;
  }

  // Gender (5 points) - implicit if gender exists
  if (profile.gender && profile.gender.length > 0) {
    score += WEIGHTS.gender;
  }

  // Face verification (10 points)
  if (profile.isVerified) {
    score += WEIGHTS.verification;
  }

  // Photos base - min 2 (12 points)
  const photoCount = profile.photoCount ?? 0;
  if (photoCount >= 2) {
    score += WEIGHTS.photosBase;
  }

  // Looking for (5 points)
  if (profile.lookingFor && profile.lookingFor.length > 0) {
    score += WEIGHTS.lookingFor;
  }

  // Relationship intent (5 points)
  if (profile.relationshipIntent && profile.relationshipIntent.length > 0) {
    score += WEIGHTS.relationshipIntent;
  }

  // OPTIONAL PROFILE (50 points)

  // Bio (10 points) - require minimum length
  const bioLength = profile.bio?.trim().length ?? 0;
  if (bioLength >= 10) {
    score += WEIGHTS.bio;
  }

  // Prompts (8 points each, up to 3)
  const prompts = profile.profilePrompts ?? [];
  const filledPrompts = prompts.filter(
    (p) => p && p.answer && p.answer.trim().length > 0
  ).length;

  if (filledPrompts >= 1) score += WEIGHTS.prompt1;
  if (filledPrompts >= 2) score += WEIGHTS.prompt2;
  if (filledPrompts >= 3) score += WEIGHTS.prompt3;

  // Additional photos (5 points each)
  if (photoCount >= 3) score += WEIGHTS.photo3;
  if (photoCount >= 4) score += WEIGHTS.photo4;

  // Education (3 points)
  if (profile.education && profile.education.length > 0) {
    score += WEIGHTS.education;
  }

  // Job (3 points)
  if (profile.jobTitle && profile.jobTitle.trim().length > 0) {
    score += WEIGHTS.job;
  }

  // Ensure score is within bounds
  return Math.min(Math.max(score, 0), 100);
}

// ---------------------------------------------------------------------------
// Boost Calculation
// ---------------------------------------------------------------------------

/**
 * Convert profile completion percentage to boost value.
 *
 * BOOST MODEL (STRICT):
 * - < 50% → +0
 * - 50-64% → +1
 * - 65-79% → +2
 * - 80-89% → +3
 * - 90-100% → +4
 *
 * @param completionPercentage - Profile completion (0-100)
 * @returns Boost value (0-4)
 */
export function completionToBoost(completionPercentage: number): number {
  // Null/invalid safety
  if (typeof completionPercentage !== 'number' || isNaN(completionPercentage)) {
    return 0;
  }

  // Clamp to valid range
  const clamped = Math.min(Math.max(completionPercentage, 0), 100);

  // Apply boost thresholds
  if (clamped >= 90) return 4;
  if (clamped >= 80) return 3;
  if (clamped >= 65) return 2;
  if (clamped >= 50) return 1;
  return 0;
}

/**
 * Check if a user is considered "new" (within 48 hours of creation).
 *
 * @param createdAt - User creation timestamp
 * @returns True if user is new
 */
export function isNewUser(createdAt: number | undefined): boolean {
  if (!createdAt || typeof createdAt !== 'number') {
    return false;
  }

  const now = Date.now();
  const age = now - createdAt;

  return age <= NEW_USER_THRESHOLD_MS;
}

/**
 * Get profile completion boost for a candidate.
 *
 * This is the MAIN FUNCTION to use in ranking logic.
 *
 * Features:
 * - Calculates completion percentage
 * - Converts to boost (0-4)
 * - Applies new user protection
 * - Null-safe with default 0
 *
 * @param profile - Candidate profile from discover ranking
 * @returns Boost value (0-4), guaranteed integer
 */
export function getProfileCompletionBoost(
  profile: CandidateProfile | null | undefined
): number {
  // Null safety - return 0 for missing profile
  if (!profile) {
    return 0;
  }

  // Calculate completion percentage
  const completionPercentage = calculateProfileCompletionScore(profile);

  // Convert to boost
  let boost = completionToBoost(completionPercentage);

  // Apply new user protection
  // New users get minimum boost to neutralize completion disadvantage
  if (isNewUser(profile.createdAt)) {
    boost = Math.max(boost, NEW_USER_MIN_BOOST);
  }

  // HARD LIMIT: Never exceed MAX_BOOST
  return Math.min(boost, MAX_BOOST);
}

// ---------------------------------------------------------------------------
// Exported Constants for Testing/Debugging
// ---------------------------------------------------------------------------

export const PROFILE_BOOST_CONFIG = {
  maxBoost: MAX_BOOST,
  newUserThresholdMs: NEW_USER_THRESHOLD_MS,
  newUserMinBoost: NEW_USER_MIN_BOOST,
  weights: WEIGHTS,
  boostThresholds: {
    tier4: 90, // +4 boost
    tier3: 80, // +3 boost
    tier2: 65, // +2 boost
    tier1: 50, // +1 boost
  },
};
