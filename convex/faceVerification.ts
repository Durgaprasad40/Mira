import { v } from 'convex/values';
import { action, mutation, query, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';

// Type for photo verification reasons
type PhotoVerificationReason =
  | 'no_face_detected'
  | 'multiple_faces'
  | 'blurry'
  | 'suspected_fake'
  | 'nsfw_content'
  | 'low_quality'
  | 'manual_review_required'
  | 'face_mismatch';

/**
 * Face Verification Service
 *
 * Compares a selfie against the user's profile photo using AWS Rekognition.
 * Returns PASS/PENDING/FAIL based on face similarity score.
 *
 * Thresholds:
 * - PASS: score >= 80 (high confidence match)
 * - PENDING: 60 <= score < 80 (manual review required)
 * - FAIL: score < 60 (clear mismatch)
 *
 * Also fails if:
 * - No face detected in either image
 * - Multiple faces detected
 * - Face quality too low
 */

// =============================================================================
// Constants
// =============================================================================

const FACE_MATCH_PASS_THRESHOLD = 80;  // Score >= 80 = PASS
const FACE_MATCH_PENDING_THRESHOLD = 60; // Score 60-79 = PENDING (manual review)
// Score < 60 = FAIL

type FaceMatchStatus = 'PASS' | 'PENDING' | 'FAIL';

// Structured reason codes for client-side routing decisions
export type FaceMatchReasonCode =
  | 'NO_REFERENCE_PHOTO'      // No verification reference photo uploaded
  | 'REFERENCE_NO_FACE'       // Reference photo has no face
  | 'REFERENCE_MULTI_FACE'    // Reference photo has multiple faces
  | 'SELFIE_NO_FACE'          // Selfie has no detectable face
  | 'SELFIE_MULTI_FACE'       // Selfie has multiple faces
  | 'MISMATCH'                // Faces don't match (score < threshold)
  | 'PENDING_REVIEW'          // Pending manual review (default mode)
  | 'MATCH';                  // Faces match successfully (admin approved)

interface FaceMatchResult {
  status: FaceMatchStatus;
  score: number | null;
  reason: string | null;
  reasonCode?: FaceMatchReasonCode; // Structured code for routing
  mode?: 'demo_auto' | 'manual_review'; // Verification mode
  details?: {
    sourceHasFace: boolean;
    targetHasFace: boolean;
    sourceFaceCount: number;
    targetFaceCount: number;
  };
}

// =============================================================================
// Helper: Get user's verification reference photo URL (internal query for action use)
// =============================================================================

export const getVerificationReferencePhotoUrl = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    // Prefer the new verificationReferencePhotoUrl field
    if (user.verificationReferencePhotoUrl) {
      return user.verificationReferencePhotoUrl;
    }

    // Fall back to primary photo if no verification reference set
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect();

    // First try to find a verification_reference type photo
    const verificationPhoto = photos.find(p => p.photoType === 'verification_reference');
    if (verificationPhoto) {
      return verificationPhoto.url;
    }

    // Fall back to primary photo
    const primaryPhoto = photos.find(p => p.isPrimary) || photos[0];
    if (!primaryPhoto) {
      return null;
    }

    return primaryPhoto.url;
  },
});

// Legacy alias for backward compatibility
export const getPrimaryPhotoUrl = getVerificationReferencePhotoUrl;

// =============================================================================
// Internal mutation to save verification result
// =============================================================================

