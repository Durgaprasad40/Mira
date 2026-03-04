/**
 * System configuration queries and mutations
 * Used for global app settings like resetEpoch
 */

import { query, internalMutation } from './_generated/server';
import { v } from 'convex/values';

/**
 * Get the current reset epoch
 * This value is incremented whenever the database is reset (all users deleted)
 * Clients compare their local resetEpoch to detect when they need to clear cached data
 */
export const getResetEpoch = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query('systemConfig')
      .withIndex('by_key', (q) => q.eq('key', 'resetEpoch'))
      .first();

    // Return 0 if not set (initial state)
    return config?.value ?? 0;
  },
});

/**
 * Increment the reset epoch
 * Called by admin:resetAllUsers after deleting all users
 * This signals to clients that they should clear their local caches
 */
export const bumpResetEpoch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query('systemConfig')
      .withIndex('by_key', (q) => q.eq('key', 'resetEpoch'))
      .first();

    const newEpoch = (config?.value ?? 0) + 1;

    if (config) {
      // Update existing
      await ctx.db.patch(config._id, {
        value: newEpoch,
        updatedAt: Date.now(),
      });
    } else {
      // Create new
      await ctx.db.insert('systemConfig', {
        key: 'resetEpoch',
        value: newEpoch,
        updatedAt: Date.now(),
      });
    }

    console.log(`[SYSTEM] Reset epoch bumped to ${newEpoch}`);
    return newEpoch;
  },
});
