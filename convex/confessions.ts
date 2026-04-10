import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId } from './helpers';

// Phone number & email patterns for server-side validation
const PHONE_PATTERN = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Confession expiry duration (24 hours in milliseconds)
const CONFESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// P1-01: Server-side rate limit (5 confessions per 24 hours)
const CONFESSION_RATE_LIMIT = 5;

const CONFESSION_FEED_LIMIT = 50;
const CONFESSION_FEED_SCAN_LIMIT = 150;
const CONFESSION_PREVIEW_REPLY_SCAN_LIMIT = 25;
const CONFESSION_TRENDING_LIMIT = 5;
const CONFESSION_TRENDING_SCAN_LIMIT = 200;
const CONFESSION_REPLY_LIMIT = 200;
const MY_CONFESSIONS_LIMIT = 100;
const TAGGED_CONFESSION_LIMIT = 50;
const CONNECT_CLEANUP_BATCH = 100;

async function getCachedConfession(
  ctx: { db: any },
  cache: Map<Id<'confessions'>, Doc<'confessions'> | null>,
  confessionId: Id<'confessions'>
) {
  if (cache.has(confessionId)) {
    return cache.get(confessionId) ?? null;
  }

  const confession = await ctx.db.get(confessionId);
  cache.set(confessionId, confession ?? null);
  return confession ?? null;
}

async function getCachedReply(
  ctx: { db: any },
  cache: Map<Id<'confessionReplies'>, Doc<'confessionReplies'> | null>,
  replyId: Id<'confessionReplies'>
) {
  if (cache.has(replyId)) {
    return cache.get(replyId) ?? null;
  }

  const reply = await ctx.db.get(replyId);
  cache.set(replyId, reply ?? null);
  return reply ?? null;
}

async function getAuthenticatedConfessionUserIdOrNull(
  ctx: QueryCtx | MutationCtx
): Promise<Id<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  return await resolveUserIdByAuthId(ctx, identity.subject);
}

async function requireAuthenticatedConfessionMutationUserId(
  ctx: MutationCtx
): Promise<Id<'users'>> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error('Authentication required');
  }

  return await ensureUserByAuthId(ctx, identity.subject);
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return fallback;
  }
  const rounded = Math.floor(requested);
  if (rounded < 1) return fallback;
  return Math.min(rounded, max);
}

