import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Get private profile by user ID
export const getByUserId = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
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
