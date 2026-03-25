import { v } from 'convex/values';
import { mutation, query, internalMutation, QueryCtx, MutationCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { softMaskText } from './softMask';
import { resolveUserIdByAuthId } from './helpers';

// Phase-2: Helper to check if user has any active chatRoom readOnly penalty
async function hasActiveChatRoomPenalty(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<boolean> {
  const now = Date.now();
  const penalties = await ctx.db
    .query('chatRoomPenalties')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  return penalties.some((p) => p.expiresAt > now);
}

// D1: Helper to check if either user has blocked the other
// Returns true if blocked (should prevent messaging)
async function isBlockedBidirectional(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  // Check if userId1 blocked userId2
  const block1 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId1).eq('blockedUserId', userId2)
    )
    .first();
  if (block1) return true;

  // Check if userId2 blocked userId1
  const block2 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId2).eq('blockedUserId', userId1)
    )
    .first();
  return !!block2;
}

// UNREAD-RULE: Message types that count toward unread badges
// Includes: text, image (photo), video, voice, template, dare
// Excludes: system (screenshot events, permission events, T&D connection system messages, etc.)
const COUNTABLE_MESSAGE_TYPES = ['text', 'image', 'video', 'voice', 'template', 'dare'];

// C1/C2/C3-REPAIR: Helper to compute unread count from source of truth (messages table)
// Used for: race-safe updates, fallback when participant rows are missing, backfill
async function computeUnreadCountFromMessages(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'conversations'>,
  userId: Id<'users'>
): Promise<number> {
  const unreadMessages = await ctx.db
    .query('messages')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
    .filter((q) =>
      q.and(
        q.neq(q.field('senderId'), userId),
        q.eq(q.field('readAt'), undefined)
      )
    )
    .collect();

  // UNREAD-RULE: Only count messages with countable types
  // System messages (screenshot_taken, permission_granted, T&D state, etc.) are excluded
  return unreadMessages.filter((m) => COUNTABLE_MESSAGE_TYPES.includes(m.type)).length;
}

// C1/C2/C3-REPAIR: Helper to upsert participant row with recomputed unread count
// Avoids race conditions by always recomputing from source of truth
async function upsertParticipantUnreadCount(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
  userId: Id<'users'>
): Promise<void> {
  const unreadCount = await computeUnreadCountFromMessages(ctx, conversationId, userId);

  const existing = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_user_conversation', (q) =>
      q.eq('userId', userId).eq('conversationId', conversationId)
    )
    .first();

  if (existing) {
    if (existing.unreadCount !== unreadCount) {
      await ctx.db.patch(existing._id, { unreadCount });
    }
  } else {
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      userId,
      unreadCount,
    });
  }
}

