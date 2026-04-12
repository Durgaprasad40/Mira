/**
 * INCOGNITO CREATE T/D - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend functions:
 * - api.privateProfiles.getCurrentOnboardingProfile (doesn't exist)
 * - api.truthDare.editPrompt (doesn't exist)
 * - Wrong argument types: token not accepted
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function IncognitoCreateTodScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'incognito_create_tod');
  }

  return (
    <FeatureComingSoon
      featureName="Create Truth/Dare"
      featureKey="incognito_create_tod"
      description="Create Truth or Dare prompts. This feature is being enhanced."
      showBackButton={true}
      iconName="flame-outline"
    />
  );
}
