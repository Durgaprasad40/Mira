import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';

// 24-hour auto-delete rule (same as Confessions)
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Rate limiting constants
const RATE_LIMITS = {
  answer: { max: 10, windowMs: 60 * 1000 }, // 10 answers per minute
  reaction: { max: 30, windowMs: 60 * 1000 }, // 30 reactions per minute
  report: { max: 10, windowMs: 24 * 60 * 60 * 1000 }, // 10 reports per day
  claim_media: { max: 20, windowMs: 60 * 1000 }, // 20 media claims per minute
};

// Report threshold for hiding
const REPORT_HIDE_THRESHOLD = 5;

// Get trending prompts (1 truth + 1 dare), excluding expired
export const getTrendingPrompts = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allTrending = await ctx.db
      .query('todPrompts')
      .withIndex('by_trending', (q) => q.eq('isTrending', true))
      .collect();

    const active = allTrending.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      return expires > now;
    });

    const truth = active.find((p) => p.type === 'truth') || null;
    const dare = active.find((p) => p.type === 'dare') || null;
    return { truth, dare };
  },
});

// Get answers for a prompt
export const getAnswersForPrompt = query({
  args: { promptId: v.string(), viewerUserId: v.optional(v.string()) },
  handler: async (ctx, { promptId }) => {
    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .order('desc')
      .collect();
    return answers;
  },
});

// Check if user already answered a prompt
export const hasUserAnswered = query({
  args: { promptId: v.string(), userId: v.string() },
  handler: async (ctx, { promptId, userId }) => {
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) => q.eq('promptId', promptId).eq('userId', userId))
      .first();
    return !!existing;
  },
});

// Create a new Truth or Dare prompt
export const createPrompt = mutation({
  args: {
    type: v.union(v.literal('truth'), v.literal('dare')),
    text: v.string(),
    ownerUserId: v.string(),
    isAnonymous: v.optional(v.boolean()),
    // Owner profile snapshot (for feed display)
    ownerName: v.optional(v.string()),
    ownerPhotoUrl: v.optional(v.string()),
    ownerAge: v.optional(v.number()),
    ownerGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + TWENTY_FOUR_HOURS_MS;

    const promptId = await ctx.db.insert('todPrompts', {
      type: args.type,
      text: args.text,
      isTrending: false, // User-created prompts are never trending
      ownerUserId: args.ownerUserId,
      answerCount: 0,
      activeCount: 0,
      createdAt: now,
      expiresAt,
      // Owner profile snapshot (default false = show profile)
      isAnonymous: args.isAnonymous ?? false,
      ownerName: args.ownerName,
      ownerPhotoUrl: args.ownerPhotoUrl,
      ownerAge: args.ownerAge,
      ownerGender: args.ownerGender,
    });

    return { promptId, expiresAt };
  },
});

// Submit an answer (one per user per prompt)
export const submitAnswer = mutation({
  args: {
    promptId: v.string(),
    userId: v.string(),
    type: v.union(v.literal('text'), v.literal('photo'), v.literal('video'), v.literal('voice')),
    text: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    mediaStorageId: v.optional(v.id('_storage')),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Enforce one answer per user per prompt
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) => q.eq('promptId', args.promptId).eq('userId', args.userId))
      .first();
    if (existing) {
      throw new Error('You already posted for this prompt.');
    }

    const answerId = await ctx.db.insert('todAnswers', {
      promptId: args.promptId,
      userId: args.userId,
      type: args.type,
      text: args.text,
      mediaUrl: args.mediaUrl,
      mediaStorageId: args.mediaStorageId,
      durationSec: args.durationSec,
      likeCount: 0,
      createdAt: Date.now(),
    });

    // Increment answer count on prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();
    if (prompt) {
      await ctx.db.patch(prompt._id, {
        answerCount: prompt.answerCount + 1,
        activeCount: prompt.activeCount + 1,
      });
    }

    return answerId;
  },
});

// Like an answer
export const likeAnswer = mutation({
  args: {
    answerId: v.string(),
    likedByUserId: v.string(),
  },
  handler: async (ctx, { answerId, likedByUserId }) => {
    // Check if already liked
    const existing = await ctx.db
      .query('todAnswerLikes')
      .withIndex('by_answer_user', (q) => q.eq('answerId', answerId).eq('likedByUserId', likedByUserId))
      .first();
    if (existing) return { alreadyLiked: true };

    await ctx.db.insert('todAnswerLikes', {
      answerId,
      likedByUserId,
      createdAt: Date.now(),
    });

    // Increment like count on answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (answer) {
      await ctx.db.patch(answer._id, { likeCount: answer.likeCount + 1 });

      // Get the prompt to find owner
      const prompt = await ctx.db
        .query('todPrompts')
        .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
        .first();

      // Create connect request for prompt owner
      if (prompt && prompt.ownerUserId !== likedByUserId) {
        await ctx.db.insert('todConnectRequests', {
          promptId: answer.promptId,
          answerId,
          fromUserId: likedByUserId,
          toUserId: prompt.ownerUserId,
          status: 'pending',
          createdAt: Date.now(),
        });
      }
    }

    return { alreadyLiked: false };
  },
});

// Unlike an answer
export const unlikeAnswer = mutation({
  args: {
    answerId: v.string(),
    likedByUserId: v.string(),
  },
  handler: async (ctx, { answerId, likedByUserId }) => {
    const existing = await ctx.db
      .query('todAnswerLikes')
      .withIndex('by_answer_user', (q) => q.eq('answerId', answerId).eq('likedByUserId', likedByUserId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      const answer = await ctx.db
        .query('todAnswers')
        .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
        .first();
      if (answer && answer.likeCount > 0) {
        await ctx.db.patch(answer._id, { likeCount: answer.likeCount - 1 });
      }
    }
  },
});

// Get pending connect requests for prompt owner
export const getPendingConnectRequests = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .order('desc')
      .collect();
  },
});

