/**
 * TEMPORARY SCRIPT: Clear interaction data for Explore debugging
 *
 * WARNING: DO NOT USE IN PRODUCTION
 * Remove this file after debugging is complete.
 *
 * Run with:
 *   npx convex run scripts/clearExploreTestData:clearAllLikes
 *   npx convex run scripts/clearExploreTestData:clearAllMatches
 *   npx convex run scripts/clearExploreTestData:clearAllConversations
 *   npx convex run scripts/clearExploreTestData:clearAll
 */
import { mutation } from '../_generated/server';

export const clearAllLikes = mutation({
  args: {},
  handler: async (ctx) => {
    const likes = await ctx.db.query('likes').collect();
    for (const like of likes) {
      await ctx.db.delete(like._id);
    }
    console.log(`[clearAllLikes] Deleted ${likes.length} likes`);
    return { deleted: likes.length };
  },
});

export const clearAllMatches = mutation({
  args: {},
  handler: async (ctx) => {
    const matches = await ctx.db.query('matches').collect();
    for (const match of matches) {
      await ctx.db.delete(match._id);
    }
    console.log(`[clearAllMatches] Deleted ${matches.length} matches`);
    return { deleted: matches.length };
  },
});

export const clearAllConversations = mutation({
  args: {},
  handler: async (ctx) => {
    const conversations = await ctx.db.query('conversations').collect();
    for (const conv of conversations) {
      await ctx.db.delete(conv._id);
    }

    const participants = await ctx.db.query('conversationParticipants').collect();
    for (const p of participants) {
      await ctx.db.delete(p._id);
    }

    // Also clear messages
    const messages = await ctx.db.query('messages').collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    console.log(`[clearAllConversations] Deleted ${conversations.length} conversations, ${participants.length} participants, ${messages.length} messages`);
    return {
      conversationsDeleted: conversations.length,
      participantsDeleted: participants.length,
      messagesDeleted: messages.length,
    };
  },
});

/**
 * Clear all interaction data in one call
 */
export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    // Clear likes
    const likes = await ctx.db.query('likes').collect();
    for (const like of likes) {
      await ctx.db.delete(like._id);
    }

    // Clear matches
    const matches = await ctx.db.query('matches').collect();
    for (const match of matches) {
      await ctx.db.delete(match._id);
    }

    // Clear conversations
    const conversations = await ctx.db.query('conversations').collect();
    for (const conv of conversations) {
      await ctx.db.delete(conv._id);
    }

    // Clear participants
    const participants = await ctx.db.query('conversationParticipants').collect();
    for (const p of participants) {
      await ctx.db.delete(p._id);
    }

    // Clear messages
    const messages = await ctx.db.query('messages').collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    console.log('[clearAll] Cleared all interaction data:');
    console.log(`  - Likes: ${likes.length}`);
    console.log(`  - Matches: ${matches.length}`);
    console.log(`  - Conversations: ${conversations.length}`);
    console.log(`  - Participants: ${participants.length}`);
    console.log(`  - Messages: ${messages.length}`);

    return {
      likesDeleted: likes.length,
      matchesDeleted: matches.length,
      conversationsDeleted: conversations.length,
      participantsDeleted: participants.length,
      messagesDeleted: messages.length,
    };
  },
});