// Create a new confession
export const createConfession = mutation({
  args: {
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    taggedUserId: v.optional(v.union(v.id('users'), v.string())), // User being confessed to
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);

    // P1-01: Server-side rate limiting - count confessions in last 24 hours
    const now = Date.now();
    const twentyFourHoursAgo = now - CONFESSION_EXPIRY_MS;
    const recentConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.gt(q.field('createdAt'), twentyFourHoursAgo))
      .collect();

    if (recentConfessions.length >= CONFESSION_RATE_LIMIT) {
      throw new Error('You have reached the confession limit. Please try again later.');
    }

    // Map taggedUserId if provided (MUTATION: can create)
    let taggedUserId: Id<'users'> | undefined;
    if (args.taggedUserId) {
      taggedUserId = await resolveUserIdByAuthId(ctx, args.taggedUserId as string) ?? undefined;
      if (!taggedUserId) {
        throw new Error('Tagged user not found.');
      }
    }

    const trimmed = args.text.trim();
    if (trimmed.length < 10) {
      throw new Error('Confession must be at least 10 characters.');
    }
    // P2-1 FIX: Add max length validation to prevent DoS/database bloat
    if (trimmed.length > 5000) {
      throw new Error('Confession must be 5000 characters or less.');
    }
    if (PHONE_PATTERN.test(trimmed)) {
      throw new Error('Do not include phone numbers in confessions.');
    }
    if (EMAIL_PATTERN.test(trimmed)) {
      throw new Error('Do not include email addresses in confessions.');
    }

    // If taggedUserId provided, verify the current user has liked them
    if (taggedUserId) {
      const likeRecord = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', taggedUserId!)
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

    const confessionId = await ctx.db.insert('confessions', {
      userId: userId,
      text: trimmed,
      isAnonymous: args.isAnonymous,
      mood: args.mood,
      visibility: args.visibility,
      imageUrl: args.imageUrl,
      authorName: args.isAnonymous ? undefined : args.authorName,
      authorPhotoUrl: args.isAnonymous ? undefined : args.authorPhotoUrl,
      authorAge: args.isAnonymous ? undefined : args.authorAge,
      authorGender: args.isAnonymous ? undefined : args.authorGender,
      replyCount: 0,
      reactionCount: 0,
      voiceReplyCount: 0,
      createdAt: now,
      expiresAt: now + CONFESSION_EXPIRY_MS,
      taggedUserId: taggedUserId,
    });

    // If tagged, create notification for the tagged user
    if (taggedUserId) {
      await ctx.db.insert('confessionNotifications', {
        userId: taggedUserId,
        confessionId,
        fromUserId: userId,
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
    refreshKey: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sortBy, limit: limitArg }) => {
    const now = Date.now();
    const viewerId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    const limit = clampLimit(limitArg, CONFESSION_FEED_LIMIT, CONFESSION_FEED_LIMIT);
    const fetchLimit = Math.min(Math.max(limit * 3, CONFESSION_FEED_LIMIT), CONFESSION_FEED_SCAN_LIMIT);

    let blockedAuthorIds = new Set<Id<'users'>>();
    let reportedConfessionIds = new Set<Id<'confessions'>>();
    let reportedReplyIds = new Set<Id<'confessionReplies'>>();

    if (viewerId) {
      const [blocks, reports, replyReports] = await Promise.all([
        ctx.db
          .query('blocks')
          .withIndex('by_blocker', (q) => q.eq('blockerId', viewerId))
          .collect(),
        ctx.db
          .query('confessionReports')
          .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
          .collect(),
        ctx.db
          .query('replyReports')
          .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
          .collect(),
      ]);

      blockedAuthorIds = new Set(blocks.map((block) => block.blockedUserId));
      reportedConfessionIds = new Set(reports.map((report) => report.confessionId));
      reportedReplyIds = new Set(replyReports.map((report) => report.replyId));
    }

    const allConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .take(fetchLimit);

    // Filter out expired, deleted, reported-for-viewer, and blocked-author confessions
    const confessions = allConfessions.filter(
      (c) =>
        (c.expiresAt === undefined || c.expiresAt > now) &&
        !c.isDeleted &&
        !reportedConfessionIds.has(c._id) &&
        !blockedAuthorIds.has(c.userId)
    );

    // Attach 2 reply previews per confession
    const withPreviews = await Promise.all(
      confessions.map(async (c) => {
        const replies = await ctx.db
          .query('confessionReplies')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .order('asc')
          .take(CONFESSION_PREVIEW_REPLY_SCAN_LIMIT);
        const visibleReplies = reportedReplyIds.size > 0
          ? replies.filter((reply) => !reportedReplyIds.has(reply._id))
          : replies;

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

        // P1-02: Omit taggedUserId from anonymous confessions to prevent privacy leak
        const { taggedUserId: _omitTagged, ...confessionWithoutTagged } = c;
        const safeConfession = c.isAnonymous ? confessionWithoutTagged : c;

        return {
          ...safeConfession,
          replyPreviews: visibleReplies.slice(0, 2).map((r) => ({
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
      // Improved trending scoring with time decay
      // Replies are strongest signal (weight 5), reactions medium (weight 2)
      // Time decay reduces score for older confessions
      withPreviews.sort((a, b) => {
        const hoursSinceA = (now - a.createdAt) / (1000 * 60 * 60);
        const hoursSinceB = (now - b.createdAt) / (1000 * 60 * 60);

        // Score formula: (replies * 5 + reactions * 2) / (hours + 2)
        // The +2 prevents division by zero and gives new posts a baseline
        const scoreA = (a.replyCount * 5 + a.reactionCount * 2) / (hoursSinceA + 2);
        const scoreB = (b.replyCount * 5 + b.reactionCount * 2) / (hoursSinceB + 2);
        return scoreB - scoreA;
      });
    }

    return withPreviews.slice(0, limit);
  },
});

// Get trending confessions (last 48h, time-decay scoring)
// Only returns non-expired confessions
export const getTrendingConfessions = query({
  args: {
    refreshKey: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit: limitArg }) => {
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000; // 48 hours ago
    const viewerId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    const limit = clampLimit(limitArg, CONFESSION_TRENDING_LIMIT, CONFESSION_TRENDING_LIMIT);

    let blockedAuthorIds = new Set<Id<'users'>>();
    let reportedConfessionIds = new Set<Id<'confessions'>>();

    if (viewerId) {
      const [blocks, reports] = await Promise.all([
        ctx.db
          .query('blocks')
          .withIndex('by_blocker', (q) => q.eq('blockerId', viewerId))
          .collect(),
        ctx.db
          .query('confessionReports')
          .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
          .collect(),
      ]);

      blockedAuthorIds = new Set(blocks.map((block) => block.blockedUserId));
      reportedConfessionIds = new Set(reports.map((report) => report.confessionId));
    }

    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .take(CONFESSION_TRENDING_SCAN_LIMIT);

    // Filter to last 48h AND not expired AND not deleted
    const recent = confessions.filter(
      (c) =>
        c.createdAt > cutoff &&
        (c.expiresAt === undefined || c.expiresAt > now) &&
        !c.isDeleted &&
        !reportedConfessionIds.has(c._id) &&
        !blockedAuthorIds.has(c.userId)
    );

    // Improved trending scoring with consistent weights
    // Replies are strongest signal (weight 5), reactions medium (weight 2)
    // Voice replies get additional bonus (+1 each)
    const scored = recent.map((c) => {
      const hoursSince = (now - c.createdAt) / (1000 * 60 * 60);
      const voiceReplies = c.voiceReplyCount || 0;
      const score =
        (c.replyCount * 5 + c.reactionCount * 2 + voiceReplies * 1) /
        (hoursSince + 2);
      // P1-02: Omit taggedUserId from anonymous confessions to prevent privacy leak
      const { taggedUserId: _omitTagged, ...confessionWithoutTagged } = c;
      const safeConfession = c.isAnonymous ? confessionWithoutTagged : c;
      return { ...safeConfession, trendingScore: score };
    });

    scored.sort((a, b) => b.trendingScore - a.trendingScore);

    // Return top 5 trending
    return scored.slice(0, limit);
  },
});

// Get a single confession by ID
export const getConfession = query({
  args: {
    confessionId: v.id('confessions'),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { confessionId }) => {
    const confession = await ctx.db.get(confessionId);
    if (!confession) return null;
    if (confession.isDeleted) return null;
    // P1-02: Omit taggedUserId from anonymous confessions to prevent privacy leak
    if (confession.isAnonymous) {
      const { taggedUserId: _omitTagged, ...safeConfession } = confession;
      return safeConfession;
    }
    return confession;
  },
});

// Create a reply to a confession (text or voice only — no images/videos/gifs)
export const createReply = mutation({
  args: {
    confessionId: v.id('confessions'),
    text: v.string(),
    isAnonymous: v.boolean(),
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    parentReplyId: v.optional(v.id('confessionReplies')), // For OP reply-to-reply
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);
    const confession = await ctx.db.get(args.confessionId);

    if (!confession || confession.isDeleted) {
      throw new Error('Confession is no longer available.');
    }

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
      userId: userId,
      text: args.text.trim(),
      isAnonymous: args.isAnonymous,
      type: replyType,
      voiceUrl: args.voiceUrl,
      voiceDurationSec: args.voiceDurationSec,
      parentReplyId: args.parentReplyId,
      createdAt: Date.now(),
    });

    // Increment reply count (and voice reply count if applicable)
    const patch: any = { replyCount: confession.replyCount + 1 };
    if (replyType === 'voice') {
      patch.voiceReplyCount = (confession.voiceReplyCount || 0) + 1;
    }
    await ctx.db.patch(args.confessionId, patch);

    return replyId;
  },
});

// Delete own reply
export const deleteReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only delete your own replies.');

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
  args: {
    confessionId: v.id('confessions'),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { confessionId, limit: limitArg }) => {
    const confession = await ctx.db.get(confessionId);
    if (!confession || confession.isDeleted) {
      return [];
    }

    const viewerId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    const limit = clampLimit(limitArg, CONFESSION_REPLY_LIMIT, CONFESSION_REPLY_LIMIT);
    let reportedReplyIds = new Set<Id<'confessionReplies'>>();

    if (viewerId) {
      const replyReports = await ctx.db
        .query('replyReports')
        .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
        .collect();
      reportedReplyIds = new Set(replyReports.map((report) => report.replyId));
    }

    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .order('desc')
      .take(limit);
    const visibleReplies = reportedReplyIds.size > 0
      ? replies.filter((reply) => !reportedReplyIds.has(reply._id))
      : replies;
    return visibleReplies.reverse();
  },
});

// Toggle emoji reaction — one emoji per user per confession (toggle/replace)
// Special behavior: if tagged user likes a tagged confession, create a DM thread
export const toggleReaction = mutation({
  args: {
    confessionId: v.id('confessions'),
    type: v.string(), // any emoji string
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);

    // Find existing reaction from this user on this confession
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();

    const confession = await ctx.db.get(args.confessionId);
    if (!confession || confession.isDeleted) {
      throw new Error('Confession is no longer available.');
    }

    // CONSISTENCY FIX B3: Helper to recompute reaction count from source of truth
    const recomputeReactionCount = async () => {
      const allReactions = await ctx.db
        .query('confessionReactions')
        .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
        .collect();
      return allReactions.length;
    };

    if (existing) {
      if (existing.type === args.type) {
        // Same emoji → remove (toggle off)
        await ctx.db.delete(existing._id);
        // CONSISTENCY FIX B3: Recompute count from actual reactions to avoid race
        const actualCount = await recomputeReactionCount();
        await ctx.db.patch(args.confessionId, { reactionCount: actualCount });
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
        userId: userId,
        type: args.type,
        createdAt: Date.now(),
      });
      // CONSISTENCY FIX B3: Recompute count from actual reactions to avoid race
      const actualCount = await recomputeReactionCount();
      await ctx.db.patch(args.confessionId, { reactionCount: actualCount });

      // SPECIAL: If tagged user likes a tagged confession, create/find a DM thread
      let chatUnlocked = false;
      if (confession.taggedUserId && userId === confession.taggedUserId) {
        // Check if conversation already exists for this confession (idempotency)
        const existingConvo = await ctx.db
          .query('conversations')
          .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
          .first();

        if (!existingConvo) {
          // Create new conversation between author and tagged user
          const now = Date.now();
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
          const conversationId = await ctx.db.insert('conversations', {
            confessionId: args.confessionId,
            participants: [confession.userId, confession.taggedUserId],
            isPreMatch: true, // Confession-based threads are pre-match
            createdAt: now,
            lastMessageAt: now,
            expiresAt: now + TWENTY_FOUR_HOURS, // Confession chats expire in 24h
            // PRIVACY FIX: Mark confession author as anonymous participant
            // Their real identity should not be revealed to the tagged user
            anonymousParticipantId: confession.isAnonymous ? confession.userId : undefined,
          });

          // Create participant junction rows for efficient Messages queries
          await ctx.db.insert('conversationParticipants', {
            conversationId,
            userId: confession.userId,
            unreadCount: 0,
          });
          await ctx.db.insert('conversationParticipants', {
            conversationId,
            userId: confession.taggedUserId,
            unreadCount: 0,
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
  },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    if (!userId) {
      return null;
    }

    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();
    return existing ? existing.type : null;
  },
});

// Get user's own confessions (all, including expired, with isExpired flag)
export const getMyConfessions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    if (!userId) {
      return [];
    }

    const now = Date.now();
    const limit = clampLimit(args.limit, MY_CONFESSIONS_LIMIT, MY_CONFESSIONS_LIMIT);
    const fetchLimit = Math.min(limit * 2, MY_CONFESSIONS_LIMIT * 2);
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .take(fetchLimit);

    // Add isExpired flag for each confession
    return confessions
      .filter((c) => !c.isDeleted)
      .slice(0, limit)
      .map((c) => ({
        ...c,
        isExpired: c.expiresAt !== undefined && c.expiresAt <= now,
      }));
  },
});

