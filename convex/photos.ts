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

// Save verification photo (legacy - use uploadVerificationReferencePhoto instead)
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

// =============================================================================
// "Verified Face Required, Privacy After" Policy Mutations
// =============================================================================

/**
 * Photo Gate: Upload a verification reference photo during onboarding.
 *
 * Requirements:
 * - Photo must have exactly one clearly visible face
 * - This photo is stored privately and used for face verification
 * - User cannot proceed until this gate passes
 *
 * Returns success if photo meets requirements, or error with specific reason.
 */
export const uploadVerificationReferencePhoto = mutation({
  args: {
    userId: v.id('users'),
    storageId: v.id('_storage'),
    hasFace: v.boolean(),           // Client-side face detection result
    faceCount: v.optional(v.number()), // Number of faces detected
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, storageId, hasFace, faceCount, width, height, fileSize, mimeType } = args;

    console.log(`[PHOTO_GATE] start user=${userId}`);

    // Validate storage exists
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      console.log(`[PHOTO_GATE] FAIL: Invalid storage reference`);
      throw new Error('Invalid storage reference: file does not exist');
    }

    // Verify user exists and has accepted consent
    const user = await ctx.db.get(userId);
    if (!user) {
      console.log(`[PHOTO_GATE] FAIL: User not found`);
      throw new Error('User not found');
    }
    if (!user.consentAcceptedAt) {
      console.log(`[PHOTO_GATE] FAIL: No consent`);
      throw new Error('Please accept the data consent agreement before uploading photos.');
    }

    // Validate file constraints
    if (fileSize !== undefined && fileSize > MAX_PHOTO_SIZE_BYTES) {
      console.log(`[PHOTO_GATE] FAIL: file_too_large size=${fileSize}`);
      return {
        success: false,
        error: 'file_too_large',
        message: `Photo must be under ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB`,
      };
    }
    if (mimeType !== undefined && !ALLOWED_PHOTO_TYPES.includes(mimeType.toLowerCase())) {
      console.log(`[PHOTO_GATE] FAIL: invalid_format type=${mimeType}`);
      return {
        success: false,
        error: 'invalid_format',
        message: 'Photo must be JPEG, PNG, WebP, or HEIC format',
      };
    }

    console.log(`[PHOTO_GATE] faces=${faceCount ?? (hasFace ? 1 : 0)} hasFace=${hasFace}`);

    // GATE CHECK: Must have exactly one face
    if (!hasFace) {
      console.log(`[PHOTO_GATE] FAIL: no_face_detected`);
      return {
        success: false,
        error: 'no_face_detected',
        message: 'No face detected in the photo. Please upload a clear photo showing your face.',
      };
    }

    // Check for multiple faces
    if (faceCount !== undefined && faceCount > 1) {
      console.log(`[PHOTO_GATE] FAIL: multiple_faces count=${faceCount}`);
      return {
        success: false,
        error: 'multiple_faces',
        message: 'Multiple faces detected. Please upload a solo photo showing only your face.',
      };
    }

    console.log(`[PHOTO_GATE] faces=1 pass=true`);

    // Create the photo record as verification_reference type
    const photoId = await ctx.db.insert('photos', {
      userId,
      storageId,
      url,
      order: 0,
      isPrimary: true, // Will be primary until display photo is set differently
      hasFace: true,
      isNsfw: false,
      width,
      height,
      createdAt: Date.now(),
      photoType: 'verification_reference',
    });

    console.log(`[PHOTO_GATE] stored verificationReferencePhotoId=${storageId}`);

    // Update user with verification reference photo
    await ctx.db.patch(userId, {
      verificationReferencePhotoId: storageId,
      verificationReferencePhotoUrl: url,
      // Also set as display photo initially (original variant)
      displayPrimaryPhotoId: storageId,
      displayPrimaryPhotoUrl: url,
      displayPrimaryPhotoVariant: 'original',
      // Set verification status to pending
      faceVerificationStatus: 'unverified',
      verificationStatus: 'pending_auto',
    });

    console.log(`[PHOTO_GATE] user updated verificationReferencePhotoId set=true`);

    return {
      success: true,
      photoId,
      url,
      message: 'Photo uploaded successfully. You can now proceed to face verification.',
    };
  },
});

/**
 * Set display photo variant after face verification passes.
 *
 * Options:
 * - 'original': Use the verification reference photo as-is
 * - 'blurred': Apply blur effect to the face (client provides blurred version)
 * - 'cartoon': Use AI-generated cartoon version (client provides cartoon version)
 *
 * Only allowed after faceVerificationStatus === 'verified'
 */
