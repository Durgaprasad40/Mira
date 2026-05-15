/**
 * 🔒 LOCKED: Phase-1 Discover (Production Ready)
 *
 * This feature has completed full audit and production hardening.
 * Do NOT modify without explicit approval.
 *
 * Locked scope includes:
 * - auth flow
 * - ranking logic
 * - pagination
 * - swipe behavior
 * - card rendering rules
 * - presence handling
 * - distance logic
 * - empty state logic
 *
 * If changes are required:
 * - open a new audit
 * - do not modify directly
 */
import { v } from 'convex/values';
import { mutation, query, QueryCtx } from './_generated/server';
import { Id, Doc } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { orderSafePhase1DisplayPhotos } from './phase1Media';
import {
  FRONTEND_EXPLORE_CATEGORY_IDS,
  FRONTEND_RELATIONSHIP_INTENT_IDS,
  normalizeExploreCategoryId,
  normalizeRelationshipIntentValues,
} from '../lib/discoveryNaming';
import { EXPLORE_NEARBY_RADIUS_KM } from '../lib/distanceRules';
import { isFreeTonightActive } from '../lib/freeTonight';
import { DEFAULT_MIN_AGE, normalizeDiscoveryPreferences } from '../lib/discoveryDefaults';
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
import type { Phase1DiscoverEmptyReason } from '../lib/phase1DiscoverQuery';

// P0 TEMPORARY: per-stage audit logging for one-way Discover visibility bug.
// Flip to `false` (or remove all gated logs) once reverse-visibility is
// validated on both test devices. See [DISCOVER_AUDIT] tags below.
const DISCOVER_AUDIT_ENABLED = false;

// ---------------------------------------------------------------------------
// Vibes / Explore Category candidate fan-out and impression-suppression caps.
// These constants bound the per-query candidate scan inside
// getExploreCategoryProfiles and govern the 4-hour repetition-suppression
// window applied to recently-shown profiles. Hard safety/privacy filters in
// buildExploreCandidates are unaffected by these values.
// ---------------------------------------------------------------------------

// Hard ceiling on per-gender candidate scan in getExploreCategoryProfiles.
// The existing maxPerGender heuristic (baseWindow * fetchMultiplier / genders)
// can grow with offset / category fetchMultiplier. We cap it via Math.min so
// query cost stays bounded and reviewable. 1500 matches the Phase-2
// MAX_PHASE2_CANDIDATES sibling cap used in privateDiscover.ts.
const MAX_EXPLORE_CANDIDATES = 1500;

// Vibes/Explore impression-suppression window. Recently-seen profiles in a
// given category are pushed to the back of the deck (never hard-excluded) so
// that re-entering a category or paginating does not immediately re-show the
// same faces. Mirrors Phase-2 SUPPRESSION_WINDOW_MS (4 hours).
const EXPLORE_SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

// Bound the 4-hour suppression lookup so a noisy category cannot force an
// unbounded read. The index still scopes by viewer/category/time first.
const MAX_EXPLORE_SUPPRESSION_READS = 500;

// Per-call bound on how many viewedUserIds the recordExploreImpression
// mutation will accept in a single batch. Keeps mutation cost predictable
// and matches the maximum page size the client typically requests.
const MAX_EXPLORE_IMPRESSION_BATCH = 100;

function isActiveDiscoverConversationPartner(
  conversation: Doc<'conversations'>,
  match: Doc<'matches'> | null,
  now: number
): boolean {
  if (conversation.confessionId && conversation.expiresAt && conversation.expiresAt <= now) {
    return false;
  }

  if (conversation.confessionId && !conversation.matchId) {
    return false;
  }

  if (!conversation.matchId) {
    // Non-match conversations such as room-originated chats or pending/pre-match flows
    // must not hide users from Phase-1 Discover. Active matches are handled separately.
    return false;
  }

  if (!match || match.isActive === false) {
    return false;
  }

  const participantIds = new Set(conversation.participants.map((id) => id as string));
  return participantIds.has(match.user1Id as string) && participantIds.has(match.user2Id as string);
}

// ---------------------------------------------------------------------------
// Phase-1 Discover: structured empty result (Step 8 — distinguish empty reasons)
// ---------------------------------------------------------------------------

function phase1DiscoverEmpty(reason: Phase1DiscoverEmptyReason): {
  profiles: [];
  phase1EmptyReason: Phase1DiscoverEmptyReason;
} {
  return { profiles: [], phase1EmptyReason: reason };
}

/** When the deck has zero candidates after filtering, classify using preference vs history barriers. */
function classifyPhase1EmptyDeck(
  prefFails: number,
  historyFails: number,
  filteredLen: number,
  candidatesLen: number,
): Phase1DiscoverEmptyReason {
  if (filteredLen > 0 && candidatesLen === 0) {
    return 'unknown_empty';
  }
  if (prefFails > 0 && historyFails === 0) return 'filters_no_match';
  if (historyFails > 0 && prefFails === 0) return 'no_more_profiles';
  if (prefFails > 0 && historyFails > 0) {
    return historyFails >= prefFails ? 'no_more_profiles' : 'filters_no_match';
  }
  return 'unknown_empty';
}

function emptyReasonWhenWindowEmpty(
  offset: number,
  fullRankedLength: number,
  prefFails: number,
  historyFails: number,
  filteredLen: number,
  candidatesLen: number,
): Phase1DiscoverEmptyReason {
  if (fullRankedLength > 0 && offset >= fullRankedLength) {
    return 'no_more_profiles';
  }
  if (offset > 0 && fullRankedLength === 0) {
    return classifyPhase1EmptyDeck(prefFails, historyFails, filteredLen, candidatesLen);
  }
  if (fullRankedLength === 0 && offset === 0) {
    return classifyPhase1EmptyDeck(prefFails, historyFails, filteredLen, candidatesLen);
  }
  return 'unknown_empty';
}

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

function orientationAllowsCandidateGender(args: {
  viewerGender: string | undefined;
  viewerOrientation: string | undefined;
  candidateGender: string | undefined;
}): boolean {
  const { viewerGender, viewerOrientation, candidateGender } = args;

  if (!viewerOrientation || viewerOrientation === 'prefer_not_to_say') return true;
  if (candidateGender !== 'male' && candidateGender !== 'female') return true;
  if (viewerGender !== 'male' && viewerGender !== 'female') return true;

  if (viewerOrientation === 'bisexual') {
    return candidateGender === 'male' || candidateGender === 'female';
  }

  if (viewerOrientation === 'straight') {
    return viewerGender === 'male' ? candidateGender === 'female' : candidateGender === 'male';
  }

  if (viewerOrientation === 'gay') {
    return candidateGender === viewerGender;
  }

  if (viewerOrientation === 'lesbian') {
    return viewerGender === 'female' && candidateGender === 'female';
  }

  return true;
}

function hashString32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isEffectivelyHiddenFromDiscover(user: {
  hideFromDiscover?: boolean;
  isDiscoveryPaused?: boolean;
  discoveryPausedUntil?: number;
}): boolean {
  return user.hideFromDiscover === true || isUserPaused(user);
}

