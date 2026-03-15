/**
 * Phase-1 Discovery Adapter
 *
 * Maps Phase-1 users table and onboarding data into the normalized
 * NormalizedDiscoveryCandidate and DiscoveryViewerContext shapes
 * for use by the shared discovery engine.
 *
 * This module is ADDITIVE - it does not modify any existing ranking/discovery logic.
 */

import {
  NormalizedDiscoveryCandidate,
  DiscoveryViewerContext,
} from './discoveryTypes';

// ---------------------------------------------------------------------------
// Type Definitions for Phase-1 Data
// ---------------------------------------------------------------------------

/**
 * Phase-1 user record shape (from users table).
 * Represents the raw data shape we receive from Convex queries.
 */
export interface Phase1UserRecord {
  _id: string;

  // Demographics
  dateOfBirth: string;
  gender: string;
  city?: string;

  // Location
  latitude?: number;
  longitude?: number;

  // Preferences
  lookingFor: string[];
  relationshipIntent: string[];
  activities: string[];
  minAge: number;
  maxAge: number;
  maxDistance: number;

  // Lifestyle
  smoking?: string;
  drinking?: string;
  exercise?: string;
  religion?: string;
  pets?: string[];
  kids?: string;

  // Profile Content
  bio: string;
  profilePrompts?: { question: string; answer: string }[];

  // Activity
  lastActive: number;
  createdAt: number;

  // Verification
  isVerified: boolean;
  verificationStatus?: string;

  // Onboarding Draft (contains archetype, values, life rhythm)
  onboardingDraft?: {
    profileDetails?: {
      seedQuestions?: {
        identityAnchor?: string;
        socialBattery?: number;
        valueTrigger?: string;
      };
      sectionPrompts?: {
        builder?: { question: string; answer: string }[];
        performer?: { question: string; answer: string }[];
        seeker?: { question: string; answer: string }[];
        grounded?: { question: string; answer: string }[];
      };
    };
    lifeRhythm?: {
      socialRhythm?: string;
      sleepSchedule?: string;
      travelStyle?: string;
      workStyle?: string;
      coreValues?: string[];
    };
  };
}

/**
 * Additional signals for a Phase-1 candidate.
 * These come from separate queries (likes, views, etc.).
 */
