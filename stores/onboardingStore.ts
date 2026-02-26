import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

// Display photo privacy variant
export type DisplayPhotoVariant = 'original' | 'blurred' | 'cartoon';

/**
 * Check if a URI is a valid persistent photo URI.
 * Only accepts local file:// URIs that are NOT in cache directories.
 * Rejects: cache URIs, Unsplash URLs, any http/https URLs.
 */
function isValidPhotoUri(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== 'string' || uri.length === 0) return false;
  // Must be a local file:// URI
  if (!uri.startsWith('file://')) return false;
  // Reject cache URIs (they disappear on app restart)
  if (uri.includes('/cache/') || uri.includes('/Cache/') || uri.includes('ImageManipulator')) return false;
  // Reject any Unsplash/demo URLs (should never happen for file://, but extra safety)
  if (uri.includes('unsplash.com')) return false;
  return true;
}

/**
 * Normalize photos array to exactly 9 slots (PhotoSlots9).
 * - Missing/undefined input => 9 nulls
 * - string[] (old data) => copy into slots, fill remaining with null
 * - Filter out invalid URIs (cache, Unsplash, non-file://)
 * - Ensure final is always length 9
 */
function normalizePhotos(input: unknown): PhotoSlots9 {
  const result: PhotoSlots9 = createEmptyPhotoSlots();

  // Handle missing/undefined/non-array
  if (!input || !Array.isArray(input)) {
    return result;
  }

  // Copy valid URIs into their slots (preserving index)
  for (let i = 0; i < Math.min(input.length, 9); i++) {
    const item = input[i];
    if (isValidPhotoUri(item)) {
      result[i] = item;
    }
    // Invalid URIs become null (slot preserved but empty)
  }

  return result;
}

// OB-1: Hydration timing for timeout fallback
const ONBOARDING_STORE_LOAD_TIME = Date.now();

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
  photos: PhotoSlots9;
  verificationPhotoUri: string | null;
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

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initialState,
      _hasHydrated: false,

      setHasHydrated: (state) => set({ _hasHydrated: state }),

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

      // Add photo to first available empty slot
      addPhoto: (uri) =>
        set((state) => {
          const newPhotos: PhotoSlots9 = [...state.photos] as PhotoSlots9;
          const emptyIndex = newPhotos.findIndex((p) => p === null || p === '');
          if (emptyIndex !== -1) {
            newPhotos[emptyIndex] = uri;
            if (__DEV__) console.log(`[P1] addPhoto slot ${emptyIndex} ->`, uri.slice(-40));
          }
          return { photos: newPhotos };
        }),

      // Set photo at specific slot index (no shifting, fixed slots)
      setPhotoAtIndex: (index, uri) =>
        set((state) => {
          if (index < 0 || index >= 9) return state;
          const newPhotos: PhotoSlots9 = [...state.photos] as PhotoSlots9;
          newPhotos[index] = uri;
          if (__DEV__) console.log(`[P1] set slot ${index} ->`, uri.slice(-40));
          return { photos: newPhotos };
        }),

      // Clear photo at specific slot (no shifting, fixed slots)
      removePhoto: (index) =>
        set((state) => {
          if (index < 0 || index >= 9) return state;
          const newPhotos: PhotoSlots9 = [...state.photos] as PhotoSlots9;
          newPhotos[index] = null;
          if (__DEV__) console.log(`[P1] clear slot ${index}`);
          return { photos: newPhotos };
        }),

      reorderPhotos: (photos) => set({ photos: normalizePhotos(photos) }),

      setVerificationPhoto: (uri) => set({ verificationPhotoUri: uri }),

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

      reset: () => set(initialState),

      // DEV: Clear all photos for re-selection (used after stale cache migration)
      clearAllPhotos: () => {
        if (__DEV__) console.log('[onboardingStore] clearAllPhotos called');
        set({
          photos: createEmptyPhotoSlots(),
          verificationPhotoUri: null,
        });
      },
    }),
    {
      name: "onboarding-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // OB-1: Set hydration flag when store rehydrates from AsyncStorage
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[onboardingStore] Rehydration error:', error);
        }
        if (__DEV__) {
          const hydrationTime = Date.now() - ONBOARDING_STORE_LOAD_TIME;
          console.log(`[HYDRATION] onboardingStore: ${hydrationTime}ms`);
        }
        // Normalize photos array from persisted data
        // normalizePhotos handles: old string[] format, filtering invalid URIs, ensuring length 9
        if (state) {
          const rawPhotos = state.photos;
          const normalized = normalizePhotos(rawPhotos);

          // Log migration if photos were cleared
          const rawCount = Array.isArray(rawPhotos) ? rawPhotos.filter(Boolean).length : 0;
          const normalizedCount = normalized.filter(Boolean).length;
          if (rawCount > 0 && normalizedCount < rawCount) {
            if (__DEV__) {
              console.warn('[MIGRATION] Cleared invalid photo URIs. User must re-add photos.');
              console.log('[onboardingStore] Photo migration:', { before: rawCount, after: normalizedCount });
            }
          }

          useOnboardingStore.setState({ photos: normalized });
        }
        state?.setHasHydrated(true);
      },
    },
  ),
);

// OB-1: Hydration timeout fallback (matches authStore/demoStore/blockStore pattern)
const HYDRATION_TIMEOUT_MS = 5000;
let _onboardingHydrationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function setupOnboardingHydrationTimeout() {
  // Clear any existing timeout (hot reload safety)
  if (_onboardingHydrationTimeoutId !== null) {
    clearTimeout(_onboardingHydrationTimeoutId);
  }
  _onboardingHydrationTimeoutId = setTimeout(() => {
    if (!useOnboardingStore.getState()._hasHydrated) {
      if (__DEV__) {
        console.warn('[onboardingStore] Hydration timeout — forcing hydrated state');
      }
      useOnboardingStore.getState().setHasHydrated(true);
    }
    _onboardingHydrationTimeoutId = null;
  }, HYDRATION_TIMEOUT_MS);
}

// OB-1 fix: hydration timeout fallback — if AsyncStorage blocks, force hydration after timeout
setupOnboardingHydrationTimeout();
