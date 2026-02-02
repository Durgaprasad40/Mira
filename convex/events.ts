import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

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
export const reportMedia = mutation({
  args: {
    reporterId: v.id('users'),
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

    await ctx.db.insert('mediaReports', {
      reporterId: args.reporterId,
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
