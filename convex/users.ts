import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Get current user profile
export const getCurrentUser = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    // Get user's photos
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_user_order", (q) => q.eq("userId", args.userId))
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
    userId: v.id("users"),
    viewerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isActive || user.isBanned) return null;

    // Check if blocked
    const blocked = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", args.userId).eq("blockedUserId", args.viewerId),
      )
      .first();

    if (blocked) return null;

    const reverseBlocked = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", args.viewerId).eq("blockedUserId", args.userId),
      )
      .first();

    if (reverseBlocked) return null;

    // Get photos
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_user_order", (q) => q.eq("userId", args.userId))
      .collect();

    // Calculate distance if both have location
    const viewer = await ctx.db.get(args.viewerId);
    let distance: number | undefined;
    if (
      user.latitude &&
      user.longitude &&
      viewer?.latitude &&
      viewer?.longitude
    ) {
      distance = calculateDistance(
        user.latitude,
        user.longitude,
        viewer.latitude,
        viewer.longitude,
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
      verificationStatus: user.verificationStatus || "unverified",
      city: user.city,
      distance,
      lastActive: user.lastActive,
      relationshipIntent: user.relationshipIntent,
      activities: user.activities,
      profilePrompts: user.profilePrompts ?? [],
      photos: photos.sort((a, b) => a.order - b.order),
      photoBlurred: user.photoBlurred === true,
    };
  },
});

// Update profile prompts (icebreakers)
export const updateProfilePrompts = mutation({
  args: {
    userId: v.id("users"),
    prompts: v.array(v.object({
      question: v.string(),
      answer: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    // Max 3 prompts, answer max 200 chars
    const cleaned = args.prompts.slice(0, 3).map((p) => ({
      question: p.question.slice(0, 100),
      answer: p.answer.slice(0, 200),
    }));

    await ctx.db.patch(args.userId, { profilePrompts: cleaned });
    return { success: true };
  },
});

// Update user profile
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    height: v.optional(v.number()),
    smoking: v.optional(
      v.union(
        v.literal("never"),
        v.literal("sometimes"),
        v.literal("regularly"),
        v.literal("trying_to_quit"),
      ),
    ),
    drinking: v.optional(
      v.union(
        v.literal("never"),
        v.literal("socially"),
        v.literal("regularly"),
        v.literal("sober"),
      ),
    ),
    kids: v.optional(
      v.union(
        v.literal("have_and_want_more"),
        v.literal("have_and_dont_want_more"),
        v.literal("dont_have_and_want"),
        v.literal("dont_have_and_dont_want"),
        v.literal("not_sure"),
      ),
    ),
    education: v.optional(
      v.union(
        v.literal("high_school"),
        v.literal("some_college"),
        v.literal("bachelors"),
        v.literal("masters"),
        v.literal("doctorate"),
        v.literal("trade_school"),
        v.literal("other"),
      ),
    ),
    religion: v.optional(
      v.union(
        v.literal("christian"),
        v.literal("muslim"),
        v.literal("hindu"),
        v.literal("buddhist"),
        v.literal("jewish"),
        v.literal("sikh"),
        v.literal("atheist"),
        v.literal("agnostic"),
        v.literal("spiritual"),
        v.literal("other"),
        v.literal("prefer_not_to_say"),
      ),
    ),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    school: v.optional(v.string()),
    relationshipIntent: v.optional(
      v.array(
        v.union(
          v.literal("long_term"),
          v.literal("short_term"),
          v.literal("fwb"),
          v.literal("figuring_out"),
          v.literal("short_to_long"),
          v.literal("long_to_short"),
          v.literal("new_friends"),
          v.literal("open_to_anything"),
        ),
      ),
    ),
    activities: v.optional(
      v.array(
        v.union(
          v.literal("coffee"),
          v.literal("date_night"),
          v.literal("sports"),
          v.literal("movies"),
          v.literal("free_tonight"),
          v.literal("foodie"),
          v.literal("gym_partner"),
          v.literal("concerts"),
          v.literal("travel"),
          v.literal("outdoors"),
          v.literal("art_culture"),
          v.literal("gaming"),
          v.literal("nightlife"),
          v.literal("brunch"),
          v.literal("study_date"),
          v.literal("this_weekend"),
          v.literal("beach_pool"),
          v.literal("road_trip"),
          v.literal("photography"),
          v.literal("volunteering"),
        ),
      ),
    ),
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
    userId: v.id("users"),
    lookingFor: v.optional(
      v.array(
        v.union(
          v.literal("male"),
          v.literal("female"),
          v.literal("non_binary"),
          v.literal("lesbian"),
          v.literal("other"),
        ),
      ),
    ),
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
    userId: v.id("users"),
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
    userId: v.id("users"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId, enabled } = args;

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    // Check if user has incognito access
    const hasFullAccess =
      user.gender === "female" || user.subscriptionTier === "premium";

    if (!hasFullAccess && enabled) {
      // Limited or partial access
      if (user.subscriptionTier === "free") {
        throw new Error("Upgrade to use incognito mode");
      }
    }

    await ctx.db.patch(userId, { incognitoMode: enabled });
    return { success: true };
  },
});

