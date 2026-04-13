/**
 * Motion Utilities - Spring presets and premium motion helpers
 *
 * Complements lib/animations.ts with spring configurations
 * and additional motion utilities for premium UI feel.
 *
 * UI-ONLY: No logic, just motion constants.
 */
import { WithSpringConfig, WithTimingConfig, Easing } from 'react-native-reanimated';

// ═══════════════════════════════════════════════════════════════════════════
// PRESS SCALE VALUES - Re-export for convenience
// ═══════════════════════════════════════════════════════════════════════════

export const PRESS_IN_SCALE = 0.97;
export const PRESS_OUT_SCALE = 1;

// ═══════════════════════════════════════════════════════════════════════════
// TIMING DURATIONS - Milliseconds
// ═══════════════════════════════════════════════════════════════════════════

export const FAST_DURATION = 160;
export const NORMAL_DURATION = 220;
export const SLOW_DURATION = 320;

// ═══════════════════════════════════════════════════════════════════════════
// ENTRANCE VALUES - For fade/slide animations
// ═══════════════════════════════════════════════════════════════════════════

export const ENTRANCE_Y = 10;
export const ENTRANCE_X = 8;
export const ENTRANCE_OPACITY = 0;

// ═══════════════════════════════════════════════════════════════════════════
// SPRING PRESETS - Premium, non-bouncy springs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gentle spring - subtle, no bounce
 * Good for: cards, buttons, list items
 */
export const SPRING_GENTLE: WithSpringConfig = {
  damping: 20,
  stiffness: 200,
  mass: 1,
  overshootClamping: false,
};

/**
 * Snappy spring - quick response, minimal overshoot
 * Good for: press feedback, toggles, small elements
 */
export const SPRING_SNAPPY: WithSpringConfig = {
  damping: 25,
  stiffness: 400,
  mass: 0.8,
  overshootClamping: true,
};

/**
 * Smooth spring - elegant, slow settle
 * Good for: modals, sheets, large containers
 */
export const SPRING_SMOOTH: WithSpringConfig = {
  damping: 18,
  stiffness: 150,
  mass: 1.2,
  overshootClamping: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// TIMING CONFIGS - For non-spring animations
// ═══════════════════════════════════════════════════════════════════════════

export const TIMING_FAST: WithTimingConfig = {
  duration: FAST_DURATION,
  easing: Easing.out(Easing.quad),
};

export const TIMING_NORMAL: WithTimingConfig = {
  duration: NORMAL_DURATION,
  easing: Easing.out(Easing.cubic),
};

export const TIMING_SMOOTH: WithTimingConfig = {
  duration: SLOW_DURATION,
  easing: Easing.inOut(Easing.quad),
};

// ═══════════════════════════════════════════════════════════════════════════
// MOTI TRANSITION PRESETS - For use with Moti components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default Moti transition - subtle and fast
 */
export const MOTI_TRANSITION_DEFAULT = {
  type: 'timing' as const,
  duration: NORMAL_DURATION,
};

/**
 * Spring Moti transition - for premium feel
 */
export const MOTI_TRANSITION_SPRING = {
  type: 'spring' as const,
  damping: 20,
  stiffness: 200,
};

// ═══════════════════════════════════════════════════════════════════════════
// STAGGER DELAYS - For list/grid animations
// ═══════════════════════════════════════════════════════════════════════════

export const STAGGER_FAST = 30;
export const STAGGER_NORMAL = 50;
export const STAGGER_SLOW = 80;
