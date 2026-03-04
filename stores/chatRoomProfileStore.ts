// STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
// All data is ephemeral (in-memory only) and rehydrates from Convex on app boot.

/**
 * Chat Room Profile Store
 *
 * Stores the user's chat room identity (display name and avatar).
 *
 * This identity is separate from the main dating profile and only
 * applies within chat rooms.
 */
import { create } from 'zustand';

interface ChatRoomProfileState {
  /** Display name for chat rooms (null = use default) */
  displayName: string | null;

  /** Avatar URI for chat rooms (null = use default) */
  avatarUri: string | null;

  /** Bio text for chat rooms (null = no bio) */
  bio: string | null;

  /** Update the chat room profile */
  setProfile: (data: { displayName?: string; avatarUri?: string | null; bio?: string | null }) => void;

  /** Clear the chat room profile (reset to defaults) */
  clearProfile: () => void;

  /** Hydration flag for async storage */
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useChatRoomProfileStore = create<ChatRoomProfileState>()((set) => ({
  displayName: null,
  avatarUri: null,
  bio: null,
  _hasHydrated: true, // Always ready - no AsyncStorage

  setProfile: (data) => {
    set((state) => ({
      displayName: data.displayName !== undefined ? data.displayName : state.displayName,
      avatarUri: data.avatarUri !== undefined ? data.avatarUri : state.avatarUri,
      bio: data.bio !== undefined ? data.bio : state.bio,
    }));
  },

  clearProfile: () => {
    set({ displayName: null, avatarUri: null, bio: null });
  },

  setHasHydrated: (hydrated) => {
    set({ _hasHydrated: true }); // No-op
  },
}));