// Send a message
// MSG-001 FIX: Auth hardening - verify caller identity server-side
export const sendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    authUserId: v.string(), // MSG-001: Auth verification required
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('template'), v.literal('dare'), v.literal('voice')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    templateId: v.optional(v.string()),
    // Voice message fields
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    // BUGFIX #3: Client-provided idempotency key to prevent double-decrement on retry
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId, type, content, imageStorageId, templateId, audioStorageId, audioDurationMs, clientMessageId } = args;
    const now = Date.now();

    // MSG-001 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const senderId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!senderId) {
      throw new Error('Unauthorized: user not found');
    }

    // Phase-2: Block DMs if user has active chatRoom readOnly penalty
    if (await hasActiveChatRoomPenalty(ctx, senderId)) {
      throw new Error('You are in read-only mode (24h)');
    }

    // P2-006 FIX: Enforce message length limit (5000 characters max)
    if (content.length > 5000) {
      throw new Error('Message too long');
    }

    // BUGFIX #3: Check for duplicate message (idempotency for retries)
    if (clientMessageId) {
      const existing = await ctx.db
        .query('messages')
        .withIndex('by_conversation_clientMessageId', (q) =>
          q.eq('conversationId', conversationId).eq('clientMessageId', clientMessageId)
        )
        .first();
      if (existing) {
        // Already processed this message, return success without decrementing again
        return { success: true, messageId: existing._id, duplicate: true };
      }
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    // Verify sender is part of conversation
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    // D1: Check if either user has blocked the other
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId && await isBlockedBidirectional(ctx, senderId, recipientId)) {
      throw new Error('Cannot send message');
    }

    // Block sending to expired confession-based conversations
    if (conversation.confessionId && conversation.expiresAt && conversation.expiresAt <= now) {
      throw new Error('This chat has expired');
    }

    // P2-007 FIX: Rate limiting for 1:1 messages (10 messages per minute per sender per conversation)
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

    // 8B: Check email verification before allowing message send
    if (sender.emailVerified !== true) {
      throw new Error('Please verify your email address before sending messages.');
    }

    // 8A: Check photo verification before allowing message send
    const verificationStatus = sender.verificationStatus || 'unverified';
    if (verificationStatus !== 'verified') {
      throw new Error('Please complete profile verification before sending messages.');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE LIMIT ENFORCEMENT DISABLED — No weekly limit for now
    // Re-enable when subscriptions are implemented
    // ═══════════════════════════════════════════════════════════════════════════
    // if (conversation.isPreMatch && sender.gender === 'male') {
    //   // Reset weekly messages if needed
    //   if (now >= sender.messagesResetAt) { ... }
    //   if (sender.messagesRemaining <= 0) {
    //     throw new Error('No messages remaining this week');
    //   }
    //   // Check custom message length
    //   // Decrement message count
    // }
    // ═══════════════════════════════════════════════════════════════════════════

    // Soft-mask sensitive words in Face 1 text messages
    const maskedContent = type === 'text' ? softMaskText(content) : content;

    // Create message (store masked text only)
    // BUGFIX #3: Store clientMessageId for idempotency on retries
    const messageId = await ctx.db.insert('messages', {
      conversationId,
      senderId,
      type,
      content: maskedContent,
      imageStorageId,
      templateId,
      audioStorageId,
      audioDurationMs,
      clientMessageId, // For retry idempotency
      createdAt: now,
    });

    // SEC-4 FIX: Post-insert block verification to close race condition
    // If a block was created between pre-check and insert, delete the message
    if (recipientId && await isBlockedBidirectional(ctx, senderId, recipientId)) {
      await ctx.db.delete(messageId);
      throw new Error('Cannot send message');
    }

    // Update conversation last message time
    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
    });

    // C1/C2/C3-REPAIR: Update recipient's unreadCount via recomputation (race-safe)
    // recipientId already defined from D1 blocking check above
    if (recipientId) {
      // Recompute from source of truth - avoids concurrent increment race conditions
      await upsertParticipantUnreadCount(ctx, conversationId, recipientId);
      // Also ensure sender has a row (will have 0 unread since they just sent)
      await upsertParticipantUnreadCount(ctx, conversationId, senderId);
    }

    // Create notification for recipient
    // 9-5: Add TTL and dedupe key for message notifications
    if (recipientId) {
      const dedupeKey = `message:${conversationId}:unread`;
      // Check for existing notification with same dedupe key
      const existingNotif = await ctx.db
        .query('notifications')
        .withIndex('by_user_dedupe', (q) => q.eq('userId', recipientId).eq('dedupeKey', dedupeKey))
        .first();

      // M1 FIX: Privacy-safe notification body - never expose message content
      const notificationBody = 'You have a new message';

      if (existingNotif) {
        // Update existing notification instead of creating duplicate
        await ctx.db.patch(existingNotif._id, {
          body: notificationBody,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });
      } else {
        await ctx.db.insert('notifications', {
          userId: recipientId,
          type: 'message',
          title: 'New Message',
          body: notificationBody,
          data: { conversationId: conversationId },
          dedupeKey,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });
      }
    }

    return { success: true, messageId };
  },
});