// Respond to connect request (Connect or Remove)
export const respondToConnect = mutation({
  args: {
    requestId: v.id('todConnectRequests'),
    action: v.union(v.literal('connect'), v.literal('remove')),
  },
  handler: async (ctx, { requestId, action }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== 'pending') return;

    if (action === 'connect') {
      await ctx.db.patch(requestId, { status: 'connected' });
      // Create a conversation between the two users
      // (reuses existing conversations table with source tracking)
    } else {
      await ctx.db.patch(requestId, { status: 'removed' });
    }
  },
});

// Seed default trending prompts (call once)
export const seedTrendingPrompts = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('todPrompts')
      .withIndex('by_trending', (q) => q.eq('isTrending', true))
      .collect();
    if (existing.length >= 2) return;

    const now = Date.now();
    await ctx.db.insert('todPrompts', {
      type: 'truth',
      text: "What's the most spontaneous thing you've ever done for someone you liked?",
      isTrending: true,
      ownerUserId: 'system',
      answerCount: 42,
      activeCount: 18,
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS,
    });

    await ctx.db.insert('todPrompts', {
      type: 'dare',
      text: 'Record a 15-second video of your best impression of your celebrity crush!',
      isTrending: true,
      ownerUserId: 'system',
      answerCount: 27,
      activeCount: 11,
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS,
    });
  },
});

// Cleanup expired prompts and their answers + media
export const cleanupExpiredPrompts = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allPrompts = await ctx.db.query('todPrompts').collect();
    let deleted = 0;

    for (const prompt of allPrompts) {
      const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires > now) continue;

      // Delete all answers for this prompt
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as string))
        .collect();

      for (const answer of answers) {
        // Delete media from storage if present
        if (answer.mediaStorageId) {
          await ctx.storage.delete(answer.mediaStorageId);
        }
        // Delete likes for this answer
        const likes = await ctx.db
          .query('todAnswerLikes')
          .withIndex('by_answer', (q) => q.eq('answerId', answer._id as string))
          .collect();
        for (const like of likes) {
          await ctx.db.delete(like._id);
        }
        // Delete connect requests for this answer
        const connects = await ctx.db
          .query('todConnectRequests')
          .filter((q) => q.eq(q.field('answerId'), answer._id as string))
          .collect();
        for (const cr of connects) {
          await ctx.db.delete(cr._id);
        }
        await ctx.db.delete(answer._id);
      }

      // Delete the prompt itself
      await ctx.db.delete(prompt._id);
      deleted++;
    }

    return { deleted };
  },
});

// Generate upload URL for media
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

// ============================================================
// PRIVATE MEDIA FUNCTIONS (One-time view photo/video responses)
// ============================================================

/**
 * Submit a private photo/video response to a prompt.
 * Only the prompt owner can ever view this media.
 * Replaces any existing pending media from the same user.
 */
export const submitPrivateMediaResponse = mutation({
  args: {
    promptId: v.string(),
    fromUserId: v.string(),
    mediaType: v.union(v.literal('photo'), v.literal('video')),
    storageId: v.id('_storage'),
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))), // tap = tap once, hold = hold to view
    durationSec: v.optional(v.number()), // 1-60 seconds, default 20
    // Responder profile info for display
    responderName: v.optional(v.string()),
    responderAge: v.optional(v.number()),
    responderGender: v.optional(v.string()),
    responderPhotoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      throw new Error('Prompt not found');
    }

    // Check for existing pending media from this user for this prompt
    const existing = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_prompt_from', (q) =>
        q.eq('promptId', args.promptId).eq('fromUserId', args.fromUserId)
      )
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .first();

    // If existing, delete old storage and remove record (replace policy)
    if (existing) {
      if (existing.storageId) {
        await ctx.storage.delete(existing.storageId);
      }
      await ctx.db.delete(existing._id);
    }

    // Create new private media record with 24h expiry
    const now = Date.now();
    const id = await ctx.db.insert('todPrivateMedia', {
      promptId: args.promptId,
      fromUserId: args.fromUserId,
      toUserId: prompt.ownerUserId,
      mediaType: args.mediaType,
      storageId: args.storageId,
      viewMode: args.viewMode ?? 'tap', // default to tap-to-view
      durationSec: args.durationSec ?? 20,
      status: 'pending',
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS, // 24h auto-delete
      connectStatus: 'none',
      responderName: args.responderName,
      responderAge: args.responderAge,
      responderGender: args.responderGender,
      responderPhotoUrl: args.responderPhotoUrl,
    });

    return { id, success: true };
  },
});

/**
 * Get private media items for a prompt (owner only).
 * Returns metadata only, NOT the media URL.
 */
export const getPrivateMediaForOwner = query({
  args: {
    promptId: v.string(),
    viewerUserId: v.string(),
  },
  handler: async (ctx, { promptId, viewerUserId }) => {
    // Get the prompt to verify ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return [];

    // Only prompt owner can see private media
    if (prompt.ownerUserId !== viewerUserId) {
      return [];
    }

    // Get all private media for this prompt
    const items = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    // Return metadata without storage URLs
    return items.map((item) => ({
      _id: item._id,
      fromUserId: item.fromUserId,
      mediaType: item.mediaType,
      viewMode: item.viewMode, // 'tap' or 'hold'
      durationSec: item.durationSec,
      status: item.status,
      createdAt: item.createdAt,
      viewedAt: item.viewedAt,
      expiresAt: item.expiresAt,
      connectStatus: item.connectStatus,
      responderName: item.responderName,
      responderAge: item.responderAge,
      responderGender: item.responderGender,
      responderPhotoUrl: item.responderPhotoUrl,
      // NEVER include storageId or URL here
    }));
  },
});

