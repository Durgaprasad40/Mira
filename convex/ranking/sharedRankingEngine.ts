/**
 * Shared Ranking Engine
 *
 * Core ranking logic for both Phase-1 (Discover) and Phase-2 (Desire Land).
 * This engine operates on normalized data provided by phase-specific adapters.
 *
 * Architecture:
 * 1. Score Calculation - weighted composite score from multiple signals
 * 2. Boosts - theyLikedMe, isBoosted, verified, newUser, lowImpressions
 * 3. Trust Penalties - soft penalties from reports/blocks
 * 4. Fairness Layer - combined daily hash + impression-based fairness
 * 5. Exploration Mixer - 80% ranked, 20% exploration
 * 6. Suppression Layer - recently seen profiles pushed to back
 * 7. Fallback Pool - candidates with 2+ compatibility signals
 *
 * Phase 0: Scaffolding only - no production integration yet.
 * Logic copied from Phase-1 discoverRanking.ts with normalized types.
 */

import {
  NormalizedCandidate,
  NormalizedViewer,
  TrustSignals,
  FairnessContext,
  RankingConfig,
  RankingResult,
  ScoredCandidate,
  DEFAULT_RANKING_CONFIG,
} from './rankingTypes';

// ---------------------------------------------------------------------------
// Score Components (0-100 each)
// ---------------------------------------------------------------------------

/**
 * A) Compatibility Score (0-100)
 * Based on: relationship intent, activities, lifestyle, life rhythm, identity
 *
 * Copied from Phase-1 discoverRanking.ts compatibilityScore()
 */
export function computeCompatibilityScore(
  candidate: NormalizedCandidate,
  viewer: NormalizedViewer
): number {
  let score = 0;

  // SAFETY: Arrays already normalized by adapter, but guard anyway
  const candidateIntent = candidate.relationshipIntent ?? [];
  const viewerIntent = viewer.relationshipIntent ?? [];
  const candidateActivities = candidate.activities ?? [];
  const viewerActivities = viewer.activities ?? [];

  // 1. Relationship intent alignment (0-30)
  const intentCompat: Record<string, string[]> = {
    long_term: ['long_term', 'short_to_long'],
    short_term: ['short_term', 'long_to_short', 'fwb'],
    fwb: ['fwb', 'short_term'],
    figuring_out: ['figuring_out', 'open_to_anything'],
    short_to_long: ['short_to_long', 'long_term', 'short_term'],
    long_to_short: ['long_to_short', 'short_term'],
    new_friends: ['new_friends', 'open_to_anything'],
    open_to_anything: ['open_to_anything', 'figuring_out', 'new_friends'],
  };

  let bestIntent = 0;
  for (const mine of viewerIntent) {
    for (const theirs of candidateIntent) {
      if (mine === theirs) bestIntent = Math.max(bestIntent, 30);
      else if (intentCompat[mine]?.includes(theirs)) bestIntent = Math.max(bestIntent, 15);
    }
  }
  score += bestIntent;

  // 2. Shared activities/interests (0-25)
  const sharedActivities = candidateActivities.filter(a => viewerActivities.includes(a));
  score += Math.min(sharedActivities.length * 5, 25);

  // 3. Lifestyle match (0-20) - smoking, drinking, kids, religion
  let lifestyleMatches = 0;
  if (candidate.lifestyle.smoking && viewer.lifestyle.smoking &&
      candidate.lifestyle.smoking === viewer.lifestyle.smoking) lifestyleMatches++;
  if (candidate.lifestyle.drinking && viewer.lifestyle.drinking &&
      candidate.lifestyle.drinking === viewer.lifestyle.drinking) lifestyleMatches++;
  if (candidate.lifestyle.kids && viewer.lifestyle.kids &&
      candidate.lifestyle.kids === viewer.lifestyle.kids) lifestyleMatches++;
  if (candidate.lifestyle.religion && viewer.lifestyle.religion &&
      candidate.lifestyle.religion === viewer.lifestyle.religion) lifestyleMatches++;
  score += lifestyleMatches * 5;

  // 4. Life rhythm match (0-15) - if available
  if (candidate.lifeRhythm && viewer.lifeRhythm) {
    let rhythmMatches = 0;
    if (candidate.lifeRhythm.socialRhythm === viewer.lifeRhythm.socialRhythm) rhythmMatches++;
    if (candidate.lifeRhythm.sleepSchedule === viewer.lifeRhythm.sleepSchedule) rhythmMatches++;
    if (candidate.lifeRhythm.workStyle === viewer.lifeRhythm.workStyle) rhythmMatches++;

    // Core values overlap
    const candidateValues = candidate.lifeRhythm.coreValues ?? [];
    const viewerValues = viewer.lifeRhythm.coreValues ?? [];
    const sharedValues = candidateValues.filter(v => viewerValues.includes(v));
    rhythmMatches += sharedValues.length;

    score += Math.min(rhythmMatches * 3, 15);
  }

  // 5. Identity anchor match (0-10) - if available
  if (candidate.seedQuestions?.identityAnchor && viewer.seedQuestions?.identityAnchor) {
    if (candidate.seedQuestions.identityAnchor === viewer.seedQuestions.identityAnchor) {
      score += 10;
    }
  }

  return Math.min(score, 100);
}

