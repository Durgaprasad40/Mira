import { v } from 'convex/values';
import { query, QueryCtx } from './_generated/server';
import { Id, Doc } from './_generated/dataModel';
import {
  resolveUserIdByAuthId,
  requireAuthenticatedUser,
  sanitizePublicPhotos,
  getPublicLastActive,
} from './helpers';
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

const EXPLORE_NEAR_ME_DISTANCE_KM = 5;
const ONLINE_NOW_WINDOW_MS = 10 * 60 * 1000;
const ACTIVE_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const EXPLORE_CATEGORY_IDS = [
  'long_term',
  'short_term',
  'figuring_out',
  'short_to_long',
  'long_to_short',
  'new_friends',
  'open_to_anything',
  'near_me',
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

type ExploreCategoryId = (typeof EXPLORE_CATEGORY_IDS)[number];

type ExploreCandidate = {
  id: Id<'users'>;
  name: string;
  age: number;
  gender: Doc<'users'>['gender'];
  bio: string;
  isVerified: boolean;
  verificationStatus: string;
  city?: string;
  distance?: number;
  lastActive?: number;
  lookingFor: string[];
  relationshipIntent: string[];
  activities: string[];
  profilePrompts: { question: string; answer: string }[];
  photos: ReturnType<typeof sanitizePublicPhotos>;
  photoBlurred: boolean;
  photoCount: number;
  createdAt: number;
  isIncognito: boolean;
};

type ExploreViewerContext = {
  currentUser: Doc<'users'>;
  swipedUserIds: Set<string>;
  matchedUserIds: Set<string>;
  blockedUserIds: Set<string>;
  viewerReportedIds: Set<string>;
  conversationPartnerIds: Set<string>;
};

function isExploreCategoryId(value: string | undefined): value is ExploreCategoryId {
  return !!value && (EXPLORE_CATEGORY_IDS as readonly string[]).includes(value);
}

function canSeeIncognitoProfiles(viewer: Doc<'users'>): boolean {
  return viewer.gender === 'female' || viewer.subscriptionTier === 'premium';
}

function shouldShowReducedReach(viewerId: string, candidateId: string): boolean {
  const seeded = rotationScore(viewerId, candidateId);
  return seeded <= 50;
}

async function loadExploreViewerContext(
  ctx: QueryCtx,
  viewerId: Id<'users'>,
): Promise<ExploreViewerContext | null> {
  const currentUser = await ctx.db.get(viewerId);
  if (!currentUser) return null;

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
      .withIndex('by_from_user', (q) => q.eq('fromUserId', viewerId))
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', viewerId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', viewerId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', viewerId))
      .collect(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerId))
      .collect(),
    ctx.db
      .query('reports')
      .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
      .collect(),
    ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', viewerId))
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
      myConversationParticipations.map((participation) => ctx.db.get(participation.conversationId)),
    );
    for (const conversation of conversations) {
      if (!conversation) continue;
      for (const participantId of conversation.participants) {
        if (participantId !== viewerId) {
          conversationPartnerIds.add(participantId as string);
        }
      }
    }
  }

  return {
    currentUser,
    swipedUserIds,
    matchedUserIds,
    blockedUserIds,
    viewerReportedIds,
    conversationPartnerIds,
  };
}

async function collectExploreUserBuckets(
  ctx: QueryCtx,
  genders: string[],
): Promise<Doc<'users'>[]> {
  const uniqueGenders = Array.from(new Set(genders));
  const buckets = await Promise.all(
    uniqueGenders.map((gender) =>
      ctx.db
        .query('users')
        .withIndex('by_gender', (q) => q.eq('gender', gender as Doc<'users'>['gender']))
        .collect()
    ),
  );

  const deduped = new Map<string, Doc<'users'>>();
  for (const bucket of buckets) {
    for (const user of bucket) {
      deduped.set(user._id as string, user);
    }
  }
  return Array.from(deduped.values());
}

