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
  | 'boot_hidden'
  | 'route_decision'
  | 'first_tab'
  | 'location_start'
  | 'location_fix'
  | 'map_ready';

interface TimingState {
  times: Partial<Record<Milestone, number>>;
  printed: boolean;
}

const state: TimingState = {
  times: {
    bundle_start: Date.now(), // Captured when this module loads
  },
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

  console.log(
    `[STARTUP_TIMING] bootHidden=${bootHidden}ms total=${total}ms hydration=${hydration}ms route=${route}ms location=${location}ms firstScreen=${firstScreen}ms`
  );

  // Detailed breakdown
  console.log('[STARTUP_TIMING] Breakdown:', {
    bundle_to_root: t.root_layout ? t.root_layout - start : '-',
    root_to_auth: t.auth_hydrated && t.root_layout ? t.auth_hydrated - t.root_layout : '-',
    root_to_demo: t.demo_hydrated && t.root_layout ? t.demo_hydrated - t.root_layout : '-',
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
  state.printed = false;
}
