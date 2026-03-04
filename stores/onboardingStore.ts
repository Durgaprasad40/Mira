import { create } from "zustand";
import {
  OnboardingStep,
  Gender,
  RelationshipIntent,
  ActivityFilter,
  SmokingStatus,
  DrinkingStatus,
  KidsStatus,
  EducationLevel,
  Religion,
  ExerciseStatus,
  PetType,
  InsectType,
  PhotoSlots9,
  createEmptyPhotoSlots,
} from "@/types";
import { logPhotoRemoved, logPhotosCleared } from "@/lib/photoSafety";

// STORAGE POLICY ENFORCEMENT:
// This store contains ALL user onboarding data (email, phone, password, profile, photos, preferences).
// Per strict requirement: NO local persistence of user information.
// All onboarding state is ephemeral (in-memory only) and must be rehydrated from Convex on app boot.
// Convex is the ONLY source of truth.
// Photos: Local file URIs are temporary upload buffers only. UI renders from Convex storage URLs.

// Display photo privacy variant
export type DisplayPhotoVariant = 'original' | 'blurred' | 'cartoon';

/**
 * ❌ DEPRECATED - DO NOT USE FOR HYDRATION
 * This function was DELETING user photos during app restart.
 * Kept for reference only - not called during hydration anymore.
 */
function isValidPhotoUri_DEPRECATED(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== 'string' || uri.length === 0) return false;
  if (!uri.startsWith('file://')) return false;
  if (uri.includes('/cache/') || uri.includes('/Cache/') || uri.includes('ImageManipulator')) return false;
  if (uri.includes('unsplash.com')) return false;
  return true;
}

/**
 * ✅ PRODUCTION-SAFE: Normalize photos array to exactly 9 slots WITHOUT DELETING data
 * - Missing/undefined input => 9 nulls
 * - string[] (old data) => copy into slots, fill remaining with null
 * - ⚠️ KEEPS ALL URIs (even cache/remote) - deletion is NEVER safe during hydration
 * - Ensure final is always length 9
 *
 * CRITICAL: This function MUST NOT delete any photo URIs during hydration.
 * Missing files are flagged at render time via FileSystem.getInfoAsync(), not here.
 */
function normalizePhotos(input: unknown): PhotoSlots9 {
  const result: PhotoSlots9 = createEmptyPhotoSlots();

  // Handle missing/undefined/non-array
  if (!input || !Array.isArray(input)) {
    return result;
  }

  // ✅ PRODUCTION FIX: Copy ALL URIs without filtering
  // Previous code used isValidPhotoUri() which DELETED photos - removed for data safety
  for (let i = 0; i < Math.min(input.length, 9); i++) {
    const item = input[i];
    // Keep any non-empty string URI (validation happens at render time, not hydration)
    if (item && typeof item === 'string' && item.length > 0) {
      result[i] = item;
    }
  }

  return result;
}

// LGBTQ identity options (max 2 selections)
export type LgbtqOption = 'gay' | 'lesbian' | 'bisexual' | 'transgender' | 'prefer_not_to_say';

