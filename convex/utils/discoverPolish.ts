/**
 * Discover Polish Utility
 *
 * LIGHTWEIGHT polish layer for Discover feed quality improvements.
 *
 * CRITICAL RULES:
 * - All adjustments are SMALL (±5 points max)
 * - Does NOT dominate base score
 * - Does NOT change eligibility/filtering
 * - Does NOT break mixer/exploration logic
 * - Null-safe with graceful fallbacks
 *
 * Features:
 * 1. Repeat Cooldown Penalty - penalize profiles shown recently
 * 2. Exposure Balancing Boost - boost under-exposed profiles
 * 3. Small Pool Handling - relax penalties when pool is small
 */

import { CandidateProfile } from '../discoverRanking';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum penalty for repeat profiles (HARD LIMIT)
 */
const MAX_REPEAT_PENALTY = 5;

/**
 * Maximum exposure boost for underexposed profiles
 */
const MAX_EXPOSURE_BOOST = 3;

/**
 * Threshold for "small pool" - when to relax penalties
 */
const SMALL_POOL_THRESHOLD = 30;

/**
 * Recent impressions window size (number of profiles)
 */
const RECENT_IMPRESSIONS_WINDOW = 20;

/**
 * Session cooldown period (4 hours in ms)
 * Profiles shown within this window get repeat penalty
 */
const SESSION_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Short-term memory period (24 hours in ms)
 * For tracking exposure fairness
 */
const SHORT_TERM_MEMORY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolishContext {
  /**
   * Set of recently shown profile IDs (within current session/query batch)
   */
  recentlyShownIds: Set<string>;

  /**
   * Total candidate pool size (for small pool detection)
   */
  poolSize: number;

  /**
   * Viewer ID (for deterministic calculations)
   */
  viewerId: string;

  /**
   * Current timestamp
   */
  now: number;
}

export interface PolishResult {
  /**
   * Repeat penalty (0 to -MAX_REPEAT_PENALTY)
   */
  repeatPenalty: number;

  /**
   * Exposure boost (0 to +MAX_EXPOSURE_BOOST)
   */
  exposureBoost: number;

  /**
   * Net adjustment (exposureBoost - repeatPenalty)
   */
  netAdjustment: number;
}

// ---------------------------------------------------------------------------
// Repeat Cooldown Penalty
// ---------------------------------------------------------------------------

/**
 * Calculate repeat penalty for a candidate.
 *
 * Rules:
 * - If shown in recent impressions → apply penalty
 * - If shown very recently (same session) → stronger penalty
 * - If lastShownInDiscoverAt within session cooldown → penalty
 * - Small pool → reduce penalty
 *
 * @param candidate - The candidate profile
 * @param context - Polish context with recent impressions
 * @returns Penalty value (0 to MAX_REPEAT_PENALTY, positive number)
 */
export function getRepeatPenalty(
  candidate: CandidateProfile | null | undefined,
  context: PolishContext
): number {
  if (!candidate) return 0;

  let penalty = 0;

  // Check if in recent impressions set
  if (context.recentlyShownIds.has(candidate.id)) {
    // Strong penalty for immediate repeats
    penalty = MAX_REPEAT_PENALTY;
  }

  // Check lastShownInDiscoverAt if available (from user schema)
  // This is a type extension - candidate may have this from DB
  const lastShown = (candidate as any).lastShownInDiscoverAt as number | undefined;
  if (lastShown && lastShown > 0) {
    const timeSinceShown = context.now - lastShown;

    if (timeSinceShown < SESSION_COOLDOWN_MS) {
      // Within session cooldown - apply penalty based on recency
      // More recent = higher penalty
      const recencyFactor = 1 - (timeSinceShown / SESSION_COOLDOWN_MS);
      const recencyPenalty = Math.round(recencyFactor * MAX_REPEAT_PENALTY);
      penalty = Math.max(penalty, recencyPenalty);
    }
  }

  // Small pool handling: reduce penalty to avoid empty feeds
  if (context.poolSize < SMALL_POOL_THRESHOLD) {
    const poolFactor = context.poolSize / SMALL_POOL_THRESHOLD;
    penalty = Math.round(penalty * poolFactor);
  }

  // Ensure penalty is within bounds
  return Math.min(Math.max(penalty, 0), MAX_REPEAT_PENALTY);
}

// ---------------------------------------------------------------------------
// Exposure Balancing Boost
// ---------------------------------------------------------------------------

/**
 * Calculate exposure boost for underexposed candidates.
 *
 * Rules:
 * - Profiles not shown recently → small boost
 * - Profiles with low impression count → boost
 * - Profiles shown frequently → slight dampening (negative boost)
 *
 * @param candidate - The candidate profile
 * @param context - Polish context
 * @returns Boost value (-1 to +MAX_EXPOSURE_BOOST)
 */
