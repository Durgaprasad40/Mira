/**
 * Phase-3 Background Crossed Paths — Offline sample buffer.
 *
 * Why a separate store?
 *   - The TaskManager handler (tasks/backgroundLocationTask.ts) runs in a
 *     headless JS context where the Convex client is not guaranteed to be
 *     mounted. The handler therefore enqueues samples to AsyncStorage via
 *     this store, and the foreground hook (hooks/useBackgroundLocation.ts)
 *     drains them once the app is active and the backend is reachable.
 *   - Failed network writes (offline, transient backend errors, rate-limit
 *     rejections) are kept on disk so we don't drop samples; they're retried
 *     on the next foreground flush.
 *
 * Privacy invariants:
 *   - The buffer NEVER persists samples beyond the user disabling background
 *     crossed paths. `clear()` is called by the disable flow and on revoke.
 *   - Buffer is hard-capped (MAX_PENDING_SAMPLES) so even a runaway task
 *     can't fill the disk.
 *   - Samples are stored in plain object form, no PII beyond the lat/lng/
 *     timestamp/source/accuracy that backend already validates.
 *   - This store does NOT itself touch the network; it's a pure on-device
 *     queue. All upload happens via the foreground hook + Convex client.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Sample type intentionally mirrors the `recordLocationBatch` validator
 *  in `convex/crossedPaths.ts`. Source is one of:
 *   - 'bg'  Android Discovery Mode background sample
 *   - 'slc' iOS Significant Location Change
 *   - 'fg'  foreground mirror (NOT used by the Phase-3 background task) */
export type BufferedSample = {
  lat: number;
  lng: number;
  capturedAt: number;
  accuracy?: number;
  source: 'bg' | 'slc' | 'fg';
};

/** Hard cap. Backend daily rate limit is 200 samples/user/device, so
 *  buffering more than 200 in one device-day would always be rejected
 *  on flush anyway. We pick 200 to align with that ceiling. */
const MAX_PENDING_SAMPLES = 200;

interface BackgroundLocationBufferState {
  pending: BufferedSample[];
  enqueue: (sample: BufferedSample) => void;
  enqueueMany: (samples: BufferedSample[]) => void;
  /** Atomically remove the first N samples (called after a successful
   *  flush). N is whatever the backend reports as accepted+dropped, i.e.
   *  the slice we no longer need to retry. */
  drainFirst: (n: number) => void;
  /** Wholesale wipe — invoked on disable / revoke / consent-version
   *  mismatch. Idempotent. */
  clear: () => void;
  getPending: () => BufferedSample[];
}

export const useBackgroundLocationBufferStore = create<BackgroundLocationBufferState>()(
  persist(
    (set, get) => ({
      pending: [],
      enqueue: (sample) => {
        set((state) => {
          const next = [...state.pending, sample];
          // Drop oldest when over cap; we'd rather lose ancient samples
          // than the freshest crossing.
          if (next.length > MAX_PENDING_SAMPLES) {
            next.splice(0, next.length - MAX_PENDING_SAMPLES);
          }
          return { pending: next };
        });
      },
      enqueueMany: (samples) => {
        if (samples.length === 0) return;
        set((state) => {
          const next = [...state.pending, ...samples];
          if (next.length > MAX_PENDING_SAMPLES) {
            next.splice(0, next.length - MAX_PENDING_SAMPLES);
          }
          return { pending: next };
        });
      },
      drainFirst: (n) => {
        if (n <= 0) return;
        set((state) => ({ pending: state.pending.slice(n) }));
      },
      clear: () => set({ pending: [] }),
      getPending: () => get().pending,
    }),
    {
      name: 'mira_bg_location_buffer_v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the pending queue; nothing else in the state needs
      // to survive a cold start.
      partialize: (state) => ({ pending: state.pending }),
    },
  ),
);

/**
 * Static helpers that DO NOT require a React render context. The TaskManager
 * handler runs in a headless JS context where hooks are not available; it
 * uses these to enqueue samples directly into the persisted store.
 */
export const backgroundLocationBuffer = {
  enqueue(sample: BufferedSample): void {
    useBackgroundLocationBufferStore.getState().enqueue(sample);
  },
  enqueueMany(samples: BufferedSample[]): void {
    useBackgroundLocationBufferStore.getState().enqueueMany(samples);
  },
  getPending(): BufferedSample[] {
    return useBackgroundLocationBufferStore.getState().getPending();
  },
  drainFirst(n: number): void {
    useBackgroundLocationBufferStore.getState().drainFirst(n);
  },
  clear(): void {
    useBackgroundLocationBufferStore.getState().clear();
  },
  size(): number {
    return useBackgroundLocationBufferStore.getState().pending.length;
  },
  /** Exposed only for diagnostics / tests. Production code should use the
   *  store's actions instead. */
  MAX_PENDING_SAMPLES,
};
