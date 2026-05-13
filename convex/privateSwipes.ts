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
  filterOwnedSafePrivatePhotoUrls,
  PHASE2_MIN_PRIVATE_PHOTOS,
} from './phase2PrivatePhotos';
import {
  assertCanDeepConnectInteract,
  canDeepConnectInteract,
} from './privateDiscover';
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

async function isIncomingLikeHiddenBySafety(
  ctx: QueryCtx,
  viewerId: Id<'users'>,
  likerUserId: Id<'users'>
): Promise<boolean> {
  return !(await canDeepConnectInteract(ctx, viewerId, likerUserId));
}

const STAND_OUT_DAILY_LIMIT = 2;
const STAND_OUT_COOLDOWN_MS = 30 * 1000;
const STAND_OUT_MESSAGE_MAX_LENGTH = 120;
const STAND_OUT_REPLY_MAX_LENGTH = 500;
const MAX_STAND_OUT_LIST_FETCH_WINDOW = 200;
const MAX_STAND_OUT_COUNT_SCAN = 300;
const MAX_INCOMING_LIKE_LIST_FETCH_WINDOW = 150;
const MAX_INCOMING_LIKE_COUNT_SCAN = 500;

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

function normalizePrivateSwipeLimit(value: number | undefined, fallback = 50, max = 50): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

function sortPrivateLikesNewestFirst<T extends Doc<'privateLikes'>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => b.createdAt - a.createdAt || String(b._id).localeCompare(String(a._id)),
  );
}

