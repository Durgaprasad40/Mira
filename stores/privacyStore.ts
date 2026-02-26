/**
 * privacyStore — Persisted store for user privacy settings.
 *
 * Stores privacy toggles that persist across app restarts:
 * - hideFromDiscover: Hide profile from Discover feed
 * - hideAge: Hide age on profile
 * - hideDistance: Hide distance from other users
 * - disableReadReceipts: Don't send read receipts to others
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PrivacyState {
  // Privacy settings (all default to false = normal app behavior)
  hideFromDiscover: boolean;
  hideAge: boolean;
  hideDistance: boolean;
  disableReadReceipts: boolean;

  // Hydration
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

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set) => ({
      hideFromDiscover: false,
      hideAge: false,
      hideDistance: false,
      disableReadReceipts: false,
      _hasHydrated: false,

      setHasHydrated: (state) => set({ _hasHydrated: state }),

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
    }),
    {
      name: 'mira-privacy-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        if (__DEV__) {
          console.log('[privacyStore] Hydrated', {
            hideFromDiscover: state?.hideFromDiscover,
            hideAge: state?.hideAge,
            hideDistance: state?.hideDistance,
            disableReadReceipts: state?.disableReadReceipts,
          });
        }
      },
      partialize: (state) => ({
        hideFromDiscover: state.hideFromDiscover,
        hideAge: state.hideAge,
        hideDistance: state.hideDistance,
        disableReadReceipts: state.disableReadReceipts,
      }),
    }
  )
);
