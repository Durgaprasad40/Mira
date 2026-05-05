import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId, validateSessionToken } from './helpers';

// Phone number & email patterns for server-side validation
const PHONE_PATTERN = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Confession expiry duration (24 hours in milliseconds)
const CONFESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// P1-01: Server-side rate limit (5 confessions per 24 hours)
const CONFESSION_RATE_LIMIT = 5;

type SerializedConfession = {
  _id: Id<'confessions'>;
  _creationTime: number;
  userId: Id<'users'>;
  text: string;
  isAnonymous: boolean;
  authorVisibility?: 'anonymous' | 'open' | 'blur_photo';
  mood: 'romantic' | 'spicy' | 'emotional' | 'funny';
  visibility: 'global';
  imageUrl?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  replyCount: number;
  reactionCount: number;
  voiceReplyCount?: number;
  createdAt: number;
  expiresAt?: number;
  isDeleted?: boolean;
  deletedAt?: number;
  taggedUserId?: Id<'users'>;
  trendingScore?: number;
  isExpired?: boolean;
};

// Canonical reply identity mode used by the current product contract.
// Legacy 'blur' literal maps to 'blur_photo'; unknown/missing maps using isAnonymous.
type ReplyIdentityMode = 'anonymous' | 'blur_photo' | 'open';

function canonicalIdentityMode(
  raw: string | undefined,
  isAnonymousFallback: boolean
): ReplyIdentityMode {
  switch (raw) {
    case 'anonymous':
      return 'anonymous';
    case 'blur':
    case 'blur_photo':
      return 'blur_photo';
    case 'open':
      return 'open';
    default:
      return isAnonymousFallback ? 'anonymous' : 'open';
  }
}

type SerializedReply = {
  _id: Id<'confessionReplies'>;
  _creationTime: number;
  confessionId: Id<'confessions'>;
  userId: Id<'users'>;
  text: string;
  isAnonymous: boolean;
  identityMode: ReplyIdentityMode;
  type?: 'text' | 'voice';
  voiceUrl?: string;
  voiceDurationSec?: number;
  parentReplyId?: Id<'confessionReplies'>;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  editedAt?: number;
  createdAt: number;
  isOwnReply?: boolean;
};

function serializeReply(
  reply: Doc<'confessionReplies'>,
  options?: { viewerId?: Id<'users'> | null }
): SerializedReply {
  const identityMode = canonicalIdentityMode(reply.identityMode, reply.isAnonymous);
  const base: SerializedReply = {
    _id: reply._id,
    _creationTime: reply._creationTime,
    confessionId: reply.confessionId,
    userId: reply.userId,
    text: reply.text,
    isAnonymous: identityMode === 'anonymous',
    identityMode,
    type: reply.type,
    voiceUrl: reply.voiceUrl,
    voiceDurationSec: reply.voiceDurationSec,
    parentReplyId: reply.parentReplyId,
    editedAt: reply.editedAt,
    createdAt: reply.createdAt,
  };

  // Gate author display fields by identity mode. Anonymous must never leak identity.
  if (identityMode !== 'anonymous') {
    base.authorName = reply.authorName;
    base.authorPhotoUrl = reply.authorPhotoUrl;
    base.authorAge = reply.authorAge;
    base.authorGender = reply.authorGender;
  }

  if (options?.viewerId) {
    base.isOwnReply = reply.userId === options.viewerId;
  }

  return base;
}

function serializeConfession(
  confession: Doc<'confessions'>,
  options?: {
    includeTaggedUserId?: boolean;
    trendingScore?: number;
    isExpired?: boolean;
  }
): SerializedConfession {
  const result: SerializedConfession = {
    _id: confession._id,
    _creationTime: confession._creationTime,
    userId: confession.userId,
    text: confession.text,
    isAnonymous: confession.isAnonymous,
    authorVisibility: confession.authorVisibility as 'anonymous' | 'open' | 'blur_photo' | undefined,
    mood: confession.mood,
    visibility: confession.visibility,
    imageUrl: confession.imageUrl,
    authorName: confession.authorName,
    authorPhotoUrl: confession.authorPhotoUrl,
    authorAge: confession.authorAge,
    authorGender: confession.authorGender,
    replyCount: confession.replyCount,
    reactionCount: confession.reactionCount,
    voiceReplyCount: confession.voiceReplyCount,
    createdAt: confession.createdAt,
    expiresAt: confession.expiresAt,
    isDeleted: confession.isDeleted,
    deletedAt: confession.deletedAt,
  };

  if (options?.includeTaggedUserId && !confession.isAnonymous) {
    result.taggedUserId = confession.taggedUserId;
  }

  if (typeof options?.trendingScore === 'number') {
    result.trendingScore = options.trendingScore;
  }

  if (typeof options?.isExpired === 'boolean') {
    result.isExpired = options.isExpired;
  }

  return result;
}

