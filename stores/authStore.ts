import { create } from "zustand";
import { markTiming } from "@/utils/startupTiming";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { isDemoMode } from "@/hooks/useConvex";

// STORAGE POLICY ENFORCEMENT:
// This store contains user authentication state (userId, token, onboarding flags).
// Per strict requirement: NO local persistence of user information.
// All auth state is ephemeral (in-memory only) and must be rehydrated from Convex on app boot.
// Convex is the ONLY source of truth.

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  onboardingCompleted: boolean;
  // Checkpoint: face verification passed (strict gate in onboarding)
  faceVerificationPassed: boolean;
  // Checkpoint: face verification pending manual review (allows onboarding resume)
  faceVerificationPending: boolean;
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
  setFaceVerificationPassed: (passed: boolean) => void;
  setFaceVerificationPending: (pending: boolean) => void;
  logout: () => Promise<void>;
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

// NO PERSISTENCE: This is an in-memory store only.
// Auth state is rehydrated from Convex queries on app boot.
export const useAuthStore = create<AuthState>()((set) => ({
  isAuthenticated: false,
  userId: null,
  token: null,
  isLoading: false,
  error: null,
  onboardingCompleted: false,
  faceVerificationPassed: false,
  faceVerificationPending: false,
  // Always true since there's no async hydration from AsyncStorage
  _hasHydrated: true,
  _sessionValidated: false,
  _sessionValidationError: null,

  setAuth: (userId, token, onboardingCompleted) => {
    // STABILITY FIX: Reset onboardingStore when switching to a different user
    // This prevents data leakage between accounts (e.g., name/DOB from previous user)
    const currentUserId = useAuthStore.getState().userId;
    if (currentUserId && currentUserId !== userId) {
      if (__DEV__) console.log('[AUTH] setAuth: userId changed, resetting onboardingStore');
      useOnboardingStore.getState().reset();

      // SECURITY FIX A4: Reset private profile store on user switch
      // Prevents Phase-2 private data leakage between accounts
      const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
      usePrivateProfileStore.getState().resetPhase2();
      if (__DEV__) console.log('[AUTH] setAuth: userId changed, resetting privateProfileStore');
    }

    return set({
      isAuthenticated: true,
      userId,
      token,
      error: null,
      onboardingCompleted,
      // Reset validation state on new auth
      _sessionValidated: false,
      _sessionValidationError: null,
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  setOnboardingCompleted: (completed) =>
    set({ onboardingCompleted: completed }),

  setFaceVerificationPassed: (passed) =>
    set({ faceVerificationPassed: passed }),

  setFaceVerificationPending: (pending) =>
    set({ faceVerificationPending: pending }),

  // Logout clears LOCAL state ONLY — server data is untouched
  // This follows the "Logout ≠ Delete" principle
  // C2 FIX: Made async - waits for SecureStore cleanup before resolving
  logout: async () => {
    // Reset onboarding store to prevent photo/data leakage between users
    useOnboardingStore.getState().reset();

    // SECURITY FIX A5: Reset private profile store on logout
    // Prevents Phase-2 private data leakage after logout
    const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
    usePrivateProfileStore.getState().resetPhase2();
    if (__DEV__) console.log('[AUTH] logout: cleared privateProfileStore');

    // BUG B FIX: Clear demo session to prevent stale currentDemoUserId
    // causing welcome.tsx to redirect to onboarding instead of showing welcome
    if (isDemoMode) {
      // Use dynamic require to avoid circular dependency
      const { useDemoStore } = require('@/stores/demoStore');
      useDemoStore.getState().demoLogout();
      if (__DEV__) console.log('[AUTH] logout: called demoLogout()');
    }
    if (__DEV__) console.log('[AUTH] logout: cleared onboardingStore');

    // Reset verification store to prevent badge leakage between accounts
    const { useVerificationStore } = require('@/stores/verificationStore');
    useVerificationStore.getState().resetVerification();

    // PRIVACY FIX: Reset confession store to prevent confession/reply data leakage
    // This ensures User A's confessions don't appear for User B after logout
    const { useConfessionStore } = require('@/stores/confessionStore');
    if (useConfessionStore.getState().reset) {
      useConfessionStore.getState().reset();
    } else {
      // Fallback: manually reset key confession state
      useConfessionStore.setState({
        seeded: false,
        confessions: [],
        myReplies: [],
        confessionThreads: {},
      });
    }
    if (__DEV__) console.log('[AUTH] logout: cleared confessionStore');

    // C2 FIX: Clear in-memory state FIRST (immediate effect for UI)
    set({
      isAuthenticated: false,
      userId: null,
      token: null,
      error: null,
      onboardingCompleted: false,
      faceVerificationPassed: false,
      faceVerificationPending: false,
      _sessionValidated: false,
      _sessionValidationError: null,
    });

    // C2 FIX: Await SecureStore cleanup - logout does NOT resolve until this completes
    // If cleanup fails, rethrow so callers know logout didn't fully complete
    const { clearAuthBootCache } = require('@/stores/authBootCache');
    try {
      await clearAuthBootCache();
    } catch (error) {
      console.error('[AUTH] logout: SecureStore cleanup failed:', error);
      throw error;
    }
  },

  // No-op for compatibility - always hydrated since no AsyncStorage
  setHasHydrated: (state) => set({ _hasHydrated: true }),

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
}));

// Milestone B: authStore ready (no async hydration needed)
markTiming('auth_hydrated');
