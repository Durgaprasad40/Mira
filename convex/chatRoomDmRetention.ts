// =============================================================================
// I-003 LEGACY HELPER — DO NOT USE FOR CURRENT CHAT ROOM PRIVATE DMs.
//
// SCOPE
//   The two predicates exported below — `isChatRoomPrivateDmConversation` and
//   `isChatRoomPrivateDmExpired` — operate on the **Phase-1 `conversations`**
//   table. They identify and gate retention for *legacy* room-sourced DM rows
//   that lived on the Phase-1 messaging table before Chat Room one-on-one DMs
//   were moved to their own dedicated tables.
//
//   Current Chat Room one-on-one DMs are stored on a separate physical pair:
//     - `chatRoomPrivateConversations`
//     - `chatRoomPrivateMessages`
//   Retention/expiry for those CURRENT tables is handled in
//   `convex/chatRooms.ts` (see `getChatRoomPrivateConversationLastActivityAt`
//   and its callers around the `CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS` usage).
//
// WHAT TO USE WHEN
//   - Cleaning up a Phase-1 `conversations` row that had
//     `connectionSource === 'room'` or `sourceRoomId != null` → use the
//     helpers in THIS file. They are the legacy-data hygiene layer used by
//     `convex/messages.ts`, `convex/users.ts`, and `convex/protectedMedia.ts`.
//   - Anything involving rows in `chatRoomPrivateConversations` /
//     `chatRoomPrivateMessages` → do NOT use these helpers. Use the
//     room-DM-specific paths in `convex/chatRooms.ts`.
//   - Anything involving rows in `privateConversations` (Phase-2 Messages)
//     → also do NOT use these helpers. Phase-2 has its own defense in
//     `convex/privateConversations.ts` (`isRoomSourcedPrivateConversation`).
//
// DO NOT
//   - Rename this file casually — it is imported from at least four backend
//     modules (`chatRooms.ts`, `messages.ts`, `users.ts`, `protectedMedia.ts`).
//   - Repurpose these helpers to gate the current `chatRoomPrivateConversations`
//     table. That table has its own dedicated retention path.
//   - Alter `CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS` here without auditing
//     `chatRooms.ts`, which re-uses the same constant for the CURRENT
//     room-DM tables (shared TTL is intentional — keep them in lockstep).
// =============================================================================

// Inactivity window after which a (legacy or current) chat-room private DM
// thread is considered expired. Shared by both the legacy Phase-1 helpers
// below and the current `chatRoomPrivateConversations` retention path in
// `chatRooms.ts`. If you tune this value, update both call sites together.
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