// BUGFIX #21: Safe date parsing with NaN guard
function calculateAge(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return null;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Number.isFinite(age) && age >= 0 && age < 120 ? age : null;
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
 * Distance is a hard Discover/Explore gate: if it cannot be calculated,
 * fail closed so missing coordinates cannot create a global deck.
 */
function isDistanceAllowed(distance: number | undefined, maxDistanceKm: number): boolean {
  return typeof distance === 'number' && Number.isFinite(distance) && distance <= maxDistanceKm;
}

function hasUsableDistanceLocation<T extends { latitude?: number; longitude?: number }>(
  user: T
): user is T & { latitude: number; longitude: number } {
  return (
    typeof user.latitude === 'number' &&
    Number.isFinite(user.latitude) &&
    typeof user.longitude === 'number' &&
    Number.isFinite(user.longitude)
  );
}

function hasEligibleAdultAge(age: number | null): age is number {
  return age !== null && age >= DEFAULT_MIN_AGE;
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

/** ~50% exclusion for reduced_reach; same viewer+candidate+day → same outcome (replaces Math.random). */
function reducedReachExcludeThisCandidate(viewerId: string, candidateId: string, dayNumber: number): boolean {
  let h = dayNumber;
  for (let i = 0; i < viewerId.length; i++) h = ((h << 5) - h + viewerId.charCodeAt(i)) | 0;
  for (let i = 0; i < candidateId.length; i++) h = ((h << 5) - h + candidateId.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2) === 1;
}

// NOTE: Old rankScore function removed (P1 dead code cleanup)
// New ranking system in discoverRanking.ts is now the only scoring logic

// ---------------------------------------------------------------------------
// getDiscoverProfiles — main swipe deck query
// ---------------------------------------------------------------------------

// 🔒 LOCKED: Do not change discover query auth, filters, or empty-result contract without audit approval
export const getDiscoverProfiles = query({
  args: {
    token: v.string(),
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

    const sessionToken = typeof args.token === 'string' ? args.token.trim() : '';
    if (sessionToken.length === 0) {
      convexLog('discover.getDiscoverProfiles', { status: 'missing_token', sortBy, limit, offset });
      return phase1DiscoverEmpty('auth_missing_or_invalid');
    }

    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      convexLog('discover.getDiscoverProfiles', { status: 'invalid_or_expired_token', sortBy, limit, offset });
      return phase1DiscoverEmpty('auth_missing_or_invalid');
    }

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return phase1DiscoverEmpty('viewer_unavailable');
    const currentPrefs = normalizeDiscoveryPreferences(currentUser);
    const currentUserAge = calculateAge(currentUser.dateOfBirth);
    if (!hasEligibleAdultAge(currentUserAge)) {
      return phase1DiscoverEmpty('viewer_unavailable');
    }

    if (isEffectivelyHiddenFromDiscover(currentUser)) return phase1DiscoverEmpty('viewer_unavailable');

    // PERF #8: Pre-fetch all swipes, matches, blocks, and incoming likes upfront
    // This converts O(6*N) queries into O(6) queries
    const now = Date.now();
    const discoverDayNumber = Math.floor(now / (1000 * 60 * 60 * 24));
    const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

    const [
      mySwipes,
      matchesAsUser1,
      matchesAsUser2,
      blocksICreated,
      blocksAgainstMe,
      likesToMe,
      myReports,
      reportsAgainstMe,
      myConversationParticipations,
    ] = await Promise.all([
      // All my swipes (likes/passes)
      ctx.db
        .query('likes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
        .collect(),
      // Matches where I'm user1
      // P1 EXCLUSION: include inactive/unmatched rows so previously-unmatched
      // pairs never reappear. `matchedUserIds` below covers both active matches
      // and ever-unmatched pairs with the same single `continue` check.
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .collect(),
      // Matches where I'm user2
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
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
      // Reports in either direction should remove the pair from Discover.
      ctx.db
        .query('reports')
        .withIndex('by_reported_user', (q) => q.eq('reportedUserId', userId))
        .collect(),
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
    for (const report of myReports) {
      if (!report.roomId) viewerReportedIds.add(report.reportedUserId as string);
    }
    for (const report of reportsAgainstMe) {
      if (!report.roomId) viewerReportedIds.add(report.reporterId as string);
    }

    // CONVERSATION PARTNER EXCLUSION: Build set of users with existing message threads
    // This ensures users who already have a chat connection don't reappear in Discover
    const conversationPartnerIds = new Set<string>();
    if (myConversationParticipations.length > 0) {
      // Batch fetch all conversations for efficiency
      const conversations = await Promise.all(
        myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
      );
      const conversationMatchIds = Array.from(
        new Set(
          conversations
            .map((conversation) => conversation?.matchId as string | undefined)
            .filter((id): id is string => Boolean(id))
        )
      );
      const conversationMatches = await Promise.all(
        conversationMatchIds.map((id) => ctx.db.get(id as Id<'matches'>))
      );
      const conversationMatchMap = new Map(
        conversationMatchIds.map((id, index) => [id, conversationMatches[index]])
      );

      for (const conv of conversations) {
        if (!conv) continue;
        if (
          !isActiveDiscoverConversationPartner(
            conv,
            conv.matchId ? (conversationMatchMap.get(conv.matchId as string) ?? null) : null,
            now
          )
        ) {
          continue;
        }
        // Extract partner IDs from participants array (excluding self)
        for (const participantId of conv.participants) {
          if (participantId !== userId) {
            conversationPartnerIds.add(participantId as string);
          }
        }
      }
    }

    // TRUST SIGNALS (Step 5): aggregate trust counts now come from denormalized per-user counters.
    // This avoids truncated global scans (reports.take/blocks.take) which fail at scale.
    const aggregateReportCounts = new Map<string, number>();
    const aggregateBlockCounts = new Map<string, number>();

    // Candidate supply (Step 4): avoid prefix-only users table scans.
    // Use indexed gender buckets with deterministic rotation so later users become reachable.
    const desiredGenders = Array.from(
      new Set((currentUser.lookingFor ?? []).filter((g) => typeof g === 'string' && g.length > 0))
    );

    const USER_PAGE_SIZE = 220;
    const MAX_PAGES_PER_GENDER = 6; // hard bound
    const MAX_SKIP_PAGES = 12; // deterministic rotation window

    // P0 FIX (Option E): Convex only supports a single paginated query per function.
    // The previous skip-and-read paginate loops issued up to ~54 .paginate() calls
    // per request (3 genders × 18 pages), which tripped Convex's rule and crashed
    // Discover in production. We now fetch a bounded bucket with a single .take().
    //
    // Rotation fairness is preserved downstream by:
    //   - rotationScore() (day-seeded per viewer+candidate)
    //   - reducedReachExcludeThisCandidate()
    //   - per-viewer ranking window over MAX_RANK_WINDOW (2000)
    //
    // BUCKET_SIZE matches the prior read-loop upper bound (USER_PAGE_SIZE *
    // MAX_PAGES_PER_GENDER = 1320) so candidate-pool capacity is unchanged.
    const BUCKET_SIZE = USER_PAGE_SIZE * MAX_PAGES_PER_GENDER;

    const fetchGenderBucket = async (gender: string) => {
      const users = await ctx.db
        .query('users')
        .withIndex('by_gender', (q) => q.eq('gender', gender as any))
        .take(BUCKET_SIZE);

      return users;
    };

    const fetchedBuckets = await Promise.all(
      (desiredGenders.length > 0 ? desiredGenders : ['male', 'female']).slice(0, 3).map(fetchGenderBucket)
    );

    const allUsersMap = new Map<string, any>();
    for (const bucket of fetchedBuckets) {
      for (const u of bucket) {
        const id = u?._id as string | undefined;
        if (!id) continue;
        if (!allUsersMap.has(id)) allUsersMap.set(id, u);
      }
    }
    const allUsers = Array.from(allUsersMap.values());

    // Populate aggregate trust maps from denormalized counters (fallback to 0 for legacy rows).
    for (const u of allUsers) {
      const id = u?._id as string | undefined;
      if (!id) continue;
      const rc = typeof u.reportCount === 'number' ? u.reportCount : 0;
      const bc = typeof u.blockCount === 'number' ? u.blockCount : 0;
      if (rc > 0) aggregateReportCounts.set(id, rc);
      if (bc > 0) aggregateBlockCounts.set(id, bc);
    }

    // First pass: filter candidates without photo queries
    const filteredCandidates: { user: typeof allUsers[number]; distance?: number }[] = [];
    /** Users who failed mutual gender / age / distance (filters may be too strict). */
    let prefFailCount = 0;
    /** Users who passed preferences but were excluded by swipes/matches/blocks/etc. */
    let historyFailCount = 0;

    if (DISCOVER_AUDIT_ENABLED) {
      console.log('[DISCOVER_AUDIT][raw]', {
        viewer: currentUser._id,
        viewerGender: currentUser.gender,
        viewerOrientation: currentUser.orientation,
        viewerLookingFor: currentUser.lookingFor,
        viewerMinAge: currentPrefs.minAge,
        viewerMaxAge: currentPrefs.maxAge,
        viewerMaxDistance: currentPrefs.maxDistance,
        viewerHasCoords: !!(currentUser.latitude && currentUser.longitude),
        rawPoolSize: allUsers.length,
        rawCandidateIds: allUsers.map((u) => u._id),
      });
    }

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) {
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][visibility] inactive_or_banned', {
            viewer: currentUser._id,
            candidate: user._id,
            isActive: user.isActive,
            isBanned: user.isBanned,
          });
        }
        continue;
      }
      // P1-2: Shadow-ban from Discover. Set true when an automated
      // high-severity behaviorFlag is created (e.g. >=10 reports/hour or
      // crossing the high-severity report threshold). Filtered here so the
      // user is silently removed from Phase-1 Discover without leaking the
      // moderation signal to either side. Denormalized field on `users`
      // avoids a per-candidate behaviorFlags lookup (no full table scan).
      if (user.discoverShadowBanned === true) {
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][visibility] discover_shadow_banned', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }
      if (isEffectivelyHiddenFromDiscover(user)) {
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][visibility] hidden_from_discover', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }

      // Align with likes.swipe: like/super_like require target verificationStatus === 'verified'
      const targetVerificationStatus = user.verificationStatus || 'unverified';
      if (targetVerificationStatus !== 'verified') {
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][visibility] not_verified', {
            viewer: currentUser._id,
            candidate: user._id,
            candidateVerificationStatus: targetVerificationStatus,
          });
        }
        continue;
      }

      // Incognito check
      if (user.incognitoMode) {
        const canSee = currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';
        if (!canSee) {
          if (DISCOVER_AUDIT_ENABLED) {
            console.log('[DISCOVER_AUDIT][visibility] incognito_not_allowed', {
              viewer: currentUser._id,
              candidate: user._id,
              viewerGender: currentUser.gender,
              viewerTier: currentUser.subscriptionTier,
            });
          }
          continue;
        }
      }

      // Orientation preference match (RECIPROCAL: viewer ↔ candidate)
      // P0 one-way-visibility fix: previously only the viewer's orientation
      // was checked against the candidate's gender. That made the gate
      // asymmetric — if the candidate's orientation excluded the viewer's
      // gender but the viewer's did not, the viewer would still see the
      // candidate (and vice versa). Now both sides must agree.
      if (
        !orientationAllowsCandidateGender({
          viewerGender: currentUser.gender,
          viewerOrientation: currentUser.orientation ?? undefined,
          candidateGender: user.gender,
        }) ||
        !orientationAllowsCandidateGender({
          viewerGender: user.gender,
          viewerOrientation: user.orientation ?? undefined,
          candidateGender: currentUser.gender,
        })
      ) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] orientation', {
            viewer: currentUser._id,
            candidate: user._id,
            viewerGender: currentUser.gender,
            viewerOrientation: currentUser.orientation,
            candidateGender: user.gender,
            candidateOrientation: user.orientation,
          });
        }
        continue;
      }

      // Gender preference match (both ways)
      if (!currentUser.lookingFor.includes(user.gender)) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] viewer_lookingFor_excludes_candidate', {
            viewer: currentUser._id,
            candidate: user._id,
            viewerLookingFor: currentUser.lookingFor,
            candidateGender: user.gender,
          });
        }
        continue;
      }
      if (!user.lookingFor.includes(currentUser.gender)) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] candidate_lookingFor_excludes_viewer', {
            viewer: currentUser._id,
            candidate: user._id,
            candidateLookingFor: user.lookingFor,
            viewerGender: currentUser.gender,
          });
        }
        continue;
      }

      // Age range
      const userAge = calculateAge(user.dateOfBirth);
      const candidatePrefs = normalizeDiscoveryPreferences(user);
      if (!hasEligibleAdultAge(userAge)) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] candidate_age_invalid_or_underage', {
            viewer: currentUser._id,
            candidate: user._id,
            candidateDateOfBirthPresent: typeof user.dateOfBirth === 'string' && user.dateOfBirth.length > 0,
          });
        }
        continue;
      }
      if (userAge < currentPrefs.minAge || userAge > currentPrefs.maxAge) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] candidate_age_out_of_viewer_range', {
            viewer: currentUser._id,
            candidate: user._id,
            candidateAge: userAge,
            viewerMinAge: currentPrefs.minAge,
            viewerMaxAge: currentPrefs.maxAge,
          });
        }
        continue;
      }
      if (currentUserAge < candidatePrefs.minAge || currentUserAge > candidatePrefs.maxAge) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] viewer_age_out_of_candidate_range', {
            viewer: currentUser._id,
            candidate: user._id,
            viewerAge: currentUserAge,
            candidateMinAge: candidatePrefs.minAge,
            candidateMaxAge: candidatePrefs.maxAge,
          });
        }
        continue;
      }

      // Distance
      if (!hasUsableDistanceLocation(currentUser) || !hasUsableDistanceLocation(user)) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] missing_distance_location', {
            viewer: currentUser._id,
            candidate: user._id,
            viewerHasCoords: hasUsableDistanceLocation(currentUser),
            candidateHasCoords: hasUsableDistanceLocation(user),
          });
        }
        continue;
      }

      const distance = calculateDistance(
        currentUser.latitude, currentUser.longitude,
        user.latitude, user.longitude,
      );
      if (!isDistanceAllowed(distance, currentPrefs.maxDistance)) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] distance_exceeds_viewer_max', {
            viewer: currentUser._id,
            candidate: user._id,
            distanceKm: distance,
            viewerMaxDistance: currentPrefs.maxDistance,
          });
        }
        continue;
      }
      if (!isDistanceAllowed(distance, candidatePrefs.maxDistance)) {
        prefFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][compatibility] distance_exceeds_candidate_max', {
            viewer: currentUser._id,
            candidate: user._id,
            distanceKm: distance,
            candidateMaxDistance: candidatePrefs.maxDistance,
          });
        }
        continue;
      }

      // PERF #8: O(1) Set lookups instead of database queries
      if (swipedUserIds.has(user._id as string)) {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] already_swiped', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }
      if (matchedUserIds.has(user._id as string)) {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] already_matched', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }
      if (blockedUserIds.has(user._id as string)) {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] blocked', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }
      // TRUST: Viewer-specific report exclusion (hard filter)
      if (viewerReportedIds.has(user._id as string)) {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] viewer_reported_candidate', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }
      if (conversationPartnerIds.has(user._id as string)) {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] active_conversation_partner', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }

      // Enforcement
      if (user.verificationEnforcementLevel === 'security_only') {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] enforcement_security_only', {
            viewer: currentUser._id,
            candidate: user._id,
          });
        }
        continue;
      }
      if (
        user.verificationEnforcementLevel === 'reduced_reach' &&
        reducedReachExcludeThisCandidate(userId as string, user._id as string, discoverDayNumber)
      ) {
        historyFailCount++;
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][limits] enforcement_reduced_reach', {
            viewer: currentUser._id,
            candidate: user._id,
            discoverDayNumber,
          });
        }
        continue;
      }

      filteredCandidates.push({ user, distance });
    }

    if (DISCOVER_AUDIT_ENABLED) {
      console.log('[DISCOVER_AUDIT][compatibility] after_filter_loop', {
        viewer: currentUser._id,
        rawPoolSize: allUsers.length,
        passedFilterCount: filteredCandidates.length,
        passedFilterIds: filteredCandidates.map((c) => c.user._id),
        prefFailCount,
        historyFailCount,
      });
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

      const orderedPublicPhotos = orderSafePhase1DisplayPhotos(photos);
      if (orderedPublicPhotos.length === 0) {
        if (DISCOVER_AUDIT_ENABLED) {
          console.log('[DISCOVER_AUDIT][visibility] no_public_safe_photos', {
            viewer: currentUser._id,
            candidate: user._id,
            rawPhotoCount: photos.length,
          });
        }
        continue; // at least 1 public-safe photo required
      }

      const userAge = calculateAge(user.dateOfBirth);
      if (!hasEligibleAdultAge(userAge)) {
        continue;
      }
      const theyLikedMe = usersWhoLikedMe.has(user._id as string);

      candidates.push({
        id: user._id,
        name: user.name,
        age: userAge,
        ageHidden: user.hideAge === true,
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
        distanceHidden: user.hideDistance === true,
        lastActive: user.lastActive,
        showLastSeen: user.showLastSeen,
        createdAt: user.createdAt,
        lookingFor: user.lookingFor,
        relationshipIntent: normalizeRelationshipIntentValues(user.relationshipIntent),
        activities: user.activities,
        profilePrompts: user.profilePrompts,
        photos: orderedPublicPhotos,
        photoBlurred: user.photoBlurred === true,
        isBoosted: !!(user.boostedUntil && user.boostedUntil > Date.now()),
        theyLikedMe,
        photoCount: orderedPublicPhotos.length,
        isIncognito: user.incognitoMode === true,
        // Client live distance (Step 9): approximate position for haversine when viewer GPS updates
        latitude: user.latitude,
        longitude: user.longitude,
      });
    }

    const mapDiscoverProfileRow = (c: any) => {
      const { showLastSeen, ...rest } = c;
      return {
        ...rest,
        age: c.ageHidden ? undefined : c.age,
        distance: c.distanceHidden ? undefined : c.distance,
        lastActive: showLastSeen === false ? undefined : c.lastActive,
        // Omit coords when distance is hidden (privacy parity with distance field)
        latitude: c.distanceHidden ? undefined : c.latitude,
        longitude: c.distanceHidden ? undefined : c.longitude,
      };
    };

    const filteredLenForEmpty = filteredCandidates.length;
    const candidatesLenForEmpty = candidates.length;

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
        minAge: currentPrefs.minAge,
        maxAge: currentPrefs.maxAge,
        maxDistance: currentPrefs.maxDistance,
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

      // Rank enough candidates to honor offset + limit (pagination window)
      const MAX_RANK_WINDOW = 2000; // bounded expansion to reduce "unreachable beyond cap" failure mode
      const rankWindow = Math.min(offset + limit, MAX_RANK_WINDOW, candidateProfiles.length);

      // Apply new ranking with exploration mix
      const { rankedCandidates, exhausted } = rankDiscoverCandidates(
        candidateProfiles,
        rankingCurrentUser,
        trustSignals,
        rankWindow,
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
      if (exhausted && result.length < rankWindow) {
        const needed = rankWindow - result.length;
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
          const sharedResult = sharedRankCandidates(normalizedCandidates, normalizedViewer, undefined, { limit: rankWindow });

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

      const window = result.slice(offset, offset + limit);
      const mappedRecommended = window.map(mapDiscoverProfileRow);
      if (DISCOVER_AUDIT_ENABLED) {
        console.log('[DISCOVER_AUDIT][final] recommended', {
          viewer: currentUser._id,
          rankedTotal: result.length,
          offset,
          limit,
          returnedCount: mappedRecommended.length,
          returnedIds: mappedRecommended.map((p: any) => p.id),
        });
      }
      if (mappedRecommended.length > 0) {
        return { profiles: mappedRecommended };
      }
      const emptyReasonRecommended = emptyReasonWhenWindowEmpty(
        offset,
        result.length,
        prefFailCount,
        historyFailCount,
        filteredLenForEmpty,
        candidatesLenForEmpty,
      );
      if (DISCOVER_AUDIT_ENABLED) {
        console.log('[DISCOVER_AUDIT][final] recommended_empty', {
          viewer: currentUser._id,
          reason: emptyReasonRecommended,
        });
      }
      return phase1DiscoverEmpty(emptyReasonRecommended);
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

    const window = candidates.slice(offset, offset + limit);
    const mappedSort = window.map(mapDiscoverProfileRow);
    if (DISCOVER_AUDIT_ENABLED) {
      console.log('[DISCOVER_AUDIT][final] sorted', {
        viewer: currentUser._id,
        sortBy,
        totalCandidates: candidates.length,
        offset,
        limit,
        returnedCount: mappedSort.length,
        returnedIds: mappedSort.map((p: any) => p.id),
      });
    }
    if (mappedSort.length > 0) {
      return { profiles: mappedSort };
    }
    const emptyReasonSort = emptyReasonWhenWindowEmpty(
      offset,
      candidates.length,
      prefFailCount,
      historyFailCount,
      filteredLenForEmpty,
      candidatesLenForEmpty,
    );
    if (DISCOVER_AUDIT_ENABLED) {
      console.log('[DISCOVER_AUDIT][final] sorted_empty', {
        viewer: currentUser._id,
        reason: emptyReasonSort,
      });
    }
    return phase1DiscoverEmpty(emptyReasonSort);
  },
});

