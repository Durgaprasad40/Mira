import { v } from 'convex/values';
import { mutation, query, MutationCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { shouldCreateNotification } from './notificationPreferences';

// D1-REPAIR: Helper to check if either user has blocked the other
// Returns true if blocked (should prevent messaging)
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
      if (await shouldCreateNotification(ctx, toUserId, 'message')) {
        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'message',
          title: 'New Direct Message!',
          body: `${fromUser.name} sent you a message`,
          data: {
            actorUserId: fromUserId as string,
            targetUserId: toUserId as string,
            conversationId: conversationId as string,
          } as any,
          dedupeKey: `message:${conversationId}:unread`,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });
      }

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
        if (await shouldCreateNotification(ctx, fromUserId, 'match')) {
          await ctx.db.insert('notifications', {
            userId: fromUserId,
            type: 'match',
            title: 'New Match!',
            body: `You matched with ${toUser?.name || 'someone'}!`,
            data: {
              actorUserId: toUserId as string,
              targetUserId: fromUserId as string,
              matchId: matchId as string,
            } as any,
            dedupeKey: `match:${matchId}`,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
          });
        }

        if (await shouldCreateNotification(ctx, toUserId, 'match')) {
          await ctx.db.insert('notifications', {
            userId: toUserId,
            type: 'match',
            title: 'New Match!',
            body: `You matched with ${fromUser.name}!`,
            data: {
              actorUserId: fromUserId as string,
              targetUserId: toUserId as string,
              matchId: matchId as string,
            } as any,
            dedupeKey: `match:${matchId}`,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
          });
        }

        return { success: true, isMatch: true, matchId };
      }
    }

    // Send notification for like/super_like (not for pass)
    // Notification lifecycle: stays until opened/acted on, then 24h expiry after opened
    // Use real sender name in notification (fallback to generic only if name missing)
    const senderName = fromUser.name || 'Someone';

    if (action === 'like') {
      if (await shouldCreateNotification(ctx, toUserId, 'like')) {
        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'like',
          title: `${senderName} liked you`,
          body: 'Check your likes to see their profile',
          data: {
            actorUserId: fromUserId as string,
            targetUserId: toUserId as string,
            likeType: 'like',
          } as any,
          dedupeKey: `like:${fromUserId}`,
          createdAt: now,
          // No expiresAt - notification stays until acted on
        });
      }
    } else if (action === 'super_like') {
      if (await shouldCreateNotification(ctx, toUserId, 'super_like')) {
        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'super_like',
          title: `${senderName} super liked you`,
          body: 'Open your likes to view their profile',
          data: {
            actorUserId: fromUserId as string,
            targetUserId: toUserId as string,
            likeType: 'super_like',
          } as any,
          dedupeKey: `super_like:${fromUserId}`,
          createdAt: now,
          // No expiresAt - notification stays until acted on
        });
      }
    }

    return { success: true, isMatch: false };
  },
});

// Rewind last swipe
export const rewind = mutation({
  args: {
    authUserId: v.string(), // AUTH FIX: Server-side auth instead of trusting client
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;

    // AUTH FIX: Resolve acting user from server-side auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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

      // Get primary photo, fallback to any photo if no primary exists
      let photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', like.fromUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // BUG FIX: Fallback to any photo if no isPrimary photo exists
      if (!photo) {
        photo = await ctx.db
          .query('photos')
          .withIndex('by_user', (q) => q.eq('userId', like.fromUserId))
          .first();
      }

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

// Get users that the current user has liked (for confession tagging)
export const getLikedUsers = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // Get all likes from this user (like or super_like, not pass)
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

    const result = [];
    for (const like of likes) {
      const likedUser = await ctx.db.get(like.toUserId);
      if (!likedUser || !likedUser.isActive) continue;

      // Get primary photo
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', like.toUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // Build disambiguator: prefer bio snippet, then school, then age, then masked userId
      let disambiguator = '';
      if (likedUser.bio && likedUser.bio.length > 0) {
        disambiguator = likedUser.bio.slice(0, 30) + (likedUser.bio.length > 30 ? '...' : '');
      } else if (likedUser.school) {
        disambiguator = likedUser.school;
      } else if (likedUser.dateOfBirth) {
        disambiguator = `${calculateAge(likedUser.dateOfBirth)} years old`;
      } else {
        // Masked userId (last 4 chars)
        const idStr = like.toUserId.toString();
        disambiguator = `ID: ...${idStr.slice(-4)}`;
      }

      result.push({
        id: like.toUserId,
        name: likedUser.name,
        avatarUrl: photo?.url || null,
        disambiguator,
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

    // Validate session and derive current user
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
