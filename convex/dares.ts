/**
 * LEGACY DARE V1
 * Not part of the active Phase-2 Truth or Dare tab flow.
 * Retained because the older chat-driven dare route is still reachable elsewhere.
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId } from './helpers';

// Send a dare to a user (Truth or Dare feature)
// TOD-002 FIX: Auth hardening - verify caller identity server-side
export const sendDare = mutation({
  args: {
    authUserId: v.string(), // TOD-002: Auth verification required
    toUserId: v.id('users'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // TOD-002 FIX: Verify caller identity
    const { authUserId, toUserId, content } = args;
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const fromUserId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!fromUserId) {
      throw new Error('Unauthorized: user not found');
    }

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
// TOD-P1-002 FIX: Server-side auth - verify caller matches requested userId
export const getPendingDares = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // TOD-P1-002 FIX: Server-side auth verification
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const callerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (callerUserId !== userId) {
        return []; // Caller is not authorized to view this user's dares
      }
    }

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
// TOD-P1-002 FIX: Server-side auth - verify caller matches requested userId
export const getDaresSent = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // TOD-P1-002 FIX: Server-side auth verification
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const callerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
      if (callerUserId !== userId) {
        return []; // Caller is not authorized to view this user's dares
      }
    }

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
// TOD-002 FIX: Auth hardening - verify caller is the dare recipient
export const acceptDare = mutation({
  args: {
    dareId: v.id('dares'),
    authUserId: v.string(), // TOD-002: Auth verification required
  },
  handler: async (ctx, args) => {
    // TOD-002 FIX: Verify caller identity
    const { dareId, authUserId } = args;
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();

    const dare = await ctx.db.get(dareId);
    if (!dare) {
      throw new Error('Dare not found');
    }

    // TOD-002 FIX: Verify caller is the dare recipient
    if (dare.toUserId !== userId) {
      throw new Error('Unauthorized: only the dare recipient can accept');
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
// TOD-002 FIX: Auth hardening - verify caller is the dare recipient
export const declineDare = mutation({
  args: {
    dareId: v.id('dares'),
    authUserId: v.string(), // TOD-002: Auth verification required
  },
  handler: async (ctx, args) => {
    // TOD-002 FIX: Verify caller identity
    const { dareId, authUserId } = args;
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const dare = await ctx.db.get(dareId);
    if (!dare) {
      throw new Error('Dare not found');
    }

    // TOD-002 FIX: Verify caller is the dare recipient
    if (dare.toUserId !== userId) {
      throw new Error('Unauthorized: only the dare recipient can decline');
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
