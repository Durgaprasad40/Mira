/**
 * confessPreviewStore — Tracks one-time profile preview usage for confession receivers
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 *
 * When a user is tagged in a confession, they can view the confessor's profile ONCE.
 * This store tracks the "previewUsed" state in memory only.
 *
 * Key format: `${confessionId}_${receiverId}` → ensures each receiver gets one preview per confession
 */
import { create } from 'zustand';

interface ConfessPreviewState {
  // Map of previewKey → boolean (true = preview has been used)
  usedPreviews: Record<string, boolean>;

  // Check if preview has been used for a specific confession/receiver combo
  isPreviewUsed: (confessionId: string, receiverId: string) => boolean;

  // Mark preview as used (call AFTER successfully opening profile)
  markPreviewUsed: (confessionId: string, receiverId: string) => void;

  // Reset for testing/debugging
  resetAllPreviews: () => void;

  // Hydration
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

const getPreviewKey = (confessionId: string, receiverId: string): string => {
  return `${confessionId}_${receiverId}`;
};

export const useConfessPreviewStore = create<ConfessPreviewState>()((set, get) => ({
  usedPreviews: {},

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

  resetAllPreviews: () => {
    set({ usedPreviews: {} });
  },
}));
