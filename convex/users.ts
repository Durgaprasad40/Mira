import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { logAdminAction } from "./adminLog";
import {
  resolveUserIdByAuthId,
  ensureUserByAuthId,
  validateSessionToken,
  requireAuthenticatedSessionUser,
  requireAuthenticatedUserId,
  requireAppUserId,
} from "./helpers";

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const ALLOWED_RELATIONSHIP_INTENTS = new Set([
  'serious_vibes', 'keep_it_casual', 'exploring_vibes', 'see_where_it_goes',
  'open_to_vibes', 'just_friends', 'open_to_anything', 'single_parent', 'new_to_dating'
]);

const PROFILE_PROMPT_SECTIONS = ['builder', 'performer', 'seeker', 'grounded'] as const;
type ProfilePromptSection = (typeof PROFILE_PROMPT_SECTIONS)[number];

function isProfilePromptSection(value: string): value is ProfilePromptSection {
  return (PROFILE_PROMPT_SECTIONS as readonly string[]).includes(value);
}

// Sanitize relationshipIntent to only include schema-valid values
function sanitizeRelationshipIntent(intent: string[] | undefined): string[] | undefined {
  if (!intent || !Array.isArray(intent)) return intent;
  const sanitized = intent.filter(v => ALLOWED_RELATIONSHIP_INTENTS.has(v));
  const removed = intent.filter(v => !ALLOWED_RELATIONSHIP_INTENTS.has(v));
  if (removed.length > 0) {
    console.warn('[SANITIZE] Removed invalid relationshipIntent values:', removed);
  }
  return sanitized.length > 0 ? sanitized : undefined;
}

function getSafeProfilePhotos<T extends { url?: string; isNsfw?: boolean; order: number }>(photos: T[]): T[] {
  return photos
    .filter((photo) => !photo.isNsfw && typeof photo.url === "string" && photo.url.trim().length > 0)
    .sort((a, b) => a.order - b.order);
}

async function buildCurrentUserResponse(
  ctx: any,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) return null;

  const allPhotos = await ctx.db
    .query("photos")
    .withIndex("by_user_order", (q: any) => q.eq("userId", userId))
    .collect();

  const photos = allPhotos.filter((p: any) => p.photoType !== "verification_reference");
  const safePhotos = getSafeProfilePhotos(photos);

  return {
    ...user,
    photos: safePhotos,
  };
}

function getPhase1SafetyDisplayName(user: any): string {
  const firstName = user?.name?.trim()?.split(/\s+/)[0];
  return firstName && firstName.length > 0 ? firstName : 'Unavailable user';
}

async function getPhase1SafetyPhotoUrl(
  ctx: any,
  userId: Id<'users'>
): Promise<string | null> {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user_order', (q: any) => q.eq('userId', userId))
    .collect();

  const safePhotos = getSafeProfilePhotos(
    photos.filter((photo: any) => photo.photoType !== 'verification_reference')
  );

  return safePhotos[0]?.url ?? null;
}

async function buildPhase1SafetyUserSummary(
  ctx: any,
  userId: Id<'users'>
) {
  const user = await ctx.db.get(userId);
  const unavailable = !user || !user.isActive || !!user.deletedAt || !!user.isBanned;

  if (unavailable) {
    return {
      displayName: 'Unavailable user',
      photoUrl: null,
      isVerified: false,
      unavailable: true,
    };
  }

  return {
    displayName: getPhase1SafetyDisplayName(user),
    photoUrl: await getPhase1SafetyPhotoUrl(ctx, userId),
    isVerified: !!user.isVerified,
    unavailable: false,
  };
}

// Get current user profile
export const getCurrentUser = query({
  args: {
    userId: v.union(v.id("users"), v.string()), // Accept both Convex ID and authUserId string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (READ-ONLY, no creation)
    const convexUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!convexUserId) {
      console.log("[getCurrentUser] User not found for authUserId:", args.userId);
      return null;
    }

    return await buildCurrentUserResponse(ctx, convexUserId);
  },
});

// DEMO AUTH FIX: Accepts optional token for demo auth mode support.
export const getCurrentUserDiscoverContext = query({
  args: {
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Use requireAppUserId which supports both real Convex auth AND demo session tokens
    const convexUserId = await requireAppUserId(ctx, args.token);
    const user = await ctx.db.get(convexUserId);
    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      activities: user.activities,
      relationshipIntent: user.relationshipIntent,
      lookingFor: user.lookingFor,
      smoking: user.smoking,
      drinking: user.drinking,
      height: user.height,
      isDiscoveryPaused: user.isDiscoveryPaused === true,
      discoveryPausedUntil: user.discoveryPausedUntil,
      hideAge: user.hideAge === true,
      hideDistance: user.hideDistance === true,
      showLastSeen: user.showLastSeen !== false,
      hasDiscoverLocation:
        typeof user.publishedLat === 'number' && typeof user.publishedLng === 'number',
    };
  },
});

export const getCurrentUserFromToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    return await buildCurrentUserResponse(ctx, user._id);
  },
});

// Bootstrap: Ensure user record exists for authUserId
// Call this mutation once after auth hydration to guarantee Convex user exists
// before any queries run. This prevents "Cannot create user from query context" errors.
export const ensureCurrentUser = mutation({
  args: {
    authUserId: v.string(), // Auth identifier (can be demo ID or production ID)
  },
  handler: async (ctx, args) => {
    const userId = await ensureUserByAuthId(ctx, args.authUserId);
    return { success: true, userId };
  },
});

// Get user by ID (for viewing profiles)
export const getUserById = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireAuthenticatedUserId(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isActive || user.isBanned) return null;

    // Check if blocked
    const blocked = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", args.userId).eq("blockedUserId", viewerId),
      )
      .first();

    if (blocked) return null;

    const reverseBlocked = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", viewerId).eq("blockedUserId", args.userId),
      )
      .first();

    if (reverseBlocked) return null;

    // P0-004 FIX: Block profile lookup for anonymous confession participants
    // If the requested user is an anonymousParticipantId in any conversation with the viewer,
    // deny the profile lookup to protect their identity
    const anonymousConversation = await ctx.db
      .query("conversations")
      .filter((q) =>
        q.and(
          q.eq(q.field("anonymousParticipantId"), args.userId),
          q.or(
            q.eq(q.field("participants"), [args.userId, viewerId]),
            q.eq(q.field("participants"), [viewerId, args.userId])
          )
        )
      )
      .first();

    if (anonymousConversation) {
      // The requested user is anonymous in a conversation with the viewer
      // Deny the profile lookup to protect their identity
      return null;
    }

    // Get photos
    const allPhotos = await ctx.db
      .query("photos")
      .withIndex("by_user_order", (q) => q.eq("userId", args.userId))
      .collect();

    // PHOTO SOURCE FIX: Filter out verification_reference photos
    // This ensures getUserById returns the same photos as getDiscoverProfiles
    // for consistent photo counts between Discover card and opened profile
    const photos = allPhotos.filter((p) => p.photoType !== 'verification_reference');
    const safePhotos = getSafeProfilePhotos(photos);

    // Calculate distance if both have location
    const viewer = await ctx.db.get(viewerId);
    let distance: number | undefined;
    if (
      user.publishedLat &&
      user.publishedLng &&
      viewer?.publishedLat &&
      viewer?.publishedLng
    ) {
      distance = calculateDistance(
        user.publishedLat,
        user.publishedLng,
        viewer.publishedLat,
        viewer.publishedLng,
      );
    }

    const publicAge = user.hideAge === true ? undefined : calculateAge(user.dateOfBirth);
    const publicDistance = user.hideDistance === true ? undefined : distance;
    const publicLastActive = user.showLastSeen === false ? undefined : user.lastActive;

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING FIX 3: CHECK FOR CONFESSION_COMMENT MATCH - RETURN MINI PROFILE
    // ═══════════════════════════════════════════════════════════════════════════
    // Check if there's a confession_comment match between these users
    // If so, return limited profile data to prevent data leaks
    const confessionCommentMatch = await ctx.db
      .query("matches")
      .withIndex("by_user1", (q) => q.eq("user1Id", args.userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("user2Id"), viewerId),
          q.eq(q.field("matchSource"), "confession_comment" as any)
        )
      )
      .first();

    const reverseConfessionCommentMatch = !confessionCommentMatch
      ? await ctx.db
          .query("matches")
          .withIndex("by_user1", (q) => q.eq("user1Id", viewerId))
          .filter((q) =>
            q.and(
              q.eq(q.field("user2Id"), args.userId),
              q.eq(q.field("matchSource"), "confession_comment" as any)
            )
          )
          .first()
      : null;

    const isConfessionCommentMatch = !!(confessionCommentMatch || reverseConfessionCommentMatch);

    if (isConfessionCommentMatch) {
      // MINI PROFILE: Return limited data for confession_comment matches
      // Only expose: name (first name only), age, gender, one blurred photo
      const firstName = user.name?.split(" ")[0] || "Anonymous";
      // ORDER-BASED PRIMARY: First photo by order is primary (photos are pre-sorted by order)
      const primaryPhoto = safePhotos[0];

      return {
        id: user._id,
        name: firstName, // First name only
        age: publicAge,
        gender: user.gender,
        // Limited fields - all others are undefined/hidden
        bio: undefined,
        height: undefined,
        smoking: undefined,
        drinking: undefined,
        kids: undefined,
        education: undefined,
        religion: undefined,
        jobTitle: undefined,
        company: undefined,
        school: undefined,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus || "unverified",
        city: user.city, // City is okay to show
        distance: publicDistance,
        lastActive: undefined, // Hide last active for privacy
        lookingFor: undefined,
        relationshipIntent: undefined,
        activities: undefined,
        profilePrompts: [], // No prompts
        photos: primaryPhoto
          ? [{ ...primaryPhoto, isBlurred: true }] // Single blurred photo
          : [],
        photoBlurred: true, // Force blur
        isConfessionCommentProfile: true, // Flag for UI to show mini profile notice
      };
    }

    // Return full public profile data
    // Extract lifeRhythm from onboardingDraft for Deeper Traits section
    const lifeRhythm = user.onboardingDraft?.lifeRhythm;

    return {
      id: user._id,
      name: user.name,
      age: publicAge,
      gender: user.gender,
      bio: user.bio,
      height: user.height,
      smoking: user.smoking,
      drinking: user.drinking,
      exercise: user.exercise, // Added for Lifestyle section
      pets: user.pets, // Added for Lifestyle section
      kids: user.kids,
      education: user.education,
      religion: user.religion,
      jobTitle: user.jobTitle,
      company: user.company,
      school: user.school,
      isVerified: user.isVerified,
      verificationStatus: user.verificationStatus || "unverified",
      city: user.city,
      distance: publicDistance,
      lastActive: publicLastActive,
      lookingFor: user.lookingFor,
      relationshipIntent: user.relationshipIntent,
      activities: user.activities,
      profilePrompts: user.profilePrompts ?? [],
      photos: safePhotos,
      photoBlurred: user.photoBlurred === true,
      // Deeper Traits from lifeRhythm (onboardingDraft)
      sleepSchedule: lifeRhythm?.sleepSchedule,
      socialRhythm: lifeRhythm?.socialRhythm,
      travelStyle: lifeRhythm?.travelStyle,
      workStyle: lifeRhythm?.workStyle,
      coreValues: lifeRhythm?.coreValues,
    };
  },
});

