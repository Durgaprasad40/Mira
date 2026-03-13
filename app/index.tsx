import { useRef, useEffect, useState, useMemo } from "react";
import { Redirect, useRouter } from "expo-router";
import type { Href } from "expo-router";

const H = (p: string) => p as unknown as Href;
import { useAuthStore } from "@/stores/authStore";
import { useBootStore } from "@/stores/bootStore";
import { getBootCache } from "@/stores/bootCache";
import { getAuthBootCache, type AuthBootCacheData } from "@/stores/authBootCache";
import { isDemoMode, convex } from "@/hooks/useConvex";
import { skipDemoOnboarding } from "@/config/demo";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { COLORS } from "@/lib/constants";
import { markTiming, markDuration } from "@/utils/startupTiming";
import { decideNextOnboardingRoute } from "@/lib/onboardingRouting";

// Boot action types for pure computation (no side effects in useMemo)
type BootAction =
  | { type: "LOADING" }
  | { type: "FORCE_WELCOME_ONBOARDING_INCOMPLETE"; route: "/(auth)/welcome" }
  | { type: "ROUTE_WELCOME"; route: "/(auth)/welcome" }
  | { type: "ROUTE_ONBOARDING"; route: "/(onboarding)/basic-info" }
  | { type: "ROUTE_HOME"; route: "/(main)/(tabs)/home" };

