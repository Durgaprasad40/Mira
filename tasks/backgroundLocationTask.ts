/**
 * backgroundLocationTask — Background Crossed Paths runtime.
 *
 * Phase-1 (iOS): Significant Location Change (always-on once enabled).
 * Phase-2 (Android): Discovery Mode — user-initiated, time-limited
 *                    foreground-service-backed location updates.
 *
 * This module is imported for its side-effect of registering a TaskManager
 * task so that background updates can forward samples to Convex. The same
 * task name is used on both platforms; the handler infers the platform
 * and tags samples with source='slc' (iOS) or source='bg' (Android).
 *
 * STRICT SCOPE:
 *   - iOS: unchanged from Phase-1 — enableBackgroundLocation() requests
 *          Always permission and starts SLC updates.
 *   - Android: enableAndroidDiscoveryMode(durationMs?) requests foreground
 *              + background permission, persists the expiry to SecureStore,
 *              and starts location updates with a persistent foreground-
 *              service notification. disableAndroidDiscoveryMode() stops
 *              cleanly. On each wake, the task self-checks the stored
 *              expiry and stops itself if the window has elapsed.
 *   - Opt-in only. Module import alone does NOT start updates.
 *   - Every sample is validated server-side against the user's
 *     backgroundLocationEnabled / discoveryModeEnabled flag before
 *     being persisted.
 *
 * DEBUG TAGS: [BG_LOCATION] (iOS), [ANDROID_DISCOVERY] (Android)
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import {
  buildNearbyBackgroundUploadBatch,
  clearNearbyBackgroundSampleQueue,
  enqueueNearbyBackgroundSamples,
  replaceNearbyBackgroundSampleQueue,
  type NearbyBackgroundSample,
} from '@/lib/nearbyBackgroundQueue';

/** Registered task name — referenced by startLocationUpdatesAsync. */
export const BACKGROUND_LOCATION_TASK = 'mira/bg-location-task';

/** SecureStore key used by the auth-boot cache (mira_auth_user_id). The
 *  background task reads authUserId from here so it can authenticate the
 *  Convex mutation without access to any React state. */
const USER_ID_KEY = 'mira_auth_user_id';

/** SecureStore key that stores the Discovery Mode expiry timestamp (ms).
 *  The background task reads this on every wake to enforce auto-expiry
 *  locally even if the server-side check would also reject. Writing is
 *  only done by enableAndroidDiscoveryMode / disableAndroidDiscoveryMode. */
const DISCOVERY_EXPIRES_KEY = 'mira_discovery_expires_at';

/** Default Discovery Mode window (4h). Mirrors convex/users.ts. */
export const DISCOVERY_MODE_DEFAULT_DURATION_MS = 4 * 60 * 60 * 1000;
/** Upper bound enforced both client-side and server-side. */
export const DISCOVERY_MODE_MAX_DURATION_MS = 8 * 60 * 60 * 1000;

type BgLocationUpdate = {
  locations?: Location.LocationObject[];
};

type BgLocationError = {
  message?: string;
};

const FOREGROUND_QUEUE_FLUSH_THROTTLE_MS = 60 * 1000;
let lastForegroundQueueFlushAt = 0;

type UploadSummary = {
  attempted: boolean;
  sampleCount: number;
  queuedCount: number;
  remainingCount: number;
  acceptedCount?: number;
  duplicateCount?: number;
  skippedCount?: number;
  crossingsWritten?: number;
  reason?: string;
  error?: string;
};

function safeErrorMessage(error: unknown): string {
  return String(error).slice(0, 180);
}

function summarizeSources(samples: NearbyBackgroundSample[]): string[] {
  return Array.from(new Set(samples.map((sample) => sample.source)));
}

function summarizeBatchResult(result: unknown) {
  if (!result || typeof result !== 'object') return {};
  const r = result as Record<string, unknown>;
  const acceptedCount =
    typeof r.acceptedCount === 'number'
      ? r.acceptedCount
      : typeof r.accepted === 'number'
        ? r.accepted
        : undefined;
  const duplicateCount = typeof r.duplicateCount === 'number' ? r.duplicateCount : undefined;
  const skippedCount = typeof r.skippedCount === 'number' ? r.skippedCount : undefined;
  const crossingsWritten = typeof r.crossingsWritten === 'number' ? r.crossingsWritten : undefined;
  const reason = typeof r.reason === 'string' ? r.reason : undefined;

  return {
    acceptedCount,
    duplicateCount,
    skippedCount,
    crossingsWritten,
    reason,
  };
}

