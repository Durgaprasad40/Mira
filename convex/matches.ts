import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Get all matches for a user
export const getMatches = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;

    // Get matches where user is either user1 or user2
    const matchesAsUser1 = await ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .take(limit);

    const matchesAsUser2 = await ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .filter((q) => q.eq(q.field('isActive'), true))
      .take(limit);

    const allMatches = [...matchesAsUser1, ...matchesAsUser2];

    // Get match details with other user info
    const result = [];
    for (const match of allMatches) {
      const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
      const otherUser = await ctx.db.get(otherUserId);

      if (!otherUser || !otherUser.isActive) continue;

      // Get conversation
      const conversation = await ctx.db
        .query('conversations')
        .withIndex('by_match', (q) => q.eq('matchId', match._id))
        .first();

      // Get last message
      let lastMessage = null;
      if (conversation) {
        const message = await ctx.db
          .query('messages')
          .withIndex('by_conversation_created', (q) =>
            q.eq('conversationId', conversation._id)
          )
          .order('desc')
          .first();

        if (message) {
          lastMessage = {
            content: message.content,
            senderId: message.senderId,
            createdAt: message.createdAt,
            isRead: !!message.readAt,
          };
        }
      }

      // Get primary photo
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', otherUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // Count unread messages
      let unreadCount = 0;
      if (conversation) {
        const unreadMessages = await ctx.db
          .query('messages')
          .withIndex('by_conversation', (q) =>
            q.eq('conversationId', conversation._id)
          )
          .filter((q) =>
            q.and(
              q.neq(q.field('senderId'), userId),
              q.eq(q.field('readAt'), undefined)
            )
          )
          .collect();
        unreadCount = unreadMessages.length;
      }

      result.push({
        matchId: match._id,
        conversationId: conversation?._id,
        matchedAt: match.matchedAt,
        user: {
          id: otherUserId,
          name: otherUser.name,
          age: calculateAge(otherUser.dateOfBirth),
          photoUrl: photo?.url,
          lastActive: otherUser.lastActive,
          isVerified: otherUser.isVerified,
        },
        lastMessage,
        unreadCount,
      });
    }

    // Sort by last message or match date
    result.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.matchedAt;
      const bTime = b.lastMessage?.createdAt || b.matchedAt;
      return bTime - aTime;
    });

    return result;
  },
});

// Get single match details
export const getMatch = query({
  args: {
    matchId: v.id('matches'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { matchId, userId } = args;

    const match = await ctx.db.get(matchId);
    if (!match || !match.isActive) return null;

    // Verify user is part of this match
    if (match.user1Id !== userId && match.user2Id !== userId) {
      return null;
    }

    const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
    const otherUser = await ctx.db.get(otherUserId);

    if (!otherUser) return null;

    // Get photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', otherUserId))
      .collect();

    // Get conversation
    const conversation = await ctx.db
      .query('conversations')
      .withIndex('by_match', (q) => q.eq('matchId', matchId))
      .first();

    return {
      matchId: match._id,
      matchedAt: match.matchedAt,
      conversationId: conversation?._id,
      user: {
        id: otherUserId,
        name: otherUser.name,
        age: calculateAge(otherUser.dateOfBirth),
        bio: otherUser.bio,
        photos: photos.sort((a, b) => a.order - b.order),
        isVerified: otherUser.isVerified,
        lastActive: otherUser.lastActive,
        city: otherUser.city,
        height: otherUser.height,
        jobTitle: otherUser.jobTitle,
        company: otherUser.company,
        education: otherUser.education,
        relationshipIntent: otherUser.relationshipIntent,
        activities: otherUser.activities,
      },
    };
  },
});

// Unmatch
export const unmatch = mutation({
  args: {
    matchId: v.id('matches'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { matchId, userId } = args;

    const match = await ctx.db.get(matchId);
    if (!match) throw new Error('Match not found');

    // Verify user is part of this match
    if (match.user1Id !== userId && match.user2Id !== userId) {
      throw new Error('Not authorized');
    }

    // Mark unmatch time for this user
    const updateField = match.user1Id === userId ? 'user1UnmatchedAt' : 'user2UnmatchedAt';
    await ctx.db.patch(matchId, {
      [updateField]: Date.now(),
      isActive: false,
    });

    return { success: true };
  },
});

// Get new matches (for notifications)
export const getNewMatches = query({
  args: {
    userId: v.id('users'),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, since } = args;

    const matchesAsUser1 = await ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('isActive'), true),
          q.gt(q.field('matchedAt'), since)
        )
      )
      .collect();

    const matchesAsUser2 = await ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('isActive'), true),
          q.gt(q.field('matchedAt'), since)
        )
      )
      .collect();

    return [...matchesAsUser1, ...matchesAsUser2];
  },
});

// Check if two users are matched
export const areMatched = query({
  args: {
    user1Id: v.id('users'),
    user2Id: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { user1Id, user2Id } = args;

    const orderedUser1 = user1Id < user2Id ? user1Id : user2Id;
    const orderedUser2 = user1Id < user2Id ? user2Id : user1Id;

    const match = await ctx.db
      .query('matches')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2)
      )
      .filter((q) => q.eq(q.field('isActive'), true))
      .first();

    return !!match;
  },
});

// Helper function
function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
