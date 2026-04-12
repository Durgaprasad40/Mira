/**
 * PRIVATE NOTIFICATIONS - BLOCKED
 *
 * This feature is temporarily blocked due to wrong backend fields:
 * - notificationsEnabled field doesn't exist in upsertPrivateProfile
 * - notificationCategories field doesn't exist in upsertPrivateProfile
 *
 * DO NOT REMOVE this blocking code until backend schema is updated.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function PrivateNotificationsScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_notifications');
  }

  return (
    <FeatureComingSoon
      featureName="Notifications"
      featureKey="private_notifications"
      description="Manage your notification preferences. This feature is coming soon."
      showBackButton={true}
      iconName="notifications-outline"
    />
  );
}
