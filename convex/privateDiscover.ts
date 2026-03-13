import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { isPrivateDataDeleted } from './privateDeletion';
import { computeFinalScore } from './phase2Ranking';
import { resolveUserIdByAuthId } from './helpers';

// Suppression window: 4 hours in milliseconds
const SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

// Get private discovery profiles (blurred photos only) with Phase-2 ranking
// Filters out:
// - The requesting user
// - Incomplete profiles
// - Blocked users (in BOTH directions - shared across phases)
// - Users with pending deletion
// Ranking behavior:
// - Users seen within 4-hour suppression window are pushed to back
// - Users without ranking metrics use fallback defaults for scoring
// Returns profiles sorted by ranking score (descending)
export const getProfiles = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const suppressionCutoff = now - SUPPRESSION_WINDOW_MS;

    // Get blocks for current user (both directions - shared across Phase-1 and Phase-2)
    const blocksOut = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', args.userId))
      .collect();
    const blocksIn = await ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', args.userId))
      .collect();

    // Combine into a set of blocked user IDs
    const blockedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    const profiles = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_enabled', (q) => q.eq('isPrivateEnabled', true))
      .collect();

    // Get all deletion states to filter out pending deletions
    const deletionStates = await ctx.db
      .query('privateDeletionStates')
      .withIndex('by_status', (q) => q.eq('status', 'pending_deletion'))
      .collect();
    const deletedUserIds = new Set(deletionStates.map((d) => d.userId as string));

    // Get all ranking metrics for efficient lookup
    const allMetrics = await ctx.db
      .query('phase2RankingMetrics')
      .collect();
    const metricsMap = new Map(allMetrics.map((m) => [m.userId as string, m]));

    // Get viewer's recent impressions for suppression check
    const viewerImpressions = await ctx.db
      .query('phase2ViewerImpressions')
      .withIndex('by_viewer', (q) => q.eq('viewerId', args.userId))
      .collect();
    const recentlySeen = new Set(
      viewerImpressions
        .filter((imp) => imp.lastSeenAt > suppressionCutoff)
        .map((imp) => imp.viewedUserId as string)
    );

    // Filter out:
    // - The requesting user
    // - Incomplete profiles
    // - Blocked users (either direction)
    // - Users with pending deletion
    // NOTE: Profiles without ranking metrics are still eligible (use fallback defaults)
    const eligible = profiles.filter(
      (p) =>
        p.userId !== args.userId &&
        p.isSetupComplete &&
        !blockedUserIds.has(p.userId as string) &&
        !deletedUserIds.has(p.userId as string)
    );

    // Compute scores and separate suppressed vs unsuppressed profiles
    const viewerId = args.userId as string;
    const unsuppressed: Array<{ profile: typeof eligible[0]; score: number }> = [];
    const suppressed: Array<{ profile: typeof eligible[0]; score: number }> = [];

    for (const p of eligible) {
      // Use fallback defaults for profiles without ranking metrics
      const metrics = metricsMap.get(p.userId as string) ?? {
        phase2OnboardedAt: p.createdAt ?? now,
        lastPhase2ActiveAt: p.updatedAt ?? now,
        totalImpressions: 0,
        lastShownAt: 0,
      };
      const score = computeFinalScore(p, metrics, viewerId);

      if (recentlySeen.has(p.userId as string)) {
        suppressed.push({ profile: p, score });
      } else {
        unsuppressed.push({ profile: p, score });
      }
    }

    // Sort both arrays by score descending
    unsuppressed.sort((a, b) => b.score - a.score);
    suppressed.sort((a, b) => b.score - a.score);

    // Combine: unsuppressed first, then suppressed at back
    const ranked = [...unsuppressed, ...suppressed];

    const limit = args.limit ?? 50;
    const limited = ranked.slice(0, limit);

    // Return only blurred data — never expose original photos
    // Cast to access optional schema fields that may not be in generated types yet
    return limited.map(({ profile: p }) => {
      const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };
      // Backward compat: older records may only have privateIntentKey (single)
      const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);
      return {
        _id: p._id,
        userId: p.userId,
        displayNameInitial: p.displayName.charAt(0).toUpperCase(),
        age: p.age,
        city: p.city,
        gender: p.gender,
        blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
        blurredPhotoUrls: p.privatePhotoUrls,
        intentKeys,
        desireTagKeys: p.privateDesireTagKeys,
        privateBio: p.privateBio,
        revealPolicy: p.revealPolicy ?? 'mutual_only',
        // Include hobbies and verification status if available
        hobbies: profile.hobbies ?? [],
        isVerified: profile.isVerified ?? false,
      };
    });
  },
});