/**
 * Begin viewing private media (owner only).
 * Sets status to 'viewing', starts timer, returns short-lived URL.
 * This is the ONLY way to get the media URL, and only works once.
 */
export const beginPrivateMediaView = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    viewerUserId: v.string(),
  },
  handler: async (ctx, { privateMediaId, viewerUserId }) => {
    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // AUTH CHECK: Only prompt owner can view
    if (item.toUserId !== viewerUserId) {
      throw new Error('Access denied: You are not the prompt owner');
    }

    // Only allow viewing if status is 'pending'
    if (item.status !== 'pending') {
      throw new Error('Media already viewed or expired');
    }

    // Ensure storageId exists
    if (!item.storageId) {
      throw new Error('Media file not found');
    }

    const now = Date.now();
    const expiresAt = now + item.durationSec * 1000;

    // Update status to viewing
    await ctx.db.patch(privateMediaId, {
      status: 'viewing',
      viewedAt: now,
      expiresAt,
    });

    // Generate short-lived URL (Convex URLs expire automatically)
    const url = await ctx.storage.getUrl(item.storageId);
    if (!url) {
      throw new Error('Failed to generate media URL');
    }

    return {
      url,
      mediaType: item.mediaType,
      viewMode: item.viewMode, // 'tap' or 'hold' - frontend enforces this
      durationSec: item.durationSec,
      expiresAt,
    };
  },
});

/**
 * Finalize private media view (called when timer ends or user closes).
 * Deletes the storage file and marks as expired/deleted.
 */
export const finalizePrivateMediaView = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    viewerUserId: v.string(),
  },
  handler: async (ctx, { privateMediaId, viewerUserId }) => {
    const item = await ctx.db.get(privateMediaId);
    if (!item) return { success: false };

    // AUTH CHECK: Only prompt owner can finalize
    if (item.toUserId !== viewerUserId) {
      throw new Error('Access denied');
    }

    // Delete storage file if exists
    if (item.storageId) {
      try {
        await ctx.storage.delete(item.storageId);
      } catch {
        // Storage may already be deleted
      }
    }

    // Mark as deleted
    await ctx.db.patch(privateMediaId, {
      status: 'deleted',
      storageId: undefined,
    });

    return { success: true };
  },
});

/**
 * Send connect request after viewing private media.
 * Creates a pending request to the responder.
 */
export const sendPrivateMediaConnect = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    fromUserId: v.string(), // prompt owner sending the request
  },
  handler: async (ctx, { privateMediaId, fromUserId }) => {
    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // Only prompt owner can send connect
    if (item.toUserId !== fromUserId) {
      throw new Error('Access denied');
    }

    // Can only connect if not already connected/pending
    if (item.connectStatus !== 'none') {
      return { success: false, reason: 'Already processed' };
    }

    // Update connect status
    await ctx.db.patch(privateMediaId, {
      connectStatus: 'pending',
    });

    // Create a connect request in todConnectRequests
    await ctx.db.insert('todConnectRequests', {
      promptId: item.promptId,
      answerId: item._id as string, // using privateMediaId as reference
      fromUserId: fromUserId, // prompt owner
      toUserId: item.fromUserId, // responder
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Reject/remove a private media connect opportunity.
 */
export const rejectPrivateMediaConnect = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    fromUserId: v.string(),
  },
  handler: async (ctx, { privateMediaId, fromUserId }) => {
    const item = await ctx.db.get(privateMediaId);
    if (!item) return { success: false };

    // Only prompt owner can reject
    if (item.toUserId !== fromUserId) {
      throw new Error('Access denied');
    }

    await ctx.db.patch(privateMediaId, {
      connectStatus: 'rejected',
    });

    return { success: true };
  },
});

/**
 * Cleanup expired private media (called periodically).
 * Deletes storage and marks records where timer expired.
 */
export const cleanupExpiredPrivateMedia = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find items that are viewing and past expiry
    const expiredViewing = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_status', (q) => q.eq('status', 'viewing'))
      .collect();

    let cleaned = 0;
    for (const item of expiredViewing) {
      if (item.expiresAt && item.expiresAt < now) {
        // Delete storage
        if (item.storageId) {
          try {
            await ctx.storage.delete(item.storageId);
          } catch { /* already deleted */ }
        }
        // Mark as expired
        await ctx.db.patch(item._id, {
          status: 'expired',
          storageId: undefined,
        });
        cleaned++;
      }
    }

    // Also cleanup very old pending items (> 24 hours)
    const oldPending = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect();

    for (const item of oldPending) {
      if (item.createdAt < now - TWENTY_FOUR_HOURS_MS) {
        if (item.storageId) {
          try {
            await ctx.storage.delete(item.storageId);
          } catch { /* already deleted */ }
        }
        await ctx.db.patch(item._id, {
          status: 'expired',
          storageId: undefined,
        });
        cleaned++;
      }
    }

    return { cleaned };
  },
});

// ============================================================
// COMPREHENSIVE CLEANUP (for cron job)
// ============================================================

/**
 * cleanupExpiredTodData - Internal mutation for cron job
 *
 * Cascade deletes all expired Truth/Dare data:
 * 1) Find expired todPrompts where expiresAt <= now
 * 2) For each expired prompt:
 *    - Delete all todPrivateMedia (storage first, then record)
 *    - Delete all todAnswerLikes for answers
 *    - Delete all todConnectRequests for the prompt
 *    - Delete all todAnswers (storage first, then record)
 *    - Finally delete the todPrompts record
 */
