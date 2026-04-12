/**
 * PHASE-2 LIKES - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend module:
 * - api.privateSwipes (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function Phase2LikesScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'phase2_likes');
  }

  return (
    <FeatureComingSoon
      featureName="Likes"
      featureKey="phase2_likes"
      description="See who likes you in Deep Connect! This feature is coming soon."
      showBackButton={true}
      iconName="heart-outline"
    />
  );
}
