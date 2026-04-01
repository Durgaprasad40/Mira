import { create } from 'zustand';

/**
 * BootStore - Tracks app boot readiness conditions
 *
 * SAFETY:
 * - This is a READ-ONLY tracking store
 * - Does NOT modify any user data, auth state, or messages
 * - Does NOT affect onboarding completion status
 * - Used only for UI gating (BootScreen hide/show)
 *
 * STABILITY FIX: Boot safety timeout
 * - Ensures boot ALWAYS resolves within 30 seconds
 * - TIMEOUT-FIX: Increased from 5s to accommodate validation retries
 * - Prevents infinite loading if hydration fails silently
 */

// Module-level safety timeout
// TIMEOUT-FIX: Increased from 5s to 30s to accommodate validation retries
// Validation has 3 attempts × 8s each = 24s max, plus buffer
const BOOT_SAFETY_TIMEOUT_MS = 30000;
let _bootSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let _bootResolved = false; // Guard: boot can only resolve once

interface BootState {
  // Readiness flags
  authHydrated: boolean;
  demoHydrated: boolean;
  routeDecisionMade: boolean;

  // Actions (WRITE-ONLY to this store, never modifies other stores)
  setAuthHydrated: (v: boolean) => void;
  setDemoHydrated: (v: boolean) => void;
  setRouteDecisionMade: (v: boolean) => void;

  // Computed: all conditions met
  isBootReady: () => boolean;

  // Force boot to complete (safety fallback)
  forceBootReady: () => void;

  // Reset for retry
  reset: () => void;
}

// Helper: Clear safety timer when boot completes normally
function clearBootSafetyTimer() {
  if (_bootSafetyTimer) {
    clearTimeout(_bootSafetyTimer);
    _bootSafetyTimer = null;
  }
}

// Helper: Start safety timer (called on store creation)
function startBootSafetyTimer(forceReady: () => void) {
  // Guard: only start once
  if (_bootSafetyTimer || _bootResolved) return;

  _bootSafetyTimer = setTimeout(() => {
    // Guard: don't force if already resolved
    if (_bootResolved) return;

    if (__DEV__) {
      console.warn('[BOOT_SAFETY] Timeout reached (30s) - forcing boot to resolve');
    }
    forceReady();
  }, BOOT_SAFETY_TIMEOUT_MS);
}

export const useBootStore = create<BootState>((set, get) => {
  // Create forceBootReady function first so we can reference it
  const forceBootReady = () => {
    // Guard: boot can only resolve once
    if (_bootResolved) return;
    _bootResolved = true;

    clearBootSafetyTimer();

    if (__DEV__) {
      console.log('[BOOT_SAFETY] Forcing boot ready (all flags set to true)');
    }

    set({
      authHydrated: true,
      demoHydrated: true,
      routeDecisionMade: true,
    });
  };

  // Start safety timer on store creation
  startBootSafetyTimer(forceBootReady);

  return {
    authHydrated: false,
    demoHydrated: false,
    routeDecisionMade: false,

    setAuthHydrated: (v) => {
      // LOOP FIX: Equality guard - don't update if value is same
      if (get().authHydrated === v) return;
      set({ authHydrated: v });
      // Check if boot is now ready, clear timer
      const state = get();
      if (state.authHydrated && state.demoHydrated && state.routeDecisionMade) {
        _bootResolved = true;
        clearBootSafetyTimer();
      }
    },

    setDemoHydrated: (v) => {
      // LOOP FIX: Equality guard - don't update if value is same
      if (get().demoHydrated === v) return;
      set({ demoHydrated: v });
      // Check if boot is now ready, clear timer
      const state = get();
      if (state.authHydrated && state.demoHydrated && state.routeDecisionMade) {
        _bootResolved = true;
        clearBootSafetyTimer();
      }
    },

    setRouteDecisionMade: (v) => {
      // LOOP FIX: Equality guard - don't update if value is same
      if (get().routeDecisionMade === v) return;
      set({ routeDecisionMade: v });
      // Check if boot is now ready, clear timer
      const state = get();
      if (state.authHydrated && state.demoHydrated && state.routeDecisionMade) {
        _bootResolved = true;
        clearBootSafetyTimer();
      }
    },

    isBootReady: () => {
      const state = get();
      // In demo mode, need both hydrations. In live mode, just auth.
      // Route decision is always required.
      return state.authHydrated && state.demoHydrated && state.routeDecisionMade;
    },

    forceBootReady,

    reset: () => {
      // Reset resolved flag to allow boot to happen again
      _bootResolved = false;
      clearBootSafetyTimer();

      set({
        authHydrated: false,
        demoHydrated: false,
        routeDecisionMade: false,
      });

      // Restart safety timer for retry
      startBootSafetyTimer(get().forceBootReady);
    },
  };
});
