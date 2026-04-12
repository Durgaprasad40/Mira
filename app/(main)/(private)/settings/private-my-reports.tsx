/**
 * PRIVATE MY REPORTS - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend module:
 * - api.supportTickets (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function PrivateMyReportsScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_my_reports');
  }

  return (
    <FeatureComingSoon
      featureName="My Reports"
      featureKey="private_my_reports"
      description="View and track your submitted reports. This feature is coming soon."
      showBackButton={true}
      iconName="document-text-outline"
    />
  );
}