async function requirePrivateSwipeActor(
  ctx: QueryCtx | MutationCtx,
  token: string,
  authUserId?: string,
): Promise<Id<'users'>> {
  const actorId = await validateSessionToken(ctx, token.trim());
  if (!actorId) {
    throw new Error('UNAUTHORIZED');
  }

  const authHint = authUserId?.trim();
  if (authHint) {
    const assertedUserId = await resolveUserIdByAuthId(ctx, authHint);
    if (!assertedUserId || assertedUserId !== actorId) {
      throw new Error('UNAUTHORIZED');
    }
  }

  return actorId;
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

async function upsertPhase2LikeNotificationForAction(
  ctx: MutationCtx,
  args: {
    fromUserId: Id<'users'>;
    toUserId: Id<'users'>;
    likeId: Id<'privateLikes'>;
    action: 'like' | 'super_like';
    now: number;
    push?: boolean;
  }
): Promise<void> {
  if (!(await shouldCreatePhase2DeepConnectNotification(ctx, args.toUserId))) {
    return;
  }

  const title =
    args.action === 'super_like' ? 'Someone super liked you! ⭐' : 'Someone liked you! 💜';
  const body = 'Check your likes in Deep Connect to see who!';
  const source = args.action === 'super_like' ? 'stand_out' : 'deep_connect';
  const data = {
    otherUserId: args.fromUserId as string,
    source,
    action: args.action,
    likeId: args.likeId as string,
  };
  const dedupeKey = `p2_like:${args.fromUserId}:${args.toUserId}`;
  const expiresAt = args.now + 7 * 24 * 60 * 60 * 1000;

  const existing = await ctx.db
    .query('privateNotifications')
    .withIndex('by_user_dedupe', (q) =>
      q.eq('userId', args.toUserId).eq('dedupeKey', dedupeKey)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      type: 'phase2_like',
      title,
      body,
      data,
      phase: 'phase2',
      createdAt: args.now,
      expiresAt,
    });
  } else {
    await ctx.db.insert('privateNotifications', {
      userId: args.toUserId,
      type: 'phase2_like',
      title,
      body,
      data,
      phase: 'phase2',
      dedupeKey,
      createdAt: args.now,
      expiresAt,
    });
  }

  if (args.push) {
    await dispatchPrivatePush(ctx, {
      userId: args.toUserId,
      type: 'phase2_like',
      title,
      body,
      data,
    });
  }
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
    .take(STAND_OUT_DAILY_LIMIT);
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

  const safePrivatePhotoUrls = await filterOwnedSafePrivatePhotoUrls(
    ctx,
    userId,
    profile.privatePhotoUrls ?? [],
  );
  if (safePrivatePhotoUrls.length < PHASE2_MIN_PRIVATE_PHOTOS) {
    return null;
  }
  const hasPrivatePhotos =
    (profile.privatePhotosBlurred?.length ?? 0) > 0 || safePrivatePhotoUrls.length > 0;

  return {
    userId,
    displayName,
    age: profile.age,
    gender: profile.gender,
    blurredPhotoUrl: safePrivatePhotoUrls[0] ?? null,
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
  if (!(await canDeepConnectInteract(ctx, viewerId, otherUserId))) return false;

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
  await assertCanDeepConnectInteract(ctx, receiverId, like.fromUserId);
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
  const receiverNotificationData = { otherUserId: args.senderId as string };
  const senderNotificationData = { otherUserId: args.receiverId as string };

  const receiverNotification = await createPhase2MatchNotificationIfMissing(ctx, {
    userId: args.receiverId,
    matchId: args.matchId,
    conversationId: args.conversationId,
    title: 'New Match! 🎉',
    body: `You matched with ${senderDisplayName} in Deep Connect!`,
    now: args.now,
    data: receiverNotificationData,
    push: false,
  });

  const senderNotification = await createPhase2MatchNotificationIfMissing(ctx, {
    userId: args.senderId,
    matchId: args.matchId,
    conversationId: args.conversationId,
    title: 'New Match! 🎉',
    body: `You matched with ${receiverDisplayName} in Deep Connect!`,
    now: args.now,
    data: senderNotificationData,
    push: false,
  });

  if (receiverNotification.inserted) {
    await dispatchPrivatePush(ctx, {
      userId: args.receiverId,
      type: 'phase2_match',
      title: 'New Match! 🎉',
      body: `You matched with ${senderDisplayName} in Deep Connect!`,
      data: {
        ...receiverNotificationData,
        matchId: args.matchId as string,
        privateConversationId: args.conversationId as string,
      },
    });
  }

  if (senderNotification.inserted) {
    await dispatchPrivatePush(ctx, {
      userId: args.senderId,
      type: 'phase2_match',
      title: 'New Match! 🎉',
      body: `You matched with ${receiverDisplayName} in Deep Connect!`,
      data: {
        ...senderNotificationData,
        matchId: args.matchId as string,
        privateConversationId: args.conversationId as string,
      },
    });
  }
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
    token: v.string(),
    authUserId: v.optional(v.string()),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { authUserId, toUserId, action, message, token } = args;
    const now = Date.now();

    const fromUserId = await requirePrivateSwipeActor(ctx, token, authUserId);

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

    await assertCanDeepConnectInteract(ctx, fromUserId, toUserId);

    // Check if already swiped (in Phase-2 privateLikes table)
    const existingLike = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', fromUserId).eq('toUserId', toUserId)
      )
      .first();

    // FIX 2: Idempotency safety - return success instead of throwing error
    if (existingLike) {
      if (action === 'super_like' && existingLike.action === 'like') {
        const toUser = await ctx.db.get(toUserId);
        if (!isPhase2UserEligible(toUser)) {
          throw new Error('Target user not available in Phase-2');
        }
        if (await isBlockedBidirectional(ctx, fromUserId, toUserId)) {
          throw new Error('Cannot like this user');
        }

        const normalizedStandOutMessage = normalizeStandOutMessage(message);
        await assertStandOutQuotaAvailable(ctx, fromUserId, now);

        const likePatch: {
          action: 'super_like';
          createdAt: number;
          message?: string;
        } = {
          action: 'super_like',
          createdAt: now,
        };
        if (normalizedStandOutMessage) {
          likePatch.message = normalizedStandOutMessage;
        }
        await ctx.db.patch(existingLike._id, likePatch);

        const { user1Id, user2Id } = getPhase2UserPair(fromUserId, toUserId);
        const existingMatch = await ctx.db
          .query('privateMatches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .first();

        if (existingMatch?.isActive === true) {
          if (existingMatch.matchSource !== 'super_like') {
            await ctx.db.patch(existingMatch._id, { matchSource: 'super_like' });
          }

          const ensured = await ensurePhase2MatchAndConversation(ctx, {
            userAId: fromUserId,
            userBId: toUserId,
            now,
            source: 'deep_connect',
            matchKind: 'super_like',
            connectionSource: 'desire_super_like',
          });

          const existingConversation = await ctx.db.get(ensured.conversationId);
          if (existingConversation?.connectionSource !== 'desire_super_like') {
            await ctx.db.patch(ensured.conversationId, {
              connectionSource: 'desire_super_like',
            });
          }

          if (normalizedStandOutMessage) {
            await insertStandOutTextMessageIfMissing(ctx, {
              conversationId: ensured.conversationId,
              senderId: fromUserId,
              recipientId: toUserId,
              content: normalizedStandOutMessage,
              createdAt: now,
              clientMessageId: `standout:${existingLike._id}:upgrade`,
            });
          }

          return {
            success: true,
            isMatch: true,
            matchId: ensured.matchId,
            conversationId: ensured.conversationId,
            alreadyMatched: true,
            alreadySent: true,
            upgradedToStandOut: true,
            likeId: existingLike._id,
            existingAction: 'like',
            action: 'super_like',
            source: ensured.source,
          };
        }

        await upsertPhase2LikeNotificationForAction(ctx, {
          fromUserId,
          toUserId,
          likeId: existingLike._id,
          action: 'super_like',
          now,
          push: true,
        });

        return {
          success: true,
          isMatch: false,
          alreadyMatched: false,
          alreadySent: true,
          upgradedToStandOut: true,
          likeId: existingLike._id,
          existingAction: 'like',
          action: 'super_like',
          source: 'deep_connect',
        };
      }

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

        const matchId = ensured.matchId;
        const conversationId = ensured.conversationId;

        if (ensured.alreadyMatched) {
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

        // Notify both users only after match, conversation, participants, and
        // any seeded Stand Out message have been written.
        await createStandOutMatchNotifications(ctx, {
          senderId: fromUserId,
          receiverId: toUserId,
          matchId,
          conversationId,
          now,
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
        // NO RECIPROCAL LIKE YET - send "someone liked you" notification.
        // This is the pending like state; match is created when the other user likes back.
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
    token: v.string(),
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, token, refreshKey } = args;
    const limit = normalizePrivateSwipeLimit(args.limit);
    void refreshKey;

    const viewerId = await requirePrivateSwipeActor(ctx, token, authUserId);

    const viewer = await ctx.db.get(viewerId);
    if (!isPhase2UserEligible(viewer)) {
      return [];
    }

    const fetchWindow = Math.min(Math.max(limit * 4, limit + 30), MAX_STAND_OUT_LIST_FETCH_WINDOW);
    const likes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_action_createdAt', (q) =>
        q.eq('toUserId', viewerId).eq('action', 'super_like')
      )
      .order('desc')
      .take(fetchWindow);

    const rows = [];
    for (const like of sortPrivateLikesNewestFirst(likes)) {
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
    token: v.string(),
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, token, refreshKey } = args;
    const limit = normalizePrivateSwipeLimit(args.limit);
    void refreshKey;

    const viewerId = await requirePrivateSwipeActor(ctx, token, authUserId);

    const viewer = await ctx.db.get(viewerId);
    if (!isPhase2UserEligible(viewer)) {
      return [];
    }

    const fetchWindow = Math.min(Math.max(limit * 4, limit + 30), MAX_STAND_OUT_LIST_FETCH_WINDOW);
    const likes = await ctx.db
      .query('privateLikes')
      .withIndex('by_from_action_createdAt', (q) =>
        q.eq('fromUserId', viewerId).eq('action', 'super_like')
      )
      .order('desc')
      .take(fetchWindow);

    const rows = [];
    for (const like of sortPrivateLikesNewestFirst(likes)) {
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
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
        .order('desc')
        .take(MAX_STAND_OUT_COUNT_SCAN),
      ctx.db
        .query('privateLikes')
        .withIndex('by_from_action_createdAt', (q) =>
          q.eq('fromUserId', viewerId).eq('action', 'super_like')
        )
        .order('desc')
        .take(MAX_STAND_OUT_COUNT_SCAN),
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
    token: v.string(),
    authUserId: v.optional(v.string()),
    likeId: v.id('privateLikes'),
  },
  handler: async (ctx, args) => {
    const receiverId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
    token: v.string(),
    authUserId: v.optional(v.string()),
    likeId: v.id('privateLikes'),
    replyText: v.string(),
  },
  handler: async (ctx, args) => {
    const receiverId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
    token: v.string(),
    authUserId: v.optional(v.string()),
    likeId: v.id('privateLikes'),
  },
  handler: async (ctx, args) => {
    const receiverId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
    token: v.string(),
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { limit = 50 } = args;

    const userId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
    token: v.string(),
    authUserId: v.optional(v.string()),
    toUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { toUserId } = args;

    const fromUserId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

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
    token: v.string(),
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, token, refreshKey } = args;
    const limit = normalizePrivateSwipeLimit(args.limit);
    void refreshKey;

    const userId = await requirePrivateSwipeActor(ctx, token, authUserId);

    // Get all likes TO the current user
    const fetchWindow = Math.min(Math.max(limit * 3, limit + 20), MAX_INCOMING_LIKE_LIST_FETCH_WINDOW);
    const incomingLikes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .order('desc')
      .take(fetchWindow);

    // Filter to only likes/super_likes (not passes), and exclude already matched.
    // Overfetching keeps the visible pending set more complete when recent rows
    // include passes or reciprocal likes that should be filtered out.
    const pendingLikes = await Promise.all(sortPrivateLikesNewestFirst(incomingLikes).map(async (like) => {
      if (like.action !== 'like' && like.action !== 'super_like') {
        return null;
      }
      if (await isIncomingLikeHiddenBySafety(ctx, userId, like.fromUserId)) {
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
      const safePrivatePhotoUrls = await filterOwnedSafePrivatePhotoUrls(
        ctx,
        like.fromUserId,
        likerProfile.privatePhotoUrls ?? [],
      );
      const hasPrivatePhotos =
        (likerProfile.privatePhotosBlurred?.length ?? 0) > 0 ||
        safePrivatePhotoUrls.length > 0;

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
          blurredPhotoUrl: safePrivatePhotoUrls[0] ?? null,
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
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateSwipeActor(ctx, args.token, args.authUserId);

    // Get all likes TO the current user
    const incomingLikes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .order('desc')
      .take(MAX_INCOMING_LIKE_COUNT_SCAN);

    let count = 0;
    for (const like of incomingLikes) {
      if (like.action !== 'like' && like.action !== 'super_like') continue;
      if (await isIncomingLikeHiddenBySafety(ctx, userId, like.fromUserId)) continue;

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
    token: v.string(),
    authUserId: v.optional(v.string()),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, args) => {
    const { authUserId, token, conversationId } = args;

    const userId = await requirePrivateSwipeActor(ctx, token, authUserId);

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
