/**
 * Discovery Scoring
 *
 * Compatibility-based scoring for the shared discovery engine.
 * Implements the approved formula with 8 weighted subscores.
 *
 * Formula:
 * base_score =
 *   0.20 * archetype_score
 * + 0.20 * values_score
 * + 0.18 * lifestyle_score
 * + 0.12 * interest_score
 * + 0.15 * bucket_score
 * + 0.07 * battery_score
 * + 0.03 * expression_score
 * + 0.05 * intent_score
 *
 * final_score = base_score * 100 - penalties + boosts
 *
 * This module is ADDITIVE - it does not modify any existing ranking/discovery logic.
 */

import {
  NormalizedDiscoveryCandidate,
  DiscoveryViewerContext,
  DiscoveryScoreBreakdown,
  DiscoveryPenaltyBreakdown,
  DiscoveryBoostBreakdown,
  DiscoveryFullBreakdown,
  DiscoveryEngineConfig,
  DEFAULT_DISCOVERY_CONFIG,
} from './discoveryTypes';

import {
  computeDistancePenalty,
  computeChildrenPenalty,
  computeLifestyleDealbreaker,
  computeLowEffortPenalty,
} from './discoveryFilters';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Neutral score when data is unavailable.
 * Used to avoid penalizing candidates with missing data.
 *
 * IMPORTANT: Phase-2 profiles lack archetype, values, battery, and life rhythm data.
 * Missing data should ALWAYS be treated neutrally (0.5), never as incompatibility.
 * This ensures Phase-2 candidates are not unfairly penalized for data they cannot provide.
 */
const NEUTRAL_SCORE = 0.5;

/**
 * One hour in milliseconds.
 */
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * One day in milliseconds.
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Six hours in milliseconds (used for exploration time buckets).
 */
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Individual Subscore Functions (all return 0-1)
// ---------------------------------------------------------------------------

/**
 * Compute archetype compatibility score.
 *
 * Archetypes: builder, performer, seeker, grounded
 * - Exact match: 1.0
 * - Compatible pairs: 0.7 (e.g., builder-seeker, performer-grounded)
 * - Neutral pairs: 0.5
 * - Low compatibility: 0.3
 *
 * If either party lacks archetype data, returns NEUTRAL_SCORE.
 */
export function computeArchetypeScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  // If either is unavailable, return neutral (not penalizing missing data)
  if (!candidate.archetypeAvailable || !viewer.archetypeAvailable) {
    return NEUTRAL_SCORE;
  }

  if (!candidate.archetype || !viewer.archetype) {
    return NEUTRAL_SCORE;
  }

  // Exact match
  if (candidate.archetype === viewer.archetype) {
    return 1.0;
  }

  // Compatibility matrix based on archetype theory
  // Higher values = more compatible pairings
  const compatibility: Record<string, Record<string, number>> = {
    builder: {
      builder: 1.0,
      seeker: 0.7,    // Complementary: builders inspire seekers
      performer: 0.5, // Neutral
      grounded: 0.6,  // Moderate: stability meets ambition
    },
    performer: {
      performer: 1.0,
      grounded: 0.7,  // Complementary: grounded provides stability
      builder: 0.5,   // Neutral
      seeker: 0.6,    // Moderate: both seek expression
    },
    seeker: {
      seeker: 1.0,
      builder: 0.7,   // Complementary: builders provide direction
      grounded: 0.5,  // Neutral
      performer: 0.6, // Moderate: both value experience
    },
    grounded: {
      grounded: 1.0,
      performer: 0.7, // Complementary: grounded stabilizes performer
      seeker: 0.5,    // Neutral
      builder: 0.6,   // Moderate: shared practicality
    },
  };

  return compatibility[viewer.archetype]?.[candidate.archetype] ?? NEUTRAL_SCORE;
}

/**
 * Compute core values alignment score.
 *
 * Based on overlap between viewer and candidate core values.
 * - 3+ shared values: 1.0
 * - 2 shared values: 0.8
 * - 1 shared value: 0.6
 * - 0 shared values: 0.3 (not 0, as no overlap doesn't mean incompatible)
 *
 * If either party lacks values data, returns NEUTRAL_SCORE.
 */
