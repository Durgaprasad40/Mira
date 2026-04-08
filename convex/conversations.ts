import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { requireLiveMessageSessionUser } from './helpers';

/**
 * Ensure a conversation exists for a given match.
 * If one already exists (via the by_match index), return it.
 * Otherwise create a new post-match conversation.
 *
 * This is safe to call multiple times — it is idempotent.
 * Live Phase-1 chat creation is authorized strictly via validated session token.
 */
export const getOrCreateForMatch = mutation({
  args: {
    matchId: v.id('matches'),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { matchId, token } = args;
    const userId = await requireLiveMessageSessionUser(ctx, token);

    const match = await ctx.db.get(matchId);
    if (!match || !match.isActive) {
      throw new Error('Match not found or inactive');
    }

    // Verify caller is part of this match
    if (match.user1Id !== userId && match.user2Id !== userId) {
      throw new Error('Not authorized');
    }

    // Look for an existing canonical conversation first.
    const existing = await ctx.db
      .query('conversations')
      .withIndex('by_match', (q) => q.eq('matchId', matchId))
      .collect();

    if (existing.length > 0) {
      const canonical = existing.sort((a, b) => {
        const createdDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
        if (createdDiff !== 0) return createdDiff;
        return String(a._id).localeCompare(String(b._id));
      })[0];
      return { conversationId: canonical._id };
    }

    // Create conversation, then re-check immediately to reduce duplicate-thread
    // races if another request created the same match thread in parallel.
    const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
    const conversationId = await ctx.db.insert('conversations', {
      matchId,
      participants: [userId, otherUserId],
      isPreMatch: false,
      createdAt: Date.now(),
    });

    const allConversations = await ctx.db
      .query('conversations')
      .withIndex('by_match', (q) => q.eq('matchId', matchId))
      .collect();

    const canonical = allConversations.sort((a, b) => {
      const createdDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      if (createdDiff !== 0) return createdDiff;
      return String(a._id).localeCompare(String(b._id));
    })[0];

    if (canonical && canonical._id !== conversationId) {
      await ctx.db.delete(conversationId);
      return { conversationId: canonical._id };
    }

    return { conversationId };
  },
});
