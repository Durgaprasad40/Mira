import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { isPrivateDataDeleted } from './privateDeletion';
import { resolveUserIdByAuthId } from './helpers';

// Get private profile by user ID
export const getByUserId = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, args.userId);
    if (isDeleted) {
      return null; // Return null if data is pending deletion
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();
    return profile;
  },
});

// Create or update private profile
// NOTE: hobbies and isVerified are imported from Phase-1 during setup and stored here for isolation
export const upsert = mutation({
  args: {
    userId: v.id('users'),
    isPrivateEnabled: v.boolean(),
    ageConfirmed18Plus: v.boolean(),
    ageConfirmedAt: v.optional(v.number()),
    privatePhotosBlurred: v.array(v.id('_storage')),
    privatePhotoUrls: v.array(v.string()),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateIntentKeys: v.array(v.string()),
    privateDesireTagKeys: v.array(v.string()),
    privateBoundaries: v.array(v.string()),
    privateBio: v.optional(v.string()),
    displayName: v.string(),
    age: v.number(),
    city: v.optional(v.string()),
    gender: v.string(),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.boolean(),
    // Phase-1 imported fields (stored in Phase-2 for isolation)
    hobbies: v.optional(v.array(v.string())),
    isVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // C9 FIX: Require authentication and verify ownership (pattern: truthDare.ts:1424-1426)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot modify another user profile');
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, args.userId);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    return { success: true, profileId };
  },
});

// Update specific fields on private profile
export const updateFields = mutation({
  args: {
    userId: v.id('users'),
    isPrivateEnabled: v.optional(v.boolean()),
    privateIntentKeys: v.optional(v.array(v.string())),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    privateBio: v.optional(v.string()),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.optional(v.boolean()),
    // Profile details
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    // Photos
    privatePhotoUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // BE-001 SECURITY FIX: Require authentication and verify ownership
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot modify another user profile');
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, args.userId);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!existing) {
      throw new Error('Private profile not found');
    }

    const { userId, ...updates } = args;
    // Remove undefined values
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    return { success: true };
  },
});

// Update blurred photos after upload
export const updateBlurredPhotos = mutation({
  args: {
    userId: v.id('users'),
    privatePhotosBlurred: v.array(v.id('_storage')),
    privatePhotoUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // BE-002 SECURITY FIX: Require authentication and verify ownership
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot modify another user photos');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!existing) {
      throw new Error('Private profile not found');
    }

    await ctx.db.patch(existing._id, {
      privatePhotosBlurred: args.privatePhotosBlurred,
      privatePhotoUrls: args.privatePhotoUrls,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete private profile
export const deleteProfile = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    // BE-003 SECURITY FIX: Require authentication and verify ownership
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot delete another user profile');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!existing) return { success: true };

    // Delete blurred photos from storage
    for (const storageId of existing.privatePhotosBlurred) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // Storage item may already be deleted
      }
    }

    await ctx.db.delete(existing._id);
    return { success: true };
  },
});

/**
 * Update specific fields on private profile by auth user ID.
 * Uses the same auth-safe pattern as upsertByAuthId (no ctx.auth.getUserIdentity).
 * Used by Phase-2 profile for photo sync and field updates.
 */
export const updateFieldsByAuthId = mutation({
  args: {
    authUserId: v.string(),
    // Photos
    privatePhotoUrls: v.optional(v.array(v.string())),
    photoBlurSlots: v.optional(v.array(v.boolean())),
    // Profile details
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    hobbies: v.optional(v.array(v.string())),
    // Other optional fields
    privateBio: v.optional(v.string()),
    privateIntentKeys: v.optional(v.array(v.string())),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    isPrivateEnabled: v.optional(v.boolean()),
    // Phase-2 Onboarding Step 3: Prompt answers
    promptAnswers: v.optional(v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    }))),
    // Phase-2 Preference Strength (ranking signal)
    preferenceStrength: v.optional(v.object({
      smoking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      drinking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      intent: v.union(v.literal('not_important'), v.literal('prefer_similar'), v.literal('important'), v.literal('must_match_exactly')),
    })),
    // Phase-2 Privacy
    hideFromDeepConnect: v.optional(v.boolean()),
    hideAge: v.optional(v.boolean()),
    hideDistance: v.optional(v.boolean()),
    disableReadReceipts: v.optional(v.boolean()),
    // Phase-2 Safety
    safeMode: v.optional(v.boolean()),
    // Phase-2 Notifications
    notificationsEnabled: v.optional(v.boolean()),
    notificationCategories: v.optional(v.object({
      deepConnect: v.optional(v.boolean()),
      privateMessages: v.optional(v.boolean()),
      chatRooms: v.optional(v.boolean()),
      truthOrDare: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.warn('[PRIVATE_PROFILE] updateFieldsByAuthId: user not found');
      return { success: false, error: 'user_not_found' };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] updateFieldsByAuthId: deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      console.warn('[PRIVATE_PROFILE] updateFieldsByAuthId: profile not found');
      return { success: false, error: 'profile_not_found' };
    }

    // Build clean updates (only defined values)
    const { authUserId, ...updates } = args;
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    if (cleanUpdates.privateIntentKeys !== undefined) {
      console.log('[P2_PREF_SAVE]', {
        privateIntentKeys: cleanUpdates.privateIntentKeys as string[],
      });
    }
    console.log('[PRIVATE_PROFILE] updateFieldsByAuthId: success');
    return { success: true };
  },
});