// Toggle discovery pause
export const toggleDiscoveryPause = mutation({
  args: {
    userId: v.id("users"),
    paused: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId, paused } = args;

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    if (paused) {
      await ctx.db.patch(userId, {
        isDiscoveryPaused: true,
        discoveryPausedUntil: Date.now() + 24 * 60 * 60 * 1000,
      });
    } else {
      await ctx.db.patch(userId, {
        isDiscoveryPaused: false,
        discoveryPausedUntil: undefined,
      });
    }

    return { success: true };
  },
});

// Complete onboarding step
export const completeOnboardingStep = mutation({
  args: {
    userId: v.id("users"),
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
    if (step === "completed") {
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
    userId: v.id("users"),
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
    userId: v.id("users"),
    verificationPhotoId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      isVerified: true,
      verificationPhotoId: args.verificationPhotoId,
      verificationCompletedAt: Date.now(),
      verificationStatus: "verified",
      verificationEnforcementLevel: "none",
    });
    return { success: true };
  },
});

// Block user
export const blockUser = mutation({
  args: {
    blockerId: v.id("users"),
    blockedUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { blockerId, blockedUserId } = args;

    // Check if already blocked
    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", blockerId).eq("blockedUserId", blockedUserId),
      )
      .first();

    if (existing) return { success: true };

    await ctx.db.insert("blocks", {
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
    blockerId: v.id("users"),
    blockedUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { blockerId, blockedUserId } = args;

    const block = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", blockerId).eq("blockedUserId", blockedUserId),
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
    reporterId: v.id("users"),
    reportedUserId: v.id("users"),
    reason: v.union(
      v.literal("fake_profile"),
      v.literal("inappropriate_photos"),
      v.literal("harassment"),
      v.literal("spam"),
      v.literal("underage"),
      v.literal("other"),
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { reporterId, reportedUserId, reason, description } = args;
    const now = Date.now();

    await ctx.db.insert("reports", {
      reporterId,
      reportedUserId,
      reason,
      description,
      status: "pending",
      createdAt: now,
    });

    // Count distinct reporters for this user
    const allReports = await ctx.db
      .query("reports")
      .withIndex("by_reported_user", (q) =>
        q.eq("reportedUserId", reportedUserId)
      )
      .collect();

    const distinctReporters = new Set(allReports.map((r) => r.reporterId));

    if (distinctReporters.size >= 3) {
      // Check if already flagged
      const existingFlag = await ctx.db
        .query("behaviorFlags")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", reportedUserId).eq("flagType", "reported_by_multiple")
        )
        .first();

      if (!existingFlag) {
        await ctx.db.insert("behaviorFlags", {
          userId: reportedUserId,
          flagType: "reported_by_multiple",
          severity: distinctReporters.size >= 5 ? "high" : "medium",
          description: `Reported by ${distinctReporters.size} distinct users`,
          createdAt: now,
        });

        // Force security_only if 5+ reporters
        if (distinctReporters.size >= 5) {
          await ctx.db.patch(reportedUserId, {
            verificationEnforcementLevel: "security_only",
          });
        }
      }
    }

    return { success: true };
  },
});

// Deactivate account
export const deactivateAccount = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { isActive: false });
    return { success: true };
  },
});