export function getExposureBoost(
  candidate: CandidateProfile | null | undefined,
  context: PolishContext
): number {
  if (!candidate) return 0;

  let boost = 0;

  // Check lastShownInDiscoverAt
  const lastShown = (candidate as any).lastShownInDiscoverAt as number | undefined;
  const totalImpressions = (candidate as any).totalImpressions as number | undefined;

  // Not recently shown → boost
  if (!lastShown || lastShown === 0) {
    // Never shown before - give full boost
    boost = MAX_EXPOSURE_BOOST;
  } else {
    const timeSinceShown = context.now - lastShown;

    if (timeSinceShown > SHORT_TERM_MEMORY_MS) {
      // Not shown in 24h - moderate boost
      boost = Math.round(MAX_EXPOSURE_BOOST * 0.7);
    } else if (timeSinceShown > SESSION_COOLDOWN_MS) {
      // Not shown in 4h - small boost
      boost = Math.round(MAX_EXPOSURE_BOOST * 0.3);
    } else {
      // Recently shown - slight dampening
      boost = -1;
    }
  }

  // Low impression count bonus
  if (totalImpressions !== undefined && totalImpressions < 10) {
    // Low exposure profile - additional boost
    boost += 1;
  }

  // High impression count dampening (avoid over-exposure)
  if (totalImpressions !== undefined && totalImpressions > 100) {
    boost -= 1;
  }

  // Clamp to valid range
  return Math.min(Math.max(boost, -1), MAX_EXPOSURE_BOOST);
}

// ---------------------------------------------------------------------------
// Combined Polish Score
// ---------------------------------------------------------------------------

/**
 * Calculate combined polish adjustment for a candidate.
 *
 * Formula:
 * netAdjustment = exposureBoost - repeatPenalty
 *
 * This is ADDITIVE to the existing score.
 *
 * @param candidate - The candidate profile
 * @param context - Polish context
 * @returns PolishResult with breakdown
 */
export function getPolishAdjustment(
  candidate: CandidateProfile | null | undefined,
  context: PolishContext
): PolishResult {
  const repeatPenalty = getRepeatPenalty(candidate, context);
  const exposureBoost = getExposureBoost(candidate, context);
  const netAdjustment = exposureBoost - repeatPenalty;

  return {
    repeatPenalty,
    exposureBoost,
    netAdjustment,
  };
}

/**
 * Maximum clamped polish range (balanced adjustment)
 * Ensures polish never dominates base score
 */
const POLISH_CLAMP_MAX = 3;
const POLISH_CLAMP_MIN = -3;

/**
 * Get net polish score adjustment (single number).
 *
 * This is the function to call from ranking logic.
 *
 * STABILIZATION FIX: Clamps final value to [-3, +3] for balanced impact.
 * Raw calculation may exceed this range, but final output is clamped.
 *
 * @param candidate - The candidate profile
 * @param context - Polish context
 * @returns Net adjustment clamped to [-3, +3]
 */
export function getPolishScore(
  candidate: CandidateProfile | null | undefined,
  context: PolishContext
): number {
  const rawPolish = getPolishAdjustment(candidate, context).netAdjustment;

  // STABILIZATION FIX: Clamp to balanced range [-3, +3]
  // Prevents polish from having outsized impact on ranking
  return Math.max(POLISH_CLAMP_MIN, Math.min(POLISH_CLAMP_MAX, rawPolish));
}

// ---------------------------------------------------------------------------
// Context Factory
// ---------------------------------------------------------------------------

/**
 * Create a polish context for a discover query.
 *
 * @param viewerId - The viewer's user ID
 * @param poolSize - Total candidate pool size
 * @param recentlyShownIds - Set of recently shown profile IDs (optional)
 * @returns PolishContext
 */
export function createPolishContext(
  viewerId: string,
  poolSize: number,
  recentlyShownIds?: Set<string>
): PolishContext {
  return {
    viewerId,
    poolSize,
    recentlyShownIds: recentlyShownIds ?? new Set(),
    now: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Session Variety Check
// ---------------------------------------------------------------------------

/**
 * Check if adding a candidate would create obvious repetition.
 *
 * Light check to avoid consecutive identical profiles.
 * Does NOT exclude - just flags for potential deprioritization.
 *
 * @param candidate - Candidate to check
 * @param lastAddedCandidate - Previously added candidate (if any)
 * @returns True if this would be a repetition
 */
export function isRepetitionRisk(
  candidate: CandidateProfile | null | undefined,
  lastAddedCandidate: CandidateProfile | null | undefined
): boolean {
  if (!candidate || !lastAddedCandidate) return false;

  // Same profile (shouldn't happen, but safety check)
  if (candidate.id === lastAddedCandidate.id) return true;

  // Don't flag based on shared traits - that would be over-engineering
  // Keep it simple: only flag exact duplicates

  return false;
}

// ---------------------------------------------------------------------------
// Exported Constants
// ---------------------------------------------------------------------------

export const DISCOVER_POLISH_CONFIG = {
  maxRepeatPenalty: MAX_REPEAT_PENALTY,
  maxExposureBoost: MAX_EXPOSURE_BOOST,
  smallPoolThreshold: SMALL_POOL_THRESHOLD,
  recentImpressionsWindow: RECENT_IMPRESSIONS_WINDOW,
  sessionCooldownMs: SESSION_COOLDOWN_MS,
  shortTermMemoryMs: SHORT_TERM_MEMORY_MS,
  // STABILIZATION FIX: Final clamped range for balanced impact
  polishClampMin: POLISH_CLAMP_MIN,
  polishClampMax: POLISH_CLAMP_MAX,
};
