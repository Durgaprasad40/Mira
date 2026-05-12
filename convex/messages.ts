import { v } from 'convex/values';
import { mutation, query, internalMutation, QueryCtx, MutationCtx } from './_generated/server';
import { Id, Doc } from './_generated/dataModel';
import { softMaskText } from './softMask';
import { validateSessionToken } from './helpers';
import {
  CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS,
  isChatRoomPrivateDmConversation,
  isChatRoomPrivateDmExpired,
} from './chatRoomDmRetention';
import { awardWalletCoins } from './wallet';
import {
  formatChatRoomContentPolicyError,
  validateChatRoomMessageContent,
} from './lib/chatRoomContentPolicy';
import { requireChatRoomTermsAccepted, requirePrivateRoomAdult } from './lib/userPolicyGates';
import { getSafePhase1PrimaryPhoto } from './phase1Media';

const PHASE1_TEXT_MESSAGE_MAX_LENGTH = 400;
const SHARED_DM_MESSAGE_MAX_LENGTH = 5000;
const SYSTEM_MESSAGE_PREFIX = '[SYSTEM:';

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

async function hasReportBetween(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  const report1 = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', userId1).eq('reportedUserId', userId2)
    )
    .first();
  if (report1) return true;

  const report2 = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', userId2).eq('reportedUserId', userId1)
    )
    .first();
  return !!report2;
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

function isPreMutualConfessionConversation(
  conversation: Doc<'conversations'>,
  hasActiveMatch: boolean
): boolean {
  if (!conversation.confessionId || hasActiveMatch) return false;
  return (
    conversation.isPreMatch === true ||
    !!conversation.anonymousParticipantId ||
    !!conversation.expiresAt
  );
}

function getTextMessageMaxLength(
  conversation: Doc<'conversations'>,
  type: 'text' | 'image' | 'video' | 'template' | 'dare' | 'voice',
  content: string
): number {
  if (type !== 'text' && type !== 'template') return SHARED_DM_MESSAGE_MAX_LENGTH;
  if (type === 'text' && content.startsWith(SYSTEM_MESSAGE_PREFIX)) {
    return SHARED_DM_MESSAGE_MAX_LENGTH;
  }
  return isChatRoomPrivateDmConversation(conversation)
    ? SHARED_DM_MESSAGE_MAX_LENGTH
    : PHASE1_TEXT_MESSAGE_MAX_LENGTH;
}

async function getPhase1PrimaryPhoto(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<Doc<'photos'> | null> {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user_order', (q) => q.eq('userId', userId))
    .collect();

  return getSafePhase1PrimaryPhoto(photos);
}

// UNREAD-RULE: Message types that count toward unread badges
// Includes: text, image (photo), video, voice, template, dare
// Excludes: system (screenshot events, permission events, T&D connection system messages, etc.)
const COUNTABLE_MESSAGE_TYPES = ['text', 'image', 'video', 'voice', 'template', 'dare'];
const TYPING_STATUS_TIMEOUT_MS = 5_000;
const TYPING_STATUS_CLEANUP_MS = 60_000;
const TYPING_STATUS_CLEANUP_BATCH = 500;
const CONVERSATION_PARTICIPANT_SCAN_LIMIT = 1000;
const MESSAGE_DELIVERY_SCAN_LIMIT = 200;
const MESSAGE_READ_SCAN_LIMIT = 200;
const UNREAD_RECOMPUTE_SCAN_LIMIT = 1000;
const CHAT_ROOM_PRIVATE_DM_CLEANUP_CONVERSATION_BATCH = 25;
const CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH = 100;
const DELIVERY_ACK_LIMIT = 200;

function isRealUserDmMessage(type: string, content: string): boolean {
  if (!COUNTABLE_MESSAGE_TYPES.includes(type)) {
    return false;
  }
  return type !== 'text' && type !== 'template' ? true : content.trim().length > 0;
}

async function maybeAwardChatRoomDmMutualReplyCoins(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
  conversationId: Id<'conversations'>,
  senderId: Id<'users'>,
  peerUserId: Id<'users'> | undefined,
  type: string,
  content: string,
  now: number
): Promise<void> {
  if (!peerUserId || peerUserId === senderId) return;
  if (!isChatRoomPrivateDmConversation(conversation)) return;
  if (conversation.firstMutualReplyAt) return;
  if (!isRealUserDmMessage(type, content)) return;

  const previousPeerMessage = await ctx.db
    .query('messages')
    .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId))
    .filter((q) =>
      q.and(
        q.eq(q.field('senderId'), peerUserId),
        q.lt(q.field('createdAt'), now),
        q.or(
          q.eq(q.field('type'), 'text'),
          q.eq(q.field('type'), 'image'),
          q.eq(q.field('type'), 'video'),
          q.eq(q.field('type'), 'voice'),
          q.eq(q.field('type'), 'template'),
          q.eq(q.field('type'), 'dare')
        )
      )
    )
    .first();

  if (!previousPeerMessage || !isRealUserDmMessage(previousPeerMessage.type, previousPeerMessage.content)) {
    return;
  }

  await awardWalletCoins(ctx, {
    userId: senderId,
    delta: 1,
    reason: 'cr_dm_mutual_reply',
    sourceType: 'chat_room_dm',
    sourceId: conversationId as string,
    peerUserId,
    dedupeKey: `cr_dm_mutual_reply:${conversationId}:${senderId}`,
    createdAt: now,
  });
  await awardWalletCoins(ctx, {
    userId: peerUserId,
    delta: 1,
    reason: 'cr_dm_mutual_reply',
    sourceType: 'chat_room_dm',
    sourceId: conversationId as string,
    peerUserId: senderId,
    dedupeKey: `cr_dm_mutual_reply:${conversationId}:${peerUserId}`,
    createdAt: now,
  });
  await ctx.db.patch(conversationId, { firstMutualReplyAt: now });
}

