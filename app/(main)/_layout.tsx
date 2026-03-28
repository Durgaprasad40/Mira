import React, { useEffect, useRef, useCallback, Component, ReactNode } from "react";
import { View } from "react-native";
import { Stack, useRootNavigationState, useRouter, useSegments, router as globalRouter } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { computeEnforcementLevel } from "@/lib/securityEnforcement";
import { ToastHost } from "@/components/ui/Toast";
import { useRouteTrace, trace } from "@/lib/devTrace";

// H-3: Session invalidation detection (NARROWED - does NOT match resource-level auth errors)
// Only triggers logout for TRUE session invalidation, not room/resource access denials
// Examples that SHOULD trigger logout: "token expired", "session expired", "invalid session"
// Examples that should NOT: "Unauthorized: authentication required", "Access denied", "banned"
function isSessionInvalidationError(msg: string): boolean {
  if (!msg) return false;
  const l = msg.toLowerCase();
  // Only match explicit session/token invalidation phrases
  // DO NOT match generic "unauthorized" or "unauthenticated" - those come from resource access denials
  return l.includes('token expired') ||
         l.includes('session expired') ||
         l.includes('invalid token') ||
         l.includes('session invalid') ||
         l.includes('session has expired') ||
         l.includes('token has expired') ||
         l.includes('auth token invalid');
}

// H-3: Session Invalidation Error Boundary - logout ONLY on true session expiry
// E3: Navigation is deferred to avoid sync navigation during lifecycle
// SECURITY FIX: Does NOT trigger logout for resource-level auth errors (room access denied, etc.)
class AuthErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; didNavigate: boolean }> {
  state = { error: null as Error | null, didNavigate: false };
  private navTimeoutId: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // SECURITY FIX: Only logout for true session invalidation (token/session expired)
    // Resource-level errors ("Access denied", "Unauthorized: authentication required") are NOT handled here
    // Those should be handled locally by the screen that threw them
    if (isSessionInvalidationError(error?.message || '')) {
      // E3: Defer navigation to next tick to avoid sync navigation during lifecycle
      // Guard against double navigation with didNavigate state
      if (this.state.didNavigate) return;
      this.setState({ didNavigate: true });
      if (__DEV__) console.log('[AuthErrorBoundary] Session invalidation detected, logging out:', error?.message);
      // H5 FIX: Wrap in async IIFE to await logout before navigation
      (async () => {
        await useAuthStore.getState().logout();
        this.navTimeoutId = setTimeout(() => {
          globalRouter.replace('/(auth)/welcome');
        }, 0);
      })();
    }
  }

  componentWillUnmount() {
    // E3: Cleanup deferred navigation timeout
    if (this.navTimeoutId) {
      clearTimeout(this.navTimeoutId);
      this.navTimeoutId = null;
    }
  }

  render() {
    if (this.state.error) {
      if (isSessionInvalidationError(this.state.error.message || '')) {
        return null;
      }
      // SECURITY FIX: Re-throw non-session errors so they propagate to the screen
      // This allows screens to handle their own access-denied errors
      throw this.state.error;
    }
    return this.props.children;
  }
}

export default function MainLayout() {
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const didRedirect = useRef(false);

  // ── Navigation hooks ──
  // useRouter() returns a new object on every navigation state change.
  // Store it in a ref so the verification effect doesn't re-run from
  // router identity changes alone.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // These subscribe to navigation state → re-render MainLayout on every
  // nav event. segmentsKey is derived as a stable string for the effect.
  const segments = useSegments();
  const rootNavState = useRootNavigationState();

  // ── ROUTE ISOLATION FIX ──
  // Phase-2 routes are handled by their own layout trace (P2_PRIVATE).
  // The main layout should NOT emit P1_MAIN for Phase-2 routes.
  const isPhase2Route = segments.includes('(private)' as never) || segments.includes('(private-setup)' as never);

  // DEV-only route change logging - SKIP for Phase-2 routes
  useRouteTrace(isPhase2Route ? "P2_SKIP" : "P1_MAIN", useCallback(() => {
    // Log route isolation confirmation for Phase-2 routes
    if (isPhase2Route && __DEV__) {
      trace("P2_ROUTE_ISOLATION_OK", { pathname: segments.join('/') });
    }
    return {
      userId: userId?.substring(0, 8) ?? null,
      hasToken: !!token,
      onboardingCompleted: !!onboardingCompleted,
      isDemoMode,
    };
  }, [userId, token, onboardingCompleted, isPhase2Route, segments]));

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : "skip"
  );

  // Security gate — guarded one-shot redirect.
  const needsVerification = !isDemoMode && currentUser && (() => {
    const level =
      currentUser.verificationEnforcementLevel ||
      computeEnforcementLevel({
        createdAt: currentUser.createdAt,
        verificationStatus:
          (currentUser.verificationStatus as any) || "unverified",
      });
    return level === "security_only";
  })();

  const segmentsKey = segments.join("/");

  useEffect(() => {
    if (didRedirect.current) return;
    if (isDemoMode) return;
    if (!rootNavState?.key) return;
    if (!needsVerification) return;

    if (segmentsKey.includes("(main)/verification")) {
      didRedirect.current = true;
      return;
    }

    didRedirect.current = true;
    routerRef.current.replace("/(main)/verification" as any);
  }, [needsVerification, rootNavState?.key, segmentsKey]);

  return (
    <AuthErrorBoundary>
    <View style={{ flex: 1 }}>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="match-celebration"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="boost" options={{ presentation: "modal" }} />
      <Stack.Screen name="crossed-paths" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="likes" />
      <Stack.Screen name="notifications" />
      <Stack.Screen
        name="pre-match-message"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="profile/[id]" />
      <Stack.Screen name="private-profile/[userId]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="subscription" options={{ presentation: "modal" }} />
      <Stack.Screen
        name="incognito-create-tod"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="prompt-thread" />
      <Stack.Screen name="confession-thread" />
      <Stack.Screen
        name="compose-confession"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="confession-chat"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="person-picker"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen
        name="stand-out"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="explore-category/[categoryId]" />
      <Stack.Screen
        name="camera-composer"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="incognito-chat" />
      <Stack.Screen name="incognito-room/[id]" />
      <Stack.Screen name="(private)" options={{ headerShown: false }} />
      <Stack.Screen
        name="(private-setup)"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="verification"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="demo-panel" options={{ presentation: "modal" }} />
    </Stack>
    <ToastHost />
    </View>
    </AuthErrorBoundary>
  );
}
