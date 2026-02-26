import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrivateIntentKey, PrivateDesireTag, PrivateBoundary, DesireCategory } from '@/types';

/** Parse "YYYY-MM-DD" to local Date (noon to avoid DST issues) */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0);
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

// Version constant - bump this to force re-setup
export const CURRENT_PHASE2_SETUP_VERSION = 1;

// Maximum Phase-1 photos that can be imported to Phase-2
export const MAX_PHASE1_PHOTO_IMPORTS = 3;

// Type for Phase-1 profile data imported during Phase-2 onboarding
export interface Phase1ProfileData {
  name: string;
  photos: { url: string }[];
  bio?: string;
  gender?: string;
  dateOfBirth?: string;
  city?: string;
  activities?: string[]; // Hobbies/activities from Phase-1
  maxDistance?: number;
  isVerified?: boolean;
}

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

  // Auto-imported from main profile (Phase-1 → Phase-2)
  displayName: string;
  age: number;
  city: string;
  gender: string;
  hobbies: string[];      // Imported from Phase-1 activities
  isVerified: boolean;    // Imported from Phase-1 verification status

  // Flags
  isSetupComplete: boolean;
  convexProfileId: string | null;
  _hasHydrated: boolean;

  // Phase-2 setup tracking
  acceptedTermsAt: number | null;
  phase2SetupVersion: number | null;
  blurMyPhoto: boolean;
  phase1PhotoUrls: string[];  // imported from Phase-1 for reference

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
  resetPhase2: () => void; // Full Phase-2 profile reset (clears everything)

  // Hydration
  setHasHydrated: (hydrated: boolean) => void;

  // Phase-2 setup actions
  setAcceptedTermsAt: (timestamp: number) => void;
  setBlurMyPhoto: (blur: boolean) => void;
  importPhase1Data: (data: Phase1ProfileData) => void;
  completeSetup: () => void;
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
  hobbies: [] as string[],
  isVerified: false,
  isSetupComplete: false,
  convexProfileId: null as string | null,
  // Phase-2 setup tracking
  acceptedTermsAt: null as number | null,
  phase2SetupVersion: null as number | null,
  blurMyPhoto: false,
  phase1PhotoUrls: [] as string[],
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
      resetPhase2: () => set({
        // Reset all wizard state
        ...initialWizardState,
        // Also reset legacy profile fields
        profile: {
          username: 'Anonymous_User',
          bio: '',
          desireCategories: [],
          blurPhoto: true,
        },
        isSetup: false,
      }),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      // Phase-2 setup actions
      setAcceptedTermsAt: (timestamp) => set({ acceptedTermsAt: timestamp }),
      setBlurMyPhoto: (blur) => set({ blurMyPhoto: blur }),
      importPhase1Data: (data) => {
        // Calculate age from DOB using local parsing (not UTC)
        let age = 0;
        if (data.dateOfBirth) {
          const dob = parseDOBString(data.dateOfBirth);
          const today = new Date();
          age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
          }
        }

        set({
          // Store Phase-1 photo URLs (limited to MAX_PHASE1_PHOTO_IMPORTS)
          phase1PhotoUrls: data.photos.slice(0, MAX_PHASE1_PHOTO_IMPORTS).map((p) => p.url),
          // Import profile info
          displayName: data.name || '',
          age,
          city: data.city || '',
          gender: data.gender || '',
          // Import hobbies from activities
          hobbies: data.activities || [],
          // Import verification status
          isVerified: data.isVerified || false,
        });
      },
      completeSetup: () => set({
        isSetupComplete: true,
        phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
      }),
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
        hobbies: state.hobbies,
        isVerified: state.isVerified,
        isSetupComplete: state.isSetupComplete,
        convexProfileId: state.convexProfileId,
        // Phase-2 setup tracking
        acceptedTermsAt: state.acceptedTermsAt,
        phase2SetupVersion: state.phase2SetupVersion,
        blurMyPhoto: state.blurMyPhoto,
        phase1PhotoUrls: state.phase1PhotoUrls,
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

// Helper to validate photo URLs
function isValidPhotoUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    url !== 'undefined' &&
    url !== 'null' &&
    (url.startsWith('http') || url.startsWith('file://'))
  );
}

// Selector: Check if Phase-2 setup is complete and valid
export const selectIsSetupValid = (state: PrivateProfileState): boolean => {
  // Must be hydrated first
  if (!state._hasHydrated) return false;

  // Must have completed setup
  if (!state.isSetupComplete) return false;

  // Version must match current
  if (state.phase2SetupVersion !== CURRENT_PHASE2_SETUP_VERSION) return false;

  // Must have accepted terms
  if (state.acceptedTermsAt === null) return false;

  // Must have at least 2 valid photos
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  if (validPhotos.length < 2) return false;

  // Must have at least 3 categories
  if (state.intentKeys.length < 3) return false;

  // Bio must be at least 10 characters
  if (state.privateBio.trim().length < 10) return false;

  return true;
};

// Selector: Check if photos step is valid (min 2 selected)
export const selectCanContinuePhotos = (state: PrivateProfileState): boolean => {
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  return validPhotos.length >= 2;
};

// Selector: Check if categories step is valid (min 3, max 10 + bio)
export const selectCanContinueCategories = (state: PrivateProfileState): boolean => {
  return (
    state.intentKeys.length >= 3 &&
    state.intentKeys.length <= 10 &&
    state.privateBio.trim().length >= 10
  );
};
