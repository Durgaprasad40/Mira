import { create } from 'zustand';
import {
  Gender,
  RelationshipIntent,
  ActivityFilter,
  SortOption,
  FilterState,
} from '@/types';

interface FilterStoreState extends FilterState {
  // Actions
  setGender: (genders: Gender[]) => void;
  toggleGender: (gender: Gender) => void;
  setMinAge: (age: number) => void;
  setMaxAge: (age: number) => void;
  setMaxDistance: (distance: number) => void;
  setRelationshipIntent: (intents: RelationshipIntent[]) => void;
  toggleRelationshipIntent: (intent: RelationshipIntent) => void;
  setActivities: (activities: ActivityFilter[]) => void;
  toggleActivity: (activity: ActivityFilter) => void;
  setSortBy: (sort: SortOption) => void;
  clearFilters: () => void;
  clearIntentFilters: () => void;
  clearActivityFilters: () => void;
}

const initialState: FilterState = {
  gender: [],
  minAge: 18,
  maxAge: 100,
  maxDistance: 100,
  relationshipIntent: [],
  activities: [],
  sortBy: 'recommended',
};

export const useFilterStore = create<FilterStoreState>((set) => ({
  ...initialState,

  setGender: (gender) => set({ gender }),

  toggleGender: (gender) =>
    set((state) => ({
      gender: state.gender.includes(gender)
        ? state.gender.filter((g) => g !== gender)
        : [...state.gender, gender],
    })),

  setMinAge: (minAge) => set({ minAge }),

  setMaxAge: (maxAge) => set({ maxAge }),

  setMaxDistance: (maxDistance) => set({ maxDistance }),

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
