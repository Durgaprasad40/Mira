import { useRef, useEffect, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";

import { useAuthStore } from "@/stores/authStore";
import { useBootStore } from "@/stores/bootStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { getBootCache } from "@/stores/bootCache";
import { getAuthBootCache, clearAuthBootCache, type AuthBootCacheData } from "@/stores/authBootCache";
import { isDemoMode, convex } from "@/hooks/useConvex";
import { skipDemoOnboarding, isDemoAuthMode } from "@/config/demo";
import { isDemoToken, validateDemoSession, getDemoOnboardingStatus } from "@/lib/demoAuth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COLORS } from "@/lib/constants";
import { markTiming, markDuration } from "@/utils/startupTiming";
import { startDiscoverPrefetch, clearDiscoverPrefetch } from "@/lib/discoverPrefetch";
import { DEBUG_AUTH_BOOT } from "@/lib/debugFlags";
import { getOnboardingResumeRoute } from "@/lib/onboardingRouting";

// =============================================================================
// BOOT STATE MACHINE
// =============================================================================
//
// States:
//   LOADING       - Reading persisted auth from SecureStore
//   NO_AUTH       - No valid persisted auth → route to welcome
//   VALIDATING    - Have persisted auth, validating with backend
//   VALID_HOME    - Validation success + onboarding complete → route to home
//   VALID_ONBOARD - Validation success + onboarding incomplete → route to onboarding
//   INVALID       - Validation failed → route to welcome
//   DEMO_HOME     - Demo mode + onboarding complete → route to home
//   DEMO_WELCOME  - Demo mode + no user or incomplete → route to welcome
//
// Rules:
//   - Read persisted auth ONCE
//   - Validate with backend ONCE (if auth exists)
//   - Capture authVersion before validation, check before applying
//   - If logoutInProgress, do not apply auth
//   - After routing decision, do not re-route
// =============================================================================

type BootState =
  | "LOADING"
  | "NO_AUTH"
  | "VALIDATING"
  | "VALID_HOME"
  | "VALID_ONBOARD"
  | "INVALID"
  | "DEMO_HOME"
  | "DEMO_WELCOME"
  | "TIMEOUT_RETRY";  // TIMEOUT-FIX: New state for validation timeout with retry

const H = (p: string) => p as unknown as Href;

export default function Index() {
  const router = useRouter();
  const setRouteDecisionMade = useBootStore((s) => s.setRouteDecisionMade);

  // ==========================================================================
  // STATE
  // ==========================================================================

  const [bootState, setBootState] = useState<BootState>("LOADING");
  const [authCache, setAuthCache] = useState<AuthBootCacheData | null>(null);
  const [demoCache, setDemoCache] = useState<{
    currentDemoUserId: string | null;
    demoOnboardingComplete: Record<string, boolean>;
  } | null>(null);
  // P1-003 FIX: Store resume route for VALID_ONBOARD state
  // Reset when bootState changes to non-onboarding state to prevent route leakage
  const [onboardingResumeRoute, setOnboardingResumeRoute] = useState<string | null>(null);

  // ==========================================================================
  // GUARDS
  // ==========================================================================

  const hasNavigated = useRef(false);
  const hasLoadedCache = useRef(false);
  const hasValidated = useRef(false);
  const mounted = useRef(true);
  // TIMEOUT-FIX: Track retry attempts for validation timeout
  const validationRetryCount = useRef(0);
  const MAX_VALIDATION_RETRIES = 2;

  // Cleanup on unmount
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ==========================================================================
  // STEP 1: Load persisted auth from SecureStore (ONCE)
  // ==========================================================================

  useEffect(() => {
    if (hasLoadedCache.current) return;
    hasLoadedCache.current = true;

    // CRITICAL FIX: If logout just completed (authVersion > 0), don't load cached auth
    // This prevents index.tsx from restoring auth when it remounts after logout
    const currentAuthState = useAuthStore.getState();
    if (currentAuthState.authVersion > 0 && !currentAuthState.token) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[BOOT] post-logout remount, skip cache');
      setBootState(isDemoMode ? "DEMO_WELCOME" : "NO_AUTH");
      return;
    }

    const loadCaches = async () => {
      const t0 = Date.now();

      const [authData, demoData] = await Promise.all([
        getAuthBootCache(),
        isDemoMode ? getBootCache() : Promise.resolve(null),
      ]);

      markDuration("boot_caches", Date.now() - t0);

      if (!mounted.current) return;

      // P0-004 FIX: Re-check logout state AFTER async cache read
      // Logout could have occurred during the Promise.all wait
      const postLoadAuthState = useAuthStore.getState();
      if (postLoadAuthState.logoutInProgress || (postLoadAuthState.authVersion > 0 && !postLoadAuthState.token)) {
        if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[BOOT] logout during cache load, abort');
        setBootState(isDemoMode ? "DEMO_WELCOME" : "NO_AUTH");
        return;
      }

      setAuthCache(authData);
      if (demoData) setDemoCache(demoData);

      // Determine next state based on cached auth
      // =========================================================================
      // DEMO AUTH MODE: Validate demo token via Convex backend
      // =========================================================================
      if (isDemoAuthMode) {
        const hasValidToken = authData.token && authData.token.trim().length > 0;
        if (hasValidToken && authData.userId && isDemoToken(authData.token)) {
          if (__DEV__ && DEBUG_AUTH_BOOT) {
            console.log('[BOOT] Demo auth mode: validating demo token');
          }
          setBootState("VALIDATING");
        } else {
          if (__DEV__ && DEBUG_AUTH_BOOT) {
            console.log('[BOOT] Demo auth mode: no valid demo token, route to welcome');
          }
          setBootState("NO_AUTH");
        }
      } else if (isDemoMode) {
        // =========================================================================
        // LEGACY DEMO MODE: Local demoStore decision
        // =========================================================================
        if (skipDemoOnboarding) {
          setBootState("DEMO_HOME");
        } else if (demoData?.currentDemoUserId) {
          const onbComplete = !!demoData.demoOnboardingComplete[demoData.currentDemoUserId];
          setBootState(onbComplete ? "DEMO_HOME" : "DEMO_WELCOME");
        } else {
          setBootState("DEMO_WELCOME");
        }
      } else {
        // =========================================================================
        // LIVE MODE: Validate with backend
        // =========================================================================
        const hasValidToken = authData.token && authData.token.trim().length > 0;
        if (hasValidToken && authData.userId) {
          // PERF: Start prefetching Discover profiles in parallel with validation
          // This eliminates the serial wait: validate → navigate → mount → query
          // Instead: validate + prefetch (parallel) → navigate → mount → render immediately
          const currentAuthVersion = useAuthStore.getState().authVersion;
          startDiscoverPrefetch(authData.userId, authData.token, currentAuthVersion);

          setBootState("VALIDATING");
        } else {
          setBootState("NO_AUTH");
        }
      }
    };

    loadCaches();
  }, []);

  // ==========================================================================
  // STEP 2: Validate with backend (with retry support for timeouts)
  // ==========================================================================
  // TIMEOUT-FIX: Separate timeout from invalid session
  // - Timeout = network/query delay, should retry
  // - Invalid = backend explicitly confirms user doesn't exist
  // ==========================================================================

  useEffect(() => {
    // TIMEOUT-FIX: Handle both VALIDATING and TIMEOUT_RETRY states
    if (bootState !== "VALIDATING" && bootState !== "TIMEOUT_RETRY") return;
    if (bootState === "VALIDATING" && hasValidated.current) return;
    if (bootState === "VALIDATING") hasValidated.current = true;
    if (!authCache) return;

    const { token, userId } = authCache;
    if (!token || !userId) {
      setBootState("NO_AUTH");
      return;
    }

    // CRITICAL FIX: Double-check we're not in post-logout state
    // If authVersion > 0 and no current token, logout happened - don't validate stale cache
    const currentAuthState = useAuthStore.getState();
    if (currentAuthState.authVersion > 0 && !currentAuthState.token) {
      if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[BOOT] post-logout state in validation, abort');
      setBootState("NO_AUTH");
      return;
    }

    // Capture authVersion BEFORE async operation
    const capturedAuthVersion = currentAuthState.authVersion;
    const retryAttempt = validationRetryCount.current;

    if (__DEV__ && DEBUG_AUTH_BOOT) {
      console.log(`[BOOT] validating: ${userId.substring(0, 8)}, v${capturedAuthVersion}, try${retryAttempt + 1}`);
    }

    const validate = async () => {
      const TIMEOUT = 8000; // 8 second timeout

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Validation timeout")), TIMEOUT)
        );

        // =========================================================================
        // DEMO AUTH MODE: Use demo auth APIs for validation
        // =========================================================================
        let statusPromise: Promise<any>;
        if (isDemoAuthMode && isDemoToken(token)) {
          if (__DEV__ && DEBUG_AUTH_BOOT) {
            console.log('[BOOT] Using demo auth API for validation');
          }
          statusPromise = getDemoOnboardingStatus(token);
        } else {
          statusPromise = convex.query(api.users.getOnboardingStatus, {
            token,
            userId,
          });
        }

        const status = (await Promise.race([statusPromise, timeoutPromise])) as any;

        if (!mounted.current) return;

        // Reset retry count on success
        validationRetryCount.current = 0;

        // Check if logout happened during validation
        const currentState = useAuthStore.getState();
        if (currentState.logoutInProgress) {
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] logout in progress, skip");
          setBootState("INVALID");
          return;
        }
        if (currentState.authVersion !== capturedAuthVersion) {
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log(`[BOOT] authVersion changed ${capturedAuthVersion}->${currentState.authVersion}, skip`);
          setBootState("INVALID");
          return;
        }

        if (!status) {
          // User not found in database - THIS IS A TRUE INVALID SESSION
          // Clear stale auth and prefetch, route to welcome
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] user not found, clearing auth");
          await clearAuthBootCache();
          clearDiscoverPrefetch();
          setBootState("INVALID");
          return;
        }

        const backendOnboardingCompleted = status.onboardingCompleted ?? false;
        if (__DEV__ && DEBUG_AUTH_BOOT) {
          console.log(`[BOOT] valid, onb=${backendOnboardingCompleted}`);
        }

        // Apply auth to store (setAuthenticatedSession will reject if logout or version mismatch)
        const accepted = useAuthStore.getState().setAuthenticatedSession(
          userId,
          token,
          backendOnboardingCompleted,
          capturedAuthVersion
        );

        if (!accepted) {
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] setAuth rejected (logout)");
          setBootState("INVALID");
          return;
        }

        // Route based on onboarding status
        if (backendOnboardingCompleted) {
          setBootState("VALID_HOME");
        } else {
          // FIX: Compute resume route from lastStepKey before setting state
          const lastStepKey = status.onboardingDraft?.progress?.lastStepKey;
          const resumeRoute = getOnboardingResumeRoute(lastStepKey, status);
          if (__DEV__ && DEBUG_AUTH_BOOT) {
            console.log(`[BOOT] onboard: step=${lastStepKey}, route=${resumeRoute}`);
          }

          // DATA-1 FIX: Hydrate onboarding store BEFORE navigation
          // We already have the draft data from getOnboardingStatus, so hydrate now
          // This prevents the "pop in" effect where screens render empty then fill in
          const onbStore = useOnboardingStore.getState();

          // Step 1: Hydrate from draft (resets store, applies saved progress)
          if (status.onboardingDraft) {
            if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[BOOT] hydrating onb from draft');
            onbStore.hydrateFromDraft(status.onboardingDraft);
          } else {
            // No draft - just mark as hydrated
            onbStore.hydrateFromDraft(null);
          }

          // Step 2: Apply user document basicInfo (authoritative, overrides stale draft)
          // IDENTITY SIMPLIFICATION: Single name field
          if (status.basicInfo) {
            const { name, nickname, dateOfBirth, gender } = status.basicInfo;
            if (name) {
              onbStore.setName(name);
            }
            if (nickname) onbStore.setNickname(nickname);
            if (dateOfBirth) onbStore.setDateOfBirth(dateOfBirth);
            if (gender) {
              const validGenders = ['male', 'female', 'non_binary'];
              if (validGenders.includes(gender)) {
                onbStore.setGender(gender as any);
              }
            }
            if (__DEV__ && DEBUG_AUTH_BOOT) console.log('[BOOT] applied basicInfo');
          }

          setOnboardingResumeRoute(resumeRoute);
          setBootState("VALID_ONBOARD");
        }

      } catch (error) {
        if (!mounted.current) return;

        // TIMEOUT-FIX: Distinguish timeout from actual validation failure
        const isTimeoutError = error instanceof Error && error.message === "Validation timeout";
        const cachedOnbComplete = authCache.onboardingCompleted === true;

        // Check logout state
        const currentState = useAuthStore.getState();
        if (currentState.logoutInProgress || currentState.authVersion !== capturedAuthVersion) {
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] logout during error handling");
          setOnboardingResumeRoute(null);
          setBootState("INVALID");
          return;
        }

        // TIMEOUT-FIX: Debug logging for timeout handling
        if (__DEV__ && DEBUG_AUTH_BOOT) {
          console.log(`[BOOT] timeout_debug: type=${isTimeoutError ? 'TIMEOUT' : 'ERROR'}, try=${retryAttempt}, willRetry=${isTimeoutError && retryAttempt < MAX_VALIDATION_RETRIES}`);
        }

        if (isTimeoutError) {
          // TIMEOUT-FIX: Timeout is NOT the same as invalid session
          // Retry if we haven't exceeded max retries
          if (retryAttempt < MAX_VALIDATION_RETRIES) {
            if (__DEV__ && DEBUG_AUTH_BOOT) console.log(`[BOOT] timeout, retry ${retryAttempt + 2}/${MAX_VALIDATION_RETRIES + 1}`);
            validationRetryCount.current = retryAttempt + 1;
            // Trigger retry by setting TIMEOUT_RETRY state
            setBootState("TIMEOUT_RETRY");
            return;
          }

          // All retries exhausted - but token exists, so trust cache if available
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log(`[BOOT] all ${MAX_VALIDATION_RETRIES + 1} attempts timed out`);

          if (cachedOnbComplete) {
            // TIMEOUT-FIX: Trust cache for completed users after timeout
            // SessionValidator will catch truly invalid sessions later
            const accepted = useAuthStore.getState().setAuthenticatedSession(userId, token, true, capturedAuthVersion);
            if (accepted) {
              if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] timeout, trust cache onb=true->home");
              setBootState("VALID_HOME");
              return;
            }
          }

          // TIMEOUT-FIX: Even without cached completion, keep trying
          // Show loading state, don't route to welcome
          // The user has a valid token - this is likely just network issues
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] timeout, no cache, staying in loading");

          // Keep in VALIDATING state to show loading UI
          // The bootStore safety timer will eventually kick in
          // but we won't incorrectly route to welcome
          // For now, trust the token and proceed to home as a fallback
          const accepted = useAuthStore.getState().setAuthenticatedSession(userId, token, false, capturedAuthVersion);
          if (accepted) {
            // Go to onboarding flow - safer than welcome
            if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] timeout fallback->onboarding");
            setOnboardingResumeRoute("/(onboarding)/basic-info");
            setBootState("VALID_ONBOARD");
          } else {
            // Auth rejected - truly invalid
            setBootState("INVALID");
          }
          return;
        }

        // Non-timeout error (actual failure) - KEEP this error log
        console.error("[BOOT] Validation failed:", error);

        if (cachedOnbComplete) {
          // Trust cache for completed users (SessionValidator will catch truly invalid sessions)
          const accepted = useAuthStore.getState().setAuthenticatedSession(userId, token, true, capturedAuthVersion);
          if (accepted) {
            if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] error, trust cache->home");
            setBootState("VALID_HOME");
          } else {
            setBootState("INVALID");
          }
        } else {
          // Non-timeout error with no cached completion
          // This might be a network error, not necessarily invalid session
          // Still retry once for non-timeout errors too
          if (retryAttempt < 1) {
            if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] error, retry once");
            validationRetryCount.current = retryAttempt + 1;
            setBootState("TIMEOUT_RETRY");
            return;
          }
          // After retry, if still failing with no cache, route to welcome
          if (__DEV__ && DEBUG_AUTH_BOOT) console.log("[BOOT] error, no cache->welcome");
          setBootState("INVALID");
        }
      }
    };

    validate();
  }, [bootState, authCache]);

  // ==========================================================================
  // STEP 3: Execute navigation based on final state (ONCE)
  // ==========================================================================

  useEffect(() => {
    // Only navigate from terminal states
    const terminalStates: BootState[] = [
      "NO_AUTH", "VALID_HOME", "VALID_ONBOARD", "INVALID", "DEMO_HOME", "DEMO_WELCOME"
    ];
    if (!terminalStates.includes(bootState)) return;
    if (hasNavigated.current) return;
    hasNavigated.current = true;

    // Mark timing
    markTiming("boot_caches_ready");
    markTiming("route_decision");
    setRouteDecisionMade(true);

    // Demo mode: restore auth if needed
    if (isDemoMode && demoCache?.currentDemoUserId && bootState === "DEMO_HOME") {
      const authState = useAuthStore.getState();
      if (!authState.getIsAuthenticated() && authState.authVersion === 0) {
        const onbComplete = !!demoCache.demoOnboardingComplete[demoCache.currentDemoUserId];
        useAuthStore.getState().setAuthenticatedSession(
          demoCache.currentDemoUserId,
          "demo_token",
          onbComplete,
          0 // Cold start - authVersion is 0
        );
      }
    }

    // Navigate based on state
    // FIX: Use onboardingResumeRoute for VALID_ONBOARD instead of welcome
    const route = bootState === "VALID_ONBOARD" && onboardingResumeRoute
      ? onboardingResumeRoute
      : getRouteForState(bootState);
    if (__DEV__ && DEBUG_AUTH_BOOT) {
      console.log(`[BOOT] state=${bootState}, nav=${route}`);
    }

    // Use replace for all routes to prevent back navigation to boot screen
    router.replace(route as any);
  }, [bootState, router, setRouteDecisionMade, demoCache, onboardingResumeRoute]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  // Show loading while in LOADING, VALIDATING, or TIMEOUT_RETRY state
  // TIMEOUT-FIX: TIMEOUT_RETRY should also show loading, not navigate to welcome
  if (bootState === "LOADING" || bootState === "VALIDATING" || bootState === "TIMEOUT_RETRY") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>
          {bootState === "TIMEOUT_RETRY" ? "Reconnecting..." : "Loading..."}
        </Text>
      </View>
    );
  }

  // For all other states, return null - navigation is handled imperatively
  return null;
}

// =============================================================================
// HELPERS
// =============================================================================

function getRouteForState(state: BootState): string {
  switch (state) {
    case "VALID_HOME":
    case "DEMO_HOME":
      return "/(main)/(tabs)/home";
    case "VALID_ONBOARD":
      // FIX: Fallback for VALID_ONBOARD - resume from basic-info (first profile step)
      // Note: Normally onboardingResumeRoute is used instead of this fallback
      return "/(onboarding)/basic-info";
    case "NO_AUTH":
    case "INVALID":
    case "DEMO_WELCOME":
    default:
      // Unauthenticated users start from auth welcome
      return "/(auth)/welcome";
  }
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.text,
    fontSize: 16,
  },
});
