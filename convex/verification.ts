import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
