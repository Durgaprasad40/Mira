import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Button } from "@/components/ui";
import { useRouter, Redirect } from "expo-router";
import { COLORS } from "@/lib/constants";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";

export default function WelcomeScreen() {
  const router = useRouter();
  const { isAuthenticated, onboardingCompleted } = useAuthStore();
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoOnboardingComplete = useDemoStore((s) => s.demoOnboardingComplete);
  const demoStoreHydrated = useDemoStore((s) => s._hasHydrated);

  // OB-6 fix: Wait for demoStore to hydrate before making redirect decisions
  // This prevents incorrect redirects during startup when store values are stale/default
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

  // Demo mode: if already logged in, redirect
  if (isDemoMode && currentDemoUserId) {
    if (demoOnboardingComplete[currentDemoUserId]) {
      return <Redirect href={"/(main)/(tabs)/home" as any} />;
    }
    return <Redirect href={"/(onboarding)" as any} />;
  }

  // Use Redirect component instead of useEffect navigation
  if (!isDemoMode && isAuthenticated) {
    if (onboardingCompleted) {
      return <Redirect href="/(main)/(tabs)/home" />;
    }
    return <Redirect href="/(onboarding)" />;
  }

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
          variant="primary"
          onPress={() => router.push("/(onboarding)")}
          style={styles.createButton}
          fullWidth
        />
        <Button
          title="I already have an account"
          variant="outline"
          onPress={() => router.push("/(auth)/login")}
          style={styles.loginButton}
          fullWidth
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
  createButton: {
    backgroundColor: COLORS.white,
    marginBottom: 12,
  },
  loginButton: {
    borderColor: COLORS.white,
    marginBottom: 16,
  },
  terms: {
    fontSize: 12,
    color: COLORS.white,
    textAlign: "center",
    opacity: 0.8,
    lineHeight: 18,
  },
});
