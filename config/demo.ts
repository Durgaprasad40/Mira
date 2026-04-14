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

// =============================================================================
// DEMO AUTH MODE - Centralized flag for testing with simulated auth
// =============================================================================
//
// When enabled (EXPO_PUBLIC_DEMO_AUTH_MODE=true in .env.local):
// - Password is not verified (dev convenience)
// - Identity is per normalized email: register creates once; login only finds existing
// - Email verification bypassed (demo user is pre-verified)
// - Face verification bypassed (demo user is pre-verified)
// - Onboarding progress saved against stable demo user
// - Force-quit/reopen restores same demo user
//
// SAFE: Only works in __DEV__ builds. Production ignores this flag.
// CLEAN: All demo auth logic centralized in lib/demoAuth.ts + convex/demoAuth.ts
// REMOVABLE: Delete demoAuth.ts files + revert this file to disable
// =============================================================================

/**
 * Demo Auth Mode - enables testing without real auth providers.
 *
 * Controlled by EXPO_PUBLIC_DEMO_AUTH_MODE env variable.
 * Only active in __DEV__ builds for safety.
 */
export const isDemoAuthMode = __DEV__
  ? process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true'
  : false;

/**
 * Legacy stable id (pre per-email demo auth). Kept for any old tooling; routing uses email.
 */
export const DEMO_USER_STABLE_ID = 'demo_user_stable_001';

/**
 * Stable demo session token - recognized by backend as valid demo session.
 * Prefix 'demo_' allows backend to identify and handle demo sessions specially.
 */
export const DEMO_TOKEN_STABLE = 'demo_token_stable_001';

/**
 * Log demo auth mode status on startup (dev only)
 */
if (__DEV__ && isDemoAuthMode) {
  console.log(
    '[DEMO_AUTH] Demo Auth Mode ENABLED — passwords not checked; login requires existing email; register creates per email'
  );
}
