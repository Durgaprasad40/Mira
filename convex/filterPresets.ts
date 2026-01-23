import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

// Get user's saved filter presets
export const getPresets = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const presets = await ctx.db
      .query('filterPresets')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect();

    return presets;
  },
});

// Save a new filter preset
export const savePreset = mutation({
  args: {
    userId: v.id('users'),
    name: v.string(),
    filters: v.object({
      relationshipIntents: v.optional(v.array(v.string())),
      activities: v.optional(v.array(v.string())),
      timeFilters: v.optional(v.array(v.string())),
      ageMin: v.optional(v.number()),
      ageMax: v.optional(v.number()),
      maxDistance: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error('User not found');

    // Check preset limit (free: 3, premium: unlimited)
    const existingPresets = await ctx.db
      .query('filterPresets')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect();

    if (user.subscriptionTier !== 'premium' && existingPresets.length >= 3) {
      throw new Error('Free users can save up to 3 presets. Upgrade to Premium for unlimited!');
    }

    const presetId = await ctx.db.insert('filterPresets', {
      userId: args.userId,
      name: args.name,
      filters: args.filters,
      createdAt: Date.now(),
    });

    return { success: true, presetId };
  },
});

// Delete a filter preset
export const deletePreset = mutation({
  args: {
    presetId: v.id('filterPresets'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const preset = await ctx.db.get(args.presetId);
    if (!preset) throw new Error('Preset not found');

    if (preset.userId !== args.userId) {
      throw new Error('Not authorized');
    }

    await ctx.db.delete(args.presetId);
    return { success: true };
  },
});