async function uploadLocationSamplesWithQueue(
  authUserId: string,
  currentSamples: NearbyBackgroundSample[],
  trigger: 'task' | 'foreground',
): Promise<UploadSummary> {
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    if (__DEV__) console.log('[BG_LOCATION][dropped]', { reason: 'no_convex_url' });
    return {
      attempted: false,
      sampleCount: 0,
      queuedCount: 0,
      remainingCount: 0,
      reason: 'no_convex_url',
    };
  }

  const uploadBatch = await buildNearbyBackgroundUploadBatch(currentSamples);
  const sources = summarizeSources(uploadBatch.samples);
  if (uploadBatch.samples.length === 0) {
    return {
      attempted: false,
      sampleCount: 0,
      queuedCount: uploadBatch.queuedCount,
      remainingCount: uploadBatch.queuedCount,
      reason: 'empty_queue',
    };
  }

  try {
    if (__DEV__) {
      console.log('[BG_LOCATION][upload_attempt]', {
        trigger,
        sampleCount: uploadBatch.samples.length,
        queuedCount: uploadBatch.queuedCount,
        currentCount: uploadBatch.currentCount,
        sources,
      });
    }

    const client = new ConvexHttpClient(convexUrl);
    const result = await client.mutation(api.crossedPaths.recordLocationBatch, {
      userId: authUserId,
      samples: uploadBatch.samples,
    });
    await replaceNearbyBackgroundSampleQueue(uploadBatch.remainingSamples);
    const resultSummary = summarizeBatchResult(result);

    if (__DEV__) {
      console.log('[BG_LOCATION][upload_success]', {
        trigger,
        sampleCount: uploadBatch.samples.length,
        queuedCount: uploadBatch.queuedCount,
        remainingCount: uploadBatch.remainingSamples.length,
        sources,
        ...resultSummary,
      });
    }

    if (__DEV__) {
      console.log('[BG_LOCATION_QUEUE] flush_success', {
        trigger,
        uploaded: uploadBatch.samples.length,
        queuedCount: uploadBatch.queuedCount,
        currentCount: uploadBatch.currentCount,
        remainingCount: uploadBatch.remainingSamples.length,
        sources,
        ...resultSummary,
      });
    }

    return {
      attempted: true,
      sampleCount: uploadBatch.samples.length,
      queuedCount: uploadBatch.queuedCount,
      remainingCount: uploadBatch.remainingSamples.length,
      ...resultSummary,
    };
  } catch (e) {
    const err = safeErrorMessage(e);
    let queuedAfterFailure: number | undefined;
    if (currentSamples.length > 0) {
      const queueResult = await enqueueNearbyBackgroundSamples(currentSamples, {
        trigger,
        sources: summarizeSources(currentSamples),
      });
      queuedAfterFailure = queueResult.total;
      if (__DEV__) {
        console.log('[BG_LOCATION][queue_after_failure]', {
          trigger,
          sampleCount: currentSamples.length,
          queuedCount: queueResult.total,
          prunedCount: queueResult.pruned,
          sources: summarizeSources(currentSamples),
        });
      }
    }

    if (__DEV__) {
      console.log('[BG_LOCATION][upload_failed]', {
        trigger,
        sampleCount: uploadBatch.samples.length,
        queuedCount: uploadBatch.queuedCount,
        currentCount: uploadBatch.currentCount,
        sources,
        error: err,
      });
      console.log('[BG_LOCATION_QUEUE] flush_failed', {
        trigger,
        queuedCount: uploadBatch.queuedCount,
        currentCount: uploadBatch.currentCount,
        remainingCount: queuedAfterFailure ?? uploadBatch.queuedCount,
        sources,
        error: err,
      });
    }

    return {
      attempted: true,
      sampleCount: uploadBatch.samples.length,
      queuedCount: uploadBatch.queuedCount,
      remainingCount: queuedAfterFailure ?? uploadBatch.queuedCount,
      error: err,
    };
  }
}

export async function flushQueuedBackgroundLocationSamples(
  authUserId?: string | null,
): Promise<void> {
  if (!authUserId) return;
  const now = Date.now();
  if (now - lastForegroundQueueFlushAt < FOREGROUND_QUEUE_FLUSH_THROTTLE_MS) {
    return;
  }
  lastForegroundQueueFlushAt = now;
  if (__DEV__) {
    console.log('[BG_LOCATION_QUEUE] foreground_flush_start', { trigger: 'foreground' });
  }
  const summary = await uploadLocationSamplesWithQueue(authUserId, [], 'foreground');
  if (__DEV__) {
    console.log('[BG_LOCATION_QUEUE] foreground_flush_done', summary);
  }
}

