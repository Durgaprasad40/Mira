import { mutation, internalMutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ============================================
// CLEANUP UTILITIES FOR CONVEX DATABASE
// ============================================

// Query to get database statistics
export const getDatabaseStats = query({
  args: {},
  handler: async (ctx) => {
    const [
      users,
      photos,
      likes,
      matches,
      conversations,
      messages,
      notifications,
      crossedPaths,
      dares,
      subscriptionRecords,
      purchases,
      reports,
      blocks,
      otpCodes,
      sessions,
      filterPresets,
    ] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("photos").collect(),
      ctx.db.query("likes").collect(),
      ctx.db.query("matches").collect(),
      ctx.db.query("conversations").collect(),
      ctx.db.query("messages").collect(),
      ctx.db.query("notifications").collect(),
      ctx.db.query("crossedPaths").collect(),
      ctx.db.query("dares").collect(),
      ctx.db.query("subscriptionRecords").collect(),
      ctx.db.query("purchases").collect(),
      ctx.db.query("reports").collect(),
      ctx.db.query("blocks").collect(),
      ctx.db.query("otpCodes").collect(),
      ctx.db.query("sessions").collect(),
      ctx.db.query("filterPresets").collect(),
    ]);

    return {
      users: users.length,
      photos: photos.length,
      likes: likes.length,
      matches: matches.length,
      conversations: conversations.length,
      messages: messages.length,
      notifications: notifications.length,
      crossedPaths: crossedPaths.length,
      dares: dares.length,
      subscriptionRecords: subscriptionRecords.length,
      purchases: purchases.length,
      reports: reports.length,
      blocks: blocks.length,
      otpCodes: otpCodes.length,
      sessions: sessions.length,
      filterPresets: filterPresets.length,
      total:
        users.length +
        photos.length +
        likes.length +
        matches.length +
        conversations.length +
        messages.length +
        notifications.length +
        crossedPaths.length +
        dares.length +
        subscriptionRecords.length +
        purchases.length +
        reports.length +
        blocks.length +
        otpCodes.length +
        sessions.length +
        filterPresets.length,
    };
  },
});

// ============================================
// CLEANUP EXPIRED DATA
// ============================================

// Clean up expired OTP codes
export const cleanupExpiredOtpCodes = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredOtps = await ctx.db
      .query("otpCodes")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    let deletedCount = 0;
    for (const otp of expiredOtps) {
      await ctx.db.delete(otp._id);
      deletedCount++;
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} expired OTP codes`,
    };
  },
});

// Clean up expired sessions
export const cleanupExpiredSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredSessions = await ctx.db
      .query("sessions")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    let deletedCount = 0;
    for (const session of expiredSessions) {
      await ctx.db.delete(session._id);
      deletedCount++;
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} expired sessions`,
    };
  },
});

// Clean up old read notifications (older than 30 days)
export const cleanupOldNotifications = mutation({
  args: {
    daysOld: v.optional(v.number()), // Default 30 days
  },
  handler: async (ctx, args) => {
    const daysOld = args.daysOld ?? 30;
    const cutoffDate = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    const oldNotifications = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.neq(q.field("readAt"), undefined),
          q.lt(q.field("createdAt"), cutoffDate),
        ),
      )
      .collect();

    let deletedCount = 0;
    for (const notification of oldNotifications) {
      await ctx.db.delete(notification._id);
      deletedCount++;
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} old read notifications`,
    };
  },
});

// Clean up expired crossed paths unlocks
export const cleanupExpiredCrossedPathsUnlocks = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredUnlocks = await ctx.db
      .query("crossedPaths")
      .filter((q) =>
        q.and(
          q.neq(q.field("unlockExpiresAt"), undefined),
          q.lt(q.field("unlockExpiresAt"), now),
        ),
      )
      .collect();

    let updatedCount = 0;
    for (const crossedPath of expiredUnlocks) {
      await ctx.db.patch(crossedPath._id, { unlockExpiresAt: undefined });
      updatedCount++;
    }

    return {
      updatedCount,
      message: `Reset ${updatedCount} expired crossed paths unlocks`,
    };
  },
});

// ============================================
// CLEANUP ORPHANED DATA
// ============================================

// Clean up orphaned photos (photos without valid user)
export const cleanupOrphanedPhotos = mutation({
  args: {},
  handler: async (ctx) => {
    const photos = await ctx.db.query("photos").collect();
    let deletedCount = 0;

    for (const photo of photos) {
      const user = await ctx.db.get(photo.userId);
      if (!user) {
        // Delete the storage file if possible
        try {
          await ctx.storage.delete(photo.storageId);
        } catch (e) {
          // Storage might already be deleted
        }
        await ctx.db.delete(photo._id);
        deletedCount++;
      }
    }

    return { deletedCount, message: `Deleted ${deletedCount} orphaned photos` };
  },
});

// Clean up orphaned likes (likes with deleted users)
export const cleanupOrphanedLikes = mutation({
  args: {},
  handler: async (ctx) => {
    const likes = await ctx.db.query("likes").collect();
    let deletedCount = 0;

    for (const like of likes) {
      const fromUser = await ctx.db.get(like.fromUserId);
      const toUser = await ctx.db.get(like.toUserId);

      if (!fromUser || !toUser) {
        await ctx.db.delete(like._id);
        deletedCount++;
      }
    }

    return { deletedCount, message: `Deleted ${deletedCount} orphaned likes` };
  },
});

// Clean up orphaned matches (matches with deleted users)
export const cleanupOrphanedMatches = mutation({
  args: {},
  handler: async (ctx) => {
    const matches = await ctx.db.query("matches").collect();
    let deletedCount = 0;

    for (const match of matches) {
      const user1 = await ctx.db.get(match.user1Id);
      const user2 = await ctx.db.get(match.user2Id);

      if (!user1 || !user2) {
        await ctx.db.delete(match._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned matches`,
    };
  },
});

