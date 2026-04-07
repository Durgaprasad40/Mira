/**
 * Typography System for Cross-Device Consistency
 *
 * This module provides standardized font sizes and text styles
 * that scale appropriately across different devices.
 *
 * Usage:
 *   import { FONT_SIZE, TEXT_STYLE, lineHeight } from '@/lib/typography';
 *
 *   // Use predefined font sizes
 *   fontSize: FONT_SIZE.md
 *
 *   // Use complete text styles
 *   <Text style={TEXT_STYLE.body}>Hello</Text>
 *
 *   // Calculate line height for custom sizes
 *   lineHeight: lineHeight(16, 1.4)
 */

import { Platform, TextStyle } from 'react-native';
import { moderateScale, FONT_SCALE, platformSelect } from './responsive';

// Inline color values to avoid circular import with constants.ts
// (constants.ts re-exports from typography.ts, which would cause COLORS to be undefined)
const TEXT_COLORS = {
  text: '#333333',
  textLight: '#666666',
  textMuted: '#999999',
  primary: '#FF6B6B',
  error: '#F44336',
  success: '#4CAF50',
};

// ═══════════════════════════════════════════════════════════════════════════
// FONT SIZES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standardized font sizes with moderate scaling.
 * Use these instead of hardcoded pixel values.
 *
 * Scale factor 0.4 provides subtle scaling - enough to adapt
 * to different screens without dramatic changes.
 */
