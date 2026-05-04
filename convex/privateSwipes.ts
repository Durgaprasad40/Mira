/**
 * Phase-2 Private Mode Swipes (Deep Connect)
 *
 * STRICT ISOLATION: This file handles ALL Phase-2 swipe/match logic.
 * Phase-2 NEVER writes to Phase-1 tables (likes, matches, conversations).
 * Phase-2 uses ONLY: privateLikes, privateMatches, privateConversations, privateMessages.
 */

import { v } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from './_generated/server';
import { Doc, Id } from './_generated/dataModel';
import { getPhase2DisplayName, validateSessionToken, resolveUserIdByAuthId } from './helpers';
import { shouldCreatePhase2DeepConnectNotification } from './phase2NotificationPrefs';
import { dispatchPrivatePush } from './privateNotifications';
import { softMaskText } from './softMask';
import {
  createPhase2MatchNotificationIfMissing,
  ensurePhase2MatchAndConversation,
  getPhase2UserPair,
} from './phase2MatchHelpers';

// Helper: Check if either user has blocked the other
async function isBlockedBidirectional(
  ctx: MutationCtx | QueryCtx,
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

const STAND_OUT_DAILY_LIMIT = 2;
const STAND_OUT_COOLDOWN_MS = 30 * 1000;
const STAND_OUT_MESSAGE_MAX_LENGTH = 120;
const STAND_OUT_REPLY_MAX_LENGTH = 500;

const STAND_OUT_UNSAFE_PATTERNS: RegExp[] = [
  /\bp[o0]rn/i,
  /\bxxx\b/i,
  /\bnude[s]?\b/i,
  /\bnaked\b/i,
  /\bsext(ing)?\b/i,
  /\bd[i1]ck\s*pic/i,
  /\bn[u0]de?\s*pic/i,
  /\bescort\b/i,
  /\bonlyfans\b/i,
  /\bfansly\b/i,
  /\bnsfw\b/i,
  /\b(pay|paid)\s*(for|me)\s*(sex|meet|hookup)/i,
  /\b(cash|money|venmo|cashapp|paypal|zelle)\s*.{0,20}(meet|sex|hookup)/i,
  /\bsugar\s*(daddy|mommy|mama|baby)/i,
  /\brape\b/i,
  /\bunder\s*18\b/i,
  /\bunderage\b/i,
  /\bminor\b/i,
];

function getStandOutDayStartMs(now: number): number {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function assertStandOutTextIsSafe(text: string): void {
  for (const pattern of STAND_OUT_UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error('Stand Out message contains content that is not allowed');
    }
  }
}

function normalizeStandOutMessage(message: string | undefined): string | undefined {
  if (message == null) return undefined;
  const trimmed = message.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > STAND_OUT_MESSAGE_MAX_LENGTH) {
    throw new Error(`Stand Out message must be ${STAND_OUT_MESSAGE_MAX_LENGTH} characters or fewer`);
  }
  assertStandOutTextIsSafe(trimmed);
  return softMaskText(trimmed);
}

function normalizeStandOutReply(replyText: string): string {
  const trimmed = replyText.trim();
  if (trimmed.length === 0) {
    throw new Error('Reply cannot be empty');
  }
  if (trimmed.length > STAND_OUT_REPLY_MAX_LENGTH) {
    throw new Error(`Reply must be ${STAND_OUT_REPLY_MAX_LENGTH} characters or fewer`);
  }
  assertStandOutTextIsSafe(trimmed);
  return softMaskText(trimmed);
}

function isPhase2UserEligible(user: Doc<'users'> | null): user is Doc<'users'> {
  return !!(
    user &&
    user.phase2OnboardingCompleted === true &&
    user.isActive !== false &&
    user.isBanned !== true &&
    !user.deletedAt
  );
}

async function getActivePrivateMatch(
  ctx: QueryCtx | MutationCtx,
  userAId: Id<'users'>,
  userBId: Id<'users'>
) {
  const { user1Id, user2Id } = getPhase2UserPair(userAId, userBId);
  const match = await ctx.db
    .query('privateMatches')
    .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
    .first();
  return match?.isActive === true ? match : null;
}

async function countStandOutsSentToday(
  ctx: QueryCtx | MutationCtx,
  fromUserId: Id<'users'>,
  now: number
): Promise<number> {
  const dayStart = getStandOutDayStartMs(now);
  const rows = await ctx.db
    .query('privateLikes')
    .withIndex('by_from_action_createdAt', (q) =>
      q.eq('fromUserId', fromUserId).eq('action', 'super_like').gte('createdAt', dayStart)
    )
    .collect();
  return rows.length;
}

