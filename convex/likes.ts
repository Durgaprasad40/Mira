import { v } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from './_generated/server';
import { Id, Doc } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { softMaskText } from './softMask';

const DAILY_LIKE_LIMIT_FREE = 25;
const DAILY_STANDOUT_LIMIT_FREE = 2; // stand-out == super_like in this codebase

function getUtcDayStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

// D1-REPAIR: Helper to check if either user has blocked the other
// Returns true if blocked (should prevent messaging)
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

async function getPhase1PrimaryPhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>
) {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user_order', (q: any) => q.eq('userId', userId))
    .filter((q: any) => q.neq(q.field('photoType'), 'verification_reference'))
    .collect();

  photos.sort((a: any, b: any) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });

  return photos[0] ?? null;
}

function isPhase1UserAvailable(user: Doc<'users'> | null): user is Doc<'users'> {
  return !!user && user.isActive !== false && user.isBanned !== true && !user.deletedAt;
}

async function getActivePhase1Match(
  ctx: QueryCtx | MutationCtx,
  userAId: Id<'users'>,
  userBId: Id<'users'>
): Promise<Doc<'matches'> | null> {
  const user1Id = userAId < userBId ? userAId : userBId;
  const user2Id = userAId < userBId ? userBId : userAId;

  const direct = await ctx.db
    .query('matches')
    .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
    .filter((q) => q.eq(q.field('isActive'), true))
    .first();
  if (direct) return direct;

  // Legacy safety: older rows may not have been normalized by user id order.
  const [asUser1, asUser2] = await Promise.all([
    ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', userAId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', userAId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect(),
  ]);

  return [...asUser1, ...asUser2].find((match) =>
    (match.user1Id === userAId && match.user2Id === userBId) ||
    (match.user1Id === userBId && match.user2Id === userAId)
  ) ?? null;
}

async function getStandOutPreviewUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
) {
  const user = await ctx.db.get(userId);
  if (!isPhase1UserAvailable(user)) return null;

  const photo = await getPhase1PrimaryPhoto(ctx, userId);
  return {
    userId,
    name: user.name,
    displayName: user.name,
    age: calculateAge(user.dateOfBirth),
    photoUrl: photo?.url,
    gender: user.gender,
    isVerified: user.isVerified,
    verified: user.isVerified,
  };
}

async function isPendingPhase1StandOutVisible(
  ctx: QueryCtx | MutationCtx,
  like: Doc<'likes'>,
  viewerId: Id<'users'>,
  otherUserId: Id<'users'>
): Promise<boolean> {
  if (like.action !== 'super_like') return false;

  const LIKE_EXPIRY_MS = 24 * 60 * 60 * 1000;
  const firstOpenedAt = (like as any).firstOpenedAt as number | undefined;
  if (firstOpenedAt && Date.now() - firstOpenedAt > LIKE_EXPIRY_MS) {
    return false;
  }

  const [viewer, otherUser] = await Promise.all([
    ctx.db.get(viewerId),
    ctx.db.get(otherUserId),
  ]);
  if (!isPhase1UserAvailable(viewer) || !isPhase1UserAvailable(otherUser)) {
    return false;
  }
  if (await isBlockedBidirectional(ctx, viewerId, otherUserId)) {
    return false;
  }
  if (await getActivePhase1Match(ctx, viewerId, otherUserId)) {
    return false;
  }

  const reciprocal = await ctx.db
    .query('likes')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', viewerId).eq('toUserId', otherUserId)
    )
    .first();

  return !reciprocal;
}

async function isPendingPhase1OutgoingStandOutVisible(
  ctx: QueryCtx | MutationCtx,
  like: Doc<'likes'>,
  viewerId: Id<'users'>
): Promise<boolean> {
  if (like.action !== 'super_like' || like.fromUserId !== viewerId) return false;

  const LIKE_EXPIRY_MS = 24 * 60 * 60 * 1000;
  const firstOpenedAt = (like as any).firstOpenedAt as number | undefined;
  if (firstOpenedAt && Date.now() - firstOpenedAt > LIKE_EXPIRY_MS) {
    return false;
  }

  const [viewer, receiver] = await Promise.all([
    ctx.db.get(viewerId),
    ctx.db.get(like.toUserId),
  ]);
  if (!isPhase1UserAvailable(viewer) || !isPhase1UserAvailable(receiver)) {
    return false;
  }
  if (await isBlockedBidirectional(ctx, viewerId, like.toUserId)) {
    return false;
  }
  if (await getActivePhase1Match(ctx, viewerId, like.toUserId)) {
    return false;
  }

  const receiverResponse = await ctx.db
    .query('likes')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', like.toUserId).eq('toUserId', viewerId)
    )
    .first();

  return !receiverResponse;
}

async function upsertPhase1ParticipantUnreadCount(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
  userId: Id<'users'>
): Promise<void> {
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
  const unreadCount = unreadMessages.filter((m) =>
    ['text', 'image', 'video', 'voice', 'template', 'dare'].includes(m.type)
  ).length;

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
    return;
  }

  await ctx.db.insert('conversationParticipants', {
    conversationId,
    userId,
    unreadCount,
  });
}

