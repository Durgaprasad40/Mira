import { useRef } from "react";
import { Redirect } from "expo-router";
import type { Href } from "expo-router";

const H = (p: string) => p as unknown as Href;
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { isDemoMode } from "@/hooks/useConvex";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { COLORS } from "@/lib/constants";

export default function Index() {
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoOnboardingComplete = useDemoStore((s) => s.demoOnboardingComplete);
  const didRedirect = useRef(false);

  // Wait for BOTH stores to hydrate before deciding destination.
  // Without this, demoUserProfile reads as null before AsyncStorage restores it,
  // causing a false redirect to /demo-profile (perceived as "asks login again").
  if (!authHydrated || (isDemoMode && !demoHydrated)) {
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
