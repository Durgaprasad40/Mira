/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase-1 Discover floating action-row tokens (premium light theme)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SCOPE
 *  - Used ONLY by Phase-1 (public Discover) surfaces:
 *      • `components/screens/DiscoverCardStack.tsx` (homepage swipe deck)
 *      • `app/(main)/profile/[id].tsx`              (opened profile)
 *  - Phase-2 Deep Connect MUST continue to use
 *    `_internal/deepConnectActionRow.tokens.ts`. Do NOT import this file from
 *    any Phase-2 path.
 *  - This file deliberately mirrors the *structure* of the Deep Connect token
 *    system (cappedScale-clamped diameters, derived icon ratios, neutral
 *    shadow, optional inner-highlight gradient, transparent floating cluster)
 *    but uses its own light / warm-ivory visual identity. It does not reuse
 *    any Phase-2 colours.
 *
 * GOALS
 *  - Three floating circular buttons (Skip / Super Like / Like) that read as
 *    independent premium orbs — NOT a full-width slab or pill bar.
 *  - One coherent style applied in BOTH the Discover homepage row and the
 *    opened-profile sticky action area.
 *  - Stable physical sizing on Samsung 360dp ↔ OnePlus 411dp ↔ iPhone 390dp
 *    (cappedScale instead of unclamped moderateScale).
 *
 * NON-GOALS
 *  - No swipe / match / Convex changes.
 *  - No card identity row, online wording, opened-profile content, photo
 *    swipe, or navigation changes.
 *  - No shared component extraction. JSX stays in the existing files.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SPACING, cappedScale } from '@/lib/responsive';

// ─── Button geometry ────────────────────────────────────────────────────────
// Skip and Like share the larger diameter; Super Like / Stand Out is the
// compact diameter. cappedScale (clamped 0.85 – 1.15) prevents the row from
// drifting ~9.6% wider on 411dp devices vs 360dp devices.
//
// Bumped to match Phase-2 Deep Connect (62 / 54). The previous 60 / 52 felt
// slightly under-scaled next to Phase-2 buttons of the same role; same
// physical size makes the two phases read as the same product family.
export const P1_BUTTON_DIAMETER = cappedScale(62);
export const P1_BUTTON_DIAMETER_COMPACT = cappedScale(54);

// Icon sizes derived from button diameter so the icon-to-button proportion
// stays constant across devices.
export const P1_ICON_SIZE = Math.round(P1_BUTTON_DIAMETER * 0.45);
export const P1_STAR_ICON_SIZE = Math.round(P1_BUTTON_DIAMETER_COMPACT * 0.42);

// ─── Row spacing ────────────────────────────────────────────────────────────
// Single stable cappedScale gap. The row container itself stays transparent
// (no background, no top-border, no slab) — each button floats as its own
// circle. Bumped 26 → 28 to match Phase-2 Deep Connect — the slightly wider
// gap pairs better with the bumped button diameter and avoids a "crowded"
// feel between the three orbs.
export const P1_BUTTON_GAP = cappedScale(28);
export const P1_ROW_PADDING_X = SPACING.xl;
export const P1_ROW_PADDING_BOTTOM = SPACING.xs;

// ─── Press feedback ─────────────────────────────────────────────────────────
// Slightly softer than Phase-2 (0.9) — Phase-1 surfaces are lighter, a smaller
// press travel feels more refined.
export const P1_PRESS_SCALE = 0.92;

// ─── Floating shadow ────────────────────────────────────────────────────────
// Warm-tinted black (`#1B0E04`) instead of pure `#000` so the lift harmonises
// with the Phase-1 ivory palette. Low opacity + medium-large radius gives a
// clean "floating orb" feel without heavy 3-D drop.
//
// Spread as `...P1_BUTTON_SHADOW` inside each button style; do NOT override
// `shadowColor` per-button (the previous "three coloured halos" look read as
// cheap on a light page).
//
// Polish (Batch 6):
//   - shadowOffset.height 5 → 4   (anchors the orb closer to the surface;
//                                  was reading as slightly "lifted-too-far")
//   - shadowOpacity      0.16 → 0.18 (matches Phase-2's lift strength so the
//                                  Phase-1 buttons no longer feel underweight
//                                  next to Phase-2 buttons of the same role)
//   - shadowRadius       12 → 14  (slightly more diffuse — light/ivory pages
//                                  benefit from a softer drop, vs Phase-2's
//                                  tighter 6 against a dark page)
//   - elevation          5  → 6   (Android equivalent of the iOS uplift)
export const P1_BUTTON_SHADOW = {
  shadowColor: '#1B0E04',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.18,
  shadowRadius: 14,
  elevation: 6,
} as const;

