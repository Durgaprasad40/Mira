import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { Id } from './_generated/dataModel';
import { isPrivateDataDeleted } from './privateDeletion';
import { computeFinalScore } from './phase2Ranking';
import { resolveUserIdByAuthId } from './helpers';

// Phase 3: Shadow mode imports
import { shouldRunShadowComparison } from './ranking/rankingConfig';
import { computeRankScore, logBatchRankingComparison, DEFAULT_RANKING_CONFIG } from './ranking/sharedRankingEngine';

// Suppression window: 4 hours in milliseconds
const SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

// SOFT_MATCH_FIX: Penalty scores for incomplete profiles (90/10 rule)
// Incomplete profiles are NOT filtered out, just pushed to the end
const SOFT_PENALTY = {
  NO_SETUP_COMPLETE: -1000,  // Not onboarded yet
  NO_PHOTOS: -500,           // No photos uploaded
};

// Get private discovery profiles (blurred photos only) with Phase-2 ranking
// HARD FILTERS (completely excluded):
// - The requesting user (self)
// - Blocked users (in BOTH directions - shared across phases)
// - Users with pending deletion
// - Users already swiped on
// - Users with existing chat threads
// SOFT FILTERS (pushed to end, not excluded):
// - Incomplete profiles (isSetupComplete=false) -> penalty score
// - Profiles without photos -> penalty score
// Ranking behavior:
// - Users seen within 4-hour suppression window are pushed to back
// - Users without ranking metrics use fallback defaults for scoring
// Returns profiles sorted by ranking score (descending)
export const getProfiles = query({
  args: {
    // P1-007 FIX: userId arg kept for backward compat - used as fallback when server auth fails
    userId: v.optional(v.id('users')),
    // AUTH_FIX: authUserId string for fallback resolution
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const suppressionCutoff = now - SUPPRESSION_WINDOW_MS;

    // AUTH_FIX: Robust identity resolution with fallback and debug logging
    let viewerUserId: Id<'users'> | null = null;
    let authSource = 'none';

    // Step 1: Try server-side auth (preferred)
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      viewerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (viewerUserId) {
        authSource = 'server_auth';
      }
    }

    // Step 2: Fallback to authUserId string arg (for dev/testing)
    if (!viewerUserId && args.authUserId) {
      viewerUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
      if (viewerUserId) {
        authSource = 'authUserId_fallback';
      }
    }

    // Step 3: Fallback to userId arg (legacy)
    if (!viewerUserId && args.userId) {
      viewerUserId = args.userId;
      authSource = 'userId_fallback';
    }

    // DEBUG: Log auth resolution
    console.log('[PHASE2_DISCOVER_BE] Auth resolution:', {
      identityExists: !!identity,
      identitySubject: identity?.subject ? 'present' : 'missing',
      argsAuthUserId: args.authUserId ? 'present' : 'missing',
      argsUserId: args.userId ? 'present' : 'missing',
      resolvedUserId: viewerUserId ? String(viewerUserId) : null,
      authSource,
    });

    if (!viewerUserId) {
      console.warn('[PHASE2_DISCOVER_BE] No valid auth - returning empty');
      return []; // No valid auth - return empty
    }

    // Phase 3: Shadow mode decision (once per request)
    const runShadow = shouldRunShadowComparison();

    // Get blocks, conversation partners, and already-swiped users for exclusion
    // P0-001 FIX: Added privateLikes query to exclude already-swiped profiles
    const [blocksOut, blocksIn, myConversationParticipations, mySwipes] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', viewerUserId))
        .collect(),
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerUserId))
        .collect(),
      // P2-003 FIX: Use Phase-2 privateConversationParticipants table (not Phase-1 conversationParticipants)
      // Users with existing Phase-2 chats must not reappear in Desire Land
      ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', viewerUserId))
        .collect(),
      // P0-001 FIX: Get all users this viewer has already swiped on (like/pass/super_like)
      ctx.db
        .query('privateLikes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', viewerUserId))
        .collect(),
    ]);

    // Combine into a set of blocked user IDs
    const blockedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    // P0-001 FIX: Build set of already-swiped user IDs (includes like, pass, super_like)
    // These users must NEVER reappear in the discover feed
    const alreadySwipedUserIds = new Set(
      mySwipes.map((s) => s.toUserId as string)
    );

    // P2-003 FIX: Build set of users with existing Phase-2 message threads
    // Uses privateConversations (Phase-2) via the privateConversationParticipants lookup above
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

    const profiles = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_enabled', (q) => q.eq('isPrivateEnabled', true))
      .collect();

    // P2_BE_FETCH: Log raw profile count immediately after DB query
    console.log('[P2_BE_FETCH]', {
      totalProfiles: profiles.length,
      viewerUserId: String(viewerUserId).slice(0, 15),
      timestamp: now,
    });

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
      .withIndex('by_viewer', (q) => q.eq('viewerId', viewerUserId))
      .collect();
    const recentlySeen = new Set(
      viewerImpressions
        .filter((imp) => imp.lastSeenAt > suppressionCutoff)
        .map((imp) => imp.viewedUserId as string)
    );

    // SOFT_MATCH_FIX: Relaxed filtering - only hard-block truly ineligible users
    // HARD FILTERS (completely excluded):
    // - Self
    // - Blocked users
    // - Deleted users
    // - Already swiped users
    // - Existing chat partners
    // SOFT FILTERS (included but penalized):
    // - isSetupComplete=false -> penalty score
    // - No photos -> penalty score
    const eligible = profiles.filter(
      (p) =>
        p.userId !== viewerUserId &&
        // REMOVED: p.isSetupComplete - now a soft filter, not hard
        !blockedUserIds.has(p.userId as string) &&
        !deletedUserIds.has(p.userId as string) &&
        // P0-001 FIX: Already-swiped users must NEVER reappear
        !alreadySwipedUserIds.has(p.userId as string) &&
        // P2-003 FIX: Users with existing Phase-2 chat threads must not reappear
        !conversationPartnerIds.has(p.userId as string)
    );

    // P2_BE_FILTER: Debug logging for filter tracking
    // Log exclusion set sizes to identify if sets are populated incorrectly on first call
    console.log('[P2_BE_FILTER]', {
      afterFilter: eligible.length,
      totalProfiles: profiles.length,
      // Exclusion set sizes (critical for first-load debugging)
      blockedSetSize: blockedUserIds.size,
      swipedSetSize: alreadySwipedUserIds.size,
      chatPartnerSetSize: conversationPartnerIds.size,
      deletedSetSize: deletedUserIds.size,
      // Breakdown of what got excluded
      excludedSelf: profiles.filter((p) => p.userId === viewerUserId).length,
      excludedBlocked: profiles.filter((p) => blockedUserIds.has(p.userId as string)).length,
      excludedDeleted: profiles.filter((p) => deletedUserIds.has(p.userId as string)).length,
      excludedSwiped: profiles.filter((p) => alreadySwipedUserIds.has(p.userId as string)).length,
      excludedChatPartners: profiles.filter((p) => conversationPartnerIds.has(p.userId as string)).length,
      // Soft filter stats
      incompleteProfiles: eligible.filter((p) => !p.isSetupComplete).length,
      noPhotoProfiles: eligible.filter((p) => !p.privatePhotoUrls?.length).length,
    });

    // =========================================================================
    // FALLBACK LADDER: Ensure we return profiles when they exist
    // Hard filters (NEVER relaxed): self, blocked, deleted/pending deletion
    // Soft filters (relaxed in stages): swiped, chat partners
    // =========================================================================
    let finalEligible = eligible;
    let fallbackStage = 'strict'; // Track which stage we used

    // STAGE 1 (STRICT): Use normal filters - already computed as `eligible`
    if (eligible.length > 0) {
      fallbackStage = 'strict';
    }

    // STAGE 2 (RELAXED): Relax swiped filter if strict result is empty
    if (finalEligible.length === 0 && profiles.length > 0) {
      fallbackStage = 'relaxed_swiped';
      finalEligible = profiles.filter(
        (p) =>
          p.userId !== viewerUserId &&
          !blockedUserIds.has(p.userId as string) &&
          !deletedUserIds.has(p.userId as string) &&
          !conversationPartnerIds.has(p.userId as string)
      );
    }

    // STAGE 3 (MORE RELAXED): Also relax chat partners filter
    if (finalEligible.length === 0 && profiles.length > 0) {
      fallbackStage = 'relaxed_chatpartners';
      finalEligible = profiles.filter(
        (p) =>
          p.userId !== viewerUserId &&
          !blockedUserIds.has(p.userId as string) &&
          !deletedUserIds.has(p.userId as string)
      );
    }

    // STAGE 4 (SAFE POOL): Relax all soft filters, keep hard filters
    // Hard filters always applied: self, blocked, deleted
    if (finalEligible.length === 0 && profiles.length > 0) {
      fallbackStage = 'safe_pool';
      finalEligible = profiles.filter(
        (p) =>
          p.userId !== viewerUserId &&
          !blockedUserIds.has(p.userId as string) &&
          !deletedUserIds.has(p.userId as string)
      );
    }

    // Log fallback result
    console.log('[PRIVATE_DISCOVER_FALLBACK]', {
      stage: fallbackStage,
      strictCount: eligible.length,
      finalCount: finalEligible.length,
      profilesInDb: profiles.length,
      otherUsersExist: profiles.some((p) => p.userId !== viewerUserId),
    });

    // Compute scores and separate suppressed vs unsuppressed profiles
    const viewerId = viewerUserId as string;
    const unsuppressed: Array<{ profile: typeof finalEligible[0]; score: number }> = [];
    const suppressed: Array<{ profile: typeof finalEligible[0]; score: number }> = [];

    for (const p of finalEligible) {
      // Use fallback defaults for profiles without ranking metrics
      const metrics = metricsMap.get(p.userId as string) ?? {
        phase2OnboardedAt: p.createdAt ?? now,
        lastPhase2ActiveAt: p.updatedAt ?? now,
        totalImpressions: 0,
        lastShownAt: 0,
      };
      let score = computeFinalScore(p, metrics, viewerId);

      // SOFT_MATCH_FIX: Apply soft penalties (push incomplete profiles to end)
      // These profiles are still shown, just ranked lower
      if (!p.isSetupComplete) {
        score += SOFT_PENALTY.NO_SETUP_COMPLETE;
      }
      if (!p.privatePhotoUrls?.length) {
        score += SOFT_PENALTY.NO_PHOTOS;
      }

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

    // HANDLE_FIX: Fetch user handles (nicknames) from users table
    // Phase-2 MUST use ONLY user.handle (user-controlled nickname), NEVER user.name
    // Handle is the @username chosen by user during onboarding
    const userIds = limited.map(({ profile: p }) => p.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const nicknameMap = new Map<string, string>();
    for (let i = 0; i < userIds.length; i++) {
      const user = users[i];
      // STRICT: Use ONLY user.handle, never user.name or firstName
      if (user?.handle) {
        nicknameMap.set(userIds[i] as string, user.handle);
      }
    }

    // PRIVATE_DISCOVER_COUNTS: Comprehensive pipeline summary for debugging
    console.log('[PRIVATE_DISCOVER_COUNTS]', {
      total: profiles.length,
      afterHardFilters: eligible.length,
      afterFallback: finalEligible.length,
      unsuppressed: unsuppressed.length,
      suppressed: suppressed.length,
      final: limited.length,
      fallbackStage: eligible.length === 0 && finalEligible.length > 0 ? 'triggered' : 'none',
    });

    // P2_BE_RETURN: Final log before returning to client
    console.log('[P2_BE_RETURN]', {
      finalCount: limited.length,
      unsuppressedCount: unsuppressed.length,
      suppressedCount: suppressed.length,
      requestedLimit: args.limit ?? 50,
    });

    // PRIVATE_DISCOVER_EMPTY: Explain WHY result is empty
    if (limited.length === 0) {
      console.log('[PRIVATE_DISCOVER_EMPTY]', {
        reason: profiles.length === 0
          ? 'no_phase2_profiles_in_db'
          : eligible.length === 0 && finalEligible.length === 0
            ? 'all_filtered_even_after_fallback'
            : 'unknown',
        totalDbProfiles: profiles.length,
        viewerWasOnlyUser: profiles.length === 1 && profiles[0]?.userId === viewerUserId,
      });
    }

    // Return only blurred data — never expose original photos
    // Cast to access optional schema fields that may not be in generated types yet
    // SOFT_MATCH_FIX: Include flags for incomplete profiles so frontend can show appropriate UI
    return limited.map(({ profile: p }) => {
      const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };
      // Backward compat: older records may only have privateIntentKey (single)
      const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);
      // P0-002 FIX: Standardize on single field 'displayName' for all Phase-2 profiles
      // This is the user's handle (anonymous identifier), never their real name
      const displayName = nicknameMap.get(p.userId as string) ?? 'Anonymous';
      return {
        _id: p._id,
        userId: p.userId,
        // P0-002: Single canonical field for user's anonymous display name
        displayName,
        age: p.age,
        city: p.city,
        gender: p.gender,
        blurredPhotoUrl: p.privatePhotoUrls?.[0] ?? null,
        blurredPhotoUrls: p.privatePhotoUrls ?? [],
        intentKeys,
        desireTagKeys: p.privateDesireTagKeys,
        privateBio: p.privateBio,
        // Include hobbies and verification status if available
        hobbies: profile.hobbies ?? [],
        isVerified: profile.isVerified ?? false,
        // SOFT_MATCH_FIX: Flags for frontend to show appropriate UI
        isSetupComplete: p.isSetupComplete ?? false,
        hasPhotos: (p.privatePhotoUrls?.length ?? 0) > 0,
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

    // P0-002 FIX: Standardize on single field 'displayName' for all Phase-2 profiles
    const user = await ctx.db.get(p.userId);
    const displayName = user?.handle ?? 'Anonymous';

    return {
      _id: p._id,
      userId: p.userId,
      // P0-002: Single canonical field for user's anonymous display name
      displayName,
      age: p.age,
      city: p.city,
      gender: p.gender,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      intentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
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

    // P0-004 FIX + P2-008 REVIEW: Cross-phase anonymity protection
    // INTENTIONAL SHARED BEHAVIOR: This check queries Phase-1 conversations table
    // to prevent de-anonymizing users who sent anonymous confessions.
    // If user A sent an anonymous confession to user B in Phase-1, and user B
    // tries to view user A's Phase-2 profile, we return null to preserve anonymity.
    // This cross-phase check is REQUIRED for privacy - not an unnecessary dependency.
    const anonymousConversation = await ctx.db
      .query('conversations')
      .filter((q) =>
        q.and(
          q.eq(q.field('anonymousParticipantId'), args.userId),
          q.or(
            q.eq(q.field('participants'), [args.userId, args.viewerId]),
            q.eq(q.field('participants'), [args.viewerId, args.userId])
          )
        )
      )
      .first();
    if (anonymousConversation) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };

    // Backward compat: older records may only have privateIntentKey (single), not privateIntentKeys (array)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    // P0-002 FIX: Standardize on single field 'displayName' for all Phase-2 profiles
    const user = await ctx.db.get(args.userId);
    const displayName = user?.handle ?? 'Anonymous';

    // Cast to access optional promptAnswers field
    const profileWithPrompts = p as typeof p & { promptAnswers?: { promptId: string; question: string; answer: string }[] };

    return {
      _id: p._id,
      userId: p.userId,
      // P0-002: Single canonical field for user's anonymous display name
      displayName,
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
      boundaries: p.privateBoundaries ?? [],
      privateBio: p.privateBio,
      // Phase-2 prompt answers
      promptAnswers: profileWithPrompts.promptAnswers ?? [],
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
