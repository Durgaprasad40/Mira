import { v } from 'convex/values';
import { query } from './_generated/server';
import { Id } from './_generated/dataModel';

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

    // Get all users who match preferences
    const allUsers = await ctx.db.query('users').collect();

    // Filter users
    const candidates = [];

    for (const user of allUsers) {
      // Skip self
      if (user._id === userId) continue;

      // Skip inactive or banned
      if (!user.isActive || user.isBanned) continue;

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

      // Check if already swiped
      const existingLike = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', user._id)
        )
        .first();

      if (existingLike) continue;

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
        city: user.city,
        distance,
        lastActive: user.lastActive,
        createdAt: user.createdAt,
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        photos: photos.sort((a, b) => a.order - b.order),
        isBoosted: user.boostedUntil && user.boostedUntil > Date.now(),
        theyLikedMe: !!theyLikedMe,
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
          // Recommended: mix of factors
          let scoreA = 0;
          let scoreB = 0;

          // Boost users who liked you
          if (a.theyLikedMe) scoreA += 100;
          if (b.theyLikedMe) scoreB += 100;

          // Prefer verified users
          if (a.isVerified) scoreA += 20;
          if (b.isVerified) scoreB += 20;

          // Prefer recently active
          const hourAgo = Date.now() - 60 * 60 * 1000;
          if (a.lastActive > hourAgo) scoreA += 30;
          if (b.lastActive > hourAgo) scoreB += 30;

          // Prefer closer distance
          if (a.distance && a.distance < 10) scoreA += 15;
          if (b.distance && b.distance < 10) scoreB += 15;

          // Prefer complete profiles
          if (a.bio && a.bio.length > 50) scoreA += 10;
          if (b.bio && b.bio.length > 50) scoreB += 10;

          if (a.photos.length >= 3) scoreA += 10;
          if (b.photos.length >= 3) scoreB += 10;

          return scoreB - scoreA;
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
      limit = 20,
      offset = 0,
    } = args;

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return { profiles: [], totalCount: 0 };

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

    // Sort by relevance (more matching filters = higher score)
    if ((relationshipIntent && relationshipIntent.length > 0) || (activities && activities.length > 0)) {
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
