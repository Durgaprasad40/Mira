import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Like, pass, or super like a user
export const swipe = mutation({
  args: {
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like'), v.literal('text')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { fromUserId, toUserId, action, message } = args;
    const now = Date.now();

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
      await ctx.db.insert('notifications', {
        userId: toUserId,
        type: 'message',
        title: 'New Direct Message!',
        body: `${fromUser.name} sent you a message`,
        data: { conversationId: conversationId },
        createdAt: now,
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

      const isReciprocal = reciprocalLike && (
        reciprocalLike.action === 'like' ||
        reciprocalLike.action === 'super_like' ||
        reciprocalLike.action === 'text'
      );

      if (isReciprocal) {
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
        const matchId = await ctx.db.insert('matches', {
          user1Id,
          user2Id,
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
export const getLikesReceived = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;

    const user = await ctx.db.get(userId);
    if (!user) return [];

    // TODO: Subscription restrictions disabled for testing mode.
    // All users can see who liked them during testing.
    const canSee = true;

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
