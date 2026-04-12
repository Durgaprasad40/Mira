/**
 * REPORT PERSON - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend module:
 * - api.supportTickets (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function ReportPersonScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'report_person');
  }

  return (
    <FeatureComingSoon
      featureName="Report a Person"
      featureKey="report_person"
      description="Report users who violate community guidelines. This feature is coming soon."
      showBackButton={true}
      iconName="flag-outline"
    />
  );
}