export const LGBTQ_OPTIONS: { value: LgbtqOption; label: string }[] = [
  { value: 'gay', label: 'Gay' },
  { value: 'lesbian', label: 'Lesbian' },
  { value: 'bisexual', label: 'Bisexual' },
  { value: 'transgender', label: 'Transgender' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

interface OnboardingState {
  currentStep: OnboardingStep;
  email: string;
  phone: string;
  password: string;
  name: string;
  nickname: string; // User ID / handle
  dateOfBirth: string;
  gender: Gender | null;
  lgbtqSelf: LgbtqOption[]; // "What am I?" - identity, optional, max 2
  lgbtqPreference: LgbtqOption[]; // "What I need?" - dating preference, optional, max 2

  // ════════════════════════════════════════════════════════════════════════
  // PHASE-1 PROFILE PHOTOS ARE BACKEND-OWNED. LOCAL FILES ARE CACHE ONLY.
  // ════════════════════════════════════════════════════════════════════════
  // HARD LOCK: photos array stores LOCAL CACHE URIs ONLY (not source of truth)
  // - Convex backend (photos table with storageId) is the ONLY source of truth
  // - These local URIs are for offline preview and performance only
  // - Missing local files are re-downloaded from Convex
  // - NEVER delete photos based on local file existence checks
  // ════════════════════════════════════════════════════════════════════════
  photos: PhotoSlots9; // LOCAL CACHE ONLY - Convex backend is source of truth
  verificationPhotoUri: string | null; // LOCAL CACHE ONLY - Convex backend is source of truth

  // BUG FIX: Reference photo as primary display photo
  // This is separate from photos[0] to prevent normal photo sync from clearing it
  // When referencePhotoExists=true, this becomes the primary photo displayed in the big circle
  verificationReferencePrimary: {
    storageId: string;
    url: string;
  } | null;

  displayPhotoVariant: DisplayPhotoVariant; // Privacy option: original, blurred, or cartoon
  bio: string;
  profilePrompts: { question: string; answer: string }[];
  height: number | null;
  weight: number | null;
  smoking: SmokingStatus | null;
  drinking: DrinkingStatus | null;
  kids: KidsStatus | null;
  exercise: ExerciseStatus | null;
  pets: PetType[];
  insect: InsectType | null;
  education: EducationLevel | null;
  educationOther: string; // Custom text when education === 'other'
  religion: Religion | null;
  jobTitle: string;
  company: string;
  school: string;
  lookingFor: Gender[];
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
  minAge: number;
  maxAge: number;
  maxDistance: number;

  // Actions
  setStep: (step: OnboardingStep) => void;
  setEmail: (email: string) => void;
  setPhone: (phone: string) => void;
  setPassword: (password: string) => void;
  setName: (name: string) => void;
  setNickname: (nickname: string) => void;
  setDateOfBirth: (dob: string) => void;
  setGender: (gender: Gender) => void;
  setLgbtqSelf: (lgbtq: LgbtqOption[]) => void;
  toggleLgbtqSelf: (option: LgbtqOption) => boolean; // Returns false if max 2 reached
  setLgbtqPreference: (lgbtq: LgbtqOption[]) => void;
  toggleLgbtqPreference: (option: LgbtqOption) => boolean; // Returns false if max 2 reached
  addPhoto: (uri: string) => void;
  setPhotoAtIndex: (index: number, uri: string) => void;
  removePhoto: (index: number) => void;
  reorderPhotos: (photos: PhotoSlots9) => void;
  setVerificationPhoto: (uri: string | null) => void;
  setVerificationReferencePrimary: (data: { storageId: string; url: string } | null) => void;
  setDisplayPhotoVariant: (variant: DisplayPhotoVariant) => void;
  setBio: (bio: string) => void;
  setProfilePrompts: (prompts: { question: string; answer: string }[]) => void;
  setHeight: (height: number | null) => void;
  setWeight: (weight: number | null) => void;
  setSmoking: (status: SmokingStatus | null) => void;
  setDrinking: (status: DrinkingStatus | null) => void;
  setKids: (status: KidsStatus | null) => void;
  setExercise: (exercise: ExerciseStatus | null) => void;
  setPets: (pets: PetType[]) => void;
  togglePet: (pet: PetType) => boolean;
  setInsect: (insect: InsectType | null) => void;
  setEducation: (level: EducationLevel | null) => void;
  setEducationOther: (text: string) => void;
  setReligion: (religion: Religion | null) => void;
  setJobTitle: (title: string) => void;
  setCompany: (company: string) => void;
  setSchool: (school: string) => void;
  setLookingFor: (genders: Gender[]) => void;
  toggleLookingFor: (gender: Gender) => void;
  setRelationshipIntent: (intents: RelationshipIntent[]) => void;
  toggleRelationshipIntent: (intent: RelationshipIntent) => void;
  setActivities: (activities: ActivityFilter[]) => void;
  toggleActivity: (activity: ActivityFilter) => void;
  setMinAge: (age: number) => void;
  setMaxAge: (age: number) => void;
  setMaxDistance: (distance: number) => void;
  reset: () => void;
  clearAllPhotos: () => void; // DEV: Clear all photos for re-selection
  hydrateFromDraft: (draft: any) => void; // Hydrate from Convex onboarding draft

  // OB-1: Hydration state for startup safety
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

const initialState = {
  currentStep: "welcome" as OnboardingStep,
  email: "",
  phone: "",
  password: "",
  name: "",
  nickname: "",
  dateOfBirth: "",
  gender: null,
  lgbtqSelf: [] as LgbtqOption[],
  lgbtqPreference: [] as LgbtqOption[],
  photos: createEmptyPhotoSlots(),
  verificationPhotoUri: null,
  verificationReferencePrimary: null,
  displayPhotoVariant: 'original' as DisplayPhotoVariant,
  bio: "",
  profilePrompts: [],
  height: null,
  weight: null,
  smoking: null,
  drinking: null,
  kids: null,
  exercise: null,
  pets: [],
  insect: null,
  education: null,
  educationOther: "",
  religion: null,
  jobTitle: "",
  company: "",
  school: "",
  lookingFor: [],
  relationshipIntent: [],
  activities: [],
  minAge: 18,
  maxAge: 50,
  maxDistance: 50,
};

// NO PERSISTENCE: This is an in-memory store only.
// Onboarding data is rehydrated from Convex queries on app boot.
export const useOnboardingStore = create<OnboardingState>()((set) => ({
  ...initialState,
  // Always true since there's no async hydration from AsyncStorage
  _hasHydrated: true,

  // No-op for compatibility
  setHasHydrated: (state) => set({ _hasHydrated: true }),

      setStep: (step) => set({ currentStep: step }),

      setEmail: (email) => set({ email }),

      setPhone: (phone) => set({ phone }),

      setPassword: (password) => set({ password }),

      setName: (name) => set({ name }),

      setNickname: (nickname) => set({ nickname }),

      setDateOfBirth: (dateOfBirth) => set({ dateOfBirth }),

      setGender: (gender) => set({ gender }),

      setLgbtqSelf: (lgbtqSelf) => set({ lgbtqSelf: lgbtqSelf.slice(0, 2) }),

      toggleLgbtqSelf: (option) => {
        const state = useOnboardingStore.getState();
        if (state.lgbtqSelf.includes(option)) {
          set({ lgbtqSelf: state.lgbtqSelf.filter((o) => o !== option) });
          return true;
        }
        if (state.lgbtqSelf.length >= 2) {
          return false; // Max 2 selections reached
        }
        set({ lgbtqSelf: [...state.lgbtqSelf, option] });
        return true;
      },

      setLgbtqPreference: (lgbtqPreference) => set({ lgbtqPreference: lgbtqPreference.slice(0, 2) }),

      toggleLgbtqPreference: (option) => {
        const state = useOnboardingStore.getState();
        if (state.lgbtqPreference.includes(option)) {
          set({ lgbtqPreference: state.lgbtqPreference.filter((o) => o !== option) });
          return true;
        }
        if (state.lgbtqPreference.length >= 2) {
          return false; // Max 2 selections reached
        }
        set({ lgbtqPreference: [...state.lgbtqPreference, option] });
        return true;
      },

      // ════════════════════════════════════════════════════════════════════════
      // HARD LOCK: Photo mutations store LOCAL CACHE URIs ONLY
      // Convex backend upload happens BEFORE these mutations are called
      // ════════════════════════════════════════════════════════════════════════

      // Add photo to first available empty slot
      // CACHE ONLY: Backend upload must happen BEFORE calling this
      addPhoto: (uri) =>
        set((state) => {
          const newPhotos: PhotoSlots9 = [...state.photos] as PhotoSlots9;
          const emptyIndex = newPhotos.findIndex((p) => p === null || p === '');
          if (emptyIndex !== -1) {
            newPhotos[emptyIndex] = uri;
            if (__DEV__) console.log(`[P1] addPhoto slot ${emptyIndex} -> CACHE:`, uri.slice(-40));
          }
          return { photos: newPhotos };
        }),

      // Set photo at specific slot index (no shifting, fixed slots)
      // CACHE ONLY: Backend upload must happen BEFORE calling this
      setPhotoAtIndex: (index, uri) =>
        set((state) => {
          if (index < 0 || index >= 9) return state;
          const newPhotos: PhotoSlots9 = [...state.photos] as PhotoSlots9;
          newPhotos[index] = uri;
          if (__DEV__) console.log(`[P1] set slot ${index} -> CACHE:`, uri.slice(-40));
          return { photos: newPhotos };
        }),

      // Clear photo at specific slot (no shifting, fixed slots)
      removePhoto: (index) =>
        set((state) => {
          if (index < 0 || index >= 9) return state;
          const newPhotos: PhotoSlots9 = [...state.photos] as PhotoSlots9;
          newPhotos[index] = null;

          // TASK 5: Safety logging - user-initiated removal
          logPhotoRemoved(index, 'user_tap_remove_button');

          if (__DEV__) console.log(`[P1] clear slot ${index}`);
          return { photos: newPhotos };
        }),

      reorderPhotos: (photos) => set({ photos: normalizePhotos(photos) }),

      setVerificationPhoto: (uri) => set({ verificationPhotoUri: uri }),

      setVerificationReferencePrimary: (data) => {
        if (__DEV__) {
          console.log('[REF_PRIMARY] Setting verification reference primary:', {
            exists: !!data,
            hasUrl: !!data?.url,
            hasStorageId: !!data?.storageId,
          });
        }
        set({ verificationReferencePrimary: data });
      },

      setDisplayPhotoVariant: (displayPhotoVariant) => set({ displayPhotoVariant }),

      setBio: (bio) => set({ bio }),

      setProfilePrompts: (profilePrompts) => set({ profilePrompts }),

      setHeight: (height) => set({ height }),

      setWeight: (weight) => set({ weight }),

      setSmoking: (smoking) => set({ smoking }),

      setDrinking: (drinking) => set({ drinking }),

      setKids: (kids) => set({ kids }),

      setExercise: (exercise) => set({ exercise }),

      setPets: (pets) => set({ pets: pets.slice(0, 3) }),

      togglePet: (pet) => {
        const state = useOnboardingStore.getState();
        if (state.pets.includes(pet)) {
          set({ pets: state.pets.filter((p) => p !== pet) });
          return true;
        }
        if (state.pets.length >= 3) {
          return false;
        }
        set({ pets: [...state.pets, pet] });
        return true;
      },

      setInsect: (insect) => set({ insect }),

      setEducation: (education) => set({ education }),

      setEducationOther: (educationOther) => set({ educationOther }),

      setReligion: (religion) => set({ religion }),

      setJobTitle: (jobTitle) => set({ jobTitle }),

      setCompany: (company) => set({ company }),

      setSchool: (school) => set({ school }),

      setLookingFor: (lookingFor) => set({ lookingFor }),

      toggleLookingFor: (gender) =>
        set((state) => ({
          lookingFor: state.lookingFor.includes(gender)
            ? state.lookingFor.filter((g) => g !== gender)
            : [...state.lookingFor, gender],
        })),

      setRelationshipIntent: (relationshipIntent) =>
        set({ relationshipIntent }),

      toggleRelationshipIntent: (intent) =>
        set((state) => ({
          relationshipIntent: state.relationshipIntent.includes(intent)
            ? state.relationshipIntent.filter((i) => i !== intent)
            : [...state.relationshipIntent, intent],
        })),

      setActivities: (activities) => set({ activities }),

      toggleActivity: (activity) =>
        set((state) => ({
          activities: state.activities.includes(activity)
            ? state.activities.filter((a) => a !== activity)
            : [...state.activities, activity],
        })),

      setMinAge: (minAge) => set({ minAge }),

      setMaxAge: (maxAge) => set({ maxAge }),

      setMaxDistance: (maxDistance) => set({ maxDistance }),

      /**
       * Hydrate from Convex onboarding draft (live mode only).
       * Called on app startup to restore incomplete onboarding progress.
       * Does NOT overwrite fields already set in current session.
       */
      hydrateFromDraft: (draft) => {
        if (!draft) return;

        const state = useOnboardingStore.getState();
        const updates: Partial<OnboardingState> = {};

        // Basic Info
        if (draft.basicInfo) {
          if (draft.basicInfo.name && !state.name) {
            updates.name = draft.basicInfo.name;
          }
          if (draft.basicInfo.handle && !state.nickname) {
            updates.nickname = draft.basicInfo.handle;
          }
          if (draft.basicInfo.dateOfBirth && !state.dateOfBirth) {
            updates.dateOfBirth = draft.basicInfo.dateOfBirth;
          }
          if (draft.basicInfo.gender && !state.gender) {
            updates.gender = draft.basicInfo.gender;
          }
        }

        // Profile Details
        if (draft.profileDetails) {
          if (draft.profileDetails.height !== undefined && !state.height) {
            updates.height = draft.profileDetails.height;
          }
          if (draft.profileDetails.weight !== undefined && !state.weight) {
            updates.weight = draft.profileDetails.weight;
          }
          if (draft.profileDetails.jobTitle && !state.jobTitle) {
            updates.jobTitle = draft.profileDetails.jobTitle;
          }
          if (draft.profileDetails.company && !state.company) {
            updates.company = draft.profileDetails.company;
          }
          if (draft.profileDetails.school && !state.school) {
            updates.school = draft.profileDetails.school;
          }
          if (draft.profileDetails.education && !state.education) {
            updates.education = draft.profileDetails.education;
          }
          if (draft.profileDetails.bio && !state.bio) {
            updates.bio = draft.profileDetails.bio;
          }
          if (draft.profileDetails.profilePrompts && state.profilePrompts.length === 0) {
            updates.profilePrompts = draft.profileDetails.profilePrompts;
          }
        }

        // Lifestyle
        if (draft.lifestyle) {
          if (draft.lifestyle.smoking && !state.smoking) {
            updates.smoking = draft.lifestyle.smoking;
          }
          if (draft.lifestyle.drinking && !state.drinking) {
            updates.drinking = draft.lifestyle.drinking;
          }
          if (draft.lifestyle.exercise && !state.exercise) {
            updates.exercise = draft.lifestyle.exercise;
          }
          if (draft.lifestyle.pets && state.pets.length === 0) {
            updates.pets = draft.lifestyle.pets;
          }
          if (draft.lifestyle.insect && !state.insect) {
            updates.insect = draft.lifestyle.insect;
          }
          if (draft.lifestyle.kids && !state.kids) {
            updates.kids = draft.lifestyle.kids;
          }
          if (draft.lifestyle.religion && !state.religion) {
            updates.religion = draft.lifestyle.religion;
          }
        }

        // Preferences
        if (draft.preferences) {
          if (draft.preferences.lookingFor && state.lookingFor.length === 0) {
            updates.lookingFor = draft.preferences.lookingFor;
          }
          if (draft.preferences.relationshipIntent && state.relationshipIntent.length === 0) {
            updates.relationshipIntent = draft.preferences.relationshipIntent;
          }
          if (draft.preferences.activities && state.activities.length === 0) {
            updates.activities = draft.preferences.activities;
          }
          if (draft.preferences.minAge !== undefined && state.minAge === 18) {
            updates.minAge = draft.preferences.minAge;
          }
          if (draft.preferences.maxAge !== undefined && state.maxAge === 50) {
            updates.maxAge = draft.preferences.maxAge;
          }
          if (draft.preferences.maxDistance !== undefined && state.maxDistance === 50) {
            updates.maxDistance = draft.preferences.maxDistance;
          }
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          if (__DEV__) {
            console.log('[ONB_DRAFT] Hydrated from Convex draft:', Object.keys(updates));
          }
          set(updates);
        }
      },

      reset: () => {
        const currentPhotos = useOnboardingStore.getState().photos;
        const photoCount = currentPhotos.filter((p) => p !== null && p !== '').length;

        // TASK 5: Safety logging - reset/logout clear
        logPhotosCleared(photoCount, 'reset');

        return set(initialState);
      },

      // DEV: Clear all photos for re-selection (used after stale cache migration)
      clearAllPhotos: () => {
        if (__DEV__) console.log('[onboardingStore] clearAllPhotos called');

        const currentPhotos = useOnboardingStore.getState().photos;
        const photoCount = currentPhotos.filter((p) => p !== null && p !== '').length;

        // TASK 5: Safety logging - DEV-only clear
        logPhotosCleared(photoCount, 'dev_clear_all');

        set({
          photos: createEmptyPhotoSlots(),
          verificationPhotoUri: null,
        });
      },
}));

// No hydration timeout needed - store is always immediately ready
