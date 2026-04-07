/**
 * One-time script to assign categories to all existing users
 * Run with: npx convex run scripts/assignAllCategories:assignAllUserCategories
 */
import { mutation } from '../_generated/server';
import { findBestCategory } from '../discoverCategories';

export const assignAllUserCategories = mutation({
  args: {},
  handler: async (ctx) => {
    // Fetch all active users
    const users = await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect();

    console.log(`[assignAllCategories] Found ${users.length} active users`);

    let assigned = 0;
    let skipped = 0;

    for (const user of users) {
      // Skip if already has a recent assignment (within 24h)
      if (user.discoverCategoryAssignedAt) {
        const hoursSinceAssign = (Date.now() - user.discoverCategoryAssignedAt) / (1000 * 60 * 60);
        if (hoursSinceAssign < 24) {
          skipped++;
          continue;
        }
      }

      // Calculate best category
      const bestCategory = findBestCategory({
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        lastActive: user.lastActive,
      });

      // Update user
      await ctx.db.patch(user._id, {
        assignedDiscoverCategory: bestCategory,
        discoverCategoryAssignedAt: Date.now(),
      });

      assigned++;
      console.log(`[assignAllCategories] ${user.name} -> ${bestCategory}`);
    }

    console.log(`[assignAllCategories] Done. Assigned: ${assigned}, Skipped: ${skipped}`);
    return { assigned, skipped, total: users.length };
  },
});
