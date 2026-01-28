import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/authStore";

export default function Index() {
  const { isAuthenticated, onboardingCompleted } = useAuthStore();

  // Check auth state and redirect accordingly
  if (isAuthenticated) {
    if (onboardingCompleted) {
      return <Redirect href="/(main)/(tabs)/home" />;
    } else {
      return <Redirect href="/(onboarding)" />;
    }
  }

  // Not authenticated, go to auth welcome
  return <Redirect href="/(auth)/welcome" />;
}
