import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Send a dare to a user (Truth or Dare feature)
export const sendDare = mutation({
  args: {
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { fromUserId, toUserId, content } = args;
    const now = Date.now();

    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');

    const toUser = await ctx.db.get(toUserId);
    if (!toUser || !toUser.isActive) throw new Error('User not found');

    // Check if already sent a dare to this user
    const existingDare = await ctx.db
      .query('dares')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', fromUserId))
      .filter((q) =>
        q.and(
          q.eq(q.field('toUserId'), toUserId),
          q.eq(q.field('isAccepted'), undefined)
        )
      )
      .first();

    if (existingDare) {
      throw new Error('You already have a pending dare with this user');
    }

    // Create dare
    const dareId = await ctx.db.insert('dares', {
      fromUserId,
      toUserId,
      content,
      createdAt: now,
    });

    // Send notification (anonymously)
    await ctx.db.insert('notifications', {
      userId: toUserId,
      type: 'message', // Generic to keep it anonymous
      title: 'New Dare Received!',
      body: 'Someone sent you a dare. Accept to reveal who!',
      createdAt: now,
    });

    return { success: true, dareId };
  },
});

// Get pending dares received
export const getPendingDares = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const dares = await ctx.db
      .query('dares')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('isAccepted'), undefined))
      .collect();

    // Don't reveal who sent the dare
    return dares.map((dare) => ({
      id: dare._id,
      content: dare.content,
      createdAt: dare.createdAt,
    }));
  },
});

// Get dares sent by user
export const getDaresSent = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const dares = await ctx.db
      .query('dares')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .order('desc')
      .take(50);

    const result = [];
    for (const dare of dares) {
      const toUser = await ctx.db.get(dare.toUserId);
      result.push({
        id: dare._id,
        content: dare.content,
        isAccepted: dare.isAccepted,
        respondedAt: dare.respondedAt,
        createdAt: dare.createdAt,
        // Only show user info if accepted
        toUser: dare.isAccepted && toUser
          ? {
              id: toUser._id,
              name: toUser.name,
            }
          : null,
      });
    }

    return result;
  },
});

// Accept a dare (reveals identities and creates match)
export const acceptDare = mutation({
  args: {
    dareId: v.id('dares'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { dareId, userId } = args;
    const now = Date.now();

    const dare = await ctx.db.get(dareId);
    if (!dare || dare.toUserId !== userId) {
      throw new Error('Dare not found');
    }

    if (dare.isAccepted !== undefined) {
      throw new Error('Dare already responded to');
    }

    // Mark as accepted
    await ctx.db.patch(dareId, {
      isAccepted: true,
      respondedAt: now,
    });

    const fromUser = await ctx.db.get(dare.fromUserId);
    const toUser = await ctx.db.get(dare.toUserId);

    if (!fromUser || !toUser) {
      throw new Error('User not found');
    }

    // Create a match!
    const user1Id = dare.fromUserId < dare.toUserId ? dare.fromUserId : dare.toUserId;
    const user2Id = dare.fromUserId < dare.toUserId ? dare.toUserId : dare.fromUserId;

    // Check if match already exists
    let match = await ctx.db
      .query('matches')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', user1Id).eq('user2Id', user2Id)
      )
      .first();

    if (!match) {
      const matchId = await ctx.db.insert('matches', {
        user1Id,
        user2Id,
        matchedAt: now,
        isActive: true,
      });
      match = await ctx.db.get(matchId);

      // Create conversation
      await ctx.db.insert('conversations', {
        matchId,
        participants: [dare.fromUserId, dare.toUserId],
        isPreMatch: false,
        createdAt: now,
      });
    }

    // Notify the dare sender
    await ctx.db.insert('notifications', {
      userId: dare.fromUserId,
      type: 'match',
      title: 'Dare Accepted!',
      body: `${toUser.name} accepted your dare! It's a match!`,
      data: { matchId: match?._id },
      createdAt: now,
    });

    return {
      success: true,
      isMatch: true,
      matchId: match?._id,
      fromUser: {
        id: fromUser._id,
        name: fromUser.name,
      },
    };
  },
});

// Decline a dare
export const declineDare = mutation({
  args: {
    dareId: v.id('dares'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { dareId, userId } = args;

    const dare = await ctx.db.get(dareId);
    if (!dare || dare.toUserId !== userId) {
      throw new Error('Dare not found');
    }

    if (dare.isAccepted !== undefined) {
      throw new Error('Dare already responded to');
    }

    // Mark as declined
    await ctx.db.patch(dareId, {
      isAccepted: false,
      respondedAt: Date.now(),
    });

    // Don't notify sender about decline to keep it anonymous

    return { success: true };
  },
});

// Get dare count (for badge)
export const getDareCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const dares = await ctx.db
      .query('dares')
      .withIndex('by_to_user', (q) => q.eq('toUserId', args.userId))
      .filter((q) => q.eq(q.field('isAccepted'), undefined))
      .collect();

    return dares.length;
  },
});
