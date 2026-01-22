import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Like, pass, or super like a user
export const swipe = mutation({
  args: {
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { fromUserId, toUserId, action, message } = args;
    const now = Date.now();

    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');

    // Check usage limits for men
    if (fromUser.gender === 'male') {
      // Reset daily likes if needed
      if (now >= fromUser.likesResetAt) {
        const newLikes = fromUser.subscriptionTier === 'free' ? 50 : 999999;
        await ctx.db.patch(fromUserId, {
          likesRemaining: newLikes,
          likesResetAt: now + 24 * 60 * 60 * 1000,
        });
        fromUser.likesRemaining = newLikes;
      }

      // Reset weekly super likes if needed
      if (now >= fromUser.superLikesResetAt) {
        let newSuperLikes = 0;
        if (fromUser.subscriptionTier === 'basic') newSuperLikes = 5;
        else if (fromUser.subscriptionTier === 'premium') newSuperLikes = 999999;
        else if (fromUser.trialEndsAt && now < fromUser.trialEndsAt) newSuperLikes = 1;

        await ctx.db.patch(fromUserId, {
          superLikesRemaining: newSuperLikes,
          superLikesResetAt: now + 7 * 24 * 60 * 60 * 1000,
        });
        fromUser.superLikesRemaining = newSuperLikes;
      }

      // Check limits
      if (action === 'like' || action === 'pass') {
        if (fromUser.likesRemaining <= 0) {
          throw new Error('No swipes remaining today');
        }
      }

      if (action === 'super_like') {
        if (fromUser.superLikesRemaining <= 0) {
          throw new Error('No super likes remaining');
        }
      }
    }

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

    // Record the like
    await ctx.db.insert('likes', {
      fromUserId,
      toUserId,
      action,
      message,
      createdAt: now,
    });

    // Update usage count for men
    if (fromUser.gender === 'male') {
      if (action === 'like' || action === 'pass') {
        await ctx.db.patch(fromUserId, {
          likesRemaining: fromUser.likesRemaining - 1,
        });
      }
      if (action === 'super_like') {
        await ctx.db.patch(fromUserId, {
          superLikesRemaining: fromUser.superLikesRemaining - 1,
        });
      }
    }

    // Check for match (only on like or super_like)
    if (action === 'like' || action === 'super_like') {
      const reciprocalLike = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', toUserId).eq('toUserId', fromUserId)
        )
        .first();

      if (reciprocalLike && (reciprocalLike.action === 'like' || reciprocalLike.action === 'super_like')) {
        // It's a match!
        const matchId = await ctx.db.insert('matches', {
          user1Id: fromUserId < toUserId ? fromUserId : toUserId,
          user2Id: fromUserId < toUserId ? toUserId : fromUserId,
          matchedAt: now,
          isActive: true,
        });

        // Create conversation
        await ctx.db.insert('conversations', {
          matchId,
          participants: [fromUserId, toUserId],
          isPreMatch: false,
          createdAt: now,
        });

        // Create notifications for both users
        const toUser = await ctx.db.get(toUserId);
        await ctx.db.insert('notifications', {
          userId: fromUserId,
          type: 'match',
          title: 'New Match!',
          body: `You matched with ${toUser?.name || 'someone'}!`,
          data: { matchId: matchId },
          createdAt: now,
        });

        await ctx.db.insert('notifications', {
          userId: toUserId,
          type: 'match',
          title: 'New Match!',
          body: `You matched with ${fromUser.name}!`,
          data: { matchId: matchId },
          createdAt: now,
        });

        return { success: true, isMatch: true, matchId };
      }
    }

    // Send notification for super like
    if (action === 'super_like') {
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'super_like',
        title: 'You got a Super Like!',
        body: 'Someone super liked you!',
        data: { userId: fromUserId },
        createdAt: now,
      });
    }

    return { success: true, isMatch: false };
  },
});

// Rewind last swipe
export const rewind = mutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // Check if user can rewind
    if (user.gender === 'male') {
      if (user.subscriptionTier === 'free') {
        throw new Error('Upgrade to rewind swipes');
      }
      if (user.rewindsRemaining <= 0) {
        throw new Error('No rewinds remaining');
      }
    }

    // Get the last like
    const lastLike = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .order('desc')
      .first();

    if (!lastLike) {
      throw new Error('No swipe to rewind');
    }

    // Can only rewind within 5 seconds (or any time for premium)
    const canRewind =
      user.subscriptionTier === 'premium' ||
      Date.now() - lastLike.createdAt < 5000;

    if (!canRewind) {
      throw new Error('Too late to rewind');
    }

    // Delete the like
    await ctx.db.delete(lastLike._id);

    // Restore usage count
    if (user.gender === 'male') {
      if (lastLike.action === 'super_like') {
        await ctx.db.patch(userId, {
          superLikesRemaining: user.superLikesRemaining + 1,
          rewindsRemaining: user.rewindsRemaining - 1,
        });
      } else {
        await ctx.db.patch(userId, {
          likesRemaining: user.likesRemaining + 1,
          rewindsRemaining: user.rewindsRemaining - 1,
        });
      }
    }

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
export const getLikesReceived = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;

    const user = await ctx.db.get(userId);
    if (!user) return [];

    // Check if user can see who liked them
    const canSee =
      user.gender === 'female' ||
      user.subscriptionTier === 'basic' ||
      user.subscriptionTier === 'premium';

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

    // Check which ones are already matched
    const result = [];
    for (const like of likes) {
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

      // Get primary photo
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', like.fromUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      result.push({
        likeId: like._id,
        userId: like.fromUserId,
        action: like.action,
        message: like.message,
        createdAt: like.createdAt,
        // Only show details if user can see
        name: canSee ? fromUser.name : undefined,
        age: canSee ? calculateAge(fromUser.dateOfBirth) : undefined,
        photoUrl: canSee ? photo?.url : undefined,
        isBlurred: !canSee,
      });
    }

    return result;
  },
});

// Get like count
export const getLikeCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field('action'), 'like'),
          q.eq(q.field('action'), 'super_like')
        )
      )
      .collect();

    // Filter out already swiped
    let count = 0;
    for (const like of likes) {
      const alreadySwiped = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', args.userId).eq('toUserId', like.fromUserId)
        )
        .first();

      if (!alreadySwiped) count++;
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

// Helper function
function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
