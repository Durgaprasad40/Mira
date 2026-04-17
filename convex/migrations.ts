/**
 * One-time migration: Remove legacy onboardingDraft fields.
 */
import { internalMutation, query } from "./_generated/server";

/**
 * Remove legacy fields from onboardingDraft:
 * - lifeRhythm (entire field)
 * - preferences.lgbtqPreference containing 'prefer_not_to_say'
 *
 * Run from Convex Dashboard: Functions -> migrations -> cleanLegacyOnboardingFields
 */
export const cleanLegacyOnboardingFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("[MIGRATION] Starting legacy onboardingDraft cleanup...");

    const allUsers = await ctx.db.query("users").collect();

    let modifiedLifeRhythm = 0;
    let modifiedLgbtqPref = 0;

    for (const user of allUsers) {
      if (!user.onboardingDraft) continue;

      const draft = user.onboardingDraft as Record<string, unknown>;
      let needsUpdate = false;
      let cleanDraft = { ...draft };

      // 1. Remove lifeRhythm if present
      if ("lifeRhythm" in cleanDraft) {
        const { lifeRhythm, ...rest } = cleanDraft;
        cleanDraft = rest;
        needsUpdate = true;
        modifiedLifeRhythm++;
        console.log(`[MIGRATION] Removing lifeRhythm from user ${user._id.substring(0, 8)}`);
      }

      // 2. Remove 'prefer_not_to_say' from preferences.lgbtqPreference if present
      const prefs = cleanDraft.preferences as Record<string, unknown> | undefined;
      if (prefs && Array.isArray(prefs.lgbtqPreference)) {
        const original = prefs.lgbtqPreference as string[];
        const filtered = original.filter((v) => v !== "prefer_not_to_say");
        if (filtered.length !== original.length) {
          cleanDraft = {
            ...cleanDraft,
            preferences: {
              ...prefs,
              lgbtqPreference: filtered.length > 0 ? filtered : undefined,
            },
          };
          needsUpdate = true;
          modifiedLgbtqPref++;
          console.log(`[MIGRATION] Removing prefer_not_to_say from lgbtqPreference for user ${user._id.substring(0, 8)}`);
        }
      }

      if (needsUpdate) {
        await ctx.db.patch(user._id, {
          onboardingDraft: cleanDraft as typeof user.onboardingDraft,
        });
      }
    }

    console.log(`[MIGRATION] Complete. lifeRhythm removed: ${modifiedLifeRhythm}, lgbtqPreference cleaned: ${modifiedLgbtqPref}`);
    return { success: true, modifiedLifeRhythm, modifiedLgbtqPref };
  },
});

/**
 * Verify no legacy fields remain in onboardingDraft.
 *
 * Run from Convex Dashboard: Functions -> migrations -> verifyLegacyFieldsRemoved
 */
export const verifyLegacyFieldsRemoved = query({
  args: {},
  handler: async (ctx) => {
    const allUsers = await ctx.db.query("users").collect();

    const hasLifeRhythm: string[] = [];
    const hasPreferNotToSay: string[] = [];

    for (const user of allUsers) {
      if (!user.onboardingDraft) continue;

      const draft = user.onboardingDraft as Record<string, unknown>;

      if ("lifeRhythm" in draft) {
        hasLifeRhythm.push(user._id);
      }

      const prefs = draft.preferences as Record<string, unknown> | undefined;
      if (prefs && Array.isArray(prefs.lgbtqPreference)) {
        if ((prefs.lgbtqPreference as string[]).includes("prefer_not_to_say")) {
          hasPreferNotToSay.push(user._id);
        }
      }
    }

    const canTightenSchema = hasLifeRhythm.length === 0 && hasPreferNotToSay.length === 0;

    return {
      canTightenSchema,
      lifeRhythmRemaining: hasLifeRhythm.length,
      preferNotToSayRemaining: hasPreferNotToSay.length,
      lifeRhythmUserIds: hasLifeRhythm.slice(0, 10),
      preferNotToSayUserIds: hasPreferNotToSay.slice(0, 10),
    };
  },
});

/**
 * Backfill: clear legacy `crossedPathsEnabled === false` values.
 *
 * Phase-1 removed the user-facing "Participate in Crossed Paths" toggle and all
 * live backend enforcement. Any pre-existing users with `crossedPathsEnabled: false`
 * would otherwise remain opted-out forever (even though the code no longer
 * reads the field), because the schema field is retained as optional for
 * migration safety. This migration neutralizes those legacy values by setting
 * the field to `undefined` so every user is treated uniformly.
 *
 * Idempotent: safe to run multiple times.
 *
 * Run from Convex Dashboard: Functions -> migrations -> backfillCrossedPathsEnabled
 */
export const backfillCrossedPathsEnabled = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("[MIGRATION] Starting crossedPathsEnabled backfill...");

    const allUsers = await ctx.db.query("users").collect();

    let cleared = 0;
    for (const user of allUsers) {
      const legacy = (user as { crossedPathsEnabled?: boolean }).crossedPathsEnabled;
      if (legacy === false) {
        await ctx.db.patch(user._id, {
          crossedPathsEnabled: undefined,
        } as Record<string, unknown>);
        cleared++;
      }
    }

    console.log(`[MIGRATION] Complete. crossedPathsEnabled cleared: ${cleared}`);
    return { success: true, cleared };
  },
});
