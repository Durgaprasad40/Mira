import { Redirect } from 'expo-router';

export default function OnboardingIndex() {
  // Route directly to email-phone (auth method selection)
  // The ONLY welcome screen is app/(auth)/welcome.tsx
  return <Redirect href="/(onboarding)/email-phone" />;
}