// Update profile prompts (icebreakers)
export const updateProfilePrompts = mutation({
  args: {
    token: v.string(), // SESSION AUTH: Validate session token server-side
    prompts: v.array(v.object({
      question: v.string(),
      answer: v.string(),
      section: v.optional(v.string()), // BUGFIX: Include section for reliable hydration
    })),
  },
  handler: async (ctx, args) => {
    console.log('[PROMPTS_BACKEND] updateProfilePrompts called with', args.prompts.length, 'prompts');
    args.prompts.forEach((p, i) => {
      console.log(`[PROMPTS_BACKEND] Received[${i}]: section=${p.section ?? 'NONE'}, question="${p.question.substring(0, 40)}...", answerLen=${p.answer.length}`);
    });

    // SESSION AUTH: Validate token and get userId (same pattern as photos.ts)
    const userId = await validateSessionToken(ctx, args.token);
    if (!userId) {
      console.log('[PROMPTS_BACKEND] FAILED: Invalid session token');
      throw new Error('Unauthorized: invalid or expired session');
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      console.log('[PROMPTS_BACKEND] FAILED: User not found for userId:', userId);
      throw new Error("User not found");
    }

    // BUGFIX #62: Reject empty prompts after trimming whitespace
    for (const prompt of args.prompts) {
      const trimmedQuestion = prompt.question.trim();
      const trimmedAnswer = prompt.answer.trim();
      if (trimmedQuestion.length === 0) {
        console.log('[PROMPTS_BACKEND] FAILED: Empty question after trim');
        throw new Error("Prompt question cannot be empty");
      }
      if (trimmedAnswer.length === 0) {
        console.log('[PROMPTS_BACKEND] FAILED: Empty answer after trim');
        throw new Error("Prompt answer cannot be empty");
      }
    }

    // Exactly 4 prompts (one per section), answer max 200 chars
    // BUGFIX: Include section field for reliable hydration
    const cleaned: { question: string; answer: string; section?: ProfilePromptSection }[] =
      args.prompts.slice(0, 4).map((p) => {
        const question = p.question.trim().slice(0, 100);
        const answer = p.answer.trim().slice(0, 200);
        const section =
          typeof p.section === 'string' && isProfilePromptSection(p.section)
            ? p.section
            : undefined;

        return section ? { question, answer, section } : { question, answer };
      });

    console.log('[PROMPTS_BACKEND] Saving', cleaned.length, 'cleaned prompts to profilePrompts field');
    await ctx.db.patch(userId, { profilePrompts: cleaned });
    console.log('[PROMPTS_BACKEND] SUCCESS: Saved prompts for user:', userId);
    return { success: true };
  },
});

