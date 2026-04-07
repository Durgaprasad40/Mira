/**
 * DEBUG ONLY: Clear cooldown timestamps for testing Explore
 * Run with: npx convex run scripts/clearTestCooldowns:clearCooldowns
 */
import { mutation } from '../_generated/server';

export const clearCooldowns = mutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();

    let cleared = 0;
    for (const user of users) {
      if (user.lastShownInDiscoverAt) {
        await ctx.db.patch(user._id, {
          lastShownInDiscoverAt: undefined,
        });
        cleared++;
        console.log(`Cleared cooldown for ${user.name}`);
      }
    }

    return { cleared, total: users.length };
  },
});
