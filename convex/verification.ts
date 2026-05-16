import { v } from "convex/values";
import { mutation, query, internalMutation, QueryCtx, MutationCtx } from "./_generated/server";
import { logAdminAction } from "./adminLog";
import { resolveUserIdByAuthId, validateSessionToken } from "./helpers";
import { reserveActionSlots } from "./actionRateLimits";

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
// P0-PROFILE-003 FIX: This mutation patches `users.isVerified = true` and
// `verificationStatus = "verified"` for the session's owner — the verified
// badge is the central trust signal of the app. The function previously had
// NO auth/admin gate, allowing any unauthenticated caller to self-approve
// (chained with the unauthenticated `getVerificationStatus` which leaked
// `pendingSessionId`). Hardening: require an admin session token via the
// existing local `requireAdmin` helper. Normal users cannot call this.
export const reviewVerificationSession = mutation({
  args: {
    token: v.string(),
    sessionId: v.id("verificationSessions"),
    approved: v.boolean(),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, sessionId, approved, rejectionReason } = args;
    const now = Date.now();

    // P0-PROFILE-003: Admin-only. requireAdmin throws on missing/expired/
    // non-admin sessions and returns the admin user otherwise.
    await requireAdmin(ctx, (token ?? "").trim());

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
// P0-PROFILE-006 FIX: Previously this mutation was unauthenticated and any
// anonymous caller could force any victim into `verificationStatus =
// "pending_verification"` by passing the victim's userId. Hardening: require
// a valid session whose owner matches the userId being modified. The existing
// per-target 30-day rejected-session cap is preserved.
export const retryVerification = mutation({
  args: {
    token: v.string(),
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
    const { token, userId, selfieStorageId, metadata } = args;
    const now = Date.now();

    // P0-PROFILE-006: caller must own the target userId.
    const callerId = await validateSessionToken(ctx, (token ?? "").trim());
    if (!callerId) {
      throw new Error("Unauthorized: invalid or expired session");
    }
    if (callerId !== userId) {
      throw new Error("Unauthorized: cannot retry verification for another user");
    }

    // P2-PROFILE: Per-user rate limit on verification retry. Layered with the
    // existing 30-day rejected-session cap below — this short-window guard
    // hard-blocks rapid-fire retry loops that would burn moderator review
    // bandwidth and create thrash in the verificationSessions table.
    // 3/hr + 10/day is generous for legitimate retry behavior (selfie didn't
    // upload, network retry) but stops automated abuse cold.
    const retryLimit = await reserveActionSlots(ctx, userId, 'verification_retry', [
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 10 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 3 },
    ]);
    if (!retryLimit.accept) {
      throw new Error('rate_limited');
    }

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
// P0-PROFILE-004 FIX: Previously this query was unauthenticated and returned
// `pendingSessionId` for any user, which chained with the unauthenticated
// `reviewVerificationSession` to enable self-approval of any victim's
// verification. Hardening:
//   1. Require a session token; reject unauthenticated callers (return null).
//   2. Only return data when the caller is the owner of `userId`, OR the
//      caller is an admin. Other callers receive null (matches the existing
//      "safe null shape" convention used elsewhere in this file).
//   3. `pendingSessionId` is only returned to the owner / admin — never to
//      arbitrary callers. (After auth gating it is by definition only
//      returned to owner/admin since other callers get null.)
export const getVerificationStatus = query({
  args: {
    token: v.string(),
    userId: v.union(v.id("users"), v.string()), // Accept both Convex ID and authUserId string
  },
  handler: async (ctx, args) => {
    // P0-PROFILE-004: require a valid session
    const callerId = await validateSessionToken(ctx, (args.token ?? "").trim());
    if (!callerId) return null;

    // Map authUserId -> Convex Id<"users"> if needed
    const convexUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!convexUserId) return null;

    // P0-PROFILE-004: owner-or-admin gate. Non-owner non-admin callers get
    // null (do not leak status, completion timestamp, or pendingSessionId).
    if (callerId !== convexUserId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) return null;
    }

    const user = await ctx.db.get(convexUserId);
    if (!user) return null;

    const status = user.verificationStatus || "unverified";

    // Find pending session if any
    const pendingSession = await ctx.db
      .query("verificationSessions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", convexUserId).eq("status", "pending")
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
// P1-PROFILE FIX: Previously this mutation accepted any `userId` and would
// patch that user's `verificationReminderDismissedAt`, allowing one user to
// silently dismiss reminders on every other user's account (mass IDOR).
// Hardening: require a session token and confirm the token-derived caller is
// the same as `args.userId`. Non-owners get an Unauthorized error.
export const dismissVerificationReminder = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionToken(ctx, (args.token ?? "").trim());
    if (!callerId) {
      throw new Error("Unauthorized: invalid or expired session");
    }
    if (callerId !== args.userId) {
      throw new Error("Unauthorized: cannot dismiss reminder for another user");
    }

    // P2-PROFILE: Per-user rate limit. The dismiss reminder action is a
    // single-tap user gesture; 10/hr + 30/day is comfortably above any
    // honest UI flow (user sees the banner, dismisses it once or twice
    // across the day) and hard-blocks automated dismissal churn that
    // would defeat the reminder feedback loop.
    const dismissLimit = await reserveActionSlots(ctx, callerId, 'verification_dismiss', [
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 30 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 10 },
    ]);
    if (!dismissLimit.accept) {
      throw new Error('rate_limited');
    }

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
// P0-PROFILE-005 FIX: Previously this mutation was unauthenticated AND
// trusted the client-supplied `faceDetectionResult.confidence` to set
// `isVerified=true` / `verificationStatus="verified"` /
// `verificationEnforcementLevel="none"`. An attacker could submit
// `{ hasFace:true, faceCount:1, confidence:1.0, isBlurry:false }` and
// auto-verify any account (combined with the photos.uploadVerificationReferencePhoto
// IDOR, even any victim account). Hardening:
//   1. Require a session token; caller must own the target userId.
//   2. Never auto-mark the user as verified based on client-supplied
//      confidence. Client metadata is recorded only on the photo's hasFace
//      flag (non-authoritative) and steers the flow toward manual review or
//      a `pending_manual` queue. Only an authenticated admin (via
//      `reviewVerificationSession` / `adminReviewVerification`) or the
//      server-side face verification action can transition the user to
//      `verified`. The client may NOT set `isVerified` here under any
//      `confidence` value.
//   3. Return shape preserved (`{ success, status, reason }`) so existing
//      frontends continue to function; in particular, what used to be the
//      `"verified"` branch now resolves to `"pending_manual"` with reason
//      `manual_review_required` so the UI shows "pending review" instead of
//      "verified". Server-side / admin verification finishes the flow.
export const processPhotoVerification = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    photoId: v.id("photos"),
    // Client-side face detection results (NON-AUTHORITATIVE — only used to
    // pre-flag obviously bad uploads and to seed the `photos.hasFace` flag).
    faceDetectionResult: v.object({
      hasFace: v.boolean(),
      faceCount: v.number(),
      confidence: v.number(), // 0-1 confidence score (NOT trusted for verification)
      isBlurry: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const { token, userId, photoId, faceDetectionResult } = args;
    const now = Date.now();

    // P0-PROFILE-005: caller must own the target userId.
    const callerId = await validateSessionToken(ctx, (token ?? "").trim());
    if (!callerId) {
      throw new Error("Unauthorized: invalid or expired session");
    }
    if (callerId !== userId) {
      throw new Error("Unauthorized: cannot process verification for another user");
    }

    // P2-PROFILE: Per-user rate limit. Each call patches the photo's hasFace
    // flag and routes verification state — a tampered client could spin this
    // to thrash the verification queue. 3/hr + 10/day is well above any
    // legitimate retry pattern (typically 1-2 attempts per upload) and
    // hard-blocks automated abuse.
    const processLimit = await reserveActionSlots(ctx, userId, 'verification_process', [
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 10 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 3 },
    ]);
    if (!processLimit.accept) {
      throw new Error('rate_limited');
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const photo = await ctx.db.get(photoId);
    if (!photo || photo.userId !== userId) {
      throw new Error("Photo not found or doesn't belong to user");
    }

    // Update photo's hasFace flag (non-authoritative client metadata)
    await ctx.db.patch(photoId, { hasFace: faceDetectionResult.hasFace });

    // P0-PROFILE-005: Determine routing only. The high-confidence
    // auto-approve branch is REMOVED — under no client-supplied value can
    // this mutation mark the user as `verified`. Best-case outcome is
    // `pending_manual` for the admin/server-side review pipeline.
    let newStatus: "pending_manual" = "pending_manual";
    let reason: VerificationReason | undefined;

    if (!faceDetectionResult.hasFace) {
      reason = "no_face_detected";
    } else if (faceDetectionResult.faceCount > 1) {
      reason = "multiple_faces";
    } else if (faceDetectionResult.isBlurry) {
      reason = "blurry";
    } else if (faceDetectionResult.confidence < 0.3) {
      reason = "low_quality";
    } else {
      // P0-PROFILE-005: Even confidence >= 0.7 routes to manual review now.
      // Client confidence is untrusted; only an admin / server-side verifier
      // may transition the user to `verified`.
      reason = "manual_review_required";
    }

    // Update user verification status (NEVER set isVerified here)
    const updates: Record<string, unknown> = {
      verificationStatus: newStatus,
    };
    updates.photoVerificationReason = reason;

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
        phase: "phase1",
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
        phase: "phase1",
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
 *
 * P1-PROFILE FIX: Previously unauthenticated. Anonymous callers could
 * enumerate any user's verification status, banned/active flags, and the
 * exact reason string ("banned", "rejected", "pending_auto", etc.).
 * Hardening: require session token; only the owner (or an admin) gets the
 * full breakdown. All other callers get a safe `{canInteract:false,
 * reason:"unauthorized"}` shape, with no information about the target.
 */
export const canUserInteract = query({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionToken(ctx, (args.token ?? "").trim());
    if (!callerId) {
      return { canInteract: false, reason: "unauthorized" };
    }
    if (callerId !== args.userId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) {
        return { canInteract: false, reason: "unauthorized" };
      }
    }

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
 *
 * P1-PROFILE FIX: Previously unauthenticated. Any caller could reset any
 * rejected user back to "unverified", erasing the moderator's rejection
 * decision. Hardening: require session token; only the owner of `userId`
 * (or an admin) may clear the rejection.
 */
export const clearRejectionForReupload = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await validateSessionToken(ctx, (args.token ?? "").trim());
    if (!callerId) {
      throw new Error("Unauthorized: invalid or expired session");
    }
    if (callerId !== args.userId) {
      const caller = await ctx.db.get(callerId);
      if (!caller?.isAdmin) {
        throw new Error("Unauthorized: cannot clear rejection for another user");
      }
    }

    // P2-PROFILE: Per-user rate limit. Clear-rejection unwinds the
    // moderator's decision on a rejected verification — it must remain
    // available for the user's legitimate re-upload flow but not be loopable.
    // 3/hr + 10/day matches the verification retry budget so an attacker
    // can't churn rejected → unverified → rejected to game moderation.
    // Keyed to callerId (admin acting on someone else hits their own bucket).
    const clearLimit = await reserveActionSlots(ctx, callerId, 'verification_clear_rejection', [
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 10 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 3 },
    ]);
    if (!clearLimit.accept) {
      throw new Error('rate_limited');
    }

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