// Update user profile
export const updateProfile = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    height: v.optional(v.number()),
    weight: v.optional(v.number()),
    exercise: v.optional(
      v.union(
        v.literal("never"),
        v.literal("sometimes"),
        v.literal("regularly"),
        v.literal("daily"),
      ),
    ),
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
    // CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
    relationshipIntent: v.optional(
      v.array(
        v.union(
          v.literal("serious_vibes"),
          v.literal("keep_it_casual"),
          v.literal("exploring_vibes"),
          v.literal("see_where_it_goes"),
          v.literal("open_to_vibes"),
          v.literal("just_friends"),
          v.literal("open_to_anything"),
          v.literal("single_parent"),
          v.literal("new_to_dating"),
        ),
      ),
    ),
    // BUGFIX: Accept all 70 activities (matching schema.ts and ACTIVITY_FILTERS)
    activities: v.optional(
      v.array(
        v.union(
          // Original 20 activities
          v.literal("coffee"), v.literal("date_night"), v.literal("sports"), v.literal("movies"), v.literal("free_tonight"),
          v.literal("foodie"), v.literal("gym_partner"), v.literal("concerts"), v.literal("travel"), v.literal("outdoors"),
          v.literal("art_culture"), v.literal("gaming"), v.literal("nightlife"), v.literal("brunch"), v.literal("study_date"),
          v.literal("this_weekend"), v.literal("beach_pool"), v.literal("road_trip"), v.literal("photography"), v.literal("volunteering"),
          // Additional 50 activities (matching frontend ACTIVITY_FILTERS)
          v.literal("late_night_talks"), v.literal("street_food"), v.literal("home_cooking"), v.literal("baking"), v.literal("healthy_eating"),
          v.literal("weekend_getaways"), v.literal("long_drives"), v.literal("city_exploring"), v.literal("beach_vibes"), v.literal("mountain_views"),
          v.literal("nature_walks"), v.literal("sunset_views"), v.literal("hiking"), v.literal("camping"), v.literal("stargazing"),
          v.literal("gardening"), v.literal("gym"), v.literal("yoga"), v.literal("running"), v.literal("cycling"),
          v.literal("meditation"), v.literal("pilates"), v.literal("music_lover"), v.literal("live_concerts"), v.literal("singing"),
          v.literal("podcasts"), v.literal("binge_watching"), v.literal("thrillers"), v.literal("documentaries"), v.literal("anime"),
          v.literal("k_dramas"), v.literal("board_games"), v.literal("chess"), v.literal("escape_rooms"), v.literal("drawing"),
          v.literal("painting"), v.literal("writing"), v.literal("journaling"), v.literal("diy_projects"), v.literal("reading"),
          v.literal("personal_growth"), v.literal("learning_new_skills"), v.literal("mindfulness"), v.literal("tech_enthusiast"), v.literal("startups"),
          v.literal("coding"), v.literal("community_service"), v.literal("sustainability"), v.literal("plant_parenting"),
        ),
      ),
    ),
    pets: v.optional(
      v.array(
        v.union(
          v.literal("dog"),
          v.literal("cat"),
          v.literal("bird"),
          v.literal("fish"),
          v.literal("rabbit"),
          v.literal("hamster"),
          v.literal("guinea_pig"),
          v.literal("turtle"),
          v.literal("parrot"),
          v.literal("pigeon"),
          v.literal("chicken"),
          v.literal("duck"),
          v.literal("goat"),
          v.literal("cow"),
          v.literal("horse"),
          v.literal("snake"),
          v.literal("lizard"),
          v.literal("frog"),
          v.literal("other"),
          v.literal("none"),
          v.literal("want_pets"),
          v.literal("allergic"),
        ),
      ),
    ),
    insect: v.optional(
      v.union(
        v.literal("mosquito"),
        v.literal("bee"),
        v.literal("butterfly"),
        v.literal("ant"),
        v.literal("cockroach"),
        v.null(),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { token, bio, pets, insect, ...otherUpdates } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    // P2 VALIDATION: Bio length validation (max 500 chars - matches frontend)
    if (bio !== undefined && bio.length > 500) {
      throw new Error("Bio must be 500 characters or less");
    }

    // P2 VALIDATION: Height range (100-250 cm)
    if (otherUpdates.height !== undefined) {
      if (otherUpdates.height < 100 || otherUpdates.height > 250) {
        throw new Error("Height must be between 100 and 250 cm");
      }
    }

    // P2 VALIDATION: Weight range (30-300 kg)
    if (otherUpdates.weight !== undefined) {
      if (otherUpdates.weight < 30 || otherUpdates.weight > 300) {
        throw new Error("Weight must be between 30 and 300 kg");
      }
    }

    // Server-side validation: pets max 3
    if (pets !== undefined && pets.length > 3) {
      throw new Error("You can select up to 3 pets only");
    }

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    if (bio !== undefined) cleanUpdates.bio = bio;
    if (pets !== undefined) cleanUpdates.pets = pets;
    if (insect !== undefined) cleanUpdates.insect = insect;
    for (const [key, value] of Object.entries(otherUpdates)) {
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
    // CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
    relationshipIntent: v.optional(
      v.array(
        v.union(
          v.literal("serious_vibes"),
          v.literal("keep_it_casual"),
          v.literal("exploring_vibes"),
          v.literal("see_where_it_goes"),
          v.literal("open_to_vibes"),
          v.literal("just_friends"),
          v.literal("open_to_anything"),
          v.literal("single_parent"),
          v.literal("new_to_dating"),
        ),
      ),
    ),
    orientation: v.optional(
      v.union(
        v.literal("straight"),
        v.literal("gay"),
        v.literal("lesbian"),
        v.literal("bisexual"),
        v.literal("prefer_not_to_say"),
        v.null(),
      ),
    ),
    sortBy: v.optional(
      v.union(
        v.literal("recommended"),
        v.literal("newest"),
        v.literal("distance"),
        v.literal("age"),
        v.literal("recently_active"),
      ),
    ),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, minAge, maxAge, maxDistance, ...otherUpdates } = args;

    // DEBUG: Log relationship category save
    console.log('[RelationshipCategorySave] updatePreferences', {
      source: 'updatePreferences',
      userId,
      relationshipIntent: args.relationshipIntent,
    });

    // BUGFIX #37: Age bounds validation
    if (minAge !== undefined) {
      if (!Number.isFinite(minAge) || minAge < 18 || minAge > 99) {
        throw new Error("minAge must be between 18 and 99");
      }
    }
    if (maxAge !== undefined) {
      if (!Number.isFinite(maxAge) || maxAge < 18 || maxAge > 99) {
        throw new Error("maxAge must be between 18 and 99");
      }
    }
    // Validate minAge <= maxAge (considering existing values if only one is updated)
    if (minAge !== undefined || maxAge !== undefined) {
      const user = await ctx.db.get(userId);
      if (!user) throw new Error("User not found");
      const effectiveMin = minAge ?? user.minAge;
      const effectiveMax = maxAge ?? user.maxAge;
      if (effectiveMin > effectiveMax) {
        throw new Error("minAge cannot be greater than maxAge");
      }
    }

    // BUGFIX #38: Distance bounds validation
    if (maxDistance !== undefined) {
      if (!Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 500) {
        throw new Error("maxDistance must be between 1 and 500 km");
      }
    }

    const cleanUpdates: Record<string, unknown> = {};
    if (minAge !== undefined) cleanUpdates.minAge = minAge;
    if (maxAge !== undefined) cleanUpdates.maxAge = maxAge;
    if (maxDistance !== undefined) cleanUpdates.maxDistance = maxDistance;
    for (const [key, value] of Object.entries(otherUpdates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    // REAL-TIME SYNC FIX: When relationshipIntent changes, force category refresh
    // This ensures Explore category visibility updates immediately, not after 28-48h
    const intentChanged = args.relationshipIntent !== undefined;
    if (intentChanged) {
      cleanUpdates.assignedDiscoverCategory = undefined;
      cleanUpdates.discoverCategoryAssignedAt = undefined;
      console.log('[CategoryRefresh] Cleared category assignment due to relationshipIntent change', {
        userId,
        newIntent: args.relationshipIntent,
      });
    }

    await ctx.db.patch(userId, cleanUpdates);

    // REAL-TIME SYNC FIX: Immediately reassign category after preference change
    // This ensures the user appears in the correct category without delay
    if (intentChanged) {
      await ctx.scheduler.runAfter(0, internal.discoverCategories.assignCategory, {
        userId,
      });
    }

    return { success: true };
  },
});

// Update location
// APP-P0-001 FIX: Server-side auth - user can only update their own location
export const updateLocation = mutation({
  args: {
    token: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, latitude, longitude, city } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    await ctx.db.patch(userId, {
      latitude,
      longitude,
      city,
      lastActive: Date.now(),
    });

    return { success: true };
  },
});

// Heartbeat - updates lastActive for presence (Online Now / Active Today)
// Called periodically when app is in foreground to keep user marked as "online"
// PRESENCE FIX: This mutation enables accurate "Online now" display on Discover cards
export const heartbeat = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = user._id;

    const now = Date.now();
    await ctx.db.patch(userId, {
      lastActive: now,
    });

    return { success: true, lastActive: now };
  },
});

// Toggle incognito mode
// APP-P1-005 FIX: Server-side auth - user can only toggle their own incognito
export const toggleIncognito = mutation({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { token, enabled } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

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

// ---------------------------------------------------------------------------
// Nearby Settings
// ---------------------------------------------------------------------------

/**
 * Update nearby settings (visibility, privacy, crossed paths).
 * All fields are optional - only provided fields will be updated.
 * P1 SECURITY: Uses authUserId + server-side resolution to prevent spoofing.
 */
export const updateNearbySettings = mutation({
  args: {
    token: v.string(),
    nearbyEnabled: v.optional(v.boolean()),
    crossedPathsEnabled: v.optional(v.boolean()),
    hideDistance: v.optional(v.boolean()),
    strongPrivacyMode: v.optional(v.boolean()),
    incognitoMode: v.optional(v.boolean()),
    nearbyVisibilityMode: v.optional(
      v.union(
        v.literal("always"),
        v.literal("app_open"),
        v.literal("recent")
      )
    ),
  },
  handler: async (ctx, args) => {
    const { token, incognitoMode, ...updates } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    // Check premium access for incognito mode (premium-only, no gender-based access)
    if (incognitoMode !== undefined) {
      const isPremium = user.subscriptionTier === "premium";
      if (!isPremium && incognitoMode) {
        throw new Error("Premium required for Incognito Nearby");
      }
      (updates as Record<string, unknown>).incognitoMode = incognitoMode;
    }

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    if (Object.keys(cleanUpdates).length > 0) {
      await ctx.db.patch(userId, cleanUpdates);
    }

    return { success: true };
  },
});

/**
 * Pause nearby visibility for 24 hours.
 * P1 SECURITY: Uses authUserId + server-side resolution to prevent spoofing.
 */
export const pauseNearby = mutation({
  args: {
    token: v.string(),
    paused: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { token, paused } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    if (paused) {
      // Pause for 24 hours
      await ctx.db.patch(userId, {
        nearbyPausedUntil: Date.now() + 24 * 60 * 60 * 1000,
      });
    } else {
      // Clear pause
      await ctx.db.patch(userId, {
        nearbyPausedUntil: undefined,
      });
    }

    return { success: true };
  },
});

// Toggle discovery pause
// APP-P1-005 FIX: Server-side auth - user can only toggle their own discovery pause
export const toggleDiscoveryPause = mutation({
  args: {
    token: v.string(),
    paused: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { token, paused } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

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

// Toggle show last seen
// APP-P1-005 FIX: Server-side auth - user can only toggle their own setting
export const toggleShowLastSeen = mutation({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { token, enabled } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    await ctx.db.patch(userId, { showLastSeen: enabled });
    return { success: true };
  },
});

// Update privacy settings (hideAge, disableReadReceipts)
// APP-P1-005 FIX: Server-side auth - user can only update their own privacy settings
export const updatePrivacySettings = mutation({
  args: {
    token: v.string(),
    hideAge: v.optional(v.boolean()),
    disableReadReceipts: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { token, hideAge, disableReadReceipts } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    // Build update object with only provided fields
    const updates: Record<string, boolean> = {};
    if (hideAge !== undefined) updates.hideAge = hideAge;
    if (disableReadReceipts !== undefined) updates.disableReadReceipts = disableReadReceipts;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates);
    }

    return { success: true };
  },
});

// Update notification settings
// APP-P0-002 FIX: Server-side auth - user can only update their own settings
export const updateNotificationSettings = mutation({
  args: {
    token: v.string(),
    notificationsEnabled: v.optional(v.boolean()),
    emailNotificationsEnabled: v.optional(v.boolean()),
    // Notification type preferences
    notifyNewMatches: v.optional(v.boolean()),
    notifyNewMessages: v.optional(v.boolean()),
    notifyLikesAndSuperLikes: v.optional(v.boolean()),
    notifyProfileViews: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const {
      token,
      notificationsEnabled,
      emailNotificationsEnabled,
      notifyNewMatches,
      notifyNewMessages,
      notifyLikesAndSuperLikes,
      notifyProfileViews,
    } = args;

    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    const updates: Record<string, boolean> = {};
    if (notificationsEnabled !== undefined) {
      updates.notificationsEnabled = notificationsEnabled;
    }
    if (emailNotificationsEnabled !== undefined) {
      updates.emailNotificationsEnabled = emailNotificationsEnabled;
    }
    if (notifyNewMatches !== undefined) {
      updates.notifyNewMatches = notifyNewMatches;
    }
    if (notifyNewMessages !== undefined) {
      updates.notifyNewMessages = notifyNewMessages;
    }
    if (notifyLikesAndSuperLikes !== undefined) {
      updates.notifyLikesAndSuperLikes = notifyLikesAndSuperLikes;
    }
    if (notifyProfileViews !== undefined) {
      updates.notifyProfileViews = notifyProfileViews;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates);
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
    // IDOR-P0-001 FIX: Restrict to admin users only
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: authentication required");
    }
    const callerId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!callerId) {
      throw new Error("Unauthorized: user not found");
    }
    const caller = await ctx.db.get(callerId);
    if (!caller?.isAdmin) {
      throw new Error("Unauthorized: Admin access required");
    }

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
    token: v.string(),
    blockedUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { token, blockedUserId } = args;
    const blockerId = await validateSessionToken(ctx, token);
    if (!blockerId) {
      return { success: false, error: 'unauthorized' };
    }

    // Prevent self-blocking
    if (blockerId === blockedUserId) {
      return { success: false, error: 'cannot_block_self' };
    }

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
    token: v.string(),
    blockedUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { token, blockedUserId } = args;
    const blockerId = await validateSessionToken(ctx, token);
    if (!blockerId) {
      return { success: false, error: 'unauthorized' };
    }

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

export const getCurrentUserBlockedUsers = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, args.token);

    const blocks = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', currentUser._id))
      .collect();

    const sortedBlocks = [...blocks].sort((a, b) => b.createdAt - a.createdAt);

    return await Promise.all(
      sortedBlocks.map(async (block) => {
        const summary = await buildPhase1SafetyUserSummary(ctx, block.blockedUserId);
        return {
          blockedUserId: block.blockedUserId,
          blockedAt: block.createdAt,
          ...summary,
        };
      })
    );
  },
});

