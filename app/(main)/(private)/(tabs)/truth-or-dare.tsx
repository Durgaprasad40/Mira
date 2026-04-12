/**
 * TRUTH OR DARE - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend functions:
 * - api.truthDare.deleteMyPrompt
 * - Wrong argument types: token vs viewerUserId
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function TruthOrDareScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'truth_or_dare');
  }

  return (
    <FeatureComingSoon
      featureName="Truth or Dare"
      featureKey="truth_or_dare"
      description="Play Truth or Dare with other users! This feature is being enhanced and will be back soon."
      showBackButton={false}
      iconName="flame-outline"
    />
  );
}