async function assertStandOutQuotaAvailable(
  ctx: MutationCtx,
  fromUserId: Id<'users'>,
  now: number
): Promise<void> {
  const sentToday = await countStandOutsSentToday(ctx, fromUserId, now);
  if (sentToday >= STAND_OUT_DAILY_LIMIT) {
    throw new Error('Daily Stand Out limit reached');
  }

  const latestStandOut = await ctx.db
    .query('privateLikes')
    .withIndex('by_from_action_createdAt', (q) =>
      q.eq('fromUserId', fromUserId).eq('action', 'super_like')
    )
    .order('desc')
    .first();

  if (latestStandOut && now - latestStandOut.createdAt < STAND_OUT_COOLDOWN_MS) {
    throw new Error('Please wait before sending another Stand Out');
  }
}

async function getStandOutProfilePreview(
  ctx: QueryCtx,
  userId: Id<'users'>
) {
  const [user, profile, displayName] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first(),
    getPhase2DisplayName(ctx, userId),
  ]);

  if (!isPhase2UserEligible(user) || !profile || profile.isSetupComplete !== true) {
    return null;
  }

  const hasPrivatePhotos = (
    profile.privatePhotosBlurred?.length ??
    profile.privatePhotoUrls?.length ??
    0
  ) > 0;

  return {
    userId,
    displayName,
    age: profile.age,
    gender: profile.gender,
    blurredPhotoUrl: profile.privatePhotoUrls?.[0] ?? null,
    photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
    photoBlurSlots: profile.photoBlurSlots ?? undefined,
    hasPrivatePhotos,
    isVerified: profile.isVerified === true || user.isVerified === true,
    lastActive: user.lastActive ?? null,
  };
}

async function isPendingStandOutVisibleToViewer(
  ctx: QueryCtx | MutationCtx,
  like: Doc<'privateLikes'>,
  viewerId: Id<'users'>,
  otherUserId: Id<'users'>
): Promise<boolean> {
  if (like.action !== 'super_like') return false;
  if (await getActivePrivateMatch(ctx, viewerId, otherUserId)) return false;
  if (await isBlockedBidirectional(ctx, viewerId, otherUserId)) return false;

  const reciprocal = await ctx.db
    .query('privateLikes')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', viewerId).eq('toUserId', otherUserId)
    )
    .first();
  if (reciprocal) return false;

  return true;
}

async function incrementPrivateConversationUnread(
  ctx: MutationCtx,
  conversationId: Id<'privateConversations'>,
  userId: Id<'users'>
): Promise<void> {
  const participant = await ctx.db
    .query('privateConversationParticipants')
    .withIndex('by_user_conversation', (q) =>
      q.eq('userId', userId).eq('conversationId', conversationId)
    )
    .first();
  if (participant) {
    await ctx.db.patch(participant._id, {
      unreadCount: participant.unreadCount + 1,
    });
  }
}

async function getPendingStandOutForReceiver(
  ctx: MutationCtx,
  receiverId: Id<'users'>,
  likeId: Id<'privateLikes'>
) {
  const like = await ctx.db.get(likeId);
  if (!like || like.toUserId !== receiverId || like.action !== 'super_like') {
    throw new Error('Stand Out request not found');
  }

  const [receiver, sender] = await Promise.all([
    ctx.db.get(receiverId),
    ctx.db.get(like.fromUserId),
  ]);
  if (!isPhase2UserEligible(receiver) || !isPhase2UserEligible(sender)) {
    throw new Error('Stand Out request is no longer available');
  }
  if (await isBlockedBidirectional(ctx, receiverId, like.fromUserId)) {
    throw new Error('Stand Out request is no longer available');
  }
  if (await getActivePrivateMatch(ctx, receiverId, like.fromUserId)) {
    throw new Error('Stand Out request is already handled');
  }

  const reciprocal = await ctx.db
    .query('privateLikes')
    .withIndex('by_from_to', (q) =>
      q.eq('fromUserId', receiverId).eq('toUserId', like.fromUserId)
    )
    .first();
  if (reciprocal) {
    throw new Error('Stand Out request is already handled');
  }

  return like;
}

async function insertStandOutTextMessageIfMissing(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'privateConversations'>;
    senderId: Id<'users'>;
    recipientId: Id<'users'>;
    content: string;
    createdAt: number;
    clientMessageId: string;
  }
) {
  const existing = await ctx.db
    .query('privateMessages')
    .withIndex('by_conversation_clientMessageId', (q) =>
      q.eq('conversationId', args.conversationId).eq('clientMessageId', args.clientMessageId)
    )
    .first();
  if (existing) {
    return { messageId: existing._id, inserted: false };
  }

  const messageId = await ctx.db.insert('privateMessages', {
    conversationId: args.conversationId,
    senderId: args.senderId,
    type: 'text',
    content: args.content,
    createdAt: args.createdAt,
    clientMessageId: args.clientMessageId,
  });

  await ctx.db.patch(args.conversationId, { lastMessageAt: args.createdAt });
  await incrementPrivateConversationUnread(ctx, args.conversationId, args.recipientId);

  return { messageId, inserted: true };
}

