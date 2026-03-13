/**
 * Preferred Chat Room Store
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * All data is ephemeral (in-memory only) and rehydrates from Convex on app boot.
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
 * In Convex mode, this is an ephemeral cache that must sync with the server.
 */
import { create } from 'zustand';

interface PreferredChatRoomState {
  /** The user's preferred chat room ID (null if none selected) */
  preferredRoomId: string | null;

  /** Set the preferred chat room */
  setPreferredRoom: (roomId: string) => void;

  /** Clear the preferred chat room (called on "Leave Room") */
  clearPreferredRoom: () => void;

  /** Hydration flag (always true - no AsyncStorage) */
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  /**
   * Session-level flag: has the initial redirect already fired in this session?
   * Prevents navigation trap when user backs out of a room.
   * Resets only on app restart (cold start), NOT on component remount.
   */
  hasRedirectedInSession: boolean;
  setHasRedirectedInSession: (value: boolean) => void;

  /**
   * MEMBERSHIP LIFECYCLE: Track the room user is currently viewing.
   * Used to call leaveRoom when user returns to homepage.
   * - Set when entering a room
   * - Cleared when returning to homepage (after leaveRoom is called)
   * - NOT cleared when switching to other app tabs
   */
  currentRoomId: string | null;
  setCurrentRoom: (roomId: string | null) => void;
}

export const usePreferredChatRoomStore = create<PreferredChatRoomState>()((set) => ({
  preferredRoomId: null,
  _hasHydrated: true, // Always ready - no AsyncStorage
  hasRedirectedInSession: false, // Session-level: resets only on app cold start
  currentRoomId: null, // MEMBERSHIP LIFECYCLE: room user is currently viewing

  setPreferredRoom: (roomId) => {
    set({ preferredRoomId: roomId });
  },

  clearPreferredRoom: () => {
    set({ preferredRoomId: null });
  },

  setHasHydrated: (hydrated) => {
    set({ _hasHydrated: true }); // No-op
  },

  setHasRedirectedInSession: (value) => {
    set({ hasRedirectedInSession: value });
  },

  setCurrentRoom: (roomId) => {
    set({ currentRoomId: roomId });
  },
}));
