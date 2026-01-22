import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  onboardingCompleted: boolean;

  // Actions
  setAuth: (userId: string, token: string, onboardingCompleted: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      userId: null,
      token: null,
      isLoading: false,
      error: null,
      onboardingCompleted: false,

      setAuth: (userId, token, onboardingCompleted) =>
        set({
          isAuthenticated: true,
          userId,
          token,
          error: null,
          onboardingCompleted,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      setOnboardingCompleted: (completed) =>
        set({ onboardingCompleted: completed }),

      logout: () =>
        set({
          isAuthenticated: false,
          userId: null,
          token: null,
          error: null,
          onboardingCompleted: false,
        }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
