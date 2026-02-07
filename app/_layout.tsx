import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { ConvexProvider, useMutation, useQuery } from "convex/react";
import { convex, isDemoMode } from "@/hooks/useConvex";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useDemoStore } from "@/stores/demoStore";
import { collectDeviceFingerprint } from "@/lib/deviceFingerprint";

function DemoBanner() {
  return null;
}

/**
 * 3A1-1: Validate session on app resume
 * When app returns from background, validates the session token.
 * If invalid/expired, forces logout and navigates to login.
 */
function SessionValidator() {
  const router = useRouter();
  const segments = useSegments();
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isValidatingRef = useRef(false);

  // Use Convex query to validate session (skip if demo mode or no token)
  const sessionStatus = useQuery(
    api.auth.validateSession,
    !isDemoMode && token ? { token } : 'skip'
  );

  // Handle invalid session from query result
  useEffect(() => {
    if (isDemoMode || !token) return;
    if (sessionStatus === undefined) return; // Still loading

    if (sessionStatus && !sessionStatus.valid) {
      console.warn('[SessionValidator] Session invalid/expired — forcing logout');
      // Clear all local state
      logout();
      useOnboardingStore.getState().reset();
      if (isDemoMode) {
        useDemoStore.getState().demoLogout();
      }
      // Navigate to login (only if currently in main/protected area)
      const inProtectedRoute = segments[0] === '(main)';
      if (inProtectedRoute) {
        router.replace('/(auth)/welcome');
      }
    }
  }, [sessionStatus, token, logout, router, segments]);

  // Validate on app resume
  useEffect(() => {
    if (isDemoMode) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // If app was in background and is now active
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        token &&
        !isValidatingRef.current
      ) {
        // The query will automatically re-fetch when app becomes active
        // due to Convex's reactivity, but we can force a check here
        isValidatingRef.current = true;
        // Reset validation flag after a short delay
        setTimeout(() => {
          isValidatingRef.current = false;
        }, 2000);
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [token]);

  return null;
}

function DeviceFingerprintCollector() {
  const userId = useAuthStore((s) => s.userId);
  const registerFingerprint = useMutation(api.deviceFingerprint.registerDeviceFingerprint);

  useEffect(() => {
    if (isDemoMode || !userId) return;

    (async () => {
      try {
        const data = await collectDeviceFingerprint();
        await registerFingerprint({
          userId: userId as any,
          ...data,
        });
      } catch {
        // Silent failure — fingerprinting is non-critical
      }
    })();
  }, [userId]);

  return null;
}

export default function RootLayout() {
  // Permissions are NOT requested here. Each screen that needs camera,
  // microphone, or media library access requests permission at point of
  // use (e.g. AttachmentPopup, camera-composer, photo-upload).
  // Requesting at launch violates App Store guidelines and causes users
  // to deny permissions before they understand why they're needed.

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ConvexProvider client={convex}>
          <StatusBar style="light" />
          <DemoBanner />
          <SessionValidator />
          <DeviceFingerprintCollector />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="demo-profile" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(main)" options={{ gestureEnabled: false }} />
          </Stack>
        </ConvexProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

