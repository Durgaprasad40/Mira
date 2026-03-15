/**
 * Shared Discovery Engine
 *
 * The main orchestrator for compatibility-based discovery.
 * Consumes normalized candidates from Phase-1 and Phase-2 adapters,
 * applies filtering, scoring, and mixing to produce ranked results.
 *
 * This engine is ADDITIVE - it does not modify any existing ranking/discovery logic.
 * It is designed to be used alongside existing systems during shadow mode testing.
 *
 * Flow:
 * 1. Accept normalized candidates (from adapters)
 * 2. Apply hard exclusion filters
 * 3. Score eligible candidates
 * 4. Apply exploration mixing (if enabled)
 * 5. Return ranked results with optional breakdown
 */

import {
  NormalizedDiscoveryCandidate,
  DiscoveryViewerContext,
  RankedDiscoveryCandidate,
  DiscoveryEngineOptions,
  DiscoveryEngineResult,
  DiscoveryEngineConfig,
  DEFAULT_DISCOVERY_CONFIG,
} from './discoveryTypes';

import { applyFilters } from './discoveryFilters';

import {
  computeFinalScore,
  computeFinalScoreWithBreakdown,
} from './discoveryScoring';

import { mixExplorationCandidates } from './discoveryMixer';

// ---------------------------------------------------------------------------
// Main Engine Function
// ---------------------------------------------------------------------------

/**
 * Run the shared discovery engine on a set of normalized candidates.
 *
 * @param candidates - Normalized candidates from Phase-1 and/or Phase-2 adapters
 * @param viewer - Viewer context with preferences and blocked/reported sets
 * @param options - Engine options (limit, breakdown, exploration, fairness)
 * @returns Ranked results with metadata
 */
