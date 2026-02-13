import { v } from 'convex/values';
import { mutation, query, action } from './_generated/server';
import { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// 8A: Photo Upload Validation Constants
// ---------------------------------------------------------------------------

const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MIN_PHOTO_DIMENSION = 200; // Minimum width/height in pixels

// Generate upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * 8A: Validate photo before upload.
 * Call this before uploading to check size/type constraints.
 */
export const validatePhotoUpload = query({
  args: {
    fileSize: v.number(),
    mimeType: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { fileSize, mimeType, width, height } = args;
    const errors: string[] = [];

    // Check file size
    if (fileSize > MAX_PHOTO_SIZE_BYTES) {
      errors.push(`Photo must be under ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB`);
    }

    // Check mime type
    if (!ALLOWED_PHOTO_TYPES.includes(mimeType.toLowerCase())) {
      errors.push(`Photo must be JPEG, PNG, WebP, or HEIC format`);
    }

    // Check dimensions if provided
    if (width && width < MIN_PHOTO_DIMENSION) {
      errors.push(`Photo width must be at least ${MIN_PHOTO_DIMENSION}px`);
    }
    if (height && height < MIN_PHOTO_DIMENSION) {
      errors.push(`Photo height must be at least ${MIN_PHOTO_DIMENSION}px`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
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
    // 8C: Client-reported flags for upload hardening
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    isNsfwDetected: v.optional(v.boolean()), // Client-side NSFW detection result
  },
  handler: async (ctx, args) => {
    const { userId, storageId, isPrimary, hasFace, width, height, fileSize, mimeType, isNsfwDetected } = args;

    // BUGFIX #67: Validate storage ID exists before proceeding
    // Get the URL for the uploaded file - this validates storageId exists
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new Error('Invalid storage reference: file does not exist');
    }

    // BUGFIX #66: Validate URL is not empty and has valid format
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('Invalid photo URL: URL cannot be empty');
    }
    // Basic URL format check (must start with http:// or https://)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Invalid photo URL: must be a valid HTTP(S) URL');
    }

    // 9-3: Verify user has accepted consent before allowing photo upload
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');
    if (!user.consentAcceptedAt) {
      throw new Error('Please accept the data consent agreement before uploading photos.');
    }

    // 8C: Server-side validation of file constraints
    if (fileSize !== undefined && fileSize > MAX_PHOTO_SIZE_BYTES) {
      throw new Error(`Photo must be under ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB`);
    }
    if (mimeType !== undefined && !ALLOWED_PHOTO_TYPES.includes(mimeType.toLowerCase())) {
      throw new Error('Photo must be JPEG, PNG, WebP, or HEIC format');
    }

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
    const isFirstPhoto = existingPhotos.length === 0;
    const willBePrimary = isPrimary || isFirstPhoto;

    // 8C: Use client-reported NSFW detection
    const flaggedNsfw = isNsfwDetected === true;

    const photoId = await ctx.db.insert('photos', {
      userId,
      storageId,
      url,
      order,
      isPrimary: willBePrimary,
      hasFace,
      isNsfw: flaggedNsfw,
      width,
      height,
      createdAt: Date.now(),
    });

    // 8C: If NSFW detected, route to moderation queue for manual review
    if (flaggedNsfw) {
      await ctx.db.insert('moderationQueue', {
        reportedUserId: userId,
        contentType: 'profile_photo',
        contentId: photoId,
        flagCategories: ['nsfw_content'],
        isAutoFlagged: true,
        status: 'pending',
        createdAt: Date.now(),
      });
    }

    // 8A: If this is the primary photo and user is not yet verified,
    // set verification status to pending_auto to trigger verification flow
    if (willBePrimary) {
      const user = await ctx.db.get(userId);
      if (user) {
        const currentStatus = user.verificationStatus || 'unverified';
        // Only update if not already verified
        if (currentStatus !== 'verified') {
          await ctx.db.patch(userId, {
            verificationStatus: 'pending_auto',
          });
        }
      }
    }

    return { success: true, photoId, url, requiresVerification: willBePrimary };
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

    // BUGFIX #67: Validate storage ID exists before saving
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new Error('Invalid storage reference: verification photo does not exist');
    }

    await ctx.db.patch(userId, {
      verificationPhotoId: storageId,
    });

    return { success: true };
  },
});