export const cleanupExpiredTodData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allPrompts = await ctx.db.query('todPrompts').collect();

    let deletedPrompts = 0;
    let deletedAnswers = 0;
    let deletedLikes = 0;
    let deletedConnects = 0;
    let deletedPrivateMedia = 0;

    for (const prompt of allPrompts) {
      const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires > now) continue; // Not expired

      const promptIdStr = prompt._id as string;

      // 1) Delete all todPrivateMedia for this prompt
      const privateMedia = await ctx.db
        .query('todPrivateMedia')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();

      for (const pm of privateMedia) {
        // Delete storage first
        if (pm.storageId) {
          try {
            await ctx.storage.delete(pm.storageId);
          } catch { /* already deleted */ }
        }
        // Delete record
        await ctx.db.delete(pm._id);
        deletedPrivateMedia++;
      }

      // 2) Get all answers for this prompt
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();

      for (const answer of answers) {
        // 2a) Delete all likes for this answer
        const likes = await ctx.db
          .query('todAnswerLikes')
          .withIndex('by_answer', (q) => q.eq('answerId', answer._id as string))
          .collect();
        for (const like of likes) {
          await ctx.db.delete(like._id);
          deletedLikes++;
        }

        // 2b) Delete media from storage if present
        if (answer.mediaStorageId) {
          try {
            await ctx.storage.delete(answer.mediaStorageId);
          } catch { /* already deleted */ }
        }

        // 2c) Delete the answer record
        await ctx.db.delete(answer._id);
        deletedAnswers++;
      }

      // 3) Delete all connect requests for this prompt
      const connects = await ctx.db
        .query('todConnectRequests')
        .filter((q) => q.eq(q.field('promptId'), promptIdStr))
        .collect();
      for (const cr of connects) {
        await ctx.db.delete(cr._id);
        deletedConnects++;
      }

      // 4) Finally delete the prompt itself
      await ctx.db.delete(prompt._id);
      deletedPrompts++;
    }

    // Also cleanup orphaned private media past 24h expiry
    const allPrivateMedia = await ctx.db
      .query('todPrivateMedia')
      .collect();

    for (const pm of allPrivateMedia) {
      const pmExpires = pm.expiresAt ?? pm.createdAt + TWENTY_FOUR_HOURS_MS;
      if (pmExpires <= now) {
        if (pm.storageId) {
          try {
            await ctx.storage.delete(pm.storageId);
          } catch { /* already deleted */ }
        }
        await ctx.db.delete(pm._id);
        deletedPrivateMedia++;
      }
    }

    return {
      deletedPrompts,
      deletedAnswers,
      deletedLikes,
      deletedConnects,
      deletedPrivateMedia,
    };
  },
});

// ============================================================
// GLOBAL FEED & THREAD QUERIES
// ============================================================

/**
 * List all active (non-expired) prompts with their top 2 answers.
 * Ranking: totalReactionCount DESC, then createdAt DESC.
 * Respects hidden-by-reports logic for non-authors.
 */
export const listActivePromptsWithTop2Answers = query({
  args: { viewerUserId: v.optional(v.string()) },
  handler: async (ctx, { viewerUserId }) => {
    const now = Date.now();

    // Get all prompts
    const allPrompts = await ctx.db.query('todPrompts').collect();

    // Filter to active (not expired)
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      return expires > now;
    });

    // Compute totalReactionCount for each prompt (sum of all answer reactions)
    const promptReactionCounts: Record<string, number> = {};
    for (const prompt of activePrompts) {
      const promptId = prompt._id as unknown as string;
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
        .collect();
      promptReactionCounts[promptId] = answers.reduce(
        (sum, a) => sum + (a.totalReactionCount ?? 0),
        0
      );
    }

    // Sort by answerCount DESC, then createdAt ASC (older first for ties)
    // Prompts with more answers float to top; ties = older appears first (new goes to bottom)
    activePrompts.sort((a, b) => {
      // Primary: answerCount DESC (more comments = higher)
      if (b.answerCount !== a.answerCount) return b.answerCount - a.answerCount;
      // Secondary: createdAt ASC (older first, new prompts go to bottom)
      return a.createdAt - b.createdAt;
    });

    // For each prompt, get top 2 answers
    const promptsWithAnswers = await Promise.all(
      activePrompts.map(async (prompt) => {
        const promptId = prompt._id as unknown as string;

        // Get all answers for this prompt
        const answers = await ctx.db
          .query('todAnswers')
          .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
          .collect();

        // Filter: exclude hidden answers (reportCount >= 5) UNLESS viewer is the author
        const visibleAnswers = answers.filter((a) => {
          const isHidden = (a.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD;
          if (!isHidden) return true;
          // Author can always see their own answer
          return viewerUserId && a.userId === viewerUserId;
        });

        // Rank: totalReactionCount DESC, createdAt DESC
        visibleAnswers.sort((a, b) => {
          const aReactions = a.totalReactionCount ?? 0;
          const bReactions = b.totalReactionCount ?? 0;
          if (bReactions !== aReactions) return bReactions - aReactions;
          return b.createdAt - a.createdAt;
        });

        // Take top 2
        const top2 = visibleAnswers.slice(0, 2);

        // Get reaction counts for each answer
        const top2WithReactions = await Promise.all(
          top2.map(async (answer) => {
            const reactions = await ctx.db
              .query('todAnswerReactions')
              .withIndex('by_answer', (q) => q.eq('answerId', answer._id as unknown as string))
              .collect();

            // Group by emoji - use array format for Convex compatibility (no emoji keys)
            const emojiCountMap: Map<string, number> = new Map();
            for (const r of reactions) {
              emojiCountMap.set(r.emoji, (emojiCountMap.get(r.emoji) || 0) + 1);
            }
            const reactionCounts = Array.from(emojiCountMap.entries()).map(
              ([emoji, count]) => ({ emoji, count })
            );

            // Get viewer's reaction if any
            let myReaction: string | null = null;
            if (viewerUserId) {
              const myR = reactions.find((r) => r.userId === viewerUserId);
              if (myR) myReaction = myR.emoji;
            }

            return {
              _id: answer._id,
              promptId: answer.promptId,
              userId: answer.userId,
              type: answer.type,
              text: answer.text,
              mediaUrl: answer.mediaUrl,
              durationSec: answer.durationSec,
              createdAt: answer.createdAt,
              editedAt: answer.editedAt,
              totalReactionCount: answer.totalReactionCount ?? 0,
              reactionCounts,
              myReaction,
              isAnonymous: answer.isAnonymous,
              visibility: answer.visibility,
              viewMode: answer.viewMode,
              viewDurationSec: answer.viewDurationSec,
              isHiddenForOthers: (answer.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD,
            };
          })
        );

        // Check if viewer has answered this prompt
        let hasAnswered = false;
        let myAnswerId: string | null = null;
        if (viewerUserId) {
          const myAnswer = answers.find((a) => a.userId === viewerUserId);
          if (myAnswer) {
            hasAnswered = true;
            myAnswerId = myAnswer._id as unknown as string;
          }
        }

        const promptIdStr = prompt._id as unknown as string;
        return {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          answerCount: prompt.answerCount,
          activeCount: prompt.activeCount,
          createdAt: prompt.createdAt,
          expiresAt: prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS,
          // Owner profile fields for feed display
          isAnonymous: prompt.isAnonymous,
          ownerName: prompt.ownerName,
          ownerPhotoUrl: prompt.ownerPhotoUrl,
          ownerAge: prompt.ownerAge,
          ownerGender: prompt.ownerGender,
          // Engagement metrics
          totalReactionCount: promptReactionCounts[promptIdStr] ?? 0,
          // Answers and viewer state
          top2Answers: top2WithReactions,
          totalAnswers: visibleAnswers.length,
          hasAnswered,
          myAnswerId,
        };
      })
    );

    return promptsWithAnswers;
  },
});