// Clean up orphaned conversations
export const cleanupOrphanedConversations = mutation({
  args: {},
  handler: async (ctx) => {
    const conversations = await ctx.db.query("conversations").collect();
    let deletedCount = 0;

    for (const conversation of conversations) {
      // Check if all participants exist
      let hasOrphanedParticipant = false;
      for (const participantId of conversation.participants) {
        const user = await ctx.db.get(participantId);
        if (!user) {
          hasOrphanedParticipant = true;
          break;
        }
      }

      // Check if match exists (if linked)
      if (conversation.matchId) {
        const match = await ctx.db.get(conversation.matchId);
        if (!match) {
          hasOrphanedParticipant = true;
        }
      }

      if (hasOrphanedParticipant) {
        // Delete all messages in the conversation first
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conversation._id),
          )
          .collect();

        for (const message of messages) {
          if (message.imageStorageId) {
            try {
              await ctx.storage.delete(message.imageStorageId);
            } catch (e) {
              // Storage might already be deleted
            }
          }
          await ctx.db.delete(message._id);
        }

        await ctx.db.delete(conversation._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned conversations with their messages`,
    };
  },
});

// Clean up orphaned messages (messages without valid conversation)
export const cleanupOrphanedMessages = mutation({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db.query("messages").collect();
    let deletedCount = 0;

    for (const message of messages) {
      const conversation = await ctx.db.get(message.conversationId);
      if (!conversation) {
        if (message.imageStorageId) {
          try {
            await ctx.storage.delete(message.imageStorageId);
          } catch (e) {
            // Storage might already be deleted
          }
        }
        await ctx.db.delete(message._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned messages`,
    };
  },
});

// Clean up orphaned notifications
export const cleanupOrphanedNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    const notifications = await ctx.db.query("notifications").collect();
    let deletedCount = 0;

    for (const notification of notifications) {
      const user = await ctx.db.get(notification.userId);
      if (!user) {
        await ctx.db.delete(notification._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned notifications`,
    };
  },
});

// Clean up orphaned dares
export const cleanupOrphanedDares = mutation({
  args: {},
  handler: async (ctx) => {
    const dares = await ctx.db.query("dares").collect();
    let deletedCount = 0;

    for (const dare of dares) {
      const fromUser = await ctx.db.get(dare.fromUserId);
      const toUser = await ctx.db.get(dare.toUserId);

      if (!fromUser || !toUser) {
        await ctx.db.delete(dare._id);
        deletedCount++;
      }
    }

    return { deletedCount, message: `Deleted ${deletedCount} orphaned dares` };
  },
});

// Clean up orphaned crossed paths
export const cleanupOrphanedCrossedPaths = mutation({
  args: {},
  handler: async (ctx) => {
    const crossedPaths = await ctx.db.query("crossedPaths").collect();
    let deletedCount = 0;

    for (const crossedPath of crossedPaths) {
      const user1 = await ctx.db.get(crossedPath.user1Id);
      const user2 = await ctx.db.get(crossedPath.user2Id);

      if (!user1 || !user2) {
        await ctx.db.delete(crossedPath._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned crossed paths`,
    };
  },
});

