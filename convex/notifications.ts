import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId } from './helpers';

// 4-2: Notification TTL (24 hours in milliseconds)
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

type NotificationData = {
  actorUserId?: string;
  targetUserId?: string;
  matchId?: string;
  conversationId?: string;
  userId?: string;
  pairKey?: string;
  likeType?: 'like' | 'super_like';
};

function normalizeNotificationData(
  data: NotificationData | undefined,
  targetUserId?: string
): NotificationData | undefined {
  if (!data && !targetUserId) {
    return undefined;
  }

  const actorUserId = data?.actorUserId ?? data?.userId;
  const normalizedTargetUserId = data?.targetUserId ?? targetUserId;

  return {
    ...data,
    actorUserId,
    targetUserId: normalizedTargetUserId,
  };
}

// Get notifications for a user
// 4-3: Filters out expired notifications server-side to prevent render race
export const getNotifications = query({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { limit = 50, unreadOnly = false } = args;

    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getNotifications] User not found for authUserId:', args.userId);
      return [];
    }

    const now = Date.now();

    let queryBuilder = ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId));

    if (unreadOnly) {
      queryBuilder = queryBuilder.filter((q) => q.eq(q.field('readAt'), undefined));
    }

    // 4-3: Filter out expired notifications (older than 24h or past expiresAt)
    queryBuilder = queryBuilder.filter((q) =>
      q.or(
        q.eq(q.field('expiresAt'), undefined),
        q.gt(q.field('expiresAt'), now)
      )
    );

    const notifications = await queryBuilder.order('desc').take(limit);
    return notifications.map((notification) => ({
      ...notification,
      data: normalizeNotificationData(notification.data as NotificationData | undefined, notification.userId as string),
    }));
  },
});

// Get unread notification count
// 4-3: Filters out expired notifications server-side
export const getUnreadCount = query({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getUnreadCount] User not found for authUserId:', args.userId);
      return 0;
    }

    const now = Date.now();
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('readAt'), undefined),
          // 4-3: Only count non-expired notifications
          q.or(
            q.eq(q.field('expiresAt'), undefined),
            q.gt(q.field('expiresAt'), now)
          )
        )
      )
      .collect();

    return notifications.length;
  },
});

// Mark notification as read
// P1 SECURITY: Use authUserId + server-side resolution to prevent spoofing
export const markAsRead = mutation({
  args: {
    notificationId: v.id('notifications'),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { notificationId, authUserId } = args;

    // P1 SECURITY: Resolve auth ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    await ctx.db.patch(notificationId, {
      readAt: Date.now(),
    });

    return { success: true };
  },
});

// Mark all notifications as read
export const markAllAsRead = mutation({
  args: {
    authUserId: v.string(), // AUTH FIX: Server-side auth instead of trusting client
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;
    const now = Date.now();

    // AUTH FIX: Resolve acting user from server-side auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const unreadNotifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
      .collect();

    for (const notification of unreadNotifications) {
      await ctx.db.patch(notification._id, { readAt: now });
    }

    return { success: true, count: unreadNotifications.length };
  },
});

// 4-1: Create or update notification with deduplication
// If a notification with the same dedupeKey exists, it is updated (refreshed).
// Otherwise a new notification is created.
export const createNotification = mutation({
  args: {
    userId: v.id('users'),
    type: v.union(
      v.literal('match'),
      v.literal('message'),
      v.literal('like'),
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh'),
      v.literal('profile_nudge')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      actorUserId: v.optional(v.string()),
      targetUserId: v.optional(v.string()),
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      pairKey: v.optional(v.string()),
      likeType: v.optional(v.union(v.literal('like'), v.literal('super_like'))),
    })),
    // 4-1: Optional dedupeKey for upsert behavior
    dedupeKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, type, title, body, dedupeKey } = args;
    const data = normalizeNotificationData(args.data as NotificationData | undefined, userId as string);
    const now = Date.now();
    const expiresAt = now + NOTIFICATION_TTL_MS; // 4-2: Set expiry

    // 4-1: If dedupeKey is provided, check for existing notification
    if (dedupeKey) {
      const existing = await ctx.db
        .query('notifications')
        .withIndex('by_user_dedupe', (q) =>
          q.eq('userId', userId).eq('dedupeKey', dedupeKey)
        )
        .first();

      if (existing) {
        // 4-1: Update existing notification (refresh timestamp, unread, update content)
        await ctx.db.patch(existing._id, {
          title,
          body,
          data,
          createdAt: now,
          expiresAt,
          readAt: undefined, // Mark as unread again
        });
        return { success: true, notificationId: existing._id, updated: true };
      }
    }

    // Create new notification
    const notificationId = await ctx.db.insert('notifications', {
      userId,
      type,
      title,
      body,
      data,
      dedupeKey,
      createdAt: now,
      expiresAt, // 4-2: Set expiry timestamp
    });

    // TODO: Send push notification via Expo
    // This would typically be done in an action that calls Expo's push API

    return { success: true, notificationId, updated: false };
  },
});

