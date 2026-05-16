import { v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { reserveActionSlots } from './actionRateLimits';

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

// P1-RL-04: Hard cap on the number of notification rows a single mass-action
// call may touch. Prevents unbounded `.collect()` fan-out from burning quota
// or producing per-mutation timeouts when a user has accumulated thousands
// of rows. When the limit is hit, callers receive `hasMore: true` and may
// re-invoke (subject to the per-action rate limits below) to drain the
// remainder. Mirrors the Phase-1 `msg_mark_all_delivered` bounded-scan
// pattern.
const MAX_NOTIFICATION_MASS_BATCH = 200;

// P2-PERF-01: Bound on the row-scan performed by the unread-count queries
// (`getPrivateUnreadCount`, `getPrivateBellUnreadCount`). The legacy
// implementation used an unbounded `.collect()` over a per-user index with a
// TTL filter, so a user who somehow accumulated thousands of unread rows (e.g.
// a notification-fanout bug, or a quiet account that never opened the bell)
// would have caused every count read to scan the entire backlog on each call.
// The mobile UI surfaces "99+" beyond this threshold, so scanning more rows
// than the cap is pure waste. Callers that hit the cap will simply see
// MAX_NOTIFICATION_COUNT_SCAN as the returned count, which is the same as
// "99+" in the UI. The TTL cleanup job (`cleanupExpiredPrivateNotifications`)
// is what actually shrinks the backlog over time; this cap is the read-side
// safety net.
const MAX_NOTIFICATION_COUNT_SCAN = 200;

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
    // P2-PERF-01: Bounded scan. Capped at MAX_NOTIFICATION_COUNT_SCAN to avoid
    // unbounded `.collect()` over per-user notifications. UI displays "99+"
    // beyond ~99, so a hard cap of 200 is well above what any display surface
    // consumes while preventing pathological scans.
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
      .take(MAX_NOTIFICATION_COUNT_SCAN);

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
    // P2-PERF-01: Bounded scan. Same MAX_NOTIFICATION_COUNT_SCAN ceiling as
    // `getPrivateUnreadCount`. Note: because we then filter by
    // `BELL_EXCLUDED_TYPES` post-scan, the displayed bell count can be lower
    // than the cap even when the cap is reached. This matches the existing
    // semantics (message-type rows always excluded from the bell badge); the
    // only behavior change is that we no longer scan an unbounded backlog to
    // discover that fact.
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
      .take(MAX_NOTIFICATION_COUNT_SCAN);

    let count = 0;
    for (const n of notifications) {
      if (BELL_EXCLUDED_TYPES.has(n.type)) continue;
      count++;
    }
    return count;
  },
});

// === MUTATIONS =============================================================

/**
 * Mark a single Phase-2 notification as read.
 *
 * SECURITY CONTRACT:
 *   - Identity is bound to the session token; `authUserId` is an assertion
 *     hint only and is cross-checked against the token-resolved user.
 *   - The notification row's `userId` MUST match the resolved viewer. The
 *     deliberately vague "Notification not found" error is shared between
 *     "row doesn't exist" and "row belongs to someone else" so an enumeration
 *     attacker cannot distinguish the two via the error channel.
 *   - This mutation is idempotent (patches `readAt` to now even if already
 *     read), so it is safe to call without an unread-check round-trip.
 */
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

    // P1-RL-04: Per-user rate limit on this mass-action. Each call can patch up
    // to MAX_NOTIFICATION_MASS_BATCH rows; an attacker firing this in a loop
    // would burn DB quota linearly with each call without the limiter. The cap
    // is well above any realistic user pattern (manual button tap), and on
    // denial we mirror the Phase-1 silent no-op so debounced clients do not
    // surface user-facing errors.
    const limit = await reserveActionSlots(ctx, userId, 'p2_mark_all_notif_read', [
      { kind: '1min', windowMs: 60_000, max: 5 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 60 },
    ]);
    if (!limit.accept) {
      return { success: false, count: 0, hasMore: false };
    }

    const now = Date.now();
    // P1-RL-04: Bounded scan. `.collect()` is replaced with `.take(MAX_BATCH)`
    // so a single call can never patch more than MAX_NOTIFICATION_MASS_BATCH
    // rows. If more remain, the caller receives `hasMore: true` and may
    // re-invoke (subject to the rate limit above) to drain the remainder.
    const unread = await ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('readAt'), undefined))
      .take(MAX_NOTIFICATION_MASS_BATCH);

    for (const n of unread) {
      await ctx.db.patch(n._id, { readAt: now });
    }

    return {
      success: true,
      count: unread.length,
      hasMore: unread.length === MAX_NOTIFICATION_MASS_BATCH,
    };
  },
});

/**
 * Delete a single Phase-2 notification.
 *
 * SECURITY CONTRACT:
 *   - Same ownership rules as `markPrivateNotificationRead` above — row
 *     `userId` MUST match the token-resolved viewer; shared "not found"
 *     error prevents enumeration.
 *   - This is a hard delete (no soft-delete column). Deduped notifications
 *     reuse the same row via `dedupeKey`, so deleting here means a future
 *     event of the same shape will create a fresh row, not resurrect the
 *     deleted one.
 *   - No rate limit on the single-delete path — mass delete lives in
 *     `deleteAllPrivateNotifications` and is gated by `p2_delete_all_notif`
 *     (see P1-RL-04).
 */
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

    // P1-RL-04: Stricter per-user rate limit than mark-all because each
    // accepted call deletes up to MAX_NOTIFICATION_MASS_BATCH rows (permanent
    // data loss vs. an idempotent read-marker patch). Silent denial on
    // overflow returns `hasMore: false` so retry loops don't busy-spin.
    const limit = await reserveActionSlots(ctx, userId, 'p2_delete_all_notif', [
      { kind: '1min', windowMs: 60_000, max: 5 },
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 30 },
    ]);
    if (!limit.accept) {
      return { success: false, count: 0, hasMore: false };
    }

    // P1-RL-04: Bounded scan — `.collect()` replaced with `.take(MAX_BATCH)`.
    // Callers must re-invoke (subject to the rate limit) to drain remaining
    // rows. This prevents a single mutation from fanning out unbounded
    // deletes.
    const all = await ctx.db
      .query('privateNotifications')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(MAX_NOTIFICATION_MASS_BATCH);

    for (const n of all) {
      await ctx.db.delete(n._id);
    }

    return {
      success: true,
      count: all.length,
      hasMore: all.length === MAX_NOTIFICATION_MASS_BATCH,
    };
  },
});

/**
 * Mark Phase-2 inbox row(s) for a private conversation as read.
 *
 * SECURITY CONTRACT:
 *   - Identity is bound to the session token. The viewer can only mark
 *     notifications addressed to themselves (the `markPrivateMessageNotifications
 *     ForConversation` helper queries by (viewerId, dedupeKey) — there is no
 *     path to mark another user's inbox).
 *   - `privateConversationId` is intentionally untyped (string) at the args
 *     boundary because the dedupeKey treats it as an opaque token. The
 *     ownership check above is the IDOR safeguard — we do NOT need to assert
 *     the viewer is a participant in the conversation, because we only ever
 *     patch rows whose `userId` is already the viewer.
 *   - Phase-2 isolation: the dedupeKey is namespaced (`phase2_message:...`)
 *     and the helper queries only `privateNotifications`, never the Phase-1
 *     `notifications` table.
 */
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
