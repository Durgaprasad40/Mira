import { v } from 'convex/values';
import { query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Check if a user is actively paused (pause not expired)
function isUserPaused(user: { isDiscoveryPaused?: boolean; discoveryPausedUntil?: number }): boolean {
  return (
    user.isDiscoveryPaused === true &&
    typeof user.discoveryPausedUntil === 'number' &&
    user.discoveryPausedUntil > Date.now()
  );
}

// Get profiles for discover/swiping
export const getDiscoverProfiles = query({
  args: {
    userId: v.id('users'),
    sortBy: v.optional(v.union(
      v.literal('recommended'),
      v.literal('distance'),
      v.literal('age'),
      v.literal('recently_active'),
      v.literal('newest')
    )),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, sortBy = 'recommended', limit = 20, offset = 0 } = args;

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return [];

    // If current user is paused, return no profiles
    if (isUserPaused(currentUser)) return [];

    // Get all users who match preferences
    const allUsers = await ctx.db.query('users').collect();

    // Filter users
    const candidates = [];

    for (const user of allUsers) {
      // Skip self
      if (user._id === userId) continue;

      // Skip inactive or banned
      if (!user.isActive || user.isBanned) continue;

      // Skip paused users
      if (isUserPaused(user)) continue;

      // Skip users in incognito (unless current user is premium or female)
      if (user.incognitoMode) {
        const canSeeIncognito =
          currentUser.gender === 'female' ||
          currentUser.subscriptionTier === 'premium';
        if (!canSeeIncognito) continue;
      }

      // Check gender preference match (both ways)
      if (!currentUser.lookingFor.includes(user.gender)) continue;
      if (!user.lookingFor.includes(currentUser.gender)) continue;

      // Check age range
      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;

      const currentUserAge = calculateAge(currentUser.dateOfBirth);
      if (currentUserAge < user.minAge || currentUserAge > user.maxAge) continue;

      // Check distance
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        const distance = calculateDistance(
          currentUser.latitude,
          currentUser.longitude,
          user.latitude,
          user.longitude
        );
        if (distance > currentUser.maxDistance) continue;
      }

      // Check if already swiped (passes expire after 7 days)
      const existingLike = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', user._id)
        )
        .first();

      if (existingLike) {
        // Likes and super_likes are permanent exclusions
        if (existingLike.action !== 'pass') continue;
        // Passes only exclude for 7 days
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (existingLike.createdAt > Date.now() - sevenDaysMs) continue;
        // Pass expired — profile can reappear
      }

      // Check if blocked
      const blocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', userId).eq('blockedUserId', user._id)
        )
        .first();

      if (blocked) continue;

      const reverseBlocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', user._id).eq('blockedUserId', userId)
        )
        .first();

      if (reverseBlocked) continue;

      // Get photos
      const photos = await ctx.db
        .query('photos')
        .withIndex('by_user_order', (q) => q.eq('userId', user._id))
        .collect();

      // Hard filter: skip users with 0 non-NSFW photos
      const nonNsfwPhotos = photos.filter(p => !p.isNsfw);
      if (nonNsfwPhotos.length === 0) continue;

      // Reduced visibility: if enforcement is reduced_reach, include with 50% probability
      if (user.verificationEnforcementLevel === 'reduced_reach' && Math.random() > 0.5) continue;

      // Full skip: if enforcement is security_only, exclude from discover
      if (user.verificationEnforcementLevel === 'security_only') continue;

      // Calculate distance for display
      let distance: number | undefined;
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        distance = calculateDistance(
          currentUser.latitude,
          currentUser.longitude,
          user.latitude,
          user.longitude
        );
      }

      // Check if they liked current user
      const theyLikedMe = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', user._id).eq('toUserId', userId)
        )
        .first();

      // Compute profile quality score
      const profileQuality = computeProfileQualityScore(user, photos);

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
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        photos: photos.sort((a, b) => a.order - b.order),
        isBoosted: user.boostedUntil && user.boostedUntil > Date.now(),
        theyLikedMe: !!theyLikedMe,
        profileQualityScore: profileQuality,
      });
    }

    // Sort candidates
    candidates.sort((a, b) => {
      // Boosted profiles first
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;

      // Then by sort preference
      switch (sortBy) {
        case 'distance':
          return (a.distance || 999) - (b.distance || 999);
        case 'age':
          return a.age - b.age;
        case 'recently_active':
          return b.lastActive - a.lastActive;
        case 'newest':
          return b.createdAt - a.createdAt;
        case 'recommended':
        default:
          return calculateRecommendedScore(b, currentUser) - calculateRecommendedScore(a, currentUser);
      }
    });

    return candidates.slice(offset, offset + limit);
  },
});

