import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Get notifications for a user
export const getNotifications = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50, unreadOnly = false } = args;

    let query = ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId));

    if (unreadOnly) {
      query = query.filter((q) => q.eq(q.field('readAt'), undefined));
    }

    return await query.order('desc').take(limit);
  },
});

// Get unread notification count
export const getUnreadCount = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
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

// Create notification (internal use)
export const createNotification = mutation({
  args: {
    userId: v.id('users'),
    type: v.union(
      v.literal('match'),
      v.literal('message'),
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { userId, type, title, body, data } = args;

    const notificationId = await ctx.db.insert('notifications', {
      userId,
      type,
      title,
      body,
      data,
      createdAt: Date.now(),
    });

    // TODO: Send push notification via Expo
    // This would typically be done in an action that calls Expo's push API

    return { success: true, notificationId };
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
          createdAt: now,
        });
        sentCount++;
      }
    }

    return { sentCount };
  },
});