async function getValidatedViewerFromToken(
  ctx: Parameters<typeof validateSessionToken>[0],
  token?: string
): Promise<Id<'users'> | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return validateSessionToken(ctx, trimmed);
}

// Create a new confession
export const createConfession = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    authorVisibility: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur_photo'))),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    taggedUserId: v.optional(v.union(v.id('users'), v.string())), // User being confessed to
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

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
      taggedUserId = await ensureUserByAuthId(ctx, args.taggedUserId as string);
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
      authorVisibility: args.authorVisibility,
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
// P0-3: Viewer-aware — excludes confessions reported by viewer
export const listConfessions = query({
  args: {
    sortBy: v.union(v.literal('trending'), v.literal('latest')),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, { sortBy, viewerId }) => {
    const now = Date.now();
    const allConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // P0-3: Build set of confession IDs the viewer has reported (server-side filter)
    let reportedIds: Set<string> = new Set();
    if (viewerId) {
      const resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
      if (resolvedViewerId) {
        const myReports = await ctx.db
          .query('confessionReports')
          .withIndex('by_reporter', (q) => q.eq('reporterId', resolvedViewerId))
          .collect();
        reportedIds = new Set(myReports.map((r) => r.confessionId as unknown as string));
      }
    }

    // Filter out expired, deleted, and viewer-reported confessions
    const confessions = allConfessions.filter(
      (c) =>
        (c.expiresAt === undefined || c.expiresAt > now) &&
        !c.isDeleted &&
        !reportedIds.has(c._id as unknown as string)
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
          ...serializeConfession(c, { includeTaggedUserId: true }),
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

    return withPreviews;
  },
});

// Get trending confessions (last 48h, time-decay scoring)
// Only returns non-expired confessions
// P0-3: Viewer-aware — excludes confessions reported by viewer
export const getTrendingConfessions = query({
  args: {
    viewerId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, { viewerId }) => {
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000; // 48 hours ago

    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // P0-3: Build set of confession IDs the viewer has reported (server-side filter)
    let reportedIds: Set<string> = new Set();
    if (viewerId) {
      const resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
      if (resolvedViewerId) {
        const myReports = await ctx.db
          .query('confessionReports')
          .withIndex('by_reporter', (q) => q.eq('reporterId', resolvedViewerId))
          .collect();
        reportedIds = new Set(myReports.map((r) => r.confessionId as unknown as string));
      }
    }

    // Filter to last 48h AND not expired AND not deleted AND not viewer-reported
    const recent = confessions.filter(
      (c) =>
        c.createdAt > cutoff &&
        (c.expiresAt === undefined || c.expiresAt > now) &&
        !c.isDeleted &&
        !reportedIds.has(c._id as unknown as string)
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
      return serializeConfession(c, {
        includeTaggedUserId: true,
        trendingScore: score,
      });
    });

    scored.sort((a, b) => (b.trendingScore ?? 0) - (a.trendingScore ?? 0));

    // Return top 5 trending
    return scored.slice(0, 5);
  },
});

// Get a single confession by ID
// P0-2: Fail closed — returns null if missing, deleted, or expired.
// Expired rows remain readable only by their owner for My Confessions history.
export const getConfession = query({
  args: {
    confessionId: v.id('confessions'),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, token }) => {
    const confession = await ctx.db.get(confessionId);
    if (!confession) return null;
    if (confession.isDeleted) return null;
    const now = Date.now();
    const isExpired = confession.expiresAt !== undefined && confession.expiresAt <= now;

    if (isExpired) {
      const validatedViewerId = await getValidatedViewerFromToken(ctx, token);
      if (!validatedViewerId || validatedViewerId !== confession.userId) return null;
    }

    return serializeConfession(confession, {
      includeTaggedUserId: true,
      isExpired,
    });
  },
});

