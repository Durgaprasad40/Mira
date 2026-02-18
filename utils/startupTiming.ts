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
  | 'map_ready'
  | 'startup_tasks_begin'  // StartupCoordinator begins deferred tasks
  | 'startup_tasks_end';   // StartupCoordinator finishes all tasks

type DurationMetric = 'boot_caches' | 'startup_tasks';

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

  if (__DEV__) {
    const elapsed = state.times[milestone]! - state.times.bundle_start!;
    console.log(`[TIMING] ${milestone} @ +${elapsed}ms`);
  }

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

  if (__DEV__) {
    console.log(`[DURATION] ${metric}: ${durationMs}ms`);
  }
}

/**
 * Print summary if we have enough data.
 * Triggers on first_tab OR map_ready.
 */
function tryPrintSummary(): void {
  if (state.printed) return;
  if (!__DEV__) return;

  const t = state.times;
  const start = t.bundle_start!;

  // Wait for either first_tab or map_ready
  const hasFirstScreen = t.first_tab !== undefined;
  const hasMap = t.map_ready !== undefined;

  if (!hasFirstScreen && !hasMap) return;

  // Calculate durations
  const total = (t.first_tab ?? t.map_ready ?? Date.now()) - start;

  // Hydration: max of auth and demo (whichever is later)
  const authTime = t.auth_hydrated ? t.auth_hydrated - start : 0;
  const demoTime = t.demo_hydrated ? t.demo_hydrated - start : 0;
  const hydration = Math.max(authTime, demoTime);

  // Route decision time (from hydration complete to route decision)
  const routeStart = Math.max(t.auth_hydrated ?? start, t.demo_hydrated ?? start);
  const route = t.route_decision ? t.route_decision - routeStart : 0;

  // Location time (from start to first fix)
  const location = t.location_fix ? t.location_fix - (t.location_start ?? start) : 0;

  // First screen time (from route decision to first tab)
  const firstScreen = t.first_tab ? t.first_tab - (t.route_decision ?? start) : 0;

  state.printed = true;

  // Boot hidden time (from start)
  const bootHidden = t.boot_hidden ? t.boot_hidden - start : 0;

  // Boot caches duration (actual cache read time, not absolute timestamp)
  const bootCachesDuration = state.durations.boot_caches ?? 0;

  console.log(
    `[STARTUP_TIMING] bootHidden=${bootHidden}ms bootCachesDuration=${bootCachesDuration}ms total=${total}ms hydration=${hydration}ms route=${route}ms location=${location}ms firstScreen=${firstScreen}ms`
  );

  // Detailed breakdown
  console.log('[STARTUP_TIMING] Breakdown:', {
    bundle_to_root: t.root_layout ? t.root_layout - start : '-',
    root_to_bootCaches: t.boot_caches_ready && t.root_layout ? t.boot_caches_ready - t.root_layout : '-',
    root_to_auth: t.auth_hydrated && t.root_layout ? t.auth_hydrated - t.root_layout : '-',
    root_to_demo: t.demo_hydrated && t.root_layout ? t.demo_hydrated - t.root_layout : '-',
    bootCaches_to_route: t.route_decision && t.boot_caches_ready ? t.route_decision - t.boot_caches_ready : '-',
    hydration_to_route: t.route_decision && routeStart ? t.route_decision - routeStart : '-',
    route_to_tab: t.first_tab && t.route_decision ? t.first_tab - t.route_decision : '-',
    location_to_fix: t.location_fix && t.location_start ? t.location_fix - t.location_start : '-',
  });
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
  state.durations = {};
  state.printed = false;
}

/**
 * Generate consolidated STARTUP_PERF_REPORT for instrumentation.
 * Call this after startup tasks complete for a full picture.
 */
export function generateStartupPerfReport(): Record<string, number | string> {
  const t = state.times;
  const d = state.durations;
  const start = t.bundle_start ?? Date.now();

  return {
    // Key metrics
    bundle_to_first_tab: t.first_tab ? t.first_tab - start : '-',
    bundle_to_boot_hidden: t.boot_hidden ? t.boot_hidden - start : '-',
    bundle_to_route_decision: t.route_decision ? t.route_decision - start : '-',

    // Location metrics (should be deferred to Map focus)
    location_start_delay: t.location_start ? t.location_start - start : '-',
    location_fix_time: t.location_fix && t.location_start
      ? t.location_fix - t.location_start
      : '-',

    // Map metrics
    map_ready_delay: t.map_ready ? t.map_ready - start : '-',

    // Startup coordinator metrics
    startup_tasks_begin: t.startup_tasks_begin
      ? t.startup_tasks_begin - start
      : '-',
    startup_tasks_duration: t.startup_tasks_end && t.startup_tasks_begin
      ? t.startup_tasks_end - t.startup_tasks_begin
      : '-',

    // Duration metrics
    boot_caches_ms: d.boot_caches ?? '-',
  };
}

/**
 * Print the consolidated startup performance report.
 * Safe to call multiple times - only prints once.
 */
let _reportPrinted = false;
export function printStartupPerfReport(): void {
  if (_reportPrinted || !__DEV__) return;
  _reportPrinted = true;

  const report = generateStartupPerfReport();
  console.log('='.repeat(50));
  console.log('STARTUP_PERF_REPORT');
  console.log('='.repeat(50));
  for (const [key, value] of Object.entries(report)) {
    const displayValue = typeof value === 'number' ? `${value}ms` : value;
    console.log(`  ${key}: ${displayValue}`);
  }
  console.log('='.repeat(50));
}
