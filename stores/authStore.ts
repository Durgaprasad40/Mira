import { create } from "zustand";
import { markTiming } from "@/utils/startupTiming";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { isDemoMode } from "@/hooks/useConvex";

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
      if (__DEV__) {
        console.log('[AUTH] setAuthenticatedSession REJECTED - logout in progress');
      }
      return false;
    }

    // GUARD 2: Reject if authVersion changed (logout happened after async started)
    // This is the KEY guard that prevents ghost login after finishLogout()
    if (state.authVersion !== expectedAuthVersion) {
      if (__DEV__) {
        console.log(`[AUTH] setAuthenticatedSession REJECTED - authVersion mismatch (expected=${expectedAuthVersion}, current=${state.authVersion})`);
      }
      return false;
    }

    // GUARD 3: Reset dependent stores if switching users
    if (state.userId && state.userId !== userId) {
      if (__DEV__) console.log('[AUTH] setAuthenticatedSession: userId changed, resetting stores');
      useOnboardingStore.getState().reset();
      try {
        const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
        usePrivateProfileStore.getState().resetPhase2();
      } catch {}
    }

    if (__DEV__) {
      console.log(`[AUTH] setAuthenticatedSession: userId=${userId.substring(0, 10)}..., onboardingCompleted=${onboardingCompleted}, authVersion=${expectedAuthVersion}`);
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

    if (__DEV__) {
      console.log('[AUTH_READY] authReady=true, onboardingCompleted=', onboardingCompleted);
    }

    return true;
  },

  beginLogout: () => {
    // P0-003 FIX: Prevent double logout - if already in progress, return false
    // This acts as a mutex to prevent concurrent logout execution
    if (get().logoutInProgress) {
      if (__DEV__) {
        console.log('[AUTH] beginLogout: already in progress, skipping');
      }
      return false;
    }

    const currentVersion = get().authVersion;
    const newVersion = currentVersion + 1;

    if (__DEV__) {
      console.log(`[AUTH] beginLogout: authVersion ${currentVersion} -> ${newVersion}, logoutInProgress=true`);
    }

    set({
      logoutInProgress: true,
      authVersion: newVersion,
    });

    return true;
  },

  finishLogout: () => {
    if (__DEV__) {
      console.log('[AUTH] finishLogout: clearing all state');
    }

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
    //    If this fails, throw - don't leave partial state
    //
    // 3. Clear dependent stores (with try-catch each)
    //
    // 4. finishLogout() - clears in-memory state
    // =======================================================================

    // STEP 1: Begin logout - blocks all auth restoration
    // P0-003 FIX: Check if logout already in progress (mutex)
    const didAcquireLock = get().beginLogout();
    if (!didAcquireLock) {
      if (__DEV__) {
        console.log('[AUTH] logout: skipped (already in progress)');
      }
      return; // Another logout is already running
    }

    // STEP 2: Clear SecureStore FIRST
    try {
      const { clearAuthBootCache } = require('@/stores/authBootCache');
      await clearAuthBootCache();
      if (__DEV__) console.log('[AUTH] logout: cleared SecureStore');
    } catch (error) {
      if (__DEV__) console.error('[AUTH] logout: SecureStore cleanup failed:', error);
      // CRITICAL: SecureStore failed - we must still clear in-memory to prevent
      // the user staying logged in. On next boot, they may get ghost login,
      // but that's better than being stuck logged in now.
      get().finishLogout();
      throw error;
    }

    // STEP 3: Clear dependent stores (each wrapped in try-catch)
    // These are safe to fail - session is already invalidated

    try {
      useOnboardingStore.getState()?.reset?.();
      if (__DEV__) console.log('[AUTH] logout: cleared onboardingStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset onboardingStore', error);
    }

    try {
      const { usePrivateProfileStore } = require('@/stores/privateProfileStore');
      usePrivateProfileStore.getState()?.resetPhase2?.();
      if (__DEV__) console.log('[AUTH] logout: cleared privateProfileStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset privateProfileStore', error);
    }

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
      if (__DEV__) console.warn('[AUTH] logout: failed to reset privateChatStore', error);
    }

    if (isDemoMode) {
      try {
        const { useDemoStore } = require('@/stores/demoStore');
        useDemoStore.getState()?.demoLogout?.();
        if (__DEV__) console.log('[AUTH] logout: called demoLogout()');
      } catch (error) {
        if (__DEV__) console.warn('[AUTH] logout: failed to call demoLogout', error);
      }
    }

    // P0-001 FIX: Reset demoDmStore to prevent cross-user DM leakage in demo mode
    try {
      const { useDemoDmStore } = require('@/stores/demoDmStore');
      useDemoDmStore.getState()?.reset?.();
      if (__DEV__) console.log('[AUTH] logout: cleared demoDmStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset demoDmStore', error);
    }

    try {
      const { useVerificationStore } = require('@/stores/verificationStore');
      useVerificationStore.getState()?.resetVerification?.();
      if (__DEV__) console.log('[AUTH] logout: cleared verificationStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset verificationStore', error);
    }

    // P0-PRIVACY-FIX: Reset privacy settings to prevent cross-user leakage
    try {
      const { usePrivacyStore } = require('@/stores/privacyStore');
      usePrivacyStore.getState()?.resetPrivacy?.();
      if (__DEV__) console.log('[AUTH] logout: cleared privacyStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset privacyStore', error);
    }

    try {
      const { useConfessionStore } = require('@/stores/confessionStore');
      const confessionState = useConfessionStore.getState();
      if (confessionState?.reset) {
        confessionState.reset();
      } else {
        // P0-002 FIX: Clear ALL user-specific state including rate limits and block lists
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
      if (__DEV__) console.log('[AUTH] logout: cleared confessionStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset confessionStore', error);
    }

    try {
      const { clearTodCache } = require('@/app/(main)/(private)/(tabs)/truth-or-dare');
      clearTodCache?.();
      if (__DEV__) console.log('[AUTH] logout: cleared T&D cache');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to clear T&D cache', error);
    }

    try {
      const { useChatTodStore } = require('@/stores/chatTodStore');
      useChatTodStore.setState({ games: {} });
      if (__DEV__) console.log('[AUTH] logout: cleared chatTodStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to clear chatTodStore', error);
    }

    // P0-005 FIX: Reset Phase-2 active flag to prevent notification filtering for next user
    try {
      const { setPhase2Active } = require('@/hooks/useNotifications');
      setPhase2Active(false);
      if (__DEV__) console.log('[AUTH] logout: reset Phase-2 active flag');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset Phase-2 active flag', error);
    }

    // P1 SECURITY: Reset discoverStore to prevent cross-user state bleed
    // Daily like limits and session counters must not leak between users
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
      if (__DEV__) console.log('[AUTH] logout: cleared discoverStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset discoverStore', error);
    }

    // APP-P1-007 FIX: Clear blockStore to prevent cross-user blocked list bleed
    try {
      const { useBlockStore } = require('@/stores/blockStore');
      useBlockStore.getState().clearBlocks();
      if (__DEV__) console.log('[AUTH] logout: cleared blockStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset blockStore', error);
    }

    // P0-002 FIX: Clear filterStore to prevent cross-user filter bleed
    try {
      const { useFilterStore } = require('@/stores/filterStore');
      useFilterStore.getState().clearFilters();
      if (__DEV__) console.log('[AUTH] logout: cleared filterStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset filterStore', error);
    }

    // P0-002 FIX: Clear subscriptionStore to prevent cross-user subscription bleed
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
      if (__DEV__) console.log('[AUTH] logout: cleared subscriptionStore');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to reset subscriptionStore', error);
    }

    // P0-003 FIX: Stop GPS tracking to prevent battery drain and privacy leak
    try {
      const { useLocationStore } = require('@/stores/locationStore');
      useLocationStore.getState().stopLocationTracking();
      if (__DEV__) console.log('[AUTH] logout: stopped location tracking');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to stop location tracking', error);
    }

    // PHASE 2: Stop background location tracking and clear settings on logout
    try {
      const { cleanupBackgroundLocation } = require('@/utils/backgroundLocation');
      await cleanupBackgroundLocation();
      if (__DEV__) console.log('[AUTH] logout: cleaned up background location');
    } catch (error) {
      if (__DEV__) console.warn('[AUTH] logout: failed to cleanup background location', error);
    }

    // STEP 4: Finish logout - clear in-memory state
    get().finishLogout();
  },

  // ==========================================================================
  // OTHER ACTIONS
  // ==========================================================================

  setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),

  setFaceVerificationPassed: (passed) => set({ faceVerificationPassed: passed }),

  setFaceVerificationPending: (pending) => set({ faceVerificationPending: pending }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  setHasHydrated: () => set({ _hasHydrated: true }),

  syncFromServerValidation: (userInfo) =>
    set((state) => ({
      onboardingCompleted: userInfo.onboardingCompleted || state.onboardingCompleted,
    })),

  setSessionValidated: (validated, error = null) =>
    set({
      _sessionValidated: true,
      _sessionValidationError: validated ? null : error,
    }),

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
