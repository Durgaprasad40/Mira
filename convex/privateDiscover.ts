import { v } from 'convex/values';
import { query } from './_generated/server';

// Get private discovery profiles (blurred photos only)
// Filters out:
// - The requesting user
// - Incomplete profiles
// - Blocked users (in BOTH directions - shared across phases)
export const getProfiles = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get blocks for current user (both directions - shared across Phase-1 and Phase-2)
    const blocksOut = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', args.userId))
      .collect();
    const blocksIn = await ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', args.userId))
      .collect();

    // Combine into a set of blocked user IDs
    const blockedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    const profiles = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_enabled', (q) => q.eq('isPrivateEnabled', true))
      .collect();

    // Filter out:
    // - The requesting user
    // - Incomplete profiles
    // - Blocked users (either direction)
    const filtered = profiles.filter(
      (p) =>
        p.userId !== args.userId &&
        p.isSetupComplete &&
        !blockedUserIds.has(p.userId as string)
    );

    const limit = args.limit ?? 50;
    const limited = filtered.slice(0, limit);

    // Return only blurred data — never expose original photos
    // Cast to access optional schema fields that may not be in generated types yet
    return limited.map((p) => {
      const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };
      // Backward compat: older records may only have privateIntentKey (single)
      const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);
      return {
        _id: p._id,
        userId: p.userId,
        displayNameInitial: p.displayName.charAt(0).toUpperCase(),
        age: p.age,
        city: p.city,
        gender: p.gender,
        blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
        blurredPhotoUrls: p.privatePhotoUrls,
        intentKeys,
        desireTagKeys: p.privateDesireTagKeys,
        privateBio: p.privateBio,
        revealPolicy: p.revealPolicy ?? 'mutual_only',
        // Include hobbies and verification status if available
        hobbies: profile.hobbies ?? [],
        isVerified: profile.isVerified ?? false,
      };
    });
  },
});

// Get a single private profile for viewing (blurred only)
// Also checks blocks before returning
// viewerId is REQUIRED to enforce block checking
export const getProfileCard = query({
  args: {
    profileId: v.id('userPrivateProfiles'),
    viewerId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.profileId);
    if (!p || !p.isPrivateEnabled || !p.isSetupComplete) return null;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.viewerId).eq('blockedUserId', p.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', p.userId).eq('blockedUserId', args.viewerId)
      )
      .first();
    if (blockedByOwner) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };
    // Backward compat: older records may only have privateIntentKey (single)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    return {
      _id: p._id,
      userId: p.userId,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: p.age,
      city: p.city,
      gender: p.gender,
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      intentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
    };
  },
});

// Get a Phase-2 profile by userId (for full profile view)
// Returns full profile data including intentKeys for display
// viewerId is REQUIRED to enforce block checking
export const getProfileByUserId = query({
  args: {
    userId: v.id('users'),
    viewerId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // Find the private profile for this user
    const p = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!p || !p.isPrivateEnabled || !p.isSetupComplete) return null;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.viewerId).eq('blockedUserId', args.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.userId).eq('blockedUserId', args.viewerId)
      )
      .first();
    if (blockedByOwner) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; privateIntentKey?: string };

    // Backward compat: older records may only have privateIntentKey (single), not privateIntentKeys (array)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    return {
      _id: p._id,
      userId: p.userId,
      name: p.displayName,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: p.age,
      city: p.city,
      gender: p.gender,
      bio: p.privateBio,
      photos: p.privatePhotoUrls.map((url, i) => ({ _id: `photo_${i}`, url })),
      blurredPhotoUrl: p.privatePhotoUrls[0] ?? null,
      blurredPhotoUrls: p.privatePhotoUrls,
      // Phase-2 intents (array)
      intentKeys,
      // Legacy single key for backward compat
      privateIntentKey: intentKeys[0] ?? null,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
      activities: profile.hobbies ?? [],
      // Phase-2 does NOT have Phase-1 fields
      relationshipIntent: [],
      profilePrompts: [],
    };
  },
});