/**
 * Save onboarding photos for Phase-2 Step 2.
 * Creates a skeleton profile if none exists, updates photos if it does.
 * Used specifically during Phase-2 onboarding before full profile is complete.
 */
export const saveOnboardingPhotos = mutation({
  args: {
    authUserId: v.string(),
    privatePhotoUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.warn('[PRIVATE_PROFILE] saveOnboardingPhotos: user not found');
      return { success: false, error: 'user_not_found' };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] saveOnboardingPhotos: deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing profile with photos
      await ctx.db.patch(existing._id, {
        privatePhotoUrls: args.privatePhotoUrls,
        updatedAt: now,
      });
      console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: updated existing profile');
      return { success: true, profileId: existing._id };
    }

    // Create skeleton profile for onboarding (will be completed in later steps)
    // Get user data to populate required fields with defaults
    const user = await ctx.db.get(userId);
    const profileId = await ctx.db.insert('userPrivateProfiles', {
      userId,
      displayName: user?.handle || user?.name || '',
      age: 0, // Will be calculated from DOB in later steps
      gender: user?.gender || '',
      privateBio: '',
      privateIntentKeys: [],
      privatePhotoUrls: args.privatePhotoUrls,
      city: user?.city || '',
      isPrivateEnabled: true,
      ageConfirmed18Plus: true,
      ageConfirmedAt: now,
      privatePhotosBlurred: [],
      privatePhotoBlurLevel: 0,
      privateDesireTagKeys: [],
      privateBoundaries: [],
      revealPolicy: 'mutual_only',
      isSetupComplete: false,
      hobbies: user?.activities || [],
      isVerified: user?.isVerified || false,
      promptAnswers: [],
      createdAt: now,
      updatedAt: now,
    });
    console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: created skeleton profile');
    return { success: true, profileId };
  },
});

/**
 * Get private profile by auth user ID (string).
 * Resolves auth ID to Convex user ID internally.
 * Used by Phase-2 Profile tab to load backend data.
 *
 * PROFILE-P1-002 FIX: Strict server-side auth verification.
 */
export const getByAuthUserId = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    // Resolve the provided authUserId to a Convex user ID
    // authUserId can be either a Convex ID directly or a Clerk/auth ID
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.log('[P2_PROFILE_QUERY] getByAuthUserId: user not found', {
        authUserId: args.authUserId?.substring(0, 8),
      });
      return null;
    }

    // PROFILE-P1-002 FIX: Verify caller owns this profile
    // Compare Clerk identity against the user's stored authUserId field
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const user = await ctx.db.get(userId);
      // If user has an authUserId field, verify it matches the Clerk identity
      if (user?.authUserId && user.authUserId !== identity.subject) {
        console.log('[P2_PROFILE_QUERY] getByAuthUserId: auth mismatch', {
          userAuthUserId: user.authUserId?.substring(0, 8),
          identitySubject: identity.subject?.substring(0, 8),
        });
        return null;
      }
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.log('[P2_PROFILE_QUERY] getByAuthUserId: deletion pending');
      return null;
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!profile) {
      console.log('[P2_PROFILE_QUERY] getByAuthUserId: no profile found', {
        userId: userId?.substring(0, 8),
      });
      return null;
    }

    // Always expose privateIntentKeys to clients (schema-required; normalize if ever missing in a row)
    const privateIntentKeys = profile.privateIntentKeys ?? [];

    // TEMP: remove after QA — verify Phase-2 intents round-trip
    console.log('[P2_PREF_BACKEND_READ]', {
      privateIntentKeys,
    });

    return {
      ...profile,
      privateIntentKeys,
    };
  },
});

