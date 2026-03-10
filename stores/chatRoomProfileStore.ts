/**
 * Chat Room Profile Store
 *
 * STORAGE: In-memory only (session-scoped). Data is lost on app restart.
 * No persistence to AsyncStorage or Convex.
 *
 * Stores the user's chat room identity:
 * - displayName: Custom name for chat rooms (null = use default from main profile)
 * - avatarUri: Custom avatar for chat rooms (null = use default from main profile)
 * - bio: Custom bio for chat rooms (null = no bio)
 *
 * This identity is separate from the main dating profile and only
 * applies within chat rooms for the current session.
 *
 * L-001 FIX: Updated comment to accurately reflect session-only storage.
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
