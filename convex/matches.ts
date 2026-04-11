import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { getTrustedUserId, resolveUserIdByAuthId } from './helpers';
import { getUnreadCount as getConversationUnreadCount } from './unreadCounts';

// Get all matches for a user
// FIX: Excludes blocked users (bidirectional)
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

    // FIX: Batch fetch blocked users (bidirectional)
    const [myBlocks, blocksOnMe] = await Promise.all([
      // Users I have blocked
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      // Users who have blocked me
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
    ]);
    const blockedUserIds = new Set([
      ...myBlocks.map((b) => b.blockedUserId as string),
      ...blocksOnMe.map((b) => b.blockerId as string),
    ]);

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
        validConversations.map((c) => getConversationUnreadCount(ctx, c._id, userId))
      ),
    ]);

    // Build conversation data maps
    const lastMessageMap = new Map(
      validConversations.map((c, i) => [c._id as string, lastMessages[i]])
    );
    const unreadCountMap = new Map(
      validConversations.map((c, i) => [c._id as string, unreadCounts[i] || 0])
    );

    // Build result
    const result = [];
    for (const match of allMatches) {
      const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;

      // FIX: Skip matches with blocked users (either direction)
      if (blockedUserIds.has(otherUserId as string)) continue;

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
        matchSource: (match as any).matchSource || 'like', // Track super_like vs normal match
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
// P0 SECURITY: Added bidirectional block check to prevent blocked users from viewing profiles
export const getMatch = query({
  args: {
    matchId: v.id('matches'),
    token: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { matchId } = args;
    const userId = await getTrustedUserId(
      ctx,
      args,
      'Unauthorized: match access requires a valid session'
    );

    const match = await ctx.db.get(matchId);
    if (!match || !match.isActive) return null;

    // Verify user is part of this match
    if (match.user1Id !== userId && match.user2Id !== userId) {
      return null;
    }

    const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;

    // P0 SECURITY: Check if either user blocked the other
    const [blockByMe, blockByThem] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', userId).eq('blockedUserId', otherUserId)
        )
        .first(),
      ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', otherUserId).eq('blockedUserId', userId)
        )
        .first(),
    ]);
    if (blockByMe || blockByThem) {
      return null; // Block exists - deny access
    }

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
// AUTH FIX: Use authUserId + server-side resolution to prevent client spoofing
export const unmatch = mutation({
  args: {
    matchId: v.id('matches'),
    authUserId: v.string(), // Auth ID from client, resolved server-side
  },
  handler: async (ctx, args) => {
    const { matchId, authUserId } = args;

    // Resolve auth ID to actual user ID server-side (prevents spoofing)
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('User not found');
    }

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
// P1 SECURITY: Added bidirectional block filtering
export const getNewMatches = query({
  args: {
    userId: v.id('users'),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, since } = args;

    const [matchesAsUser1, matchesAsUser2, myBlocks, blocksOnMe] = await Promise.all([
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) =>
          q.and(
            q.eq(q.field('isActive'), true),
            q.gt(q.field('matchedAt'), since)
          )
        )
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .filter((q) =>
          q.and(
            q.eq(q.field('isActive'), true),
            q.gt(q.field('matchedAt'), since)
          )
        )
        .collect(),
      // P1 SECURITY: Fetch blocks bidirectionally
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
    ]);

    // Build blocked user set
    const blockedUserIds = new Set([
      ...myBlocks.map((b) => b.blockedUserId as string),
      ...blocksOnMe.map((b) => b.blockerId as string),
    ]);

    // Filter out matches with blocked users
    const allMatches = [...matchesAsUser1, ...matchesAsUser2];
    return allMatches.filter((match) => {
      const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
      return !blockedUserIds.has(otherUserId as string);
    });
  },
});

// Check if two users are matched
// P1 SECURITY: Added authorization (caller must be one of the users) and block check
export const areMatched = query({
  args: {
    authUserId: v.string(), // Caller's auth ID for authorization
    otherUserId: v.id('users'), // The other user to check match with
  },
  handler: async (ctx, args) => {
    const { authUserId, otherUserId } = args;

    // P1 SECURITY: Resolve caller's auth ID to Convex user ID
    const callerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!callerId) {
      return false; // Unauthorized
    }

    // P1 SECURITY: Check if either user blocked the other
    const [blockByMe, blockByThem] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', callerId).eq('blockedUserId', otherUserId)
        )
        .first(),
      ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', otherUserId).eq('blockedUserId', callerId)
        )
        .first(),
    ]);
    if (blockByMe || blockByThem) {
      return false; // Block exists
    }

    // Normalize user ordering for index lookup
    const orderedUser1 = callerId < otherUserId ? callerId : otherUserId;
    const orderedUser2 = callerId < otherUserId ? otherUserId : callerId;

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
