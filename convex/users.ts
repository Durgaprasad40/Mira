import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Get current user profile
export const getCurrentUser = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    // Get user's photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', args.userId))
      .collect();

    return {
      ...user,
      photos: photos.sort((a, b) => a.order - b.order),
    };
  },
});

// Get user by ID (for viewing profiles)
export const getUserById = query({
  args: {
    userId: v.id('users'),
    viewerId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isActive || user.isBanned) return null;

    // Check if blocked
    const blocked = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.userId).eq('blockedUserId', args.viewerId)
      )
      .first();

    if (blocked) return null;

    const reverseBlocked = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.viewerId).eq('blockedUserId', args.userId)
      )
      .first();

    if (reverseBlocked) return null;

    // Get photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', args.userId))
      .collect();

    // Calculate distance if both have location
    const viewer = await ctx.db.get(args.viewerId);
    let distance: number | undefined;
    if (user.latitude && user.longitude && viewer?.latitude && viewer?.longitude) {
      distance = calculateDistance(
        user.latitude,
        user.longitude,
        viewer.latitude,
        viewer.longitude
      );
    }

    // Return public profile data
    return {
      id: user._id,
      name: user.name,
      age: calculateAge(user.dateOfBirth),
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
      relationshipIntent: user.relationshipIntent,
      activities: user.activities,
      photos: photos.sort((a, b) => a.order - b.order),
    };
  },
});

// Update user profile
export const updateProfile = mutation({
  args: {
    userId: v.id('users'),
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    height: v.optional(v.number()),
    smoking: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('trying_to_quit'))),
    drinking: v.optional(v.union(v.literal('never'), v.literal('socially'), v.literal('regularly'), v.literal('sober'))),
    kids: v.optional(v.union(
      v.literal('have_and_want_more'),
      v.literal('have_and_dont_want_more'),
      v.literal('dont_have_and_want'),
      v.literal('dont_have_and_dont_want'),
      v.literal('not_sure')
    )),
    education: v.optional(v.union(
      v.literal('high_school'),
      v.literal('some_college'),
      v.literal('bachelors'),
      v.literal('masters'),
      v.literal('doctorate'),
      v.literal('trade_school'),
      v.literal('other')
    )),
    religion: v.optional(v.union(
      v.literal('christian'),
      v.literal('muslim'),
      v.literal('hindu'),
      v.literal('buddhist'),
      v.literal('jewish'),
      v.literal('sikh'),
      v.literal('atheist'),
      v.literal('agnostic'),
      v.literal('spiritual'),
      v.literal('other'),
      v.literal('prefer_not_to_say')
    )),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    school: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const { userId, ...updates } = args;

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(userId, cleanUpdates);
    return { success: true };
  },
});

// Update preferences
export const updatePreferences = mutation({
  args: {
    userId: v.id('users'),
    lookingFor: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('other')))),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, ...updates } = args;

    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(userId, cleanUpdates);
    return { success: true };
  },
});

// Update location
export const updateLocation = mutation({
  args: {
    userId: v.id('users'),
    latitude: v.number(),
    longitude: v.number(),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, latitude, longitude, city } = args;

    await ctx.db.patch(userId, {
      latitude,
      longitude,
      city,
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

// Toggle incognito mode
export const toggleIncognito = mutation({
  args: {
    userId: v.id('users'),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId, enabled } = args;

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // Check if user has incognito access
    const hasFullAccess =
      user.gender === 'female' ||
      user.subscriptionTier === 'premium';

    if (!hasFullAccess && enabled) {
      // Limited or partial access
      if (user.subscriptionTier === 'free') {
        throw new Error('Upgrade to use incognito mode');
      }
    }

    await ctx.db.patch(userId, { incognitoMode: enabled });
    return { success: true };
  },
});

// Complete onboarding step
export const completeOnboardingStep = mutation({
  args: {
    userId: v.id('users'),
    step: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { userId, step, data } = args;

    const updates: Record<string, unknown> = {
      onboardingStep: step,
    };

    // Merge any additional data
    if (data) {
      Object.assign(updates, data);
    }

    // Check if this is the final step
    if (step === 'completed') {
      updates.onboardingCompleted = true;
      updates.onboardingStep = undefined;
    }

    await ctx.db.patch(userId, updates);
    return { success: true };
  },
});

// Update push token
export const updatePushToken = mutation({
  args: {
    userId: v.id('users'),
    pushToken: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      pushToken: args.pushToken,
      notificationsEnabled: true,
    });
    return { success: true };
  },
});

// Mark user as verified
export const markVerified = mutation({
  args: {
    userId: v.id('users'),
    verificationPhotoId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      isVerified: true,
      verificationPhotoId: args.verificationPhotoId,
      verificationCompletedAt: Date.now(),
    });
    return { success: true };
  },
});

// Block user
export const blockUser = mutation({
  args: {
    blockerId: v.id('users'),
    blockedUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { blockerId, blockedUserId } = args;

    // Check if already blocked
    const existing = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', blockerId).eq('blockedUserId', blockedUserId)
      )
      .first();

    if (existing) return { success: true };

    await ctx.db.insert('blocks', {
      blockerId,
      blockedUserId,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Unblock user
export const unblockUser = mutation({
  args: {
    blockerId: v.id('users'),
    blockedUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { blockerId, blockedUserId } = args;

    const block = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', blockerId).eq('blockedUserId', blockedUserId)
      )
      .first();

    if (block) {
      await ctx.db.delete(block._id);
    }

    return { success: true };
  },
});

// Report user
export const reportUser = mutation({
  args: {
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    reason: v.union(
      v.literal('fake_profile'),
      v.literal('inappropriate_photos'),
      v.literal('harassment'),
      v.literal('spam'),
      v.literal('underage'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { reporterId, reportedUserId, reason, description } = args;

    await ctx.db.insert('reports', {
      reporterId,
      reportedUserId,
      reason,
      description,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Deactivate account
export const deactivateAccount = mutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { isActive: false });
    return { success: true };
  },
});

// Reactivate account
export const reactivateAccount = mutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { isActive: true, lastActive: Date.now() });
    return { success: true };
  },
});

// Helper function to calculate age
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

// Helper function to calculate distance in miles
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
