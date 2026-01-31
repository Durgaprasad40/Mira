import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';

/**
 * Server-side content moderation for user-generated content.
 * Handles: messages, bios, room titles, T&D prompts, profile content.
 *
 * This module provides:
 * - Text filtering (explicit, solicitation, non-consensual, underage)
 * - Moderation queue management
 * - User strike tracking with auto-action thresholds
 * - Image moderation placeholder
 */

// ── Pattern lists (server-side mirror of client filter) ──

const EXPLICIT_PATTERNS: RegExp[] = [
  /\bp[o0]rn/i, /\bxxx\b/i, /\bnude[s]?\b/i, /\bnaked\b/i,
  /\bsex\s*tape/i, /\bsext(ing)?\b/i, /\bd[i1]ck\s*pic/i,
  /\bn[u0]de?\s*pic/i, /\bescort\b/i, /\bprostitut/i,
  /\bcam\s*girl/i, /\bcam\s*boy/i, /\bonlyfans/i, /\bfansly/i,
  /\bnsfw/i, /\bgangbang/i, /\borgy\b/i, /\bbdsm/i,
  /\bbondage/i, /\bfetish\b/i, /\bhentai/i,
];

const SOLICITATION_PATTERNS: RegExp[] = [
  /\b(pay|paid)\s*(for|me)\s*(sex|meet|hookup)/i,
  /\b(cash|money|venmo|cashapp|paypal|zelle)\s*.{0,20}(meet|sex|hookup)/i,
  /\bsugar\s*(daddy|mommy|mama|baby)/i,
  /\bescort\s*service/i, /\bfull\s*service/i,
  /\bppm\b/i, /\brates?\s*:?\s*\$?\d/i,
];

const NON_CONSENSUAL_PATTERNS: RegExp[] = [
  /\brape\b/i, /\bforce(d)?\s*(sex|her|him|them)/i,
  /\bdrug(ged)?\s*(her|him|them)/i, /\brevenge\s*porn/i,
  /\bnon.?consensual/i,
];

const UNDERAGE_PATTERNS: RegExp[] = [
  /\bi'?m\s*(1[0-7]|[1-9])\s*(years?\s*old|yo|yrs)/i,
  /\bunder\s*18/i, /\bunderage/i, /\bminor\b/i,
  /\bschool\s*(girl|boy)/i, /\bjail\s*bait/i,
  /\bloli\b/i, /\bshota\b/i, /\bpedoph/i, /\bchild\s*(porn|sex)/i,
];

type FlagCategory = 'explicit' | 'solicitation' | 'non_consensual' | 'underage';

function checkContent(text: string): { isClean: boolean; categories: FlagCategory[] } {
  if (!text || text.trim().length === 0) return { isClean: true, categories: [] };
  const categories: FlagCategory[] = [];

  const check = (patterns: RegExp[], cat: FlagCategory) => {
    for (const p of patterns) {
      if (p.test(text)) { categories.push(cat); return; }
    }
  };

  check(EXPLICIT_PATTERNS, 'explicit');
  check(SOLICITATION_PATTERNS, 'solicitation');
  check(NON_CONSENSUAL_PATTERNS, 'non_consensual');
  check(UNDERAGE_PATTERNS, 'underage');

  return { isClean: categories.length === 0, categories };
}

// ── Moderation queue: flag content for review ──

export const flagContent = mutation({
  args: {
    reporterId: v.optional(v.id('users')), // system if auto-flagged
    reportedUserId: v.id('users'),
    contentType: v.union(
      v.literal('message'), v.literal('bio'), v.literal('room_title'),
      v.literal('tod_prompt'), v.literal('desire_bio'), v.literal('profile_photo'),
    ),
    contentId: v.optional(v.string()), // messageId, roomId, etc.
    contentText: v.optional(v.string()),
    flagCategories: v.array(v.string()),
    isAutoFlagged: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('moderationQueue', {
      reporterId: args.reporterId,
      reportedUserId: args.reportedUserId,
      contentType: args.contentType,
      contentId: args.contentId,
      contentText: args.contentText,
      flagCategories: args.flagCategories,
      isAutoFlagged: args.isAutoFlagged,
      status: 'pending',
      createdAt: Date.now(),
    });
  },
});

// ── Moderate content (server-side check + auto-flag) ──

