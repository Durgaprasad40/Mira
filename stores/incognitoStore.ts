import { create } from 'zustand';

interface IncognitoState {
  isActive: boolean;
  setActive: (active: boolean) => void;
  toggle: () => void;
}

export const useIncognitoStore = create<IncognitoState>((set) => ({
  isActive: false,
  setActive: (active) => set({ isActive: active }),
  toggle: () => set((state) => ({ isActive: !state.isActive })),
}));
