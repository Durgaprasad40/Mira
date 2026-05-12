import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { bellNotificationCountsForPhase } from './notificationBellPhase';

// Server-side Phase-1 row guard. A row is Phase-1 iff:
//   - phase is undefined (legacy rows) AND type is not a legacy phase2_* type, OR
//   - phase === 'phase1'
// New code must always set phase: 'phase1' on insert.
const PHASE2_LEGACY_TYPES = new Set<string>([
  'phase2_match',
  'phase2_like',
  'phase2_private_message',
  'phase2_deep_connect',
  'phase2_chat_room',
]);

function isPhase1Row(row: { phase?: string | null; type: string }): boolean {
  if (row.phase === 'phase1') return true;
  if (row.phase === 'phase2') return false;
  return !PHASE2_LEGACY_TYPES.has(row.type);
}

async function shouldSurfacePhase1Notification(
  ctx: QueryCtx,
  row: Doc<'notifications'>,
): Promise<boolean> {
  if (!isPhase1Row(row)) return false;
  if (row.type !== 'crossed_paths') return true;

  const otherUserId = row.data?.userId ?? row.data?.otherUserId;
  if (!otherUserId) return true;

  let otherUser: Doc<'users'> | null = null;
  try {
    otherUser = await ctx.db.get(otherUserId as Id<'users'>);
  } catch {
    otherUser = null;
  }

  if (!otherUser) {
    const resolvedOtherUserId = await resolveUserIdByAuthId(ctx, otherUserId);
    if (resolvedOtherUserId) {
      otherUser = await ctx.db.get(resolvedOtherUserId);
    }
  }

  return otherUser?.incognitoMode !== true;
}

/**
 * Marks Phase-1 in-app inbox rows for a conversation.
 * Phase-2 rows live in `privateNotifications` and are handled by `markPrivateMessageNotificationsForConversation`.
 */
export async function markInboxMessageNotificationsForConversation(
  ctx: MutationCtx,
  userId: Id<'users'>,
  conversationId: string
): Promise<number> {
  const now = Date.now();
  let count = 0;
  const dedupeKey = `message:${conversationId}:unread`;
  const notification = await ctx.db
    .query('notifications')
    .withIndex('by_user_dedupe', (q) => q.eq('userId', userId).eq('dedupeKey', dedupeKey))
    .first();
  if (notification && !notification.readAt) {
    await ctx.db.patch(notification._id, { readAt: now });
    count++;
  }
  return count;
}

// 4-2: Notification TTL (24 hours in milliseconds)
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

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

    const rows = await queryBuilder.order('desc').take(limit * 2);
    // Strict Phase-1 isolation enforced server-side
    const visibleRows = [];
    for (const row of rows) {
      if (await shouldSurfacePhase1Notification(ctx, row)) {
        visibleRows.push(row);
      }
      if (visibleRows.length >= limit) break;
    }
    return visibleRows;
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

    // Strict Phase-1 isolation + Nearby Incognito suppression for crossed-path rows.
    let count = 0;
    for (const notification of notifications) {
      if (await shouldSurfacePhase1Notification(ctx, notification)) {
        count++;
      }
    }
    return count;
  },
});

// Get bell notification unread count (for tab badge) - PHASE-1 ONLY.
// Phase-2 callers must use `api.privateNotifications.getPrivateBellUnreadCount` instead.
export const getBellUnreadCount = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
    // Argument retained for backwards compatibility; this query is Phase-1 only.
    phase: v.optional(v.union(v.literal('phase1'), v.literal('phase2'))),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      return 0;
    }

    if (args.phase === 'phase2') {
      // Hard guard: Phase-2 must use privateNotifications.getPrivateBellUnreadCount
      console.warn('[getBellUnreadCount] Phase-2 called Phase-1 query; returning 0');
      return 0;
    }

    const now = Date.now();
    const notifications = await ctx.db
      .query('notifications')
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
      if (!(await shouldSurfacePhase1Notification(ctx, n))) continue;
      if (bellNotificationCountsForPhase(n.type, 'phase1')) {
        count++;
      }
    }
    return count;
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

    // Strict Phase-1 isolation: only mark Phase-1 rows
    let count = 0;
    for (const notification of unreadNotifications) {
      if (!isPhase1Row(notification)) continue;
      await ctx.db.patch(notification._id, { readAt: now });
      count++;
    }

    return { success: true, count };
  },
});

