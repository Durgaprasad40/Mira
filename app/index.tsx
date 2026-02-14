import { useRef, useEffect, useState, useMemo } from "react";
import { Redirect } from "expo-router";
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

export default function Index() {
  // We no longer wait for full authStore hydration - use boot caches for fast routing
  const setRouteDecisionMade = useBootStore((s) => s.setRouteDecisionMade);
  const didRedirect = useRef(false);
  const routeSignaled = useRef(false);

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

  // Compute route destination (pure computation, no side effects)
  const routeDestination = useMemo(() => {
    if (!bootCachesReady || !authBootCacheData) return null;

    // ── Demo mode: email+password auth with full onboarding ──
    if (isDemoMode) {
      if (currentDemoUserId) {
        const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
        if (__DEV__) console.log(`[DemoGate] userId=${currentDemoUserId} onboarding_complete=${onbComplete}`);
        return onbComplete ? "/(main)/(tabs)/home" : "/(onboarding)";
      }
      if (__DEV__) console.log('[DemoGate] no userId → welcome');
      return "/(auth)/welcome";
    }

    // ── Live mode: standard auth flow using authBootCache ──
    if (authBootCacheData.isAuthenticated) {
      return authBootCacheData.onboardingCompleted
        ? "/(main)/(tabs)/home"
        : "/(onboarding)";
    }

    return "/(auth)/welcome";
  }, [bootCachesReady, authBootCacheData, currentDemoUserId, demoOnboardingComplete]);

  // Side effects: signal route decision, restore demo auth, mark timing
  // This runs in the commit phase AFTER render, avoiding setState-during-render
  useEffect(() => {
    if (!routeDestination || routeSignaled.current) return;
    routeSignaled.current = true;

    // Mark timing: boot caches are ready and route computed
    markTiming('boot_caches_ready');

    // Restore demo auth session if needed (covers app restart)
    if (isDemoMode && currentDemoUserId && !useAuthStore.getState().isAuthenticated) {
      const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
      useAuthStore.getState().setAuth(currentDemoUserId, 'demo_token', onbComplete);
    }

    // Signal to BootScreen that routing decision has been made
    setRouteDecisionMade(true);

    // Milestone D: route decision made
    markTiming('route_decision');
  }, [routeDestination, setRouteDecisionMade, currentDemoUserId, demoOnboardingComplete]);

  // Loading state: boot caches not yet ready
  if (!routeDestination) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Guard: render <Redirect> exactly once. After the first render that
  // returns <Redirect>, all subsequent renders return null. This prevents
  // the focus-loop caused by expo-router's <Redirect> internally using
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
