import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrivateIntentKey, PrivateDesireTag, PrivateBoundary, DesireCategory, PhotoSlots9 } from '@/types';
import { createEmptyPhotoSlots } from '@/types';

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
  photoSlots?: PhotoSlots9; // NEW: Slot-preserving photo array (9 slots)
  photos: { url: string }[]; // Legacy: list of photo URLs (for backward compat)
  bio?: string;
  gender?: string;
  dateOfBirth?: string;
  city?: string;
  activities?: string[]; // Hobbies/activities from Phase-1
  maxDistance?: number;
  isVerified?: boolean;
  // Extended fields for Phase-2 onboarding info preview
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  kids?: string | null;
  education?: string | null;
  religion?: string | null;
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
  // Extended imported fields (read-only, editable later in settings)
  height: number | null;
  smoking: string | null;
  drinking: string | null;
  kids: string | null;
  education: string | null;
  religion: string | null;
  maxDistanceKm: number;  // Distance in km

  // Flags
  isSetupComplete: boolean;
  // Permanent flag - once true, onboarding NEVER shows again
  phase2OnboardingCompleted: boolean;
  convexProfileId: string | null;
  _hasHydrated: boolean;

  // Phase-2 setup tracking
  acceptedTermsAt: number | null;
  phase2SetupVersion: number | null;
  blurMyPhoto: boolean;
  phase1PhotoSlots: PhotoSlots9;  // Slot-preserving photos from Phase-1 (9 slots)
  phase2PhotosConfirmed: boolean; // True after initial photo selection in Step-2

  // Navigation lock: prevents duplicate router.replace calls in PrivateEntryGuard
  privateEntryNavLock: boolean;

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
  // Actions — individual profile field setters (for Phase-2 editing)
  setGender: (gender: string) => void;
  setHeight: (height: number | null) => void;
  setSmoking: (smoking: string | null) => void;
  setDrinking: (drinking: string | null) => void;
  setEducation: (education: string | null) => void;
  setReligion: (religion: string | null) => void;

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
  setPhase2PhotosConfirmed: (confirmed: boolean) => void;
  setPrivateEntryNavLock: (locked: boolean) => void;
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
  // Extended imported fields
  height: null as number | null,
  smoking: null as string | null,
  drinking: null as string | null,
  kids: null as string | null,
  education: null as string | null,
  religion: null as string | null,
  maxDistanceKm: 50,
  isSetupComplete: false,
  phase2OnboardingCompleted: false, // Permanent - never reset
  convexProfileId: null as string | null,
  // Phase-2 setup tracking
  acceptedTermsAt: null as number | null,
  phase2SetupVersion: null as number | null,
  blurMyPhoto: true, // Default blur ON
  phase1PhotoSlots: createEmptyPhotoSlots(),
  phase2PhotosConfirmed: false, // True after Step-2 photo selection
  privateEntryNavLock: false, // Navigation lock for PrivateEntryGuard
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
      // Individual profile field setters
      setGender: (gender) => set({ gender }),
      setHeight: (height) => set({ height }),
      setSmoking: (smoking) => set({ smoking }),
      setDrinking: (drinking) => set({ drinking }),
      setEducation: (education) => set({ education }),
      setReligion: (religion) => set({ religion }),
      setIsSetupComplete: (complete) => set({ isSetupComplete: complete }),
      setConvexProfileId: (id) => set({ convexProfileId: id }),
      resetWizard: () => set(initialWizardState),
      resetPhase2: () => set((state) => ({
        // Reset all wizard state EXCEPT permanent onboarding flag
        ...initialWizardState,
        // PRESERVE permanent flag - onboarding never shows again once completed
        phase2OnboardingCompleted: state.phase2OnboardingCompleted,
        // Reset photos confirmed flag
        phase2PhotosConfirmed: false,
        // Also reset legacy profile fields
        profile: {
          username: 'Anonymous_User',
          bio: '',
          desireCategories: [],
          blurPhoto: true,
        },
        isSetup: false,
      })),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

      // Phase-2 setup actions
      setAcceptedTermsAt: (timestamp) => set({ acceptedTermsAt: timestamp }),
      setBlurMyPhoto: (blur) => set({ blurMyPhoto: blur }),
      importPhase1Data: (data) => {
        const startTime = __DEV__ ? Date.now() : 0;
        if (__DEV__) console.log('[P2 IMPORT] start');

        // GUARD: Check if we have any photos to process
        const hasPhotoSlots = data.photoSlots && data.photoSlots.some((s) => s !== null);
        const hasLegacyPhotos = data.photos && data.photos.length > 0;

        // If no photos at all, do minimal import (just basic profile info)
        if (!hasPhotoSlots && !hasLegacyPhotos) {
          if (__DEV__) {
            console.log('[P2 IMPORT] skip heavy work: no photos');
          }
          // Minimal state update - no photo processing
          set({
            displayName: data.name || '',
            gender: data.gender || '',
            phase1PhotoSlots: createEmptyPhotoSlots(),
          });
          if (__DEV__) {
            console.log(`[P2 IMPORT] end (duration=${Date.now() - startTime}ms, minimal)`);
          }
          return;
        }

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

        // Convert maxDistance from miles to km (Phase-1 stores in miles)
        const maxDistanceKm = data.maxDistance ? Math.round(data.maxDistance * 1.60934) : 50;

        // SLOT-PRESERVING: Use photoSlots if available, otherwise convert from legacy photos array
        let photoSlots: PhotoSlots9;
        if (data.photoSlots) {
          // Use the slot-based array directly
          photoSlots = data.photoSlots;
        } else {
          // Legacy: convert photos array to slots (loses slot info, places in order)
          photoSlots = createEmptyPhotoSlots();
          data.photos.forEach((p, idx) => {
            if (idx < 9 && p.url) {
              photoSlots[idx] = p.url;
            }
          });
        }

        // DEBUG: Log what we're storing
        if (__DEV__) {
          const nonNullIndices = photoSlots
            .map((uri, idx) => (uri ? idx : -1))
            .filter((idx) => idx >= 0);
          console.log('[privateProfileStore] importPhase1Data:', {
            photoSlotsProvided: !!data.photoSlots,
            nonNullSlots: nonNullIndices,
            firstUri: photoSlots.find(Boolean)?.slice(-40) || 'none',
          });
        }

        set({
          // Store Phase-1 photo slots (9 slots, preserving positions)
          phase1PhotoSlots: photoSlots,
          // Import profile info
          displayName: data.name || '',
          age,
          city: data.city || '',
          gender: data.gender || '',
          // Import hobbies from activities
          hobbies: data.activities || [],
          // Import verification status
          isVerified: data.isVerified || false,
          // Extended fields for info preview
          height: data.height ?? null,
          smoking: data.smoking ?? null,
          drinking: data.drinking ?? null,
          kids: data.kids ?? null,
          education: data.education ?? null,
          religion: data.religion ?? null,
          maxDistanceKm,
        });

        if (__DEV__) {
          console.log(`[P2 IMPORT] end (duration=${Date.now() - startTime}ms)`);
        }
      },
      completeSetup: () => set({
        isSetupComplete: true,
        phase2OnboardingCompleted: true, // Permanent flag - never shows onboarding again
        phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
      }),
      setPhase2PhotosConfirmed: (confirmed) => set({ phase2PhotosConfirmed: confirmed }),
      setPrivateEntryNavLock: (locked) => set({ privateEntryNavLock: locked }),
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
        // Extended imported fields
        height: state.height,
        smoking: state.smoking,
        drinking: state.drinking,
        kids: state.kids,
        education: state.education,
        religion: state.religion,
        maxDistanceKm: state.maxDistanceKm,
        isSetupComplete: state.isSetupComplete,
        phase2OnboardingCompleted: state.phase2OnboardingCompleted, // Permanent flag
        convexProfileId: state.convexProfileId,
        // Phase-2 setup tracking
        acceptedTermsAt: state.acceptedTermsAt,
        phase2SetupVersion: state.phase2SetupVersion,
        blurMyPhoto: state.blurMyPhoto,
        phase2PhotosConfirmed: state.phase2PhotosConfirmed,
        // NOTE: phase1PhotoSlots intentionally NOT persisted
        // It's re-imported from onboardingStore each session to avoid stale data
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

