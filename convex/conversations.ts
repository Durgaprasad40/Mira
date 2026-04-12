import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';

/**
 * Ensure a conversation exists for a given match.
 * If one already exists (via the by_match index), return it.
 * Otherwise create a new post-match conversation.
 *
 * This is safe to call multiple times — it is idempotent.
 * MSG-005 FIX: Auth hardening - verify caller identity server-side
 */
export const getOrCreateForMatch = mutation({
  args: {
    matchId: v.id('matches'),
    authUserId: v.string(), // MSG-005: Auth verification required
  },
  handler: async (ctx, args) => {
    const { matchId, authUserId } = args;

    // MSG-005 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const match = await ctx.db.get(matchId);
    if (!match || !match.isActive) {
      throw new Error('Match not found or inactive');
    }

    // Verify caller is part of this match
    if (match.user1Id !== userId && match.user2Id !== userId) {
      throw new Error('Not authorized');
    }

    // Look for existing conversation
    const existing = await ctx.db
      .query('conversations')
      .withIndex('by_match', (q) => q.eq('matchId', matchId))
      .first();

    if (existing) {
      return { conversationId: existing._id };
    }

    // Create conversation
    const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
    const conversationId = await ctx.db.insert('conversations', {
      matchId,
      participants: [userId, otherUserId],
      isPreMatch: false,
      createdAt: Date.now(),
    });

    return { conversationId };
  },
});
