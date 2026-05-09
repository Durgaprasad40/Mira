/**
 * Phase-3 Background Crossed Paths — Foreground orchestrator hook.
 *
 * THIS MODULE IS THE ONLY PLACE THAT MAY CALL:
 *   - Location.requestBackgroundPermissionsAsync()
 *   - Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, …)
 *
 * Strict contract:
 *   - The hook NEVER auto-runs the enable flow. The caller (UI) must invoke
 *     `enableBackgroundCrossedPaths()` from an explicit user-initiated action
 *     after the explainer was shown.
 *   - `enableBackgroundCrossedPaths` fail-closes if ANY of these is missing:
 *       1. `BG_CROSSED_PATHS_FEATURE_READY` (client gate, currently false)
 *       2. authenticated user
 *       3. foreground location permission
 *       4. backend-side consent stamp (server re-validates)
 *       5. background location permission (OS prompt)
 *       6. platform-specific server flag (iOS backgroundLocationEnabled or
 *          Android Discovery Mode window)
 *       7. successful start of the OS background-location updates task
 *     Any failure rolls back the previous step server-side so client/server
 *     state stays consistent (a partial enable never leaks into the steady
 *     state).
 *   - `disableBackgroundCrossedPaths` ALWAYS attempts to make progress, even
 *     when not authenticated: it stops the OS task, clears the on-disk
 *     buffer, and best-effort calls server revoke. The user must always be
 *     able to disable.
 *   - `flushPendingBackgroundSamples` is gated on the same client flag and
 *     auth, never sends bytes when the gate is off, and is internally
 *     serialized so concurrent foreground/AppState triggers don't double-
 *     submit.
 *   - All paths fail closed: errors return a structured result, never throw
 *     past the hook boundary.
 *
 * NOT a manager component: the hook is consumed from the screens that own
 * the toggle UI (nearby-settings) and the consent flow (explainer). When
 * `BG_CROSSED_PATHS_FEATURE_READY` flips true, we'll add a global mount so
 * background flushes run app-wide; for now there's no observable behavior
 * change since every entry point short-circuits on the gate.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { BG_CROSSED_PATHS_FEATURE_READY } from '@/lib/backgroundCrossedPaths';
import { BACKGROUND_LOCATION_TASK_NAME } from '@/tasks/backgroundLocationTask';
import {
  backgroundLocationBuffer,
  type BufferedSample,
} from '@/stores/backgroundLocationBufferStore';
import { getOrCreateInstallId } from '@/lib/deviceFingerprint';

// ---------------------------------------------------------------------------
// Public result types — the hook NEVER throws, callers branch on `ok`.
// ---------------------------------------------------------------------------

export type BgEnableFailureReason =
  | 'feature_not_ready'
  | 'demo_mode'
  | 'not_authenticated'
  | 'foreground_permission_denied'
  | 'background_permission_denied'
  | 'consent_failed'
  | 'platform_setup_failed'
  | 'task_start_failed';

export type BgEnableResult =
  | { ok: true }
  | { ok: false; reason: BgEnableFailureReason; message?: string };

export type BgDisableFailureReason = 'revoke_failed';

export type BgDisableResult =
  | { ok: true }
  | { ok: false; reason: BgDisableFailureReason; message?: string };

export type BgFlushResult = {
  flushed: number;       // number of samples we attempted to upload
  accepted: number;      // number the backend confirmed it stored
  skipped: boolean;      // true if no upload happened
  reason?: string;       // structured short-circuit reason
};

export type BgStatus = {
  /** Mirror of the client-side feature gate. Currently false. */
  featureReady: boolean;
  /** featureReady && !demoMode — UI uses this to disable the toggle. */
  available: boolean;
  /** OS-level "while-using-the-app" permission. */
  foregroundPermissionGranted: boolean;
  /** OS-level "always" / Android background permission. */
  backgroundPermissionGranted: boolean;
  /** Whether `TaskManager.defineTask` ran — should always be true once the
   *  root layout imports the task module. */
  taskRegistered: boolean;
  /** Whether `Location.startLocationUpdatesAsync` is currently active. */
  taskActive: boolean;
  /** Pending samples queued on disk that haven't been uploaded yet. */
  bufferSize: number;
};

// ---------------------------------------------------------------------------
// Standalone status reader. Does not require a React render context — UI
// surfaces that just want to display state can call this.
// ---------------------------------------------------------------------------

