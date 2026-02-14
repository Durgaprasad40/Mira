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
 * - User can "Exit to Home" (session retained, can return)
 * - User can "Leave Room" (session cleared, must re-enter)
 * - On leave: session cleared, navigate to Chat Rooms HOME
 *
 * Coin system:
 * - User earns +1 coin per message sent
 * - Coins are tracked in this store (chatroom-safe)
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  /** Last visited timestamp per room (for unread badge calculation) */
  lastVisitedAt: Record<string, number>;

  /** User's coin balance (earned from sending messages) */
  coins: number;

  /** Enter a room - starts the session */
  enterRoom: (roomId: string, identity: ChatRoomIdentity) => void;

  /** Exit to Chat Rooms HOME - keeps session active (can return) */
  exitToHome: () => void;

  /** Leave the room completely - clears session */
  exitRoom: () => void;

  /** Update profile picture (allowed during session) */
  updateProfilePicture: (url: string) => void;

  /** Mark a room as visited (updates lastVisitedAt) */
  markRoomVisited: (roomId: string) => void;

  /** Get last visited timestamp for a room */
  getLastVisitedAt: (roomId: string) => number;

  /** Increment coins by 1 (called on message send) */
  incrementCoins: () => void;
}

export const useChatRoomSessionStore = create<ChatRoomSessionState>()(
  persist(
    (set, get) => ({
      isInChatRoom: false,
      activeRoomId: null,
      identity: null,
      lastVisitedAt: {},
      coins: 0,

      enterRoom: (roomId, identity) => {
        const now = Date.now();
        set((state) => ({
          isInChatRoom: true,
          activeRoomId: roomId,
          identity,
          lastVisitedAt: {
            ...state.lastVisitedAt,
            [roomId]: now,
          },
        }));
      },

      exitToHome: () => {
        // Keep session active (isInChatRoom, activeRoomId, identity remain)
        // User can return to the same room
        // This is just a navigation hint - actual navigation done by caller
      },

      exitRoom: () => {
        const { activeRoomId } = get();
        const now = Date.now();
        set((state) => ({
          isInChatRoom: false,
          activeRoomId: null,
          identity: null,
          // Update lastVisitedAt for the room being left
          lastVisitedAt: activeRoomId
            ? { ...state.lastVisitedAt, [activeRoomId]: now }
            : state.lastVisitedAt,
        }));
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

      markRoomVisited: (roomId) => {
        const now = Date.now();
        set((state) => ({
          lastVisitedAt: {
            ...state.lastVisitedAt,
            [roomId]: now,
          },
        }));
      },

      getLastVisitedAt: (roomId) => {
        return get().lastVisitedAt[roomId] ?? 0;
      },

      incrementCoins: () => {
        set((state) => ({
          coins: state.coins + 1,
        }));
      },
    }),
    {
      name: 'chatroom-session-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist these fields (not the session state)
      partialize: (state) => ({
        lastVisitedAt: state.lastVisitedAt,
        coins: state.coins,
      }),
    }
  )
);
