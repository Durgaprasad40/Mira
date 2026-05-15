import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { validateOwnership } from './helpers';
import { reserveActionSlots } from './actionRateLimits';

// P0-1: Anti-abuse limits for media report submissions, identical scale to
// `users.reportUser` per-reporter caps. Counted only on successful submissions
// (i.e. after dedupe + ownership validation pass).
const REPORT_MEDIA_HOURLY_MAX = 5;
const REPORT_MEDIA_DAILY_MAX = 30;
const REPORT_MEDIA_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
// P1-7: Per-target hourly spike protection for media reports — mirrors the
// `reportUser` P1-5 spike rule. >=10 distinct media reports against a single
// user inside a trailing 1h window escalates the user to a high-severity
// behaviorFlag and shadow-bans them from Phase-1 Discover.
const REPORT_MEDIA_SPIKE_WINDOW_MS = 60 * 60 * 1000;
const REPORT_MEDIA_SPIKE_THRESHOLD = 10;

// Report that a screenshot was taken — deduplicates system messages
export const reportScreenshotTaken = mutation({
  args: {
    mediaId: v.id('media'),
    actorId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, actorId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    // Validate actor is in the permission table for this media
    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', mediaId).eq('recipientId', actorId)
      )
      .first();

    // Owner can also trigger this (on their own device in testing), allow gracefully
    if (!permission && media.ownerId !== actorId) {
      throw new Error('Not authorized');
    }

    // Dedupe: check if a screenshot_taken event already exists for this media + actor
    const existingEvents = await ctx.db
      .query('securityEvents')
      .withIndex('by_media', (q) => q.eq('mediaId', mediaId))
      .filter((q) =>
        q.and(
          q.eq(q.field('actorId'), actorId),
          q.eq(q.field('type'), 'screenshot_taken')
        )
      )
      .collect();

    // Always log the event for audit
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId,
      actorId,
      type: 'screenshot_taken',
      metadata: { deduped: existingEvents.length > 0 },
      createdAt: now,
    });

    // Only insert ONE system message per (mediaId + actorId) — dedupe
    if (existingEvents.length === 0) {
      await ctx.db.insert('messages', {
        conversationId: media.chatId,
        senderId: actorId,
        type: 'system',
        content: '📸 Screenshot taken',
        systemSubtype: 'screenshot_taken',
        createdAt: now,
      });
    }

    return { success: true };
  },
});

// Report screenshot attempted (e.g. Android blocked it)
export const reportScreenshotAttempted = mutation({
  args: {
    mediaId: v.id('media'),
    actorId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, actorId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId,
      actorId,
      type: 'screenshot_attempted',
      createdAt: now,
    });

    return { success: true };
  },
});

// Get security events for a media item (sender-only audit view)
export const getSecurityEvents = query({
  args: {
    mediaId: v.id('media'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, userId } = args;

    const media = await ctx.db.get(mediaId);
    if (!media) return [];

    // Only owner can view full event log
    if (media.ownerId !== userId) return [];

    const events = await ctx.db
      .query('securityEvents')
      .withIndex('by_media', (q) => q.eq('mediaId', mediaId))
      .collect();

    return events;
  },
});

// Submit a media report
//
// P0-1 SECURITY FIX: Previously accepted `reporterId: v.id('users')` raw from
// the client which allowed any caller to file reports as any other user
// (IDOR). The mutation now derives `reporterId` from a validated session via
// `validateOwnership(token, authUserId)`, mirroring the
// `users.reportUser` ownership pattern. Adds:
//   * Self-report prevention
//   * 24h per-pair dedupe (same reporter + reported user)
//   * Per-reporter anti-abuse rate limit (5/hour, 30/day)
//   * Description length cap
export const reportMedia = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    reportedUserId: v.id('users'),
    chatId: v.id('conversations'),
    mediaId: v.optional(v.id('media')),
    reason: v.union(
      v.literal('inappropriate_content'),
      v.literal('non_consensual'),
      v.literal('screenshot_abuse'),
      v.literal('harassment'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // P0-1: Server-derived reporterId. Throws on session/ownership failure.
    const reporterId = await validateOwnership(ctx, args.token, args.authUserId);

    if (reporterId === args.reportedUserId) {
      return { success: false as const, error: 'cannot_report_self' };
    }

    const description = args.description?.trim();
    if (description && description.length > 500) {
      return { success: false as const, error: 'description_too_long' };
    }

    // P0-1: Per-pair dedupe — one media report per (reporter, reported user)
    // per 24h window. Mirrors users.reportUser dedupe semantics so a single
    // submit-storm cannot flood the moderation queue.
    const recentReport = await ctx.db
      .query('mediaReports')
      .withIndex('by_reporter', (q) => q.eq('reporterId', reporterId))
      .filter((q) =>
        q.and(
          q.eq(q.field('reportedUserId'), args.reportedUserId),
          q.gte(q.field('createdAt'), now - REPORT_MEDIA_DEDUPE_WINDOW_MS),
        ),
      )
      .first();
    if (recentReport) {
      return { success: false as const, error: 'duplicate_recent_report' };
    }

    // P0-1: Per-reporter anti-abuse rate limit. Reserve BEFORE the insert so
    // a tampered client cannot burn through the moderation queue.
    const limit = await reserveActionSlots(ctx, reporterId, 'report_media', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: REPORT_MEDIA_HOURLY_MAX },
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: REPORT_MEDIA_DAILY_MAX },
    ]);
    if (!limit.accept) {
      return {
        success: false as const,
        error: 'rate_limited',
        retryAfterMs: limit.retryAfterMs,
      };
    }

    await ctx.db.insert('mediaReports', {
      reporterId,
      reportedUserId: args.reportedUserId,
      mediaId: args.mediaId,
      chatId: args.chatId,
      reason: args.reason,
      description: description || undefined,
      status: 'pending',
      createdAt: now,
    });

    // P1-7: Per-target hourly spike protection. Identical pattern to
    // `users.reportUser` P1-5 but scoped to mediaReports. Indexed by
    // `by_reported_user`; only the trailing 1h slice is counted.
    const spikeWindowStart = now - REPORT_MEDIA_SPIKE_WINDOW_MS;
    const recentMediaReports = await ctx.db
      .query('mediaReports')
      .withIndex('by_reported_user', (q) => q.eq('reportedUserId', args.reportedUserId))
      .filter((q) => q.gte(q.field('createdAt'), spikeWindowStart))
      .collect();

    if (recentMediaReports.length >= REPORT_MEDIA_SPIKE_THRESHOLD) {
      const existingFlag = await ctx.db
        .query('behaviorFlags')
        .withIndex('by_user_type', (q) =>
          q.eq('userId', args.reportedUserId).eq('flagType', 'reported_by_multiple')
        )
        .first();

      const flagDescription = `Media-report spike: ${recentMediaReports.length} reports in last 1h`;
      if (!existingFlag) {
        await ctx.db.insert('behaviorFlags', {
          userId: args.reportedUserId,
          flagType: 'reported_by_multiple',
          severity: 'high',
          description: flagDescription,
          createdAt: now,
        });
      } else {
        await ctx.db.patch(existingFlag._id, {
          severity: 'high',
          description: flagDescription,
        });
      }

      // P1-2 / P1-7: Shadow-ban from Discover on spike. Idempotent.
      const reportedUser = await ctx.db.get(args.reportedUserId);
      if (reportedUser && reportedUser.discoverShadowBanned !== true) {
        await ctx.db.patch(args.reportedUserId, { discoverShadowBanned: true });
      }
    }

    return { success: true as const };
  },
});
