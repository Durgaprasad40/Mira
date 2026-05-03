/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Deep Connect (Phase-2) action-row tokens
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SCOPE
 *  - Used ONLY by the Phase-2 Deep Connect path inside `DiscoverCardStack.tsx`
 *    when `mode === "phase2"`.
 *  - The Phase-1 Discover screen MUST continue to use its existing tokens
 *    (`DISCOVER_ACTION_BUTTON_SIZE`, `DISCOVER_ACTION_ICON_SIZE`, etc.).
 *  - Do not import this file from Phase-1 code paths.
 *
 * GOALS
 *  - Make Pass / Super Like / Like buttons render at the same physical size on
 *    every common phone width (Samsung 360dp ↔ OnePlus 411dp ↔ iPhone 390dp).
 *  - Replace ad-hoc `SPACING.xxl - SPACING.xs` arithmetic with one stable gap.
 *  - Replace three independent `insets.bottom` formulas with a single helper.
 *  - Standardise icon-to-button ratio, shadow opacity, and press feedback.
 *
 * APPROACH
 *  - Use `cappedScale` (clamped 0.85 – 1.15) instead of unclamped
 *    `moderateScale`, so a 411dp device cannot drift the action row 8% larger
 *    than a 360dp device.
 *  - Derive icon sizes from button diameter (fixed ratios) instead of scaling
 *    them on a separate factor, so the icon-to-button proportion stays
 *    constant cross-device.
 *  - Expose a single `useDeepConnectBottomLayout(insets)` hook that returns
 *    every bottom-anchored value the action row / card / hint need.
 *
 * NON-GOALS
 *  - No swipe / match / Convex changes.
 *  - No shared component extraction. The Phase-2 path keeps the same JSX.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { EdgeInsets } from 'react-native-safe-area-context';

import { SPACING, cappedScale } from '@/lib/responsive';

// ─── Button geometry ────────────────────────────────────────────────────────
// Pass and Like share the larger diameter; Stand Out is the compact diameter.
// Both clamped via cappedScale so they don't grow uncontrollably on wider
// devices (OnePlus 411dp would otherwise scale 9.6% larger than Samsung 360dp).
export const DC_BUTTON_DIAMETER = cappedScale(62);
export const DC_BUTTON_DIAMETER_COMPACT = cappedScale(54);

// Icon sizes derived from button diameter so the icon-to-button ratio is
// constant across devices. Pass/Like icon ≈ 45% of button. Stand Out star
// ≈ 41% of compact button.
export const DC_ICON_SIZE = Math.round(DC_BUTTON_DIAMETER * 0.45);
export const DC_STAR_ICON_SIZE = Math.round(DC_BUTTON_DIAMETER_COMPACT * 0.41);

// ─── Row spacing ────────────────────────────────────────────────────────────
// One stable gap value — replaces `SPACING.xxl - SPACING.xs` (which mixed two
// different moderateScale factors).
export const DC_BUTTON_GAP = cappedScale(28);
export const DC_ROW_PADDING_X = SPACING.xl;
export const DC_ROW_PADDING_BOTTOM = SPACING.xs;

// ─── Stand Out badge ────────────────────────────────────────────────────────
// Phase-2 hides the numeric "remaining count" badge — only the star icon is
// shown. The remaining-count value (`standOutsLeft`) is still computed and
// passed through to the Stand Out screen via `router.push(...standOutsLeft)`,
// so the underlying limit logic is unchanged.

// ─── Bottom layout (safe-area unification) ──────────────────────────────────
// Single source of truth for every bottom-anchored value Phase-2 needs.
// Keeps `actionRowBottom`, `cardBottom`, and `phaseTransitionHintBottom` in
// lockstep so the deck never overlaps the action row and the hint never
// collides with the bottom of the action row.
export const DC_ROW_BOTTOM_MIN = SPACING.md + SPACING.sm;
export const DC_ROW_BOTTOM_MAX = SPACING.xxl + SPACING.sm;
export const DC_ROW_GAP_ABOVE_INSET = SPACING.sm;
export const DC_CARD_TO_ROW_GAP = SPACING.md + SPACING.xs;
export const DC_TRANSITION_HINT_OFFSET = SPACING.lg;

