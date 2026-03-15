/**
 * Ranking Configuration
 *
 * Feature flags and configuration for the shared ranking engine migration.
 *
 * Phase 2: Feature flag setup - defaults to OFF (no production impact).
 *
 * Migration phases:
 * - Phase 0: Scaffolding (DONE)
 * - Phase 1: Adapters (DONE)
 * - Phase 2: Feature flags (CURRENT)
 * - Phase 3: Shadow mode (compare old vs new scores)
 * - Phase 4: Phase-1 cutover (gradual rollout)
 * - Phase 5: Phase-2 shadow mode
 * - Phase 6: Phase-2 cutover
 * - Phase 7: Cleanup
 */

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

/**
 * Master switch for the shared ranking engine.
 *
 * When FALSE (default):
 * - discover.ts uses discoverRanking.ts (Phase-1 legacy)
 * - privateDiscover.ts uses phase2Ranking.ts (Phase-2 legacy)
 *
 * When TRUE:
 * - discover.ts uses sharedRankingEngine.ts via phase1Adapter
 * - privateDiscover.ts uses sharedRankingEngine.ts via phase2Adapter
 *
 * IMPORTANT: Do NOT set to true until shadow mode testing is complete.
 */
export const USE_SHARED_RANKING_ENGINE = false;

/**
 * Enable shadow mode comparison logging.
 *
 * When TRUE:
 * - Both old and new ranking scores are computed
 * - Differences are logged for analysis
 * - Old scores are still used for actual ranking
 *
 * This flag is only meaningful when USE_SHARED_RANKING_ENGINE is false.
 */
export const ENABLE_SHADOW_MODE_LOGGING = false;

/**
 * Percentage of requests to run shadow comparison on (0-100).
 * Used to reduce logging volume in production.
 */
export const SHADOW_MODE_SAMPLE_RATE = 10; // 10% of requests

/**
 * Score difference threshold for warning logs.
 * If old score and new score differ by more than this, log a warning.
 */
export const SCORE_DIFF_WARNING_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// Rollout Configuration
// ---------------------------------------------------------------------------

/**
 * Gradual rollout percentage for Phase-1 (Discover).
 * 0 = all traffic uses old system
 * 100 = all traffic uses new system
 *
 * Used when USE_SHARED_RANKING_ENGINE is true.
 */
export const PHASE1_ROLLOUT_PERCENTAGE = 0;

/**
 * Gradual rollout percentage for Phase-2 (Desire Land).
 * 0 = all traffic uses old system
 * 100 = all traffic uses new system
 *
 * Used when USE_SHARED_RANKING_ENGINE is true.
 */
export const PHASE2_ROLLOUT_PERCENTAGE = 0;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Check if a request should use the new shared ranking engine.
 *
 * @param phase - Which phase to check ('phase1' or 'phase2')
 * @param userId - Optional user ID for deterministic rollout
 * @returns true if the request should use the shared engine
 */
export function shouldUseSharedEngine(
  phase: 'phase1' | 'phase2',
  userId?: string
): boolean {
  // Master switch must be on
  if (!USE_SHARED_RANKING_ENGINE) {
    return false;
  }

  // Get rollout percentage for this phase
  const rolloutPercentage = phase === 'phase1'
    ? PHASE1_ROLLOUT_PERCENTAGE
    : PHASE2_ROLLOUT_PERCENTAGE;

  // If 0%, never use new engine
  if (rolloutPercentage <= 0) {
    return false;
  }

  // If 100%, always use new engine
  if (rolloutPercentage >= 100) {
    return true;
  }

  // Deterministic rollout based on user ID
  if (userId) {
    const hash = simpleHash(userId);
    return (hash % 100) < rolloutPercentage;
  }

  // Random rollout if no user ID
  return Math.random() * 100 < rolloutPercentage;
}

/**
 * Check if shadow mode comparison should run for this request.
 *
 * @returns true if shadow comparison should be logged
 */
export function shouldRunShadowComparison(): boolean {
  if (!ENABLE_SHADOW_MODE_LOGGING) {
    return false;
  }

  // Sample rate check
  return Math.random() * 100 < SHADOW_MODE_SAMPLE_RATE;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Simple hash function for deterministic rollout.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
