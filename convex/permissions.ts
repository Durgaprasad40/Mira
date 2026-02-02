import { v } from 'convex/values';
import { mutation } from './_generated/server';

// Sender controls screenshot permission: OFF | ON | ON_FOR_10_MIN
export const setScreenshotPermission = mutation({
  args: {
    mediaId: v.id('media'),
    recipientId: v.id('users'),
    mode: v.union(v.literal('OFF'), v.literal('ON'), v.literal('ON_FOR_10_MIN')),
    senderId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, recipientId, mode, senderId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    // Only owner can change permissions
    if (media.ownerId !== senderId) {
      throw new Error('Not authorized — only media owner can change permissions');
    }

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', mediaId).eq('recipientId', recipientId)
      )
      .first();

    if (!permission) throw new Error('Permission row not found');

    let canScreenshot = false;
    let allowedUntil: number | undefined = undefined;
    let eventSubtype: 'permission_granted' | 'permission_revoked' = 'permission_revoked';

    switch (mode) {
      case 'OFF':
        canScreenshot = false;
        eventSubtype = 'permission_revoked';
        break;
      case 'ON':
        canScreenshot = true;
        eventSubtype = 'permission_granted';
        break;
      case 'ON_FOR_10_MIN':
        canScreenshot = true;
        allowedUntil = now + 10 * 60 * 1000;
        eventSubtype = 'permission_granted';
        break;
    }

    await ctx.db.patch(permission._id, {
      canScreenshot,
      allowedUntil,
    });

    // Log security event
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId,
      actorId: senderId,
      type: eventSubtype,
      metadata: { mode, recipientId },
      createdAt: now,
    });

    // Insert system message
    const label = mode === 'OFF'
      ? '🔒 Screenshot access revoked'
      : mode === 'ON_FOR_10_MIN'
        ? '🔓 Screenshot access granted (10 min)'
        : '🔓 Screenshot access granted';

    await ctx.db.insert('messages', {
      conversationId: media.chatId,
      senderId,
      type: 'system',
      content: label,
      systemSubtype: eventSubtype,
      createdAt: now,
    });

    return { success: true };
  },
});

// Recipient requests screenshot access from sender
export const requestScreenshotAccess = mutation({
  args: {
    mediaId: v.id('media'),
    requesterId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, requesterId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    const conversation = await ctx.db.get(media.chatId);
    if (!conversation || !conversation.participants.includes(requesterId)) {
      throw new Error('Not authorized');
    }

    // Cannot request if you're the owner
    if (media.ownerId === requesterId) {
      throw new Error('Owner cannot request access to own media');
    }

    // Log security event
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId,
      actorId: requesterId,
      type: 'access_requested',
      createdAt: now,
    });

    // Insert system message
    const requester = await ctx.db.get(requesterId);
    const name = requester?.name || 'Someone';
    await ctx.db.insert('messages', {
      conversationId: media.chatId,
      senderId: requesterId,
      type: 'system',
      content: `${name} requested screenshot access`,
      systemSubtype: 'access_requested',
      createdAt: now,
    });

    return { success: true };
  },
});
