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
import { useConvex, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import {
  BG_CROSSED_PATHS_FEATURE_READY,
  BACKGROUND_FLUSH_TASK_NAME,
  getLocalBackgroundCrossedPathsEnabled,
  registerBackgroundCrossedPathsFlushTask,
  setLocalBackgroundCrossedPathsEnabled,
  unregisterBackgroundCrossedPathsFlushTask,
} from '@/lib/backgroundCrossedPaths';
import {
  flushBufferedBackgroundSamples,
  type BackgroundFlushResult,
} from '@/lib/backgroundCrossedPathsFlush';
import { recordBgCrossedPathsBreadcrumb } from '@/lib/backgroundCrossedPathsTelemetry';
import { BACKGROUND_LOCATION_TASK_NAME } from '@/tasks/backgroundLocationTask';
import { backgroundLocationBuffer } from '@/stores/backgroundLocationBufferStore';
import { getAuthBootCache } from '@/stores/authBootCache';
import { captureException as sentryCaptureException } from '@/lib/sentry';

// Native rejection from expo-location when the AndroidManifest is missing
// ACCESS_BACKGROUND_LOCATION (or similar misconfiguration). We sniff for
// these markers so the UI can render a friendly "needs app update" message
// instead of the raw native error string.
const NATIVE_MANIFEST_MARKERS = [
  'ACCESS_BACKGROUND_LOCATION',
  'AndroidManifest',
  'ExpoLocation.getBackgroundPermissionsAsync',
  'ExpoLocation.requestBackgroundPermissionsAsync',
];

function isNativeManifestError(err: unknown): boolean {
  const msg = (err as Error)?.message || String(err ?? '');
  return NATIVE_MANIFEST_MARKERS.some((m) => msg.includes(m));
}

function reportBgPermissionError(
  err: unknown,
  context: {
    stage: 'get' | 'request';
    nativeManifest: boolean;
  },
): void {
  try {
    sentryCaptureException(err, {
      tags: {
        area: 'nearby_settings',
        feature: 'background_detection',
        action: 'allow_background',
        platform: Platform.OS,
        stage: context.stage,
        native_manifest_error: context.nativeManifest ? 'true' : 'false',
      },
      extra: {
        message: (err as Error)?.message,
      },
      level: 'error',
    });
  } catch {
    // Sentry helper is already defensive, but never let logging surface
    // an error to the caller.
  }
}

// ---------------------------------------------------------------------------
// Public result types — the hook NEVER throws, callers branch on `ok`.
// ---------------------------------------------------------------------------

export type BgEnableFailureReason =
  | 'feature_not_ready'
  | 'feature_disabled_server'
  | 'demo_mode'
  | 'not_authenticated'
  | 'foreground_permission_denied'
  | 'background_permission_denied'
  // Native/Expo module rejected the call because the installed binary is
  // missing manifest entries (e.g. ACCESS_BACKGROUND_LOCATION). Requires
  // an app rebuild + reinstall — not something the user can fix in app.
  | 'native_misconfigured'
  | 'consent_required'
  | 'consent_failed'
  | 'server_failed'
  | 'platform_setup_failed'
  | 'task_start_failed';

export type BgEnableResult =
  | { ok: true }
  | { ok: false; reason: BgEnableFailureReason; message?: string };

export type BgDisableFailureReason = 'not_authenticated' | 'revoke_failed';

export type BgDisableResult =
  | { ok: true }
  | { ok: false; reason: BgDisableFailureReason; message?: string };

export type BgFlushResult = BackgroundFlushResult;

type ServerBackgroundGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'feature_disabled_server' | 'consent_required' | 'not_authenticated' | 'server_failed';
      message?: string;
    };

const SENTRY_THROTTLE_MS = 10 * 60 * 1000;
const sentryLastCapturedAt = new Map<string, number>();

