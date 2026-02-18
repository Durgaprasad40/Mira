import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isDemoMode } from "@/hooks/useConvex";

const DAILY_LIKE_LIMIT = 25;
const DAILY_STANDOUT_LIMIT = 2;

// F2-C: Random match popup gating constants
const RANDOM_MATCH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const RANDOM_MATCH_DISMISS_BACKOFF_MS = 3 * 24 * 60 * 60 * 1000; // +3 days on dismiss
const RANDOM_MATCH_PROB = 0.10; // 10% chance per eligible swipe
const MIN_SWIPES_FOR_INTENT = 5; // User must swipe 5 times before eligible
const MIN_PROFILE_VIEWS_FOR_INTENT = 3; // OR view 3 profiles

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
  lastRandomMatchDismissAt: number | null; // F2: Track dismiss for +3 day backoff
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
  setLastRandomMatchDismissAt: (ts: number) => void; // F2: Dismiss backoff
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
      lastRandomMatchDismissAt: null, // F2: Dismiss backoff tracking
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
        // F2: Require MIN_SWIPES_FOR_INTENT (5) swipes before intent is set
        const newIntent = hasUserShownIntent || newCount >= MIN_SWIPES_FOR_INTENT;
        set({ swipeCount: newCount, hasUserShownIntent: newIntent });
        if (__DEV__) console.log('[F2-A] incSwipe:', newCount, '/', MIN_SWIPES_FOR_INTENT, 'intent:', newIntent);
      },

      incProfileView: () => {
        const { profileViewCount, hasUserShownIntent } = get();
        const newCount = profileViewCount + 1;
        // F2: Require MIN_PROFILE_VIEWS_FOR_INTENT (3) views before intent is set
        const newIntent = hasUserShownIntent || newCount >= MIN_PROFILE_VIEWS_FOR_INTENT;
        set({ profileViewCount: newCount, hasUserShownIntent: newIntent });
        if (__DEV__) console.log('[F2-A] incProfileView:', newCount, '/', MIN_PROFILE_VIEWS_FOR_INTENT, 'intent:', newIntent);
      },

      setLastRandomMatchAt: (ts: number) => {
        set({ lastRandomMatchAt: ts });
      },

      setLastRandomMatchDismissAt: (ts: number) => {
        set({ lastRandomMatchDismissAt: ts });
        if (__DEV__) console.log('[F2] dismiss backoff set, next eligible:', new Date(ts + RANDOM_MATCH_DISMISS_BACKOFF_MS).toISOString());
      },

      setRandomMatchShownThisSession: (v: boolean) => {
        set({ randomMatchShownThisSession: v });
      },

      resetRandomMatchSessionFlags: () => {
        set({ randomMatchShownThisSession: false });
      },

      // F2-B/F2-C: Discover-only entry point for random match popup with gating logic
      // IMPORTANT: This function must ONLY be called from DiscoverCardStack.
      maybeTriggerRandomMatch: () => {
        const { hasUserShownIntent, randomMatchShownThisSession, lastRandomMatchAt, lastRandomMatchDismissAt } = get();
        const now = Date.now();

        // Gate 1: User must have shown intent (5 swipes OR 3 profile views)
        if (!hasUserShownIntent) {
          if (__DEV__) console.log('[F2-C] random match blocked: no intent (need 5 swipes or 3 views)');
          return false;
        }

        // Gate 2: Only one random match per session
        if (randomMatchShownThisSession) {
          if (__DEV__) console.log('[F2-C] random match blocked: session limit (1/session)');
          return false;
        }

        // Gate 3: Cooldown - 24 hours since last random match shown
        if (lastRandomMatchAt !== null && (now - lastRandomMatchAt) < RANDOM_MATCH_COOLDOWN_MS) {
          const hoursLeft = Math.ceil((RANDOM_MATCH_COOLDOWN_MS - (now - lastRandomMatchAt)) / (60 * 60 * 1000));
          if (__DEV__) console.log('[F2-C] random match blocked: cooldown', hoursLeft, 'hrs left');
          return false;
        }

        // Gate 4: Dismiss backoff - +3 days since last dismiss
        if (lastRandomMatchDismissAt !== null && (now - lastRandomMatchDismissAt) < RANDOM_MATCH_DISMISS_BACKOFF_MS) {
          const daysLeft = Math.ceil((RANDOM_MATCH_DISMISS_BACKOFF_MS - (now - lastRandomMatchDismissAt)) / (24 * 60 * 60 * 1000));
          if (__DEV__) console.log('[F2-C] random match blocked: dismiss backoff', daysLeft, 'days left');
          return false;
        }

        // Gate 5: Probability roll (10% chance)
        const roll = Math.random();
        if (roll >= RANDOM_MATCH_PROB) {
          if (__DEV__) console.log('[F2-C] random match blocked: prob roll', (roll * 100).toFixed(1) + '%', '>=', (RANDOM_MATCH_PROB * 100) + '%');
          return false;
        }

        // All gates passed - TRIGGER random match (atomic update)
        if (__DEV__) console.log('[F2-C] random match TRIGGERED (roll:', (roll * 100).toFixed(1) + '%)');
        set((s) => ({ ...s, randomMatchShownThisSession: true, lastRandomMatchAt: now }));
        return true;
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
        lastRandomMatchDismissAt: state.lastRandomMatchDismissAt, // F2: Persist dismiss backoff
      }),
    },
  ),
);
