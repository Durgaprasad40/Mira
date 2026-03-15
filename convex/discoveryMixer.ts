/**
 * Discovery Mixer
 *
 * Handles exploration/fairness mixing for the discovery engine.
 * Ensures underexposed profiles get fair representation.
 *
 * NOTE: This mixer is OPTIONAL post-processing on top of score-based fairness.
 * Compatibility ranking remains the PRIMARY ordering source.
 * Exploration mixing provides a small fairness boost to underexposed profiles
 * without drastically altering the compatibility-based ranking.
 *
 * This module is ADDITIVE - it does not modify any existing ranking/discovery logic.
 */

import {
  RankedDiscoveryCandidate,
  DiscoveryEngineConfig,
  DEFAULT_DISCOVERY_CONFIG,
} from './discoveryTypes';

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Threshold for identifying underexposed profiles.
 * Profiles with fewer than this many impressions are considered underexposed.
 */
const UNDEREXPOSED_IMPRESSION_THRESHOLD = 20;

/**
 * Window for "recently shown" determination (4 hours in ms).
 * Profiles shown within this window are not eligible for exploration boost.
 */
const RECENT_SHOWN_WINDOW_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mixing Functions
// ---------------------------------------------------------------------------

/**
 * Mix exploration candidates into the ranked results.
 *
 * Strategy:
 * - Take top (1 - explorationRatio) from ranked results
 * - Fill remaining slots with underexposed candidates
 * - Underexposed = low totalImpressions + not recently shown
 *
 * This ensures fairness without drastically altering compatibility rankings.
 *
 * @param ranked - Candidates sorted by score (descending)
 * @param limit - Total number of results to return
 * @param config - Engine configuration
 * @returns Mixed results with exploration candidates interspersed
 */
export function mixExplorationCandidates(
  ranked: RankedDiscoveryCandidate[],
  limit: number,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): RankedDiscoveryCandidate[] {
  if (ranked.length === 0 || limit <= 0) {
    return [];
  }

  const explorationRatio = config.exploration.ratio;

  // Number of slots for exploration
  const explorationSlots = Math.floor(limit * explorationRatio);
  const primarySlots = limit - explorationSlots;

  if (explorationSlots === 0 || ranked.length <= primarySlots) {
    // No exploration needed or not enough candidates
    return ranked.slice(0, limit);
  }

  // Identify exploration candidates (underexposed profiles)
  const explorationPool = identifyUnderexposed(ranked, primarySlots);

  if (explorationPool.length === 0) {
    // No underexposed candidates available
    return ranked.slice(0, limit);
  }

  // Take primary results
  const primary = ranked.slice(0, primarySlots);

  // Take exploration candidates (up to explorationSlots)
  const exploration = explorationPool.slice(0, explorationSlots);

  // Merge: interleave exploration candidates into primary results
  const mixed = interleaveResults(primary, exploration);

  // Deduplicate by candidate.id (in case exploration candidate was also in primary)
  const seen = new Set<string>();
  const deduped: RankedDiscoveryCandidate[] = [];
  for (const rc of mixed) {
    if (!seen.has(rc.candidate.id)) {
      seen.add(rc.candidate.id);
      deduped.push(rc);
    }
  }

  // Explicitly slice to limit
  return deduped.slice(0, limit);
}

/**
 * Identify underexposed candidates from the ranked list.
 *
 * Underexposed candidates are those that:
 * - Have low totalImpressions (< UNDEREXPOSED_IMPRESSION_THRESHOLD)
 * - Haven't been shown recently (> RECENT_SHOWN_WINDOW_MS)
 *
 * These are pulled from lower in the ranking to give them visibility.
 *
 * @param ranked - Full ranked list
 * @param topN - Number of top results to exclude from exploration pool
 * @returns Candidates eligible for exploration boost
 */
function identifyUnderexposed(
  ranked: RankedDiscoveryCandidate[],
  topN: number
): RankedDiscoveryCandidate[] {
  const now = Date.now();

  // Only consider candidates outside top N
  const candidates = ranked.slice(topN);

  // Filter to underexposed (low impressions, not recently shown)
  return candidates.filter(rc => {
    const impressions = rc.candidate.totalImpressions ?? 0;
    const lastShown = rc.candidate.lastShownAt ?? 0;
    const timeSinceShown = now - lastShown;

    // Underexposed: below impression threshold AND not shown recently
    return (
      impressions < UNDEREXPOSED_IMPRESSION_THRESHOLD &&
      (lastShown === 0 || timeSinceShown > RECENT_SHOWN_WINDOW_MS)
    );
  });
}

/**
 * Interleave exploration candidates into primary results.
 *
 * Strategy: Distribute exploration candidates evenly through results.
 * For example, with 8 primary and 2 exploration, insert at positions 3 and 6.
 *
 * Edge case handling:
 * - If interval <= 1, fallback to appending exploration at end (no odd clustering)
 * - Small lists are handled gracefully
 *
 * @param primary - Primary ranked results
 * @param exploration - Exploration candidates to interleave
 * @returns Combined results with exploration interleaved
 */
function interleaveResults(
  primary: RankedDiscoveryCandidate[],
  exploration: RankedDiscoveryCandidate[]
): RankedDiscoveryCandidate[] {
  if (exploration.length === 0) {
    return [...primary];
  }

  if (primary.length === 0) {
    return [...exploration];
  }

  const totalSlots = primary.length + exploration.length;

  // Calculate insertion interval
  const interval = Math.floor(totalSlots / (exploration.length + 1));

  // Edge case: if interval <= 1, interleaving would cluster exploration oddly.
  // Fallback: append exploration candidates at the end for stable behavior.
  if (interval <= 1) {
    return [...primary, ...exploration];
  }

  const result: RankedDiscoveryCandidate[] = [];
  let primaryIdx = 0;
  let explorationIdx = 0;

  for (let i = 0; i < totalSlots; i++) {
    // Insert exploration at every interval position (starting after first interval)
    if (
      explorationIdx < exploration.length &&
      (i + 1) % interval === 0 &&
      i > 0
    ) {
      result.push(exploration[explorationIdx]);
      explorationIdx++;
    } else if (primaryIdx < primary.length) {
      result.push(primary[primaryIdx]);
      primaryIdx++;
    }
  }

  // Add any remaining (edge case cleanup)
  while (primaryIdx < primary.length) {
    result.push(primary[primaryIdx++]);
  }
  while (explorationIdx < exploration.length) {
    result.push(exploration[explorationIdx++]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reserved / Analysis-Only Functions
// ---------------------------------------------------------------------------

/**
 * RESERVED: Apply fairness reranking to boost underexposed profiles.
 *
 * This function is INTENTIONALLY NOT USED by the current discovery engine.
 * It is reserved for potential future post-processing fairness strategies.
 *
 * Current implementation: Fairness is applied during scoring (computeBoostBreakdown),
 * not as a post-processing reranking step.
 *
 * If this function is ever implemented, it would provide a gentler alternative
 * to mixing by adjusting scores slightly without removing top results.
 *
 * @param ranked - Candidates sorted by score
 * @param _config - Engine configuration (unused in current implementation)
 * @returns Same ranked candidates (no-op passthrough)
 */
export function applyFairnessReranking(
  ranked: RankedDiscoveryCandidate[],
  _config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): RankedDiscoveryCandidate[] {
  // RESERVED: No-op passthrough. See docstring for context.
  return ranked;
}
