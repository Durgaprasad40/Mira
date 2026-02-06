import { create } from 'zustand';
import {
  Gender,
  RelationshipIntent,
  ActivityFilter,
  SortOption,
  FilterState,
} from '@/types';

// Conversion constants
const KM_PER_MILE = 1.60934;
const MILE_PER_KM = 1 / KM_PER_MILE;

// Helper functions for miles <-> km conversion
export const milesToKm = (miles: number): number => Math.round(miles * KM_PER_MILE);
export const kmToMiles = (km: number): number => Math.round(km * MILE_PER_KM);

interface FilterStoreState extends FilterState {
  // Alias for gender
  lookingFor: Gender[];
  setLookingFor: (genders: Gender[]) => void;

  // Filter version - incremented on save to trigger refetch
  filterVersion: number;
  incrementFilterVersion: () => void;

  // Actions
  setGender: (genders: Gender[]) => void;
  toggleGender: (gender: Gender) => void;
  setMinAge: (age: number) => void;
  setMaxAge: (age: number) => void;

  // Distance stored in km internally
  setMaxDistanceKm: (km: number) => void;
  setMaxDistanceMiles: (miles: number) => void;
  getMaxDistanceMiles: () => number;

  // Legacy alias (stores km)
  setMaxDistance: (km: number) => void;

  setRelationshipIntent: (intents: RelationshipIntent[]) => void;
  toggleRelationshipIntent: (intent: RelationshipIntent) => void;
  setActivities: (activities: ActivityFilter[]) => void;
  toggleActivity: (activity: ActivityFilter) => void;
  setSortBy: (sort: SortOption) => void;
  clearFilters: () => void;
  clearIntentFilters: () => void;
  clearActivityFilters: () => void;
}

// Default 80km (~50 miles)
const DEFAULT_MAX_DISTANCE_KM = 80;

const initialState: FilterState = {
  gender: [],
  minAge: 18,
  maxAge: 70,
  maxDistance: DEFAULT_MAX_DISTANCE_KM, // Stored in km
  relationshipIntent: [],
  activities: [],
  sortBy: 'recommended',
};

export const useFilterStore = create<FilterStoreState>((set, get) => ({
  ...initialState,
  lookingFor: initialState.gender,
  filterVersion: 0,

  incrementFilterVersion: () => set((state) => ({ filterVersion: state.filterVersion + 1 })),

  setLookingFor: (genders) => set({ gender: genders, lookingFor: genders }),

  setGender: (gender) => set({ gender, lookingFor: gender }),

  toggleGender: (gender) =>
    set((state) => {
      const next = state.gender.includes(gender)
        ? state.gender.filter((g) => g !== gender)
        : [...state.gender, gender];
      return { gender: next, lookingFor: next };
    }),

  setMinAge: (minAge) => set({ minAge }),

  setMaxAge: (maxAge) => set({ maxAge }),

  // Distance methods - all store in km internally
  setMaxDistanceKm: (km) => set({ maxDistance: km }),

  setMaxDistanceMiles: (miles) => set({ maxDistance: milesToKm(miles) }),

  getMaxDistanceMiles: () => kmToMiles(get().maxDistance),

  // Legacy alias - stores km
  setMaxDistance: (km) => set({ maxDistance: km }),

  setRelationshipIntent: (relationshipIntent) => set({ relationshipIntent }),

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

  setSortBy: (sortBy) => set({ sortBy }),

  clearFilters: () => set(initialState),

  clearIntentFilters: () => set({ relationshipIntent: [] }),

  clearActivityFilters: () => set({ activities: [] }),
}));
