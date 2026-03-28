/**
 * Phase-2 UI Constants
 *
 * P2-002: Centralized blur radius values for consistency across Phase-2 UI.
 * All Phase-2 components should import from here instead of hardcoding.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Blur Radius Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Standard blur for profile photos in chat avatars, message bubbles */
export const PHASE2_BLUR_AVATAR = 10;

/** Lighter blur for small avatars in lists */
export const PHASE2_BLUR_AVATAR_SMALL = 8;

/** Standard blur for profile cards in likes page, discover */
export const PHASE2_BLUR_CARD = 20;

/** Heavy blur for profile photos in full profile view */
export const PHASE2_BLUR_PROFILE = 35;

/** Heavy blur for like cards (slightly more than standard) */
export const PHASE2_BLUR_LIKE_CARD = 25;

// ═══════════════════════════════════════════════════════════════════════════
// Default Export for Convenience
// ═══════════════════════════════════════════════════════════════════════════

/** Default blur radius for most Phase-2 contexts */
export const PHASE2_BLUR_RADIUS = PHASE2_BLUR_CARD;
