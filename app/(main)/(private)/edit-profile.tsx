/**
 * PRIVATE EDIT PROFILE - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend function:
 * - api.privateProfiles.updatePhotoBlurSlots (doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function PrivateEditProfileScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_edit_profile');
  }

  return (
    <FeatureComingSoon
      featureName="Edit Profile"
      featureKey="private_edit_profile"
      description="Edit your Deep Connect profile. This feature is being enhanced."
      showBackButton={true}
      iconName="create-outline"
    />
  );
}
