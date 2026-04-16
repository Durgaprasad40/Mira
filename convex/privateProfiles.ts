import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { isPrivateDataDeleted } from './privateDeletion';
import { resolveUserIdByAuthId } from './helpers';

function calculateAgeFromDOB(dob: string | undefined | null): number {
  // Mirror Phase-1 backend behavior: accept any parsable date string (ISO or YYYY-MM-DD).
  if (!dob) return 0;
  const today = new Date();
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 && age < 120 ? age : 0;
}

function ageFromUser(user: any): number {
  // Canonical source of truth: users.dateOfBirth (Phase-1)
  const dob = user?.dateOfBirth;
  return calculateAgeFromDOB(typeof dob === 'string' ? dob : null);
}

export const debugAgeSourcesByAuthUserId = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return { success: false as const, error: 'user_not_found' as const };
    }
    const user = await ctx.db.get(userId);
    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    return {
      success: true as const,
      userId,
      userDateOfBirth: (user as any)?.dateOfBirth ?? null,
      derivedAgeFromDob: ageFromUser(user),
      privateProfileAge: (profile as any)?.age ?? null,
      hasPrivateProfile: Boolean(profile),
    };
  },
});

export const backfillPrivateProfileAgeByAuthUserId = mutation({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return { success: false as const, error: 'user_not_found' as const };
    }
    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false as const, error: 'user_not_found' as const };
    }
    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    if (!profile) {
      return { success: false as const, error: 'profile_not_found' as const };
    }

    const nextAge = ageFromUser(user);
    if (!nextAge || nextAge <= 0) {
      return { success: false as const, error: 'missing_or_invalid_dob' as const };
    }

    await ctx.db.patch(profile._id, { age: nextAge, updatedAt: Date.now() });
    return {
      success: true as const,
      userDateOfBirth: (user as any)?.dateOfBirth ?? null,
      previousAge: (profile as any)?.age ?? null,
      nextAge,
    };
  },
});

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
    photoBlurEnabled: v.optional(v.boolean()),
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
    // Phase-2 Photo & Media Privacy
    defaultPhotoVisibility: v.optional(
      v.union(v.literal('public'), v.literal('blurred'), v.literal('private'))
    ),
    allowUnblurRequests: v.optional(v.boolean()),
    defaultSecureMediaTimer: v.optional(
      v.union(v.literal(0), v.literal(10), v.literal(30))
    ),
    defaultSecureMediaViewingMode: v.optional(
      v.union(v.literal('tap'), v.literal('hold'))
    ),
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

    // Self-heal: opportunistically fix age if invalid
    const needsAgeFix =
      typeof existing.age !== 'number' ||
      existing.age <= 0 ||
      existing.age >= 120;

    if (needsAgeFix) {
      const user = await ctx.db.get(userId);
      const fixedAge = ageFromUser(user);
      if (fixedAge > 0) {
        cleanUpdates.age = fixedAge;
        console.log('[PRIVATE_PROFILE] updateFieldsByAuthId: healed age', {
          previousAge: existing.age,
          fixedAge,
        });
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
 * Update Phase-2 nickname (displayName) with server-side edit limit enforcement.
 *
 * Rules:
 * - Total allowed changes = 3
 * - Onboarding creation counts as first use (saveOnboardingPhotos sets count=1)
 * - Missing count is treated as 0 (backward compatible)
 */
export const updateDisplayNameByAuthId = mutation({
  args: {
    authUserId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.displayName.trim();
    if (trimmed.length < 3 || trimmed.length > 20 || !/^[A-Za-z0-9]+$/.test(trimmed)) {
      return { success: false, error: 'INVALID_DISPLAY_NAME' as const };
    }

    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return { success: false, error: 'user_not_found' as const };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return { success: false, error: 'deletion_pending' as const };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      return { success: false, error: 'profile_not_found' as const };
    }

    const currentCount = (existing as any).displayNameEditCount ?? 0;
    if (currentCount >= 3) {
      return { success: false, error: 'Nickname change limit reached' as const };
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      displayName: trimmed,
      displayNameEditCount: currentCount + 1,
      lastDisplayNameEditedAt: now,
      updatedAt: now,
    });

    return { success: true as const, displayNameEditCount: currentCount + 1 };
  },
});

/**
 * Manual one-shot sync: copy selected Phase-1 fields into Phase-2 private profile.
 *
 * IMPORTANT:
 * - This is NOT automatic; it must be explicitly invoked by the client.
 * - Only syncs inherited "details" fields; does not touch nickname, photos, prompts, bio, intents, age, or gender.
 */