export function computeValuesScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  // If either is unavailable, return neutral
  if (!candidate.valuesAvailable || !viewer.valuesAvailable) {
    return NEUTRAL_SCORE;
  }

  if (candidate.coreValues.length === 0 || viewer.coreValues.length === 0) {
    return NEUTRAL_SCORE;
  }

  // Count shared values (case-insensitive)
  const viewerValuesLower = new Set(viewer.coreValues.map(v => v.toLowerCase()));
  const sharedCount = candidate.coreValues.filter(
    v => viewerValuesLower.has(v.toLowerCase())
  ).length;

  // Score based on shared values count
  if (sharedCount >= 3) return 1.0;
  if (sharedCount === 2) return 0.8;
  if (sharedCount === 1) return 0.6;
  return 0.3;
}

/**
 * Compute lifestyle compatibility score.
 *
 * Considers: smoking, drinking, exercise, religion, pets
 * Each matching attribute contributes to the score.
 * Missing attributes are treated neutrally (not penalized).
 */
export function computeLifestyleScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  let matchCount = 0;
  let comparedCount = 0;

  // Compare smoking
  if (candidate.lifestyle.smoking && viewer.lifestyle.smoking) {
    comparedCount++;
    if (candidate.lifestyle.smoking === viewer.lifestyle.smoking) {
      matchCount++;
    }
  }

  // Compare drinking
  if (candidate.lifestyle.drinking && viewer.lifestyle.drinking) {
    comparedCount++;
    if (candidate.lifestyle.drinking === viewer.lifestyle.drinking) {
      matchCount++;
    }
  }

  // Compare exercise
  if (candidate.lifestyle.exercise && viewer.lifestyle.exercise) {
    comparedCount++;
    if (candidate.lifestyle.exercise === viewer.lifestyle.exercise) {
      matchCount++;
    }
  }

  // Compare religion
  if (candidate.lifestyle.religion && viewer.lifestyle.religion) {
    comparedCount++;
    if (candidate.lifestyle.religion === viewer.lifestyle.religion) {
      matchCount++;
    }
  }

  // Compare pets (if both have pets data)
  // Pets is an array - check for any overlap
  if (candidate.lifestyle.pets?.length && viewer.lifestyle.pets?.length) {
    comparedCount++;
    const viewerPetsLower = new Set(viewer.lifestyle.pets.map(p => p.toLowerCase()));
    const hasOverlap = candidate.lifestyle.pets.some(
      p => viewerPetsLower.has(p.toLowerCase())
    );
    if (hasOverlap) {
      matchCount++;
    }
  }

  // If no attributes compared, return neutral
  if (comparedCount === 0) {
    return NEUTRAL_SCORE;
  }

  // Score = ratio of matches to compared attributes
  // Scale from 0.3 (no matches) to 1.0 (all matches)
  const matchRatio = matchCount / comparedCount;
  return 0.3 + matchRatio * 0.7;
}

/**
 * Compute interest/activity overlap score.
 *
 * Based on shared activities between viewer and candidate.
 * - 5+ shared: 1.0
 * - 3-4 shared: 0.8
 * - 1-2 shared: 0.6
 * - 0 shared: 0.3
 */
export function computeInterestScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  if (candidate.activities.length === 0 || viewer.activities.length === 0) {
    return NEUTRAL_SCORE;
  }

  // Count shared activities (case-insensitive)
  const viewerActivitiesLower = new Set(viewer.activities.map(a => a.toLowerCase()));
  const sharedCount = candidate.activities.filter(
    a => viewerActivitiesLower.has(a.toLowerCase())
  ).length;

  // Score based on shared count
  if (sharedCount >= 5) return 1.0;
  if (sharedCount >= 3) return 0.8;
  if (sharedCount >= 1) return 0.6;
  return 0.3;
}

/**
 * Compute bucket/section prompt alignment score.
 *
 * Bucket signals represent which "archetype buckets" the user has engaged with
 * (builder, performer, seeker, grounded) based on section prompts answered.
 *
 * Score is based on weighted dot product of bucket signals.
 */
