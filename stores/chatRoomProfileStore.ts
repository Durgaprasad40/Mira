/**
 * Chat Room Profile Store
 *
 * Stores the user's chat room identity (display name and avatar)
 * that persists across app sessions.
 *
 * This identity is separate from the main dating profile and only
 * applies within chat rooms.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ChatRoomProfileState {
  /** Display name for chat rooms (null = use default) */
  displayName: string | null;

  /** Avatar URI for chat rooms (null = use default) */
  avatarUri: string | null;

  /** Update the chat room profile */
  setProfile: (data: { displayName?: string; avatarUri?: string | null }) => void;

  /** Clear the chat room profile (reset to defaults) */
  clearProfile: () => void;

  /** Hydration flag for async storage */
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useChatRoomProfileStore = create<ChatRoomProfileState>()(
  persist(
    (set) => ({
      displayName: null,
      avatarUri: null,
      _hasHydrated: false,

      setProfile: (data) => {
        set((state) => ({
          displayName: data.displayName !== undefined ? data.displayName : state.displayName,
          avatarUri: data.avatarUri !== undefined ? data.avatarUri : state.avatarUri,
        }));
      },

      clearProfile: () => {
        set({ displayName: null, avatarUri: null });
      },

      setHasHydrated: (hydrated) => {
        set({ _hasHydrated: hydrated });
      },
    }),
    {
      name: 'chatroom-profile-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
