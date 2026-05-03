import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { isPrivateDataDeleted } from './privateDeletion';
import { computeFinalScore } from './phase2Ranking';
import { resolveUserIdByAuthId, isRevealed } from './helpers';

// Phase 3: Shadow mode imports
import { shouldRunShadowComparison } from './ranking/rankingConfig';
import { computeRankScore, logBatchRankingComparison, DEFAULT_RANKING_CONFIG } from './ranking/sharedRankingEngine';

// Suppression window: 4 hours in milliseconds
const SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000;
const MAX_BLOCK_ROWS = 5000;
const MAX_CONVERSATION_ROWS = 500;
const MAX_PRIVATE_RELATIONSHIP_ROWS = 5000;
const MAX_PENDING_DELETION_ROWS = 5000;
const IMPRESSION_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_IMPRESSIONS_PER_WINDOW = 300;

/** Haversine distance in km (rounded), matches users.getUserById / discover helpers */
function distanceKmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function getProfileIntentKeys(profile: { privateIntentKeys?: string[]; privateIntentKey?: string | null | undefined }): string[] {
  return (profile.privateIntentKeys && profile.privateIntentKeys.length > 0)
    ? profile.privateIntentKeys
    : (profile.privateIntentKey ? [profile.privateIntentKey] : []);
}