export function computeBucketScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  // If either lacks bucket data, return neutral
  if (!candidate.bucketAvailable || !viewer.bucketAvailable) {
    return NEUTRAL_SCORE;
  }

  const candidateBuckets = candidate.bucketSignals;
  const viewerBuckets = viewer.bucketSignals;

  // Compute weighted dot product (cosine similarity without normalization)
  const dotProduct =
    candidateBuckets.builder * viewerBuckets.builder +
    candidateBuckets.performer * viewerBuckets.performer +
    candidateBuckets.seeker * viewerBuckets.seeker +
    candidateBuckets.grounded * viewerBuckets.grounded;

  // Normalize to 0-1 range
  // Max possible dot product is 4.0 (all buckets = 1.0 for both)
  const normalizedScore = dotProduct / 4.0;

  // Scale from 0.3 minimum to 1.0 maximum
  return 0.3 + normalizedScore * 0.7;
}

/**
 * Compute social battery compatibility score.
 *
 * Social battery is 1-5 scale.
 * - Same value: 1.0
 * - ±1 difference: 0.8
 * - ±2 difference: 0.5
 * - ±3+ difference: 0.3
 */
export function computeBatteryScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  // If either lacks battery data, return neutral
  if (!candidate.batteryAvailable || !viewer.batteryAvailable) {
    return NEUTRAL_SCORE;
  }

  if (candidate.socialBattery === undefined || viewer.socialBattery === undefined) {
    return NEUTRAL_SCORE;
  }

  const difference = Math.abs(candidate.socialBattery - viewer.socialBattery);

  if (difference === 0) return 1.0;
  if (difference === 1) return 0.8;
  if (difference === 2) return 0.5;
  return 0.3;
}

/**
 * Helper: Compute life rhythm alignment score.
 *
 * Life rhythm includes: socialRhythm, sleepSchedule, travelStyle, workStyle
 * Score based on matching rhythm attributes.
 *
 * NOTE: This is a helper reserved for potential future use.
 * Currently NOT used in the main expression score (which uses keyword overlap).
 * It may be blended into expression score later if product requirements evolve.
 * Phase-2 lacks life rhythm data and will return neutral.
 */
function computeLifeRhythmAlignment(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  // If either lacks life rhythm data, return neutral
  if (!candidate.lifeRhythmAvailable || !viewer.lifeRhythmAvailable) {
    return NEUTRAL_SCORE;
  }

  let matchCount = 0;
  let comparedCount = 0;

  // Compare socialRhythm
  if (candidate.lifeRhythm.socialRhythm && viewer.lifeRhythm.socialRhythm) {
    comparedCount++;
    if (candidate.lifeRhythm.socialRhythm === viewer.lifeRhythm.socialRhythm) {
      matchCount++;
    }
  }

  // Compare sleepSchedule
  if (candidate.lifeRhythm.sleepSchedule && viewer.lifeRhythm.sleepSchedule) {
    comparedCount++;
    if (candidate.lifeRhythm.sleepSchedule === viewer.lifeRhythm.sleepSchedule) {
      matchCount++;
    }
  }

  // Compare travelStyle
  if (candidate.lifeRhythm.travelStyle && viewer.lifeRhythm.travelStyle) {
    comparedCount++;
    if (candidate.lifeRhythm.travelStyle === viewer.lifeRhythm.travelStyle) {
      matchCount++;
    }
  }

  // Compare workStyle
  if (candidate.lifeRhythm.workStyle && viewer.lifeRhythm.workStyle) {
    comparedCount++;
    if (candidate.lifeRhythm.workStyle === viewer.lifeRhythm.workStyle) {
      matchCount++;
    }
  }

  // If nothing compared, return neutral
  if (comparedCount === 0) {
    return NEUTRAL_SCORE;
  }

  // Score = ratio of matches
  const matchRatio = matchCount / comparedCount;
  return 0.3 + matchRatio * 0.7;
}

