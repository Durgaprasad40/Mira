import { useRef, useEffect, useState } from "react";
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
import { markTiming } from "@/utils/startupTiming";

export default function Index() {
  // We no longer wait for full authStore hydration - use boot caches for fast routing
  const setRouteDecisionMade = useBootStore((s) => s.setRouteDecisionMade);
  const didRedirect = useRef(false);

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

  useEffect(() => {
    // Load auth boot cache (always needed for live mode, also useful in demo)
    if (!authBootCacheData) {
      getAuthBootCache().then(setAuthBootCacheData);
    }
    // Load demo boot cache only in demo mode
    if (isDemoMode && !bootCacheData) {
      getBootCache().then(setBootCacheData);
    }
  }, [authBootCacheData, bootCacheData]);

  // For demo mode: use bootCache (fast) for routing
  // For live mode: use authBootCache (fast) for routing
  const currentDemoUserId = bootCacheData?.currentDemoUserId ?? null;
  const demoOnboardingComplete = bootCacheData?.demoOnboardingComplete ?? {};

  // Wait for boot caches only - NOT full store hydration
  // authBootCache: ~10-50ms vs authStore hydration: ~900ms
  // bootCache: ~10-50ms vs demoStore hydration: ~100-200ms
  const bootCachesReady = authBootCacheData && (!isDemoMode || bootCacheData);

  // Mark timing when boot caches are ready (much faster than full hydration)
  useEffect(() => {
    if (bootCachesReady) {
      markTiming('boot_caches_ready');
    }
  }, [bootCachesReady]);

  if (!bootCachesReady) {
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

  // Signal to BootScreen that routing decision has been made
  // This allows the boot screen to hide
  setRouteDecisionMade(true);

  // Milestone D: route decision made
  markTiming('route_decision');

  // ── Demo mode: email+password auth with full onboarding ──
  if (isDemoMode) {
    if (currentDemoUserId) {
      // Restore auth session if needed (covers app restart)
      // Use getState() for one-time sync check (not subscribing to store)
      if (!useAuthStore.getState().isAuthenticated) {
        const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
        useAuthStore.getState().setAuth(currentDemoUserId, 'demo_token', onbComplete);
      }
      const onbComplete = !!demoOnboardingComplete[currentDemoUserId];
      if (__DEV__) console.log(`[DemoGate] userId=${currentDemoUserId} onboarding_complete=${onbComplete}`);
      if (onbComplete) {
        return <Redirect href={H("/(main)/(tabs)/home")} />;
      }
      return <Redirect href={H("/(onboarding)")} />;
    }
    if (__DEV__) console.log('[DemoGate] no userId → welcome');
    return <Redirect href={H("/(auth)/welcome")} />;
  }

  // ── Live mode: standard auth flow using authBootCache ──
  if (authBootCacheData.isAuthenticated) {
    if (authBootCacheData.onboardingCompleted) {
      return <Redirect href={H("/(main)/(tabs)/home")} />;
    }
    return <Redirect href={H("/(onboarding)")} />;
  }

  return <Redirect href={H("/(auth)/welcome")} />;
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