// ---------------------------------------------------------------------------
// getExploreCategoryProfiles — filtered category view
// ---------------------------------------------------------------------------

const EXTRA_EXPLORE_CATEGORY_IDS = [
  'online_now',
  'active_today',
  'free_tonight',
] as const;

function getFiniteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const EXPLORE_CATEGORY_IDS = [
  ...FRONTEND_EXPLORE_CATEGORY_IDS,
  ...EXTRA_EXPLORE_CATEGORY_IDS,
] as const;

type ExploreCategoryId = (typeof EXPLORE_CATEGORY_IDS)[number];
type RelationshipExploreCategoryId = (typeof FRONTEND_RELATIONSHIP_INTENT_IDS)[number];

const RIGHT_NOW_EXPLORE_CATEGORY_IDS = [
  'free_tonight',
  'nearby',
  'online_now',
  'active_today',
] as const;

type RightNowExploreCategoryId = (typeof RIGHT_NOW_EXPLORE_CATEGORY_IDS)[number];
type ExploreNearbyAvailabilityStatus = 'ok' | 'location_required' | 'verification_required';

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
  freeTonightExpiresAt?: number;
  profilePrompts?: { question: string; answer: string }[];
  photoBlurred: boolean;
  isIncognito: boolean;
  createdAt: number;
  rankingLastActive: number;
  rankingScore: number;
  nearbyDistanceKm?: number;
  sourceUserId: Id<'users'>;
  primaryPhotoUrl?: string;
  displayPrimaryPhotoUrl?: string;
};