// ---------------------------------------------------------------------------
// Task registration — MUST run at module scope so the OS can resolve the
// task name even when the app is launched from a terminated state.
// ---------------------------------------------------------------------------

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(
    BACKGROUND_LOCATION_TASK,
    async ({ data, error }: { data: BgLocationUpdate; error: BgLocationError | null }) => {
      if (error) {
        if (__DEV__) console.log('[BG_LOCATION][task_error]', { message: error.message });
        return;
      }
      const locations = data?.locations ?? [];
      if (locations.length === 0) return;
      if (__DEV__) {
        console.log('[BG_LOCATION][task_received]', {
          sampleCount: locations.length,
          platform: Platform.OS,
        });
      }

      try {
        // Android Phase-2: self-check Discovery Mode expiry before doing
        // anything. If the window has elapsed we stop the task locally so
        // the foreground-service notification can drop even if the user
        // never re-opens the app. The server also rejects expired batches
        // — this is a defense-in-depth check, not a correctness check.
        if (Platform.OS === 'android') {
          const expiresAtRaw = await SecureStore.getItemAsync(DISCOVERY_EXPIRES_KEY);
          const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0;
          if (!expiresAt || Date.now() > expiresAt) {
            if (__DEV__) {
              console.log('[ANDROID_DISCOVERY][expired]', {
                expiresAt,
                now: Date.now(),
              });
            }
            // Best-effort teardown; swallow errors so the task handler
            // never throws back into TaskManager.
            try {
              await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
            } catch {}
            try {
              await SecureStore.deleteItemAsync(DISCOVERY_EXPIRES_KEY);
            } catch {}
            try {
              await clearNearbyBackgroundSampleQueue();
            } catch {}
            return;
          }
        }

        const authUserId = await SecureStore.getItemAsync(USER_ID_KEY);
        if (!authUserId) {
          if (__DEV__) console.log('[BG_LOCATION][dropped]', { reason: 'no_auth_user' });
          return;
        }

        const now = Date.now();

        // Map expo-location updates to the mutation's sample schema.
        // Source: 'slc' on iOS (Significant Location Change is our configured
        // trigger there), 'bg' elsewhere. Clamp capturedAt to [now - 6h, now].
        const samples: NearbyBackgroundSample[] = locations
          .filter((loc) => loc && loc.coords)
          .map((loc) => {
            const ts = typeof loc.timestamp === 'number' ? loc.timestamp : now;
            const clamped = Math.max(now - 6 * 60 * 60 * 1000, Math.min(ts, now));
            return {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              capturedAt: clamped,
              accuracy: typeof loc.coords.accuracy === 'number' ? loc.coords.accuracy : undefined,
              source: Platform.OS === 'ios' ? ('slc' as const) : ('bg' as const),
            };
          });

        if (samples.length === 0) return;

        if (__DEV__) {
          console.log('[BG_LOCATION][sample_received]', {
            count: samples.length,
            platform: Platform.OS,
          });
          if (Platform.OS === 'android') {
            console.log('[ANDROID_DISCOVERY][sample_sent]', {
              count: samples.length,
            });
          }
        }

        await uploadLocationSamplesWithQueue(authUserId, samples, 'task');
      } catch (e) {
        if (__DEV__) {
          console.log('[BG_LOCATION][dropped]', {
            reason: 'task_exception',
            err: String(e),
          });
        }
      }
    },
  );
}

// ---------------------------------------------------------------------------
// enableBackgroundLocation — request Always permission + start SLC updates.
// Returns an object describing the outcome; callers should surface
// permission-denied state in the UI.
// ---------------------------------------------------------------------------