export interface Phase1CandidateSignals {
  photoCount: number;
  theyLikedMe: boolean;
  theySuperLikedMe: boolean;
  theyTextedMe: boolean;
  viewedYou: boolean;
  reportCount: number;
  blockCount: number;
  totalImpressions?: number;
  lastShownAt?: number;
  distance?: number; // Pre-computed if viewer has location
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Calculate age from date of birth string.
 * Returns 0 if date is invalid.
 */
function calculateAge(dateOfBirth: string): number {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Sanitize a string array: trim values and remove empty strings.
 */
function sanitizeStringArray(arr: string[] | undefined | null): string[] {
  if (!arr || !Array.isArray(arr)) return [];
  return arr
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(s => s.length > 0);
}

/**
 * Clamp social battery to valid range (1-5).
 * Returns undefined if invalid.
 */
function clampSocialBattery(value: number | undefined | null): number | undefined {
  if (typeof value !== 'number' || isNaN(value)) return undefined;
  if (value < 1 || value > 5) return undefined;
  return Math.round(value);
}

/**
 * Calculate bucket signal strength from section prompts.
 * Returns 0-1 based on how many prompts are answered.
 */
function computeBucketStrength(prompts?: { question: string; answer: string }[]): number {
  if (!prompts || prompts.length === 0) return 0;
  const answered = prompts.filter(p => p.answer?.trim().length > 0).length;
  // Normalize: 0 prompts = 0, 3+ prompts = 1
  return Math.min(answered / 3, 1);
}

// ---------------------------------------------------------------------------
// Main Adapter Functions
// ---------------------------------------------------------------------------

/**
 * Normalize a Phase-1 user record into a NormalizedDiscoveryCandidate.
 *
 * @param user - Raw Phase-1 user record
 * @param signals - Additional signals (likes, views, etc.)
 * @returns Normalized candidate for discovery engine
 */
export function normalizePhase1Candidate(
  user: Phase1UserRecord,
  signals: Phase1CandidateSignals
): NormalizedDiscoveryCandidate {
  const onboarding = user.onboardingDraft;
  const seedQuestions = onboarding?.profileDetails?.seedQuestions;
  const sectionPrompts = onboarding?.profileDetails?.sectionPrompts;
  const lifeRhythm = onboarding?.lifeRhythm;

  // Extract archetype
  const archetype = seedQuestions?.identityAnchor;
  const archetypeAvailable = !!archetype;

  // Extract and clamp social battery (valid range: 1-5)
  const socialBattery = clampSocialBattery(seedQuestions?.socialBattery);
  const batteryAvailable = socialBattery !== undefined;

  // Extract and sanitize core values
  const coreValues = sanitizeStringArray(lifeRhythm?.coreValues);
  const valuesAvailable = coreValues.length > 0;

  // Extract life rhythm
  const lifeRhythmAvailable = !!(
    lifeRhythm?.socialRhythm ||
    lifeRhythm?.sleepSchedule ||
    lifeRhythm?.travelStyle ||
    lifeRhythm?.workStyle
  );

  // Compute bucket signals from section prompts
  const bucketSignals = {
    builder: computeBucketStrength(sectionPrompts?.builder),
    performer: computeBucketStrength(sectionPrompts?.performer),
    seeker: computeBucketStrength(sectionPrompts?.seeker),
    grounded: computeBucketStrength(sectionPrompts?.grounded),
  };
  const bucketAvailable = Object.values(bucketSignals).some(v => v > 0);

  // Extract prompts
  const prompts = user.profilePrompts ?? [];
  const promptsAnswered = prompts.filter(p => p.answer?.trim().length > 0).length;

  return {
    // Identity
    id: user._id,
    phase: 'phase1',

    // Demographics
    age: calculateAge(user.dateOfBirth),
    gender: user.gender,
    city: user.city,

    // Location (Phase-1 has coordinates)
    latitude: user.latitude,
    longitude: user.longitude,
    distance: signals.distance,

    // Relationship & Intent (sanitized)
    relationshipIntent: sanitizeStringArray(user.relationshipIntent),
    lookingFor: sanitizeStringArray(user.lookingFor),

    // Children preference
    kids: user.kids,

    // Activities/Interests (sanitized)
    activities: sanitizeStringArray(user.activities),

    // Lifestyle
    lifestyle: {
      smoking: user.smoking,
      drinking: user.drinking,
      exercise: user.exercise,
      religion: user.religion,
      pets: user.pets,
    },

    // Archetype
    archetype,
    archetypeAvailable,

    // Bucket Signals
    bucketSignals,
    bucketAvailable,

    // Social Battery
    socialBattery,
    batteryAvailable,

    // Core Values
    coreValues,
    valuesAvailable,

    // Life Rhythm
    lifeRhythm: {
      socialRhythm: lifeRhythm?.socialRhythm,
      sleepSchedule: lifeRhythm?.sleepSchedule,
      travelStyle: lifeRhythm?.travelStyle,
      workStyle: lifeRhythm?.workStyle,
    },
    lifeRhythmAvailable,

    // Profile Content
    bio: user.bio ?? '',
    bioLength: user.bio?.trim().length ?? 0,
    prompts,
    promptsAnswered,
    photoCount: signals.photoCount,

    // Activity & Freshness
    lastActiveAt: user.lastActive,
    createdAt: user.createdAt,

    // Verification
    isVerified: user.isVerified,
    verificationStatus: user.verificationStatus,

    // Inbound Interest Signals
    theyLikedMe: signals.theyLikedMe,
    theySuperLikedMe: signals.theySuperLikedMe,
    theyTextedMe: signals.theyTextedMe,
    viewedYou: signals.viewedYou,

    // Trust Signals
    reportCount: signals.reportCount,
    blockCount: signals.blockCount,

    // Fairness Signals
    totalImpressions: signals.totalImpressions,
    lastShownAt: signals.lastShownAt,
  };
}

/**
 * Create a DiscoveryViewerContext from a Phase-1 user.
 *
 * @param user - Raw Phase-1 user record
 * @param blockedIds - Set of user IDs blocked by this viewer
 * @param reportedIds - Set of user IDs reported by this viewer
 * @returns Viewer context for discovery engine
 */
export function createPhase1ViewerContext(
  user: Phase1UserRecord,
  blockedIds: Set<string>,
  reportedIds: Set<string>
): DiscoveryViewerContext {
  const onboarding = user.onboardingDraft;
  const seedQuestions = onboarding?.profileDetails?.seedQuestions;
  const sectionPrompts = onboarding?.profileDetails?.sectionPrompts;
  const lifeRhythm = onboarding?.lifeRhythm;

  // Extract archetype
  const archetype = seedQuestions?.identityAnchor;
  const archetypeAvailable = !!archetype;

  // Extract and clamp social battery (valid range: 1-5)
  const socialBattery = clampSocialBattery(seedQuestions?.socialBattery);
  const batteryAvailable = socialBattery !== undefined;

  // Extract and sanitize core values
  const coreValues = sanitizeStringArray(lifeRhythm?.coreValues);
  const valuesAvailable = coreValues.length > 0;

  // Extract life rhythm
  const lifeRhythmAvailable = !!(
    lifeRhythm?.socialRhythm ||
    lifeRhythm?.sleepSchedule ||
    lifeRhythm?.travelStyle ||
    lifeRhythm?.workStyle
  );

  // Compute bucket signals from section prompts
  const bucketSignals = {
    builder: computeBucketStrength(sectionPrompts?.builder),
    performer: computeBucketStrength(sectionPrompts?.performer),
    seeker: computeBucketStrength(sectionPrompts?.seeker),
    grounded: computeBucketStrength(sectionPrompts?.grounded),
  };
  const bucketAvailable = Object.values(bucketSignals).some(v => v > 0);

  return {
    // Identity
    id: user._id,
    phase: 'phase1',

    // Demographics
    age: calculateAge(user.dateOfBirth),
    gender: user.gender,
    city: user.city,

    // Location
    latitude: user.latitude,
    longitude: user.longitude,

    // Preferences (sanitized)
    lookingFor: sanitizeStringArray(user.lookingFor),
    minAge: user.minAge,
    maxAge: user.maxAge,
    maxDistance: user.maxDistance,

    // Relationship & Intent (sanitized)
    relationshipIntent: sanitizeStringArray(user.relationshipIntent),

    // Children preference
    kids: user.kids,

    // Activities/Interests (sanitized)
    activities: sanitizeStringArray(user.activities),

    // Lifestyle
    lifestyle: {
      smoking: user.smoking,
      drinking: user.drinking,
      exercise: user.exercise,
      religion: user.religion,
      pets: user.pets,
    },

    // Archetype
    archetype,
    archetypeAvailable,

    // Bucket Signals
    bucketSignals,
    bucketAvailable,

    // Social Battery
    socialBattery,
    batteryAvailable,

    // Core Values
    coreValues,
    valuesAvailable,

    // Life Rhythm
    lifeRhythm: {
      socialRhythm: lifeRhythm?.socialRhythm,
      sleepSchedule: lifeRhythm?.sleepSchedule,
      travelStyle: lifeRhythm?.travelStyle,
      workStyle: lifeRhythm?.workStyle,
    },
    lifeRhythmAvailable,

    // Bio/Prompts (for chemistry scoring)
    bio: user.bio ?? '',
    prompts: user.profilePrompts ?? [],

    // Blocked/Reported Sets
    blockedIds,
    reportedIds,
  };
}

/**
 * Batch normalize multiple Phase-1 candidates.
 *
 * @param users - Array of Phase-1 user records
 * @param signalsMap - Map of userId to signals
 * @returns Array of normalized candidates
 */
export function batchNormalizePhase1Candidates(
  users: Phase1UserRecord[],
  signalsMap: Map<string, Phase1CandidateSignals>
): NormalizedDiscoveryCandidate[] {
  return users.map(user => {
    const signals = signalsMap.get(user._id) ?? {
      photoCount: 0,
      theyLikedMe: false,
      theySuperLikedMe: false,
      theyTextedMe: false,
      viewedYou: false,
      reportCount: 0,
      blockCount: 0,
      distance: undefined,
      totalImpressions: undefined,
      lastShownAt: undefined,
    };
    return normalizePhase1Candidate(user, signals);
  });
}
