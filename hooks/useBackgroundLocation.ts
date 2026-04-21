/**
 * useBackgroundLocation — Background Crossed Paths client orchestration.
 *
 * iOS Phase-1: enable()/disable() drive Significant Location Change.
 * Android Phase-2: enableDiscoveryMode()/disableDiscoveryMode() drive the
 *                  time-limited, foreground-service-backed window.
 *
 * Both paths keep the OS-level task state and the server flag in lock-step.
 * If either half of the pair fails, the hook rolls back the other half so
 * we never end up with "OS task running but server says off" (which would
 * make recordLocationBatch silently drop every sample) or its inverse.
 *
 * DEBUG TAGS: [BG_LOCATION] (iOS), [ANDROID_DISCOVERY] (Android)
 */

import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  enableBackgroundLocation as enableTask,
  disableBackgroundLocation as disableTask,
  enableAndroidDiscoveryMode as enableDiscoveryTask,
  disableAndroidDiscoveryMode as disableDiscoveryTask,
  isBackgroundLocationRunning,
  readAndroidDiscoveryExpiry,
  DISCOVERY_MODE_DEFAULT_DURATION_MS,
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

type EnableDiscoveryResult =
  | { ok: true; expiresAt: number; durationMs: number }
  | {
      ok: false;
      reason:
        | 'not_android'
        | 'foreground_denied'
        | 'background_denied'
        | 'start_failed'
        | 'no_auth'
        | 'server_failed';
      err?: string;
    };

export function useBackgroundLocation(authUserId: string | null) {
  const updateNearbySettings = useMutation(api.users.updateNearbySettings);
  const startDiscoveryMode = useMutation(api.users.startDiscoveryMode);
  const stopDiscoveryMode = useMutation(api.users.stopDiscoveryMode);
  const [isWorking, setIsWorking] = useState(false);

  // -------------------------------------------------------------------------
  // iOS Phase-1 — Background SLC (always-on once enabled).
  // -------------------------------------------------------------------------

  /**
   * enable — iOS SLC opt-in flow. Must be called in direct response to a
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
   * disable — Turn off SLC and unset the iOS server flag. Idempotent.
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

  // -------------------------------------------------------------------------
  // Android Phase-2 — Discovery Mode (user-initiated, time-limited).
  // -------------------------------------------------------------------------

  /**
   * enableDiscoveryMode — Android opt-in flow.
   *
   * Order of operations matters:
   *   1. Start the foreground-service task (triggers OS permission prompts).
   *   2. If the task started, persist the discovery window server-side.
   *   3. If the server call fails, stop the task so we don't run a
   *      foreground service whose samples the server will reject.
   *
   * durationMs is optional; defaults to the 4h product window.
   */
  const enableDiscoveryMode = useCallback(
    async (
      durationMs: number = DISCOVERY_MODE_DEFAULT_DURATION_MS,
    ): Promise<EnableDiscoveryResult> => {
      if (Platform.OS !== 'android') {
        return { ok: false, reason: 'not_android' };
      }
      if (!authUserId) {
        return { ok: false, reason: 'no_auth' };
      }

      setIsWorking(true);
      try {
        const taskResult = await enableDiscoveryTask(durationMs);
        if (!taskResult.ok) {
          if (__DEV__) {
            console.log('[ANDROID_DISCOVERY][enable]', {
              ok: false,
              reason: taskResult.reason,
            });
          }
          return taskResult;
        }

        try {
          await startDiscoveryMode({
            authUserId,
            durationMs: taskResult.durationMs,
          });
        } catch (e) {
          if (__DEV__) {
            console.log('[ANDROID_DISCOVERY][enable]', {
              ok: false,
              stage: 'server',
              err: String(e),
            });
          }
          // Rollback: stop the foreground service since the server won't
          // accept samples. Otherwise the user sees a persistent
          // notification for a feature that's silently inactive.
          await disableDiscoveryTask();
          return { ok: false, reason: 'server_failed', err: String(e) };
        }

        if (__DEV__) {
          console.log('[ANDROID_DISCOVERY][enable]', {
            ok: true,
            expiresAt: taskResult.expiresAt,
            durationMs: taskResult.durationMs,
          });
        }
        return {
          ok: true,
          expiresAt: taskResult.expiresAt,
          durationMs: taskResult.durationMs,
        };
      } finally {
        setIsWorking(false);
      }
    },
    [authUserId, startDiscoveryMode],
  );

  /**
   * disableDiscoveryMode — Stop the task + clear server window. Idempotent.
   */
  const disableDiscoveryMode = useCallback(async (): Promise<void> => {
    setIsWorking(true);
    try {
      await disableDiscoveryTask();
      if (authUserId) {
        try {
          await stopDiscoveryMode({ authUserId });
        } catch (e) {
          if (__DEV__) {
            console.log('[ANDROID_DISCOVERY][disable]', {
              stage: 'server',
              err: String(e),
            });
          }
        }
      }
    } finally {
      setIsWorking(false);
    }
  }, [authUserId, stopDiscoveryMode]);

  return {
    // iOS Phase-1
    enable,
    disable,
    // Android Phase-2
    enableDiscoveryMode,
    disableDiscoveryMode,
    // Introspection
    isWorking,
    isRunning: isBackgroundLocationRunning,
    readAndroidDiscoveryExpiry,
  };
}
