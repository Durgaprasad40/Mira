import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

// Create a new confession
export const createConfession = mutation({
  args: {
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
  },
  handler: async (ctx, args) => {
    const confessionId = await ctx.db.insert('confessions', {
      userId: args.userId,
      text: args.text,
      isAnonymous: args.isAnonymous,
      mood: args.mood,
      visibility: args.visibility,
      replyCount: 0,
      reactionCount: 0,
      createdAt: Date.now(),
    });
    return confessionId;
  },
});

// List confessions sorted by trending or latest
export const listConfessions = query({
  args: {
    sortBy: v.union(v.literal('trending'), v.literal('latest')),
  },
  handler: async (ctx, { sortBy }) => {
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    if (sortBy === 'trending') {
      confessions.sort((a, b) => {
        const scoreA = a.replyCount * 2 + a.reactionCount;
        const scoreB = b.replyCount * 2 + b.reactionCount;
        return scoreB - scoreA;
      });
    }

    return confessions;
  },
});

// Get a single confession by ID
export const getConfession = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    return await ctx.db.get(confessionId);
  },
});

// Create a reply to a confession
export const createReply = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
  },
  handler: async (ctx, args) => {
    const replyId = await ctx.db.insert('confessionReplies', {
      confessionId: args.confessionId,
      userId: args.userId,
      text: args.text,
      isAnonymous: args.isAnonymous,
      createdAt: Date.now(),
    });

    // Increment reply count on the confession
    const confession = await ctx.db.get(args.confessionId);
    if (confession) {
      await ctx.db.patch(args.confessionId, {
        replyCount: confession.replyCount + 1,
      });
    }

    return replyId;
  },
});

// Get replies for a confession
export const getReplies = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .order('asc')
      .collect();
    return replies;
  },
});

// Toggle a reaction on a confession
export const toggleReaction = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    type: v.literal('heart'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', args.userId)
      )
      .first();

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) return { added: false };

    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(args.confessionId, {
        reactionCount: Math.max(0, confession.reactionCount - 1),
      });
      return { added: false };
    } else {
      await ctx.db.insert('confessionReactions', {
        confessionId: args.confessionId,
        userId: args.userId,
        type: args.type,
        createdAt: Date.now(),
      });
      await ctx.db.patch(args.confessionId, {
        reactionCount: confession.reactionCount + 1,
      });
      return { added: true };
    }
  },
});

// Get reaction counts for a confession
export const getReactionCounts = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .collect();
    return { heart: reactions.length };
  },
});

// Check if user has reacted to a confession
export const hasUserReacted = query({
  args: {
    confessionId: v.id('confessions'),
    userId: v.id('users'),
  },
  handler: async (ctx, { confessionId, userId }) => {
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', confessionId).eq('userId', userId)
      )
      .first();
    return !!existing;
  },
});

// Get user's own confessions
export const getMyConfessions = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();
    return confessions;
  },
});
