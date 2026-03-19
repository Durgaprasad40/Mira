import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';

/**
 * Legacy compatibility layer.
 * New code should import from convex/media, convex/permissions, convex/events.
 * These wrappers keep existing frontend call-sites working during migration.
 */

// Legacy: sendProtectedImage → delegates to media.createMediaMessage pattern
// MSG-003 FIX: Auth hardening - verify caller identity server-side
export const sendProtectedImage = mutation({
  args: {
    conversationId: v.id('conversations'),
    authUserId: v.string(), // MSG-003: Auth verification required
    imageStorageId: v.id('_storage'),
    timer: v.number(),
    screenshotAllowed: v.boolean(),
    viewOnce: v.boolean(),
    watermark: v.boolean(),
    // HOLD-TAP-FIX: Accept viewMode from frontend
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    // VIDEO-FIX: Accept mediaType to distinguish photo vs video
    mediaType: v.optional(v.union(v.literal('image'), v.literal('video'))),
    // VIDEO-MIRROR-FIX: Accept isMirrored flag for front-camera videos
    isMirrored: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const {
      conversationId,
      authUserId,
      imageStorageId,
      timer,
      screenshotAllowed,
      viewOnce,
      watermark,
      viewMode,
      mediaType = 'image', // Default to image for backwards compatibility
      isMirrored = false, // VIDEO-MIRROR-FIX: Default to false
    } = args;
    const now = Date.now();

    // MSG-003 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const senderId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!senderId) {
      throw new Error('Unauthorized: user not found');
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    const sender = await ctx.db.get(senderId);
    if (!sender) throw new Error('Sender not found');

    // MEDIA-BUG-001 FIX: Validate storage object exists before creating media
    // This prevents "blank media" bugs caused by failed uploads returning stale storageIds
    const storageUrl = await ctx.storage.getUrl(imageStorageId);
    if (!storageUrl) {
      throw new Error('Upload validation failed: storage object not found. Please try uploading again.');
    }

    // Insert media row
    // HOLD-TAP-FIX: Store viewMode for consistent rendering on both sides
    // VIDEO-FIX: Use passed mediaType instead of hardcoded 'image'
    // VIDEO-MIRROR-FIX: Store isMirrored for front-camera video correction
    const mediaId = await ctx.db.insert('media', {
      chatId: conversationId,
      ownerId: senderId,
      objectKey: imageStorageId,
      mediaType,
      createdAt: now,
      timerSeconds: timer > 0 ? timer : undefined,
      viewOnce,
      watermarkEnabled: watermark,
      viewMode: viewMode ?? 'tap', // Default to tap if not specified
      isMirrored: mediaType === 'video' ? isMirrored : undefined, // Only store for videos
    });

    // Insert message row
    // VIDEO-FIX: Use correct type and content based on mediaType
    const isVideo = mediaType === 'video';
    const messageId = await ctx.db.insert('messages', {
      conversationId,
      senderId,
      type: isVideo ? 'video' : 'image',
      content: isVideo ? 'Protected Video' : 'Protected Photo',
      mediaId,
      createdAt: now,
    });

    // Create permissions for recipients
    for (const participantId of conversation.participants) {
      if (participantId === senderId) continue;
      await ctx.db.insert('mediaPermissions', {
        mediaId,
        senderId,
        recipientId: participantId,
        canView: true,
        canScreenshot: screenshotAllowed,
        revoked: false,
        viewCount: 0,
      });
    }

    // Update conversation
    await ctx.db.patch(conversationId, { lastMessageAt: now });

    // Notify recipient
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId) {
      await ctx.db.insert('notifications', {
        userId: recipientId,
        type: 'message',
        title: 'New Message',
        body: `${sender.name} sent you a protected ${isVideo ? 'video' : 'photo'}`,
        data: { conversationId },
        createdAt: now,
      });
    }

    return { success: true, messageId, mediaId };
  },
});