/**
 * Get trending Truth and Dare prompts (one of each type with highest engagement).
 * Used for the "🔥 Trending" section at top of feed.
 */
export const getTrendingTruthAndDare = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all prompts
    const allPrompts = await ctx.db.query('todPrompts').collect();

    // Filter to active (not expired)
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      return expires > now;
    });

    // Compute totalReactionCount for each prompt
    const promptReactionCounts: Record<string, number> = {};
    for (const prompt of activePrompts) {
      const promptId = prompt._id as unknown as string;
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
        .collect();
      promptReactionCounts[promptId] = answers.reduce(
        (sum, a) => sum + (a.totalReactionCount ?? 0),
        0
      );
    }

    // Separate by type
    const darePrompts = activePrompts.filter((p) => p.type === 'dare');
    const truthPrompts = activePrompts.filter((p) => p.type === 'truth');

    // Sort each by answerCount DESC, then createdAt DESC (newer wins ties)
    // Trending = highest engagement based on answer count
    const sortByEngagement = (a: typeof activePrompts[0], b: typeof activePrompts[0]) => {
      // Primary: answerCount DESC
      if (b.answerCount !== a.answerCount) return b.answerCount - a.answerCount;
      // Secondary: createdAt DESC (newer first)
      return b.createdAt - a.createdAt;
    };

    darePrompts.sort(sortByEngagement);
    truthPrompts.sort(sortByEngagement);

    // Get top 1 of each
    const topDare = darePrompts[0] ?? null;
    const topTruth = truthPrompts[0] ?? null;

    // Helper to format prompt for response
    const formatPrompt = (prompt: typeof activePrompts[0] | null) => {
      if (!prompt) return null;
      const promptId = prompt._id as unknown as string;
      return {
        _id: prompt._id,
        type: prompt.type,
        text: prompt.text,
        isTrending: true,
        ownerUserId: prompt.ownerUserId,
        answerCount: prompt.answerCount,
        activeCount: prompt.activeCount,
        createdAt: prompt.createdAt,
        expiresAt: prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS,
        // Owner profile fields
        isAnonymous: prompt.isAnonymous,
        ownerName: prompt.ownerName,
        ownerPhotoUrl: prompt.ownerPhotoUrl,
        ownerAge: prompt.ownerAge,
        ownerGender: prompt.ownerGender,
        // Engagement metrics
        totalReactionCount: promptReactionCounts[promptId] ?? 0,
      };
    };

    return {
      trendingDarePrompt: formatPrompt(topDare),
      trendingTruthPrompt: formatPrompt(topTruth),
    };
  },
});

/**
 * Get full thread for a prompt - all answers with reactions.
 * Respects hidden-by-reports: hidden answers only visible to their author.
 */