// C1/C2/C3-REPAIR: Helper to compute unread count from source of truth (messages table)
// Used for: race-safe updates, fallback when participant rows are missing, backfill
async function computeUnreadCountFromMessages(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'conversations'>,
  userId: Id<'users'>
): Promise<number> {
  const unreadMessages = await ctx.db
    .query('messages')
    .withIndex('by_conversation_readAt', (q) =>
      q.eq('conversationId', conversationId).eq('readAt', undefined)
    )
    .filter((q) =>
      q.neq(q.field('senderId'), userId)
    )
    .take(UNREAD_RECOMPUTE_SCAN_LIMIT);

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

async function deleteExpiredChatRoomPrivateDmConversation(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
  now: number
): Promise<{
  deletedConversation: boolean;
  deletedMessages: number;
  deletedMedia: number;
  deletedParticipants: number;
  deletedHiddenRows: number;
}> {
  if (!isChatRoomPrivateDmExpired(conversation, now)) {
    return {
      deletedConversation: false,
      deletedMessages: 0,
      deletedMedia: 0,
      deletedParticipants: 0,
      deletedHiddenRows: 0,
    };
  }

  let deletedMessages = 0;
  let deletedMedia = 0;
  let deletedParticipants = 0;
  let deletedHiddenRows = 0;

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversation._id))
    .take(CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH);

  for (const message of messages) {
    const storageIds = [message.imageStorageId, message.audioStorageId].filter(
      (storageId): storageId is Id<'_storage'> => !!storageId
    );
    for (const storageId of storageIds) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // Best-effort storage cleanup; the DB row is still expired.
      }
    }
    await ctx.db.delete(message._id);
    deletedMessages += 1;
  }

  if (messages.length === CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH) {
    return { deletedConversation: false, deletedMessages, deletedMedia, deletedParticipants, deletedHiddenRows };
  }

  const protectedMedia = await ctx.db
    .query('media')
    .withIndex('by_chat', (q) => q.eq('chatId', conversation._id))
    .take(CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH);

  for (const media of protectedMedia) {
    const permissions = await ctx.db
      .query('mediaPermissions')
      .withIndex('by_media_recipient', (q) => q.eq('mediaId', media._id))
      .collect();
    for (const permission of permissions) {
      await ctx.db.delete(permission._id);
    }

    const securityEvents = await ctx.db
      .query('securityEvents')
      .withIndex('by_media', (q) => q.eq('mediaId', media._id))
      .collect();
    for (const event of securityEvents) {
      await ctx.db.delete(event._id);
    }

    try {
      await ctx.storage.delete(media.objectKey);
    } catch {
      // Best-effort storage cleanup; media row deletion remains authoritative.
    }
    await ctx.db.delete(media._id);
    deletedMedia += 1;
  }

  if (protectedMedia.length === CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH) {
    return { deletedConversation: false, deletedMessages, deletedMedia, deletedParticipants, deletedHiddenRows };
  }

  const remainingSecurityEvents = await ctx.db
    .query('securityEvents')
    .withIndex('by_chat', (q) => q.eq('chatId', conversation._id))
    .take(CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH);
  for (const event of remainingSecurityEvents) {
    await ctx.db.delete(event._id);
  }
  if (remainingSecurityEvents.length === CHAT_ROOM_PRIVATE_DM_CLEANUP_MESSAGE_BATCH) {
    return { deletedConversation: false, deletedMessages, deletedMedia, deletedParticipants, deletedHiddenRows };
  }

  const typingRows = await ctx.db
    .query('typingStatus')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversation._id))
    .collect();
  for (const typing of typingRows) {
    await ctx.db.delete(typing._id);
  }

  for (const participantId of conversation.participants) {
    const hidden = await ctx.db
      .query('chatRoomHiddenDmConversations')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', participantId).eq('conversationId', conversation._id)
      )
      .first();
    if (hidden) {
      await ctx.db.delete(hidden._id);
      deletedHiddenRows += 1;
    }
  }

  const participantRows = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversation._id))
    .collect();
  for (const participant of participantRows) {
    await ctx.db.delete(participant._id);
    deletedParticipants += 1;
  }

  await ctx.db.delete(conversation._id);

  return {
    deletedConversation: true,
    deletedMessages,
    deletedMedia,
    deletedParticipants,
    deletedHiddenRows,
  };
}

/**
 * Whether the other participant in a 1:1 conversation has disabled read receipts for senders.
 * Group threads (>2 participants): no single "recipient" for this flag — leave readAt visible (unchanged).
 */
async function recipientHidesReadReceiptsFromSender(
  ctx: QueryCtx,
  conversation: { participants: Id<'users'>[] },
  viewerId: Id<'users'>
): Promise<boolean> {
  if (conversation.participants.length !== 2) return false;
  const otherId = conversation.participants.find((p) => p !== viewerId);
  if (!otherId) return false;
  const other = await ctx.db.get(otherId);
  return other?.disableReadReceipts === true;
}

/** Query-only: hide read state on the sender's copy when recipient opted out (DB readAt unchanged). */
function applyReadReceiptSenderView<T extends Record<string, unknown>>(
  payload: T,
  msg: { senderId: Id<'users'> },
  viewerId: Id<'users'>,
  hideReadFromSender: boolean
): T {
  if (!hideReadFromSender || msg.senderId !== viewerId) {
    return payload;
  }
  return { ...payload, readAt: undefined, readReceiptVisible: false } as T;
}

// Send a message
// MSG-001 FIX: Auth hardening - verify caller identity server-side
export const sendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    token: v.string(),
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
    const { conversationId, token, type, content, imageStorageId, templateId, audioStorageId, audioDurationMs, clientMessageId } = args;
    const now = Date.now();
    const normalizedContent =
      type === 'text' || type === 'template'
        ? content.trim()
        : content;

    const sessionToken = token.trim();
    if (!sessionToken) {
      throw new Error('Unauthorized: authentication required');
    }
    const senderId = await validateSessionToken(ctx, sessionToken);
    if (!senderId) {
      throw new Error('Unauthorized: user not found');
    }

    // Phase-2: Block DMs if user has active chatRoom readOnly penalty
    if (await hasActiveChatRoomPenalty(ctx, senderId)) {
      throw new Error('You are in read-only mode (24h)');
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
        const duplicateConversation = await ctx.db.get(conversationId);
        if (isChatRoomPrivateDmExpired(duplicateConversation, now)) {
          throw new Error('This chat expired');
        }
        // Already processed this message, return success without decrementing again
        return { success: true, messageId: existing._id, duplicate: true };
      }
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error('Conversation not found');
    const isChatRoomDm = isChatRoomPrivateDmConversation(conversation);
    if (isChatRoomDm) {
      await requireChatRoomTermsAccepted(ctx, senderId);
    }

    // Verify sender is part of conversation
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    // D1: Check if either user has blocked the other
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId && await isBlockedBidirectional(ctx, senderId, recipientId)) {
      throw new Error('Cannot send message');
    }
    if (recipientId && await hasReportBetween(ctx, senderId, recipientId)) {
      throw new Error('Cannot send message');
    }

    // Phase-2 Chat Rooms: if recipient muted sender in the originating room,
    // block the private DM. One-way (recipient is muter, sender is target).
    // Scoped by conversation.sourceRoomId so Phase-1 DMs are unaffected.
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

    // Block sending to expired confession-based conversations
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

    if ((type === 'text' || type === 'template') && normalizedContent.length === 0) {
      throw new Error('Message cannot be empty');
    }

    if (normalizedContent.length > getTextMessageMaxLength(conversation, type, normalizedContent)) {
      throw new Error('Message too long');
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

    if (isChatRoomDm) {
      const contentPolicy = validateChatRoomMessageContent({
        text: normalizedContent,
        context: 'dm',
        recentMessages,
        allowMentions: false,
      });
      if (contentPolicy.ok === false) {
        throw new Error(formatChatRoomContentPolicyError(contentPolicy));
      }
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
    const maskedContent =
      type === 'text'
        ? softMaskText(normalizedContent)
        : normalizedContent;

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

    await maybeAwardChatRoomDmMutualReplyCoins(
      ctx,
      conversation,
      conversationId,
      senderId,
      recipientId,
      type,
      maskedContent,
      now
    );

    // Update conversation last message time
    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
    });

    if (conversation.sourceRoomId && recipientId) {
      const hiddenRow = await ctx.db
        .query('chatRoomHiddenDmConversations')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', recipientId).eq('conversationId', conversationId)
        )
        .first();
      if (hiddenRow) {
        await ctx.db.delete(hiddenRow._id);
      }
    }

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
          readAt: undefined,
        });
      } else {
        await ctx.db.insert('notifications', {
          userId: recipientId,
          type: 'message',
          title: 'New Message',
          body: notificationBody,
          data: { conversationId: conversationId },
          phase: 'phase1',
          dedupeKey,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });
      }
    }

    return { success: true, messageId };
  },
});

