import { useCallback, useEffect, useMemo, useRef } from 'react';
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

  // ── Demo-mode shared state ──
  const demoNotifs = useDemoNotifStore((s) => s.notifications);
  const demoMarkAllRead = useDemoNotifStore((s) => s.markAllRead);
  const demoMarkRead = useDemoNotifStore((s) => s.markRead);
  const demoMarkReadByDedupeKey = useDemoNotifStore((s) => s.markReadByDedupeKey);
  const demoMarkReadForConversation = useDemoNotifStore((s) => s.markReadForConversation);
  const demoAddNotification = useDemoNotifStore((s) => s.addNotification);

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
  const notifications: AppNotification[] = isDemoMode ? demoNotifs : mappedConvex;

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
  const markRead = useCallback(
    (notificationId: string) => {
      if (isDemoMode) {
        demoMarkRead(notificationId);
        return;
      }
      if (convexUserId) {
        markAsReadMutation({
          notificationId: notificationId as any,
          userId: convexUserId,
        }).catch(console.error);
      }
    },
    [convexUserId, markAsReadMutation, demoMarkRead],
  );

  // ── Mark by dedupe key ──
  const markReadByDedupeKey = useCallback(
    (dedupeKey: string) => {
      if (isDemoMode) {
        demoMarkReadByDedupeKey(dedupeKey);
      }
    },
    [demoMarkReadByDedupeKey],
  );

  // ── Mark all message notifications for a conversation as read ──
  const markReadForConversation = useCallback(
    (conversationId: string) => {
      if (isDemoMode) {
        demoMarkReadForConversation(conversationId);
      }
      // Convex mode: handled by the chat's own markAsRead mutation
    },
    [demoMarkReadForConversation],
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

  return {
    notifications,
    unseenCount,
    markAllSeen,
    markRead,
    markReadByDedupeKey,
    markReadForConversation,
    addNotification,
  };
}
