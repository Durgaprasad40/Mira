/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(auth)/welcome.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import { useRef, useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Button } from "@/components/ui";
import { useRouter, Redirect, useSegments } from "expo-router";
import { COLORS } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";

// P1-021 FIX: Timeout for demo hydration to prevent frozen screen
const DEMO_HYDRATION_TIMEOUT_MS = 5000;

// =============================================================================
// WELCOME SCREEN - Auth Entry Point
// =============================================================================
//
// REDIRECT RULES (ALL must be true to redirect to home):
// 1. isAuthenticated === true (token && userId && !logoutInProgress)
// 2. token exists and is non-empty
// 3. userId exists
// 4. onboardingCompleted === true
// 5. logoutInProgress === false
//
// If ANY condition fails, stay on welcome screen.
// This prevents ghost redirects after logout.
// =============================================================================

export default function WelcomeScreen() {
  const router = useRouter();
  const segments = useSegments();

  // Subscribe to auth state
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const logoutInProgress = useAuthStore((s) => s.logoutInProgress);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Demo mode state
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoOnboardingComplete = useDemoStore((s) => s.demoOnboardingComplete);
  const demoStoreHydrated = useDemoStore((s) => s._hasHydrated);

  // Single-fire guard to prevent repeated redirects
  const didRedirectRef = useRef(false);

  // P1-021 FIX: Track hydration timeout to prevent frozen screen
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  useEffect(() => {
    if (isDemoMode && !demoStoreHydrated) {
      const timer = setTimeout(() => {
        setHydrationTimedOut(true);
        console.warn('[AUTH_WELCOME] P1-021: Demo hydration timeout after 5s');
      }, DEMO_HYDRATION_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
    // Reset timeout flag if hydration completes
    if (demoStoreHydrated) {
      setHydrationTimedOut(false);
    }
  }, [demoStoreHydrated]);

  // ==========================================================================
  // GUARD: Only process redirect logic if on auth path
  // ==========================================================================

  const isOnAuthPath = segments[0] === "(auth)" || !segments[0];

  // If not on auth path, return null (component is mounted but inactive)
  if (!isOnAuthPath) {
    return null;
  }

  // ==========================================================================
  // GUARD: Wait for demo store hydration in demo mode
  // ==========================================================================

  if (isDemoMode && !demoStoreHydrated) {
    // P1-021 FIX: Show error and proceed option if hydration times out
    if (hydrationTimedOut) {
      return (
        <LinearGradient
          colors={[COLORS.primary, COLORS.secondary]}
          style={styles.container}
        >
          <View style={styles.content}>
            <Ionicons name="cloud-offline-outline" size={48} color={COLORS.white} />
            <Text style={[styles.title, { fontSize: 24, marginTop: 16 }]}>Demo Loading Slow</Text>
            <Text style={styles.subtitle}>
              Demo data is taking longer than expected. You can continue anyway.
            </Text>
            <Button
              title="Continue Anyway"
              variant="outline"
              onPress={() => setHydrationTimedOut(false)}
              style={{ marginTop: 20, borderColor: COLORS.white }}
              textStyle={{ color: COLORS.white }}
            />
          </View>
        </LinearGradient>
      );
    }
    return (
      <LinearGradient
        colors={[COLORS.primary, COLORS.secondary]}
        style={styles.container}
      >
        <View style={styles.content}>
          <ActivityIndicator size="large" color={COLORS.white} />
        </View>
      </LinearGradient>
    );
  }

  // ==========================================================================
  // REDIRECT LOGIC - Demo Mode
  // ==========================================================================
  // Only auto-redirect if onboarding is COMPLETE → go to home
  // If onboarding is INCOMPLETE, stay on welcome and let user choose action

  if (isDemoMode && currentDemoUserId && demoOnboardingComplete[currentDemoUserId]) {
    if (didRedirectRef.current) return null;
    didRedirectRef.current = true;
    return <Redirect href={"/(main)/(tabs)/home" as any} />;
  }

  // Demo mode: Authenticated but incomplete onboarding → STAY on welcome
  // User must explicitly tap a button to continue (no auto-redirect)

  // ==========================================================================
  // REDIRECT LOGIC - Live Mode
  // ==========================================================================
  //
  // STRICT CONDITIONS - ALL must be true:
  // 1. isAuthenticated (legacy flag for compatibility)
  // 2. token exists and non-empty
  // 3. userId exists
  // 4. onboardingCompleted is true
  // 5. logoutInProgress is FALSE
  //
  // This prevents the ghost login bug where:
  // - User logs out
  // - Stale async operation restores auth state
  // - Welcome sees isAuthenticated=true and redirects to home
  //
  // With logoutInProgress check:
  // - beginLogout() sets logoutInProgress=true
  // - Welcome sees logoutInProgress=true → stays on welcome
  // - finishLogout() clears auth state
  // - Welcome sees isAuthenticated=false → stays on welcome
  // ==========================================================================

  const hasValidToken = typeof token === "string" && token.trim().length > 0;

  const shouldRedirectToHome =
    !isDemoMode &&
    isAuthenticated &&
    hasValidToken &&
    userId !== null &&
    onboardingCompleted === true &&
    logoutInProgress === false;

  if (shouldRedirectToHome) {
    if (didRedirectRef.current) return null;
    didRedirectRef.current = true;

    if (__DEV__) {
      console.log("[WELCOME] All conditions met, redirecting to home");
    }

    return <Redirect href="/(main)/(tabs)/home" />;
  }

  // ==========================================================================
  // STAY ON WELCOME - Authenticated but incomplete onboarding
  // ==========================================================================
  // Do NOT auto-redirect to basic-info. User must explicitly tap a button.
  // This is intentional: user needs to see welcome to understand which account
  // they're in and choose how to proceed. Auto-dropping into basic-info is confusing.

  // ==========================================================================
  // STAY ON WELCOME - Show buttons
  // ==========================================================================
  // At this point, user is either:
  // 1. Not authenticated (NO_AUTH, INVALID) → show buttons, let them login/signup
  // 2. Authenticated but incomplete onboarding → show buttons, let them choose action

  const handleCreateAccount = () => {
    // STABILITY FIX: Do NOT force logout here.
    // Welcome page must be passive - no automatic state clearing.
    // If user has an existing session, email-phone will handle it appropriately.
    // Users who want to continue their incomplete onboarding should tap
    // "I already have an account" instead.
    if (__DEV__) {
      console.log("[WELCOME] Create Account tapped, navigating to email-phone");
    }
    router.push("/(onboarding)/email-phone");
  };

  return (
    <LinearGradient
      colors={[COLORS.primary, COLORS.secondary]}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="heart" size={80} color={COLORS.white} />
        </View>

        <Text style={styles.title}>Mira</Text>
        <Text style={styles.subtitle}>Find your perfect match</Text>

        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons name="flame" size={24} color={COLORS.white} />
            <Text style={styles.featureText}>Swipe to match</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="chatbubbles" size={24} color={COLORS.white} />
            <Text style={styles.featureText}>Chat with matches</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="location" size={24} color={COLORS.white} />
            <Text style={styles.featureText}>Find people nearby</Text>
          </View>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title="Create Account"
          variant="outline"
          onPress={handleCreateAccount}
          fullWidth
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.12)",
            borderWidth: 1.5,
            borderColor: "rgba(255, 255, 255, 0.9)",
            elevation: 0,
            marginBottom: 14,
            borderRadius: 14,
            paddingVertical: 16,
          }}
          textStyle={{
            color: COLORS.white,
            fontWeight: "600",
            fontSize: 17,
            letterSpacing: 0.3,
          }}
        />
        <Button
          title="I already have an account"
          variant="outline"
          onPress={() => {
            // STABILITY FIX: Welcome page must be passive - no automatic routing decisions.
            // Always go to login page. Login will handle session state appropriately.
            if (__DEV__) {
              console.log("[WELCOME] I already have an account tapped, going to login");
            }
            router.push("/(auth)/login");
          }}
          fullWidth
          style={{
            backgroundColor: "transparent",
            borderWidth: 1.5,
            borderColor: "rgba(255, 255, 255, 0.5)",
            elevation: 0,
            marginBottom: 18,
            borderRadius: 14,
            paddingVertical: 14,
          }}
          textStyle={{
            color: "rgba(255, 255, 255, 0.9)",
            fontWeight: "500",
            fontSize: 15,
          }}
        />
        <Text style={styles.terms}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  iconContainer: {
    marginBottom: 28,
  },
  title: {
    fontSize: 52,
    fontWeight: "700",
    color: COLORS.white,
    marginBottom: 10,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 19,
    color: COLORS.white,
    opacity: 0.92,
    marginBottom: 48,
    fontWeight: "400",
    letterSpacing: 0.2,
  },
  features: {
    width: "100%",
    gap: 14,
  },
  feature: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  featureText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  buttonContainer: {
    width: "100%",
    padding: 24,
    paddingBottom: 44,
  },
  terms: {
    fontSize: 12,
    color: COLORS.white,
    textAlign: "center",
    opacity: 0.75,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
});
