import { v } from 'convex/values';
import { query } from './_generated/server';
import { Id } from './_generated/dataModel';

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

/** Combined weighted score. */
function rankScore(
  candidate: {
    id: string;
    lastActive: number;
    bio: string;
    profilePrompts?: { question: string; answer: string }[];
    activities: string[];
    relationshipIntent: string[];
    isVerified: boolean;
    city?: string;
    height?: number;
    jobTitle?: string;
    education?: string;
    theyLikedMe: boolean;
    isBoosted: boolean;
    photoCount: number;
  },
  currentUser: {
    _id: string;
    city?: string;
    activities: string[];
    relationshipIntent: string[];
  },
): number {
  const activity    = activityScore(candidate.lastActive);
  const complete    = completenessScore(candidate, candidate.photoCount);
  const preference  = preferenceMatchScore(candidate, currentUser);
  const rotation    = rotationScore(currentUser._id as string, candidate.id);

  let score =
    0.45 * activity +
    0.35 * complete +
    0.15 * preference +
    0.05 * rotation;

  // Bonus: they already liked the viewer — surface them first
  if (candidate.theyLikedMe) score += 50;

  // Bonus: currently boosted
  if (candidate.isBoosted) score += 30;

  return score;
}

// ---------------------------------------------------------------------------
// getDiscoverProfiles — main swipe deck query
// ---------------------------------------------------------------------------

export const getDiscoverProfiles = query({
  args: {
    userId: v.id('users'),
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
    const { userId, sortBy = 'recommended', limit = 20, offset = 0 } = args;
    // filterVersion intentionally unused — it's only to bust query cache

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

      // 8A: Filter out unverified/rejected users from Discover
      const verificationStatus = user.verificationStatus || 'unverified';
      if (verificationStatus !== 'verified') continue;

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
      });
    }

    // Sort
    if (sortBy === 'recommended') {
      candidates.sort((a, b) => rankScore(b, currentUser) - rankScore(a, currentUser));
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

    const allUsers = await ctx.db.query('users').collect();
    const candidates = [];

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;

      // 8A: Filter out unverified/rejected users from Explore
      const verificationStatus = user.verificationStatus || 'unverified';
      if (verificationStatus !== 'verified') continue;

      if (!effectiveGender.includes(user.gender)) continue;

      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < effectiveMinAge || userAge > effectiveMaxAge) continue;

      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        const dist = calculateDistance(
          currentUser.latitude, currentUser.longitude,
          user.latitude, user.longitude,
        );
        if (!isDistanceAllowed(dist, effectiveMaxDistance)) continue;
      }

      if (relationshipIntent && relationshipIntent.length > 0) {
        if (!relationshipIntent.some((i) => user.relationshipIntent.includes(i))) continue;
      }

      if (activities && activities.length > 0) {
        if (!activities.some((a) => user.activities.includes(a))) continue;
      }

      // BUGFIX #17: Exclude users I already swiped on (likes/superlikes, passes within 7 days)
      const existingLike = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) => q.eq('fromUserId', userId).eq('toUserId', user._id))
        .first();

      if (existingLike) {
        if (existingLike.action !== 'pass') continue;
        if (existingLike.createdAt > Date.now() - 7 * 24 * 60 * 60 * 1000) continue;
      }

      // BUGFIX #17: Exclude users I'm already matched with
      const orderedUser1 = userId < user._id ? userId : user._id;
      const orderedUser2 = userId < user._id ? user._id : userId;
      const existingMatch = await ctx.db
        .query('matches')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2)
        )
        .first();

      if (existingMatch && existingMatch.isActive) continue;

      const blocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) => q.eq('blockerId', userId).eq('blockedUserId', user._id))
        .first();
      if (blocked) continue;

      // 9-8: Check reverse block (candidate blocked current user)
      const reverseBlocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) => q.eq('blockerId', user._id).eq('blockedUserId', userId))
        .first();
      if (reverseBlocked) continue;

      const photos = await ctx.db
        .query('photos')
        .withIndex('by_user_order', (q) => q.eq('userId', user._id))
        .collect();

      let distance: number | undefined;
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        distance = calculateDistance(
          currentUser.latitude, currentUser.longitude,
          user.latitude, user.longitude,
        );
      }

      candidates.push({
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
        photos: photos.sort((a, b) => a.order - b.order),
        photoBlurred: user.photoBlurred === true,
        photoCount: photos.filter((p) => !p.isNsfw).length,
      });
    }

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

    const allUsers = await ctx.db.query('users').collect();
    const intentCounts: Record<string, number> = {};
    const activityCounts: Record<string, number> = {};

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;
      if (!currentUser.lookingFor.includes(user.gender)) continue;

      // 9-7: Exclude unverified users from filter counts to match discovery queries
      const verificationStatus = user.verificationStatus || 'unverified';
      if (verificationStatus !== 'verified') continue;

      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;

      for (const intent of user.relationshipIntent) {
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
      }
      for (const activity of user.activities) {
        activityCounts[activity] = (activityCounts[activity] || 0) + 1;
      }
    }

    return { intentCounts, activityCounts };
  },
});