// Clean up orphaned blocks
export const cleanupOrphanedBlocks = mutation({
  args: {},
  handler: async (ctx) => {
    const blocks = await ctx.db.query("blocks").collect();
    let deletedCount = 0;

    for (const block of blocks) {
      const blocker = await ctx.db.get(block.blockerId);
      const blocked = await ctx.db.get(block.blockedUserId);

      if (!blocker || !blocked) {
        await ctx.db.delete(block._id);
        deletedCount++;
      }
    }

    return { deletedCount, message: `Deleted ${deletedCount} orphaned blocks` };
  },
});

// Clean up orphaned reports
export const cleanupOrphanedReports = mutation({
  args: {},
  handler: async (ctx) => {
    const reports = await ctx.db.query("reports").collect();
    let deletedCount = 0;

    for (const report of reports) {
      const reporter = await ctx.db.get(report.reporterId);
      const reported = await ctx.db.get(report.reportedUserId);

      if (!reporter || !reported) {
        await ctx.db.delete(report._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned reports`,
    };
  },
});

// Clean up orphaned filter presets
export const cleanupOrphanedFilterPresets = mutation({
  args: {},
  handler: async (ctx) => {
    const presets = await ctx.db.query("filterPresets").collect();
    let deletedCount = 0;

    for (const preset of presets) {
      const user = await ctx.db.get(preset.userId);
      if (!user) {
        await ctx.db.delete(preset._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned filter presets`,
    };
  },
});

// Clean up orphaned subscription records
export const cleanupOrphanedSubscriptionRecords = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("subscriptionRecords").collect();
    let deletedCount = 0;

    for (const record of records) {
      const user = await ctx.db.get(record.userId);
      if (!user) {
        await ctx.db.delete(record._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned subscription records`,
    };
  },
});

// Clean up orphaned purchases
export const cleanupOrphanedPurchases = mutation({
  args: {},
  handler: async (ctx) => {
    const purchases = await ctx.db.query("purchases").collect();
    let deletedCount = 0;

    for (const purchase of purchases) {
      const user = await ctx.db.get(purchase.userId);
      if (!user) {
        await ctx.db.delete(purchase._id);
        deletedCount++;
      }
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} orphaned purchases`,
    };
  },
});

// ============================================
// FULL CLEANUP OPERATIONS
// ============================================

// Run all expired data cleanup
export const cleanupAllExpiredData = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    let results = {
      expiredOtpCodes: 0,
      expiredSessions: 0,
      oldNotifications: 0,
      expiredCrossedPathsUnlocks: 0,
    };

    // Clean expired OTP codes
    const expiredOtps = await ctx.db
      .query("otpCodes")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
    for (const otp of expiredOtps) {
      await ctx.db.delete(otp._id);
      results.expiredOtpCodes++;
    }

    // Clean expired sessions
    const expiredSessions = await ctx.db
      .query("sessions")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
    for (const session of expiredSessions) {
      await ctx.db.delete(session._id);
      results.expiredSessions++;
    }

    // Clean old read notifications
    const oldNotifications = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.neq(q.field("readAt"), undefined),
          q.lt(q.field("createdAt"), thirtyDaysAgo),
        ),
      )
      .collect();
    for (const notification of oldNotifications) {
      await ctx.db.delete(notification._id);
      results.oldNotifications++;
    }

    // Reset expired crossed paths unlocks
    const expiredUnlocks = await ctx.db
      .query("crossedPaths")
      .filter((q) =>
        q.and(
          q.neq(q.field("unlockExpiresAt"), undefined),
          q.lt(q.field("unlockExpiresAt"), now),
        ),
      )
      .collect();
    for (const crossedPath of expiredUnlocks) {
      await ctx.db.patch(crossedPath._id, { unlockExpiresAt: undefined });
      results.expiredCrossedPathsUnlocks++;
    }

    return {
      ...results,
      totalCleaned:
        results.expiredOtpCodes +
        results.expiredSessions +
        results.oldNotifications +
        results.expiredCrossedPathsUnlocks,
    };
  },
});

// ============================================
// DANGEROUS: FULL DATABASE WIPE (USE WITH CAUTION!)
// ============================================

