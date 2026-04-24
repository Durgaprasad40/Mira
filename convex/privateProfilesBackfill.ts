/**
 * One-time backfill: repair Phase-2 profiles whose `isSetupComplete` was
 * never flipped to true (existing-row data gap). Onboarding writes are NOT
 * changed by this file — this only patches rows that already look complete
 * enough to be eligible for Deep Connect.
 *
 * Run via Convex dashboard or CLI as an internal mutation. Safe to re-run.
 */
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';

export const backfillSetupComplete = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('userPrivateProfiles').collect();

    let updated = 0;
    let skipped = 0;

    for (const profile of profiles) {
      // Already complete — leave alone.
      if (profile.isSetupComplete === true) {
        skipped++;
        continue;
      }

      const hasName =
        typeof profile.displayName === 'string' &&
        profile.displayName.trim().length > 0;

      const hasIntent =
        Array.isArray(profile.privateIntentKeys) &&
        profile.privateIntentKeys.length > 0;

      const hasPhotos =
        Array.isArray(profile.privatePhotoUrls) &&
        profile.privatePhotoUrls.length > 0;

      const isEnabled = profile.isPrivateEnabled === true;

      // Location lives on the `users` table, not on userPrivateProfiles.
      // Prefer the published coords (what discovery actually shares); fall
      // back to live coords if published has not run yet.
      const user = await ctx.db.get(profile.userId);
      const lat =
        typeof user?.publishedLat === 'number'
          ? user.publishedLat
          : typeof user?.latitude === 'number'
            ? user.latitude
            : null;
      const lng =
        typeof user?.publishedLng === 'number'
          ? user.publishedLng
          : typeof user?.longitude === 'number'
            ? user.longitude
            : null;
      const hasLocation =
        lat !== null &&
        lng !== null &&
        Number.isFinite(lat) &&
        Number.isFinite(lng);

      const eligible =
        hasName && hasIntent && hasPhotos && hasLocation && isEnabled;

      if (!eligible) {
        skipped++;
        continue;
      }

      await ctx.db.patch(profile._id, {
        isSetupComplete: true,
        updatedAt: Date.now(),
      });
      updated++;
    }

    const summary = {
      total: profiles.length,
      updated,
      skipped,
    };

    console.log('[BACKFILL_SETUP_COMPLETE]', summary);
    return summary;
  },
});