export function runDiscoveryEngine(
  candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  options: DiscoveryEngineOptions
): DiscoveryEngineResult {
  const config = mergeConfig(options.config);
  const {
    limit,
    includeBreakdown = false,
    enableExploration = true,
    enableFairness = true,
  } = options;

  // Guard: invalid limit returns empty result
  if (limit <= 0) {
    return {
      ranked: [],
      totalCandidates: candidates.length,
      totalEligible: 0,
      excluded: 0,
      explorationUsed: false,
    };
  }

  // Step 1: Apply hard exclusion filters
  const filterResult = applyFilters(candidates, viewer, config);
  const eligible = filterResult.eligible;

  // Step 2: Score all eligible candidates
  const scored = scoreAllCandidates(
    eligible,
    viewer,
    config,
    { enableFairness, enableExploration },
    includeBreakdown
  );

  // Step 3: Sort by final score (descending)
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Step 4: Apply exploration mixing if enabled
  // explorationUsed = true means the post-score mixer was actually applied,
  // not just that exploration was enabled in options.
  let ranked: RankedDiscoveryCandidate[];
  let explorationUsed = false;

  if (enableExploration && scored.length > limit) {
    ranked = mixExplorationCandidates(scored, limit, config);
    explorationUsed = true;
  } else {
    ranked = scored.slice(0, limit);
  }

  // Explicitly slice to limit (defensive, ensures mixer compliance)
  ranked = ranked.slice(0, limit);

  return {
    ranked,
    totalCandidates: candidates.length,
    totalEligible: eligible.length,
    excluded: filterResult.excluded.length,
    explorationUsed,
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Merge partial config with defaults.
 */
function mergeConfig(
  partial?: Partial<DiscoveryEngineConfig>
): DiscoveryEngineConfig {
  if (!partial) {
    return DEFAULT_DISCOVERY_CONFIG;
  }

  return {
    weights: { ...DEFAULT_DISCOVERY_CONFIG.weights, ...partial.weights },
    distance: { ...DEFAULT_DISCOVERY_CONFIG.distance, ...partial.distance },
    penalties: { ...DEFAULT_DISCOVERY_CONFIG.penalties, ...partial.penalties },
    boosts: { ...DEFAULT_DISCOVERY_CONFIG.boosts, ...partial.boosts },
    exploration: { ...DEFAULT_DISCOVERY_CONFIG.exploration, ...partial.exploration },
  };
}

/**
 * Score all eligible candidates.
 *
 * Always computes real breakdown data to avoid misleading zero values.
 * The includeBreakdown flag is kept for API compatibility but breakdown
 * is always computed to ensure accurate data.
 *
 * @param candidates - Eligible candidates after filtering
 * @param viewer - Viewer context
 * @param config - Engine configuration
 * @param options - Scoring options (fairness, exploration)
 * @param _includeBreakdown - Kept for API compatibility (breakdown always computed)
 * @returns Array of ranked candidates with scores
 */
function scoreAllCandidates(
  candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig,
  options: { enableFairness: boolean; enableExploration: boolean },
  _includeBreakdown: boolean
): RankedDiscoveryCandidate[] {
  // Always compute real breakdown to avoid misleading zero values.
  // The cost of computing breakdown is minimal compared to the risk
  // of returning fake/zero breakdown data that could mislead consumers.
  return candidates.map(candidate => {
    const { score, breakdown } = computeFinalScoreWithBreakdown(
      candidate,
      viewer,
      config,
      options
    );
    return {
      candidate,
      finalScore: score,
      breakdown,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase-Specific Entry Points
// ---------------------------------------------------------------------------

/**
 * Run discovery for Phase-1 candidates only.
 *
 * Convenience wrapper that accepts Phase-1 normalized candidates.
 * Use this when you only have Phase-1 data.
 *
 * Non-Phase-1 candidates are silently filtered out.
 */
export function runPhase1Discovery(
  candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  options: DiscoveryEngineOptions
): DiscoveryEngineResult {
  // Filter to Phase-1 only (silently ignore non-Phase-1)
  const phase1Only = candidates.filter(c => c.phase === 'phase1');
  return runDiscoveryEngine(phase1Only, viewer, options);
}

/**
 * Run discovery for Phase-2 candidates only.
 *
 * Convenience wrapper that accepts Phase-2 normalized candidates.
 * Use this when you only have Phase-2 data.
 *
 * NOTE: Phase-2 candidates have limited data (no archetype, values, battery, life rhythm).
 * The scoring engine will use neutral fallbacks for missing data.
 *
 * Non-Phase-2 candidates are silently filtered out.
 */
export function runPhase2Discovery(
  candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  options: DiscoveryEngineOptions
): DiscoveryEngineResult {
  // Filter to Phase-2 only (silently ignore non-Phase-2)
  const phase2Only = candidates.filter(c => c.phase === 'phase2');
  return runDiscoveryEngine(phase2Only, viewer, options);
}

/**
 * Run mixed discovery with both Phase-1 and Phase-2 candidates.
 *
 * This is the unified entry point for cross-phase discovery.
 * Both phases are scored using the same compatibility formula,
 * with Phase-2 using neutral fallbacks for unavailable data.
 */
export function runMixedDiscovery(
  phase1Candidates: NormalizedDiscoveryCandidate[],
  phase2Candidates: NormalizedDiscoveryCandidate[],
  viewer: DiscoveryViewerContext,
  options: DiscoveryEngineOptions
): DiscoveryEngineResult {
  // Combine candidates
  const allCandidates = [...phase1Candidates, ...phase2Candidates];
  return runDiscoveryEngine(allCandidates, viewer, options);
}

// ---------------------------------------------------------------------------
// Utility Exports
// ---------------------------------------------------------------------------

/**
 * Get ranked candidate IDs only (without full breakdown).
 *
 * Useful for shadow mode comparison where you only need the ranking order.
 */
export function getRankedIds(result: DiscoveryEngineResult): string[] {
  return result.ranked.map(rc => rc.candidate.id);
}

// ---------------------------------------------------------------------------
// Analysis-Only Utilities (Shadow Mode)
// ---------------------------------------------------------------------------

/**
 * Compare two ranking results.
 *
 * ANALYSIS-ONLY: This function is a shadow-mode utility for comparing
 * legacy vs. shared ranking results. It is NOT part of the live ranking
 * execution path and should only be used for offline analysis/testing.
 *
 * Returns metrics for shadow mode analysis:
 * - topKOverlap: Overlap ratio at K = 5, 10, 20
 * - kendallTau: Rank correlation coefficient (-1 to 1)
 * - positionChanges: Per-candidate position changes
 */
export function compareRankings(
  legacy: string[],
  shared: string[]
): {
  topKOverlap: Record<number, number>;
  kendallTau: number;
  positionChanges: { id: string; legacyPos: number; sharedPos: number; change: number }[];
} {
  // Top-K overlap for K = 5, 10, 20
  const topKOverlap: Record<number, number> = {};
  for (const k of [5, 10, 20]) {
    const legacyTopK = new Set(legacy.slice(0, k));
    const sharedTopK = new Set(shared.slice(0, k));
    let overlap = 0;
    for (const id of legacyTopK) {
      if (sharedTopK.has(id)) overlap++;
    }
    topKOverlap[k] = overlap / k;
  }

  // Build position maps
  const legacyPos = new Map(legacy.map((id, i) => [id, i]));
  const sharedPos = new Map(shared.map((id, i) => [id, i]));

  // Position changes for each ID in legacy
  const positionChanges: { id: string; legacyPos: number; sharedPos: number; change: number }[] = [];
  for (const [id, lPos] of legacyPos) {
    const sPos = sharedPos.get(id);
    if (sPos !== undefined) {
      positionChanges.push({
        id,
        legacyPos: lPos,
        sharedPos: sPos,
        change: lPos - sPos, // Positive = moved up in shared ranking
      });
    }
  }

  // Simplified Kendall tau approximation (correlation of ranks)
  // Full Kendall tau is O(n^2), so we use a simplified version
  let concordant = 0;
  let discordant = 0;
  const commonIds = positionChanges.map(p => p.id);
  for (let i = 0; i < commonIds.length; i++) {
    for (let j = i + 1; j < commonIds.length; j++) {
      const li = legacyPos.get(commonIds[i])!;
      const lj = legacyPos.get(commonIds[j])!;
      const si = sharedPos.get(commonIds[i])!;
      const sj = sharedPos.get(commonIds[j])!;

      if ((li < lj && si < sj) || (li > lj && si > sj)) {
        concordant++;
      } else {
        discordant++;
      }
    }
  }
  const total = concordant + discordant;
  const kendallTau = total > 0 ? (concordant - discordant) / total : 0;

  return { topKOverlap, kendallTau, positionChanges };
}