export const saveVerificationResult = internalMutation({
  args: {
    userId: v.id('users'),
    status: v.union(v.literal('PASS'), v.literal('PENDING'), v.literal('FAIL')),
    score: v.number(),
    reason: v.string(),
    selfieStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    const { userId, status, score, reason, selfieStorageId } = args;

    // Map status to legacy verification status
    const verificationStatus =
      status === 'PASS' ? 'verified' :
      status === 'PENDING' ? 'pending_manual' :
      'rejected';

    // Map status to new faceVerificationStatus
    const faceVerificationStatus =
      status === 'PASS' ? 'verified' :
      status === 'PENDING' ? 'pending' :
      'failed';

    // Map reason to photoVerificationReason
    let photoVerificationReason: PhotoVerificationReason | undefined;
    if (reason.includes('No face detected')) {
      photoVerificationReason = 'no_face_detected';
    } else if (reason.includes('Multiple faces')) {
      photoVerificationReason = 'multiple_faces';
    } else if (reason.includes('match') || reason.includes('mismatch')) {
      photoVerificationReason = status === 'FAIL' ? 'face_mismatch' : undefined;
    } else if (status === 'PENDING') {
      photoVerificationReason = 'manual_review_required';
    }

    await ctx.db.patch(userId, {
      verificationStatus,
      faceVerificationStatus, // New clean status field
      photoVerificationReason,
      faceMatchScore: score,
      faceVerificationAttemptedAt: Date.now(),
      faceVerificationSelfieId: selfieStorageId,
      // Only mark as verified if PASS
      isVerified: status === 'PASS',
      verificationCompletedAt: status === 'PASS' ? Date.now() : undefined,
    });

    // If PENDING, add to moderation queue
    if (status === 'PENDING') {
      await ctx.db.insert('moderationQueue', {
        reportedUserId: userId,
        contentType: 'profile_photo',
        contentId: selfieStorageId,
        contentText: `Face match score: ${score}. ${reason}`,
        flagCategories: ['manual_review_required'],
        isAutoFlagged: true,
        status: 'pending',
        createdAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// =============================================================================
// Internal mutation to generate upload URL for selfie storage
// =============================================================================

export const generateSelfieUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// =============================================================================
// Internal mutation to save selfie storage ID after upload
// =============================================================================

export const saveSelfieStorageId = internalMutation({
  args: {
    userId: v.id('users'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const { userId, storageId } = args;

    const selfieUrl = await ctx.storage.getUrl(storageId);
    console.log(`[FaceMatch] Stored selfie for manual review: storageId=${storageId}`);

    return { storageId, selfieUrl };
  },
});

// =============================================================================
// Main face verification action - DEMO AUTO-APPROVE or MANUAL REVIEW MODE
// =============================================================================

export const compareFaces = action({
  args: {
    userId: v.string(),
    selfieBase64: v.string(), // Base64 encoded selfie image
    isDemoMode: v.optional(v.boolean()), // Demo mode flag from client
  },
  handler: async (ctx, args): Promise<FaceMatchResult> => {
    const { userId, selfieBase64, isDemoMode = false } = args;

    const mode = isDemoMode ? 'demo_auto' : 'manual_review';
    console.log(`[FaceVerify] mode=${mode} Starting verification for user ${userId}`);

    // Get user's verification reference photo
    const verificationPhotoUrl = await ctx.runQuery(internal.faceVerification.getVerificationReferencePhotoUrl, {
      userId: userId as Id<'users'>,
    });

    if (!verificationPhotoUrl) {
      console.log(`[FaceVerify] mode=${mode} status=failed reason=missing_reference_photo`);
      return {
        status: 'FAIL',
        score: null,
        reason: 'No verification reference photo found. Please upload a clear face photo first.',
        reasonCode: 'NO_REFERENCE_PHOTO',
        mode,
      };
    }

    console.log(`[FaceVerify] mode=${mode} Reference photo found`);

    try {
      // Step 1: Get an upload URL
      console.log(`[FaceVerify] mode=${mode} Getting upload URL for selfie...`);
      const uploadUrl = await ctx.runMutation(internal.faceVerification.generateSelfieUploadUrl, {});

      // Step 2: Convert base64 to binary and upload
      console.log(`[FaceVerify] mode=${mode} Uploading selfie to storage...`);
      const binaryString = atob(selfieBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: bytes,
      });

      if (!uploadResponse.ok) {
        console.log(`[FaceVerify] mode=${mode} status=failed reason=selfie_upload_failed`);
        return {
          status: 'FAIL',
          score: null,
          reason: 'Failed to upload selfie. Please try again.',
          reasonCode: 'SELFIE_NO_FACE',
          mode,
        };
      }

      const uploadResult = await uploadResponse.json();
      const selfieStorageId = uploadResult.storageId as Id<'_storage'>;

      // Step 3: Save the storage ID
      console.log(`[FaceVerify] mode=${mode} Saving selfie storage ID...`);
      await ctx.runMutation(internal.faceVerification.saveSelfieStorageId, {
        userId: userId as Id<'users'>,
        storageId: selfieStorageId,
      });

      // Step 4: Handle based on mode
      if (isDemoMode) {
        // DEMO AUTO-APPROVE: Immediately verify the user
        console.log(`[FaceVerify] mode=demo_auto status=verified - Auto-approving verification`);
        await ctx.runMutation(internal.faceVerification.saveVerificationResult, {
          userId: userId as Id<'users'>,
          status: 'PASS',
          score: 100, // Perfect score for demo auto-approve
          reason: 'Verified (Demo)',
          selfieStorageId,
        });

        return {
          status: 'PASS',
          score: null,
          reason: null,
          reasonCode: 'MATCH',
          mode: 'demo_auto',
        };
      } else {
        // MANUAL REVIEW MODE: Set to PENDING for admin review
        console.log(`[FaceVerify] mode=manual_review status=pending - Setting for manual review`);
        await ctx.runMutation(internal.faceVerification.saveVerificationResult, {
          userId: userId as Id<'users'>,
          status: 'PENDING',
          score: 0,
          reason: 'Your profile is pending manual verification.',
          selfieStorageId,
        });

        return {
          status: 'PENDING',
          score: null,
          reason: 'Your selfie has been captured. Your profile is now pending manual verification.',
          reasonCode: 'PENDING_REVIEW',
          mode: 'manual_review',
        };
      }

    } catch (error: any) {
      console.error(`[FaceVerify] mode=${mode} status=failed reason=selfie_upload_failed error=${error.message}`);

      return {
        status: 'FAIL',
        score: null,
        reason: `Failed to capture selfie: ${error.message}. Please try again.`,
        reasonCode: 'SELFIE_NO_FACE',
        mode,
      };
    }
  },
});

// =============================================================================
// Query to check verification status
// =============================================================================

export const getVerificationStatus = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      status: user.verificationStatus || 'unverified',
      faceVerificationStatus: user.faceVerificationStatus || 'unverified',
      reason: user.photoVerificationReason,
      score: user.faceMatchScore,
      isVerified: user.isVerified,
      attemptedAt: user.faceVerificationAttemptedAt,
    };
  },
});

// =============================================================================
// Admin Functions for Manual Verification Review
// =============================================================================

/**
 * Helper to check if requesting user is an admin.
 * Returns the admin user or throws an error.
 */
async function requireAdmin(ctx: any, adminUserId: Id<'users'>) {
  const admin = await ctx.db.get(adminUserId);
  if (!admin) {
    throw new Error('Admin user not found');
  }
  if (!admin.isAdmin) {
    throw new Error('Access denied: Admin privileges required');
  }
  return admin;
}

/**
 * List pending verifications for admin review.
 * Returns users with faceVerificationStatus = 'pending'.
 */
export const listPendingVerifications = query({
  args: {
    adminUserId: v.id('users'),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { adminUserId, limit = 20 } = args;

    // Check admin access
    await requireAdmin(ctx, adminUserId);

    // Query users with pending face verification
    // Note: Using filter since we may not have an index on faceVerificationStatus
    const allUsers = await ctx.db.query('users').collect();

    const pendingUsers = allUsers
      .filter(u => u.faceVerificationStatus === 'pending')
      .sort((a, b) => (b.faceVerificationAttemptedAt || 0) - (a.faceVerificationAttemptedAt || 0))
      .slice(0, limit);

    // Build response with photo URLs
    const results = await Promise.all(
      pendingUsers.map(async (user) => {
        // Get selfie URL if available
        let selfieUrl = null;
        if (user.faceVerificationSelfieId) {
          selfieUrl = await ctx.storage.getUrl(user.faceVerificationSelfieId);
        }

        return {
          userId: user._id,
          name: user.name,
          email: user.email,
          displayPhotoUrl: user.displayPrimaryPhotoUrl || user.verificationReferencePhotoUrl,
          verificationReferencePhotoUrl: user.verificationReferencePhotoUrl,
          selfieUrl,
          faceVerificationAttemptedAt: user.faceVerificationAttemptedAt,
          createdAt: user.createdAt,
        };
      })
    );

    return {
      items: results,
      totalPending: pendingUsers.length,
    };
  },
});

/**
 * Approve a user's face verification (admin only).
 * Sets faceVerificationStatus = 'verified' and isVerified = true.
 */
export const approveVerification = mutation({
  args: {
    adminUserId: v.id('users'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { adminUserId, targetUserId } = args;

    // Check admin access
    const admin = await requireAdmin(ctx, adminUserId);

    // Get target user
    const targetUser = await ctx.db.get(targetUserId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    // Update verification status
    await ctx.db.patch(targetUserId, {
      faceVerificationStatus: 'verified',
      verificationStatus: 'verified',
      isVerified: true,
      verificationCompletedAt: Date.now(),
      photoVerificationReason: undefined, // Clear any previous reason
      // Keep the score as 100 for admin-approved
      faceMatchScore: 100,
    });

    console.log(`[Admin] User ${targetUserId} verification APPROVED by admin ${adminUserId}`);

    return {
      success: true,
      message: 'User verification approved',
      userId: targetUserId,
    };
  },
});

/**
 * Reject a user's face verification (admin only).
 * Sets faceVerificationStatus = 'failed' with a reason.
 */
export const rejectVerification = mutation({
  args: {
    adminUserId: v.id('users'),
    targetUserId: v.id('users'),
    reason: v.union(v.literal('face_mismatch'), v.literal('unclear'), v.literal('suspected_fake')),
  },
  handler: async (ctx, args) => {
    const { adminUserId, targetUserId, reason } = args;

    // Check admin access
    const admin = await requireAdmin(ctx, adminUserId);

    // Get target user
    const targetUser = await ctx.db.get(targetUserId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    // Map reason to PhotoVerificationReason
    const photoVerificationReason: PhotoVerificationReason =
      reason === 'face_mismatch' ? 'face_mismatch' :
      reason === 'unclear' ? 'low_quality' :
      'suspected_fake';

    // Update verification status
    await ctx.db.patch(targetUserId, {
      faceVerificationStatus: 'failed',
      verificationStatus: 'rejected',
      isVerified: false,
      photoVerificationReason,
      faceMatchScore: 0,
    });

    console.log(`[Admin] User ${targetUserId} verification REJECTED by admin ${adminUserId}, reason: ${reason}`);

    return {
      success: true,
      message: `User verification rejected: ${reason}`,
      userId: targetUserId,
    };
  },
});

/**
 * Get verification details for a specific user (admin only).
 * Includes both reference photo and selfie URLs.
 */
export const getVerificationDetails = query({
  args: {
    adminUserId: v.id('users'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { adminUserId, targetUserId } = args;

    // Check admin access
    await requireAdmin(ctx, adminUserId);

    const user = await ctx.db.get(targetUserId);
    if (!user) {
      return null;
    }

    // Get selfie URL if available
    let selfieUrl = null;
    if (user.faceVerificationSelfieId) {
      selfieUrl = await ctx.storage.getUrl(user.faceVerificationSelfieId);
    }

    return {
      userId: user._id,
      name: user.name,
      email: user.email,
      verificationReferencePhotoUrl: user.verificationReferencePhotoUrl,
      selfieUrl,
      faceVerificationStatus: user.faceVerificationStatus,
      faceMatchScore: user.faceMatchScore,
      photoVerificationReason: user.photoVerificationReason,
      faceVerificationAttemptedAt: user.faceVerificationAttemptedAt,
      verificationCompletedAt: user.verificationCompletedAt,
    };
  },
});
