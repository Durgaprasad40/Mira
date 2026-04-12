/**
 * INCOGNITO CHAT - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend modules:
 * - api.privateConversations (entire module doesn't exist)
 * - api.privatePhotoAccess (entire module doesn't exist)
 * - Missing table: privateConversations
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function IncognitoChatScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'incognito_chat');
  }

  return (
    <FeatureComingSoon
      featureName="Private Chat"
      featureKey="incognito_chat"
      description="Private messaging is coming soon. Start a conversation with your matches!"
      showBackButton={true}
      iconName="chatbubble-outline"
    />
  );
}