async function ensurePhase1StandOutMatchAndConversation(
  ctx: MutationCtx,
  args: {
    senderId: Id<'users'>;
    receiverId: Id<'users'>;
    now: number;
  }
): Promise<{ matchId: Id<'matches'>; conversationId: Id<'conversations'>; createdMatch: boolean }> {
  const user1Id = args.senderId < args.receiverId ? args.senderId : args.receiverId;
  const user2Id = args.senderId < args.receiverId ? args.receiverId : args.senderId;

  let match = await getActivePhase1Match(ctx, args.senderId, args.receiverId);
  let createdMatch = false;

  if (!match) {
    const matchId = await ctx.db.insert('matches', {
      user1Id,
      user2Id,
      matchedAt: args.now,
      isActive: true,
      matchSource: 'super_like',
    });
    match = await ctx.db.get(matchId);
    createdMatch = true;
  } else if ((match as any).matchSource !== 'super_like') {
    await ctx.db.patch(match._id, { matchSource: 'super_like' });
    match = { ...match, matchSource: 'super_like' } as Doc<'matches'>;
  }

  if (!match) {
    throw new Error('Failed to create match');
  }

  let conversation = await ctx.db
    .query('conversations')
    .withIndex('by_match', (q) => q.eq('matchId', match._id))
    .first();

  if (!conversation) {
    const existingTodConversationId = await findExistingTodConversation(
      ctx,
      args.senderId,
      args.receiverId
    );

    if (existingTodConversationId) {
      await ctx.db.patch(existingTodConversationId, {
        matchId: match._id,
        isPreMatch: false,
      });
      conversation = await ctx.db.get(existingTodConversationId);
    } else {
      const conversationId = await ctx.db.insert('conversations', {
        matchId: match._id,
        participants: [args.senderId, args.receiverId],
        isPreMatch: false,
        createdAt: args.now,
      });
      conversation = await ctx.db.get(conversationId);
    }
  }

  if (!conversation) {
    throw new Error('Failed to create conversation');
  }

  await upsertPhase1ParticipantUnreadCount(ctx, conversation._id, args.senderId);
  await upsertPhase1ParticipantUnreadCount(ctx, conversation._id, args.receiverId);

  return {
    matchId: match._id,
    conversationId: conversation._id,
    createdMatch,
  };
}

async function seedPhase1StandOutMessageIfNeeded(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    senderId: Id<'users'>;
    recipientId: Id<'users'>;
    content: string | undefined;
    createdAt: number;
    clientMessageId: string;
  }
): Promise<{ messageId: Id<'messages'> | null; inserted: boolean }> {
  const normalizedContent = args.content?.trim();
  if (!normalizedContent) {
    return { messageId: null, inserted: false };
  }
  if (normalizedContent.length > 5000) {
    throw new Error('Message too long');
  }

  const existing = await ctx.db
    .query('messages')
    .withIndex('by_conversation_clientMessageId', (q) =>
      q.eq('conversationId', args.conversationId).eq('clientMessageId', args.clientMessageId)
    )
    .first();
  if (existing) {
    return { messageId: existing._id, inserted: false };
  }

  const messageId = await ctx.db.insert('messages', {
    conversationId: args.conversationId,
    senderId: args.senderId,
    type: 'text',
    content: softMaskText(normalizedContent),
    clientMessageId: args.clientMessageId,
    createdAt: args.createdAt,
  });

  await ctx.db.patch(args.conversationId, { lastMessageAt: args.createdAt });
  await upsertPhase1ParticipantUnreadCount(ctx, args.conversationId, args.recipientId);
  await upsertPhase1ParticipantUnreadCount(ctx, args.conversationId, args.senderId);

  return { messageId, inserted: true };
}

async function createPhase1StandOutMatchNotifications(
  ctx: MutationCtx,
  args: {
    senderId: Id<'users'>;
    receiverId: Id<'users'>;
    matchId: Id<'matches'>;
    now: number;
  }
) {
  const [sender, receiver] = await Promise.all([
    ctx.db.get(args.senderId),
    ctx.db.get(args.receiverId),
  ]);

  const rows = [
    {
      userId: args.receiverId,
      title: 'New Match!',
      body: `You matched with ${sender?.name || 'someone'}!`,
    },
    {
      userId: args.senderId,
      title: 'New Match!',
      body: `You matched with ${receiver?.name || 'someone'}!`,
    },
  ];

  for (const row of rows) {
    const dedupeKey = `match:${args.matchId}`;
    const existing = await ctx.db
      .query('notifications')
      .withIndex('by_user_dedupe', (q) =>
        q.eq('userId', row.userId).eq('dedupeKey', dedupeKey)
      )
      .first();
    if (existing) continue;

    await ctx.db.insert('notifications', {
      userId: row.userId,
      type: 'match',
      title: row.title,
      body: row.body,
      data: { matchId: args.matchId },
      phase: 'phase1',
      dedupeKey,
      createdAt: args.now,
      expiresAt: args.now + 24 * 60 * 60 * 1000,
    });
  }
}

async function acceptPendingPhase1StandOut(
  ctx: MutationCtx,
  args: {
    receiverId: Id<'users'>;
    likeId: Id<'likes'>;
    replyText?: string;
  }
) {
  const now = Date.now();
  const like = await ctx.db.get(args.likeId);
  if (!like || like.toUserId !== args.receiverId || like.action !== 'super_like') {
    throw new Error('Stand Out request not found');
  }
  const normalizedReply = args.replyText == null ? null : args.replyText.trim();
  if (normalizedReply != null && normalizedReply.length === 0) {
    throw new Error('Reply required');
  }
  if (normalizedReply && normalizedReply.length > 5000) {
    throw new Error('Message too long');
  }

  const existingReciprocal = await ctx.db
    .query('likes')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', args.receiverId).eq('toUserId', like.fromUserId)
    )
    .first();

  if (existingReciprocal?.action === 'pass') {
    throw new Error('Stand Out request is already handled');
  }

  const existingMatch = await getActivePhase1Match(ctx, args.receiverId, like.fromUserId);
  const isRetryAfterAccept = !!existingReciprocal && !!existingMatch;
  if (!isRetryAfterAccept) {
    const isVisible = await isPendingPhase1StandOutVisible(ctx, like, args.receiverId, like.fromUserId);
    if (!isVisible) {
      throw new Error('Stand Out request is already handled');
    }
  }

  const acceptanceLikeId = existingReciprocal?._id ?? await ctx.db.insert('likes', {
    fromUserId: args.receiverId,
    toUserId: like.fromUserId,
    action: 'like',
    createdAt: now,
  });

  const ensured = await ensurePhase1StandOutMatchAndConversation(ctx, {
    senderId: like.fromUserId,
    receiverId: args.receiverId,
    now,
  });

  const originalMessage = await seedPhase1StandOutMessageIfNeeded(ctx, {
    conversationId: ensured.conversationId,
    senderId: like.fromUserId,
    recipientId: args.receiverId,
    content: like.message,
    createdAt: now,
    clientMessageId: `standout-p1:${like._id}:original`,
  });

  let replyMessageId: Id<'messages'> | null = null;
  if (normalizedReply) {
    const reply = await seedPhase1StandOutMessageIfNeeded(ctx, {
      conversationId: ensured.conversationId,
      senderId: args.receiverId,
      recipientId: like.fromUserId,
      content: normalizedReply,
      createdAt: now + 1,
      clientMessageId: `standout-p1:${like._id}:reply`,
    });
    replyMessageId = reply.messageId;
  }

  await createPhase1StandOutMatchNotifications(ctx, {
    senderId: like.fromUserId,
    receiverId: args.receiverId,
    matchId: ensured.matchId,
    now,
  });

  return {
    success: true,
    conversationId: ensured.conversationId,
    matchId: ensured.matchId,
    acceptanceLikeId,
    seededOriginalMessage: originalMessage.inserted,
    originalMessageId: originalMessage.messageId,
    replyMessageId,
    createdMatch: ensured.createdMatch,
  };
}