// Phase-2 onboarding validation constants
export const PHASE2_MIN_PHOTOS = 2;
export const PHASE2_MIN_INTENTS = 1;
export const PHASE2_MAX_INTENTS = 3;
export const PHASE2_DESIRE_MIN_LENGTH = 30;
export const PHASE2_DESIRE_MAX_LENGTH = 300;

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
  if (validPhotos.length < PHASE2_MIN_PHOTOS) return false;

  // Must have 1-3 intent categories
  if (state.intentKeys.length < PHASE2_MIN_INTENTS || state.intentKeys.length > PHASE2_MAX_INTENTS) return false;

  // Desire (bio) must be at least 30 characters
  if (state.privateBio.trim().length < PHASE2_DESIRE_MIN_LENGTH) return false;

  return true;
};

// Selector: Check if photos step is valid (min 2 selected)
export const selectCanContinuePhotos = (state: PrivateProfileState): boolean => {
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  return validPhotos.length >= PHASE2_MIN_PHOTOS;
};

// Selector: Check if intents are valid (1-3 selected)
export const selectCanContinueIntents = (state: PrivateProfileState): boolean => {
  return (
    state.intentKeys.length >= PHASE2_MIN_INTENTS &&
    state.intentKeys.length <= PHASE2_MAX_INTENTS
  );
};

