import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isDemoMode } from "@/hooks/useConvex";

const DAILY_LIKE_LIMIT = 25;
const DAILY_STANDOUT_LIMIT = 2;

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

interface DiscoverState {
  likesUsedToday: number;
  standOutsUsedToday: number;
  lastResetDate: string;

  // Computed-like getters
  likesRemaining: () => number;
  standOutsRemaining: () => number;
  hasReachedLikeLimit: () => boolean;
  hasReachedStandOutLimit: () => boolean;

  // Actions
  incrementLikes: () => void;
  incrementStandOuts: () => void;
  checkAndResetIfNewDay: () => void;
}

export const useDiscoverStore = create<DiscoverState>()(
  persist(
    (set, get) => ({
      likesUsedToday: 0,
      standOutsUsedToday: 0,
      lastResetDate: getTodayDateString(),

      likesRemaining: () => {
        if (isDemoMode) return 999;
        const state = get();
        return Math.max(0, DAILY_LIKE_LIMIT - state.likesUsedToday);
      },

      standOutsRemaining: () => {
        if (isDemoMode) return 99;
        const state = get();
        return Math.max(0, DAILY_STANDOUT_LIMIT - state.standOutsUsedToday);
      },

      hasReachedLikeLimit: () => {
        if (isDemoMode) return false;
        return get().likesUsedToday >= DAILY_LIKE_LIMIT;
      },

      hasReachedStandOutLimit: () => {
        if (isDemoMode) return false;
        return get().standOutsUsedToday >= DAILY_STANDOUT_LIMIT;
      },

      incrementLikes: () => {
        set((state) => ({ likesUsedToday: state.likesUsedToday + 1 }));
      },

      incrementStandOuts: () => {
        set((state) => ({ standOutsUsedToday: state.standOutsUsedToday + 1 }));
      },

      checkAndResetIfNewDay: () => {
        const today = getTodayDateString();
        if (get().lastResetDate !== today) {
          set({
            likesUsedToday: 0,
            standOutsUsedToday: 0,
            lastResetDate: today,
          });
        }
      },
    }),
    {
      name: "discover-limits-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        likesUsedToday: state.likesUsedToday,
        standOutsUsedToday: state.standOutsUsedToday,
        lastResetDate: state.lastResetDate,
      }),
    },
  ),
);