// Reactivate account
export const reactivateAccount = mutation({
  args: {
    userId: v.id("users"),
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

// Helper function to calculate distance in km
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
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

// Complete onboarding with all user data
export const completeOnboarding = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    gender: v.optional(
      v.union(
        v.literal("male"),
        v.literal("female"),
        v.literal("non_binary"),
        v.literal("lesbian"),
        v.literal("other"),
      ),
    ),
    bio: v.optional(v.string()),
    height: v.optional(v.number()),
    weight: v.optional(v.number()),
    smoking: v.optional(
      v.union(
        v.literal("never"),
        v.literal("sometimes"),
        v.literal("regularly"),
        v.literal("trying_to_quit"),
      ),
    ),
    drinking: v.optional(
      v.union(
        v.literal("never"),
        v.literal("socially"),
        v.literal("regularly"),
        v.literal("sober"),
      ),
    ),
    kids: v.optional(
      v.union(
        v.literal("have_and_want_more"),
        v.literal("have_and_dont_want_more"),
        v.literal("dont_have_and_want"),
        v.literal("dont_have_and_dont_want"),
        v.literal("not_sure"),
      ),
    ),
    exercise: v.optional(
      v.union(
        v.literal("never"),
        v.literal("sometimes"),
        v.literal("regularly"),
        v.literal("daily"),
      ),
    ),
    pets: v.optional(
      v.array(
        v.union(
          v.literal("dog"),
          v.literal("cat"),
          v.literal("bird"),
          v.literal("other"),
          v.literal("none"),
          v.literal("want_pets"),
          v.literal("allergic"),
        ),
      ),
    ),
    education: v.optional(
      v.union(
        v.literal("high_school"),
        v.literal("some_college"),
        v.literal("bachelors"),
        v.literal("masters"),
        v.literal("doctorate"),
        v.literal("trade_school"),
        v.literal("other"),
      ),
    ),
    religion: v.optional(
      v.union(
        v.literal("christian"),
        v.literal("muslim"),
        v.literal("hindu"),
        v.literal("buddhist"),
        v.literal("jewish"),
        v.literal("sikh"),
        v.literal("atheist"),
        v.literal("agnostic"),
        v.literal("spiritual"),
        v.literal("other"),
        v.literal("prefer_not_to_say"),
      ),
    ),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    school: v.optional(v.string()),
    lookingFor: v.optional(
      v.array(
        v.union(
          v.literal("male"),
          v.literal("female"),
          v.literal("non_binary"),
          v.literal("lesbian"),
          v.literal("other"),
        ),
      ),
    ),
    relationshipIntent: v.optional(
      v.array(
        v.union(
          v.literal("long_term"),
          v.literal("short_term"),
          v.literal("fwb"),
          v.literal("figuring_out"),
          v.literal("short_to_long"),
          v.literal("long_to_short"),
          v.literal("new_friends"),
          v.literal("open_to_anything"),
        ),
      ),
    ),
    activities: v.optional(
      v.array(
        v.union(
          v.literal("coffee"),
          v.literal("date_night"),
          v.literal("sports"),
          v.literal("movies"),
          v.literal("free_tonight"),
          v.literal("foodie"),
          v.literal("gym_partner"),
          v.literal("concerts"),
          v.literal("travel"),
          v.literal("outdoors"),
          v.literal("art_culture"),
          v.literal("gaming"),
          v.literal("nightlife"),
          v.literal("brunch"),
          v.literal("study_date"),
          v.literal("this_weekend"),
          v.literal("beach_pool"),
          v.literal("road_trip"),
          v.literal("photography"),
          v.literal("volunteering"),
        ),
      ),
    ),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
    photoStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const { userId, photoStorageIds, ...updates } = args;

    // Verify user exists
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    // Mark onboarding as completed
    cleanUpdates.onboardingCompleted = true;
    cleanUpdates.onboardingStep = undefined;
    cleanUpdates.lastActive = Date.now();
    cleanUpdates.verificationStatus = "unverified";
    cleanUpdates.trustScore = 50;

    // Update user profile
    await ctx.db.patch(userId, cleanUpdates);

    // Handle photos if provided
    if (photoStorageIds && photoStorageIds.length > 0) {
      // Delete existing photos and their storage files
      const existingPhotos = await ctx.db
        .query("photos")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();

      for (const photo of existingPhotos) {
        await ctx.storage.delete(photo.storageId);
        await ctx.db.delete(photo._id);
      }

      // Add new photos
      for (let i = 0; i < photoStorageIds.length; i++) {
        const storageId = photoStorageIds[i];
        const url = await ctx.storage.getUrl(storageId);

        if (url) {
          await ctx.db.insert("photos", {
            userId,
            storageId,
            url,
            order: i,
            isPrimary: i === 0,
            hasFace: true, // Assuming face detection was done
            isNsfw: false,
            createdAt: Date.now(),
          });
        }
      }
    }

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Photo Blur
// ---------------------------------------------------------------------------

/** Toggle blur on/off. No hard-block — user can always toggle freely. */
export const togglePhotoBlur = mutation({
  args: {
    userId: v.id("users"),
    blurred: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    await ctx.db.patch(args.userId, { photoBlurred: args.blurred });
    return { success: true, blurred: args.blurred };
  },
});

// ---------------------------------------------------------------------------
// Profile Completeness + Daily Nudge
// ---------------------------------------------------------------------------

const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const NUDGE_THRESHOLD = 70; // nudge if completeness < 70%
const INACTIVE_DAYS = 7; // stop nudging if user hasn't been active in 7 days

/**
 * Returns profile completeness (0–100) and a list of recommendations
 * for what to fill in next. Used by frontend for nudge banner.
 */
export const getProfileCompleteness = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { score: 0, recommendations: [] as string[] };

    const photos = await ctx.db
      .query("photos")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .collect();
    const photoCount = photos.filter((p) => !p.isNsfw).length;

    let score = 0;
    const recommendations: string[] = [];

    // Bio (0–20)
    if (user.bio && user.bio.trim().length >= 100) {
      score += 20;
    } else if (user.bio && user.bio.trim().length >= 50) {
      score += 15;
    } else if (user.bio && user.bio.trim().length > 0) {
      score += 5;
      recommendations.push("Write a longer bio for better matches");
    } else {
      recommendations.push("Add a bio to tell others about yourself");
    }

    // Prompts (0–25)
    const filledPrompts = (user.profilePrompts ?? []).filter(
      (p: { answer: string }) => p.answer.trim().length > 0,
    ).length;
    score += Math.min(filledPrompts, 3) * 8;
    if (filledPrompts >= 3) score += 1;
    if (filledPrompts < 3) {
      recommendations.push(
        `Answer ${3 - filledPrompts} more prompt${3 - filledPrompts > 1 ? "s" : ""} to stand out`,
      );
    }

    // Interests (0–15)
    if (user.activities && user.activities.length >= 3) {
      score += 15;
    } else if (user.activities && user.activities.length >= 1) {
      score += 8;
      recommendations.push("Add more interests for better matches");
    } else {
      recommendations.push("Select your interests so we can match you better");
    }

    // Photos (0–20)
    if (photoCount >= 4) score += 20;
    else if (photoCount >= 2) score += 15;
    else if (photoCount >= 1) {
      score += 10;
      recommendations.push("Add more photos — profiles with 3+ photos get more replies");
    } else {
      recommendations.push("Upload at least one photo");
    }

    // Verified (0–10)
    if (user.isVerified) score += 10;
    else recommendations.push("Verify your profile for a trust badge");

    // Optional extras (0–10)
    if (user.height) score += 3;
    if (user.jobTitle) score += 3;
    if (user.education) score += 4;

    return {
      score: Math.min(score, 100),
      recommendations: recommendations.slice(0, 3), // max 3 suggestions
    };
  },
});