// Get explore profiles with filters
export const getExploreProfiles = query({
  args: {
    userId: v.id('users'),
    genderFilter: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('other')))),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
    relationshipIntent: v.optional(v.array(v.union(
      v.literal('long_term'),
      v.literal('short_term'),
      v.literal('fwb'),
      v.literal('figuring_out'),
      v.literal('short_to_long'),
      v.literal('long_to_short'),
      v.literal('new_friends'),
      v.literal('open_to_anything')
    ))),
    activities: v.optional(v.array(v.union(
      v.literal('coffee'),
      v.literal('date_night'),
      v.literal('sports'),
      v.literal('movies'),
      v.literal('free_tonight'),
      v.literal('foodie'),
      v.literal('gym_partner'),
      v.literal('concerts'),
      v.literal('travel'),
      v.literal('outdoors'),
      v.literal('art_culture'),
      v.literal('gaming'),
      v.literal('nightlife'),
      v.literal('brunch'),
      v.literal('study_date'),
      v.literal('this_weekend'),
      v.literal('beach_pool'),
      v.literal('road_trip'),
      v.literal('photography'),
      v.literal('volunteering')
    ))),
    sortByInterests: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      userId,
      genderFilter,
      minAge,
      maxAge,
      maxDistance,
      relationshipIntent,
      activities,
      sortByInterests,
      limit = 20,
      offset = 0,
    } = args;

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return { profiles: [], totalCount: 0 };

    // If current user is paused, return no profiles
    if (isUserPaused(currentUser)) return { profiles: [], totalCount: 0 };

    // Use provided filters or user preferences
    const effectiveGender = genderFilter || currentUser.lookingFor;
    const effectiveMinAge = minAge ?? currentUser.minAge;
    const effectiveMaxAge = maxAge ?? currentUser.maxAge;
    const effectiveMaxDistance = maxDistance ?? currentUser.maxDistance;

    const allUsers = await ctx.db.query('users').collect();
    const candidates = [];

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;

      // Skip paused users
      if (isUserPaused(user)) continue;

      // Gender filter
      if (!effectiveGender.includes(user.gender)) continue;

      // Age filter
      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < effectiveMinAge || userAge > effectiveMaxAge) continue;

      // Distance filter
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        const distance = calculateDistance(
          currentUser.latitude,
          currentUser.longitude,
          user.latitude,
          user.longitude
        );
        if (distance > effectiveMaxDistance) continue;
      }

      // Relationship intent filter (OR logic)
      if (relationshipIntent && relationshipIntent.length > 0) {
        const hasMatchingIntent = relationshipIntent.some((intent) =>
          user.relationshipIntent.includes(intent)
        );
        if (!hasMatchingIntent) continue;
      }

      // Activities filter (OR logic)
      if (activities && activities.length > 0) {
        const hasMatchingActivity = activities.some((activity) =>
          user.activities.includes(activity)
        );
        if (!hasMatchingActivity) continue;
      }

      // Check blocked
      const blocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', userId).eq('blockedUserId', user._id)
        )
        .first();
      if (blocked) continue;

      // Get photos
      const photos = await ctx.db
        .query('photos')
        .withIndex('by_user_order', (q) => q.eq('userId', user._id))
        .collect();

      let distance: number | undefined;
      if (currentUser.latitude && currentUser.longitude && user.latitude && user.longitude) {
        distance = calculateDistance(
          currentUser.latitude,
          currentUser.longitude,
          user.latitude,
          user.longitude
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
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        photos: photos.sort((a, b) => a.order - b.order),
      });
    }

    // Sort by shared interests with current user
    if (sortByInterests && currentUser.activities.length > 0) {
      candidates.sort((a, b) => {
        const sharedA = a.activities.filter((act) => currentUser.activities.includes(act)).length;
        const sharedB = b.activities.filter((act) => currentUser.activities.includes(act)).length;
        return sharedB - sharedA;
      });
    } else if ((relationshipIntent && relationshipIntent.length > 0) || (activities && activities.length > 0)) {
      // Sort by relevance (more matching filters = higher score)
      candidates.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        if (relationshipIntent) {
          scoreA += relationshipIntent.filter((i) => a.relationshipIntent.includes(i)).length;
          scoreB += relationshipIntent.filter((i) => b.relationshipIntent.includes(i)).length;
        }

        if (activities) {
          scoreA += activities.filter((act) => a.activities.includes(act)).length;
          scoreB += activities.filter((act) => b.activities.includes(act)).length;
        }

        return scoreB - scoreA;
      });
    }

    return {
      profiles: candidates.slice(offset, offset + limit),
      totalCount: candidates.length,
    };
  },
});

// Get filter counts (for showing badge numbers on filters)
export const getFilterCounts = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return {};

    const allUsers = await ctx.db.query('users').collect();

    // Count by relationship intent
    const intentCounts: Record<string, number> = {};
    const activityCounts: Record<string, number> = {};

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;
      if (!currentUser.lookingFor.includes(user.gender)) continue;

      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;

      // Count intents
      for (const intent of user.relationshipIntent) {
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
      }

      // Count activities
      for (const activity of user.activities) {
        activityCounts[activity] = (activityCounts[activity] || 0) + 1;
      }
    }

    return { intentCounts, activityCounts };
  },
});