// Send pre-match message (uses template or limited text)
// MSG-002 FIX: Auth hardening - verify caller identity server-side
export const sendPreMatchMessage = mutation({
  args: {
    authUserId: v.string(), // MSG-002: Auth verification required
    toUserId: v.id('users'),
    content: v.string(),
    templateId: v.optional(v.string()),
    // BUGFIX #3: Client-provided idempotency key to prevent double-decrement on retry
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { authUserId, toUserId, content, templateId, clientMessageId } = args;
    const now = Date.now();

    // MSG-002 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const fromUserId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!fromUserId) {
      throw new Error('Unauthorized: user not found');
    }

    // Phase-2: Block DMs if user has active chatRoom readOnly penalty
    if (await hasActiveChatRoomPenalty(ctx, fromUserId)) {
      throw new Error('You are in read-only mode (24h)');
    }

    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');

    // 9-1: Check email verification before allowing pre-match message
    if (fromUser.emailVerified !== true) {
      throw new Error('Please verify your email address before sending messages.');
    }

    // 9-1: Check photo verification before allowing pre-match message
    const verificationStatus = fromUser.verificationStatus || 'unverified';
    if (verificationStatus !== 'verified') {
      throw new Error('Please complete profile verification before sending messages.');
    }

    // D1: Check if either user has blocked the other
    if (await isBlockedBidirectional(ctx, fromUserId, toUserId)) {
      throw new Error('Cannot send message');
    }

    // Check if already have a conversation
    let conversation = await ctx.db
      .query('conversations')
      .filter((q) =>
        q.and(
          q.eq(q.field('isPreMatch'), true),
          q.or(
            q.and(
              q.eq(q.field('participants'), [fromUserId, toUserId])
            ),
            q.and(
              q.eq(q.field('participants'), [toUserId, fromUserId])
            )
          )
        )
      )
      .first();

    // Create conversation if doesn't exist
    if (!conversation) {
      const conversationId = await ctx.db.insert('conversations', {
        participants: [fromUserId, toUserId],
        isPreMatch: true,
        createdAt: now,
      });
      conversation = await ctx.db.get(conversationId);
    }

    if (!conversation) throw new Error('Failed to create conversation');

    // BUGFIX #3: Check for duplicate message (idempotency for retries)
    if (clientMessageId) {
      const existing = await ctx.db
        .query('messages')
        .withIndex('by_conversation_clientMessageId', (q) =>
          q.eq('conversationId', conversation._id).eq('clientMessageId', clientMessageId)
        )
        .first();
      if (existing) {
        // Already processed this message, return success without decrementing again
        return { success: true, messageId: existing._id, conversationId: conversation._id, duplicate: true };
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE LIMIT ENFORCEMENT DISABLED — No weekly limit for now
    // Re-enable when subscriptions are implemented
    // ═══════════════════════════════════════════════════════════════════════════
    // if (fromUser.gender === 'male') {
    //   // Reset weekly messages if needed
    //   if (now >= fromUser.messagesResetAt) { ... }
    //   if (fromUser.messagesRemaining <= 0) {
    //     throw new Error('No messages remaining this week');
    //   }
    //   // Decrement message count
    // }
    // ═══════════════════════════════════════════════════════════════════════════

    // Soft-mask sensitive words in Face 1 text messages
    const msgType = templateId ? 'template' : 'text';
    const maskedContent = msgType === 'text' ? softMaskText(content) : content;

    // BUGFIX #3: Store clientMessageId for idempotency on retries
    const messageId = await ctx.db.insert('messages', {
      conversationId: conversation._id,
      senderId: fromUserId,
      type: msgType,
      content: maskedContent,
      templateId,
      clientMessageId, // For retry idempotency
      createdAt: now,
    });

    await ctx.db.patch(conversation._id, {
      lastMessageAt: now,
    });

    // C1/C2/C3-REPAIR: Update participant unreadCounts via recomputation (race-safe)
    // Recompute from source of truth - avoids concurrent increment race conditions
    await upsertParticipantUnreadCount(ctx, conversation._id, toUserId);
    await upsertParticipantUnreadCount(ctx, conversation._id, fromUserId);

    // 9-5: Notify recipient with TTL and dedupe
    // M1 FIX: Privacy-safe notification body - never expose message content
    const dedupeKey = `message:${conversation._id}:unread`;
    const notificationBody = 'You have a new message';
    const existingNotif = await ctx.db
      .query('notifications')
      .withIndex('by_user_dedupe', (q) => q.eq('userId', toUserId).eq('dedupeKey', dedupeKey))
      .first();

    if (existingNotif) {
      await ctx.db.patch(existingNotif._id, {
        title: `${fromUser.name} sent you a message`,
        body: notificationBody,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
    } else {
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'message',
        title: `${fromUser.name} sent you a message`,
        body: notificationBody,
        data: { conversationId: conversation._id, userId: fromUserId },
        dedupeKey,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
    }

    return { success: true, messageId, conversationId: conversation._id };
  },
});

// Get messages in a conversation
// P0-AUTH-FIX: Require authUserId and resolve server-side only (matches sendMessage pattern)
export const getMessages = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.optional(v.id('users')), // IGNORED: Legacy compat only, never used
    authUserId: v.string(), // P0-AUTH-FIX: Required, resolved server-side
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId, limit = 50, before } = args;

    // P0-AUTH-FIX: Always resolve identity server-side from authUserId
    // Never trust client-provided userId - it is ignored even if passed
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return [];
    }

    // Verify user is part of conversation
    if (!conversation.participants.includes(userId)) {
      return [];
    }

    // SYNC-FIX: Deterministic query - same for all devices
    let query = ctx.db
      .query('messages')
      .withIndex('by_conversation_created', (q) =>
        q.eq('conversationId', conversationId)
      );

    if (before) {
      query = query.filter((q) => q.lt(q.field('createdAt'), before));
    }

    // Fetch latest messages (desc order), then reverse for chronological display
    const messages = await query.order('desc').take(limit);

    // SECURE-MEDIA-FIX: Batch-fetch media info for protected messages
    // This ensures both sender and receiver have consistent metadata (viewMode, expiresAt, expiredAt)
    const mediaIds = messages.filter((m) => m.mediaId).map((m) => m.mediaId!);
    const mediaRecords = await Promise.all(mediaIds.map((id) => ctx.db.get(id)));
    const mediaMap = new Map(mediaRecords.filter(Boolean).map((m) => [m!._id, m!]));

    // SENDER-TIMER-FIX: Fetch permissions correctly for both sender and receiver
    // For receiver: get their own permission (recipientId = userId)
    // For sender: get the recipient's permission (to see their timer)
    const permissionsForUser = await Promise.all(
      mediaIds.map(async (mediaId) => {
        const media = mediaMap.get(mediaId);
        const isOwner = media?.ownerId === userId;

        if (isOwner) {
          // SENDER-TIMER-FIX: Sender needs recipient's permission to show their timer
          // Find any recipient permission for this media
          return ctx.db
            .query('mediaPermissions')
            .withIndex('by_media_recipient', (q) => q.eq('mediaId', mediaId))
            .first();
        } else {
          // Receiver gets their own permission
          return ctx.db
            .query('mediaPermissions')
            .withIndex('by_media_recipient', (q) =>
              q.eq('mediaId', mediaId).eq('recipientId', userId)
            )
            .first();
        }
      })
    );
    const permissionMap = new Map(
      mediaIds.map((id, i) => [id as string, permissionsForUser[i]])
    );

    // Batch-fetch audio URLs for voice messages
    const audioStorageIds = messages.filter((m) => m.audioStorageId).map((m) => m.audioStorageId!);
    const audioUrls = await Promise.all(
      audioStorageIds.map((id) => ctx.storage.getUrl(id))
    );
    const audioUrlMap = new Map(audioStorageIds.map((id, i) => [id as string, audioUrls[i]]));

    // Strip imageStorageId from protected messages and add isProtected flag + media metadata
    return messages.reverse().map((msg) => {
      // Voice messages: include audio URL
      if (msg.type === 'voice' && msg.audioStorageId) {
        const { audioStorageId, ...rest } = msg;
        return {
          ...rest,
          isProtected: false,
          audioUrl: audioUrlMap.get(audioStorageId as string) ?? null,
        };
      }

      if (msg.mediaId) {
        // Protected media — strip storage keys, flag as protected
        const { imageStorageId, ...rest } = msg;
        const media = mediaMap.get(msg.mediaId);
        const permission = permissionMap.get(msg.mediaId as string);
        const isOwner = media?.ownerId === userId;

        // SECURE-MEDIA-FIX: Compute expiry state consistently for both sides
        const globallyExpired = !!media?.expiredAt;
        // VIEW-ONCE-FIX: Don't use viewCount for expiry - it causes race conditions
        // View-once expiry is determined ONLY by media.expiredAt (set when viewer closes)
        // The viewCount >= 1 check was causing premature expiry during active viewing
        const recipientExpired = !isOwner && (
          permission?.revoked ||
          (permission?.expiresAt != null && Date.now() >= permission.expiresAt)
        );
        // SENDER-TIMER-FIX: Both sender and receiver use globallyExpired as single source of truth
        const isExpired = globallyExpired || !!recipientExpired;

        return {
          ...rest,
          isProtected: true,
          // SECURE-MEDIA-FIX: Include media metadata for both sender and receiver
          viewMode: media?.viewMode ?? 'tap',
          timerEndsAt: permission?.expiresAt ?? null, // Absolute deadline (wall-clock)
          isExpired,
          expiredAt: media?.expiredAt ?? null, // For auto-hide timer
          // VIEW-ONCE-FIX: Include viewOnce flag for UI to handle properly
          viewOnce: media?.viewOnce ?? false,
          // SENDER-TIMER-FIX: Include opened state so sender knows recipient is viewing
          recipientOpened: !!(permission?.openedAt),
        };
      }
      return { ...msg, isProtected: false };
    });
  },
});

