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
  const _hasHydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const demoUserProfile = useDemoStore((s) => s.demoUserProfile);
  const didRedirect = useRef(false);

  // Wait for Zustand hydration before deciding destination
  if (!_hasHydrated) {
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

  // ── Demo mode: skip all auth, check if profile exists ──
  if (isDemoMode) {
    const profileExists = !!demoUserProfile;
    if (__DEV__) console.log(`[DemoGate] mode=demo profile_exists=${profileExists}`);

    if (profileExists) {
      // Ensure auth is set (covers app restart where authStore may have been cleared)
      if (!isAuthenticated) {
        useAuthStore.getState().setAuth('demo_user_1', 'demo_token', true);
      }
      if (__DEV__) console.log('[DemoGate] redirect_to=main');
      return <Redirect href={H("/(main)/(tabs)/home")} />;
    }
    if (__DEV__) console.log('[DemoGate] redirect_to=profile_create');
    return <Redirect href={H("/demo-profile")} />;
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
