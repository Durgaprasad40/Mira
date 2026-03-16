// STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
// All data is ephemeral (in-memory only) and rehydrates from Convex on app boot.

/**
 * blockStore — Global block list shared across Phase-1 and Phase-2.
 *
 * Single source of truth for blocked user IDs. Both demoStore and
 * privateChatStore delegate to this store so blocks apply everywhere:
 * Discover, Nearby, Likes, Messages, Phase-2 private chat.
 */
import { create } from 'zustand';

interface BlockedUserInfo {
  id: string;
  blockedAt: number; // timestamp
}

interface BlockState {
  blockedUserIds: string[];
  blockedUsersInfo: BlockedUserInfo[]; // Extended info for blocked users list
  _hasHydrated: boolean;

  // DL-012: Cached blocked set to avoid creating new Set on every call
  _cachedBlockedSet: Set<string> | null;

  // One-time "just unblocked" flag for UI indicator (not persisted)
  justUnblockedUserId: string | null;

  // Actions
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  isBlocked: (userId: string) => boolean;
  getBlockedSet: () => Set<string>;
  getBlockedUsersInfo: () => BlockedUserInfo[];
  clearBlocks: () => void;
  setHasHydrated: (state: boolean) => void;

  // Just unblocked actions
  setJustUnblockedUserId: (userId: string | null) => void;
  clearJustUnblocked: () => void;
}

export const useBlockStore = create<BlockState>()((set, get) => ({
  blockedUserIds: [],
  blockedUsersInfo: [],
  _hasHydrated: true, // Always ready - no AsyncStorage
  _cachedBlockedSet: null, // DL-012: Cached set
  justUnblockedUserId: null,

  blockUser: (userId) =>
    set((s) => {
      if (s.blockedUserIds.includes(userId)) return s;
      return {
        blockedUserIds: [...s.blockedUserIds, userId],
        blockedUsersInfo: [
          ...s.blockedUsersInfo,
          { id: userId, blockedAt: Date.now() },
        ],
        _cachedBlockedSet: null, // DL-012: Invalidate cache
      };
    }),

  unblockUser: (userId) =>
    set((s) => ({
      blockedUserIds: s.blockedUserIds.filter((id) => id !== userId),
      blockedUsersInfo: s.blockedUsersInfo.filter((u) => u.id !== userId),
      _cachedBlockedSet: null, // DL-012: Invalidate cache
    })),

  isBlocked: (userId) => get().blockedUserIds.includes(userId),

  getBlockedSet: () => {
    const state = get();
    // DL-012: Return cached set if available, otherwise create and cache
    if (state._cachedBlockedSet) return state._cachedBlockedSet;
    const newSet = new Set(state.blockedUserIds);
    set({ _cachedBlockedSet: newSet });
    return newSet;
  },

  getBlockedUsersInfo: () => get().blockedUsersInfo,

  clearBlocks: () => set({ blockedUserIds: [], blockedUsersInfo: [], _cachedBlockedSet: null }),

  setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op

  setJustUnblockedUserId: (userId) => set({ justUnblockedUserId: userId }),

  clearJustUnblocked: () => set({ justUnblockedUserId: null }),
}));
