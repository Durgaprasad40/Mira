import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';

/**
 * Phase-2 notifications backend.
 *
 * STRICT ISOLATION: This module reads/writes ONLY the `privateNotifications`
 * table. It never touches the Phase-1 `notifications` table. Phase-1 lives
 * in `convex/notifications.ts` and reads only the `notifications` table.
 *
 * The two phases are physically separated at the table level so a failure to
 * filter on the client can never leak rows across the boundary.
 */

// 24h TTL, mirroring Phase-1 conventions
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

async function requirePrivateNotificationUser(
  ctx: QueryCtx | MutationCtx,
  token: string,
  assertedUser?: string | Id<'users'>,
): Promise<Id<'users'>> {
  const userId = await validateSessionToken(ctx, token.trim());
  if (!userId) {
    throw new Error('UNAUTHORIZED');
  }

  if (assertedUser) {
    const assertedUserId = await resolveUserIdByAuthId(ctx, assertedUser as string);
    if (!assertedUserId || assertedUserId !== userId) {
      throw new Error('UNAUTHORIZED');
    }
  }

  return userId;
}

/**
 * Marks Phase-2 inbox rows for a private conversation as read.
 * `privateConversations` IDs are disjoint from `conversations` IDs (different tables),
 * so the dedupeKey is safe.
 */
export async function markPrivateMessageNotificationsForConversation(
  ctx: MutationCtx,
  userId: Id<'users'>,
  privateConversationId: string
): Promise<number> {
  const now = Date.now();
  let count = 0;
  const dedupeKey = `phase2_message:${privateConversationId}:unread`;
  const notification = await ctx.db
    .query('privateNotifications')
    .withIndex('by_user_dedupe', (q) =>
      q.eq('userId', userId).eq('dedupeKey', dedupeKey)
    )
    .first();
  if (notification && !notification.readAt) {
    await ctx.db.patch(notification._id, { readAt: now });
    count++;
  }
  return count;
}

// === QUERIES ===============================================================

// Get Phase-2 notifications for a user
export const getPrivateNotifications = query({
  args: {
    token: v.string(),
    userId: v.optional(v.union(v.id('users'), v.string())),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { limit = 50, unreadOnly = false } = args;

    const userId = await requirePrivateNotificationUser(ctx, args.token, args.userId);

    const now = Date.now();

    let queryBuilder = ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId));

    if (unreadOnly) {
      queryBuilder = queryBuilder.filter((q) => q.eq(q.field('readAt'), undefined));
    }

    queryBuilder = queryBuilder.filter((q) =>
      q.or(
        q.eq(q.field('expiresAt'), undefined),
        q.gt(q.field('expiresAt'), now)
      )
    );

    return await queryBuilder.order('desc').take(limit);
  },
});

// Phase-2 unread count
export const getPrivateUnreadCount = query({
  args: {
    token: v.string(),
    userId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.userId);

    const now = Date.now();
    const notifications = await ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('readAt'), undefined),
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

// Phase-2 bell unread count (excludes message types — they're shown via inbox badge instead)
const BELL_EXCLUDED_TYPES = new Set<string>(['phase2_private_message']);
export const getPrivateBellUnreadCount = query({
  args: {
    token: v.string(),
    userId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.userId);

    const now = Date.now();
    const notifications = await ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('readAt'), undefined),
          q.or(
            q.eq(q.field('expiresAt'), undefined),
            q.gt(q.field('expiresAt'), now)
          )
        )
      )
      .collect();

    let count = 0;
    for (const n of notifications) {
      if (BELL_EXCLUDED_TYPES.has(n.type)) continue;
      count++;
    }
    return count;
  },
});

// === MUTATIONS =============================================================

export const markPrivateNotificationRead = mutation({
  args: {
    token: v.string(),
    notificationId: v.id('privateNotifications'),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.authUserId);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    return { success: true };
  },
});

export const markAllPrivateNotificationsRead = mutation({
  args: { token: v.string(), authUserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.authUserId);

    const now = Date.now();
    const unread = await ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
      .collect();

    for (const n of unread) {
      await ctx.db.patch(n._id, { readAt: now });
    }

    return { success: true, count: unread.length };
  },
});

export const deletePrivateNotification = mutation({
  args: {
    token: v.string(),
    notificationId: v.id('privateNotifications'),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.authUserId);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found');
    }

    await ctx.db.delete(args.notificationId);
    return { success: true };
  },
});

export const deleteAllPrivateNotifications = mutation({
  args: { token: v.string(), authUserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.authUserId);

    const all = await ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    for (const n of all) {
      await ctx.db.delete(n._id);
    }

    return { success: true, count: all.length };
  },
});

export const markPrivateReadForConversation = mutation({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
    privateConversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requirePrivateNotificationUser(ctx, args.token, args.authUserId);

    const count = await markPrivateMessageNotificationsForConversation(
      ctx,
      userId,
      args.privateConversationId
    );
    return { success: true, count };
  },
});

// === INTERNAL CLEANUP =====================================================

export const cleanupExpiredPrivateNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('privateNotifications')
      .withIndex('by_expires')
      .filter((q) =>
        q.and(
          q.neq(q.field('expiresAt'), undefined),
          q.lte(q.field('expiresAt'), now)
        )
      )
      .take(100);

    let deletedCount = 0;
    for (const n of expired) {
      await ctx.db.delete(n._id);
      deletedCount++;
    }

    return { deletedCount, hasMore: expired.length === 100 };
  },
});

// Re-export TTL for producers that schedule expiresAt
export const PRIVATE_NOTIFICATION_TTL_MS = NOTIFICATION_TTL_MS;

// Push-notification side-channel hook (parity with Phase-1 createNotification).
// Producers should call ctx.scheduler.runAfter(0, internal.pushNotifications.send, ...) directly
// after inserting; we expose the dispatch helper for convenience.
export async function dispatchPrivatePush(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    title: string;
    body: string;
    type: string;
    data?: Record<string, unknown> | null;
  }
) {
  await ctx.scheduler.runAfter(0, internal.pushNotifications.send, {
    userId: args.userId,
    title: args.title,
    body: args.body,
    data: args.data ?? null,
    type: args.type,
  });
}
