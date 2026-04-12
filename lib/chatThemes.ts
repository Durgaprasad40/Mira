/**
 * Chat Rooms Theme System
 *
 * Lightweight theme configuration for Phase-2 Chat Rooms.
 * Allows users to personalize chat appearance with 4 visual themes.
 */

export type ChatThemeId = 'default' | 'softDark' | 'deepConnect' | 'cleanMinimal';

export interface ChatTheme {
  id: ChatThemeId;
  name: string;
  description: string;
  colors: {
    // Main backgrounds
    background: string;
    dmBackground: string;
    surface: string;
    // Message bubbles
    bubbleMe: string;
    bubbleOther: string;
    bubbleMeText: string;
    bubbleOtherText: string;
    // UI elements
    accent: string;
    text: string;
    textLight: string;
    border: string;
    primary: string;
  };
}

/**
 * Theme Definitions
 */
export const CHAT_THEMES: Record<ChatThemeId, ChatTheme> = {
  // Default - Current blue-purple dark theme
  default: {
    id: 'default',
    name: 'Midnight',
    description: 'Classic dark blue theme',
    colors: {
      background: '#1A1A2E',
      dmBackground: '#1F1A30',
      surface: '#16213E',
      bubbleMe: '#0F3460',
      bubbleOther: '#16213E',
      bubbleMeText: '#E0E0E0',
      bubbleOtherText: '#E0E0E0',
      accent: '#0F3460',
      text: '#E0E0E0',
      textLight: '#9E9E9E',
      border: '#2D3748',
      primary: '#E94560',
    },
  },

  // Soft Dark - Warmer, softer dark theme
  softDark: {
    id: 'softDark',
    name: 'Soft Dark',
    description: 'Warm and cozy dark theme',
    colors: {
      background: '#1E1E24',
      dmBackground: '#252528',
      surface: '#2A2A32',
      bubbleMe: '#3D3D4A',
      bubbleOther: '#2A2A32',
      bubbleMeText: '#F0F0F0',
      bubbleOtherText: '#E8E8E8',
      accent: '#3D3D4A',
      text: '#F0F0F0',
      textLight: '#A0A0A8',
      border: '#3A3A42',
      primary: '#FF7B9C',
    },
  },

  // Deep Connect - Rich purple theme
  deepConnect: {
    id: 'deepConnect',
    name: 'Deep Connect',
    description: 'Rich purple connection theme',
    colors: {
      background: '#1A1625',
      dmBackground: '#211B2E',
      surface: '#251E35',
      bubbleMe: '#4A3366',
      bubbleOther: '#2D2440',
      bubbleMeText: '#F5F0FF',
      bubbleOtherText: '#E8E0F0',
      accent: '#4A3366',
      text: '#F0E8FF',
      textLight: '#A898C0',
      border: '#3D3250',
      primary: '#9D6FFF',
    },
  },

  // Clean Minimal - Modern minimal dark
  cleanMinimal: {
    id: 'cleanMinimal',
    name: 'Clean Minimal',
    description: 'Modern minimal aesthetic',
    colors: {
      background: '#0D0D0F',
      dmBackground: '#121214',
      surface: '#1A1A1D',
      bubbleMe: '#2C2C30',
      bubbleOther: '#1A1A1D',
      bubbleMeText: '#FFFFFF',
      bubbleOtherText: '#F0F0F0',
      accent: '#2C2C30',
      text: '#FFFFFF',
      textLight: '#808088',
      border: '#2A2A2E',
      primary: '#00D9FF',
    },
  },
};

/**
 * Get theme by ID with fallback to default
 */
export function getTheme(themeId: ChatThemeId): ChatTheme {
  return CHAT_THEMES[themeId] || CHAT_THEMES.default;
}

/**
 * Get all available themes as array
 */
export function getAllThemes(): ChatTheme[] {
  return Object.values(CHAT_THEMES);
}

/**
 * Theme preview colors for selector UI
 */
export function getThemePreviewColors(themeId: ChatThemeId): string[] {
  const theme = getTheme(themeId);
  return [
    theme.colors.background,
    theme.colors.bubbleMe,
    theme.colors.primary,
  ];
}
