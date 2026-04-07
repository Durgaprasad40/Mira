/**
 * Intent Refinement Utility
 *
 * ADDITIVE refinement layer for relationship intent matching.
 * Works alongside existing compatibilityScore() - does NOT replace it.
 *
 * CRITICAL RULES:
 * - Range: -5 to +5 (STRICT)
 * - Missing data = neutral (0)
 * - New users = neutral (0)
 * - Multi-select = best match wins
 * - Null-safe throughout
 *
 * LEGACY NORMALIZATION:
 * Maps deprecated values to current canonical values before comparison.
 * This ensures users with old data still get proper matching.
 *
 * SCORING TIERS:
 * - Tier A (+5): Strong alignment (serious↔serious, casual↔casual)
 * - Tier B (+3): Compatible alignment (serious↔see_where_it_goes)
 * - Tier C (0): Neutral (missing data, unclear matches)
 * - Tier D (-2): Mild mismatch (serious↔exploring)
 * - Tier E (-5): Strong mismatch (serious↔casual)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Refinement score range (STRICT LIMITS)
 */
const MAX_REFINEMENT_BOOST = 5;
const MAX_REFINEMENT_PENALTY = -5;

/**
 * Legacy value to canonical value mapping.
 * Source: schema.ts legacy values + product taxonomy
 */
const LEGACY_INTENT_MAP: Record<string, string> = {
  // LEGACY → CANONICAL
  long_term: 'serious_vibes',
  short_term: 'keep_it_casual',
  fwb: 'keep_it_casual',
  figuring_out: 'exploring_vibes',
  short_to_long: 'see_where_it_goes',
  long_to_short: 'open_to_vibes',
};

/**
 * Canonical intent values (current 9 categories).
 * Used for validation and safe defaults.
 */
const CANONICAL_INTENTS = new Set([
  'serious_vibes',
  'keep_it_casual',
  'exploring_vibes',
  'see_where_it_goes',
  'open_to_vibes',
  'just_friends',
  'open_to_anything',
  'single_parent',
  'new_to_dating',
]);

// ---------------------------------------------------------------------------
// Intent Scoring Matrix
// ---------------------------------------------------------------------------

/**
 * Pairwise refinement scores.
 * Key format: "userIntent:candidateIntent"
 * Scores are from user's perspective.
 *
 * SCORING LOGIC:
 * +5: Perfect alignment (both want same thing)
 * +3: Compatible (complementary intents)
 * -2: Mild mismatch (different energy but not opposite)
 * -5: Strong mismatch (fundamentally incompatible)
 * 0: Neutral (unlisted pairs, ambiguous matches)
 */
const INTENT_REFINEMENT_MATRIX: Record<string, number> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER A (+5): Strong Alignment - Both want the same thing
  // ═══════════════════════════════════════════════════════════════════════════
  'serious_vibes:serious_vibes': 5,
  'keep_it_casual:keep_it_casual': 5,
  'exploring_vibes:exploring_vibes': 5,
  'see_where_it_goes:see_where_it_goes': 5,
  'open_to_vibes:open_to_vibes': 5,
  'just_friends:just_friends': 5,
  'open_to_anything:open_to_anything': 5,
  'single_parent:single_parent': 5,
  'new_to_dating:new_to_dating': 5,

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER B (+3): Compatible Alignment - Complementary intents
  // ═══════════════════════════════════════════════════════════════════════════
  // Serious + open to it
  'serious_vibes:see_where_it_goes': 3,
  'see_where_it_goes:serious_vibes': 3,

  // Casual + flexible
  'keep_it_casual:open_to_vibes': 3,
  'open_to_vibes:keep_it_casual': 3,

  // Exploring + open to anything
  'exploring_vibes:open_to_anything': 3,
  'open_to_anything:exploring_vibes': 3,
  'exploring_vibes:new_to_dating': 3,
  'new_to_dating:exploring_vibes': 3,

  // Open to anything + new to dating (both flexible)
  'open_to_anything:new_to_dating': 3,
  'new_to_dating:open_to_anything': 3,

  // Single parent + serious (family-oriented)
  'single_parent:serious_vibes': 3,
  'serious_vibes:single_parent': 3,

  // Just friends + open to anything
  'just_friends:open_to_anything': 3,
  'open_to_anything:just_friends': 3,

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER D (-2): Mild Mismatch - Different energy but not opposite
  // ═══════════════════════════════════════════════════════════════════════════
  // Serious vs exploring (commitment mismatch)
  'serious_vibes:exploring_vibes': -2,
  'exploring_vibes:serious_vibes': -2,

  // Casual vs exploring (some tension but manageable)
  'keep_it_casual:exploring_vibes': -2,
  'exploring_vibes:keep_it_casual': -2,

  // Just friends vs romantic intents
  'just_friends:serious_vibes': -2,
  'serious_vibes:just_friends': -2,
  'just_friends:keep_it_casual': -2,
  'keep_it_casual:just_friends': -2,

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER E (-5): Strong Mismatch - Fundamentally incompatible
  // ═══════════════════════════════════════════════════════════════════════════
  // Serious vs casual (opposite ends)
  'serious_vibes:keep_it_casual': -5,
  'keep_it_casual:serious_vibes': -5,
};