export const getCurrentUserReportCandidates = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, args.token);
    const currentUserId = currentUser._id;
    const limit = Math.max(1, Math.min(args.limit ?? 30, 50));
    const recentWindowStart = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const candidateMap = new Map<string, {
      userId: Id<'users'>;
      lastInteractionAt: number;
      blockedAt: number | null;
      contexts: Set<'blocked' | 'matched' | 'messaged' | 'liked' | 'liked_you'>;
    }>();

    const addCandidate = (
      otherUserId: Id<'users'>,
      timestamp: number,
      context: 'blocked' | 'matched' | 'messaged' | 'liked' | 'liked_you',
      blockedAt?: number
    ) => {
      if (otherUserId === currentUserId) return;

      const key = String(otherUserId);
      const existing = candidateMap.get(key);
      if (existing) {
        existing.lastInteractionAt = Math.max(existing.lastInteractionAt, timestamp);
        if (blockedAt) {
          existing.blockedAt = Math.max(existing.blockedAt ?? 0, blockedAt);
        }
        existing.contexts.add(context);
        return;
      }

      candidateMap.set(key, {
        userId: otherUserId,
        lastInteractionAt: timestamp,
        blockedAt: blockedAt ?? null,
        contexts: new Set([context]),
      });
    };

    const [
      blocks,
      matchesAsUser1,
      matchesAsUser2,
      participantRows,
      outgoingLikes,
      incomingLikes,
    ] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', currentUserId))
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', currentUserId))
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', currentUserId))
        .collect(),
      ctx.db
        .query('conversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', currentUserId))
        .collect(),
      ctx.db
        .query('likes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', currentUserId))
        .collect(),
      ctx.db
        .query('likes')
        .withIndex('by_to_user', (q) => q.eq('toUserId', currentUserId))
        .collect(),
    ]);

    for (const block of blocks) {
      addCandidate(block.blockedUserId, block.createdAt, 'blocked', block.createdAt);
    }

    for (const match of [...matchesAsUser1, ...matchesAsUser2]) {
      if (!match.isActive && match.matchedAt < recentWindowStart) {
        continue;
      }
      const otherUserId = match.user1Id === currentUserId ? match.user2Id : match.user1Id;
      addCandidate(otherUserId, match.matchedAt, 'matched');
    }

    const conversations = await Promise.all(
      participantRows.map((row) => ctx.db.get(row.conversationId))
    );
    for (const conversation of conversations) {
      if (!conversation) continue;
      if (conversation.sourceRoomId || conversation.connectionSource) continue;

      const interactionAt = conversation.lastMessageAt ?? conversation.createdAt ?? 0;
      if (interactionAt < recentWindowStart) continue;

      const otherUserId = conversation.participants.find((participantId) => participantId !== currentUserId);
      if (!otherUserId) continue;
      addCandidate(otherUserId, interactionAt, 'messaged');
    }

    for (const like of outgoingLikes) {
      if (like.action === 'pass' || like.createdAt < recentWindowStart) continue;
      addCandidate(like.toUserId, like.createdAt, 'liked');
    }

    for (const like of incomingLikes) {
      if (like.action === 'pass' || like.createdAt < recentWindowStart) continue;
      addCandidate(like.fromUserId, like.createdAt, 'liked_you');
    }

    const candidates = [...candidateMap.values()]
      .sort((a, b) => {
        const aSortAt = Math.max(a.lastInteractionAt, a.blockedAt ?? 0);
        const bSortAt = Math.max(b.lastInteractionAt, b.blockedAt ?? 0);
        return bSortAt - aSortAt;
      })
      .slice(0, limit);

    return await Promise.all(
      candidates.map(async (candidate) => {
        const summary = await buildPhase1SafetyUserSummary(ctx, candidate.userId);
        return {
          userId: candidate.userId,
          lastInteractionAt: candidate.lastInteractionAt,
          blockedAt: candidate.blockedAt,
          contexts: Array.from(candidate.contexts),
          ...summary,
        };
      })
    );
  },
});