async function seedStandOutMessageIfNeeded(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'privateConversations'>;
    like: Doc<'privateLikes'>;
    receiverId: Id<'users'>;
    createdAt: number;
  }
): Promise<boolean> {
  const content = args.like.message?.trim();
  if (!content) return false;

  const result = await insertStandOutTextMessageIfMissing(ctx, {
    conversationId: args.conversationId,
    senderId: args.like.fromUserId,
    recipientId: args.receiverId,
    content,
    createdAt: args.createdAt,
    clientMessageId: `standout:${args.like._id}:original`,
  });
  return result.inserted;
}

async function createStandOutMatchNotifications(
  ctx: MutationCtx,
  args: {
    senderId: Id<'users'>;
    receiverId: Id<'users'>;
    matchId: Id<'privateMatches'>;
    conversationId: Id<'privateConversations'>;
    now: number;
  }
) {
  const [senderDisplayNameRaw, receiverDisplayNameRaw] = await Promise.all([
    getPhase2DisplayName(ctx, args.senderId),
    getPhase2DisplayName(ctx, args.receiverId),
  ]);
  const senderDisplayName = senderDisplayNameRaw ?? 'Someone';
  const receiverDisplayName = receiverDisplayNameRaw ?? 'Someone';

  await createPhase2MatchNotificationIfMissing(ctx, {
    userId: args.receiverId,
    matchId: args.matchId,
    conversationId: args.conversationId,
    title: 'New Match! 🎉',
    body: `You matched with ${senderDisplayName} in Deep Connect!`,
    now: args.now,
    data: { otherUserId: args.senderId as string },
    push: true,
  });

  await createPhase2MatchNotificationIfMissing(ctx, {
    userId: args.senderId,
    matchId: args.matchId,
    conversationId: args.conversationId,
    title: 'New Match! 🎉',
    body: `You matched with ${receiverDisplayName} in Deep Connect!`,
    now: args.now,
    data: { otherUserId: args.receiverId as string },
    push: true,
  });
}

async function acceptPendingStandOut(
  ctx: MutationCtx,
  args: {
    receiverId: Id<'users'>;
    likeId: Id<'privateLikes'>;
    replyText?: string;
  }
) {
  const now = Date.now();
  const like = await getPendingStandOutForReceiver(ctx, args.receiverId, args.likeId);
  const normalizedReply = args.replyText == null ? null : normalizeStandOutReply(args.replyText);

  const acceptanceLikeId = await ctx.db.insert('privateLikes', {
    fromUserId: args.receiverId,
    toUserId: like.fromUserId,
    action: 'like',
    createdAt: now,
  });

  const ensured = await ensurePhase2MatchAndConversation(ctx, {
    userAId: like.fromUserId,
    userBId: args.receiverId,
    now,
    source: 'deep_connect',
    matchKind: 'super_like',
    connectionSource: 'desire_super_like',
    reactivateInactive: true,
    unhideExistingConversation: true,
    existingConversationMeansAlreadyMatched: false,
  });

  const seededStandOutMessage = await seedStandOutMessageIfNeeded(ctx, {
    conversationId: ensured.conversationId,
    like,
    receiverId: args.receiverId,
    createdAt: now,
  });

  let replyMessageId: Id<'privateMessages'> | null = null;
  if (normalizedReply) {
    const replyResult = await insertStandOutTextMessageIfMissing(ctx, {
      conversationId: ensured.conversationId,
      senderId: args.receiverId,
      recipientId: like.fromUserId,
      content: normalizedReply,
      createdAt: now + 1,
      clientMessageId: `standout:${like._id}:reply`,
    });
    replyMessageId = replyResult.messageId;
  }

  await createStandOutMatchNotifications(ctx, {
    senderId: like.fromUserId,
    receiverId: args.receiverId,
    matchId: ensured.matchId,
    conversationId: ensured.conversationId,
    now,
  });

  return {
    success: true,
    conversationId: ensured.conversationId,
    matchId: ensured.matchId,
    acceptanceLikeId,
    seededStandOutMessage,
    replyMessageId,
    source: ensured.source,
  };
}

/**
 * Phase-2 Swipe Mutation
 *
 * Records swipes in privateLikes table and creates matches in privateMatches.
 * NEVER writes to Phase-1 tables.
 */
