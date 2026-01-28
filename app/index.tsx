import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/authStore";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { COLORS } from "@/lib/constants";

export default function Index() {
  const { isAuthenticated, onboardingCompleted, _hasHydrated } = useAuthStore();

  // Show loading screen while store is hydrating
  if (!_hasHydrated) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Use Redirect component instead of imperative navigation
  // This is safer and waits for the layout to be mounted
  if (isAuthenticated) {
    if (onboardingCompleted) {
      return <Redirect href="/(main)/(tabs)/home" />;
    }
    return <Redirect href="/(onboarding)" />;
  }

  return <Redirect href="/(auth)/welcome" />;
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
