import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
 */
function validateAccess(providedToken: string): void {
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

// ============================================================================
// PHASE-2 ONBOARDING DEBUG UTILITIES
// ============================================================================

/**
 * List all users with their Phase-2 onboarding status (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * RETURNS for each user:
 * - userId, authId, name, phone, email
 * - phase2OnboardingCompleted flag
 * - privateProfile exists (boolean)
 * - privateProfileId (if exists)
 * - timestamps
 *
 * USAGE:
 * npx convex run devReset:listUsersWithPhase2Status '{"token":"YOUR_TOKEN"}'
 */
export const listUsersWithPhase2Status = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const users = await ctx.db.query("users").collect();

    const results = await Promise.all(
      users.map(async (user) => {
        // Check if privateProfile exists for this user
        const privateProfile = await ctx.db
          .query("userPrivateProfiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first();

        return {
          userId: user._id,
          authUserId: user.authUserId || null,
          name: user.name || null,
          phone: user.phone || null,
          email: user.email || null,
          phase2OnboardingCompleted: user.phase2OnboardingCompleted || false,
          phase2OnboardingCompletedAt: user.phase2OnboardingCompletedAt || null,
          hasPrivateProfile: !!privateProfile,
          privateProfileId: privateProfile?._id || null,
          privateProfileCreatedAt: privateProfile?.createdAt || null,
          privateProfileUpdatedAt: privateProfile?.updatedAt || null,
          userCreatedAt: user._creationTime,
        };
      })
    );

    // Sort: users with Phase-2 completed first, then by creation time desc
    results.sort((a, b) => {
      if (a.phase2OnboardingCompleted !== b.phase2OnboardingCompleted) {
        return a.phase2OnboardingCompleted ? -1 : 1;
      }
      return (b.userCreatedAt || 0) - (a.userCreatedAt || 0);
    });

    return {
      total: results.length,
      phase2Completed: results.filter((r) => r.phase2OnboardingCompleted).length,
      withPrivateProfile: results.filter((r) => r.hasPrivateProfile).length,
      users: results,
    };
  },
});

/**
 * Reset Phase-2 onboarding for a specific user (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DOES:
 * - Sets users.phase2OnboardingCompleted = false
 * - Sets users.phase2OnboardingCompletedAt = null
 * - Deletes the userPrivateProfiles record if it exists
 *
 * WARNING: This allows the user to go through Phase-2 onboarding again.
 *
 * USAGE:
 * npx convex run devReset:resetPhase2ForUser '{"token":"YOUR_TOKEN","userId":"abc123..."}'
 */
export const resetPhase2ForUser = mutation({
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
        };
      }

      // 1. Reset Phase-2 flags on user record
      await ctx.db.patch(userIdTyped, {
        phase2OnboardingCompleted: false,
        phase2OnboardingCompletedAt: undefined,
      });

      // 2. Delete privateProfile if exists
      const privateProfile = await ctx.db
        .query("userPrivateProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userIdTyped))
        .first();

      let privateProfileDeleted = false;
      if (privateProfile) {
        // Delete any blurred photos from storage first
        if (privateProfile.privatePhotosBlurred) {
          for (const storageId of privateProfile.privatePhotosBlurred) {
            try {
              await ctx.storage.delete(storageId);
            } catch {
              // Storage item may already be deleted
            }
          }
        }
        await ctx.db.delete(privateProfile._id);
        privateProfileDeleted = true;
      }

      return {
        success: true,
        userId,
        userName: user.name || "Unknown",
        phase2FlagReset: true,
        privateProfileDeleted,
        privateProfileId: privateProfile?._id || null,
      };
    } catch (error: any) {
      return {
        success: false,
        userId,
        error: error.message || "Unknown error",
      };
    }
  },
});

// ============================================================================
// PHASE-2 RELATIONAL DATA RESET - Clear only Phase-2 relationships
// ============================================================================

// Phase-2 relational tables (NOT profile tables)
const PHASE2_RELATIONAL_TABLES = [
  "privateLikes",
  "privateMatches",
  "privateConversations",
  "privateConversationParticipants",
  "privateMessages",
  "todConnectRequests",
  "todPrivateMedia",
] as const;

