import { v } from 'convex/values';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import {
  isChatRoomPrivateDmConversation,
  isChatRoomPrivateDmExpired,
} from './chatRoomDmRetention';

/**
 * Legacy compatibility layer.
 * New code should import from convex/media, convex/permissions, convex/events.
 * These wrappers keep existing frontend call-sites working during migration.
 */

type MediaDoc = Doc<'media'>;

async function isBlockedBidirectional(
  ctx: MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  const block1 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId1).eq('blockedUserId', userId2)
    )
    .first();
  if (block1) return true;

  const block2 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId2).eq('blockedUserId', userId1)
    )
    .first();
  return !!block2;
}

async function hasReportBetween(
  ctx: MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  const report1 = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', userId1).eq('reportedUserId', userId2)
    )
    .collect();
  if (report1.some((report) => !report.roomId)) return true;

  const report2 = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', userId2).eq('reportedUserId', userId1)
    )
    .collect();
  return report2.some((report) => !report.roomId);
}

function isUnavailableDmUser(user: Doc<'users'> | null): boolean {
  return !user || !user.isActive || user.isBanned === true || !!user.deletedAt;
}

function hasActiveLinkedMatch(
  conversation: Doc<'conversations'>,
  match: Doc<'matches'> | null
): boolean {
  if (!conversation.matchId) return true;
  if (!match || match.isActive === false) return false;

  const participantIds = new Set(conversation.participants.map((id) => id as string));
  return participantIds.has(match.user1Id as string) && participantIds.has(match.user2Id as string);
}

async function revokeMediaPermissionsForMedia(
  ctx: MutationCtx,
  mediaId: Id<'media'>
): Promise<void> {
  const permissions = await ctx.db
    .query('mediaPermissions')
    .withIndex('by_media_recipient', (q) => q.eq('mediaId', mediaId))
    .collect();

  for (const permission of permissions) {
    if (!permission.revoked) {
      await ctx.db.patch(permission._id, { revoked: true });
    }
  }
}

async function finalizeExpiredMedia(
  ctx: MutationCtx,
  media: MediaDoc,
  expiredAt: number
): Promise<void> {
  if (!media.expiredAt) {
    await ctx.db.patch(media._id, { expiredAt });
  }

  await revokeMediaPermissionsForMedia(ctx, media._id);

  if (media.deletedAt) {
    return;
  }

  try {
    await ctx.storage.delete(media.objectKey);
    await ctx.db.patch(media._id, {
      expiredAt: media.expiredAt ?? expiredAt,
      deletedAt: expiredAt,
    });
  } catch {
    // Best effort only. The expiredAt gate still blocks backend access and
    // cron cleanup will retry storage deletion on the next sweep.
  }
}

async function assertCanSendProtectedMedia(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
  senderId: Id<'users'>,
  now: number
): Promise<{
  conversation: Doc<'conversations'>;
  sender: Doc<'users'>;
  recipientId: Id<'users'> | undefined;
}> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new Error('Conversation not found');

  const isChatRoomDm = isChatRoomPrivateDmConversation(conversation);
  if (isChatRoomDm) {
    throw new Error('Use Chat Room DM APIs for room-scoped media');
  }

  if (!conversation.participants.includes(senderId)) {
    throw new Error('Not authorized');
  }

  const recipientId = conversation.participants.find((id) => id !== senderId);
  if (recipientId && await isBlockedBidirectional(ctx, senderId, recipientId)) {
    throw new Error('Cannot send message');
  }
  if (recipientId && await hasReportBetween(ctx, senderId, recipientId)) {
    throw new Error('Cannot send message');
  }

  const sourceRoomId = conversation.sourceRoomId;
  if (sourceRoomId && recipientId) {
    const mutedByRecipient = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter_target', (q) =>
        q
          .eq('roomId', sourceRoomId)
          .eq('muterId', recipientId)
          .eq('targetUserId', senderId)
      )
      .first();
    if (mutedByRecipient) {
      throw new Error("You can't message this user right now.");
    }
  }

  if (recipientId) {
    const recipient = await ctx.db.get(recipientId);
    if (isUnavailableDmUser(recipient)) {
      throw new Error('Recipient unavailable');
    }
  }

  if (conversation.matchId) {
    const match = await ctx.db.get(conversation.matchId);
    if (!hasActiveLinkedMatch(conversation, match)) {
      throw new Error('This chat is no longer active.');
    }
  }

  if (conversation.confessionId && conversation.expiresAt && conversation.expiresAt <= now) {
    throw new Error('This chat has expired');
  }
  if (isChatRoomPrivateDmExpired(conversation, now)) {
    throw new Error('This chat expired');
  }

  if (isChatRoomDm && sourceRoomId) {
    const senderBan = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', sourceRoomId).eq('userId', senderId))
      .first();
    if (senderBan) {
      throw new Error('You can no longer message members of this room.');
    }
  }

  const oneMinuteAgo = now - 60000;
  const recentMessages = await ctx.db
    .query('messages')
    .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId))
    .filter((q) =>
      q.and(
        q.eq(q.field('senderId'), senderId),
        q.gt(q.field('createdAt'), oneMinuteAgo)
      )
    )
    .take(10);
  if (recentMessages.length >= 10) {
    throw new Error('You are sending messages too quickly');
  }

  const sender = await ctx.db.get(senderId);
  if (!sender) throw new Error('Sender not found');
  if (sender.emailVerified !== true) {
    throw new Error('Please verify your email address before sending messages.');
  }
  const verificationStatus = sender.verificationStatus || 'unverified';
  if (verificationStatus !== 'verified') {
    throw new Error('Please complete profile verification before sending messages.');
  }

  return { conversation, sender, recipientId };
}

