import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import { create } from 'zustand';

/**
 * Notification shape used by the UI.
 * In Convex mode these come from the notifications table.
 * In demo mode they are seeded locally via Zustand store.
 */
export interface AppNotification {
  _id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string | undefined>;
  createdAt: number;
  readAt?: number;
  /** Derived convenience flag for the UI */
  isRead: boolean;
  /** Stable key used for deduplication — same key = same logical event. */
  dedupeKey?: string;
}

/**
 * Input for creating a notification via the deduping `addNotification` action.
 * Callers provide the notification fields; the store computes `dedupeKey`
 * from `type` + `data` and either updates an existing notification or
 * prepends a new one.
 */
export interface AddNotificationInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, string | undefined>;
}

// ── Dedupe key computation ─────────────────────────────────────
// Deterministic key per logical event so the same event doesn't create
// duplicate rows.  Key schema:
//   match_created     → "match:<otherUserId>"
//   like_received     → "like:daily"  (aggregated per day)
//   super_like_received → "super_like:<otherUserId>"
//   crossed_paths     → "crossed_paths:<otherUserId>"
//   profile_viewed    → "view:daily"  (aggregated per day)
//   message           → "message:<conversationId>"
//   system            → "system:<slug>"
//   confession_*      → "confession_<sub>:<confessionId>"
//   fallback          → "<type>:<timestamp>"  (no dedupe — always unique)
function computeDedupeKey(type: string, data?: Record<string, string | undefined>): string {
  const userId = data?.otherUserId ?? data?.userId;
  switch (type) {
    case 'match':
    case 'new_match':
    case 'match_created':
      return `match:${userId ?? 'unknown'}`;
    case 'like':
    case 'like_received':
      // Aggregate all likes into a single daily notification
      return 'like:daily';
    case 'super_like':
    case 'superlike':
    case 'super_like_received':
      return `super_like:${userId ?? 'unknown'}`;
    case 'message':
    case 'new_message':
      return `message:${data?.conversationId ?? userId ?? 'unknown'}`;
    case 'crossed_paths':
      return `crossed_paths:${userId ?? 'unknown'}`;
    case 'profile_viewed':
      // Aggregate all views into a single daily notification
      return 'view:daily';
    case 'system':
      return `system:${data?.slug ?? 'general'}`;
    case 'confession_reaction':
      return `confession_reaction:${data?.confessionId ?? 'unknown'}`;
    case 'confession_reply':
      return `confession_reply:${data?.confessionId ?? 'unknown'}`;
    default:
      return `${type}:${Date.now()}`;
  }
}

// ── Rate limiting ──────────────────────────────────────────────
// Max notifications per type per calendar day. When exceeded, the existing
// daily aggregate notification is updated instead of creating new ones.
const MAX_PER_TYPE_PER_DAY = 3;

function todayKey(): string {
  return new Date().toDateString();
}

/** Count how many notifications of a given type were created today. */
function countTodayByType(notifications: AppNotification[], type: string): number {
  const today = new Date().setHours(0, 0, 0, 0);
  return notifications.filter((n) => n.type === type && n.createdAt >= today).length;
}

/** Check if a type is rate-limited (already hit daily cap). */
function isRateLimited(notifications: AppNotification[], type: string): boolean {
  return countTodayByType(notifications, type) >= MAX_PER_TYPE_PER_DAY;
}

// ── Demo seed data ──────────────────────────────────────────────
function createDemoNotifications(): AppNotification[] {
  const now = Date.now();
  return [
    {
      _id: 'demo_notif_1',
      type: 'crossed_paths',
      title: 'Crossed paths',
      body: 'You crossed paths with Sarah nearby.',
      data: { otherUserId: 'demo_sarah' },
      createdAt: now - 10 * 60 * 1000,
      isRead: false,
      dedupeKey: 'crossed_paths:demo_sarah',
    },
    {
      _id: 'demo_notif_2',
      type: 'like_received',
      title: 'New likes',
      body: '3 people liked you today.',
      data: { count: '3' },
      createdAt: now - 30 * 60 * 1000,
      isRead: false,
      dedupeKey: 'like:daily',
    },
    {
      _id: 'demo_notif_3',
      type: 'super_like_received',
      title: 'Super Like',
      body: 'Someone super-liked you!',
      data: { otherUserId: 'demo_someone' },
      createdAt: now - 3 * 60 * 60 * 1000,
      isRead: true,
      readAt: now - 2 * 60 * 60 * 1000,
      dedupeKey: 'super_like:demo_someone',
    },
  ];
}