export const swipe = mutation({
  args: {
    authUserId: v.string(), // CONTRACT FIX: Changed from token to authUserId
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { authUserId, toUserId, action, message } = args;
    const now = Date.now();

    // Resolve authUserId to Convex user ID
    const fromUserId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!fromUserId) {
      throw new Error('Unauthorized: user not found');
    }

    // Prevent self-swiping
    if (fromUserId === toUserId) {
      throw new Error('Cannot swipe on yourself');
    }

    // Get current user for verification checks
    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');

    // Verify Phase-2 onboarding is complete
    if (!fromUser.phase2OnboardingCompleted) {
      throw new Error('Phase-2 onboarding required');
    }

    // Check if already swiped (in Phase-2 privateLikes table)
    const existingLike = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', fromUserId).eq('toUserId', toUserId)
      )
      .first();

    // FIX 2: Idempotency safety - return success instead of throwing error
    if (existingLike) {
      if (action === 'like' || action === 'super_like') {
        const { user1Id, user2Id } = getPhase2UserPair(fromUserId, toUserId);
        const existingMatch = await ctx.db
          .query('privateMatches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .first();

        if (existingMatch?.isActive === true) {
          const ensured = await ensurePhase2MatchAndConversation(ctx, {
            userAId: fromUserId,
            userBId: toUserId,
            now,
            source: 'deep_connect',
            matchKind: existingMatch.matchSource === 'super_like' ? 'super_like' : 'like',
            connectionSource: existingMatch.matchSource === 'super_like' ? 'desire_super_like' : 'desire_match',
          });

          return {
            success: true,
            isMatch: true,
            matchId: ensured.matchId,
            conversationId: ensured.conversationId,
            alreadyMatched: true,
            source: ensured.source,
          };
        }
      }

      return {
        success: true,
        isMatch: false,
        alreadyMatched: false,
        alreadySent: true,
        likeId: existingLike._id,
        existingAction: existingLike.action,
        source: 'deep_connect',
      };
    }

    // FIX 1: Target user Phase-2 validation
    const toUser = await ctx.db.get(toUserId);
    if (!isPhase2UserEligible(toUser)) {
      throw new Error('Target user not available in Phase-2');
    }

    // Block check for like/super_like actions
    if (action === 'like' || action === 'super_like') {
      if (await isBlockedBidirectional(ctx, fromUserId, toUserId)) {
        throw new Error('Cannot like this user');
      }

      const { user1Id, user2Id } = getPhase2UserPair(fromUserId, toUserId);
      const existingMatch = await ctx.db
        .query('privateMatches')
        .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
        .first();

      if (existingMatch?.isActive === true) {
        const ensured = await ensurePhase2MatchAndConversation(ctx, {
          userAId: fromUserId,
          userBId: toUserId,
          now,
          source: 'deep_connect',
          matchKind: existingMatch.matchSource === 'super_like' ? 'super_like' : 'like',
          connectionSource: existingMatch.matchSource === 'super_like' ? 'desire_super_like' : 'desire_match',
        });

        return {
          success: true,
          isMatch: true,
          matchId: ensured.matchId,
          conversationId: ensured.conversationId,
          alreadyMatched: true,
          source: ensured.source,
        };
      }
    }

    const normalizedStandOutMessage =
      action === 'super_like' ? normalizeStandOutMessage(message) : message;
    if (action === 'super_like') {
      await assertStandOutQuotaAvailable(ctx, fromUserId, now);
    }

    // Record the swipe in privateLikes (Phase-2 table)
    const likeId = await ctx.db.insert('privateLikes', {
      fromUserId,
      toUserId,
      action,
      message: normalizedStandOutMessage,
      createdAt: now,
    });

    // Log like creation
    if (action === 'like' || action === 'super_like') {
      console.log('[P2_LIKE_CREATED]', {
        from: fromUserId,
        to: toUserId,
        action,
        likeId
      });
    }

    // Check for match (only on like or super_like)
    if (action === 'like' || action === 'super_like') {
      // Check for reciprocal like in privateLikes (Phase-2 only)
      const reciprocalLike = await ctx.db
        .query('privateLikes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', toUserId).eq('toUserId', fromUserId)
        )
        .first();

      const hasReciprocalLike = reciprocalLike && (
        reciprocalLike.action === 'like' ||
        reciprocalLike.action === 'super_like'
      );

      if (hasReciprocalLike) {
        const reciprocalAction = reciprocalLike.action;
        const isSuperLikeMatch = action === 'super_like' || reciprocalAction === 'super_like';
        const ensured = await ensurePhase2MatchAndConversation(ctx, {
          userAId: fromUserId,
          userBId: toUserId,
          now,
          source: 'deep_connect',
          matchKind: isSuperLikeMatch ? 'super_like' : 'like',
          connectionSource: isSuperLikeMatch ? 'desire_super_like' : 'desire_match',
          reactivateInactive: true,
        });

        const { user1Id, user2Id } = getPhase2UserPair(fromUserId, toUserId);
        const matchId = ensured.matchId;
        const conversationId = ensured.conversationId;

        if (ensured.alreadyMatched) {
          console.log('[P2_MATCH_ALREADY_EXISTS]', {
            user1: (user1Id as string)?.slice(-8),
            user2: (user2Id as string)?.slice(-8),
            matchId: (matchId as string)?.slice(-8),
            conversationId: (conversationId as string)?.slice(-8),
          });
          return {
            success: true,
            isMatch: true,
            matchId,
            conversationId,
            alreadyMatched: true,
            source: ensured.source,
          };
        }

        // Seed super_like message if present
        const currentSuperLikeMessage = (action === 'super_like' && normalizedStandOutMessage) ? normalizedStandOutMessage : null;
        const reciprocalSuperLikeMessage = (reciprocalLike.action === 'super_like' && reciprocalLike.message)
          ? reciprocalLike.message
          : null;

        let seededMessage: { senderId: Id<'users'>; content: string } | null = null;
        if (currentSuperLikeMessage) {
          seededMessage = { senderId: fromUserId, content: currentSuperLikeMessage };
        } else if (reciprocalSuperLikeMessage) {
          seededMessage = { senderId: toUserId, content: reciprocalSuperLikeMessage };
        }

        if (seededMessage) {
          await ctx.db.insert('privateMessages', {
            conversationId,
            senderId: seededMessage.senderId,
            type: 'text',
            content: seededMessage.content,
            createdAt: now,
          });

          // Update conversation's lastMessageAt
          await ctx.db.patch(conversationId, { lastMessageAt: now });

          // Update unread count for recipient
          const recipientId = seededMessage.senderId === fromUserId ? toUserId : fromUserId;
          const participantRecord = await ctx.db
            .query('privateConversationParticipants')
            .withIndex('by_user_conversation', (q) =>
              q.eq('userId', recipientId).eq('conversationId', conversationId)
            )
            .first();
          if (participantRecord) {
            await ctx.db.patch(participantRecord._id, {
              unreadCount: participantRecord.unreadCount + 1,
            });
          }
        }

        // Log match creation
        console.log('[P2_MATCH_CREATED]', {
          user1: user1Id,
          user2: user2Id,
          matchId,
          conversationId,
          source: isSuperLikeMatch ? 'super_like' : 'like'
        });

        // ANON-LOADING-FIX: getPhase2DisplayName may now return null. Use
        // 'Someone' as a graceful generic label so match notifications never
        // read "You matched with null" or leak the intentional-anonymous-only
        // word "Anonymous" for a missing-data state.
        const [fromDisplayNameRaw, toDisplayNameRaw] = await Promise.all([
          getPhase2DisplayName(ctx, fromUserId),
          getPhase2DisplayName(ctx, toUserId),
        ]);
        const fromDisplayName = fromDisplayNameRaw ?? 'Someone';
        const toDisplayName = toDisplayNameRaw ?? 'Someone';

        // Notify both users exactly once per match/user pair.
        await createPhase2MatchNotificationIfMissing(ctx, {
          userId: toUserId,
          matchId,
          conversationId,
          title: 'New Match! 🎉',
          body: `You matched with ${fromDisplayName} in Deep Connect!`,
          now,
          push: true,
        });

        await createPhase2MatchNotificationIfMissing(ctx, {
          userId: fromUserId,
          matchId,
          conversationId,
          title: 'New Match! 🎉',
          body: `You matched with ${toDisplayName} in Deep Connect!`,
          now,
          push: true,
        });

        return {
          success: true,
          isMatch: true,
          matchId,
          conversationId,
          alreadyMatched: false,
          source: ensured.source,
        };
      } else {
        // NO RECIPROCAL LIKE YET - send "someone liked you" notification
        // This is the pending like state - match will be created when other user likes back
        console.log('[P2_LIKE_PENDING]', {
          from: fromUserId,
          to: toUserId,
          action,
          awaitingReciprocal: true
        });

        // Notify the recipient that someone liked them (anonymous)
        // STRICT ISOLATION: Phase-2 rows live in `privateNotifications` only
        if (await shouldCreatePhase2DeepConnectNotification(ctx, toUserId)) {
          const likeTitle =
            action === 'super_like' ? 'Someone super liked you! ⭐' : 'Someone liked you! 💜';
          const likeBody = 'Check your likes in Deep Connect to see who!';
          const notificationSource = action === 'super_like' ? 'stand_out' : 'deep_connect';
          await ctx.db.insert('privateNotifications', {
            userId: toUserId,
            type: 'phase2_like',
            title: likeTitle,
            body: likeBody,
            data: {
              otherUserId: fromUserId as string,
              source: notificationSource,
              action,
              likeId: likeId as string,
            },
            phase: 'phase2',
            dedupeKey: `p2_like:${fromUserId}:${toUserId}`,
            createdAt: now,
            expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
          });
          // PHASE-2 PUSH: surface OS notification for new like (gated by same pref)
          await dispatchPrivatePush(ctx, {
            userId: toUserId,
            type: 'phase2_like',
            title: likeTitle,
            body: likeBody,
            data: {
              otherUserId: fromUserId as string,
              source: notificationSource,
              action,
              likeId: likeId as string,
            },
          });
        }
      }
    }

    return { success: true, isMatch: false, alreadyMatched: false, source: 'deep_connect' };
  },
});

