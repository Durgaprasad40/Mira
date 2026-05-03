/**
 * Phase-2 Discovery Adapter
 *
 * Maps Phase-2 userPrivateProfiles table into the normalized
 * NormalizedDiscoveryCandidate and DiscoveryViewerContext shapes
 * for use by the shared discovery engine.
 *
 * Phase-2 has limited data compared to Phase-1. This adapter uses
 * explicit neutral fallbacks for missing fields:
 * - archetype: neutral 0.5 score
 * - values: neutral 0.5 score
 * - social battery: neutral 0.5 score
 * - life rhythm: neutral 0.5 score
 * - distance: skipped (no coordinates in Phase-2)
 *
 * This module is ADDITIVE - it does not modify any existing ranking/discovery logic.
 */

import {
  NormalizedDiscoveryCandidate,
  DiscoveryViewerContext,
} from './discoveryTypes';
import { normalizeRelationshipIntentValues } from '../lib/discoveryNaming';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Neutral fallback value for missing compatibility signals.
 * Used when Phase-2 data is unavailable to ensure fair scoring.
 */
export const NEUTRAL_FALLBACK = 0.5;

// ---------------------------------------------------------------------------
// Type Definitions for Phase-2 Data
// ---------------------------------------------------------------------------

/**
 * Phase-2 private profile record shape (from userPrivateProfiles table).
 */
export interface Phase2PrivateProfileRecord {
  _id: string;
  userId: string;

  // Demographics
  displayName: string;
  age: number;
  gender: string;
  city?: string;

  // Intent & Desires
  privateIntentKeys: string[];
  privateDesireTagKeys: string[];
  privateBoundaries?: string[];

  // Profile Content
  privateBio?: string;
  promptAnswers?: { promptId: string; question: string; answer: string }[];

  // Media
  privatePhotoUrls: string[];

  // Lifestyle (imported from Phase-1 or edited)
  hobbies?: string[];
  smoking?: string;
  drinking?: string;
  height?: number;
  weight?: number;
  education?: string;
  religion?: string;

  // Verification
  isVerified?: boolean;