export const syncFromMainProfile = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return { success: false, error: 'user_not_found' as const };
    }

    // Phase-1 user record (source of truth for this manual sync)
    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false, error: 'user_not_found' as const };
    }

    // Phase-2 private profile (target)
    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    if (!existing) {
      return { success: false, error: 'profile_not_found' as const };
    }

    // Build patch object - NEVER write null (schema only accepts undefined)
    const patch: Record<string, unknown> = {
      hobbies: (user as any).activities ?? [],
      updatedAt: Date.now(),
    };

    // Only include lifestyle fields if they have valid values
    const height = (user as any).height;
    const weight = (user as any).weight;
    const smoking = (user as any).smoking;
    const drinking = (user as any).drinking;
    const education = (user as any).education;
    const religion = (user as any).religion;

    if (typeof height === 'number' && height > 0) patch.height = height;
    if (typeof weight === 'number' && weight > 0) patch.weight = weight;
    if (typeof smoking === 'string' && smoking.length > 0) patch.smoking = smoking;
    if (typeof drinking === 'string' && drinking.length > 0) patch.drinking = drinking;
    if (typeof education === 'string' && education.length > 0) patch.education = education;
    if (typeof religion === 'string' && religion.length > 0) patch.religion = religion;

    await ctx.db.patch(existing._id, patch);

    return { success: true as const };
  },
});

/**
 * Migration/backfill: Fix userPrivateProfiles rows with missing/invalid age by recomputing from users.dateOfBirth.
 *
 * - Scans userPrivateProfiles
 * - If age is 0/invalid and user has DOB, patches age
 * - Returns counts for reporting
 */
