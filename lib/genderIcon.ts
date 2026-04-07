/**
 * Gender Icon Utility
 *
 * P2-004: Centralized gender icon mapping to eliminate duplicate implementations.
 * Supports Ionicons and Unicode symbol variants.
 */

import type { Ionicons } from '@expo/vector-icons';

// ═══════════════════════════════════════════════════════════════════════════
// Ionicons Gender Icon
// ═══════════════════════════════════════════════════════════════════════════

export type GenderIconName = 'male' | 'female' | 'male-female' | 'person-outline';

/**
 * Get Ionicons name for gender display.
 * Handles variations: 'male', 'm', 'female', 'f', 'non_binary', etc.
 *
 * @param gender - Gender string (case-insensitive)
 * @returns Ionicons glyph name
 */
export function getGenderIcon(gender: string | undefined): keyof typeof Ionicons.glyphMap {
  if (!gender) return 'person-outline';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  return 'male-female'; // non-binary or other
}

/**
 * Get Ionicons name for gender, returning null if unknown.
 * Use when you want to conditionally render the icon.
 *
 * @param gender - Gender string (case-insensitive)
 * @returns Ionicons glyph name or null
 */
export function getGenderIconOrNull(gender: string | undefined): keyof typeof Ionicons.glyphMap | null {
  if (!gender) return null;
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  return 'male-female';
}

// ═══════════════════════════════════════════════════════════════════════════
// Unicode Gender Symbol (for text displays)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get Unicode symbol for gender display in text.
 * ♂ = male, ♀ = female, ⚧ = other/non-binary
 *
 * @param gender - Gender string (case-insensitive)
 * @returns Unicode symbol or empty string
 */
export function getGenderSymbol(gender: string | undefined): string {
  if (!gender) return '';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return '♂';
  if (g === 'female' || g === 'f') return '♀';
  return '⚧';
}

// ═══════════════════════════════════════════════════════════════════════════
// Gender Icon with Color
// ═══════════════════════════════════════════════════════════════════════════

export interface GenderIconInfo {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

/**
 * Get gender icon with associated color.
 *
 * @param gender - Gender string (case-insensitive)
 * @returns Object with icon name and color
 */
export function getGenderIconWithColor(gender: string | undefined): GenderIconInfo {
  if (!gender) return { icon: 'person-outline', color: '#888888' };
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return { icon: 'male', color: '#4A90D9' };
  if (g === 'female' || g === 'f') return { icon: 'female', color: '#E91E8C' };
  return { icon: 'male-female', color: '#9B59B6' };
}
