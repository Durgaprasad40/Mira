import { create } from "zustand";
import { markTiming } from "@/utils/startupTiming";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { isDemoMode } from "@/hooks/useConvex";
import { DEBUG_AUTH_BOOT } from "@/lib/debugFlags";

// =============================================================================
// AUTH STORE - Single Source of Truth for Authentication State
// =============================================================================
//
// ARCHITECTURE:
// - All auth state changes go through explicit actions only
// - No scattered direct setState calls for auth restoration
// - logoutInProgress flag prevents any auth restoration during logout
// - authVersion is monotonic counter that invalidates stale async operations
//
// ACTIONS:
// - setAuthenticatedSession() - set auth after successful login/validation
// - beginLogout() - start logout, block all auth restoration
// - finishLogout() - complete logout, clear all state
// - logout() - orchestrates the full logout flow
//
// GUARDS:
// - setAuthenticatedSession checks logoutInProgress - if true, rejects
// - Async operations capture authVersion, check before applying
// =============================================================================

interface AuthState {
  // Core auth state
  userId: string | null;
  token: string | null;
  onboardingCompleted: boolean;

  // AUTH_READY_FIX: Flag indicating auth state is fully validated and ready
  // Set to true ONLY after setAuthenticatedSession is called with validated onboarding status
  // Components should wait for this before running queries that depend on auth state
  authReady: boolean;

  // Auth lifecycle flags
  authVersion: number;        // Monotonic counter, incremented on logout start
  logoutInProgress: boolean;  // True between beginLogout and finishLogout

  // Face verification checkpoints
  faceVerificationPassed: boolean;
  faceVerificationPending: boolean;

  // Session validation state
  _sessionValidated: boolean;
  _sessionValidationError: string | null;

  // Compatibility flags
  _hasHydrated: boolean;
  isLoading: boolean;
  error: string | null;

  // ==========================================================================
  // COMPUTED (derived from state)
  // ==========================================================================

  // True ONLY when we have valid auth AND logout is not in progress
  // This is the ONLY way to check if user is authenticated
  getIsAuthenticated: () => boolean;

  // ==========================================================================
  // EXPLICIT AUTH ACTIONS (the only way to modify auth state)
  // ==========================================================================

  // Set authenticated session - ONLY call after successful auth
  // REJECTS if:
  //   - logoutInProgress is true
  //   - expectedAuthVersion does not match current authVersion
  // This ensures stale async operations cannot restore auth after logout
  setAuthenticatedSession: (
    userId: string,
    token: string,
    onboardingCompleted: boolean,
    expectedAuthVersion: number,
  ) => boolean; // Returns false if rejected

  // Begin logout - sets logoutInProgress, increments authVersion
  // After this, all setAuthenticatedSession calls will be rejected
  // P0-003 FIX: Returns false if logout already in progress (mutex)
  beginLogout: () => boolean;

  // Finish logout - clears all state, sets logoutInProgress=false
  finishLogout: () => void;

  // Full logout orchestration (async)
  // 1. beginLogout()
  // 2. Clear SecureStore
  // 3. Clear dependent stores
  // 4. finishLogout()
  logout: () => Promise<void>;

  // ==========================================================================
  // OTHER ACTIONS
  // ==========================================================================

  setOnboardingCompleted: (completed: boolean) => void;
  setFaceVerificationPassed: (passed: boolean) => void;
  setFaceVerificationPending: (pending: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setHasHydrated: (state: boolean) => void;
  syncFromServerValidation: (userInfo: {
    onboardingCompleted: boolean;
    isVerified?: boolean;
    name?: string;
  }) => void;
  setSessionValidated: (validated: boolean, error?: string | null) => void;

  // ==========================================================================
  // LEGACY COMPATIBILITY
  // ==========================================================================

  // Legacy isAuthenticated for components that read it directly
  // DEPRECATED: Use getIsAuthenticated() instead
  isAuthenticated: boolean;

  // Legacy setAuth - wraps setAuthenticatedSession for compatibility
  // DEPRECATED: Use setAuthenticatedSession() instead
  // Now requires expectedAuthVersion parameter for safety
  setAuth: (userId: string, token: string, onboardingCompleted: boolean, expectedAuthVersion: number) => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  // ==========================================================================
  // INITIAL STATE
  // ==========================================================================

  userId: null,
  token: null,
  onboardingCompleted: false,
  // AUTH_READY_FIX: Start as false, set true only after validation completes
  authReady: false,
  authVersion: 0,
  logoutInProgress: false,
  faceVerificationPassed: false,
  faceVerificationPending: false,
  _sessionValidated: false,
  _sessionValidationError: null,
  _hasHydrated: true,
  isLoading: false,
  error: null,

  // Legacy compatibility
  isAuthenticated: false,

  // ==========================================================================
  // COMPUTED
  // ==========================================================================

  getIsAuthenticated: () => {
    const state = get();
    return (
      state.token !== null &&
      state.userId !== null &&
      !state.logoutInProgress
    );
  },

  // ==========================================================================
  // EXPLICIT AUTH ACTIONS
  // ==========================================================================

  setAuthenticatedSession: (userId, token, onboardingCompleted, expectedAuthVersion) => {
    const state = get();

    // GUARD 1: Reject if logout is in progress
    if (state.logoutInProgress) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[AUTH] setAuth REJECTED - logout');
      return false;
    }

    // GUARD 2: Reject if authVersion changed (logout happened after async started)
    // This is the KEY guard that prevents ghost login after finishLogout()
    if (state.authVersion !== expectedAuthVersion) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log(`[AUTH] setAuth REJECTED - v${expectedAuthVersion}!=${state.authVersion}`);
      return false;
    }

