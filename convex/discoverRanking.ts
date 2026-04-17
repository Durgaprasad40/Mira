/**
 * 🔒 LOCKED: Phase-1 Discover (Production Ready)
 *
 * This feature has completed full audit and production hardening.
 * Do NOT modify without explicit approval.
 *
 * Locked scope includes:
 * - auth flow
 * - ranking logic
 * - pagination
 * - swipe behavior
 * - card rendering rules
 * - presence handling
 * - distance logic
 * - empty state logic
 *
 * If changes are required:
 * - open a new audit
 * - do not modify directly
 */

/**
 * Phase-1 Discover Ranking Module
 *
 * Modular ranking system for the main Discover feed.
 *
 * Architecture:
 * 1. Eligibility Filter - hard exclusions (safety, viewer-specific blocks/reports)
 * 2. Score Calculation - weighted composite score
 * 3. Penalties/Boosts - trust signals, mutual interest
 * 4. Exploration Mixer - 80% ranked, 20% exploration
 * 5. Exhaustion Fallback - fallback pool with 2+ compatibility signals
 *
 * Weights (total 100%):
 * - Compatibility: 40%
 * - Profile Quality: 20%
 * - Mutual Interest: 10%
 * - Activity/Recency: 10%
 * - Distance: 10%
 * - Fairness/Exploration: 10%
 */

import { Id } from './_generated/dataModel';
import { normalizeRelationshipIntentValues } from '../lib/discoveryNaming';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateProfile {
  id: string;
  name: string;
  age: number;
  gender: string;
  bio: string;
  city?: string;
  distance?: number;
  lastActive: number;
  createdAt: number;
  isVerified: boolean;
  lookingFor: string[];
  relationshipIntent: string[];
  activities: string[];
  profilePrompts?: { question: string; answer: string }[];
  height?: number;
  jobTitle?: string;
  education?: string;
  smoking?: string;
  drinking?: string;
  religion?: string;
  kids?: string;
  photoCount: number;
  theyLikedMe: boolean;
  isBoosted: boolean;
  // Trust signals (aggregated)
  reportCount?: number;
  blockCount?: number;
  // Life rhythm (if available)
  lifeRhythm?: {
    socialRhythm?: string;
    sleepSchedule?: string;
    travelStyle?: string;
    workStyle?: string;
    coreValues?: string[];
  };
  // Seed questions (if available)
  seedQuestions?: {
    identityAnchor?: string;
    socialBattery?: number;
    valueTrigger?: string;
  };
  // Section prompts (if available)
  sectionPrompts?: {
    builder?: { question: string; answer: string }[];
    performer?: { question: string; answer: string }[];
    seeker?: { question: string; answer: string }[];
    grounded?: { question: string; answer: string }[];
  };
}

export interface CurrentUser {
  _id: string;
  city?: string;
  activities: string[];
  relationshipIntent: string[];
  lookingFor: string[];
  minAge: number;
  maxAge: number;
  maxDistance: number;
  // Life rhythm (if available)
  lifeRhythm?: {
    socialRhythm?: string;
    sleepSchedule?: string;
    travelStyle?: string;
    workStyle?: string;
    coreValues?: string[];
  };
  // Seed questions (if available)
  seedQuestions?: {
    identityAnchor?: string;
    socialBattery?: number;
    valueTrigger?: string;
  };
  smoking?: string;
  drinking?: string;
  religion?: string;
  kids?: string;
}

export interface TrustSignals {
  // Viewer-specific (hard exclude)
  viewerBlockedIds: Set<string>;
  viewerReportedIds: Set<string>;
  // Aggregate counts per candidate (soft penalty)
  aggregateReportCounts: Map<string, number>;
  aggregateBlockCounts: Map<string, number>;
}