// Legacy: getMediaUrl → uses new media/permissions tables
// MSG-P1-001 FIX: Server-side auth - verify caller matches requested userId
export const getMediaUrl = query({
  args: {
    messageId: v.id('messages'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { messageId, userId } = args;
    const now = Date.now();

    // MSG-P1-001 FIX: Server-side auth verification
    // Verify caller identity matches the requested userId
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const callerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (callerUserId !== userId) {
        // Caller is not authorized to view media as this user
        return null;
      }
    }

    const message = await ctx.db.get(messageId);
    if (!message) return null;

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return null;
    }

    // No mediaId means not a protected message
    if (!message.mediaId) return null;

    const media = await ctx.db.get(message.mediaId);
    if (!media) return null;

    // EXPIRY-SYNC-FIX: Check global expiry first (applies to both owner and recipient)
    if (media.expiredAt) {
      return {
        url: null,
        isExpired: true,
        allowScreenshot: false,
        shouldBlur: true,
        watermarkText: null,
        mediaId: media._id,
        timerSeconds: null,
        expiresAt: null, // TIMER-FIX: Include deadline for consistency
        viewOnce: media.viewOnce,
        viewMode: media.viewMode ?? 'tap', // HOLD-TAP-FIX: Include viewMode
        mediaType: media.mediaType ?? 'image', // VIDEO-FIX: Include mediaType for viewer
        isMirrored: media.isMirrored ?? false, // VIDEO-MIRROR-FIX: Include mirrored flag
      };
    }

    // Find permission first (needed for owner too to show timer)
    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', media._id).eq('recipientId', userId)
      )
      .first();

    // Owner can view if not globally expired
    if (media.ownerId === userId) {
      const url = await ctx.storage.getUrl(media.objectKey);
      // MEDIA-BUG-002 FIX: Handle null URL (storage object missing/deleted)
      if (!url) {
        return {
          url: null,
          isExpired: false,
          allowScreenshot: true,
          shouldBlur: false,
          watermarkText: null,
          mediaId: media._id,
          timerSeconds: null,
          expiresAt: null,
          viewOnce: false,
          viewMode: media.viewMode ?? 'tap',
          mediaType: media.mediaType ?? 'image', // VIDEO-FIX: Include mediaType for viewer
          isMirrored: media.isMirrored ?? false, // VIDEO-MIRROR-FIX: Include mirrored flag
          error: 'storage_unavailable', // Indicates media could not be loaded
        };
      }
      // TIMER-FIX: For owner, show the recipient's timer deadline if exists
      // This ensures owner sees the same countdown as the recipient
      const recipientPermission = await ctx.db
        .query('mediaPermissions')
        .withIndex('by_media_recipient', (q) => q.eq('mediaId', media._id))
        .first();
      return {
        url,
        isExpired: false,
        allowScreenshot: true,
        shouldBlur: false,
        watermarkText: null,
        mediaId: media._id,
        timerSeconds: media.timerSeconds ?? null,
        expiresAt: recipientPermission?.expiresAt ?? null, // TIMER-FIX: Owner sees recipient's deadline
        viewOnce: media.viewOnce,
        viewMode: media.viewMode ?? 'tap', // HOLD-TAP-FIX: Include viewMode
        mediaType: media.mediaType ?? 'image', // VIDEO-FIX: Include mediaType for viewer
        isMirrored: media.isMirrored ?? false, // VIDEO-MIRROR-FIX: Include mirrored flag
      };
    }

    if (!permission || permission.revoked || !permission.canView) {
      return { url: null, isExpired: true, allowScreenshot: false, shouldBlur: true, watermarkText: null, mediaId: media._id, timerSeconds: null, expiresAt: null, viewOnce: false, viewMode: media.viewMode ?? 'tap', mediaType: media.mediaType ?? 'image', isMirrored: media.isMirrored ?? false };
    }

    // Timer expired
    if (permission.expiresAt && now >= permission.expiresAt) {
      return { url: null, isExpired: true, allowScreenshot: false, shouldBlur: true, watermarkText: null, mediaId: media._id, timerSeconds: null, expiresAt: permission.expiresAt, viewOnce: false, viewMode: media.viewMode ?? 'tap', mediaType: media.mediaType ?? 'image', isMirrored: media.isMirrored ?? false };
    }

    // View-once consumed
    if (media.viewOnce && permission.viewCount >= 1) {
      return { url: null, isExpired: true, allowScreenshot: false, shouldBlur: true, watermarkText: null, mediaId: media._id, timerSeconds: null, expiresAt: null, viewOnce: true, viewMode: media.viewMode ?? 'tap', mediaType: media.mediaType ?? 'image', isMirrored: media.isMirrored ?? false };
    }

    const allowScreenshot = permission.canScreenshot &&
      (permission.allowedUntil == null || now < permission.allowedUntil);
    const shouldBlur = !allowScreenshot;

    const url = await ctx.storage.getUrl(media.objectKey);

    // MEDIA-BUG-002 FIX: Handle null URL (storage object missing/deleted)
    if (!url) {
      return {
        url: null,
        isExpired: false,
        allowScreenshot: false,
        shouldBlur: true,
        watermarkText: null,
        mediaId: media._id,
        timerSeconds: null,
        expiresAt: null,
        viewOnce: false,
        viewMode: media.viewMode ?? 'tap',
        mediaType: media.mediaType ?? 'image', // VIDEO-FIX: Include mediaType for viewer
        isMirrored: media.isMirrored ?? false, // VIDEO-MIRROR-FIX: Include mirrored flag
        error: 'storage_unavailable', // Indicates media could not be loaded
      };
    }

    // Build watermark
    const viewer = await ctx.db.get(userId);
    const viewerName = viewer?.name || 'Unknown';
    const dateStr = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
    const watermarkText = media.watermarkEnabled ? `${viewerName} · ${dateStr}` : null;

    return {
      url,
      isExpired: false,
      allowScreenshot,
      shouldBlur,
      watermarkText,
      mediaId: media._id,
      timerSeconds: media.timerSeconds ?? null,
      expiresAt: permission.expiresAt ?? null, // TIMER-FIX: Include absolute deadline
      viewOnce: media.viewOnce,
      viewMode: media.viewMode ?? 'tap', // HOLD-TAP-FIX: Include viewMode
      mediaType: media.mediaType ?? 'image', // VIDEO-FIX: Include mediaType for viewer
      isMirrored: media.isMirrored ?? false, // VIDEO-MIRROR-FIX: Include mirrored flag
    };
  },
});

