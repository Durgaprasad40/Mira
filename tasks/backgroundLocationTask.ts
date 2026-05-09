/**
 * Phase-3 Background Crossed Paths — TaskManager task definition.
 *
 * STRICT contract:
 *   - This file ONLY defines the task at module scope. Defining a task is
 *     not the same as starting it — `expo-location.startLocationUpdatesAsync`
 *     is the start primitive and is gated behind the Phase-3 hook
 *     (`hooks/useBackgroundLocation.ts`), the client-side feature gate
 *     (`BG_CROSSED_PATHS_FEATURE_READY`), the explainer accept flow, and
 *     the OS background-permission prompt.
 *   - Module-load side effect = `TaskManager.defineTask` only. It must be
 *     imported once (from `app/_layout.tsx`) at app boot. It does not start
 *     anything.
 *   - The handler ONLY pushes received samples into the on-device buffer
 *     (stores/backgroundLocationBufferStore.ts). It does NOT contact the
 *     backend directly — Convex client may not be mounted in the headless
 *     JS context that runs background tasks. The foreground hook drains
 *     the buffer when the app is active.
 *   - Handler fails closed: any thrown error is swallowed, samples for that
 *     invocation are dropped. We never re-raise from background context.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { backgroundLocationBuffer } from '@/stores/backgroundLocationBufferStore';
import { recordBgCrossedPathsBreadcrumb } from '@/lib/backgroundCrossedPathsTelemetry';

/** Stable task name — referenced by `useBackgroundLocation` to start/stop
 *  via `Location.startLocationUpdatesAsync` and `stopLocationUpdatesAsync`. */
export const BACKGROUND_LOCATION_TASK_NAME = 'mira-background-crossed-paths-v1';

/**
 * Module-scope task registration. Safe to call repeatedly; TaskManager
 * dedupes by task name. The task itself is INACTIVE until something calls
 * `Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK_NAME, …)`.
 */
// `defineTask` expects a handler typed as `() => Promise<any>`. The body is
// still synchronous in practice (we only push into a Zustand store) — the
// `async` keyword exists purely to satisfy `TaskManagerTaskExecutor`.
TaskManager.defineTask(BACKGROUND_LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    // Swallow — never throw from background context. Foreground UI will
    // surface degraded state via getStatus() if the task ends up unhealthy.
    recordBgCrossedPathsBreadcrumb('background_location_task_error', {
      reason: 'task_error',
    });
    if (__DEV__) {
      console.warn('[BG_LOCATION_TASK] error:', error?.message);
    }
    return;
  }

  if (!data) return;

  // expo-location TaskManager payload is `{ locations: Location.LocationObject[] }`.
  const payload = data as { locations?: Location.LocationObject[] };
  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  if (locations.length === 0) return;

  // We can't reliably tell here whether we're being woken by Significant
  // Location Change (iOS) or by a Discovery Mode foreground-service update
  // (Android). The TaskManager payload doesn't carry that distinction. We
  // pick a platform-stable source label — backend's per-source whitelist
  // accepts both `'bg'` and `'slc'`. Using `'bg'` for both is safe; the
  // server still applies the privacy gates either way and the source
  // label is only used for rate-limit attribution and audit logs.
  //
  // (If finer-grained attribution is ever needed, the start-task call site
  // in the hook can split between the two flows on Platform.OS.)
  const samples = locations
    .map((loc) => {
      const lat = typeof loc?.coords?.latitude === 'number' ? loc.coords.latitude : null;
      const lng = typeof loc?.coords?.longitude === 'number' ? loc.coords.longitude : null;
      const ts =
        typeof loc?.timestamp === 'number' && Number.isFinite(loc.timestamp)
          ? loc.timestamp
          : Date.now();
      const accuracy =
        typeof loc?.coords?.accuracy === 'number' && loc.coords.accuracy >= 0
          ? loc.coords.accuracy
          : undefined;
      if (lat == null || lng == null) return null;
      return {
        lat,
        lng,
        capturedAt: ts,
        accuracy,
        source: 'bg' as const,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

  if (samples.length === 0) return;

  try {
    backgroundLocationBuffer.enqueueMany(samples);
    recordBgCrossedPathsBreadcrumb('samples_buffered', {
      count: samples.length,
      sources: Array.from(new Set(samples.map((sample) => sample.source))),
      pendingCount: backgroundLocationBuffer.size(),
    });
  } catch (err) {
    // Persist failure here is non-recoverable from background context.
    // Drop silently; foreground retry-loop will re-prime if the user is
    // still moving.
    recordBgCrossedPathsBreadcrumb('buffer_enqueue_failed', {
      reason: 'persist_failed',
      count: samples.length,
    });
    if (__DEV__) {
      console.warn('[BG_LOCATION_TASK] enqueue failed:', (err as Error)?.message);
    }
  }
});
