/**
 * useBackgroundLocation — Phase-1 Background Crossed Paths (iOS only).
 *
 * Thin client-side orchestration around:
 *   1. enableBackgroundLocation() — request Always permission + start SLC
 *   2. api.users.updateNearbySettings({ backgroundLocationEnabled: true })
 *
 * Both must succeed for the feature to be "on". If the permission prompt
 * is denied, we never set the server flag, so recordLocationBatch calls
 * from a stale client will be rejected server-side.
 *
 * DEBUG TAG: [BG_LOCATION]
 */

import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  enableBackgroundLocation as enableTask,
  disableBackgroundLocation as disableTask,
  isBackgroundLocationRunning,
} from '@/tasks/backgroundLocationTask';

type EnableResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not_ios'
        | 'foreground_denied'
        | 'background_denied'
        | 'start_failed'
        | 'no_auth'
        | 'server_failed';
      err?: string;
    };

export function useBackgroundLocation(authUserId: string | null) {
  const updateNearbySettings = useMutation(api.users.updateNearbySettings);
  const [isWorking, setIsWorking] = useState(false);

  /**
   * enable — The full opt-in flow. Must be called in direct response to a
   * user tap (the iOS permission prompt requires a foreground user gesture).
   */
  const enable = useCallback(async (): Promise<EnableResult> => {
    if (Platform.OS !== 'ios') {
      return { ok: false, reason: 'not_ios' };
    }
    if (!authUserId) {
      return { ok: false, reason: 'no_auth' };
    }

    setIsWorking(true);
    try {
      const taskResult = await enableTask();
      if (!taskResult.ok) {
        if (__DEV__) {
          console.log('[BG_LOCATION][enabled]', {
            ok: false,
            reason: taskResult.reason,
          });
        }
        return taskResult;
      }

      // Only flip the server flag AFTER the OS has granted and the task
      // has started. Otherwise recordLocationBatch may arrive with no
      // corresponding running task, or be dropped for missing permission.
      try {
        await updateNearbySettings({
          authUserId,
          backgroundLocationEnabled: true,
        });
      } catch (e) {
        if (__DEV__) {
          console.log('[BG_LOCATION][enabled]', {
            ok: false,
            stage: 'server',
            err: String(e),
          });
        }
        // Best-effort rollback: stop the task so we don't keep sampling
        // with a server that rejected the flag.
        await disableTask();
        return { ok: false, reason: 'server_failed', err: String(e) };
      }

      if (__DEV__) console.log('[BG_LOCATION][enabled]', { ok: true });
      return { ok: true };
    } finally {
      setIsWorking(false);
    }
  }, [authUserId, updateNearbySettings]);

  /**
   * disable — Turn off the task and unset the server flag. Idempotent.
   */
  const disable = useCallback(async (): Promise<void> => {
    setIsWorking(true);
    try {
      await disableTask();
      if (authUserId) {
        try {
          await updateNearbySettings({
            authUserId,
            backgroundLocationEnabled: false,
          });
        } catch (e) {
          if (__DEV__) {
            console.log('[BG_LOCATION][disabled]', {
              stage: 'server',
              err: String(e),
            });
          }
        }
      }
    } finally {
      setIsWorking(false);
    }
  }, [authUserId, updateNearbySettings]);

  return {
    enable,
    disable,
    isWorking,
    isRunning: isBackgroundLocationRunning,
  };
}
