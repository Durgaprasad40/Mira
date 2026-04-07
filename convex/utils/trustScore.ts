/**
 * Trust & Safety Ranking Adjustment
 *
 * SOFT TRUST LAYER that improves Discover safety by:
 * - Slightly boosting verified/trustworthy users
 * - Reducing visibility of users with concerning signals
 * - Preventing abuse and false positives
 *
 * CRITICAL RULES:
 * - Range: -8 to +2 (STRICT)
 * - Single report MUST NOT cause penalty
 * - Requires MULTIPLE UNIQUE reporters for penalties
 * - Missing data = neutral (0)
 * - New users = neutral (0)
 *
 * ANTI-ABUSE:
 * - One user cannot tank another's ranking
 * - Mass-reporting from same user is ignored
 * - Requires independent signals from multiple users
 *
 * TRUST TIERS:
 * - Tier A (Trusted): +1 to +2 (verified, clean record)
 * - Tier B (Neutral): 0 (no strong signals either way)
 * - Tier C (Mild Concern): -2 (few concerning signals)
 * - Tier D (Moderate Concern): -4 to -6 (repeated signals)
 * - Tier E (High Concern): -8 (strong/repeated signals)
 */

import { CandidateProfile } from '../discoverRanking';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Trust adjustment range (STRICT LIMITS)
 */
const MAX_TRUST_BOOST = 2;
const MAX_TRUST_PENALTY = -8;

/**
 * Verified user boost
 */
const VERIFIED_BOOST = 1;
const VERIFIED_CLEAN_BOOST = 2; // Verified AND clean record

/**
 * Report thresholds (unique reporters only)
 * Single report = no penalty (anti-abuse)
 */
const REPORT_THRESHOLDS = {
  mildConcern: 2,     // 2+ unique reporters → -2
  moderateConcern: 4, // 4+ unique reporters → -4
  highConcern: 6,     // 6+ unique reporters → -6
  severeConcern: 8,   // 8+ unique reporters → -8
};

/**
 * Block thresholds (unique blockers only)
 */
const BLOCK_THRESHOLDS = {
  mildConcern: 5,      // 5+ unique blockers → -1
  moderateConcern: 10, // 10+ unique blockers → -2
  highConcern: 20,     // 20+ unique blockers → -3
};

/**
 * Report recency window (30 days in ms)
 * Only recent reports count toward trust penalty
 */
const REPORT_RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * New user threshold (7 days)
 * New users get neutral trust (no penalty possible)
 */
const NEW_USER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Trust metrics for a candidate.
 * These may be populated from aggregated data or extended profile.
 */
export interface TrustMetrics {
  /**
   * Is the user face-verified?
   */
  isVerified: boolean;

  /**
   * Account creation timestamp (for new user detection)
   */
  createdAt: number;

  /**
   * Number of unique reporters (recent window only)
   */
  uniqueReporterCount?: number;

  /**
   * Number of unique blockers (all-time, but unique)
   */
  uniqueBlockerCount?: number;

  /**
   * Whether user has a moderation flag (marked for review)
   */
  moderationFlag?: boolean;

  /**
   * Timestamp of most recent report (for recency check)
   */
  lastReportAt?: number;
}

// ---------------------------------------------------------------------------
// Trust Calculation Helpers
// ---------------------------------------------------------------------------

/**
 * Check if user is a new user (created recently).
 * New users get neutral trust treatment.
 */
function isNewUser(createdAt: number): boolean {
  if (!createdAt || typeof createdAt !== 'number') return false;
  const now = Date.now();
  return (now - createdAt) <= NEW_USER_THRESHOLD_MS;
}

/**
 * Calculate penalty from unique reporter count.
 * ANTI-ABUSE: Single report = 0 penalty
 *
 * @param uniqueReporters - Number of unique users who reported
 * @returns Penalty value (0 to -8)
 */
function getReportPenalty(uniqueReporters: number): number {
  if (uniqueReporters < REPORT_THRESHOLDS.mildConcern) {
    return 0; // No penalty for < 2 reporters (anti-abuse)
  }

  if (uniqueReporters >= REPORT_THRESHOLDS.severeConcern) {
    return -8;
  }
  if (uniqueReporters >= REPORT_THRESHOLDS.highConcern) {
    return -6;
  }
  if (uniqueReporters >= REPORT_THRESHOLDS.moderateConcern) {
    return -4;
  }
  return -2; // mildConcern
}

/**
 * Calculate penalty from unique blocker count.
 *
 * @param uniqueBlockers - Number of unique users who blocked
 * @returns Penalty value (0 to -3)
 */
function getBlockPenalty(uniqueBlockers: number): number {
  if (uniqueBlockers < BLOCK_THRESHOLDS.mildConcern) {
    return 0;
  }

  if (uniqueBlockers >= BLOCK_THRESHOLDS.highConcern) {
    return -3;
  }
  if (uniqueBlockers >= BLOCK_THRESHOLDS.moderateConcern) {
    return -2;
  }
  return -1; // mildConcern
}

/**
 * Check if user has clean trust record.
 * Clean = no recent reports, no moderation flags, few blocks
 */