export default function Index() {
  // We no longer wait for full authStore hydration - use boot caches for fast routing
  const setRouteDecisionMade = useBootStore((s) => s.setRouteDecisionMade);
  const router = useRouter();
  const didRedirect = useRef(false);
  const routeSignaled = useRef(false);
  const didForceWelcome = useRef(false);
  const didForceLogout = useRef(false); // Guard for logout side effect

  // STABILITY FIX: C-1, C-2 - Single navigation guard to prevent double-routing
  const hasNavigatedRef = useRef(false);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // STABILITY FIX: C-1, C-2 - Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear watchdog on unmount
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };
  }, []);

  // STABILITY FIX: C-1, C-2 - Safe navigation helper that prevents double-routing
  const safeReplace = (nextRoute: string, reason: string) => {
    // Guard: only navigate once
    if (hasNavigatedRef.current) {
      if (__DEV__) {
        console.log(`[BOOT] safeReplace BLOCKED (already navigated): ${reason} → ${nextRoute}`);
      }
      return false;
    }
    // Guard: don't navigate if unmounted
    if (!mountedRef.current) {
      if (__DEV__) {
        console.log(`[BOOT] safeReplace BLOCKED (unmounted): ${reason} → ${nextRoute}`);
      }
      return false;
    }

    // Mark as navigated BEFORE calling replace
    hasNavigatedRef.current = true;

    // Clear watchdog timer since we're navigating
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }

    if (__DEV__) {
      console.log(`[BOOT] safeReplace: ${reason} → ${nextRoute}`);
    }

    router.replace(nextRoute as any);
    return true;
  };

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

  // Convex validation state (for live mode with token)
  const [convexValidated, setConvexValidated] = useState(false);
  const [convexOnboardingCompleted, setConvexOnboardingCompleted] = useState(false);
  const convexValidationStarted = useRef(false);

  // Track if we've already started loading (to measure duration once)
  const cacheLoadStarted = useRef(false);

  // STABILITY FIX: C-1 - Watchdog timer to prevent infinite loading
  // If boot hasn't completed after 12s, force a safe navigation
  // Uses watchdogTimerRef and safeReplace to prevent double-routing
  const watchdogFired = useRef(false);
  useEffect(() => {
    const WATCHDOG_TIMEOUT = 12000; // 12 seconds

    // Clear any existing watchdog timer
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
    }

    watchdogTimerRef.current = setTimeout(() => {
      // Check if boot completed (routeSignaled means we made a decision)
      if (routeSignaled.current || watchdogFired.current) return;
      watchdogFired.current = true;

      console.warn('[BOOT_FIX] Watchdog fired after 12s - forcing safe navigation');

      // C1 FIX: Watchdog must NOT route to home based on cached data alone
      // If backend validation didn't complete in 12s, route to welcome as safe fallback
      // User can re-authenticate; this prevents stale/invalid session from reaching home
      console.log('[BOOT_FIX] Watchdog: backend validation timeout → welcome (safe fallback)');
      setConvexValidated(true);
      safeReplace("/(auth)/welcome", "watchdog (validation timeout)");
    }, WATCHDOG_TIMEOUT);

    return () => {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };
  }, [authBootCacheData]);

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

  // CONVEX VALIDATION: Validate token and fetch onboardingCompleted from backend
  // FAST_PATH: If cached onboardingCompleted=true, route immediately and validate in background
  useEffect(() => {
    // Skip if demo mode or no token or already validated
    if (isDemoMode || !authBootCacheData || convexValidationStarted.current) return;

    const token = authBootCacheData.token;
    const userId = authBootCacheData.userId;
    const hasValidToken = typeof token === 'string' && token.trim().length > 0;
    const cachedOnboardingCompleted = authBootCacheData.onboardingCompleted === true;

    if (!hasValidToken || !userId) {
      // No token - skip validation
      setConvexValidated(true);
      return;
    }

    // C1 FIX: Do NOT route immediately based on cached onboardingCompleted
    // Wait for backend validation to confirm session is valid before routing to home
    // This prevents the race where user sees home briefly then gets logged out
    if (cachedOnboardingCompleted && __DEV__) {
      console.log('[AUTH_BOOT] Cached onboardingCompleted=true, waiting for backend validation');
    }

    // Start validation (even if FAST_PATH, validate in background)
    convexValidationStarted.current = true;

    if (__DEV__) {
      console.log('[AUTH_BOOT] Validating session via Convex' + (cachedOnboardingCompleted ? ' (background)' : '') + ', userId:', userId.substring(0, 10) + '...');
    }

    const validateSession = async () => {
      const timeout = 5000; // 5 second timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Validation timeout')), timeout)
      );

      try {
        const statusPromise = convex.query(api.users.getOnboardingStatus, {
          userId: userId as Id<'users'>,
        });

        const status = await Promise.race([statusPromise, timeoutPromise]) as any;

        if (status) {
          const backendOnboardingCompleted = status.onboardingCompleted ?? false;

          if (__DEV__) {
            console.log('[AUTH_BOOT] Validation complete, onboardingCompleted:', backendOnboardingCompleted);
          }

          // STABILITY FIX: C-2 - FAST_PATH validation check: if cached said true but backend says false, clear cache and redirect
          if (cachedOnboardingCompleted && !backendOnboardingCompleted) {
            if (__DEV__) {
              console.warn('[AUTH_BOOT] FAST_PATH validation failed: backend says onboarding incomplete, clearing cache and routing to welcome');
            }
            const { clearAuthBootCache } = require('@/stores/authBootCache');
            await clearAuthBootCache();
            await useAuthStore.getState().logout();
            safeReplace("/(auth)/welcome", "FAST_PATH validation failed");
            return;
          }

          // C1 FIX: Always set both state values after successful backend validation
          // Guard: don't set state if component unmounted
          if (!mountedRef.current) return;
          setConvexOnboardingCompleted(backendOnboardingCompleted);
          setConvexValidated(true);

          // Update authStore with real onboarding status
          useAuthStore.getState().setAuth(userId, token, backendOnboardingCompleted);
        }
      } catch (error) {
        console.error('[AUTH_BOOT] Validation failed:', error);

        // C1 FIX: On network error, set state to trigger ROUTE_WELCOME via existing useEffect
        // (lines 398-405 call safeReplace for all ROUTE_WELCOME cases)
        if (__DEV__) {
          console.warn('[AUTH_BOOT] Validation failed (network) -> will route to welcome');
        }
        // Guard: don't set state if component unmounted
        if (!mountedRef.current) return;
        setConvexValidated(true);
        setConvexOnboardingCompleted(false);
      }
    };

    // STABILITY FIX (2026-03-04): Handle promise rejection to prevent unhandled errors
    validateSession().catch((error) => {
      console.error('[AUTH_BOOT] Unhandled validation error:', error);
      // C1 FIX: On crash, set state to trigger ROUTE_WELCOME
      // Guard: don't set state if component unmounted
      if (!mountedRef.current) return;
      setConvexValidated(true);
      setConvexOnboardingCompleted(false);
    });
  }, [authBootCacheData, router]);

  // For demo mode: use bootCache (fast) for routing
  // For live mode: use authBootCache (fast) for routing
  const currentDemoUserId = bootCacheData?.currentDemoUserId ?? null;
  const demoOnboardingComplete = bootCacheData?.demoOnboardingComplete ?? {};

  // Wait for boot caches only - NOT full store hydration
  // authBootCache: ~10-50ms vs authStore hydration: ~900ms
  // bootCache: ~10-50ms vs demoStore hydration: ~100-200ms
  const bootCachesReady = authBootCacheData && (!isDemoMode || bootCacheData);

  // For live mode with token, also wait for Convex validation
  const hasToken = authBootCacheData?.token && authBootCacheData.token.trim().length > 0;
  const needsConvexValidation = !isDemoMode && hasToken;
  const bootReady = bootCachesReady && (!needsConvexValidation || convexValidated);

  // PURE computation of boot action - NO side effects (logout, setState, etc.)
  // Side effects are handled in useEffect below
  const bootAction: BootAction = useMemo(() => {
    if (!bootReady || !authBootCacheData) {
      return { type: "LOADING" };
    }

    // ── Demo mode: email+password auth with full onboarding ──
    if (isDemoMode) {
      // FAST PATH: Skip onboarding when skipDemoOnboarding is enabled (for testing)
      if (skipDemoOnboarding) {
        if (__DEV__) {
          console.log('[AUTH_BOOT] Demo mode: skipDemoOnboarding=true → Phase-1');
        }
        return { type: "ROUTE_HOME", route: "/(main)/(tabs)/home" };
      }

      if (currentDemoUserId) {
        const onbComplete = !!demoOnboardingComplete[currentDemoUserId];

        if (onbComplete) {
          return { type: "ROUTE_HOME", route: "/(main)/(tabs)/home" };
        }

        // ONBOARDING INCOMPLETE: Always route to welcome on cold start (logout first)
        return { type: "FORCE_WELCOME_ONBOARDING_INCOMPLETE", route: "/(auth)/welcome" };
      }
      return { type: "ROUTE_WELCOME", route: "/(auth)/welcome" };
    }

    // ── Live mode: standard auth flow using authBootCache + Convex validation ──
    const token = authBootCacheData.token;
    const hasValidToken = typeof token === 'string' && token.trim().length > 0;

    if (hasValidToken) {
      // Use Convex-validated onboarding status (source of truth)
      if (convexOnboardingCompleted) {
        if (__DEV__) {
          console.log('[AUTH_BOOT] Route decision: onboarding completed → Phase-1');
        }
        return { type: "ROUTE_HOME", route: "/(main)/(tabs)/home" };
      }

      // ONBOARDING INCOMPLETE: Route directly to onboarding (not welcome/auth)
      // User is authenticated with valid token, just needs to complete onboarding
      // SAFETY: Don't force logout - SessionValidator will handle truly invalid sessions
      if (__DEV__) {
        console.log('[AUTH_BOOT] Route decision: authenticated but onboarding incomplete → onboarding');
      }
      return { type: "ROUTE_ONBOARDING", route: "/(onboarding)/basic-info" };
    }

    // No valid token → show welcome screen
    if (__DEV__) {
      console.log('[AUTH_BOOT] Route decision: no token → welcome');
    }
    return { type: "ROUTE_WELCOME", route: "/(auth)/welcome" };
  }, [bootReady, authBootCacheData, currentDemoUserId, demoOnboardingComplete, convexOnboardingCompleted]);

  // Derive route for use in render (null if loading)
  const routeDestination = bootAction.type === "LOADING" ? null : bootAction.route;

  // STABILITY FIX: C-1, C-2 - SIDE EFFECT: Handle FORCE_WELCOME_ONBOARDING_INCOMPLETE
  // Logout and route to welcome when onboarding is not completed
  // Uses safeReplace to prevent double-routing
  useEffect(() => {
    if (bootAction.type !== "FORCE_WELCOME_ONBOARDING_INCOMPLETE") return;
    if (didForceLogout.current) return; // Guard: only run once
    didForceLogout.current = true;

    if (__DEV__) console.log('[ONB] boot_decision action=FORCE_WELCOME_ONBOARDING_INCOMPLETE → logout + welcome');
    // CRASH FIX: Await async logout before navigation to prevent race condition
    (async () => {
      await useAuthStore.getState().logout();
      safeReplace("/(auth)/welcome", "FORCE_WELCOME_ONBOARDING_INCOMPLETE");
    })();
  }, [bootAction]);

  // Side effects: signal route decision, restore demo auth, mark timing
  // This runs in the commit phase AFTER render, avoiding setState-during-render
  useEffect(() => {
    if (!routeDestination || routeSignaled.current) return;
    routeSignaled.current = true;

    // Log boot decision for debugging
    if (__DEV__) {
      const onbComplete = convexOnboardingCompleted;
      const token2 = authBootCacheData?.token;
      const hasToken = typeof token2 === 'string' && token2.trim().length > 0;
      console.log(`[ONB] boot_decision onboardingCompleted=${onbComplete} hasToken=${hasToken} action=${bootAction.type}`);
      console.log(`[ONB] route_decision routeDestination=${routeDestination}`);
    }

    // Mark timing: boot caches are ready and route computed
    markTiming('boot_caches_ready');

    // Restore demo auth session if needed (covers app restart)
    // Skip if we're forcing logout (onboarding not completed)
    if (isDemoMode && currentDemoUserId && !useAuthStore.getState().isAuthenticated && bootAction.type !== "FORCE_WELCOME_ONBOARDING_INCOMPLETE") {
      const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
      useAuthStore.getState().setAuth(currentDemoUserId, 'demo_token', onbComplete);
    }

    // Signal to BootScreen that routing decision has been made
    setRouteDecisionMade(true);

    // Milestone D: route decision made
    markTiming('route_decision');
  }, [routeDestination, setRouteDecisionMade, currentDemoUserId, demoOnboardingComplete, bootAction, authBootCacheData]);

  // STABILITY FIX: C-1, C-2 - IMPERATIVE NAVIGATION for unauthenticated users → welcome screen
  // Uses safeReplace to OVERRIDE any restored navigation state from Expo Go
  // and to prevent double-routing
  // Skip if FORCE_WELCOME_ONBOARDING_INCOMPLETE already handled navigation
  useEffect(() => {
    if (!routeDestination || didForceWelcome.current) return;
    if (bootAction.type === "FORCE_WELCOME_ONBOARDING_INCOMPLETE") return; // Already handled above

    if (routeDestination === "/(auth)/welcome") {
      didForceWelcome.current = true;
      safeReplace("/(auth)/welcome", "imperative welcome");
    }

    // IMPERATIVE NAVIGATION for authenticated users with incomplete onboarding → onboarding
    if (routeDestination === "/(onboarding)/basic-info") {
      didForceWelcome.current = true; // Reuse guard to prevent double-navigation
      safeReplace("/(onboarding)/basic-info", "imperative onboarding");
    }
  }, [routeDestination, bootAction]);

  // Loading state: boot caches not yet ready
  if (!routeDestination) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // FORCE_WELCOME_ONBOARDING_INCOMPLETE: useEffect handles logout + navigation, render nothing
  if (bootAction.type === "FORCE_WELCOME_ONBOARDING_INCOMPLETE") {
    return null;
  }

  // For unauthenticated → welcome: imperative navigation handles it, return null
  if (routeDestination === "/(auth)/welcome") {
    return null;
  }

  // For authenticated but incomplete → onboarding: imperative navigation handles it, return null
  if (routeDestination === "/(onboarding)/basic-info") {
    return null;
  }

  // Guard: render <Redirect> exactly once for authenticated users.
  // After the first render that returns <Redirect>, all subsequent renders return null.
  // This prevents the focus-loop caused by expo-router's <Redirect> internally using
  // useFocusEffect with a new inline callback on every render.
  // E5: Also check hasNavigatedRef to prevent double-navigation if safeReplace already ran
  // (e.g., watchdog timer fired before Redirect rendered)
  if (didRedirect.current || hasNavigatedRef.current) {
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
