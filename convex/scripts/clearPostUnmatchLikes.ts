/**
 * DEBUG ONLY: Clear likes between the unmatched test pair
 * Run with: npx convex run scripts/clearPostUnmatchLikes:clearLikes
 */
import { mutation } from '../_generated/server';
import { Id } from '../_generated/dataModel';

// The unmatched test pair
const PUKA_KOJJA_ID = 'm170wje32shsfrc1k5tjsh5hd18344vp' as Id<'users'>;
const HAHAHA_JPG_ID = 'm179mzxzvfmhfcf640r9mxcr81835w90' as Id<'users'>;

export const clearLikes = mutation({
  args: {},
  handler: async (ctx) => {
    console.log('='.repeat(80));
    console.log('CLEARING POST-UNMATCH LIKES');
    console.log('='.repeat(80));

    // Find and delete: Puka Kojja -> Hahaha Jpg
    const like1 = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', PUKA_KOJJA_ID).eq('toUserId', HAHAHA_JPG_ID)
      )
      .first();

    // Find and delete: Hahaha Jpg -> Puka Kojja
    const like2 = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', HAHAHA_JPG_ID).eq('toUserId', PUKA_KOJJA_ID)
      )
      .first();

    let deletedCount = 0;

    if (like1) {
      console.log(`Deleting like: Puka Kojja -> Hahaha Jpg (${like1._id})`);
      await ctx.db.delete(like1._id);
      deletedCount++;
    } else {
      console.log('No like found: Puka Kojja -> Hahaha Jpg');
    }

    if (like2) {
      console.log(`Deleting like: Hahaha Jpg -> Puka Kojja (${like2._id})`);
      await ctx.db.delete(like2._id);
      deletedCount++;
    } else {
      console.log('No like found: Hahaha Jpg -> Puka Kojja');
    }

    console.log(`\nDeleted ${deletedCount} like record(s)`);
    console.log('Users should now be able to appear to each other in Explore/Discover');

    return {
      success: true,
      deletedCount,
    };
  },
});