/**
 * Extract keywords from bio and prompts text.
 * Simple tokenization: lowercase, split on non-word chars, filter short words.
 */
function extractKeywords(bio: string, prompts: { question: string; answer: string }[]): Set<string> {
  const text = [
    bio,
    ...prompts.map(p => p.answer),
  ].join(' ');

  // Tokenize: lowercase, split on non-word characters
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter(token => token.length >= 3); // Filter very short words

  return new Set(tokens);
}

/**
 * Compute expression score based on keyword overlap in bio and prompts.
 *
 * This measures "chemistry" through textual similarity without embeddings.
 * - Extracts keywords from bio + prompt answers for both viewer and candidate
 * - Scores based on overlap count
 *
 * If text is missing on either side, returns neutral 0.5.
 */
export function computeExpressionScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  // Extract keywords from both sides
  const candidateKeywords = extractKeywords(candidate.bio, candidate.prompts);
  const viewerKeywords = extractKeywords(viewer.bio, viewer.prompts);

  // If either has no meaningful keywords, return neutral
  if (candidateKeywords.size === 0 || viewerKeywords.size === 0) {
    return NEUTRAL_SCORE;
  }

  // Count overlapping keywords
  let overlapCount = 0;
  for (const word of candidateKeywords) {
    if (viewerKeywords.has(word)) {
      overlapCount++;
    }
  }

  // Score based on overlap relative to smaller keyword set
  const minSetSize = Math.min(candidateKeywords.size, viewerKeywords.size);
  const overlapRatio = overlapCount / minSetSize;

  // Scale: 0% overlap = 0.3, 30%+ overlap = 1.0
  // This is intentionally soft - keyword overlap is just one signal
  const score = 0.3 + Math.min(overlapRatio / 0.3, 1) * 0.7;

  return score;
}

/**
 * Compute relationship intent compatibility score.
 *
 * Intent arrays may contain: casual, serious, marriage, open, friendship, etc.
 * Score based on overlap.
 * - High overlap: 1.0
 * - Some overlap: 0.7
 * - No overlap but both multi-intent: 0.45 (flexible, benefit of doubt)
 * - No overlap single-intent: 0.3
 *
 * NOTE: This is a soft signal, not a hard filter.
 * Multi-intent profiles are treated as more flexible and receive gentler scoring.
 */
export function computeIntentScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext
): number {
  if (candidate.relationshipIntent.length === 0 || viewer.relationshipIntent.length === 0) {
    return NEUTRAL_SCORE;
  }

  // Count shared intents (case-insensitive)
  const viewerIntentsLower = new Set(viewer.relationshipIntent.map(i => i.toLowerCase()));
  const sharedCount = candidate.relationshipIntent.filter(
    i => viewerIntentsLower.has(i.toLowerCase())
  ).length;

  const candidateTotal = candidate.relationshipIntent.length;
  const viewerTotal = viewer.relationshipIntent.length;
  const minTotal = Math.min(candidateTotal, viewerTotal);

  // Score based on overlap ratio
  if (minTotal === 0) return NEUTRAL_SCORE;

  const overlapRatio = sharedCount / minTotal;

  if (overlapRatio >= 0.5) return 1.0;  // High overlap
  if (overlapRatio > 0) return 0.7;      // Some overlap

  // No overlap - check if both are multi-intent (flexible)
  // Multi-intent users (2+ intents) are assumed to be more flexible
  const bothMultiIntent = candidateTotal >= 2 && viewerTotal >= 2;
  if (bothMultiIntent) {
    // Both flexible - give benefit of doubt, return closer to neutral
    return 0.45;
  }

  // Single-intent on at least one side with no overlap - lower score
  return 0.3;
}

// ---------------------------------------------------------------------------
// Score Aggregation
// ---------------------------------------------------------------------------

/**
 * Compute weighted base score from all subscores.
 * Returns score breakdown with individual subscores and weighted total.
 */