// Delete all data from a specific table
export const clearTable = mutation({
  args: {
    tableName: v.union(
      v.literal("users"),
      v.literal("photos"),
      v.literal("likes"),
      v.literal("matches"),
      v.literal("conversations"),
      v.literal("messages"),
      v.literal("notifications"),
      v.literal("crossedPaths"),
      v.literal("dares"),
      v.literal("subscriptionRecords"),
      v.literal("purchases"),
      v.literal("reports"),
      v.literal("blocks"),
      v.literal("otpCodes"),
      v.literal("sessions"),
      v.literal("filterPresets"),
    ),
    confirmDelete: v.literal("I_CONFIRM_DELETE_ALL_DATA"),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db.query(args.tableName).collect();
    let deletedCount = 0;

    for (const record of records) {
      // Handle storage cleanup for photos and messages
      if (args.tableName === "photos" && "storageId" in record) {
        try {
          await ctx.storage.delete(record.storageId as any);
        } catch (e) {
          // Storage might already be deleted
        }
      }
      if (
        args.tableName === "messages" &&
        "imageStorageId" in record &&
        record.imageStorageId
      ) {
        try {
          await ctx.storage.delete(record.imageStorageId as any);
        } catch (e) {
          // Storage might already be deleted
        }
      }
      if (
        args.tableName === "users" &&
        "verificationPhotoId" in record &&
        record.verificationPhotoId
      ) {
        try {
          await ctx.storage.delete(record.verificationPhotoId as any);
        } catch (e) {
          // Storage might already be deleted
        }
      }

      await ctx.db.delete(record._id);
      deletedCount++;
    }

    return {
      deletedCount,
      message: `⚠️ DELETED ${deletedCount} records from ${args.tableName}`,
    };
  },
});

// DANGEROUS: Delete ALL data from ALL tables
export const clearAllTables = mutation({
  args: {
    confirmDelete: v.literal("I_CONFIRM_DELETE_ENTIRE_DATABASE"),
  },
  handler: async (ctx) => {
    const tables = [
      "messages",
      "conversations",
      "likes",
      "matches",
      "photos",
      "notifications",
      "crossedPaths",
      "dares",
      "subscriptionRecords",
      "purchases",
      "reports",
      "blocks",
      "otpCodes",
      "sessions",
      "filterPresets",
      "users", // Delete users last due to foreign key references
    ] as const;

    const results: Record<string, number> = {};

    for (const tableName of tables) {
      const records = await ctx.db.query(tableName).collect();
      results[tableName] = 0;

      for (const record of records) {
        // Handle storage cleanup
        if (tableName === "photos" && "storageId" in record) {
          try {
            await ctx.storage.delete(record.storageId as any);
          } catch (e) {}
        }
        if (
          tableName === "messages" &&
          "imageStorageId" in record &&
          record.imageStorageId
        ) {
          try {
            await ctx.storage.delete(record.imageStorageId as any);
          } catch (e) {}
        }
        if (
          tableName === "users" &&
          "verificationPhotoId" in record &&
          record.verificationPhotoId
        ) {
          try {
            await ctx.storage.delete(record.verificationPhotoId as any);
          } catch (e) {}
        }

        await ctx.db.delete(record._id);
        results[tableName]++;
      }
    }

    const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);

    return {
      results,
      totalDeleted,
      message: `⚠️ DELETED ${totalDeleted} records from all tables`,
    };
  },
});

// ============================================
// DELETE USER AND ALL RELATED DATA
// ============================================

