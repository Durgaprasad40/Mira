import { v } from "convex/values";
import { mutation, query, internalMutation, QueryCtx, MutationCtx } from "./_generated/server";
import { logAdminAction } from "./adminLog";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Validate admin access from session token.
 * Returns the admin user if valid, throws if unauthorized.
 */
async function requireAdmin(ctx: QueryCtx | MutationCtx, token: string) {
  const now = Date.now();

  // Look up session by token
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();

  if (!session || session.expiresAt < now) {
    throw new Error("Unauthorized: Invalid or expired session");
  }

  // Get user and verify admin status
  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive || user.isBanned) {
    throw new Error("Unauthorized: Invalid user");
  }

  // Check if session was revoked
  if (user.sessionsRevokedAt && session.createdAt < user.sessionsRevokedAt) {
    throw new Error("Unauthorized: Session revoked");
  }

  // Verify admin privilege
  if (!user.isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  return user;
}

// Create a new verification session
export const createVerificationSession = mutation({
  args: {
    userId: v.id("users"),
    selfieStorageId: v.id("_storage"),
    metadata: v.optional(
      v.object({
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        format: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { userId, selfieStorageId, metadata } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    // Expire old pending sessions for this user
    const pendingSessions = await ctx.db
      .query("verificationSessions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "pending")
      )
      .collect();

    for (const session of pendingSessions) {
      await ctx.db.patch(session._id, { status: "expired" });
    }

    // Create new session
    const sessionId = await ctx.db.insert("verificationSessions", {
      userId,
      selfieStorageId,
      status: "pending",
      selfieMetadata: metadata,
      createdAt: now,
      expiresAt: now + SESSION_EXPIRY_MS,
    });

    // Update user verification status
    await ctx.db.patch(userId, {
      verificationStatus: "pending_verification",
    });

    return { sessionId };
  },
});

// Review a verification session (admin action)
export const reviewVerificationSession = mutation({
  args: {
    sessionId: v.id("verificationSessions"),
    approved: v.boolean(),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { sessionId, approved, rejectionReason } = args;
    const now = Date.now();

    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "pending") throw new Error("Session is not pending");

    if (approved) {
      await ctx.db.patch(sessionId, {
        status: "approved",
        reviewedAt: now,
      });
      await ctx.db.patch(session.userId, {
        isVerified: true,
        verificationStatus: "verified",
        verificationEnforcementLevel: "none",
        verificationCompletedAt: now,
      });
    } else {
      await ctx.db.patch(sessionId, {
        status: "rejected",
        rejectionReason,
        reviewedAt: now,
      });
      await ctx.db.patch(session.userId, {
        verificationStatus: "unverified",
      });
    }

    return { success: true };
  },
});

// Retry verification (rate-limited)
export const retryVerification = mutation({
  args: {
    userId: v.id("users"),
    selfieStorageId: v.id("_storage"),
    metadata: v.optional(
      v.object({
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        format: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { userId, selfieStorageId, metadata } = args;
    const now = Date.now();

    // Rate limit: max 3 rejected sessions per 30 days
    const recentRejected = await ctx.db
      .query("verificationSessions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "rejected")
      )
      .collect();

    const recentCount = recentRejected.filter(
      (s) => now - s.createdAt < THIRTY_DAYS_MS
    ).length;

    if (recentCount >= 3) {
      throw new Error(
        "Too many verification attempts. Please try again later."
      );
    }

    // Expire old pending sessions
    const pendingSessions = await ctx.db
      .query("verificationSessions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "pending")
      )
      .collect();

    for (const session of pendingSessions) {
      await ctx.db.patch(session._id, { status: "expired" });
    }

    const sessionId = await ctx.db.insert("verificationSessions", {
      userId,
      selfieStorageId,
      status: "pending",
      selfieMetadata: metadata,
      createdAt: now,
      expiresAt: now + SESSION_EXPIRY_MS,
    });

    await ctx.db.patch(userId, {
      verificationStatus: "pending_verification",
    });

    return { sessionId };
  },
});

// Get verification status for a user
export const getVerificationStatus = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const status = user.verificationStatus || "unverified";

    // Find pending session if any
    const pendingSession = await ctx.db
      .query("verificationSessions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "pending")
      )
      .first();

    return {
      status,
      pendingSessionId: pendingSession?._id,
      completedAt: user.verificationCompletedAt,
    };
  },
});

// Dismiss verification reminder
export const dismissVerificationReminder = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      verificationReminderDismissedAt: Date.now(),
    });
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// 8A: Photo Verification Pipeline
// ---------------------------------------------------------------------------

type VerificationReason =
  | "no_face_detected"
  | "multiple_faces"
  | "blurry"
  | "suspected_fake"
  | "nsfw_content"
  | "low_quality"
  | "manual_review_required";

/**
 * 8A: Process photo for auto-verification.
 * Analyzes the primary photo and determines verification status.
 * - If face detected and passes checks → verified
 * - If unclear/no face → pending_manual (needs human review)
 * - If clearly fake/NSFW → rejected
 */