// SMART MATCHING: Check for T&D connected status between two users
// Returns true if there's a 'connected' todConnectRequest between them
// Handles mixed storage patterns in todConnectRequests (authUserId vs Id<'users'>)
async function hasTodConnection(
  ctx: MutationCtx,
  user1DbId: Id<'users'>,
  user1AuthId: string,
  user2DbId: Id<'users'>,
  user2AuthId: string
): Promise<boolean> {
  // Pattern A: likeAnswer stores (authUserId, Id<'users'>)
  // Pattern B: sendTodConnectRequest stores (Id<'users'>, authUserId)
  // Check both patterns in both directions (4 queries total)

  // Direction 1: user1 -> user2
  let conn = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', user1AuthId).eq('toUserId', user2DbId)
    )
    .filter((q) => q.eq(q.field('status'), 'connected'))
    .first();
  if (conn) return true;

  conn = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', user1DbId).eq('toUserId', user2AuthId)
    )
    .filter((q) => q.eq(q.field('status'), 'connected'))
    .first();
  if (conn) return true;

  // Direction 2: user2 -> user1
  conn = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', user2AuthId).eq('toUserId', user1DbId)
    )
    .filter((q) => q.eq(q.field('status'), 'connected'))
    .first();
  if (conn) return true;

  conn = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', user2DbId).eq('toUserId', user1AuthId)
    )
    .filter((q) => q.eq(q.field('status'), 'connected'))
    .first();
  return !!conn;
}

// SMART MATCHING: Find existing T&D conversation between two users
// Returns conversationId ONLY if connectionSource === 'tod'
// Ignores confession conversations and all other conversation types
async function findExistingTodConversation(
  ctx: MutationCtx,
  user1Id: Id<'users'>,
  user2Id: Id<'users'>
): Promise<Id<'conversations'> | null> {
  const user1Participations = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_user', (q) => q.eq('userId', user1Id))
    .collect();

  for (const p of user1Participations) {
    const user2InConvo = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', user2Id).eq('conversationId', p.conversationId)
      )
      .first();

    if (user2InConvo) {
      // Found shared conversation - verify it's a T&D conversation
      const conversation = await ctx.db.get(p.conversationId);
      if (conversation && conversation.connectionSource === 'tod') {
        return p.conversationId;
      }
      // Not a T&D conversation - continue searching (don't return non-T&D)
    }
  }
  return null;
}

