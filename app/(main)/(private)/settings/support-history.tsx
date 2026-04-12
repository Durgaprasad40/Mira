/**
 * SUPPORT HISTORY - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend module:
 * - api.supportTickets (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function SupportHistoryScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'support_history');
  }

  return (
    <FeatureComingSoon
      featureName="Support History"
      featureKey="support_history"
      description="View your support ticket history. This feature is coming soon."
      showBackButton={true}
      iconName="help-circle-outline"
    />
  );
}
