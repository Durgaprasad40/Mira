/**
 * Shared Animation Utilities for Onboarding
 *
 * Lightweight, production-safe animation constants and helpers.
 * Uses react-native-reanimated for performance.
 *
 * UI-ONLY: No logic, just animation utilities.
 */
import { Easing } from 'react-native-reanimated';

// ═══════════════════════════════════════════════════════════════════════════
// TIMING CONSTANTS - Consistent animation durations
// ═══════════════════════════════════════════════════════════════════════════

export const ANIMATION_DURATION = {
  // Ultra-fast for micro-interactions
  instant: 80,
  // Fast for press feedback
  fast: 120,
  // Standard for transitions
  standard: 180,
  // Smooth for progress/fill animations
  smooth: 250,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// EASING PRESETS - Smooth, natural motion curves
// ═══════════════════════════════════════════════════════════════════════════

export const ANIMATION_EASING = {
  // For press/release (snappy)
  pressIn: Easing.out(Easing.quad),
  pressOut: Easing.out(Easing.quad),
  // For fade/slide entries
  entry: Easing.out(Easing.cubic),
  // For progress bars
  smooth: Easing.inOut(Easing.quad),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// SCALE VALUES - Consistent scale transforms
// ═══════════════════════════════════════════════════════════════════════════

export const ANIMATION_SCALE = {
  // Button press scale
  buttonPressed: 0.97,
  buttonReleased: 1,
  // Input focus scale (very subtle)
  inputFocused: 1.005,
  inputBlurred: 1,
  // OTP digit pop
  otpPop: 1.05,
  // Photo appear
  photoAppear: 0.95,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN ENTRY VALUES
// ═══════════════════════════════════════════════════════════════════════════

export const SCREEN_ENTRY = {
  initialOpacity: 0,
  finalOpacity: 1,
  initialTranslateY: 12,
  finalTranslateY: 0,
  duration: 180,
  // Stagger delay between elements (very subtle)
  staggerDelay: 30,
} as const;
