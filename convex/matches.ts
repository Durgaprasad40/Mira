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
    const [matchesAsUser1, matchesAsUser2] = await Promise.all([
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .take(limit),
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .take(limit),
    ]);

    const allMatches = [...matchesAsUser1, ...matchesAsUser2];
    if (allMatches.length === 0) return [];

    // PERF #6: Batch-fetch all other users and conversations in parallel
    const otherUserIds = allMatches.map((m) =>
      m.user1Id === userId ? m.user2Id : m.user1Id
    );

    // Parallel batch: users, conversations, and photos
    const [users, conversations, photos] = await Promise.all([
      // Batch fetch all other users
      Promise.all(otherUserIds.map((id) => ctx.db.get(id))),
      // Batch fetch all conversations by matchId
      Promise.all(
        allMatches.map((m) =>
          ctx.db
            .query('conversations')
            .withIndex('by_match', (q) => q.eq('matchId', m._id))
            .first()
        )
      ),
      // Batch fetch primary photos for all other users
      Promise.all(
        otherUserIds.map((id) =>
          ctx.db
            .query('photos')
            .withIndex('by_user', (q) => q.eq('userId', id))
            .filter((q) => q.eq(q.field('isPrimary'), true))
            .first()
        )
      ),
    ]);

    // Build user and photo maps for O(1) lookup
    const userMap = new Map(
      otherUserIds.map((id, i) => [id, users[i]])
    );
    const photoMap = new Map(
      otherUserIds.map((id, i) => [id, photos[i]])
    );
    const conversationMap = new Map(
      allMatches.map((m, i) => [m._id as string, conversations[i]])
    );

    // Get conversation IDs that exist
    const validConversations = conversations.filter(Boolean) as NonNullable<typeof conversations[number]>[];

    // Batch fetch last messages and unread counts for all conversations
    const [lastMessages, unreadCounts] = await Promise.all([
      Promise.all(
        validConversations.map((c) =>
          ctx.db
            .query('messages')
            .withIndex('by_conversation_created', (q) =>
              q.eq('conversationId', c._id)
            )
            .order('desc')
            .first()
        )
      ),
      Promise.all(
        validConversations.map((c) =>
          ctx.db
            .query('messages')
            .withIndex('by_conversation', (q) =>
              q.eq('conversationId', c._id)
            )
            .filter((q) =>
              q.and(
                q.neq(q.field('senderId'), userId),
                q.eq(q.field('readAt'), undefined)
              )
            )
            .collect()
        )
      ),
    ]);

    // Build conversation data maps
    const lastMessageMap = new Map(
      validConversations.map((c, i) => [c._id as string, lastMessages[i]])
    );
    const unreadCountMap = new Map(
      validConversations.map((c, i) => [c._id as string, unreadCounts[i]?.length || 0])
    );

    // Build result
    const result = [];
    for (const match of allMatches) {
      const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
      const otherUser = userMap.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;

      const conversation = conversationMap.get(match._id as string);
      const photo = photoMap.get(otherUserId);
      const message = conversation ? lastMessageMap.get(conversation._id as string) : null;
      const unreadCount = conversation ? unreadCountMap.get(conversation._id as string) || 0 : 0;

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
        lastMessage: message
          ? {
              content: message.content,
              senderId: message.senderId,
              createdAt: message.createdAt,
              isRead: !!message.readAt,
            }
          : null,
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

// BUGFIX #21: Safe date parsing with NaN guard
function calculateAge(dateOfBirth: string): number {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
