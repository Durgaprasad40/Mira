/**
 * DELIVERY_ACK: App-wide foreground delivery acknowledgement for Phase-1.
 *
 * Problem (pre-fix):
 *   `markAllAsDelivered` only ran inside the Messages tab. If the receiver
 *   was online but on Discover / Profile / Notifications / etc. the sender
 *   would sit at a single tick until the receiver opened Messages.
 *
 * Fix:
 *   Mount this hook once at the Phase-1 layout root. It subscribes to a
 *   narrow `listUndeliveredIncomingMessages` query and, while the app is
 *   foregrounded, batches IDs into `markMessagesDelivered`. The query
 *   only re-fires when actually-undelivered rows change, so idle devices
 *   stay quiet.
 *
 * Safety invariants (enforced in `convex/messages.ts`):
 *   - Sender guard on query + mutation (senderId !== userId).
 *   - Participant guard on mutation via `by_user_conversation`.
 *   - Never touches `media`, `mediaPermissions`, `openedAt`, `readAt`,
 *     or any protected-media timer fields. Background delivery never
 *     starts a secure-media countdown or expires view-once media.
 *
 * Logs (all prefixed `[DELIVERY_ACK]`):
 *   - no_user          : skipped (auth not ready)
 *   - demo_mode        : skipped (demo build)
 *   - background       : skipped (app not foregrounded)
 *   - query_count      : subscription emitted N undelivered rows
 *   - marking_delivered: calling mutation with N ids
 *   - success          : mutation returned (count)
 *   - error            : mutation threw
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

export function useDeliveryAck() {
  const userId = useAuthStore((s) => s.userId);

  // Re-render nudge for the flush effect on foreground transitions.
  const [foregroundTick, setForegroundTick] = useState(0);

  const isAuthed = !isDemoMode && !!userId;

  const markMessagesDelivered = useMutation(api.messages.markMessagesDelivered);

  // Skip the subscription entirely when unauthed / demo. We intentionally
  // keep it live across foreground/background so the moment the user
  // returns to foreground we already have a cached result to flush.
  const undelivered = useQuery(
    api.messages.listUndeliveredIncomingMessages,
    isAuthed ? { authUserId: userId as string } : 'skip'
  );

  const lastSyncKeyRef = useRef<string>('');
  const inFlightRef = useRef(false);
  const isForegroundRef = useRef<boolean>(AppState.currentState === 'active');

  useEffect(() => {
    const handleChange = (next: AppStateStatus) => {
      const wasForeground = isForegroundRef.current;
      const nowForeground = next === 'active';
      isForegroundRef.current = nowForeground;
      if (!wasForeground && nowForeground) {
        // Clear sync key so a fresh foreground flushes any cached backlog.
        lastSyncKeyRef.current = '';
        setForegroundTick((t) => (t + 1) & 0xffff);
      }
    };
    const sub = AppState.addEventListener('change', handleChange);
    return () => {
      try {
        sub.remove();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!isAuthed) {
      if (__DEV__) {
        if (isDemoMode) {
          console.log('[DELIVERY_ACK] demo_mode');
        } else if (!userId) {
          console.log('[DELIVERY_ACK] no_user');
        }
      }
      return;
    }

    if (!isForegroundRef.current) {
      if (__DEV__) console.log('[DELIVERY_ACK] background');
      return;
    }

    if (!undelivered || undelivered.length === 0) return;

    const ids = undelivered.map((r) => r._id);
    const syncKey = ids.join('|');
    if (syncKey === lastSyncKeyRef.current) return;
    if (inFlightRef.current) return;

    if (__DEV__) {
      console.log('[DELIVERY_ACK] query_count', { count: ids.length });
      console.log('[DELIVERY_ACK] marking_delivered', { count: ids.length });
    }

    inFlightRef.current = true;
    lastSyncKeyRef.current = syncKey;

    markMessagesDelivered({ messageIds: ids as any, authUserId: userId as string })
      .then((res) => {
        if (__DEV__) console.log('[DELIVERY_ACK] success', res);
      })
      .catch((err) => {
        // On failure, clear the sync key so a later tick can retry.
        lastSyncKeyRef.current = '';
        if (__DEV__) console.warn('[DELIVERY_ACK] error', err?.message || err);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [undelivered, isAuthed, userId, markMessagesDelivered, foregroundTick]);
}