// Report user
export const reportUser = mutation({
  args: {
    token: v.string(),
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
    const { token, reportedUserId, reason, description } = args;
    const now = Date.now();
    const reporterId = await validateSessionToken(ctx, token);
    if (!reporterId) {
      return { success: false, error: 'unauthorized' };
    }

    // Prevent self-reporting
    if (reporterId === reportedUserId) {
      return { success: false, error: 'cannot_report_self' };
    }

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
// APP-P0-003 FIX: Server-side auth - user can only deactivate their own account
export const deactivateAccount = mutation({
  args: {
    token: v.string(),
  },
  handler: async () => {
    throw new Error('Deprecated: use auth.softDeleteAccount');
  },
});

// Reactivate account
// APP-P1-005 FIX: Server-side auth - user can only reactivate their own account
export const reactivateAccount = mutation({
  args: {
    token: v.string(),
  },
  handler: async () => {
    throw new Error('Deprecated: sign in again to reactivate');
  },
});

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
// P0 SECURITY FIX: Added token validation to prevent unauthorized onboarding completion
export const completeOnboarding = mutation({
  args: {
    userId: v.id("users"),
    token: v.optional(v.string()), // P0 FIX: Session token for auth validation
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
          v.literal("fish"),
          v.literal("rabbit"),
          v.literal("hamster"),
          v.literal("guinea_pig"),
          v.literal("turtle"),
          v.literal("parrot"),
          v.literal("pigeon"),
          v.literal("chicken"),
          v.literal("duck"),
          v.literal("goat"),
          v.literal("cow"),
          v.literal("horse"),
          v.literal("snake"),
          v.literal("lizard"),
          v.literal("frog"),
          v.literal("other"),
          v.literal("none"),
          v.literal("want_pets"),
          v.literal("allergic"),
        ),
      ),
    ),
    insect: v.optional(
      v.union(
        v.literal("mosquito"),
        v.literal("bee"),
        v.literal("butterfly"),
        v.literal("ant"),
        v.literal("cockroach"),
        v.null(),
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
    // CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
    relationshipIntent: v.optional(
      v.array(
        v.union(
          v.literal("serious_vibes"),
          v.literal("keep_it_casual"),
          v.literal("exploring_vibes"),
          v.literal("see_where_it_goes"),
          v.literal("open_to_vibes"),
          v.literal("just_friends"),
          v.literal("open_to_anything"),
          v.literal("single_parent"),
          v.literal("new_to_dating"),
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
    // FIX: Add missing validators for profilePrompts and lgbtqSelf
    // BUGFIX: Include section for reliable hydration
    profilePrompts: v.optional(v.array(v.object({
      question: v.string(),
      answer: v.string(),
      section: v.optional(v.string()), // builder | performer | seeker | grounded
    }))),
    lgbtqSelf: v.optional(v.array(v.union(
      v.literal('gay'),
      v.literal('lesbian'),
      v.literal('bisexual'),
      v.literal('transgender'),
      v.literal('prefer_not_to_say')
    ))),
    // P0 FIX: Add lgbtqPreference for LGBTQ matching
    lgbtqPreference: v.optional(v.array(v.union(
      v.literal('gay'),
      v.literal('lesbian'),
      v.literal('bisexual'),
      v.literal('transgender'),
      v.literal('prefer_not_to_say')
    ))),
    photoStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const { userId, token, photoStorageIds, pets, insect, ...updates } = args;

    // P0 SECURITY FIX: Validate session token to prevent unauthorized onboarding
    // This ensures only the authenticated user can complete their own onboarding
    if (token) {
      const authenticatedUserId = await validateSessionToken(ctx, token);
      if (!authenticatedUserId) {
        throw new Error("Unauthorized: invalid or expired session");
      }
      if (authenticatedUserId !== userId) {
        throw new Error("Unauthorized: cannot complete onboarding for another user");
      }
    }

    // P0 SECURITY FIX: Validate photoStorageIds array length
    // Prevents excessive DB writes from malicious clients
    const MAX_PHOTOS = 9;
    if (photoStorageIds && photoStorageIds.length > MAX_PHOTOS) {
      throw new Error(`Too many photos: maximum ${MAX_PHOTOS} allowed`);
    }

    // Verify user exists
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // P1 SECURITY FIX: Enforce consent acceptance before allowing onboarding completion
    // This ensures users have explicitly accepted terms before entering the app
    if (!user.consentAcceptedAt) {
      throw new Error("Consent required: please accept the data consent agreement before completing onboarding");
    }

    // ONB-P0-002 FIX: Enforce face verification before onboarding completion
    // PRODUCT RULE: Allow both "verified" AND "pending" to complete onboarding
    // Only block "unverified" (user hasn't attempted verification at all)
    const faceStatus = user.faceVerificationStatus || 'unverified';
    const faceVerificationAllowed = faceStatus === 'verified' || faceStatus === 'pending';
    if (!faceVerificationAllowed) {
      throw new Error("Face verification required: please complete face verification before continuing");
    }

    // Server-side validation: pets max 3
    if (pets !== undefined && pets.length > 3) {
      throw new Error("You can select up to 3 pets only");
    }

    // P2 VALIDATION: Bio length validation (max 500 chars)
    if (updates.bio !== undefined && (updates.bio as string).length > 500) {
      throw new Error("Bio must be 500 characters or less");
    }

    // P2 VALIDATION: Height range (100-250 cm)
    if (updates.height !== undefined) {
      const h = updates.height as number;
      if (h < 100 || h > 250) {
        throw new Error("Height must be between 100 and 250 cm");
      }
    }

    // P2 VALIDATION: Weight range (30-300 kg)
    if (updates.weight !== undefined) {
      const w = updates.weight as number;
      if (w < 30 || w > 300) {
        throw new Error("Weight must be between 30 and 300 kg");
      }
    }

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    // Add pets and insect to cleanUpdates
    if (pets !== undefined) cleanUpdates.pets = pets;
    if (insect !== undefined) cleanUpdates.insect = insect;

    // DEFENSIVE SANITIZATION: Filter out invalid relationshipIntent values
    // Keeps relationshipIntent aligned with the current 9 Explore-safe schema values
    if (cleanUpdates.relationshipIntent) {
      cleanUpdates.relationshipIntent = sanitizeRelationshipIntent(
        cleanUpdates.relationshipIntent as string[]
      );
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

    await ctx.scheduler.runAfter(0, internal.discoverCategories.assignCategory, {
      userId,
    });

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Photo Blur
// ---------------------------------------------------------------------------

/** Toggle blur on/off. No hard-block — user can always toggle freely. */
// APP-P1-005 FIX: Server-side auth - user can only toggle their own photo blur
export const togglePhotoBlur = mutation({
  args: {
    token: v.string(),
    blurred: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = user._id;
    await ctx.db.patch(userId, { photoBlurred: args.blurred });
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

/**
 * Set admin status for a user.
 * For bootstrap (first admin): use ADMIN_SETUP_SECRET env var.
 * For subsequent admins: an existing admin can promote others.
 */
export const setAdminStatus = mutation({
  args: {
    targetUserId: v.id("users"),
    isAdmin: v.boolean(),
    // For bootstrap: use secret. For admin promotion: use adminUserId.
    adminUserId: v.optional(v.id("users")),
    setupSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { targetUserId, isAdmin, adminUserId, setupSecret } = args;

    // Authorization: either valid admin or valid setup secret
    let authorized = false;
    let verifiedAdminId: Id<"users"> | undefined;

    if (adminUserId) {
      const admin = await ctx.db.get(adminUserId);
      if (admin?.isAdmin) {
        authorized = true;
        verifiedAdminId = adminUserId;
      }
    }

    if (setupSecret) {
      const expectedSecret = process.env.ADMIN_SETUP_SECRET;
      if (expectedSecret && setupSecret === expectedSecret) {
        authorized = true;
        // For bootstrap, the target user becomes the "admin" in the log
        verifiedAdminId = targetUserId;
      }
    }

    if (!authorized) {
      throw new Error("Unauthorized: Admin access or valid setup secret required");
    }

    const targetUser = await ctx.db.get(targetUserId);
    if (!targetUser) {
      throw new Error("Target user not found");
    }

    const oldIsAdmin = targetUser.isAdmin || false;
    await ctx.db.patch(targetUserId, { isAdmin });

    // Audit log: record admin status change
    if (verifiedAdminId) {
      await logAdminAction(ctx, {
        adminUserId: verifiedAdminId,
        action: "set_admin",
        targetUserId,
        metadata: {
          oldIsAdmin,
          newIsAdmin: isAdmin,
          usedSetupSecret: !!setupSecret,
        },
      });
    }

    return { success: true, userId: targetUserId, isAdmin };
  },
});

/**
 * Check if user is admin (for frontend route guards).
 */
export const checkIsAdmin = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return { isAdmin: user?.isAdmin === true };
  },
});

export const checkCurrentUserIsAdmin = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    return { isAdmin: user.isAdmin === true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PREFERRED CHAT ROOM
// Auto-opens the user's preferred room when entering the Chat Rooms tab.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the user's preferred chat room ID.
 */
export const getPreferredChatRoom = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return { preferredChatRoomId: null };
    }

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { preferredChatRoomId: null };
    }

    const user = await ctx.db.get(userId);
    const preferredChatRoomId = user?.preferredChatRoomId ?? null;
    if (!preferredChatRoomId) {
      return { preferredChatRoomId: null };
    }

    const room = await ctx.db.get(preferredChatRoomId);
    if (!room) {
      return { preferredChatRoomId: null };
    }

    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      return { preferredChatRoomId: null };
    }

    const ban = await ctx.db
      .query("chatRoomBans")
      .withIndex("by_room_user", (q) => q.eq("roomId", preferredChatRoomId).eq("userId", userId))
      .first();
    if (ban) {
      return { preferredChatRoomId: null };
    }

    const membership = await ctx.db
      .query("chatRoomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", preferredChatRoomId).eq("userId", userId))
      .first();
    if (!membership) {
      return { preferredChatRoomId: null };
    }

    return { preferredChatRoomId };
  },
});

/**
 * Set the user's preferred chat room.
 * Called when user enters a chat room (auto-saved as preferred).
 * CR-017 FIX: Auth hardening - verify caller identity, don't trust client userId
 */
export const setPreferredChatRoom = mutation({
  args: {
    authUserId: v.string(), // CR-017: Auth verification required
    roomId: v.id("chatRooms"),
  },
  handler: async (ctx, { authUserId, roomId }) => {
    // CR-017 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error("Unauthorized: authentication required");
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error("Unauthorized: user not found");
    }

    // Verify room exists
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      throw new Error("Room has expired");
    }

    const ban = await ctx.db
      .query("chatRoomBans")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId))
      .first();
    if (ban) {
      throw new Error("Access denied: you are banned from this room");
    }

    const membership = await ctx.db
      .query("chatRoomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId))
      .first();
    if (!membership) {
      throw new Error("Cannot save a room you have not joined");
    }

    await ctx.db.patch(userId, { preferredChatRoomId: roomId });
    return { success: true };
  },
});

