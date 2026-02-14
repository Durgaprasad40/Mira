import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { markTiming } from "@/utils/startupTiming";

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  onboardingCompleted: boolean;
  _hasHydrated: boolean;
  // Hydration status for initial session validation
  _sessionValidated: boolean;
  _sessionValidationError: string | null;

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
  // Sync local state from server validation (READ-ONLY - updates local state only)
  syncFromServerValidation: (userInfo: {
    onboardingCompleted: boolean;
    isVerified?: boolean;
    name?: string;
  }) => void;
  // Mark session as validated (or failed)
  setSessionValidated: (validated: boolean, error?: string | null) => void;
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
      _sessionValidated: false,
      _sessionValidationError: null,

      setAuth: (userId, token, onboardingCompleted) =>
        set({
          isAuthenticated: true,
          userId,
          token,
          error: null,
          onboardingCompleted,
          // Reset validation state on new auth
          _sessionValidated: false,
          _sessionValidationError: null,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      setOnboardingCompleted: (completed) =>
        set({ onboardingCompleted: completed }),

      // Logout clears LOCAL state ONLY — server data is untouched
      // This follows the "Logout ≠ Delete" principle
      logout: () =>
        set({
          isAuthenticated: false,
          userId: null,
          token: null,
          error: null,
          onboardingCompleted: false,
          _sessionValidated: false,
          _sessionValidationError: null,
        }),

      setHasHydrated: (state) => set({ _hasHydrated: state }),

      // Sync local state from server validation result
      // SAFETY: This only UPDATES local state from server truth
      // It NEVER modifies server data (read-only sync)
      syncFromServerValidation: (userInfo) =>
        set((state) => ({
          // Only update onboardingCompleted if server says it's true
          // NEVER reset to false — prevents onboarding reset
          onboardingCompleted: userInfo.onboardingCompleted || state.onboardingCompleted,
        })),

      // Mark session validation complete (success or failure)
      setSessionValidated: (validated, error = null) =>
        set({
          _sessionValidated: true,
          _sessionValidationError: validated ? null : error,
        }),
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
        // Milestone B: authStore hydration complete
        markTiming('auth_hydrated');
      },
    },
  ),
);

// BUGFIX #14: Store timeout ID to prevent multiple timers on hot reload
let _authHydrationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function setupAuthHydrationTimeout() {
  // Clear any existing timeout (hot reload safety)
  if (_authHydrationTimeoutId !== null) {
    clearTimeout(_authHydrationTimeoutId);
  }
  _authHydrationTimeoutId = setTimeout(() => {
    if (!useAuthStore.getState()._hasHydrated) {
      console.warn('[authStore] Hydration timeout — forcing hydrated state');
      useAuthStore.getState().setHasHydrated(true);
    }
    _authHydrationTimeoutId = null;
  }, HYDRATION_TIMEOUT_MS);
}

// C8 fix: hydration timeout fallback — if AsyncStorage blocks, force hydration after timeout
setupAuthHydrationTimeout();
