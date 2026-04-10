import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { userIdToString, resolveUserIdByAuthId } from "./helpers";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Helper function to check if a user's private data is in pending_deletion state
 * Returns true if data should be hidden (pending deletion)
 * Use this in all Phase-2 queries to gate data access
 */
export async function isPrivateDataDeleted(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<boolean> {
  const deletionState = await ctx.db
    .query("privateDeletionStates")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();

  return deletionState?.status === 'pending_deletion';
}

async function getCurrentAuthenticatedUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  return await resolveUserIdByAuthId(ctx, identity.subject);
}

async function requireCurrentAuthenticatedUserId(
  ctx: MutationCtx
): Promise<Id<"users">> {
  const userId = await getCurrentAuthenticatedUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }

  return userId;
}

// Get private deletion state for a user
export const getPrivateDeletionState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentAuthenticatedUserId(ctx);
    if (!userId) {
      return {
        status: 'active' as const,
        deletedAt: null,
        recoverUntil: null,
      };
    }

    const deletionState = await ctx.db
      .query("privateDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!deletionState) {
      return {
        status: 'active' as const,
        deletedAt: null,
        recoverUntil: null,
      };
    }

    return {
      status: deletionState.status,
      deletedAt: deletionState.deletedAt ?? null,
      recoverUntil: deletionState.recoverUntil ?? null,
    };
  },
});

// Initiate private data deletion (soft delete with 30-day recovery window)
export const initiatePrivateDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireCurrentAuthenticatedUserId(ctx);
    const now = Date.now();
    const recoverUntil = now + THIRTY_DAYS_MS;

    // Check if deletion state already exists
    const existingState = await ctx.db
      .query("privateDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existingState) {
      // Update existing record
      await ctx.db.patch(existingState._id, {
        status: 'pending_deletion',
        deletedAt: now,
        recoverUntil,
        updatedAt: now,
      });
    } else {
      // Create new record
      await ctx.db.insert("privateDeletionStates", {
        userId,
        status: 'pending_deletion',
        deletedAt: now,
        recoverUntil,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      status: 'pending_deletion' as const,
      deletedAt: now,
      recoverUntil,
    };
  },
});

// Recover private data (restore from soft delete)
export const recoverPrivateDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireCurrentAuthenticatedUserId(ctx);
    const now = Date.now();

    const existingState = await ctx.db
      .query("privateDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!existingState) {
      throw new Error("No deletion state found for this user");
    }

    // Check if recovery window has expired
    if (existingState.recoverUntil && now > existingState.recoverUntil) {
      throw new Error("Recovery window has expired");
    }

    // Update to active status
    await ctx.db.patch(existingState._id, {
      status: 'active',
      deletedAt: undefined,
      recoverUntil: undefined,
      updatedAt: now,
    });

    return {
      status: 'active' as const,
      deletedAt: null,
      recoverUntil: null,
    };
  },
});

// Hard delete private data for expired deletions (called by cron or on-access)
export const cleanupExpiredDeletions = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all pending deletions where recovery window has expired
    const expiredDeletions = await ctx.db
      .query("privateDeletionStates")
      .withIndex("by_status", (q) => q.eq("status", "pending_deletion"))
      .collect();

    const toDelete = expiredDeletions.filter(
      (d) => d.recoverUntil && now > d.recoverUntil
    );

    for (const deletion of toDelete) {
      const userId = deletion.userId;
      const userIdString = userIdToString(userId);

      // 1. Delete userPrivateProfiles record
      const privateProfile = await ctx.db
        .query("userPrivateProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();

      if (privateProfile) {
        // TODO: Delete storage blobs referenced in privatePhotosBlurred array
        // privateProfile.privatePhotosBlurred contains storageIds to delete
        await ctx.db.delete(privateProfile._id);
      }

      // 2. Delete todPrivateMedia sent by user
      const mediaByUser = await ctx.db
        .query("todPrivateMedia")
        .withIndex("by_from_user", (q) => q.eq("fromUserId", userIdString))
        .collect();
      for (const media of mediaByUser) {
        // TODO: Delete storage blob if storageId exists: media.storageId
        await ctx.db.delete(media._id);
      }

      // 3. Delete todPrivateMedia sent to user
      const mediaToUser = await ctx.db
        .query("todPrivateMedia")
        .withIndex("by_to_user", (q) => q.eq("toUserId", userIdString))
        .collect();
      for (const media of mediaToUser) {
        // TODO: Delete storage blob if storageId exists: media.storageId
        await ctx.db.delete(media._id);
      }

      // 4. Delete chatTodGames where user is participant1
      const gamesAsP1 = await ctx.db
        .query("chatTodGames")
        .withIndex("by_participant1", (q) => q.eq("participant1Id", userIdString))
        .collect();
      for (const game of gamesAsP1) {
        await ctx.db.delete(game._id);
      }

      // 5. Delete chatTodGames where user is participant2
      const gamesAsP2 = await ctx.db
        .query("chatTodGames")
        .withIndex("by_participant2", (q) => q.eq("participant2Id", userIdString))
        .collect();
      for (const game of gamesAsP2) {
        await ctx.db.delete(game._id);
      }

      // 6. Delete todAnswers by user
      const answers = await ctx.db
        .query("todAnswers")
        .withIndex("by_user", (q) => q.eq("userId", userIdString))
        .collect();
      for (const answer of answers) {
        // TODO: Delete storage blob if mediaStorageId exists: answer.mediaStorageId
        await ctx.db.delete(answer._id);
      }

      // 7. Delete todPrompts created by user
      const prompts = await ctx.db
        .query("todPrompts")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userIdString))
        .collect();
      for (const prompt of prompts) {
        await ctx.db.delete(prompt._id);
      }

      // 8. Delete todConnectRequests to user
      const connectsTo = await ctx.db
        .query("todConnectRequests")
        .withIndex("by_to_user", (q) => q.eq("toUserId", userIdString))
        .collect();
      for (const connect of connectsTo) {
        await ctx.db.delete(connect._id);
      }

      // Mark deletion state as permanently deleted
      await ctx.db.patch(deletion._id, {
        status: 'active', // Reset to active (data is gone)
        deletedAt: undefined,
        recoverUntil: undefined,
        updatedAt: now,
      });
    }

    return {
      deletedCount: toDelete.length,
      userIds: toDelete.map((d) => d.userId),
    };
  },
});