// Mark messages as read
// MSG-004 FIX: Auth hardening - verify caller identity server-side
export const markAsRead = mutation({
  args: {
    conversationId: v.id('conversations'),
    authUserId: v.string(), // MSG-004: Auth verification required
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId } = args;
    const now = Date.now();

    // MSG-004 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return; // Silent return for mark-as-read (non-critical)
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return; // Silent return for mark-as-read (non-critical)
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return;

    if (!conversation.participants.includes(userId)) {
      return;
    }

    // Get all unread messages not sent by this user
    const unreadMessages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('readAt'), undefined)
        )
      )
      .collect();

    for (const message of unreadMessages) {
      await ctx.db.patch(message._id, { readAt: now });
    }

    // C1/C2/C3-REPAIR: Update user's unreadCount via recomputation (race-safe)
    // Recompute from source of truth - handles missing rows and concurrent races
    await upsertParticipantUnreadCount(ctx, conversationId, userId);

    return { success: true, count: unreadMessages.length };
  },
});

// MESSAGE-TICKS-FIX: Mark messages as delivered
// Called when recipient's app receives/loads messages
export const markAsDelivered = mutation({
  args: {
    conversationId: v.id('conversations'),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId } = args;
    const now = Date.now();

    // Verify caller identity
    if (!authUserId || authUserId.trim().length === 0) {
      return { success: false, count: 0 };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: false, count: 0 };
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false, count: 0 };
    }

    // Get all messages from OTHER user that are not yet delivered
    const undeliveredMessages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('deliveredAt'), undefined)
        )
      )
      .collect();

    for (const message of undeliveredMessages) {
      await ctx.db.patch(message._id, { deliveredAt: now });
    }

    return { success: true, count: undeliveredMessages.length };
  },
});

// DELIVERED-TICK-FIX: Mark ALL incoming messages as delivered across all conversations
// Called when recipient's app loads the messages list (before opening any conversation)
// This ensures "delivered" state is set when message reaches device, not when conversation is opened
export const markAllAsDelivered = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;
    const now = Date.now();

    if (!authUserId || authUserId.trim().length === 0) {
      return { success: false, count: 0 };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: false, count: 0 };
    }

    // Find all messages sent TO this user that are not yet delivered
    // Query all conversations this user is part of
    // SEC-6 NOTE: Access validation is enforced by the by_user index - we only get
    // conversations where this userId is a participant. No additional validation needed.
    const participations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    let totalMarked = 0;

    for (const participation of participations) {
      const undeliveredMessages = await ctx.db
        .query('messages')
        .withIndex('by_conversation', (q) => q.eq('conversationId', participation.conversationId))
        .filter((q) =>
          q.and(
            q.neq(q.field('senderId'), userId),
            q.eq(q.field('deliveredAt'), undefined)
          )
        )
        .collect();

      for (const message of undeliveredMessages) {
        await ctx.db.patch(message._id, { deliveredAt: now });
        totalMarked++;
      }
    }

    return { success: true, count: totalMarked };
  },
});

