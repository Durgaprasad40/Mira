import { useRef, useEffect, useState, useMemo } from "react";
import { Redirect, useRouter } from "expo-router";
import type { Href } from "expo-router";

const H = (p: string) => p as unknown as Href;
import { useAuthStore } from "@/stores/authStore";
import { useBootStore } from "@/stores/bootStore";
import { getBootCache } from "@/stores/bootCache";
import { getAuthBootCache, type AuthBootCacheData } from "@/stores/authBootCache";
import { isDemoMode, convex } from "@/hooks/useConvex";
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

  // Convex validation state (for live mode with token)
  const [convexValidated, setConvexValidated] = useState(false);
  const [convexOnboardingCompleted, setConvexOnboardingCompleted] = useState(false);
  const convexValidationStarted = useRef(false);

  // Track if we've already started loading (to measure duration once)
  const cacheLoadStarted = useRef(false);

  // [BOOT_FIX] Watchdog timer to prevent infinite loading
  // If boot hasn't completed after 12s, force a safe navigation
  const watchdogFired = useRef(false);
  useEffect(() => {
    const WATCHDOG_TIMEOUT = 12000; // 12 seconds

    const watchdogTimer = setTimeout(() => {
      // Check if boot completed (routeSignaled means we made a decision)
      if (routeSignaled.current || watchdogFired.current) return;
      watchdogFired.current = true;

      console.warn('[BOOT_FIX] Watchdog fired after 12s - forcing safe navigation');

      // Check cached data to decide where to route
      const cachedOnboarding = authBootCacheData?.onboardingCompleted === true;
      const hasToken = authBootCacheData?.token && authBootCacheData.token.trim().length > 0;

      if (hasToken && cachedOnboarding) {
        console.log('[BOOT_FIX] Watchdog: token + cached onboarding=true → home');
        setConvexValidated(true);
        setConvexOnboardingCompleted(true);
        router.replace("/(main)/(tabs)/home");
      } else {
        console.log('[BOOT_FIX] Watchdog: no valid session → welcome');
        setConvexValidated(true);
        router.replace("/(auth)/welcome");
      }
    }, WATCHDOG_TIMEOUT);

    return () => clearTimeout(watchdogTimer);
  }, [authBootCacheData, router]);

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

    // STABILITY FIX (2026-03-05): FAST_PATH - route immediately, validate in background
    // If cached onboardingCompleted=true, route to home IMMEDIATELY (no loading spinner)
    // Validation runs in background - if it fails, user stays on home (will retry next boot)
    // This prevents infinite loading if validation hangs or times out
    if (cachedOnboardingCompleted) {
      if (__DEV__) {
        console.log('[AUTH_BOOT] FAST_PATH: cached onboardingCompleted=true, routing immediately');
      }
      setConvexOnboardingCompleted(true);
      setConvexValidated(true); // [BOOT_FIX] Unblock boot immediately for FAST_PATH
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

          // FAST_PATH validation check: if cached said true but backend says false, clear cache and redirect
          if (cachedOnboardingCompleted && !backendOnboardingCompleted) {
            if (__DEV__) {
              console.warn('[AUTH_BOOT] FAST_PATH validation failed: backend says onboarding incomplete, clearing cache and routing to welcome');
            }
            const { clearAuthBootCache } = require('@/stores/authBootCache');
            await clearAuthBootCache();
            useAuthStore.getState().logout();
            router.replace("/(auth)/welcome");
            return;
          }

          // Update state with validated data
          setConvexOnboardingCompleted(backendOnboardingCompleted);
          if (!cachedOnboardingCompleted) {
            // Only update validation state if not FAST_PATH (FAST_PATH already set it)
            setConvexValidated(true);
          }

          // Update authStore with real onboarding status
          useAuthStore.getState().setAuth(userId, token, backendOnboardingCompleted);
        }
      } catch (error) {
        console.error('[AUTH_BOOT] Validation failed:', error);

        // FAST_PATH validation failure: keep cached session (network error, will retry next boot)
        if (cachedOnboardingCompleted) {
          if (__DEV__) {
            console.warn('[AUTH_BOOT] FAST_PATH validation failed (network) -> keeping cached session, will retry next boot');
          }
          // Keep user on home, keep SecureStore values, don't redirect
          return;
        }

        // Non-FAST_PATH: allow boot but treat as not completed
        setConvexValidated(true);
        setConvexOnboardingCompleted(false);

        if (__DEV__) {
          console.warn('[AUTH_BOOT] Validation failed, falling back to welcome (user can retry)');
        }
      }
    };

    // STABILITY FIX (2026-03-04): Handle promise rejection to prevent unhandled errors
    validateSession().catch((error) => {
      console.error('[AUTH_BOOT] Unhandled validation error:', error);
      // Fail-safe: if validation crashes, treat as validation complete but incomplete onboarding
      if (!cachedOnboardingCompleted) {
        setConvexValidated(true);
        setConvexOnboardingCompleted(false);
      }
      // If FAST_PATH (cachedOnboardingCompleted=true), user already routed to home
      // Keep them there, error is logged, will retry next boot
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

      // ONBOARDING INCOMPLETE: Route to welcome to continue onboarding
      // SAFETY: Don't force logout - SessionValidator will handle truly invalid sessions
      // Forcing logout here would clear photos and break onboarding progress
      if (__DEV__) {
        console.log('[AUTH_BOOT] Route decision: onboarding incomplete → welcome');
      }
      return { type: "ROUTE_WELCOME", route: "/(auth)/welcome" };
    }

    // No valid token → show welcome screen
    if (__DEV__) {
      console.log('[AUTH_BOOT] Route decision: no token → welcome');
    }
    return { type: "ROUTE_WELCOME", route: "/(auth)/welcome" };
  }, [bootReady, authBootCacheData, currentDemoUserId, demoOnboardingComplete, convexOnboardingCompleted]);

  // Derive route for use in render (null if loading)
  const routeDestination = bootAction.type === "LOADING" ? null : bootAction.route;

  // SIDE EFFECT: Handle FORCE_WELCOME_ONBOARDING_INCOMPLETE
  // Logout and route to welcome when onboarding is not completed
  useEffect(() => {
    if (bootAction.type !== "FORCE_WELCOME_ONBOARDING_INCOMPLETE") return;
    if (didForceLogout.current) return; // Guard: only run once
    didForceLogout.current = true;

    if (__DEV__) console.log('[ONB] boot_decision action=FORCE_WELCOME_ONBOARDING_INCOMPLETE → logout + welcome');
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
      const token2 = authBootCacheData?.token;
      const hasToken = typeof token2 === 'string' && token2.trim().length > 0;
      console.log(`[ONB] boot_decision facePassed=${facePassed} onboardingCompleted=${onbComplete} hasToken=${hasToken} action=${bootAction.type}`);
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

  // IMPERATIVE NAVIGATION for unauthenticated users → welcome screen
  // Uses router.replace() to OVERRIDE any restored navigation state from Expo Go
  // Skip if FORCE_WELCOME_ONBOARDING_INCOMPLETE already handled navigation
  useEffect(() => {
    if (!routeDestination || didForceWelcome.current) return;
    if (bootAction.type === "FORCE_WELCOME_ONBOARDING_INCOMPLETE") return; // Already handled above

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

  // FORCE_WELCOME_ONBOARDING_INCOMPLETE: useEffect handles logout + navigation, render nothing
  if (bootAction.type === "FORCE_WELCOME_ONBOARDING_INCOMPLETE") {
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