export const processPhotoVerification = mutation({
  args: {
    userId: v.id("users"),
    photoId: v.id("photos"),
    // Client-side face detection results (basic checks)
    faceDetectionResult: v.object({
      hasFace: v.boolean(),
      faceCount: v.number(),
      confidence: v.number(), // 0-1 confidence score
      isBlurry: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const { userId, photoId, faceDetectionResult } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const photo = await ctx.db.get(photoId);
    if (!photo || photo.userId !== userId) {
      throw new Error("Photo not found or doesn't belong to user");
    }

    // Update photo's hasFace flag
    await ctx.db.patch(photoId, { hasFace: faceDetectionResult.hasFace });

    // Analyze results and determine verification status
    let newStatus: "verified" | "pending_manual" | "rejected" = "pending_manual";
    let reason: VerificationReason | undefined;

    if (!faceDetectionResult.hasFace) {
      // No face detected → needs manual review
      newStatus = "pending_manual";
      reason = "no_face_detected";
    } else if (faceDetectionResult.faceCount > 1) {
      // Multiple faces → needs manual review (which one is the user?)
      newStatus = "pending_manual";
      reason = "multiple_faces";
    } else if (faceDetectionResult.isBlurry) {
      // Blurry → needs manual review
      newStatus = "pending_manual";
      reason = "blurry";
    } else if (faceDetectionResult.confidence < 0.3) {
      // Low confidence → needs manual review
      newStatus = "pending_manual";
      reason = "low_quality";
    } else if (faceDetectionResult.confidence >= 0.7) {
      // High confidence single face → auto-approve
      newStatus = "verified";
      reason = undefined;
    } else {
      // Medium confidence → manual review to be safe
      newStatus = "pending_manual";
      reason = "manual_review_required";
    }

    // Update user verification status
    const updates: Record<string, unknown> = {
      verificationStatus: newStatus,
    };

    if (reason) {
      updates.photoVerificationReason = reason;
    } else {
      // Clear reason if verified
      updates.photoVerificationReason = undefined;
    }

    if (newStatus === "verified") {
      updates.isVerified = true;
      updates.verificationCompletedAt = now;
      updates.verificationEnforcementLevel = "none";
    }

    await ctx.db.patch(userId, updates);

    // If pending_manual, create a verification session for admin review
    if (newStatus === "pending_manual") {
      // Expire old pending sessions for this user
      const pendingSessions = await ctx.db
        .query("verificationSessions")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "pending")
        )
        .collect();

      for (const session of pendingSessions) {
        await ctx.db.patch(session._id, { status: "expired" });
      }

      // Create new session for manual review
      await ctx.db.insert("verificationSessions", {
        userId,
        selfieStorageId: photo.storageId,
        status: "pending",
        selfieMetadata: {
          width: photo.width,
          height: photo.height,
        },
        createdAt: now,
        expiresAt: now + SESSION_EXPIRY_MS,
      });
    }

    return {
      success: true,
      status: newStatus,
      reason,
    };
  },
});

/**
 * 8A: Admin query to get pending manual review queue.
 * Returns users with pending_manual status along with their photos.
 * Requires admin access via valid session token.
 */
export const getPendingManualReviews = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { token, limit = 50, offset = 0 } = args;

    // Admin gate: verify session token belongs to an admin
    await requireAdmin(ctx, token);

    // Get pending verification sessions
    const pendingSessions = await ctx.db
      .query("verificationSessions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const results = [];

    for (const session of pendingSessions.slice(offset, offset + limit)) {
      const user = await ctx.db.get(session.userId);
      if (!user) continue;

      // Get all user photos for context
      const photos = await ctx.db
        .query("photos")
        .withIndex("by_user", (q) => q.eq("userId", session.userId))
        .collect();

      // Get storage URL for the verification photo
      const verificationPhotoUrl = await ctx.storage.getUrl(session.selfieStorageId);

      results.push({
        sessionId: session._id,
        userId: session.userId,
        userName: user.name,
        userEmail: user.email,
        verificationPhotoUrl,
        verificationReason: user.photoVerificationReason,
        photos: photos.map((p) => ({
          id: p._id,
          url: p.url,
          isPrimary: p.isPrimary,
          hasFace: p.hasFace,
        })),
        createdAt: session.createdAt,
        userCreatedAt: user.createdAt,
      });
    }

    return {
      reviews: results,
      total: pendingSessions.length,
    };
  },
});

/**
 * 8A: Admin action to approve or reject a pending verification.
 * Requires admin access via valid session token.
 */
