/**
 * Phase-2 Ranking System
 *
 * Provides ranking metrics initialization and tracking for Desire Land discovery.
 * Step 2: Initialization - metrics row created when Phase-2 onboarding completes.
 * Step 3: Activity recording - updates lastPhase2ActiveAt from TD and chat activity.
 * Step 4: Scoring helpers - pure functions for computing ranking scores.
 * Step 7: Debug query and cleanup cron for viewer impressions.
 */
import { v } from 'convex/values';
import { query, internalMutation } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';

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

function countPrivatePhotos(profile: any): number {
  if (Array.isArray(profile?.privatePhotoStorageIds) && profile.privatePhotoStorageIds.length > 0) {
    return profile.privatePhotoStorageIds.length;
  }
  if (Array.isArray(profile?.privatePhotoUrls)) {
    return profile.privatePhotoUrls.length;
  }
  return 0;
}

/**
 * Compute base score (0-50) from profile completeness.
 * - Photos: 0-15 (3 pts per photo, max 5)
 * - Desire text: 0-10 (based on length thresholds)
 * - Prompts: 0-15 (3 pts per prompt, max 5)
 * - Verification: 0-10
 */
function computeBaseScore(profile: any): number {
  const photoCount = countPrivatePhotos(profile);
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
export function computeFinalScore(profile: any, metrics: any, viewerId: string): number {
  const base = computeBaseScore(profile);
  const freshness = computeFreshnessScore(metrics, profile);
  const fairness = computeFairnessScore(metrics);
  const jitter = computeJitter(viewerId, profile.authUserId ?? profile.userId);
  return base + freshness + fairness + jitter;
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

    // Compute score breakdown
    // Base score components
    const photoCount = countPrivatePhotos(profile);
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

    // Final score
    const finalScore = baseScore + freshnessScore + fairnessScore + jitter;

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
          photo: `${photoScore} (${photoCount} photos)`,
          desire: `${desireScore} (${desireLen} chars)`,
          prompts: `${promptScore} (${promptCount} answered)`,
          verified: `${verifiedScore} (${profile.isVerified ? 'yes' : 'no'})`,
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
