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
} from "@/types";

// Display photo privacy variant
export type DisplayPhotoVariant = 'original' | 'blurred' | 'cartoon';

/**
 * Normalize photos array to exactly 9 slots.
 * - Missing/undefined input => Array(9).fill(null)
 * - string[] (old data) => copy into slots, fill remaining with null
 * - (string|null)[] shorter than 9 => pad with null
 * - Longer than 9 => slice(0,9)
 * - Convert any undefined/'' to null
 */
function normalizePhotos(input: unknown): (string | null)[] {
  // Handle missing/undefined/non-array
  if (!input || !Array.isArray(input)) {
    return Array(9).fill(null);
  }

  // Normalize each slot: convert undefined/'' to null, keep valid strings
  const normalized: (string | null)[] = input.slice(0, 9).map((item) => {
    if (typeof item === 'string' && item.length > 0) {
      return item;
    }
    return null;
  });

  // Pad to exactly 9 slots if shorter
  while (normalized.length < 9) {
    normalized.push(null);
  }

  return normalized;
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
  photos: (string | null)[];
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
  reorderPhotos: (photos: (string | null)[]) => void;
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
  photos: [null, null, null, null, null, null, null, null, null] as (string | null)[],
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
          const newPhotos = [...state.photos];
          const emptyIndex = newPhotos.findIndex((p) => p === null || p === '');
          if (emptyIndex !== -1) {
            newPhotos[emptyIndex] = uri;
          }
          return { photos: newPhotos };
        }),

      // Set photo at specific slot index (no shifting, fixed slots)
      setPhotoAtIndex: (index, uri) =>
        set((state) => {
          if (index < 0 || index >= 9) return state;
          const newPhotos = [...state.photos];
          newPhotos[index] = uri;
          return { photos: newPhotos };
        }),

      // Clear photo at specific slot (no shifting, fixed slots)
      removePhoto: (index) =>
        set((state) => {
          if (index < 0 || index >= 9) return state;
          const newPhotos = [...state.photos];
          newPhotos[index] = null;
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
        // Normalize photos array from persisted data (handles old string[] format, undefined slots, etc.)
        if (state) {
          const normalized = normalizePhotos(state.photos);
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