export async function getBackgroundLocationStatus(): Promise<BgStatus> {
  let foregroundPermissionGranted = false;
  let backgroundPermissionGranted = false;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    foregroundPermissionGranted = fg.status === 'granted';
  } catch {
    foregroundPermissionGranted = false;
  }
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    backgroundPermissionGranted = bg.status === 'granted';
  } catch {
    backgroundPermissionGranted = false;
  }

  let taskRegistered = false;
  let taskActive = false;
  try {
    taskRegistered = TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME);
  } catch {
    taskRegistered = false;
  }
  try {
    taskActive = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK_NAME,
    );
  } catch {
    taskActive = false;
  }

  return {
    featureReady: BG_CROSSED_PATHS_FEATURE_READY,
    available: BG_CROSSED_PATHS_FEATURE_READY && !isDemoMode,
    foregroundPermissionGranted,
    backgroundPermissionGranted,
    taskRegistered,
    taskActive,
    bufferSize: backgroundLocationBuffer.size(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Idempotent stop. Never throws — disable path must always make progress. */
async function stopBackgroundTaskSafe(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK_NAME,
    );
    if (started) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME);
    }
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[BG_LOCATION] stopBackgroundTaskSafe failed:',
        (err as Error)?.message,
      );
    }
  }
}

/** Cap per-flush so a backlog of 200 samples doesn't slam the backend with a
 *  single huge mutation. Backend MAX_SAMPLES_PER_BATCH is configurable; 50 is
 *  conservative and lines up with foreground rate limits. */
