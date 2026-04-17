import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============================================================================
// DEV-ONLY: Reset utilities for development and testing
//
// SECURITY GATES (both required):
// 1. DEV_RESET_ENABLED env var must be "true"
// 2. DEV_RESET_TOKEN env var must match the provided token
//
// WARNING: These functions permanently delete data. Only use in development.
// ============================================================================

/**
 * Validate that dev reset is enabled and token is correct.
 * Throws "Unauthorized" if either check fails.
 * Exported for other dev-only mutations (e.g. users.devWipeAllUserData) that share the same gates.
 */
export function validateAccess(providedToken: string): void {
  // Gate 1: Check if dev reset is enabled
  const isEnabled = process.env.DEV_RESET_ENABLED;
  if (isEnabled !== "true") {
    throw new Error("Unauthorized: DEV_RESET_ENABLED is not set to 'true'");
  }

  // Gate 2: Validate token
  const expectedToken = process.env.DEV_RESET_TOKEN;
  if (!expectedToken) {
    throw new Error("Unauthorized: DEV_RESET_TOKEN not configured");
  }

  if (providedToken !== expectedToken) {
    throw new Error("Unauthorized: Invalid token");
  }
}

/**
 * Delete test users by email addresses.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DELETES:
 * - User record from `users` table
 * - All sessions associated with that user from `sessions` table
 *
 * USAGE:
 * npx convex run devReset:deleteUsersByEmail '{"token":"YOUR_TOKEN","emails":["test@example.com"]}'
 */
export const deleteUsersByEmail = mutation({
  args: {
    token: v.string(),
    emails: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const { emails } = args;
    const results: Array<{
      email: string;
      found: boolean;
      userId?: string;
      sessionsDeleted?: number;
      error?: string;
    }> = [];

    for (const email of emails) {
      try {
        const normalizedEmail = email.trim().toLowerCase();

        // Try to find user with normalized (lowercase) email first
        let user = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
          .unique();

        // Fallback: try exact original email if normalized didn't match
        if (!user && normalizedEmail !== email.trim()) {
          user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email.trim()))
            .unique();
        }

        if (!user) {
          results.push({
            email,
            found: false,
          });
          continue;
        }

        // Delete all sessions for this user
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        for (const session of sessions) {
          await ctx.db.delete(session._id);
        }

        // Delete the user
        await ctx.db.delete(user._id);

        results.push({
          email,
          found: true,
          userId: user._id,
          sessionsDeleted: sessions.length,
        });
      } catch (error: any) {
        results.push({
          email,
          found: false,
          error: error.message || "Unknown error",
        });
      }
    }

    return {
      success: true,
      message: `Processed ${emails.length} email(s)`,
      results,
    };
  },
});

/**
 * Delete a user by their Convex user ID.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DELETES:
 * - All sessions associated with that user from `sessions` table
 * - User record from `users` table
 *
 * USAGE:
 * npx convex run devReset:deleteUserById '{"token":"YOUR_TOKEN","userId":"abc123..."}'
 */
export const deleteUserById = mutation({
  args: {
    token: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const { userId } = args;

    try {
      // Cast string to Id<"users">
      const userIdTyped = userId as Id<"users">;

      // Check if user exists
      const user = await ctx.db.get(userIdTyped);
      if (!user) {
        return {
          success: false,
          error: "User not found",
          userId,
          sessionsDeleted: 0,
        };
      }

      // Delete all sessions for this user
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", userIdTyped))
        .collect();

      for (const session of sessions) {
        await ctx.db.delete(session._id);
      }

      // Delete the user
      await ctx.db.delete(userIdTyped);

      return {
        success: true,
        userId,
        sessionsDeleted: sessions.length,
      };
    } catch (error: any) {
      return {
        success: false,
        userId,
        sessionsDeleted: 0,
        error: error.message || "Unknown error",
      };
    }
  },
});

/**
 * List all users (DEV only) - useful for debugging.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 */
export const listAllUsers = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const users = await ctx.db.query("users").collect();

    return users.map((u) => ({
      id: u._id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      onboardingCompleted: u.onboardingCompleted,
      _creationTime: u._creationTime,
    }));
  },
});

// ----------------------------------------------------------------------------
// Step 5 backfill: Convex-safe trust-counter recompute (single paginate per fn)
// ----------------------------------------------------------------------------

