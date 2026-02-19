/**
 * confessPreviewStore — Tracks one-time profile preview usage for confession receivers
 *
 * When a user is tagged in a confession, they can view the confessor's profile ONCE.
 * This store persists the "previewUsed" state to ensure it survives app restarts.
 *
 * Key format: `${confessionId}_${receiverId}` → ensures each receiver gets one preview per confession
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HYDRATION_TIMEOUT_MS = 3000;

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

export const useConfessPreviewStore = create<ConfessPreviewState>()(
  persist(
    (set, get) => ({
      usedPreviews: {},

      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),

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
    }),
    {
      name: 'confess-preview-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('[confessPreviewStore] Rehydration error:', error);
        if (state) state.setHasHydrated(true);
      },
    }
  )
);

// Hydration timeout fallback
let _confessPreviewHydrationTimeoutId: ReturnType<typeof setTimeout> | null = null;
if (_confessPreviewHydrationTimeoutId !== null) clearTimeout(_confessPreviewHydrationTimeoutId);
_confessPreviewHydrationTimeoutId = setTimeout(() => {
  if (!useConfessPreviewStore.getState()._hasHydrated) {
    console.warn('[HYDRATION] confessPreviewStore timed out, continuing');
    useConfessPreviewStore.getState().setHasHydrated(true);
  }
  _confessPreviewHydrationTimeoutId = null;
}, HYDRATION_TIMEOUT_MS);