export const deleteMessage = mutation({
  args: {
    messageId: v.id('messages'),
    token: v.string(),
  },
  handler: async (ctx, { messageId, token }) => {
    const sessionToken = token.trim();
    if (!sessionToken) {
      throw new Error('Unauthorized: authentication required');
    }

    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const message = await ctx.db.get(messageId);
    if (!message) {
      return { success: true, deleted: false };
    }

    if (message.type !== 'voice') {
      throw new Error('Only voice messages can be deleted');
    }

    if (message.senderId !== userId) {
      throw new Error('Not authorized');
    }

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Conversation not found');
    }

    await ctx.db.delete(messageId);

    if (message.audioStorageId) {
      try {
        await ctx.storage.delete(message.audioStorageId);
      } catch {
        // Best effort only - message deletion should still succeed.
      }
    }

    const latestMessage = await ctx.db
      .query('messages')
      .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversation._id))
      .order('desc')
      .first();

    await ctx.db.patch(conversation._id, {
      lastMessageAt: latestMessage?.createdAt ?? conversation.createdAt,
    });

    await Promise.all(
      conversation.participants.map((participantId) =>
        upsertParticipantUnreadCount(ctx, conversation._id, participantId)
      )
    );

    return { success: true, deleted: true };
  },
});

// Send pre-match message (uses template or limited text)
// MSG-002 FIX: Auth hardening - verify caller identity server-side
export const sendPreMatchMessage = mutation({
  args: {
    token: v.string(),
    toUserId: v.id('users'),
    content: v.string(),
    templateId: v.optional(v.string()),
    // BUGFIX #3: Client-provided idempotency key to prevent double-decrement on retry
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, toUserId, content, templateId, clientMessageId } = args;
    const now = Date.now();
    const normalizedContent = content.trim();

    const sessionToken = token.trim();
    if (!sessionToken) {
      throw new Error('Unauthorized: authentication required');
    }
    const fromUserId = await validateSessionToken(ctx, sessionToken);
    if (!fromUserId) {
      throw new Error('Unauthorized: user not found');
    }

    // Phase-2: Block DMs if user has active chatRoom readOnly penalty
    if (await hasActiveChatRoomPenalty(ctx, fromUserId)) {
      throw new Error('You are in read-only mode (24h)');
    }

    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');
    const toUser = await ctx.db.get(toUserId);
    if (isUnavailableDmUser(toUser)) {
      throw new Error('Recipient unavailable');
    }

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

    if (normalizedContent.length === 0) {
      throw new Error('Message cannot be empty');
    }

    if (normalizedContent.length > PHASE1_TEXT_MESSAGE_MAX_LENGTH) {
      throw new Error('Message too long');
    }

    // Check if already have a conversation
    let conversation: Doc<'conversations'> | null = null;
    const senderParticipantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', fromUserId))
      .take(CONVERSATION_PARTICIPANT_SCAN_LIMIT);

    for (const participantRow of senderParticipantRows) {
      const candidateConversation = await ctx.db.get(participantRow.conversationId);
      if (
        candidateConversation &&
        candidateConversation.isPreMatch &&
        candidateConversation.participants.length === 2 &&
        candidateConversation.participants.includes(fromUserId) &&
        candidateConversation.participants.includes(toUserId)
      ) {
        conversation = candidateConversation;
        break;
      }
    }

    if (!conversation) {
      conversation = await ctx.db
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
    }

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
    const maskedContent = msgType === 'text' ? softMaskText(normalizedContent) : normalizedContent;

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
        readAt: undefined,
      });
    } else {
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'message',
        title: `${fromUser.name} sent you a message`,
        body: notificationBody,
        data: { conversationId: conversation._id, userId: fromUserId },
        phase: 'phase1',
        dedupeKey,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
    }

    return { success: true, messageId, conversationId: conversation._id };
  },
});

// Get messages in a conversation
// SYNC-FIX: Accept authUserId string for consistent identity resolution across devices
export const getMessages = query({
  args: {
    conversationId: v.id('conversations'),
    token: v.string(),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { conversationId, token, limit = 50, before } = args;

    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;

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
    const otherParticipantId = conversation.participants.find((id) => id !== userId);
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      return [];
    }
    if (otherParticipantId && await hasReportBetween(ctx, userId, otherParticipantId)) {
      return [];
    }
    if (isChatRoomPrivateDmExpired(conversation)) {
      return [];
    }

    const hideReadFromSender = await recipientHidesReadReceiptsFromSender(ctx, conversation, userId);

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
        return applyReadReceiptSenderView(
          {
            ...rest,
            isProtected: false,
            audioUrl: audioUrlMap.get(audioStorageId as string) ?? null,
          },
          msg,
          userId,
          hideReadFromSender
        );
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

        return applyReadReceiptSenderView(
          {
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
          },
          msg,
          userId,
          hideReadFromSender
        );
      }
      return applyReadReceiptSenderView({ ...msg, isProtected: false }, msg, userId, hideReadFromSender);
    });
  },
});

// Mark messages as read
// MSG-004 FIX: Auth hardening - verify caller identity server-side
export const markAsRead = mutation({
  args: {
    conversationId: v.id('conversations'),
    token: v.string(), // MSG-004: Auth verification required
  },
  handler: async (ctx, args) => {
    const { conversationId, token } = args;
    const now = Date.now();

    // MSG-004 FIX: Verify caller identity via session-based auth
    const sessionToken = token.trim();
    if (!sessionToken) {
      return; // Silent return for mark-as-read (non-critical)
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return; // Silent return for mark-as-read (non-critical)
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return;

    if (!conversation.participants.includes(userId)) {
      return;
    }
    if (isChatRoomPrivateDmExpired(conversation, now)) {
      return { success: true, count: 0, expired: true as const };
    }

    const otherParticipantId = conversation.participants.find((participantId) => participantId !== userId);
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      return { success: true, count: 0, blocked: true };
    }

    // Get all unread messages not sent by this user
    const unreadMessages = await ctx.db
      .query('messages')
      .withIndex('by_conversation_readAt', (q) =>
        q.eq('conversationId', conversationId).eq('readAt', undefined)
      )
      .filter((q) =>
        q.neq(q.field('senderId'), userId)
      )
      .take(MESSAGE_READ_SCAN_LIMIT);

    for (const message of unreadMessages) {
      await ctx.db.patch(message._id, { readAt: now });
    }

    // C1/C2/C3-REPAIR: Update user's unreadCount via recomputation (race-safe)
    // Recompute from source of truth - handles missing rows and concurrent races
    await upsertParticipantUnreadCount(ctx, conversationId, userId);

    return { success: true, count: unreadMessages.length };
  },
});