export const resetDiscoverTrustCountersPage = mutation({
  args: {
    token: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateAccess(args.token);

    const page = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor ?? null, numItems: 250 });

    let usersPatched = 0;
    for (const u of page.page) {
      await ctx.db.patch(u._id as Id<"users">, { reportCount: 0, blockCount: 0 });
      usersPatched++;
    }

    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      usersPatched,
    };
  },
});

export const backfillReportCountsPage = mutation({
  args: {
    token: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateAccess(args.token);

    const page = await ctx.db
      .query("reports")
      .paginate({ cursor: args.cursor ?? null, numItems: 1000 });

    let reportsProcessed = 0;
    let usersPatched = 0;
    for (const r of page.page) {
      reportsProcessed++;
      const targetId = r.reportedUserId as Id<"users">;
      if (!targetId) continue;
      const user = await ctx.db.get(targetId);
      if (!user) continue; // user deleted
      const prev = typeof user.reportCount === "number" ? user.reportCount : 0;
      await ctx.db.patch(targetId, { reportCount: prev + 1 });
      usersPatched++;
    }

    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      reportsProcessed,
      usersPatched,
    };
  },
});

export const backfillBlockCountsPage = mutation({
  args: {
    token: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateAccess(args.token);

    const page = await ctx.db
      .query("blocks")
      .paginate({ cursor: args.cursor ?? null, numItems: 1000 });

    let blocksProcessed = 0;
    let usersPatched = 0;
    for (const b of page.page) {
      blocksProcessed++;
      const targetId = b.blockedUserId as Id<"users">;
      if (!targetId) continue;
      const user = await ctx.db.get(targetId);
      if (!user) continue; // user deleted
      const prev = typeof user.blockCount === "number" ? user.blockCount : 0;
      await ctx.db.patch(targetId, { blockCount: prev + 1 });
      usersPatched++;
    }

    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      blocksProcessed,
      usersPatched,
    };
  },
});

/**
 * One-time backfill: recompute users.reportCount and users.blockCount.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * Convex-safe: orchestrates page mutations (each performs a single paginate).
 * Idempotent when run from start: resets counters to 0, then replays counts from reports/blocks.
 *
 * USAGE (run repeatedly until done === true):
 * npx convex run --prod devReset:backfillDiscoverTrustCounters '{"token":"..."}'
 */
