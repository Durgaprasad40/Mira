import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { useSegments } from 'expo-router';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import { create } from 'zustand';
import { log } from '@/utils/logger';

// Phase 1-only notification types — never shown in Phase 2 (private tabs)
const PHASE1_ONLY_TYPES = new Set(['crossed_paths', 'nearby']);

// Module-level phase tracking for creation-side blocking in Zustand store
let _isInPhase2 = false;
export function setPhase2Active(active: boolean) {
  _isInPhase2 = active;
}

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
  /** BUGFIX #19: Explicit expiry timestamp — if set and <= now, notification is expired */
  expiresAt?: number;
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
      // Per-event: each like is unique by liker's userId
      return `like:${userId ?? 'unknown'}`;
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
// IMPORTANT: Notification otherUserIds MUST match the userIds in:
// - DEMO_LIKES (demoData.ts) for like notifications
// - crossedPaths (demoStore.ts) for crossed_paths notifications
// so that tapping a notification can find the corresponding entry.
// BUGFIX #19: Demo notifications now include expiresAt for proper expiry filtering
const DEMO_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function createDemoNotifications(): AppNotification[] {
  const now = Date.now();
  return [
    // crossed_paths notification — must match a crossedPaths entry seeded in demoStore
    // Using demo_profile_12 which has lat/lng and will be seeded as a crossed path
    {
      _id: 'demo_notif_1',
      type: 'crossed_paths',
      title: 'Crossed paths',
      body: 'You crossed paths with Isha nearby.',
      data: { otherUserId: 'demo_profile_12', crossedAt: String(now - 5 * 60 * 1000) },
      createdAt: now - 10 * 60 * 1000,
      expiresAt: now - 10 * 60 * 1000 + DEMO_NOTIFICATION_TTL_MS, // BUGFIX #19
      isRead: false,
      dedupeKey: 'crossed_paths:demo_profile_12',
    },
    // Per-event like notifications — IDs match DEMO_LIKES in demoData.ts
    {
      _id: 'demo_notif_2',
      type: 'like_received',
      title: 'New Like',
      body: 'Kavya liked you',
      data: { otherUserId: 'demo_superlike_kavya', likerName: 'Kavya' },
      createdAt: now - 30 * 60 * 1000,
      expiresAt: now - 30 * 60 * 1000 + DEMO_NOTIFICATION_TTL_MS, // BUGFIX #19
      isRead: false,
      dedupeKey: 'like:demo_superlike_kavya',
    },
    {
      _id: 'demo_notif_4',
      type: 'like_received',
      title: 'New Like',
      body: 'Riya liked you',
      data: { otherUserId: 'demo_profile_6', likerName: 'Riya' },
      createdAt: now - 2 * 60 * 60 * 1000,
      expiresAt: now - 2 * 60 * 60 * 1000 + DEMO_NOTIFICATION_TTL_MS, // BUGFIX #19
      isRead: false,
      dedupeKey: 'like:demo_profile_6',
    },
    {
      _id: 'demo_notif_3',
      type: 'super_like_received',
      title: 'Super Like',
      body: 'Meera super-liked you!',
      data: { otherUserId: 'demo_superlike_meera', likerName: 'Meera' },
      createdAt: now - 3 * 60 * 60 * 1000,
      expiresAt: now - 3 * 60 * 60 * 1000 + DEMO_NOTIFICATION_TTL_MS, // BUGFIX #19
      isRead: true,
      readAt: now - 2 * 60 * 60 * 1000,
      dedupeKey: 'super_like:demo_superlike_meera',
    },
  ];
}

// ── Notification expiry ─────────────────────────────────────────
const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * BUGFIX #19: Check if a notification is expired.
 * 1) If expiresAt is set, use it directly (expiresAt <= now = expired)
 * 2) Otherwise fall back to createdAt + 24h TTL
 */
