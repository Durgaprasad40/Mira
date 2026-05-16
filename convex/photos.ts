import { v } from 'convex/values';
import { mutation, query, action, internalMutation, MutationCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId, validateSessionToken as validateSessionTokenAny } from './helpers';
import { reserveActionSlots } from './actionRateLimits';

// ---------------------------------------------------------------------------
// Session-based Auth Helper (matches app's custom auth system)
// ---------------------------------------------------------------------------

/**
 * Validate session token and return the authenticated user ID.
 * Handles both:
 * - Regular session tokens (from sessions table)
 * - Demo tokens (format: demo_<userId>)
 *
 * @returns userId if valid, null if invalid/expired/revoked
 */
async function validateSessionToken(
  ctx: MutationCtx,
  token: string
): Promise<Id<'users'> | null> {
  const now = Date.now();

  // Handle demo tokens (format: demo_<userId>)
  if (token.startsWith('demo_')) {
    const userIdPart = token.substring(5);
    try {
      // Demo token contains the Convex user._id directly
      const user = await ctx.db.get(userIdPart as Id<'users'>);
      if (user && user.isActive && !user.deletedAt && !user.isBanned) {
        return user._id;
      }
    } catch {
      // Not a valid Convex ID format, fall through to session lookup
    }

    // Fallback: try by demoUserId or authUserId field
    const usersByDemo = await ctx.db
      .query('users')
      .withIndex('by_demo_user_id', (q) => q.eq('demoUserId', userIdPart))
      .first();
    if (usersByDemo && usersByDemo.isActive && !usersByDemo.deletedAt && !usersByDemo.isBanned) {
      return usersByDemo._id;
    }

    const usersByAuth = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', userIdPart))
      .first();
    if (usersByAuth && usersByAuth.isActive && !usersByAuth.deletedAt && !usersByAuth.isBanned) {
      return usersByAuth._id;
    }

    return null;
  }

  // Regular session token validation
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
  if (user.isBanned) return null;

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
// Supported normal ceiling is 10 photos (9 display + optional verification reference).
// Keep a buffer for legacy/order-repair cases while avoiding unbounded reads.
const MAX_GET_USER_PHOTOS = 25;

async function getGridPrimaryPhotoUrl(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>
): Promise<string | null> {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user_order', (q) => q.eq('userId', userId))
    .filter((q) => q.neq(q.field('photoType'), 'verification_reference'))
    .collect();

  photos.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });

  return photos[0]?.url ?? null;
}

