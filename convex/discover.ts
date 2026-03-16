import { v } from 'convex/values';
import { query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId } from './helpers';
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

  // Same city? (0–30)
  if (candidate.city && currentUser.city && candidate.city === currentUser.city) {
    score += 30;
  }

  // Common interests (0–40) — 10 pts each, cap at 40
  const shared = candidate.activities.filter((a) => currentUser.activities.includes(a));
  score += Math.min(shared.length * 10, 40);

  // Relationship intent alignment (0–30)
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
  for (const mine of currentUser.relationshipIntent) {
    for (const theirs of candidate.relationshipIntent) {
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
    const { sortBy = 'recommended', limit = 20, offset = 0 } = args;
    // filterVersion intentionally unused — it's only to bust query cache

    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getDiscoverProfiles] User not found for authUserId:', args.userId);
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
        relationshipIntent: user.relationshipIntent,
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
        relationshipIntent: currentUser.relationshipIntent,
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
// getExploreProfiles — filtered category view
// ---------------------------------------------------------------------------

export const getExploreProfiles = query({
  args: {
    userId: v.id('users'),
    genderFilter: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('other')))),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
    relationshipIntent: v.optional(v.array(v.union(
      v.literal('long_term'), v.literal('short_term'), v.literal('fwb'),
      v.literal('figuring_out'), v.literal('short_to_long'), v.literal('long_to_short'),
      v.literal('new_friends'), v.literal('open_to_anything'),
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
  },
  handler: async (ctx, args) => {
    const {
      userId, genderFilter, minAge, maxAge, maxDistance,
      relationshipIntent, activities, sortByInterests,
      limit = 20, offset = 0,
    } = args;

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return { profiles: [], totalCount: 0 };
    if (isUserPaused(currentUser)) return { profiles: [], totalCount: 0 };

    const effectiveGender = genderFilter || currentUser.lookingFor;
    const effectiveMinAge = minAge ?? currentUser.minAge;
    const effectiveMaxAge = maxAge ?? currentUser.maxAge;
    const effectiveMaxDistance = maxDistance ?? currentUser.maxDistance;

    // PERF FIX: Pre-fetch all swipes, matches, blocks upfront (converts O(4*N) queries to O(4))
    // Same efficient pattern as getDiscoverProfiles
    const now = Date.now();
    const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

    // P1/R3 FIX: Adaptive buffer sizing instead of full table scan
    // Base multiplier with adjustment for filter strictness
    const hasStrictFilters = (relationshipIntent && relationshipIntent.length > 0) ||
                              (activities && activities.length > 0);
    const bufferMultiplier = hasStrictFilters ? 20 : 10; // Higher buffer for stricter filters
    const fetchLimit = Math.max((offset + limit) * bufferMultiplier, 200); // Min 200 candidates

    const [
      allUsers,
      mySwipes,
      matchesAsUser1,
      matchesAsUser2,
      blocksICreated,
      blocksAgainstMe,
    ] = await Promise.all([
      // P0 FIX: Remove verification hard-filter - verification is a ranking boost, not exclusion
      // Use take() with buffer for efficiency without filtering by verification status
      ctx.db.query('users')
        .take(fetchLimit),
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
    ]);

    // Build Maps/Sets for O(1) lookups
    // Swiped users: exclude likes/superlikes, and recent passes (within 7 days)
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

    // STABILITY FIX: C-9 - Two-pass approach to eliminate N+1 photo queries
    // First pass: filter candidates, collect user objects with computed values
    type FilteredUser = { user: typeof allUsers[0]; userAge: number; distance: number | undefined };
    const filteredUsers: FilteredUser[] = [];

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;
      // P0 FIX: Verification is a ranking boost, not a hard filter - no verification check here

      if (!effectiveGender.includes(user.gender)) continue;

      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < effectiveMinAge || userAge > effectiveMaxAge) continue;

      let distance: number | undefined;
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        const dist = calculateDistance(
          currentUser.latitude, currentUser.longitude,
          user.latitude, user.longitude,
        );
        if (!isDistanceAllowed(dist, effectiveMaxDistance)) continue;
        distance = dist;
      }

      if (relationshipIntent && relationshipIntent.length > 0) {
        if (!relationshipIntent.some((i) => user.relationshipIntent.includes(i))) continue;
      }

      if (activities && activities.length > 0) {
        if (!activities.some((a) => user.activities.includes(a))) continue;
      }

      // PERF FIX: O(1) Set lookups instead of per-user database queries
      if (swipedUserIds.has(user._id as string)) continue;
      if (matchedUserIds.has(user._id as string)) continue;
      if (blockedUserIds.has(user._id as string)) continue;

      filteredUsers.push({ user, userAge, distance });
    }

    // STABILITY FIX: C-9 - Batch fetch photos with chunked concurrency (avoids N+1)
    const CHUNK_SIZE = 20;
    const photosByUser = new Map<string, any[]>();
    for (let i = 0; i < filteredUsers.length; i += CHUNK_SIZE) {
      const chunk = filteredUsers.slice(i, i + CHUNK_SIZE);
      const chunkPhotos = await Promise.all(
        chunk.map((f) =>
          ctx.db
            .query('photos')
            .withIndex('by_user_order', (q) => q.eq('userId', f.user._id))
            .collect()
        )
      );
      for (let j = 0; j < chunk.length; j++) {
        photosByUser.set(chunk[j].user._id as string, chunkPhotos[j]);
      }
    }

    // Second pass: build candidates with photos from the map
    const candidates = filteredUsers.map(({ user, userAge, distance }) => {
      const photos = photosByUser.get(user._id as string) ?? [];
      return {
        id: user._id,
        name: user.name,
        age: userAge,
        gender: user.gender,
        bio: user.bio,
        isVerified: user.isVerified,
        city: user.city,
        distance,
        lastActive: user.lastActive,
        lookingFor: user.lookingFor,
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        profilePrompts: user.profilePrompts,
        photos, // Already sorted by order via by_user_order index
        photoBlurred: user.photoBlurred === true,
        photoCount: photos.filter((p: any) => !p.isNsfw).length,
        isIncognito: user.incognitoMode === true,
      };
    });

    // Sort: interests sort uses shared activities, filtered categories use relevance,
    // default falls back to the simple 4-signal score.
    if (sortByInterests && currentUser.activities.length > 0) {
      candidates.sort((a, b) => {
        const shA = a.activities.filter((act) => currentUser.activities.includes(act)).length;
        const shB = b.activities.filter((act) => currentUser.activities.includes(act)).length;
        return shB - shA;
      });
    } else if ((relationshipIntent && relationshipIntent.length > 0) || (activities && activities.length > 0)) {
      candidates.sort((a, b) => {
        let sA = 0, sB = 0;
        if (relationshipIntent) {
          sA += relationshipIntent.filter((i) => a.relationshipIntent.includes(i)).length;
          sB += relationshipIntent.filter((i) => b.relationshipIntent.includes(i)).length;
        }
        if (activities) {
          sA += activities.filter((act) => a.activities.includes(act)).length;
          sB += activities.filter((act) => b.activities.includes(act)).length;
        }
        return sB - sA;
      });
    } else {
      // Default: rank by the same 4-signal formula
      candidates.sort((a, b) => {
        const scoreA = 0.45 * activityScore(a.lastActive) +
          0.35 * completenessScore(a, a.photoCount) +
          0.15 * preferenceMatchScore(a, currentUser) +
          0.05 * rotationScore(currentUser._id as string, a.id as string);
        const scoreB = 0.45 * activityScore(b.lastActive) +
          0.35 * completenessScore(b, b.photoCount) +
          0.15 * preferenceMatchScore(b, currentUser) +
          0.05 * rotationScore(currentUser._id as string, b.id as string);
        return scoreB - scoreA;
      });
    }

    return {
      profiles: candidates.slice(offset, offset + limit),
      totalCount: candidates.length,
    };
  },
});