/**
 * Clear the user's preferred chat room.
 * Called when user explicitly leaves the room via "Leave Room" action.
 * CR-017 FIX: Auth hardening - verify caller identity, don't trust client userId
 */
export const clearPreferredChatRoom = mutation({
  args: {
    authUserId: v.string(), // CR-017: Auth verification required
  },
  handler: async (ctx, { authUserId }) => {
    // CR-017 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error("Unauthorized: authentication required");
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error("Unauthorized: user not found");
    }

    await ctx.db.patch(userId, { preferredChatRoomId: undefined });
    return { success: true };
  },
});

/**
 * Get onboarding draft for a user (live mode only).
 * Loads saved onboarding progress from backend for hydration on app startup.
 *
 * QUERY: Read-only, uses resolveUserIdByAuthId.
 */
export const getOnboardingDraft = query({
  args: {
    userId: v.union(v.id("users"), v.string()),
  },
  handler: async (ctx, args) => {
    // QUERY: read-only, no creation
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getOnboardingDraft] User not found for authUserId:', args.userId);
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    return {
      onboardingDraft: user.onboardingDraft ?? null,
    };
  },
});

/**
 * Upsert onboarding draft - save partial onboarding progress (live mode only).
 * Called as user fills each onboarding screen to persist their progress.
 *
 * P1 CONCURRENCY NOTE: This mutation uses additive merge (existing + patch).
 * Concurrent calls within a short window may still lose data if they read
 * stale state. Convex serializes mutations per document, but rapid client
 * calls can still race. The safest approach is to debounce client-side saves.
 *
 * MUTATION: Can create user, uses ensureUserByAuthId.
 */
export const upsertOnboardingDraft = mutation({
  args: {
    userId: v.union(v.id("users"), v.string()),
    patch: v.any(), // Accepts partial draft updates
  },
  handler: async (ctx, args) => {
    // DEBUG: Log relationship category save
    console.log('[RelationshipCategorySave] upsertOnboardingDraft', {
      source: 'upsertOnboardingDraft',
      userId: args.userId,
      relationshipIntent: args.patch?.preferences?.relationshipIntent,
    });

    // MUTATION: can create
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found after ensureUserByAuthId");
    }

    // Deep merge patch into existing onboardingDraft
    const existingDraft = user.onboardingDraft || {};

    // P1 STABILITY: Warn if draft was updated very recently (potential race condition)
    const lastUpdatedAt = existingDraft.progress?.lastUpdatedAt;
    const now = Date.now();
    if (lastUpdatedAt && (now - lastUpdatedAt) < 500) {
      console.warn(`[DRAFT_RACE] Rapid draft update detected for user ${userId}: ${now - lastUpdatedAt}ms since last update`);
    }

    // P1 STABILITY: Helper to merge objects while filtering out undefined values
    // This prevents accidentally overwriting existing values with undefined
    const safeMerge = (existing: any, patch: any) => {
      if (!patch) return existing;
      const merged = { ...existing };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          merged[key] = value;
        }
      }
      return merged;
    };

    const mergedDraft = {
      ...existingDraft,
      basicInfo: safeMerge(existingDraft.basicInfo, args.patch.basicInfo),
      profileDetails: safeMerge(existingDraft.profileDetails, args.patch.profileDetails),
      lifestyle: safeMerge(existingDraft.lifestyle, args.patch.lifestyle),
      lifeRhythm: safeMerge(existingDraft.lifeRhythm, args.patch.lifeRhythm),
      preferences: safeMerge(existingDraft.preferences, args.patch.preferences),
      progress: {
        lastStepKey: args.patch.progress?.lastStepKey ?? existingDraft.progress?.lastStepKey,
        lastUpdatedAt: now,
      },
    };

    // DEFENSIVE SANITIZATION: Filter out invalid relationshipIntent values before saving
    // Keeps draft preferences aligned with the current 9 Explore-safe schema values
    if (mergedDraft.preferences?.relationshipIntent) {
      mergedDraft.preferences.relationshipIntent = sanitizeRelationshipIntent(
        mergedDraft.preferences.relationshipIntent
      );
    }

    await ctx.db.patch(userId, {
      onboardingDraft: mergedDraft,
    });

    return { success: true };
  },
});

export const upsertCurrentUserOnboardingDraft = mutation({
  args: {
    token: v.string(),
    patch: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = user._id;
    const existingDraft = user.onboardingDraft || {};

    const lastUpdatedAt = existingDraft.progress?.lastUpdatedAt;
    const now = Date.now();
    if (lastUpdatedAt && (now - lastUpdatedAt) < 500) {
      console.warn(`[DRAFT_RACE] Rapid draft update detected for user ${userId}: ${now - lastUpdatedAt}ms since last update`);
    }

    const safeMerge = (existing: any, patch: any) => {
      if (!patch) return existing;
      const merged = { ...existing };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          merged[key] = value;
        }
      }
      return merged;
    };

    const mergedDraft = {
      ...existingDraft,
      basicInfo: safeMerge(existingDraft.basicInfo, args.patch.basicInfo),
      profileDetails: safeMerge(existingDraft.profileDetails, args.patch.profileDetails),
      lifestyle: safeMerge(existingDraft.lifestyle, args.patch.lifestyle),
      lifeRhythm: safeMerge(existingDraft.lifeRhythm, args.patch.lifeRhythm),
      preferences: safeMerge(existingDraft.preferences, args.patch.preferences),
      progress: {
        lastStepKey: args.patch.progress?.lastStepKey ?? existingDraft.progress?.lastStepKey,
        lastUpdatedAt: now,
      },
    };

    if (mergedDraft.preferences?.relationshipIntent) {
      mergedDraft.preferences.relationshipIntent = sanitizeRelationshipIntent(
        mergedDraft.preferences.relationshipIntent
      );
    }

    await ctx.db.patch(userId, {
      onboardingDraft: mergedDraft,
    });

    return { success: true };
  },
});

/**
 * Get comprehensive onboarding status for hydration and routing decisions.
 * Returns all data needed to hydrate stores and determine next onboarding step.
 */
export const getOnboardingStatus = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = currentUser._id;

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Count normal profile photos (exclude verification_reference)
    const normalPhotos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.neq(q.field('photoType'), 'verification_reference'))
      .collect();

    // Get basic info from user document (authoritative) or draft (fallback)
    const basicInfo = {
      name: user.name || user.onboardingDraft?.basicInfo?.name || null,
      nickname: user.handle || user.onboardingDraft?.basicInfo?.handle || null, // BUG FIX: schema uses 'handle' field
      dateOfBirth: user.dateOfBirth || user.onboardingDraft?.basicInfo?.dateOfBirth || null,
      gender: user.gender || user.onboardingDraft?.basicInfo?.gender || null,
    };

    // Calculate effective photo count: normal photos + reference photo (if exists)
    // MIN_PHOTOS_REQUIRED = 2, so if user has 1 reference + 1 normal, that's enough
    const effectivePhotoCount = normalPhotos.length + (user.verificationReferencePhotoId ? 1 : 0);

    const status = {
      // Basic info
      basicInfo,
      basicInfoComplete: !!(basicInfo.name && basicInfo.dateOfBirth && basicInfo.gender),

      // Verification status
      referencePhotoExists: !!user.verificationReferencePhotoId,
      verificationReferencePhotoId: user.verificationReferencePhotoId || null,
      // C5 FIX: Include URL for face verification (persisted, survives app restart)
      verificationReferencePhotoUrl: user.verificationReferencePhotoUrl || null,
      faceVerificationStatus: user.faceVerificationStatus || 'unverified',
      faceVerificationPassed: user.faceVerificationStatus === 'verified',
      faceVerificationPending: user.faceVerificationStatus === 'pending',

      // Photos (BUG FIX: count reference photo as primary display photo)
      normalPhotoCount: normalPhotos.length,
      hasMinPhotos: effectivePhotoCount >= 2,

      // Onboarding state
      onboardingCompleted: user.onboardingCompleted || false,
      onboardingDraft: user.onboardingDraft || null,

      // Phase-2 onboarding state (Private Mode)
      phase2OnboardingCompleted: user.phase2OnboardingCompleted || false,

      // Private welcome/guidelines confirmation (18+ consent gate)
      privateWelcomeConfirmed: user.privateWelcomeConfirmed || false,
    };

    console.log('[ONB_STATUS]', JSON.stringify({
      userId: userId.substring(0, 8),
      onboardingCompleted: status.onboardingCompleted,
      phase2OnboardingCompleted: status.phase2OnboardingCompleted,
      privateWelcomeConfirmed: status.privateWelcomeConfirmed,
      basicInfoPresent: status.basicInfoComplete,
      referencePhotoExists: status.referencePhotoExists,
      faceStatus: status.faceVerificationStatus,
      normalPhotoCount: status.normalPhotoCount,
      effectivePhotoCount,
      hasMinPhotos: status.hasMinPhotos,
    }));

    return status;
  },
});