type ExploreProfileResult = Omit<ExploreCandidateBase, 'rankingScore' | 'rankingLastActive' | 'nearbyDistanceKm' | 'sourceUserId' | 'primaryPhotoUrl' | 'displayPrimaryPhotoUrl'> & {
  photos: { url: string }[];
};

function isExploreCategoryId(value: string | undefined): value is ExploreCategoryId {
  return typeof value === 'string' && (EXPLORE_CATEGORY_IDS as readonly string[]).includes(value);
}

function isRelationshipExploreCategoryId(categoryId: ExploreCategoryId): categoryId is RelationshipExploreCategoryId {
  return (FRONTEND_RELATIONSHIP_INTENT_IDS as readonly string[]).includes(categoryId);
}

function isRightNowExploreCategoryId(categoryId: ExploreCategoryId): categoryId is RightNowExploreCategoryId {
  return (RIGHT_NOW_EXPLORE_CATEGORY_IDS as readonly string[]).includes(categoryId);
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

function isNearMeCandidate(candidate: { nearbyDistanceKm?: number }): boolean {
  return typeof candidate.nearbyDistanceKm === 'number' && candidate.nearbyDistanceKm <= EXPLORE_NEARBY_RADIUS_KM;
}

function isOnlineNowCandidate(candidate: { isActiveNow: boolean }): boolean {
  return candidate.isActiveNow === true;
}

function isActiveTodayCandidate(candidate: { wasActiveToday: boolean }): boolean {
  return candidate.wasActiveToday === true;
}

function matchesRightNowExploreCategory(candidate: ExploreCandidateBase, categoryId: RightNowExploreCategoryId): boolean {
  switch (categoryId) {
    case 'nearby':
      return isNearMeCandidate(candidate);
    case 'online_now':
      return isOnlineNowCandidate(candidate);
    case 'active_today':
      return isActiveTodayCandidate(candidate);
    case 'free_tonight':
      return isFreeTonightActive(candidate.activities, candidate.freeTonightExpiresAt);
    default:
      return false;
  }
}

function createEmptyExploreCounts(): Record<string, number> {
  return Object.fromEntries(EXPLORE_CATEGORY_IDS.map((id) => [id, 0]));
}

function hasUsableExploreLocation(user: { latitude?: number; longitude?: number }): boolean {
  return hasUsableDistanceLocation(user);
}

function getExploreNearbyAvailabilityStatus(user: {
  latitude?: number;
  longitude?: number;
  verificationStatus?: string;
}): ExploreNearbyAvailabilityStatus {
  if (!hasUsableExploreLocation(user)) {
    return 'location_required';
  }

  const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
  if ((user.verificationStatus || 'unverified') !== 'verified' && !isDevBypass) {
    return 'verification_required';
  }

  return 'ok';
}

// ---------------------------------------------------------------------------
// R3 Explore bucketing
// ---------------------------------------------------------------------------
// Product rule: Explore has two independent layers. A candidate can own exactly
// one Relationship category per viewer-candidate pair and exactly one Right Now
// category. Relationship counts/listings use mutual intent priority; Right Now
// counts/listings keep their existing signal priority.
//
// NOTE: order matters; do not reorder without product review.
const RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY: readonly RelationshipExploreCategoryId[] = [
  'serious_vibes',
  'keep_it_casual',
  'exploring_vibes',
  'see_where_it_goes',
  'open_to_vibes',
  'just_friends',
  'open_to_anything',
  'single_parent',
  'new_to_dating',
];

const RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY: readonly RightNowExploreCategoryId[] = [
  'free_tonight',
  'nearby',
  'online_now',
  'active_today',
];

// Invariants: each layer priority list must cover its category set exactly once.
(() => {
  const relationshipPriorityIds = new Set<string>(RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY);
  if (relationshipPriorityIds.size !== RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY.length) {
    throw new Error('RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY has duplicate entries');
  }
  if (relationshipPriorityIds.size !== FRONTEND_RELATIONSHIP_INTENT_IDS.length) {
    throw new Error(
      `RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY covers ${relationshipPriorityIds.size} ids but relationship category set has ${FRONTEND_RELATIONSHIP_INTENT_IDS.length}`,
    );
  }
  for (const id of FRONTEND_RELATIONSHIP_INTENT_IDS) {
    if (!relationshipPriorityIds.has(id)) {
      throw new Error(`RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY is missing category: ${id}`);
    }
  }

  const rightNowPriorityIds = new Set<string>(RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY);
  if (rightNowPriorityIds.size !== RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY.length) {
    throw new Error('RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY has duplicate entries');
  }
  if (rightNowPriorityIds.size !== RIGHT_NOW_EXPLORE_CATEGORY_IDS.length) {
    throw new Error(
      `RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY covers ${rightNowPriorityIds.size} ids but Right Now category set has ${RIGHT_NOW_EXPLORE_CATEGORY_IDS.length}`,
    );
  }
  for (const id of RIGHT_NOW_EXPLORE_CATEGORY_IDS) {
    if (!rightNowPriorityIds.has(id)) {
      throw new Error(`RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY is missing category: ${id}`);
    }
  }
})();

function assignMutualRelationshipExploreCategory(
  viewerRelationshipIntent: readonly string[] | string | undefined | null,
  candidateRelationshipIntent: readonly string[] | string | undefined | null,
): RelationshipExploreCategoryId | null {
  const viewerIntents = new Set(normalizeRelationshipIntentValues(viewerRelationshipIntent));
  if (viewerIntents.size === 0) return null;

  const candidateIntents = new Set(normalizeRelationshipIntentValues(candidateRelationshipIntent));
  if (candidateIntents.size === 0) return null;

  for (const categoryId of RELATIONSHIP_EXPLORE_ASSIGNMENT_PRIORITY) {
    if (viewerIntents.has(categoryId) && candidateIntents.has(categoryId)) {
      return categoryId;
    }
  }
  return null;
}

function assignRightNowExploreCategory(
  candidate: ExploreCandidateBase,
): RightNowExploreCategoryId | null {
  for (const categoryId of RIGHT_NOW_EXPLORE_ASSIGNMENT_PRIORITY) {
    if (matchesRightNowExploreCategory(candidate, categoryId)) {
      return categoryId;
    }
  }
  return null;
}

function countExploreCategories(
  viewer: { relationshipIntent?: string[] } | null,
  candidates: ExploreCandidateBase[],
): Record<string, number> {
  const counts = createEmptyExploreCounts();
  for (const candidate of candidates) {
    const relationshipOwner = assignMutualRelationshipExploreCategory(
      viewer?.relationshipIntent,
      candidate.relationshipIntent,
    );
    if (relationshipOwner) {
      counts[relationshipOwner] += 1;
    }

    const rightNowOwner = assignRightNowExploreCategory(candidate);
    if (rightNowOwner) {
      counts[rightNowOwner] += 1;
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
  if (
    !currentUser ||
    !currentUser.isActive ||
    currentUser.isBanned ||
    currentUser.deletedAt ||
    currentUser.onboardingCompleted !== true ||
    isEffectivelyHiddenFromDiscover(currentUser)
  ) return null;
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
    reportsAgainstMe,
    myConversationParticipations,
  ] = await Promise.all([
    ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .collect(),
    // P1 EXCLUSION: include inactive/unmatched rows so ever-unmatched pairs
    // stay excluded from Explore (same semantics as Discover).
    ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
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
      .query('reports')
      .withIndex('by_reported_user', (q) => q.eq('reportedUserId', userId))
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
  for (const report of myReports) {
    if (!report.roomId) viewerReportedIds.add(report.reportedUserId as string);
  }
  for (const report of reportsAgainstMe) {
    if (!report.roomId) viewerReportedIds.add(report.reporterId as string);
  }

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
): Promise<{ status: 'ready' | 'viewer_not_found' | 'invalid_category' | 'location_required' | 'verification_required'; currentUser: any | null; candidates: ExploreCandidateBase[] }> {
  const resolvedViewer = await resolveExploreViewer(ctx, args.rawUserId);
  if (!resolvedViewer) {
    return { status: 'viewer_not_found', currentUser: null, candidates: [] };
  }

  const { userId, currentUser } = resolvedViewer;
  const activeCategoryId = normalizePublicExploreCategoryId(args.categoryId);
  if (args.categoryId && !activeCategoryId) {
    return { status: 'invalid_category', currentUser, candidates: [] };
  }
  if (activeCategoryId === 'nearby') {
    const nearbyStatus = getExploreNearbyAvailabilityStatus(currentUser);
    if (nearbyStatus !== 'ok') {
      return { status: nearbyStatus, currentUser, candidates: [] };
    }
  }

  const exclusions = await loadExploreExclusions(ctx, userId);

  const savedLookingFor = Array.isArray(currentUser.lookingFor)
    ? Array.from(new Set(currentUser.lookingFor.filter(Boolean)))
    : [];
  const requestedGenderSet = args.genderFilter && args.genderFilter.length > 0
    ? new Set(args.genderFilter.filter(Boolean))
    : null;
  const effectiveGender = savedLookingFor.filter((gender) =>
    requestedGenderSet ? requestedGenderSet.has(gender) : true
  );
  if (effectiveGender.length === 0) {
    return { status: 'ready', currentUser, candidates: [] };
  }

  const currentPrefs = normalizeDiscoveryPreferences(currentUser);
  const requestedMinAge = getFiniteNumber(args.minAge);
  const requestedMaxAge = getFiniteNumber(args.maxAge);
  const requestedMaxDistance = getFiniteNumber(args.maxDistance);
  const effectiveMinAge = Math.max(requestedMinAge ?? currentPrefs.minAge, currentPrefs.minAge);
  const effectiveMaxAge = Math.min(requestedMaxAge ?? currentPrefs.maxAge, currentPrefs.maxAge);
  const effectiveMaxDistance = Math.min(requestedMaxDistance ?? currentPrefs.maxDistance, currentPrefs.maxDistance);
  if (effectiveMaxAge < effectiveMinAge || effectiveMaxDistance <= 0) {
    return { status: 'ready', currentUser, candidates: [] };
  }
  const normalizedRelationshipIntentFilter = normalizeRelationshipIntentValues(args.relationshipIntent);
  const viewerAge = calculateAge(currentUser.dateOfBirth);
  if (!hasEligibleAdultAge(viewerAge)) {
    return { status: 'ready', currentUser, candidates: [] };
  }

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
      if (!user.isActive || user.isBanned || user.deletedAt || user.onboardingCompleted !== true) continue;
      if (isEffectivelyHiddenFromDiscover(user)) continue;
      if ((user.verificationStatus || 'unverified') !== 'verified') continue;
      if (user.verificationEnforcementLevel === 'security_only') continue;
      if (exclusions.swipedUserIds.has(candidateId)) continue;
      if (exclusions.matchedUserIds.has(candidateId)) continue;
      if (exclusions.blockedUserIds.has(candidateId)) continue;
      if (exclusions.viewerReportedIds.has(candidateId)) continue;
      // CONVERSATION PARTNER EXCLUSION — DISABLED (see getDiscoverProfiles):
      // Users with an existing conversation are no longer hidden from Explore.
      // Blocking / unmatching / reporting still exclude above.

      if (user.incognitoMode) {
        const canSeeIncognito = currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';
        if (!canSeeIncognito) continue;
      }

      const candidateLookingFor = Array.isArray(user.lookingFor) ? user.lookingFor : [];
      const candidateRelationshipIntent = Array.isArray(user.relationshipIntent) ? (user.relationshipIntent as string[]) : [];
      const candidateActivities = Array.isArray(user.activities) ? (user.activities as string[]) : [];
      const normalizedCandidateRelationshipIntent = normalizeRelationshipIntentValues(candidateRelationshipIntent);

      if (!candidateLookingFor.includes(currentUser.gender)) continue;
      if (
        !orientationAllowsCandidateGender({
          viewerGender: currentUser.gender ?? undefined,
          viewerOrientation: currentUser.orientation ?? undefined,
          candidateGender: user.gender ?? undefined,
        })
      ) {
        continue;
      }
      if (
        !orientationAllowsCandidateGender({
          viewerGender: user.gender ?? undefined,
          viewerOrientation: user.orientation ?? undefined,
          candidateGender: currentUser.gender ?? undefined,
        })
      ) {
        continue;
      }

      const userAge = calculateAge(user.dateOfBirth);
      const candidatePrefs = normalizeDiscoveryPreferences(user);
      if (!hasEligibleAdultAge(userAge)) continue;
      if (userAge < effectiveMinAge || userAge > effectiveMaxAge) continue;
      if (viewerAge < candidatePrefs.minAge || viewerAge > candidatePrefs.maxAge) continue;

      const rawDistance = getCandidateDistance(currentUser, user);
      if (!isDistanceAllowed(rawDistance, effectiveMaxDistance)) continue;
      if (!isDistanceAllowed(rawDistance, candidatePrefs.maxDistance)) continue;

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
        freeTonightExpiresAt: user.freeTonightExpiresAt,
        profilePrompts: user.profilePrompts,
        photoBlurred: user.photoBlurred === true,
        isIncognito: user.incognitoMode === true,
        createdAt: user.createdAt ?? user._creationTime,
        rankingLastActive: user.lastActive ?? 0,
        rankingScore: buildExploreRankingScore(user, currentUser, 1),
        nearbyDistanceKm: rawDistance,
        sourceUserId: user._id,
        primaryPhotoUrl: user.primaryPhotoUrl,
        displayPrimaryPhotoUrl: user.displayPrimaryPhotoUrl,
      };

      if (activeCategoryId) {
        if (isRelationshipExploreCategoryId(activeCategoryId)) {
          if (
            assignMutualRelationshipExploreCategory(
              currentUser.relationshipIntent,
              candidate.relationshipIntent,
            ) !== activeCategoryId
          ) {
            continue;
          }
        } else if (isRightNowExploreCategoryId(activeCategoryId)) {
          if (assignRightNowExploreCategory(candidate) !== activeCategoryId) continue;
        } else {
          continue;
        }
      }
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => {
    if (activeCategoryId === 'nearby') {
      return (a.nearbyDistanceKm ?? 999) - (b.nearbyDistanceKm ?? 999);
    }
    if (activeCategoryId === 'online_now' || activeCategoryId === 'active_today') {
      return b.rankingLastActive - a.rankingLastActive;
    }
    return b.rankingScore - a.rankingScore;
  });

  return { status: 'ready', currentUser, candidates };
}

async function loadSafeExplorePhotoUrlsByCandidateId(
  ctx: QueryCtx,
  candidates: ExploreCandidateBase[]
): Promise<Map<string, { url: string }[]>> {
  const photoUrlsByCandidateId = new Map<string, { url: string }[]>();
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
      const orderedSafePhotos = orderSafePhase1DisplayPhotos(chunkPhotos[index]);
      const publicPhotos = orderedSafePhotos.map((photo) => ({ url: photo.url }));

      if (publicPhotos.length === 0) continue;
      photoUrlsByCandidateId.set(candidate.id as string, publicPhotos);
    }
  }

  return photoUrlsByCandidateId;
}