export const backfillDiscoverTrustCounters = action({
  args: {
    token: v.string(),
    phase: v.optional(v.union(v.literal("reset"), v.literal("reports"), v.literal("blocks"))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateAccess(args.token);

    const start = Date.now();
    const MAX_MS = 20_000;

    let phase: "reset" | "reports" | "blocks" = (args.phase as any) ?? "reset";
    let cursor: string | undefined = args.cursor;

    const totals = {
      usersReset: 0,
      reportsProcessed: 0,
      blocksProcessed: 0,
    };

    while (Date.now() - start < MAX_MS) {
      if (phase === "reset") {
        const res: any = await ctx.runMutation("devReset:resetDiscoverTrustCountersPage" as any, {
          token: args.token,
          cursor,
        });
        totals.usersReset += res.usersPatched ?? 0;
        if (res.done) {
          phase = "reports";
          cursor = undefined;
        } else {
          cursor = res.continueCursor;
          continue;
        }
      }

      if (phase === "reports") {
        const res: any = await ctx.runMutation("devReset:backfillReportCountsPage" as any, {
          token: args.token,
          cursor,
        });
        totals.reportsProcessed += res.reportsProcessed ?? 0;
        if (res.done) {
          phase = "blocks";
          cursor = undefined;
        } else {
          cursor = res.continueCursor;
          continue;
        }
      }

      if (phase === "blocks") {
        const res: any = await ctx.runMutation("devReset:backfillBlockCountsPage" as any, {
          token: args.token,
          cursor,
        });
        totals.blocksProcessed += res.blocksProcessed ?? 0;
        if (res.done) {
          return { success: true, done: true, totals };
        }
        cursor = res.continueCursor;
        continue;
      }
    }

    return { success: true, done: false, next: { phase, cursor }, totals };
  },
});

// ============================================================================
// FULL DATABASE WIPE (Dev/Test Only)
// Deletes ALL user-generated data while preserving schema and system config.
// ============================================================================

/**
 * Helper to delete all documents from a table.
 * Returns the count of deleted documents.
 */
async function wipeTable(
  ctx: { db: any },
  tableName: string
): Promise<number> {
  const docs = await ctx.db.query(tableName).collect();
  for (const doc of docs) {
    await ctx.db.delete(doc._id);
  }
  return docs.length;
}

/**
 * FULL USER DATA WIPE - Deletes ALL user-generated data.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 * ADDITIONAL SAFETY: Requires confirm="WIPE_ALL" to execute.
 *
 * WHAT IT DELETES:
 * - All user profiles and auth data
 * - All matches, likes, and social connections
 * - All messages (Phase-1 and Phase-2)
 * - All confessions, T&D, chat rooms
 * - All support tickets and reports
 * - All notifications and nudges
 * - All media metadata (NOT storage files)
 *
 * WHAT IT PRESERVES:
 * - Schema definitions and indexes
 * - systemConfig table (global settings)
 * - Actual storage files (_storage) - run storage cleanup separately if needed
 *
 * USAGE:
 * npx convex run devReset:devWipeAllUserData '{"token":"YOUR_TOKEN","confirm":"WIPE_ALL"}'
 */
export const devWipeAllUserData = mutation({
  args: {
    token: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    // SAFETY GATE
    if (args.confirm !== "WIPE_ALL") {
      throw new Error(
        'Safety check failed: You must pass confirm: "WIPE_ALL" to execute this wipe.'
      );
    }

    console.log("⚠️ DEV WIPE: Starting full user data deletion...");

    const results: Record<string, number> = {};

    // ========================================================================
    // PHASE 1: Deep child tables (reactions, replies, views, etc.)
    // ========================================================================

    // Confession children
    results.confessionReactions = await wipeTable(ctx, "confessionReactions");
    results.confessionReplies = await wipeTable(ctx, "confessionReplies");
    results.confessionReports = await wipeTable(ctx, "confessionReports");
    results.confessionNotifications = await wipeTable(ctx, "confessionNotifications");

    // T&D children
    results.todAnswerReactions = await wipeTable(ctx, "todAnswerReactions");
    results.todAnswerLikes = await wipeTable(ctx, "todAnswerLikes");
    results.todAnswerReports = await wipeTable(ctx, "todAnswerReports");
    results.todAnswerViews = await wipeTable(ctx, "todAnswerViews");
    results.todPromptReactions = await wipeTable(ctx, "todPromptReactions");
    results.todPromptReports = await wipeTable(ctx, "todPromptReports");
    results.todConnectRequests = await wipeTable(ctx, "todConnectRequests");
    results.todPrivateMedia = await wipeTable(ctx, "todPrivateMedia");
    results.todRateLimits = await wipeTable(ctx, "todRateLimits");
    results.todAnswers = await wipeTable(ctx, "todAnswers");

    // Chat room children
    results.chatRoomMessages = await wipeTable(ctx, "chatRoomMessages");
    results.chatRoomMembers = await wipeTable(ctx, "chatRoomMembers");
    results.chatRoomPresence = await wipeTable(ctx, "chatRoomPresence");
    results.chatRoomPenalties = await wipeTable(ctx, "chatRoomPenalties");
    results.chatRoomJoinRequests = await wipeTable(ctx, "chatRoomJoinRequests");
    results.chatRoomBans = await wipeTable(ctx, "chatRoomBans");
    results.chatRoomPasswordAttempts = await wipeTable(ctx, "chatRoomPasswordAttempts");
    results.chatRoomProfiles = await wipeTable(ctx, "chatRoomProfiles");

    // Phase-1 messaging children
    results.messages = await wipeTable(ctx, "messages");
    results.conversationParticipants = await wipeTable(ctx, "conversationParticipants");
    results.typingStatus = await wipeTable(ctx, "typingStatus");
    results.mediaPermissions = await wipeTable(ctx, "mediaPermissions");
    results.securityEvents = await wipeTable(ctx, "securityEvents");

    // Phase-2 messaging children
    results.privateMessages = await wipeTable(ctx, "privateMessages");
    results.privateConversationParticipants = await wipeTable(ctx, "privateConversationParticipants");
    results.privateTypingStatus = await wipeTable(ctx, "privateTypingStatus");
    results.privatePhotoAccessRequests = await wipeTable(ctx, "privatePhotoAccessRequests");

    // Support children
    results.supportMessages = await wipeTable(ctx, "supportMessages");
    results.supportConversationSnapshots = await wipeTable(ctx, "supportConversationSnapshots");
    results.supportTicketMessages = await wipeTable(ctx, "supportTicketMessages");

    // ========================================================================
    // PHASE 2: Mid-level tables (conversations, matches, confessions, etc.)
    // ========================================================================

    // Confessions and T&D prompts
    results.confessions = await wipeTable(ctx, "confessions");
    results.todPrompts = await wipeTable(ctx, "todPrompts");

    // Chat rooms
    results.chatRooms = await wipeTable(ctx, "chatRooms");

    // Conversations
    results.conversations = await wipeTable(ctx, "conversations");
    results.privateConversations = await wipeTable(ctx, "privateConversations");

    // Media
    results.media = await wipeTable(ctx, "media");
    results.mediaReports = await wipeTable(ctx, "mediaReports");

    // Matches and likes
    results.matches = await wipeTable(ctx, "matches");
    results.likes = await wipeTable(ctx, "likes");
    results.privateMatches = await wipeTable(ctx, "privateMatches");
    results.privateLikes = await wipeTable(ctx, "privateLikes");
    results.dares = await wipeTable(ctx, "dares");

    // Crossed paths
    results.crossedPaths = await wipeTable(ctx, "crossedPaths");
    results.crossPathHistory = await wipeTable(ctx, "crossPathHistory");
    results.crossedEvents = await wipeTable(ctx, "crossedEvents");

    // Support tickets
    results.supportRequests = await wipeTable(ctx, "supportRequests");
    results.supportTickets = await wipeTable(ctx, "supportTickets");

    // Reports and blocks
    results.reports = await wipeTable(ctx, "reports");
    results.blocks = await wipeTable(ctx, "blocks");
    results.behaviorFlags = await wipeTable(ctx, "behaviorFlags");
    results.moderationQueue = await wipeTable(ctx, "moderationQueue");
    results.userStrikes = await wipeTable(ctx, "userStrikes");

    // Notifications
    results.notifications = await wipeTable(ctx, "notifications");
    results.nudges = await wipeTable(ctx, "nudges");

    // Private profiles
    results.userPrivateProfiles = await wipeTable(ctx, "userPrivateProfiles");
    results.revealRequests = await wipeTable(ctx, "revealRequests");
    results.privateDeletionStates = await wipeTable(ctx, "privateDeletionStates");
    results.privateUserPresence = await wipeTable(ctx, "privateUserPresence");

    // User preferences and limits
    results.filterPresets = await wipeTable(ctx, "filterPresets");
    results.userRoomPrefs = await wipeTable(ctx, "userRoomPrefs");
    results.userRoomReports = await wipeTable(ctx, "userRoomReports");
    results.userGameLimits = await wipeTable(ctx, "userGameLimits");
    results.surveyResponses = await wipeTable(ctx, "surveyResponses");

    // Games
    results.chatTodGames = await wipeTable(ctx, "chatTodGames");
    results.bottleSpinSessions = await wipeTable(ctx, "bottleSpinSessions");

    // Subscriptions and purchases
    results.subscriptionRecords = await wipeTable(ctx, "subscriptionRecords");
    results.purchases = await wipeTable(ctx, "purchases");

    // Ranking
    results.phase2RankingMetrics = await wipeTable(ctx, "phase2RankingMetrics");
    results.phase2ViewerImpressions = await wipeTable(ctx, "phase2ViewerImpressions");

    // Admin logs (optional - can keep for audit trail)
    results.adminLogs = await wipeTable(ctx, "adminLogs");

    // ========================================================================
    // PHASE 3: Auth and verification tables
    // ========================================================================

    results.sessions = await wipeTable(ctx, "sessions");
    results.otpCodes = await wipeTable(ctx, "otpCodes");
    results.phoneOtps = await wipeTable(ctx, "phoneOtps");
    results.verificationSessions = await wipeTable(ctx, "verificationSessions");
    results.deviceFingerprints = await wipeTable(ctx, "deviceFingerprints");
    results.pendingUploads = await wipeTable(ctx, "pendingUploads");
    results.failedStorageDeletions = await wipeTable(ctx, "failedStorageDeletions");

    // ========================================================================
    // PHASE 4: Photos and users (parent tables - delete last)
    // ========================================================================

    results.photos = await wipeTable(ctx, "photos");
    results.users = await wipeTable(ctx, "users");

    // ========================================================================
    // DONE
    // ========================================================================

    const totalDeleted = Object.values(results).reduce((sum, count) => sum + count, 0);

    console.log(`⚠️ DEV WIPE: All user data deleted. Total documents: ${totalDeleted}`);

    return {
      success: true,
      message: `DEV WIPE COMPLETE: Deleted ${totalDeleted} documents across ${Object.keys(results).length} tables.`,
      deletedCounts: results,
      totalDeleted,
      preservedTables: ["systemConfig", "_storage (files)"],
    };
  },
});
