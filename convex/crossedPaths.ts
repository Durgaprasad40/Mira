import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

const PROXIMITY_METERS = 100;
const MIN_CROSSINGS_FOR_UNLOCK = 10;
const UNLOCK_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours

// Record a location update and check for crossed paths
export const recordLocation = mutation({
  args: {
    userId: v.id('users'),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, latitude, longitude } = args;
    const now = Date.now();

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return { success: false };

    // Update user location
    await ctx.db.patch(userId, {
      latitude,
      longitude,
      lastActive: now,
    });

    // Find nearby users (within PROXIMITY_METERS)
    const allUsers = await ctx.db.query('users').collect();
    const nearbyUsers = [];

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive) continue;
      if (!user.latitude || !user.longitude) continue;

      // Check if location was updated in the last hour (user is actively using app)
      if (now - user.lastActive > 60 * 60 * 1000) continue;

      const distance = calculateDistanceMeters(
        latitude,
        longitude,
        user.latitude,
        user.longitude
      );

      if (distance <= PROXIMITY_METERS) {
        nearbyUsers.push(user);
      }
    }

    // Record crossed paths
    for (const nearbyUser of nearbyUsers) {
      // Check preferences match
      if (!currentUser.lookingFor.includes(nearbyUser.gender)) continue;
      if (!nearbyUser.lookingFor.includes(currentUser.gender)) continue;

      // Check if blocked
      const blocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', userId).eq('blockedUserId', nearbyUser._id)
        )
        .first();
      if (blocked) continue;

      // Order user IDs for consistent lookup
      const user1Id = userId < nearbyUser._id ? userId : nearbyUser._id;
      const user2Id = userId < nearbyUser._id ? nearbyUser._id : userId;

      // Check for existing crossed path record
      let crossedPath = await ctx.db
        .query('crossedPaths')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id)
        )
        .first();

      if (crossedPath) {
        // Don't count if last crossing was less than 30 minutes ago
        if (now - crossedPath.lastCrossedAt < 30 * 60 * 1000) continue;

        // Update existing record
        const newCount = crossedPath.count + 1;
        const updates: Record<string, unknown> = {
          count: newCount,
          lastCrossedAt: now,
        };

        // Check if they've reached the unlock threshold
        if (newCount >= MIN_CROSSINGS_FOR_UNLOCK && !crossedPath.unlockExpiresAt) {
          updates.unlockExpiresAt = now + UNLOCK_DURATION_MS;

          // Send notifications to both users
          await ctx.db.insert('notifications', {
            userId: user1Id,
            type: 'crossed_paths',
            title: 'Crossed Paths Milestone!',
            body: `You've crossed paths ${newCount} times! Enjoy 48 hours of free messaging.`,
            data: { userId: user2Id as string },
            createdAt: now,
          });

          await ctx.db.insert('notifications', {
            userId: user2Id,
            type: 'crossed_paths',
            title: 'Crossed Paths Milestone!',
            body: `You've crossed paths ${newCount} times! Enjoy 48 hours of free messaging.`,
            data: { userId: user1Id as string },
            createdAt: now,
          });
        }

        await ctx.db.patch(crossedPath._id, updates);
      } else {
        // Create new record
        await ctx.db.insert('crossedPaths', {
          user1Id,
          user2Id,
          count: 1,
          lastCrossedAt: now,
        });
      }
    }

    return { success: true, nearbyCount: nearbyUsers.length };
  },
});

// Get crossed paths for a user
export const getCrossedPaths = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;
    const now = Date.now();

    // Get crossed paths where user is either user1 or user2
    const asUser1 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .take(limit);

    const asUser2 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .take(limit);

    const allCrossedPaths = [...asUser1, ...asUser2];

    // Sort by count and last crossed
    allCrossedPaths.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastCrossedAt - a.lastCrossedAt;
    });

    const result = [];
    for (const cp of allCrossedPaths.slice(0, limit)) {
      const otherUserId = cp.user1Id === userId ? cp.user2Id : cp.user1Id;
      const otherUser = await ctx.db.get(otherUserId);

      if (!otherUser || !otherUser.isActive) continue;

      // Get primary photo
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', otherUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // Check if unlock is active
      const isUnlocked = cp.unlockExpiresAt && cp.unlockExpiresAt > now;
      const unlockTimeRemaining = isUnlocked ? cp.unlockExpiresAt! - now : 0;

      result.push({
        id: cp._id,
        count: cp.count,
        lastCrossedAt: cp.lastCrossedAt,
        isUnlocked,
        unlockExpiresAt: cp.unlockExpiresAt,
        unlockTimeRemaining,
        progressToUnlock: Math.min(cp.count / MIN_CROSSINGS_FOR_UNLOCK, 1),
        user: {
          id: otherUserId,
          name: otherUser.name,
          age: calculateAge(otherUser.dateOfBirth),
          photoUrl: photo?.url,
          isVerified: otherUser.isVerified,
        },
      });
    }

    return result;
  },
});

// Check if two users have unlocked messaging via crossed paths
export const checkCrossedPathsUnlock = query({
  args: {
    user1Id: v.id('users'),
    user2Id: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { user1Id, user2Id } = args;
    const now = Date.now();

    // Order user IDs for lookup
    const orderedUser1 = user1Id < user2Id ? user1Id : user2Id;
    const orderedUser2 = user1Id < user2Id ? user2Id : user1Id;

    const crossedPath = await ctx.db
      .query('crossedPaths')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2)
      )
      .first();

    if (!crossedPath) return { isUnlocked: false, count: 0 };

    const isUnlocked = crossedPath.unlockExpiresAt && crossedPath.unlockExpiresAt > now;

    return {
      isUnlocked,
      count: crossedPath.count,
      unlockExpiresAt: crossedPath.unlockExpiresAt,
      unlockTimeRemaining: isUnlocked ? crossedPath.unlockExpiresAt! - now : 0,
    };
  },
});

// Get crossed paths count (for badge)
export const getCrossedPathsCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const asUser1 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect();

    const asUser2 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .collect();

    return asUser1.length + asUser2.length;
  },
});

// Helper functions
function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

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