// Get a single private profile for viewing (blurred only)
// Also checks blocks before returning
// viewerId is REQUIRED to enforce block checking
export const getProfileCard = query({
  args: {
    profileId: v.id('userPrivateProfiles'),
    viewerId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.profileId);
    if (!p || !p.isPrivateEnabled || !p.isSetupComplete) return null;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.viewerId).eq('blockedUserId', p.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', p.userId).eq('blockedUserId', args.viewerId)
      )
      .first();
    if (blockedByOwner) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };
    // Backward compat: older records may only have privateIntentKey (single)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    return {
      _id: p._id,
      userId: p.userId,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: p.age,
      city: p.city,
      gender: p.gender,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      intentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
    };
  },
});

// Get a Phase-2 profile by userId (for full profile view)
// Returns full profile data including intentKeys for display
// viewerId is REQUIRED to enforce block checking
export const getProfileByUserId = query({
  args: {
    userId: v.id('users'),
    viewerId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // Find the private profile for this user
    const p = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!p || !p.isPrivateEnabled || !p.isSetupComplete) return null;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.viewerId).eq('blockedUserId', args.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.userId).eq('blockedUserId', args.viewerId)
      )
      .first();
    if (blockedByOwner) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };

    // Backward compat: older records may only have privateIntentKey (single), not privateIntentKeys (array)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    return {
      _id: p._id,
      userId: p.userId,
      name: p.displayName,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: p.age,
      city: p.city,
      gender: p.gender,
      bio: p.privateBio,
      photos: p.privatePhotoUrls.map((url, i) => ({ _id: `photo_${i}`, url })),
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      // Phase-2 intents (array)
      intentKeys,
      // Legacy single key for backward compat
      privateIntentKey: intentKeys[0] ?? null,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
      activities: profile.hobbies ?? [],
      // Phase-2 does NOT have Phase-1 fields
      relationshipIntent: [],
      profilePrompts: [],
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 6: Impression Recording for Desire Land Ranking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record Desire Land impressions for ranking system.
 * Called after profiles are displayed to the viewer.
 * Updates both global metrics (totalImpressions, lastShownAt) and
 * per-viewer impressions (for suppression window).
 *
 * Safe: silently returns if unauthenticated or on any error.
 * Fire-and-forget: client should not await or block on this.
 */
export const recordDesireLandImpressions = mutation({
  args: {
    viewedUserIds: v.array(v.id('users')),
  },
  handler: async (ctx, args) => {
    // Resolve viewer from server-side auth (secure - not client-supplied)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return;

    const viewerId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!viewerId) return;

    const now = Date.now();

    for (const viewedUserId of args.viewedUserIds) {
      // Skip if viewer is viewing themselves (shouldn't happen but guard)
      if (viewedUserId === viewerId) continue;

      // Update global metrics row (if exists)
      const metrics = await ctx.db
        .query('phase2RankingMetrics')
        .withIndex('by_user', (q) => q.eq('userId', viewedUserId))
        .first();

      if (metrics) {
        await ctx.db.patch(metrics._id, {
          totalImpressions: metrics.totalImpressions + 1,
          lastShownAt: now,
          updatedAt: now,
        });
      }

      // Update per-viewer impression row
      const existing = await ctx.db
        .query('phase2ViewerImpressions')
        .withIndex('by_pair', (q) =>
          q.eq('viewerId', viewerId).eq('viewedUserId', viewedUserId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          lastSeenAt: now,
          seenCount: existing.seenCount + 1,
        });
      } else {
        await ctx.db.insert('phase2ViewerImpressions', {
          viewerId,
          viewedUserId,
          lastSeenAt: now,
          seenCount: 1,
        });
      }
    }
  },
});
