import { Redirect } from 'expo-router';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { View, ActivityIndicator } from 'react-native';
import { COLORS } from '@/lib/constants';
import type { OnboardingStep } from '@/types';

/**
 * Onboarding Index - Routes to the correct onboarding screen based on stored step.
 *
 * When a user returns to the app with a valid token but incomplete onboarding,
 * this component ensures they resume where they left off rather than starting over.
 */

// Map OnboardingStep to actual route paths
const STEP_TO_ROUTE: Record<OnboardingStep, string> = {
  // First steps - start of onboarding flow
  'welcome': '/(onboarding)/email-phone',
  'email_phone': '/(onboarding)/email-phone',
  'otp': '/(onboarding)/otp',
  'password': '/(onboarding)/password',
  'basic_info': '/(onboarding)/basic-info',
  'consent': '/(onboarding)/consent',

  // Photo and verification steps
  'photo_upload': '/(onboarding)/photo-upload',
  'face_verification': '/(onboarding)/face-verification',
  'additional_photos': '/(onboarding)/additional-photos',

  // Profile completion steps
  'bio': '/(onboarding)/bio',
  'prompts': '/(onboarding)/prompts',
  'profile_details': '/(onboarding)/profile-details',
  'preferences': '/(onboarding)/preferences',
  'permissions': '/(onboarding)/permissions',
  'review': '/(onboarding)/review',
  'tutorial': '/(onboarding)/tutorial',
};

// Default route if step is unknown
const DEFAULT_ROUTE = '/(onboarding)/photo-upload';

export default function OnboardingIndex() {
  const hasHydrated = useOnboardingStore((s) => s._hasHydrated);
  const currentStep = useOnboardingStore((s) => s.currentStep);

  // Wait for onboardingStore to hydrate before making routing decision
  if (!hasHydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Determine route based on current step
  const route = STEP_TO_ROUTE[currentStep] || DEFAULT_ROUTE;

  // Debug logging for route decision (visible in adb logcat)
  if (__DEV__) {
    console.log(`[ONBOARDING] index.tsx: currentStep="${currentStep}" → route="${route}"`);
  }

  return <Redirect href={route as any} />;
}