function filterExploreCandidatesWithSafeDisplayPhoto(
  candidates: ExploreCandidateBase[],
  photoUrlsByCandidateId: Map<string, { url: string }[]>
): ExploreCandidateBase[] {
  return candidates.filter((candidate) => photoUrlsByCandidateId.has(candidate.id as string));
}

async function hydrateExploreProfiles(
  ctx: QueryCtx,
  candidates: ExploreCandidateBase[],
  preloadedPhotoUrlsByCandidateId?: Map<string, { url: string }[]>
): Promise<ExploreProfileResult[]> {
  const results: ExploreProfileResult[] = [];
  const photoUrlsByCandidateId =
    preloadedPhotoUrlsByCandidateId ?? await loadSafeExplorePhotoUrlsByCandidateId(ctx, candidates);

  for (const candidate of candidates) {
    const publicPhotos = photoUrlsByCandidateId.get(candidate.id as string) ?? [];
    if (publicPhotos.length === 0) continue;

    const { rankingScore, rankingLastActive, nearbyDistanceKm, sourceUserId, primaryPhotoUrl, displayPrimaryPhotoUrl, ...safeCandidate } = candidate;
    results.push({
      ...safeCandidate,
      photos: publicPhotos,
    });
  }

  return results;
}

export const getExploreCategoryProfiles = query({
  args: {
    token: v.string(),
    genderFilter: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other')))),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
    relationshipIntent: v.optional(v.array(v.union(
      v.literal('serious_vibes'), v.literal('keep_it_casual'), v.literal('exploring_vibes'),
      v.literal('see_where_it_goes'), v.literal('open_to_vibes'), v.literal('just_friends'),
      v.literal('open_to_anything'), v.literal('single_parent'), v.literal('new_to_dating'),
    ))),
    // Activities filter accepted by getExploreCategoryProfiles. Mirrors the
    // 70-value frontend ACTIVITY_FILTERS list so any UI-selectable activity
    // (e.g. 'diy_projects') passed as a discover/explore filter is accepted.
    activities: v.optional(v.array(v.union(
      // Original 20 activities
      v.literal('coffee'), v.literal('date_night'), v.literal('sports'), v.literal('movies'), v.literal('free_tonight'),
      v.literal('foodie'), v.literal('gym_partner'), v.literal('concerts'), v.literal('travel'), v.literal('outdoors'),
      v.literal('art_culture'), v.literal('gaming'), v.literal('nightlife'), v.literal('brunch'), v.literal('study_date'),
      v.literal('this_weekend'), v.literal('beach_pool'), v.literal('road_trip'), v.literal('photography'), v.literal('volunteering'),
      // Additional 49 activities (matching frontend ACTIVITY_FILTERS)
      v.literal('late_night_talks'), v.literal('street_food'), v.literal('home_cooking'), v.literal('baking'), v.literal('healthy_eating'),
      v.literal('weekend_getaways'), v.literal('long_drives'), v.literal('city_exploring'), v.literal('beach_vibes'), v.literal('mountain_views'),
      v.literal('nature_walks'), v.literal('sunset_views'), v.literal('hiking'), v.literal('camping'), v.literal('stargazing'),
      v.literal('gardening'), v.literal('gym'), v.literal('yoga'), v.literal('running'), v.literal('cycling'),
      v.literal('meditation'), v.literal('pilates'), v.literal('music_lover'), v.literal('live_concerts'), v.literal('singing'),
      v.literal('podcasts'), v.literal('binge_watching'), v.literal('thrillers'), v.literal('documentaries'), v.literal('anime'),
      v.literal('k_dramas'), v.literal('board_games'), v.literal('chess'), v.literal('escape_rooms'), v.literal('drawing'),
      v.literal('painting'), v.literal('writing'), v.literal('journaling'), v.literal('diy_projects'), v.literal('reading'),
      v.literal('personal_growth'), v.literal('learning_new_skills'), v.literal('mindfulness'), v.literal('tech_enthusiast'), v.literal('startups'),
      v.literal('coding'), v.literal('community_service'), v.literal('sustainability'), v.literal('plant_parenting'),
    ))),
    sortByInterests: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    categoryId: v.optional(v.string()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      token, genderFilter, minAge, maxAge, maxDistance,
      relationshipIntent, activities, sortByInterests,
      limit = 20, offset = 0,
      categoryId,
    } = args;

    const sessionToken = typeof token === 'string' ? token.trim() : '';
    if (sessionToken.length === 0) {
      return {
        profiles: [],
        totalCount: 0,
        status: 'viewer_missing' as const,
      };
    }

    const viewerId = await validateSessionToken(ctx, sessionToken);
    if (!viewerId) {
      return {
        profiles: [],
        totalCount: 0,
        status: 'viewer_missing' as const,
      };
    }

    const baseWindow = Math.max(offset + limit, 24);
    const fetchMultiplier = categoryId ? 30 : ((relationshipIntent && relationshipIntent.length > 0) || (activities && activities.length > 0) || sortByInterests ? 24 : 16);
    // Bounded candidate fan-out: existing heuristic floored at 140, then
    // capped at MAX_EXPLORE_CANDIDATES so the per-gender scan cannot grow
    // unbounded with offset / multiplier. Ranking/filter behavior is
    // unchanged — this only limits how many rows are read per gender bucket.
    const heuristicMaxPerGender = Math.max(
      Math.ceil((baseWindow * fetchMultiplier) / Math.max((genderFilter?.length ?? 0) || 1, 1)),
      140,
    );
    const maxPerGender = Math.min(heuristicMaxPerGender, MAX_EXPLORE_CANDIDATES);

    const built = await buildExploreCandidates(ctx, {
      rawUserId: viewerId,
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

    // Vibes/Explore impression suppression — push-to-back ordering scoped by
    // (viewerId, categoryId). Profiles shown to this viewer in this category
    // within the last 4 hours are reordered to the BACK of the deck so the
    // immediate strict page does not repeat them, while still keeping them
    // available if the viewer paginates deep. Hard safety/privacy filters in
    // buildExploreCandidates are unaffected — suppression is ordering-only.
    // Suppression is gated on a categoryId being present (the table key
    // requires it). Without a categoryId we fall through unchanged.
    let orderedCandidates: typeof rankedCandidates = rankedCandidates;
    if (categoryId && built.currentUser?._id) {
      const suppressionCutoff = Date.now() - EXPLORE_SUPPRESSION_WINDOW_MS;
      const viewerId = built.currentUser._id as Id<'users'>;
      const recentImpressions = await ctx.db
        .query('exploreViewerImpressions')
        .withIndex('by_viewer_category_lastSeenAt', (q) =>
          q
            .eq('viewerId', viewerId)
            .eq('categoryId', categoryId)
            .gt('lastSeenAt', suppressionCutoff)
        )
        .take(MAX_EXPLORE_SUPPRESSION_READS);
      if (recentImpressions.length > 0) {
        const recentlySeen = new Set(
          recentImpressions.map((imp) => imp.viewedUserId as string)
        );
        const fresh: typeof rankedCandidates = [];
        const stale: typeof rankedCandidates = [];
        for (const candidate of rankedCandidates) {
          if (recentlySeen.has(candidate.id as string)) {
            stale.push(candidate);
          } else {
            fresh.push(candidate);
          }
        }
        orderedCandidates = fresh.concat(stale);
      }
    }

    const safePhotoUrlsByCandidateId = await loadSafeExplorePhotoUrlsByCandidateId(ctx, orderedCandidates);
    const displayableOrderedCandidates = filterExploreCandidatesWithSafeDisplayPhoto(
      orderedCandidates,
      safePhotoUrlsByCandidateId
    );
    const pageWindow = displayableOrderedCandidates.slice(offset, offset + limit * 3);
    const hydratedProfiles = await hydrateExploreProfiles(ctx, pageWindow, safePhotoUrlsByCandidateId);

    return {
      profiles: hydratedProfiles.slice(0, limit),
      totalCount: displayableOrderedCandidates.length,
      status: 'ok' as const,
    };
  },
});

// ---------------------------------------------------------------------------
// recordExploreImpression — records that the given Vibes/Explore category
// candidate profiles were shown to the viewer. Called fire-and-forget from
// the client after a successful getExploreCategoryProfiles fetch. Used by
// the 4-hour push-to-back suppression in getExploreCategoryProfiles above.
// Safe: silently returns on auth failure or empty input. Hard-capped batch
// size keeps mutation cost predictable.
// ---------------------------------------------------------------------------

export const recordExploreImpression = mutation({
  args: {
    token: v.string(),
    viewedUserIds: v.array(v.id('users')),
    categoryId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.categoryId || args.categoryId.trim().length === 0) return;

    const sessionToken = typeof args.token === 'string' ? args.token.trim() : '';
    if (sessionToken.length === 0) return;

    const viewerId = await validateSessionToken(ctx, sessionToken);
    if (!viewerId) return;
    const resolvedViewerId: Id<'users'> = viewerId;

    const dedupedIds = [...new Set(args.viewedUserIds)]
      .filter((viewedUserId) => viewedUserId !== resolvedViewerId)
      .slice(0, MAX_EXPLORE_IMPRESSION_BATCH);
    if (dedupedIds.length === 0) return;

    const now = Date.now();

    for (const viewedUserId of dedupedIds) {
      const existingRows = await ctx.db
        .query('exploreViewerImpressions')
        .withIndex('by_pair_category', (q) =>
          q
            .eq('viewerId', resolvedViewerId)
            .eq('viewedUserId', viewedUserId)
            .eq('categoryId', args.categoryId)
        )
        .collect();

      if (existingRows.length > 0) {
        const [keeper, ...duplicates] = [...existingRows].sort((a, b) => {
          const aTime = a.lastSeenAt ?? a._creationTime;
          const bTime = b.lastSeenAt ?? b._creationTime;
          return bTime - aTime;
        });
        const mergedSeenCount = existingRows.reduce(
          (total, row) => total + Math.max(row.seenCount ?? 1, 1),
          1,
        );

        await ctx.db.patch(keeper._id, {
          lastSeenAt: now,
          seenCount: mergedSeenCount,
        });
        for (const duplicate of duplicates) {
          await ctx.db.delete(duplicate._id);
        }
      } else {
        const insertedId = await ctx.db.insert('exploreViewerImpressions', {
          viewerId: resolvedViewerId,
          viewedUserId,
          categoryId: args.categoryId,
          lastSeenAt: now,
          seenCount: 1,
        });

        const rowsAfterInsert = await ctx.db
          .query('exploreViewerImpressions')
          .withIndex('by_pair_category', (q) =>
            q
              .eq('viewerId', resolvedViewerId)
              .eq('viewedUserId', viewedUserId)
              .eq('categoryId', args.categoryId)
          )
          .collect();

        if (rowsAfterInsert.length > 1) {
          const keeper =
            rowsAfterInsert.find((row) => row._id === insertedId) ??
            [...rowsAfterInsert].sort((a, b) => {
              const aTime = a.lastSeenAt ?? a._creationTime;
              const bTime = b.lastSeenAt ?? b._creationTime;
              return bTime - aTime;
            })[0];
          const mergedSeenCount = rowsAfterInsert.reduce(
            (total, row) => total + Math.max(row.seenCount ?? 1, 1),
            0,
          );

          await ctx.db.patch(keeper._id, {
            lastSeenAt: now,
            seenCount: mergedSeenCount,
          });
          for (const duplicate of rowsAfterInsert) {
            if (duplicate._id !== keeper._id) {
              await ctx.db.delete(duplicate._id);
            }
          }
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// recordPhase1Impression — P1-9. Records that the given Phase-1 Discover
// candidate profiles were shown to the viewer in the main Discover deck.
// Mirrors `recordExploreImpression` but is scoped to the (viewer, viewedUser)
// pair only — Discover has no per-category dimension. Designed to be called
// fire-and-forget from the client immediately after a successful
// `getDiscoverProfiles` fetch, batched per page.
//
// Anti-abuse:
//   * Hard-cap batch size (MAX_EXPLORE_IMPRESSION_BATCH = 100) so a tampered
//     client cannot spam thousands of pair rows in a single mutation.
//   * Self-impression filtered out (sanity).
//   * Per-pair upsert + de-duplication of any historical multi-row state so
//     the table never accumulates a row-per-fetch over time.
//   * Silent return on auth failure / empty input — same shape as
//     recordExploreImpression so the caller never blocks the UI on this.
// ---------------------------------------------------------------------------

export const recordPhase1Impression = mutation({
  args: {
    token: v.string(),
    viewedUserIds: v.array(v.id('users')),
  },
  handler: async (ctx, args) => {
    const sessionToken = typeof args.token === 'string' ? args.token.trim() : '';
    if (sessionToken.length === 0) return;

    const viewerId = await validateSessionToken(ctx, sessionToken);
    if (!viewerId) return;
    const resolvedViewerId: Id<'users'> = viewerId;

    const dedupedIds = [...new Set(args.viewedUserIds)]
      .filter((viewedUserId) => viewedUserId !== resolvedViewerId)
      .slice(0, MAX_EXPLORE_IMPRESSION_BATCH);
    if (dedupedIds.length === 0) return;

    const now = Date.now();

    for (const viewedUserId of dedupedIds) {
      const existingRows = await ctx.db
        .query('phase1ViewerImpressions')
        .withIndex('by_pair', (q) =>
          q.eq('viewerId', resolvedViewerId).eq('viewedUserId', viewedUserId)
        )
        .collect();

      if (existingRows.length > 0) {
        // Upsert: keep the most recent row, fold any historical duplicates
        // into a single row, refresh lastSeenAt + accumulate seenCount.
        const [keeper, ...duplicates] = [...existingRows].sort((a, b) => {
          const aTime = a.lastSeenAt ?? a._creationTime;
          const bTime = b.lastSeenAt ?? b._creationTime;
          return bTime - aTime;
        });
        const mergedSeenCount = existingRows.reduce(
          (total, row) => total + Math.max(row.seenCount ?? 1, 1),
          1,
        );
        await ctx.db.patch(keeper._id, {
          lastSeenAt: now,
          seenCount: mergedSeenCount,
        });
        for (const duplicate of duplicates) {
          await ctx.db.delete(duplicate._id);
        }
      } else {
        await ctx.db.insert('phase1ViewerImpressions', {
          viewerId: resolvedViewerId,
          viewedUserId,
          lastSeenAt: now,
          seenCount: 1,
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// getExploreCategoryCounts — badge numbers for explore grid
// ---------------------------------------------------------------------------

export const getExploreCategoryCounts = query({
  args: {
    token: v.string(),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sessionToken = typeof args.token === 'string' ? args.token.trim() : '';
    if (sessionToken.length === 0) {
      const emptyCounts = createEmptyExploreCounts();
      return {
        counts: emptyCounts,
        totalCount: 0,
        status: 'viewer_missing' as const,
        nearbyStatus: 'ok' as const,
      };
    }

    const viewerId = await validateSessionToken(ctx, sessionToken);
    if (!viewerId) {
      const emptyCounts = createEmptyExploreCounts();
      return {
        counts: emptyCounts,
        totalCount: 0,
        status: 'viewer_missing' as const,
        nearbyStatus: 'ok' as const,
      };
    }

    const built = await buildExploreCandidates(ctx, {
      rawUserId: viewerId,
      maxPerGender: MAX_EXPLORE_CANDIDATES,
    });

    if (built.status !== 'ready') {
      const emptyCounts = createEmptyExploreCounts();
      return {
        counts: emptyCounts,
        totalCount: 0,
        status: built.status === 'viewer_not_found' ? 'viewer_missing' : built.status,
        nearbyStatus: 'ok' as const,
      };
    }

    const safePhotoUrlsByCandidateId = await loadSafeExplorePhotoUrlsByCandidateId(ctx, built.candidates);
    const displayableCandidates = filterExploreCandidatesWithSafeDisplayPhoto(
      built.candidates,
      safePhotoUrlsByCandidateId
    );
    const nearbyStatus = getExploreNearbyAvailabilityStatus(built.currentUser);
    const counts = countExploreCategories(built.currentUser, displayableCandidates);
    if (nearbyStatus !== 'ok') {
      counts.nearby = 0;
    }

    return {
      counts,
      totalCount: displayableCandidates.length,
      status: 'ok' as const,
      nearbyStatus,
    };
  },
});
