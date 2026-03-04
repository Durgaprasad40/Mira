// STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
// All data is ephemeral (in-memory only) and rehydrates from Convex on app boot.

import { create } from 'zustand';

interface IncognitoState {
  isActive: boolean;
  setActive: (active: boolean) => void;
  toggle: () => void;

  // 18+ consent gate for Private/Face 2
  // Stores both the confirmation flag and a timestamp for audit
  ageConfirmed18Plus: boolean;
  ageConfirmedAt: number | null;
  acceptPrivateTerms: () => void;
  resetPrivateTerms: () => void;

  // H-001/C-001 FIX: Hydration tracking to prevent reading stale defaults
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useIncognitoStore = create<IncognitoState>()((set) => ({
  isActive: false,
  setActive: (active) => set({ isActive: active }),
  toggle: () => set((state) => ({ isActive: !state.isActive })),

  ageConfirmed18Plus: false,
  ageConfirmedAt: null,
  acceptPrivateTerms: () =>
    set({ ageConfirmed18Plus: true, ageConfirmedAt: Date.now() }),
  resetPrivateTerms: () =>
    set({ ageConfirmed18Plus: false, ageConfirmedAt: null }),

  _hasHydrated: true, // Always ready - no AsyncStorage
  setHasHydrated: (hydrated) => set({ _hasHydrated: true }), // No-op
}));
