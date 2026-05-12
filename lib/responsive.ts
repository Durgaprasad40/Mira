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
  /** P2-011: Badge size for notification indicators */
  badgeSize: moderateScale(16, 0.3),
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
  isTablet: SCREEN_WIDTH >= 600, // Tablet detection for layout constraints
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

// ═══════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY SCALING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize font size for consistent rendering across devices.
 * Uses conservative scaling to prevent text from becoming too small or large.
 *
 * @param size - Base font size
 * @param options - Scaling options
 * @returns Scaled font size
 */
export function normalizeFont(
  size: number,
  options: { minSize?: number; maxSize?: number; factor?: number } = {}
): number {
  const { minSize = size * 0.85, maxSize = size * 1.15, factor = 0.35 } = options;
  const scaled = moderateScale(size, factor);
  return Math.round(Math.max(minSize, Math.min(maxSize, scaled)));
}

/**
 * Get responsive font size for tab labels.
 * Ensures labels fit on smaller screens without clipping.
 * Slightly larger on tablets for comfortable reading.
 */
export function getTabLabelFontSize(): number {
  // Tablet: comfortable larger size
  if (SCREEN.isTablet) return 12;
  // Small phones: reduce to prevent clipping
  if (SCREEN_WIDTH < 360) return 9;
  if (SCREEN_WIDTH < 390) return 10;
  return 11;
}

/**
 * Get max width for tab labels to prevent overflow.
 * Based on 5 tabs, accounts for icon and padding.
 */
