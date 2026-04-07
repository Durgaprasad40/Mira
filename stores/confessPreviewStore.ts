/**
 * confessPreviewStore — Tracks profile preview usage for confessions
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 *
 * Tracks two types of previews:
 * 1. Confession previews: `${confessionId}_${receiverId}` - one preview per confession per receiver
 * 2. Tagged profile views: `${viewerId}_${targetUserId}` - soft tracking for tagged profiles
 *
 * Tagged profile views use soft tracking:
 * - First view: shown as "special" preview
 * - Subsequent views: still allowed, just not promoted/highlighted
 */
import { create } from 'zustand';

interface ConfessPreviewState {
  // Map of previewKey → boolean (true = preview has been used)
  usedPreviews: Record<string, boolean>;
  // Map of viewerTarget → boolean (true = tagged profile has been viewed at least once)
  viewedTaggedProfiles: Record<string, boolean>;

  // Check if preview has been used for a specific confession/receiver combo
  isPreviewUsed: (confessionId: string, receiverId: string) => boolean;

  // Mark preview as used (call AFTER successfully opening profile)
  markPreviewUsed: (confessionId: string, receiverId: string) => void;

  // Check if tagged profile has been viewed (soft tracking)
  hasViewedTaggedProfile: (viewerId: string, targetUserId: string) => boolean;

  // Mark tagged profile as viewed (soft tracking - doesn't block, just tracks)
  markTaggedProfileViewed: (viewerId: string, targetUserId: string) => void;

  // Reset for testing/debugging
  resetAllPreviews: () => void;

  // Hydration
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

const getPreviewKey = (confessionId: string, receiverId: string): string => {
  return `${confessionId}_${receiverId}`;
};

const getViewerTargetKey = (viewerId: string, targetUserId: string): string => {
  return `view_${viewerId}_${targetUserId}`;
};

export const useConfessPreviewStore = create<ConfessPreviewState>()((set, get) => ({
  usedPreviews: {},
  viewedTaggedProfiles: {},

  _hasHydrated: true, // Always ready - no AsyncStorage
  setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op

  isPreviewUsed: (confessionId: string, receiverId: string) => {
    const key = getPreviewKey(confessionId, receiverId);
    return !!get().usedPreviews[key];
  },

  markPreviewUsed: (confessionId: string, receiverId: string) => {
    const key = getPreviewKey(confessionId, receiverId);
    set((state) => ({
      usedPreviews: {
        ...state.usedPreviews,
        [key]: true,
      },
    }));
  },

  hasViewedTaggedProfile: (viewerId: string, targetUserId: string) => {
    const key = getViewerTargetKey(viewerId, targetUserId);
    return !!get().viewedTaggedProfiles[key];
  },

  markTaggedProfileViewed: (viewerId: string, targetUserId: string) => {
    const key = getViewerTargetKey(viewerId, targetUserId);
    set((state) => ({
      viewedTaggedProfiles: {
        ...state.viewedTaggedProfiles,
        [key]: true,
      },
    }));
  },

  resetAllPreviews: () => {
    set({ usedPreviews: {}, viewedTaggedProfiles: {} });
  },
}));