/**
 * FEAT-2: Delete a message from a private DM conversation.
 * Only the sender can delete their own messages.
 * Hard deletes the message (privacy-first: users expect true deletion).
 */
export const deleteMessage = mutation({
  args: {
    messageId: v.id('messages'),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { messageId, authUserId } = args;

    // Resolve auth ID to user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      // Message already deleted or doesn't exist
      return { success: true, alreadyDeleted: true };
    }

    // Verify sender owns this message
    if (message.senderId !== userId) {
      throw new Error('Unauthorized: you can only delete your own messages');
    }

    // Verify user is part of the conversation
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Unauthorized: conversation not found or access denied');
    }

    // Delete any associated storage (images, voice, etc.)
    if (message.imageStorageId) {
      try {
        await ctx.storage.delete(message.imageStorageId);
      } catch (e) {
        // Storage may already be deleted, continue
        console.warn('[deleteMessage] Failed to delete image storage:', e);
      }
    }
    if (message.audioStorageId) {
      try {
        await ctx.storage.delete(message.audioStorageId);
      } catch (e) {
        console.warn('[deleteMessage] Failed to delete audio storage:', e);
      }
    }

    // Hard delete the message
    await ctx.db.delete(messageId);

    return { success: true };
  },
});

// ONLINE-STATUS-FIX: Update user's lastActive timestamp
// Called periodically while user is in a conversation to show "Online" status
export const updatePresence = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;
    const now = Date.now();

    if (!authUserId || authUserId.trim().length === 0) {
      return { success: false };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: false };
    }

    await ctx.db.patch(userId, { lastActive: now });
    return { success: true, lastActive: now };
  },
});

// Get conversation by ID
// P0-AUTH-FIX: Require authUserId and resolve server-side only (matches sendMessage pattern)
export const getConversation = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.optional(v.id('users')), // IGNORED: Legacy compat only, never used
    authUserId: v.string(), // P0-AUTH-FIX: Required, resolved server-side
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId } = args;
    const now = Date.now();

    // P0-AUTH-FIX: Always resolve identity server-side from authUserId
    // Never trust client-provided userId - it is ignored even if passed
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return null;
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return null;

    if (!conversation.participants.includes(userId)) {
      return null;
    }

    // Get other participant
    const otherUserId = conversation.participants.find((id) => id !== userId);
    if (!otherUserId) return null;

    const otherUser = await ctx.db.get(otherUserId);
    if (!otherUser) return null;

    // PRIVACY FIX: Check if the other user should be shown anonymously
    // This happens when they're the confession author on an anonymous confession
    const isOtherUserAnonymous = conversation.anonymousParticipantId === otherUserId;

    // Get primary photo (only if not anonymous)
    let photo = null;
    if (!isOtherUserAnonymous) {
      photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', otherUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();
    }

    // Check if this is an expired confession-based conversation
    const isConfessionChat = !!conversation.confessionId;
    const isExpired = isConfessionChat && conversation.expiresAt
      ? conversation.expiresAt <= now
      : false;

    // FIX 8: Get matchSource to determine if this is a confession_comment match
    let matchSource: string | undefined;
    if (conversation.matchId) {
      const match = await ctx.db.get(conversation.matchId);
      matchSource = (match as any)?.matchSource;
    }

    return {
      id: conversation._id,
      matchId: conversation.matchId,
      matchSource, // FIX 8: Include matchSource for mini profile mode
      isPreMatch: conversation.isPreMatch,
      createdAt: conversation.createdAt,
      isConfessionChat,
      expiresAt: conversation.expiresAt,
      isExpired,
      otherUser: {
        id: otherUserId,
        // PRIVACY FIX: Return anonymous display info if user should be anonymous
        name: isOtherUserAnonymous ? 'Anonymous' : otherUser.name,
        photoUrl: isOtherUserAnonymous ? undefined : photo?.url,
        lastActive: isOtherUserAnonymous ? undefined : otherUser.lastActive,
        isVerified: isOtherUserAnonymous ? false : otherUser.isVerified,
        isAnonymous: isOtherUserAnonymous, // Flag for UI to show anonymous avatar
      },
    };
  },
});

