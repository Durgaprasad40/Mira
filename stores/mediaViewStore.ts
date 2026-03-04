/**
 * Media View Store
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 *
 * Tracks which media items the user has viewed at least once.
 * Used to hide the "Hold to view" hint after first successful view.
 *
 * Also prepares data model for future "view once" functionality.
 *
 * Bounded retention: keeps only most recent N IDs to prevent unbounded growth.
 */
import { create } from 'zustand';

// Max IDs to retain (evict oldest when exceeded)
const MAX_RETAINED_IDS = 2000;

interface MediaViewState {
  /**
   * Set of media IDs (message IDs) that user has viewed at least once.
   * Used to hide the "Hold to view" hint.
   */
  viewedMediaIds: Set<string>;

  /**
   * Array maintaining insertion order for viewedMediaIds (oldest first).
   * Used for eviction when exceeding MAX_RETAINED_IDS.
   */
  viewedMediaOrder: string[];

  /**
   * Set of media IDs that were "view once" and have been consumed.
   * Future feature: these media items can never be viewed again.
   */
  consumedOnceIds: Set<string>;

  /**
   * Array maintaining insertion order for consumedOnceIds (oldest first).
   */
  consumedOnceOrder: string[];

  /** Mark a media as viewed (hides hint on subsequent views) */
  markViewed: (mediaId: string) => void;

  /** Mark a "view once" media as consumed (permanently unavailable) */
  markConsumed: (mediaId: string) => void;

  /** Check if media has been viewed before */
  hasBeenViewed: (mediaId: string) => boolean;

  /** Check if "view once" media has been consumed */
  isConsumed: (mediaId: string) => boolean;

  /** Hydration flag */
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useMediaViewStore = create<MediaViewState>()((set, get) => ({
  viewedMediaIds: new Set<string>(),
  viewedMediaOrder: [],
  consumedOnceIds: new Set<string>(),
  consumedOnceOrder: [],
  _hasHydrated: true, // Always ready - no AsyncStorage

  markViewed: (mediaId: string) => {
    set((state) => {
      // Skip if already exists
      if (state.viewedMediaIds.has(mediaId)) return state;

      const newSet = new Set(state.viewedMediaIds);
      const newOrder = [...state.viewedMediaOrder];
      newSet.add(mediaId);
      newOrder.push(mediaId);

      // Evict oldest if exceeding max
      while (newOrder.length > MAX_RETAINED_IDS) {
        const oldest = newOrder.shift();
        if (oldest) newSet.delete(oldest);
      }

      return { viewedMediaIds: newSet, viewedMediaOrder: newOrder };
    });
  },

  markConsumed: (mediaId: string) => {
    set((state) => {
      // Skip if already exists
      if (state.consumedOnceIds.has(mediaId)) return state;

      const newSet = new Set(state.consumedOnceIds);
      const newOrder = [...state.consumedOnceOrder];
      newSet.add(mediaId);
      newOrder.push(mediaId);

      // Evict oldest if exceeding max
      while (newOrder.length > MAX_RETAINED_IDS) {
        const oldest = newOrder.shift();
        if (oldest) newSet.delete(oldest);
      }

      return { consumedOnceIds: newSet, consumedOnceOrder: newOrder };
    });
  },

  hasBeenViewed: (mediaId: string) => {
    return get().viewedMediaIds.has(mediaId);
  },

  isConsumed: (mediaId: string) => {
    return get().consumedOnceIds.has(mediaId);
  },

  setHasHydrated: (hydrated: boolean) => {
    set({ _hasHydrated: true }); // No-op
  },
}));