export const getPromptThread = query({
  args: {
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { promptId, viewerUserId }) => {
    // Get prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return null;

    // Check if expired
    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      return {
        prompt: {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          answerCount: prompt.answerCount,
          createdAt: prompt.createdAt,
          expiresAt: expires,
          // Owner profile snapshot
          isAnonymous: prompt.isAnonymous,
          ownerName: prompt.ownerName,
          ownerPhotoUrl: prompt.ownerPhotoUrl,
          ownerAge: prompt.ownerAge,
          ownerGender: prompt.ownerGender,
        },
        answers: [],
        isExpired: true,
      };
    }

    // Get all answers
    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    // Filter hidden answers (except for author)
    const visibleAnswers = answers.filter((a) => {
      const isHidden = (a.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD;
      if (!isHidden) return true;
      return viewerUserId && a.userId === viewerUserId;
    });

    // Rank: totalReactionCount DESC, createdAt DESC
    visibleAnswers.sort((a, b) => {
      const aReactions = a.totalReactionCount ?? 0;
      const bReactions = b.totalReactionCount ?? 0;
      if (bReactions !== aReactions) return bReactions - aReactions;
      return b.createdAt - a.createdAt;
    });

    // Enrich with reactions
    const enrichedAnswers = await Promise.all(
      visibleAnswers.map(async (answer) => {
        const answerId = answer._id as unknown as string;

        const reactions = await ctx.db
          .query('todAnswerReactions')
          .withIndex('by_answer', (q) => q.eq('answerId', answerId))
          .collect();

        // Group by emoji - use array format for Convex compatibility (no emoji keys)
        const emojiCountMap: Map<string, number> = new Map();
        for (const r of reactions) {
          emojiCountMap.set(r.emoji, (emojiCountMap.get(r.emoji) || 0) + 1);
        }
        const reactionCounts = Array.from(emojiCountMap.entries()).map(
          ([emoji, count]) => ({ emoji, count })
        );

        // Get viewer's reaction
        let myReaction: string | null = null;
        if (viewerUserId) {
          const myR = reactions.find((r) => r.userId === viewerUserId);
          if (myR) myReaction = myR.emoji;
        }

        // Check if viewer reported this
        let hasReported = false;
        if (viewerUserId) {
          const report = await ctx.db
            .query('todAnswerReports')
            .withIndex('by_answer_reporter', (q) =>
              q.eq('answerId', answerId).eq('reporterId', viewerUserId)
            )
            .first();
          hasReported = !!report;
        }

        return {
          _id: answer._id,
          promptId: answer.promptId,
          userId: answer.userId,
          type: answer.type,
          text: answer.text,
          mediaUrl: answer.mediaUrl,
          mediaStorageId: answer.mediaStorageId,
          durationSec: answer.durationSec,
          createdAt: answer.createdAt,
          editedAt: answer.editedAt,
          totalReactionCount: answer.totalReactionCount ?? 0,
          reactionCounts,
          myReaction,
          isAnonymous: answer.isAnonymous,
          visibility: answer.visibility,
          viewMode: answer.viewMode,
          viewDurationSec: answer.viewDurationSec,
          isHiddenForOthers: (answer.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD,
          isOwnAnswer: viewerUserId === answer.userId,
          hasReported,
          // Author identity snapshot
          authorName: answer.authorName,
          authorPhotoUrl: answer.authorPhotoUrl,
          authorAge: answer.authorAge,
          authorGender: answer.authorGender,
          photoBlurMode: answer.photoBlurMode,
        };
      })
    );

    return {
      prompt: {
        _id: prompt._id,
        type: prompt.type,
        text: prompt.text,
        isTrending: prompt.isTrending,
        ownerUserId: prompt.ownerUserId,
        answerCount: prompt.answerCount,
        createdAt: prompt.createdAt,
        expiresAt: expires,
        // Owner profile snapshot
        isAnonymous: prompt.isAnonymous,
        ownerName: prompt.ownerName,
        ownerPhotoUrl: prompt.ownerPhotoUrl,
        ownerAge: prompt.ownerAge,
        ownerGender: prompt.ownerGender,
      },
      answers: enrichedAnswers,
      isExpired: false,
    };
  },
});

// ============================================================
// MUTATIONS WITH RATE LIMITING
// ============================================================

/**
 * Helper: Check and update rate limit
 * Returns { allowed: boolean, remaining: number }
 */
async function checkRateLimit(
  ctx: any,
  userId: string,
  actionType: 'answer' | 'reaction' | 'report' | 'claim_media'
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const limit = RATE_LIMITS[actionType];
  const windowStart = now - limit.windowMs;

  // Get existing rate limit record
  const existing = await ctx.db
    .query('todRateLimits')
    .withIndex('by_user_action', (q: any) =>
      q.eq('userId', userId).eq('actionType', actionType)
    )
    .first();

  if (!existing) {
    // Create new record
    await ctx.db.insert('todRateLimits', {
      userId,
      actionType,
      windowStart: now,
      count: 1,
    });
    return { allowed: true, remaining: limit.max - 1 };
  }

  // Check if window has expired
  if (existing.windowStart < windowStart) {
    // Reset window
    await ctx.db.patch(existing._id, {
      windowStart: now,
      count: 1,
    });
    return { allowed: true, remaining: limit.max - 1 };
  }

  // Check if under limit
  if (existing.count < limit.max) {
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
    });
    return { allowed: true, remaining: limit.max - existing.count - 1 };
  }

  return { allowed: false, remaining: 0 };
}

/**
 * Create or edit an answer (one per user per prompt).
 * Enforces: one attachment max, rate limiting.
 */