// Report a confession
// Creates a record in confessionReports for moderation review
export const reportConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    reason: v.union(
      v.literal('spam'),
      v.literal('harassment'),
      v.literal('hate'),
      v.literal('sexual'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reporterId = await requireAuthenticatedConfessionMutationUserId(ctx);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('confessionReports')
      .filter((q) =>
        q.and(
          q.eq(q.field('confessionId'), args.confessionId),
          q.eq(q.field('reporterId'), reporterId)
        )
      )
      .first();

    if (existingReport) {
      // Already reported - just return success (idempotent)
      return { success: true, alreadyReported: true };
    }

    // Create report record
    await ctx.db.insert('confessionReports', {
      confessionId: args.confessionId,
      reporterId: reporterId,
      reportedUserId: confession.userId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true, alreadyReported: false };
  },
});

// ============ TAGGED CONFESSION NOTIFICATIONS ============

// Get badge count of unseen tagged confessions for a user
export const getTaggedConfessionBadgeCount = query({
  args: {
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx) => {
    const userId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    if (!userId) {
      return 0;
    }

    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_seen', (q) => q.eq('userId', userId).eq('seen', false))
      .collect();

    const confessionCache = new Map<Id<'confessions'>, Doc<'confessions'> | null>();
    let count = 0;
    for (const notification of notifications) {
      const confession = await getCachedConfession(ctx, confessionCache, notification.confessionId);
      if (!confession || confession.isDeleted) continue;
      count += 1;
    }

    return count;
  },
});

