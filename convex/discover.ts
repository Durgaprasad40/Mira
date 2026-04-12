import { v } from 'convex/values';
import { query, QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId } from './helpers';
import {
  FRONTEND_EXPLORE_CATEGORY_IDS,
  normalizeExploreCategoryId,
  normalizeRelationshipIntentValues,
} from '../lib/discoveryNaming';
import {
  CandidateProfile,
  CurrentUser,
  TrustSignals,
  rankDiscoverCandidates,
  qualifiesForFallback,
  DISCOVER_RANKING_CONFIG,
} from './discoverRanking';

// Phase 3: Shadow mode imports
import { shouldRunShadowComparison } from './ranking/rankingConfig';
import { rankCandidates as sharedRankCandidates, logBatchRankingComparison } from './ranking/sharedRankingEngine';

// DEV DEBUG: Structured logging
import { convexLog, convexError } from './_logging';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUserPaused(user: { isDiscoveryPaused?: boolean; discoveryPausedUntil?: number }): boolean {
  return (
    user.isDiscoveryPaused === true &&
    typeof user.discoveryPausedUntil === 'number' &&
    user.discoveryPausedUntil > Date.now()
  );
}

// BUGFIX #21: Safe date parsing with NaN guard
function calculateAge(dateOfBirth: string): number {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Check if a calculated distance is within the allowed max.
 * Mirrors lib/distanceRules.ts - profiles without distance are allowed.
 */
function isDistanceAllowed(distance: number | undefined, maxDistanceKm: number): boolean {
  if (distance == null) return true;
  return distance <= maxDistanceKm;
}

// ---------------------------------------------------------------------------
// Simple 4-signal scoring (0–100 each, then weighted)
//
//   score = 0.45 * activity + 0.35 * completeness
//         + 0.15 * preference + 0.05 * rotation
//
// No hard-blocks — everyone appears; complete profiles rank higher.
// ---------------------------------------------------------------------------

/** A) Activity score (0–100) — recently active users rank higher. */
function activityScore(lastActive: number): number {
  const now = Date.now();
  const hoursAgo = (now - lastActive) / (1000 * 60 * 60);
  if (hoursAgo < 1)  return 100;
  if (hoursAgo < 4)  return 85;
  if (hoursAgo < 12) return 70;
  if (hoursAgo < 24) return 55;
  if (hoursAgo < 72) return 35;
  if (hoursAgo < 168) return 15; // 7 days
  return 5;
}

/** B) Profile completeness score (0–100). */
function completenessScore(user: {
  bio: string;
  profilePrompts?: { question: string; answer: string }[];
  activities: string[];
  isVerified: boolean;
  height?: number;
  jobTitle?: string;
  education?: string;
}, photoCount: number): number {
  let score = 0;

  // Bio filled? (0–20)
  if (user.bio && user.bio.trim().length >= 100) score += 20;
  else if (user.bio && user.bio.trim().length >= 50) score += 15;
  else if (user.bio && user.bio.trim().length > 0) score += 5;

  // 3 prompts answered? (0–25)
  const filledPrompts = (user.profilePrompts ?? []).filter(
    (p) => p.answer.trim().length > 0,
  ).length;
  score += Math.min(filledPrompts, 3) * 8; // 0, 8, 16, 24 — cap at 24
  if (filledPrompts >= 3) score += 1; // bonus for hitting 3

  // Interests selected? (0–15)
  if (user.activities.length >= 3) score += 15;
  else if (user.activities.length >= 1) score += 8;

  // At least 1 photo? (0–20)
  if (photoCount >= 4) score += 20;
  else if (photoCount >= 2) score += 15;
  else if (photoCount >= 1) score += 10;

  // Verified? (0–10)
  if (user.isVerified) score += 10;

  // Optional extras (0–10)
  if (user.height) score += 3;
  if (user.jobTitle) score += 3;
  if (user.education) score += 4;

  return Math.min(score, 100);
}

/** C) Preference match score (0–100) — age/city + common interests. */
function preferenceMatchScore(
  candidate: {
    city?: string;
    activities: string[];
    relationshipIntent: string[];
  },
  currentUser: {
    city?: string;
    activities: string[];
    relationshipIntent: string[];
  },
): number {
  let score = 0;
  const candidateIntent = normalizeRelationshipIntentValues(candidate.relationshipIntent);
  const viewerIntent = normalizeRelationshipIntentValues(currentUser.relationshipIntent);

  // Same city? (0–30)
  if (candidate.city && currentUser.city && candidate.city === currentUser.city) {
    score += 30;
  }

  // Common interests (0–40) — 10 pts each, cap at 40
  const shared = candidate.activities.filter((a) => currentUser.activities.includes(a));
  score += Math.min(shared.length * 10, 40);

  // Relationship intent alignment (0–30)
  const intentCompat: Record<string, string[]> = {
    serious_vibes: ['serious_vibes', 'see_where_it_goes'],
    keep_it_casual: ['keep_it_casual', 'open_to_vibes'],
    exploring_vibes: ['exploring_vibes', 'open_to_anything'],
    see_where_it_goes: ['see_where_it_goes', 'serious_vibes', 'keep_it_casual'],
    open_to_vibes: ['open_to_vibes', 'keep_it_casual'],
    just_friends: ['just_friends', 'open_to_anything'],
    open_to_anything: ['open_to_anything', 'exploring_vibes', 'just_friends'],
    single_parent: ['single_parent'],
    new_to_dating: ['new_to_dating'],
  };
  let bestIntent = 0;
  for (const mine of viewerIntent) {
    for (const theirs of candidateIntent) {
      if (mine === theirs) bestIntent = Math.max(bestIntent, 30);
      else if (intentCompat[mine]?.includes(theirs)) bestIntent = Math.max(bestIntent, 15);
    }
  }
  score += bestIntent;

  return Math.min(score, 100);
}

/** D) Rotation score (0–100) — pseudo-random per viewer+candidate pair per day. */
function rotationScore(viewerId: string, candidateId: string): number {
  // Simple day-seeded hash so the order shuffles daily
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  let h = day;
  for (let i = 0; i < viewerId.length; i++) h = ((h << 5) - h + viewerId.charCodeAt(i)) | 0;
  for (let i = 0; i < candidateId.length; i++) h = ((h << 5) - h + candidateId.charCodeAt(i)) | 0;
  return Math.abs(h) % 101; // 0–100
}

// NOTE: Old rankScore function removed (P1 dead code cleanup)
// New ranking system in discoverRanking.ts is now the only scoring logic

// ---------------------------------------------------------------------------
// getDiscoverProfiles — main swipe deck query
// ---------------------------------------------------------------------------

export const getDiscoverProfiles = query({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
    sortBy: v.optional(v.union(
      v.literal('recommended'),
      v.literal('distance'),
      v.literal('age'),
      v.literal('recently_active'),
      v.literal('newest'),
    )),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    // filterVersion is a cache-busting param — not used in logic, just forces re-fetch
    filterVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const { sortBy = 'recommended', limit = 20, offset = 0 } = args;
    // filterVersion intentionally unused — it's only to bust query cache

    convexLog('discover.getDiscoverProfiles', { sortBy, limit, offset, status: 'started' });

    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      convexLog('discover.getDiscoverProfiles', { status: 'user_not_found', authUserId: String(args.userId).slice(-8) });
      return [];
    }

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return [];

    if (isUserPaused(currentUser)) return [];

    // PERF #8: Pre-fetch all swipes, matches, blocks, and incoming likes upfront
    // This converts O(6*N) queries into O(6) queries
    const now = Date.now();
    const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

    const [
      mySwipes,
      matchesAsUser1,
      matchesAsUser2,
      blocksICreated,
      blocksAgainstMe,
      likesToMe,
      myReports,
      allReports,
      allBlocks,
      myConversationParticipations,
    ] = await Promise.all([
      // All my swipes (likes/passes)
      ctx.db
        .query('likes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
        .collect(),
      // Matches where I'm user1
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
      // Matches where I'm user2
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
      // Blocks I created
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      // Blocks against me
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
      // Likes to me (for theyLikedMe feature)
      ctx.db
        .query('likes')
        .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
        .filter((q) => q.eq(q.field('action'), 'like'))
        .collect(),
      // Reports I created (viewer-specific hard exclusion)
      ctx.db
        .query('reports')
        .withIndex('by_reporter', (q) => q.eq('reporterId', userId))
        .collect(),
      // All reports (for aggregate trust penalty - limited query)
      ctx.db
        .query('reports')
        .take(1000),
      // All blocks (for aggregate trust penalty - limited query)
      ctx.db
        .query('blocks')
        .take(2000),
      // CONVERSATION PARTNER EXCLUSION: All my conversation participations
      // Users with existing message threads must not reappear in Discover
      ctx.db
        .query('conversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    ]);

    // Build Sets for O(1) lookups
    const swipedUserIds = new Set<string>();
    for (const swipe of mySwipes) {
      // Skip expired passes (can re-show after 7 days)
      if (swipe.action === 'pass' && swipe.createdAt < passExpiry) continue;
      swipedUserIds.add(swipe.toUserId as string);
    }

    const matchedUserIds = new Set<string>();
    for (const m of matchesAsUser1) matchedUserIds.add(m.user2Id as string);
    for (const m of matchesAsUser2) matchedUserIds.add(m.user1Id as string);

    const blockedUserIds = new Set<string>();
    for (const b of blocksICreated) blockedUserIds.add(b.blockedUserId as string);
    for (const b of blocksAgainstMe) blockedUserIds.add(b.blockerId as string);

    const usersWhoLikedMe = new Set<string>();
    for (const like of likesToMe) usersWhoLikedMe.add(like.fromUserId as string);

    // TRUST SIGNALS: Viewer-specific reports (hard exclusion)
    const viewerReportedIds = new Set<string>();
    for (const report of myReports) viewerReportedIds.add(report.reportedUserId as string);

    // CONVERSATION PARTNER EXCLUSION: Build set of users with existing message threads
    // This ensures users who already have a chat connection don't reappear in Discover
    const conversationPartnerIds = new Set<string>();
    if (myConversationParticipations.length > 0) {
      // Batch fetch all conversations for efficiency
      const conversations = await Promise.all(
        myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
      );
      for (const conv of conversations) {
        if (!conv) continue;
        // Extract partner IDs from participants array (excluding self)
        for (const participantId of conv.participants) {
          if (participantId !== userId) {
            conversationPartnerIds.add(participantId as string);
          }
        }
      }
    }

    // TRUST SIGNALS: Aggregate report counts per user (soft penalty)
    const aggregateReportCounts = new Map<string, number>();
    for (const report of allReports) {
      const targetId = report.reportedUserId as string;
      aggregateReportCounts.set(targetId, (aggregateReportCounts.get(targetId) || 0) + 1);
    }

    // TRUST SIGNALS: Aggregate block counts per user (soft penalty)
    const aggregateBlockCounts = new Map<string, number>();
    for (const block of allBlocks) {
      const targetId = block.blockedUserId as string;
      aggregateBlockCounts.set(targetId, (aggregateBlockCounts.get(targetId) || 0) + 1);
    }

    // PERF #8: Use take() with buffer to avoid loading entire user table
    // Fetch more than needed since many will be filtered out
    const fetchLimit = (offset + limit) * 10; // 10x buffer for filtering
    const allUsers = await ctx.db.query('users').take(fetchLimit);

    // First pass: filter candidates without photo queries
    const filteredCandidates: { user: typeof allUsers[number]; distance?: number }[] = [];

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;

      // NOTE: Verification is NOT a hard filter - it's a ranking boost
      // Unverified users appear lower in ranking, not excluded

      // Incognito check
      if (user.incognitoMode) {
        const canSee = currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';
        if (!canSee) continue;
      }

      // Gender preference match (both ways)
      if (!currentUser.lookingFor.includes(user.gender)) continue;
      if (!user.lookingFor.includes(currentUser.gender)) continue;

      // Age range
      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;
      const myAge = calculateAge(currentUser.dateOfBirth);
      if (myAge < user.minAge || myAge > user.maxAge) continue;

      // Distance
      let distance: number | undefined;
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        distance = calculateDistance(
          currentUser.latitude, currentUser.longitude,
          user.latitude, user.longitude,
        );
        if (!isDistanceAllowed(distance, currentUser.maxDistance)) continue;
      }

      // PERF #8: O(1) Set lookups instead of database queries
      if (swipedUserIds.has(user._id as string)) continue;
      if (matchedUserIds.has(user._id as string)) continue;
      if (blockedUserIds.has(user._id as string)) continue;
      // TRUST: Viewer-specific report exclusion (hard filter)
      if (viewerReportedIds.has(user._id as string)) continue;
      // CONVERSATION PARTNER EXCLUSION: Users with existing chat threads must not reappear
      if (conversationPartnerIds.has(user._id as string)) continue;

      // Enforcement
      if (user.verificationEnforcementLevel === 'security_only') continue;
      if (user.verificationEnforcementLevel === 'reduced_reach' && Math.random() > 0.5) continue;

      filteredCandidates.push({ user, distance });
    }

    // PERF #8: Only fetch photos for candidates that passed all filters
    // Batch fetch photos in parallel
    const photoResults = await Promise.all(
      filteredCandidates.map(({ user }) =>
        ctx.db
          .query('photos')
          .withIndex('by_user_order', (q) => q.eq('userId', user._id))
          .collect()
      )
    );

    // Build final candidates with photos
    const candidates = [];
    for (let i = 0; i < filteredCandidates.length; i++) {
      const { user, distance } = filteredCandidates[i];
      const photos = photoResults[i];

      const nonNsfwPhotos = photos.filter((p) => !p.isNsfw);
      if (nonNsfwPhotos.length === 0) continue; // at least 1 photo required

      const userAge = calculateAge(user.dateOfBirth);
      const theyLikedMe = usersWhoLikedMe.has(user._id as string);

      candidates.push({
        id: user._id,
        name: user.name,
        age: userAge,
        gender: user.gender,
        bio: user.bio,
        height: user.height,
        smoking: user.smoking,
        drinking: user.drinking,
        kids: user.kids,
        education: user.education,
        religion: user.religion,
        jobTitle: user.jobTitle,
        company: user.company,
        school: user.school,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus || 'unverified',
        city: user.city,
        distance,
        lastActive: user.lastActive,
        createdAt: user.createdAt,
        lookingFor: user.lookingFor,
        relationshipIntent: normalizeRelationshipIntentValues(user.relationshipIntent),
        activities: user.activities,
        profilePrompts: user.profilePrompts,
        photos: photos.sort((a, b) => a.order - b.order),
        photoBlurred: user.photoBlurred === true,
        isBoosted: !!(user.boostedUntil && user.boostedUntil > Date.now()),
        theyLikedMe,
        photoCount: nonNsfwPhotos.length,
        isIncognito: user.incognitoMode === true,
      });
    }

    // Sort
    if (sortBy === 'recommended') {
      // Phase 3: Shadow mode decision (once per request)
      const runShadow = shouldRunShadowComparison();

      // NEW RANKING: Use Phase-1 Discover ranking system
      const trustSignals: TrustSignals = {
        viewerBlockedIds: blockedUserIds,
        viewerReportedIds,
        aggregateReportCounts,
        aggregateBlockCounts,
      };

      // Build CurrentUser object for ranking
      const rankingCurrentUser: CurrentUser = {
        _id: currentUser._id as string,
        city: currentUser.city,
        activities: currentUser.activities,
        relationshipIntent: normalizeRelationshipIntentValues(currentUser.relationshipIntent),
        lookingFor: currentUser.lookingFor,
        minAge: currentUser.minAge,
        maxAge: currentUser.maxAge,
        maxDistance: currentUser.maxDistance,
        smoking: currentUser.smoking,
        drinking: currentUser.drinking,
        religion: currentUser.religion,
        kids: currentUser.kids,
        // Life rhythm from onboarding draft (if available)
        lifeRhythm: currentUser.onboardingDraft?.lifeRhythm,
        // Seed questions from onboarding draft (if available)
        seedQuestions: currentUser.onboardingDraft?.profileDetails?.seedQuestions,
      };

      // Map candidates to CandidateProfile format
      const candidateProfiles: CandidateProfile[] = candidates.map(c => ({
        id: c.id as string,
        name: c.name,
        age: c.age,
        gender: c.gender,
        bio: c.bio,
        city: c.city,
        distance: c.distance,
        lastActive: c.lastActive,
        createdAt: c.createdAt,
        isVerified: c.isVerified,
        lookingFor: c.lookingFor,
        relationshipIntent: c.relationshipIntent,
        activities: c.activities,
        profilePrompts: c.profilePrompts,
        height: c.height,
        jobTitle: c.jobTitle,
        education: c.education,
        smoking: c.smoking,
        drinking: c.drinking,
        religion: c.religion,
        kids: c.kids,
        photoCount: c.photoCount,
        theyLikedMe: c.theyLikedMe,
        isBoosted: c.isBoosted,
      }));

      // Apply new ranking with exploration mix
      const { rankedCandidates, exhausted } = rankDiscoverCandidates(
        candidateProfiles,
        rankingCurrentUser,
        trustSignals,
        limit,
        false // useFallback flag - fallback logic handled below
      );

      // Map back to original candidate format (preserve photos, etc.)
      const rankedIds = new Set(rankedCandidates.map(c => c.id));
      const rankedMap = new Map(rankedCandidates.map((c, i) => [c.id, i]));
      let result = candidates
        .filter(c => rankedIds.has(c.id as string))
        .sort((a, b) => (rankedMap.get(a.id as string) || 0) - (rankedMap.get(b.id as string) || 0));

      // P1 FIX: Fallback mechanism when primary pool is exhausted
      // If we have fewer results than requested, activate fallback pool
      // Fallback candidates must have 2+ compatibility signals
      if (exhausted && result.length < limit) {
        const needed = limit - result.length;
        const usedIds = new Set(result.map(r => r.id as string));

        // Find candidates not already in result that qualify for fallback
        const fallbackCandidates = candidateProfiles
          .filter(c => !usedIds.has(c.id) && qualifiesForFallback(c, rankingCurrentUser))
          .slice(0, needed);

        // Map fallback candidates back to original format
        const fallbackIds = new Set(fallbackCandidates.map(c => c.id));
        const fallbackResults = candidates.filter(c => fallbackIds.has(c.id as string));

        // Append fallback results (they appear after ranked results)
        result = [...result, ...fallbackResults];
      }

      // Phase 3: Shadow mode rank comparison (no production impact)
      // Legacy result is finalized above - this only logs for analysis
      if (runShadow) {
        try {
          // Build normalized viewer inline (avoids adapter type mismatch)
          const normalizedViewer: import('./ranking/rankingTypes').NormalizedViewer = {
            id: currentUser._id as string,
            phase: 'phase1',
            relationshipIntent: rankingCurrentUser.relationshipIntent ?? [],
            activities: rankingCurrentUser.activities ?? [],
            lifestyle: {
              smoking: rankingCurrentUser.smoking,
              drinking: rankingCurrentUser.drinking,
              kids: rankingCurrentUser.kids,
              religion: rankingCurrentUser.religion,
            },
            maxDistance: rankingCurrentUser.maxDistance,
            lifeRhythm: rankingCurrentUser.lifeRhythm,
            seedQuestions: rankingCurrentUser.seedQuestions,
            blockedIds: blockedUserIds,
            reportedIds: viewerReportedIds,
          };

          // Build normalized candidates inline from candidateProfiles
          const normalizedCandidates: import('./ranking/rankingTypes').NormalizedCandidate[] = candidateProfiles.map(c => ({
            id: c.id,
            phase: 'phase1' as const,
            relationshipIntent: c.relationshipIntent ?? [],
            activities: c.activities ?? [],
            lifestyle: {
              smoking: c.smoking,
              drinking: c.drinking,
              kids: c.kids,
              religion: c.religion,
            },
            bioLength: c.bio?.trim().length ?? 0,
            promptsAnswered: (c.profilePrompts ?? []).filter(p => p.answer?.trim().length > 0).length,
            photoCount: c.photoCount,
            isVerified: c.isVerified,
            hasOptionalFields: {
              height: !!c.height,
              jobTitle: !!c.jobTitle,
              education: !!c.education,
            },
            lastActiveAt: c.lastActive,
            onboardedAt: c.createdAt,
            createdAt: c.createdAt,
            distance: c.distance,
            theyLikedMe: c.theyLikedMe,
            isBoosted: c.isBoosted,
            lifeRhythm: c.lifeRhythm,
            seedQuestions: c.seedQuestions,
            reportCount: c.reportCount ?? 0,
            blockCount: c.blockCount ?? 0,
            totalImpressions: 0,
            lastShownAt: 0,
          }));

          // Run shared ranking engine
          const sharedResult = sharedRankCandidates(normalizedCandidates, normalizedViewer, undefined, { limit });

          // Build rank lookup for shared results
          const sharedRankMap = new Map<string, number>();
          sharedResult.rankedCandidates.forEach((c, i) => sharedRankMap.set(c.id, i));

          // Build comparisons for returned window only (capped)
          // Using [candidateId, legacyRank, sharedRank] for rank-diff analysis
          // logBatchRankingComparison computes |sharedRank - legacyRank| as diff
          const finalResult = result.slice(offset, offset + limit);
          const comparisons: Array<[string, number, number]> = [];
          for (let i = 0; i < finalResult.length; i++) {
            const candidateId = finalResult[i].id as string;
            const sharedRank = sharedRankMap.get(candidateId) ?? -1;
            comparisons.push([candidateId, i, sharedRank]);
          }

          logBatchRankingComparison(currentUser._id as string, comparisons, 'phase1');
        } catch {
          // Silent fail - shadow mode must never break production
        }
      }

      return result.slice(offset, offset + limit);
    } else {
      candidates.sort((a, b) => {
        // Boosted first
        if (a.isBoosted && !b.isBoosted) return -1;
        if (!a.isBoosted && b.isBoosted) return 1;

        switch (sortBy) {
          case 'distance':       return (a.distance || 999) - (b.distance || 999);
          case 'age':            return a.age - b.age;
          case 'recently_active': return b.lastActive - a.lastActive;
          case 'newest':         return b.createdAt - a.createdAt;
          default:               return 0;
        }
      });
    }

    return candidates.slice(offset, offset + limit);
  },
});

// ---------------------------------------------------------------------------
// getExploreCategoryProfiles — filtered category view
// ---------------------------------------------------------------------------

const EXTRA_EXPLORE_CATEGORY_IDS = [
  'online_now',
  'active_today',
  'free_tonight',
  'coffee_date',
  'nature_lovers',
  'binge_watchers',
  'travel',
  'gaming',
  'fitness',
  'music',
] as const;

const EXPLORE_CATEGORY_IDS = [
  ...FRONTEND_EXPLORE_CATEGORY_IDS,
  ...EXTRA_EXPLORE_CATEGORY_IDS,
] as const;

type ExploreCategoryId = (typeof EXPLORE_CATEGORY_IDS)[number];

type ExploreCandidateBase = {
  id: Id<'users'>;
  name: string;
  age?: number;
  ageHidden: boolean;
  gender: string;
  bio: string;
  isVerified: boolean;
  verificationStatus: string;
  city?: string;
  distance?: number;
  distanceHidden: boolean;
  lastActive?: number;
  isActiveNow: boolean;
  wasActiveToday: boolean;
  lookingFor: string[];
  relationshipIntent: string[];
  activities: string[];
  profilePrompts?: { question: string; answer: string }[];
  photoBlurred: boolean;
  isIncognito: boolean;
  createdAt: number;
  rankingLastActive: number;
  rankingScore: number;
  sourceUserId: Id<'users'>;
  primaryPhotoUrl?: string;
  displayPrimaryPhotoUrl?: string;
};

type ExploreProfileResult = Omit<ExploreCandidateBase, 'rankingScore' | 'rankingLastActive' | 'sourceUserId' | 'primaryPhotoUrl' | 'displayPrimaryPhotoUrl'> & {
  photos: { url: string }[];
};

function isExploreCategoryId(value: string | undefined): value is ExploreCategoryId {
  return typeof value === 'string' && (EXPLORE_CATEGORY_IDS as readonly string[]).includes(value);
}

function normalizePublicExploreCategoryId(value: string | undefined): ExploreCategoryId | undefined {
  const normalizedFrontendId = normalizeExploreCategoryId(value);
  if (normalizedFrontendId) {
    return normalizedFrontendId;
  }

  if (
    typeof value === 'string' &&
    (EXTRA_EXPLORE_CATEGORY_IDS as readonly string[]).includes(value)
  ) {
    return value as ExploreCategoryId;
  }

  return undefined;
}

function candidateMatchesAnyIntent(candidate: { relationshipIntent: string[] }, targets: string[]): boolean {
  const normalizedCandidateIntents = normalizeRelationshipIntentValues(candidate.relationshipIntent);
  return targets.some((intent) => normalizedCandidateIntents.includes(intent as any));
}

function candidateMatchesAnyActivity(candidate: { activities: string[] }, targets: string[]): boolean {
  return targets.some((activity) => candidate.activities.includes(activity));
}

function isNearMeCandidate(candidate: { distance?: number }): boolean {
  return typeof candidate.distance === 'number' && candidate.distance <= 5;
}

function isOnlineNowCandidate(candidate: { isActiveNow: boolean }): boolean {
  return candidate.isActiveNow === true;
}

function isActiveTodayCandidate(candidate: { wasActiveToday: boolean }): boolean {
  return candidate.wasActiveToday === true;
}

function matchesExploreCategory(candidate: ExploreCandidateBase, categoryId: ExploreCategoryId): boolean {
  switch (categoryId) {
    case 'serious_vibes':
      return candidateMatchesAnyIntent(candidate, ['serious_vibes']);
    case 'keep_it_casual':
      return candidateMatchesAnyIntent(candidate, ['keep_it_casual']);
    case 'exploring_vibes':
      return candidateMatchesAnyIntent(candidate, ['exploring_vibes']);
    case 'see_where_it_goes':
      return candidateMatchesAnyIntent(candidate, ['see_where_it_goes']);
    case 'open_to_vibes':
      return candidateMatchesAnyIntent(candidate, ['open_to_vibes']);
    case 'just_friends':
      return candidateMatchesAnyIntent(candidate, ['just_friends']);
    case 'open_to_anything':
      return candidateMatchesAnyIntent(candidate, ['open_to_anything']);
    case 'single_parent':
      return candidateMatchesAnyIntent(candidate, ['single_parent']);
    case 'new_to_dating':
      return candidateMatchesAnyIntent(candidate, ['new_to_dating']);
    case 'nearby':
      return isNearMeCandidate(candidate);
    case 'online_now':
      return isOnlineNowCandidate(candidate);
    case 'active_today':
      return isActiveTodayCandidate(candidate);
    case 'free_tonight':
      return candidate.activities.includes('free_tonight');
    case 'coffee_date':
      return candidateMatchesAnyActivity(candidate, ['coffee']);
    case 'nature_lovers':
      return candidateMatchesAnyActivity(candidate, ['outdoors']);
    case 'binge_watchers':
      return candidateMatchesAnyActivity(candidate, ['movies']);
    case 'travel':
      return candidateMatchesAnyActivity(candidate, ['travel']);
    case 'gaming':
      return candidateMatchesAnyActivity(candidate, ['gaming']);
    case 'fitness':
      return candidateMatchesAnyActivity(candidate, ['gym_partner', 'gym']);
    case 'music':
      return candidateMatchesAnyActivity(candidate, ['concerts', 'music_lover']);
    default:
      return false;
  }
}

function createEmptyExploreCounts(): Record<string, number> {
  return Object.fromEntries(EXPLORE_CATEGORY_IDS.map((id) => [id, 0]));
}

function countExploreCategories(candidates: ExploreCandidateBase[]): Record<string, number> {
  const counts = createEmptyExploreCounts();
  for (const candidate of candidates) {
    for (const categoryId of EXPLORE_CATEGORY_IDS) {
      if (matchesExploreCategory(candidate, categoryId)) {
        counts[categoryId] += 1;
      }
    }
  }
  return counts;
}

async function resolveExploreViewer(
  ctx: QueryCtx,
  rawUserId: string | Id<'users'>
) {
  const userId = await resolveUserIdByAuthId(ctx, rawUserId as string);
  if (!userId) return null;
  const currentUser = await ctx.db.get(userId);
  if (!currentUser || !currentUser.isActive || currentUser.isBanned || isUserPaused(currentUser)) return null;
  return { userId, currentUser };
}

async function loadExploreExclusions(
  ctx: QueryCtx,
  userId: Id<'users'>
) {
  const now = Date.now();
  const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

  const [
    mySwipes,
    matchesAsUser1,
    matchesAsUser2,
    blocksICreated,
    blocksAgainstMe,
    myReports,
    myConversationParticipations,
  ] = await Promise.all([
    ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
      .collect(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
      .collect(),
    ctx.db
      .query('reports')
      .withIndex('by_reporter', (q) => q.eq('reporterId', userId))
      .collect(),
    ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect(),
  ]);

  const swipedUserIds = new Set<string>();
  for (const swipe of mySwipes) {
    if (swipe.action === 'pass' && swipe.createdAt < passExpiry) continue;
    swipedUserIds.add(swipe.toUserId as string);
  }

  const matchedUserIds = new Set<string>();
  for (const match of matchesAsUser1) matchedUserIds.add(match.user2Id as string);
  for (const match of matchesAsUser2) matchedUserIds.add(match.user1Id as string);

  const blockedUserIds = new Set<string>();
  for (const block of blocksICreated) blockedUserIds.add(block.blockedUserId as string);
  for (const block of blocksAgainstMe) blockedUserIds.add(block.blockerId as string);

  const viewerReportedIds = new Set<string>();
  for (const report of myReports) viewerReportedIds.add(report.reportedUserId as string);

  const conversationPartnerIds = new Set<string>();
  if (myConversationParticipations.length > 0) {
    const conversations = await Promise.all(
      myConversationParticipations.map((participation) => ctx.db.get(participation.conversationId))
    );
    for (const conversation of conversations) {
      if (!conversation) continue;
      for (const participantId of conversation.participants) {
        if (participantId !== userId) {
          conversationPartnerIds.add(participantId as string);
        }
      }
    }
  }

  return {
    swipedUserIds,
    matchedUserIds,
    blockedUserIds,
    viewerReportedIds,
    conversationPartnerIds,
  };
}

function getCandidateDistance(
  currentUser: { latitude?: number; longitude?: number },
  candidateUser: { publishedLat?: number; publishedLng?: number; latitude?: number; longitude?: number }
): number | undefined {
  if (typeof currentUser.latitude !== 'number' || typeof currentUser.longitude !== 'number') {
    return undefined;
  }

  const candidateLat = candidateUser.publishedLat ?? candidateUser.latitude;
  const candidateLng = candidateUser.publishedLng ?? candidateUser.longitude;
  if (typeof candidateLat !== 'number' || typeof candidateLng !== 'number') {
    return undefined;
  }

  return calculateDistance(
    currentUser.latitude,
    currentUser.longitude,
    candidateLat,
    candidateLng,
  );
}

function buildExploreRankingScore(
  candidateUser: {
    _id: Id<'users'>;
    lastActive?: number;
    bio: string;
    profilePrompts?: { question: string; answer: string }[];
    activities: string[];
    isVerified: boolean;
    height?: number;
    jobTitle?: string;
    education?: string;
    city?: string;
    relationshipIntent: string[];
    profileQualityScore?: number;
    verificationEnforcementLevel?: string;
  },
  currentUser: {
    _id: Id<'users'>;
    city?: string;
    activities: string[];
    relationshipIntent: string[];
  },
  primaryPhotoCount: number
): number {
  const lastActive = typeof candidateUser.lastActive === 'number' ? candidateUser.lastActive : 0;
  const completeness =
    typeof candidateUser.profileQualityScore === 'number'
      ? Math.max(0, Math.min(candidateUser.profileQualityScore, 100))
      : completenessScore(candidateUser, primaryPhotoCount);

  let score =
    0.45 * activityScore(lastActive) +
    0.35 * completeness +
    0.15 * preferenceMatchScore(candidateUser, currentUser) +
    0.05 * rotationScore(currentUser._id as string, candidateUser._id as string);

  if (candidateUser.verificationEnforcementLevel === 'reduced_reach') {
    score -= 15;
  }

  return score;
}

async function buildExploreCandidates(
  ctx: QueryCtx,
  args: {
    rawUserId: string | Id<'users'>;
    genderFilter?: string[];
    minAge?: number;
    maxAge?: number;
    maxDistance?: number;
    relationshipIntent?: string[];
    activities?: string[];
    categoryId?: string;
    maxPerGender: number;
  }
): Promise<{ status: 'ready' | 'viewer_not_found'; currentUser: any | null; candidates: ExploreCandidateBase[] }> {
  const resolvedViewer = await resolveExploreViewer(ctx, args.rawUserId);
  if (!resolvedViewer) {
    return { status: 'viewer_not_found', currentUser: null, candidates: [] };
  }

  const { userId, currentUser } = resolvedViewer;
  const exclusions = await loadExploreExclusions(ctx, userId);

  const effectiveGender = Array.from(
    new Set((args.genderFilter && args.genderFilter.length > 0 ? args.genderFilter : currentUser.lookingFor ?? []).filter(Boolean))
  );
  if (effectiveGender.length === 0) {
    return { status: 'ready', currentUser, candidates: [] };
  }

  const effectiveMinAge = args.minAge ?? currentUser.minAge;
  const effectiveMaxAge = args.maxAge ?? currentUser.maxAge;
  const effectiveMaxDistance = args.maxDistance ?? currentUser.maxDistance;
  const normalizedRelationshipIntentFilter = normalizeRelationshipIntentValues(args.relationshipIntent);
  const viewerAge = calculateAge(currentUser.dateOfBirth);
  const activeCategoryId = normalizePublicExploreCategoryId(args.categoryId);

  const userBuckets = await Promise.all(
    effectiveGender.map((gender) =>
      ctx.db
        .query('users')
        .withIndex('by_gender', (q) => q.eq('gender', gender as any))
        .take(args.maxPerGender)
    )
  );

  const seenUserIds = new Set<string>();
  const candidates: ExploreCandidateBase[] = [];

  for (const bucket of userBuckets) {
    for (const user of bucket) {
      const candidateId = user._id as string;
      if (seenUserIds.has(candidateId)) continue;
      seenUserIds.add(candidateId);

      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;
      if (user.verificationEnforcementLevel === 'security_only') continue;
      if (exclusions.swipedUserIds.has(candidateId)) continue;
      if (exclusions.matchedUserIds.has(candidateId)) continue;
      if (exclusions.blockedUserIds.has(candidateId)) continue;
      if (exclusions.viewerReportedIds.has(candidateId)) continue;
      if (exclusions.conversationPartnerIds.has(candidateId)) continue;

      if (user.incognitoMode) {
        const canSeeIncognito = currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';
        if (!canSeeIncognito) continue;
      }

      const candidateLookingFor = Array.isArray(user.lookingFor) ? user.lookingFor : [];
      const candidateRelationshipIntent = Array.isArray(user.relationshipIntent) ? (user.relationshipIntent as string[]) : [];
      const candidateActivities = Array.isArray(user.activities) ? (user.activities as string[]) : [];
      const normalizedCandidateRelationshipIntent = normalizeRelationshipIntentValues(candidateRelationshipIntent);

      if (!candidateLookingFor.includes(currentUser.gender)) continue;

      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < effectiveMinAge || userAge > effectiveMaxAge) continue;
      if (viewerAge > 0 && (viewerAge < user.minAge || viewerAge > user.maxAge)) continue;

      const rawDistance = getCandidateDistance(currentUser, user);
      if (!isDistanceAllowed(rawDistance, effectiveMaxDistance)) continue;

      if (normalizedRelationshipIntentFilter.length > 0) {
        if (!normalizedRelationshipIntentFilter.some((intent) => normalizedCandidateRelationshipIntent.includes(intent))) continue;
      }

      if (args.activities && args.activities.length > 0) {
        if (!args.activities.some((activity) => candidateActivities.includes(activity))) continue;
      }

      const hasPublicPrimaryPhoto = !!(user.primaryPhotoUrl || user.displayPrimaryPhotoUrl);
      if (!hasPublicPrimaryPhoto) continue;

      const visibleDistance = user.hideDistance === true ? undefined : rawDistance;
      const visibleLastActive = user.showLastSeen === false ? undefined : user.lastActive;

      const candidate: ExploreCandidateBase = {
        id: user._id,
        name: user.name,
        age: user.hideAge === true ? undefined : userAge,
        ageHidden: user.hideAge === true,
        gender: user.gender,
        bio: user.bio,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus || 'unverified',
        city: user.city,
        distance: visibleDistance,
        distanceHidden: user.hideDistance === true,
        lastActive: visibleLastActive,
        isActiveNow: typeof visibleLastActive === 'number' && Date.now() - visibleLastActive <= 10 * 60 * 1000,
        wasActiveToday: typeof visibleLastActive === 'number' && Date.now() - visibleLastActive <= 24 * 60 * 60 * 1000,
        lookingFor: candidateLookingFor,
        relationshipIntent: normalizedCandidateRelationshipIntent,
        activities: candidateActivities,
        profilePrompts: user.profilePrompts,
        photoBlurred: user.photoBlurred === true,
        isIncognito: user.incognitoMode === true,
        createdAt: user.createdAt ?? user._creationTime,
        rankingLastActive: user.lastActive ?? 0,
        rankingScore: buildExploreRankingScore(user, currentUser, 1),
        sourceUserId: user._id,
        primaryPhotoUrl: user.primaryPhotoUrl,
        displayPrimaryPhotoUrl: user.displayPrimaryPhotoUrl,
      };

      if (activeCategoryId && !matchesExploreCategory(candidate, activeCategoryId)) continue;
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => {
    if (activeCategoryId === 'nearby') {
      return (a.distance ?? 999) - (b.distance ?? 999);
    }
    if (activeCategoryId === 'online_now' || activeCategoryId === 'active_today') {
      return b.rankingLastActive - a.rankingLastActive;
    }
    return b.rankingScore - a.rankingScore;
  });

  return { status: 'ready', currentUser, candidates };
}

async function hydrateExploreProfiles(
  ctx: QueryCtx,
  candidates: ExploreCandidateBase[]
): Promise<ExploreProfileResult[]> {
  const results: ExploreProfileResult[] = [];
  const CHUNK_SIZE = 12;

  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE);
    const chunkPhotos = await Promise.all(
      chunk.map((candidate) =>
        ctx.db
          .query('photos')
          .withIndex('by_user_order', (q) => q.eq('userId', candidate.sourceUserId))
          .collect()
      )
    );

    for (let index = 0; index < chunk.length; index += 1) {
      const candidate = chunk[index];
      const publicPhotos = chunkPhotos[index]
        .filter((photo) => !photo.isNsfw && photo.photoType !== 'verification_reference')
        .sort((a, b) => a.order - b.order)
        .map((photo) => ({ url: photo.url }));

      if (publicPhotos.length === 0) {
        const fallbackUrl = candidate.primaryPhotoUrl || candidate.displayPrimaryPhotoUrl;
        if (!fallbackUrl) continue;
        publicPhotos.push({ url: fallbackUrl });
      }

      const { rankingScore, rankingLastActive, sourceUserId, primaryPhotoUrl, displayPrimaryPhotoUrl, ...safeCandidate } = candidate;
      results.push({
        ...safeCandidate,
        photos: publicPhotos,
      });
    }
  }

  return results;
}

