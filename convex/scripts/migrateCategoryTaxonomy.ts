/**
 * Migration script: Update category taxonomy from old to new names
 *
 * RELATIONSHIP INTENT MIGRATION (old → new):
 * - long_term → serious_vibes
 * - short_term → keep_it_casual
 * - fwb → keep_it_casual
 * - figuring_out → exploring_vibes
 * - short_to_long → see_where_it_goes
 * - long_to_short → open_to_vibes
 * - new_friends → just_friends
 * - open_to_anything → open_to_anything (same)
 * - just_18 → new_to_dating
 *
 * CATEGORY MIGRATION (old → new):
 * - single_parent → single_parent (same)
 * - near_me → nearby
 *
 * Run with: npx convex run scripts/migrateCategoryTaxonomy:migrateCategories
 */
import { mutation } from '../_generated/server';
import { findBestCategory } from '../discoverCategories';

// Mapping from old relationshipIntent values to new CURRENT 9 CATEGORIES
const INTENT_OLD_TO_NEW: Record<string, string> = {
  long_term: 'serious_vibes',
  short_term: 'keep_it_casual',
  fwb: 'keep_it_casual', // Merge fwb into keep_it_casual
  figuring_out: 'exploring_vibes',
  short_to_long: 'see_where_it_goes',
  long_to_short: 'open_to_vibes',
  new_friends: 'just_friends',
  open_to_anything: 'open_to_anything', // Same
  just_18: 'new_to_dating',
};

// Mapping from old category names to new names
const OLD_TO_NEW_MAPPING: Record<string, string> = {
  ...INTENT_OLD_TO_NEW,
  near_me: 'nearby',
  // These stay the same but list for completeness
  single_parent: 'single_parent',
  online_now: 'online_now',
  active_today: 'active_today',
  free_tonight: 'free_tonight',
  coffee_date: 'coffee_date',
  nature_lovers: 'nature_lovers',
  binge_watchers: 'binge_watchers',
  travel: 'travel',
  gaming: 'gaming',
  fitness: 'fitness',
  music: 'music',
};

// Set of old intent values that need migration
const OLD_INTENT_VALUES = new Set([
  'long_term', 'short_term', 'fwb', 'figuring_out', 'short_to_long',
  'long_to_short', 'new_friends', 'just_18',
]);

// Set of old category names that need migration
const OLD_CATEGORY_NAMES = new Set([
  'long_term', 'short_term', 'figuring_out', 'short_to_long',
  'long_to_short', 'new_friends', 'just_18', 'near_me',
]);

export const migrateCategories = mutation({
  args: {},
  handler: async (ctx) => {
    // Fetch ALL users (including inactive for completeness)
    const users = await ctx.db.query('users').collect();

    console.log(`[migrateCategoryTaxonomy] Found ${users.length} total users`);

    let categoryMigrated = 0;
    let intentMigrated = 0;
    let reassigned = 0;
    let unchanged = 0;

    for (const user of users) {
      const oldCategory = user.assignedDiscoverCategory;
      const oldIntents = user.relationshipIntent || [];
      let needsUpdate = false;
      const updates: Record<string, any> = {};

      // STEP 1: Migrate relationshipIntent values (old → new)
      if (oldIntents.length > 0) {
        const hasOldIntent = oldIntents.some((i: string) => OLD_INTENT_VALUES.has(i));
        if (hasOldIntent) {
          const newIntents = oldIntents.map((i: string) => INTENT_OLD_TO_NEW[i] || i);
          // Remove duplicates (e.g., fwb and short_term both map to keep_it_casual)
          const uniqueIntents = [...new Set(newIntents)];
          updates.relationshipIntent = uniqueIntents;
          needsUpdate = true;
          intentMigrated++;
          console.log(`[INTENT] ${user.name}: [${oldIntents.join(',')}] → [${uniqueIntents.join(',')}]`);
        }
      }

      // STEP 2: Migrate assignedDiscoverCategory (old → new)
      if (oldCategory && OLD_CATEGORY_NAMES.has(oldCategory)) {
        const newCategory = OLD_TO_NEW_MAPPING[oldCategory];
        updates.assignedDiscoverCategory = newCategory;
        updates.discoverCategoryAssignedAt = Date.now();
        needsUpdate = true;
        categoryMigrated++;
        console.log(`[CATEGORY] ${user.name}: ${oldCategory} → ${newCategory}`);
      } else if (!oldCategory) {
        // STEP 3: Assign category if none exists (using migrated intents if available)
        const intentsForCategory = updates.relationshipIntent || oldIntents;
        const bestCategory = findBestCategory({
          relationshipIntent: intentsForCategory,
          activities: user.activities || [],
          lastActive: user.lastActive || Date.now(),
        });
        updates.assignedDiscoverCategory = bestCategory;
        updates.discoverCategoryAssignedAt = Date.now();
        needsUpdate = true;
        reassigned++;
        console.log(`[ASSIGN] ${user.name}: (none) → ${bestCategory}`);
      }

      // Apply updates if needed
      if (needsUpdate) {
        await ctx.db.patch(user._id, updates);
      } else {
        unchanged++;
      }
    }

    console.log(`\n[migrateCategoryTaxonomy] Migration complete:`);
    console.log(`  - Intent migrated: ${intentMigrated}`);
    console.log(`  - Category migrated: ${categoryMigrated}`);
    console.log(`  - Category assigned: ${reassigned}`);
    console.log(`  - Unchanged: ${unchanged}`);
    console.log(`  - Total: ${users.length}`);

    return { intentMigrated, categoryMigrated, reassigned, unchanged, total: users.length };
  },
});

/**
 * Verify all users have new taxonomy categories
 * Run with: npx convex run scripts/migrateCategoryTaxonomy:verifyMigration
 */
export const verifyMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();

    const issues: { userId: string; name: string; category: string }[] = [];

    for (const user of users) {
      const category = user.assignedDiscoverCategory;
      if (category && OLD_CATEGORY_NAMES.has(category)) {
        issues.push({
          userId: user._id,
          name: user.name || 'Unknown',
          category,
        });
      }
    }

    if (issues.length === 0) {
      console.log('[verifyMigration] All users have valid new taxonomy categories!');
    } else {
      console.log(`[verifyMigration] Found ${issues.length} users with old category names:`);
      for (const issue of issues) {
        console.log(`  - ${issue.name}: ${issue.category}`);
      }
    }

    return { valid: issues.length === 0, issues };
  },
});