/**
 * Reset Phase-2 relational data ONLY (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DELETES:
 * - privateLikes (swipes)
 * - privateMatches
 * - privateConversations
 * - privateConversationParticipants
 * - privateMessages
 * - todConnectRequests
 * - todPrivateMedia
 * - Phase-2 notifications (tod_connect type)
 *
 * WHAT IT KEEPS:
 * - users table
 * - userPrivateProfiles (Phase-2 profile data)
 * - phase2RankingMetrics
 * - phase2ViewerImpressions
 * - All Phase-1 data
 * - All other tables
 *
 * OPTIONS:
 * - userIds: Optional array of user IDs to scope reset to specific users
 * - If not provided, clears ALL Phase-2 relational data
 *
 * USAGE:
 * npx convex run devReset:resetPhase2RelationalData '{"token":"YOUR_TOKEN"}'
 * npx convex run devReset:resetPhase2RelationalData '{"token":"YOUR_TOKEN","userIds":["user1","user2"]}'
 */
export const resetPhase2RelationalData = mutation({
  args: {
    token: v.string(),
    userIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const userIdSet = args.userIds ? new Set(args.userIds) : null;
    const results: Record<string, number> = {};
    let totalDeleted = 0;

    // Helper to check if record involves target users
    const involvesTargetUser = (record: any): boolean => {
      if (!userIdSet) return true; // No filter = delete all
      // Check common user ID fields
      if (record.fromUserId && userIdSet.has(record.fromUserId)) return true;
      if (record.toUserId && userIdSet.has(record.toUserId)) return true;
      if (record.userId && userIdSet.has(record.userId)) return true;
      if (record.senderId && userIdSet.has(record.senderId)) return true;
      if (record.user1Id && userIdSet.has(record.user1Id)) return true;
      if (record.user2Id && userIdSet.has(record.user2Id)) return true;
      if (record.participants) {
        for (const p of record.participants) {
          if (userIdSet.has(p)) return true;
        }
      }
      return false;
    };

    // 1. Clear privateLikes
    const privateLikes = await ctx.db.query("privateLikes").collect();
    let likesDeleted = 0;
    for (const like of privateLikes) {
      if (involvesTargetUser(like)) {
        await ctx.db.delete(like._id);
        likesDeleted++;
      }
    }
    results["privateLikes"] = likesDeleted;
    totalDeleted += likesDeleted;
    console.log(`[P2_RESET] deleted privateLikes=${likesDeleted}`);

    // 2. Clear privateMatches
    const privateMatches = await ctx.db.query("privateMatches").collect();
    let matchesDeleted = 0;
    for (const match of privateMatches) {
      if (involvesTargetUser(match)) {
        await ctx.db.delete(match._id);
        matchesDeleted++;
      }
    }
    results["privateMatches"] = matchesDeleted;
    totalDeleted += matchesDeleted;
    console.log(`[P2_RESET] deleted privateMatches=${matchesDeleted}`);

    // 3. Collect conversation IDs to delete (for cascading)
    const privateConversations = await ctx.db.query("privateConversations").collect();
    const conversationIdsToDelete: Set<string> = new Set();
    let conversationsDeleted = 0;
    for (const convo of privateConversations) {
      if (involvesTargetUser(convo)) {
        conversationIdsToDelete.add(convo._id);
        await ctx.db.delete(convo._id);
        conversationsDeleted++;
      }
    }
    results["privateConversations"] = conversationsDeleted;
    totalDeleted += conversationsDeleted;
    console.log(`[P2_RESET] deleted privateConversations=${conversationsDeleted}`);

    // 4. Clear privateConversationParticipants (cascade)
    const participants = await ctx.db.query("privateConversationParticipants").collect();
    let participantsDeleted = 0;
    for (const p of participants) {
      // Delete if conversation is being deleted OR if user is target
      if (conversationIdsToDelete.has(p.conversationId) || (userIdSet && userIdSet.has(p.userId))) {
        await ctx.db.delete(p._id);
        participantsDeleted++;
      }
    }
    results["privateConversationParticipants"] = participantsDeleted;
    totalDeleted += participantsDeleted;
    console.log(`[P2_RESET] deleted privateConversationParticipants=${participantsDeleted}`);

    // 5. Clear privateMessages (cascade)
    const privateMessages = await ctx.db.query("privateMessages").collect();
    let messagesDeleted = 0;
    for (const msg of privateMessages) {
      if (conversationIdsToDelete.has(msg.conversationId) || involvesTargetUser(msg)) {
        await ctx.db.delete(msg._id);
        messagesDeleted++;
      }
    }
    results["privateMessages"] = messagesDeleted;
    totalDeleted += messagesDeleted;
    console.log(`[P2_RESET] deleted privateMessages=${messagesDeleted}`);

    // 6. Clear todConnectRequests
    const todRequests = await ctx.db.query("todConnectRequests").collect();
    let todRequestsDeleted = 0;
    for (const req of todRequests) {
      if (involvesTargetUser(req)) {
        await ctx.db.delete(req._id);
        todRequestsDeleted++;
      }
    }
    results["todConnectRequests"] = todRequestsDeleted;
    totalDeleted += todRequestsDeleted;
    console.log(`[P2_RESET] deleted todConnectRequests=${todRequestsDeleted}`);

    // 7. Clear todPrivateMedia
    const todMedia = await ctx.db.query("todPrivateMedia").collect();
    let todMediaDeleted = 0;
    for (const media of todMedia) {
      if (involvesTargetUser(media)) {
        // Delete storage if present
        if (media.storageId) {
          try {
            await ctx.storage.delete(media.storageId);
          } catch {
            // Storage may already be deleted
          }
        }
        await ctx.db.delete(media._id);
        todMediaDeleted++;
      }
    }
    results["todPrivateMedia"] = todMediaDeleted;
    totalDeleted += todMediaDeleted;
    console.log(`[P2_RESET] deleted todPrivateMedia=${todMediaDeleted}`);

    // 8. Clear Phase-2 notifications (tod_connect type)
    const notifications = await ctx.db.query("notifications").collect();
    let notificationsDeleted = 0;
    const deletedNotifIds = new Set<string>();
    for (const notif of notifications) {
      // Skip if already deleted
      if (deletedNotifIds.has(notif._id)) continue;

      let shouldDelete = false;
      // Delete tod_connect notifications for target users
      if (notif.type === "tod_connect" && involvesTargetUser(notif)) {
        shouldDelete = true;
      }
      // Also delete notifications referencing deleted conversations
      if (notif.data?.conversationId && conversationIdsToDelete.has(notif.data.conversationId)) {
        shouldDelete = true;
      }

      if (shouldDelete) {
        try {
          await ctx.db.delete(notif._id);
          deletedNotifIds.add(notif._id);
          notificationsDeleted++;
        } catch {
          // Already deleted
        }
      }
    }
    results["notifications"] = notificationsDeleted;
    totalDeleted += notificationsDeleted;
    console.log(`[P2_RESET] deleted notifications=${notificationsDeleted}`);

    return {
      success: true,
      scope: args.userIds ? `users: ${args.userIds.join(", ")}` : "ALL Phase-2 relational data",
      totalDeleted,
      details: results,
    };
  },
});

