import { v } from 'convex/values';
import { mutation, query, action, internalMutation, MutationCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId } from './helpers';

// ---------------------------------------------------------------------------
// Session-based Auth Helper (matches app's custom auth system)
// ---------------------------------------------------------------------------

/**
 * Validate session token and return the authenticated user ID.
 * Uses the same session validation logic as auth.validateSessionFull.
 *
 * @returns userId if valid, null if invalid/expired/revoked
 */
async function validateSessionToken(
  ctx: MutationCtx,
  token: string
): Promise<Id<'users'> | null> {
  const now = Date.now();

  const session = await ctx.db
    .query('sessions')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();

  if (!session) return null;
  if (session.expiresAt < now) return null;
  if (session.revokedAt) return null;

  const user = await ctx.db.get(session.userId);
  if (!user) return null;
  if (!user.isActive) return null;
  if (user.deletedAt) return null;

  // Check mass session revocation
  if (user.sessionsRevokedAt && session.createdAt < user.sessionsRevokedAt) {
    return null;
  }

  return session.userId;
}

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
 * Get the URL for a storage ID.
 * Used by Phase-2 private profile to get permanent URLs after upload.
 */
export const getStorageUrl = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    return url;
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
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
    storageId: v.id('_storage'),
    isPrimary: v.boolean(),
    hasFace: v.boolean(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // 8C: Client-reported flags for upload hardening
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    isNsfwDetected: v.optional(v.boolean()), // Client-side NSFW detection result
    // C1 SECURITY: Session token for auth validation (MANDATORY - custom auth system)
    token: v.string(),
    // Slot position (0-8) for photo placement - if provided, use this instead of auto-incrementing
    slotOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { storageId, isPrimary, hasFace, width, height, fileSize, mimeType, isNsfwDetected, token, slotOrder } = args;

    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // C1 SECURITY: Validate session token (MANDATORY - replaces broken ctx.auth.getUserIdentity)
    // This app uses custom session/token auth, not Convex built-in auth
    const authenticatedUserId = await validateSessionToken(ctx, token);
    if (!authenticatedUserId) {
      throw new Error('Unauthorized: invalid or expired session');
    }
    // Verify the authenticated user is modifying their own profile
    if (authenticatedUserId !== userId) {
      throw new Error('Unauthorized: cannot add photos to another user\'s profile');
    }

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

    // Get current photos count (exclude verification_reference photos)
    // BUG FIX: Verification photos should NOT count towards the 9-photo limit
    const existingPhotos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.neq(q.field('photoType'), 'verification_reference'))
      .collect();

    if (existingPhotos.length >= 9) {
      throw new Error('Maximum 9 photos allowed');
    }

    // BUG FIX (2026-03-06): Check if verification_reference photo exists
    // If it does, it occupies slot 0 and is the primary photo.
    // Additional photos must NOT overwrite slot 0 or auto-become primary.
    const verificationRefPhoto = await ctx.db
      .query('photos')
      .withIndex('by_user_type', (q) => q.eq('userId', userId).eq('photoType', 'verification_reference'))
      .first();
    const hasVerificationPrimary = verificationRefPhoto && verificationRefPhoto.isPrimary;

    // If this is primary, update other photos
    if (isPrimary) {
      for (const photo of existingPhotos) {
        if (photo.isPrimary) {
          await ctx.db.patch(photo._id, { isPrimary: false });
        }
      }
    }

    // M11 FIX: Use max(existing orders) + 1 for initial assignment (best-effort)
    // Post-insert normalization below handles concurrent duplicate orders
    let maxOrder = -1;
    if (verificationRefPhoto) {
      maxOrder = Math.max(maxOrder, verificationRefPhoto.order);
    }
    for (const photo of existingPhotos) {
      maxOrder = Math.max(maxOrder, photo.order);
    }
    // Use client-provided slotOrder if valid (0-8), otherwise auto-increment
    const order = (slotOrder !== undefined && slotOrder >= 0 && slotOrder <= 8)
      ? slotOrder
      : maxOrder + 1;

    // BUG FIX: If verification_reference is primary, this is NOT the "first photo"
    // so it should NOT auto-become primary. Only explicit isPrimary=true should make it primary.
    const isFirstPhoto = existingPhotos.length === 0 && !hasVerificationPrimary;
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

    // M11 FIX: Post-insert order normalization to resolve concurrent duplicate orders
    // Deterministic sort ensures concurrent requests converge to same ordering
    const allUserPhotos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // Separate verification_reference (stays at order 0) from regular photos
    const regularPhotos = allUserPhotos.filter(p => p.photoType !== 'verification_reference');
    const hasVerificationRef = allUserPhotos.some(p => p.photoType === 'verification_reference');

    // Sort deterministically: order ASC, createdAt ASC, _id ASC
    regularPhotos.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a._id < b._id ? -1 : 1;
    });

    // Normalize to contiguous orders (1+ if verification_reference exists, else 0+)
    const startOrder = hasVerificationRef ? 1 : 0;
    for (let i = 0; i < regularPhotos.length; i++) {
      const expectedOrder = startOrder + i;
      if (regularPhotos[i].order !== expectedOrder) {
        await ctx.db.patch(regularPhotos[i]._id, { order: expectedOrder });
      }
    }

    // CONSISTENCY FIX B1: Ensure exactly one primary photo after insert
    // Re-query and enforce single primary to handle concurrent race conditions
    if (willBePrimary) {
      const allPhotos = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();
      const primaryPhotos = allPhotos.filter((p) => p.isPrimary);
      if (primaryPhotos.length > 1) {
        // Multiple primaries found - deterministically pick lowest order
        // C6 FIX: Add createdAt tiebreaker for race condition when orders are equal
        primaryPhotos.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
        const keepPrimary = primaryPhotos[0];
        for (let i = 1; i < primaryPhotos.length; i++) {
          await ctx.db.patch(primaryPhotos[i]._id, { isPrimary: false });
        }
        // Ensure correct primaryPhotoUrl
        await ctx.db.patch(userId, { primaryPhotoUrl: keepPrimary.url });
      }
    }

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
      // M10 FIX: Re-check if our photo is still primary after race reconciliation
      // If we lost the race (another photo became primary), don't overwrite primaryPhotoUrl
      const ourPhoto = await ctx.db.get(photoId);
      const isStillPrimary = ourPhoto?.isPrimary ?? false;

      const user = await ctx.db.get(userId);
      if (user) {
        const currentStatus = user.verificationStatus || 'unverified';
        // Only update if not already verified
        if (currentStatus !== 'verified') {
          await ctx.db.patch(userId, {
            verificationStatus: 'pending_auto',
          });
        }
        // M10 FIX: Only update primaryPhotoUrl if our photo is still the primary
        // If race reconciliation chose a different photo, that block already set the correct URL
        if (isStillPrimary) {
          await ctx.db.patch(userId, { primaryPhotoUrl: url });
        }
      }
    }

    // H-1: Clean up pending upload record on success (if exists)
    const pendingRecord = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first();
    if (pendingRecord) {
      await ctx.db.delete(pendingRecord._id);
    }

    return { success: true, photoId, url, requiresVerification: willBePrimary };
  },
});