// Compute dedupeKey from notification type and data (matches client-side logic)
function computeDedupeKey(type: string, data?: NotificationData): string {
  const actorUserId = data?.actorUserId ?? data?.userId;
  switch (type) {
    case 'match':
      return `match:${data?.matchId ?? actorUserId ?? 'unknown'}`;
    case 'message':
      return `message:${data?.conversationId ?? actorUserId ?? 'unknown'}:unread`;
    case 'like':
      return `like:${actorUserId ?? 'unknown'}`;
    case 'super_like':
      return `super_like:${actorUserId ?? 'unknown'}`;
    case 'crossed_paths':
      // Use pairKey if available (deterministic sorted pair format), fallback to userId
      return data?.pairKey ?? `crossed_paths:${actorUserId ?? 'unknown'}`;
    default:
      return `${type}:unknown`;
  }
}

// Mark notifications by dedupeKey as read (A1 fix)
// P1 SECURITY: Use authUserId + server-side resolution to prevent spoofing
export const markReadByDedupeKey = mutation({
  args: {
    authUserId: v.string(),
    dedupeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId, dedupeKey } = args;
    const now = Date.now();

    // P1 SECURITY: Resolve auth ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Find unread notifications matching the dedupeKey
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
      .collect();

    let count = 0;
    for (const notification of notifications) {
      const notifDedupeKey =
        notification.dedupeKey ??
        computeDedupeKey(
          notification.type,
          normalizeNotificationData(notification.data as NotificationData | undefined, notification.userId as string)
        );
      if (notifDedupeKey === dedupeKey) {
        await ctx.db.patch(notification._id, { readAt: now });
        count++;
      }
    }

    return { success: true, count };
  },
});

// Mark message notifications for a conversation as read (A2 fix)
// D2/D4: Use dedupeKey index for efficient lookup instead of scanning all notifications
// P1 SECURITY: Use authUserId + server-side resolution to prevent spoofing
export const markReadForConversation = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId, conversationId } = args;
    const now = Date.now();

    // P1 SECURITY: Resolve auth ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // D2/D4: Use dedupeKey format matching messages.ts: `message:${conversationId}:unread`
    const dedupeKey = `message:${conversationId}:unread`;

    // Use by_user_dedupe index for direct lookup
    const notification = await ctx.db
      .query('notifications')
      .withIndex('by_user_dedupe', (q) =>
        q.eq('userId', userId).eq('dedupeKey', dedupeKey)
      )
      .first();

    if (notification && !notification.readAt) {
      await ctx.db.patch(notification._id, { readAt: now });
      return { success: true, count: 1 };
    }

    return { success: true, count: 0 };
  },
});

// Delete notification
// P1 SECURITY: Use authUserId + server-side resolution to prevent spoofing
export const deleteNotification = mutation({
  args: {
    notificationId: v.id('notifications'),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { notificationId, authUserId } = args;

    // P1 SECURITY: Resolve auth ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    await ctx.db.delete(notificationId);
    return { success: true };
  },
});

// Delete all notifications
// P1 SECURITY: Use authUserId + server-side resolution to prevent spoofing
export const deleteAllNotifications = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;

    // P1 SECURITY: Resolve auth ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
    }

    return { success: true, count: notifications.length };
  },
});

// Send weekly refresh notification (for cron job)
export const sendWeeklyRefreshNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiresAt = now + NOTIFICATION_TTL_MS;

    // Find male users whose messages have been reset
    const users = await ctx.db.query('users').collect();
    let sentCount = 0;

    for (const user of users) {
      if (user.gender !== 'male') continue;
      if (!user.notificationsEnabled) continue;

      // Check if it's time to send weekly notification
      // This would typically be triggered by a cron job when messages reset
      if (user.messagesResetAt <= now && user.messagesResetAt > now - 60000) {
        await ctx.db.insert('notifications', {
          userId: user._id,
          type: 'weekly_refresh',
          title: 'Weekly Messages Refreshed!',
          body: 'Your weekly messages have been reset. Start connecting!',
          dedupeKey: `weekly_refresh:${new Date(now).toDateString()}`, // 4-1: One per day
          createdAt: now,
          expiresAt, // 4-2: Set expiry
        });
        sentCount++;
      }
    }

    return { sentCount };
  },
});

// 4-2: Cleanup expired notifications (called by cron)
// Uses internalMutation so it's only callable by cron, not by clients
export const cleanupExpiredNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all expired notifications using the by_expires index
    // Query for expiresAt <= now (expired)
    const expired = await ctx.db
      .query('notifications')
      .withIndex('by_expires')
      .filter((q) =>
        q.and(
          q.neq(q.field('expiresAt'), undefined),
          q.lte(q.field('expiresAt'), now)
        )
      )
      .take(100); // Process in batches to avoid timeout

    let deletedCount = 0;
    for (const notification of expired) {
      await ctx.db.delete(notification._id);
      deletedCount++;
    }

    return { deletedCount, hasMore: expired.length === 100 };
  },
});
