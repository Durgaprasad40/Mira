import { Redirect } from 'expo-router';

export default function OnboardingIndex() {
  // NEVER auto-navigate from this screen
  // Users should only reach onboarding screens by explicit button press from welcome screen
  // If somehow navigated here directly, redirect back to welcome
  return <Redirect href="/(auth)/welcome" />;
}

