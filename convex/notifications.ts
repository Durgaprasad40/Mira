import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { Id } from './_generated/dataModel';

// 4-2: Notification TTL (24 hours in milliseconds)
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

// Get notifications for a user
// 4-3: Filters out expired notifications server-side to prevent render race
export const getNotifications = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50, unreadOnly = false } = args;
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

    return await queryBuilder.order('desc').take(limit);
  },
});

// Get unread notification count
// 4-3: Filters out expired notifications server-side
export const getUnreadCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
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
export const markAsRead = mutation({
  args: {
    notificationId: v.id('notifications'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { notificationId, userId } = args;

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
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    const now = Date.now();

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
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh'),
      v.literal('profile_nudge')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
    })),
    // 4-1: Optional dedupeKey for upsert behavior
    dedupeKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, type, title, body, data, dedupeKey } = args;
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
function computeDedupeKey(type: string, data?: { matchId?: string; conversationId?: string; userId?: string }): string {
  const userId = data?.userId;
  switch (type) {
    case 'match':
      return `match:${data?.matchId ?? userId ?? 'unknown'}`;
    case 'message':
      return `message:${data?.conversationId ?? userId ?? 'unknown'}`;
    case 'super_like':
      return `super_like:${userId ?? 'unknown'}`;
    case 'crossed_paths':
      return `crossed_paths:${userId ?? 'unknown'}`;
    default:
      return `${type}:unknown`;
  }
}

// Mark notifications by dedupeKey as read (A1 fix)
export const markReadByDedupeKey = mutation({
  args: {
    userId: v.id('users'),
    dedupeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, dedupeKey } = args;
    const now = Date.now();

    // Find unread notifications matching the dedupeKey
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
      .collect();

    let count = 0;
    for (const notification of notifications) {
      // Compute dedupeKey from type+data
      const notifDedupeKey = computeDedupeKey(notification.type, notification.data);
      if (notifDedupeKey === dedupeKey) {
        await ctx.db.patch(notification._id, { readAt: now });
        count++;
      }
    }

    return { success: true, count };
  },
});

// Mark message notifications for a conversation as read (A2 fix)
export const markReadForConversation = mutation({
  args: {
    userId: v.id('users'),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, conversationId } = args;
    const now = Date.now();

    // Find unread message notifications for this conversation
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('type'), 'message'),
          q.eq(q.field('readAt'), undefined)
        )
      )
      .collect();

    let count = 0;
    for (const notification of notifications) {
      // Check if this notification is for the given conversation
      if (notification.data?.conversationId === conversationId) {
        await ctx.db.patch(notification._id, { readAt: now });
        count++;
      }
    }

    return { success: true, count };
  },
});

// Delete notification
export const deleteNotification = mutation({
  args: {
    notificationId: v.id('notifications'),
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { notificationId, userId } = args;

    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    await ctx.db.delete(notificationId);
    return { success: true };
  },
});

// Delete all notifications
export const deleteAllNotifications = mutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

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
