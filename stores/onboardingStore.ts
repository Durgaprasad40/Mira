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
} from "@/types";

interface OnboardingState {
  currentStep: OnboardingStep;
  email: string;
  phone: string;
  password: string;
  name: string;
  dateOfBirth: string;
  gender: Gender | null;
  photos: string[];
  verificationPhotoUri: string | null;
  bio: string;
  profilePrompts: { question: string; answer: string }[];
  height: number | null;
  weight: number | null;
  smoking: SmokingStatus | null;
  drinking: DrinkingStatus | null;
  kids: KidsStatus | null;
  exercise: ExerciseStatus | null;
  pets: PetType[];
  education: EducationLevel | null;
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
  setDateOfBirth: (dob: string) => void;
  setGender: (gender: Gender) => void;
  addPhoto: (uri: string) => void;
  removePhoto: (index: number) => void;
  reorderPhotos: (photos: string[]) => void;
  setVerificationPhoto: (uri: string | null) => void;
  setBio: (bio: string) => void;
  setProfilePrompts: (prompts: { question: string; answer: string }[]) => void;
  setHeight: (height: number | null) => void;
  setWeight: (weight: number | null) => void;
  setSmoking: (status: SmokingStatus | null) => void;
  setDrinking: (status: DrinkingStatus | null) => void;
  setKids: (status: KidsStatus | null) => void;
  setExercise: (exercise: ExerciseStatus | null) => void;
  setPets: (pets: PetType[]) => void;
  togglePet: (pet: PetType) => void;
  setEducation: (level: EducationLevel | null) => void;
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
}

const initialState = {
  currentStep: "welcome" as OnboardingStep,
  email: "",
  phone: "",
  password: "",
  name: "",
  dateOfBirth: "",
  gender: null,
  photos: [],
  verificationPhotoUri: null,
  bio: "",
  profilePrompts: [],
  height: null,
  weight: null,
  smoking: null,
  drinking: null,
  kids: null,
  exercise: null,
  pets: [],
  education: null,
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

      setStep: (step) => set({ currentStep: step }),

      setEmail: (email) => set({ email }),

      setPhone: (phone) => set({ phone }),

      setPassword: (password) => set({ password }),

      setName: (name) => set({ name }),

      setDateOfBirth: (dateOfBirth) => set({ dateOfBirth }),

      setGender: (gender) => set({ gender }),

      addPhoto: (uri) =>
        set((state) => ({
          photos:
            state.photos.length < 6 ? [...state.photos, uri] : state.photos,
        })),

      removePhoto: (index) =>
        set((state) => ({
          photos: state.photos.filter((_, i) => i !== index),
        })),

      reorderPhotos: (photos) => set({ photos }),

      setVerificationPhoto: (uri) => set({ verificationPhotoUri: uri }),

      setBio: (bio) => set({ bio }),

      setProfilePrompts: (profilePrompts) => set({ profilePrompts }),

      setHeight: (height) => set({ height }),

      setWeight: (weight) => set({ weight }),

      setSmoking: (smoking) => set({ smoking }),

      setDrinking: (drinking) => set({ drinking }),

      setKids: (kids) => set({ kids }),

      setExercise: (exercise) => set({ exercise }),

      setPets: (pets) => set({ pets }),

      togglePet: (pet) =>
        set((state) => ({
          pets: state.pets.includes(pet)
            ? state.pets.filter((p) => p !== pet)
            : [...state.pets, pet],
        })),

      setEducation: (education) => set({ education }),

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
    },
  ),
);