/**
 * Phase-2 Stand Out requests received by the viewer.
 *
 * Pending means: incoming super_like, no reciprocal response, no active match,
 * both users still Phase-2 eligible, and neither side has blocked the other.
 */
export const getIncomingStandOuts = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, limit = 50, refreshKey } = args;
    void refreshKey;

    const viewerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!viewerId) {
      console.log('[STANDOUT_INCOMING_DENIED] Auth ID not linked to user:', authUserId);
      return [];
    }

    const viewer = await ctx.db.get(viewerId);
    if (!isPhase2UserEligible(viewer)) {
      return [];
    }

    const fetchWindow = Math.min(Math.max(limit * 4, limit + 30), 200);
    const likes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_action_createdAt', (q) =>
        q.eq('toUserId', viewerId).eq('action', 'super_like')
      )
      .order('desc')
      .take(fetchWindow);

    const rows = [];
    for (const like of likes) {
      if (rows.length >= limit) break;
      if (!(await isPendingStandOutVisibleToViewer(ctx, like, viewerId, like.fromUserId))) {
        continue;
      }

      const sender = await getStandOutProfilePreview(ctx, like.fromUserId);
      if (!sender) continue;

      rows.push({
        likeId: like._id,
        fromUserId: like.fromUserId,
        action: like.action,
        message: like.message,
        createdAt: like.createdAt,
        sender,
      });
    }

    return rows;
  },
});