// List tagged confessions for a user (privacy-safe: only for the tagged user's view)
export const listTaggedConfessionsForUser = query({
  args: {
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx) => {
    const userId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    if (!userId) {
      return [];
    }

    const now = Date.now();

    // Get notifications for this user (limit 50)
    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .order('desc')
      .take(TAGGED_CONFESSION_LIMIT);

    // Join with confession data
    const result = [];
    const confessionCache = new Map<Id<'confessions'>, Doc<'confessions'> | null>();
    for (const notif of notifications) {
      const confession = await getCachedConfession(ctx, confessionCache, notif.confessionId);
      if (!confession || confession.isDeleted) continue;

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
    notificationIds: v.optional(v.array(v.id('confessionNotifications'))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);
    const { notificationIds } = args;

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

export const getEligibleTagTargets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    if (!userId) {
      return [];
    }

    const likes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .collect();

    const eligibleTargetIds = new Set<Id<'users'>>();
    for (const like of likes) {
      if (like.action === 'like' || like.action === 'super_like' || like.action === 'text') {
        eligibleTargetIds.add(like.toUserId);
      }
    }

    const targets: Array<{ id: string; name: string; photoUrl: string | null }> = [];
    for (const targetId of eligibleTargetIds) {
      const targetUser = await ctx.db.get(targetId);
      if (!targetUser || !targetUser.isActive || !!targetUser.deletedAt || !!targetUser.isBanned) {
        continue;
      }

      targets.push({
        id: targetUser._id,
        name: targetUser.name,
        photoUrl: targetUser.primaryPhotoUrl ?? targetUser.displayPrimaryPhotoUrl ?? null,
      });
    }

    targets.sort((a, b) => a.name.localeCompare(b.name));
    return targets;
  },
});

export const getPendingCommentConnects = query({
  args: {
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx) => {
    const userId = await getAuthenticatedConfessionUserIdOrNull(ctx);
    if (!userId) {
      return [];
    }

    const now = Date.now();
    const connects = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .collect();

    const pendingConnects = connects
      .filter(
        (connect) =>
          connect.toUserId === userId &&
          connect.status !== 'accepted' &&
          connect.status !== 'rejected' &&
          (connect.expiresAt === undefined || connect.expiresAt > now) &&
          !!connect.confessionId &&
          !!connect.replyId
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    const results: Array<{
      connectId: string;
      confessionId: string;
      replyId: string;
      confessionText: string;
      confessionMood: string;
      replyText: string;
      requestedAt: number;
    }> = [];
    const confessionCache = new Map<Id<'confessions'>, Doc<'confessions'> | null>();
    const replyCache = new Map<Id<'confessionReplies'>, Doc<'confessionReplies'> | null>();

    for (const connect of pendingConnects) {
      const confession = await getCachedConfession(ctx, confessionCache, connect.confessionId!);
      const reply = await getCachedReply(ctx, replyCache, connect.replyId!);

      if (!confession || confession.isDeleted || !reply) {
        continue;
      }

      results.push({
        connectId: connect._id,
        confessionId: confession._id,
        replyId: reply._id,
        confessionText: confession.text,
        confessionMood: confession.mood,
        replyText: reply.text,
        requestedAt: connect.createdAt,
      });
    }

    return results;
  },
});

export const cleanupExpiredCommentConnects = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredConnects = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_expires')
      .filter((q) =>
        q.and(
          q.neq(q.field('expiresAt'), undefined),
          q.lte(q.field('expiresAt'), now)
        )
      )
      .take(CONNECT_CLEANUP_BATCH);

    let deletedCount = 0;

    for (const connect of expiredConnects) {
      const status = connect.status ?? 'pending';
      if (status !== 'pending') {
        continue;
      }

      if (connect.replyId) {
        const reply = await ctx.db.get(connect.replyId);
        if (reply?.hasActiveConnectRequest) {
          await ctx.db.patch(connect.replyId, { hasActiveConnectRequest: false });
        }
      }

      await ctx.db.delete(connect._id);
      deletedCount++;
    }

    return {
      deletedCount,
      hasMore: expiredConnects.length === CONNECT_CLEANUP_BATCH,
    };
  },
});