    // GUARD 3: Reset dependent stores if switching users
    if (state.userId && state.userId !== userId) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[AUTH] userId changed, reset');
      useOnboardingStore.getState().reset();
      try {
        const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
        usePrivateProfileStore.getState().resetPhase2();
      } catch {}
    }

    if (__DEV__ && DEBUG_AUTH_BOOT) {
      console.log(`[AUTH] setAuth: ${userId.substring(0, 8)}, onb=${onboardingCompleted}, v${expectedAuthVersion}`);
    }

    // AUTH_READY_FIX: Set authReady=true now that validation is complete
    // This signals to components that auth state is fully hydrated and reliable
    set({
      userId,
      token,
      onboardingCompleted,
      authReady: true, // AUTH_READY_FIX: Mark auth as ready
      isAuthenticated: true,
      error: null,
      _sessionValidated: false,
      _sessionValidationError: null,
    });

    if (__DEV__ && DEBUG_AUTH_BOOT) console.log(`[AUTH_READY] onb=${onboardingCompleted}`);

    return true;
  },

  beginLogout: () => {
    // P0-003 FIX: Prevent double logout - if already in progress, return false
    // This acts as a mutex to prevent concurrent logout execution
    if (get().logoutInProgress) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[AUTH] beginLogout: skip (in progress)');
      return false;
    }

    const currentVersion = get().authVersion;
    const newVersion = currentVersion + 1;

    if (__DEV__ && DEBUG_AUTH_BOOT) console.log(`[AUTH] beginLogout: v${currentVersion}->${newVersion}`);

    set({
      logoutInProgress: true,
      authVersion: newVersion,
    });

    return true;
  },

  finishLogout: () => {
    if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[AUTH] finishLogout');

    set({
      userId: null,
      token: null,
      onboardingCompleted: false,
      authReady: false, // AUTH_READY_FIX: Reset on logout
      faceVerificationPassed: false,
      faceVerificationPending: false,
      _sessionValidated: false,
      _sessionValidationError: null,
      error: null,
      logoutInProgress: false,
      isAuthenticated: false,
    });
  },

  logout: async () => {
    // =======================================================================
    // ATOMIC LOGOUT FLOW
    // =======================================================================
    //
    // 1. beginLogout() - sets logoutInProgress=true, increments authVersion
    //    After this point, ALL setAuthenticatedSession calls are rejected
    //
    // 2. Clear SecureStore (persistent layer)
    //    Best effort only - logout must still finish if local cleanup is partial
    //
    // 3. Clear dependent stores (with try-catch each)
    //
    // 4. finishLogout() - clears in-memory state
    // =======================================================================

    // STEP 1: Begin logout - blocks all auth restoration
    // P0-003 FIX: Check if logout already in progress (mutex)
    const didAcquireLock = get().beginLogout();
    if (!didAcquireLock) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[AUTH] logout: skip (in progress)');
      return; // Another logout is already running
    }

    // STEP 2: Clear SecureStore FIRST (best effort)
    try {
      const { clearAuthBootCache } = require('@/stores/authBootCache');
      const result = await clearAuthBootCache();
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[AUTH] logout: SecureStore', result);
      if (!result.success && __DEV__) {
        console.warn('[AUTH] logout: SecureStore cleanup incomplete; local session was still cleared:', result.failedKeys);
      }
    } catch (error) {
      if (__DEV__) console.error('[AUTH] logout: unexpected SecureStore cleanup error:', error);
    }

    // STEP 3: Clear dependent stores (each wrapped in try-catch)
    // These are safe to fail - session is already invalidated
    // LOG_NOISE_FIX: Verbose cleanup logs removed (not needed for normal operation)

    try {
      useOnboardingStore.getState()?.reset?.();
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: onboardingStore reset failed');
    }

    try {
      const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
      usePrivateProfileStore.getState()?.resetPhase2?.();
    } catch {}

    try {
      const { usePrivateChatStore } = require('@/stores/privateChatStore');
      usePrivateChatStore.setState({
        conversations: [],
        messages: {},
        unlockedUsers: [],
        pendingDares: [],
        sentDares: [],
      });
    } catch {}

    if (isDemoMode) {
      try {
        const { useDemoStore } = require('@/stores/demoStore');
        useDemoStore.getState()?.demoLogout?.();
      } catch {}
    }

    try {
      const { useDemoDmStore } = require('@/stores/demoDmStore');
      useDemoDmStore.getState()?.reset?.();
    } catch {}

    try {
      const { useVerificationStore } = require('@/stores/verificationStore');
      useVerificationStore.getState()?.resetVerification?.();
    } catch {}

    try {
      const { usePrivacyStore } = require('@/stores/privacyStore');
      usePrivacyStore.getState()?.resetPrivacy?.();
    } catch {}

    try {
      const { useConfessionStore } = require('@/stores/confessionStore');
      const confessionState = useConfessionStore.getState();
      if (confessionState?.reset) {
        confessionState.reset();
      } else {
        useConfessionStore.setState({
          seeded: false,
          confessions: [],
          userReactions: {},
          replies: {},
          chats: [],
          secretCrushes: [],
          confessionThreads: {},
          reportedIds: [],
          blockedIds: [],
          seenTaggedConfessionIds: [],
          connectedConfessionIds: [],
          confessionTimestamps: [],
          revealSkippedChats: {},
        });
      }
    } catch {}

    try {
      const { clearTodCache } = require('@/app/(main)/(private)/(tabs)/truth-or-dare');
      clearTodCache?.();
    } catch {}

    try {
      const { useChatTodStore } = require('@/stores/chatTodStore');
      useChatTodStore.setState({ games: {} });
    } catch {}

    try {
      const { setPhase2Active } = require('@/hooks/useNotifications');
      setPhase2Active(false);
    } catch {}

    try {
      const { useDiscoverStore } = require('@/stores/discoverStore');
      useDiscoverStore.setState({
        likesUsedToday: 0,
        standOutsUsedToday: 0,
        lastResetDate: new Date().toISOString().slice(0, 10),
        hasUserShownIntent: false,
        swipeCount: 0,
        profileViewCount: 0,
        lastRandomMatchAt: null,
        randomMatchShownThisSession: false,
      });
    } catch {}

    try {
      const { useBlockStore } = require('@/stores/blockStore');
      useBlockStore.getState().clearBlocks();
    } catch {}

    try {
      const { useFilterStore } = require('@/stores/filterStore');
      useFilterStore.getState().clearFilters();
    } catch {}

    try {
      const { useSubscriptionStore } = require('@/stores/subscriptionStore');
      useSubscriptionStore.setState({
        tier: 'free',
        expiresAt: null,
        trialEndsAt: null,
        isInTrial: false,
        isPremium: false,
        likesRemaining: 50,
        superLikesRemaining: 1,
        messagesRemaining: 5,
        rewindsRemaining: 0,
        boostsRemaining: 0,
        likesResetAt: 0,
        superLikesResetAt: 0,
        messagesResetAt: 0,
      });
    } catch {}

    try {
      const { useLocationStore } = require('@/stores/locationStore');
      useLocationStore.getState().stopLocationTracking();
    } catch {}

    // STEP 4: Finish logout - clear in-memory state
    get().finishLogout();
  },

  // ==========================================================================
  // OTHER ACTIONS
  // ==========================================================================

  setOnboardingCompleted: (completed) => {
    // LOOP FIX: Equality guard
    if (get().onboardingCompleted === completed) return;
    set({ onboardingCompleted: completed });
  },

  setFaceVerificationPassed: (passed) => {
    // LOOP FIX: Equality guard
    if (get().faceVerificationPassed === passed) return;
    set({ faceVerificationPassed: passed });
  },

  setFaceVerificationPending: (pending) => {
    // LOOP FIX: Equality guard
    if (get().faceVerificationPending === pending) return;
    set({ faceVerificationPending: pending });
  },

  setLoading: (isLoading) => {
    // LOOP FIX: Equality guard
    if (get().isLoading === isLoading) return;
    set({ isLoading });
  },

  setError: (error) => {
    // LOOP FIX: Equality guard (compare error string)
    if (get().error === error) return;
    set({ error, isLoading: false });
  },

  setHasHydrated: () => {
    // LOOP FIX: Equality guard
    if (get()._hasHydrated === true) return;
    set({ _hasHydrated: true });
  },

  syncFromServerValidation: (userInfo) => {
    // LOOP FIX: Only update if value actually changes
    const current = get().onboardingCompleted;
    const newValue = userInfo.onboardingCompleted || current;
    if (current === newValue) return;
    set({ onboardingCompleted: newValue });
  },

  setSessionValidated: (validated, error = null) => {
    // LOOP FIX: Equality guard - check both fields
    const state = get();
    const newError = validated ? null : error;
    if (state._sessionValidated === true && state._sessionValidationError === newError) return;
    set({
      _sessionValidated: true,
      _sessionValidationError: newError,
    });
  },

  // ==========================================================================
  // LEGACY COMPATIBILITY
  // ==========================================================================

  setAuth: (userId, token, onboardingCompleted, expectedAuthVersion) => {
    // Wrapper for legacy code - calls setAuthenticatedSession
    get().setAuthenticatedSession(userId, token, onboardingCompleted, expectedAuthVersion);
  },
}));

// Milestone B: authStore ready
markTiming('auth_hydrated');