// Create a reply to a confession (text or voice only — no images/videos/gifs)
// Rules:
//  - Top-level comments (no parentReplyId): one per user per confession.
//  - Threaded replies (parentReplyId set): only the confession owner may create them,
//    and the parent must belong to the same confession.
//  - identityMode is the canonical source of truth for render mode. isAnonymous is
//    derived from it and kept in sync for backward compatibility.
export const createReply = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(),
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('open'),
      v.literal('blur_photo')
    )),
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    parentReplyId: v.optional(v.id('confessionReplies')), // OP-only reply to a comment
    // Author display snapshot (ignored for anonymous mode).
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // P0-2: Fail closed — refuse replies on missing/deleted/expired parent
    const parent = await ctx.db.get(args.confessionId);
    if (!parent) {
      throw new Error('Confession not found.');
    }
    if (parent.isDeleted) {
      throw new Error('This confession is no longer available.');
    }
    const nowMs = Date.now();
    if (parent.expiresAt !== undefined && parent.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }

    // Normalize identity mode. The request-provided value wins; otherwise derive
    // from the legacy isAnonymous boolean for backward compatibility with older clients.
    const identityMode = canonicalIdentityMode(args.identityMode, args.isAnonymous);
    const effectiveIsAnonymous = identityMode === 'anonymous';

    // Threaded reply rules (OP-only).
    if (args.parentReplyId !== undefined) {
      if (parent.userId !== userId) {
        throw new Error('Only the confession owner can reply to comments.');
      }
      const parentReply = await ctx.db.get(args.parentReplyId);
      if (!parentReply) {
        throw new Error('Parent comment not found.');
      }
      if (parentReply.confessionId !== args.confessionId) {
        throw new Error('Parent comment does not belong to this confession.');
      }
      // Don't allow deeply nested replies (reply-to-reply-to-reply).
      if (parentReply.parentReplyId !== undefined) {
        throw new Error('Cannot reply to a reply.');
      }
    } else {
      // Top-level: enforce one comment per user per confession.
      const existingTopLevel = await ctx.db
        .query('confessionReplies')
        .withIndex('by_confession_user', (q) =>
          q.eq('confessionId', args.confessionId).eq('userId', userId)
        )
        .filter((q) => q.eq(q.field('parentReplyId'), undefined))
        .first();
      if (existingTopLevel) {
        throw new Error('You have already commented on this confession.');
      }
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
      isAnonymous: effectiveIsAnonymous,
      identityMode,
      type: replyType,
      voiceUrl: args.voiceUrl,
      voiceDurationSec: args.voiceDurationSec,
      parentReplyId: args.parentReplyId,
      // Snapshot author display fields only when the mode may reveal them.
      authorName: effectiveIsAnonymous ? undefined : args.authorName,
      authorPhotoUrl: effectiveIsAnonymous ? undefined : args.authorPhotoUrl,
      authorAge: effectiveIsAnonymous ? undefined : args.authorAge,
      authorGender: effectiveIsAnonymous ? undefined : args.authorGender,
      createdAt: nowMs,
    });

    // Engagement count — only OUTSIDE-USER top-level comments count.
    // Owner replies to comments (parentReplyId set) and any owner self-authored
    // reply must NOT increment replyCount / voiceReplyCount, otherwise the
    // confession owner could artificially inflate trending by replying to
    // every comment on their own post.
    const isCountableReply =
      args.parentReplyId === undefined && parent.userId !== userId;

    if (isCountableReply) {
      const patch: any = { replyCount: parent.replyCount + 1 };
      if (replyType === 'voice') {
        patch.voiceReplyCount = (parent.voiceReplyCount || 0) + 1;
      }
      await ctx.db.patch(args.confessionId, patch);
    }

    return replyId;
  },
});

// Update own reply. Owner-only. Allows editing text and/or identityMode.
// When switching to anonymous, author snapshot fields are cleared.
// When switching to a non-anonymous mode, the caller may pass fresh snapshot fields
// so display stays consistent with the new mode.
export const updateReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()),
    text: v.optional(v.string()),
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('open'),
      v.literal('blur_photo')
    )),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only edit your own replies.');

    // Refuse edits on replies whose parent confession is gone/expired.
    const parent = await ctx.db.get(reply.confessionId);
    if (!parent || parent.isDeleted) {
      throw new Error('This confession is no longer available.');
    }
    const nowMs = Date.now();
    if (parent.expiresAt !== undefined && parent.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }

    const patch: Partial<Doc<'confessionReplies'>> = {};

    // Text edit — only meaningful for text replies.
    if (args.text !== undefined) {
      if (reply.type === 'voice') {
        throw new Error('Voice replies cannot be edited.');
      }
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
      patch.text = trimmed;
    }

    // Identity mode switch.
    if (args.identityMode !== undefined) {
      const nextMode = canonicalIdentityMode(args.identityMode, false);
      patch.identityMode = nextMode;
      patch.isAnonymous = nextMode === 'anonymous';
      if (nextMode === 'anonymous') {
        // Clear leakable fields.
        patch.authorName = undefined;
        patch.authorPhotoUrl = undefined;
        patch.authorAge = undefined;
        patch.authorGender = undefined;
      } else {
        // Accept fresh snapshot if caller provided one; otherwise keep existing.
        if (args.authorName !== undefined) patch.authorName = args.authorName;
        if (args.authorPhotoUrl !== undefined) patch.authorPhotoUrl = args.authorPhotoUrl;
        if (args.authorAge !== undefined) patch.authorAge = args.authorAge;
        if (args.authorGender !== undefined) patch.authorGender = args.authorGender;
      }
    }

    if (Object.keys(patch).length === 0) {
      // Nothing to do — treat as a no-op rather than an error.
      return { success: true, noChange: true };
    }

    patch.editedAt = nowMs;

    await ctx.db.patch(args.replyId, patch);

    return { success: true, noChange: false };
  },
});