function matchesExploreCategory(candidate: ExploreCandidate, categoryId: ExploreCategoryId): boolean {
  switch (categoryId) {
    case 'long_term':
      return candidate.relationshipIntent.includes('long_term');
    case 'short_term':
      return candidate.relationshipIntent.includes('short_term') || candidate.relationshipIntent.includes('fwb');
    case 'figuring_out':
      return candidate.relationshipIntent.includes('figuring_out');
    case 'short_to_long':
      return candidate.relationshipIntent.includes('short_to_long');
    case 'long_to_short':
      return candidate.relationshipIntent.includes('long_to_short');
    case 'new_friends':
      return candidate.relationshipIntent.includes('new_friends');
    case 'open_to_anything':
      return candidate.relationshipIntent.includes('open_to_anything');
    case 'near_me':
      return typeof candidate.distance === 'number' && candidate.distance <= EXPLORE_NEAR_ME_DISTANCE_KM;
    case 'online_now':
      return typeof candidate.lastActive === 'number' && Date.now() - candidate.lastActive <= ONLINE_NOW_WINDOW_MS;
    case 'active_today':
      return typeof candidate.lastActive === 'number' && Date.now() - candidate.lastActive <= ACTIVE_TODAY_WINDOW_MS;
    case 'free_tonight':
      return candidate.activities.includes('free_tonight');
    case 'coffee_date':
      return candidate.activities.includes('coffee');
    case 'nature_lovers':
      return candidate.activities.includes('outdoors');
    case 'binge_watchers':
      return candidate.activities.includes('movies');
    case 'travel':
      return candidate.activities.includes('travel');
    case 'gaming':
      return candidate.activities.includes('gaming');
    case 'fitness':
      return candidate.activities.includes('gym_partner') || candidate.activities.includes('gym');
    case 'music':
      return candidate.activities.includes('concerts') || candidate.activities.includes('music_lover');
    default:
      return false;
  }
}

function scoreExploreCandidate(candidate: ExploreCandidate, currentUser: Doc<'users'>): number {
  const activity = candidate.lastActive ? activityScore(candidate.lastActive) : 5;
  const completeness = completenessScore(candidate, candidate.photoCount);
  const preference = preferenceMatchScore(candidate, currentUser);
  const rotation = rotationScore(currentUser._id as string, candidate.id as string);
  return 0.45 * activity + 0.35 * completeness + 0.15 * preference + 0.05 * rotation;
}

function sortExploreCandidates(
  candidates: ExploreCandidate[],
  currentUser: Doc<'users'>,
  categoryId?: ExploreCategoryId,
): ExploreCandidate[] {
  const next = [...candidates];

  if (categoryId === 'near_me') {
    next.sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY));
    return next;
  }

  if (categoryId === 'online_now' || categoryId === 'active_today') {
    next.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
    return next;
  }

  if (categoryId && ['coffee_date', 'nature_lovers', 'binge_watchers', 'travel', 'gaming', 'fitness', 'music'].includes(categoryId)) {
    const viewerActivities = new Set<string>((currentUser.activities ?? []) as string[]);
    next.sort((a, b) => {
      const sharedA = a.activities.filter((activity) => viewerActivities.has(activity)).length;
      const sharedB = b.activities.filter((activity) => viewerActivities.has(activity)).length;
      if (sharedA !== sharedB) return sharedB - sharedA;
      return scoreExploreCandidate(b, currentUser) - scoreExploreCandidate(a, currentUser);
    });
    return next;
  }

  next.sort((a, b) => scoreExploreCandidate(b, currentUser) - scoreExploreCandidate(a, currentUser));
  return next;
}

