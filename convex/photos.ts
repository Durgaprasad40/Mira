import { v } from 'convex/values';
import { mutation, query, action } from './_generated/server';
import { Id } from './_generated/dataModel';

// Generate upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Add photo to user profile
export const addPhoto = mutation({
  args: {
    userId: v.id('users'),
    storageId: v.id('_storage'),
    isPrimary: v.boolean(),
    hasFace: v.boolean(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, storageId, isPrimary, hasFace, width, height } = args;

    // Get the URL for the uploaded file
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error('Failed to get storage URL');

    // Get current photos count
    const existingPhotos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    if (existingPhotos.length >= 6) {
      throw new Error('Maximum 6 photos allowed');
    }

    // If this is primary, update other photos
    if (isPrimary) {
      for (const photo of existingPhotos) {
        if (photo.isPrimary) {
          await ctx.db.patch(photo._id, { isPrimary: false });
        }
      }
    }

    const order = existingPhotos.length;
    const photoId = await ctx.db.insert('photos', {
      userId,
      storageId,
      url,
      order,
      isPrimary: isPrimary || existingPhotos.length === 0,
      hasFace,
      isNsfw: false, // Would be set by moderation
      width,
      height,
      createdAt: Date.now(),
    });

    return { success: true, photoId, url };
  },
});

// Delete photo
export const deletePhoto = mutation({
  args: {
    userId: v.id('users'),
    photoId: v.id('photos'),
  },
  handler: async (ctx, args) => {
    const { userId, photoId } = args;

    const photo = await ctx.db.get(photoId);
    if (!photo || photo.userId !== userId) {
      throw new Error('Photo not found');
    }

    // Get all user photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    if (photos.length <= 1) {
      throw new Error('Must have at least one photo');
    }

    // Delete from storage
    await ctx.storage.delete(photo.storageId);

    // Delete from database
    await ctx.db.delete(photoId);

    // Reorder remaining photos
    const remainingPhotos = photos
      .filter((p) => p._id !== photoId)
      .sort((a, b) => a.order - b.order);

    for (let i = 0; i < remainingPhotos.length; i++) {
      const updates: Record<string, unknown> = { order: i };
      // If deleted photo was primary, make first photo primary
      if (photo.isPrimary && i === 0) {
        updates.isPrimary = true;
      }
      await ctx.db.patch(remainingPhotos[i]._id, updates);
    }

    return { success: true };
  },
});

// Reorder photos
export const reorderPhotos = mutation({
  args: {
    userId: v.id('users'),
    photoIds: v.array(v.id('photos')),
  },
  handler: async (ctx, args) => {
    const { userId, photoIds } = args;

    // Verify all photos belong to user
    for (const photoId of photoIds) {
      const photo = await ctx.db.get(photoId);
      if (!photo || photo.userId !== userId) {
        throw new Error('Invalid photo');
      }
    }

    // Update order
    for (let i = 0; i < photoIds.length; i++) {
      await ctx.db.patch(photoIds[i], {
        order: i,
        isPrimary: i === 0,
      });
    }

    return { success: true };
  },
});

// Get user photos
export const getUserPhotos = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', args.userId))
      .collect();

    return photos.sort((a, b) => a.order - b.order);
  },
});

// Set primary photo
export const setPrimaryPhoto = mutation({
  args: {
    userId: v.id('users'),
    photoId: v.id('photos'),
  },
  handler: async (ctx, args) => {
    const { userId, photoId } = args;

    const photo = await ctx.db.get(photoId);
    if (!photo || photo.userId !== userId) {
      throw new Error('Photo not found');
    }

    // Get all user photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // Update primary status
    for (const p of photos) {
      await ctx.db.patch(p._id, {
        isPrimary: p._id === photoId,
      });
    }

    return { success: true };
  },
});

// Mark photo as NSFW (admin/moderation)
export const markPhotoNsfw = mutation({
  args: {
    photoId: v.id('photos'),
    isNsfw: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.photoId, { isNsfw: args.isNsfw });
    return { success: true };
  },
});

// Save verification photo
export const saveVerificationPhoto = mutation({
  args: {
    userId: v.id('users'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const { userId, storageId } = args;

    await ctx.db.patch(userId, {
      verificationPhotoId: storageId,
    });

    return { success: true };
  },
});
