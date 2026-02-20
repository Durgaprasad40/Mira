import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, LogBox } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";

// Suppress known dev-mode warning: Expo's withDevTools calls useKeepAwake() which can fail
// on Android before activity is ready. This is non-critical (screen may sleep during dev).
if (__DEV__) {
  LogBox.ignoreLogs(["Unable to activate keep awake"]);
}
import { ConvexProvider, useMutation, useQuery } from "convex/react";
import { convex, isDemoMode } from "@/hooks/useConvex";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useDemoStore } from "@/stores/demoStore";
import { useBootStore } from "@/stores/bootStore";
import { BootScreen } from "@/components/BootScreen";
import { collectDeviceFingerprint } from "@/lib/deviceFingerprint";
import { markTiming } from "@/utils/startupTiming";

function DemoBanner() {
  return null;
}

/**
 * BootStateTracker - Syncs hydration states to bootStore
 *
 * SAFETY:
 * - READ-ONLY: Only reads from authStore/demoStore, writes to bootStore
 * - Does NOT modify any user data, auth state, or messages
 * - Does NOT affect onboarding completion status
 */
function BootStateTracker() {
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const setAuthHydrated = useBootStore((s) => s.setAuthHydrated);
  const setDemoHydrated = useBootStore((s) => s.setDemoHydrated);

  // Sync auth hydration state
  useEffect(() => {
    setAuthHydrated(authHydrated);
  }, [authHydrated, setAuthHydrated]);

  // Sync demo hydration state (or mark as ready if not in demo mode)
  useEffect(() => {
    // In live mode, demo hydration is always "ready"
    // In demo mode, wait for actual hydration
    const ready = isDemoMode ? demoHydrated : true;
    setDemoHydrated(ready);
  }, [demoHydrated, setDemoHydrated]);

  return null;
}

/**
 * BootScreenWrapper - Shows boot screen until app is ready
 *
 * FAST BOOT STRATEGY:
 * - Hide BootScreen after 250ms from app start (module load time)
 * - Does NOT wait for hydration - Index.tsx handles that with inline loading
 * - Module-level timestamp ensures consistent timing across re-renders
 *
 * SAFETY:
 * - Does NOT modify any user data, auth state, or messages
 * - Pure UI gating only
 */
const BOOT_MIN_TIME_MS = 250;

// Module-level timestamp: captured when this file loads (same as bundle start)
const BOOT_START_TIME = Date.now();

// Module-level flag to prevent double-marking
let _hasMarkedBootHidden = false;

function BootScreenWrapper() {
  const routeDecisionMade = useBootStore((s) => s.routeDecisionMade);
  const reset = useBootStore((s) => s.reset);
  const [, forceUpdate] = useState(0);
  const timerStarted = useRef(false);

  // Calculate elapsed time from module load (not component mount)
  const elapsedMs = Date.now() - BOOT_START_TIME;
  const minTimeElapsed = elapsedMs >= BOOT_MIN_TIME_MS;

  // Start a timer to trigger re-render when 250ms elapses (if not already elapsed)
  useEffect(() => {
    if (minTimeElapsed || timerStarted.current) return;
    timerStarted.current = true;

    const remainingMs = BOOT_MIN_TIME_MS - elapsedMs;
    const timer = setTimeout(() => {
      forceUpdate((n) => n + 1); // Trigger re-render to check elapsed time
    }, Math.max(0, remainingMs));

    return () => clearTimeout(timer);
  }, [minTimeElapsed, elapsedMs]);

  // Hide when: minimum time passed OR route decision made (whichever comes first)
  const isReady = minTimeElapsed || routeDecisionMade;

  // Mark boot_hidden timing milestone once (module-level guard)
  if (isReady && !_hasMarkedBootHidden) {
    _hasMarkedBootHidden = true;
    markTiming('boot_hidden');
  }

  const handleRetry = () => {
    reset();
  };

  return <BootScreen isReady={isReady} onRetry={handleRetry} />;
}

/**
 * 3A1-1: Validate session on app launch AND resume
 *
 * HYDRATION FLOW:
 * 1. On mount: Validate session token against server
 * 2. On app resume: Re-validate session
 * 3. If invalid: Clear LOCAL token only, navigate to login
 * 4. If valid: Sync onboarding state from server (READ-ONLY)
 *
 * SAFETY:
 * - Uses validateSessionFull for detailed error reasons
 * - NEVER modifies server data
 * - NEVER resets onboarding (syncs FROM server, never overwrites)
 * - logout() clears LOCAL state only
 */
function SessionValidator() {
  const router = useRouter();
  const segments = useSegments();
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const syncFromServerValidation = useAuthStore((s) => s.syncFromServerValidation);
  const setSessionValidated = useAuthStore((s) => s.setSessionValidated);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isValidatingRef = useRef(false);
  const hasInitialValidation = useRef(false);

  // Use Convex query to validate session with FULL checks
  // validateSessionFull checks: expiry, revocation, user status, deletedAt
  const sessionStatus = useQuery(
    api.auth.validateSessionFull,
    !isDemoMode && token ? { token } : 'skip'
  );

  // Handle session validation result
  useEffect(() => {
    if (isDemoMode || !token) {
      // No token = mark as validated (nothing to validate)
      if (!token) {
        setSessionValidated(true);
      }
      return;
    }
    if (sessionStatus === undefined) return; // Still loading

    // Mark validation as complete
    hasInitialValidation.current = true;

    if (sessionStatus.valid) {
      // Session is valid — sync onboarding state from server
      // SAFETY: This only updates LOCAL state, never modifies server
      if (sessionStatus.userInfo) {
        syncFromServerValidation({
          onboardingCompleted: sessionStatus.userInfo.onboardingCompleted,
          isVerified: sessionStatus.userInfo.isVerified,
          name: sessionStatus.userInfo.name,
        });
      }
      setSessionValidated(true);
    } else {
      // Session is invalid — clear LOCAL token only
      console.warn(`[SessionValidator] Session invalid: ${sessionStatus.reason}`);

      // Clear all LOCAL state (server data untouched)
      logout();
      useOnboardingStore.getState().reset();
      if (isDemoMode) {
        useDemoStore.getState().demoLogout();
      }

      setSessionValidated(false, sessionStatus.reason);

      // Navigate to login (only if currently in main/protected area)
      const inProtectedRoute = segments[0] === '(main)';
      if (inProtectedRoute) {
        router.replace('/(auth)/welcome');
      }
    }
  }, [sessionStatus, token, logout, syncFromServerValidation, setSessionValidated, router, segments]);

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
        // due to Convex's reactivity
        isValidatingRef.current = true;
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
  // Milestone A: RootLayout first render
  markTiming('root_layout');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ConvexProvider client={convex}>
          <StatusBar style="light" />
          <DemoBanner />
          <BootStateTracker />
          <BootScreenWrapper />
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
