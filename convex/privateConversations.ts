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
import { softMaskText } from './softMask';

// P1-001: Generate upload URL for secure media (photos/videos)
// Used by incognito-chat.tsx to upload protected media to Convex storage

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
 * P2-005 FIX: Uses ctx.auth.getUserIdentity() for server-side auth resolution
 */
export const getUserPrivateConversations = query({
  args: {
    // P0-FIX: authUserId used as fallback since ctx.auth is not configured in this app
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId }) => {
    // P0-FIX: Try server-side auth first, fallback to client-supplied authUserId
    let userId: Id<'users'> | null = null;

    // Primary: Try server-side auth identity (future-proofing)
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      userId = await resolveUserIdByAuthId(ctx, identity.subject);
      console.log('[PHASE2 MESSAGES] Resolved from identity.subject:', (userId as string)?.slice(-8) ?? 'NULL');
    }

    // Fallback: Use client-supplied authUserId (current custom auth system)
    if (!userId && authUserId) {
      userId = await resolveUserIdByAuthId(ctx, authUserId);
      console.log('[PHASE2 MESSAGES] Fallback to authUserId:', (userId as string)?.slice(-8) ?? 'NULL');
    }

    if (!userId) {
      console.log('[PHASE2 MESSAGES] Could not resolve user from any source');
      return [];
    }

    // Get all conversation participations for this user (Phase-2 table)
    // Filter out hidden/left conversations
    const allParticipations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // LEAVE CONVERSATION FIX: Exclude conversations user has left/hidden
    const participations = allParticipations.filter((p) => p.isHidden !== true);

    console.log('[PHASE2 MESSAGES] Found participations:', participations.length, '(hidden:', allParticipations.length - participations.length, ')');

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

        // PHASE-2 ISOLATION: Use ONLY Phase-2 private photos
        // NO fallback to Phase-1 photos table or primaryPhotoUrl
        // If no Phase-2 photo exists, return null (UI will show placeholder)
        const photoUrl = otherPrivateProfile?.privatePhotoUrls?.[0] ?? null;

        // PHASE-2 PRIVACY FIX: ALWAYS use handle from users table, never stored displayName
        // Stored displayName may contain old full names from before the fix
        // Phase-2 must NEVER expose first name or last name
        const displayName = otherUser?.handle || 'Anonymous';

        // Compute unread count from source of truth (privateMessages table)
        const unreadCount = await computeUnreadCountFromPrivateMessages(ctx, conversation._id, userId);

        // ═══════════════════════════════════════════════════════════════════════════
        // PHOTO ACCESS CONTROL: Check if other user has blur enabled and access status
        // ═══════════════════════════════════════════════════════════════════════════
        const hasBlurredPhotos = (otherPrivateProfile?.privatePhotosBlurred?.length ?? 0) > 0;
        const hasBlurLevel = (otherPrivateProfile?.privatePhotoBlurLevel ?? 0) > 0;
        const isPhotoBlurred = hasBlurredPhotos || hasBlurLevel;

        // Check photo access request status
        let photoAccessStatus: 'none' | 'pending' | 'approved' | 'declined' = 'none';
        let canViewClearPhoto = !isPhotoBlurred; // If not blurred, can always view clear

        if (isPhotoBlurred) {
          const accessRequest = await ctx.db
            .query('privatePhotoAccessRequests')
            .withIndex('by_owner_viewer', (q) =>
              q.eq('ownerUserId', otherParticipantId).eq('viewerUserId', userId)
            )
            .first();

          if (accessRequest) {
            photoAccessStatus = accessRequest.status;
            canViewClearPhoto = accessRequest.status === 'approved';
          }
        }

        return {
          id: conversation._id,
          conversationId: conversation._id,
          matchId: conversation.matchId,
          participantId: otherParticipantId,
          participantName: displayName,
          participantAge: otherAge,
          participantPhotoUrl: photoUrl,
          // PHASE 2 ISOLATED: Get lastActiveAt from privateUserPresence table (NOT users table)
          participantLastActive: await (async () => {
            const presence = await ctx.db
              .query('privateUserPresence')
              .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
              .first();
            const lastActive = presence?.lastActiveAt ?? 0;
            console.log('[P2_PRESENCE_READ] List:', (otherParticipantId as string).slice(-8), 'lastActive:', lastActive ? new Date(lastActive).toISOString() : 'null');
            return lastActive;
          })(),
          // P1-004 FIX: Include first privateIntentKey for intent label lookup
          // Backend stores array (multi-select), we take the first/primary one for display
          participantIntentKey: otherPrivateProfile?.privateIntentKeys?.[0] ?? null,
          lastMessage: lastMessage?.content || null,
          lastMessageAt: lastMessage?.createdAt || conversation.lastMessageAt || conversation.createdAt,
          lastMessageSenderId: lastMessage?.senderId || null,
          unreadCount,
          connectionSource: conversation.connectionSource || 'desire_match',
          createdAt: conversation.createdAt,
          // PHOTO ACCESS: New fields for privacy feature
          isPhotoBlurred,
          photoAccessStatus,
          canViewClearPhoto,
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
 * P2-005 FIX: Uses ctx.auth.getUserIdentity() for server-side auth resolution
 */
export const getPrivateMessages = query({
  args: {
    conversationId: v.id('privateConversations'),
    // P0-FIX: authUserId used as fallback since ctx.auth is not configured in this app
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
    before: v.optional(v.number()), // For pagination: get messages before this timestamp
  },
  handler: async (ctx, { conversationId, authUserId, limit = 50, before }) => {
    // P0-FIX: Try server-side auth first, fallback to client-supplied authUserId
    let userId: Id<'users'> | null = null;

    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      userId = await resolveUserIdByAuthId(ctx, identity.subject);
    }

    if (!userId && authUserId) {
      userId = await resolveUserIdByAuthId(ctx, authUserId);
    }

    console.log('[PHASE2 MSGS] Auth resolve:', {
      conversationId: (conversationId as string)?.slice(-8),
      resolvedUserId: (userId as string)?.slice(-8) ?? 'NULL',
    });

    if (!userId) {
      return [];
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      console.log('[PHASE2 MSGS] Conversation not found');
      return [];
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      console.log('[PHASE2 MSGS] User not authorized');
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

    // P0-003: Batch-fetch audio URLs for voice messages (Phase-1 parity)
    const audioStorageIds = messages.filter((m) => m.audioStorageId).map((m) => m.audioStorageId!);
    const audioUrls = await Promise.all(
      audioStorageIds.map((id) => ctx.storage.getUrl(id))
    );
    const audioUrlMap = new Map(audioStorageIds.map((id, i) => [id as string, audioUrls[i]]));

    // P1-001: Batch-fetch image URLs for protected media (same pattern as audio)
    const imageStorageIds = messages.filter((m) => m.imageStorageId).map((m) => m.imageStorageId!);
    const imageUrls = await Promise.all(
      imageStorageIds.map((id) => ctx.storage.getUrl(id))
    );
    const imageUrlMap = new Map(imageStorageIds.map((id, i) => [id as string, imageUrls[i]]));

    // Return in chronological order with media URLs resolved
    return messages.reverse().map((m) => {
      // Base message fields
      const baseMessage = {
        id: m._id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        createdAt: m.createdAt,
      };

      // Voice messages: include audio URL
      if (m.type === 'voice' && m.audioStorageId) {
        return {
          ...baseMessage,
          audioUrl: audioUrlMap.get(m.audioStorageId as string) ?? null,
          audioDurationMs: m.audioDurationMs,
        };
      }

      // P1-001: Protected media messages: include image URL and metadata
      if (m.isProtected && m.imageStorageId) {
        return {
          ...baseMessage,
          isProtected: true,
          imageUrl: imageUrlMap.get(m.imageStorageId as string) ?? null,
          protectedMediaTimer: m.protectedMediaTimer,
          protectedMediaViewingMode: m.protectedMediaViewingMode,
          protectedMediaIsMirrored: m.protectedMediaIsMirrored,
          viewedAt: m.viewedAt,
          timerEndsAt: m.timerEndsAt,
          isExpired: m.isExpired,
        };
      }

      // Regular messages
      return baseMessage;
    });
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

    console.log('[P2_MSG_READ] Marked', unreadMessages.length, 'messages as read for user:', (userId as string).slice(-8));

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
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('voice'), v.literal('system')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    // P1-001: Protected media fields for secure photos/videos
    isProtected: v.optional(v.boolean()),
    protectedMediaTimer: v.optional(v.number()),
    protectedMediaViewingMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    protectedMediaIsMirrored: v.optional(v.boolean()),
    clientMessageId: v.optional(v.string()), // Idempotency key
  },
  handler: async (ctx, args) => {
    const {
      token, conversationId, type, content, imageStorageId, audioStorageId, audioDurationMs,
      isProtected, protectedMediaTimer, protectedMediaViewingMode, protectedMediaIsMirrored,
      clientMessageId
    } = args;
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
    // T/D SYSTEM MESSAGES: Skip rate limiting for system messages (game events)
    if (type !== 'system') {
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
    }

    // Verify sender exists and is active
    const sender = await ctx.db.get(senderId);
    if (!sender || !sender.isActive) {
      throw new Error('Sender not found or inactive');
    }

    // P0-002: Soft-mask sensitive words in text messages (Phase-1 parity)
    const maskedContent = type === 'text' ? softMaskText(content) : content;

    // Insert message into privateMessages table
    // P1-001: Include protected media fields for secure photos/videos
    const messageId = await ctx.db.insert('privateMessages', {
      conversationId,
      senderId,
      type,
      content: maskedContent,
      imageStorageId,
      audioStorageId,
      audioDurationMs,
      isProtected,
      protectedMediaTimer,
      protectedMediaViewingMode,
      protectedMediaIsMirrored,
      createdAt: now,
      clientMessageId,
    });

    console.log('[P2_MSG_SEND] Sent:', type, 'from:', (senderId as string).slice(-8), 'msgId:', (messageId as string).slice(-8));

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
 * P2-005 FIX: Uses ctx.auth.getUserIdentity() for server-side auth resolution
 */
export const getPrivateConversation = query({
  args: {
    conversationId: v.id('privateConversations'),
    // P0-FIX: authUserId used as fallback since ctx.auth is not configured in this app
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, authUserId }) => {
    // P0-FIX: Try server-side auth first, fallback to client-supplied authUserId
    let userId: Id<'users'> | null = null;

    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      userId = await resolveUserIdByAuthId(ctx, identity.subject);
    }

    if (!userId && authUserId) {
      userId = await resolveUserIdByAuthId(ctx, authUserId);
    }

    console.log('[PHASE2 CONVO] Auth resolve:', {
      conversationId: (conversationId as string)?.slice(-8),
      resolvedUserId: (userId as string)?.slice(-8) ?? 'NULL',
      source: identity?.subject ? 'identity' : authUserId ? 'authUserId' : 'none',
    });

    if (!userId) {
      console.log('[PHASE2 CONVO] No user resolved - returning null');
      return null;
    }

    // Get conversation
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      console.log('[PHASE2 CONVO] Conversation not found in DB');
      return null;
    }

    // SECURITY: Verify user is participant (IDOR prevention)
    const isParticipant = conversation.participants.includes(userId);
    console.log('[PHASE2 CONVO] Participant check:', {
      isParticipant,
      participants: conversation.participants.map((p) => (p as string)?.slice(-8)),
      userId: (userId as string)?.slice(-8),
    });
    if (!isParticipant) {
      console.log('[PHASE2 CONVO] User not authorized - not a participant');
      return null;
    }

    // LEAVE CONVERSATION FIX: Check if user has hidden this conversation
    const userParticipation = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (userParticipation?.isHidden === true) {
      console.log('[PHASE2 CONVO] User has left/hidden this conversation');
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

    // PHASE-2 PRIVACY FIX: ALWAYS use handle from users table, never stored displayName
    // Stored displayName may contain old full names from before the fix
    // Phase-2 must NEVER expose first name or last name
    const displayName = otherUser?.handle || 'Anonymous';

    // ═══════════════════════════════════════════════════════════════════════════
    // PHOTO ACCESS CONTROL: Check if other user has blur enabled and access status
    // ═══════════════════════════════════════════════════════════════════════════
    const hasBlurredPhotos = (otherPrivateProfile?.privatePhotosBlurred?.length ?? 0) > 0;
    const hasBlurLevel = (otherPrivateProfile?.privatePhotoBlurLevel ?? 0) > 0;
    const isPhotoBlurred = hasBlurredPhotos || hasBlurLevel;

    // Check photo access request status
    let photoAccessStatus: 'none' | 'pending' | 'approved' | 'declined' = 'none';
    let canViewClearPhoto = !isPhotoBlurred; // If not blurred, can always view clear

    if (isPhotoBlurred) {
      const accessRequest = await ctx.db
        .query('privatePhotoAccessRequests')
        .withIndex('by_owner_viewer', (q) =>
          q.eq('ownerUserId', otherParticipantId).eq('viewerUserId', userId)
        )
        .first();

      if (accessRequest) {
        photoAccessStatus = accessRequest.status;
        canViewClearPhoto = accessRequest.status === 'approved';
      }
    }

    // P2_PRESENCE_FIX: Read from privateUserPresence table (NOT users.lastActive)
    // This ensures symmetric presence display between messages list and chat header
    const otherUserPresence = await ctx.db
      .query('privateUserPresence')
      .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
      .first();
    const participantLastActive = otherUserPresence?.lastActiveAt ?? 0;
    console.log('[P2_PRESENCE_READ] Chat:', (otherParticipantId as string).slice(-8), 'lastActive:', participantLastActive ? new Date(participantLastActive).toISOString() : 'null');

    return {
      id: conversation._id,
      matchId: conversation.matchId,
      participantId: otherParticipantId,
      participantName: displayName,
      participantPhotoUrl: photoUrl,
      // P2_PRESENCE_FIX: Read from privateUserPresence table for correct online status
      participantLastActive,
      // P1-004 FIX: Include first privateIntentKey for intent label lookup
      // Backend stores array (multi-select), we take the first/primary one for display
      participantIntentKey: otherPrivateProfile?.privateIntentKeys?.[0] ?? null,
      unreadCount: participantRecord?.unreadCount || 0,
      connectionSource: conversation.connectionSource || 'desire_match',
      createdAt: conversation.createdAt,
      isBlocked,
      // PHOTO ACCESS: New fields for privacy feature
      isPhotoBlurred,
      photoAccessStatus,
      canViewClearPhoto,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query F: Get Total Unread Count (for badge)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get total unread message count across all Phase-2 conversations.
 * Used for notification badges.
 *
 * P2-005 FIX: Uses ctx.auth.getUserIdentity() for server-side auth resolution
 */
export const getTotalUnreadCount = query({
  args: {
    // P0-FIX: authUserId used as fallback since ctx.auth is not configured in this app
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId }) => {
    // P0-FIX: Try server-side auth first, fallback to client-supplied authUserId
    let userId: Id<'users'> | null = null;

    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      userId = await resolveUserIdByAuthId(ctx, identity.subject);
    }

    if (!userId && authUserId) {
      userId = await resolveUserIdByAuthId(ctx, authUserId);
    }

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

// ═══════════════════════════════════════════════════════════════════════════
// Mutation G: Mark Phase-2 Messages as Delivered (per conversation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark all undelivered incoming messages in a Phase-2 conversation as delivered.
 * Called when user opens a conversation.
 *
 * MESSAGE-TICKS-FIX: Follows Phase-1 pattern exactly
 * Security: Uses token-based auth, verifies user is participant
 */
export const markPrivateMessagesDelivered = mutation({
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
      return { success: false, count: 0 };
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return { success: false, count: 0 };
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return { success: false, count: 0 };
    }

    // Get all messages from OTHER user that are not yet delivered
    const undeliveredMessages = await ctx.db
      .query('privateMessages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('deliveredAt'), undefined)
        )
      )
      .collect();

    // Mark each message as delivered
    for (const message of undeliveredMessages) {
      await ctx.db.patch(message._id, { deliveredAt: now });
    }

    console.log('[P2_MSG_DELIVER] Marked', undeliveredMessages.length, 'messages as delivered for user:', (userId as string).slice(-8));

    return { success: true, count: undeliveredMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation H: Mark ALL Phase-2 Messages as Delivered (bulk)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark ALL incoming messages as delivered across all Phase-2 conversations.
 * Called when Messages list loads (before opening any conversation).
 *
 * DELIVERED-TICK-FIX: Ensures "delivered" state is set when message reaches device,
 * not when conversation is opened. Follows Phase-1 pattern exactly.
 *
 * Security: Uses token-based auth
 */
export const markAllPrivateMessagesDelivered = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    const now = Date.now();

    // Validate session and get current user
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, count: 0 };
    }

    // Get all conversations this user is part of
    const participations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    let totalMarked = 0;

    // Mark all undelivered messages in each conversation
    for (const participation of participations) {
      const undeliveredMessages = await ctx.db
        .query('privateMessages')
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

// ═══════════════════════════════════════════════════════════════════════════
// P0-001: Delete Private Message
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete a private message.
 * Matches Phase-1 deleteMessage behavior exactly:
 * - Only the sender can delete their own message
 * - User must be a participant in the conversation
 * - Deletes associated storage (images, audio)
 * - Hard deletes the message record
 */
export const deletePrivateMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, args) => {
    const { token, messageId } = args;

    // Validate session token and get user ID
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid session');
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
        console.warn('[deletePrivateMessage] Failed to delete image storage:', e);
      }
    }
    if (message.audioStorageId) {
      try {
        await ctx.storage.delete(message.audioStorageId);
      } catch (e) {
        console.warn('[deletePrivateMessage] Failed to delete audio storage:', e);
      }
    }

    // Hard delete the message
    await ctx.db.delete(messageId);

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPIRED MEDIA CLEANUP: System cleanup mutation for expired secure media
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cleanup expired private media messages.
 * This is a SYSTEM cleanup operation (not user-initiated deletion).
 *
 * Rules:
 * - Either participant can trigger cleanup (not restricted to sender)
 * - Message must be expired (isExpired === true)
 * - Timer must have ended (timerEndsAt <= now)
 *
 * This is separate from deletePrivateMessage which is for user-initiated deletion.
 */
export const cleanupExpiredPrivateMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, args) => {
    const { token, messageId } = args;

    // Validate session token and get user ID
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid session');
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      // Message already deleted or doesn't exist - success (idempotent)
      return { success: true, alreadyDeleted: true };
    }

    // Verify user is a PARTICIPANT in the conversation (not necessarily sender)
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Unauthorized: conversation not found or access denied');
    }

    // Verify message is eligible for cleanup:
    // 1. Must be protected media
    // 2. Must be expired
    // 3. Timer must have ended
    if (!message.isProtected) {
      throw new Error('Invalid: only protected media can be cleaned up');
    }
    if (!message.isExpired) {
      throw new Error('Invalid: message is not expired');
    }
    if (message.timerEndsAt && message.timerEndsAt > Date.now()) {
      throw new Error('Invalid: timer has not ended yet');
    }

    // Delete any associated storage (images, videos)
    if (message.imageStorageId) {
      try {
        await ctx.storage.delete(message.imageStorageId);
      } catch (e) {
        // Storage may already be deleted, continue
        console.warn('[cleanupExpiredPrivateMessage] Failed to delete storage:', e);
      }
    }

    // Hard delete the message
    await ctx.db.delete(messageId);

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// P1-001: Generate Upload URL for Phase-2 Secure Media
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a presigned upload URL for Phase-2 secure media.
 * Used by incognito-chat.tsx to upload protected photos/videos to Convex storage.
 *
 * Security: Requires valid session token
 */
export const generateSecureMediaUploadUrl = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid session');
    }

    // Generate upload URL
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return uploadUrl;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LEAVE CONVERSATION: Hide conversation for current user only
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Leave (hide) a Phase-2 conversation.
 *
 * This hides the conversation from the current user's view only.
 * The other participant can still see the conversation normally.
 * This is NOT a delete - the conversation and messages remain intact.
 *
 * Behavior:
 * - Sets isHidden=true on the user's participation record
 * - Conversation won't appear in getUserPrivateConversations for this user
 * - Other user's view is unaffected
 * - Idempotent: calling multiple times is safe
 */
export const leavePrivateConversation = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, { token, conversationId }) => {
    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the conversation to verify it exists
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return { success: false, error: 'conversation_not_found' };
    }

    // SECURITY: Verify user is a participant (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return { success: false, error: 'not_participant' };
    }

    // Find the user's participation record
    const participation = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (!participation) {
      // Participation record doesn't exist - shouldn't happen but handle gracefully
      return { success: false, error: 'participation_not_found' };
    }

    // Mark as hidden (idempotent - safe to call multiple times)
    await ctx.db.patch(participation._id, {
      isHidden: true,
    });

    console.log('[leavePrivateConversation] User left conversation:', {
      userId: (userId as string)?.slice(-8),
      conversationId: (conversationId as string)?.slice(-8),
    });

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-1 PARITY: Mark Phase-2 Secure Media as Viewed
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a Phase-2 secure media message as viewed.
 * Sets viewedAt and timerEndsAt on first view.
 *
 * Phase-1 parity: Follows protectedMedia.markViewed pattern exactly
 */
export const markPrivateSecureMediaViewed = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, { token, messageId }) => {
    const now = Date.now();

    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      return { success: false, error: 'message_not_found' };
    }

    // Verify user is a participant in the conversation
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false, error: 'not_authorized' };
    }

    // Skip if already viewed (idempotent)
    if (message.viewedAt) {
      return { success: true, alreadyViewed: true, timerEndsAt: message.timerEndsAt };
    }

    // Skip if not protected media
    if (!message.isProtected) {
      return { success: false, error: 'not_protected' };
    }

    // Calculate timerEndsAt based on protectedMediaTimer
    const timerSeconds = message.protectedMediaTimer ?? 0;
    const timerEndsAt = timerSeconds > 0 ? now + (timerSeconds * 1000) : undefined;

    // Update the message
    await ctx.db.patch(messageId, {
      viewedAt: now,
      timerEndsAt,
    });

    console.log('[markPrivateSecureMediaViewed]', {
      messageId: (messageId as string)?.slice(-8),
      timerSeconds,
      timerEndsAt,
    });

    return { success: true, viewedAt: now, timerEndsAt };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-1 PARITY: Mark Phase-2 Secure Media as Expired
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a Phase-2 secure media message as expired.
 * Called when timer runs out or view-once photo is closed.
 *
 * Phase-1 parity: Follows protectedMedia.markExpired pattern exactly
 */
