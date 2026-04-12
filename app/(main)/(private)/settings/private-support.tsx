/**
 * PRIVATE SUPPORT - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend module:
 * - api.supportTickets (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function PrivateSupportScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_support');
  }

  return (
    <FeatureComingSoon
      featureName="Support"
      featureKey="private_support"
      description="Get help and contact support. This feature is coming soon."
      showBackButton={true}
      iconName="help-buoy-outline"
    />
  );
}
