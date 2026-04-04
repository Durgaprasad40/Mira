/**
 * Chat Theme Store
 *
 * Zustand store for managing chat room theme preferences.
 * Persists theme selection to AsyncStorage.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatThemeId, getTheme, ChatTheme } from '@/lib/chatThemes';

interface ChatThemeState {
  // Current selected theme ID
  themeId: ChatThemeId;

  // Set theme
  setTheme: (themeId: ChatThemeId) => void;

  // Get current theme object
  getTheme: () => ChatTheme;
}

export const useChatThemeStore = create<ChatThemeState>()(
  persist(
    (set, get) => ({
      themeId: 'default',

      setTheme: (themeId: ChatThemeId) => {
        set({ themeId });
      },

      getTheme: () => {
        return getTheme(get().themeId);
      },
    }),
    {
      name: 'chat-theme-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ themeId: state.themeId }),
    }
  )
);

/**
 * Hook to get current theme colors directly
 * Convenience hook for components
 */
export function useChatThemeColors() {
  const themeId = useChatThemeStore((s) => s.themeId);
  return getTheme(themeId).colors;
}
