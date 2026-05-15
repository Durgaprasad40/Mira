import { v } from "convex/values";
import { mutation, query, internalMutation, MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { userIdToString, validateOwnership } from "./helpers";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// P1-001: Cascade budget guards. The cleanup cron processes at most
// MAX_CASCADE_USERS_PER_RUN soft-deleted users per invocation. For each user,
// we iterate up to MAX_CASCADE_CONVERSATIONS_PER_USER conversations and, per
// conversation, walk messages in batches of MAX_CASCADE_MESSAGES_BATCH. If we
// hit any cap mid-user the deletion state is left in `pending_deletion` so
// the next run resumes the work. Counters in the return value let operators
// detect this and re-trigger if needed.
const MAX_CASCADE_USERS_PER_RUN = 25;
const MAX_CASCADE_CONVERSATIONS_PER_USER = 1000;
const MAX_CASCADE_MESSAGES_BATCH = 200;
const MAX_CASCADE_MESSAGES_PER_CONVERSATION = 10000;
const MAX_CASCADE_GENERIC_BATCH = 500;

/**
 * Best-effort storage blob delete. Storage may already have been GC'd by
 * an earlier sweep (e.g. cleanupExpiredPrivateProtectedMedia) so a missing
 * blob is NOT a hard error — it is reported via the failure counter and we
 * proceed with row deletion.
 */
async function tryDeleteStorageBlob(
  ctx: MutationCtx,
  storageId: Id<'_storage'> | undefined | null,
  counters: { storageDeleted: number; storageFailed: number }
): Promise<void> {
  if (!storageId) return;
  try {
    await ctx.storage.delete(storageId);
    counters.storageDeleted += 1;
  } catch (e) {
    counters.storageFailed += 1;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[cleanupExpiredDeletions] storage.delete failed', {
        storageId: String(storageId).slice(-8),
        error: String((e as any)?.message ?? e),
      });
    }
  }
}

/**
 * Drain all privateMessages belonging to a conversation in bounded batches,
 * deleting owned storage blobs and the per-message media-view rows. Returns
 * the message count actually deleted plus a `complete` flag that is false if
 * we stopped early due to MAX_CASCADE_MESSAGES_PER_CONVERSATION.
 */
