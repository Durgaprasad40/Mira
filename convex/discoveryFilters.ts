/**
 * Discovery Filters
 *
 * Eligibility filtering for the shared discovery engine.
 * Handles both hard exclusions and soft penalties.
 *
 * Hard Exclusions (candidates are completely excluded):
 * - Self (viewer's own profile)
 * - Blocked users (bidirectional)
 * - Reported users (viewer reported them)
 * - Distance > 200km (Phase-1 only, when coordinates exist)
 * - Unavailable users (if product rules require)
 *
 * Soft Penalties (returned separately, applied in scoring):
 * - Distance 51-200km
 * - Children preference mismatch
 * - Lifestyle mismatch (when preference strength is deal_breaker)
 * - Low-effort profile
 *
 * NOTE: Relationship intent is NOT a hard filter here.
 * It is handled as a compatibility signal in discoveryScoring.ts.
 *
 * This module is ADDITIVE - it does not modify any existing ranking/discovery logic.
 */

import {
  NormalizedDiscoveryCandidate,
  DiscoveryViewerContext,
  FilterResult,
  ExclusionReason,
  DiscoveryEngineConfig,
  DEFAULT_DISCOVERY_CONFIG,
} from './discoveryTypes';

// ---------------------------------------------------------------------------
// Hard Exclusion Filters
// ---------------------------------------------------------------------------

// TODO: Unavailable/unverified exclusions are NOT applied by default in this
// standalone engine. If product rules require excluding unavailable or unverified
// users, add explicit config flags (e.g., config.excludeUnavailable, config.requireVerification)
// and implement the checks here. Currently, only self, blocked, reported, and
// distance_exceeded are hard exclusions.

/**
 * Check if candidate should be hard-excluded from results.
 * Returns the exclusion reason if excluded, null if eligible.
 */
export function checkHardExclusion(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): ExclusionReason | null {
  // 1. Self-exclusion (never show yourself)
  if (candidate.id === viewer.id) {
    return 'self';
  }

  // 2. Blocked by viewer
  if (viewer.blockedIds.has(candidate.id)) {
    return 'blocked_by_viewer';
  }

  // 3. Reported by viewer
  if (viewer.reportedIds.has(candidate.id)) {
    return 'reported_by_viewer';
  }

  // 4. Distance hard exclusion (Phase-1 only, when valid distance exists)
  // Skip distance check for Phase-2 candidates (no coordinates)
  // Only apply when distance is a valid finite number
  if (
    candidate.phase === 'phase1' &&
    Number.isFinite(candidate.distance) &&
    candidate.distance! > config.distance.hardRejectAt
  ) {
    return 'distance_exceeded';
  }

  // No hard exclusion
  return null;
}

/**
 * Filter candidates by hard exclusions.
 * Returns eligible candidates and list of excluded candidates with reasons.
 */
export function filterByHardExclusions(
  candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): FilterResult {
  const eligible: NormalizedDiscoveryCandidate[] = [];
  const excluded: { candidate: NormalizedDiscoveryCandidate; reason: ExclusionReason }[] = [];

  for (const candidate of candidates) {
    const reason = checkHardExclusion(candidate, viewer, config);
    if (reason) {
      excluded.push({ candidate, reason });
    } else {
      eligible.push(candidate);
    }
  }

  return { eligible, excluded };
}

// ---------------------------------------------------------------------------
// Soft Penalty Calculations
// ---------------------------------------------------------------------------

/**
 * Soft penalty context for a candidate.
 * These values are computed here but applied in the scoring layer.
 */
export interface SoftPenalties {
  distancePenalty: number;
  childrenPenalty: number;
  lifestyleDealbreaker: number;
  lowEffortPenalty: number;
}

/**
 * Compute distance penalty (soft, not hard exclusion).
 *
 * - 0 penalty if distance <= softPenaltyStart (50km)
 * - Linear penalty from 0 to maxPenalty between softPenaltyStart and hardRejectAt
 * - Phase-2 candidates (no coordinates) get 0 penalty
 * - Invalid/missing distance values get 0 penalty (benefit of the doubt)
 */