// Replace photo (update existing photo record with new image)
export const replacePhoto = mutation({
  args: {
    photoId: v.id('photos'),
    storageId: v.id('_storage'),
    // C1 SECURITY: Session token for auth validation (MANDATORY - custom auth system)
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { photoId, storageId, token } = args;

    // C1 SECURITY: Validate session token
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Get existing photo
    const existingPhoto = await ctx.db.get(photoId);
    if (!existingPhoto) {
      throw new Error('Photo not found');
    }

    // SECURITY: Verify photo ownership
    if (existingPhoto.userId !== userId) {
      throw new Error('Unauthorized: cannot replace another user\'s photo');
    }

    // Get URL for new storage
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new Error('Invalid storage reference: file does not exist');
    }

    // Validate URL format
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('Invalid photo URL: URL cannot be empty');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Invalid photo URL: must be a valid HTTP(S) URL');
    }

    // Update existing photo record - preserve order, isPrimary, etc.
    await ctx.db.patch(photoId, {
      storageId,
      url,
      // Reset NSFW flag for new image
      isNsfw: false,
      // Update timestamp
      createdAt: Date.now(),
    });

    // Clean up pending upload tracking if exists
    const pendingRecord = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first();
    if (pendingRecord) {
      await ctx.db.delete(pendingRecord._id);
    }

    return { success: true, photoId, order: existingPhoto.order, url };
  },
});