// 4-1: Create or update notification with deduplication
// If a notification with the same dedupeKey exists, it is updated (refreshed).
// Otherwise a new notification is created.
export const createNotification = internalMutation({
  args: {
    userId: v.id('users'),
    type: v.union(
      v.literal('match'),
      v.literal('message'),
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh'),
      v.literal('profile_nudge'),
      // Phase-1 confession surface — tagged-confession bell item.
      v.literal('tagged_confession'),
      v.literal('confession_connect_requested'),
      v.literal('confession_connect_accepted'),
      v.literal('confession_connect_rejected')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      // Tagged-confession deep-link payload. Body text never references this
      // id; opening the notification routes to /(main)/confession-thread.
      confessionId: v.optional(v.string()),
      connectId: v.optional(v.string()),
      fromUserId: v.optional(v.string()),
      otherUserId: v.optional(v.string()),
      source: v.optional(v.string()),
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
          phase: 'phase1',
          createdAt: now,
          expiresAt,
          readAt: undefined, // Mark as unread again
        });
        return { success: true, notificationId: existing._id, updated: true };
      }
    }

    // Create new Phase-1 notification (server-tagged)
    const notificationId = await ctx.db.insert('notifications', {
      userId,
      type,
      title,
      body,
      data,
      phase: 'phase1',
      dedupeKey,
      createdAt: now,
      expiresAt, // 4-2: Set expiry timestamp
    });

    await ctx.scheduler.runAfter(0, internal.pushNotifications.send, {
      userId,
      title,
      body,
      data: data ?? null,
      type,
    });

    return { success: true, notificationId, updated: false };
  },
});

// Compute dedupeKey from notification type and data (matches client-side logic)
function computeDedupeKey(
  type: string,
  data?: {
    matchId?: string;
    conversationId?: string;
    userId?: string;
    pairKey?: string;
    confessionId?: string;
    connectId?: string;
    otherUserId?: string;
  }
): string {
  const userId = data?.userId;
  switch (type) {
    case 'match':
      return `match:${data?.matchId ?? userId ?? 'unknown'}`;
    case 'message':
      return `message:${data?.conversationId ?? userId ?? 'unknown'}`;
    case 'super_like':
      return `super_like:${userId ?? 'unknown'}`;
    case 'crossed_paths':
      // Use pairKey if available (deterministic sorted pair format), fallback to userId
      return data?.pairKey ?? `crossed_paths:${userId ?? 'unknown'}`;
    case 'tagged_confession':
      return `tagged_confession:${data?.confessionId ?? 'unknown'}`;
    case 'confession_connect_requested':
      return `confession_connect_requested:${data?.connectId ?? 'unknown'}`;
    case 'confession_connect_accepted':
      return `confession_connect_accepted:${data?.connectId ?? 'unknown'}`;
    case 'confession_connect_rejected':
      return `confession_connect_rejected:${data?.connectId ?? 'unknown'}`;
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

    // Find unread Phase-1 notifications matching the dedupeKey
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
      .collect();

    let count = 0;
    for (const notification of notifications) {
      if (!isPhase1Row(notification)) continue;
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
// D2/D4: Use dedupeKey index for efficient lookup instead of scanning all notifications
// P1 SECURITY: Use authUserId + server-side resolution to prevent spoofing
export const markReadForConversation = mutation({
  args: {
    token: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { token, conversationId } = args;

    const sessionToken = token.trim();
    const userId = sessionToken ? await validateSessionToken(ctx, sessionToken) : null;
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Phase-1 `message:` + Phase-2 `phase2_message:` (private chat); disjoint conversation IDs
    const count = await markInboxMessageNotificationsForConversation(ctx, userId, conversationId);

    return { success: true, count };
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

    // Strict Phase-1 isolation: only delete Phase-1 rows
    let count = 0;
    for (const notification of notifications) {
      if (!isPhase1Row(notification)) continue;
      await ctx.db.delete(notification._id);
      count++;
    }

    return { success: true, count };
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
          phase: 'phase1',
          dedupeKey: `weekly_refresh:${new Date(now).toDateString()}`, // 4-1: One per day
          createdAt: now,
          expiresAt, // 4-2: Set expiry
        });
        await ctx.scheduler.runAfter(0, internal.pushNotifications.send, {
          userId: user._id,
          title: 'Weekly Messages Refreshed!',
          body: 'Your weekly messages have been reset. Start connecting!',
          data: null,
          type: 'weekly_refresh',
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