// Completely delete a user and all their data
export const deleteUserCompletely = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const deletedData: Record<string, number> = {};

    // Delete photos
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    deletedData.photos = 0;
    for (const photo of photos) {
      try {
        await ctx.storage.delete(photo.storageId);
      } catch (e) {}
      await ctx.db.delete(photo._id);
      deletedData.photos++;
    }

    // Delete verification photo
    if (user.verificationPhotoId) {
      try {
        await ctx.storage.delete(user.verificationPhotoId);
      } catch (e) {}
    }

    // Delete likes (sent and received)
    const sentLikes = await ctx.db
      .query("likes")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
      .collect();
    const receivedLikes = await ctx.db
      .query("likes")
      .withIndex("by_to_user", (q) => q.eq("toUserId", args.userId))
      .collect();
    deletedData.likes = 0;
    for (const like of [...sentLikes, ...receivedLikes]) {
      await ctx.db.delete(like._id);
      deletedData.likes++;
    }

    // Delete matches
    const matches1 = await ctx.db
      .query("matches")
      .withIndex("by_user1", (q) => q.eq("user1Id", args.userId))
      .collect();
    const matches2 = await ctx.db
      .query("matches")
      .withIndex("by_user2", (q) => q.eq("user2Id", args.userId))
      .collect();
    const allMatches = [...matches1, ...matches2];
    deletedData.matches = 0;

    // Delete conversations and messages for matches
    deletedData.conversations = 0;
    deletedData.messages = 0;
    for (const match of allMatches) {
      if (match._id) {
        const conversations = await ctx.db
          .query("conversations")
          .withIndex("by_match", (q) => q.eq("matchId", match._id))
          .collect();
        for (const conversation of conversations) {
          const messages = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) =>
              q.eq("conversationId", conversation._id),
            )
            .collect();
          for (const message of messages) {
            if (message.imageStorageId) {
              try {
                await ctx.storage.delete(message.imageStorageId);
              } catch (e) {}
            }
            await ctx.db.delete(message._id);
            deletedData.messages++;
          }
          await ctx.db.delete(conversation._id);
          deletedData.conversations++;
        }
      }
      await ctx.db.delete(match._id);
      deletedData.matches++;
    }

    // Delete notifications
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    deletedData.notifications = 0;
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
      deletedData.notifications++;
    }

    // Delete crossed paths
    const crossedPaths1 = await ctx.db
      .query("crossedPaths")
      .withIndex("by_user1", (q) => q.eq("user1Id", args.userId))
      .collect();
    const crossedPaths2 = await ctx.db
      .query("crossedPaths")
      .withIndex("by_user2", (q) => q.eq("user2Id", args.userId))
      .collect();
    deletedData.crossedPaths = 0;
    for (const crossedPath of [...crossedPaths1, ...crossedPaths2]) {
      await ctx.db.delete(crossedPath._id);
      deletedData.crossedPaths++;
    }

    // Delete dares
    const sentDares = await ctx.db
      .query("dares")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
      .collect();
    const receivedDares = await ctx.db
      .query("dares")
      .withIndex("by_to_user", (q) => q.eq("toUserId", args.userId))
      .collect();
    deletedData.dares = 0;
    for (const dare of [...sentDares, ...receivedDares]) {
      await ctx.db.delete(dare._id);
      deletedData.dares++;
    }

    // Delete subscription records
    const subscriptions = await ctx.db
      .query("subscriptionRecords")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    deletedData.subscriptionRecords = 0;
    for (const subscription of subscriptions) {
      await ctx.db.delete(subscription._id);
      deletedData.subscriptionRecords++;
    }

    // Delete purchases
    const purchases = await ctx.db
      .query("purchases")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    deletedData.purchases = 0;
    for (const purchase of purchases) {
      await ctx.db.delete(purchase._id);
      deletedData.purchases++;
    }

    // Delete blocks (by and against user)
    const blockedBy = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", args.userId))
      .collect();
    const blockedUsers = await ctx.db
      .query("blocks")
      .withIndex("by_blocked", (q) => q.eq("blockedUserId", args.userId))
      .collect();
    deletedData.blocks = 0;
    for (const block of [...blockedBy, ...blockedUsers]) {
      await ctx.db.delete(block._id);
      deletedData.blocks++;
    }

    // Delete sessions
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    deletedData.sessions = 0;
    for (const session of sessions) {
      await ctx.db.delete(session._id);
      deletedData.sessions++;
    }

    // Delete filter presets
    const presets = await ctx.db
      .query("filterPresets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    deletedData.filterPresets = 0;
    for (const preset of presets) {
      await ctx.db.delete(preset._id);
      deletedData.filterPresets++;
    }

    // Finally, delete the user
    await ctx.db.delete(args.userId);

    const totalDeleted =
      Object.values(deletedData).reduce((a, b) => a + b, 0) + 1; // +1 for user

    return {
      deletedData,
      totalDeleted,
      message: `Deleted user ${user.name} and ${totalDeleted} related records`,
    };
  },
});

// ============================================
// CLEANUP INACTIVE DATA
// ============================================

