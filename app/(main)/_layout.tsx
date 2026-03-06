import React, { useEffect, useRef, useCallback, Component, ReactNode } from "react";
import { View } from "react-native";
import { Stack, useRootNavigationState, useRouter, useSegments, router as globalRouter } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { computeEnforcementLevel } from "@/lib/securityEnforcement";
import { ToastHost } from "@/components/ui/Toast";
import { useRouteTrace } from "@/lib/devTrace";

// H-3: Minimal auth error detection
function isAuthError(msg: string): boolean {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return l.includes('unauthenticated') || l.includes('unauthorized') ||
         l.includes('token expired') || l.includes('session expired');
}

// H-3: Auth Error Boundary - redirect on auth errors, rethrow others
// E3: Navigation is deferred to avoid sync navigation during lifecycle
class AuthErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; didNavigate: boolean }> {
  state = { error: null as Error | null, didNavigate: false };
  private navTimeoutId: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isAuthError(error?.message || '')) {
      // E3: Defer navigation to next tick to avoid sync navigation during lifecycle
      // Guard against double navigation with didNavigate state
      if (this.state.didNavigate) return;
      this.setState({ didNavigate: true });
      useAuthStore.getState().logout();
      this.navTimeoutId = setTimeout(() => {
        globalRouter.replace('/(auth)/welcome');
      }, 0);
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
      if (isAuthError(this.state.error.message || '')) {
        return null;
      }
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

  // DEV-only route change logging
  useRouteTrace("P1_MAIN", useCallback(() => ({
    userId: userId?.substring(0, 8) ?? null,
    hasToken: !!token,
    onboardingCompleted: !!onboardingCompleted,
    isDemoMode,
  }), [userId, token, onboardingCompleted]));

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
