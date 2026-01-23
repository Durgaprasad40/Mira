import { Redirect } from 'expo-router';

export default function OnboardingIndex() {
  // Start onboarding at the welcome step
  return <Redirect href=\"/(onboarding)/welcome\" />;
}

