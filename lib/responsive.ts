/**
 * Responsive Design System for Cross-Device Consistency
 *
 * This module provides utilities for scaling UI elements consistently
 * across different screen sizes and pixel densities.
 *
 * Usage:
 *   import { normalize, moderateScale, SCALE, SPACING } from '@/lib/responsive';
 *
 *   // For sizes that should scale linearly with screen width
 *   fontSize: normalize(14)
 *
 *   // For sizes that should scale moderately (recommended for most UI)
 *   padding: moderateScale(16)
 *
 *   // For sizes that should scale minimally (good for icons, borders)
 *   borderRadius: moderateScale(8, 0.3)
 */

import { Dimensions, PixelRatio, Platform, StyleSheet } from 'react-native';

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN DIMENSIONS
// ═══════════════════════════════════════════════════════════════════════════

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Base design width (iPhone 13/14 standard width)
const DESIGN_WIDTH = 375;
const DESIGN_HEIGHT = 812;

// ═══════════════════════════════════════════════════════════════════════════
// SCALE FACTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Linear scale factor based on screen width.
 * Values > 1 mean larger screen, < 1 mean smaller screen.
 */
export const SCALE = SCREEN_WIDTH / DESIGN_WIDTH;

/**
 * Vertical scale factor for height-dependent layouts.
 */
export const VERTICAL_SCALE = SCREEN_HEIGHT / DESIGN_HEIGHT;

/**
 * Capped scale factor to prevent extreme scaling on tablets.
 * Range: 0.85 to 1.15
 */
export const CAPPED_SCALE = Math.max(0.85, Math.min(SCALE, 1.15));

// ═══════════════════════════════════════════════════════════════════════════
// SCALING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a size value based on screen width.
 * Use for elements that should scale linearly with screen size.
 *
 * @param size - The base size in pixels (designed for 375px width)
 * @returns Scaled size rounded to nearest pixel
 *
 * @example
 * // On 375px screen: 16
 * // On 414px screen: ~17.6 -> 18
 * // On 320px screen: ~13.6 -> 14
 * normalize(16)
 */
export function normalize(size: number): number {
  return Math.round(size * SCALE);
}

/**
 * Moderate scale - scales less aggressively than normalize().
 * Recommended for most UI elements like padding, margins, font sizes.
 *
 * @param size - The base size in pixels
 * @param factor - How much of the scale difference to apply (0-1, default 0.5)
 * @returns Scaled size rounded to nearest pixel
 *
 * @example
 * // factor 0.5 means apply 50% of the scale difference
 * // On 414px screen with size 16: 16 + (17.6 - 16) * 0.5 = 16.8 -> 17
 * moderateScale(16)
 *
 * // factor 0.25 for minimal scaling (good for icons)
 * moderateScale(24, 0.25)
 */
export function moderateScale(size: number, factor: number = 0.5): number {
  const scaledSize = size * SCALE;
  return Math.round(size + (scaledSize - size) * factor);
}

/**
 * Vertical scale - use for heights that should adapt to screen height.
 *
 * @param size - The base size in pixels
 * @returns Scaled size rounded to nearest pixel
 */
export function verticalScale(size: number): number {
  return Math.round(size * VERTICAL_SCALE);
}

/**
 * Scale with cap - prevents extreme scaling on very large/small screens.
 * Good for critical UI elements that shouldn't change too much.
 *
 * @param size - The base size in pixels
 * @returns Scaled size within reasonable bounds
 */
export function cappedScale(size: number): number {
  return Math.round(size * CAPPED_SCALE);
}

// ═══════════════════════════════════════════════════════════════════════════
// PIXEL RATIO UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get device pixel ratio for high-DPI adjustments.
 */
export const PIXEL_RATIO = PixelRatio.get();

/**
 * Get font scale for accessibility adjustments.
 */
export const FONT_SCALE = PixelRatio.getFontScale();

/**
 * Check if device has high pixel density (Retina/high-DPI).
 */
export const IS_HIGH_DPI = PIXEL_RATIO >= 2;

/**
 * Normalize border width for consistent appearance across DPIs.
 * On high-DPI devices, 1px borders can look too thin.
 *
 * @param width - Desired border width
 * @returns Adjusted border width for the device
 */
