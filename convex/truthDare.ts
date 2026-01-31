import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
      const expires = p.expiresAt ?? p.createdAt + SEVEN_DAYS_MS;
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
      .filter((q) => q.eq(q.field('_id'), args.promptId as any))
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
      .filter((q) => q.eq(q.field('_id'), answerId as any))
      .first();
    if (answer) {
      await ctx.db.patch(answer._id, { likeCount: answer.likeCount + 1 });

      // Get the prompt to find owner
      const prompt = await ctx.db
        .query('todPrompts')
        .filter((q) => q.eq(q.field('_id'), answer.promptId as any))
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
        .filter((q) => q.eq(q.field('_id'), answerId as any))
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
      expiresAt: now + SEVEN_DAYS_MS,
    });

    await ctx.db.insert('todPrompts', {
      type: 'dare',
      text: 'Record a 15-second video of your best impression of your celebrity crush!',
      isTrending: true,
      ownerUserId: 'system',
      answerCount: 27,
      activeCount: 11,
      createdAt: now,
      expiresAt: now + SEVEN_DAYS_MS,
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
      const expires = prompt.expiresAt ?? prompt.createdAt + SEVEN_DAYS_MS;
      if (expires > now) continue;

      // Delete all answers for this prompt
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as any))
        .collect();

      for (const answer of answers) {
        // Delete media from storage if present
        if (answer.mediaStorageId) {
          await ctx.storage.delete(answer.mediaStorageId);
        }
        // Delete likes for this answer
        const likes = await ctx.db
          .query('todAnswerLikes')
          .withIndex('by_answer', (q) => q.eq('answerId', answer._id as any))
          .collect();
        for (const like of likes) {
          await ctx.db.delete(like._id);
        }
        // Delete connect requests for this answer
        const connects = await ctx.db
          .query('todConnectRequests')
          .filter((q) => q.eq(q.field('answerId'), answer._id as any))
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
    return await ctx.storage.generateUploadUrl();
  },
});