function hasCleanRecord(metrics: TrustMetrics): boolean {
  const reporters = metrics.uniqueReporterCount ?? 0;
  const blockers = metrics.uniqueBlockerCount ?? 0;
  const hasFlag = metrics.moderationFlag ?? false;

  return reporters === 0 && blockers < 3 && !hasFlag;
}

// ---------------------------------------------------------------------------
// Main Trust Adjustment Function
// ---------------------------------------------------------------------------

/**
 * Calculate trust adjustment for a candidate.
 *
 * TRUST TIERS:
 * - Tier A: +1 to +2 (verified, clean record)
 * - Tier B: 0 (neutral - no strong signals)
 * - Tier C: -2 (mild concern - few unique reports/blocks)
 * - Tier D: -4 to -6 (moderate concern - repeated signals)
 * - Tier E: -8 (high concern - strong signals or moderation flag)
 *
 * @param profile - Candidate profile
 * @param metrics - Optional explicit trust metrics
 * @returns Trust adjustment (-8 to +2)
 */
export function getTrustAdjustment(
  profile: CandidateProfile | null | undefined,
  metrics?: TrustMetrics
): number {
  // Null safety
  if (!profile) return 0;

  // Build metrics from profile if not provided
  const trustMetrics: TrustMetrics = metrics ?? {
    isVerified: profile.isVerified ?? false,
    createdAt: profile.createdAt,
    uniqueReporterCount: (profile as any).uniqueReporterCount,
    uniqueBlockerCount: (profile as any).uniqueBlockerCount,
    moderationFlag: (profile as any).moderationFlag,
    lastReportAt: (profile as any).lastReportAt,
  };

  // New user protection: neutral trust
  if (isNewUser(trustMetrics.createdAt)) {
    // New users get small boost if verified, otherwise neutral
    return trustMetrics.isVerified ? VERIFIED_BOOST : 0;
  }

  // Calculate penalties
  const reportPenalty = getReportPenalty(trustMetrics.uniqueReporterCount ?? 0);
  const blockPenalty = getBlockPenalty(trustMetrics.uniqueBlockerCount ?? 0);

  // Moderation flag = severe penalty
  const flagPenalty = trustMetrics.moderationFlag ? -4 : 0;

  // Total penalty (capped)
  let totalPenalty = reportPenalty + blockPenalty + flagPenalty;
  totalPenalty = Math.max(totalPenalty, MAX_TRUST_PENALTY);

  // Calculate boost (only if no significant penalties)
  let boost = 0;
  if (trustMetrics.isVerified) {
    if (hasCleanRecord(trustMetrics) && totalPenalty === 0) {
      // Verified + clean = max boost
      boost = VERIFIED_CLEAN_BOOST;
    } else if (totalPenalty > -4) {
      // Verified but some minor concerns = reduced boost
      boost = VERIFIED_BOOST;
    }
    // If severe penalties, no boost for verification
  }

  // Final adjustment
  const adjustment = boost + totalPenalty;

  // Clamp to valid range
  return Math.max(MAX_TRUST_PENALTY, Math.min(MAX_TRUST_BOOST, adjustment));
}

/**
 * Get trust adjustment with explicit metrics (for testing/direct use).
 */
export function getTrustAdjustmentFromMetrics(
  metrics: TrustMetrics | null | undefined
): number {
  if (!metrics) return 0;

  // New user protection
  if (isNewUser(metrics.createdAt)) {
    return metrics.isVerified ? VERIFIED_BOOST : 0;
  }

  const reportPenalty = getReportPenalty(metrics.uniqueReporterCount ?? 0);
  const blockPenalty = getBlockPenalty(metrics.uniqueBlockerCount ?? 0);
  const flagPenalty = metrics.moderationFlag ? -4 : 0;

  let totalPenalty = Math.max(reportPenalty + blockPenalty + flagPenalty, MAX_TRUST_PENALTY);

  let boost = 0;
  if (metrics.isVerified) {
    if (hasCleanRecord(metrics) && totalPenalty === 0) {
      boost = VERIFIED_CLEAN_BOOST;
    } else if (totalPenalty > -4) {
      boost = VERIFIED_BOOST;
    }
  }

  return Math.max(MAX_TRUST_PENALTY, Math.min(MAX_TRUST_BOOST, boost + totalPenalty));
}

// ---------------------------------------------------------------------------
// Exported Constants
// ---------------------------------------------------------------------------

export const TRUST_SCORE_CONFIG = {
  maxBoost: MAX_TRUST_BOOST,
  maxPenalty: MAX_TRUST_PENALTY,
  verifiedBoost: VERIFIED_BOOST,
  verifiedCleanBoost: VERIFIED_CLEAN_BOOST,
  reportThresholds: REPORT_THRESHOLDS,
  blockThresholds: BLOCK_THRESHOLDS,
  reportRecencyWindowMs: REPORT_RECENCY_WINDOW_MS,
  newUserThresholdMs: NEW_USER_THRESHOLD_MS,
  tiers: {
    tierA: { min: 1, max: 2, description: 'Trusted (verified, clean)' },
    tierB: { min: 0, max: 0, description: 'Neutral' },
    tierC: { min: -2, max: -2, description: 'Mild concern' },
    tierD: { min: -6, max: -4, description: 'Moderate concern' },
    tierE: { min: -8, max: -8, description: 'High concern' },
  },
};
