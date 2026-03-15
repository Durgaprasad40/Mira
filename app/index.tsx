import { useRef, useEffect, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";

import { useAuthStore } from "@/stores/authStore";
import { useBootStore } from "@/stores/bootStore";
import { getBootCache } from "@/stores/bootCache";
import { getAuthBootCache, clearAuthBootCache, type AuthBootCacheData } from "@/stores/authBootCache";
import { isDemoMode, convex } from "@/hooks/useConvex";
import { skipDemoOnboarding } from "@/config/demo";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COLORS } from "@/lib/constants";
import { markTiming, markDuration } from "@/utils/startupTiming";

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
  | "DEMO_WELCOME";

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

  // ==========================================================================
  // GUARDS
  // ==========================================================================

  const hasNavigated = useRef(false);
  const hasLoadedCache = useRef(false);
  const hasValidated = useRef(false);
  const mounted = useRef(true);

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
      if (__DEV__) console.log('[BOOT] Post-logout remount detected (authVersion > 0, no token), skipping cache load');
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

      setAuthCache(authData);
      if (demoData) setDemoCache(demoData);

      // Determine next state based on cached auth
      if (isDemoMode) {
        // Demo mode decision
        if (skipDemoOnboarding) {
          setBootState("DEMO_HOME");
        } else if (demoData?.currentDemoUserId) {
          const onbComplete = !!demoData.demoOnboardingComplete[demoData.currentDemoUserId];
          setBootState(onbComplete ? "DEMO_HOME" : "DEMO_WELCOME");
        } else {
          setBootState("DEMO_WELCOME");
        }
      } else {
        // Live mode decision
        const hasValidToken = authData.token && authData.token.trim().length > 0;
        if (hasValidToken && authData.userId) {
          setBootState("VALIDATING");
        } else {
          setBootState("NO_AUTH");
        }
      }
    };

    loadCaches();
  }, []);

  // ==========================================================================
  // STEP 2: Validate with backend (ONCE, only if VALIDATING)
  // ==========================================================================

  useEffect(() => {
    if (bootState !== "VALIDATING" || hasValidated.current || !authCache) return;
    hasValidated.current = true;

    const { token, userId } = authCache;
    if (!token || !userId) {
      setBootState("NO_AUTH");
      return;
    }

    // CRITICAL FIX: Double-check we're not in post-logout state
    // If authVersion > 0 and no current token, logout happened - don't validate stale cache
    const currentAuthState = useAuthStore.getState();
    if (currentAuthState.authVersion > 0 && !currentAuthState.token) {
      if (__DEV__) console.log('[BOOT] Post-logout state detected in validation, aborting');
      setBootState("NO_AUTH");
      return;
    }

    // Capture authVersion BEFORE async operation
    const capturedAuthVersion = currentAuthState.authVersion;

    if (__DEV__) {
      console.log(`[BOOT] Validating session, userId=${userId.substring(0, 10)}..., authVersion=${capturedAuthVersion}`);
    }

    const validate = async () => {
      const TIMEOUT = 8000; // 8 second timeout

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Validation timeout")), TIMEOUT)
        );

        const statusPromise = convex.query(api.users.getOnboardingStatus, {
          userId: userId as Id<"users">,
        });

        const status = (await Promise.race([statusPromise, timeoutPromise])) as any;

        if (!mounted.current) return;

        // Check if logout happened during validation
        const currentState = useAuthStore.getState();
        if (currentState.logoutInProgress) {
          if (__DEV__) console.log("[BOOT] Logout in progress, ignoring validation result");
          setBootState("INVALID");
          return;
        }
        if (currentState.authVersion !== capturedAuthVersion) {
          if (__DEV__) console.log(`[BOOT] authVersion changed (${capturedAuthVersion} -> ${currentState.authVersion}), ignoring validation result`);
          setBootState("INVALID");
          return;
        }

        if (!status) {
          // User not found in database - clear stale auth
          if (__DEV__) console.log("[BOOT] User not found (null status), clearing auth");
          await clearAuthBootCache();
          setBootState("INVALID");
          return;
        }

        const backendOnboardingCompleted = status.onboardingCompleted ?? false;
        if (__DEV__) {
          console.log(`[BOOT] Validation success, onboardingCompleted=${backendOnboardingCompleted}`);
        }

        // Apply auth to store (setAuthenticatedSession will reject if logout or version mismatch)
        const accepted = useAuthStore.getState().setAuthenticatedSession(
          userId,
          token,
          backendOnboardingCompleted,
          capturedAuthVersion
        );

        if (!accepted) {
          if (__DEV__) console.log("[BOOT] setAuthenticatedSession rejected (logout in progress)");
          setBootState("INVALID");
          return;
        }

        // Route based on onboarding status
        setBootState(backendOnboardingCompleted ? "VALID_HOME" : "VALID_ONBOARD");

      } catch (error) {
        console.error("[BOOT] Validation failed:", error);
        if (!mounted.current) return;

        // On validation failure, trust cached onboardingCompleted if available
        const cachedOnbComplete = authCache.onboardingCompleted === true;

        // Check logout state again
        const currentState = useAuthStore.getState();
        if (currentState.logoutInProgress || currentState.authVersion !== capturedAuthVersion) {
          if (__DEV__) console.log("[BOOT] Logout during validation error handling, routing to welcome");
          setBootState("INVALID");
          return;
        }

        if (cachedOnbComplete) {
          // Trust cache for completed users (SessionValidator will catch truly invalid sessions)
          const accepted = useAuthStore.getState().setAuthenticatedSession(userId, token, true, capturedAuthVersion);
          if (accepted) {
            if (__DEV__) console.log("[BOOT] Validation failed, trusting cached onboardingCompleted=true");
            setBootState("VALID_HOME");
          } else {
            setBootState("INVALID");
          }
        } else {
          // No cached completion - route to welcome
          if (__DEV__) console.log("[BOOT] Validation failed, no cached completion, routing to welcome");
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
    const route = getRouteForState(bootState);
    if (__DEV__) {
      console.log(`[BOOT] Final state=${bootState}, navigating to ${route}`);
    }

    // Use replace for all routes to prevent back navigation to boot screen
    router.replace(route as any);
  }, [bootState, router, setRouteDecisionMade, demoCache]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  // Show loading while in LOADING or VALIDATING state
  if (bootState === "LOADING" || bootState === "VALIDATING") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
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
    case "NO_AUTH":
    case "INVALID":
    case "DEMO_WELCOME":
    default:
      // All non-completed users (including VALID_ONBOARD) start from Welcome
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