function captureBgReliabilityIssue(
  action: 'enable_background' | 'flush_background_samples',
  reason: string,
  err?: unknown,
): void {
  const key = `${action}:${reason}`;
  const now = Date.now();
  const lastCapturedAt = sentryLastCapturedAt.get(key) ?? 0;
  if (now - lastCapturedAt < SENTRY_THROTTLE_MS) return;
  sentryLastCapturedAt.set(key, now);

  try {
    sentryCaptureException(
      err instanceof Error
        ? err
        : new Error(`Nearby background ${action} blocked: ${reason}`),
      {
        tags: {
          area: 'nearby',
          feature: 'background_crossed_paths',
          action,
          reason,
          platform: Platform.OS,
        },
        extra: {
          message: err ? String(err) : undefined,
        },
        level: reason === 'server_failed' ? 'error' : 'warning',
      },
    );
  } catch {}
}

function normalizeServerBackgroundReason(reason: string | undefined | null):
  | 'feature_disabled_server'
  | 'consent_required'
  | null {
  if (reason === 'feature_not_ready' || reason === 'feature_disabled_server') {
    return 'feature_disabled_server';
  }
  if (
    reason === 'consent_required' ||
    reason === 'bg_consent_required' ||
    reason === 'background_consent_required'
  ) {
    return 'consent_required';
  }
  return null;
}

export type BgStatus = {
  /** Mirror of the client-side feature gate. Currently false. */
  featureReady: boolean;
  /** featureReady && !demoMode — UI uses this to disable the toggle. */
  available: boolean;
  /** OS-level "while-using-the-app" permission. */
  foregroundPermissionGranted: boolean;
  /** OS-level "always" / Android background permission. */
  backgroundPermissionGranted: boolean;
  /** False when the OS requires opening app settings to grant background permission. */
  backgroundPermissionCanAskAgain: boolean;
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
  let backgroundPermissionCanAskAgain = true;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    foregroundPermissionGranted = fg.status === 'granted';
  } catch {
    foregroundPermissionGranted = false;
  }
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    backgroundPermissionGranted = bg.status === 'granted';
    backgroundPermissionCanAskAgain = bg.canAskAgain !== false;
  } catch {
    backgroundPermissionGranted = false;
    backgroundPermissionCanAskAgain = true;
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
    backgroundPermissionCanAskAgain,
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
      recordBgCrossedPathsBreadcrumb('background_location_task_stopped');
    }
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('background_location_task_stop_failed', {
      reason: 'stop_failed',
    });
    if (__DEV__) {
      console.warn(
        '[BG_LOCATION] stopBackgroundTaskSafe failed:',
        (err as Error)?.message,
      );
    }
  }
}

function getBackgroundLocationTaskOptions(): Location.LocationTaskOptions {
  return Platform.OS === 'android'
    ? {
        accuracy: Location.Accuracy.Balanced,
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
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 100,
        pausesUpdatesAutomatically: true,
        showsBackgroundLocationIndicator: false,
        activityType: Location.ActivityType.Other,
      };
}

