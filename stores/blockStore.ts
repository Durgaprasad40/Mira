/**
 * blockStore — Global block list shared across Phase-1 and Phase-2.
 *
 * Single source of truth for blocked user IDs. Both demoStore and
 * privateChatStore delegate to this store so blocks apply everywhere:
 * Discover, Nearby, Likes, Messages, Phase-2 private chat.
 *
 * Persisted via AsyncStorage so blocks survive app restarts.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Hydration timeout: force hydration after 5s if AsyncStorage hangs
const HYDRATION_TIMEOUT_MS = 5000;

interface BlockedUserInfo {
  id: string;
  blockedAt: number; // timestamp
}

interface BlockState {
  blockedUserIds: string[];
  blockedUsersInfo: BlockedUserInfo[]; // Extended info for blocked users list
  _hasHydrated: boolean;

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

export const useBlockStore = create<BlockState>()(
  persist(
    (set, get) => ({
      blockedUserIds: [],
      blockedUsersInfo: [],
      _hasHydrated: false,
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
          };
        }),

      unblockUser: (userId) =>
        set((s) => ({
          blockedUserIds: s.blockedUserIds.filter((id) => id !== userId),
          blockedUsersInfo: s.blockedUsersInfo.filter((u) => u.id !== userId),
        })),

      isBlocked: (userId) => get().blockedUserIds.includes(userId),

      getBlockedSet: () => new Set(get().blockedUserIds),

      getBlockedUsersInfo: () => get().blockedUsersInfo,

      clearBlocks: () => set({ blockedUserIds: [], blockedUsersInfo: [] }),

      setHasHydrated: (state) => set({ _hasHydrated: state }),

      setJustUnblockedUserId: (userId) => set({ justUnblockedUserId: userId }),

      clearJustUnblocked: () => set({ justUnblockedUserId: null }),
    }),
    {
      name: 'mira-block-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        blockedUserIds: state.blockedUserIds,
        blockedUsersInfo: state.blockedUsersInfo,
        // Note: justUnblockedUserId is NOT persisted - it's a one-time UI flag
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// BUGFIX CR-2: Store timeout ID to prevent multiple timers on hot reload
let _blockHydrationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function setupBlockHydrationTimeout() {
  // Clear any existing timeout (hot reload safety)
  if (_blockHydrationTimeoutId !== null) {
    clearTimeout(_blockHydrationTimeoutId);
  }
  _blockHydrationTimeoutId = setTimeout(() => {
    if (!useBlockStore.getState()._hasHydrated) {
      if (__DEV__) {
        console.warn('[blockStore] Hydration timeout — forcing hydrated state');
      }
      useBlockStore.getState().setHasHydrated(true);
    }
    _blockHydrationTimeoutId = null;
  }, HYDRATION_TIMEOUT_MS);
}

// CR-2 fix: hydration timeout fallback — if AsyncStorage blocks, force hydration after timeout
setupBlockHydrationTimeout();