// Delete own reply. Fails closed when the parent confession is missing/deleted/expired
// so comment actions never outlive the parent.
export const deleteReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only delete your own replies.');

    // Fail closed — no comment action should succeed on a dead/expired confession.
    const parent = await ctx.db.get(reply.confessionId);
    if (!parent || parent.isDeleted) {
      throw new Error('This confession is no longer available.');
    }
    const nowMs = Date.now();
    if (parent.expiresAt !== undefined && parent.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }

    await ctx.db.delete(args.replyId);

    // Mirror the createReply counting rule: only decrement if THIS reply was
    // itself counted (an outside-user top-level comment). Owner replies were
    // never counted, so deleting them must not drift the count downward.
    const wasCounted =
      reply.parentReplyId === undefined && reply.userId !== parent.userId;

    if (wasCounted) {
      const patch: any = {
        replyCount: Math.max(0, parent.replyCount - 1),
      };
      if (reply.type === 'voice') {
        patch.voiceReplyCount = Math.max(0, (parent.voiceReplyCount || 0) - 1);
      }
      await ctx.db.patch(reply.confessionId, patch);
    }

    return { success: true };
  },
});

// Get replies for a confession
// P0-2: Fail closed — returns [] if parent missing, deleted, or expired
// If viewerId is supplied, each reply carries isOwnReply for convenient client gating.
// Author identity fields are only returned for non-anonymous rows.
export const getReplies = query({
  args: {
    confessionId: v.id('confessions'),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, viewerId, token }) => {
    const parent = await ctx.db.get(confessionId);
    if (!parent) return [];
    if (parent.isDeleted) return [];

    const validatedViewerId = await getValidatedViewerFromToken(ctx, token);
    const now = Date.now();
    const isExpired = parent.expiresAt !== undefined && parent.expiresAt <= now;
    if (isExpired) {
      if (!validatedViewerId || validatedViewerId !== parent.userId) return [];
    }

    // Resolve viewer for display-only isOwnReply. Expired access never relies on
    // client-provided viewerId; when expired, use the validated token owner.
    let resolvedViewerId: Id<'users'> | null = validatedViewerId;
    if (!resolvedViewerId && !isExpired && viewerId) {
      resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
    }

    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .order('asc')
      .collect();

    return replies.map((reply) => serializeReply(reply, { viewerId: resolvedViewerId }));
  },
});

// Return the viewer's own top-level reply (if any) on this confession.
// Used by the composer to decide between "new comment" and "edit your comment" UX.
// Fails closed like getReplies: returns null when the confession is missing/deleted/expired,
// or when the viewer has no top-level comment on this confession.
export const getMyReplyForConfession = query({
  args: {
    confessionId: v.id('confessions'),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, viewerId, token }) => {
    const parent = await ctx.db.get(confessionId);
    if (!parent) return null;
    if (parent.isDeleted) return null;

    const validatedViewerId = await getValidatedViewerFromToken(ctx, token);
    const now = Date.now();
    const isExpired = parent.expiresAt !== undefined && parent.expiresAt <= now;
    if (isExpired) {
      if (!validatedViewerId || validatedViewerId !== parent.userId) return null;
    }

    let resolvedViewerId: Id<'users'> | null = validatedViewerId;
    if (!resolvedViewerId && !isExpired && viewerId) {
      resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
    }
    if (!resolvedViewerId) return null;

    const own = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', confessionId).eq('userId', resolvedViewerId)
      )
      .filter((q) => q.eq(q.field('parentReplyId'), undefined))
      .first();

    if (!own) return null;
    return serializeReply(own, { viewerId: resolvedViewerId });
  },
});