/**
 * B) Profile Quality Score (0-100)
 * Based on: completeness, verification, effort indicators
 *
 * Copied from Phase-1 discoverRanking.ts profileQualityScore()
 */
export function computeProfileQualityScore(candidate: NormalizedCandidate): number {
  let score = 0;

  // Bio quality (0-20)
  const bioLength = candidate.bioLength;
  if (bioLength >= 150) score += 20;
  else if (bioLength >= 100) score += 15;
  else if (bioLength >= 50) score += 10;
  else if (bioLength > 0) score += 5;

  // Profile prompts answered (0-25)
  const filledPrompts = candidate.promptsAnswered;
  score += Math.min(filledPrompts * 8, 24);
  if (filledPrompts >= 3) score += 1;

  // Photos (0-20)
  if (candidate.photoCount >= 4) score += 20;
  else if (candidate.photoCount >= 3) score += 15;
  else if (candidate.photoCount >= 2) score += 10;
  else if (candidate.photoCount >= 1) score += 5;

  // Verified (0-10)
  if (candidate.isVerified) score += 10;

  // Optional fields filled (0-10)
  if (candidate.hasOptionalFields.height) score += 2;
  if (candidate.hasOptionalFields.jobTitle) score += 3;
  if (candidate.hasOptionalFields.education) score += 2;
  // Note: 3 more points available for future optional fields

  // Activities selected (0-15)
  const activitiesCount = (candidate.activities ?? []).length;
  if (activitiesCount >= 5) score += 15;
  else if (activitiesCount >= 3) score += 10;
  else if (activitiesCount >= 1) score += 5;

  return Math.min(score, 100);
}

/**
 * C) Activity/Recency Score (0-100)
 * Based on: last active time
 *
 * Copied from Phase-1 discoverRanking.ts activityRecencyScore()
 */
