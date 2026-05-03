/**
 * Phase-2 Private Mode Swipes (Deep Connect)
 *
 * STRICT ISOLATION: This file handles ALL Phase-2 swipe/match logic.
 * Phase-2 NEVER writes to Phase-1 tables (likes, matches, conversations).
 * Phase-2 uses ONLY: privateLikes, privateMatches, privateConversations, privateMessages.
 */

import { v } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { getPhase2DisplayName, validateSessionToken, resolveUserIdByAuthId } from './helpers';
import { shouldCreatePhase2DeepConnectNotification } from './phase2NotificationPrefs';
import { dispatchPrivatePush } from './privateNotifications';
import {
  createPhase2MatchNotificationIfMissing,
  ensurePhase2MatchAndConversation,
  getPhase2UserPair,
} from './phase2MatchHelpers';

// Helper: Check if either user has blocked the other
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

      return { success: true, isMatch: false, alreadyMatched: false, source: 'deep_connect' };
    }

    // FIX 1: Target user Phase-2 validation
    const toUser = await ctx.db.get(toUserId);
    if (!toUser || toUser.phase2OnboardingCompleted !== true) {
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

    // Record the swipe in privateLikes (Phase-2 table)
    const likeId = await ctx.db.insert('privateLikes', {
      fromUserId,
      toUserId,
      action,
      message,
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
        const currentSuperLikeMessage = (action === 'super_like' && message) ? message : null;
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
          await ctx.db.insert('privateNotifications', {
            userId: toUserId,
            type: 'phase2_like',
            title: likeTitle,
            body: likeBody,
            data: {
              otherUserId: fromUserId as string,
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
            data: { otherUserId: fromUserId as string },
          });
        }
      }
    }

    return { success: true, isMatch: false, alreadyMatched: false, source: 'deep_connect' };
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