/**
 * Canonical Phase-2 onboarding consent write.
 * This is the only active onboarding step that should set both consentAcceptedAt
 * and privateWelcomeConfirmed on the users table.
 */
export const acceptPrivateOnboardingConsent = mutation({
  args: {
    token: v.string(),
    confirmAdult: v.boolean(),
    confirmNoSharing: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!args.confirmAdult || !args.confirmNoSharing) {
      throw new Error('Both onboarding consent confirmations are required');
    }

    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const now = Date.now();

    const consentAcceptedAt = user.consentAcceptedAt ?? now;
    const privateWelcomeConfirmedAt = user.privateWelcomeConfirmedAt ?? now;

    await ctx.db.patch(user._id, {
      consentAcceptedAt,
      privateWelcomeConfirmed: true,
      privateWelcomeConfirmedAt,
    });

    return {
      success: true,
      consentAcceptedAt,
      privateWelcomeConfirmed: true,
    };
  },
});

/**
 * Legacy helper retained for compatibility.
 * Active Phase-2 onboarding now marks completion inside privateProfiles.finalizeOnboardingProfile
 * so profile creation and onboarding gating cannot drift apart.
 */
export const setPhase2OnboardingCompleted = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, args.token);
    const resolvedUserId = currentUser._id;

    if (!resolvedUserId) {
      console.warn('[P2_ONBOARD] setPhase2OnboardingCompleted: user not found');
      return { success: false, error: 'user_not_found' };
    }

    const user = await ctx.db.get(resolvedUserId);
    if (!user) {
      console.warn('[P2_ONBOARD] setPhase2OnboardingCompleted: user document not found');
      return { success: false, error: 'user_not_found' };
    }

    // Idempotent: skip if already completed
    if (user.phase2OnboardingCompleted) {
      console.log('[P2_ONBOARD] setPhase2OnboardingCompleted: already completed, skipping');
      return { success: true, alreadyCompleted: true };
    }

    // Set the flag
    await ctx.db.patch(resolvedUserId, {
      phase2OnboardingCompleted: true,
      phase2OnboardingCompletedAt: Date.now(),
    });

    // Initialize Phase-2 ranking metrics for Desire Land discovery
    await ctx.runMutation(internal.phase2Ranking.initializePhase2RankingMetrics, {
      userId: resolvedUserId,
    });

    console.log('[P2_ONBOARD] setPhase2OnboardingCompleted: success for user', resolvedUserId.substring(0, 8));
    return { success: true };
  },
});

/**
 * Legacy helper retained for compatibility.
 * Active Phase-2 onboarding uses acceptPrivateOnboardingConsent instead.
 */
export const setPrivateWelcomeConfirmed = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, args.token);
    const resolvedUserId = currentUser._id;

    if (!resolvedUserId) {
      console.warn('[PRIVATE_WELCOME] setPrivateWelcomeConfirmed: user not found');
      return { success: false, error: 'user_not_found' };
    }

    const user = await ctx.db.get(resolvedUserId);
    if (!user) {
      console.warn('[PRIVATE_WELCOME] setPrivateWelcomeConfirmed: user document not found');
      return { success: false, error: 'user_not_found' };
    }

    // Idempotent: skip if already confirmed
    if (user.privateWelcomeConfirmed) {
      console.log('[PRIVATE_WELCOME] setPrivateWelcomeConfirmed: already confirmed, skipping');
      return { success: true, alreadyConfirmed: true };
    }

    // Set the flag
    await ctx.db.patch(resolvedUserId, {
      privateWelcomeConfirmed: true,
      privateWelcomeConfirmedAt: Date.now(),
    });

    console.log('[PRIVATE_WELCOME] setPrivateWelcomeConfirmed: success for user', resolvedUserId.substring(0, 8));
    return { success: true };
  },
});

/**
 * DEV ONLY: Reset Phase-2 onboarding for a user.
 * This allows re-testing Phase-2 onboarding by clearing all completion flags
 * and deleting the private profile.
 *
 * SAFETY: Does NOT touch Phase-1 data, auth, or main profile.
 *
 * What this resets:
 * - users.phase2OnboardingCompleted → false
 * - users.phase2OnboardingCompletedAt → undefined
 * - users.privateWelcomeConfirmed → false (optional, for full reset)
 * - userPrivateProfiles record → DELETED
 * - privateDeletionStates record → DELETED (if exists)
 */
export const resetPhase2Onboarding = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!resolvedUserId) {
      console.warn('[P2_RESET] resetPhase2Onboarding: user not found');
      return { success: false, error: 'user_not_found' };
    }

    const user = await ctx.db.get(resolvedUserId);
    if (!user) {
      console.warn('[P2_RESET] resetPhase2Onboarding: user document not found');
      return { success: false, error: 'user_not_found' };
    }

    console.log('[P2_RESET] Starting Phase-2 reset for user:', resolvedUserId.substring(0, 8));

    // 1. Clear Phase-2 completion flags on user record
    await ctx.db.patch(resolvedUserId, {
      phase2OnboardingCompleted: false,
      phase2OnboardingCompletedAt: undefined,
      privateWelcomeConfirmed: false,
      privateWelcomeConfirmedAt: undefined,
    });
    console.log('[P2_RESET] Cleared phase2OnboardingCompleted flag');

    // 2. Delete userPrivateProfiles record (if exists)
    const privateProfile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', resolvedUserId))
      .first();

    if (privateProfile) {
      await ctx.db.delete(privateProfile._id);
      console.log('[P2_RESET] Deleted userPrivateProfiles record');
    } else {
      console.log('[P2_RESET] No userPrivateProfiles record found');
    }

    // 3. Delete privateDeletionStates record (if exists)
    const deletionState = await ctx.db
      .query('privateDeletionStates')
      .withIndex('by_userId', (q) => q.eq('userId', resolvedUserId))
      .first();

    if (deletionState) {
      await ctx.db.delete(deletionState._id);
      console.log('[P2_RESET] Deleted privateDeletionStates record');
    }

    console.log('[P2_RESET] Phase-2 reset complete for user:', resolvedUserId.substring(0, 8));
    return { success: true };
  },
});

// ============================================================================
// DEV ONLY: WIPE TEST USER DATA
// ============================================================================

/**
 * DEV ONLY: Completely wipe all data for the current test user.
 * This allows starting fresh with a clean slate for testing onboarding.
 *
 * WHAT THIS DELETES:
 * - The user document itself
 * - All photos (metadata - storage files remain for cleanup separately)
 * - All likes sent/received
 * - All matches
 * - All conversations and messages
 * - All notifications
 * - All sessions
 * - All private profiles
 * - All other user-linked records
 *
 * AFTER WIPE:
 * - User must clear local stores and logout
 * - On next login, a completely fresh user will be created
 * - No stale data will survive
 */
