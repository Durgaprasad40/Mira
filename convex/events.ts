import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { resolveTrustedUserId } from './helpers';

// Report that a screenshot was taken — deduplicates system messages
export const reportScreenshotTaken = mutation({
  args: {
    mediaId: v.id('media'),
    authUserId: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { mediaId } = args;
    const now = Date.now();

    const actorId = await resolveTrustedUserId(ctx, args);
    if (!actorId) {
      throw new Error('Unauthorized: authentication required');
    }

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
    authUserId: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { mediaId } = args;
    const now = Date.now();

    const actorId = await resolveTrustedUserId(ctx, args);
    if (!actorId) {
      throw new Error('Unauthorized: authentication required');
    }

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    const conversation = await ctx.db.get(media.chatId);
    if (!conversation || !conversation.participants.includes(actorId)) {
      throw new Error('Not authorized');
    }

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', mediaId).eq('recipientId', actorId)
      )
      .first();

    if (!permission && media.ownerId !== actorId) {
      throw new Error('Not authorized');
    }

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
    authUserId: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { mediaId } = args;

    const userId = await resolveTrustedUserId(ctx, args);
    if (!userId) {
      return [];
    }

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
export const reportMedia = mutation({
  args: {
    authUserId: v.optional(v.string()),
    token: v.optional(v.string()),
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

    const reporterId = await resolveTrustedUserId(ctx, args);
    if (!reporterId) {
      throw new Error('Unauthorized: authentication required');
    }

    const conversation = await ctx.db.get(args.chatId);
    if (!conversation || !conversation.participants.includes(reporterId)) {
      throw new Error('Not authorized');
    }

    if (!conversation.participants.includes(args.reportedUserId)) {
      throw new Error('Invalid report target');
    }

    if (args.mediaId) {
      const media = await ctx.db.get(args.mediaId);
      if (!media || media.chatId !== args.chatId) {
        throw new Error('Invalid media report');
      }
    }

    await ctx.db.insert('mediaReports', {
      reporterId,
      reportedUserId: args.reportedUserId,
      mediaId: args.mediaId,
      chatId: args.chatId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: now,
    });

    return { success: true };
  },
});