export interface RankingResult {
  rankedCandidates: CandidateProfile[];
  exhausted: boolean;
  fallbackUsed: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RANKING_WEIGHTS = {
  compatibility: 0.40,
  profileQuality: 0.20,
  mutualInterest: 0.10,
  activityRecency: 0.10,
  distanceInfluence: 0.10,
  fairnessExploration: 0.10,
};

const EXPLORATION_RATIO = 0.20; // 20% exploration, 80% best-ranked

// Trust penalty thresholds (soft penalty, not hard filter)
const TRUST_PENALTY = {
  perReport: 5,    // -5 points per report
  perBlock: 3,     // -3 points per block (less severe than report)
  maxPenalty: 30,  // Cap penalty at -30 points
};

// Boost values
const BOOSTS = {
  theyLikedMe: 25,  // Small boost for mutual interest signal
  isBoosted: 20,    // Paid boost
  verified: 15,     // Verification trust boost (NOT a hard filter)
};

// Fallback: minimum strong signals required
const FALLBACK_MIN_SIGNALS = 2;

// ---------------------------------------------------------------------------
// Score Components (0-100 each)
// ---------------------------------------------------------------------------

/**
 * A) Compatibility Score (0-100)
 * Based on: relationship intent, lifestyle, life rhythm, values
 */
export function compatibilityScore(
  candidate: CandidateProfile,
  currentUser: CurrentUser
): number {
  let score = 0;

  // SAFETY: Normalize arrays to prevent crashes on undefined fields
  const candidateIntent = normalizeRelationshipIntentValues(candidate.relationshipIntent);
  const userIntent = normalizeRelationshipIntentValues(currentUser.relationshipIntent);
  const candidateActivities = candidate.activities ?? [];
  const userActivities = currentUser.activities ?? [];

  // 1. Relationship intent alignment (0-30)
  const intentCompat: Record<string, string[]> = {
    serious_vibes: ['serious_vibes', 'see_where_it_goes'],
    keep_it_casual: ['keep_it_casual', 'open_to_vibes'],
    exploring_vibes: ['exploring_vibes', 'open_to_anything'],
    see_where_it_goes: ['see_where_it_goes', 'serious_vibes', 'keep_it_casual'],
    open_to_vibes: ['open_to_vibes', 'keep_it_casual'],
    just_friends: ['just_friends', 'open_to_anything'],
    open_to_anything: ['open_to_anything', 'exploring_vibes', 'just_friends'],
    single_parent: ['single_parent'],
    new_to_dating: ['new_to_dating'],
  };

  let bestIntent = 0;
  for (const mine of userIntent) {
    for (const theirs of candidateIntent) {
      if (mine === theirs) bestIntent = Math.max(bestIntent, 30);
      else if (intentCompat[mine]?.includes(theirs)) bestIntent = Math.max(bestIntent, 15);
    }
  }
  score += bestIntent;

  // 2. Shared activities/interests (0-25)
  const sharedActivities = candidateActivities.filter(a => userActivities.includes(a));
  score += Math.min(sharedActivities.length * 5, 25);

  // 3. Lifestyle match (0-20) - smoking, drinking, kids, religion
  let lifestyleMatches = 0;
  if (candidate.smoking && currentUser.smoking && candidate.smoking === currentUser.smoking) lifestyleMatches++;
  if (candidate.drinking && currentUser.drinking && candidate.drinking === currentUser.drinking) lifestyleMatches++;
  if (candidate.kids && currentUser.kids && candidate.kids === currentUser.kids) lifestyleMatches++;
  if (candidate.religion && currentUser.religion && candidate.religion === currentUser.religion) lifestyleMatches++;
  score += lifestyleMatches * 5;

  // 4. Life rhythm match (0-15) - if available
  if (candidate.lifeRhythm && currentUser.lifeRhythm) {
    let rhythmMatches = 0;
    if (candidate.lifeRhythm.socialRhythm === currentUser.lifeRhythm.socialRhythm) rhythmMatches++;
    if (candidate.lifeRhythm.sleepSchedule === currentUser.lifeRhythm.sleepSchedule) rhythmMatches++;
    if (candidate.lifeRhythm.workStyle === currentUser.lifeRhythm.workStyle) rhythmMatches++;

    // Core values overlap
    const candidateValues = candidate.lifeRhythm.coreValues || [];
    const userValues = currentUser.lifeRhythm.coreValues || [];
    const sharedValues = candidateValues.filter(v => userValues.includes(v));
    rhythmMatches += sharedValues.length;

    score += Math.min(rhythmMatches * 3, 15);
  }

  // 5. Identity anchor match (0-10) - if available
  if (candidate.seedQuestions?.identityAnchor && currentUser.seedQuestions?.identityAnchor) {
    if (candidate.seedQuestions.identityAnchor === currentUser.seedQuestions.identityAnchor) {
      score += 10;
    }
  }

  return Math.min(score, 100);
}

/**
 * B) Profile Quality Score (0-100)
 * Based on: completeness, verification, effort indicators
 */
export function profileQualityScore(candidate: CandidateProfile): number {
  let score = 0;

  // Bio quality (0-20)
  const bioLength = candidate.bio?.trim().length || 0;
  if (bioLength >= 150) score += 20;
  else if (bioLength >= 100) score += 15;
  else if (bioLength >= 50) score += 10;
  else if (bioLength > 0) score += 5;

  // Profile prompts answered (0-25)
  const filledPrompts = (candidate.profilePrompts ?? []).filter(
    p => p.answer.trim().length > 0
  ).length;
  score += Math.min(filledPrompts * 8, 24);
  if (filledPrompts >= 3) score += 1;

  // Activities selected (0-15)
  // SAFETY: Guard against undefined activities array
  const activitiesCount = (candidate.activities ?? []).length;
  if (activitiesCount >= 5) score += 15;
  else if (activitiesCount >= 3) score += 10;
  else if (activitiesCount >= 1) score += 5;

  // Photos (0-20)
  if (candidate.photoCount >= 4) score += 20;
  else if (candidate.photoCount >= 3) score += 15;
  else if (candidate.photoCount >= 2) score += 10;
  else if (candidate.photoCount >= 1) score += 5;

  // Verified (0-10)
  if (candidate.isVerified) score += 10;

  // Optional fields filled (0-10)
  if (candidate.height) score += 2;
  if (candidate.jobTitle) score += 3;
  if (candidate.education) score += 2;
  if (candidate.religion) score += 1;
  if (candidate.kids) score += 2;

  return Math.min(score, 100);
}

/**
 * C) Activity/Recency Score (0-100)
 * Based on: last active time
 */
export function activityRecencyScore(lastActive: number): number {
  const now = Date.now();
  const hoursAgo = (now - lastActive) / (1000 * 60 * 60);

  if (hoursAgo < 1) return 100;
  if (hoursAgo < 4) return 85;
  if (hoursAgo < 12) return 70;
  if (hoursAgo < 24) return 55;
  if (hoursAgo < 48) return 40;
  if (hoursAgo < 72) return 30;
  if (hoursAgo < 168) return 15; // 7 days
  return 5;
}

/**
 * D) Distance Score (0-100)
 * Closer = higher score. Max distance = 0 score.
 */
export function distanceScore(
  distance: number | undefined,
  maxDistance: number
): number {
  // SAFETY: Guard against division by zero
  if (!maxDistance || maxDistance <= 0) return 100;
  if (distance == null) return 50; // Unknown distance = neutral
  if (distance <= 0) return 100;
  if (distance >= maxDistance) return 0;

  // Linear decay from 100 to 0
  return Math.round(100 * (1 - distance / maxDistance));
}

/**
 * E) Fairness/Exploration Score (0-100)
 * Deterministic daily hash for variety
 */
export function fairnessScore(viewerId: string, candidateId: string): number {
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  let h = day;
  for (let i = 0; i < viewerId.length; i++) h = ((h << 5) - h + viewerId.charCodeAt(i)) | 0;
  for (let i = 0; i < candidateId.length; i++) h = ((h << 5) - h + candidateId.charCodeAt(i)) | 0;
  return Math.abs(h) % 101;
}

// ---------------------------------------------------------------------------
// Trust/Safety Penalties
// ---------------------------------------------------------------------------

/**
 * Calculate trust penalty based on aggregate reports/blocks.
 * Returns a NEGATIVE value to subtract from score.
 * Does NOT hard-filter - just reduces ranking.
 */
export function trustPenalty(
  candidateId: string,
  aggregateReportCounts: Map<string, number>,
  aggregateBlockCounts: Map<string, number>
): number {
  const reports = aggregateReportCounts.get(candidateId) || 0;
  const blocks = aggregateBlockCounts.get(candidateId) || 0;

  const penalty =
    reports * TRUST_PENALTY.perReport +
    blocks * TRUST_PENALTY.perBlock;

  return Math.min(penalty, TRUST_PENALTY.maxPenalty);
}

// ---------------------------------------------------------------------------
// Composite Ranking Score
// ---------------------------------------------------------------------------

/**
 * Calculate the final ranking score for a candidate.
 */
export function calculateRankScore(
  candidate: CandidateProfile,
  currentUser: CurrentUser,
  trustSignals: TrustSignals
): number {
  // Component scores (0-100 each)
  const compatibility = compatibilityScore(candidate, currentUser);
  const quality = profileQualityScore(candidate);
  const activity = activityRecencyScore(candidate.lastActive);
  const distance = distanceScore(candidate.distance, currentUser.maxDistance);
  const fairness = fairnessScore(currentUser._id, candidate.id);

  // Mutual interest score (0-100) - based on available signals
  let mutualInterest = 0;
  if (candidate.theyLikedMe) mutualInterest = 100;
  // Future: add profile views, message engagement, etc.

  // Weighted composite score
  let score =
    RANKING_WEIGHTS.compatibility * compatibility +
    RANKING_WEIGHTS.profileQuality * quality +
    RANKING_WEIGHTS.mutualInterest * mutualInterest +
    RANKING_WEIGHTS.activityRecency * activity +
    RANKING_WEIGHTS.distanceInfluence * distance +
    RANKING_WEIGHTS.fairnessExploration * fairness;

  // Apply boosts
  if (candidate.theyLikedMe) score += BOOSTS.theyLikedMe;
  if (candidate.isBoosted) score += BOOSTS.isBoosted;
  if (candidate.isVerified) score += BOOSTS.verified;

  // Apply trust penalty (soft penalty, not hard filter)
  const penalty = trustPenalty(
    candidate.id,
    trustSignals.aggregateReportCounts,
    trustSignals.aggregateBlockCounts
  );
  score -= penalty;

  return score;
}

// ---------------------------------------------------------------------------
// Exploration Mixer
// ---------------------------------------------------------------------------

/** Calendar day index (UTC), aligned with rotationScore / Discover stability. */
export function discoverDayNumberFromTimestamp(nowMs: number): number {
  return Math.floor(nowMs / (1000 * 60 * 60 * 24));
}

/** 32-bit seed from viewer + day (deterministic per viewer per day). */
function seedViewerDay(viewerId: string, dayNumber: number): number {
  const s = `${viewerId}\0${dayNumber}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h === 0 ? 0x9e3779b9 : h >>> 0;
}

/** Mulberry32 — returns values in [0, 1). */
function createSeededUnitRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function unitRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using the provided RNG (uniform in [0,1)).
 * Returns a new shuffled array without modifying the original.
 */
function fisherYatesShuffle<T>(array: T[], unitRandom: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(unitRandom() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Mix ranked candidates with exploration pool.
 * 80% from top-ranked, 20% from random exploration.
 */
export function applyExplorationMix(
  sortedCandidates: CandidateProfile[],
  limit: number,
  viewerId: string,
  dayNumber: number,
): CandidateProfile[] {
  if (sortedCandidates.length <= limit) {
    return sortedCandidates;
  }

  const rankedCount = Math.ceil(limit * (1 - EXPLORATION_RATIO));
  const explorationCount = limit - rankedCount;

  // Top ranked candidates
  const ranked = sortedCandidates.slice(0, rankedCount);

  // Exploration pool: random selection from remaining
  const remaining = sortedCandidates.slice(rankedCount);
  const exploration: CandidateProfile[] = [];

  if (remaining.length > 0 && explorationCount > 0) {
    const unitRandom = createSeededUnitRandom(seedViewerDay(viewerId, dayNumber));
    // Shuffle remaining for random exploration (deterministic per viewer+day)
    const shuffled = fisherYatesShuffle(remaining, unitRandom);
    exploration.push(...shuffled.slice(0, explorationCount));
  }

  // Interleave: mostly ranked, with exploration sprinkled in
  const result: CandidateProfile[] = [];
  let rankedIdx = 0;
  let exploreIdx = 0;

  for (let i = 0; i < limit && (rankedIdx < ranked.length || exploreIdx < exploration.length); i++) {
    // Every 5th position (after position 4, 9, 14, etc.) use exploration
    if (i > 0 && i % 5 === 4 && exploreIdx < exploration.length) {
      result.push(exploration[exploreIdx++]);
    } else if (rankedIdx < ranked.length) {
      result.push(ranked[rankedIdx++]);
    } else if (exploreIdx < exploration.length) {
      result.push(exploration[exploreIdx++]);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fallback Compatibility Check
// ---------------------------------------------------------------------------

/**
 * Count strong compatibility signals between candidate and current user.
 * Used for fallback pool eligibility.
 *
 * Strong signals (compatibility-based, NOT profile completeness):
 * 1. Same identity anchor (builder/performer/seeker/grounded)
 * 2. Same value trigger
 * 3. Overlapping interests (3+ shared)
 * 4. Similar life rhythm (2+ matching fields)
 * 5. Similar lifestyle (2+ matching fields)
 * 6. Same relationship intent
 */
export function countStrongCompatibilitySignals(
  candidate: CandidateProfile,
  currentUser: CurrentUser
): number {
  let signals = 0;

  // SAFETY: Normalize arrays to prevent crashes on undefined fields
  const candidateActivities = candidate.activities ?? [];
  const userActivities = currentUser.activities ?? [];
  const candidateIntent = candidate.relationshipIntent ?? [];
  const userIntent = currentUser.relationshipIntent ?? [];

  // 1. Same identity anchor
  if (
    candidate.seedQuestions?.identityAnchor &&
    currentUser.seedQuestions?.identityAnchor &&
    candidate.seedQuestions.identityAnchor === currentUser.seedQuestions.identityAnchor
  ) {
    signals++;
  }

  // 2. Same value trigger
  if (
    candidate.seedQuestions?.valueTrigger &&
    currentUser.seedQuestions?.valueTrigger &&
    candidate.seedQuestions.valueTrigger === currentUser.seedQuestions.valueTrigger
  ) {
    signals++;
  }

  // 3. Overlapping interests (3+ shared)
  const sharedActivities = candidateActivities.filter(a => userActivities.includes(a));
  if (sharedActivities.length >= 3) {
    signals++;
  }

  // 4. Similar life rhythm (2+ matching fields)
  if (candidate.lifeRhythm && currentUser.lifeRhythm) {
    let rhythmMatches = 0;
    if (candidate.lifeRhythm.socialRhythm === currentUser.lifeRhythm.socialRhythm) rhythmMatches++;
    if (candidate.lifeRhythm.sleepSchedule === currentUser.lifeRhythm.sleepSchedule) rhythmMatches++;
    if (candidate.lifeRhythm.workStyle === currentUser.lifeRhythm.workStyle) rhythmMatches++;
    if (candidate.lifeRhythm.travelStyle === currentUser.lifeRhythm.travelStyle) rhythmMatches++;

    // Core values overlap
    const candidateValues = candidate.lifeRhythm.coreValues || [];
    const userValues = currentUser.lifeRhythm.coreValues || [];
    const sharedValues = candidateValues.filter(v => userValues.includes(v));
    if (sharedValues.length >= 1) rhythmMatches++;

    if (rhythmMatches >= 2) signals++;
  }

  // 5. Similar lifestyle (2+ matching fields)
  let lifestyleMatches = 0;
  if (candidate.smoking && currentUser.smoking && candidate.smoking === currentUser.smoking) lifestyleMatches++;
  if (candidate.drinking && currentUser.drinking && candidate.drinking === currentUser.drinking) lifestyleMatches++;
  if (candidate.kids && currentUser.kids && candidate.kids === currentUser.kids) lifestyleMatches++;
  if (candidate.religion && currentUser.religion && candidate.religion === currentUser.religion) lifestyleMatches++;
  if (lifestyleMatches >= 2) signals++;

  // 6. Same relationship intent (exact match)
  const hasMatchingIntent = userIntent.some(i =>
    candidateIntent.includes(i)
  );
  if (hasMatchingIntent) signals++;

  // NOTE: Profile prompts answered is NOT a fallback signal
  // Fallback signals must be about actual compatibility, not profile completeness

  return signals;
}

/**
 * Check if a candidate qualifies for fallback pool.
 * Must have at least FALLBACK_MIN_SIGNALS strong compatibility signals.
 */
export function qualifiesForFallback(
  candidate: CandidateProfile,
  currentUser: CurrentUser
): boolean {
  return countStrongCompatibilitySignals(candidate, currentUser) >= FALLBACK_MIN_SIGNALS;
}

// ---------------------------------------------------------------------------
// Main Ranking Function
// ---------------------------------------------------------------------------

/**
 * Rank candidates for Discover feed.
 *
 * @param candidates - Pre-filtered eligible candidates (passed hard filters)
 * @param currentUser - The viewing user
 * @param trustSignals - Trust/safety data
 * @param limit - Number of results to return
 * @param useFallback - Whether to include fallback pool
 */
// 🔒 LOCKED: Do not change ranking scores, exploration mix, or determinism without audit approval
export function rankDiscoverCandidates(
  candidates: CandidateProfile[],
  currentUser: CurrentUser,
  trustSignals: TrustSignals,
  limit: number,
  useFallback: boolean = false
): RankingResult {
  // Calculate scores for all candidates
  const scoredCandidates = candidates.map(candidate => ({
    candidate,
    score: calculateRankScore(candidate, currentUser, trustSignals),
  }));

  // Sort by score (descending)
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Apply exploration mix (shuffle seed: viewer + calendar day — stable across pagination requests)
  const sortedCandidates = scoredCandidates.map(s => s.candidate);
  const dayNumber = discoverDayNumberFromTimestamp(Date.now());
  const mixed = applyExplorationMix(sortedCandidates, limit, currentUser._id, dayNumber);

  const exhausted = mixed.length < limit;
  let fallbackUsed = false;

  // If exhausted and fallback allowed, could extend pool
  // (Fallback filtering happens at query level, not here)
  if (exhausted && useFallback) {
    fallbackUsed = true;
  }

  return {
    rankedCandidates: mixed,
    exhausted,
    fallbackUsed,
  };
}

// ---------------------------------------------------------------------------
// Export constants for external use
// ---------------------------------------------------------------------------

export const DISCOVER_RANKING_CONFIG = {
  weights: RANKING_WEIGHTS,
  explorationRatio: EXPLORATION_RATIO,
  trustPenalty: TRUST_PENALTY,
  boosts: BOOSTS,
  fallbackMinSignals: FALLBACK_MIN_SIGNALS,
};