export const getExploreCategoryProfiles = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
    genderFilter: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other')))),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
    relationshipIntent: v.optional(v.array(v.union(
      v.literal('serious_vibes'), v.literal('keep_it_casual'), v.literal('exploring_vibes'),
      v.literal('see_where_it_goes'), v.literal('open_to_vibes'), v.literal('just_friends'),
      v.literal('open_to_anything'), v.literal('single_parent'), v.literal('new_to_dating'),
    ))),
    activities: v.optional(v.array(v.union(
      v.literal('coffee'), v.literal('date_night'), v.literal('sports'),
      v.literal('movies'), v.literal('free_tonight'), v.literal('foodie'),
      v.literal('gym_partner'), v.literal('concerts'), v.literal('travel'),
      v.literal('outdoors'), v.literal('art_culture'), v.literal('gaming'),
      v.literal('nightlife'), v.literal('brunch'), v.literal('study_date'),
      v.literal('this_weekend'), v.literal('beach_pool'), v.literal('road_trip'),
      v.literal('photography'), v.literal('volunteering'),
    ))),
    sortByInterests: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    categoryId: v.optional(v.string()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      userId, genderFilter, minAge, maxAge, maxDistance,
      relationshipIntent, activities, sortByInterests,
      limit = 20, offset = 0,
      categoryId,
    } = args;

    const baseWindow = Math.max(offset + limit, 24);
    const fetchMultiplier = categoryId ? 30 : ((relationshipIntent && relationshipIntent.length > 0) || (activities && activities.length > 0) || sortByInterests ? 24 : 16);
    const maxPerGender = Math.max(Math.ceil((baseWindow * fetchMultiplier) / Math.max((genderFilter?.length ?? 0) || 1, 1)), 140);

    const built = await buildExploreCandidates(ctx, {
      rawUserId: userId,
      genderFilter,
      minAge,
      maxAge,
      maxDistance,
      relationshipIntent,
      activities,
      categoryId,
      maxPerGender,
    });

    if (built.status !== 'ready') {
      return {
        profiles: [],
        totalCount: 0,
        status: built.status === 'viewer_not_found' ? 'viewer_missing' : built.status,
      };
    }

    const rankedCandidates = [...built.candidates];
    if (sortByInterests && built.currentUser.activities.length > 0) {
      rankedCandidates.sort((a, b) => {
        const sharedA = a.activities.filter((activity) => built.currentUser.activities.includes(activity)).length;
        const sharedB = b.activities.filter((activity) => built.currentUser.activities.includes(activity)).length;
        if (sharedA !== sharedB) return sharedB - sharedA;
        return b.rankingScore - a.rankingScore;
      });
    }

    const pageWindow = rankedCandidates.slice(offset, offset + limit * 3);
    const hydratedProfiles = await hydrateExploreProfiles(ctx, pageWindow);

    return {
      profiles: hydratedProfiles.slice(0, limit),
      totalCount: rankedCandidates.length,
      status: 'ok' as const,
    };
  },
});

// ---------------------------------------------------------------------------
// getExploreCategoryCounts — badge numbers for explore grid
// ---------------------------------------------------------------------------

export const getExploreCategoryCounts = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const built = await buildExploreCandidates(ctx, {
      rawUserId: args.userId,
      maxPerGender: 2500,
    });

    if (built.status !== 'ready') {
      return {
        counts: createEmptyExploreCounts(),
        totalCount: 0,
        status: built.status === 'viewer_not_found' ? 'viewer_missing' : built.status,
        nearbyStatus: 'ok' as const,
      };
    }

    return {
      counts: countExploreCategories(built.candidates),
      totalCount: built.candidates.length,
      status: 'ok' as const,
      nearbyStatus: 'ok' as const,
    };
  },
});
