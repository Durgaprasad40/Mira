/**
 * DEBUG: Check session formats
 */
import { query } from '../_generated/server';

export const checkSessions = query({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query('sessions').take(10);

    return sessions.map(s => ({
      _id: s._id,
      userId: s.userId,
      tokenPrefix: s.token?.substring(0, 20) + '...',
      expiresAt: new Date(s.expiresAt).toISOString(),
    }));
  },
});