/**
 * Find and report duplicate Phase-2 conversations for the same user pair (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * USAGE:
 * npx convex run devReset:findDuplicatePhase2Conversations '{"token":"YOUR_TOKEN"}'
 */
export const findDuplicatePhase2Conversations = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const conversations = await ctx.db.query("privateConversations").collect();
    const pairMap = new Map<string, typeof conversations>();

    for (const convo of conversations) {
      // Create canonical pair key (sorted user IDs)
      const sortedParticipants = [...convo.participants].sort();
      const pairKey = sortedParticipants.join(":");

      if (!pairMap.has(pairKey)) {
        pairMap.set(pairKey, []);
      }
      pairMap.get(pairKey)!.push(convo);
    }

    // Find pairs with multiple conversations
    const duplicates: Array<{
      pairKey: string;
      count: number;
      conversations: Array<{
        id: string;
        connectionSource: string | undefined;
        createdAt: number;
        lastMessageAt: number | undefined;
        matchId: string | undefined;
      }>;
    }> = [];

    for (const [pairKey, convos] of pairMap.entries()) {
      if (convos.length > 1) {
        duplicates.push({
          pairKey,
          count: convos.length,
          conversations: convos.map((c) => ({
            id: c._id,
            connectionSource: c.connectionSource,
            createdAt: c.createdAt,
            lastMessageAt: c.lastMessageAt,
            matchId: c.matchId as string | undefined,
          })),
        });
      }
    }

    return {
      totalConversations: conversations.length,
      uniquePairs: pairMap.size,
      duplicatePairs: duplicates.length,
      duplicates,
    };
  },
});