export function computeScoreBreakdown(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): DiscoveryScoreBreakdown {
  // Compute individual subscores (all 0-1)
  const archetypeScore = computeArchetypeScore(candidate, viewer);
  const valuesScore = computeValuesScore(candidate, viewer);
  const lifestyleScore = computeLifestyleScore(candidate, viewer);
  const interestScore = computeInterestScore(candidate, viewer);
  const bucketScore = computeBucketScore(candidate, viewer);
  const batteryScore = computeBatteryScore(candidate, viewer);
  const expressionScore = computeExpressionScore(candidate, viewer);
  const intentScore = computeIntentScore(candidate, viewer);

  // Compute weighted base score (0-1)
  const weights = config.weights;
  const baseScore =
    weights.archetype * archetypeScore +
    weights.values * valuesScore +
    weights.lifestyle * lifestyleScore +
    weights.interest * interestScore +
    weights.bucket * bucketScore +
    weights.battery * batteryScore +
    weights.expression * expressionScore +
    weights.intent * intentScore;

  // Scale to 0-100
  const scaledBaseScore = baseScore * 100;

  return {
    archetypeScore,
    valuesScore,
    lifestyleScore,
    interestScore,
    bucketScore,
    batteryScore,
    expressionScore,
    intentScore,
    baseScore,
    scaledBaseScore,
  };
}

// ---------------------------------------------------------------------------
// Penalty Aggregation
// ---------------------------------------------------------------------------

/**
 * Compute total penalties for a candidate.
 * Uses penalty functions from discoveryFilters.ts.
 */
export function computePenaltyBreakdown(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG
): DiscoveryPenaltyBreakdown {
  const distancePenalty = computeDistancePenalty(candidate, config);
  const childrenPenalty = computeChildrenPenalty(candidate, viewer, config);
  const lifestyleDealbreaker = computeLifestyleDealbreaker(candidate, viewer, config);
  const lowEffortPenalty = computeLowEffortPenalty(candidate, config);

  // Trust penalty based on report/block counts
  const trustPenalty = Math.min(
    candidate.reportCount * config.penalties.trustPerReport +
      candidate.blockCount * config.penalties.trustPerBlock,
    config.penalties.trustMax
  );

  const totalPenalty =
    distancePenalty +
    childrenPenalty +
    lifestyleDealbreaker +
    lowEffortPenalty +
    trustPenalty;

  return {
    distancePenalty,
    childrenPenalty,
    lifestyleDealbreaker,
    lowEffortPenalty,
    trustPenalty,
    totalPenalty,
  };
}

// ---------------------------------------------------------------------------
// Boost Aggregation
// ---------------------------------------------------------------------------

/**
 * Compute total boosts for a candidate.
 *
 * Boosts are intentionally modest so compatibility remains dominant.
 * No premium-style artificial boosts - only organic signals.
 */