export const respondToCommentConnect = mutation({
  args: {
    connectId: v.id('confessionCommentConnects'),
    action: v.union(v.literal('accept'), v.literal('reject')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);
    const connect = await ctx.db.get(args.connectId);

    if (!connect) {
      throw new Error('Connect request not found.');
    }

    if (connect.toUserId !== userId) {
      throw new Error('Only the request recipient can respond.');
    }

    if (connect.status === 'accepted' || connect.status === 'rejected') {
      throw new Error('Connect request already processed.');
    }

    const now = Date.now();
    if (connect.expiresAt !== undefined && connect.expiresAt <= now) {
      await ctx.db.patch(args.connectId, {
        status: 'rejected',
        respondedAt: now,
      });

      if (connect.replyId) {
        await ctx.db.patch(connect.replyId, { hasActiveConnectRequest: false });
      }

      throw new Error('Connect request expired.');
    }

    await ctx.db.patch(args.connectId, {
      status: args.action === 'accept' ? 'accepted' : 'rejected',
      respondedAt: now,
    });

    if (connect.replyId) {
      await ctx.db.patch(connect.replyId, { hasActiveConnectRequest: false });
    }

    if (args.action === 'reject') {
      return {
        success: true,
        matchCreated: false,
      };
    }

    const user1Id = connect.fromUserId < connect.toUserId ? connect.fromUserId : connect.toUserId;
    const user2Id = connect.fromUserId < connect.toUserId ? connect.toUserId : connect.fromUserId;

    let matchId: Id<'matches'>;
    const existingMatch = await ctx.db
      .query('matches')
      .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .first();

    if (existingMatch) {
      matchId = existingMatch._id;
    } else {
      matchId = await ctx.db.insert('matches', {
        user1Id,
        user2Id,
        matchedAt: now,
        isActive: true,
      });
    }

    await ctx.db.patch(args.connectId, { matchId });

    return {
      success: true,
      matchCreated: true,
      matchId,
      otherUserId: connect.fromUserId as string,
    };
  },
});