// ---------------------------------------------------------------------------
// Legacy Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a single intent value.
 * Converts legacy values to canonical values.
 *
 * @param intent - Raw intent value (may be legacy)
 * @returns Canonical intent value
 */
function normalizeIntentValue(intent: string): string {
  if (!intent || typeof intent !== 'string') {
    return '';
  }

  // Check if it's a legacy value
  if (LEGACY_INTENT_MAP[intent]) {
    return LEGACY_INTENT_MAP[intent];
  }

  // Return as-is if canonical or unknown
  return intent;
}

/**
 * Normalize an array of intent values.
 * - Converts legacy values to canonical
 * - Removes duplicates (after normalization)
 * - Filters out empty/invalid values
 *
 * @param intentArray - Raw intent array (may contain legacy values)
 * @returns Normalized, deduplicated array of canonical intents
 */
export function normalizeIntentArray(
  intentArray: string[] | null | undefined
): string[] {
  // Null safety
  if (!intentArray || !Array.isArray(intentArray)) {
    return [];
  }

  // Normalize and dedupe
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const intent of intentArray) {
    const norm = normalizeIntentValue(intent);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      normalized.push(norm);
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Pairwise Scoring
// ---------------------------------------------------------------------------

/**
 * Get refinement score for a single intent pair.
 *
 * @param userIntent - User's intent (normalized)
 * @param candidateIntent - Candidate's intent (normalized)
 * @returns Score for this pair (-5 to +5, or null if unlisted)
 */
function getPairScore(
  userIntent: string,
  candidateIntent: string
): number | null {
  if (!userIntent || !candidateIntent) {
    return null;
  }

  const key = `${userIntent}:${candidateIntent}`;
  const score = INTENT_REFINEMENT_MATRIX[key];

  return score !== undefined ? score : null;
}

// ---------------------------------------------------------------------------
// Main Refinement Function
// ---------------------------------------------------------------------------

/**
 * Calculate intent refinement score between user and candidate.
 *
 * RULES:
 * - Normalizes both arrays (legacy → canonical)
 * - Compares all pairs
 * - Returns best match (highest score)
 * - Missing data = 0 (neutral)
 *
 * @param userIntent - User's relationship intent array
 * @param candidateIntent - Candidate's relationship intent array
 * @returns Refinement score (-5 to +5)
 */
export function getIntentRefinement(
  userIntent: string[] | null | undefined,
  candidateIntent: string[] | null | undefined
): number {
  // Normalize both arrays
  const normalizedUser = normalizeIntentArray(userIntent);
  const normalizedCandidate = normalizeIntentArray(candidateIntent);

  // Missing data = neutral
  if (normalizedUser.length === 0 || normalizedCandidate.length === 0) {
    return 0;
  }

  // Find best match across all pairs
  let bestScore: number | null = null;

  for (const uIntent of normalizedUser) {
    for (const cIntent of normalizedCandidate) {
      const pairScore = getPairScore(uIntent, cIntent);

      if (pairScore !== null) {
        // Track best (highest) score
        if (bestScore === null || pairScore > bestScore) {
          bestScore = pairScore;
        }
      }
    }
  }

  // No matches found = neutral
  if (bestScore === null) {
    return 0;
  }

  // Clamp to valid range
  return Math.max(MAX_REFINEMENT_PENALTY, Math.min(MAX_REFINEMENT_BOOST, bestScore));
}

/**
 * Check if a user has only legacy intents (needs migration).
 * Useful for analytics/debugging.
 *
 * @param intentArray - Raw intent array
 * @returns True if all intents are legacy values
 */
export function hasOnlyLegacyIntents(
  intentArray: string[] | null | undefined
): boolean {
  if (!intentArray || intentArray.length === 0) {
    return false;
  }

  return intentArray.every(intent => LEGACY_INTENT_MAP[intent] !== undefined);
}

/**
 * Check if any legacy intents are present (for migration tracking).
 *
 * @param intentArray - Raw intent array
 * @returns True if any legacy values are present
 */
export function hasLegacyIntents(
  intentArray: string[] | null | undefined
): boolean {
  if (!intentArray || intentArray.length === 0) {
    return false;
  }

  return intentArray.some(intent => LEGACY_INTENT_MAP[intent] !== undefined);
}

// ---------------------------------------------------------------------------
// Exported Constants
// ---------------------------------------------------------------------------

export const INTENT_REFINEMENT_CONFIG = {
  maxBoost: MAX_REFINEMENT_BOOST,
  maxPenalty: MAX_REFINEMENT_PENALTY,
  legacyMap: LEGACY_INTENT_MAP,
  canonicalIntents: Array.from(CANONICAL_INTENTS),
  tiers: {
    tierA: { score: 5, description: 'Strong alignment' },
    tierB: { score: 3, description: 'Compatible alignment' },
    tierC: { score: 0, description: 'Neutral (missing/unclear)' },
    tierD: { score: -2, description: 'Mild mismatch' },
    tierE: { score: -5, description: 'Strong mismatch' },
  },
};
