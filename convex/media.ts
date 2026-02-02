import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Create a protected media message with per-recipient permissions
export const createMediaMessage = mutation({
  args: {
    chatId: v.id('conversations'),
    senderId: v.id('users'),
    objectKey: v.id('_storage'),
    mediaType: v.union(v.literal('image'), v.literal('video')),
    timerSeconds: v.optional(v.number()),
    viewOnce: v.optional(v.boolean()),
    watermarkEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const {
      chatId,
      senderId,
      objectKey,
      mediaType,
      timerSeconds,
      viewOnce = false,
      watermarkEnabled = true,
    } = args;
    const now = Date.now();

    const conversation = await ctx.db.get(chatId);
    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    const sender = await ctx.db.get(senderId);
    if (!sender) throw new Error('Sender not found');

    // 1. Insert media row (never stores a URL — only objectKey)
    const mediaId = await ctx.db.insert('media', {
      chatId,
      ownerId: senderId,
      objectKey,
      mediaType,
      createdAt: now,
      timerSeconds: timerSeconds && timerSeconds > 0 ? timerSeconds : undefined,
      viewOnce,
      watermarkEnabled,
    });

    // 2. Insert message row referencing media
    const messageId = await ctx.db.insert('messages', {
      conversationId: chatId,
      senderId,
      type: mediaType,
      content: 'Protected Photo',
      mediaId,
      createdAt: now,
    });

    // 3. Create permission rows for each recipient (1:1 chat = other user)
    for (const participantId of conversation.participants) {
      if (participantId === senderId) continue;
      await ctx.db.insert('mediaPermissions', {
        mediaId,
        senderId,
        recipientId: participantId,
        canView: true,
        canScreenshot: false, // blocked by default
        revoked: false,
        viewCount: 0,
      });
    }

    // 4. Update conversation
    await ctx.db.patch(chatId, { lastMessageAt: now });

    // 5. Notify recipients
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId) {
      await ctx.db.insert('notifications', {
        userId: recipientId,
        type: 'message',
        title: 'New Message',
        body: `${sender.name} sent you a protected photo`,
        data: { conversationId: chatId },
        createdAt: now,
      });
    }

    return { success: true, messageId, mediaId };
  },
});

// Open protected media — validates permissions, returns signed URL + metadata
export const openMedia = query({
  args: {
    mediaId: v.id('media'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, userId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) return { error: 'not_found' };

    // Soft-deleted
    if (media.deletedAt) return { error: 'deleted' };

    // Owner can always view their own media
    if (media.ownerId === userId) {
      const url = await ctx.storage.getUrl(media.objectKey);
      return {
        url,
        allowScreenshot: true,
        shouldBlur: false,
        watermarkText: null,
        expiresAt: null,
        viewOnce: media.viewOnce,
        timerSeconds: media.timerSeconds ?? null,
        isOwner: true,
      };
    }

    // Find permission for this recipient
    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', mediaId).eq('recipientId', userId)
      )
      .first();

    if (!permission) return { error: 'no_permission' };
    if (permission.revoked) return { error: 'revoked' };
    if (!permission.canView) return { error: 'no_view' };

    // Timer logic: if openedAt is set and expiresAt has passed → expired
    if (permission.expiresAt && now >= permission.expiresAt) {
      return { error: 'expired' };
    }

    // View-once: if already viewed once → deny
    if (media.viewOnce && permission.viewCount >= 1) {
      return { error: 'view_once_consumed' };
    }

    // Determine screenshot permission
    const allowScreenshot =
      permission.canScreenshot &&
      (permission.allowedUntil === undefined || permission.allowedUntil === null || now < permission.allowedUntil);

    const shouldBlur = !allowScreenshot;

    // Generate URL from private storage
    const url = await ctx.storage.getUrl(media.objectKey);

    // Build watermark text (viewerId + datetime)
    const viewer = await ctx.db.get(userId);
    const viewerName = viewer?.name || 'Unknown';
    const dateStr = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
    const watermarkText = media.watermarkEnabled
      ? `${viewerName} · ${dateStr}`
      : null;

    return {
      url,
      allowScreenshot,
      shouldBlur,
      watermarkText,
      expiresAt: permission.expiresAt ?? null,
      viewOnce: media.viewOnce,
      timerSeconds: media.timerSeconds ?? null,
      isOwner: false,
    };
  },
});

// Record that media was opened — sets openedAt, starts timer, increments viewCount
export const recordMediaOpened = mutation({
  args: {
    mediaId: v.id('media'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, userId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    // Owner viewing doesn't consume permissions
    if (media.ownerId === userId) return { success: true };

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', mediaId).eq('recipientId', userId)
      )
      .first();

    if (!permission) throw new Error('No permission');

    const updates: Record<string, any> = {
      viewCount: permission.viewCount + 1,
      lastViewedAt: now,
    };

    // Start timer on first open
    if (!permission.openedAt) {
      updates.openedAt = now;
      if (media.timerSeconds && media.timerSeconds > 0) {
        updates.expiresAt = now + media.timerSeconds * 1000;
      }
    }

    await ctx.db.patch(permission._id, updates);

    // Log security event
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId,
      actorId: userId,
      type: 'media_opened',
      metadata: { viewCount: updates.viewCount },
      createdAt: now,
    });

    return { success: true, expiresAt: updates.expiresAt };
  },
});

// Mark media as expired (timer ran out or view-once consumed)
export const expireMedia = mutation({
  args: {
    mediaId: v.id('media'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, userId } = args;
    const now = Date.now();

    const media = await ctx.db.get(mediaId);
    if (!media) throw new Error('Media not found');

    const conversation = await ctx.db.get(media.chatId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Not authorized');
    }

    // Revoke all permissions
    const permissions = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) => q.eq('mediaId', mediaId))
      .collect();

    for (const perm of permissions) {
      if (!perm.revoked) {
        await ctx.db.patch(perm._id, { revoked: true });
      }
    }

    // Log event
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId,
      actorId: userId,
      type: 'media_expired',
      createdAt: now,
    });

    // Insert system message
    await ctx.db.insert('messages', {
      conversationId: media.chatId,
      senderId: userId,
      type: 'system',
      content: '⏱ Media expired',
      systemSubtype: 'expired',
      createdAt: now,
    });

    return { success: true };
  },
});

// Get media info for a message (used by chat bubble to know if it's protected)
export const getMediaInfo = query({
  args: {
    mediaId: v.id('media'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { mediaId, userId } = args;

    const media = await ctx.db.get(mediaId);
    if (!media) return null;

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', mediaId).eq('recipientId', userId)
      )
      .first();

    const isOwner = media.ownerId === userId;
    const isExpired = permission?.revoked ||
      (permission?.expiresAt != null && Date.now() >= permission.expiresAt) ||
      (media.viewOnce && (permission?.viewCount ?? 0) >= 1);

    return {
      mediaId,
      mediaType: media.mediaType,
      timerSeconds: media.timerSeconds ?? null,
      viewOnce: media.viewOnce,
      watermarkEnabled: media.watermarkEnabled,
      canScreenshot: isOwner ? true : (permission?.canScreenshot ?? false),
      isExpired: isOwner ? false : !!isExpired,
      isOwner,
    };
  },
});