// Delete photo
export const deletePhoto = mutation({
  args: {
    photoId: v.id('photos'),
    // C1 SECURITY: Session token for auth validation (MANDATORY - custom auth system)
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { photoId, token } = args;

    // C1 SECURITY: Validate session token (MANDATORY - custom auth system)
    // This app uses custom session/token auth, not Convex built-in auth
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    const photo = await ctx.db.get(photoId);
    if (!photo) {
      throw new Error('Photo not found');
    }
    // SECURITY: Verify photo ownership before deletion
    if (photo.userId !== userId) {
      throw new Error('Unauthorized photo modification');
    }

    // Get all user photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    if (photos.length <= 2) {
      throw new Error('Must have at least two photos');
    }

    // CONSISTENCY FIX B2: Reorder operations for safer deletion
    // 1. Delete from database FIRST (authoritative state)
    // 2. Reorder remaining photos (maintain consistency)
    // 3. Delete from storage LAST (best effort, orphan cleanup handles failures)
    const storageIdToDelete = photo.storageId;
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

    // STABILITY FIX: C-10 + H-2 - Keep primaryPhotoUrl in sync after delete
    // Query for primary photo, fallback to first by order if none marked primary (defensive)
    let primaryPhoto = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('isPrimary'), true))
      .first();

    // H-2: Defensive fallback - if no isPrimary found but photos exist, use first by order
    if (!primaryPhoto) {
      primaryPhoto = await ctx.db
        .query('photos')
        .withIndex('by_user_order', (q) => q.eq('userId', userId))
        .first();
      // If we found a photo, mark it as primary for consistency
      if (primaryPhoto) {
        await ctx.db.patch(primaryPhoto._id, { isPrimary: true });
      }
    }

    await ctx.db.patch(userId, { primaryPhotoUrl: primaryPhoto?.url });

    // CONSISTENCY FIX B2: Delete from storage LAST (best effort)
    // If this fails, DB is already consistent; failed deletion is queued for retry
    try {
      await ctx.storage.delete(storageIdToDelete);
    } catch (storageError) {
      // Log the failure
      console.warn('[PHOTO_DELETE] Storage cleanup failed, queuing for retry:', storageError);

      // B2-FIX: Track failed deletion for retry by cron
      const errorString = storageError instanceof Error
        ? storageError.message.slice(0, 500)
        : String(storageError).slice(0, 500);

      // Check if already queued (prevent duplicate spam)
      const existing = await ctx.db
        .query('failedStorageDeletions')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageIdToDelete))
        .first();

      if (existing) {
        // Update existing record
        await ctx.db.patch(existing._id, {
          failedAt: Date.now(),
          retryCount: existing.retryCount + 1,
          lastError: errorString,
        });
      } else {
        // Insert new record
        await ctx.db.insert('failedStorageDeletions', {
          storageId: storageIdToDelete,
          failedAt: Date.now(),
          retryCount: 0,
          lastError: errorString,
        });
      }
    }

    return { success: true };
  },
});

// Reorder photos
export const reorderPhotos = mutation({
  args: {
    // IDOR-P1-003 FIX: Removed userId - now derived from server auth
    photoIds: v.array(v.id('photos')),
  },
  handler: async (ctx, args) => {
    // IDOR-P1-003 FIX: Derive caller identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const { photoIds } = args;

    // SECURITY: Verify all photos belong to user before reordering
    for (const photoId of photoIds) {
      const photo = await ctx.db.get(photoId);
      if (!photo) {
        throw new Error('Photo not found');
      }
      if (photo.userId !== userId) {
        throw new Error('Unauthorized photo modification');
      }
    }

    // Update order
    for (let i = 0; i < photoIds.length; i++) {
      await ctx.db.patch(photoIds[i], {
        order: i,
        isPrimary: i === 0,
      });
    }

    // STABILITY FIX: C-10 - Keep primaryPhotoUrl in sync with isPrimary
    const primaryPhoto = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('isPrimary'), true))
      .first();
    await ctx.db.patch(userId, { primaryPhotoUrl: primaryPhoto?.url });

    return { success: true };
  },
});