// ─── Surfaces (light premium) ───────────────────────────────────────────────
// Skip:      pure white — calm "exit" affordance.
// Stand Out: very faint cool-ivory tint — keeps the blue accent dominant
//            without flattening into a solid chip.
// Like:      very faint warm-ivory tint — pairs with the rose accent.
export const P1_SURFACE = '#FFFFFF';
export const P1_SURFACE_TINT_STANDOUT = '#F4F8FF';
export const P1_SURFACE_TINT_LIKE = '#FFF5F6';

// ─── Borders (premium thin ring) ────────────────────────────────────────────
// 1pt soft accent ring per button. Gives a "framed glass orb" feel without
// the heavy coloured fills the previous design used.
export const P1_BORDER_WIDTH = 1;
export const P1_BORDER_SKIP = 'rgba(229, 57, 53, 0.22)';     // soft red
export const P1_BORDER_STANDOUT = 'rgba(33, 150, 243, 0.30)'; // soft blue
export const P1_BORDER_LIKE = 'rgba(233, 30, 99, 0.26)';      // soft pink/brand

// ─── Icon accent colours ────────────────────────────────────────────────────
// Slightly desaturated vs the previous bold reds/pinks so the icons sit
// comfortably on the light surfaces and feel premium instead of loud.
export const P1_ICON_SKIP = '#E53935';     // deep red (close icon)
export const P1_ICON_STANDOUT = '#1E88E5'; // medium blue (star)
export const P1_ICON_LIKE = '#E91E63';     // brand pink (heart)

// ─── Inner glass highlight ──────────────────────────────────────────────────
// Subtle top-sheen → mid-fade → soft-warm-shade gradient. Sells the
// "premium 3-D orb" silhouette on the light surface — mild, not heavy 3-D.
// Tuples are `as const` so TS infers them as the readonly tuple type
// expected by `LinearGradient.colors`.
export const P1_GLASS_HIGHLIGHT_COLORS = [
  'rgba(255,255,255,0.55)',
  'rgba(255,255,255,0.10)',
  'rgba(27,14,4,0.06)',
] as const;
export const P1_GLASS_HIGHLIGHT_LOCATIONS = [0, 0.55, 1] as const;
export const P1_GLASS_HIGHLIGHT_START = { x: 0.5, y: 0 } as const;
export const P1_GLASS_HIGHLIGHT_END = { x: 0.5, y: 1 } as const;

// ─── Disabled state ─────────────────────────────────────────────────────────
export const P1_DISABLED_OPACITY = 0.4;
export const P1_DISABLED_SHADOW_OPACITY = 0.08;

// ─── Floating-cluster bottom layout ─────────────────────────────────────────
// Returns the bottom anchor for the opened-profile floating cluster. Mirrors
// the helper-shape used by Phase-2 but lives in the Phase-1 token space and
// uses its own clamp range. The Discover homepage row already has its own
// dedicated bottom-layout math (`actionRowBottom`) and does NOT use this.
export const P1_OPEN_PROFILE_ROW_BOTTOM_MIN = SPACING.md + SPACING.sm;
export const P1_OPEN_PROFILE_ROW_BOTTOM_MAX = SPACING.xxl + SPACING.sm;
export const P1_OPEN_PROFILE_ROW_GAP_ABOVE_INSET = SPACING.sm;

export type Phase1OpenProfileLayout = {
  /** Cluster `bottom` value for the floating action row. */
  actionRowBottom: number;
  /** Vertical clearance (button height + breathing room) the scroll view
   *  needs to reserve so content doesn't sit underneath the cluster. */
  actionRowClearance: number;
};

export function getPhase1OpenProfileActionLayout(insets: {
  bottom: number;
}): Phase1OpenProfileLayout {
  // Clamp insets.bottom so very tall gesture areas don't push the cluster
  // into the middle of the screen, and devices with no inset still get a
  // comfortable margin.
  const clampedInset = Math.min(
    Math.max(insets.bottom, P1_OPEN_PROFILE_ROW_BOTTOM_MIN),
    P1_OPEN_PROFILE_ROW_BOTTOM_MAX,
  );
  const actionRowBottom = clampedInset + P1_OPEN_PROFILE_ROW_GAP_ABOVE_INSET;
  // Reserve enough height so scroll content doesn't disappear under the
  // floating row (button + soft breathing room above it).
  const actionRowClearance = P1_BUTTON_DIAMETER + SPACING.lg;

  return { actionRowBottom, actionRowClearance };
}
