import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import { recordBgCrossedPathsBreadcrumb } from '@/lib/backgroundCrossedPathsTelemetry';

/**
 * Lazy-load the native `expo-background-task` module. Phase-2/dev builds may
 * not bundle the native binding, so a top-level `import` would crash app
 * startup with "Cannot find native module 'ExpoBackgroundTask'". Each helper
 * below calls this only after `BG_CROSSED_PATHS_FEATURE_READY` is verified.
 * If the require throws (module missing), we fail-soft and return null.
 */
function loadBackgroundTaskModule(): typeof import('expo-background-task') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-background-task') as typeof import('expo-background-task');
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[BG_FLUSH_TASK] expo-background-task native module unavailable.',
        (err as Error)?.message,
      );
    }
    return null;
  }
}

/**
 * Background Crossed Paths — Phase-3 client surface
 *
 * Real background-location opt-in is now wired end-to-end:
 *   - backend `featureFlags.bgCrossedPathsEnabled` row (admin-seeded)
 *   - native ACCESS_BACKGROUND_LOCATION + FOREGROUND_SERVICE_LOCATION (Android)
 *   - iOS Significant Location Change task (registered via expo-location)
 *   - Android Discovery Mode task via TaskManager
 *   - `acceptBackgroundLocationConsent` mutation on explicit ON-flip
 *
 * The toggle remains gated by both this client flag AND the backend feature
 * flag, so the backend can still freeze writes if needed. Revoke
 * (`revokeBackgroundLocationConsent`) is always reachable so consent can be
 * cleared regardless of feature gate state.
 */

/**
 * Client-side gate for the Background Crossed Paths surface.
 *
 * When `true`, the Settings UI exposes the explicit enable flow that triggers
 * `acceptBackgroundLocationConsent` and the OS permission prompts. The
 * backend independently re-validates `featureFlags.bgCrossedPathsEnabled` on
 * every write path, so this client flag alone cannot bypass server gating.
 */
export const BG_CROSSED_PATHS_FEATURE_READY = true;

export const BACKGROUND_FLUSH_TASK_NAME = 'mira-background-crossed-paths-flush-v1';
const BACKGROUND_FLUSH_MIN_INTERVAL_MINUTES = 60;
const LOCAL_BG_CROSSED_PATHS_ENABLED_KEY = 'mira_bg_crossed_paths_enabled_v1';

/**
 * Mirror of the backend `BG_LOCATION_CONSENT_VERSION` (in `convex/crossedPaths.ts`).
 * Used by the UI to decide whether an existing consent stamp is still
 * current. Purely advisory on the client — backend re-validates on every
 * write path.
 */
export const BG_LOCATION_CONSENT_VERSION = 'bg_crossed_paths_v1';

/** Copy strings for the Background Crossed Paths surface. Centralized so
 *  product can iterate without spelunking through the settings file. */
export const BG_COPY = {
  sectionTitle: 'Background detection',
  sectionTagline:
    'Optional background detection for crossed paths when Mira is not open.',
  toggleTitle: 'Background detection',
  toggleDescriptionUnavailable:
    'Background detection is temporarily paused.',
  toggleDescriptionReady:
    'Mira can detect crossed paths when the app is not open after you allow background location.',
  androidBatteryTitle: 'Android reliability',
  androidBatteryDescription:
    'Samsung, OnePlus, and some Android phones may pause background detection to save battery. You can improve reliability by allowing Mira unrestricted battery usage in Android settings.',
  androidBatteryAction: 'Open app settings',
  statusComingSoon: 'Feature paused/off',
  statusConsentGranted: 'Background ON',
  statusConsentNone: 'Foreground only',
  discoveryActiveLabel: 'Discovery Mode active',
  discoveryInactiveLabel: 'Discovery Mode off',
  // Explainer modal copy
  explainerTitle: 'Background detection',
  explainerLead:
    'Background detection helps Mira detect crossed paths when the app is not open.',
  explainerBullets: [
    'Your exact location is never shown.',
    'Foreground Nearby still works without background permission.',
    'You can turn this off anytime from Nearby Settings.',
    'Privacy zones, pause, Incognito, and phone battery settings still apply.',
  ],
  explainerNoticeUnavailable:
    'Background detection is paused right now.',
  explainerNoticeReady:
    'Mira will ask your phone for background location permission only after you continue.',
  explainerCancel: 'Cancel',
  explainerContinueUnavailable: 'OK, got it',
  explainerContinueReady: 'Allow background',
  // Revoke confirmation copy
  revokeNote:
    'Turning this off clears background consent and disables background detection.',
} as const;

/**
 * Resolve the user-visible status for the Background Crossed Paths section
 * given the consent fields surfaced by `getCurrentUser`.
 *
 * Returns one of:
 *   - 'unavailable' — backend feature flag is OFF (Phase-2 default)
 *   - 'granted'     — consent recorded with the current version
 *   - 'stale'       — consent recorded but version mismatches (must re-accept)
 *   - 'none'        — no consent on file
 */
export type BgConsentStatus = 'unavailable' | 'granted' | 'stale' | 'none';

export function resolveBgConsentStatus(args: {
  featureReady: boolean;
  consentAt: number | undefined | null;
  consentVersion: string | undefined | null;
}): BgConsentStatus {
  if (!args.featureReady) return 'unavailable';
  if (typeof args.consentAt !== 'number' || args.consentAt <= 0) return 'none';
  if (args.consentVersion !== BG_LOCATION_CONSENT_VERSION) return 'stale';
  return 'granted';
}

/**
 * Format a "Discovery Mode active — ends in 3h 12m" status line, or null when
 * the window has elapsed / never started.
 */