export function normalizeBorder(width: number): number {
  if (width === 1) {
    return StyleSheet.hairlineWidth;
  }
  return width / PIXEL_RATIO * Math.min(PIXEL_RATIO, 2);
}

/**
 * Hairline width - thinnest possible line on device.
 * Use instead of borderWidth: 1 for consistent thin borders.
 */
export const HAIRLINE = StyleSheet.hairlineWidth;

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSIVE SPACING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standardized spacing values with moderate scaling.
 * Use these instead of hardcoded pixel values.
 */
export const SPACING = {
  /** 2px - Micro spacing */
  xxs: moderateScale(2, 0.25),
  /** 4px - Extra small */
  xs: moderateScale(4, 0.25),
  /** 8px - Small */
  sm: moderateScale(8, 0.5),
  /** 12px - Medium-small */
  md: moderateScale(12, 0.5),
  /** 16px - Medium (base unit) */
  base: moderateScale(16, 0.5),
  /** 20px - Medium-large */
  lg: moderateScale(20, 0.5),
  /** 24px - Large */
  xl: moderateScale(24, 0.5),
  /** 32px - Extra large */
  xxl: moderateScale(32, 0.5),
  /** 48px - Huge */
  xxxl: moderateScale(48, 0.5),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSIVE SIZING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard component sizes with moderate scaling.
 */
export const SIZES = {
  /** Icon sizes */
  icon: {
    xs: moderateScale(12, 0.3),
    sm: moderateScale(16, 0.3),
    md: moderateScale(20, 0.3),
    lg: moderateScale(24, 0.3),
    xl: moderateScale(32, 0.3),
  },
  /** Avatar sizes */
  avatar: {
    xs: moderateScale(24, 0.4),
    sm: moderateScale(32, 0.4),
    md: moderateScale(40, 0.4),
    lg: moderateScale(56, 0.4),
    xl: moderateScale(80, 0.4),
  },
  /** Button heights */
  button: {
    sm: moderateScale(32, 0.4),
    md: moderateScale(44, 0.4),
    lg: moderateScale(56, 0.4),
  },
  /** Border radius */
  radius: {
    xxs: moderateScale(2, 0.25),
    xs: moderateScale(4, 0.25),
    sm: moderateScale(8, 0.25),
    md: moderateScale(12, 0.25),
    lg: moderateScale(16, 0.25),
    xl: moderateScale(24, 0.25),
    full: 9999,
  },
  /** Touch target minimum (accessibility) */
  touchTarget: moderateScale(44, 0.25),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN INFO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Screen dimension info for conditional rendering.
 */
export const SCREEN = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  isSmall: SCREEN_WIDTH < 360,
  isMedium: SCREEN_WIDTH >= 360 && SCREEN_WIDTH < 400,
  isLarge: SCREEN_WIDTH >= 400,
  isShort: SCREEN_HEIGHT < 700,
  isTall: SCREEN_HEIGHT >= 800,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Platform-specific values helper.
 *
 * @example
 * platformSelect({ ios: 10, android: 12, default: 10 })
 */
export function platformSelect<T>(options: {
  ios?: T;
  android?: T;
  default: T;
}): T {
  if (Platform.OS === 'ios' && options.ios !== undefined) {
    return options.ios;
  }
  if (Platform.OS === 'android' && options.android !== undefined) {
    return options.android;
  }
  return options.default;
}

// ═══════════════════════════════════════════════════════════════════════════
// FLEX UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Common flex styles for consistent layouts.
 */
export const FLEX = {
  /** Prevent element from shrinking */
  noShrink: { flexShrink: 0 },
  /** Allow element to shrink */
  shrink: { flexShrink: 1 },
  /** Fill available space */
  grow: { flexGrow: 1 },
  /** Fill and shrink */
  flex1: { flex: 1 },
  /** Row layout */
  row: { flexDirection: 'row' as const },
  /** Column layout */
  column: { flexDirection: 'column' as const },
  /** Center content */
  center: { alignItems: 'center' as const, justifyContent: 'center' as const },
  /** Space between */
  spaceBetween: { justifyContent: 'space-between' as const },
} as const;