// Reorder photos with token-based auth (for apps using custom session auth)
export const reorderPhotosWithToken = mutation({
  args: {
    photoIds: v.array(v.id('photos')),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { photoIds, token } = args;

    // Validate session token
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // SECURITY: Verify all photos belong to user before reordering
    for (const photoId of photoIds) {
      const photo = await ctx.db.get(photoId);
      if (!photo) {
        throw new Error('Photo not found');
      }
      if (photo.userId !== userId) {
        throw new Error('Unauthorized photo modification');
      }
    }

    // Update order and isPrimary (first photo is primary)
    for (let i = 0; i < photoIds.length; i++) {
      await ctx.db.patch(photoIds[i], {
        order: i,
        isPrimary: i === 0,
      });
    }

    // Keep primaryPhotoUrl in sync
    const primaryPhoto = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('isPrimary'), true))
      .first();
    await ctx.db.patch(userId, { primaryPhotoUrl: primaryPhoto?.url });

    console.log('[reorderPhotosWithToken] Reordered', photoIds.length, 'photos, primary:', primaryPhoto?._id);

    return { success: true, primaryPhotoId: primaryPhoto?._id, primaryPhotoUrl: primaryPhoto?.url };
  },
});

// Get user photos (excludes verification_reference photos)
export const getUserPhotos = query({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const convexUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!convexUserId) {
      console.log('[getUserPhotos] User not found for authUserId:', args.userId);
      return [];
    }

    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', convexUserId))
      .collect();

    // BUG FIX: Filter out verification_reference photos (those are private, not for profile display)
    const normalPhotos = photos.filter(photo => photo.photoType !== 'verification_reference');

    return normalPhotos.sort((a, b) => a.order - b.order);
  },
});

// Set primary photo
export const setPrimaryPhoto = mutation({
  args: {
    // IDOR-P1-004 FIX: Removed userId - now derived from server auth
    photoId: v.id('photos'),
  },
  handler: async (ctx, args) => {
    // IDOR-P1-004 FIX: Derive caller identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const { photoId } = args;

    const photo = await ctx.db.get(photoId);
    if (!photo) {
      throw new Error('Photo not found');
    }
    // SECURITY: Verify photo ownership before setting primary
    if (photo.userId !== userId) {
      throw new Error('Unauthorized photo modification');
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

    // STABILITY FIX: C-10 - Keep primaryPhotoUrl in sync
    await ctx.db.patch(userId, { primaryPhotoUrl: photo.url });

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
    // SECURITY FIX A3: Require authentication and authorization
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }

    // Get the photo to check ownership
    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      throw new Error('Photo not found');
    }

    // Resolve authenticated user
    const authUserId = identity.subject;
    const authenticatedUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
      .first();

    if (!authenticatedUser) {
      throw new Error('Unauthorized: user not found');
    }

    // Allow if: user is admin OR user owns the photo
    const isAdmin = authenticatedUser.isAdmin === true;
    const isOwner = photo.userId === authenticatedUser._id;

    if (!isAdmin && !isOwner) {
      throw new Error('Unauthorized: only photo owner or admin can mark NSFW status');
    }

    await ctx.db.patch(args.photoId, { isNsfw: args.isNsfw });
    return { success: true };
  },
});