// ── Notification expiry ─────────────────────────────────────────
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Check if a notification is expired (older than 24 hours). */
function isExpired(notification: AppNotification, now: number = Date.now()): boolean {
  return now - notification.createdAt > NOTIFICATION_TTL_MS;
}

// ── Zustand store for demo-mode notifications (shared across screens) ──
interface DemoNotifStore {
  notifications: AppNotification[];
  markAllRead: () => void;
  markRead: (id: string) => void;
  markReadByDedupeKey: (dedupeKey: string) => void;
  markReadForConversation: (conversationId: string) => void;
  /**
   * Add or update a notification with automatic deduplication.
   * If a notification with the same dedupeKey already exists, it is
   * updated in-place (createdAt refreshed, isRead reset to false,
   * title/body/data merged). Otherwise a new notification is prepended.
   */
  addNotification: (input: AddNotificationInput) => void;
  /**
   * Remove notifications older than 24 hours.
   * Call this on app start and when opening the notification list.
   */
  cleanupExpiredNotifications: (now?: number) => void;
  /** Clear all notifications. */
  reset: () => void;
}

export const useDemoNotifStore = create<DemoNotifStore>((set) => ({
  notifications: createDemoNotifications(),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.isRead ? n : { ...n, isRead: true, readAt: Date.now() },
      ),
    })),
  markRead: (id: string) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n._id === id ? { ...n, isRead: true, readAt: Date.now() } : n,
      ),
    })),
  markReadByDedupeKey: (dedupeKey: string) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.dedupeKey === dedupeKey && !n.isRead
          ? { ...n, isRead: true, readAt: Date.now() }
          : n,
      ),
    })),
  markReadForConversation: (conversationId: string) =>
    set((state) => {
      const key = `message:${conversationId}`;
      return {
        notifications: state.notifications.map((n) =>
          n.dedupeKey === key && !n.isRead
            ? { ...n, isRead: true, readAt: Date.now() }
            : n,
        ),
      };
    }),
  addNotification: (input: AddNotificationInput) =>
    set((state) => {
      const now = Date.now();
      const key = computeDedupeKey(input.type, input.data);
      const existingIdx = state.notifications.findIndex((n) => n.dedupeKey === key);

      // ── Daily aggregation for like_received and profile_viewed ──
      // These types use a single "daily" dedupeKey. When a new event
      // arrives, we increment the count in the existing notification
      // rather than creating a new row.
      const isAggregated = key === 'like:daily' || key === 'view:daily';

      if (existingIdx >= 0) {
        const existing = state.notifications[existingIdx];

        // For aggregated types, bump the count and update the body
        let mergedData = { ...existing.data, ...input.data };
        let body = input.body;
        if (isAggregated) {
          const prevCount = parseInt(existing.data?.count ?? '1', 10);
          const newCount = prevCount + 1;
          mergedData = { ...mergedData, count: String(newCount) };
          if (input.type === 'like_received' || input.type === 'like') {
            body = newCount === 1 ? 'Someone liked you.' : `${newCount} people liked you today.`;
          } else if (input.type === 'profile_viewed') {
            body = newCount === 1 ? 'Someone viewed your profile.' : `${newCount} people viewed your profile today.`;
          }
        }

        const updated: AppNotification = {
          ...existing,
          title: input.title,
          body,
          data: mergedData,
          createdAt: now,
          readAt: undefined,
          isRead: false,
          dedupeKey: key,
        };
        const rest = state.notifications.filter((_, i) => i !== existingIdx);
        if (__DEV__) console.log(`[DemoNotifStore] dedupe hit key=${key} — updating existing`);
        return { notifications: [updated, ...rest] };
      }

      // ── Rate limiting: if type already hit daily cap, force-aggregate ──
      if (!isAggregated && isRateLimited(state.notifications, input.type)) {
        if (__DEV__) console.log(`[DemoNotifStore] rate-limited type=${input.type} — skipping`);
        return {};
      }

      // New notification (for aggregated types, start count at 1)
      const data = isAggregated
        ? { ...input.data, count: input.data?.count ?? '1' }
        : input.data;

      const notif: AppNotification = {
        _id: `notif_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: input.type,
        title: input.title,
        body: input.body,
        data,
        createdAt: now,
        isRead: false,
        dedupeKey: key,
      };
      if (__DEV__) console.log(`[DemoNotifStore] new notification key=${key}`);
      return { notifications: [notif, ...state.notifications] };
    }),
  cleanupExpiredNotifications: (now: number = Date.now()) =>
    set((state) => {
      const before = state.notifications.length;
      const filtered = state.notifications.filter((n) => !isExpired(n, now));
      const removed = before - filtered.length;
      if (removed > 0 && __DEV__) {
        console.log(`[DemoNotifStore] cleaned up ${removed} expired notification(s)`);
      }
      return removed > 0 ? { notifications: filtered } : {};
    }),
  reset: () => set({ notifications: [] }),
}));

const EMPTY_ARRAY: any[] = [];

let __notifLogged = false;

/**
 * Single source-of-truth hook for notifications.
 *
 * Both the bell badge (home.tsx) and the notifications screen
 * call this hook. They share the SAME underlying data:
 *  - Demo mode → Zustand store (shared across component trees)
 *  - Convex mode → reactive getNotifications query
 *
 * Returns:
 *  - notifications: full list (same array drives both badge & list)
 *  - unseenCount:   derived from notifications.filter(n => !n.isRead)
 *  - markAllSeen(): marks every unread notification as read
 *  - markRead(id):  marks a single notification as read
 */
export function useNotifications() {
  const userId = useAuthStore((s) => s.userId);
  const convexUserId = asUserId(userId);

  // ── Convex queries (skipped in demo mode) ──
  const convexNotifications = useQuery(
    api.notifications.getNotifications,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip',
  );
  const markAsReadMutation = useMutation(api.notifications.markAsRead);
  const markAllAsReadMutation = useMutation(api.notifications.markAllAsRead);
  // A1 & A2 fix: Convex mutations for dedupeKey and conversation-based marking
  const markReadByDedupeKeyMutation = useMutation(api.notifications.markReadByDedupeKey);
  const markReadForConversationMutation = useMutation(api.notifications.markReadForConversation);

  // ── Demo-mode shared state ──
  const demoNotifs = useDemoNotifStore((s) => s.notifications);
  const demoMarkAllRead = useDemoNotifStore((s) => s.markAllRead);
  const demoMarkRead = useDemoNotifStore((s) => s.markRead);
  const demoMarkReadByDedupeKey = useDemoNotifStore((s) => s.markReadByDedupeKey);
  const demoMarkReadForConversation = useDemoNotifStore((s) => s.markReadForConversation);
  const demoAddNotification = useDemoNotifStore((s) => s.addNotification);
  const demoCleanupExpired = useDemoNotifStore((s) => s.cleanupExpiredNotifications);

  // ── Unified notifications array (memoized to prevent new refs each render) ──
  const convexSafe = convexNotifications ?? EMPTY_ARRAY;
  const mappedConvex = useMemo<AppNotification[]>(
    () =>
      convexSafe.map((n: any) => ({
        _id: n._id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        createdAt: n.createdAt,
        readAt: n.readAt,
        isRead: !!n.readAt,
      })),
    [convexSafe],
  );

  // ── Filter out expired (24h TTL) and read notifications in display ──
  // Read notifications disappear immediately when marked as read
  // A3 fix: use minute-granularity timestamp so expired notifications are filtered
  // within 60s without causing re-renders every frame
  const nowMinute = useMemo(() => Math.floor(Date.now() / 60000) * 60000, []);
  const [stableNow, setStableNow] = useState(nowMinute);
  useEffect(() => {
    // Update every minute to catch newly expired notifications
    const interval = setInterval(() => {
      setStableNow(Math.floor(Date.now() / 60000) * 60000);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // 4-5: Track pending optimistic reads for rollback on error
  const [pendingReads, setPendingReads] = useState<Set<string>>(new Set());

  const filteredDemoNotifs = useMemo(
    () => demoNotifs.filter((n) => !isExpired(n, stableNow) && !n.isRead),
    [demoNotifs, stableNow],
  );
  // 4-5: Filter out pending reads (optimistically marked as read) from Convex notifications
  const filteredConvexNotifs = useMemo(
    () => mappedConvex.filter((n) => !n.isRead && !isExpired(n, stableNow) && !pendingReads.has(n._id)),
    [mappedConvex, stableNow, pendingReads],
  );
  const notifications: AppNotification[] = isDemoMode ? filteredDemoNotifs : filteredConvexNotifs;

  // ── Derived count (single formula, no separate query) ──
  const unseenCount = notifications.filter((n) => !n.isRead).length;

  // ── Debug logging (once globally, DEV only) ──
  useEffect(() => {
    if (__DEV__ && !__notifLogged) {
      console.log(
        `[useNotifications] mode=${isDemoMode ? 'demo' : 'convex'} ` +
          `total=${notifications.length} unseenCount=${unseenCount}`,
      );
      __notifLogged = true;
    }
  }, [notifications.length, unseenCount]);

  // ── Mark all as seen/read ──
  const markAllSeen = useCallback(() => {
    if (isDemoMode) {
      demoMarkAllRead();
      return;
    }
    if (convexUserId) {
      markAllAsReadMutation({ userId: convexUserId }).catch(console.error);
    }
  }, [convexUserId, markAllAsReadMutation, demoMarkAllRead]);

  // ── Mark single notification as read ──
  // 4-5: Implements optimistic update with rollback on error
  const markRead = useCallback(
    (notificationId: string) => {
      if (isDemoMode) {
        demoMarkRead(notificationId);
        return;
      }
      if (convexUserId) {
        // 4-5: Optimistically add to pending reads
        setPendingReads((prev) => new Set(prev).add(notificationId));

        markAsReadMutation({
          notificationId: notificationId as any,
          userId: convexUserId,
        })
          .then(() => {
            // 4-5: Remove from pending on success (Convex will update the query)
            setPendingReads((prev) => {
              const next = new Set(prev);
              next.delete(notificationId);
              return next;
            });
          })
          .catch((error) => {
            // 4-5: Rollback on error — remove from pending, notification stays unread
            console.error('[useNotifications] markRead failed, rolling back:', error);
            setPendingReads((prev) => {
              const next = new Set(prev);
              next.delete(notificationId);
              return next;
            });
          });
      }
    },
    [convexUserId, markAsReadMutation, demoMarkRead],
  );

  // ── Mark by dedupe key (A1 fix: now supports Convex mode) ──
  const markReadByDedupeKey = useCallback(
    (dedupeKey: string) => {
      if (isDemoMode) {
        demoMarkReadByDedupeKey(dedupeKey);
      } else if (convexUserId) {
        markReadByDedupeKeyMutation({ userId: convexUserId, dedupeKey }).catch(console.error);
      }
    },
    [demoMarkReadByDedupeKey, convexUserId, markReadByDedupeKeyMutation],
  );

  // ── Mark all message notifications for a conversation as read (A2 fix: now supports Convex mode) ──
  const markReadForConversation = useCallback(
    (conversationId: string) => {
      // A4 fix: normalize conversationId to string
      const normalizedId = String(conversationId);
      if (isDemoMode) {
        demoMarkReadForConversation(normalizedId);
      } else if (convexUserId) {
        markReadForConversationMutation({ userId: convexUserId, conversationId: normalizedId }).catch(console.error);
      }
    },
    [demoMarkReadForConversation, convexUserId, markReadForConversationMutation],
  );

  // ── Add notification (demo mode only — Convex mode uses server push) ──
  const addNotification = useCallback(
    (input: AddNotificationInput) => {
      if (isDemoMode) {
        demoAddNotification(input);
      }
    },
    [demoAddNotification],
  );

  // ── Cleanup expired notifications (demo mode only) ──
  const cleanupExpiredNotifications = useCallback(
    (timestamp?: number) => {
      if (isDemoMode) {
        demoCleanupExpired(timestamp);
      }
    },
    [demoCleanupExpired],
  );

  return {
    notifications,
    unseenCount,
    markAllSeen,
    markRead,
    markReadByDedupeKey,
    markReadForConversation,
    addNotification,
    cleanupExpiredNotifications,
  };
}