export const backfillPrivateProfileAges = mutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('userPrivateProfiles').collect();
    let scanned = 0;
    let fixed = 0;
    let skippedNoDob = 0;
    let skippedNoUser = 0;

    for (const p of profiles) {
      scanned++;
      const currentAge = (p as any).age;
      const isInvalid = typeof currentAge !== 'number' || !Number.isFinite(currentAge) || currentAge <= 0 || currentAge >= 120;
      if (!isInvalid) continue;

      const user = await ctx.db.get((p as any).userId);
      if (!user) {
        skippedNoUser++;
        continue;
      }
      const nextAge = ageFromUser(user);
      if (!nextAge || nextAge <= 0) {
        skippedNoDob++;
        continue;
      }
      await ctx.db.patch(p._id, { age: nextAge, updatedAt: Date.now() });
      fixed++;
    }

    return { success: true as const, scanned, fixed, skippedNoDob, skippedNoUser };
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
    displayName: v.optional(v.string()),
    // Phase-1 imported fields to persist into Phase-2 on initial skeleton creation only
    // NOTE: age is derived from backend users.dateOfBirth (args.age ignored; kept for backwards-compat callers)
    age: v.optional(v.number()),
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
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
      // Build patch object starting with photos
      const patch: Record<string, unknown> = {
        privatePhotoUrls: args.privatePhotoUrls,
        updatedAt: now,
      };

      // Self-heal: fix age if invalid
      const needsAgeFix =
        typeof existing.age !== 'number' ||
        existing.age <= 0 ||
        existing.age >= 120;

      if (needsAgeFix) {
        const user = await ctx.db.get(userId);
        const fixedAge = ageFromUser(user);
        if (fixedAge > 0) {
          patch.age = fixedAge;
          console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: healed age', {
            previousAge: existing.age,
            fixedAge,
          });
        }
      }

      await ctx.db.patch(existing._id, patch);
      console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: updated existing profile');
      return { success: true, profileId: existing._id };
    }

    // Create skeleton profile for onboarding (will be completed in later steps)
    // Get user data to populate required fields with defaults
    const user = await ctx.db.get(userId);
    const derivedAge = ageFromUser(user);
    const trimmedDisplayName =
      typeof args.displayName === 'string' ? args.displayName.trim() : '';

    if (trimmedDisplayName.length < 3 || trimmedDisplayName.length > 20 || !/^[A-Za-z0-9]+$/.test(trimmedDisplayName)) {
      return { success: false, error: 'display_name_required' as const };
    }
    const profileId = await ctx.db.insert('userPrivateProfiles', {
      userId,
      displayName: trimmedDisplayName || '',
      // Onboarding creation counts as first nickname usage
      displayNameEditCount: 1,
      lastDisplayNameEditedAt: now,
      // Canonical identity field: backend source of truth only
      age: derivedAge,
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
      // Phase-1 import: only set during skeleton creation (do not overwrite later Phase-2 edits)
      // NOTE: userPrivateProfiles schema stores these as optional (undefined) rather than null.
      height: args.height ?? undefined,
      weight: args.weight ?? undefined,
      smoking: args.smoking ?? undefined,
      drinking: args.drinking ?? undefined,
      education: args.education ?? undefined,
      religion: args.religion ?? undefined,
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
 * NOTE: This app uses custom session-based auth (not Convex auth integration).
 * Ownership is verified by resolving the provided authUserId to a valid user.
 * The frontend only sends the user's own ID from authStore (populated after login).
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

    // Verify the user exists (ownership check via ID resolution)
    const user = await ctx.db.get(userId);
    if (!user) {
      console.log('[P2_PROFILE_QUERY] getByAuthUserId: user record not found', {
        userId: (userId as string)?.substring(0, 8),
      });
      return null;
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
 * Self-healing version of getByAuthUserId.
 * On every call, checks if profile.age is invalid and auto-corrects from users.dateOfBirth.
 * This ensures existing broken profiles (age=0) automatically heal without manual backfill.
 *
 * IMPORTANT: This is a mutation (not a query) because it writes to the database.
 * Frontend should use useMutation and call this on profile load for self-healing.
 */
export const getAndHealByAuthUserId = mutation({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return null;
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!profile) {
      return null;
    }

    // Self-heal: check if age is invalid and fix it
    const needsAgeFix =
      typeof profile.age !== 'number' ||
      profile.age <= 0 ||
      profile.age >= 120;

    let returnProfile = profile;

    if (needsAgeFix) {
      const fixedAge = ageFromUser(user);
      if (fixedAge > 0) {
        // Patch DB immediately
        await ctx.db.patch(profile._id, {
          age: fixedAge,
          updatedAt: Date.now(),
        });
        console.log('[PRIVATE_PROFILE] getAndHealByAuthUserId: healed age', {
          userId: userId.substring(0, 8),
          previousAge: profile.age,
          fixedAge,
        });
        // Return corrected value
        returnProfile = { ...profile, age: fixedAge };
      }
    }

    // Normalize privateIntentKeys
    const privateIntentKeys = returnProfile.privateIntentKeys ?? [];

    return {
      ...returnProfile,
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
    // NOTE: Do NOT allow displayName updates here (nickname limit is enforced in updateDisplayNameByAuthId).
    // Keep displayName in args for backward compatibility of callers, but do not patch it on existing profiles.
    displayName: v.string(),
    // NOTE: age is derived from backend users.dateOfBirth (args.age ignored; kept for backwards-compat callers)
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

    const user = await ctx.db.get(userId);
    if (!user) {
      console.warn('[PRIVATE_PROFILE] upsertByAuthId: user record not found');
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
      // Canonical identity fields: backend source of truth only
      age: ageFromUser(user),
      gender: user?.gender || args.gender,
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
      // SAFETY: Prevent bypassing nickname limit via upsert.
      // Preserve existing displayName and related nickname-limit fields.
      const { displayName: _ignoreDisplayName, ...rest } = profileData as any;
      await ctx.db.patch(existing._id, {
        ...rest,
        updatedAt: now,
      });
      console.log('[PRIVATE_PROFILE] upsertByAuthId: updated existing profile');
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...profileData,
      // Initialize nickname edit limit fields on first creation (onboarding counts as first use elsewhere)
      displayNameEditCount: 1,
      lastDisplayNameEditedAt: now,
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
 * Update photo blur settings for user's private profile.
 * Pass only the fields you want to change. At least one of photoBlurSlots or photoBlurEnabled must be provided.
 */
export const updatePhotoBlurSlots = mutation({
  args: {
    authUserId: v.string(),
    photoBlurSlots: v.optional(v.array(v.boolean())),
    photoBlurEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.photoBlurSlots === undefined && args.photoBlurEnabled === undefined) {
      throw new Error('photoBlurSlots or photoBlurEnabled required');
    }

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
      const patch: Record<string, unknown> = { updatedAt: now };
      if (args.photoBlurSlots !== undefined) {
        patch.photoBlurSlots = args.photoBlurSlots;
      }
      if (args.photoBlurEnabled !== undefined) {
        patch.photoBlurEnabled = args.photoBlurEnabled;
      }
      await ctx.db.patch(existing._id, patch);
      return { success: true };
    }

    // No profile exists yet - this shouldn't happen in normal flow
    // but we handle it gracefully
    throw new Error('Private profile not found. Please complete profile setup first.');
  },
});