export function getTabLabelMaxWidth(): number {
  // Available width per tab = screen width / 5 tabs - icon and padding
  const tabWidth = SCREEN_WIDTH / 5;
  return Math.floor(tabWidth - 24); // Reserve 24px for icon and padding
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT UI CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chat-specific sizing constants with responsive scaling.
 * Tablet: slightly larger for comfortable viewing on bigger screens.
 */
export const CHAT_SIZES = {
  /** Message bubble max width - wider on tablets */
  bubbleMaxWidth: SCREEN.isTablet
    ? Math.min(SCREEN_WIDTH * 0.65, 480)
    : Math.min(SCREEN_WIDTH * 0.78, 320),
  /** Avatar size in message list - larger on tablets */
  messageAvatar: SCREEN.isTablet ? moderateScale(40, 0.3) : moderateScale(34, 0.3),
  /** Avatar size in member strip - larger on tablets */
  stripAvatar: SCREEN.isTablet ? moderateScale(32, 0.3) : moderateScale(28, 0.3),
  /** Avatar size in online users panel - larger on tablets */
  panelAvatar: SCREEN.isTablet ? moderateScale(37, 0.3) : moderateScale(33, 0.3),
  /** Bubble border radius */
  bubbleRadius: moderateScale(16, 0.25),
  /** Reply preview max lines */
  replyPreviewLines: SCREEN.isSmall ? 2 : 3,
  /** Minimum touch target - larger on tablets */
  touchTarget: SCREEN.isTablet ? 48 : 44,
  /** Container padding - larger on tablets */
  containerPadding: SCREEN.isTablet ? moderateScale(16, 0.5) : moderateScale(12, 0.5),
  /** Emoji button size in reaction bar - needs to be touch-friendly */
  emojiButton: moderateScale(40, 0.4),
  /** Emoji font size in reaction bar - scales carefully to avoid rendering issues */
  emojiSize: moderateScale(22, 0.3),  // Slightly smaller than 24 for better perf
  /** Emoji font size in reaction chips - smaller for inline display */
  emojiChipSize: moderateScale(14, 0.3),
  /** Header avatar size */
  headerAvatar: moderateScale(32, 0.4),
  /** Header icon sizes */
  headerIconSm: moderateScale(22, 0.3),
  headerIconMd: moderateScale(24, 0.3),
  headerIconLg: moderateScale(26, 0.3),
} as const;

/**
 * Typography sizes for Chat Rooms - responsive with careful scaling.
 * These values prevent text from becoming too small on small screens
 * or too large on tablets.
 */
export const CHAT_FONTS = {
  /** Header title (room name) */
  headerTitle: normalizeFont(18, { minSize: 16, maxSize: 20 }),
  /** Header subtitle (countdown, etc.) */
  headerSubtitle: normalizeFont(12, { minSize: 11, maxSize: 13 }),
  /** Online count badge text */
  onlineCount: normalizeFont(12, { minSize: 11, maxSize: 13 }),
  /** Notification badge text */
  badgeText: normalizeFont(9, { minSize: 8, maxSize: 10 }),
  /** Message body text */
  messageText: normalizeFont(14, { minSize: 13, maxSize: 15 }),
  /** Sender name in messages */
  senderName: normalizeFont(11, { minSize: 10, maxSize: 12 }),
  /** Reaction chip count */
  reactionCount: normalizeFont(12, { minSize: 11, maxSize: 13 }),
  /** User name in panels/lists */
  userName: normalizeFont(14, { minSize: 13, maxSize: 15 }),
  /** Secondary/timestamp text */
  secondary: normalizeFont(10, { minSize: 9, maxSize: 11 }),
  /** Label text (e.g., "X online") */
  label: normalizeFont(12, { minSize: 11, maxSize: 13 }),
  // P2-001: Additional typography constants for consistency
  /** Panel header title */
  panelTitle: normalizeFont(18, { minSize: 16, maxSize: 20 }),
  /** Section header text */
  sectionHeader: normalizeFont(11, { minSize: 10, maxSize: 12 }),
  /** Room card title */
  roomTitle: normalizeFont(16, { minSize: 15, maxSize: 17 }),
  /** Room card subtitle/activity */
  roomActivity: normalizeFont(13, { minSize: 12, maxSize: 14 }),
  /** Empty state title */
  emptyTitle: normalizeFont(16, { minSize: 15, maxSize: 17 }),
  /** Empty state subtitle */
  emptySubtitle: normalizeFont(13, { minSize: 12, maxSize: 14 }),
  /** Button text */
  buttonText: normalizeFont(14, { minSize: 13, maxSize: 15 }),
  /** Input text */
  inputText: normalizeFont(15, { minSize: 14, maxSize: 16 }),
  /** Date separator */
  dateSeparator: normalizeFont(12, { minSize: 11, maxSize: 13 }),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// CHAT ROOMS UI NORMALIZATION TOKENS
// ═══════════════════════════════════════════════════════════════════════════

export const CHAT_ROOM_HEADER_HEIGHT = moderateScale(52, 0.3);
export const CHAT_ROOM_HEADER_AVATAR_SIZE = CHAT_SIZES.headerAvatar;
export const CHAT_ROOM_MESSAGE_AVATAR_SIZE = CHAT_SIZES.messageAvatar;
export const CHAT_ROOM_BUBBLE_PADDING_H = SPACING.md;
export const CHAT_ROOM_BUBBLE_PADDING_V = SPACING.sm;
export const CHAT_ROOM_BUBBLE_RADIUS = CHAT_SIZES.bubbleRadius;
export const CHAT_ROOM_BUBBLE_MAX_WIDTH = CHAT_SIZES.bubbleMaxWidth;
export const CHAT_ROOM_MESSAGE_ROW_GAP = SPACING.xs;
export const CHAT_ROOM_COMPOSER_VERTICAL_PADDING = SPACING.sm;
export const CHAT_ROOM_INPUT_HEIGHT_MIN = moderateScale(40, 0.3);
export const CHAT_ROOM_INPUT_HEIGHT_MAX = moderateScale(120, 0.3);
export const CHAT_ROOM_ICON_BUTTON_SIZE = moderateScale(40, 0.3);
export const CHAT_ROOM_ICON_SIZE = SIZES.icon.lg;
export const CHAT_ROOM_BADGE_SIZE = moderateScale(18, 0.25);
export const CHAT_ROOM_BADGE_FONT = normalizeFont(10, { minSize: 9, maxSize: 11 });
export const CHAT_ROOM_KEYBOARD_GAP = 40;
export const CHAT_ROOM_MAX_FONT_SCALE = 1.2;

export function getChatRoomClosedBottomInset(insetsBottom?: number | null): number {
  return Math.min(insetsBottom ?? 0, SPACING.md);
}

// ═══════════════════════════════════════════════════════════════════════════
// P2-003: AVATAR STYLING CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standardized avatar border widths for consistency across Chat Rooms.
 * P2-003: Consistent border treatment across all avatar surfaces.
 */
export const AVATAR_BORDERS = {
  /** Standard avatar ring (message list, panels) */
  standard: 2.5,
  /** Thicker ring for emphasis (profile, header) */
  emphasis: 3,
  /** Thin ring for compact displays */
  thin: 2,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// P3-005: GENDER-BASED AVATAR RING COLORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gender-based avatar ring colors for Chat Rooms.
 * P3-005: Centralized to avoid duplicate definitions.
 */
export const GENDER_COLORS = {
  male: '#3B82F6',     // Clear blue (saturated for visibility)
  female: '#E879F9',   // Light fuchsia/magenta (contrasts with pink/red avatars)
  other: '#9CA3AF',    // Neutral gray
  default: '#9CA3AF',  // Default neutral
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// P2-004: SHADOW UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cross-platform shadow styles for premium depth.
 * P2-004: Consistent shadow/elevation across iOS and Android.
 */
export const SHADOWS = {
  /** Subtle shadow for message bubbles */
  bubble: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 3,
    },
    android: {
      elevation: 2,
    },
  }),
  /** Medium shadow for cards */
  card: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
    },
    android: {
      elevation: 4,
    },
  }),
  /** Prominent shadow for modals/overlays */
  modal: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
    },
    android: {
      elevation: 8,
    },
  }),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// P2-007: CHAT-SPECIFIC COLOR CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Centralized color constants for Chat Rooms to reduce raw color duplication.
 * P2-007: These extend INCOGNITO_COLORS for Chat-specific uses.
 */
export const CHAT_COLORS = {
  /** Primary purple accent */
  primary: '#6D28D9',
  /** Light purple for highlights */
  primaryLight: '#A78BFA',
  /** Very light purple for subtle backgrounds */
  primarySubtle: 'rgba(109, 40, 217, 0.15)',
  /** Success/online green */
  online: '#22C55E',
  /** Error/warning red */
  error: '#EF4444',
  /** Warning orange */
  warning: '#FF9800',
  /** Chevron/muted icon color */
  chevron: 'rgba(255,255,255,0.35)',
  /** Chevron hover/active */
  chevronActive: 'rgba(255,255,255,0.5)',
  /** Message bubble - sender */
  bubbleSender: '#6D28D9',
  /** Message bubble - receiver */
  bubbleReceiver: '#1A2238',
  /** Quote block background */
  quoteBackground: '#212840',
  /** Quote accent bar */
  quoteAccent: 'rgba(167, 139, 250, 0.6)',
} as const;