async function isWithinDeepConnectImpressionRateLimit(
  ctx: any,
  viewerId: Id<'users'>,
  increment: number
): Promise<boolean> {
  if (increment <= 0) return true;

  const now = Date.now();
  const existing = await ctx.db
    .query('phase2ImpressionRateLimits')
    .withIndex('by_viewer', (q: any) => q.eq('viewerId', viewerId))
    .first();

  if (!existing) {
    await ctx.db.insert('phase2ImpressionRateLimits', {
      viewerId,
      windowStart: now,
      count: increment,
      updatedAt: now,
    });
    return true;
  }

  if (existing.windowStart < now - IMPRESSION_RATE_LIMIT_WINDOW_MS) {
    await ctx.db.patch(existing._id, {
      windowStart: now,
      count: increment,
      updatedAt: now,
    });
    return true;
  }

  if (existing.count + increment > MAX_IMPRESSIONS_PER_WINDOW) {
    return false;
  }

  await ctx.db.patch(existing._id, {
    count: existing.count + increment,
    updatedAt: now,
  });
  return true;
}

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
    // DL-013: userId is optional; prefer server-side auth resolution
    userId: v.optional(v.id('users')),
    authUserId: v.optional(v.string()),
    intentKeys: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const suppressionCutoff = now - SUPPRESSION_WINDOW_MS;
    const requestedIntentKeys = (args.intentKeys ?? [])
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    const requestedIntentKeySet =
      requestedIntentKeys.length > 0 ? new Set(requestedIntentKeys) : null;

    // DL-013: Resolve viewer from server-side auth, then legacy args.userId, then authUserId fallback
    let viewerUserId = undefined;
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const resolvedId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (resolvedId) {
        viewerUserId = resolvedId;
      }
    }
    if (!viewerUserId && args.userId) {
      viewerUserId = args.userId;
    }
    if (!viewerUserId && args.authUserId?.trim()) {
      const resolvedId = await resolveUserIdByAuthId(ctx, args.authUserId.trim());
      if (resolvedId) {
        viewerUserId = resolvedId;
      }
    }
    if (!viewerUserId) {
      return []; // No valid viewer - return empty
    }

    // Phase 3: Shadow mode decision (once per request)
    const runShadow = shouldRunShadowComparison();

    // Get blocks for current user (both directions - shared across Phase-1 and Phase-2)
    const [
      blocksOut,
      blocksIn,
      myConversationParticipations,
      matchesAsUser1,
      matchesAsUser2,
      myPrivateSwipes,
      myReports,
    ] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', viewerUserId))
        .take(MAX_BLOCK_ROWS),
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerUserId))
        .take(MAX_BLOCK_ROWS),
      // CONVERSATION PARTNER EXCLUSION: Users with existing chats must not reappear
      ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', viewerUserId))
        .take(MAX_CONVERSATION_ROWS),
      ctx.db
        .query('privateMatches')
        .withIndex('by_user1', (q) => q.eq('user1Id', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
      ctx.db
        .query('privateMatches')
        .withIndex('by_user2', (q) => q.eq('user2Id', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
      ctx.db
        .query('privateLikes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
      ctx.db
        .query('reports')
        .withIndex('by_reporter', (q) => q.eq('reporterId', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
    ]);

    // Combine into a set of blocked user IDs
    const blockedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    // CONVERSATION PARTNER EXCLUSION: Build set of users with existing message threads
    const conversationPartnerIds = new Set<string>();
    if (myConversationParticipations.length > 0) {
      const conversations = await Promise.all(
        myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
      );
      for (const conv of conversations) {
        if (!conv) continue;
        for (const participantId of conv.participants) {
          if (participantId !== viewerUserId) {
            conversationPartnerIds.add(participantId as string);
          }
        }
      }
    }

    const matchedUserIds = new Set<string>();
    const unmatchedUserIds = new Set<string>();
    for (const match of matchesAsUser1) {
      const isUnmatched =
        match.isActive === false ||
        (match as any).unmatchedAt != null ||
        (match as any).user1UnmatchedAt != null ||
        (match as any).user2UnmatchedAt != null;
      (isUnmatched ? unmatchedUserIds : matchedUserIds).add(match.user2Id as string);
    }
    for (const match of matchesAsUser2) {
      const isUnmatched =
        match.isActive === false ||
        (match as any).unmatchedAt != null ||
        (match as any).user1UnmatchedAt != null ||
        (match as any).user2UnmatchedAt != null;
      (isUnmatched ? unmatchedUserIds : matchedUserIds).add(match.user1Id as string);
    }

    const swipedUserIds = new Set(myPrivateSwipes.map((s) => s.toUserId as string));
    const reportedUserIds = new Set(myReports.map((r) => r.reportedUserId as string));

    const profiles = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_enabled', (q) => q.eq('isPrivateEnabled', true))
      .collect();

    // Viewer private profile signals (Phase-2 only) for compatibility-aware ranking.
    // NOTE: This does NOT affect eligibility filtering; it only improves ordering.
    const viewerPrivateProfile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', viewerUserId))
      .first();

    // Get all deletion states to filter out pending deletions
    const deletionStates = await ctx.db
      .query('privateDeletionStates')
      .withIndex('by_status', (q) => q.eq('status', 'pending_deletion'))
      .take(MAX_PENDING_DELETION_ROWS);
    const deletedUserIds = new Set(deletionStates.map((d) => d.userId as string));

    // Get viewer's recent impressions for suppression check via compound index
    const viewerImpressions = await ctx.db
      .query('phase2ViewerImpressions')
      .withIndex('by_viewer_lastSeenAt', (q) =>
        q.eq('viewerId', viewerUserId).gt('lastSeenAt', suppressionCutoff)
      )
      .collect();
    const recentlySeen = new Set(
      viewerImpressions.map((imp) => imp.viewedUserId as string)
    );

    // Filter out:
    // - The requesting user
    // - Incomplete profiles
    // - Blocked users (either direction)
    // - Existing private conversation partners
    // - Existing private matches and unmatched private matches
    // - Users already swiped in Deep Connect
    // - Users reported by the viewer
    // - Users with pending deletion
    // - Users who opted out of Deep Connect discovery (hideFromDeepConnect === true; missing = visible)
    // NOTE: Profiles without ranking metrics are still eligible (use fallback defaults)
    const eligible = profiles.filter(
      (p) => {
        const profileIntentKeys = getProfileIntentKeys(
          p as typeof p & { privateIntentKey?: string | null | undefined }
        );
        return (
          p.userId !== viewerUserId &&
          p.isSetupComplete &&
          !blockedUserIds.has(p.userId as string) &&
          !conversationPartnerIds.has(p.userId as string) &&
          !matchedUserIds.has(p.userId as string) &&
          !unmatchedUserIds.has(p.userId as string) &&
          !swipedUserIds.has(p.userId as string) &&
          !reportedUserIds.has(p.userId as string) &&
          !deletedUserIds.has(p.userId as string) &&
          p.hideFromDeepConnect !== true &&
          (!requestedIntentKeySet ||
            profileIntentKeys.some((key) => requestedIntentKeySet.has(key)))
        );
      }
    );

    // Fetch ranking metrics only for the profiles we may score.
    const metricEntries = await Promise.all(
      eligible.map(async (profile) => ({
        userId: profile.userId as string,
        metrics: await ctx.db
          .query('phase2RankingMetrics')
          .withIndex('by_user', (q) => q.eq('userId', profile.userId))
          .first(),
      }))
    );
    const metricsMap = new Map(
      metricEntries.flatMap(({ userId, metrics }) => (metrics ? [[userId, metrics] as const] : []))
    );

    // Compute scores and separate suppressed vs unsuppressed profiles
    const viewerId = viewerUserId as string;
    const unsuppressed: Array<{ profile: typeof eligible[0]; score: number }> = [];
    const suppressed: Array<{ profile: typeof eligible[0]; score: number }> = [];

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

    for (const p of eligible) {
      // Use fallback defaults for profiles without ranking metrics
      const metrics = metricsMap.get(p.userId as string) ?? {
        phase2OnboardedAt: p.createdAt ?? now,
        lastPhase2ActiveAt: p.updatedAt ?? now,
        totalImpressions: 0,
        lastShownAt: 0,
      };
      const score = computeFinalScore(p, metrics, viewerId, viewerSignals);

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

    const viewerUserDoc = await ctx.db.get(viewerUserId);
    const ownerIds = [...new Set(limited.map(({ profile: p }) => p.userId as string))];
    const ownerDocs = await Promise.all(ownerIds.map((id) => ctx.db.get(id as Id<'users'>)));
    const ownerById = new Map(ownerIds.map((id, i) => [id, ownerDocs[i]]));

    // Phase 3: Shadow mode rank comparison (no production impact)
    // Legacy result is finalized above - this only logs for analysis
    if (runShadow) {
      try {
        // Build minimal normalized viewer for Phase-2
        // NOTE: Viewer preferences are intentionally neutral because Phase-2
        // has limited viewer preference data and this is rank-only shadow comparison
        const normalizedViewer: import('./ranking/rankingTypes').NormalizedViewer = {
          id: viewerId,
          phase: 'phase2',
          relationshipIntent: [],
          activities: [],
          lifestyle: {},
          maxDistance: 0,
          blockedIds: new Set<string>(),
          reportedIds: new Set<string>(),
        };

        // Build normalized candidates from limited results only (capped)
        const normalizedCandidates: import('./ranking/rankingTypes').NormalizedCandidate[] = limited.map(({ profile: p }) => {
          const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; promptAnswers?: Array<{ answer?: string }>; height?: number; education?: string };
          const metrics = metricsMap.get(p.userId as string);

          // Count filled prompts if available (Phase-2 uses promptAnswers field)
          const promptsAnswered = Array.isArray(profile.promptAnswers)
            ? profile.promptAnswers.filter((pr: any) => pr.answer?.trim().length > 0).length
            : 0;

          return {
            id: p.userId as string,
            phase: 'phase2' as const,
            relationshipIntent: [],
            activities: profile.hobbies ?? [],
            lifestyle: {},
            bioLength: p.privateBio?.trim().length ?? 0,
            promptsAnswered,
            photoCount: p.privatePhotoUrls?.length ?? 0,
            isVerified: profile.isVerified ?? false,
            hasOptionalFields: { height: !!profile.height, jobTitle: false, education: !!profile.education },
            lastActiveAt: metrics?.lastPhase2ActiveAt ?? p.updatedAt ?? now,
            onboardedAt: metrics?.phase2OnboardedAt ?? p.createdAt ?? now,
            createdAt: p.createdAt ?? now,
            distance: undefined,
            theyLikedMe: false,   // Phase-2 has no swipe system
            isBoosted: false,     // Phase-2 has no boost system
            reportCount: 0,
            blockCount: 0,
            totalImpressions: metrics?.totalImpressions ?? 0,
            lastShownAt: metrics?.lastShownAt ?? 0,
          };
        });

        // Compute shared scores and build rank lookup
        const sharedScored = normalizedCandidates.map((c, i) => ({
          id: c.id,
          score: computeRankScore(c, normalizedViewer, DEFAULT_RANKING_CONFIG).score,
          originalIndex: i,
        }));
        sharedScored.sort((a, b) => b.score - a.score);
        const sharedRankMap = new Map<string, number>();
        sharedScored.forEach((s, i) => sharedRankMap.set(s.id, i));

        // Build comparisons: [candidateId, legacyRank, sharedRank]
        const comparisons: Array<[string, number, number]> = [];
        for (let i = 0; i < limited.length; i++) {
          const candidateId = limited[i].profile.userId as string;
          const sharedRank = sharedRankMap.get(candidateId) ?? -1;
          comparisons.push([candidateId, i, sharedRank]);
        }

        logBatchRankingComparison(viewerId, comparisons, 'phase2');
      } catch {
        // Silent fail - shadow mode must never break production
      }
    }

    // P1-009: Batch-compute reveal status for each candidate against the viewer.
    // Discover normally excludes conversation partners (who include matches), but we
    // compute defensively so the field is always accurate.
    const revealMap = new Map<string, boolean>();
    await Promise.all(
      limited.map(async ({ profile: p }) => {
        const revealed = await isRevealed(ctx, viewerUserId as Id<'users'>, p.userId);
        revealMap.set(p.userId as string, revealed);
      })
    );

    // Return only blurred data — never expose original photos
    // Cast to access optional schema fields that may not be in generated types yet
    return limited.map(({ profile: p }) => {
      const profile = p as typeof p & {
        hobbies?: string[];
        isVerified?: boolean;
        privateIntentKey?: string;
        education?: string;
        religion?: string;
      };
      // Backward compat: older records may only have privateIntentKey (single)
      const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);
      // Privacy: hide age from others in Deep Connect (viewer is never self here — excluded above)
      const age = profile.hideAge === true ? undefined : p.age;
      const ownerUser = ownerById.get(p.userId as string);
      if (!ownerUser || ownerUser.isActive !== true) {
        return null;
      }
      let distanceKm: number | undefined;
      if (
        profile.hideDistance !== true &&
        viewerUserDoc?.latitude != null &&
        viewerUserDoc?.longitude != null &&
        ownerUser?.latitude != null &&
        ownerUser?.longitude != null
      ) {
        distanceKm = distanceKmBetween(
          viewerUserDoc.latitude,
          viewerUserDoc.longitude,
          ownerUser.latitude,
          ownerUser.longitude
        );
      }
      return {
        _id: p._id,
        userId: p.userId,
        displayName: p.displayName,
        displayNameInitial: p.displayName.charAt(0).toUpperCase(),
        age,
        city: p.city,
        gender: p.gender,
        photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
        photoBlurSlots: p.photoBlurSlots ?? undefined,
        blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
        blurredPhotoUrls: p.privatePhotoUrls,
        intentKeys,
        privateIntentKeys: intentKeys,
        desireTagKeys: p.privateDesireTagKeys,
        promptAnswers: p.promptAnswers,
        height: p.height,
        smoking: p.smoking,
        drinking: p.drinking,
        education: profile.education,
        religion: profile.religion,
        isSetupComplete: p.isSetupComplete,
        privateBio: p.privateBio,
        revealPolicy: p.revealPolicy ?? 'mutual_only',
        // P1-009: mutual reveal for this pair — client uses to skip blur
        isRevealed: revealMap.get(p.userId as string) ?? false,
        // Include hobbies and verification status if available
        hobbies: profile.hobbies ?? [],
        isVerified: profile.isVerified ?? false,
        ...(distanceKm !== undefined ? { distanceKm } : {}),
      };
    }).filter(Boolean);
  },
});

// Get a single private profile for viewing (blurred only)
// Also checks blocks before returning
// viewer resolves from server auth first, then optional viewerId / viewerAuthUserId fallback
export const getProfileCard = query({
  args: {
    profileId: v.id('userPrivateProfiles'),
    viewerId: v.optional(v.id('users')),
    viewerAuthUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let viewerUserId = undefined;
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const resolvedId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (resolvedId) {
        viewerUserId = resolvedId;
      }
    }
    if (!viewerUserId && args.viewerId) {
      viewerUserId = args.viewerId;
    }
    if (!viewerUserId && args.viewerAuthUserId?.trim()) {
      const resolvedId = await resolveUserIdByAuthId(ctx, args.viewerAuthUserId.trim());
      if (resolvedId) {
        viewerUserId = resolvedId;
      }
    }
    if (!viewerUserId) return null;

    const p = await ctx.db.get(args.profileId);
    if (!p || !p.isPrivateEnabled || !p.isSetupComplete) return null;
    const owner = await ctx.db.get(p.userId);
    if (!owner || owner.isActive !== true) return null;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', viewerUserId).eq('blockedUserId', p.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', p.userId).eq('blockedUserId', viewerUserId)
      )
      .first();
    if (blockedByOwner) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & {
      hobbies?: string[];
      isVerified?: boolean;
      privateIntentKey?: string;
      education?: string;
      religion?: string;
    };
    // Backward compat: older records may only have privateIntentKey (single)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    const hideAgeFromViewer = profile.hideAge === true && viewerUserId !== p.userId;

    let distanceKm: number | undefined;
    if (viewerUserId !== p.userId && profile.hideDistance !== true) {
      const [viewerU, ownerU] = await Promise.all([ctx.db.get(viewerUserId), Promise.resolve(owner)]);
      if (
        viewerU?.latitude != null &&
        viewerU?.longitude != null &&
        ownerU?.latitude != null &&
        ownerU?.longitude != null
      ) {
        distanceKm = distanceKmBetween(
          viewerU.latitude,
          viewerU.longitude,
          ownerU.latitude,
          ownerU.longitude
        );
      }
    }

    // P1-009: reveal check for this exact pair (viewerUserId is guaranteed defined above)
    const revealed = await isRevealed(ctx, viewerUserId, p.userId);

    return {
      _id: p._id,
      userId: p.userId,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: hideAgeFromViewer ? undefined : p.age,
      city: p.city,
      gender: p.gender,
      photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
      photoBlurSlots: p.photoBlurSlots ?? undefined,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      intentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // P1-009: mutual reveal for this pair — client uses to skip blur
      isRevealed: revealed,
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
      education: profile.education,
      religion: profile.religion,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    };
  },
});

