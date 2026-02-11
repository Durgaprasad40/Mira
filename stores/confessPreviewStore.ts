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

interface ConfessPreviewState {
  // Map of previewKey → boolean (true = preview has been used)
  usedPreviews: Record<string, boolean>;

  // Check if preview has been used for a specific confession/receiver combo
  isPreviewUsed: (confessionId: string, receiverId: string) => boolean;

  // Mark preview as used (call AFTER successfully opening profile)
  markPreviewUsed: (confessionId: string, receiverId: string) => void;

  // Reset for testing/debugging
  resetAllPreviews: () => void;
}

const getPreviewKey = (confessionId: string, receiverId: string): string => {
  return `${confessionId}_${receiverId}`;
};

export const useConfessPreviewStore = create<ConfessPreviewState>()(
  persist(
    (set, get) => ({
      usedPreviews: {},

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
    }
  )
);