export const FONT_SIZE = {
  /** 9px - Micro text (timestamps, badges) */
  xxs: moderateScale(9, 0.4),
  /** 10px - Tiny text (badges, labels) */
  xs: moderateScale(10, 0.4),
  /** 11px - Small labels */
  sm: moderateScale(11, 0.4),
  /** 12px - Captions, secondary text */
  caption: moderateScale(12, 0.4),
  /** 13px - Small body text */
  body2: moderateScale(13, 0.4),
  /** 14px - Body text (base) */
  md: moderateScale(14, 0.4),
  /** 14px - Body text alias */
  body: moderateScale(14, 0.4),
  /** 16px - Large body, button text */
  lg: moderateScale(16, 0.4),
  /** 18px - Subtitles */
  xl: moderateScale(18, 0.4),
  /** 20px - Section headers */
  xxl: moderateScale(20, 0.4),
  /** 24px - Page titles */
  title: moderateScale(24, 0.4),
  /** 28px - Large titles */
  h2: moderateScale(28, 0.4),
  /** 32px - Hero text */
  h1: moderateScale(32, 0.4),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// FONT WEIGHTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Font weight values.
 * Note: Android may render weights differently than iOS.
 */
export const FONT_WEIGHT = {
  /** Thin - 100 (may not be available on all devices) */
  thin: '100' as const,
  /** Light - 300 */
  light: '300' as const,
  /** Normal/Regular - 400 */
  normal: '400' as const,
  /** Medium - 500 */
  medium: '500' as const,
  /** Semi-bold - 600 */
  semibold: '600' as const,
  /** Bold - 700 */
  bold: '700' as const,
  /** Extra bold - 800 */
  extrabold: '800' as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// LINE HEIGHT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard line height multipliers.
 */
export const LINE_HEIGHT_MULTIPLIER = {
  /** Tight - for headings */
  tight: 1.2,
  /** Normal - for body text */
  normal: 1.4,
  /** Relaxed - for comfortable reading */
  relaxed: 1.6,
  /** Loose - for spacious text */
  loose: 1.8,
} as const;

/**
 * Calculate line height for a given font size.
 *
 * @param fontSize - The font size in pixels
 * @param multiplier - Line height multiplier (default 1.4)
 * @returns Line height in pixels, rounded
 *
 * @example
 * lineHeight(14) // 20 (14 * 1.4)
 * lineHeight(16, 1.2) // 19 (16 * 1.2)
 */
export function lineHeight(fontSize: number, multiplier: number = 1.4): number {
  return Math.round(fontSize * multiplier);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT STYLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-defined text styles for common use cases.
 * Use these for consistent typography across the app.
 */
export const TEXT_STYLE: Record<string, TextStyle> = {
  // ── Headings ──
  h1: {
    fontSize: FONT_SIZE.h1,
    fontWeight: FONT_WEIGHT.bold,
    lineHeight: lineHeight(FONT_SIZE.h1, LINE_HEIGHT_MULTIPLIER.tight),
    color: TEXT_COLORS.text,
  },
  h2: {
    fontSize: FONT_SIZE.h2,
    fontWeight: FONT_WEIGHT.bold,
    lineHeight: lineHeight(FONT_SIZE.h2, LINE_HEIGHT_MULTIPLIER.tight),
    color: TEXT_COLORS.text,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: FONT_WEIGHT.bold,
    lineHeight: lineHeight(FONT_SIZE.title, LINE_HEIGHT_MULTIPLIER.tight),
    color: TEXT_COLORS.text,
  },
  subtitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: FONT_WEIGHT.semibold,
    lineHeight: lineHeight(FONT_SIZE.xl, LINE_HEIGHT_MULTIPLIER.tight),
    color: TEXT_COLORS.text,
  },
  sectionHeader: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: FONT_WEIGHT.bold,
    lineHeight: lineHeight(FONT_SIZE.xxl, LINE_HEIGHT_MULTIPLIER.tight),
    color: TEXT_COLORS.text,
  },

  // ── Body Text ──
  bodyLarge: {
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.normal,
    lineHeight: lineHeight(FONT_SIZE.lg, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.text,
  },
  body: {
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.normal,
    lineHeight: lineHeight(FONT_SIZE.body, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.text,
  },
  bodySmall: {
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.normal,
    lineHeight: lineHeight(FONT_SIZE.body2, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.text,
  },

  // ── Captions & Labels ──
  caption: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.normal,
    lineHeight: lineHeight(FONT_SIZE.caption, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.textLight,
  },
  captionBold: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    lineHeight: lineHeight(FONT_SIZE.caption, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.textLight,
  },
  label: {
    fontSize: FONT_SIZE.sm,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: lineHeight(FONT_SIZE.sm, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.textMuted,
  },
  labelSmall: {
    fontSize: FONT_SIZE.xs,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: lineHeight(FONT_SIZE.xs, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.textMuted,
  },

  // ── UI Elements ──
  button: {
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.semibold,
    lineHeight: lineHeight(FONT_SIZE.lg, LINE_HEIGHT_MULTIPLIER.tight),
  },
  buttonSmall: {
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.semibold,
    lineHeight: lineHeight(FONT_SIZE.md, LINE_HEIGHT_MULTIPLIER.tight),
  },
  link: {
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: lineHeight(FONT_SIZE.md, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.primary,
  },
  badge: {
    fontSize: FONT_SIZE.xs,
    fontWeight: FONT_WEIGHT.bold,
    lineHeight: lineHeight(FONT_SIZE.xs, LINE_HEIGHT_MULTIPLIER.tight),
  },
  chip: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: lineHeight(FONT_SIZE.caption, LINE_HEIGHT_MULTIPLIER.tight),
  },
  timestamp: {
    fontSize: FONT_SIZE.sm,
    fontWeight: FONT_WEIGHT.normal,
    lineHeight: lineHeight(FONT_SIZE.sm, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.textMuted,
  },

  // ── Special ──
  error: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: lineHeight(FONT_SIZE.caption, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.error,
  },
  success: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: lineHeight(FONT_SIZE.caption, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.success,
  },
  muted: {
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.normal,
    lineHeight: lineHeight(FONT_SIZE.md, LINE_HEIGHT_MULTIPLIER.normal),
    color: TEXT_COLORS.textMuted,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// ACCESSIBILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if user has increased font size in system settings.
 * Use to conditionally adjust layouts.
 */
export const hasLargeFontScale = FONT_SCALE > 1.2;

/**
 * Get an accessibility-aware font size.
 * Caps the maximum scale to prevent layout breaking.
 *
 * @param baseSize - Base font size
 * @param maxScale - Maximum scale factor (default 1.3)
 */
export function accessibleFontSize(baseSize: number, maxScale: number = 1.3): number {
  const scaledSize = baseSize * Math.min(FONT_SCALE, maxScale);
  return Math.round(scaledSize);
}