export const createOrEditAnswer = mutation({
  args: {
    promptId: v.string(),
    userId: v.string(),
    type: v.union(v.literal('text'), v.literal('photo'), v.literal('video'), v.literal('voice')),
    text: v.optional(v.string()),
    mediaStorageId: v.optional(v.id('_storage')),
    durationSec: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    visibility: v.optional(v.union(v.literal('owner_only'), v.literal('public'))),
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    viewDurationSec: v.optional(v.number()),
    // Author identity snapshot (for non-anonymous comments)
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    photoBlurMode: v.optional(v.union(v.literal('none'), v.literal('blur'))),
  },
  handler: async (ctx, args) => {
    // Validate prompt exists and not expired
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      throw new Error('Prompt has expired');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, args.userId, 'answer');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment before posting again.');
    }

    // Check for existing answer
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', args.promptId).eq('userId', args.userId)
      )
      .first();

    // If type is text, require text content
    if (args.type === 'text' && (!args.text || args.text.trim().length === 0)) {
      throw new Error('Text answer requires content');
    }

    // If type is media, require mediaStorageId
    if ((args.type === 'photo' || args.type === 'video' || args.type === 'voice') && !args.mediaStorageId) {
      throw new Error('Media answer requires attachment');
    }

    // Generate media URL if storage ID provided
    let mediaUrl: string | undefined;
    if (args.mediaStorageId) {
      mediaUrl = await ctx.storage.getUrl(args.mediaStorageId) ?? undefined;
    }

    if (existing) {
      // EDIT existing answer
      // Delete old media if replacing with new
      if (existing.mediaStorageId && args.mediaStorageId && existing.mediaStorageId !== args.mediaStorageId) {
        try {
          await ctx.storage.delete(existing.mediaStorageId);
        } catch { /* already deleted */ }
      }

      await ctx.db.patch(existing._id, {
        type: args.type,
        text: args.text,
        mediaStorageId: args.mediaStorageId,
        mediaUrl,
        durationSec: args.durationSec,
        isAnonymous: args.isAnonymous,
        visibility: args.visibility ?? 'public',
        viewMode: args.viewMode,
        viewDurationSec: args.viewDurationSec,
        editedAt: now,
        // Author identity snapshot
        authorName: args.authorName,
        authorPhotoUrl: args.authorPhotoUrl,
        authorAge: args.authorAge,
        authorGender: args.authorGender,
        photoBlurMode: args.photoBlurMode,
      });

      return { answerId: existing._id, isEdit: true };
    } else {
      // CREATE new answer
      const answerId = await ctx.db.insert('todAnswers', {
        promptId: args.promptId,
        userId: args.userId,
        type: args.type,
        text: args.text,
        mediaStorageId: args.mediaStorageId,
        mediaUrl,
        durationSec: args.durationSec,
        likeCount: 0,
        createdAt: now,
        isAnonymous: args.isAnonymous,
        visibility: args.visibility ?? 'public',
        viewMode: args.viewMode,
        viewDurationSec: args.viewDurationSec,
        totalReactionCount: 0,
        reportCount: 0,
        // Author identity snapshot
        authorName: args.authorName,
        authorPhotoUrl: args.authorPhotoUrl,
        authorAge: args.authorAge,
        authorGender: args.authorGender,
        photoBlurMode: args.photoBlurMode,
      });

      // Increment answer count on prompt
      await ctx.db.patch(prompt._id, {
        answerCount: prompt.answerCount + 1,
        activeCount: prompt.activeCount + 1,
      });

      return { answerId, isEdit: false };
    }
  },
});

/**
 * Set (upsert) an emoji reaction on an answer.
 * One reaction per user per answer. Changing updates counts.
 */
export const setAnswerReaction = mutation({
  args: {
    answerId: v.string(),
    userId: v.string(),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { answerId, userId, emoji }) => {
    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userId, 'reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    const now = Date.now();

    // Check for existing reaction
    const existing = await ctx.db
      .query('todAnswerReactions')
      .withIndex('by_answer_user', (q) =>
        q.eq('answerId', answerId).eq('userId', userId)
      )
      .first();

    if (emoji === '' || !emoji) {
      // Remove reaction
      if (existing) {
        await ctx.db.delete(existing._id);
        // Decrement count
        const newCount = Math.max(0, (answer.totalReactionCount ?? 0) - 1);
        await ctx.db.patch(answer._id, { totalReactionCount: newCount });
      }
      return { action: 'removed' };
    }

    if (existing) {
      // Update reaction
      if (existing.emoji !== emoji) {
        await ctx.db.patch(existing._id, {
          emoji,
          updatedAt: now,
        });
        return { action: 'changed', oldEmoji: existing.emoji, newEmoji: emoji };
      }
      return { action: 'unchanged' };
    } else {
      // Create new reaction
      await ctx.db.insert('todAnswerReactions', {
        answerId,
        userId,
        emoji,
        createdAt: now,
      });
      // Increment count
      await ctx.db.patch(answer._id, {
        totalReactionCount: (answer.totalReactionCount ?? 0) + 1,
      });
      return { action: 'added', emoji };
    }
  },
});

/**
 * Report an answer.
 * Rate limited per day. Same user can't report same answer twice.
 * If answer reaches 5 unique reports, it's hidden from everyone except author.
 */
export const reportAnswer = mutation({
  args: {
    answerId: v.string(),
    reporterId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { answerId, reporterId, reason }) => {
    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    // Can't report own answer
    if (answer.userId === reporterId) {
      throw new Error("You can't report your own answer");
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer_reporter', (q) =>
        q.eq('answerId', answerId).eq('reporterId', reporterId)
      )
      .first();

    if (existingReport) {
      throw new Error('You have already reported this answer');
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, reporterId, 'report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    // Create report
    await ctx.db.insert('todAnswerReports', {
      answerId,
      reporterId,
      reason,
      createdAt: Date.now(),
    });

    // Increment report count
    const newReportCount = (answer.reportCount ?? 0) + 1;
    await ctx.db.patch(answer._id, { reportCount: newReportCount });

    // Check if threshold reached
    const isNowHidden = newReportCount >= REPORT_HIDE_THRESHOLD;

    return {
      success: true,
      reportCount: newReportCount,
      isNowHidden,
    };
  },
});

/**
 * Get user's answer for a prompt (for editing)
 */
export const getUserAnswer = query({
  args: {
    promptId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, { promptId, userId }) => {
    const answer = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', userId)
      )
      .first();

    return answer;
  },
});

/**
 * Delete user's own answer
 */