export async function recoverBackgroundCrossedPathsTasks(): Promise<void> {
  if (Platform.OS !== 'android') return;

  if (!BG_CROSSED_PATHS_FEATURE_READY) {
    recordBgCrossedPathsBreadcrumb('recovery_skipped', {
      reason: 'feature_not_ready',
      platform: Platform.OS,
    });
    if (__DEV__) console.log('[BG_RECOVERY] skipped: feature not ready');
    return;
  }

  const locallyEnabled = await getLocalBackgroundCrossedPathsEnabled();
  if (!locallyEnabled) {
    recordBgCrossedPathsBreadcrumb('recovery_skipped', {
      reason: 'local_opt_in_missing',
      platform: Platform.OS,
    });
    if (__DEV__) console.log('[BG_RECOVERY] skipped: local opt-in missing');
    return;
  }

  const auth = await getAuthBootCache();
  if (!auth.isAuthenticated || !auth.userId || !auth.token) {
    recordBgCrossedPathsBreadcrumb('recovery_failed', {
      reason: 'not_authenticated',
      platform: Platform.OS,
    });
    if (__DEV__) console.log('[BG_RECOVERY] failed: not_authenticated');
    return;
  }

  try {
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK_NAME)) {
      recordBgCrossedPathsBreadcrumb('recovery_failed', {
        reason: 'location_task_not_defined',
        platform: Platform.OS,
      });
      if (__DEV__) console.log('[BG_RECOVERY] failed: location task not defined');
      return;
    }
    if (!TaskManager.isTaskDefined(BACKGROUND_FLUSH_TASK_NAME)) {
      recordBgCrossedPathsBreadcrumb('recovery_failed', {
        reason: 'flush_task_not_defined',
        platform: Platform.OS,
      });
      if (__DEV__) console.log('[BG_RECOVERY] failed: flush task not defined');
      return;
    }

    const backgroundPermission = await Location.getBackgroundPermissionsAsync();
    if (backgroundPermission.status !== 'granted') {
      recordBgCrossedPathsBreadcrumb('recovery_failed', {
        reason: 'background_permission_missing',
        platform: Platform.OS,
      });
      if (__DEV__) console.log('[BG_RECOVERY] failed: background permission missing');
      return;
    }

    let repaired = false;
    const locationStarted = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK_NAME,
    );
    if (!locationStarted) {
      await Location.startLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK_NAME,
        getBackgroundLocationTaskOptions(),
      );
      recordBgCrossedPathsBreadcrumb('background_location_task_started', {
        source: 'recovery',
        platform: Platform.OS,
      });
      repaired = true;
    }

    const flushRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_FLUSH_TASK_NAME,
    );
    if (!flushRegistered) {
      const result = await registerBackgroundCrossedPathsFlushTask();
      repaired = repaired || result.registered;
    }

    if (__DEV__) {
      console.log(
        repaired
          ? '[BG_RECOVERY] repaired: tasks re-registered'
          : '[BG_RECOVERY] checked: tasks already registered',
      );
    }
    recordBgCrossedPathsBreadcrumb(repaired ? 'recovery_repaired' : 'recovery_checked', {
      repaired,
      platform: Platform.OS,
    });
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('recovery_failed', {
      reason: 'exception',
      platform: Platform.OS,
    });
    if (__DEV__) {
      console.warn('[BG_RECOVERY] failed:', (err as Error)?.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBackgroundLocation() {
  const convex = useConvex();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  // Capture in a ref so async callbacks see the latest value without
  // re-binding the callbacks on every render.
  const userIdRef = useRef(userId);
  const tokenRef = useRef(token);
  userIdRef.current = userId;
  tokenRef.current = token;

  const acceptConsentMut = useMutation(api.users.acceptBackgroundLocationConsent);
  const revokeConsentMut = useMutation(api.users.revokeBackgroundLocationConsent);
  const startDiscoveryMut = useMutation(api.users.startDiscoveryMode);
  const stopDiscoveryMut = useMutation(api.users.stopDiscoveryMode);
  const updateNearbySettingsMut = useMutation(api.users.updateNearbySettings);
  const recordBatchMut = useMutation(api.crossedPaths.recordLocationBatch);

  /** Single-flight guard so AppState 'active' bursts don't trigger overlapping
   *  flushes. */
  const flushInFlightRef = useRef(false);

  const checkServerBackgroundGate = useCallback(
    async (): Promise<ServerBackgroundGateResult> => {
      const sessionToken = typeof tokenRef.current === 'string' ? tokenRef.current.trim() : '';
      if (!sessionToken || !userIdRef.current) {
        return { ok: false, reason: 'not_authenticated' };
      }

      try {
        const status = await convex.query(api.crossedPaths.getBackgroundCrossedPathsStatus, {
          token: sessionToken,
        });
        recordBgCrossedPathsBreadcrumb('server_background_status_checked', {
          serverFeatureEnabled: status.serverFeatureEnabled,
          reconsentRequired: status.reconsentRequired,
          reason: status.reason ?? 'ok',
          platform: Platform.OS,
        });

        if (!status.serverFeatureEnabled) {
          captureBgReliabilityIssue('enable_background', 'feature_disabled_server');
          return {
            ok: false,
            reason: 'feature_disabled_server',
            message:
              'Background detection is not available yet. You can still use Nearby while the app is open.',
          };
        }
        if (status.reconsentRequired) {
          captureBgReliabilityIssue('enable_background', 'consent_required');
          return {
            ok: false,
            reason: 'consent_required',
            message: 'Please confirm background detection again to continue.',
          };
        }

        return { ok: true };
      } catch (err) {
        const normalized = normalizeServerBackgroundReason((err as Error)?.message);
        const reason = normalized ?? 'server_failed';
        captureBgReliabilityIssue('enable_background', reason, err);
        return {
          ok: false,
          reason,
          message: (err as Error)?.message,
        };
      }
    },
    [convex],
  );

  // -------------------------------------------------------------------------
  // flushPendingBackgroundSamples
  // -------------------------------------------------------------------------
  const flushPendingBackgroundSamples = useCallback(async (): Promise<BgFlushResult> => {
    if (flushInFlightRef.current) {
      recordBgCrossedPathsBreadcrumb('flush_skipped', {
        reason: 'in_flight',
      });
      return { flushed: 0, accepted: 0, skipped: true, reason: 'in_flight' };
    }

    flushInFlightRef.current = true;
    try {
      return await flushBufferedBackgroundSamples({
        userId: userIdRef.current,
        token: tokenRef.current,
        logPrefix: 'BG_LOCATION',
        requireLocalEnablement: true,
        uploadBatch: async ({ samples, deviceHash }) => {
          const sessionToken = typeof tokenRef.current === 'string' ? tokenRef.current.trim() : '';
          const result = (await recordBatchMut({
            token: sessionToken,
            samples,
            deviceHash,
          })) as { success?: boolean; accepted?: number; reason?: string } | undefined;
          const blockedReason = normalizeServerBackgroundReason(result?.reason);
          if (blockedReason) {
            captureBgReliabilityIssue('flush_background_samples', blockedReason);
          }
          return result;
        },
      });
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
        recordBgCrossedPathsBreadcrumb('enable_gate_skipped', {
          gate: 'feature_ready',
          reason: 'feature_not_ready',
        });
        return {
          ok: false,
          reason: 'feature_not_ready',
          message:
            'Background crossed paths is not yet available in this version.',
        };
      }
      if (isDemoMode) {
        recordBgCrossedPathsBreadcrumb('enable_gate_skipped', {
          gate: 'demo_mode',
          reason: 'demo_mode',
        });
        return { ok: false, reason: 'demo_mode' };
      }
      const uid = userIdRef.current;
      const sessionToken = typeof tokenRef.current === 'string' ? tokenRef.current.trim() : '';
      if (!uid || !sessionToken) {
        recordBgCrossedPathsBreadcrumb('enable_gate_skipped', {
          gate: 'auth',
          reason: 'not_authenticated',
        });
        return { ok: false, reason: 'not_authenticated' };
      }

      const serverGate = await checkServerBackgroundGate();
      if (!serverGate.ok) {
        recordBgCrossedPathsBreadcrumb('enable_gate_skipped', {
          gate: 'server_status',
          reason: serverGate.reason,
        });
        return {
          ok: false,
          reason: serverGate.reason,
          message: serverGate.message,
        };
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
          recordBgCrossedPathsBreadcrumb('os_permission_result', {
            permission: 'foreground',
            granted: false,
            reason: 'request_failed',
          });
          return {
            ok: false,
            reason: 'foreground_permission_denied',
            message: (err as Error)?.message,
          };
        }
      }
      if (fg.status !== 'granted') {
        recordBgCrossedPathsBreadcrumb('os_permission_result', {
          permission: 'foreground',
          granted: false,
          reason: 'denied',
        });
        return { ok: false, reason: 'foreground_permission_denied' };
      }
      recordBgCrossedPathsBreadcrumb('os_permission_result', {
        permission: 'foreground',
        granted: true,
      });

      // Gate 3: Server-side consent stamp. We record consent BEFORE asking
      // for OS background permission so a user who declines the OS prompt
      // can still be revoked via `disableBackgroundCrossedPaths` cleanly,
      // and so the backend never sees a pre-consent OS-permission attempt
      // (defense in depth — UI also gates).
      try {
        await acceptConsentMut({ token: sessionToken, authUserId: uid });
        recordBgCrossedPathsBreadcrumb('server_consent_result', {
          success: true,
        });
      } catch (err) {
        const normalized = normalizeServerBackgroundReason((err as Error)?.message);
        if (normalized) {
          captureBgReliabilityIssue('enable_background', normalized, err);
          recordBgCrossedPathsBreadcrumb('server_consent_result', {
            success: false,
            reason: normalized,
          });
          return {
            ok: false,
            reason: normalized,
            message: (err as Error)?.message,
          };
        }
        recordBgCrossedPathsBreadcrumb('server_consent_result', {
          success: false,
          reason: 'consent_failed',
        });
        return {
          ok: false,
          reason: 'consent_failed',
          message: (err as Error)?.message,
        };
      }

      // Gate 4: OS background permission. Triggers the system "Always Allow"
      // / "Allow all the time" prompt. The user CAN deny here even after
      // accepting our explainer — we honor that and roll back consent.
      //
      // Both `get` and `request` calls can reject natively if the installed
      // binary is missing manifest entries (e.g. ACCESS_BACKGROUND_LOCATION
      // on Android). We MUST catch both so the rejection never escapes as
      // an unhandled promise + LogBox to the user, and so Sentry sees the
      // technical detail under tagged context.
      let bg: Awaited<ReturnType<typeof Location.getBackgroundPermissionsAsync>>;
      try {
        bg = await Location.getBackgroundPermissionsAsync();
      } catch (err) {
        const manifestErr = isNativeManifestError(err);
        reportBgPermissionError(err, {
          stage: 'get',
          nativeManifest: manifestErr,
        });
        await safeRevokeOnRollback(uid, sessionToken, revokeConsentMut);
        recordBgCrossedPathsBreadcrumb('os_permission_result', {
          permission: 'background',
          granted: false,
          reason: manifestErr ? 'native_misconfigured' : 'get_failed',
        });
        return {
          ok: false,
          reason: manifestErr ? 'native_misconfigured' : 'background_permission_denied',
        };
      }
      if (bg.status !== 'granted') {
        try {
          bg = await Location.requestBackgroundPermissionsAsync();
        } catch (err) {
          const manifestErr = isNativeManifestError(err);
          reportBgPermissionError(err, {
            stage: 'request',
            nativeManifest: manifestErr,
          });
          await safeRevokeOnRollback(uid, sessionToken, revokeConsentMut);
          recordBgCrossedPathsBreadcrumb('os_permission_result', {
            permission: 'background',
            granted: false,
            reason: manifestErr ? 'native_misconfigured' : 'request_failed',
          });
          return {
            ok: false,
            reason: manifestErr ? 'native_misconfigured' : 'background_permission_denied',
          };
        }
      }
      if (bg.status !== 'granted') {
        await safeRevokeOnRollback(uid, sessionToken, revokeConsentMut);
        recordBgCrossedPathsBreadcrumb('os_permission_result', {
          permission: 'background',
          granted: false,
          reason: 'denied',
        });
        return { ok: false, reason: 'background_permission_denied' };
      }
      recordBgCrossedPathsBreadcrumb('os_permission_result', {
        permission: 'background',
        granted: true,
      });

      // Gate 5: Platform-specific server flag.
      //   - Android: open a Discovery Mode window (auto-expires; backend
      //     rejects 'bg' samples once the window closes).
      //   - iOS:   set backgroundLocationEnabled=true (gates 'slc' samples).
      try {
        if (Platform.OS === 'android') {
          await startDiscoveryMut({ token: sessionToken, authUserId: uid });
        } else {
          await updateNearbySettingsMut({
            token: sessionToken,
            backgroundLocationEnabled: true,
          });
        }
        recordBgCrossedPathsBreadcrumb('platform_setup_result', {
          success: true,
          platform: Platform.OS,
        });
      } catch (err) {
        const normalized = normalizeServerBackgroundReason((err as Error)?.message);
        if (normalized) {
          captureBgReliabilityIssue('enable_background', normalized, err);
          await safeRevokeOnRollback(uid, sessionToken, revokeConsentMut);
          recordBgCrossedPathsBreadcrumb('platform_setup_result', {
            success: false,
            platform: Platform.OS,
            reason: normalized,
          });
          return {
            ok: false,
            reason: normalized,
            message: (err as Error)?.message,
          };
        }
        await safeRevokeOnRollback(uid, sessionToken, revokeConsentMut);
        recordBgCrossedPathsBreadcrumb('platform_setup_result', {
          success: false,
          platform: Platform.OS,
          reason: 'platform_setup_failed',
        });
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
        await Location.startLocationUpdatesAsync(
          BACKGROUND_LOCATION_TASK_NAME,
          getBackgroundLocationTaskOptions(),
        );
        recordBgCrossedPathsBreadcrumb('background_location_task_started', {
          source: 'enable_flow',
          platform: Platform.OS,
        });
      } catch (err) {
        // Roll back: stop platform flag, then revoke consent.
        try {
          if (Platform.OS === 'android') {
            await stopDiscoveryMut({ token: sessionToken, authUserId: uid });
          } else if (sessionToken) {
            await updateNearbySettingsMut({
              token: sessionToken,
              backgroundLocationEnabled: false,
            });
          }
        } catch {
          // Swallow — revoke below also clears these defensively.
        }
        await safeRevokeOnRollback(uid, sessionToken, revokeConsentMut);
        recordBgCrossedPathsBreadcrumb('background_location_task_start_failed', {
          reason: 'task_start_failed',
          platform: Platform.OS,
        });
        return {
          ok: false,
          reason: 'task_start_failed',
          message: (err as Error)?.message,
        };
      }

      await setLocalBackgroundCrossedPathsEnabled(true);
      await registerBackgroundCrossedPathsFlushTask();
      recordBgCrossedPathsBreadcrumb('enable_flow_succeeded', {
        platform: Platform.OS,
      });

      return { ok: true };
    }, [
      acceptConsentMut,
      checkServerBackgroundGate,
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
  //   2. Unregister the deferred flush task and clear local enablement.
  //   3. Clear the on-disk buffer so retries can't resurface dropped samples.
  //   4. Best-effort stop platform-specific flag (Discovery / iOS bg flag).
  //      `revokeConsent` below also clears these, but we send the targeted
  //      mutation first so the platform-specific telemetry log fires.
  //   5. Revoke server-side consent — this is the canonical "off" mutation
  //      and ALWAYS succeeds for an authenticated user (backend code path
  //      never throws here).
  const disableBackgroundCrossedPaths =
    useCallback(async (): Promise<BgDisableResult> => {
      await stopBackgroundTaskSafe();
      await unregisterBackgroundCrossedPathsFlushTask();
      const pendingBeforeClear = backgroundLocationBuffer.size();
      backgroundLocationBuffer.clear();
      recordBgCrossedPathsBreadcrumb('disable_flow_local_cleanup', {
        clearedCount: pendingBeforeClear,
      });

      if (isDemoMode) return { ok: true };
      const uid = userIdRef.current;
      if (!uid) {
        // No auth: client-side state is fully cleared, that's the best we
        // can do. Treat as success so the UI shows OFF.
        return { ok: true };
      }
      const sessionToken = typeof tokenRef.current === 'string' ? tokenRef.current.trim() : '';
      if (!sessionToken) {
        return { ok: false, reason: 'not_authenticated' };
      }
      try {
        if (Platform.OS === 'android') {
          try {
            await stopDiscoveryMut({ token: sessionToken, authUserId: uid });
          } catch {
            // Swallow — revoke below also clears Discovery state.
          }
        } else if (sessionToken) {
          try {
            await updateNearbySettingsMut({
              token: sessionToken,
              backgroundLocationEnabled: false,
            });
          } catch {
            // Swallow — revoke below also clears backgroundLocationEnabled.
          }
        }
        await revokeConsentMut({ token: sessionToken, authUserId: uid });
        recordBgCrossedPathsBreadcrumb('server_revoke_result', {
          success: true,
        });
        return { ok: true };
      } catch (err) {
        recordBgCrossedPathsBreadcrumb('server_revoke_result', {
          success: false,
          reason: 'revoke_failed',
        });
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
  token: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  revokeMut: (args: { token: string; authUserId: string }) => Promise<any>,
): Promise<void> {
  if (!token) return;
  try {
    await revokeMut({ token, authUserId });
    recordBgCrossedPathsBreadcrumb('server_revoke_result', {
      success: true,
      source: 'rollback',
    });
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('server_revoke_result', {
      success: false,
      source: 'rollback',
      reason: 'rollback_failed',
    });
    if (__DEV__) {
      console.warn(
        '[BG_LOCATION] rollback revoke failed:',
        (err as Error)?.message,
      );
    }
  }
}
