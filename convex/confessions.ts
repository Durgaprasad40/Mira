import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

// Phone number & email patterns for server-side validation
const PHONE_PATTERN = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Confession expiry duration (24 hours in milliseconds)
const CONFESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

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
    taggedUserId: v.optional(v.id('users')), // User being confessed to
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

    // If taggedUserId provided, verify the current user has liked them
    if (args.taggedUserId) {
      const likeRecord = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', args.userId).eq('toUserId', args.taggedUserId!)
        )
        .filter((q) =>
          q.or(
            q.eq(q.field('action'), 'like'),
            q.eq(q.field('action'), 'super_like'),
            q.eq(q.field('action'), 'text')
          )
        )
        .first();

      if (!likeRecord) {
        throw new Error('You can only confess to users you have liked.');
      }
    }

    const now = Date.now();
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
      createdAt: now,
      expiresAt: now + CONFESSION_EXPIRY_MS,
      taggedUserId: args.taggedUserId,
    });

    // If tagged, create notification for the tagged user
    if (args.taggedUserId) {
      await ctx.db.insert('confessionNotifications', {
        userId: args.taggedUserId,
        confessionId,
        fromUserId: args.userId,
        type: 'TAGGED_CONFESSION',
        seen: false,
        createdAt: now,
      });
    }

    return confessionId;
  },
});

// List confessions (latest) with 2 reply previews per confession
// Only returns non-expired confessions for public feed
export const listConfessions = query({
  args: {
    sortBy: v.union(v.literal('trending'), v.literal('latest')),
  },
  handler: async (ctx, { sortBy }) => {
    const now = Date.now();
    const allConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // Filter out expired confessions (expiresAt <= now, or undefined = legacy, include)
    const confessions = allConfessions.filter(
      (c) => c.expiresAt === undefined || c.expiresAt > now
    );

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
// Only returns non-expired confessions
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

    // Filter to last 48h AND not expired
    const recent = confessions.filter(
      (c) => c.createdAt > cutoff && (c.expiresAt === undefined || c.expiresAt > now)
    );

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
// Special behavior: if tagged user likes a tagged confession, create a DM thread
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
    if (!confession) return { added: false, replaced: false, chatUnlocked: false };

    if (existing) {
      if (existing.type === args.type) {
        // Same emoji → remove (toggle off)
        await ctx.db.delete(existing._id);
        await ctx.db.patch(args.confessionId, {
          reactionCount: Math.max(0, confession.reactionCount - 1),
        });
        return { added: false, replaced: false, chatUnlocked: false };
      } else {
        // Different emoji → replace (count stays the same)
        await ctx.db.patch(existing._id, {
          type: args.type,
          createdAt: Date.now(),
        });
        return { added: false, replaced: true, chatUnlocked: false };
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

      // SPECIAL: If tagged user likes a tagged confession, create/find a DM thread
      let chatUnlocked = false;
      if (confession.taggedUserId && args.userId === confession.taggedUserId) {
        // Check if conversation already exists for this confession (idempotency)
        const existingConvo = await ctx.db
          .query('conversations')
          .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
          .first();

        if (!existingConvo) {
          // Create new conversation between author and tagged user
          const now = Date.now();
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
          await ctx.db.insert('conversations', {
            confessionId: args.confessionId,
            participants: [confession.userId, confession.taggedUserId],
            isPreMatch: true, // Confession-based threads are pre-match
            createdAt: now,
            lastMessageAt: now,
            expiresAt: now + TWENTY_FOUR_HOURS, // Confession chats expire in 24h
          });
          chatUnlocked = true;
        }
      }

      return { added: true, replaced: false, chatUnlocked };
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

// Get user's own confessions (all, including expired, with isExpired flag)
export const getMyConfessions = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();

    // Add isExpired flag for each confession
    return confessions.map((c) => ({
      ...c,
      isExpired: c.expiresAt !== undefined && c.expiresAt <= now,
    }));
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

// ============ TAGGED CONFESSION NOTIFICATIONS ============

// Get badge count of unseen tagged confessions for a user
export const getTaggedConfessionBadgeCount = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_seen', (q) => q.eq('userId', userId).eq('seen', false))
      .collect();
    return notifications.length;
  },
});

// List tagged confessions for a user (privacy-safe: only for the tagged user's view)
export const listTaggedConfessionsForUser = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const now = Date.now();

    // Get notifications for this user (limit 50)
    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .order('desc')
      .take(50);

    // Join with confession data
    const result = [];
    for (const notif of notifications) {
      const confession = await ctx.db.get(notif.confessionId);
      if (!confession) continue;

      result.push({
        notificationId: notif._id,
        confessionId: notif.confessionId,
        seen: notif.seen,
        notificationCreatedAt: notif.createdAt,
        // Confession data (do NOT include authorName or any identity info)
        confessionText: confession.text,
        confessionMood: confession.mood,
        confessionCreatedAt: confession.createdAt,
        confessionExpiresAt: confession.expiresAt,
        isExpired: confession.expiresAt !== undefined && confession.expiresAt <= now,
        replyCount: confession.replyCount,
        reactionCount: confession.reactionCount,
      });
    }

    return result;
  },
});

// Mark tagged confession notifications as seen
export const markTaggedConfessionsSeen = mutation({
  args: {
    userId: v.id('users'),
    notificationIds: v.optional(v.array(v.id('confessionNotifications'))),
  },
  handler: async (ctx, args) => {
    const { userId, notificationIds } = args;

    if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications as seen
      for (const notifId of notificationIds) {
        const notif = await ctx.db.get(notifId);
        if (notif && notif.userId === userId && !notif.seen) {
          await ctx.db.patch(notifId, { seen: true });
        }
      }
    } else {
      // Mark all unseen notifications for this user as seen
      const unseen = await ctx.db
        .query('confessionNotifications')
        .withIndex('by_user_seen', (q) => q.eq('userId', userId).eq('seen', false))
        .collect();

      for (const notif of unseen) {
        await ctx.db.patch(notif._id, { seen: true });
      }
    }

    return { success: true };
  },
});
