/**
 * privacyStore — In-memory store for user privacy settings.
 *
 * STORAGE POLICY ENFORCEMENT:
 * NO local persistence. Privacy settings are user information.
 * All privacy settings must be rehydrated from Convex on app boot.
 * Convex is the ONLY source of truth.
 */
import { create } from 'zustand';

interface PrivacyState {
  // Privacy settings (all default to false = normal app behavior)
  hideFromDiscover: boolean;
  hideAge: boolean;
  hideDistance: boolean;
  disableReadReceipts: boolean;

  // Hydration (always true - no AsyncStorage)
  _hasHydrated: boolean;

  // Actions
  setHasHydrated: (state: boolean) => void;
  setHideFromDiscover: (value: boolean) => void;
  setHideAge: (value: boolean) => void;
  setHideDistance: (value: boolean) => void;
  setDisableReadReceipts: (value: boolean) => void;

  // Reset (for logout)
  resetPrivacy: () => void;
}

export const usePrivacyStore = create<PrivacyState>()((set) => ({
  hideFromDiscover: false,
  hideAge: false,
  hideDistance: false,
  disableReadReceipts: false,
  _hasHydrated: true,

  setHasHydrated: (state) => set({ _hasHydrated: true }),

  setHideFromDiscover: (value) => set({ hideFromDiscover: value }),
  setHideAge: (value) => set({ hideAge: value }),
  setHideDistance: (value) => set({ hideDistance: value }),
  setDisableReadReceipts: (value) => set({ disableReadReceipts: value }),

  // Reset
  resetPrivacy: () =>
    set({
      hideFromDiscover: false,
      hideAge: false,
      hideDistance: false,
      disableReadReceipts: false,
    }),
}));