// Save verification photo (legacy - use uploadVerificationReferencePhoto instead)
export const saveVerificationPhoto = mutation({
  args: {
    // IDOR-P1-005 FIX: Removed userId - now derived from server auth
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    // IDOR-P1-005 FIX: Derive caller identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const { storageId } = args;

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
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
    storageId: v.id('_storage'),
    hasFace: v.boolean(),           // Client-side face detection result
    faceCount: v.optional(v.number()), // Number of faces detected
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { storageId, hasFace, faceCount, width, height, fileSize, mimeType } = args;

    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    console.log(`[PHOTO_GATE] start user=${userId}`);

    // Validate storage exists
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      console.log(`[PHOTO_GATE] FAIL: Invalid storage reference`);
      throw new Error('Invalid storage reference: file does not exist');
    }

    // M13 FIX: Validate URL format before insert (same as addPhoto)
    if (typeof url !== 'string' || url.trim().length === 0) {
      console.log(`[PHOTO_GATE] FAIL: Empty URL`);
      throw new Error('Invalid photo URL: URL cannot be empty');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.log(`[PHOTO_GATE] FAIL: Invalid URL format`);
      throw new Error('Invalid photo URL: must be a valid HTTP(S) URL');
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

    // M9 FIX: Insert first, then reconcile with deterministic winner selection
    // Old approach (delete-then-insert) had race: concurrent uploads could both delete then insert
    // New approach: insert first, deterministically keep newest, update user to point to winner

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

    // M9 FIX: Deterministic reconciliation - both concurrent requests agree on same winner
    // Query all verification_reference photos, keep newest (by createdAt DESC, _id DESC as tiebreaker)
    const allVerificationPhotos = await ctx.db
      .query('photos')
      .withIndex('by_user_type', (q) => q.eq('userId', userId).eq('photoType', 'verification_reference'))
      .collect();

    // Sort by createdAt DESC, then _id DESC (deterministic tiebreaker)
    allVerificationPhotos.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      return b._id > a._id ? 1 : -1;
    });
    const winner = allVerificationPhotos[0];

    if (allVerificationPhotos.length > 1) {
      console.log(`[PHOTO_GATE] M9: Found ${allVerificationPhotos.length} verification photos, keeping winner: ${winner._id}`);
      // Delete all except the deterministic winner
      for (const photo of allVerificationPhotos) {
        if (photo._id !== winner._id) {
          await ctx.db.delete(photo._id);
          console.log(`[PHOTO_GATE] M9: Deleted duplicate verification photo: ${photo._id}`);
        }
      }
      // Note: Storage files are NOT deleted - they may still be referenced elsewhere
    }

    console.log(`[PHOTO_GATE] stored verificationReferencePhotoId=${winner.storageId}`);

    // M9 FIX: Update user with WINNER's data, not current request's data
    // This ensures both concurrent requests point user to the same deterministic winner
    await ctx.db.patch(userId, {
      verificationReferencePhotoId: winner.storageId,
      verificationReferencePhotoUrl: winner.url,
      // Also set as display photo initially (original variant)
      displayPrimaryPhotoId: winner.storageId,
      displayPrimaryPhotoUrl: winner.url,
      displayPrimaryPhotoVariant: 'original',
      // STABILITY FIX: C-10 - Keep primaryPhotoUrl in sync
      primaryPhotoUrl: winner.url,
      // Set verification status to pending
      faceVerificationStatus: 'unverified',
      verificationStatus: 'pending_auto',
    });

    console.log(`[PHOTO_GATE] user updated verificationReferencePhotoId set=true`);

    // H-1: Clean up pending upload record on success (if exists)
    const pendingRecord = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .first();
    if (pendingRecord) {
      await ctx.db.delete(pendingRecord._id);
    }

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
    // IDOR-P1-006 FIX: Removed userId - now derived from server auth
    variant: v.union(v.literal('original'), v.literal('blurred'), v.literal('cartoon')),
    // For blurred/cartoon, client uploads a processed version
    processedStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    // IDOR-P1-006 FIX: Derive caller identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const { variant, processedStorageId } = args;

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
        // STABILITY FIX: C-10 - Keep primaryPhotoUrl in sync
        primaryPhotoUrl: user.verificationReferencePhotoUrl,
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

      // M13 FIX: Validate URL format before insert (same as addPhoto)
      if (typeof url !== 'string' || url.trim().length === 0) {
        throw new Error('Invalid photo URL: URL cannot be empty');
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('Invalid photo URL: must be a valid HTTP(S) URL');
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
        // STABILITY FIX: C-10 - Keep primaryPhotoUrl in sync
        primaryPhotoUrl: url,
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

// =============================================================================
// H-1: Pending Upload Tracking (Orphan Storage Prevention)
// =============================================================================

/**
 * Track a pending upload to prevent orphaned storage blobs.
 * Call this AFTER storage upload succeeds but BEFORE calling addPhoto.
 * If addPhoto fails, call cleanupPendingUpload to delete the blob.
 */
export const trackPendingUpload = mutation({
  args: {
    userId: v.string(), // authId string
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    // Resolve authId -> Convex userId
    const resolvedUserId = await ensureUserByAuthId(ctx, args.userId);

    // Check if pending record already exists for this storageId
    const existing = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
      // If exists and belongs to same user: idempotent success
      if (existing.userId === resolvedUserId) {
        return { success: true, pendingId: existing._id };
      }
      // If exists and belongs to different user: forbidden
      throw new Error('Storage ID already claimed by another user');
    }

    // Create pending upload record
    const pendingId = await ctx.db.insert('pendingUploads', {
      storageId: args.storageId,
      userId: resolvedUserId,
      createdAt: Date.now(),
    });

    return { success: true, pendingId };
  },
});

/**
 * Clean up a pending upload by deleting both the storage blob and pending record.
 * Call this if addPhoto fails after upload.
 * Safety: Will NOT delete storage if a photo record already references it.
 */
export const cleanupPendingUpload = mutation({
  args: {
    userId: v.string(), // authId string
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    // Resolve authId -> Convex userId
    const resolvedUserId = await ensureUserByAuthId(ctx, args.userId);

    // Find the pending record
    const pending = await ctx.db
      .query('pendingUploads')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .first();

    if (!pending) {
      // No pending record - may have already been cleaned up or addPhoto succeeded
      return { success: true, deleted: false };
    }

    // Ownership check: must belong to the requesting user
    if (pending.userId !== resolvedUserId) {
      throw new Error('Not authorized to clean up this upload');
    }

    // Safety check: verify no photo is using this storageId
    const photoUsingStorage = await ctx.db
      .query('photos')
      .filter((q) => q.eq(q.field('storageId'), args.storageId))
      .first();

    if (photoUsingStorage) {
      // Photo exists - do NOT delete storage, just clean up pending record
      await ctx.db.delete(pending._id);
      return { success: true, deleted: false, reason: 'in_use' };
    }

    // No photo using this storage - safe to delete
    try {
      await ctx.storage.delete(args.storageId);
    } catch (e) {
      // Storage may already be deleted - log but continue
      console.log('[H-1] Storage delete failed (may already be deleted):', e);
    }

    // Delete the pending record
    await ctx.db.delete(pending._id);

    return { success: true, deleted: true };
  },
});

/**
 * DEV ONLY: Clean up stale pending uploads (orphaned storage blobs).
 * Should be run periodically (e.g., via cron) to clean up uploads where:
 * - Upload succeeded but addPhoto was never called
 * - User abandoned the upload flow
 *
 * Safety: Only runs in DEV mode (EXPO_PUBLIC_DEMO_MODE === 'true')
 * Safety: Will NOT delete storage if a photo record already references it.
 */
export const cleanupStalePendingUploads = mutation({
  args: {
    maxAgeMs: v.optional(v.number()), // Default: 1 hour
    limit: v.optional(v.number()), // Default: 50
  },
  handler: async (ctx, args) => {
    // DEV-only safety gate
    const isDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
    if (!isDemoMode) {
      throw new Error('cleanupStalePendingUploads is only available in DEV mode');
    }

    const maxAge = args.maxAgeMs ?? 60 * 60 * 1000; // 1 hour default
    const limit = args.limit ?? 50;
    const cutoff = Date.now() - maxAge;

    // Find stale pending uploads (limited batch)
    const stalePending = await ctx.db
      .query('pendingUploads')
      .withIndex('by_createdAt')
      .filter((q) => q.lt(q.field('createdAt'), cutoff))
      .take(limit);

    let deletedCount = 0;
    let skippedCount = 0;

    for (const pending of stalePending) {
      // Safety check: verify no photo is using this storageId
      const photoUsingStorage = await ctx.db
        .query('photos')
        .filter((q) => q.eq(q.field('storageId'), pending.storageId))
        .first();

      if (photoUsingStorage) {
        // Photo exists - only delete pending record, NOT storage
        await ctx.db.delete(pending._id);
        skippedCount++;
      } else {
        // No photo using this storage - safe to delete both
        try {
          await ctx.storage.delete(pending.storageId);
        } catch (e) {
          console.log('[H-1] Stale storage delete failed:', pending.storageId, e);
        }
        await ctx.db.delete(pending._id);
        deletedCount++;
      }
    }

    console.log(`[H-1] Cleaned up ${deletedCount} stale pending uploads, skipped ${skippedCount} in-use`);
    return { success: true, deletedCount, skippedCount };
  },
});

/**
 * DEV ONLY: Delete all photos for a user
 * Used for testing/development to clean up extra photos
 * ⚠️ DO NOT USE IN PRODUCTION - this deletes ALL photos
 */
export const deleteAllPhotosForUser = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve userId (handle both Convex ID and auth ID)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);

    if (!userId) {
      throw new Error('User not found');
    }

    // Get all photos for this user
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    console.log(`[DEV_CLEANUP] Deleting ${photos.length} photos for user ${userId}`);

    // Delete all photos
    let deletedCount = 0;
    for (const photo of photos) {
      await ctx.db.delete(photo._id);
      deletedCount++;
    }

    // Clear photo-related fields in user record
    await ctx.db.patch(userId, {
      verificationReferencePhotoId: undefined,
      verificationReferencePhotoUrl: undefined,
      displayPrimaryPhotoId: undefined,
      faceVerificationSelfieId: undefined,
    });

    console.log(`[DEV_CLEANUP] Deleted ${deletedCount} photos and cleared user photo fields`);

    return {
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} photos`,
    };
  },
});

// =============================================================================
// B2-FIX: Retry Failed Storage Deletions
// =============================================================================

/**
 * Internal mutation to retry failed storage deletions.
 * Called by cron job to clean up orphaned storage blobs.
 * Processes in bounded batches to avoid heavy work.
 */
export const retryFailedStorageDeletions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batchSize = 20;
    const maxRetries = 10;

    // Get oldest failed deletions first (FIFO order)
    const failedDeletions = await ctx.db
      .query('failedStorageDeletions')
      .withIndex('by_failedAt')
      .take(batchSize);

    let successCount = 0;
    let failCount = 0;
    let abandonedCount = 0;

    for (const record of failedDeletions) {
      // Check if we should abandon this record (too many retries)
      if (record.retryCount >= maxRetries) {
        console.warn(`[B2-RETRY] Abandoning storageId ${record.storageId} after ${record.retryCount} retries`);
        await ctx.db.delete(record._id);
        abandonedCount++;
        continue;
      }

      try {
        // Attempt to delete from storage
        await ctx.storage.delete(record.storageId);

        // Success - remove the queue record
        await ctx.db.delete(record._id);
        successCount++;
      } catch (error) {
        // Failed again - update retry count
        const errorString = error instanceof Error
          ? error.message.slice(0, 500)
          : String(error).slice(0, 500);

        await ctx.db.patch(record._id, {
          failedAt: Date.now(),
          retryCount: record.retryCount + 1,
          lastError: errorString,
        });
        failCount++;
      }
    }

    if (successCount > 0 || failCount > 0 || abandonedCount > 0) {
      console.log(`[B2-RETRY] Processed ${failedDeletions.length} failed deletions: ${successCount} succeeded, ${failCount} failed, ${abandonedCount} abandoned`);
    }

    return { successCount, failCount, abandonedCount, processed: failedDeletions.length };
  },
});
