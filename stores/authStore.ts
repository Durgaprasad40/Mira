import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  onboardingCompleted: boolean;
  _hasHydrated: boolean;

  // Actions
  setAuth: (
    userId: string,
    token: string,
    onboardingCompleted: boolean,
  ) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
}

// C8 fix: hydration timeout constant
const HYDRATION_TIMEOUT_MS = 5000;

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      userId: null,
      token: null,
      isLoading: false,
      error: null,
      onboardingCompleted: false,
      _hasHydrated: false,

      setAuth: (userId, token, onboardingCompleted) =>
        set({
          isAuthenticated: true,
          userId,
          token,
          error: null,
          onboardingCompleted,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      setOnboardingCompleted: (completed) =>
        set({ onboardingCompleted: completed }),

      logout: () =>
        set({
          isAuthenticated: false,
          userId: null,
          token: null,
          error: null,
          onboardingCompleted: false,
        }),

      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state, error) => {
        // C9 fix: log rehydration errors
        if (error) {
          console.error('[authStore] Rehydration error:', error);
        }
        state?.setHasHydrated(true);
      },
    },
  ),
);

// C8 fix: hydration timeout fallback — if AsyncStorage blocks, force hydration after timeout
setTimeout(() => {
  if (!useAuthStore.getState()._hasHydrated) {
    console.warn('[authStore] Hydration timeout — forcing hydrated state');
    useAuthStore.getState().setHasHydrated(true);
  }
}, HYDRATION_TIMEOUT_MS);