export const deleteMyAnswer = mutation({
  args: {
    answerId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, { answerId, userId }) => {
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    if (answer.userId !== userId) {
      throw new Error('You can only delete your own answers');
    }

    // Delete media if exists
    if (answer.mediaStorageId) {
      try {
        await ctx.storage.delete(answer.mediaStorageId);
      } catch { /* already deleted */ }
    }

    // Delete all reactions for this answer
    const reactions = await ctx.db
      .query('todAnswerReactions')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();
    for (const r of reactions) {
      await ctx.db.delete(r._id);
    }

    // Delete all reports for this answer
    const reports = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();
    for (const r of reports) {
      await ctx.db.delete(r._id);
    }

    // Delete all view records for this answer (cleanup todAnswerViews)
    const views = await ctx.db
      .query('todAnswerViews')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();
    for (const v of views) {
      await ctx.db.delete(v._id);
    }

    // Decrement prompt answer count
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();
    if (prompt && prompt.answerCount > 0) {
      await ctx.db.patch(prompt._id, {
        answerCount: prompt.answerCount - 1,
        activeCount: Math.max(0, prompt.activeCount - 1),
      });
    }

    // Delete the answer
    await ctx.db.delete(answer._id);

    return { success: true };
  },
});

// ============================================================
// SECURE ANSWER MEDIA VIEWING APIs
// ============================================================

/**
 * Claim viewing rights for an answer's secure media.
 * - For 'owner_only' visibility: only prompt owner can view
 * - For 'public' visibility: anyone can view, but only once
 * Enforces one-time viewing via todAnswerViews tracking.
 */
export const claimAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    viewerId: v.string(),
  },
  handler: async (ctx, { answerId, viewerId }) => {
    // Rate limit check
    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    // Get the answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      return { status: 'no_media' as const };
    }

    // Must have media
    if (!answer.mediaStorageId) {
      return { status: 'no_media' as const };
    }

    // Check if media was already deleted (prompt owner viewed it)
    if (answer.promptOwnerViewedAt) {
      return { status: 'already_deleted' as const };
    }

    // Get the prompt to check ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return { status: 'no_media' as const };
    }

    const isPromptOwner = prompt.ownerUserId === viewerId;
    const isAnswerAuthor = answer.userId === viewerId;

    // Authorization check based on visibility
    if (answer.visibility === 'owner_only') {
      // Only prompt owner can view owner_only media
      if (!isPromptOwner) {
        return { status: 'not_authorized' as const };
      }
    }

    // Determine role for frontend
    let role: 'owner' | 'sender' | 'viewer';
    if (isPromptOwner) {
      role = 'owner';
    } else if (isAnswerAuthor) {
      role = 'sender';
    } else {
      role = 'viewer';
    }

    // Check if already viewed (one-time enforcement)
    // Answer author can always re-view their own media
    if (!isAnswerAuthor) {
      const existingView = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer_viewer', (q) =>
          q.eq('answerId', answerId).eq('viewerUserId', viewerId)
        )
        .first();

      if (existingView) {
        return { status: 'already_viewed' as const };
      }
    }

    // Record the view (for non-authors)
    if (!isAnswerAuthor) {
      await ctx.db.insert('todAnswerViews', {
        answerId,
        viewerUserId: viewerId,
        viewedAt: Date.now(),
      });
    }

    // Mark first claim time if not set
    if (!answer.mediaViewedAt) {
      await ctx.db.patch(answer._id, {
        mediaViewedAt: Date.now(),
      });
    }

    // Generate fresh URL via storage
    const url = await ctx.storage.getUrl(answer.mediaStorageId);
    if (!url) {
      return { status: 'no_media' as const };
    }

    return {
      status: 'ok' as const,
      url,
      mediaType: answer.type as 'photo' | 'video',
      viewMode: (answer.viewMode ?? 'tap') as 'tap' | 'hold',
      durationSec: answer.viewDurationSec ?? 10,
      role,
      isFrontCamera: answer.isFrontCamera ?? false,
    };
  },
});

/**
 * Finalize answer media view.
 * If prompt owner is viewing, marks media as viewed and deletes storage.
 */
export const finalizeAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    viewerId: v.string(),
  },
  handler: async (ctx, { answerId, viewerId }) => {
    // Get the answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      return { status: 'not_found' as const };
    }

    // Get the prompt to check ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return { status: 'not_found' as const };
    }

    const isPromptOwner = prompt.ownerUserId === viewerId;

    // If prompt owner finalized viewing, delete media for everyone
    if (isPromptOwner && answer.mediaStorageId && !answer.promptOwnerViewedAt) {
      // Delete storage file
      try {
        await ctx.storage.delete(answer.mediaStorageId);
      } catch {
        // Already deleted
      }

      // Mark as viewed by owner (this locks it for everyone)
      await ctx.db.patch(answer._id, {
        promptOwnerViewedAt: Date.now(),
        mediaStorageId: undefined,
        mediaUrl: undefined,
      });
    }

    return { status: 'ok' as const };
  },
});

/**
 * Get URL for voice message playback.
 * Voice messages are NOT one-time secure - they can be replayed.
 */
export const getVoiceUrl = query({
  args: {
    answerId: v.string(),
  },
  handler: async (ctx, { answerId }) => {
    // Get the answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      return { status: 'not_found' as const };
    }

    // Must be voice type
    if (answer.type !== 'voice') {
      return { status: 'not_voice' as const };
    }

    // Try mediaUrl first (may already be set)
    if (answer.mediaUrl) {
      return { status: 'ok' as const, url: answer.mediaUrl };
    }

    // Generate from storageId
    if (answer.mediaStorageId) {
      const url = await ctx.storage.getUrl(answer.mediaStorageId);
      if (url) {
        return { status: 'ok' as const, url };
      }
    }

    return { status: 'no_media' as const };
  },
});