// Profile quality score computation
function computeProfileQualityScore(
  user: { bio: string; height?: number; jobTitle?: string; education?: string; profilePrompts?: { question: string; answer: string }[] },
  photos: { hasFace: boolean; isNsfw: boolean }[]
): number {
  let score = 0;

  // Photos (0-40pts): +10 per photo up to 3, +10 for at least 1 face photo
  const nonNsfwPhotos = photos.filter(p => !p.isNsfw);
  score += Math.min(nonNsfwPhotos.length, 3) * 10;
  if (nonNsfwPhotos.some(p => p.hasFace)) score += 10;

  // Bio (0-20pts): +10 for >=20 chars, +10 for >=100 chars
  if (user.bio && user.bio.length >= 20) score += 10;
  if (user.bio && user.bio.length >= 100) score += 10;

  // Completeness (0-20pts): +5 each for height, jobTitle, education, profilePrompts
  if (user.height) score += 5;
  if (user.jobTitle) score += 5;
  if (user.education) score += 5;
  if (user.profilePrompts && user.profilePrompts.length > 0) score += 5;

  return score;
}

// Enhanced recommended scoring
function calculateRecommendedScore(
  candidate: {
    theyLikedMe: boolean;
    isVerified: boolean;
    verificationStatus?: string;
    lastActive: number;
    distance?: number;
    bio: string;
    photos: any[];
    activities: string[];
    relationshipIntent: string[];
    height?: number;
    jobTitle?: string;
    education?: string;
    religion?: string;
    profileQualityScore?: number;
  },
  currentUser: {
    activities: string[];
    relationshipIntent: string[];
  }
): number {
  let score = 0;

  // Existing factors
  if (candidate.theyLikedMe) score += 100;

  // Verification-based scoring (replaces flat isVerified: +20)
  if (candidate.verificationStatus === 'verified') score += 25;
  else if (candidate.verificationStatus === 'pending_verification') score += 10;

  // Profile quality contribution (0-20pts, scaled from 0-80 quality score)
  if (candidate.profileQualityScore) {
    score += Math.round((candidate.profileQualityScore / 80) * 20);
  }

  const hourAgo = Date.now() - 60 * 60 * 1000;
  if (candidate.lastActive > hourAgo) score += 30;

  if (candidate.bio && candidate.bio.length > 50) score += 10;
  if (candidate.photos.length >= 3) score += 10;

  // New: Common interests (0-25pts)
  const sharedActivities = candidate.activities.filter((a) =>
    currentUser.activities.includes(a)
  );
  score += Math.min(sharedActivities.length * 5, 25);

  // New: Relationship intent alignment (0-20pts)
  const intentCompatMap: Record<string, string[]> = {
    long_term: ['long_term', 'short_to_long'],
    short_term: ['short_term', 'long_to_short', 'fwb'],
    fwb: ['fwb', 'short_term'],
    figuring_out: ['figuring_out', 'open_to_anything'],
    short_to_long: ['short_to_long', 'long_term', 'short_term'],
    long_to_short: ['long_to_short', 'short_term'],
    new_friends: ['new_friends', 'open_to_anything'],
    open_to_anything: ['open_to_anything', 'figuring_out', 'new_friends'],
  };
  let bestIntentScore = 0;
  for (const myIntent of currentUser.relationshipIntent) {
    for (const theirIntent of candidate.relationshipIntent) {
      if (myIntent === theirIntent) {
        bestIntentScore = Math.max(bestIntentScore, 20);
      } else if (intentCompatMap[myIntent]?.includes(theirIntent)) {
        bestIntentScore = Math.max(bestIntentScore, 10);
      }
    }
  }
  score += bestIntentScore;

  // New: Activity recency (0-15pts)
  const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
  if (candidate.lastActive > fourHoursAgo) score += 15;

  // New: Profile completeness depth (0-15pts)
  let completeness = 0;
  if (candidate.bio && candidate.bio.length > 100) completeness += 3;
  else if (candidate.bio && candidate.bio.length > 50) completeness += 2;
  if (candidate.height) completeness += 2;
  if (candidate.jobTitle) completeness += 2;
  if (candidate.education) completeness += 2;
  if (candidate.religion) completeness += 2;
  if (candidate.photos.length >= 4) completeness += 2;
  else if (candidate.photos.length >= 2) completeness += 1;
  score += Math.min(completeness, 15);

  // New: Distance gradient (0-10pts) — replaces binary <10mi check
  if (candidate.distance !== undefined) {
    if (candidate.distance < 2) score += 10;
    else if (candidate.distance < 5) score += 8;
    else if (candidate.distance < 10) score += 5;
    else if (candidate.distance < 20) score += 2;
  }

  return score;
}

// Helper functions
function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
