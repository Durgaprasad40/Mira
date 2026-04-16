/**
 * Phase-2 Ranking System
 *
 * Provides ranking metrics initialization and tracking for Deep Connect discovery.
 * Step 2: Initialization - metrics row created when Phase-2 onboarding completes.
 * Step 3: Activity recording - updates lastPhase2ActiveAt from TD and chat activity.
 * Step 4: Scoring helpers - pure functions for computing ranking scores.
 * Step 7: Debug query and cleanup cron for viewer impressions.
 */
import { v } from 'convex/values';
import { query, internalMutation } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';

type Phase2RankingProfileSignals = {
  privateIntentKeys?: string[];
  privateDesireTagKeys?: string[];
  hobbies?: string[];
  privateBio?: string;
  promptAnswers?: Array<{ question?: string; answer?: string }>;
  smoking?: string;
  drinking?: string;
  city?: string;
  isVerified?: boolean;
};

type Phase2RankingViewerSignals = {
  privateIntentKeys?: string[];
  privateDesireTagKeys?: string[];
  hobbies?: string[];
  privateBio?: string;
  promptAnswers?: Array<{ question?: string; answer?: string }>;
  smoking?: string;
  drinking?: string;
  city?: string;
  preferenceStrength?: {
    smoking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    drinking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    intent?: 'not_important' | 'prefer_similar' | 'important' | 'must_match_exactly';
  };
};

/**
 * Initialize Phase-2 ranking metrics for a user.
 * Called once when Phase-2 onboarding completes.
 * Idempotent: safe to call multiple times.
 */
export const initializePhase2RankingMetrics = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('phase2RankingMetrics')
      .withIndex('by_user', q => q.eq('userId', args.userId))
      .first();

    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert('phase2RankingMetrics', {
      userId: args.userId,
      phase2OnboardedAt: now,
      lastPhase2ActiveAt: now,
      totalImpressions: 0,
      lastShownAt: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Record Phase-2 activity to update lastPhase2ActiveAt.
 * Called from Truth or Dare and Phase-2 chat message sends.
 * Throttled: only updates if last activity was more than 1 hour ago.
 * Safe: silently returns if unauthenticated or metrics row missing.
 *
 * Internal mutation: called from other server-side mutations, not directly by clients.
 */
export const recordPhase2Activity = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get authenticated user identity
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return;

    // Resolve to Convex user ID
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) return;

    // Get existing metrics row
    const metrics = await ctx.db
      .query('phase2RankingMetrics')
      .withIndex('by_user', q => q.eq('userId', userId))
      .first();

    if (!metrics) return;

    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Throttle: only update if last activity was more than 1 hour ago
    if (metrics.lastPhase2ActiveAt > oneHourAgo) return;

    await ctx.db.patch(metrics._id, {
      lastPhase2ActiveAt: now,
      updatedAt: now,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 4: Scoring Helpers (pure functions for ranking computation)
// Only computeFinalScore is exported for use in privateDiscover.ts
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Count total prompts answered in Phase-2 profile.
 * Uses the real schema field: promptAnswers
 */
function countAllPromptsAnswered(profile: any): number {
  const prompts = profile.promptAnswers;
  if (Array.isArray(prompts)) {
    return prompts.filter((p: any) => p.answer?.trim().length > 0).length;
  }
  return 0;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
}

function overlapCount(a: string[] | undefined, b: string[] | undefined): number {
  const aa = normalizeStringArray(a);
  const bb = normalizeStringArray(b);
  if (aa.length === 0 || bb.length === 0) return 0;
  const setB = new Set(bb);
  let count = 0;
  for (const x of aa) if (setB.has(x)) count += 1;
  return count;
}

function overlapRatio(a: string[] | undefined, b: string[] | undefined): number {
  const aa = normalizeStringArray(a);
  const bb = normalizeStringArray(b);
  if (aa.length === 0 || bb.length === 0) return 0;
  const denom = Math.min(aa.length, bb.length);
  if (denom <= 0) return 0;
  return overlapCount(aa, bb) / denom;
}

function extractKeywords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3);
  return new Set(tokens);
}

function computeTextAffinity(viewer: Phase2RankingViewerSignals, candidate: Phase2RankingProfileSignals): number {
  const viewerParts: string[] = [];
  const candidateParts: string[] = [];

  const vBio = typeof viewer.privateBio === 'string' ? viewer.privateBio : '';
  const cBio = typeof candidate.privateBio === 'string' ? candidate.privateBio : '';
  if (vBio) viewerParts.push(vBio);
  if (cBio) candidateParts.push(cBio);

  if (Array.isArray(viewer.promptAnswers)) {
    for (const p of viewer.promptAnswers) {
      const ans = typeof p?.answer === 'string' ? p.answer.trim() : '';
      if (ans) viewerParts.push(ans);
    }
  }
  if (Array.isArray(candidate.promptAnswers)) {
    for (const p of candidate.promptAnswers) {
      const ans = typeof p?.answer === 'string' ? p.answer.trim() : '';
      if (ans) candidateParts.push(ans);
    }
  }

  const vText = viewerParts.join(' ').trim();
  const cText = candidateParts.join(' ').trim();
  if (!vText || !cText) return 0;

  const vKeys = extractKeywords(vText);
  const cKeys = extractKeywords(cText);
  if (vKeys.size === 0 || cKeys.size === 0) return 0;

  let overlap = 0;
  for (const w of cKeys) if (vKeys.has(w)) overlap += 1;
  const denom = Math.min(vKeys.size, cKeys.size);
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(1, overlap / denom));
}