export function computeBoostBreakdown(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG,
  options: { enableFairness?: boolean; enableExploration?: boolean } = {}
): DiscoveryBoostBreakdown {
  const now = Date.now();
  const boosts = config.boosts;

  // Active user boost (based on recent activity)
  let activeUserBoost = 0;
  if (candidate.lastActiveAt) {
    const timeSinceActive = now - candidate.lastActiveAt;
    if (timeSinceActive < ONE_HOUR_MS) {
      activeUserBoost = boosts.activeRecent;
    } else if (timeSinceActive < ONE_DAY_MS) {
      activeUserBoost = boosts.activeToday;
    }
  }

  // Inbound interest boost (they showed interest in you)
  // NOTE: Only the strongest inbound signal applies - no stacking.
  // This prevents gaming through multiple signal types.
  let inboundInterestBoost = 0;
  if (candidate.theySuperLikedMe) {
    inboundInterestBoost = boosts.inboundSuperLike;
  } else if (candidate.theyTextedMe) {
    inboundInterestBoost = boosts.inboundText;
  } else if (candidate.theyLikedMe) {
    inboundInterestBoost = boosts.inboundLike;
  }

  // Viewed you boost
  const viewedYouBoost = candidate.viewedYou ? boosts.viewedYou : 0;

  // Fairness adjustment (boost underexposed profiles)
  // Considers both totalImpressions AND recency of lastShownAt.
  // Recently shown profiles should not keep accumulating fairness boost.
  let fairnessAdjustment = 0;
  if (options.enableFairness) {
    const impressions = candidate.totalImpressions ?? 0;
    const lastShown = candidate.lastShownAt ?? 0;
    const timeSinceShown = now - lastShown;

    // Impression factor: fewer impressions = higher boost (max at 0, diminishes by 100)
    const impressionFactor = Math.max(0, 1 - impressions / 100);

    // Recency factor: recently shown profiles get reduced fairness boost
    // Full fairness only if not shown in last 4 hours
    let recencyFactor = 1.0;
    if (lastShown > 0 && timeSinceShown < 4 * ONE_HOUR_MS) {
      // Linearly reduce fairness if shown recently (0-4 hours)
      recencyFactor = timeSinceShown / (4 * ONE_HOUR_MS);
    }

    // Combined fairness: both underexposed AND not recently shown
    fairnessAdjustment = impressionFactor * recencyFactor * boosts.fairnessMax;
  }

  // Exploration randomness (mild random variation)
  // Combines candidate.id with a 6-hour time bucket for session stability
  // without being permanently frozen.
  let explorationRandomness = 0;
  if (options.enableExploration) {
    // Create time bucket (changes every 6 hours)
    const timeBucket = Math.floor(now / SIX_HOURS_MS);
    // Combine candidate ID with time bucket for stable-but-rotating randomness
    const seed = `${candidate.id}_${timeBucket}`;
    const randomFactor = (hashCode(seed) % 100) / 100;
    explorationRandomness = randomFactor * boosts.explorationMax;
  }

  const totalBoost =
    activeUserBoost +
    inboundInterestBoost +
    viewedYouBoost +
    fairnessAdjustment +
    explorationRandomness;

  return {
    activeUserBoost,
    inboundInterestBoost,
    viewedYouBoost,
    fairnessAdjustment,
    explorationRandomness,
    totalBoost,
  };
}

/**
 * Simple hash function for consistent pseudo-random exploration.
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Final Score Computation
// ---------------------------------------------------------------------------

/**
 * Compute the full breakdown and final score for a candidate.
 *
 * Formula: final_score = base_score * 100 - penalties + boosts
 *
 * Returns complete breakdown for debugging/analytics.
 */
export function computeFullBreakdown(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG,
  options: { enableFairness?: boolean; enableExploration?: boolean } = {}
): DiscoveryFullBreakdown {
  const scores = computeScoreBreakdown(candidate, viewer, config);
  const penalties = computePenaltyBreakdown(candidate, viewer, config);
  const boosts = computeBoostBreakdown(candidate, viewer, config, options);

  return { scores, penalties, boosts };
}

/**
 * Compute the final score for a candidate (single number for sorting).
 *
 * Formula: final_score = base_score * 100 - penalties + boosts
 *
 * Minimum score is 0 (can't go negative).
 */
export function computeFinalScore(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG,
  options: { enableFairness?: boolean; enableExploration?: boolean } = {}
): number {
  const breakdown = computeFullBreakdown(candidate, viewer, config, options);

  const finalScore =
    breakdown.scores.scaledBaseScore -
    breakdown.penalties.totalPenalty +
    breakdown.boosts.totalBoost;

  // Ensure non-negative score
  return Math.max(0, finalScore);
}

/**
 * Compute final score with full breakdown (for analytics/debugging).
 */
export function computeFinalScoreWithBreakdown(
  candidate: NormalizedDiscoveryCandidate,
  viewer: DiscoveryViewerContext,
  config: DiscoveryEngineConfig = DEFAULT_DISCOVERY_CONFIG,
  options: { enableFairness?: boolean; enableExploration?: boolean } = {}
): { score: number; breakdown: DiscoveryFullBreakdown } {
  const breakdown = computeFullBreakdown(candidate, viewer, config, options);

  const score = Math.max(
    0,
    breakdown.scores.scaledBaseScore -
      breakdown.penalties.totalPenalty +
      breakdown.boosts.totalBoost
  );

  return { score, breakdown };
}