// Like, pass, or super like a user
export const swipe = mutation({
  args: {
    token: v.string(), // P1-028 FIX: Session token for server-side auth
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like'), v.literal('text')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, toUserId, action, message } = args;
    const now = Date.now();

    // P1-028 FIX: Validate session and derive user from trusted server context
    const fromUserId = await validateSessionToken(ctx, token);
    if (!fromUserId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // P2-003 FIX: Prevent self-swiping
    if (fromUserId === toUserId) {
      throw new Error('Cannot swipe on yourself');
    }

    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');

    // 8B: Check email verification before allowing swipe (except pass)
    if (action !== 'pass' && fromUser.emailVerified !== true) {
      throw new Error('Please verify your email address before swiping.');
    }

    // 8A: Check verification status before allowing swipe
    // Unverified/rejected users cannot swipe (except pass)
    const fromStatus = fromUser.verificationStatus || 'unverified';
    if (action !== 'pass' && fromStatus !== 'verified') {
      const statusMessages: Record<string, string> = {
        unverified: 'Please upload a profile photo to get verified before swiping.',
        pending_auto: 'Your profile is being verified. Please wait.',
        pending_manual: 'Your profile is under review. Please wait.',
        pending_verification: 'Your profile is being verified. Please wait.',
        rejected: 'Your photo was rejected. Please upload a new one.',
      };
      throw new Error(statusMessages[fromStatus] || 'Verification required to swipe.');
    }

    // 8A: Check target user is also verified (shouldn't appear in deck but double-check)
    const toUser = await ctx.db.get(toUserId);
    if (toUser) {
      const toStatus = toUser.verificationStatus || 'unverified';
      if (toStatus !== 'verified') {
        throw new Error('This user is no longer available.');
      }
    }

    // TODO: Subscription restrictions disabled for testing mode.
    // Re-enable usage limits once testing is complete.
    // if (fromUser.gender === 'male') { ... }

    // Check if already swiped
    const existingLike = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', fromUserId).eq('toUserId', toUserId)
      )
      .first();

    if (existingLike) {
      throw new Error('Already swiped on this user');
    }

    // P1 SECURITY: Block check for like/super_like actions (not just text)
    // Prevents blocked users from liking each other and creating matches
    if (action === 'like' || action === 'super_like') {
      if (await isBlockedBidirectional(ctx, fromUserId, toUserId)) {
        throw new Error('Cannot like this user');
      }
    }

    // P0-1: Server-side daily like / stand-out enforcement (backend is source of truth)
    // Policy alignment: premium and female accounts are treated as unlimited; basic remains subject to limits.
    // Enforcement is placed AFTER duplicate + block checks so those errors take precedence.
    const isUnlimitedByPolicy =
      fromUser.gender === 'female' ||
      fromUser.subscriptionTier === 'premium';

    if (!isUnlimitedByPolicy && (action === 'like' || action === 'super_like')) {
      const dayStart = getUtcDayStartMs(now);
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;

      const todaysSwipes = await ctx.db
        .query('likes')
        .withIndex('by_from_user_createdAt', (q) =>
          q.eq('fromUserId', fromUserId).gte('createdAt', dayStart).lt('createdAt', dayEnd)
        )
        .collect();

      if (action === 'like') {
        const likesToday = todaysSwipes.filter((s) => s.action === 'like').length;
        if (likesToday >= DAILY_LIKE_LIMIT_FREE) {
          throw new Error('Daily like limit reached');
        }
      } else {
        const standoutsToday = todaysSwipes.filter((s) => s.action === 'super_like').length;
        if (standoutsToday >= DAILY_STANDOUT_LIMIT_FREE) {
          throw new Error('Daily stand-out limit reached');
        }
      }
    }

    // Record the like
    await ctx.db.insert('likes', {
      fromUserId,
      toUserId,
      action,
      message,
      createdAt: now,
    });

    // Inline rapid-swiping check
    const fiveMinAgo = now - 5 * 60 * 1000;
    const recentSwipes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', fromUserId))
      .collect();
    const recentCount = recentSwipes.filter(s => s.createdAt > fiveMinAgo).length;
    if (recentCount > 100) {
      const existingFlag = await ctx.db
        .query('behaviorFlags')
        .withIndex('by_user_type', (q) =>
          q.eq('userId', fromUserId).eq('flagType', 'rapid_swiping')
        )
        .collect();
      const recentFlag = existingFlag.find(f => now - f.createdAt < 60 * 60 * 1000);
      if (!recentFlag) {
        await ctx.db.insert('behaviorFlags', {
          userId: fromUserId,
          flagType: 'rapid_swiping',
          severity: 'medium',
          description: `${recentCount} swipes in 5 minutes`,
          createdAt: now,
        });
      }
    }

    // TODO: Usage count updates disabled for testing mode.
    // Re-enable once testing is complete.

    // Handle text action: send a direct message via message token (pre-match conversation)
    if (action === 'text') {
      if (!message) {
        throw new Error('Message is required for text action');
      }

      // D1-REPAIR: Check if either user has blocked the other
      if (await isBlockedBidirectional(ctx, fromUserId, toUserId)) {
        throw new Error('Cannot send message');
      }

      // Create a pre-match conversation for the direct message
      const conversationId = await ctx.db.insert('conversations', {
        participants: [fromUserId, toUserId],
        isPreMatch: true,
        lastMessageAt: now,
        createdAt: now,
      });

      // Insert the direct message
      await ctx.db.insert('messages', {
        conversationId,
        senderId: fromUserId,
        type: 'text',
        content: message,
        createdAt: now,
      });

      // Notify the receiver
      // D3: Add dedupeKey and expiresAt for consistency with messages.ts notifications
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'message',
        title: 'New Direct Message!',
        body: `${fromUser.name} sent you a message`,
        data: { conversationId: conversationId, userId: fromUserId },
        phase: 'phase1',
        dedupeKey: `message:${conversationId}:unread`,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });

      return { success: true, isMatch: false };
    }

    // Check for match (only on like or super_like)
    if (action === 'like' || action === 'super_like') {
      const reciprocalLike = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', toUserId).eq('toUserId', fromUserId)
        )
        .first();

      const hasReciprocalLike = reciprocalLike && (
        reciprocalLike.action === 'like' ||
        reciprocalLike.action === 'super_like' ||
        reciprocalLike.action === 'text'
      );

      // SMART MATCHING: Check for T&D connected status
      // Only check if both users have authUserId (required for mixed-type query)
      // Skip T&D matching if target has passed current user
      // (Current user's pass toward target is impossible here - blocked by existingLike check)
      let hasTodConn = false;
      if (fromUser.authUserId && toUser?.authUserId) {
        const targetHasPassed = reciprocalLike?.action === 'pass';

        if (!targetHasPassed) {
          hasTodConn = await hasTodConnection(
            ctx,
            fromUserId,
            fromUser.authUserId,
            toUserId,
            toUser.authUserId
          );
        }
      }

      const isMatchEligible = hasReciprocalLike || hasTodConn;

      if (isMatchEligible) {
        // 9-2: Check if match already exists to prevent duplicates from race conditions
        const user1Id = fromUserId < toUserId ? fromUserId : toUserId;
        const user2Id = fromUserId < toUserId ? toUserId : fromUserId;

        const existingMatch = await ctx.db
          .query('matches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .first();

        if (existingMatch) {
          // Match already exists, return success without creating duplicate
          return { success: true, isMatch: true, matchId: existingMatch._id };
        }

        // It's a match!
        // Determine matchSource: super_like if either user sent super_like
        const reciprocalAction = reciprocalLike?.action;
        const isSuperLikeMatch = action === 'super_like' || reciprocalAction === 'super_like';

        const matchId = await ctx.db.insert('matches', {
          user1Id,
          user2Id,
          matchedAt: now,
          isActive: true,
          matchSource: isSuperLikeMatch ? 'super_like' : 'like',
        });

        // B1 SECURITY: Race condition protection - check for duplicates BEFORE downstream writes
        // If two swipes raced past the existingMatch check, multiple matches may exist.
        // P1-FIX: Use _id (lexicographic) for deterministic winner - both mutations agree on same winner
        const allMatches = await ctx.db
          .query('matches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .collect();

        if (allMatches.length > 1) {
          // Duplicates detected - determine winner by _id (deterministic, never identical)
          allMatches.sort((a, b) => a._id.localeCompare(b._id));
          const winnerMatchId = allMatches[0]._id;

          if (matchId !== winnerMatchId) {
            // Our match lost the race - delete it and return winner's ID
            // Do NOT create conversation/notifications (winner mutation will do it)
            await ctx.db.delete(matchId);
            console.log(`[LIKES] Match race detected: our match ${matchId} lost to ${winnerMatchId}, cleaned up`);
            return { success: true, isMatch: true, matchId: winnerMatchId };
          }

          // We are the winner - delete the other duplicates
          for (let i = 1; i < allMatches.length; i++) {
            await ctx.db.delete(allMatches[i]._id);
            console.log(`[LIKES] Match race detected: cleaned up duplicate ${allMatches[i]._id}`);
          }
        }

        // P1-FIX: STRICT RE-VERIFICATION before any downstream writes
        // Re-query and re-determine winner to handle race where both mutations cleaned up
        const finalMatches = await ctx.db
          .query('matches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .collect();

        if (finalMatches.length === 0) {
          // All matches were deleted (shouldn't happen, but guard anyway)
          console.error('[LIKES] Race condition: all matches deleted, cannot proceed');
          return { success: false, isMatch: false };
        }

        // Deterministic winner: smallest _id wins
        finalMatches.sort((a, b) => a._id.localeCompare(b._id));
        const finalWinnerId = finalMatches[0]._id;

        if (matchId !== finalWinnerId) {
          // We are NOT the winner after re-verification - do NOT proceed with downstream writes
          // The actual winner will handle conversation/notifications
          console.log(`[LIKES] Race re-verify: ${matchId} is not winner (${finalWinnerId}), exiting`);
          return { success: true, isMatch: true, matchId: finalWinnerId };
        }

        // We are the verified winner - proceed with downstream writes
        // SMART MATCHING: Check for existing T&D conversation only
        const existingTodConvoId = await findExistingTodConversation(ctx, fromUserId, toUserId);

        let conversationId: Id<'conversations'>;
        if (existingTodConvoId) {
          // Upgrade existing T&D conversation to match conversation
          await ctx.db.patch(existingTodConvoId, {
            matchId,
            isPreMatch: false,
            lastMessageAt: now,
          });
          conversationId = existingTodConvoId;
        } else {
          // Create new conversation
          conversationId = await ctx.db.insert('conversations', {
            matchId,
            participants: [fromUserId, toUserId],
            isPreMatch: false,
            createdAt: now,
          });
        }

        // STANDOUT MESSAGE SEEDING: If either super_like has a message, seed it as first chat message
        // Priority: current swipe's message > reciprocal like's message (deterministic rule)
        // This ensures the standout message appears as opening context in the conversation
        const currentSuperLikeMessage = (action === 'super_like' && message) ? message : null;
        const reciprocalSuperLikeMessage = (reciprocalLike?.action === 'super_like' && reciprocalLike?.message)
          ? reciprocalLike.message
          : null;

        // Determine which message to seed (if any) and who sent it
        let seededMessage: { senderId: Id<'users'>; content: string } | null = null;
        if (currentSuperLikeMessage) {
          seededMessage = { senderId: fromUserId, content: currentSuperLikeMessage };
        } else if (reciprocalSuperLikeMessage) {
          seededMessage = { senderId: toUserId, content: reciprocalSuperLikeMessage };
        }

        if (seededMessage) {
          // Check if this exact message already exists to prevent duplicates
          // (could happen in race conditions or retries)
          const existingSeededMsg = await ctx.db
            .query('messages')
            .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
            .filter((q) =>
              q.and(
                q.eq(q.field('senderId'), seededMessage!.senderId),
                q.eq(q.field('content'), seededMessage!.content)
              )
            )
            .first();

          if (!existingSeededMsg) {
            await ctx.db.insert('messages', {
              conversationId,
              senderId: seededMessage.senderId,
              type: 'text',
              content: seededMessage.content,
              createdAt: now,
            });

            // Update conversation's lastMessageAt
            await ctx.db.patch(conversationId, { lastMessageAt: now });
          }
        }

        // Create notifications for both users
        // D5: Add dedupeKey and expiresAt for match notifications
        const toUser = await ctx.db.get(toUserId);
        await ctx.db.insert('notifications', {
          userId: fromUserId,
          type: 'match',
          title: 'New Match!',
          body: `You matched with ${toUser?.name || 'someone'}!`,
          data: { matchId: matchId },
          phase: 'phase1',
          dedupeKey: `match:${matchId}`,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });

        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'match',
          title: 'New Match!',
          body: `You matched with ${fromUser.name}!`,
          data: { matchId: matchId },
          phase: 'phase1',
          dedupeKey: `match:${matchId}`,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });

        return { success: true, isMatch: true, matchId };
      }
    }

    // Send notification for like/super_like (not for pass)
    // Notification lifecycle: stays until opened/acted on, then 24h expiry after opened
    // Use real sender name in notification (fallback to generic only if name missing)
    const senderName = fromUser.name || 'Someone';

    if (action === 'like') {
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'like',
        title: `${senderName} liked you`,
        body: 'Check your likes to see their profile',
        data: { userId: fromUserId, likeType: 'like' },
        phase: 'phase1',
        dedupeKey: `like:${fromUserId}`,
        createdAt: now,
        // No expiresAt - notification stays until acted on
      });
    } else if (action === 'super_like') {
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'super_like',
        title: `${senderName} super liked you`,
        body: 'Open your likes to view their profile',
        data: { userId: fromUserId, likeType: 'super_like' },
        phase: 'phase1',
        dedupeKey: `super_like:${fromUserId}`,
        createdAt: now,
        // No expiresAt - notification stays until acted on
      });
    }

    return { success: true, isMatch: false };
  },
});

