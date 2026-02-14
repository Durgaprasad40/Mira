/**
 * Chat Room Session Store
 *
 * Manages the "in-room" session state for Phase-2 Chat Rooms.
 * This is separate from global auth - it only tracks whether
 * the user is currently active in a chat room session.
 *
 * Session rules:
 * - User enters a room -> session starts (isInChatRoom = true)
 * - User can switch tabs freely while session is active
 * - User can only exit by "Leave Room" action from profile menu
 * - On leave: session cleared, navigate to Chat Rooms HOME
 */
import { create } from 'zustand';

export interface ChatRoomIdentity {
  userId: string;
  name: string;
  age: number;
  gender: string;
  profilePicture: string;
}

interface ChatRoomSessionState {
  /** Whether user is currently in a chat room session */
  isInChatRoom: boolean;

  /** The active room ID (null if not in a room) */
  activeRoomId: string | null;

  /** The user's identity snapshot for this session (fixed during session) */
  identity: ChatRoomIdentity | null;

  /** Enter a room - starts the session */
  enterRoom: (roomId: string, identity: ChatRoomIdentity) => void;

  /** Leave the room - ends the session */
  exitRoom: () => void;

  /** Update profile picture (allowed during session) */
  updateProfilePicture: (url: string) => void;
}

export const useChatRoomSessionStore = create<ChatRoomSessionState>((set, get) => ({
  isInChatRoom: false,
  activeRoomId: null,
  identity: null,

  enterRoom: (roomId, identity) => {
    set({
      isInChatRoom: true,
      activeRoomId: roomId,
      identity,
    });
  },

  exitRoom: () => {
    set({
      isInChatRoom: false,
      activeRoomId: null,
      identity: null,
    });
  },

  updateProfilePicture: (url) => {
    const { identity } = get();
    if (identity) {
      set({
        identity: {
          ...identity,
          profilePicture: url,
        },
      });
    }
  },
}));
