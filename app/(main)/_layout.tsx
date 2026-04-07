import React, { useEffect, useRef, useCallback, useMemo, Component, ReactNode } from "react";
import { View } from "react-native";
import { Stack, useRootNavigationState, useRouter, useSegments, router as globalRouter, usePathname } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { computeEnforcementLevel } from "@/lib/securityEnforcement";
import { ToastHost } from "@/components/ui/Toast";
import { useRouteTrace, trace } from "@/lib/devTrace";
import { usePhaseMode, type PhaseMode } from "@/lib/usePhaseMode";

// Navigation state tracking (minimal, for effect dependency)
let _lastPathname = '';

// ═══════════════════════════════════════════════════════════════════════════
// EXPO-ROUTER SETTINGS: Control navigation state behavior
// - initialRouteName ensures app starts at tabs, not at a stale modal
// - This helps prevent state restoration issues with camera-composer
// ═══════════════════════════════════════════════════════════════════════════
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

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
  const pathname = usePathname();

  // Navigation state tracking (debug logging removed to reduce Metro noise)
  useEffect(() => {
    if (!rootNavState?.key) return;
    _lastPathname = pathname;
  }, [pathname, rootNavState]);

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE MODE: Single derived routing decision (replaces multiple segment checks)
  // - 'phase1': Route handled by MainLayout effects
  // - 'phase2': Route handled by PrivateLayout - MainLayout should NOT run effects
  // - 'shared': Routes like incognito-chat, match-celebration - MainLayout handles
  // - 'loading': Router not ready
  // ══════════════════════════════════════════════════════════════════════════════
  const phaseMode = usePhaseMode();

  // Derived: Should MainLayout handle this route?
  // MainLayout handles Phase 1 and shared routes; Phase 2 is handled by PrivateLayout
  const isMainLayoutRoute = phaseMode === 'phase1' || phaseMode === 'shared';
  const isPhase2Route = phaseMode === 'phase2';

  // DEV-only route change logging
  // SKIP for shared routes (incognito-chat, etc.) to reduce log spam and render overhead
  // SKIP for Phase-2 routes (PrivateLayout handles those)
  const shouldTraceMain = phaseMode === 'phase1'; // Only trace actual Phase 1 routes
  useRouteTrace(shouldTraceMain ? "P1_MAIN" : "SKIP", useCallback(() => {
    return {
      userId: userId?.substring(0, 8) ?? null,
      hasToken: !!token,
      onboardingCompleted: !!onboardingCompleted,
      phaseMode,
      isDemoMode,
    };
  }, [userId, token, onboardingCompleted, phaseMode]));

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : "skip"
  );

  // Security gate — guarded one-shot redirect.
  // LOOP FIX: Memoize to prevent recomputation on every render
  const needsVerification = useMemo(() => {
    if (isDemoMode) return false;
    if (!currentUser) return false;
    const level =
      currentUser.verificationEnforcementLevel ||
      computeEnforcementLevel({
        createdAt: currentUser.createdAt,
        verificationStatus:
          (currentUser.verificationStatus as any) || "unverified",
      });
    return level === "security_only";
  }, [currentUser]);

  const segmentsKey = segments.join("/");

  // Security gate — ONLY runs for Phase 1 and shared routes
  // Phase 2 (PrivateLayout) handles its own guards
  useEffect(() => {
    if (didRedirect.current) return;
    if (isDemoMode) return;
    if (!rootNavState?.key) return;
    if (!needsVerification) return;
    // PHASE ISOLATION: Don't redirect when in Phase 2 - PrivateLayout has its own guards
    if (isPhase2Route) return;

    if (segmentsKey.includes("(main)/verification")) {
      didRedirect.current = true;
      return;
    }

    didRedirect.current = true;
    routerRef.current.replace("/(main)/verification" as any);
  }, [needsVerification, rootNavState?.key, segmentsKey, isPhase2Route]);

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
        options={{
          presentation: "fullScreenModal",
          // SAFETY: Unique ID per params prevents stale state restoration
          // If params are missing, the route becomes invalid and guard will redirect
        }}
        dangerouslySingular={(_name: string, params: Record<string, any>) => {
          // Generate unique ID based on params - prevents state restoration with stale/missing params
          const mode = params?.mode || 'none';
          const convId = params?.conversationId || params?.todConversationId || '';
          const promptId = params?.promptId || '';
          return `camera-${mode}-${convId}-${promptId}`;
        }}
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
