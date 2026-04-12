/**
 * CHAT ROOM DETAIL - BLOCKED
 *
 * This feature is temporarily blocked due to 20+ missing backend functions:
 * - getOrCreateDmThread, addReaction, removeReaction
 * - heartbeatPresence, hideDmThread, getRoomPresence
 * - getMutedUsersInRoom, toggleMuteUserInRoom, getReactionsForMessages
 * - getDmThreads, getUserMentions, markMentionRead, markAllMentionsRead
 * - Missing table: chatRoomDmThreads
 *
 * DO NOT REMOVE this blocking code until backend is implemented.
 */
import React from 'react';
import FeatureComingSoon from '@/components/FeatureComingSoon';

export default function ChatRoomDetailScreen() {
  return (
    <FeatureComingSoon
      featureName="Chat Room"
      featureKey="chat_room_detail"
      description="Chat Room conversations are being built. Soon you'll be able to chat with others in real-time!"
      showBackButton={true}
      iconName="chatbubble-ellipses-outline"
    />
  );
}