export function computeDistancePenalty(
  candidate: NormalizedDiscoveryCandidate,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): number {
  // Phase-2 has no distance data - no penalty
  if (candidate.phase === 'phase2') {
    return 0;
  }

  // Guard: only apply penalty if distance is a valid finite number
  if (!Number.isFinite(candidate.distance)) {
    return 0;
  }

  const distance = candidate.distance!;
  const { softPenaltyStart, hardRejectAt, maxPenalty } = config.distance;

  // Within soft zone - no penalty
  if (distance <= softPenaltyStart) {
    return 0;
  }

  // Beyond hard reject - should have been filtered, but cap penalty
  if (distance >= hardRejectAt) {
    return maxPenalty;
  }

  // Linear interpolation in soft penalty zone
  const penaltyRange = hardRejectAt - softPenaltyStart;
  const distanceInRange = distance - softPenaltyStart;
  return (distanceInRange / penaltyRange) * maxPenalty;
}

/**
 * Compute children preference mismatch penalty.
 *
 * Compatibility matrix for kids preference:
 * - Exact match: 0 penalty
 * - Compatible: 0 penalty (e.g., both want kids or both don't care)
 * - Soft mismatch: small penalty (not definitively opposite)
 * - Strong opposite: larger penalty (clearly conflicting preferences)
 * - One missing: no penalty (assume neutral)
 *
 * NOTE: This uses a conservative approach - only strong opposites get full penalty.
 * TODO: Refine taxonomy mapping if product requirements evolve.
 */
export function computeChildrenPenalty(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): number {
  // If either is missing, no penalty (assume neutral)
  if (!candidate.kids || !viewer.kids) {
    return 0;
  }

  // Exact match: no penalty
  if (candidate.kids === viewer.kids) {
    return 0;
  }

  // Compatible pairs (no penalty)
  const compatible: Record<string, string[]> = {
    have_and_want_more: ['have_and_want_more', 'dont_have_and_want', 'not_sure'],
    have_and_dont_want_more: ['have_and_dont_want_more', 'dont_have_and_dont_want', 'not_sure'],
    dont_have_and_want: ['dont_have_and_want', 'have_and_want_more', 'not_sure'],
    dont_have_and_dont_want: ['dont_have_and_dont_want', 'have_and_dont_want_more', 'not_sure'],
    not_sure: ['not_sure', 'have_and_want_more', 'have_and_dont_want_more', 'dont_have_and_want', 'dont_have_and_dont_want'],
  };

  const viewerCompatible = compatible[viewer.kids] ?? [];
  if (viewerCompatible.includes(candidate.kids)) {
    return 0;
  }

  // Strong opposite pairs (full penalty) - only the clearest conflicts
  const strongOpposite: Record<string, string[]> = {
    have_and_want_more: ['dont_have_and_dont_want'],
    have_and_dont_want_more: ['dont_have_and_want'],
    dont_have_and_want: ['have_and_dont_want_more', 'dont_have_and_dont_want'],
    dont_have_and_dont_want: ['have_and_want_more', 'dont_have_and_want'],
  };

  const viewerStrongOpposite = strongOpposite[viewer.kids] ?? [];
  if (viewerStrongOpposite.includes(candidate.kids)) {
    // Strong opposite - full penalty
    return config.penalties.childrenMismatchMax;
  }

  // Soft mismatch - half penalty (conservative approach)
  return Math.floor(config.penalties.childrenMismatchMax / 2);
}

/**
 * Compute lifestyle dealbreaker penalty.
 *
 * Only applies when viewer has marked a lifestyle preference as "deal_breaker"
 * and candidate's value doesn't match.
 *
 * This respects Phase-2 preferenceStrength field.
 *
 * NOTE: Total penalty is capped so multiple mismatches don't stack excessively.
 * The cap is 1.5x the single dealbreaker penalty to keep this in soft range.
 */