export function computeActivityRecencyScore(lastActiveAt: number): number {
  const now = Date.now();
  const hoursAgo = (now - lastActiveAt) / (1000 * 60 * 60);

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
 *
 * Copied from Phase-1 discoverRanking.ts distanceScore()
 */
export function computeDistanceScore(
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
 * E) Fairness Score (0-100)
 * Combined: deterministic daily hash + impression-based fairness
 *
 * Enhanced from Phase-1 fairnessScore() with Phase-2 impression logic.
 */
export function computeFairnessScore(
  viewerId: string,
  candidateId: string,
  candidate: NormalizedCandidate,
  config: RankingConfig
): number {
  // Phase-1 component: Deterministic daily hash (40%)
  // Ensures different ordering per day, reproducible
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  let h = day;
  for (let i = 0; i < viewerId.length; i++) h = ((h << 5) - h + viewerId.charCodeAt(i)) | 0;
  for (let i = 0; i < candidateId.length; i++) h = ((h << 5) - h + candidateId.charCodeAt(i)) | 0;
  const hashScore = Math.abs(h) % 101; // 0-100

  // Phase-2 component: Time since shown (30%)
  // Boosts profiles not shown recently
  const hoursSinceShown = candidate.lastShownAt
    ? (Date.now() - candidate.lastShownAt) / 3600000
    : 24; // Default to 24h if never shown
  const timeScore = Math.min(100, hoursSinceShown * 4); // Max at 25h

  // Phase-2 component: Low impressions (30%)
  // Boosts under-exposed profiles
  const impressionScore =
    candidate.totalImpressions < 10 ? 100 :
    candidate.totalImpressions < 25 ? 80 :
    candidate.totalImpressions < 50 ? 60 :
    candidate.totalImpressions < 100 ? 40 :
    candidate.totalImpressions < 200 ? 20 : 0;

  return Math.round(
    0.40 * hashScore +
    0.30 * timeScore +
    0.30 * impressionScore
  );
}

// ---------------------------------------------------------------------------
// Boost Calculations
// ---------------------------------------------------------------------------

/**
 * Calculate new user boost (0-maxBoost, decaying over days).
 * From Phase-2 ranking.
 */
export function computeNewUserBoost(
  onboardedAt: number,
  boostDays: number,
  maxBoost: number
): number {
  const daysSinceOnboarding = (Date.now() - onboardedAt) / 86400000;
  if (daysSinceOnboarding >= boostDays) return 0;
  return Math.round(maxBoost * (boostDays - daysSinceOnboarding) / boostDays);
}

/**
 * Calculate low impressions boost.
 * From Phase-2 ranking.
 */
export function computeLowImpressionsBoost(
  totalImpressions: number,
  maxBoost: number
): number {
  if (totalImpressions < 10) return maxBoost;
  if (totalImpressions < 25) return Math.round(maxBoost * 0.8);
  if (totalImpressions < 50) return Math.round(maxBoost * 0.6);
  if (totalImpressions < 100) return Math.round(maxBoost * 0.4);
  if (totalImpressions < 200) return Math.round(maxBoost * 0.2);
  return 0;
}

/**
 * Calculate all boosts for a candidate.
 */
export function computeTotalBoosts(
  candidate: NormalizedCandidate,
  config: RankingConfig
): number {
  let boosts = 0;

  if (candidate.theyLikedMe) boosts += config.boosts.theyLikedMe;
  if (candidate.isBoosted) boosts += config.boosts.isBoosted;
  if (candidate.isVerified) boosts += config.boosts.verified;

  boosts += computeNewUserBoost(
    candidate.onboardedAt,
    config.newUserBoostDays,
    config.boosts.newUser7Days
  );

  boosts += computeLowImpressionsBoost(
    candidate.totalImpressions,
    config.boosts.lowImpressions
  );

  return boosts;
}

// ---------------------------------------------------------------------------
// Trust/Safety Penalties
// ---------------------------------------------------------------------------

/**
 * Calculate trust penalty based on aggregate reports/blocks.
 * Returns a POSITIVE value (to subtract from score).
 * Does NOT hard-filter - just reduces ranking.
 *
 * Copied from Phase-1 discoverRanking.ts trustPenalty()
 */
export function computeTrustPenalty(
  candidate: NormalizedCandidate,
  config: RankingConfig
): number {
  const penalty =
    candidate.reportCount * config.trustPenalty.perReport +
    candidate.blockCount * config.trustPenalty.perBlock;

  return Math.min(penalty, config.trustPenalty.maxPenalty);
}

// ---------------------------------------------------------------------------
// Composite Ranking Score
// ---------------------------------------------------------------------------

/**
 * Calculate the final ranking score for a candidate.
 */
export function computeRankScore(
  candidate: NormalizedCandidate,
  viewer: NormalizedViewer,
  config: RankingConfig
): ScoredCandidate {
  const weights = config.weights;

  // Component scores (0-100 each)
  const compatibility = computeCompatibilityScore(candidate, viewer);
  const quality = computeProfileQualityScore(candidate);
  const activity = computeActivityRecencyScore(candidate.lastActiveAt);
  const distance = computeDistanceScore(candidate.distance, viewer.maxDistance);
  const fairness = computeFairnessScore(viewer.id, candidate.id, candidate, config);

  // Mutual interest score (0-100)
  const mutualInterest = candidate.theyLikedMe ? 100 : 0;

  // Weighted composite score
  let score =
    weights.compatibility * compatibility +
    weights.profileQuality * quality +
    weights.mutualInterest * mutualInterest +
    weights.activityRecency * activity +
    weights.distance * distance +
    weights.fairness * fairness;

  // Apply boosts
  const boosts = computeTotalBoosts(candidate, config);
  score += boosts;

  // Apply trust penalty
  const penalty = computeTrustPenalty(candidate, config);
  score -= penalty;

  return {
    candidate,
    score,
    scoreBreakdown: {
      compatibility,
      profileQuality: quality,
      mutualInterest,
      activityRecency: activity,
      distance,
      fairness,
      boosts,
      penalty,
    },
  };
}

// ---------------------------------------------------------------------------
// Exploration Mixer
// ---------------------------------------------------------------------------

/**
 * Mix ranked candidates with exploration pool.
 * 80% from top-ranked, 20% from random exploration.
 *
 * Copied from Phase-1 discoverRanking.ts applyExplorationMix()
 */
export function applyExplorationMix(
  sortedCandidates: NormalizedCandidate[],
  limit: number,
  config: RankingConfig
): NormalizedCandidate[] {
  if (sortedCandidates.length <= limit) {
    return sortedCandidates;
  }

  const explorationRatio = config.explorationRatio;
  const rankedCount = Math.ceil(limit * (1 - explorationRatio));
  const explorationCount = limit - rankedCount;

  // Top ranked candidates
  const ranked = sortedCandidates.slice(0, rankedCount);

  // Exploration pool: random selection from remaining
  const remaining = sortedCandidates.slice(rankedCount);
  const exploration: NormalizedCandidate[] = [];

  if (remaining.length > 0 && explorationCount > 0) {
    // Shuffle remaining for random exploration
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    exploration.push(...shuffled.slice(0, explorationCount));
  }

  // Interleave: mostly ranked, with exploration sprinkled in
  const result: NormalizedCandidate[] = [];
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
// Suppression Layer
// ---------------------------------------------------------------------------

/**
 * Apply suppression: recently seen candidates pushed to end.
 * From Phase-2 ranking.
 */
export function applySuppression(
  rankedCandidates: NormalizedCandidate[],
  fairnessContext: FairnessContext | undefined
): NormalizedCandidate[] {
  // If no fairness context, skip suppression
  if (!fairnessContext || fairnessContext.recentlySeenIds.size === 0) {
    return rankedCandidates;
  }

  const unsuppressed: NormalizedCandidate[] = [];
  const suppressed: NormalizedCandidate[] = [];

  for (const c of rankedCandidates) {
    if (fairnessContext.recentlySeenIds.has(c.id)) {
      suppressed.push(c);
    } else {
      unsuppressed.push(c);
    }
  }

  // Suppressed profiles go to end, maintaining their relative order
  return [...unsuppressed, ...suppressed];
}

// ---------------------------------------------------------------------------
// Fallback Compatibility Check
// ---------------------------------------------------------------------------

/**
 * Count strong compatibility signals between candidate and viewer.
 * Used for fallback pool eligibility.
 *
 * Copied from Phase-1 discoverRanking.ts countStrongCompatibilitySignals()
 */
export function countStrongCompatibilitySignals(
  candidate: NormalizedCandidate,
  viewer: NormalizedViewer
): number {
  let signals = 0;

  // SAFETY: Normalize arrays
  const candidateActivities = candidate.activities ?? [];
  const viewerActivities = viewer.activities ?? [];
  const candidateIntent = candidate.relationshipIntent ?? [];
  const viewerIntent = viewer.relationshipIntent ?? [];

  // 1. Same identity anchor
  if (
    candidate.seedQuestions?.identityAnchor &&
    viewer.seedQuestions?.identityAnchor &&
    candidate.seedQuestions.identityAnchor === viewer.seedQuestions.identityAnchor
  ) {
    signals++;
  }

  // 2. Same value trigger
  if (
    candidate.seedQuestions?.valueTrigger &&
    viewer.seedQuestions?.valueTrigger &&
    candidate.seedQuestions.valueTrigger === viewer.seedQuestions.valueTrigger
  ) {
    signals++;
  }

  // 3. Overlapping interests (3+ shared)
  const sharedActivities = candidateActivities.filter(a => viewerActivities.includes(a));
  if (sharedActivities.length >= 3) {
    signals++;
  }

  // 4. Similar life rhythm (2+ matching fields)
  if (candidate.lifeRhythm && viewer.lifeRhythm) {
    let rhythmMatches = 0;
    if (candidate.lifeRhythm.socialRhythm === viewer.lifeRhythm.socialRhythm) rhythmMatches++;
    if (candidate.lifeRhythm.sleepSchedule === viewer.lifeRhythm.sleepSchedule) rhythmMatches++;
    if (candidate.lifeRhythm.workStyle === viewer.lifeRhythm.workStyle) rhythmMatches++;
    if (candidate.lifeRhythm.travelStyle === viewer.lifeRhythm.travelStyle) rhythmMatches++;

    // Core values overlap
    const candidateValues = candidate.lifeRhythm.coreValues ?? [];
    const viewerValues = viewer.lifeRhythm.coreValues ?? [];
    const sharedValues = candidateValues.filter(v => viewerValues.includes(v));
    if (sharedValues.length >= 1) rhythmMatches++;

    if (rhythmMatches >= 2) signals++;
  }

  // 5. Similar lifestyle (2+ matching fields)
  let lifestyleMatches = 0;
  if (candidate.lifestyle.smoking && viewer.lifestyle.smoking &&
      candidate.lifestyle.smoking === viewer.lifestyle.smoking) lifestyleMatches++;
  if (candidate.lifestyle.drinking && viewer.lifestyle.drinking &&
      candidate.lifestyle.drinking === viewer.lifestyle.drinking) lifestyleMatches++;
  if (candidate.lifestyle.kids && viewer.lifestyle.kids &&
      candidate.lifestyle.kids === viewer.lifestyle.kids) lifestyleMatches++;
  if (candidate.lifestyle.religion && viewer.lifestyle.religion &&
      candidate.lifestyle.religion === viewer.lifestyle.religion) lifestyleMatches++;
  if (lifestyleMatches >= 2) signals++;

  // 6. Same relationship intent (exact match)
  const hasMatchingIntent = viewerIntent.some(i => candidateIntent.includes(i));
  if (hasMatchingIntent) signals++;

  return signals;
}

/**
 * Check if a candidate qualifies for fallback pool.
 */
export function qualifiesForFallback(
  candidate: NormalizedCandidate,
  viewer: NormalizedViewer,
  config: RankingConfig
): boolean {
  return countStrongCompatibilitySignals(candidate, viewer) >= config.fallbackMinSignals;
}

// ---------------------------------------------------------------------------
// Main Ranking Function
// ---------------------------------------------------------------------------

/**
 * Rank candidates using the shared ranking engine.
 *
 * @param candidates - Pre-filtered eligible candidates (passed hard filters in query layer)
 * @param viewer - The normalized viewer
 * @param config - Ranking configuration
 * @param options - Additional options
 */
export function rankCandidates(
  candidates: NormalizedCandidate[],
  viewer: NormalizedViewer,
  config: RankingConfig = DEFAULT_RANKING_CONFIG,
  options: {
    limit?: number;
    useFallback?: boolean;
    fairnessContext?: FairnessContext;
  } = {}
): RankingResult {
  const { limit = 20, useFallback = false, fairnessContext } = options;

  // Score all candidates
  const scoredCandidates = candidates.map(candidate =>
    computeRankScore(candidate, viewer, config)
  );

  // Sort by score (descending)
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Extract sorted candidates
  let sortedCandidates = scoredCandidates.map(s => s.candidate);

  // Apply exploration mix
  const mixed = applyExplorationMix(sortedCandidates, limit, config);

  // Apply suppression (push recently seen to back)
  const suppressed = applySuppression(mixed, fairnessContext);

  const exhausted = suppressed.length < limit;
  let fallbackUsed = false;

  // Handle fallback if needed
  let result = suppressed;
  if (exhausted && useFallback) {
    const needed = limit - result.length;
    const usedIds = new Set(result.map(r => r.id));

    // Find candidates not already in result that qualify for fallback
    const fallbackCandidates = candidates
      .filter(c => !usedIds.has(c.id) && qualifiesForFallback(c, viewer, config))
      .slice(0, needed);

    if (fallbackCandidates.length > 0) {
      result = [...result, ...fallbackCandidates];
      fallbackUsed = true;
    }
  }

  return {
    rankedCandidates: result.slice(0, limit),
    exhausted,
    fallbackUsed,
  };
}

// ---------------------------------------------------------------------------
// Export configuration for external use
// ---------------------------------------------------------------------------

export { DEFAULT_RANKING_CONFIG };
