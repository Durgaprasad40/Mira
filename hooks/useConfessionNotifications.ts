import { useCallback, useRef } from 'react';
import { useDemoNotifStore, type AppNotification } from './useNotifications';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_DAILY = 3;

/**
 * Hook for firing confession-related notifications with rate limiting.
 *
 * Rate limits:
 *  - Max 1 notification per confessionId per 6 hours
 *  - Max 3 confession notifications per day total
 */
export function useConfessionNotifications() {
  const addNotification = useDemoNotifStore((s) => s.addNotification);

  // In-memory rate limiting (resets on remount / app restart — fine for demo)
  const lastNotifiedAt = useRef<Map<string, number>>(new Map());
  const dailyCount = useRef({ date: new Date().toDateString(), count: 0 });

  const isRateLimited = useCallback((confessionId: string): boolean => {
    const now = Date.now();

    // Per-confession cooldown
    const last = lastNotifiedAt.current.get(confessionId);
    if (last && now - last < SIX_HOURS) return true;

    // Daily cap
    const today = new Date().toDateString();
    if (dailyCount.current.date !== today) {
      dailyCount.current = { date: today, count: 0 };
    }
    if (dailyCount.current.count >= MAX_DAILY) return true;

    return false;
  }, []);

  const recordNotification = useCallback((confessionId: string) => {
    lastNotifiedAt.current.set(confessionId, Date.now());
    const today = new Date().toDateString();
    if (dailyCount.current.date !== today) {
      dailyCount.current = { date: today, count: 1 };
    } else {
      dailyCount.current.count += 1;
    }
  }, []);

  const notifyReaction = useCallback(
    (confessionId: string) => {
      if (isRateLimited(confessionId)) return;
      const notif: AppNotification = {
        _id: `cn_react_${Date.now()}`,
        type: 'confession_reaction',
        title: 'Confess',
        body: 'Someone felt the same',
        data: { confessionId },
        createdAt: Date.now(),
        isRead: false,
      };
      addNotification(notif);
      recordNotification(confessionId);
    },
    [addNotification, isRateLimited, recordNotification],
  );

  const notifyReply = useCallback(
    (confessionId: string) => {
      if (isRateLimited(confessionId)) return;
      const notif: AppNotification = {
        _id: `cn_reply_${Date.now()}`,
        type: 'confession_reply',
        title: 'Confess',
        body: 'Someone replied to your confession',
        data: { confessionId },
        createdAt: Date.now(),
        isRead: false,
      };
      addNotification(notif);
      recordNotification(confessionId);
    },
    [addNotification, isRateLimited, recordNotification],
  );

  return { notifyReaction, notifyReply };
}