// Toggle emoji reaction — one emoji per user per confession (toggle/replace)
// Special behavior: if tagged user likes a tagged confession, create a DM thread
export const toggleReaction = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    type: v.string(), // any emoji string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) return { added: false, replaced: false, chatUnlocked: false };
    const nowMs = Date.now();
    if (confession.expiresAt !== undefined && confession.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }

    // Find existing reaction from this user on this confession
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();

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
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getUserReaction] User not found for authUserId:', args.userId);
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
  args: { userId: v.union(v.id('users'), v.string()) },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getMyConfessions] User not found for authUserId:', args.userId);
      return [];
    }

    const now = Date.now();
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();

    // Filter out manually deleted confessions (isDeleted: true)
    // Expired confessions are kept but marked as expired for the owner to see
    return confessions
      .filter((confession) => !confession.isDeleted)
      .map((confession) =>
        serializeConfession(confession, {
          includeTaggedUserId: true,
          isExpired: confession.expiresAt !== undefined && confession.expiresAt <= now,
        })
      );
  },
});

// Report a confession
// Creates a record in confessionReports for moderation review
export const reportConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    reporterId: v.union(v.id('users'), v.string()),
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
    // Map authUserId -> Convex Id<"users">
    const reporterId = await ensureUserByAuthId(ctx, args.reporterId as string);

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

// Report a specific comment/reply
// Creates a record in confessionReplyReports for moderation review.
// Idempotent per (reporter, reply) — repeat reports short-circuit to success.
export const reportReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    reporterId: v.union(v.id('users'), v.string()),
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
    const reporterId = await ensureUserByAuthId(ctx, args.reporterId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) {
      throw new Error('Comment not found.');
    }

    // Users cannot report their own comments.
    if (reply.userId === reporterId) {
      throw new Error('You cannot report your own comment.');
    }

    // Idempotency — same reporter + same reply is a no-op.
    const existing = await ctx.db
      .query('confessionReplyReports')
      .withIndex('by_reply', (q) => q.eq('replyId', args.replyId))
      .filter((q) => q.eq(q.field('reporterId'), reporterId))
      .first();

    if (existing) {
      return { success: true, alreadyReported: true };
    }

    await ctx.db.insert('confessionReplyReports', {
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

// ============ TAGGED CONFESSION NOTIFICATIONS ============

// Get badge count of unseen tagged confessions for a user
export const getTaggedConfessionBadgeCount = query({
  args: { userId: v.union(v.id('users'), v.string()) },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getTaggedConfessionBadgeCount] User not found for authUserId:', args.userId);
      return 0;
    }

    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_seen', (q) => q.eq('userId', userId).eq('seen', false))
      .collect();
    return notifications.length;
  },
});

// List tagged confessions for a user (privacy-safe: only for the tagged user's view)
export const listTaggedConfessionsForUser = query({
  args: { userId: v.union(v.id('users'), v.string()) },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[listTaggedConfessionsForUser] User not found for authUserId:', args.userId);
      return [];
    }

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
    userId: v.union(v.id('users'), v.string()),
    notificationIds: v.optional(v.array(v.id('confessionNotifications'))),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);
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

// ═══════════════════════════════════════════════════════════════════════════
// Get or create a conversation for an anonymous confession reply
// This unifies confession chats with the Messages system
// ═══════════════════════════════════════════════════════════════════════════
export const getOrCreateForConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Get the confession to find the author
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
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
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

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

// Update own confession (text and mood only)
// Only the author can edit their own confession, and only if not deleted
export const updateConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }
    if (confession.userId !== userId) {
      throw new Error('You can only edit your own confessions.');
    }
    if (confession.isDeleted) {
      throw new Error('Cannot edit a deleted confession.');
    }

    // Validate text
    const trimmedText = args.text.trim();
    if (trimmedText.length < 1) {
      throw new Error('Confession cannot be empty.');
    }
    if (trimmedText.length > 500) {
      throw new Error('Confession exceeds 500 character limit.');
    }
    if (PHONE_PATTERN.test(trimmedText)) {
      throw new Error('Do not include phone numbers.');
    }
    if (EMAIL_PATTERN.test(trimmedText)) {
      throw new Error('Do not include email addresses.');
    }

    // Update only text and mood (preserves original author info, anonymity, etc.)
    await ctx.db.patch(args.confessionId, {
      text: trimmedText,
      mood: args.mood,
    });

    return { success: true };
  },
});
