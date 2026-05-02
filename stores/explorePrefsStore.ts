/**
 * Explore Preferences Store - Phase 4 Intelligent UX
 *
 * Tracks user category preferences for personalized sorting:
 * - Click counts per category
 * - Last visited category
 * - Last visit timestamp
 *
 * Also tracks session-only engagement triggers:
 * - Session category visits (for "new people joining" nudge)
 * - Swipe counts (for progress feedback)
 * - Shown triggers (to prevent spam)
 *
 * Persists to AsyncStorage for cross-session memory.
 * NO backend dependency - purely frontend intelligence.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';

interface ExplorePrefsState {
  // Category click counts (for frequency-based sorting)
  categoryClickCounts: Record<string, number>;

  // Last visited category (for return boost)
  lastVisitedCategoryId: string | null;
  lastVisitTimestamp: number | null;

  // Session-only state (not persisted, resets on app restart)
  sessionCategoryVisits: Record<string, number>; // categoryId -> visit count this session
  sessionSwipeCount: number; // Total swipes this session
  shownTriggers: Set<string>; // Trigger IDs already shown (prevents spam)
  lastExploreExitTimestamp: number | null; // When user left Explore tab

  // Actions
  trackCategoryClick: (categoryId: string) => void;
  getCategoryScore: (categoryId: string, profileCount: number) => number;
  isFrequentCategory: (categoryId: string) => boolean;
  shouldShowReturnBoost: (categoryId: string) => boolean;

  // Session engagement actions
  trackCategoryVisit: (categoryId: string) => void;
  isRevisitInSession: (categoryId: string) => boolean;
  trackSwipe: () => number; // Returns new swipe count
  shouldShowSwipeProgress: () => boolean;
  markTriggerShown: (triggerId: string) => void;
  hasTriggerBeenShown: (triggerId: string) => boolean;
  trackExploreExit: () => void;
  shouldShowReturnHook: () => boolean;
  getReturnCategory: () => string | null;

  reset: () => void;
}

// Threshold for "Your vibe" tag (clicked at least 3 times)
const FREQUENT_CLICK_THRESHOLD = 3;

// Return boost shows if last visit was > 5 minutes ago
const RETURN_BOOST_MIN_GAP_MS = 5 * 60 * 1000;

// Return hook shows if user returns after > 10 minutes
const RETURN_HOOK_MIN_GAP_MS = 10 * 60 * 1000;

// Show swipe progress every N swipes
const SWIPE_PROGRESS_INTERVAL = 3;

const ACTIVE_EXPLORE_CATEGORY_IDS = new Set(EXPLORE_CATEGORIES.map((category) => category.id));

function isActiveExploreCategoryId(categoryId: string | null | undefined): categoryId is string {
  return typeof categoryId === 'string' && ACTIVE_EXPLORE_CATEGORY_IDS.has(categoryId);
}

function sanitizeCategoryClickCounts(categoryClickCounts: unknown): Record<string, number> {
  if (
    !categoryClickCounts ||
    typeof categoryClickCounts !== 'object' ||
    Array.isArray(categoryClickCounts)
  ) {
    return {};
  }

  const cleaned: Record<string, number> = {};
  for (const [categoryId, clickCount] of Object.entries(categoryClickCounts)) {
    if (isActiveExploreCategoryId(categoryId) && typeof clickCount === 'number' && Number.isFinite(clickCount)) {
      cleaned[categoryId] = clickCount;
    }
  }
  return cleaned;
}

function sanitizeLastVisitedCategoryId(categoryId: unknown): string | null {
  if (typeof categoryId !== 'string') return null;
  return isActiveExploreCategoryId(categoryId) ? categoryId : null;
}

function sanitizeLastVisitTimestamp(timestamp: unknown, lastVisitedCategoryId: string | null): number | null {
  if (!lastVisitedCategoryId) return null;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : null;
}

export const useExplorePrefsStore = create<ExplorePrefsState>()(
  persist(
    (set, get) => ({
      categoryClickCounts: {},
      lastVisitedCategoryId: null,
      lastVisitTimestamp: null,

      // Session-only state (initialized fresh, not persisted)
      sessionCategoryVisits: {},
      sessionSwipeCount: 0,
      shownTriggers: new Set<string>(),
      lastExploreExitTimestamp: null,

      // Track when user taps a category tile
      trackCategoryClick: (categoryId: string) => {
        if (!isActiveExploreCategoryId(categoryId)) return;

        set((state) => ({
          categoryClickCounts: {
            ...state.categoryClickCounts,
            [categoryId]: (state.categoryClickCounts[categoryId] ?? 0) + 1,
          },
          lastVisitedCategoryId: categoryId,
          lastVisitTimestamp: Date.now(),
        }));
      },

      // Calculate smart score: count + (clickWeight * 2)
      getCategoryScore: (categoryId: string, profileCount: number) => {
        if (!isActiveExploreCategoryId(categoryId)) return profileCount;

        const clickCount = get().categoryClickCounts[categoryId] ?? 0;
        return profileCount + (clickCount * 2);
      },

      // Check if category is frequently clicked (for "Your vibe" tag)
      isFrequentCategory: (categoryId: string) => {
        if (!isActiveExploreCategoryId(categoryId)) return false;

        const clickCount = get().categoryClickCounts[categoryId] ?? 0;
        return clickCount >= FREQUENT_CLICK_THRESHOLD;
      },

      // Check if should show return boost for a category
      shouldShowReturnBoost: (categoryId: string) => {
        if (!isActiveExploreCategoryId(categoryId)) return false;

        const { lastVisitedCategoryId, lastVisitTimestamp } = get();
        if (lastVisitedCategoryId !== categoryId) return false;
        if (!lastVisitTimestamp) return false;

        const timeSinceLastVisit = Date.now() - lastVisitTimestamp;
        return timeSinceLastVisit > RETURN_BOOST_MIN_GAP_MS;
      },

      // --- Session engagement actions ---

      // Track category visit within session (for time-based nudge)
      trackCategoryVisit: (categoryId: string) => {
        if (!isActiveExploreCategoryId(categoryId)) return;

        set((state) => ({
          sessionCategoryVisits: {
            ...state.sessionCategoryVisits,
            [categoryId]: (state.sessionCategoryVisits[categoryId] ?? 0) + 1,
          },
        }));
      },

      // Check if this is a revisit within the same session
      isRevisitInSession: (categoryId: string) => {
        if (!isActiveExploreCategoryId(categoryId)) return false;

        const visits = get().sessionCategoryVisits[categoryId] ?? 0;
        return visits > 1; // More than 1 means revisit
      },

      // Track swipe and return new count
      trackSwipe: () => {
        const newCount = get().sessionSwipeCount + 1;
        set({ sessionSwipeCount: newCount });
        return newCount;
      },

      // Check if should show swipe progress (every 3 swipes, but only once per milestone)
      shouldShowSwipeProgress: () => {
        const count = get().sessionSwipeCount;
        if (count === 0 || count % SWIPE_PROGRESS_INTERVAL !== 0) return false;

        const triggerId = `swipe-progress-${count}`;
        if (get().shownTriggers.has(triggerId)) return false;

        // Mark as shown
        set((state) => ({
          shownTriggers: new Set(state.shownTriggers).add(triggerId),
        }));
        return true;
      },

      // Mark a trigger as shown (prevents spam)
      markTriggerShown: (triggerId: string) => {
        set((state) => ({
          shownTriggers: new Set(state.shownTriggers).add(triggerId),
        }));
      },

      // Check if trigger has been shown
      hasTriggerBeenShown: (triggerId: string) => {
        return get().shownTriggers.has(triggerId);
      },

      // Track when user exits Explore tab
      trackExploreExit: () => {
        set({ lastExploreExitTimestamp: Date.now() });
      },

      // Check if should show return hook (returned after >10 min)
      shouldShowReturnHook: () => {
        const { lastExploreExitTimestamp, lastVisitedCategoryId } = get();
        if (!lastExploreExitTimestamp || !lastVisitedCategoryId) return false;
        if (!isActiveExploreCategoryId(lastVisitedCategoryId)) return false;

        const timeSinceExit = Date.now() - lastExploreExitTimestamp;
        if (timeSinceExit <= RETURN_HOOK_MIN_GAP_MS) return false;

        // Only show once per return
        const triggerId = `return-hook-${lastExploreExitTimestamp}`;
        if (get().shownTriggers.has(triggerId)) return false;

        return true;
      },

      // Get the category to return to
      getReturnCategory: () => {
        const lastVisitedCategoryId = get().lastVisitedCategoryId;
        return isActiveExploreCategoryId(lastVisitedCategoryId) ? lastVisitedCategoryId : null;
      },

      // Reset all preferences
      reset: () => {
        set({
          categoryClickCounts: {},
          lastVisitedCategoryId: null,
          lastVisitTimestamp: null,
          sessionCategoryVisits: {},
          sessionSwipeCount: 0,
          shownTriggers: new Set<string>(),
          lastExploreExitTimestamp: null,
        });
      },
    }),
    {
      name: 'mira-explore-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist these fields, not session state
      partialize: (state) => ({
        categoryClickCounts: sanitizeCategoryClickCounts(state.categoryClickCounts),
        lastVisitedCategoryId: sanitizeLastVisitedCategoryId(state.lastVisitedCategoryId),
        lastVisitTimestamp: sanitizeLastVisitTimestamp(
          state.lastVisitTimestamp,
          sanitizeLastVisitedCategoryId(state.lastVisitedCategoryId),
        ),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<ExplorePrefsState>;
        const lastVisitedCategoryId = sanitizeLastVisitedCategoryId(persisted.lastVisitedCategoryId);

        return {
          ...currentState,
          ...persisted,
          categoryClickCounts: sanitizeCategoryClickCounts(persisted.categoryClickCounts),
          lastVisitedCategoryId,
          lastVisitTimestamp: sanitizeLastVisitTimestamp(persisted.lastVisitTimestamp, lastVisitedCategoryId),
          sessionCategoryVisits: currentState.sessionCategoryVisits,
          sessionSwipeCount: currentState.sessionSwipeCount,
          shownTriggers: currentState.shownTriggers,
          lastExploreExitTimestamp: currentState.lastExploreExitTimestamp,
        };
      },
    }
  )
);