function computeLifestylePenalty(viewer: Phase2RankingViewerSignals, candidate: Phase2RankingProfileSignals): number {
  // Phase-2 safe: only apply when viewer explicitly marks as deal_breaker.
  // Returns 0..10 (penalty points to subtract).
  let penalty = 0;
  const ps = viewer.preferenceStrength;

  if (
    ps?.smoking === 'deal_breaker' &&
    typeof viewer.smoking === 'string' &&
    typeof candidate.smoking === 'string' &&
    viewer.smoking !== candidate.smoking
  ) {
    penalty += 6;
  }

  if (
    ps?.drinking === 'deal_breaker' &&
    typeof viewer.drinking === 'string' &&
    typeof candidate.drinking === 'string' &&
    viewer.drinking !== candidate.drinking
  ) {
    penalty += 6;
  }

  return Math.min(10, penalty);
}

function computeCompatibilityScore(viewer: Phase2RankingViewerSignals, candidate: Phase2RankingProfileSignals): number {
  // Returns 0..25 (additive).
  // Uses only Phase-2-safe fields already in private profiles.
  let score = 0;

  // A) Intent alignment (0..10)
  const intentOverlap = overlapRatio(viewer.privateIntentKeys, candidate.privateIntentKeys);
  const intentStrength = viewer.preferenceStrength?.intent;
  if (intentStrength === 'must_match_exactly') {
    // Strongly prioritize exact overlap; 0 otherwise
    score += intentOverlap > 0 ? 10 : 0;
  } else if (intentStrength === 'important') {
    score += Math.round(10 * Math.min(1, intentOverlap));
  } else if (intentStrength === 'prefer_similar') {
    score += Math.round(8 * Math.min(1, intentOverlap));
  } else {
    // Not important / unknown -> mild signal
    score += Math.round(6 * Math.min(1, intentOverlap));
  }

  // B) Desire tag overlap (0..7)
  const desireOverlap = overlapRatio(viewer.privateDesireTagKeys, candidate.privateDesireTagKeys);
  score += Math.round(7 * Math.min(1, desireOverlap));

  // C) Interests/hobbies overlap (0..6)
  const hobbyOverlap = overlapRatio(viewer.hobbies, candidate.hobbies);
  score += Math.round(6 * Math.min(1, hobbyOverlap));

  // D) Light text affinity (0..2)
  const textAffinity = computeTextAffinity(viewer, candidate);
  score += Math.round(2 * Math.min(1, textAffinity));

  // E) Same city (0..2) — already present on private profile; optional.
  if (viewer.city && candidate.city && viewer.city === candidate.city) {
    score += 2;
  }

  return Math.max(0, Math.min(25, score));
}

/**
 * Compute base score (0-50) from profile completeness.
 * - Photos: 0-15 (3 pts per photo, max 5)
 * - Desire text: 0-10 (based on length thresholds)
 * - Prompts: 0-15 (3 pts per prompt, max 5)
 * - Verification: 0-10
 */
