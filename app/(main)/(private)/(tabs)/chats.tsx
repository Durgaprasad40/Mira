/**
 * PHASE-2 MESSAGES - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend modules:
 * - api.privateConversations (entire module doesn't exist)
 * - api.privateSwipes (entire module doesn't exist)
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function Phase2ChatsScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'phase2_messages');
  }

  return (
    <FeatureComingSoon
      featureName="Messages"
      featureKey="phase2_messages"
      description="Private messaging in Deep Connect is coming soon. Match with someone to start a conversation!"
      showBackButton={false}
      iconName="mail-outline"
    />
  );
}