// Rewind last swipe
export const rewind = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // TODO: Subscription restrictions disabled for testing mode.
    // Re-enable rewind limits once testing is complete.

    // Get the last like
    const lastLike = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .order('desc')
      .first();

    if (!lastLike) {
      throw new Error('No swipe to rewind');
    }

    // TODO: Time restriction disabled for testing mode.
    // Re-enable 5-second window / premium check once testing is complete.

    // Delete the like
    await ctx.db.delete(lastLike._id);

    // Check if there was a match to undo
    const toUserId = lastLike.toUserId;
    const match = await ctx.db
      .query('matches')
      .filter((q) =>
        q.or(
          q.and(q.eq(q.field('user1Id'), userId), q.eq(q.field('user2Id'), toUserId)),
          q.and(q.eq(q.field('user1Id'), toUserId), q.eq(q.field('user2Id'), userId))
        )
      )
      .first();

    if (match && match.isActive) {
      // Deactivate the match
      await ctx.db.patch(match._id, { isActive: false });

      // Find and deactivate the conversation
      const conversation = await ctx.db
        .query('conversations')
        .withIndex('by_match', (q) => q.eq('matchId', match._id))
        .first();

      if (conversation) {
        // Keep conversation for history but could mark it
      }
    }

    return { success: true, rewindedUserId: toUserId };
  },
});

