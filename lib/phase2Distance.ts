/**
 * Phase-2 Deep Connect distance formatter (miles, symbol style).
 *
 * SCOPE
 *  - Used by every Phase-2 Deep Connect surface that needs to render
 *    distance: the swipe card (`components/cards/ProfileCard.tsx`) and the
 *    expanded Phase-2 profile (`app/(main)/(private)/p2-profile/[userId].tsx`).
 *  - Phase-1 surfaces continue to use `lib/distanceRules.ts` (km).
 *
 * RULES
 *  - Input is the backend-provided `distanceKm` (kilometres). If the backend
 *    omits or hides distance (privacy / `hideDistance`) the value will be
 *    null/undefined here and the formatter returns null → callers render
 *    nothing.
 *  - Output is miles only, in compact "mi" symbol form. No km, no
 *    city/locality fallback, no "Nearby" / "Nearby area" buckets.
 *  - Sub-mile distance shows "< 1 mi" to avoid the misleading "0 mi".
 *
 * EXAMPLES
 *  - 0.4 km   → "< 1 mi"
 *  - 1.6 km   → "1 mi"
 *  - 8 km     → "5 mi"
 *  - 24 km    → "15 mi"
 *  - 32 km    → "20 mi"
 *  - With { includeAway: true } the suffix " away" is appended:
 *    "< 1 mi away", "1 mi away", "15 mi away".
 */

const KM_TO_MILES = 0.621371;

export interface Phase2DistanceFormatOptions {
  /**
   * When true, append " away" — used by the expanded profile
   * ("5 mi away"). The swipe-card right-corner label leaves it off for
   * a tight "15 mi" pill.
   */
  includeAway?: boolean;
}

/**
 * Format a Phase-2 Deep Connect distance value for display.
 * Returns null when the input is missing/invalid so callers can short-circuit
 * the entire row (no empty bullet, no leftover label).
 */
export function formatPhase2DistanceMiles(
  distanceKm?: number | null,
  options: Phase2DistanceFormatOptions = {},
): string | null {
  if (
    typeof distanceKm !== 'number' ||
    !Number.isFinite(distanceKm) ||
    distanceKm < 0
  ) {
    return null;
  }

  const miles = distanceKm * KM_TO_MILES;
  const baseLabel = miles < 1 ? '< 1 mi' : `${Math.round(miles)} mi`;

  return options.includeAway ? `${baseLabel} away` : baseLabel;
}
