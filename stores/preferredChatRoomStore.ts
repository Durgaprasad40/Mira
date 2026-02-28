/**
 * Preferred Chat Room Store
 *
 * Stores the user's preferred chat room ID so they automatically
 * open that room when entering the Chat Rooms tab.
 *
 * Behavior:
 * - First time: No preferred room → show Chat Rooms homepage
 * - After selection: User enters a room → set as preferred
 * - Next time: Auto-redirect to preferred room (skip homepage)
 * - Leave Room: Clear preferred room → show homepage again
 *
 * This store is used for both demo and Convex modes.
 * In Convex mode, this is a local cache that syncs with the server.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PreferredChatRoomState {
  /** The user's preferred chat room ID (null if none selected) */
  preferredRoomId: string | null;

  /** Set the preferred chat room */
  setPreferredRoom: (roomId: string) => void;

  /** Clear the preferred chat room (called on "Leave Room") */
  clearPreferredRoom: () => void;

  /** Hydration flag for async storage */
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

export const usePreferredChatRoomStore = create<PreferredChatRoomState>()(
  persist(
    (set) => ({
      preferredRoomId: null,
      _hasHydrated: false,

      setPreferredRoom: (roomId) => {
        set({ preferredRoomId: roomId });
      },

      clearPreferredRoom: () => {
        set({ preferredRoomId: null });
      },

      setHasHydrated: (hydrated) => {
        set({ _hasHydrated: hydrated });
      },
    }),
    {
      name: 'preferred-chatroom-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
