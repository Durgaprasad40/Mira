/**
 * Phase-2 Private Mode Swipes (Desire Land)
 *
 * STRICT ISOLATION: This file handles ALL Phase-2 swipe/match logic.
 * Phase-2 NEVER writes to Phase-1 tables (likes, matches, conversations).
 * Phase-2 uses ONLY: privateLikes, privateMatches, privateConversations, privateMessages.
 */

import { v } from 'convex/values';
import { mutation, query, MutationCtx, QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { validateSessionToken, resolveUserIdByAuthId } from './helpers';

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
    token: v.string(),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, toUserId, action, message } = args;
    const now = Date.now();

    // Validate session and get current user
    const fromUserId = await validateSessionToken(ctx, token);
    if (!fromUserId) {
      throw new Error('Unauthorized: invalid or expired session');
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
      return { success: true, isMatch: false };
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
        // Ordered pair for match (user1Id < user2Id)
        const user1Id = fromUserId < toUserId ? fromUserId : toUserId;
        const user2Id = fromUserId < toUserId ? toUserId : fromUserId;

        // Check if match already exists (race condition protection)
        const existingMatch = await ctx.db
          .query('privateMatches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .first();

        if (existingMatch) {
          // Match already exists
          return { success: true, isMatch: true, matchId: existingMatch._id };
        }

        // Determine match source
        const reciprocalAction = reciprocalLike.action;
        const isSuperLikeMatch = action === 'super_like' || reciprocalAction === 'super_like';

        // Create match in privateMatches (Phase-2 table)
        const matchId = await ctx.db.insert('privateMatches', {
          user1Id,
          user2Id,
          matchedAt: now,
          isActive: true,
          matchSource: isSuperLikeMatch ? 'super_like' : 'like',
        });

        // Race condition protection: verify we're the winner
        const allMatches = await ctx.db
          .query('privateMatches')
          .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
          .collect();

        if (allMatches.length > 1) {
          // Duplicates detected - determine winner by _id
          allMatches.sort((a, b) => a._id.localeCompare(b._id));
          const winnerMatchId = allMatches[0]._id;

          if (matchId !== winnerMatchId) {
            // Our match lost the race - delete it
            await ctx.db.delete(matchId);
            return { success: true, isMatch: true, matchId: winnerMatchId };
          }

          // We are the winner - delete duplicates
          for (let i = 1; i < allMatches.length; i++) {
            await ctx.db.delete(allMatches[i]._id);
          }
        }

        // ONE-PAIR-ONE-THREAD: Check if conversation already exists for this pair
        // This prevents duplicate threads when T/D or other paths already created one
        const sortedParticipants = [fromUserId, toUserId].sort() as [Id<'users'>, Id<'users'>];

        // Query for existing conversation using participant lookup
        const fromUserConvos = await ctx.db
          .query('privateConversationParticipants')
          .withIndex('by_user', (q) => q.eq('userId', fromUserId))
          .collect();

        let existingConversationId: Id<'privateConversations'> | null = null;
        for (const pc of fromUserConvos) {
          const toUserInConvo = await ctx.db
            .query('privateConversationParticipants')
            .withIndex('by_user_conversation', (q) =>
              q.eq('userId', toUserId).eq('conversationId', pc.conversationId)
            )
            .first();
          if (toUserInConvo) {
            existingConversationId = pc.conversationId;
            break;
          }
        }

        let conversationId: Id<'privateConversations'>;
        let conversationCreated = false;

        if (existingConversationId) {
          // Reuse existing conversation, update matchId if needed
          conversationId = existingConversationId;
          const existingConvo = await ctx.db.get(existingConversationId);
          if (existingConvo && !existingConvo.matchId) {
            // Link match to existing conversation (e.g., T/D conversation now has a match)
            await ctx.db.patch(existingConversationId, { matchId });
          }
          console.log('[PRIVATE_SWIPE] Reusing existing conversation for pair:', conversationId);
        } else {
          // Create Phase-2 conversation
          conversationId = await ctx.db.insert('privateConversations', {
            matchId,
            participants: sortedParticipants,
            isPreMatch: false,
            createdAt: now,
            connectionSource: isSuperLikeMatch ? 'desire_super_like' : 'desire_match',
          });
          conversationCreated = true;

          // Create conversation participants for efficient queries
          await ctx.db.insert('privateConversationParticipants', {
            conversationId,
            userId: fromUserId,
            unreadCount: 0,
          });
          await ctx.db.insert('privateConversationParticipants', {
            conversationId,
            userId: toUserId,
            unreadCount: 0,
          });

          // RACE CONDITION PROTECTION: Check for duplicate conversations
          const allPairConvos = await ctx.db
            .query('privateConversations')
            .filter((q) =>
              q.eq(q.field('participants'), sortedParticipants)
            )
            .collect();

          if (allPairConvos.length > 1) {
            // Duplicates detected - keep the one with lowest _id (deterministic winner)
            allPairConvos.sort((a, b) => a._id.localeCompare(b._id));
            const winnerConvoId = allPairConvos[0]._id;

            if (conversationId !== winnerConvoId) {
              // Our conversation lost - delete it and its participants, use winner
              const ourParticipants = await ctx.db
                .query('privateConversationParticipants')
                .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
                .collect();
              for (const p of ourParticipants) {
                await ctx.db.delete(p._id);
              }
              await ctx.db.delete(conversationId);
              conversationId = winnerConvoId;
              console.log('[PRIVATE_SWIPE] Lost race, using winner conversation:', winnerConvoId);
            } else {
              // We won - delete duplicates
              for (let i = 1; i < allPairConvos.length; i++) {
                const dupeConvo = allPairConvos[i];
                const dupeParticipants = await ctx.db
                  .query('privateConversationParticipants')
                  .withIndex('by_conversation', (q) => q.eq('conversationId', dupeConvo._id))
                  .collect();
                for (const p of dupeParticipants) {
                  await ctx.db.delete(p._id);
                }
                await ctx.db.delete(dupeConvo._id);
              }
              console.log('[PRIVATE_SWIPE] Won race, deleted', allPairConvos.length - 1, 'duplicates');
            }
          } else {
            console.log('[PRIVATE_SWIPE] Created new conversation for pair:', conversationId);
          }
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

        // Create match notifications for both users
        // Get display names for notifications
        const fromProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', fromUserId))
          .first();
        const toProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', toUserId))
          .first();

        const fromDisplayName = fromProfile?.displayName || 'Someone';
        const toDisplayName = toProfile?.displayName || 'Someone';

        // Notify the other user (toUser) about the match
        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'match',
          title: 'New Match! 🎉',
          body: `You matched with ${fromDisplayName} in Desire Land!`,
          data: { matchId: matchId as string, conversationId: conversationId as string },
          dedupeKey: `p2_match:${matchId}:${toUserId}`,
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        // Notify the current user (fromUser) about the match
        await ctx.db.insert('notifications', {
          userId: fromUserId,
          type: 'match',
          title: 'New Match! 🎉',
          body: `You matched with ${toDisplayName} in Desire Land!`,
          data: { matchId: matchId as string, conversationId: conversationId as string },
          dedupeKey: `p2_match:${matchId}:${fromUserId}`,
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        return { success: true, isMatch: true, matchId, conversationId };
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
        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'like',
          title: action === 'super_like' ? 'Someone super liked you! ⭐' : 'Someone liked you! 💜',
          body: 'Check your likes in Desire Land to see who!',
          data: { likeType: action },
          dedupeKey: `p2_like:${fromUserId}:${toUserId}`,
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
        });
      }
    }

    return { success: true, isMatch: false };
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
 */
export const getIncomingLikes = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;

    // Get all likes TO the current user
    const incomingLikes = await ctx.db
      .query('privateLikes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .order('desc')
      .take(limit);

    // Filter to only likes/super_likes (not passes), and exclude already matched
    const pendingLikes = [];
    for (const like of incomingLikes) {
      if (like.action !== 'like' && like.action !== 'super_like') continue;

      // Check if current user has already liked them back (would be matched)
      const reciprocalLike = await ctx.db
        .query('privateLikes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', like.fromUserId)
        )
        .first();

      // If user hasn't swiped on them yet, it's a pending like
      if (!reciprocalLike) {
        // Get liker's profile info
        const likerProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', like.fromUserId))
          .first();

        if (likerProfile) {
          pendingLikes.push({
            likeId: like._id,
            fromUserId: like.fromUserId,
            action: like.action,
            createdAt: like.createdAt,
            message: like.message,
            // Profile preview (blurred until they swipe back)
            // displayName is the Phase-2 nickname (user-chosen display identity)
            profile: {
              displayName: likerProfile.displayName,
              age: likerProfile.age,
              gender: likerProfile.gender,
              city: likerProfile.city,
              blurredPhotoUrl: likerProfile.privatePhotoUrls?.[0],
            },
          });
        }
      }
    }

    return pendingLikes;
  },
});

/**
 * Get count of pending incoming likes (for badge)
 */
export const getIncomingLikesCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

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