async function buildEligibleExploreCandidates(
  ctx: QueryCtx,
  viewerId: Id<'users'>,
  categoryId?: ExploreCategoryId,
): Promise<{ currentUser: Doc<'users'>; candidates: ExploreCandidate[] } | null> {
  const viewerContext = await loadExploreViewerContext(ctx, viewerId);
  if (!viewerContext) return null;

  const { currentUser } = viewerContext;
  const genders: string[] = Array.from(
    new Set((currentUser.lookingFor ?? []) as string[]),
  );
  if (genders.length === 0) {
    return { currentUser, candidates: [] };
  }

  const allUsers = await collectExploreUserBuckets(ctx, genders);
  const myAge = calculateAge(currentUser.dateOfBirth);
  const filteredUsers: Array<{ user: Doc<'users'>; age: number; distance?: number }> = [];

  for (const user of allUsers) {
    if (user._id === viewerId) continue;
    if (!user.isActive || user.isBanned) continue;
    if (isUserPaused(user)) continue;

    if (user.incognitoMode && !canSeeIncognitoProfiles(currentUser)) continue;

    if (!currentUser.lookingFor.includes(user.gender)) continue;
    if (!user.lookingFor.includes(currentUser.gender)) continue;

    const userAge = calculateAge(user.dateOfBirth);
    if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;
    if (myAge < user.minAge || myAge > user.maxAge) continue;

    let distance: number | undefined;
    if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
      distance = calculateDistance(
        currentUser.latitude,
        currentUser.longitude,
        user.latitude,
        user.longitude,
      );
      if (!isDistanceAllowed(distance, currentUser.maxDistance)) continue;
    }

    if (viewerContext.swipedUserIds.has(user._id as string)) continue;
    if (viewerContext.matchedUserIds.has(user._id as string)) continue;
    if (viewerContext.blockedUserIds.has(user._id as string)) continue;
    if (viewerContext.viewerReportedIds.has(user._id as string)) continue;
    if (viewerContext.conversationPartnerIds.has(user._id as string)) continue;

    if (user.verificationEnforcementLevel === 'security_only') continue;
    if (
      user.verificationEnforcementLevel === 'reduced_reach' &&
      !shouldShowReducedReach(viewerId as string, user._id as string)
    ) {
      continue;
    }

    filteredUsers.push({ user, age: userAge, distance });
  }

  const photoResults = await Promise.all(
    filteredUsers.map(({ user }) =>
      ctx.db
        .query('photos')
        .withIndex('by_user_order', (q) => q.eq('userId', user._id))
        .collect()
    ),
  );

  const candidates: ExploreCandidate[] = [];
  for (let i = 0; i < filteredUsers.length; i++) {
    const { user, age, distance } = filteredUsers[i];
    const publicPhotos = sanitizePublicPhotos(photoResults[i]);
    if (publicPhotos.length === 0) continue;

    const candidate: ExploreCandidate = {
      id: user._id,
      name: user.name,
      age,
      gender: user.gender,
      bio: user.bio,
      isVerified: user.isVerified,
      verificationStatus: user.verificationStatus || 'unverified',
      city: user.city,
      distance,
      lastActive: getPublicLastActive(user),
      lookingFor: user.lookingFor,
      relationshipIntent: user.relationshipIntent,
      activities: user.activities,
      profilePrompts: user.profilePrompts ?? [],
      photos: publicPhotos,
      photoBlurred: user.photoBlurred === true,
      photoCount: publicPhotos.length,
      createdAt: user.createdAt,
      isIncognito: user.incognitoMode === true,
    };

    if (categoryId && !matchesExploreCategory(candidate, categoryId)) {
      continue;
    }

    candidates.push(candidate);
  }

  return {
    currentUser,
    candidates: sortExploreCandidates(candidates, currentUser, categoryId),
  };
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
    authUserId: v.string(),
    categoryId: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireAuthenticatedUser(ctx, args.authUserId);
    const categoryId = isExploreCategoryId(args.categoryId) ? args.categoryId : undefined;
    const { limit, offset = 0 } = args;

    const result = await buildEligibleExploreCandidates(ctx, viewerId, categoryId);
    if (!result) {
      return { profiles: [], totalCount: 0 };
    }

    const start = Math.max(0, offset);
    const end = typeof limit === 'number' ? start + limit : undefined;
    return {
      profiles: result.candidates.slice(start, end),
      totalCount: result.candidates.length,
    };
  },
});

// ---------------------------------------------------------------------------
// getExploreCategoryCounts — accurate badge numbers for the explore grid
// ---------------------------------------------------------------------------

export const getExploreCategoryCounts = query({
  args: {
    authUserId: v.string(),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireAuthenticatedUser(ctx, args.authUserId);
    const result = await buildEligibleExploreCandidates(ctx, viewerId);
    if (!result) {
      return { counts: {}, totalEligibleCount: 0 };
    }

    const counts: Record<string, number> = {};
    for (const categoryId of EXPLORE_CATEGORY_IDS) {
      counts[categoryId] = result.candidates.filter((candidate) => matchesExploreCategory(candidate, categoryId)).length;
    }

    return {
      counts,
      totalEligibleCount: result.candidates.length,
    };
  },
});

// Backward-compatible legacy helper for any older Explore callers.
export const getFilterCounts = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const intentCounts: Record<string, number> = {};
    const activityCounts: Record<string, number> = {};

    const viewerId = await requireAuthenticatedUser(ctx, args.authUserId);
    const result = await buildEligibleExploreCandidates(ctx, viewerId);
    if (!result) {
      return { intentCounts, activityCounts, categoryCounts: {} };
    }

    const categoryCounts: Record<string, number> = {};
    for (const categoryId of EXPLORE_CATEGORY_IDS) {
      categoryCounts[categoryId] = result.candidates.filter((candidate) => matchesExploreCategory(candidate, categoryId)).length;
    }

    for (const candidate of result.candidates) {
      for (const intent of candidate.relationshipIntent) {
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
      }
      for (const activity of candidate.activities) {
        activityCounts[activity] = (activityCounts[activity] || 0) + 1;
      }
    }

    return {
      intentCounts,
      activityCounts,
      categoryCounts,
    };
  },
});
