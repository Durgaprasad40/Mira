import { v } from 'convex/values';
import { query } from './_generated/server';

// Get private discovery profiles (blurred photos only)
export const getProfiles = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profiles = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_enabled', (q) => q.eq('isPrivateEnabled', true))
      .collect();

    // Filter out the requesting user and incomplete profiles
    const filtered = profiles.filter(
      (p) => p.userId !== args.userId && p.isSetupComplete
    );

    const limit = args.limit ?? 50;
    const limited = filtered.slice(0, limit);

    // Return only blurred data — never expose original photos
    return limited.map((p) => ({
      _id: p._id,
      userId: p.userId,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: p.age,
      city: p.city,
      gender: p.gender,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      intentKeys: p.privateIntentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
    }));
  },
});

// Get a single private profile for viewing (blurred only)
export const getProfileCard = query({
  args: {
    profileId: v.id('userPrivateProfiles'),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.profileId);
    if (!p || !p.isPrivateEnabled || !p.isSetupComplete) return null;

    return {
      _id: p._id,
      userId: p.userId,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: p.age,
      city: p.city,
      gender: p.gender,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      intentKeys: p.privateIntentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
    };
  },
});
