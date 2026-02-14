import { useRef, useEffect, useState } from "react";
import { Redirect } from "expo-router";
import type { Href } from "expo-router";

const H = (p: string) => p as unknown as Href;
import { useAuthStore } from "@/stores/authStore";
import { useBootStore } from "@/stores/bootStore";
import { getBootCache } from "@/stores/bootCache";
import { isDemoMode } from "@/hooks/useConvex";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { COLORS } from "@/lib/constants";
import { markTiming } from "@/utils/startupTiming";

export default function Index() {
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const setRouteDecisionMade = useBootStore((s) => s.setRouteDecisionMade);
  const didRedirect = useRef(false);

  // FAST PATH for demo mode: use bootCache instead of waiting for full demoStore hydration
  // bootCache reads only ~100 bytes (userId + onboarding flags) vs ~50KB+ for full store
  const [bootCacheData, setBootCacheData] = useState<{
    currentDemoUserId: string | null;
    demoOnboardingComplete: Record<string, boolean>;
  } | null>(null);

  useEffect(() => {
    if (isDemoMode && !bootCacheData) {
      getBootCache().then(setBootCacheData);
    }
  }, [bootCacheData]);

  // For demo mode: use bootCache (fast) for routing
  // For live mode: use authStore only (no demo data needed)
  const currentDemoUserId = bootCacheData?.currentDemoUserId ?? null;
  const demoOnboardingComplete = bootCacheData?.demoOnboardingComplete ?? {};

  // Wait for auth hydration always, and bootCache in demo mode
  // This is MUCH faster than waiting for full demoStore hydration
  if (!authHydrated || (isDemoMode && !bootCacheData)) {
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
      if (!isAuthenticated) {
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

  // ── Live mode: standard auth flow ──
  if (isAuthenticated) {
    if (onboardingCompleted) {
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