/**
 * Paginated DM messages for PrivateChatView (chat room modal).
 * Cursor: JSON.stringify({ before: createdAt }) for strictly older pages.
 */
export const getDmMessages = query({
  args: {
    token: v.string(),
    threadId: v.id('conversations'),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, { token, threadId, paginationOpts }) => {
    try {
      const sessionToken = token.trim();
      const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
      if (!userId) {
        return { page: [], isDone: true, continueCursor: null };
      }

      const conversation = await ctx.db.get(threadId);
      if (!conversation || !conversation.participants.includes(userId)) {
        return { page: [], isDone: true, continueCursor: null };
      }
      if (isChatRoomPrivateDmExpired(conversation)) {
        return { page: [], isDone: true, continueCursor: null, expired: true as const };
      }
      if (conversation.sourceRoomId) {
        const sourceRoom = await ctx.db.get(conversation.sourceRoomId);
        if (!sourceRoom) {
          return { page: [], isDone: true, continueCursor: null };
        }
        if (!sourceRoom.isPublic) {
          await requirePrivateRoomAdult(ctx, userId);
        }
      }

      const hideReadFromSender = await recipientHidesReadReceiptsFromSender(ctx, conversation, userId);

      const numItems = Math.min(Math.max(paginationOpts.numItems, 1), 100);

      let q = ctx.db
        .query('messages')
        .withIndex('by_conversation_created', (q) => q.eq('conversationId', threadId))
        .order('desc');

      if (paginationOpts.cursor) {
        try {
          const parsed = JSON.parse(paginationOpts.cursor) as { before: number };
          q = q.filter((qf) => qf.lt(qf.field('createdAt'), parsed.before));
        } catch {
          return { page: [], isDone: true, continueCursor: null };
        }
      }

      const batch = await q.take(numItems + 1);
      const hasMore = batch.length > numItems;
      const slice = hasMore ? batch.slice(0, numItems) : batch;

      type DmRow = {
        id: string;
        threadId: string;
        senderId: string;
        senderName: string;
        senderAvatar?: string;
        text?: string;
        type: string;
        mediaUrl?: string;
        readAt?: number;
        readReceiptVisible?: boolean;
        createdAt: number;
        isMe: boolean;
      };

      const orderedMessages = slice.slice().reverse();
      const senderIds = Array.from(new Set(orderedMessages.map((message) => message.senderId)));
      const mediaStorageIds = Array.from(new Set(
        orderedMessages.flatMap((message) => {
          if ((message.type === 'image' || message.type === 'video') && message.imageStorageId) {
            return [message.imageStorageId];
          }
          if (message.type === 'voice' && message.audioStorageId) {
            return [message.audioStorageId];
          }
          return [];
        })
      ));

      const [senders, senderProfiles, mediaUrls] = await Promise.all([
        Promise.all(senderIds.map((senderId) => ctx.db.get(senderId))),
        Promise.all(
          senderIds.map((senderId) =>
            ctx.db
              .query('userPrivateProfiles')
              .withIndex('by_user', (q) => q.eq('userId', senderId))
              .first()
          )
        ),
        Promise.all(mediaStorageIds.map((storageId) => ctx.storage.getUrl(storageId))),
      ]);

      const senderMap = new Map(senderIds.map((senderId, index) => [senderId, senders[index]]));
      const senderProfileMap = new Map(
        senderIds.map((senderId, index) => [senderId, senderProfiles[index]])
      );
      const mediaUrlMap = new Map(
        mediaStorageIds.map((storageId, index) => [storageId, mediaUrls[index] ?? undefined])
      );

      const dmPage: DmRow[] = [];

      for (const m of orderedMessages) {
        try {
          const sender = senderMap.get(m.senderId);
          const profile = senderProfileMap.get(m.senderId);
          const senderName = profile?.displayName ?? sender?.name ?? 'User';

          let mediaUrl: string | undefined;
          if ((m.type === 'image' || m.type === 'video') && m.imageStorageId) {
            mediaUrl = mediaUrlMap.get(m.imageStorageId);
          } else if (m.type === 'voice' && m.audioStorageId) {
            mediaUrl = mediaUrlMap.get(m.audioStorageId);
          }

          let uiType = m.type as string;
          if (m.type === 'voice') {
            uiType = 'audio';
          }
          if (m.type === 'template') {
            uiType = 'text';
          }

          const row: DmRow = applyReadReceiptSenderView(
            {
              id: m._id as string,
              threadId: threadId as string,
              senderId: m.senderId as string,
              senderName,
              senderAvatar: profile?.privatePhotoUrls?.[0] ?? sender?.primaryPhotoUrl ?? undefined,
              text:
                m.type === 'text' || m.type === 'template' ? m.content : undefined,
              type: uiType,
              mediaUrl,
              readAt: m.readAt,
              createdAt: m.createdAt,
              isMe: m.senderId === userId,
            },
            m,
            userId,
            hideReadFromSender
          );
          dmPage.push(row);
        } catch {
          continue;
        }
      }

      const oldest = slice.length > 0 ? slice[slice.length - 1] : null;
      const continueCursor =
        hasMore && oldest ? JSON.stringify({ before: oldest.createdAt }) : null;

      return {
        page: dmPage,
        isDone: !hasMore,
        continueCursor,
      };
    } catch {
      return { page: [], isDone: true, continueCursor: null };
    }
  },
});

// MESSAGE-TICKS-FIX: Mark messages as delivered
// Called when recipient's app receives/loads messages
export const markAsDelivered = mutation({
  args: {
    conversationId: v.id('conversations'),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { conversationId, token } = args;
    const now = Date.now();

    // Verify caller identity
    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: false, count: 0 };
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: false, count: 0 };
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false, count: 0 };
    }
    if (isChatRoomPrivateDmExpired(conversation, now)) {
      return { success: true, count: 0, expired: true as const };
    }

    const otherParticipantId = conversation.participants.find((participantId) => participantId !== userId);
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      return { success: true, count: 0, blocked: true };
    }

    // Get all messages from OTHER user that are not yet delivered
    const undeliveredMessages = await ctx.db
      .query('messages')
      .withIndex('by_conversation_deliveredAt', (q) =>
        q.eq('conversationId', conversationId).eq('deliveredAt', undefined)
      )
      .filter((q) =>
        q.neq(q.field('senderId'), userId)
      )
      .take(MESSAGE_DELIVERY_SCAN_LIMIT);

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
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    const now = Date.now();

    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: false, count: 0 };
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: false, count: 0 };
    }

    // Find all messages sent TO this user that are not yet delivered
    // Query all conversations this user is part of
    const participations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(CONVERSATION_PARTICIPANT_SCAN_LIMIT);

    let totalMarked = 0;

    for (const participation of participations) {
      if (totalMarked >= MESSAGE_DELIVERY_SCAN_LIMIT) break;
      const conversation = await ctx.db.get(participation.conversationId);
      if (isChatRoomPrivateDmExpired(conversation, now)) {
        continue;
      }

      const undeliveredMessages = await ctx.db
        .query('messages')
        .withIndex('by_conversation_deliveredAt', (q) =>
          q.eq('conversationId', participation.conversationId).eq('deliveredAt', undefined)
        )
        .filter((q) =>
          q.neq(q.field('senderId'), userId)
        )
        .take(MESSAGE_DELIVERY_SCAN_LIMIT - totalMarked);

      for (const message of undeliveredMessages) {
        await ctx.db.patch(message._id, { deliveredAt: now });
        totalMarked++;
      }
    }

    return { success: true, count: totalMarked };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY_ACK: lightweight, app-wide delivery acknowledgement for Phase-1.
