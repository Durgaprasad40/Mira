/**
 * photoBlurStore — Persisted store for per-photo blur settings.
 *
 * Stores blur preferences keyed by userId so they persist across:
 * - Navigation (leaving/returning to Edit Profile)
 * - App restarts
 * - Logout/login (per-account)
 *
 * Uses AsyncStorage via zustand persist.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UserBlurSettings {
  blurEnabled: boolean;
  blurredPhotos: Record<number, boolean>;
}

interface PhotoBlurState {
  // Settings keyed by userId
  userSettings: Record<string, UserBlurSettings>;
  _hasHydrated: boolean;

  // Actions
  setHasHydrated: (state: boolean) => void;
  getBlurEnabled: (userId: string) => boolean;
  getBlurredPhotos: (userId: string) => Record<number, boolean>;
  setBlurEnabled: (userId: string, enabled: boolean) => void;
  setBlurredPhotos: (userId: string, blurredPhotos: Record<number, boolean>) => void;
  togglePhotoBlur: (userId: string, photoIndex: number) => void;
  // Cleanup invalid indices when photos change
  cleanupBlurredPhotos: (userId: string, validPhotoCount: number) => void;
}

const DEFAULT_SETTINGS: UserBlurSettings = {
  blurEnabled: false,
  blurredPhotos: {},
};

// Stable empty object reference to avoid creating new {} on every call
const EMPTY_BLURRED_PHOTOS: Record<number, boolean> = {};

export const usePhotoBlurStore = create<PhotoBlurState>()(
  persist(
    (set, get) => ({
      userSettings: {},
      _hasHydrated: false,

      setHasHydrated: (state) => set({ _hasHydrated: state }),

      getBlurEnabled: (userId) => {
        if (!userId) return false;
        return get().userSettings[userId]?.blurEnabled ?? false;
      },

      getBlurredPhotos: (userId) => {
        if (!userId) return EMPTY_BLURRED_PHOTOS;
        return get().userSettings[userId]?.blurredPhotos ?? EMPTY_BLURRED_PHOTOS;
      },

      setBlurEnabled: (userId, enabled) => {
        if (!userId) return;
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [userId]: {
              ...DEFAULT_SETTINGS,
              ...state.userSettings[userId],
              blurEnabled: enabled,
            },
          },
        }));
      },

      setBlurredPhotos: (userId, blurredPhotos) => {
        if (!userId) return;
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [userId]: {
              ...DEFAULT_SETTINGS,
              ...state.userSettings[userId],
              blurredPhotos,
            },
          },
        }));
      },

      togglePhotoBlur: (userId, photoIndex) => {
        if (!userId) return;
        set((state) => {
          const currentSettings = state.userSettings[userId] ?? DEFAULT_SETTINGS;
          const currentBlurred = currentSettings.blurredPhotos[photoIndex] ?? false;
          return {
            userSettings: {
              ...state.userSettings,
              [userId]: {
                ...currentSettings,
                blurredPhotos: {
                  ...currentSettings.blurredPhotos,
                  [photoIndex]: !currentBlurred,
                },
              },
            },
          };
        });
      },

      // Remove blur state for indices >= validPhotoCount (when photos are deleted)
      cleanupBlurredPhotos: (userId, validPhotoCount) => {
        if (!userId) return;
        set((state) => {
          const currentSettings = state.userSettings[userId];
          if (!currentSettings) return state;

          const cleanedBlurredPhotos: Record<number, boolean> = {};
          for (const [key, value] of Object.entries(currentSettings.blurredPhotos)) {
            const index = parseInt(key, 10);
            if (index < validPhotoCount) {
              cleanedBlurredPhotos[index] = value;
            }
          }

          return {
            userSettings: {
              ...state.userSettings,
              [userId]: {
                ...currentSettings,
                blurredPhotos: cleanedBlurredPhotos,
              },
            },
          };
        });
      },
    }),
    {
      name: 'mira-photo-blur-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        if (__DEV__) {
          console.log('[photoBlurStore] Hydrated', {
            userCount: Object.keys(state?.userSettings ?? {}).length,
          });
        }
      },
      partialize: (state) => ({
        userSettings: state.userSettings,
      }),
    }
  )
);