export function formatDiscoveryCountdown(expiresAt: number | undefined | null): string | null {
  if (typeof expiresAt !== 'number' || expiresAt <= 0) return null;
  const now = Date.now();
  if (expiresAt <= now) return null;
  const remainingMs = expiresAt - now;
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export async function getLocalBackgroundCrossedPathsEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LOCAL_BG_CROSSED_PATHS_ENABLED_KEY)) === '1';
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('local_opt_in_read_failed', {
      reason: 'storage_read_failed',
    });
    if (__DEV__) {
      console.warn('[BG_FLUSH_TASK] skipped reason=local_enabled_read_failed', (err as Error)?.message);
    }
    return false;
  }
}

export async function setLocalBackgroundCrossedPathsEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await AsyncStorage.setItem(LOCAL_BG_CROSSED_PATHS_ENABLED_KEY, '1');
    } else {
      await AsyncStorage.removeItem(LOCAL_BG_CROSSED_PATHS_ENABLED_KEY);
    }
    recordBgCrossedPathsBreadcrumb('local_opt_in_updated', { enabled });
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('local_opt_in_update_failed', {
      enabled,
      reason: 'storage_write_failed',
    });
    if (__DEV__) {
      console.warn('[BG_FLUSH_TASK] local enablement write failed:', (err as Error)?.message);
    }
  }
}

export async function registerBackgroundCrossedPathsFlushTask(): Promise<{
  registered: boolean;
  reason?: string;
}> {
  if (!BG_CROSSED_PATHS_FEATURE_READY) {
    recordBgCrossedPathsBreadcrumb('deferred_flush_register_skipped', {
      reason: 'feature_not_ready',
    });
    if (__DEV__) console.log('[BG_FLUSH_TASK] skipped reason=feature_not_ready');
    return { registered: false, reason: 'feature_not_ready' };
  }

  const locallyEnabled = await getLocalBackgroundCrossedPathsEnabled();
  if (!locallyEnabled) {
    recordBgCrossedPathsBreadcrumb('deferred_flush_register_skipped', {
      reason: 'locally_disabled',
    });
    if (__DEV__) console.log('[BG_FLUSH_TASK] skipped reason=locally_disabled');
    return { registered: false, reason: 'locally_disabled' };
  }

  // Phase-3 ON path only: resolve the native module here so Phase-2/dev
  // builds without `expo-background-task` never crash module evaluation.
  const BackgroundTask = loadBackgroundTaskModule();
  if (!BackgroundTask) {
    recordBgCrossedPathsBreadcrumb('deferred_flush_register_skipped', {
      reason: 'native_module_unavailable',
    });
    if (__DEV__) console.warn('[BG_FLUSH_TASK] skipped reason=native_module_unavailable');
    return { registered: false, reason: 'native_module_unavailable' };
  }

  try {
    if (!TaskManager.isTaskDefined(BACKGROUND_FLUSH_TASK_NAME)) {
      recordBgCrossedPathsBreadcrumb('deferred_flush_register_skipped', {
        reason: 'task_not_defined',
      });
      if (__DEV__) console.warn('[BG_FLUSH_TASK] skipped reason=task_not_defined');
      return { registered: false, reason: 'task_not_defined' };
    }

    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      recordBgCrossedPathsBreadcrumb('deferred_flush_register_skipped', {
        reason: 'background_task_unavailable',
        status,
      });
      if (__DEV__) console.log('[BG_FLUSH_TASK] skipped reason=background_task_unavailable');
      return { registered: false, reason: 'background_task_unavailable' };
    }

    await BackgroundTask.registerTaskAsync(BACKGROUND_FLUSH_TASK_NAME, {
      minimumInterval: BACKGROUND_FLUSH_MIN_INTERVAL_MINUTES,
    });
    recordBgCrossedPathsBreadcrumb('deferred_flush_task_registered', {
      minimumIntervalMinutes: BACKGROUND_FLUSH_MIN_INTERVAL_MINUTES,
    });
    if (__DEV__) console.log('[BG_FLUSH_TASK] registered');
    return { registered: true };
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('deferred_flush_register_failed', {
      reason: 'register_failed',
    });
    if (__DEV__) {
      console.warn('[BG_FLUSH_TASK] failed reason=register_failed', (err as Error)?.message);
    }
    return { registered: false, reason: 'register_failed' };
  }
}

export async function unregisterBackgroundCrossedPathsFlushTask(): Promise<void> {
  // Lazy-load: if the native module isn't bundled (Phase-2/dev), there is
  // nothing to unregister at the OS level — clear the local opt-in flag and
  // exit cleanly so consent revocation paths still work.
  const BackgroundTask = loadBackgroundTaskModule();
  if (!BackgroundTask) {
    recordBgCrossedPathsBreadcrumb('deferred_flush_unregister_skipped', {
      reason: 'native_module_unavailable',
    });
    if (__DEV__) console.log('[BG_FLUSH_TASK] unregister skipped reason=native_module_unavailable');
    await setLocalBackgroundCrossedPathsEnabled(false);
    return;
  }

  try {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_FLUSH_TASK_NAME);
    recordBgCrossedPathsBreadcrumb('deferred_flush_task_unregistered');
    if (__DEV__) console.log('[BG_FLUSH_TASK] unregistered');
  } catch (err) {
    recordBgCrossedPathsBreadcrumb('deferred_flush_unregister_failed', {
      reason: 'unregister_failed',
    });
    if (__DEV__) {
      console.warn('[BG_FLUSH_TASK] failed reason=unregister_failed', (err as Error)?.message);
    }
  } finally {
    await setLocalBackgroundCrossedPathsEnabled(false);
  }
}