// Legacy: sendProtectedImage → delegates to media.createMediaMessage pattern
// MSG-003 FIX: Auth hardening - verify caller identity server-side
export const sendProtectedImage = mutation({
  args: {
    conversationId: v.id('conversations'),
    token: v.string(),
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
      token,
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

    const sessionToken = token.trim();
    if (!sessionToken) {
      throw new Error('Unauthorized: authentication required');
    }
    const senderId = await validateSessionToken(ctx, sessionToken);
    if (!senderId) {
      throw new Error('Unauthorized: user not found');
    }

    const { conversation, sender } = await assertCanSendProtectedMedia(
      ctx,
      conversationId,
      senderId,
      now
    );

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
        phase: 'phase1',
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
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { messageId, token } = args;
    const now = Date.now();

    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) return null;

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
    if (media.expiredAt || media.deletedAt) {
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

    // VIEW-ONCE-FIX: Don't check viewCount >= 1 here!
    // The issue was: markViewed increments viewCount, then Convex reactivity re-runs this query,
    // which sees viewCount >= 1 and returns expired while the viewer is still open.
    // Instead, view-once expiry is determined ONLY by media.expiredAt (set when viewer closes).
    // The viewCount check was causing premature expiry during active viewing.
    // (Removed the viewCount >= 1 check that was here)

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
    token: v.string(), // MSG-006: Auth verification required
  },
  handler: async (ctx, args) => {
    const { messageId, token } = args;
    const now = Date.now();

    // MSG-006 FIX: Verify caller identity via session-based auth
    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: true }; // Silent return for view tracking
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: true }; // Silent return for view tracking
    }

    const message = await ctx.db.get(messageId);
    if (!message || !message.mediaId) return { success: true };

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: true };
    }

    const media = await ctx.db.get(message.mediaId);
    if (!media) return { success: true };
    if (media.expiredAt || media.deletedAt) return { success: true };

    // Owner doesn't consume permissions
    if (media.ownerId === userId) return { success: true };

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', media._id).eq('recipientId', userId)
      )
      .first();

    if (!permission || permission.revoked || !permission.canView) return { success: true };
    if (permission.expiresAt && now >= permission.expiresAt) {
      return { success: true, expiresAt: permission.expiresAt };
    }

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
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { messageId, token } = args;
    const now = Date.now();

    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: true }; // Silent return for expiry tracking
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: true }; // Silent return for expiry tracking
    }

    const message = await ctx.db.get(messageId);
    if (!message || !message.mediaId) return { success: true };

    const media = await ctx.db.get(message.mediaId);
    if (!media) return { success: true };

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: true };
    }

    const permission = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) =>
        q.eq('mediaId', media._id).eq('recipientId', userId)
      )
      .first();
    const isSender = media.ownerId === userId;
    const isRecipient = !!permission && !permission.revoked && permission.canView;
    if (!isSender && !isRecipient) {
      return { success: true };
    }

    await finalizeExpiredMedia(ctx, media, now);

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

export const cleanupExpiredMedia = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const permissions = await ctx.db.query('mediaPermissions').collect();
    const expiredMediaIds = new Set<Id<'media'>>();

    for (const permission of permissions) {
      if (permission.expiresAt && permission.expiresAt <= now) {
        expiredMediaIds.add(permission.mediaId);
      }
    }

    const mediaRecords = await ctx.db.query('media').collect();
    for (const media of mediaRecords) {
      if (media.expiredAt || media.deletedAt) {
        expiredMediaIds.add(media._id);
      }
    }

    let expiredCount = 0;
    for (const mediaId of expiredMediaIds) {
      const media = await ctx.db.get(mediaId);
      if (!media) continue;
      await finalizeExpiredMedia(ctx, media, media.expiredAt ?? now);
      expiredCount += 1;
    }

    return { success: true, expiredCount };
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
