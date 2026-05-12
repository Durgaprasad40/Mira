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
import { DEBUG_ONBOARDING_HYDRATION } from "@/lib/debugFlags";
import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_DISTANCE_KM,
  DEFAULT_MIN_AGE,
} from "@/lib/discoveryDefaults";
import {
  IdentityAnchorValue,
  SocialBatteryValue,
  ValueTriggerValue,
  SeedQuestions,
  SectionPrompts,
  SectionPromptAnswer,
  PromptSectionKey,
  // Life Rhythm types
  SocialRhythmValue,
  SleepScheduleValue,
  TravelStyleValue,
  WorkStyleValue,
  CoreValueValue,
  LifeRhythm,
} from "@/lib/constants";

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

  // P1-001 FIX: Warn if photos array exceeds slot capacity (DEV only)
  if (__DEV__ && input.length > 9) {
    console.warn(`[ONB_STORE] normalizePhotos: ${input.length} photos provided, only first 9 will be used`);
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

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const ALLOWED_RELATIONSHIP_INTENTS = new Set([
  'serious_vibes', 'keep_it_casual', 'exploring_vibes', 'see_where_it_goes',
  'open_to_vibes', 'just_friends', 'open_to_anything', 'single_parent', 'new_to_dating'
]);

// Legacy → Current mapping for relationshipIntent values
// These old values may exist in cached drafts or older user profiles
const LEGACY_INTENT_MAP: Record<string, string> = {
  'long_term': 'serious_vibes',
  'short_term': 'keep_it_casual',
  'fwb': 'keep_it_casual',
  'figuring_out': 'exploring_vibes',
  'short_to_long': 'see_where_it_goes',
  'long_to_short': 'open_to_vibes',
  'casual': 'keep_it_casual',
  'serious': 'serious_vibes',
  'marriage': 'serious_vibes',
  'friendship': 'just_friends',
  'open': 'open_to_anything',
};

/**
 * Normalize relationshipIntent values from backend draft.
 * Maps legacy values to current schema and filters invalid values.
 */
function normalizeRelationshipIntent(arr: unknown): RelationshipIntent[] {
  if (!arr || !Array.isArray(arr)) return [];

  // Step 1: Map legacy values to current valid values
  const mapped = arr.map(v => {
    const strVal = typeof v === 'string' ? v : String(v);
    return LEGACY_INTENT_MAP[strVal] || strVal;
  });

  // Step 2: Filter to only valid values
  const sanitized = mapped.filter(v => ALLOWED_RELATIONSHIP_INTENTS.has(v));

  // Step 3: Deduplicate
  const deduped = [...new Set(sanitized)] as RelationshipIntent[];

  if (__DEV__ && (arr.length !== deduped.length || arr.some((v, i) => v !== mapped[i]))) {
    console.log('[ONB_STORE] relationshipIntent normalization:', {
      original: arr,
      mapped,
      final: deduped,
    });
  }
  return deduped;
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
  name: string; // Single name field (replaces firstName + lastName)
  nickname: string; // User ID / handle - NO uniqueness requirement
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
  profilePrompts: { question: string; answer: string; section?: string }[]; // Section-based prompts

  // ═══════════════════════════════════════════════════════════════════════════════
  // NEW PROMPT SYSTEM V2 (2-Page Structure)
  // ═══════════════════════════════════════════════════════════════════════════════
  seedQuestions: SeedQuestions;       // Page 1: Identity, Social Battery, Values
  sectionPrompts: SectionPrompts;     // Page 2: Builder, Performer, Seeker, Grounded
  // ═══════════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIFE RHYTHM (New Matching Signals)
  // ═══════════════════════════════════════════════════════════════════════════════
  lifeRhythm: LifeRhythm;
  // ═══════════════════════════════════════════════════════════════════════════════

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
  setName: (name: string) => void; // Single name setter (replaces setFirstName + setLastName)
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
  // New Prompt System V2 actions
  setIdentityAnchor: (value: IdentityAnchorValue | null) => void;
  setSocialBattery: (value: SocialBatteryValue | null) => void;
  setValueTrigger: (value: ValueTriggerValue | null) => void;
  setSectionPromptAnswer: (section: PromptSectionKey, questionText: string, answer: string) => void;
  removeSectionPromptAnswer: (section: PromptSectionKey, questionText: string) => void;
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
  // Life Rhythm actions
  setLifeRhythmCity: (city: string | null) => void;
  setLifeRhythmSocialRhythm: (value: SocialRhythmValue | null) => void;
  setLifeRhythmSleepSchedule: (value: SleepScheduleValue | null) => void;
  setLifeRhythmTravelStyle: (value: TravelStyleValue | null) => void;
  setLifeRhythmWorkStyle: (value: WorkStyleValue | null) => void;
  setLifeRhythmCoreValues: (values: CoreValueValue[]) => void;
  toggleLifeRhythmCoreValue: (value: CoreValueValue) => boolean; // Returns false if max 3 reached
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

  // Convex draft hydration state - tracks whether backend data has been loaded
  _convexHydrated: boolean;
  setConvexHydrated: () => void;
}

const initialState = {
  currentStep: "welcome" as OnboardingStep,
  email: "",
  phone: "",
  password: "",
  name: "", // Single name field (replaces firstName + lastName)
  nickname: "", // NO uniqueness requirement
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
  // New Prompt System V2
  seedQuestions: {
    identityAnchor: null,
    socialBattery: null,
    valueTrigger: null,
  } as SeedQuestions,
  sectionPrompts: {
    builder: [],
    performer: [],
    seeker: [],
    grounded: [],
  } as SectionPrompts,
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
  // Life Rhythm
  lifeRhythm: {
    city: null,
    socialRhythm: null,
    sleepSchedule: null,
    travelStyle: null,
    workStyle: null,
    coreValues: [],
  } as LifeRhythm,
  lookingFor: [],
  relationshipIntent: [],
  activities: [],
  minAge: DEFAULT_MIN_AGE,
  maxAge: DEFAULT_MAX_AGE,
  maxDistance: DEFAULT_MAX_DISTANCE_KM,
};

// NO PERSISTENCE: This is an in-memory store only.
// Onboarding data is rehydrated from Convex queries on app boot.
export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  ...initialState,
  // Legacy flag - always true for backward compatibility
  _hasHydrated: true,

  // New flag: tracks whether Convex draft has been hydrated
  // Screens should check this before rendering forms to prevent data loss
  _convexHydrated: false,

  // No-op for compatibility
  setHasHydrated: (state) => {
    // LOOP FIX: Equality guard
    if (get()._hasHydrated === true) return;
    set({ _hasHydrated: true });
  },

  // Set convex hydration complete
  setConvexHydrated: () => {
    // LOOP FIX: Equality guard
    if (get()._convexHydrated === true) return;
    set({ _convexHydrated: true });
  },

      setStep: (step) => {
        // LOOP FIX: Equality guard
        if (get().currentStep === step) return;
        set({ currentStep: step });
      },

      setEmail: (email) => {
        // LOOP FIX: Equality guard
        if (get().email === email) return;
        set({ email });
      },

      setPhone: (phone) => {
        // LOOP FIX: Equality guard
        if (get().phone === phone) return;
        set({ phone });
      },

      setPassword: (password) => {
        // LOOP FIX: Equality guard
        if (get().password === password) return;
        set({ password });
      },

      setName: (name) => {
        // LOOP FIX: Equality guard
        if (get().name === name) return;
        set({ name });
      },

      setNickname: (nickname) => {
        // LOOP FIX: Equality guard
        if (get().nickname === nickname) return;
        set({ nickname });
      },

      setDateOfBirth: (dateOfBirth) => {
        // LOOP FIX: Equality guard
        if (get().dateOfBirth === dateOfBirth) return;
        set({ dateOfBirth });
      },

      setGender: (gender) => {
        // LOOP FIX: Equality guard
        if (get().gender === gender) return;
        set({ gender });
      },

      setLgbtqSelf: (lgbtqSelf) => set({ lgbtqSelf: lgbtqSelf.slice(0, 2) }),

      // P2 STABILITY: Use atomic set() to prevent race conditions on rapid taps
      toggleLgbtqSelf: (option) => {
        let success = true;
        set((state) => {
          if (state.lgbtqSelf.includes(option)) {
            // Remove existing option
            return { lgbtqSelf: state.lgbtqSelf.filter((o) => o !== option) };
          }
          if (state.lgbtqSelf.length >= 2) {
            // Max 2 reached, cannot add
            success = false;
            return state;
          }
          // Add new option
          return { lgbtqSelf: [...state.lgbtqSelf, option] };
        });
        return success;
      },

      setLgbtqPreference: (lgbtqPreference) => set({ lgbtqPreference: lgbtqPreference.slice(0, 2) }),

      // P2 STABILITY: Use atomic set() to prevent race conditions on rapid taps
      toggleLgbtqPreference: (option) => {
        let success = true;
        set((state) => {
          if (state.lgbtqPreference.includes(option)) {
            // Remove existing option
            return { lgbtqPreference: state.lgbtqPreference.filter((o) => o !== option) };
          }
          if (state.lgbtqPreference.length >= 2) {
            // Max 2 reached, cannot add
            success = false;
            return state;
          }
          // Add new option
          return { lgbtqPreference: [...state.lgbtqPreference, option] };
        });
        return success;
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
        if (__DEV__ && DEBUG_ONBOARDING_HYDRATION) console.log('[REF_PRIMARY] set:', !!data);
        set({ verificationReferencePrimary: data });
      },

      setDisplayPhotoVariant: (displayPhotoVariant) => set({ displayPhotoVariant }),

      setBio: (bio) => set({ bio }),

      setProfilePrompts: (profilePrompts) => set({ profilePrompts }),

      // ═══════════════════════════════════════════════════════════════════════════════
      // NEW PROMPT SYSTEM V2 ACTIONS
      // ═══════════════════════════════════════════════════════════════════════════════

      setIdentityAnchor: (value) =>
        set((state) => ({
          seedQuestions: { ...state.seedQuestions, identityAnchor: value },
        })),

      setSocialBattery: (value) =>
        set((state) => ({
          seedQuestions: { ...state.seedQuestions, socialBattery: value },
        })),

      setValueTrigger: (value) =>
        set((state) => ({
          seedQuestions: { ...state.seedQuestions, valueTrigger: value },
        })),

      setSectionPromptAnswer: (section, questionText, answer) =>
        set((state) => {
          const currentSection = [...state.sectionPrompts[section]];
          const existingIndex = currentSection.findIndex((p) => p.question === questionText);

          if (existingIndex >= 0) {
            // Update existing answer
            currentSection[existingIndex] = { section, question: questionText, answer };
          } else {
            // Add new answer
            currentSection.push({ section, question: questionText, answer });
          }

          return {
            sectionPrompts: {
              ...state.sectionPrompts,
              [section]: currentSection,
            },
          };
        }),

      removeSectionPromptAnswer: (section, questionText) =>
        set((state) => ({
          sectionPrompts: {
            ...state.sectionPrompts,
            [section]: state.sectionPrompts[section].filter((p: SectionPromptAnswer) => p.question !== questionText),
          },
        })),

      // ═══════════════════════════════════════════════════════════════════════════════

      setHeight: (height) => set({ height }),

      setWeight: (weight) => set({ weight }),

      setSmoking: (smoking) => set({ smoking }),

      setDrinking: (drinking) => set({ drinking }),

      setKids: (kids) => set({ kids }),

      setExercise: (exercise) => set({ exercise }),

      setPets: (pets) => set({ pets: pets.slice(0, 3) }),

      // P2 STABILITY: Use atomic set() to prevent race conditions on rapid taps
      togglePet: (pet) => {
        let success = true;
        set((state) => {
          if (state.pets.includes(pet)) {
            // Remove existing pet
            return { pets: state.pets.filter((p) => p !== pet) };
          }
          if (state.pets.length >= 3) {
            // Max 3 reached, cannot add
            success = false;
            return state;
          }
          // Add new pet
          return { pets: [...state.pets, pet] };
        });
        return success;
      },

      setInsect: (insect) => set({ insect }),

      setEducation: (education) => set({ education }),

      setEducationOther: (educationOther) => set({ educationOther }),

      setReligion: (religion) => set({ religion }),

      setJobTitle: (jobTitle) => set({ jobTitle }),

      setCompany: (company) => set({ company }),

      setSchool: (school) => set({ school }),

      // ═══════════════════════════════════════════════════════════════════════════════
      // LIFE RHYTHM SETTERS
      // ═══════════════════════════════════════════════════════════════════════════════

      setLifeRhythmCity: (city) =>
        set((state) => ({
          lifeRhythm: { ...state.lifeRhythm, city },
        })),

      setLifeRhythmSocialRhythm: (socialRhythm) =>
        set((state) => ({
          lifeRhythm: { ...state.lifeRhythm, socialRhythm },
        })),

      setLifeRhythmSleepSchedule: (sleepSchedule) =>
        set((state) => ({
          lifeRhythm: { ...state.lifeRhythm, sleepSchedule },
        })),

      setLifeRhythmTravelStyle: (travelStyle) =>
        set((state) => ({
          lifeRhythm: { ...state.lifeRhythm, travelStyle },
        })),

      setLifeRhythmWorkStyle: (workStyle) =>
        set((state) => ({
          lifeRhythm: { ...state.lifeRhythm, workStyle },
        })),

      setLifeRhythmCoreValues: (coreValues) =>
        set((state) => ({
          lifeRhythm: { ...state.lifeRhythm, coreValues: coreValues.slice(0, 3) },
        })),

      // P1-002 FIX: Use atomic set() callback to prevent race conditions on rapid toggles
      toggleLifeRhythmCoreValue: (value) => {
        let success = true;
        set((state) => {
          const currentValues = state.lifeRhythm.coreValues;
          if (currentValues.includes(value)) {
            // Remove value
            return {
              lifeRhythm: {
                ...state.lifeRhythm,
                coreValues: currentValues.filter((v) => v !== value),
              },
            };
          }
          // Check max 3 limit
          if (currentValues.length >= 3) {
            success = false;
            return state; // Return unchanged state
          }
          // Add value
          return {
            lifeRhythm: {
              ...state.lifeRhythm,
              coreValues: [...currentValues, value],
            },
          };
        });
        return success;
      },

      // ═══════════════════════════════════════════════════════════════════════════════

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
       * STABILITY FIX: Now resets to initialState first, then applies draft.
       * This ensures Convex is the source of truth and prevents data leakage.
       */
      hydrateFromDraft: (draft) => {
        // STABILITY FIX: Reset to initial state to prevent data leakage between accounts.
        // P0 FIX: Preserve photos array - photos are synced separately via autoSyncPhotosOnStartup.
        // Resetting photos here would wipe photos synced from backend before draft hydration.
        const currentPhotos = get().photos;
        const currentVerificationPhoto = get().verificationPhotoUri;
        const currentVerificationReferencePrimary = get().verificationReferencePrimary;
        set({
          ...initialState,
          _hasHydrated: true,
          // P0 FIX: Preserve photo state (synced from backend, not from draft)
          photos: currentPhotos,
          verificationPhotoUri: currentVerificationPhoto,
          verificationReferencePrimary: currentVerificationReferencePrimary,
        });

        if (!draft) {
          // No draft, but hydration is complete (nothing to hydrate)
          set({ _convexHydrated: true });
          return;
        }

        const updates: Partial<OnboardingState> = {};

        // Basic Info - directly apply from draft (state is now reset)
        // Single name field - no parsing needed
        if (draft.basicInfo) {
          if (draft.basicInfo.name) updates.name = draft.basicInfo.name;
          if (draft.basicInfo.handle) updates.nickname = draft.basicInfo.handle;
          if (draft.basicInfo.dateOfBirth) updates.dateOfBirth = draft.basicInfo.dateOfBirth;
          if (draft.basicInfo.gender) updates.gender = draft.basicInfo.gender;
        }

        // Profile Details
        if (draft.profileDetails) {
          if (draft.profileDetails.height !== undefined) updates.height = draft.profileDetails.height;
          if (draft.profileDetails.weight !== undefined) updates.weight = draft.profileDetails.weight;
          if (draft.profileDetails.jobTitle) updates.jobTitle = draft.profileDetails.jobTitle;
          if (draft.profileDetails.company) updates.company = draft.profileDetails.company;
          if (draft.profileDetails.school) updates.school = draft.profileDetails.school;
          if (draft.profileDetails.education) updates.education = draft.profileDetails.education;
          if (draft.profileDetails.educationOther) updates.educationOther = draft.profileDetails.educationOther;
          if (draft.profileDetails.bio) updates.bio = draft.profileDetails.bio;
          if (draft.profileDetails.profilePrompts) updates.profilePrompts = draft.profileDetails.profilePrompts;
          if (draft.profileDetails.displayPhotoVariant) updates.displayPhotoVariant = draft.profileDetails.displayPhotoVariant;
          // New Prompt System V2
          if (draft.profileDetails.seedQuestions) {
            updates.seedQuestions = {
              identityAnchor: draft.profileDetails.seedQuestions.identityAnchor ?? null,
              socialBattery: draft.profileDetails.seedQuestions.socialBattery ?? null,
              valueTrigger: draft.profileDetails.seedQuestions.valueTrigger ?? null,
            };
          }
          if (draft.profileDetails.sectionPrompts) {
            updates.sectionPrompts = {
              builder: draft.profileDetails.sectionPrompts.builder ?? [],
              performer: draft.profileDetails.sectionPrompts.performer ?? [],
              seeker: draft.profileDetails.sectionPrompts.seeker ?? [],
              grounded: draft.profileDetails.sectionPrompts.grounded ?? [],
            };
          }
        }

        // Lifestyle
        if (draft.lifestyle) {
          if (draft.lifestyle.smoking) updates.smoking = draft.lifestyle.smoking;
          if (draft.lifestyle.drinking) updates.drinking = draft.lifestyle.drinking;
          if (draft.lifestyle.exercise) updates.exercise = draft.lifestyle.exercise;
          if (draft.lifestyle.pets) updates.pets = draft.lifestyle.pets;
          if (draft.lifestyle.insect) updates.insect = draft.lifestyle.insect;
          if (draft.lifestyle.kids) updates.kids = draft.lifestyle.kids;
          if (draft.lifestyle.religion) updates.religion = draft.lifestyle.religion;
        }

        // Life Rhythm
        if (draft.lifeRhythm) {
          updates.lifeRhythm = {
            city: draft.lifeRhythm.city ?? null,
            socialRhythm: draft.lifeRhythm.socialRhythm ?? null,
            sleepSchedule: draft.lifeRhythm.sleepSchedule ?? null,
            travelStyle: draft.lifeRhythm.travelStyle ?? null,
            workStyle: draft.lifeRhythm.workStyle ?? null,
            coreValues: draft.lifeRhythm.coreValues ?? [],
          };
        }

        // Preferences
        if (draft.preferences) {
          if (draft.preferences.lookingFor) updates.lookingFor = draft.preferences.lookingFor;
          // STABILITY FIX: Normalize legacy relationshipIntent values from backend draft
          if (draft.preferences.relationshipIntent) {
            updates.relationshipIntent = normalizeRelationshipIntent(draft.preferences.relationshipIntent);
          }
          if (draft.preferences.activities) updates.activities = draft.preferences.activities;
          if (draft.preferences.minAge !== undefined) updates.minAge = draft.preferences.minAge;
          if (draft.preferences.maxAge !== undefined) updates.maxAge = draft.preferences.maxAge;
          if (draft.preferences.maxDistance !== undefined) updates.maxDistance = draft.preferences.maxDistance;
          if (draft.preferences.lgbtqPreference) updates.lgbtqPreference = draft.preferences.lgbtqPreference;
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          if (__DEV__ && DEBUG_ONBOARDING_HYDRATION) console.log(`[ONB_DRAFT] hydrated ${Object.keys(updates).length} fields`);
          set(updates);
        }

        // Mark Convex hydration as complete
        set({ _convexHydrated: true });
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