// Report a reply for moderation
export const reportReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    reason: v.union(
      v.literal('spam'),
      v.literal('abuse'),
      v.literal('harassment'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reporterId = await requireAuthenticatedConfessionMutationUserId(ctx);
    const reply = await ctx.db.get(args.replyId);

    if (!reply) {
      throw new Error('Reply not found.');
    }

    const confession = await ctx.db.get(reply.confessionId);
    if (!confession || confession.isDeleted) {
      throw new Error('Confession is no longer available.');
    }

    const existing = await ctx.db
      .query('replyReports')
      .withIndex('by_reply_reporter', (q) =>
        q.eq('replyId', args.replyId).eq('reporterId', reporterId)
      )
      .first();

    if (existing) {
      return { success: true, alreadyReported: true };
    }

    await ctx.db.insert('replyReports', {
      replyId: args.replyId,
      confessionId: reply.confessionId,
      reporterId,
      reportedUserId: reply.userId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true, alreadyReported: false };
  },
});

// Consume a one-time Confess profile preview before navigation.
// Backend is the source of truth for whether a viewer has already used their preview.
export const consumePreview = mutation({
  args: {
    targetUserId: v.union(v.id('users'), v.string()),
    confessionId: v.optional(v.id('confessions')),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireAuthenticatedConfessionMutationUserId(ctx);
    const targetUserId = await resolveUserIdByAuthId(ctx, args.targetUserId as string);

    if (!targetUserId) {
      return {
        allowed: false,
        reason: 'target_not_found' as const,
      };
    }

    if (args.confessionId) {
      const confession = await ctx.db.get(args.confessionId);
      if (!confession || confession.isDeleted) {
        return {
          allowed: false,
          reason: 'confession_unavailable' as const,
        };
      }

      if (confession.taggedUserId && confession.taggedUserId !== viewerId) {
        return {
          allowed: false,
          reason: 'not_allowed' as const,
        };
      }

      if (confession.userId !== targetUserId) {
        return {
          allowed: false,
          reason: 'target_mismatch' as const,
        };
      }
    }

    if (viewerId === targetUserId) {
      return {
        allowed: true,
        reason: 'self' as const,
      };
    }

    const existing = await ctx.db
      .query('confessionProfilePreviews')
      .withIndex('by_viewer_target', (q) =>
        q.eq('viewerId', viewerId).eq('targetUserId', targetUserId)
      )
      .first();

    if (existing) {
      return {
        allowed: false,
        reason: 'already_used' as const,
      };
    }

    await ctx.db.insert('confessionProfilePreviews', {
      viewerId,
      targetUserId,
      confessionId: args.confessionId,
      createdAt: Date.now(),
    });

    return {
      allowed: true,
      reason: 'granted' as const,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Get or create a conversation for an anonymous confession reply
// This unifies confession chats with the Messages system
// ═══════════════════════════════════════════════════════════════════════════
export const getOrCreateForConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);

    // Get the confession to find the author
    const confession = await ctx.db.get(args.confessionId);
    if (!confession || confession.isDeleted) {
      throw new Error('Confession not found');
    }

    const authorId = confession.userId;

    // Prevent self-chat
    if (userId === authorId) {
      throw new Error('Cannot start a chat with yourself');
    }

    // Look for existing conversation for this confession between these users
    const existingConversations = await ctx.db
      .query('conversations')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // Find one where both users are participants
    const existingConvo = existingConversations.find(
      (c) => c.participants.includes(userId) && c.participants.includes(authorId)
    );

    if (existingConvo) {
      return { conversationId: existingConvo._id, isNew: false };
    }

    // Create new conversation
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const conversationId = await ctx.db.insert('conversations', {
      confessionId: args.confessionId,
      participants: [userId, authorId],
      isPreMatch: true,
      createdAt: now,
      lastMessageAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS,
      // PRIVACY FIX: Mark confession author as anonymous participant if confession is anonymous
      // Their real identity should not be revealed to the replying user
      anonymousParticipantId: confession.isAnonymous ? authorId : undefined,
    });

    // Create participant junction rows for efficient queries
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      userId,
      unreadCount: 0,
    });
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      userId: authorId,
      unreadCount: 0,
    });

    return { conversationId, isNew: true };
  },
});

// Delete own confession (soft delete via isDeleted flag)
// Only the author can delete their own confession
export const deleteConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedConfessionMutationUserId(ctx);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }
    if (confession.userId !== userId) {
      throw new Error('You can only delete your own confessions.');
    }

    // Soft delete: mark as deleted rather than hard delete
    // This preserves referential integrity with replies, reactions, conversations
    await ctx.db.patch(args.confessionId, {
      isDeleted: true,
      deletedAt: Date.now(),
    });

    return { success: true };
  },
});