// Get all conversations for a user
// APP-P0-004 FIX: Server-side auth - resolve userId from authUserId to prevent cross-user access
export const getConversations = query({
  args: {
    authUserId: v.string(), // APP-P0-004: Changed from userId: v.id('users')
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, limit = 50 } = args;
    const now = Date.now();

    // APP-P0-004 FIX: Resolve auth ID to Convex user ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return []; // Unauthorized - return empty array
    }

    // Get all conversations where user is a participant
    const allConversations = await ctx.db
      .query('conversations')
      .withIndex('by_last_message')
      .order('desc')
      .collect();

    const userConversations = allConversations
      .filter((c) => {
        // Must be a participant
        if (!c.participants.includes(userId)) return false;
        // Filter out expired confession-based conversations
        if (c.confessionId && c.expiresAt && c.expiresAt <= now) return false;
        return true;
      })
      .slice(0, limit);

    if (userConversations.length === 0) return [];

    // PERF #7: Batch-fetch all related data in parallel instead of N+1 queries
    const otherUserIds = userConversations
      .map((c) => c.participants.find((id) => id !== userId))
      .filter((id): id is Id<'users'> => id !== undefined);

    // M2 FIX: Batch-fetch ALL blocks for current user in just 2 queries (not 2*N)
    // Uses same efficient pattern as privateDiscover.ts
    const [blocksOut, blocksIn] = await Promise.all([
      // All users I have blocked
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      // All users who have blocked me
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
    ]);

    // Build set of blocked user IDs (either direction)
    const blockedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    // Parallel batch: users, photos, last messages, and unread counts
    const [users, photos, lastMessages, unreadCounts] = await Promise.all([
      // Batch fetch all other users
      Promise.all(otherUserIds.map((id) => ctx.db.get(id))),
      // Batch fetch primary photos for all other users
      Promise.all(
        otherUserIds.map((id) =>
          ctx.db
            .query('photos')
            .withIndex('by_user', (q) => q.eq('userId', id))
            .filter((q) => q.eq(q.field('isPrimary'), true))
            .first()
        )
      ),
      // Batch fetch last message for each conversation
      Promise.all(
        userConversations.map((c) =>
          ctx.db
            .query('messages')
            .withIndex('by_conversation_created', (q) =>
              q.eq('conversationId', c._id)
            )
            .order('desc')
            .first()
        )
      ),
      // Batch fetch unread messages for each conversation
      Promise.all(
        userConversations.map((c) =>
          ctx.db
            .query('messages')
            .withIndex('by_conversation', (q) =>
              q.eq('conversationId', c._id)
            )
            .filter((q) =>
              q.and(
                q.neq(q.field('senderId'), userId),
                q.eq(q.field('readAt'), undefined)
              )
            )
            .collect()
        )
      ),
    ]);

    // Build maps for O(1) lookup
    const userMap = new Map(otherUserIds.map((id, i) => [id, users[i]]));
    const photoMap = new Map(otherUserIds.map((id, i) => [id, photos[i]]));

    // Build result
    const result = [];
    for (let i = 0; i < userConversations.length; i++) {
      const conversation = userConversations[i];
      const otherUserId = conversation.participants.find((id) => id !== userId);
      if (!otherUserId) continue;

      // SAFETY FIX: Skip conversations with blocked users (either direction)
      if (blockedUserIds.has(otherUserId as string)) continue;

      const otherUser = userMap.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;

      const photo = photoMap.get(otherUserId);
      const lastMessage = lastMessages[i];
      // P0-008 FIX: Filter unread messages by COUNTABLE_MESSAGE_TYPES (same as computeUnreadCountFromMessages)
      // System messages should not count toward the unread badge
      const unreadCount = (unreadCounts[i] || []).filter((m) => COUNTABLE_MESSAGE_TYPES.includes(m.type)).length;

      // PRIVACY FIX: Check if the other user should be shown anonymously
      // This happens when they're the confession author on an anonymous confession
      const isOtherUserAnonymous = conversation.anonymousParticipantId === otherUserId;

      result.push({
        id: conversation._id,
        matchId: conversation.matchId,
        isPreMatch: conversation.isPreMatch,
        lastMessageAt: conversation.lastMessageAt,
        otherUser: {
          id: otherUserId,
          // PRIVACY FIX: Return anonymous display info if user should be anonymous
          name: isOtherUserAnonymous ? 'Anonymous' : otherUser.name,
          photoUrl: isOtherUserAnonymous ? undefined : photo?.url,
          lastActive: isOtherUserAnonymous ? undefined : otherUser.lastActive,
          isVerified: isOtherUserAnonymous ? false : otherUser.isVerified,
          photoBlurred: isOtherUserAnonymous ? false : otherUser.photoBlurred === true,
          isAnonymous: isOtherUserAnonymous, // Flag for UI to show anonymous avatar
        },
        lastMessage: lastMessage
          ? {
              content: lastMessage.mediaId ? 'Protected Photo' : lastMessage.content,
              type: lastMessage.type,
              senderId: lastMessage.senderId,
              createdAt: lastMessage.createdAt,
              isProtected: !!lastMessage.mediaId,
              systemSubtype: lastMessage.systemSubtype,
            }
          : null,
        unreadCount,
      });
    }

    return result;
  },
});

