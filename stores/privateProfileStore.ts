import { create } from 'zustand';
import type { DesireCategory } from '@/types';

interface PrivateProfile {
  username: string;
  bio: string;
  desireCategories: DesireCategory[];
  blurPhoto: boolean;
}

interface PrivateProfileState {
  profile: PrivateProfile;
  isSetup: boolean;
  setProfile: (updates: Partial<PrivateProfile>) => void;
  markSetup: () => void;
}

export const usePrivateProfileStore = create<PrivateProfileState>((set) => ({
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
}));
