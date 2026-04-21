import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

/**
 * DEV/TEST-ONLY: Delete all swipe-history rows in the `likes` table between
 * two specific users (both directions). Intended for targeted test-data resets
 * (e.g. re-enabling a candidate in Discover after a pre-existing swipe) without
 * touching any other data.
 *
 * Internal-only: not exposed as a public API. Invoke from the Convex dashboard
 * via `internal.testing.resetSwipesBetween`.
 *
 * Scope guarantees:
 * - Touches only the `likes` table.
 * - Deletes rows where (fromUserId = userAId AND toUserId = userBId) OR the
 *   reverse pair.
 * - Does not modify matches, conversations, blocks, reports, or any other table.
 */
export const resetSwipesBetween = internalMutation({
  args: {
    userAId: v.id('users'),
    userBId: v.id('users'),
  },
  handler: async (ctx, { userAId, userBId }) => {
    // Direction A → B
    const aToB = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', userAId).eq('toUserId', userBId),
      )
      .collect();

    // Direction B → A
    const bToA = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', userBId).eq('toUserId', userAId),
      )
      .collect();

    for (const row of aToB) await ctx.db.delete(row._id);
    for (const row of bToA) await ctx.db.delete(row._id);

    console.log('[TEST_RESET] resetSwipesBetween', {
      userAId,
      userBId,
      deletedAtoB: aToB.length,
      deletedBtoA: bToA.length,
    });

    return {
      deletedAtoB: aToB.length,
      deletedBtoA: bToA.length,
      total: aToB.length + bToA.length,
    };
  },
});