/**
 * Phase-2 Stand Out requests sent by the viewer that are still pending.
 */
export const getOutgoingStandOuts = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, limit = 50, refreshKey } = args;
    void refreshKey;

    const viewerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!viewerId) {
      console.log('[STANDOUT_OUTGOING_DENIED] Auth ID not linked to user:', authUserId);
      return [];
    }

    const viewer = await ctx.db.get(viewerId);
    if (!isPhase2UserEligible(viewer)) {
      return [];
    }

    const fetchWindow = Math.min(Math.max(limit * 4, limit + 30), 200);
    const likes = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_action_createdAt', (q) =>
        q.eq('fromUserId', viewerId).eq('action', 'super_like')
      )
      .order('desc')
      .take(fetchWindow);

    const rows = [];
    for (const like of likes) {
      if (rows.length >= limit) break;
      if (!(await isPendingStandOutVisibleToViewer(ctx, like, viewerId, like.toUserId))) {
        continue;
      }

      const receiver = await getStandOutProfilePreview(ctx, like.toUserId);
      if (!receiver) continue;

      rows.push({
        likeId: like._id,
        toUserId: like.toUserId,
        action: like.action,
        message: like.message,
        createdAt: like.createdAt,
        receiver,
      });
    }

    return rows;
  },
});

/**
 * Phase-2 Stand Out badge/count data for future Messages UI.
 */
export const getStandOutCounts = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!viewerId) {
      console.log('[STANDOUT_COUNTS_DENIED] Auth ID not linked to user:', args.authUserId);
      return {
        incoming: 0,
        outgoing: 0,
        remainingToday: STAND_OUT_DAILY_LIMIT,
      };
    }

    const viewer = await ctx.db.get(viewerId);
    if (!isPhase2UserEligible(viewer)) {
      return {
        incoming: 0,
        outgoing: 0,
        remainingToday: STAND_OUT_DAILY_LIMIT,
      };
    }

    const [incomingLikes, outgoingLikes, sentToday] = await Promise.all([
      ctx.db
        .query('privateLikes')
        .withIndex('by_to_action_createdAt', (q) =>
          q.eq('toUserId', viewerId).eq('action', 'super_like')
        )
        .collect(),
      ctx.db
        .query('privateLikes')
        .withIndex('by_from_action_createdAt', (q) =>
          q.eq('fromUserId', viewerId).eq('action', 'super_like')
        )
        .collect(),
      countStandOutsSentToday(ctx, viewerId, Date.now()),
    ]);

    let incoming = 0;
    for (const like of incomingLikes) {
      if (await isPendingStandOutVisibleToViewer(ctx, like, viewerId, like.fromUserId)) {
        const sender = await getStandOutProfilePreview(ctx, like.fromUserId);
        if (sender) incoming++;
      }
    }

    let outgoing = 0;
    for (const like of outgoingLikes) {
      if (await isPendingStandOutVisibleToViewer(ctx, like, viewerId, like.toUserId)) {
        const receiver = await getStandOutProfilePreview(ctx, like.toUserId);
        if (receiver) outgoing++;
      }
    }

    return {
      incoming,
      outgoing,
      remainingToday: Math.max(0, STAND_OUT_DAILY_LIMIT - sentToday),
    };
  },
});