/**
 * Clean up duplicate Phase-2 conversations, keeping only the best one per pair (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DOES:
 * - For each user pair with multiple conversations
 * - Keeps the conversation with most recent lastMessageAt (or newest createdAt)
 * - Deletes extra conversations and their messages/participants
 *
 * USAGE:
 * npx convex run devReset:cleanupDuplicatePhase2Conversations '{"token":"YOUR_TOKEN"}'
 */
export const cleanupDuplicatePhase2Conversations = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const conversations = await ctx.db.query("privateConversations").collect();
    const pairMap = new Map<string, typeof conversations>();

    for (const convo of conversations) {
      const sortedParticipants = [...convo.participants].sort();
      const pairKey = sortedParticipants.join(":");

      if (!pairMap.has(pairKey)) {
        pairMap.set(pairKey, []);
      }
      pairMap.get(pairKey)!.push(convo);
    }

    let conversationsDeleted = 0;
    let messagesDeleted = 0;
    let participantsDeleted = 0;
    const cleanedPairs: string[] = [];

    for (const [pairKey, convos] of pairMap.entries()) {
      if (convos.length <= 1) continue;

      // Sort: prefer lastMessageAt, then createdAt (keep most recent)
      convos.sort((a, b) => {
        const aTime = a.lastMessageAt || a.createdAt;
        const bTime = b.lastMessageAt || b.createdAt;
        return bTime - aTime; // Descending (most recent first)
      });

      // Keep the first (most recent), delete the rest
      const toKeep = convos[0];
      const toDelete = convos.slice(1);

      for (const convo of toDelete) {
        // Delete messages
        const messages = await ctx.db
          .query("privateMessages")
          .withIndex("by_conversation", (q) => q.eq("conversationId", convo._id))
          .collect();
        for (const msg of messages) {
          await ctx.db.delete(msg._id);
          messagesDeleted++;
        }

        // Delete participants
        const participants = await ctx.db
          .query("privateConversationParticipants")
          .withIndex("by_conversation", (q) => q.eq("conversationId", convo._id))
          .collect();
        for (const p of participants) {
          await ctx.db.delete(p._id);
          participantsDeleted++;
        }

        // Delete conversation
        await ctx.db.delete(convo._id);
        conversationsDeleted++;
      }

      cleanedPairs.push(pairKey);
      console.log(`[P2_RESET] Cleaned duplicate pair ${pairKey}: kept ${toKeep._id}, deleted ${toDelete.length}`);
    }

    return {
      success: true,
      pairsCleaned: cleanedPairs.length,
      conversationsDeleted,
      messagesDeleted,
      participantsDeleted,
      cleanedPairs,
    };
  },
});

// ============================================================================
// FULL DATABASE RESET - Clear ALL user activity data
// ============================================================================