//
// Problem: `markAllAsDelivered` only runs when the Messages tab is mounted;
// if the receiver is on any other Phase-1 screen (Discover, Profile, etc.)
// the sender never sees the second tick until the receiver opens Messages.
//
// Fix: pair a narrow subscription (`listUndeliveredIncomingMessages`) with
// a targeted mutation (`markMessagesDelivered`) and invoke them from a
// hook mounted at the Phase-1 layout root. The query only re-fires when
// actually-undelivered messages change, so idle devices stay quiet.
//
// Safety:
//  - Sender guard on both query + mutation (`senderId !== userId`).
//  - Does NOT touch `media`, `mediaPermissions`, `openedAt`, `readAt`, or any
//    protected-media timer fields. Delivery acknowledgement never starts
//    secure-media countdowns or expires view-once media.
// ─────────────────────────────────────────────────────────────────────────────

export const listUndeliveredIncomingMessages = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    const sessionToken = token.trim();
    if (!sessionToken) {
      return [] as Array<{ _id: Id<'messages'>; conversationId: Id<'conversations'> }>;
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return [] as Array<{ _id: Id<'messages'>; conversationId: Id<'conversations'> }>;
    }

    const participations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(CONVERSATION_PARTICIPANT_SCAN_LIMIT);

    const results: Array<{ _id: Id<'messages'>; conversationId: Id<'conversations'> }> = [];

    for (const participation of participations) {
      if (results.length >= DELIVERY_ACK_LIMIT) break;

      const conversation = await ctx.db.get(participation.conversationId);
      if (isChatRoomPrivateDmExpired(conversation)) {
        continue;
      }

      const undelivered = await ctx.db
        .query('messages')
        .withIndex('by_conversation_deliveredAt', (q) =>
          q.eq('conversationId', participation.conversationId).eq('deliveredAt', undefined)
        )
        .filter((q) =>
          q.neq(q.field('senderId'), userId)
        )
        .take(DELIVERY_ACK_LIMIT - results.length);

      for (const msg of undelivered) {
        if (results.length >= DELIVERY_ACK_LIMIT) break;
        results.push({ _id: msg._id, conversationId: msg.conversationId });
      }
    }

    return results;
  },
});

export const markMessagesDelivered = mutation({
  args: {
    messageIds: v.array(v.id('messages')),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { messageIds, token } = args;
    const now = Date.now();

    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: false, count: 0 };
    }
    if (!messageIds || messageIds.length === 0) {
      return { success: true, count: 0 };
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: false, count: 0 };
    }

    // Cap to DELIVERY_ACK_LIMIT to keep the mutation bounded.
    const ids = messageIds.slice(0, DELIVERY_ACK_LIMIT);
    let marked = 0;

    for (const messageId of ids) {
      const message = await ctx.db.get(messageId);
      if (!message) continue;
      // Sender guard: user must not be the sender.
      if (message.senderId === userId) continue;
      // Participant guard: user must be in the conversation.
      const participation = await ctx.db
        .query('conversationParticipants')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', userId).eq('conversationId', message.conversationId)
        )
        .first();
      if (!participation) continue;
      const conversation = await ctx.db.get(message.conversationId);
      if (isChatRoomPrivateDmExpired(conversation, now)) continue;
      // Idempotent: skip if already delivered.
      if (message.deliveredAt) continue;

      await ctx.db.patch(messageId, { deliveredAt: now });
      marked++;
    }

    return { success: true, count: marked };
  },
});

// ONLINE-STATUS-FIX: Update user's lastActive timestamp
// Called periodically while user is in a conversation to show "Online" status
export const updatePresence = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    const now = Date.now();

    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: false };
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: false };
    }

    await ctx.db.patch(userId, { lastActive: now });
    return { success: true, lastActive: now };
  },
});

// Get conversation by ID
// SYNC-FIX: Accept authUserId string for consistent identity resolution across devices
export const getConversation = query({
  args: {
    conversationId: v.id('conversations'),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { conversationId, token } = args;
    const now = Date.now();

    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;

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
    if (await isBlockedBidirectional(ctx, userId, otherUserId)) {
      return null;
    }
    if (await hasReportBetween(ctx, userId, otherUserId)) {
      return null;
    }

    const otherUser = await ctx.db.get(otherUserId);

    let hasLinkedActiveMatch = false;
    if (conversation.matchId) {
      const match = await ctx.db.get(conversation.matchId);
      if (!hasActiveLinkedMatch(conversation, match)) {
        return null;
      }
      hasLinkedActiveMatch = true;
    }

    let terminalState: 'user_removed' | null = null;
    // user_removed takes precedence (user gone or deactivated)
    if (!otherUser || otherUser.isActive === false) {
      terminalState = 'user_removed';
    }

    const isPreMutualConfessionChat = isPreMutualConfessionConversation(
      conversation,
      hasLinkedActiveMatch
    );

    // PRIVACY FIX: Check if the other user should be shown anonymously.
    // Confession metadata can remain after mutual connect; only pre-mutual
    // confession chats should keep anonymous rendering.
    const isOtherUserAnonymous =
      isPreMutualConfessionChat && conversation.anonymousParticipantId === otherUserId;

    // Get primary photo (only if not anonymous and user still exists)
    let photo = null;
    if (!isOtherUserAnonymous && otherUser && terminalState !== 'user_removed') {
      photo = await getPhase1PrimaryPhoto(ctx, otherUserId);
    }

    // BUG FIX: Resolve photo URL at query time using ctx.storage.getUrl
    // Stored URLs can expire; always fetch fresh URL from storage
    let resolvedPhotoUrl: string | null = null;
    if (photo?.storageId) {
      resolvedPhotoUrl = await ctx.storage.getUrl(photo.storageId);
    }

    // Confession mode is UI state, not merely stored confession metadata.
    const isConfessionChat = isPreMutualConfessionChat;
    const isChatRoomPrivateDm = isChatRoomPrivateDmConversation(conversation);
    const isExpired = (isPreMutualConfessionChat && conversation.expiresAt
      ? conversation.expiresAt <= now
      : false) || isChatRoomPrivateDmExpired(conversation, now);

    return {
      id: conversation._id,
      matchId: conversation.matchId,
      isPreMatch: conversation.isPreMatch,
      createdAt: conversation.createdAt,
      isConfessionChat,
      isPreMutualConfessionChat,
      isChatRoomPrivateDm,
      expiresAt: conversation.expiresAt,
      isExpired,
      terminalState,
      otherUser: {
        id: otherUserId,
        // P1-RESTORE: Show 'User unavailable' for removed users; never blank.
        name: terminalState === 'user_removed'
          ? 'User unavailable'
          : (isOtherUserAnonymous ? 'Anonymous' : (otherUser?.name ?? 'User unavailable')),
        photoUrl: terminalState === 'user_removed'
          ? undefined
          : (isOtherUserAnonymous ? undefined : resolvedPhotoUrl),
        lastActive: terminalState === 'user_removed'
          ? undefined
          : (isOtherUserAnonymous ? undefined : otherUser?.lastActive),
        isVerified: terminalState === 'user_removed'
          ? false
          : (isOtherUserAnonymous ? false : !!otherUser?.isVerified),
        isAnonymous: isOtherUserAnonymous, // Flag for UI to show anonymous avatar
      },
    };
  },
});