// Get unread message count
// Check if user can send messages
export const canSendMessage = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { canSend: false, remaining: 0, total: 0 };

    // Women can always send
    if (user.gender === 'female') {
      return { canSend: true, remaining: 999999, total: 999999 };
    }

    // Check if reset time has passed
    const now = Date.now();
    if (now >= user.messagesResetAt) {
      let newMessages = 0;
      if (user.subscriptionTier === 'basic') newMessages = 10;
      else if (user.subscriptionTier === 'premium') newMessages = 999999;
      else if (user.trialEndsAt && now < user.trialEndsAt) newMessages = 5;

      return {
        canSend: newMessages > 0,
        remaining: newMessages,
        total: newMessages,
      };
    }

    return {
      canSend: user.messagesRemaining > 0,
      remaining: user.messagesRemaining,
      total: user.subscriptionTier === 'basic' ? 10 : user.subscriptionTier === 'premium' ? 999999 : 5,
    };
  },
});

export const getUnreadCount = query({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getUnreadCount] User not found for authUserId:', args.userId);
      return 0;
    }

    // C1/C2-REPAIR: Hybrid approach - use denormalized counts where available,
    // fall back to source-of-truth computation for conversations without participant rows.
    // P1-FIX: Bounded fallback instead of unbounded .collect() on all conversations.

    // 1. Get all participant rows for this user (fast indexed query)
    const participantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // Build set of conversation IDs that have participant rows (O(1) lookup)
    const coveredConversationIds = new Set<string>(
      participantRows.map((row) => row.conversationId as string)
    );

    // BADGE-FIX: Count CONVERSATIONS with unread messages, not total messages
    // 2. Count conversations that have unreadCount > 0 (not sum of all unread)
    let totalUnreadConversations = participantRows.filter((row) => row.unreadCount > 0).length;

    // 3. Bounded fallback: only check recent conversations (last 30 days) without participant rows
    // This replaces the unbounded .collect() that loaded ALL conversations
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
    const MAX_FALLBACK_CONVERSATIONS = 500;

    const recentConversations = await ctx.db
      .query('conversations')
      .withIndex('by_last_message', (q) => q.gt('lastMessageAt', thirtyDaysAgo))
      .take(MAX_FALLBACK_CONVERSATIONS);

    for (const conversation of recentConversations) {
      // Skip if not a participant
      if (!conversation.participants.includes(userId)) continue;
      // Skip if already covered by participant row
      if (coveredConversationIds.has(conversation._id as string)) continue;

      const count = await computeUnreadCountFromMessages(ctx, conversation._id, userId);
      // BADGE-FIX: Add 1 if conversation has any unread, not the count itself
      if (count > 0) {
        totalUnreadConversations += 1;
      }
    }

    return totalUnreadConversations;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2: Per-Room DM Unread Counts (for Chat Rooms badges)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get unread DM counts grouped by sourceRoomId.
 * Used for:
 * - Chat Rooms list: badge per room card
 * - Chat Rooms tab: count of rooms with unread DMs
 */
export const getUnreadDmCountsByRoom = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, { userId }) => {
    // C3-REPAIR: Hybrid approach - use denormalized counts where available,
    // fall back to source-of-truth computation for conversations without participant rows.
    // P1-FIX: Bounded fallback instead of unbounded .collect() on all conversations.

    // 1. Get all participant rows for this user (fast indexed query)
    const participantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // Build set for O(1) lookup
    const coveredConversationIds = new Set<string>(
      participantRows.map((row) => row.conversationId as string)
    );

    // 2. Batch-fetch referenced conversations by ID (bounded by user's conversation count)
    const conversations = await Promise.all(
      participantRows.map((row) => ctx.db.get(row.conversationId))
    );

    // 3. Build unread counts by room from participant rows
    const byRoomId: Record<string, number> = {};

    for (let i = 0; i < conversations.length; i++) {
      const conversation = conversations[i];
      if (!conversation) continue;
      if (!conversation.sourceRoomId) continue;

      const roomIdStr = conversation.sourceRoomId as string;
      const unreadCount = participantRows[i].unreadCount;

      if (unreadCount > 0) {
        byRoomId[roomIdStr] = (byRoomId[roomIdStr] || 0) + unreadCount;
      }
    }

    // 4. Bounded fallback: check recent conversations without participant rows
    // This replaces the unbounded .collect() that loaded ALL conversations
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
    const MAX_FALLBACK_CONVERSATIONS = 500;

    const recentConversations = await ctx.db
      .query('conversations')
      .withIndex('by_last_message', (q) => q.gt('lastMessageAt', thirtyDaysAgo))
      .take(MAX_FALLBACK_CONVERSATIONS);

    for (const conversation of recentConversations) {
      // Skip if not a participant
      if (!conversation.participants.includes(userId)) continue;
      // Skip if no sourceRoomId (not a room DM)
      if (!conversation.sourceRoomId) continue;
      // Skip if already covered by participant row
      if (coveredConversationIds.has(conversation._id as string)) continue;

      const unreadCount = await computeUnreadCountFromMessages(ctx, conversation._id, userId);
      if (unreadCount > 0) {
        const roomIdStr = conversation.sourceRoomId as string;
        byRoomId[roomIdStr] = (byRoomId[roomIdStr] || 0) + unreadCount;
      }
    }

    const roomsWithUnread = Object.keys(byRoomId).length;

    return {
      byRoomId,
      roomsWithUnread,
    };
  },
});