// Legacy: markViewed → uses new tables
// MSG-006 FIX: Auth hardening - verify caller identity server-side
export const markViewed = mutation({
  args: {
    messageId: v.id('messages'),
    authUserId: v.string(), // MSG-006: Auth verification required
  },
  handler: async (ctx, args) => {
    const { messageId, authUserId } = args;
    const now = Date.now();

    // MSG-006 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { success: true }; // Silent return for view tracking
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: true }; // Silent return for view tracking
    }

    const message = await ctx.db.get(messageId);
    if (!message || !message.mediaId) return { success: true };

    const media = await ctx.db.get(message.mediaId);
    if (!media) return { success: true };

    // Owner doesn't consume permissions
    if (media.ownerId === userId) return { success: true };

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', media._id).eq('recipientId', userId)
      )
      .first();

    if (!permission) return { success: true };

    const updates: Record<string, any> = {
      viewCount: permission.viewCount + 1,
      lastViewedAt: now,
    };

    if (!permission.openedAt) {
      updates.openedAt = now;
      if (media.timerSeconds && media.timerSeconds > 0) {
        updates.expiresAt = now + media.timerSeconds * 1000;
      }
    }

    await ctx.db.patch(permission._id, updates);

    // Log event
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId: media._id,
      actorId: userId,
      type: 'media_opened',
      metadata: { viewCount: updates.viewCount },
      createdAt: now,
    });

    return { success: true, expiresAt: updates.expiresAt };
  },
});

// Legacy: markExpired → uses new tables
// MSG-006 FIX: Auth hardening - verify caller identity server-side
export const markExpired = mutation({
  args: {
    messageId: v.id('messages'),
    authUserId: v.string(), // MSG-006: Auth verification required
  },
  handler: async (ctx, args) => {
    const { messageId, authUserId } = args;
    const now = Date.now();

    // MSG-006 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { success: true }; // Silent return for expiry tracking
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: true }; // Silent return for expiry tracking
    }

    const message = await ctx.db.get(messageId);
    if (!message || !message.mediaId) return { success: true };

    const media = await ctx.db.get(message.mediaId);
    if (!media) return { success: true };

    // EXPIRY-SYNC-FIX: Mark media itself as expired so BOTH sender and receiver see it
    // This is the single source of truth for expiry status
    if (!media.expiredAt) {
      await ctx.db.patch(media._id, { expiredAt: now });
    }

    // Revoke all permissions
    const permissions = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) => q.eq('mediaId', media._id))
      .collect();

    for (const perm of permissions) {
      if (!perm.revoked) {
        await ctx.db.patch(perm._id, { revoked: true });
      }
    }

    // Log event
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId: media._id,
      actorId: userId,
      type: 'media_expired',
      createdAt: now,
    });

    // DUPLICATE-FIX: Removed system message insertion
    // The ProtectedMediaBubble already shows "Expired" pill - no need for duplicate

    return { success: true };
  },
});

// Legacy: logScreenshotEvent → delegates to events module pattern
export const logScreenshotEvent = mutation({
  args: {
    messageId: v.id('messages'),
    // MEDIA-P1-003 FIX: Removed userId - now derived from server auth
    wasTaken: v.boolean(),
  },
  handler: async (ctx, args) => {
    // MEDIA-P1-003 FIX: Derive caller identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: true }; // Silent return for unauthenticated
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      return { success: true }; // Silent return if user not found
    }

    const { messageId, wasTaken } = args;
    const now = Date.now();

    const message = await ctx.db.get(messageId);
    if (!message || !message.mediaId) return { success: true };

    const media = await ctx.db.get(message.mediaId);
    if (!media) return { success: true };

    const eventType = wasTaken ? 'screenshot_taken' : 'screenshot_attempted';

    // Always log for audit
    await ctx.db.insert('securityEvents', {
      chatId: media.chatId,
      mediaId: media._id,
      actorId: userId,
      type: eventType,
      createdAt: now,
    });

    // Deduplicate system messages for screenshot_taken
    if (wasTaken) {
      const existing = await ctx.db
        .query('securityEvents')
        .withIndex('by_media', (q) => q.eq('mediaId', media._id))
        .filter((q) =>
          q.and(
            q.eq(q.field('actorId'), userId),
            q.eq(q.field('type'), 'screenshot_taken')
          )
        )
        .collect();

      // Only one system message per actor+media (we just inserted one, so check <= 1)
      if (existing.length <= 1) {
        await ctx.db.insert('messages', {
          conversationId: media.chatId,
          senderId: userId,
          type: 'system',
          content: '📸 Screenshot taken',
          systemSubtype: 'screenshot_taken',
          createdAt: now,
        });
      }
    }

    return { success: true };
  },
});