// ---------------------------------------------------------------------------
// getFilterCounts — badge numbers for explore grid
// ---------------------------------------------------------------------------

export const getFilterCounts = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const { userId } = args;
    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return {};

    const intentCounts: Record<string, number> = {};
    const activityCounts: Record<string, number> = {};

    // P1-001 FIX: Use by_gender index with bounded reads instead of .collect()
    // Dedupe genders to avoid querying same bucket twice
    const genders = Array.from(new Set(currentUser.lookingFor ?? []));
    if (genders.length === 0) return { intentCounts, activityCounts };

    // Track seen users to avoid double-counting if user appears in multiple queries
    const seenUserIds = new Set<string>();
    const MAX_PER_GENDER = 2500;

    for (const gender of genders) {
      const users = await ctx.db
        .query('users')
        .withIndex('by_gender', (q) => q.eq('gender', gender))
        .take(MAX_PER_GENDER);

      for (const user of users) {
        if (String(user._id) === String(userId)) continue;
        if (seenUserIds.has(String(user._id))) continue;
        seenUserIds.add(String(user._id));

        if (!user.isActive || user.isBanned) continue;
        if (isUserPaused(user)) continue;

        // P0 FIX: Verification is a ranking boost, not a hard filter
        // Removed verification check - unverified users are included in counts

        const userAge = calculateAge(user.dateOfBirth);
        if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;

        for (const intent of user.relationshipIntent) {
          intentCounts[intent] = (intentCounts[intent] || 0) + 1;
        }
        for (const activity of user.activities) {
          activityCounts[activity] = (activityCounts[activity] || 0) + 1;
        }
      }
    }

    return { intentCounts, activityCounts };
  },
});