export const setDisplayPhotoVariant = mutation({
  args: {
    userId: v.id('users'),
    variant: v.union(v.literal('original'), v.literal('blurred'), v.literal('cartoon')),
    // For blurred/cartoon, client uploads a processed version
    processedStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    const { userId, variant, processedStorageId } = args;

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // SECURITY: Only allow changing display photo after face verification passes
    if (user.faceVerificationStatus !== 'verified') {
      throw new Error('Face verification must be completed before changing display photo privacy.');
    }

    // Ensure verification reference exists
    if (!user.verificationReferencePhotoId) {
      throw new Error('No verification reference photo found. Please complete photo upload first.');
    }

    if (variant === 'original') {
      // Use the original verification reference photo
      await ctx.db.patch(userId, {
        displayPrimaryPhotoId: user.verificationReferencePhotoId,
        displayPrimaryPhotoUrl: user.verificationReferencePhotoUrl,
        displayPrimaryPhotoVariant: 'original',
      });
    } else {
      // For blurred/cartoon, need the processed version
      if (!processedStorageId) {
        throw new Error(`Processed photo required for ${variant} variant.`);
      }

      const url = await ctx.storage.getUrl(processedStorageId);
      if (!url) {
        throw new Error('Invalid processed photo storage reference');
      }

      // Create a new photo record for the variant
      const existingPhotos = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();

      const originalPhoto = existingPhotos.find(p => p.photoType === 'verification_reference');

      await ctx.db.insert('photos', {
        userId,
        storageId: processedStorageId,
        url,
        order: 0,
        isPrimary: true,
        hasFace: true,
        isNsfw: false,
        createdAt: Date.now(),
        photoType: 'display',
        derivedFromPhotoId: originalPhoto?._id,
        variantType: variant,
      });

      await ctx.db.patch(userId, {
        displayPrimaryPhotoId: processedStorageId,
        displayPrimaryPhotoUrl: url,
        displayPrimaryPhotoVariant: variant,
      });
    }

    return { success: true, variant };
  },
});

/**
 * Get user's display photo (what others see).
 * Returns the display variant, not the private verification photo.
 */
export const getDisplayPhoto = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      photoUrl: user.displayPrimaryPhotoUrl,
      variant: user.displayPrimaryPhotoVariant || 'original',
      isVerified: user.faceVerificationStatus === 'verified',
    };
  },
});

/**
 * Get verification reference photo (INTERNAL/ADMIN ONLY).
 * This is the private face photo used for verification.
 * Should only be accessible by the user themselves or admins for audit.
 */
export const getVerificationReferencePhoto = query({
  args: {
    requestingUserId: v.id('users'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { requestingUserId, targetUserId } = args;

    // Security: Only allow if requesting user is the same as target, or is an admin
    const requestingUser = await ctx.db.get(requestingUserId);
    if (!requestingUser) throw new Error('Requesting user not found');

    const isSelf = requestingUserId === targetUserId;
    const isAdmin = requestingUser.isAdmin === true;

    if (!isSelf && !isAdmin) {
      throw new Error('Access denied: Verification photos are private.');
    }

    const targetUser = await ctx.db.get(targetUserId);
    if (!targetUser) throw new Error('Target user not found');

    return {
      verificationReferencePhotoUrl: targetUser.verificationReferencePhotoUrl,
      faceVerificationStatus: targetUser.faceVerificationStatus,
      faceMatchScore: targetUser.faceMatchScore,
      verificationAttemptedAt: targetUser.faceVerificationAttemptedAt,
    };
  },
});

/**
 * Check if user has completed the photo gate (has valid verification reference photo).
 */
export const checkPhotoGateStatus = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { hasPhoto: false, isVerified: false };

    const hasVerificationPhoto = !!user.verificationReferencePhotoId;
    const isVerified = user.faceVerificationStatus === 'verified';

    return {
      hasPhoto: hasVerificationPhoto,
      isVerified,
      faceVerificationStatus: user.faceVerificationStatus || 'unverified',
      canChangeDisplayVariant: isVerified,
      currentDisplayVariant: user.displayPrimaryPhotoVariant || 'original',
    };
  },
});

/**
 * Debug query: Get detailed photo gate status for debugging.
 * Returns all relevant fields for troubleshooting photo upload and verification flow.
 */
export const getPhotoGateStatus = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return {
        userId: args.userId,
        exists: false,
        verificationReferencePhotoId: null,
        verificationReferencePhotoUrl: null,
        displayPrimaryPhotoId: null,
        faceVerificationStatus: null,
      };
    }

    return {
      userId: args.userId,
      exists: true,
      verificationReferencePhotoId: user.verificationReferencePhotoId || null,
      verificationReferencePhotoUrl: user.verificationReferencePhotoUrl || null,
      displayPrimaryPhotoId: user.displayPrimaryPhotoId || null,
      faceVerificationStatus: user.faceVerificationStatus || 'unverified',
    };
  },
});
