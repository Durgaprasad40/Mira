/**
 * PRIVATE ACCOUNT - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend args:
 * - api.privateDeletion.markForDeletion: missing userId
 *
 * DO NOT REMOVE this blocking code until backend is fixed.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function PrivateAccountScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_account');
  }

  return (
    <FeatureComingSoon
      featureName="Account"
      featureKey="private_account"
      description="Manage your account settings. This feature is coming soon."
      showBackButton={true}
      iconName="person-outline"
    />
  );
}