// Get likes received (who liked you)
// FIX: Excludes blocked users (bidirectional)
// PRODUCT FIX: Always return real profile data (photo/name/age)
// LIFECYCLE: Filter out expired likes (opened > 24h ago with no action)
export const getLikesReceived = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;
    const now = Date.now();
    const LIKE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

    const user = await ctx.db.get(userId);
    if (!user) return [];

    const likes = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) =>
        q.or(
          q.eq(q.field('action'), 'like'),
          q.eq(q.field('action'), 'super_like')
        )
      )
      .order('desc')
      .take(limit);

    // FIX: Batch fetch blocked users (bidirectional)
    const [myBlocks, blocksOnMe] = await Promise.all([
      // Users I have blocked
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      // Users who have blocked me
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
    ]);
    const blockedUserIds = new Set([
      ...myBlocks.map((b) => b.blockedUserId as string),
      ...blocksOnMe.map((b) => b.blockerId as string),
    ]);

    // Check which ones are already matched
    const result = [];
    for (const like of likes) {
      // FIX: Skip likes from blocked users (either direction)
      if (blockedUserIds.has(like.fromUserId as string)) continue;

      // LIFECYCLE: Skip expired likes (opened > 24h ago)
      // Unopened likes (firstOpenedAt undefined) never expire
      const firstOpenedAt = (like as any).firstOpenedAt as number | undefined;
      if (firstOpenedAt && now - firstOpenedAt > LIKE_EXPIRY_MS) {
        continue; // Expired - skip
      }

      // Check if already swiped on this person
      const alreadySwiped = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', like.fromUserId)
        )
        .first();

      if (alreadySwiped) continue; // Skip if already swiped

      const fromUser = await ctx.db.get(like.fromUserId);
      if (!fromUser || !fromUser.isActive) continue;

      const photo = await getPhase1PrimaryPhoto(ctx, like.fromUserId);

      // PRODUCT FIX: Always return REAL profile data (no anonymization)
      result.push({
        likeId: like._id,
        userId: like.fromUserId,
        action: like.action,
        message: like.message,
        createdAt: like.createdAt,
        firstOpenedAt, // Include for UI lifecycle tracking
        // Always show real data
        name: fromUser.name,
        age: calculateAge(fromUser.dateOfBirth),
        photoUrl: photo?.url,
        gender: fromUser.gender,
      });
    }

    return result;
  },
});

// Phase-1 Stand Out requests received by the viewer.
// Pending means: incoming super_like, no reciprocal response, no active match,
// both users still available, and neither side has blocked the other.
export const getIncomingStandOuts = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50, refreshKey } = args;
    void refreshKey;

    const viewer = await ctx.db.get(userId);
    if (!isPhase1UserAvailable(viewer)) return [];

    const fetchWindow = Math.min(Math.max(limit * 4, limit + 30), 200);
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('action'), 'super_like'))
      .order('desc')
      .take(fetchWindow);

    const rows = [];
    for (const like of likes) {
      if (rows.length >= limit) break;
      if (!(await isPendingPhase1StandOutVisible(ctx, like, userId, like.fromUserId))) {
        continue;
      }

      const sender = await getStandOutPreviewUser(ctx, like.fromUserId);
      if (!sender) continue;

      rows.push({
        likeId: like._id,
        fromUserId: like.fromUserId,
        action: like.action,
        message: like.message,
        createdAt: like.createdAt,
        firstOpenedAt: (like as any).firstOpenedAt,
        sender,
      });
    }

    return rows;
  },
});

// Phase-1 Stand Out requests sent by the viewer that are still pending.
export const getOutgoingStandOuts = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50, refreshKey } = args;
    void refreshKey;

    const viewer = await ctx.db.get(userId);
    if (!isPhase1UserAvailable(viewer)) return [];

    const fetchWindow = Math.min(Math.max(limit * 4, limit + 30), 200);
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .filter((q) => q.eq(q.field('action'), 'super_like'))
      .order('desc')
      .take(fetchWindow);

    const rows = [];
    for (const like of likes) {
      if (rows.length >= limit) break;
      if (!(await isPendingPhase1OutgoingStandOutVisible(ctx, like, userId))) {
        continue;
      }

      const receiver = await getStandOutPreviewUser(ctx, like.toUserId);
      if (!receiver) continue;

      rows.push({
        likeId: like._id,
        toUserId: like.toUserId,
        action: like.action,
        message: like.message,
        createdAt: like.createdAt,
        firstOpenedAt: (like as any).firstOpenedAt,
        receiver,
      });
    }

    return rows;
  },
});