export const markPrivateSecureMediaExpired = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, { token, messageId }) => {
    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      return { success: false, error: 'message_not_found' };
    }

    // Verify user is a participant in the conversation
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false, error: 'not_authorized' };
    }

    // Skip if already expired (idempotent)
    if (message.isExpired) {
      return { success: true, alreadyExpired: true };
    }

    // Update the message
    await ctx.db.patch(messageId, {
      isExpired: true,
    });

    console.log('[markPrivateSecureMediaExpired]', {
      messageId: (messageId as string)?.slice(-8),
    });

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE: Update user's lastActive timestamp (ISOLATED TABLE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update user's presence (lastActive timestamp).
 * Called on:
 * - App open
 * - Chat open
 * - Message send
 * - Periodic heartbeat (every 15s)
 *
 * CRITICAL: Uses ISOLATED privateUserPresence table, NOT users table.
 * This maintains strict Phase-2 isolation.
 */
export const updatePresence = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      console.log('[P2_PRESENCE_WRITE] Failed: user_not_found for authUserId:', authUserId?.slice(-8));
      return { success: false, error: 'user_not_found' };
    }

    const now = Date.now();

    // Check if presence record exists
    const existing = await ctx.db
      .query('privateUserPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        lastActiveAt: now,
        updatedAt: now,
      });
      console.log('[P2_PRESENCE_WRITE] Updated:', (userId as string).slice(-8), 'at', new Date(now).toISOString());
    } else {
      // Create new presence record
      await ctx.db.insert('privateUserPresence', {
        userId,
        lastActiveAt: now,
        updatedAt: now,
      });
      console.log('[P2_PRESENCE_WRITE] Created:', (userId as string).slice(-8), 'at', new Date(now).toISOString());
    }

    return { success: true };
  },
});

/**
 * Get presence for a user (used by conversations query).
 * Returns lastActiveAt from privateUserPresence table.
 */
export const getPresence = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, { userId }) => {
    const presence = await ctx.db
      .query('privateUserPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    return presence?.lastActiveAt ?? 0;
  },
});