/**
 * Receiver accepts an incoming Phase-2 Stand Out without adding a reply.
 */
export const acceptStandOut = mutation({
  args: {
    authUserId: v.string(),
    likeId: v.id('privateLikes'),
  },
  handler: async (ctx, args) => {
    const receiverId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!receiverId) {
      throw new Error('Unauthorized: user not found');
    }

    return await acceptPendingStandOut(ctx, {
      receiverId,
      likeId: args.likeId,
    });
  },
});

/**
 * Receiver replies to an incoming Phase-2 Stand Out, which accepts it.
 */
export const replyToStandOut = mutation({
  args: {
    authUserId: v.string(),
    likeId: v.id('privateLikes'),
    replyText: v.string(),
  },
  handler: async (ctx, args) => {
    const receiverId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!receiverId) {
      throw new Error('Unauthorized: user not found');
    }

    return await acceptPendingStandOut(ctx, {
      receiverId,
      likeId: args.likeId,
      replyText: args.replyText,
    });
  },
});

/**
 * Receiver ignores an incoming Phase-2 Stand Out.
 *
 * Stores a Phase-2 private pass from receiver to sender so pending queries
 * hide the request for both sides without notifying the sender.
 */
export const ignoreStandOut = mutation({
  args: {
    authUserId: v.string(),
    likeId: v.id('privateLikes'),
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

    const sender = await ctx.db.get(like.fromUserId);
    const receiver = await ctx.db.get(receiverId);
    if (!isPhase2UserEligible(sender) || !isPhase2UserEligible(receiver)) {
      return { success: true, ignored: false, alreadyHandled: true };
    }

    const existingMatch = await getActivePrivateMatch(ctx, receiverId, like.fromUserId);
    if (existingMatch) {
      return { success: true, ignored: false, alreadyHandled: true };
    }

    const reciprocal = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', receiverId).eq('toUserId', like.fromUserId)
      )
      .first();
    if (reciprocal) {
      return { success: true, ignored: false, alreadyHandled: true };
    }

    const now = Date.now();
    const passId = await ctx.db.insert('privateLikes', {
      fromUserId: receiverId,
      toUserId: like.fromUserId,
      action: 'pass',
      createdAt: now,
    });

    return {
      success: true,
      ignored: true,
      passId,
    };
  },
});

/**
 * Get Phase-2 swipe history for a user
 * P1-SECURITY FIX: Requires auth - users can only access their OWN swipe history
 */
export const getSwipeHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { limit = 50 } = args;

    // P1-SECURITY FIX: Validate caller identity - fail closed
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error('Authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      throw new Error('User not found');
    }

    return await ctx.db
      .query('privateLikes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .order('desc')
      .take(limit);
  },
});

/**
 * Check if user has already swiped on another user in Phase-2
 * P1-SECURITY FIX: Requires auth - users can only check their OWN swipes
 */
export const hasSwipedOn = query({
  args: {
    toUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { toUserId } = args;

    // P1-SECURITY FIX: Validate caller identity - fail closed
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error('Authentication required');
    }
    const fromUserId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!fromUserId) {
      throw new Error('User not found');
    }

    const existingLike = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', fromUserId).eq('toUserId', toUserId)
      )
      .first();

    return !!existingLike;
  },
});

/**
 * Get users that current user has swiped on in Phase-2 (for filtering discover)
 * P1-SECURITY FIX: Requires auth - users can only access their OWN swipe list
 */
export const getSwipedUserIds = query({
  args: {},
  handler: async (ctx) => {
    // P1-SECURITY FIX: Validate caller identity - fail closed
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error('Authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      throw new Error('User not found');
    }

    const swipes = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .collect();

    return swipes.map((s) => s.toUserId);
  },
});

/**
 * Get incoming likes (people who liked the current user) in Phase-2
 * Used by Likes tab to show pending likes before match
 *
 * SECURITY: Auth-enforced - users can ONLY access their OWN incoming likes
 * P2-FIX: Changed from userId: v.id('users') to authUserId: v.string() for frontend compatibility
 */