export async function enableBackgroundLocation(): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_ios' | 'foreground_denied' | 'background_denied' | 'start_failed'; err?: string }
> {
  // Phase-1 restriction: iOS only.
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'not_ios' };
  }

  // Step 1: ensure foreground permission (required before requesting
  // background on iOS — the OS enforces the two-step prompt pattern).
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    if (__DEV__) console.log('[BG_LOCATION][enabled]', { ok: false, stage: 'foreground', status: fg.status });
    return { ok: false, reason: 'foreground_denied' };
  }

  // Step 2: upgrade to Always. On iOS this is the "Change to Always Allow"
  // system prompt. If the user picks "Keep Only While Using", we fail.
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    if (__DEV__) console.log('[BG_LOCATION][enabled]', { ok: false, stage: 'background', status: bg.status });
    return { ok: false, reason: 'background_denied' };
  }

  // Step 3: start updates. Significant Location Change is the Phase-1 mode:
  // ~500m granularity, battery-cheap, wakes the app even when terminated.
  try {
    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!alreadyRunning) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        // iOS SLC is used instead of continuous updates for battery.
        // expo-location exposes this via activityType + pausesUpdatesAutomatically
        // plus the deferredUpdatesInterval/distance knobs below.
        activityType: Location.ActivityType.OtherNavigation,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: false,
        // ~500m cadence. iOS will coalesce to SLC semantics when the
        // accuracy + distance filter combination allows it.
        distanceInterval: 500,
        deferredUpdatesDistance: 500,
        deferredUpdatesInterval: 10 * 60 * 1000, // 10 min min gap
      });
    }
    if (__DEV__) console.log('[BG_LOCATION][enabled]', { ok: true });
    return { ok: true };
  } catch (e) {
    if (__DEV__) console.log('[BG_LOCATION][enabled]', { ok: false, stage: 'start', err: String(e) });
    return { ok: false, reason: 'start_failed', err: String(e) };
  }
}

// ---------------------------------------------------------------------------
// disableBackgroundLocation — stop SLC updates. Does NOT revoke iOS
// authorization (that's a manual user action in iOS Settings).
// ---------------------------------------------------------------------------

