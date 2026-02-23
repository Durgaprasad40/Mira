import { useRef, useEffect, useState, useMemo } from "react";
import { Redirect, useRouter } from "expo-router";
import type { Href } from "expo-router";

const H = (p: string) => p as unknown as Href;
import { useAuthStore } from "@/stores/authStore";
import { useBootStore } from "@/stores/bootStore";
import { getBootCache } from "@/stores/bootCache";
import { getAuthBootCache, type AuthBootCacheData } from "@/stores/authBootCache";
import { isDemoMode } from "@/hooks/useConvex";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { COLORS } from "@/lib/constants";
import { markTiming, markDuration } from "@/utils/startupTiming";

// Boot action types for pure computation (no side effects in useMemo)
type BootAction =
  | { type: "LOADING" }
  | { type: "FORCE_WELCOME_LOGOUT"; route: "/(auth)/welcome" }
  | { type: "ROUTE_WELCOME"; route: "/(auth)/welcome" }
  | { type: "ROUTE_ADDITIONAL"; route: "/(onboarding)/additional-photos" }
  | { type: "ROUTE_FACE_VERIFICATION"; route: "/(onboarding)/face-verification" }
  | { type: "ROUTE_HOME"; route: "/(main)/(tabs)/home" };

export default function Index() {
  // We no longer wait for full authStore hydration - use boot caches for fast routing
  const setRouteDecisionMade = useBootStore((s) => s.setRouteDecisionMade);
  const router = useRouter();
  const didRedirect = useRef(false);
  const routeSignaled = useRef(false);
  const didForceWelcome = useRef(false);
  const didForceLogout = useRef(false); // Guard for logout side effect

  // FAST PATH: use boot caches instead of waiting for full Zustand hydration
  // Boot caches read only minimal data (~100 bytes) directly from AsyncStorage
  // vs ~50KB+ for full stores with all matches, profiles, etc.

  // Auth boot cache (for live mode routing)
  const [authBootCacheData, setAuthBootCacheData] = useState<AuthBootCacheData | null>(null);

  // Demo boot cache (for demo mode routing)
  const [bootCacheData, setBootCacheData] = useState<{
    currentDemoUserId: string | null;
    demoOnboardingComplete: Record<string, boolean>;
  } | null>(null);

  // Track if we've already started loading (to measure duration once)
  const cacheLoadStarted = useRef(false);

  useEffect(() => {
    // Only load once, measure duration
    if (cacheLoadStarted.current) return;
    cacheLoadStarted.current = true;

    const t0 = Date.now();

    // Load caches in parallel, measure total duration
    const loadCaches = async () => {
      // Always load auth cache
      const authPromise = getAuthBootCache();

      // Load demo cache only in demo mode
      const demoPromise = isDemoMode ? getBootCache() : Promise.resolve(null);

      const [authData, demoData] = await Promise.all([authPromise, demoPromise]);

      const duration = Date.now() - t0;
      markDuration('boot_caches', duration);

      setAuthBootCacheData(authData);
      if (demoData) {
        setBootCacheData(demoData);
      }
    };

    loadCaches();
  }, []);

  // For demo mode: use bootCache (fast) for routing
  // For live mode: use authBootCache (fast) for routing
  const currentDemoUserId = bootCacheData?.currentDemoUserId ?? null;
  const demoOnboardingComplete = bootCacheData?.demoOnboardingComplete ?? {};

  // Wait for boot caches only - NOT full store hydration
  // authBootCache: ~10-50ms vs authStore hydration: ~900ms
  // bootCache: ~10-50ms vs demoStore hydration: ~100-200ms
  const bootCachesReady = authBootCacheData && (!isDemoMode || bootCacheData);

  // PURE computation of boot action - NO side effects (logout, setState, etc.)
  // Side effects are handled in useEffect below
  const bootAction: BootAction = useMemo(() => {
    if (!bootCachesReady || !authBootCacheData) {
      return { type: "LOADING" };
    }

    // ── Demo mode: email+password auth with full onboarding ──
    if (isDemoMode) {
      if (currentDemoUserId) {
        const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
        const facePassed = authBootCacheData.faceVerificationPassed;

        if (onbComplete) {
          return { type: "ROUTE_HOME", route: "/(main)/(tabs)/home" };
        }

        // CHECKPOINT SYSTEM: face verification is the strict gate
        if (facePassed) {
          return { type: "ROUTE_ADDITIONAL", route: "/(onboarding)/additional-photos" };
        } else if (authBootCacheData.faceVerificationPending) {
          // PENDING: User is awaiting manual review — resume at face-verification screen
          return { type: "ROUTE_FACE_VERIFICATION", route: "/(onboarding)/face-verification" };
        } else {
          // Face NOT passed and NOT pending → need to force logout (done in useEffect)
          return { type: "FORCE_WELCOME_LOGOUT", route: "/(auth)/welcome" };
        }
      }
      return { type: "ROUTE_WELCOME", route: "/(auth)/welcome" };
    }

    // ── Live mode: standard auth flow using authBootCache ──
    const hasValidToken = typeof authBootCacheData.token === 'string' && authBootCacheData.token.trim().length > 0;

    if (hasValidToken) {
      // Onboarding complete → home
      if (authBootCacheData.onboardingCompleted) {
        return { type: "ROUTE_HOME", route: "/(main)/(tabs)/home" };
      }

      // CHECKPOINT SYSTEM: face verification is the strict gate
      if (authBootCacheData.faceVerificationPassed) {
        return { type: "ROUTE_ADDITIONAL", route: "/(onboarding)/additional-photos" };
      } else if (authBootCacheData.faceVerificationPending) {
        // PENDING: User is awaiting manual review — resume at face-verification screen
        return { type: "ROUTE_FACE_VERIFICATION", route: "/(onboarding)/face-verification" };
      } else {
        // Face NOT passed and NOT pending → need to force logout (done in useEffect)
        return { type: "FORCE_WELCOME_LOGOUT", route: "/(auth)/welcome" };
      }
    }

    // No valid token → show welcome screen
    return { type: "ROUTE_WELCOME", route: "/(auth)/welcome" };
  }, [bootCachesReady, authBootCacheData, currentDemoUserId, demoOnboardingComplete]);

  // Derive route for use in render (null if loading)
  const routeDestination = bootAction.type === "LOADING" ? null : bootAction.route;

  // SIDE EFFECT: Handle FORCE_WELCOME_LOGOUT (must run in useEffect, not during render)
  // This logs out the user and navigates to welcome screen
  useEffect(() => {
    if (bootAction.type !== "FORCE_WELCOME_LOGOUT") return;
    if (didForceLogout.current) return; // Guard: only run once
    didForceLogout.current = true;

    if (__DEV__) console.log('[ONB] pre-verify → forcing logout, routing to /(auth)/welcome');
    useAuthStore.getState().logout();
    router.replace("/(auth)/welcome");
  }, [bootAction, router]);

  // Side effects: signal route decision, restore demo auth, mark timing
  // This runs in the commit phase AFTER render, avoiding setState-during-render
  useEffect(() => {
    if (!routeDestination || routeSignaled.current) return;
    routeSignaled.current = true;

    // Log boot decision for debugging (with reference photo info from onboarding store if available)
    if (__DEV__) {
      const facePassed = authBootCacheData?.faceVerificationPassed;
      const onbComplete = authBootCacheData?.onboardingCompleted;
      const hasToken = typeof authBootCacheData?.token === 'string' && authBootCacheData.token.trim().length > 0;
      console.log(`[ONB] boot_decision facePassed=${facePassed} onboardingCompleted=${onbComplete} hasToken=${hasToken} action=${bootAction.type}`);
      console.log(`[ONB] route_decision routeDestination=${routeDestination}`);
    }

    // Mark timing: boot caches are ready and route computed
    markTiming('boot_caches_ready');

    // Restore demo auth session if needed (covers app restart)
    // Skip if we're forcing logout (face verification not passed)
    if (isDemoMode && currentDemoUserId && !useAuthStore.getState().isAuthenticated && bootAction.type !== "FORCE_WELCOME_LOGOUT") {
      const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
      useAuthStore.getState().setAuth(currentDemoUserId, 'demo_token', onbComplete);
    }

    // Signal to BootScreen that routing decision has been made
    setRouteDecisionMade(true);

    // Milestone D: route decision made
    markTiming('route_decision');
  }, [routeDestination, setRouteDecisionMade, currentDemoUserId, demoOnboardingComplete, bootAction, authBootCacheData]);

  // IMPERATIVE NAVIGATION for unauthenticated users → welcome screen
  // Uses router.replace() to OVERRIDE any restored navigation state from Expo Go
  // Skip if FORCE_WELCOME_LOGOUT already handled navigation
  useEffect(() => {
    if (!routeDestination || didForceWelcome.current) return;
    if (bootAction.type === "FORCE_WELCOME_LOGOUT") return; // Already handled above

    if (routeDestination === "/(auth)/welcome") {
      didForceWelcome.current = true;
      if (__DEV__) console.log("[BOOT] forced welcome replace");
      router.replace("/(auth)/welcome");
    }
  }, [routeDestination, router, bootAction]);

  // Loading state: boot caches not yet ready
  if (!routeDestination) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // FORCE_WELCOME_LOGOUT: useEffect handles logout + navigation, render nothing
  if (bootAction.type === "FORCE_WELCOME_LOGOUT") {
    return null;
  }

  // For unauthenticated → welcome: imperative navigation handles it, return null
  if (routeDestination === "/(auth)/welcome") {
    return null;
  }

  // Guard: render <Redirect> exactly once for authenticated users.
  // After the first render that returns <Redirect>, all subsequent renders return null.
  // This prevents the focus-loop caused by expo-router's <Redirect> internally using
  // useFocusEffect with a new inline callback on every render.
  if (didRedirect.current) {
    return null;
  }
  didRedirect.current = true;

  return <Redirect href={H(routeDestination)} />;
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
