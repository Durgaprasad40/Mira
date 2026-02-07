import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { softMaskText } from './softMask';

// Send a message
export const sendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('template'), v.literal('dare')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    templateId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { conversationId, senderId, type, content, imageStorageId, templateId } = args;
    const now = Date.now();

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    // Verify sender is part of conversation
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    // Block sending to expired confession-based conversations
    if (conversation.confessionId && conversation.expiresAt && conversation.expiresAt <= now) {
      throw new Error('This chat has expired');
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

    // Check message limits for pre-match conversations (men only)
    if (conversation.isPreMatch && sender.gender === 'male') {
      // Reset weekly messages if needed
      if (now >= sender.messagesResetAt) {
        let newMessages = 0;
        if (sender.subscriptionTier === 'basic') newMessages = 10;
        else if (sender.subscriptionTier === 'premium') newMessages = 999999;
        else if (sender.trialEndsAt && now < sender.trialEndsAt) newMessages = 5;

        await ctx.db.patch(senderId, {
          messagesRemaining: newMessages,
          messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
        });
        sender.messagesRemaining = newMessages;
      }

      if (sender.messagesRemaining <= 0) {
        throw new Error('No messages remaining this week');
      }

      // Check custom message length
      if (type === 'text' && sender.subscriptionTier !== 'premium') {
        const maxLength = sender.subscriptionTier === 'basic' ? 150 : 0;
        if (sender.subscriptionTier === 'free') {
          throw new Error('Upgrade to send custom messages');
        }
        if (content.length > maxLength) {
          throw new Error(`Message too long. Maximum ${maxLength} characters`);
        }
      }

      // Decrement message count
      await ctx.db.patch(senderId, {
        messagesRemaining: sender.messagesRemaining - 1,
      });
    }

    // Soft-mask sensitive words in Face 1 text messages
    const maskedContent = type === 'text' ? softMaskText(content) : content;

    // Create message (store masked text only)
    const messageId = await ctx.db.insert('messages', {
      conversationId,
      senderId,
      type,
      content: maskedContent,
      imageStorageId,
      templateId,
      createdAt: now,
    });

    // Update conversation last message time
    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
    });

    // Create notification for recipient
    // 9-5: Add TTL and dedupe key for message notifications
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId) {
      const dedupeKey = `message:${conversationId}:unread`;
      // Check for existing notification with same dedupe key
      const existingNotif = await ctx.db
        .query('notifications')
        .withIndex('by_user_dedupe', (q) => q.eq('userId', recipientId).eq('dedupeKey', dedupeKey))
        .first();

      if (existingNotif) {
        // Update existing notification instead of creating duplicate
        await ctx.db.patch(existingNotif._id, {
          body: type === 'text' ? maskedContent.substring(0, 50) : 'Sent you a message',
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });
      } else {
        await ctx.db.insert('notifications', {
          userId: recipientId,
          type: 'message',
          title: 'New Message',
          body: type === 'text' ? maskedContent.substring(0, 50) : 'Sent you a message',
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
export const sendPreMatchMessage = mutation({
  args: {
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    content: v.string(),
    templateId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { fromUserId, toUserId, content, templateId } = args;
    const now = Date.now();

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

    // Send the message using the main send function logic
    // Check limits for men
    if (fromUser.gender === 'male') {
      if (now >= fromUser.messagesResetAt) {
        let newMessages = 0;
        if (fromUser.subscriptionTier === 'basic') newMessages = 10;
        else if (fromUser.subscriptionTier === 'premium') newMessages = 999999;
        else if (fromUser.trialEndsAt && now < fromUser.trialEndsAt) newMessages = 5;

        await ctx.db.patch(fromUserId, {
          messagesRemaining: newMessages,
          messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
        });
        fromUser.messagesRemaining = newMessages;
      }

      if (fromUser.messagesRemaining <= 0) {
        throw new Error('No messages remaining this week');
      }

      await ctx.db.patch(fromUserId, {
        messagesRemaining: fromUser.messagesRemaining - 1,
      });
    }

    // Soft-mask sensitive words in Face 1 text messages
    const msgType = templateId ? 'template' : 'text';
    const maskedContent = msgType === 'text' ? softMaskText(content) : content;

    const messageId = await ctx.db.insert('messages', {
      conversationId: conversation._id,
      senderId: fromUserId,
      type: msgType,
      content: maskedContent,
      templateId,
      createdAt: now,
    });

    await ctx.db.patch(conversation._id, {
      lastMessageAt: now,
    });

    // 9-5: Notify recipient with TTL and dedupe
    const dedupeKey = `message:${conversation._id}:unread`;
    const existingNotif = await ctx.db
      .query('notifications')
      .withIndex('by_user_dedupe', (q) => q.eq('userId', toUserId).eq('dedupeKey', dedupeKey))
      .first();

    if (existingNotif) {
      await ctx.db.patch(existingNotif._id, {
        title: `${fromUser.name} sent you a message`,
        body: maskedContent.substring(0, 50),
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
    } else {
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'message',
        title: `${fromUser.name} sent you a message`,
        body: maskedContent.substring(0, 50),
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
export const getMessages = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { conversationId, userId, limit = 50, before } = args;

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return [];

    // Verify user is part of conversation
    if (!conversation.participants.includes(userId)) {
      return [];
    }

    let query = ctx.db
      .query('messages')
      .withIndex('by_conversation_created', (q) =>
        q.eq('conversationId', conversationId)
      );

    if (before) {
      query = query.filter((q) => q.lt(q.field('createdAt'), before));
    }

    const messages = await query.order('desc').take(limit);

    // Strip imageStorageId from protected messages and add isProtected flag
    return messages.reverse().map((msg) => {
      if (msg.mediaId) {
        // Protected media — strip storage keys, flag as protected
        const { imageStorageId, ...rest } = msg;
        return { ...rest, isProtected: true };
      }
      return { ...msg, isProtected: false };
    });
  },
});

// Mark messages as read
export const markAsRead = mutation({
  args: {
    conversationId: v.id('conversations'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { conversationId, userId } = args;
    const now = Date.now();

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

    return { success: true, count: unreadMessages.length };
  },
});

// Get conversation by ID
export const getConversation = query({
  args: {
    conversationId: v.id('conversations'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { conversationId, userId } = args;
    const now = Date.now();

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

    // Get primary photo
    const photo = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', otherUserId))
      .filter((q) => q.eq(q.field('isPrimary'), true))
      .first();

    // Check if this is an expired confession-based conversation
    const isConfessionChat = !!conversation.confessionId;
    const isExpired = isConfessionChat && conversation.expiresAt
      ? conversation.expiresAt <= now
      : false;

    return {
      id: conversation._id,
      matchId: conversation.matchId,
      isPreMatch: conversation.isPreMatch,
      createdAt: conversation.createdAt,
      isConfessionChat,
      expiresAt: conversation.expiresAt,
      isExpired,
      otherUser: {
        id: otherUserId,
        name: otherUser.name,
        photoUrl: photo?.url,
        lastActive: otherUser.lastActive,
        isVerified: otherUser.isVerified,
      },
    };
  },
});

// Get all conversations for a user
export const getConversations = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;
    const now = Date.now();

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

    const result = [];
    for (const conversation of userConversations) {
      const otherUserId = conversation.participants.find((id) => id !== userId);
      if (!otherUserId) continue;

      const otherUser = await ctx.db.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;

      // Get primary photo
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', otherUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // Get last message
      const lastMessage = await ctx.db
        .query('messages')
        .withIndex('by_conversation_created', (q) =>
          q.eq('conversationId', conversation._id)
        )
        .order('desc')
        .first();

      // Count unread
      const unreadMessages = await ctx.db
        .query('messages')
        .withIndex('by_conversation', (q) =>
          q.eq('conversationId', conversation._id)
        )
        .filter((q) =>
          q.and(
            q.neq(q.field('senderId'), userId),
            q.eq(q.field('readAt'), undefined)
          )
        )
        .collect();

      result.push({
        id: conversation._id,
        matchId: conversation.matchId,
        isPreMatch: conversation.isPreMatch,
        lastMessageAt: conversation.lastMessageAt,
        otherUser: {
          id: otherUserId,
          name: otherUser.name,
          photoUrl: photo?.url,
          lastActive: otherUser.lastActive,
          isVerified: otherUser.isVerified,
          photoBlurred: otherUser.photoBlurred === true,
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
        unreadCount: unreadMessages.length,
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
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // Get all conversations
    const allConversations = await ctx.db
      .query('conversations')
      .collect();

    const userConversations = allConversations.filter((c) =>
      c.participants.includes(userId)
    );

    let totalUnread = 0;
    for (const conversation of userConversations) {
      const unreadMessages = await ctx.db
        .query('messages')
        .withIndex('by_conversation', (q) =>
          q.eq('conversationId', conversation._id)
        )
        .filter((q) =>
          q.and(
            q.neq(q.field('senderId'), userId),
            q.eq(q.field('readAt'), undefined)
          )
        )
        .collect();
      totalUnread += unreadMessages.length;
    }

    return totalUnread;
  },
});
