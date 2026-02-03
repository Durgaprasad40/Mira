import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
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
}

// ── Demo seed data ──────────────────────────────────────────────
function createDemoNotifications(): AppNotification[] {
  const now = Date.now();
  return [
    {
      _id: 'demo_notif_1',
      type: 'crossed_paths',
      title: 'Crossed Paths',
      body: 'You crossed paths with Sarah near downtown!',
      createdAt: now - 10 * 60 * 1000,
      isRead: false,
    },
    {
      _id: 'demo_notif_2',
      type: 'match',
      title: 'New Match',
      body: 'Alex shares 3 interests with you — say hi!',
      createdAt: now - 35 * 60 * 1000,
      isRead: false,
    },
    {
      _id: 'demo_notif_3',
      type: 'super_like',
      title: 'Super Like',
      body: 'Someone super liked your profile!',
      createdAt: now - 3 * 60 * 60 * 1000,
      isRead: true,
      readAt: now - 2 * 60 * 60 * 1000,
    },
  ];
}

// ── Zustand store for demo-mode notifications (shared across screens) ──
interface DemoNotifStore {
  notifications: AppNotification[];
  markAllRead: () => void;
  markRead: (id: string) => void;
  addNotification: (notif: AppNotification) => void;
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
  addNotification: (notif: AppNotification) =>
    set((state) => ({
      notifications: [notif, ...state.notifications],
    })),
}));

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
  const { userId } = useAuthStore();

  // ── Convex queries (skipped in demo mode) ──
  const convexNotifications = useQuery(
    api.notifications.getNotifications,
    !isDemoMode && userId ? { userId: userId as any } : 'skip',
  );
  const markAsReadMutation = useMutation(api.notifications.markAsRead);
  const markAllAsReadMutation = useMutation(api.notifications.markAllAsRead);

  // ── Demo-mode shared state ──
  const demoNotifs = useDemoNotifStore((s) => s.notifications);
  const demoMarkAllRead = useDemoNotifStore((s) => s.markAllRead);
  const demoMarkRead = useDemoNotifStore((s) => s.markRead);

  // ── Unified notifications array ──
  const notifications: AppNotification[] = isDemoMode
    ? demoNotifs
    : (convexNotifications || []).map((n: any) => ({
        _id: n._id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        createdAt: n.createdAt,
        readAt: n.readAt,
        isRead: !!n.readAt,
      }));

  // ── Derived count (single formula, no separate query) ──
  const unseenCount = notifications.filter((n) => !n.isRead).length;

  // ── Debug logging ──
  const prevLogRef = useRef('');
  useEffect(() => {
    const key = `${notifications.length}:${unseenCount}`;
    if (prevLogRef.current !== key) {
      console.log(
        `[useNotifications] mode=${isDemoMode ? 'demo' : 'convex'} ` +
          `total=${notifications.length} unseenCount=${unseenCount}`,
      );
      prevLogRef.current = key;
    }
  }, [notifications.length, unseenCount]);

  // ── Mark all as seen/read ──
  const markAllSeen = useCallback(() => {
    if (isDemoMode) {
      demoMarkAllRead();
      return;
    }
    if (userId) {
      markAllAsReadMutation({ userId: userId as any }).catch(console.error);
    }
  }, [userId, markAllAsReadMutation, demoMarkAllRead]);

  // ── Mark single notification as read ──
  const markRead = useCallback(
    (notificationId: string) => {
      if (isDemoMode) {
        demoMarkRead(notificationId);
        return;
      }
      if (userId) {
        markAsReadMutation({
          notificationId: notificationId as any,
          userId: userId as any,
        }).catch(console.error);
      }
    },
    [userId, markAsReadMutation, demoMarkRead],
  );

  return {
    notifications,
    unseenCount,
    markAllSeen,
    markRead,
  };
}