// Get a Phase-2 profile by userId (for full profile view)
// Returns full profile data including intentKeys for display
// viewer resolves from server auth first, then optional viewerId / viewerAuthUserId fallback
export const getProfileByUserId = query({
  args: {
    userId: v.id('users'),
    viewerId: v.optional(v.id('users')),
    viewerAuthUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let viewerUserId = undefined;
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const resolvedId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (resolvedId) {
        viewerUserId = resolvedId;
      }
    }
    if (!viewerUserId && args.viewerId) {
      viewerUserId = args.viewerId;
    }
    if (!viewerUserId && args.viewerAuthUserId?.trim()) {
      const resolvedId = await resolveUserIdByAuthId(ctx, args.viewerAuthUserId.trim());
      if (resolvedId) {
        viewerUserId = resolvedId;
      }
    }
    if (!viewerUserId) return null;

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
        q.eq('blockerId', viewerUserId).eq('blockedUserId', args.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.userId).eq('blockedUserId', viewerUserId)
      )
      .first();
    if (blockedByOwner) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & {
      hobbies?: string[];
      isVerified?: boolean;
      privateIntentKey?: string;
      education?: string;
      religion?: string;
    };

    // Backward compat: older records may only have privateIntentKey (single), not privateIntentKeys (array)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    const hideAgeFromViewer = profile.hideAge === true && viewerUserId !== args.userId;

    let distanceKm: number | undefined;
    if (viewerUserId !== args.userId && profile.hideDistance !== true) {
      const [viewerU, ownerU] = await Promise.all([ctx.db.get(viewerUserId), ctx.db.get(args.userId)]);
      if (
        viewerU?.latitude != null &&
        viewerU?.longitude != null &&
        ownerU?.latitude != null &&
        ownerU?.longitude != null
      ) {
        distanceKm = distanceKmBetween(
          viewerU.latitude,
          viewerU.longitude,
          ownerU.latitude,
          ownerU.longitude
        );
      }
    }

    // P1-009: reveal check for this exact pair (viewerUserId is guaranteed defined above)
    const revealed = await isRevealed(ctx, viewerUserId, args.userId);

    return {
      _id: p._id,
      userId: p.userId,
      name: p.displayName,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: hideAgeFromViewer ? undefined : p.age,
      city: p.city,
      gender: p.gender,
      bio: p.privateBio,
      photos: p.privatePhotoUrls.map((url, i) => ({ _id: `photo_${i}`, url })),
      photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
      photoBlurSlots: p.photoBlurSlots ?? undefined,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      // Phase-2 intents (array)
      intentKeys,
      // Legacy single key for backward compat
      privateIntentKey: intentKeys[0] ?? null,
      desireTagKeys: p.privateDesireTagKeys,
      promptAnswers: p.promptAnswers,
      height: p.height,
      smoking: p.smoking,
      drinking: p.drinking,
      education: profile.education,
      religion: profile.religion,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // P1-009: mutual reveal for this pair — client uses to skip blur
      isRevealed: revealed,
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
      activities: profile.hobbies ?? [],
      // Phase-2 does NOT have Phase-1 fields
      relationshipIntent: [],
      profilePrompts: [],
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 6: Impression Recording for Deep Connect ranking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record Deep Connect impressions for ranking system.
 * Called after profiles are displayed to the viewer.
 * Updates both global metrics (totalImpressions, lastShownAt) and
 * per-viewer impressions (for suppression window).
 *
 * Safe: silently returns if unauthenticated or on any error.
 * Fire-and-forget: client should not await or block on this.
 */
export const recordDeepConnectImpressions = mutation({
  args: {
    viewedUserIds: v.array(v.id('users')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve viewer from server-side auth first, then authUserId fallback.
    let viewerId = undefined;
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      viewerId = await resolveUserIdByAuthId(ctx, identity.subject);
    }
    if (!viewerId && args.authUserId?.trim()) {
      viewerId = await resolveUserIdByAuthId(ctx, args.authUserId.trim());
    }
    if (!viewerId) return;

    const viewedUserIds = [...new Set(args.viewedUserIds)]
      .filter((viewedUserId) => viewedUserId !== viewerId);
    if (viewedUserIds.length === 0) return;

    const allowed = await isWithinDeepConnectImpressionRateLimit(
      ctx,
      viewerId,
      viewedUserIds.length
    );
    if (!allowed) return;

    const now = Date.now();

    for (const viewedUserId of viewedUserIds) {

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
