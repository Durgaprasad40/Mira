import { create } from 'zustand';

/**
 * BootStore - Tracks app boot readiness conditions
 *
 * SAFETY:
 * - This is a READ-ONLY tracking store
 * - Does NOT modify any user data, auth state, or messages
 * - Does NOT affect onboarding completion status
 * - Used only for UI gating (BootScreen hide/show)
 */
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

  // Reset for retry
  reset: () => void;
}

export const useBootStore = create<BootState>((set, get) => ({
  authHydrated: false,
  demoHydrated: false,
  routeDecisionMade: false,

  setAuthHydrated: (v) => set({ authHydrated: v }),
  setDemoHydrated: (v) => set({ demoHydrated: v }),
  setRouteDecisionMade: (v) => set({ routeDecisionMade: v }),

  isBootReady: () => {
    const state = get();
    // In demo mode, need both hydrations. In live mode, just auth.
    // Route decision is always required.
    return state.authHydrated && state.demoHydrated && state.routeDecisionMade;
  },

  reset: () =>
    set({
      authHydrated: false,
      demoHydrated: false,
      routeDecisionMade: false,
    }),
}));