// Get all conversations for a user
// APP-P0-004 FIX: Server-side auth - resolve userId from authUserId to prevent cross-user access
export const getConversations = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { token, limit = 50 } = args;
    const now = Date.now();
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);

    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) {
      return []; // Unauthorized - return empty array
    }

    // PERF #7: Batch-fetch all related data in parallel instead of N+1 queries
    // M2 FIX: Batch-fetch ALL blocks for current user in just 2 queries (not 2*N)
    // Uses same efficient pattern as privateDiscover.ts
    const [blocksOut, blocksIn, reportsOut, reportsIn] = await Promise.all([
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
      ctx.db
        .query('reports')
        .withIndex('by_reporter', (q) => q.eq('reporterId', userId))
        .collect(),
      ctx.db
        .query('reports')
        .withIndex('by_reported_user', (q) => q.eq('reportedUserId', userId))
        .collect(),
    ]);

    // Build set of blocked user IDs (either direction)
    const blockedOrReportedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
      ...reportsOut.map((r) => r.reportedUserId as string),
      ...reportsIn.map((r) => r.reporterId as string),
    ]);

    type ConversationCandidate = {
      conversation: Doc<'conversations'>;
      otherUserId: Id<'users'>;
      unreadCount: number;
    };

    const getConversationSortTs = (conversation: Doc<'conversations'>) =>
      conversation.lastMessageAt ?? conversation.createdAt;

    const candidates: ConversationCandidate[] = [];
    const seenConversationIds = new Set<string>();

    const pushCandidate = (candidate: ConversationCandidate) => {
      candidates.push(candidate);
      candidates.sort((a, b) => {
        const byActivity = getConversationSortTs(b.conversation) - getConversationSortTs(a.conversation);
        if (byActivity !== 0) return byActivity;
        return b.conversation._creationTime - a.conversation._creationTime;
      });
      if (candidates.length > normalizedLimit) {
        candidates.length = normalizedLimit;
      }
    };

    // CONVEX PAGINATION FIX: Convex allows only ONE .paginate() per function.
    // This query returns a plain array (not a PaginationResult) so there is no
    // client-facing cursor contract — we just need a bounded scan. Use .take()
    // with a generous upper bound that comfortably exceeds any realistic
    // per-user participant count. Candidates are still capped to
    // `normalizedLimit` via pushCandidate, so memory stays bounded.
    const MAX_PARTICIPANT_ROWS = 1000;

    const participantRows: Doc<'conversationParticipants'>[] = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(MAX_PARTICIPANT_ROWS);

    if (participantRows.length > 0) {
      // TYPING-FIX: Explicitly type the awaited array so consumers below see
      // `Doc<'conversations'> | null` instead of `any`.
      const participantConversations: Array<Doc<'conversations'> | null> = await Promise.all(
        participantRows.map((row) => ctx.db.get(row.conversationId))
      );

      const participantOtherUserIds = Array.from(
        new Set(
          participantConversations
            .map((conversation) =>
              conversation?.participants.find((id: Id<'users'>) => id !== userId) as string | undefined
            )
            .filter((id): id is string => Boolean(id))
        )
      );

      const participantUsers = await Promise.all(
        participantOtherUserIds.map((id) => ctx.db.get(id as Id<'users'>))
      );
      const participantUserMap = new Map(
        participantOtherUserIds.map((id, index) => [id, participantUsers[index]])
      );
      const participantMatchIds = Array.from(
        new Set(
          participantConversations
            .map((conversation) => conversation?.matchId as string | undefined)
            .filter((id): id is string => Boolean(id))
        )
      );
      const participantMatches = await Promise.all(
        participantMatchIds.map((id) => ctx.db.get(id as Id<'matches'>))
      );
      const participantMatchMap = new Map(
        participantMatchIds.map((id, index) => [id, participantMatches[index]])
      );

      for (let index = 0; index < participantRows.length; index++) {
        const row = participantRows[index];
        const conversation = participantConversations[index];
        if (!conversation) continue;

        seenConversationIds.add(conversation._id as string);

        if (!conversation.participants.includes(userId)) continue;
        // PHASE-1/CHAT-ROOMS ISOLATION: Chat Rooms private 1:1 DMs live in the
        // shared `conversations` table but are temporary and room-scoped. They
        // are surfaced by the Chat Rooms DM inbox, not Phase-1 match Messages.
        if (isChatRoomPrivateDmConversation(conversation)) continue;
        if (conversation.confessionId && conversation.expiresAt && conversation.expiresAt <= now) {
          continue;
        }
        if (
          conversation.matchId &&
          !hasActiveLinkedMatch(
            conversation,
            participantMatchMap.get(conversation.matchId as string) ?? null
          )
        ) {
          continue;
        }

        const otherUserId = conversation.participants.find((id: Id<'users'>) => id !== userId);
        if (!otherUserId) continue;
        if (blockedOrReportedUserIds.has(otherUserId as string)) continue;

        pushCandidate({
          conversation,
          otherUserId,
          unreadCount: row.unreadCount,
        });
      }
    }

    // Fallback for legacy conversations that may not have participant rows yet.
    // We scan only a bounded recent window from the recency index and still keep
    // the backend as the source of truth for unread counts on those conversations.
    //
    // CONVEX PAGINATION FIX: Replaced cursor-based paginate() loop with a single
    // bounded .take() since Convex only allows one paginate() per function and
    // this query returns a plain array. The recency index already orders rows
    // by `lastMessageAt` desc, so the first N rows are the most recent window.
    const MAX_FALLBACK_CONVERSATIONS = 500;

    const fallbackConversations: Doc<'conversations'>[] = await ctx.db
      .query('conversations')
      .withIndex('by_last_message')
      .order('desc')
      .take(MAX_FALLBACK_CONVERSATIONS);

    if (fallbackConversations.length > 0) {
      const fallbackOtherUserIds = Array.from(
        new Set(
          fallbackConversations
            .map((conversation) => conversation.participants.find((id) => id !== userId) as string | undefined)
            .filter((id): id is string => Boolean(id))
        )
      );

      const fallbackUsers = await Promise.all(
        fallbackOtherUserIds.map((id) => ctx.db.get(id as Id<'users'>))
      );
      const fallbackUserMap = new Map(
        fallbackOtherUserIds.map((id, index) => [id, fallbackUsers[index]])
      );
      const fallbackMatchIds = Array.from(
        new Set(
          fallbackConversations
            .map((conversation) => conversation.matchId as string | undefined)
            .filter((id): id is string => Boolean(id))
        )
      );
      const fallbackMatches = await Promise.all(
        fallbackMatchIds.map((id) => ctx.db.get(id as Id<'matches'>))
      );
      const fallbackMatchMap = new Map(
        fallbackMatchIds.map((id, index) => [id, fallbackMatches[index]])
      );

      for (const conversation of fallbackConversations) {
        if (seenConversationIds.has(conversation._id as string)) continue;
        seenConversationIds.add(conversation._id as string);

        if (!conversation.participants.includes(userId)) continue;
        // PHASE-1/CHAT-ROOMS ISOLATION (fallback path): same reasoning as above.
        if (isChatRoomPrivateDmConversation(conversation)) continue;
        if (conversation.confessionId && conversation.expiresAt && conversation.expiresAt <= now) {
          continue;
        }
        if (
          conversation.matchId &&
          !hasActiveLinkedMatch(
            conversation,
            fallbackMatchMap.get(conversation.matchId as string) ?? null
          )
        ) {
          continue;
        }

        const otherUserId = conversation.participants.find((id) => id !== userId);
        if (!otherUserId) continue;
        if (blockedOrReportedUserIds.has(otherUserId as string)) continue;

        const unreadCount = await computeUnreadCountFromMessages(ctx, conversation._id, userId);
        pushCandidate({
          conversation,
          otherUserId,
          unreadCount,
        });

        // Early-exit optimization preserved: once candidates are full AND this
        // fallback conversation is older than the oldest candidate, every
        // subsequent row in the `by_last_message desc` scan is also older, so
        // it cannot improve the result set.
        if (candidates.length === normalizedLimit) {
          const oldestCandidate = candidates[candidates.length - 1];
          if (
            oldestCandidate &&
            getConversationSortTs(conversation) <=
              getConversationSortTs(oldestCandidate.conversation)
          ) {
            break;
          }
        }
      }
    }

    if (candidates.length === 0) return [];

    const finalCandidates = candidates
      .slice()
      .sort((a, b) => {
        const byActivity = getConversationSortTs(b.conversation) - getConversationSortTs(a.conversation);
        if (byActivity !== 0) return byActivity;
        return b.conversation._creationTime - a.conversation._creationTime;
      });

    const otherUserIds = finalCandidates.map((candidate) => candidate.otherUserId);

    // Parallel batch: users, photos, last messages, AND matches (for active-match validation).
    const [users, photos, lastMessages, matches] = await Promise.all([
      Promise.all(otherUserIds.map((id) => ctx.db.get(id))),
      Promise.all(
        otherUserIds.map((id) => getPhase1PrimaryPhoto(ctx, id))
      ),
      Promise.all(
        finalCandidates.map((candidate) =>
          ctx.db
            .query('messages')
            .withIndex('by_conversation_created', (q) =>
              q.eq('conversationId', candidate.conversation._id)
            )
            .order('desc')
            .first()
        )
      ),
      // Fetch matches per-row so inactive/orphan match conversations stay out of Recent Chats.
      Promise.all(
        finalCandidates.map((candidate) =>
          candidate.conversation.matchId ? ctx.db.get(candidate.conversation.matchId) : Promise.resolve(null)
        )
      ),
    ]);

    const photoMap = new Map(otherUserIds.map((id, i) => [id as string, photos[i]]));

    // BUG FIX: Resolve photo URLs at query time using ctx.storage.getUrl
    // Stored URLs can expire; always fetch fresh URLs from storage
    const photoUrlMap = new Map<string, string | null>();
    const usersWithPhotos = Array.from(photoMap.entries()).filter(([_, photo]) => photo?.storageId);
    if (usersWithPhotos.length > 0) {
      const resolvedUrls = await Promise.all(
        usersWithPhotos.map(([_, photo]) => ctx.storage.getUrl(photo!.storageId))
      );
      usersWithPhotos.forEach(([id], i) => {
        photoUrlMap.set(id, resolvedUrls[i]);
      });
    }

    // Build result
    const result = [];
    for (let i = 0; i < finalCandidates.length; i++) {
      const { conversation, otherUserId, unreadCount } = finalCandidates[i];
      const otherUser = users[i];
      const match = matches[i];

      if (conversation.matchId && !hasActiveLinkedMatch(conversation, match)) {
        continue;
      }

      let terminalState: 'user_removed' | null = null;
      if (!otherUser || otherUser.isActive === false) {
        terminalState = 'user_removed';
      }

      const resolvedPhotoUrl = photoUrlMap.get(otherUserId as string) ?? null;
      const lastMessage = lastMessages[i];

      const hasLinkedActiveMatch =
        !!conversation.matchId &&
        !!match &&
        hasActiveLinkedMatch(conversation, match);
      const isPreMutualConfessionChat = isPreMutualConfessionConversation(
        conversation,
        hasLinkedActiveMatch
      );

      // PRIVACY FIX: Check if the other user should be shown anonymously.
      // Promoted Confess Connect chats keep confessionId as metadata but render
      // like normal matched chats once they have an active match.
      const isOtherUserAnonymous =
        isPreMutualConfessionChat && conversation.anonymousParticipantId === otherUserId;

      result.push({
        id: conversation._id,
        matchId: conversation.matchId,
        isPreMatch: conversation.isPreMatch,
        isConfessionChat: isPreMutualConfessionChat,
        isPreMutualConfessionChat,
        lastMessageAt: conversation.lastMessageAt,
        terminalState,
        otherUser: {
          id: otherUserId,
          // PRIVACY FIX: Return anonymous display info if user should be anonymous
          // P1-RESTORE: Override with "User unavailable" when terminal=user_removed.
          name:
            terminalState === 'user_removed'
              ? 'User unavailable'
              : isOtherUserAnonymous
                ? 'Anonymous'
                : (otherUser?.name ?? 'User unavailable'),
          photoUrl:
            terminalState === 'user_removed'
              ? undefined
              : isOtherUserAnonymous
                ? undefined
                : resolvedPhotoUrl,
          lastActive:
            terminalState === 'user_removed'
              ? undefined
              : isOtherUserAnonymous
                ? undefined
                : otherUser?.lastActive,
          isVerified:
            terminalState === 'user_removed'
              ? false
              : isOtherUserAnonymous
                ? false
                : otherUser?.isVerified,
          photoBlurred:
            terminalState === 'user_removed'
              ? false
              : isOtherUserAnonymous
                ? false
                : otherUser?.photoBlurred === true,
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
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionToken = args.token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) return { canSend: false, remaining: 0, total: 0 };

    const user = await ctx.db.get(userId);
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
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionToken = args.token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) {
      return 0;
    }

    // C1/C2-REPAIR: Hybrid approach - use denormalized counts where available,
    // fall back to source-of-truth computation for conversations without participant rows.
    // P1-FIX: Bounded fallback instead of unbounded .collect() on all conversations.

    // 1. Get all participant rows for this user (fast indexed query)
    const participantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(CONVERSATION_PARTICIPANT_SCAN_LIMIT);

    // Build set of conversation IDs that have participant rows (O(1) lookup)
    const coveredConversationIds = new Set<string>(
      participantRows.map((row) => row.conversationId as string)
    );

    // PHASE-1/CHAT-ROOMS ISOLATION: The Phase-1 Messages badge must NOT count
    // Chat Rooms private 1:1 DMs (connectionSource === 'room'). Those are
    // surfaced separately by `getUnreadDmCountsByRoom`. Resolve the owning
    // conversation for every participant row that has unread so we can filter
    // out room DMs before counting.
    const rowsWithUnread = participantRows.filter((row) => row.unreadCount > 0);
    const unreadConversationsForRows = await Promise.all(
      rowsWithUnread.map((row) => ctx.db.get(row.conversationId))
    );

    // BADGE-FIX: Count CONVERSATIONS with unread messages, not total messages
    // 2. Count conversations that have unreadCount > 0 (not sum of all unread)
    //    …excluding Chat Rooms DMs.
    let totalUnreadConversations = 0;
    const now = Date.now();
    for (const conversation of unreadConversationsForRows) {
      if (!conversation) continue;
      if (isChatRoomPrivateDmConversation(conversation)) continue;
      totalUnreadConversations += 1;
    }

    // 3. Bounded fallback: only check recent conversations (last 30 days) without participant rows
    // This replaces the unbounded .collect() that loaded ALL conversations
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - THIRTY_DAYS_MS;
    const MAX_FALLBACK_CONVERSATIONS = 500;

    const recentConversations = await ctx.db
      .query('conversations')
      .withIndex('by_last_message', (q) => q.gt('lastMessageAt', thirtyDaysAgo))
      .take(MAX_FALLBACK_CONVERSATIONS);

    for (const conversation of recentConversations) {
      // Skip if not a participant
      if (!conversation.participants.includes(userId)) continue;
      // PHASE-1/CHAT-ROOMS ISOLATION (fallback path): same reasoning as above.
      if (isChatRoomPrivateDmConversation(conversation)) continue;
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
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) {
      return {
        byRoomId: {},
        roomsWithUnread: 0,
      };
    }

    const now = Date.now();
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
      if (isChatRoomPrivateDmExpired(conversation, now)) continue;

      const roomIdStr = conversation.sourceRoomId as string;
      const unreadCount = participantRows[i].unreadCount;

      if (unreadCount > 0) {
        byRoomId[roomIdStr] = (byRoomId[roomIdStr] || 0) + unreadCount;
      }
    }

    // 4. Bounded fallback: check recent conversations without participant rows
    // This replaces the unbounded .collect() that loaded ALL conversations
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - THIRTY_DAYS_MS;
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
      if (isChatRoomPrivateDmExpired(conversation, now)) continue;
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
    token: v.string(), // MSG-004: Auth verification required
  },
  handler: async (ctx, { conversationId, token }) => {
    const now = Date.now();

    // MSG-004 FIX: Verify caller identity via session-based auth
    const sessionToken = token.trim();
    if (!sessionToken) {
      return { success: false, count: 0 };
    }
    const userId = await validateSessionToken(ctx, sessionToken);
    if (!userId) {
      return { success: false, count: 0 };
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return { success: false, count: 0 };

    // Verify user is a participant
    if (!conversation.participants.includes(userId)) {
      return { success: false, count: 0 };
    }
    if (isChatRoomPrivateDmExpired(conversation, now)) {
      return { success: true, count: 0, expired: true as const };
    }

    const otherParticipantId = conversation.participants.find((participantId) => participantId !== userId);
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      return { success: true, count: 0, blocked: true };
    }

    // Get all unread messages RECEIVED by this user (not sent by them)
    const unreadMessages = await ctx.db
      .query('messages')
      .withIndex('by_conversation_readAt', (q) =>
        q.eq('conversationId', conversationId).eq('readAt', undefined)
      )
      .filter((q) =>
        q.neq(q.field('senderId'), userId)
      )
      .take(MESSAGE_READ_SCAN_LIMIT);

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

export const cleanupExpiredChatRoomPrivateDms = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS;
    const seen = new Set<string>();
    let checked = 0;
    let expired = 0;
    let deletedConversations = 0;
    let deletedMessages = 0;
    let deletedMedia = 0;
    let deletedParticipants = 0;
    let deletedHiddenRows = 0;

    const handleConversation = async (conversation: Doc<'conversations'> | null) => {
      if (!conversation) return;
      if (seen.has(conversation._id as string)) return;
      seen.add(conversation._id as string);
      if (!isChatRoomPrivateDmConversation(conversation)) return;
      checked += 1;
      if (!isChatRoomPrivateDmExpired(conversation, now)) return;
      expired += 1;

      const result = await deleteExpiredChatRoomPrivateDmConversation(ctx, conversation, now);
      if (result.deletedConversation) deletedConversations += 1;
      deletedMessages += result.deletedMessages;
      deletedMedia += result.deletedMedia;
      deletedParticipants += result.deletedParticipants;
      deletedHiddenRows += result.deletedHiddenRows;
    };

    const roomSourceConversations = await ctx.db
      .query('conversations')
      .withIndex('by_connection_source', (q) => q.eq('connectionSource', 'room'))
      .take(CHAT_ROOM_PRIVATE_DM_CLEANUP_CONVERSATION_BATCH);

    for (const conversation of roomSourceConversations) {
      await handleConversation(conversation);
    }

    const legacySourceRoomConversations = await ctx.db
      .query('conversations')
      .withIndex('by_last_message', (q) => q.lte('lastMessageAt', cutoff))
      .take(CHAT_ROOM_PRIVATE_DM_CLEANUP_CONVERSATION_BATCH);

    for (const conversation of legacySourceRoomConversations) {
      await handleConversation(conversation);
    }

    return {
      success: true,
      checked,
      expired,
      deletedConversations,
      deletedMessages,
      deletedMedia,
      deletedParticipants,
      deletedHiddenRows,
    };
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
    token: v.string(),
    isTyping: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { conversationId, token, isTyping } = args;
    const now = Date.now();

    // Resolve auth ID to user ID
    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) return;

    // Verify user is part of conversation
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return;
    }
    if (isChatRoomPrivateDmExpired(conversation, now)) {
      return;
    }

    // Upsert typing status
    const existing = await ctx.db
      .query('typingStatus')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (!isTyping) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return;
    }

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
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { conversationId, token } = args;
    const now = Date.now();
    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) {
      return { isTyping: false };
    }

    // Get conversation to find the other participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { isTyping: false };
    }
    if (isChatRoomPrivateDmExpired(conversation, now)) {
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
    const isStale = now - typingStatus.updatedAt > TYPING_STATUS_TIMEOUT_MS;
    return {
      isTyping: typingStatus.isTyping && !isStale,
    };
  },
});

export const cleanupStaleTypingStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TYPING_STATUS_CLEANUP_MS;
    const typingRows = await ctx.db
      .query('typingStatus')
      .withIndex('by_updatedAt', (q) => q.lt('updatedAt', cutoff))
      .take(TYPING_STATUS_CLEANUP_BATCH);

    let deleted = 0;
    for (const row of typingRows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    return {
      success: true,
      deleted,
      hasMore: typingRows.length === TYPING_STATUS_CLEANUP_BATCH,
    };
  },
});