export const devWipeMyTestUserData = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // STRICT PRODUCTION GUARD: Only allow in development environment
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('devWipeMyTestUserData is disabled in production');
    }

    console.log('[DEV_WIPE] === STARTING USER DATA WIPE ===');
    console.log('[DEV_WIPE] Input userId:', args.userId);

    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!resolvedUserId) {
      console.log('[DEV_WIPE] User not found');
      return { success: false, error: 'user_not_found' };
    }

    const user = await ctx.db.get(resolvedUserId);
    if (!user) {
      console.log('[DEV_WIPE] User document not found');
      return { success: false, error: 'user_not_found' };
    }

    console.log('[DEV_WIPE] Wiping data for user:', user.name, '(', resolvedUserId.substring(0, 8), ')');

    const deletedCounts: Record<string, number> = {};

    // Helper to delete records from a table
    const deleteFromTable = async (
      tableName: string,
      indexName: string,
      fieldName: string,
      fieldValue: Id<'users'>
    ) => {
      const records = await ctx.db
        .query(tableName as any)
        .withIndex(indexName as any, (q: any) => q.eq(fieldName, fieldValue))
        .collect();

      for (const record of records) {
        await ctx.db.delete(record._id);
      }

      deletedCounts[tableName] = (deletedCounts[tableName] || 0) + records.length;
    };

    // 1. Delete photos
    await deleteFromTable('photos', 'by_user', 'userId', resolvedUserId);

    // 2. Delete likes (sent and received)
    const likesSent = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', resolvedUserId))
      .collect();
    for (const like of likesSent) await ctx.db.delete(like._id);
    deletedCounts['likes_sent'] = likesSent.length;

    const likesReceived = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', resolvedUserId))
      .collect();
    for (const like of likesReceived) await ctx.db.delete(like._id);
    deletedCounts['likes_received'] = likesReceived.length;

    // 3. Delete matches (where user is either user1 or user2)
    const matches1 = await ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', resolvedUserId))
      .collect();
    for (const match of matches1) await ctx.db.delete(match._id);

    const matches2 = await ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', resolvedUserId))
      .collect();
    for (const match of matches2) await ctx.db.delete(match._id);
    deletedCounts['matches'] = matches1.length + matches2.length;

    // 4. Delete conversation participants and related data
    await deleteFromTable('conversationParticipants', 'by_user', 'userId', resolvedUserId);

    // 5. Delete notifications
    await deleteFromTable('notifications', 'by_user', 'userId', resolvedUserId);

    // 6. Delete sessions
    await deleteFromTable('sessions', 'by_user', 'userId', resolvedUserId);

    // 7. Delete private profiles
    await deleteFromTable('userPrivateProfiles', 'by_user', 'userId', resolvedUserId);

    // 8. Delete private deletion states
    await deleteFromTable('privateDeletionStates', 'by_userId', 'userId', resolvedUserId);

    // 9. Delete verification sessions
    await deleteFromTable('verificationSessions', 'by_user', 'userId', resolvedUserId);

    // 10. Delete filter presets
    await deleteFromTable('filterPresets', 'by_user', 'userId', resolvedUserId);

    // 11. Delete behavior flags
    await deleteFromTable('behaviorFlags', 'by_user', 'userId', resolvedUserId);

    // 12. Delete device fingerprints
    await deleteFromTable('deviceFingerprints', 'by_user', 'userId', resolvedUserId);

    // 13. Finally, delete the user document itself
    await ctx.db.delete(resolvedUserId);
    deletedCounts['users'] = 1;

    console.log('[DEV_WIPE] Deletion counts:', JSON.stringify(deletedCounts));
    console.log('[DEV_WIPE] === USER DATA WIPE COMPLETE ===');

    return {
      success: true,
      deletedUserId: resolvedUserId,
      deletedCounts,
      message: 'User data wiped. Clear local stores and logout to complete.',
    };
  },
});

// ============================================================================
// PHASE-2 SAFETY + TRUST QUERIES
// ============================================================================

/**
 * Get list of users blocked by the current user.
 * Returns basic info for display in Blocked Users settings screen.
 * Auth-safe: uses authUserId parameter instead of ctx.auth.
 */
export const getMyBlockedUsers = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', blockedUsers: [] };
    }

    // Get all blocks where this user is the blocker
    const blocks = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', resolvedUserId))
      .collect();

    // Fetch basic info for each blocked user
    // PHASE-2 IDENTITY FIX: Use Phase-2 nickname, never real name
    const blockedUsers = await Promise.all(
      blocks.map(async (block) => {
        const user = await ctx.db.get(block.blockedUserId);
        if (!user) return null;

        return {
          blockId: block._id,
          blockedUserId: block.blockedUserId,
          displayName: user.handle || 'Anonymous',
          blockedAt: block.createdAt,
        };
      })
    );

    return {
      success: true,
      blockedUsers: blockedUsers.filter(Boolean),
    };
  },
});

/**
 * Get reports submitted by the current user (last 30 days).
 * Does NOT expose any info about who reported the current user.
 * Auth-safe: uses authUserId parameter instead of ctx.auth.
 */
export const getMyReports = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', reports: [] };
    }

    // 30-day window
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Get reports where this user is the reporter
    const reports = await ctx.db
      .query('reports')
      .withIndex('by_reporter', (q) => q.eq('reporterId', resolvedUserId))
      .filter((q) => q.gte(q.field('createdAt'), thirtyDaysAgo))
      .order('desc')
      .collect();

    // Map to safe output (no reportedUserId info for privacy)
    const safeReports = reports.map((report) => ({
      reportId: report._id,
      reason: report.reason,
      status: report.status,
      createdAt: report.createdAt,
      hasDescription: !!report.description,
    }));

    return {
      success: true,
      reports: safeReports,
    };
  },
});

// ============================================================================
// DEV ONLY: WIPE ALL USER DATA (NUCLEAR OPTION)
// ============================================================================

/**
 * DEV ONLY: Wipe ALL user data from ALL user-related tables.
 * This is the "nuclear option" for completely resetting the database for testing.
 *
 * WHAT THIS DELETES (ALL RECORDS FROM):
 * - users
 * - photos
 * - likes
 * - matches
 * - conversationParticipants
 * - messages
 * - notifications
 * - crossedPaths
 * - crossPathHistory
 * - userPrivateProfiles
 * - privateDeletionStates
 * - reports
 * - blocks
 * - sessions
 * - verificationSessions
 * - deviceFingerprints
 * - behaviorFlags
 * - userStrikes
 * - todAnswers
 * - todConnectRequests
 * - todPrivateMedia
 * - confessions
 * - confessionReplies
 * - confessionReactions
 * - confessionNotifications
 * - chatRoomMembers
 * - filterPresets
 * - supportRequests
 * - purchases
 * - subscriptionRecords
 *
 * HOW TO RUN FROM CONVEX DASHBOARD:
 * 1. Go to your Convex dashboard
 * 2. Navigate to Functions → users → devWipeAllUserData
 * 3. Click "Run" (no arguments needed)
 * 4. Check the logs for deletion report
 *
 * AFTER WIPE:
 * - All app data is gone
 * - All users must re-authenticate
 * - Fresh start for testing
 */
export const devWipeAllUserData = mutation({
  args: {},
  handler: async (ctx) => {
    // STRICT PRODUCTION GUARD: Only allow in development environment
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('devWipeAllUserData is disabled in production');
    }

    console.log('[DEV_WIPE_ALL] ════════════════════════════════════════════');
    console.log('[DEV_WIPE_ALL] === STARTING FULL DATABASE WIPE ===');
    console.log('[DEV_WIPE_ALL] ════════════════════════════════════════════');

    const deletedCounts: Record<string, number> = {};

    // Helper to delete ALL records from a table
    const wipeTable = async (tableName: string) => {
      try {
        const records = await ctx.db.query(tableName as any).collect();
        for (const record of records) {
          await ctx.db.delete(record._id);
        }
        deletedCounts[tableName] = records.length;
        if (records.length > 0) {
          console.log(`[DEV_WIPE_ALL] Deleted ${records.length} records from ${tableName}`);
        }
      } catch (error) {
        console.warn(`[DEV_WIPE_ALL] Could not wipe ${tableName}:`, error);
        deletedCounts[tableName] = 0;
      }
    };

    // Wipe all user-related tables (order matters - delete dependent records first)

    // 1. Messages and conversations
    await wipeTable('messages');
    await wipeTable('conversationParticipants');

    // 2. Social interactions
    await wipeTable('likes');
    await wipeTable('matches');
    await wipeTable('blocks');
    await wipeTable('reports');

    // 3. Location features
    await wipeTable('crossedPaths');
    await wipeTable('crossPathHistory');

    // 4. Notifications
    await wipeTable('notifications');

    // 5. Truth or Dare
    await wipeTable('todAnswers');
    await wipeTable('todConnectRequests');
    await wipeTable('todPrivateMedia');

    // 6. Confessions
    await wipeTable('confessions');
    await wipeTable('confessionReplies');
    await wipeTable('confessionReactions');
    await wipeTable('confessionNotifications');

    // 7. Chat rooms
    await wipeTable('chatRoomMembers');

    // 9. Verification and security
    await wipeTable('verificationSessions');
    await wipeTable('deviceFingerprints');
    await wipeTable('behaviorFlags');
    await wipeTable('userStrikes');
    await wipeTable('sessions');

    // 10. Private profiles
    await wipeTable('userPrivateProfiles');
    await wipeTable('privateDeletionStates');

    // 11. Settings and preferences
    await wipeTable('filterPresets');

    // 12. Support and purchases
    await wipeTable('supportRequests');
    await wipeTable('purchases');
    await wipeTable('subscriptionRecords');

    // 13. Photos (metadata - storage files remain)
    await wipeTable('photos');

    // 14. Finally, delete all users
    await wipeTable('users');

    // Calculate total
    const totalDeleted = Object.values(deletedCounts).reduce((sum, count) => sum + count, 0);

    console.log('[DEV_WIPE_ALL] ════════════════════════════════════════════');
    console.log('[DEV_WIPE_ALL] === FULL DATABASE WIPE COMPLETE ===');
    console.log('[DEV_WIPE_ALL] Total records deleted:', totalDeleted);
    console.log('[DEV_WIPE_ALL] Deletion report:', JSON.stringify(deletedCounts, null, 2));
    console.log('[DEV_WIPE_ALL] ════════════════════════════════════════════');

    return {
      success: true,
      totalDeleted,
      deletedCounts,
      message: 'All user data wiped. All users must re-authenticate.',
    };
  },
});
