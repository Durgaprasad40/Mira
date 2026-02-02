import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

// Phone number & email patterns for server-side validation
const PHONE_PATTERN = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Create a new confession
export const createConfession = mutation({
  args: {
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trimmed = args.text.trim();
    if (trimmed.length < 10) {
      throw new Error('Confession must be at least 10 characters.');
    }
    if (PHONE_PATTERN.test(trimmed)) {
      throw new Error('Do not include phone numbers in confessions.');
    }
    if (EMAIL_PATTERN.test(trimmed)) {
      throw new Error('Do not include email addresses in confessions.');
    }

    const confessionId = await ctx.db.insert('confessions', {
      userId: args.userId,
      text: trimmed,
      isAnonymous: args.isAnonymous,
      mood: args.mood,
      visibility: args.visibility,
      imageUrl: args.imageUrl,
      authorName: args.isAnonymous ? undefined : args.authorName,
      authorPhotoUrl: args.isAnonymous ? undefined : args.authorPhotoUrl,
      replyCount: 0,
      reactionCount: 0,
      voiceReplyCount: 0,
      createdAt: Date.now(),
    });
    return confessionId;
  },
});

// List confessions (latest) with 2 reply previews per confession
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

    // Attach 2 reply previews per confession
    const withPreviews = await Promise.all(
      confessions.map(async (c) => {
        const replies = await ctx.db
          .query('confessionReplies')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .order('asc')
          .take(2);

        // Get top 3 emoji reactions for display
        const allReactions = await ctx.db
          .query('confessionReactions')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .collect();
        const emojiCounts: Record<string, number> = {};
        for (const r of allReactions) {
          // Skip old string-based reaction keys (e.g. "relatable", "bold")
          if (/^[a-zA-Z0-9_\s]+$/.test(r.type)) continue;
          emojiCounts[r.type] = (emojiCounts[r.type] || 0) + 1;
        }
        const topEmojis = Object.entries(emojiCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([emoji, count]) => ({ emoji, count }));

        return {
          ...c,
          replyPreviews: replies.map((r) => ({
            _id: r._id,
            text: r.text,
            isAnonymous: r.isAnonymous,
            type: r.type || 'text',
            createdAt: r.createdAt,
          })),
          topEmojis,
        };
      })
    );

    if (sortBy === 'trending') {
      withPreviews.sort((a, b) => {
        const scoreA = a.replyCount * 2 + a.reactionCount;
        const scoreB = b.replyCount * 2 + b.reactionCount;
        return scoreB - scoreA;
      });
    }

    return withPreviews;
  },
});

// Get trending confessions (last 48h, time-decay scoring)
export const getTrendingConfessions = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000; // 48 hours ago

    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // Filter to last 48h
    const recent = confessions.filter((c) => c.createdAt > cutoff);

    // Time-decay scoring: score = ((reactionCount * 3) + (commentCount * 4) + (voiceReplyCount * 4)) / (hoursSinceCreated + 2)
    const scored = recent.map((c) => {
      const hoursSince = (now - c.createdAt) / (1000 * 60 * 60);
      const voiceReplies = c.voiceReplyCount || 0;
      const score =
        (c.reactionCount * 3 + c.replyCount * 4 + voiceReplies * 4) /
        (hoursSince + 2);
      return { ...c, trendingScore: score };
    });

    scored.sort((a, b) => b.trendingScore - a.trendingScore);

    // Return top 5 trending
    return scored.slice(0, 5);
  },
});

// Get a single confession by ID
export const getConfession = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    return await ctx.db.get(confessionId);
  },
});

// Create a reply to a confession (text or voice only — no images/videos/gifs)
export const createReply = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const replyType = args.type || 'text';

    if (replyType === 'text') {
      const trimmed = args.text.trim();
      if (trimmed.length < 1) {
        throw new Error('Reply cannot be empty.');
      }
      if (PHONE_PATTERN.test(trimmed)) {
        throw new Error('Do not include phone numbers.');
      }
      if (EMAIL_PATTERN.test(trimmed)) {
        throw new Error('Do not include email addresses.');
      }
    }

    const replyId = await ctx.db.insert('confessionReplies', {
      confessionId: args.confessionId,
      userId: args.userId,
      text: args.text.trim(),
      isAnonymous: args.isAnonymous,
      type: replyType,
      voiceUrl: args.voiceUrl,
      voiceDurationSec: args.voiceDurationSec,
      createdAt: Date.now(),
    });

    // Increment reply count (and voice reply count if applicable)
    const confession = await ctx.db.get(args.confessionId);
    if (confession) {
      const patch: any = { replyCount: confession.replyCount + 1 };
      if (replyType === 'voice') {
        patch.voiceReplyCount = (confession.voiceReplyCount || 0) + 1;
      }
      await ctx.db.patch(args.confessionId, patch);
    }

    return replyId;
  },
});

// Delete own reply
export const deleteReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== args.userId) throw new Error('You can only delete your own replies.');

    await ctx.db.delete(args.replyId);

    // Decrement reply count
    const confession = await ctx.db.get(reply.confessionId);
    if (confession) {
      const patch: any = {
        replyCount: Math.max(0, confession.replyCount - 1),
      };
      if (reply.type === 'voice') {
        patch.voiceReplyCount = Math.max(0, (confession.voiceReplyCount || 0) - 1);
      }
      await ctx.db.patch(reply.confessionId, patch);
    }

    return { success: true };
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

// Toggle emoji reaction — one emoji per user per confession (toggle/replace)
export const toggleReaction = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    type: v.string(), // any emoji string
  },
  handler: async (ctx, args) => {
    // Find existing reaction from this user on this confession
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', args.userId)
      )
      .first();

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) return { added: false, replaced: false };

    if (existing) {
      if (existing.type === args.type) {
        // Same emoji → remove (toggle off)
        await ctx.db.delete(existing._id);
        await ctx.db.patch(args.confessionId, {
          reactionCount: Math.max(0, confession.reactionCount - 1),
        });
        return { added: false, replaced: false };
      } else {
        // Different emoji → replace (count stays the same)
        await ctx.db.patch(existing._id, {
          type: args.type,
          createdAt: Date.now(),
        });
        return { added: false, replaced: true };
      }
    } else {
      // No existing → add new
      await ctx.db.insert('confessionReactions', {
        confessionId: args.confessionId,
        userId: args.userId,
        type: args.type,
        createdAt: Date.now(),
      });
      await ctx.db.patch(args.confessionId, {
        reactionCount: confession.reactionCount + 1,
      });
      return { added: true, replaced: false };
    }
  },
});

// Get all reactions for a confession (grouped by emoji)
export const getReactionCounts = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .collect();
    const emojiCounts: Record<string, number> = {};
    for (const r of reactions) {
      // Skip old string-based reaction keys (e.g. "relatable", "bold")
      if (/^[a-zA-Z0-9_\s]+$/.test(r.type)) continue;
      emojiCounts[r.type] = (emojiCounts[r.type] || 0) + 1;
    }
    // Return top emojis sorted by count
    const topEmojis = Object.entries(emojiCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji, count]) => ({ emoji, count }));
    return topEmojis;
  },
});

// Get user's reaction on a confession (single emoji or null)
export const getUserReaction = query({
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
    return existing ? existing.type : null;
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

// Report a confession
export const reportConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    reporterId: v.id('users'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('confessionReports', {
      confessionId: args.confessionId,
      reporterId: args.reporterId,
      reason: args.reason,
      createdAt: Date.now(),
    });
    return { success: true };
  },
});
