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
  // H5 FIX: Track logout timestamp to detect logout during async operations
  // Used to prevent race condition where in-flight auth mutation re-saves token after logout
  _logoutTimestamp: number;

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
  // H5 FIX: Track logout timestamp (0 = never logged out)
  _logoutTimestamp: 0,

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
  // C8 FIX: All resets wrapped in try-catch to prevent cascade failure
  // H2 FIX: Atomic logout - SecureStore cleared FIRST to prevent split-brain state
  logout: async () => {
    // ═══════════════════════════════════════════════════════════════════════
    // ATOMIC LOGOUT - SecureStore cleared FIRST, then in-memory state
    // H2 FIX: Prevents split-brain where memory is cleared but persistent
    // auth remains (causing ghost login on app restart)
    // ═══════════════════════════════════════════════════════════════════════

    // STEP 1: Clear SecureStore FIRST (persistent auth layer)
    // If this fails, abort immediately - do NOT clear in-memory state
    // This ensures no half-logged-out state where restart would re-login
    try {
      const { clearAuthBootCache } = require('@/stores/authBootCache');
      await clearAuthBootCache();
      if (__DEV__) console.log('[AUTH] logout: cleared SecureStore (step 1)');
    } catch (error) {
      console.error('[AUTH] logout: SecureStore cleanup failed, aborting logout:', error);
      // H2 FIX: Do NOT proceed - keeps user logged in rather than half-logged-out
      throw error;
    }

    // STEP 2: Clear in-memory auth state (now safe since SecureStore is cleared)
    // This makes isAuthenticated=false, triggering UI updates
    // H5 FIX: Set _logoutTimestamp to detect logout during async operations
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
      _logoutTimestamp: Date.now(),
    });
    if (__DEV__) console.log('[AUTH] logout: cleared in-memory auth state (step 2)');

    // STEP 3: Clear dependent stores (with try-catch for each)
    // These are safe to fail individually - the session is already invalidated
    // C8 FIX: Each reset wrapped to prevent cascade failure

    // 3a. Reset onboarding store
    try {
      useOnboardingStore.getState()?.reset?.();
      if (__DEV__) console.log('[AUTH] logout: cleared onboardingStore');
    } catch (error) {
      console.warn('[AUTH] logout: failed to reset onboardingStore', error);
    }

    // 3b. Reset private profile store (Phase-2 private data)
    try {
      const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
      usePrivateProfileStore.getState()?.resetPhase2?.();
      if (__DEV__) console.log('[AUTH] logout: cleared privateProfileStore');
    } catch (error) {
      console.warn('[AUTH] logout: failed to reset privateProfileStore', error);
    }

    // 3c. Reset private chat store (Phase-2 conversations, messages, unlocked users)
    try {
      const { usePrivateChatStore } = require('@/stores/privateChatStore');
      usePrivateChatStore.setState({
        conversations: [],
        messages: {},
        unlockedUsers: [],
        pendingDares: [],
        sentDares: [],
      });
      if (__DEV__) console.log('[AUTH] logout: cleared privateChatStore');
    } catch (error) {
      console.warn('[AUTH] logout: failed to reset privateChatStore', error);
    }

    // 3d. Clear demo session (only in demo mode)
    if (isDemoMode) {
      try {
        const { useDemoStore } = require('@/stores/demoStore');
        useDemoStore.getState()?.demoLogout?.();
        if (__DEV__) console.log('[AUTH] logout: called demoLogout()');
      } catch (error) {
        console.warn('[AUTH] logout: failed to call demoLogout', error);
      }
    }

    // 3e. Reset verification store
    try {
      const { useVerificationStore } = require('@/stores/verificationStore');
      useVerificationStore.getState()?.resetVerification?.();
      if (__DEV__) console.log('[AUTH] logout: cleared verificationStore');
    } catch (error) {
      console.warn('[AUTH] logout: failed to reset verificationStore', error);
    }

    // 3f. Reset confession store
    try {
      const { useConfessionStore } = require('@/stores/confessionStore');
      const confessionState = useConfessionStore.getState();
      if (confessionState?.reset) {
        confessionState.reset();
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
    } catch (error) {
      console.warn('[AUTH] logout: failed to reset confessionStore', error);
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
