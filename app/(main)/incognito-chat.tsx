/**
 * INCOGNITO CHAT - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend modules:
 * - api.privatePhotoAccess (entire module doesn't exist)
 * - api.games.startBottleSpinGame (function not exported)
 *
 * Note: api.privateConversations DOES exist and can be used for basic chat.
 * The photo access and bottle spin game features need backend implementation.
 *
 * DO NOT REMOVE this blocking code until backend APIs are implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function IncognitoChatScreen() {
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'incognito_chat - missing: privatePhotoAccess, startBottleSpinGame');
  }

  return (
    <FeatureComingSoon
      featureName="Private Chat"
      featureKey="incognito_chat"
      description="Private messaging is coming soon. Backend APIs for photo access and games need to be implemented first."
      showBackButton={true}
      iconName="chatbubble-outline"
    />
  );
}
