/**
 * Phase-2 Private Conversations Query Layer
 *
 * STRICT ISOLATION: This file handles ALL Phase-2 conversation queries.
 * Phase-2 ONLY reads from: privateConversations, privateConversationParticipants, privateMessages
 * Phase-2 NEVER reads from Phase-1 tables: conversations, conversationParticipants, messages
 *
 * Created to fix P0-003: No query functions exist for Phase-2 conversation data
 */

import { v } from 'convex/values';
import { query, mutation, MutationCtx, QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { validateSessionToken, resolveUserIdByAuthId } from './helpers';

// Message types that count toward unread badges (excludes system messages)
const COUNTABLE_MESSAGE_TYPES = ['text', 'image', 'video', 'voice'];

// Helper: Check if either user has blocked the other (shared across phases)
async function isBlockedBidirectional(
  ctx: QueryCtx | MutationCtx,
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

// Helper: Compute unread count from privateMessages (source of truth)
async function computeUnreadCountFromPrivateMessages(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'privateConversations'>,
  userId: Id<'users'>
): Promise<number> {
  const unreadMessages = await ctx.db
    .query('privateMessages')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
    .filter((q) =>
      q.and(
        q.neq(q.field('senderId'), userId),
        q.eq(q.field('readAt'), undefined)
      )
    )
    .collect();

  return unreadMessages.filter((m) => COUNTABLE_MESSAGE_TYPES.includes(m.type)).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Query A: Get User's Phase-2 Conversations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all Phase-2 conversations for the authenticated user.
 *
 * Returns conversations with:
 * - Other participant's profile info (name initial, photo, age)
 * - Last message preview
 * - Unread count
 * - Connection source (desire_match, desire_super_like, tod, room)
 *
 * Security: Resolves user from authUserId server-side, never trusts client userId
 */
export const getUserPrivateConversations = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;

    // Resolve user from auth - never trust client
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }

    // Get all conversation participations for this user (Phase-2 table)
    const participations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    if (participations.length === 0) {
      return [];
    }

    // Fetch conversation details and other participant info
    const results = await Promise.all(
      participations.map(async (p) => {
        const conversation = await ctx.db.get(p.conversationId);
        if (!conversation) return null;

        // Find the other participant
        const otherParticipantId = conversation.participants.find(
          (pid) => pid !== userId
        );
        if (!otherParticipantId) return null;

        // Check if blocked (skip blocked conversations)
        if (await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
          return null;
        }

        // Get other participant's user record
        const otherUser = await ctx.db.get(otherParticipantId);
        if (!otherUser) return null;

        // Get other participant's Phase-2 private profile for display name
        const otherPrivateProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
          .first();

        // Calculate age from DOB
        let otherAge: number | null = null;
        if (otherUser.dateOfBirth) {
          const birthDate = new Date(otherUser.dateOfBirth);
          const today = new Date();
          otherAge = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            otherAge--;
          }
        }

        // Get last message
        const lastMessage = await ctx.db
          .query('privateMessages')
          .withIndex('by_conversation_created', (q) => q.eq('conversationId', p.conversationId))
          .order('desc')
          .first();

        // Get photo URL - use Phase-2 private profile photos only (strict isolation)
        const photoUrl = otherPrivateProfile?.privatePhotoUrls?.[0] ?? null;

        // Get display name - use Phase-2 initial or fallback
        const displayName = otherPrivateProfile?.displayName
          ? otherPrivateProfile.displayName.charAt(0).toUpperCase()
          : otherUser.name?.charAt(0).toUpperCase() || 'U';

        // Compute unread count from source of truth (privateMessages table)
        const unreadCount = await computeUnreadCountFromPrivateMessages(ctx, conversation._id, userId);

        return {
          id: conversation._id,
          conversationId: conversation._id,
          matchId: conversation.matchId,
          participantId: otherParticipantId,
          participantName: displayName,
          participantAge: otherAge,
          participantPhotoUrl: photoUrl,
          lastMessage: lastMessage?.content || null,
          lastMessageAt: lastMessage?.createdAt || conversation.lastMessageAt || conversation.createdAt,
          lastMessageSenderId: lastMessage?.senderId || null,
          unreadCount,
          connectionSource: conversation.connectionSource || 'desire_match',
          createdAt: conversation.createdAt,
        };
      })
    );

    // Filter nulls and sort by last activity (most recent first)
    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query B: Get Messages for a Phase-2 Conversation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get messages for a Phase-2 conversation.
 *
 * Security: Verifies user is a participant in the conversation
 */
export const getPrivateMessages = query({
  args: {
    conversationId: v.id('privateConversations'),
    authUserId: v.string(),
    limit: v.optional(v.number()),
    before: v.optional(v.number()), // For pagination: get messages before this timestamp
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId, limit = 50, before } = args;

    // Resolve user from auth - never trust client
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return [];
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return [];
    }

    // Build query
    let messagesQuery = ctx.db
      .query('privateMessages')
      .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId));

    if (before) {
      messagesQuery = messagesQuery.filter((q) => q.lt(q.field('createdAt'), before));
    }

    // Fetch latest messages (desc order), then reverse for chronological display
    const messages = await messagesQuery.order('desc').take(limit);

    // Return in chronological order
    return messages.reverse().map((m) => ({
      id: m._id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      type: m.type,
      content: m.content,
      imageStorageId: m.imageStorageId,
      audioStorageId: m.audioStorageId,
      audioDurationMs: m.audioDurationMs,
      deliveredAt: m.deliveredAt,
      readAt: m.readAt,
      createdAt: m.createdAt,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation C: Mark Phase-2 Messages as Read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark all unread messages in a Phase-2 conversation as read.
 *
 * Security: Uses token-based auth, verifies user is participant
 */
export const markPrivateMessagesRead = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, args) => {
    const { token, conversationId } = args;
    const now = Date.now();

    // Validate session and get current user
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      throw new Error('Not authorized');
    }

    // Get all unread messages sent by others
    const unreadMessages = await ctx.db
      .query('privateMessages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('readAt'), undefined)
        )
      )
      .collect();

    // Mark each message as read
    for (const message of unreadMessages) {
      await ctx.db.patch(message._id, { readAt: now });
    }

    // Update participant's unread count to 0
    const participantRecord = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (participantRecord && participantRecord.unreadCount > 0) {
      await ctx.db.patch(participantRecord._id, { unreadCount: 0 });
    }

    return { success: true, markedCount: unreadMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation D: Send a Phase-2 Message
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a message in a Phase-2 conversation.
 *
 * Security: Uses token-based auth, verifies user is participant, rate limits
 */
export const sendPrivateMessage = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('voice')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    clientMessageId: v.optional(v.string()), // Idempotency key
  },
  handler: async (ctx, args) => {
    const { token, conversationId, type, content, imageStorageId, audioStorageId, audioDurationMs, clientMessageId } = args;
    const now = Date.now();

    // Validate session and get current user
    const senderId = await validateSessionToken(ctx, token);
    if (!senderId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Message length limit
    if (content.length > 5000) {
      throw new Error('Message too long');
    }

    // Idempotency check: prevent duplicate messages on retry
    if (clientMessageId) {
      const existing = await ctx.db
        .query('privateMessages')
        .withIndex('by_conversation_clientMessageId', (q) =>
          q.eq('conversationId', conversationId).eq('clientMessageId', clientMessageId)
        )
        .first();
      if (existing) {
        return { success: true, messageId: existing._id, duplicate: true };
      }
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    // Check if blocked
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId && await isBlockedBidirectional(ctx, senderId, recipientId)) {
      throw new Error('Cannot send message');
    }

    // Rate limiting: 10 messages per minute per sender per conversation
    const oneMinuteAgo = now - 60000;
    const recentMessages = await ctx.db
      .query('privateMessages')
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

    // Verify sender exists and is active
    const sender = await ctx.db.get(senderId);
    if (!sender || !sender.isActive) {
      throw new Error('Sender not found or inactive');
    }

    // Insert message into privateMessages table
    const messageId = await ctx.db.insert('privateMessages', {
      conversationId,
      senderId,
      type,
      content,
      imageStorageId,
      audioStorageId,
      audioDurationMs,
      createdAt: now,
      clientMessageId,
    });

    // Update conversation's lastMessageAt
    await ctx.db.patch(conversationId, { lastMessageAt: now });

    // Update recipient's unread count
    if (recipientId) {
      const recipientParticipant = await ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', recipientId).eq('conversationId', conversationId)
        )
        .first();

      if (recipientParticipant) {
        await ctx.db.patch(recipientParticipant._id, {
          unreadCount: recipientParticipant.unreadCount + 1,
        });
      }
    }

    return { success: true, messageId, duplicate: false };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query E: Get Single Conversation Details
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get details of a single Phase-2 conversation.
 *
 * Security: Verifies user is participant
 */
export const getPrivateConversation = query({
  args: {
    conversationId: v.id('privateConversations'),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { conversationId, authUserId } = args;

    // Resolve user from auth
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return null;
    }

    // Get conversation
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return null;
    }

    // SECURITY: Verify user is participant (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return null;
    }

    // Get other participant info
    const otherParticipantId = conversation.participants.find((pid) => pid !== userId);
    if (!otherParticipantId) {
      return null;
    }

    // Check block status
    const isBlocked = await isBlockedBidirectional(ctx, userId, otherParticipantId);

    const otherUser = await ctx.db.get(otherParticipantId);
    const otherPrivateProfile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
      .first();

    // Get participant record for unread count
    const participantRecord = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    // Get photo URL - use Phase-2 private profile photos only (strict isolation)
    const photoUrl = otherPrivateProfile?.privatePhotoUrls?.[0] ?? null;

    const displayName = otherPrivateProfile?.displayName
      ? otherPrivateProfile.displayName.charAt(0).toUpperCase()
      : otherUser?.name?.charAt(0).toUpperCase() || 'U';

    return {
      id: conversation._id,
      matchId: conversation.matchId,
      participantId: otherParticipantId,
      participantName: displayName,
      participantPhotoUrl: photoUrl,
      unreadCount: participantRecord?.unreadCount || 0,
      connectionSource: conversation.connectionSource || 'desire_match',
      createdAt: conversation.createdAt,
      isBlocked,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query F: Get Total Unread Count (for badge)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get total unread message count across all Phase-2 conversations.
 * Used for notification badges.
 */
export const getTotalUnreadCount = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return 0;
    }

    const participations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    return participations.reduce((total, p) => total + p.unreadCount, 0);
  },
});
