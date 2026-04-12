/**
 * PRIVATE SAFETY - BLOCKED
 *
 * This feature is temporarily blocked due to wrong backend fields:
 * - safeMode field doesn't exist in upsertPrivateProfile
 *
 * DO NOT REMOVE this blocking code until backend schema is updated.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function PrivateSafetyScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_safety');
  }

  return (
    <FeatureComingSoon
      featureName="Safety"
      featureKey="private_safety"
      description="Manage your safety settings. This feature is coming soon."
      showBackButton={true}
      iconName="shield-outline"
    />
  );
}