export function computeLifestyleDealbreaker(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): number {
  let penalty = 0;
  const singlePenalty = config.penalties.lifestyleDealbreaker;

  // Check smoking dealbreaker
  if (
    viewer.preferenceStrength?.smoking === 'deal_breaker' &&
    candidate.lifestyle.smoking &&
    viewer.lifestyle.smoking &&
    candidate.lifestyle.smoking !== viewer.lifestyle.smoking
  ) {
    penalty += singlePenalty;
  }

  // Check drinking dealbreaker
  if (
    viewer.preferenceStrength?.drinking === 'deal_breaker' &&
    candidate.lifestyle.drinking &&
    viewer.lifestyle.drinking &&
    candidate.lifestyle.drinking !== viewer.lifestyle.drinking
  ) {
    penalty += singlePenalty;
  }

  // Cap total lifestyle penalty to 1.5x single penalty (soft range)
  const maxLifestylePenalty = Math.floor(singlePenalty * 1.5);
  return Math.min(penalty, maxLifestylePenalty);
}

/**
 * Compute low-effort profile penalty.
 *
 * Penalizes profiles that are incomplete:
 * - No bio or very short bio
 * - No prompts answered
 * - Few activities selected
 * - Few photos
 *
 * NOTE: These penalties are intentionally modest and capped so that
 * compatibility scoring remains the dominant ranking factor.
 * A low-effort profile can still rank highly if compatibility is strong.
 *
 * Penalty is capped at config.penalties.lowEffortMax.
 */
export function computeLowEffortPenalty(
  candidate: NormalizedDiscoveryCandidate,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): number {
  let penalty = 0;

  // Bio penalty: 0 for 100+ chars, increasing penalty for shorter
  if (candidate.bioLength < 20) {
    penalty += 4; // Very short or no bio
  } else if (candidate.bioLength < 50) {
    penalty += 2; // Short bio
  }

  // Prompts penalty: 0 for 3+ prompts, penalty for fewer
  if (candidate.promptsAnswered === 0) {
    penalty += 4; // No prompts
  } else if (candidate.promptsAnswered < 2) {
    penalty += 2; // Few prompts
  }

  // Activities penalty: 0 for 3+ activities, penalty for fewer
  if (candidate.activities.length === 0) {
    penalty += 2; // No activities
  } else if (candidate.activities.length < 2) {
    penalty += 1; // Few activities
  }

  // Photo penalty: 0 for 3+ photos, penalty for fewer
  if (candidate.photoCount < 2) {
    penalty += 2; // Few photos
  }

  // Cap total penalty so compatibility remains dominant
  return Math.min(penalty, config.penalties.lowEffortMax);
}

/**
 * Compute all soft penalties for a candidate.
 */
export function computeAllSoftPenalties(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): SoftPenalties {
  return {
    distancePenalty: computeDistancePenalty(candidate, config),
    childrenPenalty: computeChildrenPenalty(candidate, viewer, config),
    lifestyleDealbreaker: computeLifestyleDealbreaker(candidate, viewer, config),
    lowEffortPenalty: computeLowEffortPenalty(candidate, config),
  };
}

/**
 * Compute total soft penalty for a candidate.
 */
export function computeTotalSoftPenalty(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): number {
  const penalties = computeAllSoftPenalties(candidate, viewer, config);
  return (
    penalties.distancePenalty +
    penalties.childrenPenalty +
    penalties.lifestyleDealbreaker +
    penalties.lowEffortPenalty
  );
}

// ---------------------------------------------------------------------------
// Combined Filter Function
// ---------------------------------------------------------------------------

/**
 * Apply all filters to a list of candidates.
 * Returns eligible candidates (after hard exclusions) and excluded list.
 *
 * NOTE: Soft penalties are NOT applied here. They are computed separately
 * in the scoring layer. This function only handles hard exclusions.
 */
export function applyFilters(
  candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): FilterResult {
  return filterByHardExclusions(candidates, viewer, config);
}
