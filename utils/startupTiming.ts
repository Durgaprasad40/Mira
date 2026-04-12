/**
 * Startup Timing - Measurement-only utility for tracking app startup performance.
 *
 * STRICT: No refactors, no behavior changes, measurement only.
 *
 * Milestones tracked:
 * A) RootLayout first render
 * B) authStore hydration complete
 * C) demoStore hydration complete
 * D) route decision made
 * E) first tab screen mounted
 * F) location start + first fix
 * G) map markers ready
 */

import { DEBUG_STARTUP } from '@/lib/debugFlags';

type Milestone =
  | 'bundle_start'
  | 'root_layout'
  | 'auth_hydrated'
  | 'demo_hydrated'
  | 'boot_caches_ready'  // Fast boot caches loaded (bypasses full hydration)
  | 'boot_hidden'
  | 'route_decision'
  | 'first_tab'
  | 'location_start'
  | 'location_fix'
  | 'map_ready';

type DurationMetric = 'boot_caches';

interface TimingState {
  times: Partial<Record<Milestone, number>>;
  durations: Partial<Record<DurationMetric, number>>;
  printed: boolean;
}

const state: TimingState = {
  times: {
    bundle_start: Date.now(), // Captured when this module loads
  },
  durations: {},
  printed: false,
};

/**
 * Mark a milestone with current timestamp.
 * Duplicate marks are ignored (first wins).
 */
export function markTiming(milestone: Milestone): void {
  if (state.times[milestone] !== undefined) return;
  state.times[milestone] = Date.now();

  // Individual milestone logs disabled to reduce DEV noise
  // Summary is printed when boot completes (see tryPrintSummary)

  // Auto-print summary when key milestones are hit
  tryPrintSummary();
}

/**
 * Record a duration metric (actual elapsed time for an operation).
 * Unlike milestones (absolute timestamps), durations measure operation time.
 */
export function markDuration(metric: DurationMetric, durationMs: number): void {
  if (state.durations[metric] !== undefined) return;
  state.durations[metric] = durationMs;
  // Individual duration logs disabled - included in summary
}

/**
 * Print summary if we have enough data.
 * Triggers on first_tab OR map_ready.
 */
function tryPrintSummary(): void {
  if (state.printed) return;
  if (!__DEV__ || !DEBUG_STARTUP) return;

  const t = state.times;
  const start = t.bundle_start!;

  // Wait for either first_tab or map_ready
  const hasFirstScreen = t.first_tab !== undefined;
  const hasMap = t.map_ready !== undefined;

  if (!hasFirstScreen && !hasMap) return;

  // Calculate durations
  const total = (t.first_tab ?? t.map_ready ?? Date.now()) - start;
  const bootHidden = t.boot_hidden ? t.boot_hidden - start : 0;
  const bootCachesDuration = state.durations.boot_caches ?? 0;
  const authTime = t.auth_hydrated ? t.auth_hydrated - start : 0;
  const demoTime = t.demo_hydrated ? t.demo_hydrated - start : 0;
  const hydration = Math.max(authTime, demoTime);
  const routeStart = Math.max(t.auth_hydrated ?? start, t.demo_hydrated ?? start);
  const route = t.route_decision ? t.route_decision - routeStart : 0;
  const location = t.location_fix ? t.location_fix - (t.location_start ?? start) : 0;
  const firstScreen = t.first_tab ? t.first_tab - (t.route_decision ?? start) : 0;

  state.printed = true;

  console.log(
    `[STARTUP_TIMING] boot=${bootHidden}ms cache=${bootCachesDuration}ms total=${total}ms`
  );
}

/**
 * Force print summary (for debugging).
 */
export function printTimingSummary(): void {
  state.printed = false;
  tryPrintSummary();
}

/**
 * Reset timing state (for testing).
 */
export function resetTiming(): void {
  state.times = { bundle_start: Date.now() };
  state.printed = false;
}