// All tables containing user activity data to be cleared
const TABLES_TO_CLEAR = [
  // Phase-1 Core
  "likes",
  "matches",
  "conversations",
  "conversationParticipants",
  "messages",

  // Media & Permissions
  "photos",
  "media",
  "mediaPermissions",
  "securityEvents",
  "mediaReports",

  // Notifications & Location
  "notifications",
  "crossedPaths",
  "crossPathHistory",
  "crossedEvents",

  // Social Features
  "dares",
  "reports",
  "blocks",

  // Support System
  "supportRequests",
  "supportMessages",
  "supportConversationSnapshots",
  "supportTickets",
  "supportTicketMessages",

  // Auth & Sessions
  "otpCodes",
  "phoneOtps",
  "sessions",
  "typingStatus",

  // User Behavior
  "nudges",
  "surveyResponses",
  "verificationSessions",
  "deviceFingerprints",
  "behaviorFlags",

  // Moderation
  "moderationQueue",
  "userStrikes",
  "adminLogs",

  // Phase-2 Profiles
  "userPrivateProfiles",
  "privateDeletionStates",

  // Truth or Dare
  "todPrompts",
  "todAnswers",
  "todAnswerViews",
  "todAnswerLikes",
  "todAnswerReactions",
  "todAnswerReports",
  "todRateLimits",
  "todConnectRequests",
  "todPrivateMedia",

  // Confessions
  "confessions",
  "confessionConnectSignals",
  "confessionReports",
  "confessionReplies",
  "replyReports",
  "confessionReactions",
  "confessionNotifications",
  "confessionCommentConnects",

  // Chat Rooms
  "chatRooms",
  "chatRoomMembers",
  "chatRoomMessages",
  "chatRoomPenalties",
  "chatRoomJoinRequests",
  "chatRoomBans",
  "chatTodGames",

  // User Preferences
  "filterPresets",
  "userRoomPrefs",
  "userRoomReports",
  "userGameLimits",

  // Games
  "bottleSpinSessions",

  // Storage Cleanup
  "pendingUploads",
  "failedStorageDeletions",

  // Phase-2 Ranking
  "phase2RankingMetrics",
  "phase2ViewerImpressions",

  // Phase-2 Private Interactions
  "privateLikes",
  "privateMatches",
  "privateConversations",
  "privateConversationParticipants",
  "privateMessages",
] as const;

/**
 * Clear ALL user activity data from the database (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DELETES:
 * - ALL records from 70+ activity tables
 * - Photos, media, messages, matches, likes, etc.
 *
 * WHAT IT KEEPS:
 * - users table (unless includeUsers=true)
 * - systemConfig table
 * - subscriptionRecords/purchases (unless includePurchases=true)
 * - Schema and indexes remain intact
 *
 * USAGE:
 * npx convex run devReset:clearAllUserData '{"token":"YOUR_TOKEN"}'
 * npx convex run devReset:clearAllUserData '{"token":"YOUR_TOKEN","includeUsers":true}'
 */
export const clearAllUserData = mutation({
  args: {
    token: v.string(),
    includeUsers: v.optional(v.boolean()),
    includePurchases: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const results: Record<string, number> = {};
    let totalDeleted = 0;

    // Clear each table
    for (const tableName of TABLES_TO_CLEAR) {
      try {
        const docs = await ctx.db.query(tableName as any).collect();
        const count = docs.length;

        for (const doc of docs) {
          await ctx.db.delete(doc._id);
        }

        results[tableName] = count;
        totalDeleted += count;
      } catch (error) {
        // Table might not exist or be empty - continue
        results[tableName] = 0;
      }
    }

    // Optionally clear purchases
    if (args.includePurchases) {
      for (const table of ["subscriptionRecords", "purchases"]) {
        try {
          const docs = await ctx.db.query(table as any).collect();
          const count = docs.length;
          for (const doc of docs) {
            await ctx.db.delete(doc._id);
          }
          results[table] = count;
          totalDeleted += count;
        } catch {
          results[table] = 0;
        }
      }
    }

    // Optionally clear users table
    if (args.includeUsers) {
      try {
        const users = await ctx.db.query("users").collect();
        const count = users.length;

        for (const user of users) {
          await ctx.db.delete(user._id);
        }

        results["users"] = count;
        totalDeleted += count;
      } catch (error) {
        results["users"] = 0;
      }
    }

    // Count non-zero tables
    const tablesWithData = Object.entries(results).filter(([_, count]) => count > 0);

    return {
      success: true,
      tablesCleared: tablesWithData.length,
      totalRecordsDeleted: totalDeleted,
      usersDeleted: args.includeUsers ? (results["users"] || 0) : "skipped",
      details: Object.fromEntries(tablesWithData),
    };
  },
});
