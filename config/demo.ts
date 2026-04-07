/**
 * Central demo-mode flag (pure — no side effects).
 *
 * P0-004 FIX: Demo mode is ONLY available in __DEV__ builds.
 * In production builds, this is hardcoded to false and cannot be changed.
 *
 * Demo mode bypasses:
 * - Daily like limits (returns 999 instead of 25)
 * - Daily stand out limits (returns 99 instead of 2)
 * - Backend queries (uses mock data)
 * - Feature access checks (returns unlimited)
 *
 * CRITICAL: All code using isDemoMode MUST also check __DEV__:
 *   if (__DEV__ && isDemoMode) { ... }
 *
 * This ensures the demo bypass is completely stripped from production builds.
 */
// P0-004 FIX: Production builds always have isDemoMode = false
// The __DEV__ check at call sites ensures this code path is never reached in production
export const isDemoMode = __DEV__ ? false : false;

/**
 * When true, demo mode skips onboarding and routes directly to Phase-1 home.
 * Use this for testing specific features without going through full onboarding flow.
 * Only has effect when isDemoMode = true.
 */
export const skipDemoOnboarding = false;