// ─── Press feedback / shadows ───────────────────────────────────────────────
// Single press-scale for all three buttons (was 0.92 / 0.90 / 0.90 — visually
// reads as Pass being "softer" than the other two).
export const DC_PRESS_SCALE = 0.9;

// Subtle neutral lift shared by all three Phase-2 action buttons.
// Intentionally small radius + low opacity + black tint so the shadow reads
// as a clean premium drop, not a coloured halo / ring around the button.
// All three Phase-2 buttons override `shadowColor` to "#000" so the lift
// stays neutral regardless of the button surface colour.
export const DC_BUTTON_SHADOW = {
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.18,
  shadowRadius: 6,
  elevation: 3,
} as const;

// ─── Premium glass / depth ──────────────────────────────────────────────────
// Inner stroke gives each button a "lit edge" so it reads as a 3-D orb rather
// than a flat circle. Light tint on the coloured buttons; a faint accent tint
// on the white Pass button.
export const DC_GLASS_BORDER_WIDTH = 1.5;
export const DC_GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.24)';
export const DC_GLASS_BORDER_PASS = 'rgba(244,67,54,0.18)';

// Three-stop inner highlight gradient applied as a top-to-bottom LinearGradient
// inside each button. The trick is to combine a bright top sheen with a
// noticeable bottom darkening — the brain reads that combination as a 3-D
// sphere instead of a flat disc. A two-stop "fade-to-transparent" gradient
// (the previous version) reads as flat.
//
// Tuples are `as const` so TypeScript infers them as the readonly tuple type
// expected by `LinearGradient.colors`.
export const DC_GLASS_HIGHLIGHT_COLORS_LIGHT = [
  'rgba(255,255,255,0.42)',
  'rgba(255,255,255,0.10)',
  'rgba(0,0,0,0.10)',
] as const;
export const DC_GLASS_HIGHLIGHT_COLORS_PASS = [
  'rgba(255,255,255,0.06)',
  'rgba(0,0,0,0.05)',
  'rgba(0,0,0,0.14)',
] as const;
export const DC_GLASS_HIGHLIGHT_LOCATIONS = [0, 0.55, 1] as const;
export const DC_GLASS_HIGHLIGHT_START = { x: 0.5, y: 0 } as const;
export const DC_GLASS_HIGHLIGHT_END = { x: 0.5, y: 1 } as const;

// ─── Bottom-layout helper ───────────────────────────────────────────────────
// Single helper used for the action row bottom, the card bottom, and the
// phase-transition hint bottom. Returning a plain object (not a hook) keeps
// it usable from inside the existing render function without changing
// React-hook ordering.
export type DeepConnectBottomLayout = {
  /** Action-row `bottom` value (absolute positioned). */
  actionRowBottom: number;
  /** How much vertical space the action row occupies above its `bottom`. */
  actionRowClearance: number;
  /** Card-area bottom inset so cards don't sit underneath the action row. */
  cardBottom: number;
  /** Bottom anchor for the phase-transition hint. */
  transitionHintBottom: number;
};

export function getDeepConnectBottomLayout(
  insets: Pick<EdgeInsets, 'bottom'>,
): DeepConnectBottomLayout {
  // Clamp insets.bottom into [DC_ROW_BOTTOM_MIN, DC_ROW_BOTTOM_MAX] so very
  // tall gesture areas (some Androids report >SPACING.xxl) don't push the
  // action row into the middle of the screen, and devices with no inset
  // still get a comfortable margin.
  const clampedInset = Math.min(
    Math.max(insets.bottom, DC_ROW_BOTTOM_MIN),
    DC_ROW_BOTTOM_MAX,
  );
  const actionRowBottom = clampedInset + DC_ROW_GAP_ABOVE_INSET;
  const actionRowClearance = DC_BUTTON_DIAMETER + DC_CARD_TO_ROW_GAP;
  const cardBottom = actionRowBottom + actionRowClearance;
  const transitionHintBottom = actionRowBottom + DC_TRANSITION_HINT_OFFSET;

  return {
    actionRowBottom,
    actionRowClearance,
    cardBottom,
    transitionHintBottom,
  };
}
