import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrivateIntentKey, PrivateDesireTag, PrivateBoundary, DesireCategory } from '@/types';

interface PrivateProfile {
  username: string;
  bio: string;
  desireCategories: DesireCategory[];
  blurPhoto: boolean;
}

interface PrivateProfileState {
  // Legacy profile (used by PrivateProfileSection in incognito.tsx)
  profile: PrivateProfile;
  isSetup: boolean;
  setProfile: (updates: Partial<PrivateProfile>) => void;
  markSetup: () => void;

  // Wizard state
  currentStep: number;
  selectedPhotoIds: string[];
  selectedPhotoUrls: string[];
  blurredPhotoLocalUris: string[];
  blurredStorageIds: string[];
  blurredPhotoUrls: string[];

  // Category state
  intentKeys: PrivateIntentKey[];
  desireTags: PrivateDesireTag[];
  boundaries: PrivateBoundary[];
  privateBio: string;
  consentAgreed: boolean;

  // Auto-imported from main profile
  displayName: string;
  age: number;
  city: string;
  gender: string;

  // Flags
  isSetupComplete: boolean;
  convexProfileId: string | null;
  _hasHydrated: boolean;

  // Actions — wizard navigation
  setCurrentStep: (step: number) => void;

  // Actions — photo selection
  setSelectedPhotos: (ids: string[], urls: string[]) => void;

  // Actions — blurred photos
  setBlurredPhotoLocalUris: (uris: string[]) => void;
  setBlurredStorageIds: (ids: string[]) => void;
  setBlurredPhotoUrls: (urls: string[]) => void;

  // Actions — categories
  setIntentKeys: (keys: PrivateIntentKey[]) => void;
  setDesireTags: (tags: PrivateDesireTag[]) => void;
  setBoundaries: (boundaries: PrivateBoundary[]) => void;
  setPrivateBio: (bio: string) => void;
  setConsentAgreed: (agreed: boolean) => void;

  // Actions — profile info
  setProfileInfo: (info: { displayName: string; age: number; city: string; gender: string }) => void;

  // Actions — completion
  setIsSetupComplete: (complete: boolean) => void;
  setConvexProfileId: (id: string | null) => void;

  // Actions — reset
  resetWizard: () => void;

  // Hydration
  setHasHydrated: (hydrated: boolean) => void;
}

const initialWizardState = {
  currentStep: 1,
  selectedPhotoIds: [] as string[],
  selectedPhotoUrls: [] as string[],
  blurredPhotoLocalUris: [] as string[],
  blurredStorageIds: [] as string[],
  blurredPhotoUrls: [] as string[],
  intentKeys: [] as PrivateIntentKey[],
  desireTags: [] as PrivateDesireTag[],
  boundaries: [] as PrivateBoundary[],
  privateBio: '',
  consentAgreed: false,
  displayName: '',
  age: 0,
  city: '',
  gender: '',
  isSetupComplete: false,
  convexProfileId: null as string | null,
};

export const usePrivateProfileStore = create<PrivateProfileState>()(
  persist(
    (set) => ({
      // Legacy profile fields
      profile: {
        username: 'Anonymous_User',
        bio: '',
        desireCategories: [],
        blurPhoto: true,
      },
      isSetup: false,
      setProfile: (updates) =>
        set((state) => ({ profile: { ...state.profile, ...updates } })),
      markSetup: () => set({ isSetup: true }),

      // Wizard state
      ...initialWizardState,
      _hasHydrated: false,

      // Actions
      setCurrentStep: (step) => set({ currentStep: step }),
      setSelectedPhotos: (ids, urls) => set({ selectedPhotoIds: ids, selectedPhotoUrls: urls }),
      setBlurredPhotoLocalUris: (uris) => set({ blurredPhotoLocalUris: uris }),
      setBlurredStorageIds: (ids) => set({ blurredStorageIds: ids }),
      setBlurredPhotoUrls: (urls) => set({ blurredPhotoUrls: urls }),
      setIntentKeys: (keys) => set({ intentKeys: keys }),
      setDesireTags: (tags) => set({ desireTags: tags }),
      setBoundaries: (boundaries) => set({ boundaries }),
      setPrivateBio: (bio) => set({ privateBio: bio }),
      setConsentAgreed: (agreed) => set({ consentAgreed: agreed }),
      setProfileInfo: (info) => set(info),
      setIsSetupComplete: (complete) => set({ isSetupComplete: complete }),
      setConvexProfileId: (id) => set({ convexProfileId: id }),
      resetWizard: () => set(initialWizardState),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: 'private-profile-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        currentStep: state.currentStep,
        selectedPhotoIds: state.selectedPhotoIds,
        selectedPhotoUrls: state.selectedPhotoUrls,
        blurredStorageIds: state.blurredStorageIds,
        blurredPhotoUrls: state.blurredPhotoUrls,
        intentKeys: state.intentKeys,
        desireTags: state.desireTags,
        boundaries: state.boundaries,
        privateBio: state.privateBio,
        consentAgreed: state.consentAgreed,
        displayName: state.displayName,
        age: state.age,
        city: state.city,
        gender: state.gender,
        isSetupComplete: state.isSetupComplete,
        convexProfileId: state.convexProfileId,
        // Legacy
        profile: state.profile,
        isSetup: state.isSetup,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