export const moderateText = mutation({
  args: {
    userId: v.id('users'),
    text: v.string(),
    contentType: v.union(
      v.literal('message'), v.literal('bio'), v.literal('room_title'),
      v.literal('tod_prompt'), v.literal('desire_bio'),
    ),
    contentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = checkContent(args.text);

    if (!result.isClean) {
      // Auto-flag the content
      await ctx.db.insert('moderationQueue', {
        reporterId: undefined,
        reportedUserId: args.userId,
        contentType: args.contentType,
        contentId: args.contentId,
        contentText: args.text,
        flagCategories: result.categories,
        isAutoFlagged: true,
        status: 'pending',
        createdAt: Date.now(),
      });

      // Add a strike
      await addStrike(ctx, args.userId, result.categories);
    }

    // Return masking info for client-side display:
    // - Public surfaces: hide entire text → "Private preferences available after match"
    // - Private chat: mask explicit words with "****"
    let maskedText = args.text;
    if (!result.isClean) {
      for (const cat of result.categories) {
        const patterns =
          cat === 'explicit' ? EXPLICIT_PATTERNS
          : cat === 'solicitation' ? SOLICITATION_PATTERNS
          : cat === 'non_consensual' ? NON_CONSENSUAL_PATTERNS
          : UNDERAGE_PATTERNS;
        for (const p of patterns) {
          maskedText = maskedText.replace(new RegExp(p.source, 'gi'), '****');
        }
      }
    }

    return {
      isClean: result.isClean,
      categories: result.categories,
      maskedText,
    };
  },
});

// ── User strikes + auto-action thresholds ──

async function addStrike(ctx: any, userId: any, categories: FlagCategory[]) {
  const severity = categories.includes('underage') || categories.includes('non_consensual')
    ? 'critical'
    : categories.includes('solicitation')
      ? 'high'
      : 'medium';

  await ctx.db.insert('userStrikes', {
    userId,
    reason: categories.join(', '),
    severity,
    createdAt: Date.now(),
  });

  // Count active strikes
  const strikes = await ctx.db
    .query('userStrikes')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();

  const activeStrikes = strikes.length;

  // Auto-action thresholds:
  // - Critical content (underage/non-consensual): immediate ban
  // - 1 strike: warning (no action beyond flag)
  // - 3 strikes: timeout (24h reduced_reach)
  // - 5 strikes: ban
  if (severity === 'critical') {
    await ctx.db.patch(userId, {
      isBanned: true,
      banReason: `Auto-banned: ${categories.join(', ')} content detected`,
      verificationEnforcementLevel: 'security_only',
    });
  } else if (activeStrikes >= 5) {
    await ctx.db.patch(userId, {
      isBanned: true,
      banReason: `Auto-banned: ${activeStrikes} content moderation strikes`,
      verificationEnforcementLevel: 'security_only',
    });
  } else if (activeStrikes >= 3) {
    await ctx.db.patch(userId, {
      verificationEnforcementLevel: 'reduced_reach',
    });
  }
}

// ── Query: get pending moderation queue items ──

export const getModerationQueue = query({
  args: {
    status: v.optional(v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved'), v.literal('dismissed'))),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query('moderationQueue')
        .withIndex('by_status', (q) => q.eq('status', args.status!))
        .order('desc')
        .take(50);
    }
    return await ctx.db
      .query('moderationQueue')
      .order('desc')
      .take(50);
  },
});

// ── Resolve moderation queue item ──

export const resolveModeration = mutation({
  args: {
    itemId: v.id('moderationQueue'),
    resolution: v.union(v.literal('reviewed'), v.literal('resolved'), v.literal('dismissed')),
    reviewerNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      status: args.resolution,
      reviewedAt: Date.now(),
      reviewerNote: args.reviewerNote,
    });
  },
});

// ── Image moderation placeholder ──

export const checkImage = mutation({
  args: {
    userId: v.id('users'),
    storageId: v.id('_storage'),
    context: v.union(v.literal('profile_photo'), v.literal('chat_image'), v.literal('verification')),
  },
  handler: async (ctx, args) => {
    // PLACEHOLDER: In production, integrate with an image moderation API
    // (e.g., AWS Rekognition, Google Cloud Vision, Azure Content Safety)
    // For now, flag for manual review if context is chat_image
    if (args.context === 'chat_image') {
      await ctx.db.insert('moderationQueue', {
        reporterId: undefined,
        reportedUserId: args.userId,
        contentType: 'profile_photo',
        contentId: args.storageId,
        contentText: undefined,
        flagCategories: ['image_review_pending'],
        isAutoFlagged: true,
        status: 'pending',
        createdAt: Date.now(),
      });
    }

    // For v1: strict no-nude-pics policy — images pass through but
    // NSFW flag on photos table is checked during display
    return { passed: true, requiresReview: args.context === 'chat_image' };
  },
});