export const adminReviewVerification = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("verificationSessions"),
    action: v.union(v.literal("approve"), v.literal("reject")),
    rejectionReason: v.optional(
      v.union(
        v.literal("no_face_detected"),
        v.literal("multiple_faces"),
        v.literal("blurry"),
        v.literal("suspected_fake"),
        v.literal("nsfw_content"),
        v.literal("low_quality")
      )
    ),
    reviewerNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, sessionId, action, rejectionReason, reviewerNote } = args;
    const now = Date.now();

    // Admin gate: verify session token belongs to an admin
    const admin = await requireAdmin(ctx, token);

    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "pending") {
      throw new Error("Session is not pending");
    }

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    // Capture old status for audit log
    const oldStatus = user.verificationStatus || "unverified";

    if (action === "approve") {
      // Approve verification
      await ctx.db.patch(sessionId, {
        status: "approved",
        reviewedAt: now,
      });

      await ctx.db.patch(session.userId, {
        isVerified: true,
        verificationStatus: "verified",
        verificationEnforcementLevel: "none",
        verificationCompletedAt: now,
        photoVerificationReason: undefined,
      });

      // Notify user of approval
      await ctx.db.insert("notifications", {
        userId: session.userId,
        type: "subscription", // Using existing type for system notifications
        title: "Profile Verified!",
        body: "Your profile photo has been verified. You can now fully use Mira!",
        createdAt: now,
      });
    } else {
      // Reject verification
      await ctx.db.patch(sessionId, {
        status: "rejected",
        rejectionReason: rejectionReason || "suspected_fake",
        reviewedAt: now,
      });

      await ctx.db.patch(session.userId, {
        isVerified: false,
        verificationStatus: "rejected",
        photoVerificationReason: rejectionReason || "suspected_fake",
      });

      // Notify user of rejection
      const reasonMessages: Record<string, string> = {
        no_face_detected: "Your photo doesn't clearly show your face.",
        multiple_faces: "Your photo contains multiple people.",
        blurry: "Your photo is too blurry.",
        suspected_fake: "Your photo doesn't appear to be genuine.",
        nsfw_content: "Your photo contains inappropriate content.",
        low_quality: "Your photo quality is too low.",
      };

      const message = reasonMessages[rejectionReason || "suspected_fake"];

      await ctx.db.insert("notifications", {
        userId: session.userId,
        type: "subscription",
        title: "Photo Verification Failed",
        body: `${message} Please upload a new photo to get verified.`,
        createdAt: now,
      });
    }

    // Audit log: record the admin action
    await logAdminAction(ctx, {
      adminUserId: admin._id,
      action: action === "approve" ? "verify_approve" : "verify_reject",
      targetUserId: session.userId,
      reason: rejectionReason,
      metadata: {
        sessionId,
        oldStatus,
        newStatus: action === "approve" ? "verified" : "rejected",
        photoVerificationReason: rejectionReason,
        reviewerNote,
      },
    });

    return { success: true, action };
  },
});

/**
 * 8A: Check if user can interact (match/chat).
 * Returns false if user is not verified or is rejected.
 */
export const canUserInteract = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { canInteract: false, reason: "user_not_found" };

    // Banned users cannot interact
    if (user.isBanned) {
      return { canInteract: false, reason: "banned" };
    }

    // Inactive users cannot interact
    if (!user.isActive) {
      return { canInteract: false, reason: "inactive" };
    }

    const status = user.verificationStatus || "unverified";

    // Only verified users can fully interact
    if (status === "verified") {
      return { canInteract: true, reason: null };
    }

    // Rejected users must re-upload
    if (status === "rejected") {
      return {
        canInteract: false,
        reason: "rejected",
        message: "Your photo was rejected. Please upload a new one.",
      };
    }

    // Pending users have limited interactions
    if (status === "pending_auto" || status === "pending_manual" || status === "pending_verification") {
      return {
        canInteract: false,
        reason: "pending",
        message: "Your profile is being verified. This usually takes a few minutes.",
      };
    }

    // Unverified users need to upload a photo
    return {
      canInteract: false,
      reason: "unverified",
      message: "Please upload a profile photo to get verified.",
    };
  },
});

/**
 * 8A: User action to re-upload photo after rejection.
 * Clears rejection status and starts fresh verification.
 */
export const clearRejectionForReupload = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    if (user.verificationStatus !== "rejected") {
      throw new Error("User is not in rejected state");
    }

    // Reset to unverified so they can upload a new photo
    await ctx.db.patch(args.userId, {
      verificationStatus: "unverified",
      photoVerificationReason: undefined,
    });

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// 8C: Verification Photo Retention Policy
// ---------------------------------------------------------------------------

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 8C: Cleanup verification photos older than 90 days.
 * - Deletes storage objects for verification session selfies
 * - Only processes approved/rejected/expired sessions (not pending)
 * - Runs daily via cron
 */
export const cleanupOldVerificationPhotos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - NINETY_DAYS_MS;

    // Find old verification sessions (not pending)
    const oldSessions = await ctx.db
      .query("verificationSessions")
      .filter((q) =>
        q.and(
          q.lt(q.field("createdAt"), cutoff),
          q.neq(q.field("status"), "pending")
        )
      )
      .take(50); // Process in batches

    let deletedPhotos = 0;
    let deletedSessions = 0;

    for (const session of oldSessions) {
      // Delete the verification photo from storage
      try {
        await ctx.storage.delete(session.selfieStorageId);
        deletedPhotos++;
      } catch {
        // Photo may already be deleted, continue
      }

      // Delete the session record
      await ctx.db.delete(session._id);
      deletedSessions++;
    }

    return {
      deletedPhotos,
      deletedSessions,
      hasMore: oldSessions.length === 50,
    };
  },
});