/**
 * Send a daily profile-completion nudge notification.
 * Rules:
 *   - Max 1 per 24 hours
 *   - Only if completeness < 70%
 *   - Only if user was active in last 7 days
 *   - Stops once profile is complete
 */
export const sendProfileNudge = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { sent: false, reason: "user_not_found" };

    // Don't nudge inactive users (haven't opened app in 7 days)
    const inactiveCutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;
    if (user.lastActive < inactiveCutoff) {
      return { sent: false, reason: "inactive" };
    }

    // Cooldown: max 1 nudge per 24h
    if (user.lastNudgeAt && Date.now() - user.lastNudgeAt < NUDGE_COOLDOWN_MS) {
      return { sent: false, reason: "cooldown" };
    }

    // Check completeness
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .collect();
    const photoCount = photos.filter((p) => !p.isNsfw).length;

    let score = 0;
    if (user.bio && user.bio.trim().length >= 100) score += 20;
    else if (user.bio && user.bio.trim().length >= 50) score += 15;
    else if (user.bio && user.bio.trim().length > 0) score += 5;

    const filledPrompts = (user.profilePrompts ?? []).filter(
      (p: { answer: string }) => p.answer.trim().length > 0,
    ).length;
    score += Math.min(filledPrompts, 3) * 8;
    if (filledPrompts >= 3) score += 1;

    if (user.activities && user.activities.length >= 3) score += 15;
    else if (user.activities && user.activities.length >= 1) score += 8;

    if (photoCount >= 4) score += 20;
    else if (photoCount >= 2) score += 15;
    else if (photoCount >= 1) score += 10;

    if (user.isVerified) score += 10;
    if (user.height) score += 3;
    if (user.jobTitle) score += 3;
    if (user.education) score += 4;

    score = Math.min(score, 100);

    // Already complete — don't nudge
    if (score >= NUDGE_THRESHOLD) {
      return { sent: false, reason: "already_complete", score };
    }

    // Pick a positive nudge message
    const nudgeMessages = [
      "Profiles with photos + interests get more replies. Finish yours in 2 minutes.",
      "Complete your profile to get better matches — add prompts + interests.",
      "You're almost there! A complete profile is recommended for better matches.",
    ];
    const body = nudgeMessages[Math.floor(Math.random() * nudgeMessages.length)];

    // Create notification
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "profile_nudge" as any,
      title: "Complete your profile",
      body,
      createdAt: Date.now(),
    });

    // Update cooldown
    await ctx.db.patch(args.userId, { lastNudgeAt: Date.now() });

    return { sent: true, score };
  },
});

// Update enforcement level based on account age + verification status
export const updateEnforcementLevel = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    const verificationStatus = user.verificationStatus || "unverified";

    // Verified users always have no enforcement
    if (verificationStatus === "verified") {
      await ctx.db.patch(args.userId, {
        verificationEnforcementLevel: "none",
      });
      return { level: "none" };
    }

    const accountAgeDays =
      (Date.now() - user.createdAt) / (24 * 60 * 60 * 1000);

    let level: "none" | "gentle_reminder" | "reduced_reach" | "security_only";

    if (accountAgeDays < 3) {
      level = "gentle_reminder";
    } else if (accountAgeDays < 6) {
      level =
        verificationStatus === "pending_verification"
          ? "gentle_reminder"
          : "reduced_reach";
    } else {
      // Day 7+
      level =
        verificationStatus === "pending_verification"
          ? "reduced_reach"
          : "security_only";
    }

    await ctx.db.patch(args.userId, {
      verificationEnforcementLevel: level,
    });

    return { level };
  },
});