export const getStandOutCounts = query({
  args: {
    userId: v.id('users'),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, refreshKey } = args;
    void refreshKey;

    const viewer = await ctx.db.get(userId);
    if (!isPhase1UserAvailable(viewer)) {
      return { incoming: 0, outgoing: 0, remainingToday: 0 };
    }

    const [incomingLikes, outgoingLikes] = await Promise.all([
      ctx.db
        .query('likes')
        .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
        .filter((q) => q.eq(q.field('action'), 'super_like'))
        .collect(),
      ctx.db
        .query('likes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
        .filter((q) => q.eq(q.field('action'), 'super_like'))
        .collect(),
    ]);

    let incoming = 0;
    for (const like of incomingLikes) {
      if (await isPendingPhase1StandOutVisible(ctx, like, userId, like.fromUserId)) {
        incoming++;
      }
    }

    let outgoing = 0;
    for (const like of outgoingLikes) {
      if (await isPendingPhase1OutgoingStandOutVisible(ctx, like, userId)) {
        outgoing++;
      }
    }

    const isUnlimitedByPolicy =
      viewer.gender === 'female' ||
      viewer.subscriptionTier === 'premium';
    let remainingToday: number | null = null;
    if (!isUnlimitedByPolicy) {
      const now = Date.now();
      const dayStart = getUtcDayStartMs(now);
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const sentToday = await ctx.db
        .query('likes')
        .withIndex('by_from_user_createdAt', (q) =>
          q.eq('fromUserId', userId).gte('createdAt', dayStart).lt('createdAt', dayEnd)
        )
        .filter((q) => q.eq(q.field('action'), 'super_like'))
        .collect();
      remainingToday = Math.max(0, DAILY_STANDOUT_LIMIT_FREE - sentToday.length);
    }

    return { incoming, outgoing, remainingToday };
  },
});

export const acceptStandOut = mutation({
  args: {
    authUserId: v.string(),
    likeId: v.id('likes'),
  },
  handler: async (ctx, args) => {
    const receiverId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!receiverId) {
      throw new Error('Unauthorized: user not found');
    }

    return await acceptPendingPhase1StandOut(ctx, {
      receiverId,
      likeId: args.likeId,
    });
  },
});

export const replyToStandOut = mutation({
  args: {
    authUserId: v.string(),
    likeId: v.id('likes'),
    replyText: v.string(),
  },
  handler: async (ctx, args) => {
    const receiverId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!receiverId) {
      throw new Error('Unauthorized: user not found');
    }

    return await acceptPendingPhase1StandOut(ctx, {
      receiverId,
      likeId: args.likeId,
      replyText: args.replyText,
    });
  },
});

export const ignoreStandOut = mutation({
  args: {
    authUserId: v.string(),
    likeId: v.id('likes'),
  },
  handler: async (ctx, args) => {
    const receiverId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!receiverId) {
      throw new Error('Unauthorized: user not found');
    }

    const like = await ctx.db.get(args.likeId);
    if (!like || like.toUserId !== receiverId || like.action !== 'super_like') {
      throw new Error('Stand Out request not found');
    }

    const isVisible = await isPendingPhase1StandOutVisible(ctx, like, receiverId, like.fromUserId);
    if (!isVisible) {
      return { success: true, ignored: false, alreadyHandled: true };
    }

    const now = Date.now();
    const passId = await ctx.db.insert('likes', {
      fromUserId: receiverId,
      toUserId: like.fromUserId,
      action: 'pass',
      createdAt: now,
    });

    return { success: true, ignored: true, passId };
  },
});

// Get like count
// OPTIMIZATION: Uses batch queries instead of N+1 pattern
// FIX: Excludes blocked users (bidirectional)
export const getLikeCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // 1. Get all likes received (like or super_like)
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) =>
        q.or(
          q.eq(q.field('action'), 'like'),
          q.eq(q.field('action'), 'super_like')
        )
      )
      .collect();

    if (likes.length === 0) return 0;

    // 2. Batch fetch: users I've already swiped on (OPTIMIZATION: replaces N+1 pattern)
    const mySwipes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .collect();
    const alreadySwipedSet = new Set(mySwipes.map((s) => s.toUserId));

    // 3. Batch fetch: users I've blocked (FIX: exclude blocked users)
    const myBlocks = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
      .collect();
    const blockedByMeSet = new Set(myBlocks.map((b) => b.blockedUserId));

    // 4. Batch fetch: users who blocked me (FIX: exclude users who blocked me)
    const blocksOnMe = await ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
      .collect();
    const blockedMeSet = new Set(blocksOnMe.map((b) => b.blockerId));

    // 5. Count likes excluding swiped and blocked users
    let count = 0;
    for (const like of likes) {
      const fromUserId = like.fromUserId;
      // Exclude if already swiped
      if (alreadySwipedSet.has(fromUserId)) continue;
      // Exclude if blocked (either direction)
      if (blockedByMeSet.has(fromUserId)) continue;
      if (blockedMeSet.has(fromUserId)) continue;
      count++;
    }

    return count;
  },
});

// Get user's swipe history
export const getSwipeHistory = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;

    return await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .order('desc')
      .take(limit);
  },
});

// Get users eligible for Confess mention (single source of truth).
//
// P0/P1 MENTION_RULE:
// A can mention B if either:
//   (1) A has liked/right-swiped B (outgoing 'like' / 'super_like' / 'text' row
//       in `likes` with fromUserId=A, toUserId=B), OR
//   (2) A and B are in an active mutual match (row in `matches` with
//       isActive=true and {user1Id,user2Id} = {A,B}).
//
// Reverse one-way unlock is NOT supported: if B liked A but A did not like B
// and no mutual match exists, B is NOT eligible for A to mention.
//
// Candidates from (1) and (2) are merged (union by user id), de-duplicated,
// annotated with `matchType` ('mutual_match' | 'liked_only'), and sorted on
// the server:
//   - 'mutual_match' first
//   - 'liked_only' second
//   - then stable alphabetical by name (case-insensitive)
//
// The exported shape preserves the legacy `{ id, name, avatarUrl, disambiguator }`
// fields so existing callers continue to work; `matchType` is an additive new
// field.
const MENTION_RULE_AUDIT_ENABLED = false;

