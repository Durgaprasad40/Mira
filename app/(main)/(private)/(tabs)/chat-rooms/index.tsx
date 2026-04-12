/**
 * CHAT ROOMS - BLOCKED
 *
 * This feature is temporarily blocked due to missing backend functions:
 * - getChatRoomProfile
 * - getUnreadDmCountsByRoom
 * - And 15+ other missing chatRooms functions
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function ChatRoomsIndexScreen() {
  return (
    <FeatureComingSoon
      featureName="Chat Rooms"
      featureKey="chat_rooms_index"
      description="Chat Rooms feature is under development. You'll be able to join topic-based chat rooms and meet new people soon!"
      showBackButton={false}
      iconName="chatbubbles-outline"
    />
  );
}