// Generate upload URL
// P3-PROFILE NOTE (shared-upload policy — FUTURE / out of scope for P3):
// A per-user rate limit on this mutation was considered during P2/P3 but
// deliberately deferred. The URL is shared across onboarding photo-upload,
// edit-profile, face verification, Phase-2 onboarding, the photo-sync
// service, and Phase-1 chat secure media. A single global cap would
// either be too tight (breaking bursty onboarding) or too loose (no
// protection). The correct fix requires one of:
//   (1) Accept a `purpose: v.union(...)` arg and apply per-purpose quotas
//       (e.g. `onboarding_photo` 20/hr, `chat_image` 60/min,
//       `verification_reference` 5/hr) — preferred, but needs a
//       coordinated frontend change at every caller to pass `purpose`;
//   (2) Split this mutation into per-feature variants
//       (`generateOnboardingUploadUrl`, `generateChatImageUploadUrl`, …)
//       so each can be independently rate-limited and audited.
// Mitigation today: downstream consumers (`addPhoto`, `sendPreMatchMessage`,
// `sendProtectedImage`, verification flows) each enforce their own per-user
// rate limits, so an attacker can mint URLs but cannot attach them to user
// data. Orphaned storage objects are reaped by existing GC.
export const generateUploadUrl = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateSessionToken(ctx, args.token.trim());
    if (!userId) {
      throw new Error('Unauthorized: authentication required');
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Get the URL for a storage ID.
 * Used by Phase-2 private profile to get permanent URLs after upload.
 */
export const getStorageUrl = mutation({
  args: {
    token: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const userId = await validateSessionToken(ctx, args.token.trim());
    if (!userId) {
      throw new Error('Unauthorized: authentication required');
    }
    const [ownedPhoto, pendingUpload] = await Promise.all([
      ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .filter((q) => q.eq(q.field('storageId'), args.storageId))
        .first(),
      ctx.db
        .query('pendingUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
        .first(),
    ]);
    if (!ownedPhoto && pendingUpload?.userId !== userId) {
      throw new Error('Unauthorized: storage not owned by caller');
    }
    const url = await ctx.storage.getUrl(args.storageId);
    return url;
  },
});

/**
 * 8A: Validate photo before upload.
 * Call this before uploading to check size/type constraints.
 *
 * P3-PROFILE NOTE: This is a UX helper, NOT a security boundary. It is an
 * unauthenticated query intended to give the upload UI fast feedback
 * ("photo too small", "wrong format") before the user even hits
 * `generateUploadUrl`. A malicious client can trivially skip this call;
 * the authoritative size/type/dimension checks live in `addPhoto` (size +
 * mimeType bounds), pre-upload UI gating, and the per-user upload rate
 * limits enforced by downstream consumers. Treat the return value as a
 * convenience hint, not an authorization decision.
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
// P3-PROFILE NOTE (dimension validation — FUTURE / out of scope for P3):
// `width` and `height` here are client-supplied and are NOT independently
// re-derived server-side from the storage object. The current `validatePhotoUpload`
// query + pre-upload UI gating enforce min-dimensions client-side only.
// A server-authoritative dimension check requires one of:
//   (1) A Convex action that downloads the storage object and decodes the
//       header bytes (e.g. via `image-size` or a similar lightweight
//       header-parser) — adds runtime dependency surface and per-upload
//       latency, and must itself be rate-limited;
//   (2) A trusted upstream extraction service that signs a sidecar
//       (width/height/mimeType/sha256) the mutation can verify.
// Until one of those lands, this mutation deliberately does not pretend to
// validate dimensions server-side. Worst case is an under-sized profile
// photo — already mitigated by the UI gate and by photo-moderation review
// on first display. This is intentionally deferred and tracked here so a
// future hardening pass does not assume coverage exists.
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
  },
  handler: async (ctx, args) => {
    const { storageId, isPrimary, hasFace, width, height, fileSize, mimeType, isNsfwDetected, token } = args;

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

    // P2-PROFILE: Per-user rate limit on photo writes. The profile cap is 9
    // photos total, so a legitimate user only calls this a handful of times
    // per session. 5/min + 30/hr leaves room for normal upload bursts (e.g.
    // batch-add 3-4 photos during onboarding) while hard-blocking automated
    // upload thrash that would burn storage objects and moderation work.
    const addLimit = await reserveActionSlots(ctx, userId, 'photo_add', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 30 },
      { kind: '1min', windowMs: 60 * 1000, max: 5 },
    ]);
    if (!addLimit.accept) {
      throw new Error('rate_limited');
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
    const order = maxOrder + 1;

    // BUG FIX: If verification_reference is primary, this is NOT the "first photo"
    // so it should NOT auto-become primary. Only explicit isPrimary=true should make it primary.
    const isFirstPhoto = existingPhotos.length === 0 && !hasVerificationPrimary;
    const willBePrimary = isPrimary || isFirstPhoto;

    // 8C: Use client-reported NSFW detection
    const flaggedNsfw = isNsfwDetected === true;
    const moderationStatus = flaggedNsfw ? 'flagged' : 'pending';

    const photoId = await ctx.db.insert('photos', {
      userId,
      storageId,
      url,
      order,
      isPrimary: willBePrimary,
      hasFace,
      isNsfw: flaggedNsfw,
      moderationStatus,
      moderationCheckedAt: flaggedNsfw ? Date.now() : undefined,
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

    // P2-PROFILE: Per-user rate limit on photo writes. Replace is rarer than
    // add (users typically swap a couple photos per session at most). 5/min +
    // 30/hr leaves room for legitimate retry loops while hard-blocking
    // automated replace thrash that would orphan storage objects and burn
    // moderation work.
    const replaceLimit = await reserveActionSlots(ctx, userId, 'photo_replace', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 30 },
      { kind: '1min', windowMs: 60 * 1000, max: 5 },
    ]);
    if (!replaceLimit.accept) {
      throw new Error('rate_limited');
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
      moderationStatus: 'pending',
      moderationCheckedAt: undefined,
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

    // P2-PROFILE: Per-user rate limit on photo writes. Delete is a deliberate
    // user action; 5/min + 30/hr accommodates legitimate cleanup (e.g. user
    // pruning their grid) while hard-blocking automated thrash that would
    // churn storage cleanup queues and primary-photo reassignment.
    const deleteLimit = await reserveActionSlots(ctx, userId, 'photo_delete', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 30 },
      { kind: '1min', windowMs: 60 * 1000, max: 5 },
    ]);
    if (!deleteLimit.accept) {
      throw new Error('rate_limited');
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
    // C1 SECURITY: Session token for auth validation (MANDATORY - custom auth system)
    token: v.string(),
    photoIds: v.array(v.id('photos')),
  },
  handler: async (ctx, args) => {
    const { token, photoIds } = args;

    // C1 SECURITY: Validate session token (MANDATORY - replaces broken ctx.auth.getUserIdentity)
    // This app uses custom session/token auth, not Convex built-in auth
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // P2-PROFILE: Per-user rate limit. Reordering is a drag-and-drop user
    // action that may fire several times in a row while the user arranges
    // their grid; 10/min covers that burst while hard-blocking automated
    // ordering thrash that would churn primary-photo reassignment and
    // primaryPhotoUrl writes.
    const reorderLimit = await reserveActionSlots(ctx, userId, 'photo_reorder', [
      { kind: '1min', windowMs: 60 * 1000, max: 10 },
    ]);
    if (!reorderLimit.accept) {
      throw new Error('rate_limited');
    }

    const publicPhotoIds: Id<'photos'>[] = [];

    // SECURITY: Verify all photos belong to user before reordering
    for (const photoId of photoIds) {
      const photo = await ctx.db.get(photoId);
      if (!photo) {
        throw new Error('Photo not found');
      }
      if (photo.userId !== userId) {
        throw new Error('Unauthorized photo modification');
      }
      if (photo.photoType !== 'verification_reference') {
        publicPhotoIds.push(photoId);
      }
    }

    // Update order
    for (let i = 0; i < publicPhotoIds.length; i++) {
      await ctx.db.patch(publicPhotoIds[i], {
        order: i,
        isPrimary: i === 0,
      });
    }

    // STABILITY FIX: C-10 - Keep primaryPhotoUrl in sync with isPrimary
    const primaryPhoto = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('isPrimary'), true),
          q.neq(q.field('photoType'), 'verification_reference'),
        )
      )
      .first();
    await ctx.db.patch(userId, { primaryPhotoUrl: primaryPhoto?.url });

    return { success: true };
  },
});

// Get public user photos for profile grids. Verification reference photos stay
// private to the verification system and are never returned here.
//
// P1-PROFILE FIX: Previously this query was unauthenticated and accepted ANY
// `userId` (either Convex ID or auth string). An anonymous caller could iterate
// every user and pull their full photo URL list — a mass enumeration of every
// user's images including order, primary flag, NSFW flag, and storage IDs.
// Hardening: require a session token; only the owner of `userId` (or an admin)
// receives photo data. Anyone else receives `[]` (matches the existing
// "safe empty array" convention so callers don't crash).
export const getUserPhotos = query({
  args: {
    token: v.string(),
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionTokenAny(ctx, (args.token ?? '').trim());
    if (!callerId) return [];

    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const convexUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!convexUserId) {
      console.log('[getUserPhotos] User not found for authUserId:', args.userId);
      return [];
    }

    if (callerId !== convexUserId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) return [];
    }

    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', convexUserId))
      .filter((q) => q.neq(q.field('photoType'), 'verification_reference'))
      .take(MAX_GET_USER_PHOTOS);

    const primaryPhoto = photos.find(photo => photo.isPrimary === true);
    const otherPhotos = photos.filter(photo => photo.isPrimary !== true);
    otherPhotos.sort((a, b) => a.order - b.order);
    const orderedPhotos = primaryPhoto ? [primaryPhoto, ...otherPhotos] : photos.sort((a, b) => a.order - b.order);

    return orderedPhotos;
  },
});

// Set primary photo
// P3-PROFILE FIX: Standardized to the session-token auth pattern used
// elsewhere in this file (validateSessionToken). Previously used
// `ctx.auth.getUserIdentity()` which is inconsistent with the rest of the
// photos surface and harder to reason about in tests. Grep confirmed zero
// frontend callsites at the time of this change, so the signature change is
// safe in-place. IDOR-P1-004 invariant preserved: userId is server-derived,
// never client-supplied.
export const setPrimaryPhoto = mutation({
  args: {
    // IDOR-P1-004 FIX: No client-supplied userId; derived from session token.
    token: v.string(),
    photoId: v.id('photos'),
  },
  handler: async (ctx, args) => {
    // P3-PROFILE FIX: Session-token-based auth (standardized pattern).
    const userId = await validateSessionToken(ctx, args.token.trim());
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // P2-PROFILE: Per-user rate limit. Setting primary is a deliberate user
    // action; 10/min accommodates rapid-toggle UI flows while hard-blocking
    // automated primary-photo thrash that would churn primaryPhotoUrl writes
    // and isPrimary flips across the user's photo set.
    const primaryLimit = await reserveActionSlots(ctx, userId, 'photo_set_primary', [
      { kind: '1min', windowMs: 60 * 1000, max: 10 },
    ]);
    if (!primaryLimit.accept) {
      throw new Error('rate_limited');
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

// Mark photo as NSFW (admin moderation OR owner self-flag)
// P3-PROFILE NOTE (owner-branch behavior — intentional, comment-only):
// The owner branch lets a user toggle `isNsfw` on their own photos in
// EITHER direction (flag or un-flag). This is a self-flag affordance, not a
// moderation-trust grant:
//   - Owner -> isNsfw=true is the "I want this gated behind blur" UX.
//   - Owner -> isNsfw=false reverses that, which means an owner can clear
//     a flag they themselves set. They cannot clear an admin-imposed flag
//     of any stronger nature because admin moderation actions live in a
//     separate path (`admin.moderatePhoto` / `markPhotoIneligible`) and
//     also set `moderationStatus`/`moderationReason` fields that this
//     mutation does NOT touch independently of `isNsfw`.
// Trust-level distinction is enforced by the admin branch (which has full
// authority) vs the owner branch (which can only toggle their own self-flag
// view). If a future feature needs to prevent owners from un-flagging
// content that an admin/auto-moderation system flagged, gate the owner
// branch on the photo's `moderationStatus !== 'flagged_by_admin'` rather
// than removing the owner-self-flag toggle entirely.
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

    await ctx.db.patch(args.photoId, {
      isNsfw: args.isNsfw,
      moderationStatus: args.isNsfw ? 'flagged' : 'clean',
      moderationCheckedAt: Date.now(),
    });
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
// P1-PROFILE FIX: Previously this mutation accepted a client-supplied `userId`
// and called `ensureUserByAuthId` WITHOUT verifying the caller. An attacker
// could overwrite ANY victim's `verificationReferencePhotoId` /
// `verificationReferencePhotoUrl` to a storage object they uploaded,
// poisoning the victim's verification reference photo. Hardening: require a
// session token and confirm the token-derived caller matches the resolved
// `userId`. Non-owners get an Unauthorized error.
export const uploadVerificationReferencePhoto = mutation({
  args: {
    token: v.string(),
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

    const callerId = await validateSessionTokenAny(ctx, (args.token ?? '').trim());
    if (!callerId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    if (callerId !== userId) {
      throw new Error('Unauthorized: cannot upload verification photo for another user');
    }

    // P2-PROFILE: Per-user rate limit. Verification reference upload is a
    // one-time onboarding action with limited legitimate retry need (failed
    // face detection, network retry). 3/hr + 10/day is well above any
    // honest user flow and hard-blocks automated verification-spam loops
    // that would burn moderator review time and storage objects.
    const refUploadLimit = await reserveActionSlots(ctx, userId, 'verification_ref_upload', [
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 10 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 3 },
    ]);
    if (!refUploadLimit.accept) {
      throw new Error('rate_limited');
    }

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

    // DEBUG LOG: Consent check details (temporary for diagnosing flow)
    console.log(`[PHOTO_GATE] DEBUG: userId=${userId}, inputUserId=${args.userId}, consentAcceptedAt=${user.consentAcceptedAt ?? 'NOT_SET'}, authUserId=${user.authUserId ?? 'N/A'}, demoUserId=${user.demoUserId ?? 'N/A'}`);

    if (!user.consentAcceptedAt) {
      console.log(`[PHOTO_GATE] FAIL: No consent - user.consentAcceptedAt is undefined/null`);
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
      moderationStatus: 'pending',
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

    // Collect storage IDs of losers being purged from the photos table so we can
    // also clean up the underlying storage blobs below (best-effort).
    const losersStorageIds: Id<'_storage'>[] = [];
    if (allVerificationPhotos.length > 1) {
      console.log(`[PHOTO_GATE] M9: Found ${allVerificationPhotos.length} verification photos, keeping winner: ${winner._id}`);
      // Delete all except the deterministic winner
      for (const photo of allVerificationPhotos) {
        if (photo._id !== winner._id) {
          if (photo.storageId !== winner.storageId) {
            losersStorageIds.push(photo.storageId);
          }
          await ctx.db.delete(photo._id);
          console.log(`[PHOTO_GATE] M9: Deleted duplicate verification photo: ${photo._id}`);
        }
      }
    }

    // Safety net: include the user's previous verificationReferencePhotoId even if its
    // photos row was already missing, so an orphaned blob still gets cleaned up.
    const previousRefStorageId = user.verificationReferencePhotoId;
    if (
      previousRefStorageId &&
      previousRefStorageId !== winner.storageId &&
      !losersStorageIds.includes(previousRefStorageId)
    ) {
      losersStorageIds.push(previousRefStorageId);
    }

    console.log(`[PHOTO_GATE] stored verificationReferencePhotoId=${winner.storageId}`);

    // M9 FIX: Update user with WINNER's data, not current request's data
    // This ensures both concurrent requests point user to the same deterministic winner
    //
    // PRIVACY: The reference photo is private verification evidence and must NOT be
    // promoted to the public profile. We deliberately no longer set displayPrimaryPhotoId,
    // displayPrimaryPhotoUrl, or displayPrimaryPhotoVariant here. Public display fields
    // are managed exclusively by addPhoto / setDisplayPhotoVariant after verification.
    const gridPrimaryPhotoUrl = await getGridPrimaryPhotoUrl(ctx, userId);
    await ctx.db.patch(userId, {
      verificationReferencePhotoId: winner.storageId,
      verificationReferencePhotoUrl: winner.url,
      primaryPhotoUrl: gridPrimaryPhotoUrl ?? undefined,
      // Set verification status to pending
      faceVerificationStatus: 'unverified',
      verificationStatus: 'pending_auto',
    });

    console.log(`[PHOTO_GATE] user updated verificationReferencePhotoId set=true`);

    // Best-effort cleanup of old reference-photo storage blobs. We skip any blob still
    // referenced by another field on this user (e.g. legacy soft-leaked displayPrimaryPhotoId,
    // verificationPhotoId, faceVerificationSelfieId). Reused failedStorageDeletions queue
    // ensures retries via existing cron if delete fails.
    for (const oldStorageId of losersStorageIds) {
      const stillReferenced =
        oldStorageId === winner.storageId ||
        oldStorageId === user.displayPrimaryPhotoId ||
        oldStorageId === user.verificationPhotoId ||
        oldStorageId === user.faceVerificationSelfieId;
      if (stillReferenced) {
        console.log(`[PHOTO_GATE] Skipping storage delete for ${oldStorageId} - still referenced by user record`);
        continue;
      }
      try {
        await ctx.storage.delete(oldStorageId);
        console.log(`[PHOTO_GATE] Deleted old reference storage blob: ${oldStorageId}`);
      } catch (storageError) {
        const errorString = storageError instanceof Error
          ? storageError.message.slice(0, 500)
          : String(storageError).slice(0, 500);
        console.warn(`[PHOTO_GATE] Storage cleanup failed for ${oldStorageId}, queuing for retry:`, errorString);
        const existing = await ctx.db
          .query('failedStorageDeletions')
          .withIndex('by_storageId', (q) => q.eq('storageId', oldStorageId))
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, {
            failedAt: Date.now(),
            retryCount: existing.retryCount + 1,
            lastError: errorString,
          });
        } else {
          await ctx.db.insert('failedStorageDeletions', {
            storageId: oldStorageId,
            failedAt: Date.now(),
            retryCount: 0,
            lastError: errorString,
          });
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

    // P2-PROFILE: Per-user rate limit. Variant switching (original/blurred/
    // cartoon) is a privacy preference toggle; 10/min covers any plausible
    // UI usage and hard-blocks automated variant thrash that would inflate
    // the photos table with derived-display rows and churn the cached
    // primary photo URL.
    const variantLimit = await reserveActionSlots(ctx, userId, 'photo_set_variant', [
      { kind: '1min', windowMs: 60 * 1000, max: 10 },
    ]);
    if (!variantLimit.accept) {
      throw new Error('rate_limited');
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
      const gridPrimaryPhotoUrl = await getGridPrimaryPhotoUrl(ctx, userId);
      await ctx.db.patch(userId, {
        displayPrimaryPhotoId: user.verificationReferencePhotoId,
        displayPrimaryPhotoUrl: user.verificationReferencePhotoUrl,
        displayPrimaryPhotoVariant: 'original',
        primaryPhotoUrl: gridPrimaryPhotoUrl ?? undefined,
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
        moderationStatus: 'pending',
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
 *
 * P1-PROFILE FIX: Previously unauthenticated. Anonymous callers could pull
 * the display photo URL + verification flag for any user. Hardening: require
 * a session token; only the owner of `userId` (or an admin) receives data.
 * Anyone else gets null (matches the existing "safe null" shape).
 */
export const getDisplayPhoto = query({
  args: {
    token: v.string(),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionTokenAny(ctx, (args.token ?? '').trim());
    if (!callerId) return null;
    if (callerId !== args.userId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) return null;
    }

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
 *
 * P0-PROFILE-007 FIX: Previously this query took `requestingUserId` from the
 * client and trusted it. Any anonymous caller who knew an admin user `_id`
 * could pass it as `requestingUserId` to bypass the `isSelf || isAdmin` gate
 * and read every user's private verification face photo URL — the most
 * sensitive image users submit. Hardening:
 *   1. Drop the trusted `requestingUserId` arg entirely. Caller identity is
 *      derived from a session token via validateSessionToken — never from
 *      client-supplied IDs.
 *   2. Allow only owner-or-admin to read the URL/score/timestamp; everyone
 *      else gets an Unauthorized error.
 *   3. Preserve return shape for legitimate owner/admin callers.
 */
export const getVerificationReferencePhoto = query({
  args: {
    token: v.string(),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { token, targetUserId } = args;

    // P0-PROFILE-007: derive caller from token, NEVER from args.
    const callerId = await validateSessionTokenAny(ctx, (token ?? '').trim());
    if (!callerId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    const isSelf = callerId === targetUserId;
    let isAdmin = false;
    if (!isSelf) {
      const caller = await ctx.db.get(callerId);
      isAdmin = caller?.isAdmin === true;
    }

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
 *
 * P1-PROFILE FIX: Previously unauthenticated. Anonymous callers could
 * enumerate every user's `faceVerificationStatus`, whether they have a
 * verification photo, and current display variant. Hardening: require a
 * session token; only the owner of `userId` (or an admin) receives data.
 * Anyone else gets the safe `{hasPhoto:false, isVerified:false}` shape.
 */
export const checkPhotoGateStatus = query({
  args: {
    token: v.string(),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionTokenAny(ctx, (args.token ?? '').trim());
    if (!callerId) return { hasPhoto: false, isVerified: false };
    if (callerId !== args.userId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) return { hasPhoto: false, isVerified: false };
    }

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
 *
 * P1-PROFILE FIX: Previously unauthenticated. This query leaks the private
 * `verificationReferencePhotoUrl` for any user (alongside other gate state),
 * which is the single most sensitive photo URL in the system. Hardening:
 * require a session token; only the owner of `userId` (or an admin) receives
 * data. Anyone else gets the safe `exists:false` shape with all photo fields
 * set to null — never any URL or storage ID for another user.
 */
export const getPhotoGateStatus = query({
  args: {
    token: v.string(),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionTokenAny(ctx, (args.token ?? '').trim());
    const safeEmpty = {
      userId: args.userId,
      exists: false,
      verificationReferencePhotoId: null,
      verificationReferencePhotoUrl: null,
      displayPrimaryPhotoId: null,
      faceVerificationStatus: null,
    };
    if (!callerId) return safeEmpty;
    if (callerId !== args.userId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) return safeEmpty;
    }

    const user = await ctx.db.get(args.userId);
    if (!user) return safeEmpty;

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
    token: v.string(),
    userId: v.string(), // authId string
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await validateSessionToken(ctx, args.token.trim());
    const claimedUserId = await resolveUserIdByAuthId(ctx, args.userId);
    if (!resolvedUserId || !claimedUserId || resolvedUserId !== claimedUserId) {
      throw new Error('Unauthorized: upload ownership mismatch');
    }

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
    token: v.string(),
    userId: v.string(), // authId string
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await validateSessionToken(ctx, args.token.trim());
    const claimedUserId = await resolveUserIdByAuthId(ctx, args.userId);
    if (!resolvedUserId || !claimedUserId || resolvedUserId !== claimedUserId) {
      throw new Error('Unauthorized: upload ownership mismatch');
    }

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
export const deleteAllPhotosForUser = internalMutation({
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