function computeBaseScore(profile: any): number {
  // Phase-2 profiles use privatePhotoUrls
  const photoCount = profile.privatePhotoUrls?.length ?? 0;
  const photoScore = Math.min(15, photoCount * 3);

  const desireLen = profile.privateBio?.trim().length ?? 0;
  const desireScore =
    desireLen >= 100 ? 10 :
    desireLen >= 50 ? 7 :
    desireLen >= 20 ? 4 : 0;

  const promptCount = countAllPromptsAnswered(profile);
  const promptScore = Math.min(15, promptCount * 3);

  const verifiedScore = profile.isVerified ? 10 : 0;

  return photoScore + desireScore + promptScore + verifiedScore;
}

/**
 * Compute freshness score (0-25) from activity recency and new user boost.
 * - Activity recency: 0-15 (based on hours since last active)
 * - New user boost: 0-10 (decays over 7 days)
 */
function computeFreshnessScore(metrics: any, profile: any): number {
  const now = Date.now();

  const hoursSinceActive = (now - metrics.lastPhase2ActiveAt) / 3600000;
  const activityScore =
    hoursSinceActive < 1 ? 15 :
    hoursSinceActive < 6 ? 12 :
    hoursSinceActive < 24 ? 9 :
    hoursSinceActive < 72 ? 6 :
    hoursSinceActive < 168 ? 3 : 0;

  const daysSinceOnboarding = (now - metrics.phase2OnboardedAt) / 86400000;
  const newUserScore =
    daysSinceOnboarding >= 7 ? 0 :
    Math.round(10 * (7 - daysSinceOnboarding) / 7);

  return activityScore + newUserScore;
}

/**
 * Compute fairness score (0-20) from global impressions and time since shown.
 * - Time since shown: 0-10 (1 pt per 2 hours, max 10)
 * - Low impressions boost: 0-10 (higher boost for fewer total impressions)
 */
function computeFairnessScore(metrics: any): number {
  const now = Date.now();

  const hoursSinceShown = metrics.lastShownAt ? (now - metrics.lastShownAt) / 3600000 : 24;
  const timeScore = Math.min(10, Math.floor(hoursSinceShown / 2));

  const impressionsScore =
    metrics.totalImpressions < 10 ? 10 :
    metrics.totalImpressions < 25 ? 8 :
    metrics.totalImpressions < 50 ? 6 :
    metrics.totalImpressions < 100 ? 4 :
    metrics.totalImpressions < 200 ? 2 : 0;

  return timeScore + impressionsScore;
}

/**
 * Simple hash function for deterministic jitter.
 * Returns a non-negative integer.
 */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Compute deterministic jitter (0-4) for tie-breaking.
 * Same viewer + profile + day = same jitter.
 * Different viewers see different orderings.
 */
function computeJitter(viewerId: string, profileId: string): number {
  const today = new Date().toISOString().split('T')[0];
  return simpleHash(`${viewerId}:${profileId}:${today}`) % 5;
}

/**
 * Compute final ranking score (0-99) for a profile.
 * Combines: base (0-50) + freshness (0-25) + fairness (0-20) + jitter (0-4)
 */
