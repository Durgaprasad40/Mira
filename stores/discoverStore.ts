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

  // Random match control state (F2-A)
  hasUserShownIntent: boolean;
  swipeCount: number;
  profileViewCount: number;
  lastRandomMatchAt: number | null;
  randomMatchShownThisSession: boolean;

  // Computed-like getters
  likesRemaining: () => number;
  standOutsRemaining: () => number;
  hasReachedLikeLimit: () => boolean;
  hasReachedStandOutLimit: () => boolean;

  // Actions
  incrementLikes: () => void;
  incrementStandOuts: () => void;
  checkAndResetIfNewDay: () => void;

  // Random match control actions (F2-A)
  markIntent: () => void;
  incSwipe: () => void;
  incProfileView: () => void;
  setLastRandomMatchAt: (ts: number) => void;
  setRandomMatchShownThisSession: (v: boolean) => void;
  resetRandomMatchSessionFlags: () => void;

  // F2-B: Discover-only entry point for random match popup
  // This function should ONLY be called from DiscoverCardStack after swipe/profile view.
  // Returns true if a random match popup should be shown (gating logic added in F2-C).
  maybeTriggerRandomMatch: () => boolean;
}

export const useDiscoverStore = create<DiscoverState>()(
  persist(
    (set, get) => ({
      likesUsedToday: 0,
      standOutsUsedToday: 0,
      lastResetDate: getTodayDateString(),

      // Random match control state defaults (F2-A)
      hasUserShownIntent: false,
      swipeCount: 0,
      profileViewCount: 0,
      lastRandomMatchAt: null,
      randomMatchShownThisSession: false,

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

      // Random match control actions (F2-A)
      markIntent: () => {
        set((s) => (s.hasUserShownIntent ? s : { hasUserShownIntent: true }));
      },

      incSwipe: () => {
        const { swipeCount, hasUserShownIntent } = get();
        const newCount = swipeCount + 1;
        const newIntent = hasUserShownIntent || newCount >= 1;
        set({ swipeCount: newCount, hasUserShownIntent: newIntent });
        if (__DEV__) console.log('[F2-A] incSwipe:', newCount, 'intent:', newIntent);
      },

      incProfileView: () => {
        const { profileViewCount, hasUserShownIntent } = get();
        const newCount = profileViewCount + 1;
        const newIntent = hasUserShownIntent || newCount >= 3;
        set({ profileViewCount: newCount, hasUserShownIntent: newIntent });
        if (__DEV__) console.log('[F2-A] incProfileView:', newCount, 'intent:', newIntent);
      },

      setLastRandomMatchAt: (ts: number) => {
        set({ lastRandomMatchAt: ts });
      },

      setRandomMatchShownThisSession: (v: boolean) => {
        set({ randomMatchShownThisSession: v });
      },

      resetRandomMatchSessionFlags: () => {
        set({ randomMatchShownThisSession: false });
      },

      // F2-B: Discover-only entry point for random match popup
      // NO-OP placeholder for F2-B. Gating logic (cooldown, probability, intent check) added in F2-C.
      // IMPORTANT: This function must ONLY be called from DiscoverCardStack.
      maybeTriggerRandomMatch: () => {
        if (__DEV__) console.log('[F2-B] maybeTriggerRandomMatch called (NO-OP placeholder)');
        // F2-B: Always return false - no popup triggered yet.
        // F2-C will add: intent check, cooldown check, probability roll, session flag.
        return false;
      },
    }),
    {
      name: "discover-limits-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        likesUsedToday: state.likesUsedToday,
        standOutsUsedToday: state.standOutsUsedToday,
        lastResetDate: state.lastResetDate,
        // Persist random match control state (F2-A)
        // Note: randomMatchShownThisSession is NOT persisted (session-only)
        lastRandomMatchAt: state.lastRandomMatchAt,
      }),
    },
  ),
);