/**
 * Mark all unread RECEIVED messages in a conversation as read.
 * Called when user opens a DM screen.
 * MSG-004 FIX: Auth hardening - verify caller identity server-side
 */
export const markDmConversationRead = mutation({
  args: {
    conversationId: v.id('conversations'),
    authUserId: v.string(), // MSG-004: Auth verification required
  },
  handler: async (ctx, { conversationId, authUserId }) => {
    const now = Date.now();

    // MSG-004 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { success: false, count: 0 };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: false, count: 0 };
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return { success: false, count: 0 };

    // Verify user is a participant
    if (!conversation.participants.includes(userId)) {
      return { success: false, count: 0 };
    }

    // Get all unread messages RECEIVED by this user (not sent by them)
    const unreadMessages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) =>
        q.eq('conversationId', conversationId)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('readAt'), undefined)
        )
      )
      .collect();

    // Mark each as read
    for (const message of unreadMessages) {
      await ctx.db.patch(message._id, { readAt: now });
    }

    // C1/C2/C3-REPAIR: Update user's unreadCount via recomputation (race-safe)
    // Recompute from source of truth - handles missing rows and concurrent races
    await upsertParticipantUnreadCount(ctx, conversationId, userId);

    return { success: true, count: unreadMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// C1/C2/C3-REPAIR: Backfill conversationParticipants for existing data
// Run with cursor to iterate all conversations:
//   npx convex run messages:backfillConversationParticipants
//   npx convex run messages:backfillConversationParticipants '{"cursor": "<lastId>"}'
// ═══════════════════════════════════════════════════════════════════════════

export const backfillConversationParticipants = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.id('conversations')), // Last processed conversation ID
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    const cursor = args.cursor;

    // Get batch of conversations, starting after cursor if provided
    // Use _creationTime ordering for stable pagination
    let query = ctx.db
      .query('conversations')
      .order('asc'); // Oldest first for stable iteration

    if (cursor) {
      // Get the cursor conversation to find its _creationTime
      const cursorDoc = await ctx.db.get(cursor);
      if (cursorDoc) {
        query = query.filter((q) =>
          q.gt(q.field('_creationTime'), cursorDoc._creationTime)
        );
      }
    }

    const conversations = await query.take(batchSize);

    let created = 0;
    let updated = 0;
    let lastId: Id<'conversations'> | null = null;

    for (const conversation of conversations) {
      lastId = conversation._id;

      // For each participant, upsert their row with recomputed unread count
      for (const participantId of conversation.participants) {
        // Recompute from source of truth (same logic as upsertParticipantUnreadCount)
        const unreadCount = await computeUnreadCountFromMessages(
          ctx,
          conversation._id,
          participantId
        );

        const existing = await ctx.db
          .query('conversationParticipants')
          .withIndex('by_user_conversation', (q) =>
            q.eq('userId', participantId).eq('conversationId', conversation._id)
          )
          .first();

        if (existing) {
          if (existing.unreadCount !== unreadCount) {
            await ctx.db.patch(existing._id, { unreadCount });
            updated++;
          }
        } else {
          await ctx.db.insert('conversationParticipants', {
            conversationId: conversation._id,
            userId: participantId,
            unreadCount,
          });
          created++;
        }
      }
    }

    return {
      processed: conversations.length,
      created,
      updated,
      hasMore: conversations.length === batchSize,
      nextCursor: lastId, // Pass this as cursor to next invocation
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TYPING INDICATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set typing status for a user in a conversation.
 * Called when user starts/stops typing.
 * Uses upsert pattern to avoid creating duplicate rows.
 */
export const setTypingStatus = mutation({
  args: {
    conversationId: v.id('conversations'),
    authUserId: v.string(),
    isTyping: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId, isTyping } = args;
    const now = Date.now();

    // Resolve auth ID to user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) return;

    // Verify user is part of conversation
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return;
    }

    // Upsert typing status
    const existing = await ctx.db
      .query('typingStatus')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { isTyping, updatedAt: now });
    } else {
      await ctx.db.insert('typingStatus', {
        conversationId,
        userId,
        isTyping,
        updatedAt: now,
      });
    }
  },
});

/**
 * Get typing status for the other participant in a conversation.
 * Returns isTyping: true if the other user is actively typing (updated within last 5s).
 */
export const getTypingStatus = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { conversationId, userId } = args;
    const now = Date.now();
    const TYPING_TIMEOUT = 5000; // 5 seconds

    // Get conversation to find the other participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { isTyping: false };
    }

    const otherUserId = conversation.participants.find((id) => id !== userId);
    if (!otherUserId) return { isTyping: false };

    // Get other user's typing status
    const typingStatus = await ctx.db
      .query('typingStatus')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', otherUserId).eq('conversationId', conversationId)
      )
      .first();

    if (!typingStatus) return { isTyping: false };

    // Check if typing status is stale (older than 5 seconds)
    const isStale = now - typingStatus.updatedAt > TYPING_TIMEOUT;
    return {
      isTyping: typingStatus.isTyping && !isStale,
    };
  },
});