// Selector: Check if desire (bio) is valid (30-300 chars)
export const selectCanContinueDesire = (state: PrivateProfileState): boolean => {
  const length = state.privateBio.trim().length;
  return length >= PHASE2_DESIRE_MIN_LENGTH && length <= PHASE2_DESIRE_MAX_LENGTH;
};

// Legacy selector: Check if categories step is valid (kept for backward compatibility)
export const selectCanContinueCategories = (state: PrivateProfileState): boolean => {
  return (
    state.intentKeys.length >= PHASE2_MIN_INTENTS &&
    state.intentKeys.length <= PHASE2_MAX_INTENTS &&
    state.privateBio.trim().length >= PHASE2_DESIRE_MIN_LENGTH
  );
};

// Selector: Check if profile details are complete (mandatory fields)
export const selectIsProfileDetailsComplete = (state: PrivateProfileState): boolean => {
  return (
    !!state.gender &&
    state.height !== null && state.height > 0 &&
    !!state.smoking &&
    !!state.drinking &&
    !!state.education &&
    !!state.religion
  );
};

// Selector: Get list of missing mandatory fields
export const selectMissingProfileFields = (state: PrivateProfileState): string[] => {
  const missing: string[] = [];
  if (!state.gender) missing.push('Gender');
  if (state.height === null || state.height <= 0) missing.push('Height');
  if (!state.smoking) missing.push('Smoking');
  if (!state.drinking) missing.push('Drinking');
  if (!state.education) missing.push('Education');
  if (!state.religion) missing.push('Religion');
  return missing;
};

// Selector: Check if entire Phase-2 profile is complete (photos + intents + desire + profile details)
export const selectIsPhase2ProfileComplete = (state: PrivateProfileState): boolean => {
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  const hasEnoughPhotos = validPhotos.length >= PHASE2_MIN_PHOTOS;
  const hasValidIntents = state.intentKeys.length >= PHASE2_MIN_INTENTS && state.intentKeys.length <= PHASE2_MAX_INTENTS;
  const hasValidDesire = state.privateBio.trim().length >= PHASE2_DESIRE_MIN_LENGTH && state.privateBio.trim().length <= PHASE2_DESIRE_MAX_LENGTH;
  const hasProfileDetails = selectIsProfileDetailsComplete(state);

  return hasEnoughPhotos && hasValidIntents && hasValidDesire && hasProfileDetails;
};

// Selector: Get all missing items for Phase-2 completion
export const selectAllMissingItems = (state: PrivateProfileState): string[] => {
  const missing: string[] = [];

  // Photos
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  if (validPhotos.length < PHASE2_MIN_PHOTOS) {
    missing.push(`${PHASE2_MIN_PHOTOS - validPhotos.length} more photo${PHASE2_MIN_PHOTOS - validPhotos.length > 1 ? 's' : ''}`);
  }

  // Intents
  if (state.intentKeys.length < PHASE2_MIN_INTENTS) {
    missing.push('Looking For selection');
  }

  // Desire
  if (state.privateBio.trim().length < PHASE2_DESIRE_MIN_LENGTH) {
    missing.push('Desire text');
  }

  // Profile details
  const missingFields = selectMissingProfileFields(state);
  missing.push(...missingFields);

  return missing;
};