const FLUSH_BATCH_LIMIT = 50;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBackgroundLocation() {
  const userId = useAuthStore((s) => s.userId);
  // Capture in a ref so async callbacks see the latest value without
  // re-binding the callbacks on every render.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const acceptConsentMut = useMutation(api.users.acceptBackgroundLocationConsent);
  const revokeConsentMut = useMutation(api.users.revokeBackgroundLocationConsent);
  const startDiscoveryMut = useMutation(api.users.startDiscoveryMode);
  const stopDiscoveryMut = useMutation(api.users.stopDiscoveryMode);
  const updateNearbySettingsMut = useMutation(api.users.updateNearbySettings);
  const recordBatchMut = useMutation(api.crossedPaths.recordLocationBatch);

  /** Single-flight guard so AppState 'active' bursts don't trigger overlapping
   *  flushes. */
  const flushInFlightRef = useRef(false);

  // -------------------------------------------------------------------------
  // flushPendingBackgroundSamples
  // -------------------------------------------------------------------------
  const flushPendingBackgroundSamples = useCallback(async (): Promise<BgFlushResult> => {
    if (!BG_CROSSED_PATHS_FEATURE_READY) {
      return { flushed: 0, accepted: 0, skipped: true, reason: 'feature_not_ready' };
    }
    if (isDemoMode) {
      return { flushed: 0, accepted: 0, skipped: true, reason: 'demo_mode' };
    }
    const uid = userIdRef.current;
    if (!uid) {
      return { flushed: 0, accepted: 0, skipped: true, reason: 'not_authenticated' };
    }
    if (flushInFlightRef.current) {
      return { flushed: 0, accepted: 0, skipped: true, reason: 'in_flight' };
    }

    const pending = backgroundLocationBuffer.getPending();
    if (pending.length === 0) {
      return { flushed: 0, accepted: 0, skipped: true, reason: 'empty' };
    }

    const slice: BufferedSample[] = pending.slice(0, FLUSH_BATCH_LIMIT);
    flushInFlightRef.current = true;
    try {
      const deviceHash = await getOrCreateInstallId();
      const res = (await recordBatchMut({
        userId: uid as any,
        samples: slice,
        deviceHash,
      })) as { success?: boolean; accepted?: number; reason?: string } | undefined;

      const reason = res?.reason;
      // Keep samples on disk only for transient failures (rate limit). Every
      // other reason — kill-switch off, consent missing, paused, incognito,
      // privacy-zone — is a steady-state rejection that won't change inside
      // a session, so retrying would just churn the buffer until the cap
      // forces a drop. Drop the slice and move on.
      const transient = reason === 'rate_limited';
      if (!transient) {
        backgroundLocationBuffer.drainFirst(slice.length);
      }
      return {
        flushed: slice.length,
        accepted: typeof res?.accepted === 'number' ? res.accepted : 0,
        skipped: false,
        reason,
      };
    } catch (err) {
      // Network or backend error — keep samples for the next foreground
      // attempt. The 200-cap protects disk usage if we never recover.
      if (__DEV__) {
        console.warn(
          '[BG_LOCATION] flushPendingBackgroundSamples failed:',
          (err as Error)?.message,
        );
      }
      return { flushed: 0, accepted: 0, skipped: true, reason: 'network_error' };
    } finally {
      flushInFlightRef.current = false;
    }
  }, [recordBatchMut]);

  // -------------------------------------------------------------------------
  // enableBackgroundCrossedPaths
  // -------------------------------------------------------------------------
  const enableBackgroundCrossedPaths =
    useCallback(async (): Promise<BgEnableResult> => {
      // Gate 1: client-side feature flag. Hard short-circuit before we touch
      // ANY OS API or backend mutation. This is the check that keeps Phase-3
      // OFF in production until we explicitly flip the constant.
      if (!BG_CROSSED_PATHS_FEATURE_READY) {
        return {
          ok: false,
          reason: 'feature_not_ready',
          message:
            'Background crossed paths is not yet available in this version.',
        };
      }
      if (isDemoMode) {
        return { ok: false, reason: 'demo_mode' };
      }
      const uid = userIdRef.current;
      if (!uid) {
        return { ok: false, reason: 'not_authenticated' };
      }

      // Gate 2: Foreground permission. Required before background per Apple
      // and Google rules. We do NOT request background until foreground is
      // granted, even though we already have backend consent — this matches
      // the OS-recommended escalation pattern.
      let fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        try {
          fg = await Location.requestForegroundPermissionsAsync();
        } catch (err) {
          return {
            ok: false,
            reason: 'foreground_permission_denied',
            message: (err as Error)?.message,
          };
        }
      }
      if (fg.status !== 'granted') {
        return { ok: false, reason: 'foreground_permission_denied' };
      }

      // Gate 3: Server-side consent stamp. We record consent BEFORE asking
      // for OS background permission so a user who declines the OS prompt
      // can still be revoked via `disableBackgroundCrossedPaths` cleanly,
      // and so the backend never sees a pre-consent OS-permission attempt
      // (defense in depth — UI also gates).
      try {
        await acceptConsentMut({ authUserId: uid });
      } catch (err) {
        return {
          ok: false,
          reason: 'consent_failed',
          message: (err as Error)?.message,
        };
      }

      // Gate 4: OS background permission. Triggers the system "Always Allow"
      // / "Allow all the time" prompt. The user CAN deny here even after
      // accepting our explainer — we honor that and roll back consent.
      let bg = await Location.getBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        try {
          bg = await Location.requestBackgroundPermissionsAsync();
        } catch (err) {
          await safeRevokeOnRollback(uid, revokeConsentMut);
          return {
            ok: false,
            reason: 'background_permission_denied',
            message: (err as Error)?.message,
          };
        }
      }
      if (bg.status !== 'granted') {
        await safeRevokeOnRollback(uid, revokeConsentMut);
        return { ok: false, reason: 'background_permission_denied' };
      }

      // Gate 5: Platform-specific server flag.
      //   - Android: open a Discovery Mode window (auto-expires; backend
      //     rejects 'bg' samples once the window closes).
      //   - iOS:   set backgroundLocationEnabled=true (gates 'slc' samples).
      try {
        if (Platform.OS === 'android') {
          await startDiscoveryMut({ authUserId: uid });
        } else {
          await updateNearbySettingsMut({
            authUserId: uid,
            backgroundLocationEnabled: true,
          });
        }
      } catch (err) {
        await safeRevokeOnRollback(uid, revokeConsentMut);
        return {
          ok: false,
          reason: 'platform_setup_failed',
          message: (err as Error)?.message,
        };
      }

      // Gate 6: Start the OS background-location task. The task itself was
      // registered at module-load by the root layout's import of
      // `@/tasks/backgroundLocationTask` — this is the first time it actually
      // runs.
      try {
        const opts: Location.LocationTaskOptions =
          Platform.OS === 'android'
            ? {
                accuracy: Location.Accuracy.Balanced,
                // Android: foreground-service-backed updates. The system
                // notification is REQUIRED on Android 14+ for
                // FOREGROUND_SERVICE_LOCATION; the copy explicitly tells the
                // user how to turn it off (Nearby Settings).
                timeInterval: 60_000,
                distanceInterval: 100,
                deferredUpdatesInterval: 60_000,
                deferredUpdatesDistance: 100,
                pausesUpdatesAutomatically: false,
                showsBackgroundLocationIndicator: false,
                foregroundService: {
                  notificationTitle: 'Mira',
                  notificationBody:
                    'Recording crossed paths. You can turn this off in Nearby Settings.',
                },
              }
            : {
                // iOS: low accuracy + automatic-pause + Other activity type
                // is the documented expo-location pattern that lines up with
                // CoreLocation's Significant Location Change service. Samples
                // arrive infrequently (city-block scale), aligning with the
                // backend's privacy-protective coarsening.
                accuracy: Location.Accuracy.Balanced,
                distanceInterval: 100,
                pausesUpdatesAutomatically: true,
                showsBackgroundLocationIndicator: false,
                activityType: Location.ActivityType.Other,
              };
        await Location.startLocationUpdatesAsync(
          BACKGROUND_LOCATION_TASK_NAME,
          opts,
        );
      } catch (err) {
        // Roll back: stop platform flag, then revoke consent.
        try {
          if (Platform.OS === 'android') {
            await stopDiscoveryMut({ authUserId: uid });
          } else {
            await updateNearbySettingsMut({
              authUserId: uid,
              backgroundLocationEnabled: false,
            });
          }
        } catch {
          // Swallow — revoke below also clears these defensively.
        }
        await safeRevokeOnRollback(uid, revokeConsentMut);
        return {
          ok: false,
          reason: 'task_start_failed',
          message: (err as Error)?.message,
        };
      }

      return { ok: true };
    }, [
      acceptConsentMut,
      revokeConsentMut,
      startDiscoveryMut,
      stopDiscoveryMut,
      updateNearbySettingsMut,
    ]);

  // -------------------------------------------------------------------------
  // disableBackgroundCrossedPaths
  // -------------------------------------------------------------------------
  // Order matters here:
  //   1. Stop the OS task FIRST so no further samples enqueue while we tear
  //      down the rest of the state.
  //   2. Clear the on-disk buffer so retries can't resurface dropped samples.
  //   3. Best-effort stop platform-specific flag (Discovery / iOS bg flag).
  //      `revokeConsent` below also clears these, but we send the targeted
  //      mutation first so the platform-specific telemetry log fires.
  //   4. Revoke server-side consent — this is the canonical "off" mutation
  //      and ALWAYS succeeds for an authenticated user (backend code path
  //      never throws here).
  const disableBackgroundCrossedPaths =
    useCallback(async (): Promise<BgDisableResult> => {
      await stopBackgroundTaskSafe();
      backgroundLocationBuffer.clear();

      if (isDemoMode) return { ok: true };
      const uid = userIdRef.current;
      if (!uid) {
        // No auth: client-side state is fully cleared, that's the best we
        // can do. Treat as success so the UI shows OFF.
        return { ok: true };
      }
      try {
        if (Platform.OS === 'android') {
          try {
            await stopDiscoveryMut({ authUserId: uid });
          } catch {
            // Swallow — revoke below also clears Discovery state.
          }
        } else {
          try {
            await updateNearbySettingsMut({
              authUserId: uid,
              backgroundLocationEnabled: false,
            });
          } catch {
            // Swallow — revoke below also clears backgroundLocationEnabled.
          }
        }
        await revokeConsentMut({ authUserId: uid });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: 'revoke_failed',
          message: (err as Error)?.message,
        };
      }
    }, [revokeConsentMut, stopDiscoveryMut, updateNearbySettingsMut]);

  // -------------------------------------------------------------------------
  // Auto-flush on foreground transition. Gated on the client feature flag
  // so this is a no-op until Phase-3 is unlocked.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!BG_CROSSED_PATHS_FEATURE_READY) return;
    if (isDemoMode) return;
    if (!userId) return;

    let cancelled = false;
    const tryDrain = () => {
      if (cancelled) return;
      flushPendingBackgroundSamples().catch(() => {
        // Already swallowed inside flushPendingBackgroundSamples.
      });
    };

    // Drain once on mount in case the headless task buffered samples while
    // the app was killed/backgrounded.
    tryDrain();

    const sub = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => {
        if (next === 'active') tryDrain();
      },
    );

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId, flushPendingBackgroundSamples]);

  return {
    getBackgroundLocationStatus,
    enableBackgroundCrossedPaths,
    disableBackgroundCrossedPaths,
    flushPendingBackgroundSamples,
  };
}

// ---------------------------------------------------------------------------
// Internal: best-effort consent rollback. Used when a later step in the
// enable flow fails so we don't leave the server in a "consented but not
// running" state. Never throws — rollback is best-effort.
// ---------------------------------------------------------------------------
async function safeRevokeOnRollback(
  authUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  revokeMut: (args: { authUserId: string }) => Promise<any>,
): Promise<void> {
  try {
    await revokeMut({ authUserId });
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[BG_LOCATION] rollback revoke failed:',
        (err as Error)?.message,
      );
    }
  }
}
