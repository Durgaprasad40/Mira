/**
 * SELECT PERSON LIST - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend module:
 * - api.privateConversations (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function SelectPersonListScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'select_person_list');
  }

  return (
    <FeatureComingSoon
      featureName="Select Person"
      featureKey="select_person_list"
      description="Select a person from your conversations. This feature is coming soon."
      showBackButton={true}
      iconName="people-outline"
    />
  );
}