export function computeFinalScore(
  profile: any,
  metrics: any,
  viewerId: string,
  viewerSignals?: Phase2RankingViewerSignals
): number {
  // Completeness remains important, but should not dominate obvious fit differences.
  // We keep the same underlying base components, then compress slightly.
  const base = computeBaseScore(profile);
  const baseTuned = Math.round(base * 0.85); // 0–43 (from 0–50)
  const freshness = computeFreshnessScore(metrics, profile);
  const fairness = computeFairnessScore(metrics);
  const jitter = computeJitter(viewerId, profile.authUserId ?? profile.userId);

  // Phase-2 compatibility (0..25) - only when viewer signals are available.
  // This stays Phase-2-only and does not use Phase-1 preferences.
  const compatibilityRaw = viewerSignals
    ? computeCompatibilityScore(viewerSignals, profile as Phase2RankingProfileSignals)
    : 0;

  // Tune: amplify compatibility so strong-fit profiles surface above merely complete weak-fit profiles.
  // Keep deterministic behavior (no randomness); cap to avoid brittle overfitting.
  const compatibilityTuned = Math.min(40, Math.round(compatibilityRaw * 1.6)); // 0–40 (from 0–25)

  // Phase-2 dealbreaker penalties (0..10)
  const lifestylePenalty = viewerSignals
    ? computeLifestylePenalty(viewerSignals, profile as Phase2RankingProfileSignals)
    : 0;

  // Soft weak-fit penalty (Phase-2 only):
  // If compatibility is clearly weak AND the viewer has compatibility context,
  // nudge these profiles down so "complete-but-weak-match" doesn't dominate.
  const weakFitPenalty =
    viewerSignals && compatibilityRaw > 0 && compatibilityRaw <= 4 ? 6 :
    viewerSignals && compatibilityRaw === 0 ? 8 :
    0;

  return baseTuned + freshness + fairness + compatibilityTuned + jitter - lifestylePenalty - weakFitPenalty;
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 7: Debug Query and Cleanup Cron
// ═══════════════════════════════════════════════════════════════════════════

// Suppression window: 4 hours in milliseconds
const SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Debug query to inspect ranking scores for a specific user.
 * Returns detailed score breakdown for debugging ranking behavior.
 * Authenticated viewer only.
 */
export const debugRanking = query({
  args: { targetUserId: v.id('users') },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get authenticated viewer
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      return { error: 'Not authenticated' };
    }

    const viewerId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!viewerId) {
      return { error: 'Not authenticated' };
    }

    // Load target private profile
    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.targetUserId))
      .first();

    if (!profile) {
      return { error: 'Profile not found' };
    }

    // Load target ranking metrics (with fallback defaults)
    const metricsRow = await ctx.db
      .query('phase2RankingMetrics')
      .withIndex('by_user', (q) => q.eq('userId', args.targetUserId))
      .first();

    const m = metricsRow ?? {
      phase2OnboardedAt: profile.createdAt ?? now,
      lastPhase2ActiveAt: profile.updatedAt ?? now,
      totalImpressions: 0,
      lastShownAt: 0,
    };

    // Load viewer-target impression pair
    const viewerImpression = await ctx.db
      .query('phase2ViewerImpressions')
      .withIndex('by_pair', (q) =>
        q.eq('viewerId', viewerId).eq('viewedUserId', args.targetUserId)
      )
      .first();

    // Load viewer private profile for compatibility context (Phase-2 only)
    const viewerPrivateProfile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', viewerId))
      .first();
    const viewerSignals = viewerPrivateProfile
      ? {
          privateIntentKeys: viewerPrivateProfile.privateIntentKeys ?? [],
          privateDesireTagKeys: viewerPrivateProfile.privateDesireTagKeys ?? [],
          hobbies: (viewerPrivateProfile as any).hobbies ?? [],
          privateBio: viewerPrivateProfile.privateBio ?? '',
          promptAnswers: (viewerPrivateProfile as any).promptAnswers ?? [],
          smoking: (viewerPrivateProfile as any).smoking,
          drinking: (viewerPrivateProfile as any).drinking,
          city: viewerPrivateProfile.city,
          preferenceStrength: (viewerPrivateProfile as any).preferenceStrength,
        }
      : undefined;

    // Compute score breakdown
    // Base score components
    const photoCount = profile.privatePhotoUrls?.length ?? 0;
    const photoScore = Math.min(15, photoCount * 3);

    const desireLen = profile.privateBio?.trim().length ?? 0;
    const desireScore =
      desireLen >= 100 ? 10 :
      desireLen >= 50 ? 7 :
      desireLen >= 20 ? 4 : 0;

    const promptCount = countAllPromptsAnswered(profile);
    const promptScore = Math.min(15, promptCount * 3);

    const verifiedScore = profile.isVerified ? 10 : 0;
    const baseScore = photoScore + desireScore + promptScore + verifiedScore;

    // Freshness score components
    const hoursSinceActive = (now - m.lastPhase2ActiveAt) / 3600000;
    const activityScore =
      hoursSinceActive < 1 ? 15 :
      hoursSinceActive < 6 ? 12 :
      hoursSinceActive < 24 ? 9 :
      hoursSinceActive < 72 ? 6 :
      hoursSinceActive < 168 ? 3 : 0;

    const daysSinceOnboarding = (now - m.phase2OnboardedAt) / 86400000;
    const newUserScore =
      daysSinceOnboarding >= 7 ? 0 :
      Math.round(10 * (7 - daysSinceOnboarding) / 7);

    const freshnessScore = activityScore + newUserScore;

    // Fairness score components
    const hoursSinceShown = m.lastShownAt ? (now - m.lastShownAt) / 3600000 : 24;
    const timeScore = Math.min(10, Math.floor(hoursSinceShown / 2));

    const impressionsScore =
      m.totalImpressions < 10 ? 10 :
      m.totalImpressions < 25 ? 8 :
      m.totalImpressions < 50 ? 6 :
      m.totalImpressions < 100 ? 4 :
      m.totalImpressions < 200 ? 2 : 0;

    const fairnessScore = timeScore + impressionsScore;

    // Jitter
    const jitter = computeJitter(viewerId as string, args.targetUserId as string);

    // Compatibility + penalties (tuned)
    const compatibilityRaw = viewerSignals
      ? computeCompatibilityScore(viewerSignals, profile as any)
      : 0;
    const compatibilityTuned = Math.min(40, Math.round(compatibilityRaw * 1.6));
    const lifestylePenalty = viewerSignals
      ? computeLifestylePenalty(viewerSignals, profile as any)
      : 0;
    const weakFitPenalty =
      viewerSignals && compatibilityRaw > 0 && compatibilityRaw <= 4 ? 6 :
      viewerSignals && compatibilityRaw === 0 ? 8 :
      0;

    const baseTuned = Math.round(baseScore * 0.85);

    // Final score (mirrors computeFinalScore)
    const finalScore =
      baseTuned +
      freshnessScore +
      fairnessScore +
      compatibilityTuned +
      jitter -
      lifestylePenalty -
      weakFitPenalty;

    // Suppression state
    const isSuppressed = viewerImpression
      ? viewerImpression.lastSeenAt > (now - SUPPRESSION_WINDOW_MS)
      : false;

    return {
      targetUserId: args.targetUserId,
      viewerId,

      scores: {
        base: {
          total: baseScore,
          tuned: baseTuned,
          photo: `${photoScore} (${photoCount} photos)`,
          desire: `${desireScore} (${desireLen} chars)`,
          prompts: `${promptScore} (${promptCount} answered)`,
          verified: `${verifiedScore} (${profile.isVerified ? 'yes' : 'no'})`,
        },
        compatibility: {
          raw: compatibilityRaw,
          tuned: compatibilityTuned,
          weakFitPenalty,
          lifestylePenalty,
        },
        freshness: {
          total: freshnessScore,
          activity: `${activityScore} (${Math.round(hoursSinceActive)}h ago)`,
          newUser: `${newUserScore} (day ${Math.round(daysSinceOnboarding)})`,
        },
        fairness: {
          total: fairnessScore,
          timeSinceShown: `${timeScore} (${Math.round(hoursSinceShown)}h ago)`,
          impressions: `${impressionsScore} (${m.totalImpressions} total)`,
        },
        jitter,
        final: finalScore,
      },

      suppression: {
        isSuppressed,
        lastSeenByViewer: viewerImpression
          ? new Date(viewerImpression.lastSeenAt).toISOString()
          : null,
        seenCount: viewerImpression?.seenCount ?? 0,
      },

      raw: {
        lastPhase2ActiveAt: new Date(m.lastPhase2ActiveAt).toISOString(),
        phase2OnboardedAt: new Date(m.phase2OnboardedAt).toISOString(),
        totalImpressions: m.totalImpressions,
        lastShownAt: m.lastShownAt ? new Date(m.lastShownAt).toISOString() : null,
      },
    };
  },
});

/**
 * Cleanup old viewer impressions (older than 7 days).
 * Called daily by cron to prevent unbounded table growth.
 */
export const cleanupOldImpressions = internalMutation({
  handler: async (ctx) => {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);

    const oldImpressions = await ctx.db
      .query('phase2ViewerImpressions')
      .filter((q) => q.lt(q.field('lastSeenAt'), cutoff))
      .collect();

    for (const imp of oldImpressions) {
      await ctx.db.delete(imp._id);
    }

    return { deleted: oldImpressions.length };
  },
});
