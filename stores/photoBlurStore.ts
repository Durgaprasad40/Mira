/**
 * photoBlurStore — In-memory cache for photo blur settings.
 *
 * STORAGE POLICY:
 * - blurEnabled: Convex `users.photoBlurred` is source of truth.
 *   Must be hydrated from Convex on component mount (edit-profile.tsx does this).
 * - blurredPhotos: Per-photo granular blur, LOCAL ONLY (not persisted to Convex).
 *   Resets on app restart. Used for preview before save.
 *
 * The global blur toggle (blurEnabled) syncs to Convex via togglePhotoBlur mutation.
 * The per-photo blur (blurredPhotos) is UI-only state.
 */
import { create } from 'zustand';

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

export const usePhotoBlurStore = create<PhotoBlurState>()((set, get) => ({
  userSettings: {},
  _hasHydrated: true, // Always ready - no AsyncStorage

  setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op

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
}));
