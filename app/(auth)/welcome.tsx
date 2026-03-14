/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(auth)/welcome.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import { useRef } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Button } from "@/components/ui";
import { useRouter, Redirect, useSegments } from "expo-router";
import { COLORS } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";

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
            backgroundColor: "#00000000",
            borderWidth: 2,
            borderColor: COLORS.white,
            elevation: 0,
            marginBottom: 12,
          }}
          textStyle={{
            color: COLORS.white,
            fontWeight: "600",
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
            backgroundColor: "#00000000",
            borderWidth: 2,
            borderColor: COLORS.white,
            elevation: 0,
            marginBottom: 16,
          }}
          textStyle={{
            color: COLORS.white,
            fontWeight: "600",
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
    padding: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: "bold",
    color: COLORS.white,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.white,
    opacity: 0.9,
    marginBottom: 48,
  },
  features: {
    width: "100%",
    gap: 16,
  },
  feature: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: COLORS.white + "20",
    padding: 16,
    borderRadius: 12,
  },
  featureText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: "500",
  },
  buttonContainer: {
    width: "100%",
    padding: 24,
    paddingBottom: 40,
  },
  terms: {
    fontSize: 12,
    color: COLORS.white,
    textAlign: "center",
    opacity: 0.8,
    lineHeight: 18,
  },
});
