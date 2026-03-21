/**
 * DEBUG: Check user ID formats
 */
import { query } from '../_generated/server';

export const checkUserIds = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').take(10);

    return users.map(u => ({
      _id: u._id,
      name: u.name,
      authUserId: u.authUserId,
      demoUserId: u.demoUserId,
    }));
  },
});
