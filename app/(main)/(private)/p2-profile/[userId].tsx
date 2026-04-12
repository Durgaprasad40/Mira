/**
 * PHASE-2 PROFILE - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend modules:
 * - api.privateSwipes (entire module doesn't exist)
 * - api.privatePhotoAccess (entire module doesn't exist)
 * - Missing profile fields: displayName, promptAnswers, height, smoking, drinking
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function Phase2ProfileScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'phase2_profile');
  }

  return (
    <FeatureComingSoon
      featureName="Profile"
      featureKey="phase2_profile"
      description="Full profile viewing is coming soon. You'll be able to see detailed profiles with photos and prompts!"
      showBackButton={true}
      iconName="person-circle-outline"
    />
  );
}
