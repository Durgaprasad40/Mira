/**
 * Shared Onboarding Styles
 *
 * Centralized style constants for Phase-1 onboarding screens.
 * Ensures visual consistency across all onboarding steps.
 *
 * UI-ONLY: No logic, just styling constants.
 */
import { StyleSheet, Platform } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, FONT_WEIGHT } from './constants';

// ═══════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY - Consistent text styles across onboarding
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_TYPOGRAPHY = {
  // Screen titles - large, bold, welcoming
  title: {
    fontSize: 28,
    fontWeight: FONT_WEIGHT.bold as '700',
    color: COLORS.text,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  // Screen subtitles - softer, explanatory
  subtitle: {
    fontSize: 16,
    fontWeight: FONT_WEIGHT.normal as '400',
    color: COLORS.textLight,
    lineHeight: 24,
  },
  // Section headers within forms
  sectionTitle: {
    fontSize: 18,
    fontWeight: FONT_WEIGHT.semibold as '600',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  // Input labels
  label: {
    fontSize: 14,
    fontWeight: FONT_WEIGHT.medium as '500',
    color: COLORS.textLight,
    marginBottom: 8,
  },
  // Helper text below inputs
  helper: {
    fontSize: 13,
    fontWeight: FONT_WEIGHT.normal as '400',
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  // Error text
  error: {
    fontSize: 13,
    fontWeight: FONT_WEIGHT.medium as '500',
    color: COLORS.error,
    lineHeight: 18,
  },
  // Button text (primary)
  buttonPrimary: {
    fontSize: 17,
    fontWeight: FONT_WEIGHT.semibold as '600',
    color: COLORS.white,
    letterSpacing: 0.2,
  },
  // Button text (secondary/link)
  buttonSecondary: {
    fontSize: 15,
    fontWeight: FONT_WEIGHT.medium as '500',
    color: COLORS.textLight,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// SPACING - Consistent vertical rhythm
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_SPACING = {
  // Screen content padding
  screenPadding: 24,
  screenPaddingBottom: 40,

  // Title to subtitle gap
  titleGap: 10,
  // Subtitle to content gap
  subtitleGap: 28,

  // Between form sections
  sectionGap: 28,
  // Between items within a section
  itemGap: 16,
  // Small gap (label to input, etc.)
  smallGap: 8,

  // Footer margin from content
  footerMargin: 32,
  // Gap between footer buttons
  footerButtonGap: 14,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// INPUT STYLES - Consistent form input appearance
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_INPUT = {
  // Standard input container
  container: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  // Focused state additions
  focused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  // Error state additions
  error: {
    borderColor: COLORS.error,
  },
  // Disabled state additions
  disabled: {
    opacity: 0.5,
  },
  // Text inside input
  text: {
    fontSize: 16,
    fontWeight: FONT_WEIGHT.normal as '400',
    color: COLORS.text,
  },
  // Placeholder text
  placeholder: {
    color: COLORS.textMuted,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// BUTTON STYLES - Premium button appearance
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_BUTTON = {
  // Primary CTA button
  primary: {
    container: {
      backgroundColor: COLORS.primary,
      borderRadius: 14,
      paddingVertical: 18,
      paddingHorizontal: 32,
      minHeight: 56,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      // Subtle shadow for depth
      ...Platform.select({
        ios: {
          shadowColor: COLORS.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 8,
        },
        android: {
          elevation: 4,
        },
      }),
    },
    text: ONBOARDING_TYPOGRAPHY.buttonPrimary,
    disabled: {
      opacity: 0.5,
    },
  },
  // Secondary/outline button
  secondary: {
    container: {
      backgroundColor: 'transparent',
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 24,
      minHeight: 48,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    text: ONBOARDING_TYPOGRAPHY.buttonSecondary,
  },
  // Ghost/link button
  ghost: {
    container: {
      backgroundColor: 'transparent',
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    text: {
      fontSize: 14,
      fontWeight: FONT_WEIGHT.medium as '500',
      color: COLORS.textLight,
    },
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// CARD/OPTION STYLES - Selection cards and chips
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_CARD = {
  // Standard option card (like identity anchor options)
  option: {
    container: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      backgroundColor: COLORS.backgroundDark,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: 'transparent',
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    selected: {
      backgroundColor: COLORS.primary,
      borderColor: COLORS.primaryDark,
    },
    text: {
      fontSize: 15,
      fontWeight: FONT_WEIGHT.medium as '500',
      color: COLORS.text,
    },
    textSelected: {
      color: COLORS.white,
    },
  },
  // Chip style (like preferences)
  chip: {
    container: {
      backgroundColor: COLORS.backgroundDark,
      borderRadius: 22,
      borderWidth: 1.5,
      borderColor: 'transparent',
      paddingVertical: 12,
      paddingHorizontal: 18,
    },
    selected: {
      backgroundColor: COLORS.primary,
      borderColor: COLORS.primaryDark,
    },
    text: {
      fontSize: 14,
      fontWeight: FONT_WEIGHT.medium as '500',
      color: COLORS.text,
    },
    textSelected: {
      color: COLORS.white,
    },
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// OTP INPUT STYLES - Consistent OTP box appearance
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_OTP = {
  // Single OTP digit box
  box: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // Focused box
  boxFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  // Filled box (has value)
  boxFilled: {
    borderColor: COLORS.border,
  },
  // Error state
  boxError: {
    borderColor: COLORS.error,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  // Text inside box
  text: {
    fontSize: 24,
    fontWeight: FONT_WEIGHT.semibold as '600',
    color: COLORS.text,
    textAlign: 'center' as const,
  },
  // Gap between boxes
  gap: 10,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO UPLOAD STYLES - Photo slot appearance
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_PHOTO = {
  // Photo slot container
  slot: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
  },
  // Primary (first) slot - larger
  slotPrimary: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  // Filled slot (has photo)
  slotFilled: {
    borderWidth: 0,
    borderStyle: 'solid' as const,
  },
  // Add icon styling
  addIcon: {
    color: COLORS.textMuted,
    size: 28,
  },
  // Primary add icon
  addIconPrimary: {
    color: COLORS.primary,
    size: 32,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS HEADER STYLES
// ═══════════════════════════════════════════════════════════════════════════

export const ONBOARDING_PROGRESS = {
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
  fill: {
    height: '100%' as const,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// COMMON LAYOUT STYLES
// ═══════════════════════════════════════════════════════════════════════════

export const onboardingLayoutStyles = StyleSheet.create({
  // Safe area container
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // Scrollable content container
  scrollContainer: {
    flex: 1,
  },
  // Content wrapper with standard padding
  content: {
    padding: ONBOARDING_SPACING.screenPadding,
    paddingBottom: ONBOARDING_SPACING.screenPaddingBottom,
  },
  // Screen title
  title: {
    ...ONBOARDING_TYPOGRAPHY.title,
    marginBottom: ONBOARDING_SPACING.titleGap,
  },
  // Screen subtitle
  subtitle: {
    ...ONBOARDING_TYPOGRAPHY.subtitle,
    marginBottom: ONBOARDING_SPACING.subtitleGap,
  },
  // Form section wrapper
  section: {
    marginBottom: ONBOARDING_SPACING.sectionGap,
  },
  // Section title
  sectionTitle: {
    ...ONBOARDING_TYPOGRAPHY.sectionTitle,
    marginBottom: ONBOARDING_SPACING.itemGap,
  },
  // Input label
  label: {
    ...ONBOARDING_TYPOGRAPHY.label,
  },
  // Helper text
  helper: {
    ...ONBOARDING_TYPOGRAPHY.helper,
    marginTop: ONBOARDING_SPACING.smallGap,
  },
  // Error text
  error: {
    ...ONBOARDING_TYPOGRAPHY.error,
    marginTop: ONBOARDING_SPACING.smallGap,
  },
  // Footer container
  footer: {
    marginTop: ONBOARDING_SPACING.footerMargin,
  },
  // Navigation row (Previous/Skip buttons)
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: ONBOARDING_SPACING.footerButtonGap,
  },
});