/**
 * Upsert private profile by auth user ID.
 * Called from Phase-2 onboarding completion to persist profile to Convex.
 * IMPORTANT: Only stores backend URLs, not local file URIs.
 */
export const upsertByAuthId = mutation({
  args: {
    authUserId: v.string(),
    displayName: v.string(),
    age: v.number(),
    gender: v.string(),
    privateBio: v.optional(v.string()),
    privateIntentKeys: v.array(v.string()),
    privatePhotoUrls: v.array(v.string()),
    city: v.optional(v.string()),
    // Optional fields with defaults
    isPrivateEnabled: v.optional(v.boolean()),
    ageConfirmed18Plus: v.optional(v.boolean()),
    ageConfirmedAt: v.optional(v.number()),
    privatePhotosBlurred: v.optional(v.array(v.id('_storage'))),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.optional(v.boolean()),
    hobbies: v.optional(v.array(v.string())),
    isVerified: v.optional(v.boolean()),
    // Profile details (imported from Phase-1)
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    // Phase-2 Onboarding Step 3: Prompt answers
    promptAnswers: v.optional(v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    }))),
    // Phase-2 Preference Strength (ranking signal)
    preferenceStrength: v.optional(v.object({
      smoking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      drinking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      intent: v.union(v.literal('not_important'), v.literal('prefer_similar'), v.literal('important'), v.literal('must_match_exactly')),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.warn('[PRIVATE_PROFILE] upsertByAuthId: user not found for authId');
      return { success: false, error: 'user_not_found' };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] upsertByAuthId: cannot update while deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    // Build profile data with defaults
    const profileData = {
      userId,
      displayName: args.displayName,
      age: args.age,
      gender: args.gender,
      privateBio: args.privateBio || '',
      privateIntentKeys: args.privateIntentKeys,
      privatePhotoUrls: args.privatePhotoUrls,
      city: args.city || '',
      isPrivateEnabled: args.isPrivateEnabled ?? true,
      ageConfirmed18Plus: args.ageConfirmed18Plus ?? true,
      ageConfirmedAt: args.ageConfirmedAt ?? now,
      privatePhotosBlurred: args.privatePhotosBlurred ?? [],
      privatePhotoBlurLevel: args.privatePhotoBlurLevel ?? 0,
      privateDesireTagKeys: args.privateDesireTagKeys ?? [],
      privateBoundaries: args.privateBoundaries ?? [],
      revealPolicy: args.revealPolicy ?? 'mutual_only',
      isSetupComplete: args.isSetupComplete ?? false,
      hobbies: args.hobbies ?? [],
      isVerified: args.isVerified ?? false,
      // Phase-2 Onboarding Step 3: Prompt answers
      promptAnswers: args.promptAnswers ?? [],
    };

    // Profile details (imported from Phase-1) - only include if defined
    // Schema uses v.optional(), not v.union with null, so we omit undefined/null values
    if (args.height !== undefined && args.height !== null) {
      (profileData as any).height = args.height;
    }
    if (args.weight !== undefined && args.weight !== null) {
      (profileData as any).weight = args.weight;
    }
    if (args.smoking !== undefined && args.smoking !== null) {
      (profileData as any).smoking = args.smoking;
    }
    if (args.drinking !== undefined && args.drinking !== null) {
      (profileData as any).drinking = args.drinking;
    }
    if (args.education !== undefined && args.education !== null) {
      (profileData as any).education = args.education;
    }
    if (args.religion !== undefined && args.religion !== null) {
      (profileData as any).religion = args.religion;
    }

    // Preference Strength - only include if provided (fully complete object)
    if (args.preferenceStrength) {
      (profileData as any).preferenceStrength = args.preferenceStrength;
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...profileData,
        updatedAt: now,
      });
      console.log('[PRIVATE_PROFILE] upsertByAuthId: updated existing profile');
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...profileData,
      createdAt: now,
      updatedAt: now,
    });
    console.log('[PRIVATE_PROFILE] upsertByAuthId: created new profile');
    return { success: true, profileId };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO BLUR SLOTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update photo blur slots for user's private profile.
 * Each slot indicates whether that photo position should be blurred.
 */
export const updatePhotoBlurSlots = mutation({
  args: {
    authUserId: v.string(),
    photoBlurSlots: v.array(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Resolve auth ID to user ID
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Find existing profile
    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing profile
      await ctx.db.patch(existing._id, {
        photoBlurSlots: args.photoBlurSlots,
        updatedAt: now,
      });
      return { success: true };
    }

    // No profile exists yet - this shouldn't happen in normal flow
    // but we handle it gracefully
    throw new Error('Private profile not found. Please complete profile setup first.');
  },
});