  // Preference Strength
  preferenceStrength?: {
    smoking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    drinking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    intent?: 'not_important' | 'prefer_similar' | 'important' | 'must_match_exactly';
  };

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

/**
 * Phase-2 ranking metrics (from phase2RankingMetrics table).
 */
export interface Phase2RankingMetrics {
  phase2OnboardedAt: number;
  lastPhase2ActiveAt: number;
  totalImpressions: number;
  lastShownAt: number;
}

/**
 * Additional signals for a Phase-2 candidate.
 */
export interface Phase2CandidateSignals {
  metrics?: Phase2RankingMetrics;
  theyLikedMe: boolean;
  theySuperLikedMe: boolean;
  theyTextedMe: boolean;
  viewedYou: boolean;
  reportCount: number;
  blockCount: number;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

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
 * Map Phase-2 intent keys to normalized relationship intent values.
 * Phase-2 uses different intent key naming than Phase-1.
 */
function normalizePhase2IntentKeys(intentKeys: string[]): string[] {
  return normalizeRelationshipIntentValues(sanitizeStringArray(intentKeys));
}

/**
 * Count prompts answered in Phase-2 profile.
 */
function countPromptsAnswered(
  prompts?: { promptId: string; question: string; answer: string }[]
): number {
  if (!prompts || !Array.isArray(prompts)) return 0;
  return prompts.filter(p => p.answer?.trim().length > 0).length;
}

/**
 * Normalize and sanitize Phase-2 prompts to standard format.
 * Trims question/answer, filters out empty prompts, and dedupes by promptId
 * (keeps first non-empty entry per id) to defend against legacy writes that
 * bypassed setPromptAnswer's local dedup.
 */
function normalizePhase2Prompts(
  prompts?: { promptId: string; question: string; answer: string }[]
): { question: string; answer: string }[] {
  if (!prompts || !Array.isArray(prompts)) return [];
  const seenPromptIds = new Set<string>();
  return prompts
    .filter(p => {
      if (!p.answer?.trim().length) return false;
      if (p.promptId) {
        if (seenPromptIds.has(p.promptId)) return false;
        seenPromptIds.add(p.promptId);
      }
      return true;
    })
    .map(p => ({
      question: p.question?.trim() ?? '',
      answer: p.answer?.trim() ?? '',
    }));
}

// ---------------------------------------------------------------------------
// Main Adapter Functions
// ---------------------------------------------------------------------------

/**
 * Normalize a Phase-2 private profile into a NormalizedDiscoveryCandidate.
 *
 * Uses explicit neutral fallbacks for fields not available in Phase-2:
 * - archetype: not available -> archetypeAvailable = false
 * - values: not available -> valuesAvailable = false
 * - battery: not available -> batteryAvailable = false
 * - life rhythm: not available -> lifeRhythmAvailable = false
 * - distance: not available (no coordinates in Phase-2)
 *
 * @param profile - Raw Phase-2 private profile record
 * @param signals - Additional signals (metrics, likes, etc.)
 * @returns Normalized candidate for discovery engine
 */
export function normalizePhase2Candidate(
  profile: Phase2PrivateProfileRecord,
  signals: Phase2CandidateSignals
): NormalizedDiscoveryCandidate {
  const metrics = signals.metrics;
  const promptsAnswered = countPromptsAnswered(profile.promptAnswers);

  // Normalize and sanitize prompts (trim content, filter empty)
  const normalizedPrompts = normalizePhase2Prompts(profile.promptAnswers);

  return {
    // Identity
    id: profile.userId,
    phase: 'phase2',

    // Demographics
    age: profile.age,
    gender: profile.gender,
    city: profile.city,

    // Location - Phase-2 has no coordinates
    latitude: undefined,
    longitude: undefined,
    distance: undefined, // Skip distance for Phase-2

    // Relationship & Intent (sanitized)
    relationshipIntent: normalizePhase2IntentKeys(profile.privateIntentKeys),
    lookingFor: [], // Phase-2 doesn't have lookingFor preference

    // Children preference - not available in Phase-2
    kids: undefined,

    // Activities/Interests (using hobbies from Phase-2)
    activities: sanitizeStringArray(profile.hobbies),

    // Lifestyle
    lifestyle: {
      smoking: profile.smoking,
      drinking: profile.drinking,
      exercise: undefined, // Not in Phase-2 schema
      religion: profile.religion,
      pets: undefined, // Not in Phase-2 schema
    },

    // Archetype - NOT available in Phase-2, use neutral fallback
    archetype: undefined,
    archetypeAvailable: false,

    // Bucket Signals - NOT available in Phase-2
    // IMPORTANT: bucketAvailable=false signals to the scoring layer that
    // bucket data is unavailable. Scoring must treat unavailable bucket
    // data neutrally (0.5), not as true signal strength.
    bucketSignals: {
      builder: NEUTRAL_FALLBACK,
      performer: NEUTRAL_FALLBACK,
      seeker: NEUTRAL_FALLBACK,
      grounded: NEUTRAL_FALLBACK,
    },
    bucketAvailable: false,

    // Social Battery - NOT available in Phase-2, use neutral fallback
    socialBattery: undefined,
    batteryAvailable: false,

    // Core Values - NOT available in Phase-2, use neutral fallback
    coreValues: [],
    valuesAvailable: false,

    // Life Rhythm - NOT available in Phase-2, use neutral fallback
    lifeRhythm: {
      socialRhythm: undefined,
      sleepSchedule: undefined,
      travelStyle: undefined,
      workStyle: undefined,
    },
    lifeRhythmAvailable: false,

    // Profile Content
    bio: profile.privateBio ?? '',
    bioLength: profile.privateBio?.trim().length ?? 0,
    prompts: normalizedPrompts,
    promptsAnswered,
    photoCount: profile.privatePhotoUrls?.length ?? 0,

    // Activity & Freshness
    lastActiveAt: metrics?.lastPhase2ActiveAt ?? profile.updatedAt,
    createdAt: profile.createdAt,
    onboardedAt: metrics?.phase2OnboardedAt,

    // Verification
    isVerified: profile.isVerified ?? false,
    verificationStatus: profile.isVerified ? 'verified' : 'unverified',

    // Inbound Interest Signals
    theyLikedMe: signals.theyLikedMe,
    theySuperLikedMe: signals.theySuperLikedMe,
    theyTextedMe: signals.theyTextedMe,
    viewedYou: signals.viewedYou,

    // Trust Signals
    reportCount: signals.reportCount,
    blockCount: signals.blockCount,

    // Fairness Signals
    totalImpressions: metrics?.totalImpressions,
    lastShownAt: metrics?.lastShownAt,

    // Phase-2 Specific
    preferenceStrength: profile.preferenceStrength,
  };
}

/**
 * Create a DiscoveryViewerContext from a Phase-2 private profile.
 *
 * Uses explicit neutral fallbacks for fields not available in Phase-2.
 *
 * @param profile - Raw Phase-2 private profile record
 * @param blockedIds - Set of user IDs blocked by this viewer
 * @param reportedIds - Set of user IDs reported by this viewer
 * @returns Viewer context for discovery engine
 */
export function createPhase2ViewerContext(
  profile: Phase2PrivateProfileRecord,
  blockedIds: Set<string>,
  reportedIds: Set<string>
): DiscoveryViewerContext {
  // Normalize and sanitize prompts (trim content, filter empty)
  const normalizedPrompts = normalizePhase2Prompts(profile.promptAnswers);

  return {
    // Identity
    id: profile.userId,
    phase: 'phase2',

    // Demographics
    age: profile.age,
    gender: profile.gender,
    city: profile.city,

    // Location - Phase-2 has no coordinates
    latitude: undefined,
    longitude: undefined,

    // Preferences - Phase-2 has limited preference data
    // NOTE: These are NON-OPERATIVE placeholders. Phase-2 filtering MUST skip
    // age/distance preference logic entirely. These values exist only to satisfy
    // the type interface and should never be used for actual filtering.
    lookingFor: [], // Not available in Phase-2
    minAge: 0,      // NON-OPERATIVE - do not filter by age
    maxAge: 100,    // NON-OPERATIVE - do not filter by age
    maxDistance: 0, // NON-OPERATIVE - distance not applicable for Phase-2

    // Relationship & Intent (sanitized)
    relationshipIntent: normalizePhase2IntentKeys(profile.privateIntentKeys),

    // Children preference - not available
    kids: undefined,

    // Activities/Interests
    activities: sanitizeStringArray(profile.hobbies),

    // Lifestyle
    lifestyle: {
      smoking: profile.smoking,
      drinking: profile.drinking,
      exercise: undefined,
      religion: profile.religion,
      pets: undefined,
    },

    // Archetype - NOT available in Phase-2
    archetype: undefined,
    archetypeAvailable: false,

    // Bucket Signals - NOT available in Phase-2
    // IMPORTANT: Phase-2 does not have real bucket/section prompt data.
    // These 0.5 neutral values are placeholders only.
    // Scoring must treat bucketAvailable=false as unavailable data,
    // not as actual signal strength.
    bucketSignals: {
      builder: NEUTRAL_FALLBACK,
      performer: NEUTRAL_FALLBACK,
      seeker: NEUTRAL_FALLBACK,
      grounded: NEUTRAL_FALLBACK,
    },
    bucketAvailable: false,

    // Social Battery - NOT available in Phase-2
    socialBattery: undefined,
    batteryAvailable: false,

    // Core Values - NOT available
    coreValues: [],
    valuesAvailable: false,

    // Life Rhythm - NOT available
    lifeRhythm: {
      socialRhythm: undefined,
      sleepSchedule: undefined,
      travelStyle: undefined,
      workStyle: undefined,
    },
    lifeRhythmAvailable: false,

    // Bio/Prompts
    bio: profile.privateBio ?? '',
    prompts: normalizedPrompts,

    // Blocked/Reported Sets
    blockedIds,
    reportedIds,

    // Phase-2 Specific
    preferenceStrength: profile.preferenceStrength,
  };
}

/**
 * Batch normalize multiple Phase-2 candidates.
 *
 * @param profiles - Array of Phase-2 private profile records
 * @param signalsMap - Map of userId to signals
 * @returns Array of normalized candidates
 */
export function batchNormalizePhase2Candidates(
  profiles: Phase2PrivateProfileRecord[],
  signalsMap: Map<string, Phase2CandidateSignals>
): NormalizedDiscoveryCandidate[] {
  return profiles.map(profile => {
    const signals = signalsMap.get(profile.userId) ?? {
      metrics: undefined,
      theyLikedMe: false,
      theySuperLikedMe: false,
      theyTextedMe: false,
      viewedYou: false,
      reportCount: 0,
      blockCount: 0,
    };
    return normalizePhase2Candidate(profile, signals);
  });
}