// Get list of inactive users (for review before deletion)
export const getInactiveUsers = query({
  args: {
    daysInactive: v.optional(v.number()), // Default 90 days
  },
  handler: async (ctx, args) => {
    const daysInactive = args.daysInactive ?? 90;
    const cutoffDate = Date.now() - daysInactive * 24 * 60 * 60 * 1000;

    const inactiveUsers = await ctx.db
      .query("users")
      .filter((q) => q.lt(q.field("lastActive"), cutoffDate))
      .collect();

    return inactiveUsers.map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      lastActive: new Date(user.lastActive).toISOString(),
      daysInactive: Math.floor(
        (Date.now() - user.lastActive) / (24 * 60 * 60 * 1000),
      ),
    }));
  },
});

// Clean up unverified/incomplete user accounts older than X days
export const cleanupIncompleteAccounts = mutation({
  args: {
    daysOld: v.optional(v.number()), // Default 7 days
  },
  handler: async (ctx, args) => {
    const daysOld = args.daysOld ?? 7;
    const cutoffDate = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    const incompleteUsers = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(
          q.eq(q.field("onboardingCompleted"), false),
          q.lt(q.field("createdAt"), cutoffDate),
        ),
      )
      .collect();

    let deletedCount = 0;
    for (const user of incompleteUsers) {
      // Delete associated photos first
      const photos = await ctx.db
        .query("photos")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const photo of photos) {
        try {
          await ctx.storage.delete(photo.storageId);
        } catch (e) {}
        await ctx.db.delete(photo._id);
      }

      // Delete the user
      await ctx.db.delete(user._id);
      deletedCount++;
    }

    return {
      deletedCount,
      message: `Deleted ${deletedCount} incomplete accounts older than ${daysOld} days`,
    };
  },
});

// ============================================
// WIPE ENTIRE DATABASE (NO CONFIRMATION - DEV ONLY!)
// ============================================

/**
 * ⚠️ DANGER: Completely wipes the entire database without confirmation.
 * This should ONLY be used in development environments.
 * Deletes ALL data from ALL tables including storage files.
 */
export const wipeEntireDatabase = mutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "messages",
      "conversations",
      "likes",
      "matches",
      "photos",
      "notifications",
      "crossedPaths",
      "dares",
      "subscriptionRecords",
      "purchases",
      "reports",
      "blocks",
      "otpCodes",
      "sessions",
      "filterPresets",
      "users",
    ] as const;

    const results: Record<string, number> = {};
    let storageFilesDeleted = 0;

    for (const tableName of tables) {
      const records = await ctx.db.query(tableName).collect();
      results[tableName] = 0;

      for (const record of records) {
        // Clean up all storage files
        if (tableName === "photos" && "storageId" in record) {
          try {
            await ctx.storage.delete(record.storageId as any);
            storageFilesDeleted++;
          } catch (e) {
            // Ignore storage errors
          }
        }
        if (
          tableName === "messages" &&
          "imageStorageId" in record &&
          record.imageStorageId
        ) {
          try {
            await ctx.storage.delete(record.imageStorageId as any);
            storageFilesDeleted++;
          } catch (e) {
            // Ignore storage errors
          }
        }
        if (
          tableName === "users" &&
          "verificationPhotoId" in record &&
          record.verificationPhotoId
        ) {
          try {
            await ctx.storage.delete(record.verificationPhotoId as any);
            storageFilesDeleted++;
          } catch (e) {
            // Ignore storage errors
          }
        }

        await ctx.db.delete(record._id);
        results[tableName]++;
      }
    }

    const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);

    return {
      success: true,
      results,
      totalRecordsDeleted: totalDeleted,
      storageFilesDeleted,
      message: `🗑️ DATABASE WIPED: Deleted ${totalDeleted} records and ${storageFilesDeleted} storage files`,
    };
  },
});

/**
 * Quick helper to check if database is empty
 */
export const isDatabaseEmpty = query({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "users",
      "photos",
      "likes",
      "matches",
      "conversations",
      "messages",
      "notifications",
      "crossedPaths",
      "dares",
      "subscriptionRecords",
      "purchases",
      "reports",
      "blocks",
      "otpCodes",
      "sessions",
      "filterPresets",
    ] as const;

    const counts: Record<string, number> = {};
    let totalRecords = 0;

    for (const tableName of tables) {
      const records = await ctx.db.query(tableName).collect();
      counts[tableName] = records.length;
      totalRecords += records.length;
    }

    return {
      isEmpty: totalRecords === 0,
      totalRecords,
      counts,
    };
  },
});
