/**
 * Media View Store
 *
 * Tracks which media items the user has viewed at least once.
 * Used to hide the "Hold to view" hint after first successful view.
 *
 * Also prepares data model for future "view once" functionality.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface MediaViewState {
  /**
   * Set of media IDs (message IDs) that user has viewed at least once.
   * Used to hide the "Hold to view" hint.
   */
  viewedMediaIds: Set<string>;

  /**
   * Set of media IDs that were "view once" and have been consumed.
   * Future feature: these media items can never be viewed again.
   */
  consumedOnceIds: Set<string>;

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

export const useMediaViewStore = create<MediaViewState>()(
  persist(
    (set, get) => ({
      viewedMediaIds: new Set<string>(),
      consumedOnceIds: new Set<string>(),
      _hasHydrated: false,

      markViewed: (mediaId: string) => {
        set((state) => {
          const newSet = new Set(state.viewedMediaIds);
          newSet.add(mediaId);
          return { viewedMediaIds: newSet };
        });
      },

      markConsumed: (mediaId: string) => {
        set((state) => {
          const newSet = new Set(state.consumedOnceIds);
          newSet.add(mediaId);
          return { consumedOnceIds: newSet };
        });
      },

      hasBeenViewed: (mediaId: string) => {
        return get().viewedMediaIds.has(mediaId);
      },

      isConsumed: (mediaId: string) => {
        return get().consumedOnceIds.has(mediaId);
      },

      setHasHydrated: (hydrated: boolean) => {
        set({ _hasHydrated: hydrated });
      },
    }),
    {
      name: 'media-view-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Custom serialization for Set objects
      partialize: (state) => ({
        viewedMediaIds: Array.from(state.viewedMediaIds),
        consumedOnceIds: Array.from(state.consumedOnceIds),
      }),
      merge: (persisted: any, current) => ({
        ...current,
        viewedMediaIds: new Set(persisted?.viewedMediaIds || []),
        consumedOnceIds: new Set(persisted?.consumedOnceIds || []),
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