export async function disableBackgroundLocation(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (running) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    if (__DEV__) console.log('[BG_LOCATION][disabled]', { ok: true });
  } catch (e) {
    if (__DEV__) console.log('[BG_LOCATION][disabled]', { ok: false, err: String(e) });
  } finally {
    try {
      await clearNearbyBackgroundSampleQueue();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// isBackgroundLocationRunning — introspection helper (UI may use this to
// show the user the current state of the background task).
// ---------------------------------------------------------------------------

export async function isBackgroundLocationRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase-2: Android Discovery Mode helpers
// ---------------------------------------------------------------------------
// Deliberately split from enableBackgroundLocation() so the two platforms'
// product semantics stay visually distinct in the code:
//   * iOS always-on SLC vs.
//   * Android user-initiated, time-limited foreground-service window.
// They share the same registered TaskManager task because the transport
// (sample → recordLocationBatch) is identical.
// ---------------------------------------------------------------------------

export type EnableDiscoveryResult =
  | { ok: true; expiresAt: number; durationMs: number }
  | {
      ok: false;
      reason:
        | 'not_android'
        | 'foreground_denied'
        | 'background_denied'
        | 'start_failed';
      err?: string;
    };

/**
 * enableAndroidDiscoveryMode — request Android background location + start
 * foreground-service-backed updates for a time-limited window.
 *
 * Must be called in direct response to a user tap — the OS permission
 * prompts require a foreground user gesture on both Android 10+ (where
 * ACCESS_BACKGROUND_LOCATION is a separate dialog) and Android 13+
 * (POST_NOTIFICATIONS dialog).
 *
 * durationMs is clamped to DISCOVERY_MODE_MAX_DURATION_MS.
 */
export async function enableAndroidDiscoveryMode(
  durationMs: number = DISCOVERY_MODE_DEFAULT_DURATION_MS,
): Promise<EnableDiscoveryResult> {
  if (Platform.OS !== 'android') {
    return { ok: false, reason: 'not_android' };
  }

  // Clamp the requested duration. The server also clamps, but clamping
  // locally keeps the stored expiry (SecureStore) consistent with what
  // the task's self-expiry check will compare against.
  const effectiveDuration = Math.max(
    60 * 1000, // at least 1 minute — guards against 0/negative durations
    Math.min(durationMs, DISCOVERY_MODE_MAX_DURATION_MS),
  );
  const expiresAt = Date.now() + effectiveDuration;

  // Step 1: ensure foreground permission (required before background on
  // all Android versions; Android 10+ enforces this as a distinct prompt).
  const fg = await Location.requestForegroundPermissionsAsync();
  if (__DEV__) {
    console.log('[ANDROID_DISCOVERY][permission]', {
      stage: 'foreground',
      status: fg.status,
    });
  }
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'foreground_denied' };
  }

  // Step 2: request ACCESS_BACKGROUND_LOCATION. On Android 11+ this
  // redirects the user to system settings ("Allow all the time"). On
  // Android 10 it's a prompt.
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (__DEV__) {
    console.log('[ANDROID_DISCOVERY][permission]', {
      stage: 'background',
      status: bg.status,
    });
  }
  if (bg.status !== 'granted') {
    return { ok: false, reason: 'background_denied' };
  }

  // Step 3: persist the expiry FIRST so that even if the OS wakes the
  // task between startLocationUpdatesAsync returning and the next line
  // executing, the self-expiry check has something to read.
  try {
    await SecureStore.setItemAsync(DISCOVERY_EXPIRES_KEY, String(expiresAt));
  } catch (e) {
    if (__DEV__) {
      console.log('[ANDROID_DISCOVERY][enable]', {
        ok: false,
        stage: 'persist_expiry',
        err: String(e),
      });
    }
    return { ok: false, reason: 'start_failed', err: String(e) };
  }

  // Step 4: start location updates. On Android the `foregroundService`
  // options block makes expo-location run the task under a typed
  // foreground service with the required persistent notification —
  // mandatory on Android 8+ and required for the FOREGROUND_SERVICE_LOCATION
  // permission grant on Android 14+.
  try {
    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (!alreadyRunning) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        activityType: Location.ActivityType.OtherNavigation,
        // Android: don't let the OS auto-pause Discovery Mode; the user
        // already constrained the duration via the expiry window.
        pausesUpdatesAutomatically: false,
        // Battery-conscious knobs: coarse grid + ≥2min between updates
        // is enough for crossed-path detection (10min server window).
        distanceInterval: 300,
        timeInterval: 2 * 60 * 1000,
        deferredUpdatesDistance: 300,
        deferredUpdatesInterval: 2 * 60 * 1000,
        // REQUIRED: persistent foreground-service notification. User must
        // be able to see that Discovery Mode is active.
        foregroundService: {
          notificationTitle: 'Mira Discovery Mode',
          notificationBody:
            'Detecting people you cross paths with. Tap to manage.',
          notificationColor: '#FF6B6B',
          // killServiceOnDestroy true → when the user swipes away the app
          // AND Discovery Mode isn't active, the service terminates.
          killServiceOnDestroy: true,
        },
      });
    }

    if (__DEV__) {
      console.log('[ANDROID_DISCOVERY][task_started]', {
        expiresAt,
        durationMs: effectiveDuration,
      });
      console.log('[ANDROID_DISCOVERY][enable]', { ok: true });
    }

    return { ok: true, expiresAt, durationMs: effectiveDuration };
  } catch (e) {
    // Rollback the persisted expiry so the next wake will self-stop.
    try {
      await SecureStore.deleteItemAsync(DISCOVERY_EXPIRES_KEY);
    } catch {}
    if (__DEV__) {
      console.log('[ANDROID_DISCOVERY][enable]', {
        ok: false,
        stage: 'start',
        err: String(e),
      });
    }
    return { ok: false, reason: 'start_failed', err: String(e) };
  }
}

/**
 * disableAndroidDiscoveryMode — stop updates and clear the persisted
 * expiry. Idempotent; safe to call even if Discovery Mode is not active.
 * Does NOT revoke OS permissions (that's a manual user action).
 */
export async function disableAndroidDiscoveryMode(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (running) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    if (__DEV__) {
      console.log('[ANDROID_DISCOVERY][task_stopped]', { ok: true });
      console.log('[ANDROID_DISCOVERY][disable]', { ok: true });
    }
  } catch (e) {
    if (__DEV__) {
      console.log('[ANDROID_DISCOVERY][disable]', {
        ok: false,
        err: String(e),
      });
    }
  } finally {
    // Always clear the expiry so the task's self-check fails fast if it
    // somehow wakes again (e.g. system resurrection, race with stop call).
    try {
      await SecureStore.deleteItemAsync(DISCOVERY_EXPIRES_KEY);
    } catch {}
    try {
      await clearNearbyBackgroundSampleQueue();
    } catch {}
  }
}

/**
 * readAndroidDiscoveryExpiry — introspection helper. Returns the locally
 * persisted expiry timestamp or null if Discovery Mode has never been
 * enabled / has been cleared. Useful for UI countdowns between app opens.
 */
export async function readAndroidDiscoveryExpiry(): Promise<number | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const v = await SecureStore.getItemAsync(DISCOVERY_EXPIRES_KEY);
    if (!v) return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