export const getLikedUsers = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // (1) Outgoing likes by viewer
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .filter((q) =>
        q.or(
          q.eq(q.field('action'), 'like'),
          q.eq(q.field('action'), 'super_like'),
          q.eq(q.field('action'), 'text')
        )
      )
      .collect();

    const likedUserIds = new Set<string>();
    for (const like of likes) likedUserIds.add(like.toUserId as unknown as string);

    // (2) Active mutual matches (viewer is user1 OR user2)
    const [matchesAsUser1, matchesAsUser2] = await Promise.all([
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
    ]);

    const matchedUserIds = new Set<string>();
    for (const m of matchesAsUser1) matchedUserIds.add(m.user2Id as unknown as string);
    for (const m of matchesAsUser2) matchedUserIds.add(m.user1Id as unknown as string);

    // Union (de-duped by id)
    const candidateIds = new Set<string>([...likedUserIds, ...matchedUserIds]);

    if (MENTION_RULE_AUDIT_ENABLED) {
      console.log('[MENTION_RULE][source] raw', {
        viewer: userId,
        likedCount: likedUserIds.size,
        matchedCount: matchedUserIds.size,
        unionCount: candidateIds.size,
      });
    }

    type Row = {
      id: any;
      name: string;
      avatarUrl: string | null;
      disambiguator: string;
      matchType: 'mutual_match' | 'liked_only';
    };

    const result: Row[] = [];

    for (const idStr of candidateIds) {
      const candidateId = idStr as any;
      const candidate = await ctx.db.get(candidateId);
      if (!candidate || !(candidate as any).isActive) continue;

      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', candidateId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // Build disambiguator: prefer bio snippet, then school, then age, then masked userId
      let disambiguator = '';
      const c: any = candidate;
      if (c.bio && c.bio.length > 0) {
        disambiguator = c.bio.slice(0, 30) + (c.bio.length > 30 ? '...' : '');
      } else if (c.school) {
        disambiguator = c.school;
      } else if (c.dateOfBirth) {
        disambiguator = `${calculateAge(c.dateOfBirth)} years old`;
      } else {
        disambiguator = `ID: ...${String(candidateId).slice(-4)}`;
      }

      const matchType: 'mutual_match' | 'liked_only' = matchedUserIds.has(idStr)
        ? 'mutual_match'
        : 'liked_only';

      result.push({
        id: candidateId,
        name: c.name,
        avatarUrl: photo?.url || null,
        disambiguator,
        matchType,
      });
    }

    // Sort: mutual_match (0) before liked_only (1), then case-insensitive name
    result.sort((a, b) => {
      const rank = (t: Row['matchType']) => (t === 'mutual_match' ? 0 : 1);
      const r = rank(a.matchType) - rank(b.matchType);
      if (r !== 0) return r;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    if (MENTION_RULE_AUDIT_ENABLED) {
      const mutualCount = result.filter((r) => r.matchType === 'mutual_match').length;
      const likedOnlyCount = result.filter((r) => r.matchType === 'liked_only').length;
      console.log('[MENTION_RULE][eligible] final', {
        viewer: userId,
        total: result.length,
        mutualCount,
        likedOnlyCount,
        orderedIds: result.map((r) => r.id),
      });
    }

    return result;
  },
});

// BUGFIX #21: Safe date parsing with NaN guard
function calculateAge(dateOfBirth: string): number {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// =============================================================================
// TEST-ONLY: Reset swipe state between two users
// =============================================================================
// WARNING: This is strictly for testing. Do not use in production UI.
// Purpose: Allow repeated testing of swipe flows with limited test users.
// =============================================================================
export const resetSwipeBetweenUsers = mutation({
  args: {
    token: v.string(),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { token, targetUserId } = args;

    // Validate session and derive current user
    const fromUserId = await validateSessionToken(ctx, token);
    if (!fromUserId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Prevent self-targeting
    if (fromUserId === targetUserId) {
      throw new Error('Cannot reset swipe with yourself');
    }

    // Find and delete: fromUserId → targetUserId
    const like1 = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', fromUserId).eq('toUserId', targetUserId)
      )
      .first();

    // Find and delete: targetUserId → fromUserId
    const like2 = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', targetUserId).eq('toUserId', fromUserId)
      )
      .first();

    let deletedCount = 0;

    if (like1) {
      await ctx.db.delete(like1._id);
      deletedCount++;
    }

    if (like2) {
      await ctx.db.delete(like2._id);
      deletedCount++;
    }

    // Test logging
    console.log('[TEST] resetSwipeBetweenUsers executed', {
      fromUserId,
      targetUserId,
      deletedCount,
    });

    return {
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} swipe record(s) between users`,
    };
  },
});

// =============================================================================
// LIFECYCLE: Mark likes as opened when user views the likes section
// =============================================================================
// When user opens the likes/heart section, mark all unopened likes as opened.
// Opened likes start a 24-hour expiry timer.
// =============================================================================
export const markLikesOpened = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    const now = Date.now();

    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Get all unopened likes for this user
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field('action'), 'like'),
            q.eq(q.field('action'), 'super_like')
          ),
          q.eq(q.field('firstOpenedAt'), undefined)
        )
      )
      .collect();

    // Mark each as opened
    let markedCount = 0;
    for (const like of likes) {
      await ctx.db.patch(like._id, { firstOpenedAt: now });
      markedCount++;
    }

    return { success: true, markedCount };
  },
});