async function cascadeConversationMessages(
  ctx: MutationCtx,
  conversationId: Id<'privateConversations'>,
  counters: {
    messagesDeleted: number;
    storageDeleted: number;
    storageFailed: number;
    mediaUploadsDeleted: number;
    mediaViewsDeleted: number;
  }
): Promise<{ complete: boolean }> {
  let totalProcessed = 0;
  // Bounded loop: each pass takes <= MAX_CASCADE_MESSAGES_BATCH rows.
  // Deleting the rows we just read means the next .take() returns the next
  // page; no cursor needed.
  while (true) {
    const batch = await ctx.db
      .query('privateMessages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .take(MAX_CASCADE_MESSAGES_BATCH);

    if (batch.length === 0) return { complete: true };

    for (const message of batch) {
      // 1. Best-effort delete owned storage blobs.
      await tryDeleteStorageBlob(ctx, message.imageStorageId ?? null, counters);
      await tryDeleteStorageBlob(ctx, message.audioStorageId ?? null, counters);

      // 2. Clean up the upload index row for each owned blob (orphan-prevention).
      for (const sid of [message.imageStorageId, message.audioStorageId]) {
        if (!sid) continue;
        const uploadRows = await ctx.db
          .query('privateMessageMediaUploads')
          .withIndex('by_storage', (q) => q.eq('storageId', sid))
          .take(MAX_CASCADE_GENERIC_BATCH);
        for (const row of uploadRows) {
          await ctx.db.delete(row._id);
          counters.mediaUploadsDeleted += 1;
        }
      }

      // 3. Delete view-receipt rows pointing at this message.
      const viewRows = await ctx.db
        .query('privateMessageMediaViews')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .take(MAX_CASCADE_GENERIC_BATCH);
      for (const row of viewRows) {
        await ctx.db.delete(row._id);
        counters.mediaViewsDeleted += 1;
      }

      // 4. Delete the message row itself.
      await ctx.db.delete(message._id);
      counters.messagesDeleted += 1;
      totalProcessed += 1;
    }

    if (totalProcessed >= MAX_CASCADE_MESSAGES_PER_CONVERSATION) {
      return { complete: false };
    }
  }
}

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

// Get private deletion state for a user
export const getPrivateDeletionState = query({
  args: {
    token: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);

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
  args: {
    token: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);
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
  args: {
    token: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);
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

// Hard delete private data for expired deletions (called by cron).
// P1-001: Cascades into all Phase-2 Messages tables in addition to the
// pre-existing T/D + revealRequests cleanup so the 30-day "permanently
// deleted" promise is actually honored. The cascade is bounded by per-user
// and per-conversation caps so a single invocation cannot exhaust Convex
// transaction limits; the deletion state stays in `pending_deletion` if
// any cap was hit, and the next cron run resumes the work.
//
// P1-003-followup: This MUST be `internalMutation` so it can be wired into
// `convex/crons.ts` (Convex crons only invoke `internal.*` references) and
// so untrusted clients cannot trigger the cascade. There were no client
// callers prior to this change.
export const cleanupExpiredDeletions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all pending deletions where recovery window has expired
    const expiredDeletions = await ctx.db
      .query("privateDeletionStates")
      .withIndex("by_status", (q) => q.eq("status", "pending_deletion"))
      .collect();

    const toDelete = expiredDeletions
      .filter((d) => d.recoverUntil && now > d.recoverUntil)
      .slice(0, MAX_CASCADE_USERS_PER_RUN);

    let fullyDeletedUsers = 0;
    let postponedUsers = 0;
    const counters = {
      // Phase-2 Messages cascade
      conversationsDeleted: 0,
      participantsDeleted: 0,
      messagesDeleted: 0,
      mediaUploadsDeleted: 0,
      mediaViewsDeleted: 0,
      notificationsDeleted: 0,
      likesDeleted: 0,
      matchesDeleted: 0,
      // Storage blob counters
      storageDeleted: 0,
      storageFailed: 0,
      // Existing categories
      privateProfilesDeleted: 0,
      todPrivateMediaDeleted: 0,
      chatTodGamesDeleted: 0,
      todAnswersDeleted: 0,
      todPromptsDeleted: 0,
      revealRequestsDeleted: 0,
      todConnectRequestsDeleted: 0,
    };

    for (const deletion of toDelete) {
      const userId = deletion.userId;
      const userIdString = userIdToString(userId);
      let cascadeComplete = true;

      // ═══════════════════════════════════════════════════════════════════
      // P1-001 (new): Phase-2 Messages tables cascade
      // ═══════════════════════════════════════════════════════════════════

      // (a) Find every conversation this user participates in. Use the
      // participants table (indexed by_user) so we don't scan privateConversations.
      const myParticipantRows = await ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .take(MAX_CASCADE_CONVERSATIONS_PER_USER);

      if (myParticipantRows.length >= MAX_CASCADE_CONVERSATIONS_PER_USER) {
        cascadeComplete = false;
      }

      for (const myParticipant of myParticipantRows) {
        const conversationId = myParticipant.conversationId;

        // (b) Drain every message in this conversation in bounded batches,
        // deleting owned storage blobs + upload/view rows along the way.
        const drain = await cascadeConversationMessages(ctx, conversationId, counters);
        if (!drain.complete) {
          cascadeComplete = false;
        }

        // (c) Delete BOTH participant rows for the conversation (ours + the
        // counterparty's). Required because the user's account deletion
        // promise outweighs the counterparty retaining the thread; without
        // this, the counterparty would see an orphaned conversation card.
        const allParticipants = await ctx.db
          .query('privateConversationParticipants')
          .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
          .take(MAX_CASCADE_GENERIC_BATCH);
        for (const row of allParticipants) {
          await ctx.db.delete(row._id);
          counters.participantsDeleted += 1;
        }

        // (d) Finally drop the conversation row itself (only if drain was
        // complete; otherwise we leave the conversation in place so the
        // next run can resume on its remaining messages).
        if (drain.complete) {
          const convo = await ctx.db.get(conversationId);
          if (convo) {
            await ctx.db.delete(convo._id);
            counters.conversationsDeleted += 1;
          }
        }
      }

      // (e) Orphan-sweep: privateMessageMediaUploads owned by this user that
      // were never associated with a deleted message (e.g. upload completed
      // but message insert failed). Delete the blob + row both.
      const orphanUploads = await ctx.db
        .query('privateMessageMediaUploads')
        .withIndex('by_uploader', (q) => q.eq('uploaderUserId', userId))
        .take(MAX_CASCADE_GENERIC_BATCH);
      if (orphanUploads.length >= MAX_CASCADE_GENERIC_BATCH) {
        cascadeComplete = false;
      }
      for (const row of orphanUploads) {
        await tryDeleteStorageBlob(ctx, row.storageId, counters);
        await ctx.db.delete(row._id);
        counters.mediaUploadsDeleted += 1;
      }

      // (f) privateNotifications targeting this user.
      const notifs = await ctx.db
        .query('privateNotifications')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .take(MAX_CASCADE_GENERIC_BATCH);
      if (notifs.length >= MAX_CASCADE_GENERIC_BATCH) {
        cascadeComplete = false;
      }
      for (const row of notifs) {
        await ctx.db.delete(row._id);
        counters.notificationsDeleted += 1;
      }

      // (g) privateLikes: both directions (from this user and to this user).
      const likesFrom = await ctx.db
        .query('privateLikes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
        .take(MAX_CASCADE_GENERIC_BATCH);
      if (likesFrom.length >= MAX_CASCADE_GENERIC_BATCH) {
        cascadeComplete = false;
      }
      for (const row of likesFrom) {
        await ctx.db.delete(row._id);
        counters.likesDeleted += 1;
      }
      const likesTo = await ctx.db
        .query('privateLikes')
        .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
        .take(MAX_CASCADE_GENERIC_BATCH);
      if (likesTo.length >= MAX_CASCADE_GENERIC_BATCH) {
        cascadeComplete = false;
      }
      for (const row of likesTo) {
        await ctx.db.delete(row._id);
        counters.likesDeleted += 1;
      }

      // (h) privateMatches: schema sorts pairs as (user1Id < user2Id), so we
      // must query both ends.
      const matchesAsU1 = await ctx.db
        .query('privateMatches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .take(MAX_CASCADE_GENERIC_BATCH);
      if (matchesAsU1.length >= MAX_CASCADE_GENERIC_BATCH) {
        cascadeComplete = false;
      }
      for (const row of matchesAsU1) {
        await ctx.db.delete(row._id);
        counters.matchesDeleted += 1;
      }
      const matchesAsU2 = await ctx.db
        .query('privateMatches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .take(MAX_CASCADE_GENERIC_BATCH);
      if (matchesAsU2.length >= MAX_CASCADE_GENERIC_BATCH) {
        cascadeComplete = false;
      }
      for (const row of matchesAsU2) {
        await ctx.db.delete(row._id);
        counters.matchesDeleted += 1;
      }

      // ═══════════════════════════════════════════════════════════════════
      // Pre-existing cleanup (kept verbatim aside from added storage-blob
      // deletes that satisfy the original TODOs).
      // ═══════════════════════════════════════════════════════════════════

      // 1. Delete userPrivateProfiles record + owned blurred-photo storage blobs.
      const privateProfile = await ctx.db
        .query("userPrivateProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();

      if (privateProfile) {
        // P1-001: satisfy original TODO — privatePhotosBlurred is an array of
        // _storage ids; best-effort delete each.
        const blurred = (privateProfile as any).privatePhotosBlurred as
          | Id<'_storage'>[]
          | undefined;
        if (Array.isArray(blurred)) {
          for (const sid of blurred) {
            await tryDeleteStorageBlob(ctx, sid, counters);
          }
        }
        await ctx.db.delete(privateProfile._id);
        counters.privateProfilesDeleted += 1;
      }

      // 2. Delete todPrivateMedia sent by user (+ owned blobs).
      const mediaByUser = await ctx.db
        .query("todPrivateMedia")
        .withIndex("by_from_user", (q) => q.eq("fromUserId", userIdString))
        .collect();
      for (const media of mediaByUser) {
        // P1-001: satisfy original TODO.
        await tryDeleteStorageBlob(
          ctx,
          (media as any).storageId ?? null,
          counters
        );
        await ctx.db.delete(media._id);
        counters.todPrivateMediaDeleted += 1;
      }

      // 3. Delete todPrivateMedia sent to user (+ owned blobs).
      const mediaToUser = await ctx.db
        .query("todPrivateMedia")
        .withIndex("by_to_user", (q) => q.eq("toUserId", userIdString))
        .collect();
      for (const media of mediaToUser) {
        // P1-001: satisfy original TODO.
        await tryDeleteStorageBlob(
          ctx,
          (media as any).storageId ?? null,
          counters
        );
        await ctx.db.delete(media._id);
        counters.todPrivateMediaDeleted += 1;
      }

      // 4. Delete chatTodGames where user is participant1
      const gamesAsP1 = await ctx.db
        .query("chatTodGames")
        .withIndex("by_participant1", (q) => q.eq("participant1Id", userIdString))
        .collect();
      for (const game of gamesAsP1) {
        await ctx.db.delete(game._id);
        counters.chatTodGamesDeleted += 1;
      }

      // 5. Delete chatTodGames where user is participant2
      const gamesAsP2 = await ctx.db
        .query("chatTodGames")
        .withIndex("by_participant2", (q) => q.eq("participant2Id", userIdString))
        .collect();
      for (const game of gamesAsP2) {
        await ctx.db.delete(game._id);
        counters.chatTodGamesDeleted += 1;
      }

      // 6. Delete todAnswers by user (+ owned blobs).
      const answers = await ctx.db
        .query("todAnswers")
        .withIndex("by_user", (q) => q.eq("userId", userIdString))
        .collect();
      for (const answer of answers) {
        // P1-001: satisfy original TODO.
        await tryDeleteStorageBlob(
          ctx,
          (answer as any).mediaStorageId ?? null,
          counters
        );
        await ctx.db.delete(answer._id);
        counters.todAnswersDeleted += 1;
      }

      // 7. Delete todPrompts created by user
      const prompts = await ctx.db
        .query("todPrompts")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userIdString))
        .collect();
      for (const prompt of prompts) {
        await ctx.db.delete(prompt._id);
        counters.todPromptsDeleted += 1;
      }

      // 8. Delete revealRequests from user
      const revealsFrom = await ctx.db
        .query("revealRequests")
        .withIndex("by_from_user", (q) => q.eq("fromUserId", userId))
        .collect();
      for (const reveal of revealsFrom) {
        await ctx.db.delete(reveal._id);
        counters.revealRequestsDeleted += 1;
      }

      // 9. Delete revealRequests to user
      const revealsTo = await ctx.db
        .query("revealRequests")
        .withIndex("by_to_user", (q) => q.eq("toUserId", userId))
        .collect();
      for (const reveal of revealsTo) {
        await ctx.db.delete(reveal._id);
        counters.revealRequestsDeleted += 1;
      }

      // 10. Delete todConnectRequests to user
      const connectsTo = await ctx.db
        .query("todConnectRequests")
        .withIndex("by_to_user", (q) => q.eq("toUserId", userIdString))
        .collect();
      for (const connect of connectsTo) {
        await ctx.db.delete(connect._id);
        counters.todConnectRequestsDeleted += 1;
      }

      // P1-001: Only reset the deletion state if the cascade actually
      // finished. If we hit a budget cap, leave the row in `pending_deletion`
      // so the next cron run picks it up. Without this guard a partial sweep
      // would mark the user "active" and the residue would never be
      // collected.
      if (cascadeComplete) {
        await ctx.db.patch(deletion._id, {
          status: 'active', // Reset to active (data is gone)
          deletedAt: undefined,
          recoverUntil: undefined,
          updatedAt: now,
        });
        fullyDeletedUsers += 1;
      } else {
        await ctx.db.patch(deletion._id, {
          updatedAt: now,
        });
        postponedUsers += 1;
      }
    }

    return {
      // Pre-existing fields (callers may rely on these names).
      deletedCount: fullyDeletedUsers,
      userIds: toDelete.map((d) => d.userId),
      // P1-001: new visibility into cascade work + postponed users.
      usersConsidered: toDelete.length,
      usersPostponed: postponedUsers,
      ...counters,
    };
  },
});