export const getIncomingLikes = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, limit = 50, refreshKey } = args;
    void refreshKey;

    // Resolve auth ID to Convex user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      console.log('[LIKES_FETCH_DENIED] Auth ID not linked to user:', authUserId);
      return []; // Return empty for graceful degradation
    }

    // Get all likes TO the current user
    const fetchWindow = Math.min(Math.max(limit * 3, limit + 20), 150);
    const incomingLikes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .order('desc')
      .take(fetchWindow);

    // Filter to only likes/super_likes (not passes), and exclude already matched.
    // Overfetching keeps the visible pending set more complete when recent rows
    // include passes or reciprocal likes that should be filtered out.
    const pendingLikes = await Promise.all(incomingLikes.map(async (like) => {
      if (like.action !== 'like' && like.action !== 'super_like') {
        return null;
      }

      // Check if current user has already liked them back (would be matched)
      const reciprocalLike = await ctx.db
        .query('privateLikes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', like.fromUserId)
        )
        .first();

      // If user hasn't swiped on them yet, it's a pending like
      if (reciprocalLike) {
        return null;
      }

      // Get liker's profile info
      const likerProfile = await ctx.db
        .query('userPrivateProfiles')
        .withIndex('by_user', (q) => q.eq('userId', like.fromUserId))
        .first();

      if (!likerProfile) {
        return null;
      }

      const displayName = await getPhase2DisplayName(ctx, like.fromUserId);
      const hasPrivatePhotos = (
        likerProfile.privatePhotosBlurred?.length ??
        likerProfile.privatePhotoUrls?.length ??
        0
      ) > 0;

      return {
        likeId: like._id,
        fromUserId: like.fromUserId,
        action: like.action,
        createdAt: like.createdAt,
        message: like.message,
        profile: {
          displayName,
          age: likerProfile.age,
          gender: likerProfile.gender,
          blurredPhotoUrl: likerProfile.privatePhotoUrls?.[0] ?? null,
          photoBlurEnabled: (likerProfile as any).photoBlurEnabled ?? undefined,
          photoBlurSlots: likerProfile.photoBlurSlots ?? undefined,
          hasPrivatePhotos,
        },
      };
    }));

    return pendingLikes.filter((like): like is NonNullable<typeof like> => like !== null).slice(0, limit);
  },
});

/**
 * Get count of pending incoming likes (for badge)
 *
 * SECURITY: Auth-enforced - users can ONLY access their OWN like count
 * P2-FIX: Changed from userId: v.id('users') to authUserId: v.string() for frontend compatibility
 */
export const getIncomingLikesCount = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;

    // Resolve auth ID to Convex user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      console.log('[LIKES_COUNT_DENIED] Auth ID not linked to user:', authUserId);
      return 0; // Return 0 for graceful degradation
    }

    // Get all likes TO the current user
    const incomingLikes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .collect();

    let count = 0;
    for (const like of incomingLikes) {
      if (like.action !== 'like' && like.action !== 'super_like') continue;

      // Check if current user has already liked them back
      const reciprocalLike = await ctx.db
        .query('privateLikes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', like.fromUserId)
        )
        .first();

      if (!reciprocalLike) {
        count++;
      }
    }

    return count;
  },
});

/**
 * Phase-2 Unmatch
 *
 * STRICT ISOLATION: Operates ONLY on Phase-2 tables (privateMatches,
 * privateConversationParticipants). Never touches Phase-1 `matches` or
 * `conversations`. Must NOT be confused with `api.matches.unmatch` (Phase-1).
 *
 * Behavior:
 *   1. Verifies the caller is a participant in the privateConversation.
 *   2. If a privateMatch exists for the participant pair, sets isActive=false.
 *   3. Hides the conversation for the caller (privateConversationParticipants.isHidden=true).
 *      The other participant's view is left untouched (one-sided unmatch UX).
 */
export const unmatchPrivate = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, args) => {
    const { authUserId, conversationId } = args;

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: false, error: 'unauthorized' as const };
    }

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return { success: false, error: 'conversation_not_found' as const };
    }

    // Verify caller is part of this conversation
    const callerParticipant = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();
    if (!callerParticipant) {
      return { success: false, error: 'not_a_participant' as const };
    }

    // Find the other participant (Phase-2 conversations are 1:1)
    const otherParticipantId = conversation.participants.find(
      (p) => (p as string) !== (userId as string)
    ) as Id<'users'> | undefined;

    // Mark the privateMatch inactive if it exists
    if (otherParticipantId) {
      const user1Id =
        (userId as string) < (otherParticipantId as string) ? userId : otherParticipantId;
      const user2Id =
        (userId as string) < (otherParticipantId as string) ? otherParticipantId : userId;

      const match = await ctx.db
        .query('privateMatches')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id as Id<'users'>).eq('user2Id', user2Id as Id<'users'>)
        )
        .first();

      if (match && match.isActive) {
        await ctx.db.patch(match._id, { isActive: false });
      }
    }

    // Hide the conversation for the caller (one-sided)
    await ctx.db.patch(callerParticipant._id, { isHidden: true });

    return { success: true };
  },
});
