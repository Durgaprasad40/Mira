/**
 * backgroundLocationTask — Phase-1 Background Crossed Paths (iOS only).
 *
 * This module is imported for its side-effect of registering a TaskManager
 * task so that iOS Significant Location Change updates can wake the app
 * (even when terminated) and forward samples to Convex.
 *
 * STRICT SCOPE (Phase-1):
 *   - iOS only. Android stays foreground-only in this phase.
 *   - Opt-in only. The task is started by enableBackgroundLocation() and
 *     stopped by disableBackgroundLocation(). Module import alone does NOT
 *     start the updates — it only registers the task definition.
 *   - Every sample is validated server-side against the user's
 *     backgroundLocationEnabled flag before being persisted.
 *
 * DEBUG TAG: [BG_LOCATION]
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';

/** Registered task name — referenced by startLocationUpdatesAsync. */
export const BACKGROUND_LOCATION_TASK = 'mira/bg-location-task';

/** SecureStore key used by the auth-boot cache (mira_auth_user_id). The
 *  background task reads authUserId from here so it can authenticate the
 *  Convex mutation without access to any React state. */
const USER_ID_KEY = 'mira_auth_user_id';

type BgLocationUpdate = {
  locations?: Location.LocationObject[];
};

type BgLocationError = {
  message?: string;
};

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

      try {
        const authUserId = await SecureStore.getItemAsync(USER_ID_KEY);
        if (!authUserId) {
          if (__DEV__) console.log('[BG_LOCATION][dropped]', { reason: 'no_auth_user' });
          return;
        }

        const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
        if (!convexUrl) {
          if (__DEV__) console.log('[BG_LOCATION][dropped]', { reason: 'no_convex_url' });
          return;
        }

        const client = new ConvexHttpClient(convexUrl);
        const now = Date.now();

        // Map expo-location updates to the mutation's sample schema.
        // Source: 'slc' on iOS (Significant Location Change is our configured
        // trigger there), 'bg' elsewhere. Clamp capturedAt to [now - 6h, now].
        const samples = locations
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
        }

        await client.mutation(api.crossedPaths.recordLocationBatch, {
          userId: authUserId,
          samples,
        });
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