function isExpired(notification: AppNotification, now: number = Date.now()): boolean {
  // BUGFIX #19: Check expiresAt first if present
  if (notification.expiresAt !== undefined) {
    return notification.expiresAt <= now;
  }
  // Fallback: use createdAt + TTL
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
  /**
   * Remove all like_received/super_like_received notifications for a user.
   * Called when a Like is removed to maintain notification/like consistency.
   */
  removeLikeNotificationsForUser: (userId: string) => void;
  /**
   * Remove orphaned like notifications (those without corresponding likes).
   * Called after seed/cleanup to enforce invariant.
   * @param context - 'startup' for hydration/seed cleanup (logs summary), 'runtime' for active session bugs (logs per-profile)
   */
  removeOrphanedLikeNotifications: (validLikeUserIds: Set<string>, context?: 'startup' | 'runtime') => void;
  /**
   * Remove all crossed_paths notifications for a user.
   * Called when a CrossedPath entry is removed to maintain notification/crossedPath consistency.
   */
  removeCrossedPathNotificationsForUser: (userId: string) => void;
  /**
   * Remove orphaned crossed_paths notifications (those without corresponding entries).
   * Called after seed/cleanup to enforce invariant.
   * @param context - 'startup' for hydration/seed cleanup (logs summary), 'runtime' for active session bugs (logs per-profile)
   */
  removeOrphanedCrossedPathNotifications: (validCrossedPathUserIds: Set<string>, context?: 'startup' | 'runtime') => void;
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
      // Creation-side guard: Block Phase 1-only notifications if currently in Phase 2
      if (PHASE1_ONLY_TYPES.has(input.type) && _isInPhase2) {
        return {};
      }

      const now = Date.now();
      const key = computeDedupeKey(input.type, input.data);
      const existingIdx = state.notifications.findIndex((n) => n.dedupeKey === key);

      // ── Daily aggregation for profile_viewed only ──
      // Likes are now per-event (not aggregated). Profile views still aggregate.
      const isAggregated = key === 'view:daily';

      if (existingIdx >= 0) {
        const existing = state.notifications[existingIdx];

        // For aggregated types, bump the count and update the body
        let mergedData = { ...existing.data, ...input.data };
        let body = input.body;
        if (isAggregated) {
          const prevCount = parseInt(existing.data?.count ?? '1', 10);
          const newCount = prevCount + 1;
          mergedData = { ...mergedData, count: String(newCount) };
          if (input.type === 'profile_viewed') {
            body = newCount === 1 ? 'Someone viewed your profile.' : `${newCount} people viewed your profile today.`;
          }
        }

        const updated: AppNotification = {
          ...existing,
          title: input.title,
          body,
          data: mergedData,
          createdAt: now,
          // BUGFIX #19: Refresh expiresAt when notification is updated
          expiresAt: now + NOTIFICATION_TTL_MS,
          readAt: undefined,
          isRead: false,
          dedupeKey: key,
        };
        const rest = state.notifications.filter((_, i) => i !== existingIdx);
        return { notifications: [updated, ...rest] };
      }

      // ── Rate limiting: if type already hit daily cap, skip ──
      if (!isAggregated && isRateLimited(state.notifications, input.type)) {
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
        // BUGFIX #19: Set expiresAt for proper expiry filtering
        expiresAt: now + NOTIFICATION_TTL_MS,
        isRead: false,
        dedupeKey: key,
      };
      log.info('[NOTIF]', 'created', { type: input.type });
      return { notifications: [notif, ...state.notifications] };
    }),
  cleanupExpiredNotifications: (now: number = Date.now()) =>
    set((state) => {
      const before = state.notifications.length;
      const filtered = state.notifications.filter((n) => !isExpired(n, now));
      const removed = before - filtered.length;
      if (removed > 0) {
        log.debug('[NOTIF]', 'cleanup', { removed });
      }
      return removed > 0 ? { notifications: filtered } : {};
    }),
  removeLikeNotificationsForUser: (userId: string) =>
    set((state) => {
      const likeTypes = new Set(['like', 'like_received', 'super_like', 'superlike', 'super_like_received']);
      const filtered = state.notifications.filter((n) => {
        if (!likeTypes.has(n.type)) return true;
        return n.data?.otherUserId !== userId;
      });
      return { notifications: filtered };
    }),
  removeOrphanedLikeNotifications: (validLikeUserIds: Set<string>, context: 'startup' | 'runtime' = 'runtime') =>
    set((state) => {
      const likeTypes = new Set(['like', 'like_received', 'super_like', 'superlike', 'super_like_received']);
      const orphanedIds: string[] = [];
      // BUGFIX #35: Capture cleanup start time to avoid deleting notifications created in same tick
      const cleanupStartTime = Date.now() - 100; // 100ms grace period
      const filtered = state.notifications.filter((n) => {
        if (!likeTypes.has(n.type)) return true;
        const userId = n.data?.otherUserId;
        if (!userId) return true;
        // BUGFIX #35: Don't delete notifications created after cleanup started
        if (n.createdAt && n.createdAt > cleanupStartTime) return true;
        const isValid = validLikeUserIds.has(userId);
        if (!isValid) {
          orphanedIds.push(userId);
        }
        return isValid;
      });

      // Log based on context
      if (orphanedIds.length > 0) {
        if (context === 'startup') {
          // Startup cleanup — log one summary, not per-profile warnings
          log.once('orphan-like-cleanup', '[DEMO]', 'cleaned orphan like notifications', { count: orphanedIds.length });
        } else {
          // Runtime — real bug, log each orphan
          for (const profileId of orphanedIds) {
            log.warn('[BUG]', 'like_notification_without_like', { profileId });
          }
        }
      }

      return { notifications: filtered };
    }),
  removeCrossedPathNotificationsForUser: (userId: string) =>
    set((state) => {
      const filtered = state.notifications.filter((n) => {
        if (n.type !== 'crossed_paths') return true;
        return n.data?.otherUserId !== userId;
      });
      return { notifications: filtered };
    }),
  removeOrphanedCrossedPathNotifications: (validCrossedPathUserIds: Set<string>, context: 'startup' | 'runtime' = 'runtime') =>
    set((state) => {
      const orphanedIds: string[] = [];
      // BUGFIX #35: Capture cleanup start time to avoid deleting notifications created in same tick
      const cleanupStartTime = Date.now() - 100; // 100ms grace period
      const filtered = state.notifications.filter((n) => {
        if (n.type !== 'crossed_paths') return true;
        const userId = n.data?.otherUserId;
        // Keep notifications without otherUserId (legacy/generic crossed paths)
        if (!userId) return true;
        // BUGFIX #35: Don't delete notifications created after cleanup started
        if (n.createdAt && n.createdAt > cleanupStartTime) return true;
        const isValid = validCrossedPathUserIds.has(userId);
        if (!isValid) {
          orphanedIds.push(userId);
        }
        return isValid;
      });

      // Log based on context
      if (orphanedIds.length > 0) {
        if (context === 'startup') {
          // Startup cleanup — log one summary, not per-profile warnings
          log.once('orphan-crossed-paths-cleanup', '[DEMO]', 'cleaned orphan crossed_paths notifications', { count: orphanedIds.length });
        } else {
          // Runtime — real bug, log each orphan
          for (const profileId of orphanedIds) {
            log.warn('[BUG]', 'crossed_paths_notification_without_entry', { profileId });
          }
        }
      }

      return { notifications: filtered };
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

  // Detect if we're in Phase 2 (private tabs) — filter out Phase 1-only notifications
  const segments = useSegments();
  const isInPhase2 = segments.includes('(private)' as never);

  // BUGFIX #32: Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ORDERING FIX: In demo mode, wait for demoStore to be seeded before showing notifications
  // This ensures orphan cleanup runs before notification counts are computed
  // Import dynamically to avoid circular dependency
  const [demoStoreReady, setDemoStoreReady] = useState(!isDemoMode);
  useEffect(() => {
    if (!isDemoMode) return;

    // Check if demoStore is ready (hydrated and seeded)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useDemoStore } = require('@/stores/demoStore') as {
      useDemoStore: { getState: () => { _hasHydrated: boolean; seeded: boolean; seed: () => void } };
    };

    const checkReady = () => {
      const state = useDemoStore.getState();
      if (state._hasHydrated) {
        // Trigger seed to run orphan cleanup
        state.seed();
        if (state.seeded) {
          // BUGFIX #32: Check mounted before state update
          if (isMountedRef.current) {
            setDemoStoreReady(true);
          }
          return true;
        }
      }
      return false;
    };

    // Check immediately
    if (checkReady()) return;

    // Poll until ready (hydration + seed typically completes within a few frames)
    const interval = setInterval(() => {
      if (checkReady()) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, []);

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
        // BUGFIX #19: Include expiresAt for proper expiry filtering
        expiresAt: n.expiresAt,
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
    // BUGFIX #32: Check mounted before state update
    const interval = setInterval(() => {
      if (isMountedRef.current) {
        setStableNow(Math.floor(Date.now() / 60000) * 60000);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // BUGFIX #33: Use ref instead of state to avoid setState warnings on unmount
  // Ref is safe: updates don't cause re-renders, but Convex query updates will trigger re-render anyway
  const pendingReadsRef = useRef<Set<string>>(new Set());
  // Force re-render trigger for optimistic UI updates
  const [, forceUpdate] = useState(0);

  const filteredDemoNotifs = useMemo(
    () => demoNotifs.filter((n) => !isExpired(n, stableNow) && !n.isRead),
    [demoNotifs, stableNow],
  );
  // BUGFIX #33: Filter out pending reads using ref (checked on each render)
  const filteredConvexNotifs = useMemo(
    () => mappedConvex.filter((n) => !n.isRead && !isExpired(n, stableNow) && !pendingReadsRef.current.has(n._id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingReadsRef.current is intentionally not a dep
    [mappedConvex, stableNow],
  );

  // Phase 2 isolation: filter out Phase 1-only notification types when in private tabs
  // ORDERING FIX: In demo mode, return empty array until demoStore is seeded (orphan cleanup complete)
  const baseNotifications = isDemoMode
    ? (demoStoreReady ? filteredDemoNotifs : EMPTY_ARRAY)
    : filteredConvexNotifs;
  const notifications: AppNotification[] = useMemo(
    () => isInPhase2 ? baseNotifications.filter((n) => !PHASE1_ONLY_TYPES.has(n.type)) : baseNotifications,
    [baseNotifications, isInPhase2],
  );

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
  // BUGFIX #33: Uses ref for pending reads to avoid setState on unmount warnings
  const markRead = useCallback(
    (notificationId: string) => {
      if (isDemoMode) {
        demoMarkRead(notificationId);
        return;
      }
      if (convexUserId) {
        // BUGFIX #33: Add to ref and force re-render for optimistic UI
        pendingReadsRef.current.add(notificationId);
        forceUpdate((n) => n + 1);

        markAsReadMutation({
          notificationId: notificationId as any,
          userId: convexUserId,
        })
          .then(() => {
            // BUGFIX #33: Remove from ref on success (Convex query update triggers re-render)
            pendingReadsRef.current.delete(notificationId);
          })
          .catch((error) => {
            // BUGFIX #33: Remove from ref on error (rollback) and force re-render to show notification again
            console.error('[useNotifications] markRead failed, rolling back:', error);
            pendingReadsRef.current.delete(notificationId);
            forceUpdate((n) => n + 1);
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
