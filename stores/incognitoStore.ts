import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export const useIncognitoStore = create<IncognitoState>()(
  persist(
    (set) => ({
      isActive: false,
      setActive: (active) => set({ isActive: active }),
      toggle: () => set((state) => ({ isActive: !state.isActive })),

      ageConfirmed18Plus: false,
      ageConfirmedAt: null,
      acceptPrivateTerms: () =>
        set({ ageConfirmed18Plus: true, ageConfirmedAt: Date.now() }),
      resetPrivateTerms: () =>
        set({ ageConfirmed18Plus: false, ageConfirmedAt: null }),

      // H-001/C-001 FIX: Hydration state
      _hasHydrated: false,
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: 'incognito-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        ageConfirmed18Plus: state.ageConfirmed18Plus,
        ageConfirmedAt: state.ageConfirmedAt,
        // NOTE: _hasHydrated is NOT persisted - it's runtime-only
      }),
      // H-001/C-001 FIX: Set hydrated flag after rehydration (success or error)
      onRehydrateStorage: () => (state, error) => {
        // Always mark hydrated, even on error, to avoid permanent soft-lock
        state?.setHasHydrated(true);
        if (__DEV__ && error) {
          console.warn('[incognitoStore] Rehydration error:', error);
        }
      },
    },
  ),
);
