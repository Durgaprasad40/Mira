import { internalMutation } from '../_generated/server';

/**
 * Migration: Remove category field from all todPrompts documents
 * Run via Convex dashboard: npx convex run migrations/removeTodCategory:run
 *
 * This deletes and re-inserts documents without the category field.
 * WARNING: This changes document IDs. Run only if no external references exist.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const prompts = await ctx.db.query('todPrompts').collect();
    let migrated = 0;

    for (const prompt of prompts) {
      const doc = prompt as any;
      if ('category' in doc) {
        // Extract all fields except _id, _creationTime, and category
        const {
          _id,
          _creationTime,
          category, // eslint-disable-line @typescript-eslint/no-unused-vars
          ...cleanDoc
        } = doc;

        // Delete old document
        await ctx.db.delete(prompt._id);

        // Re-insert without category
        await ctx.db.insert('todPrompts', cleanDoc);
        migrated++;
      }
    }

    return { migrated, message: `Migrated ${migrated} documents (removed category field)` };
  },
});
