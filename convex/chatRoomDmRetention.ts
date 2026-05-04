export const CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS = 3 * 60 * 60 * 1000;

type ChatRoomPrivateDmConversationLike = {
  connectionSource?: string;
  sourceRoomId?: unknown;
  participants?: unknown[];
  lastMessageAt?: number;
  createdAt: number;
};

export function isChatRoomPrivateDmConversation(
  conversation: ChatRoomPrivateDmConversationLike | null | undefined
): boolean {
  if (!conversation) return false;
  if (conversation.participants && conversation.participants.length !== 2) {
    return false;
  }
  return conversation.connectionSource === 'room' || conversation.sourceRoomId != null;
}

export function getChatRoomPrivateDmLastActivityAt(
  conversation: ChatRoomPrivateDmConversationLike
): number {
  return conversation.lastMessageAt ?? conversation.createdAt;
}

export function isChatRoomPrivateDmExpired(
  conversation: ChatRoomPrivateDmConversationLike | null | undefined,
  now: number = Date.now()
): boolean {
  if (!conversation || !isChatRoomPrivateDmConversation(conversation)) return false;
  return getChatRoomPrivateDmLastActivityAt(conversation) + CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS <= now;
}
