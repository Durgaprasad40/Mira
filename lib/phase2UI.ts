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

// ═══════════════════════════════════════════════════════════════════════════
// Photo Blur Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get effective photo display settings for Phase-2.
 *
 * BLUR CONSISTENCY FIX:
 * - If user chose blurred photo → blurred everywhere
 * - If user did NOT choose blurred photo → clear everywhere
 * - No screen-specific difference
 *
 * @param options.isPhotoBlurred - Backend flag indicating if owner blurred their photo
 * @param options.canViewClearPhoto - Backend flag indicating if viewer has permission to see clear
 * @param options.defaultBlurRadius - The blur radius to apply if photo should be blurred
 * @returns { shouldBlur, blurRadius } - Whether to blur and what radius to use
 */
export function getEffectivePhotoBlur(options: {
  isPhotoBlurred?: boolean;
  canViewClearPhoto?: boolean;
  defaultBlurRadius?: number;
}): { shouldBlur: boolean; blurRadius: number } {
  const {
    isPhotoBlurred = false,
    canViewClearPhoto = true,
    defaultBlurRadius = PHASE2_BLUR_AVATAR,
  } = options;

  // Photo should be blurred if:
  // 1. Owner chose to blur their photo (isPhotoBlurred = true)
  // 2. AND viewer doesn't have permission to see clear (canViewClearPhoto = false)
  const shouldBlur = isPhotoBlurred && !canViewClearPhoto;

  // Debug logging in dev
  if (__DEV__) {
    console.log('[PHOTO_BLUR_DEBUG]', {
      isPhotoBlurred,
      canViewClearPhoto,
      shouldBlur,
      blurRadius: shouldBlur ? defaultBlurRadius : 0,
      sourceOfTruth: 'backend-flags',
    });
  }

  return {
    shouldBlur,
    blurRadius: shouldBlur ? defaultBlurRadius : 0,
  };
}

/**
 * Get blur radius for avatar display in Phase-2.
 * Convenience wrapper around getEffectivePhotoBlur.
 */
export function getAvatarBlurRadius(options: {
  isPhotoBlurred?: boolean;
  canViewClearPhoto?: boolean;
  size?: 'small' | 'normal';
}): number {
  const defaultRadius = options.size === 'small'
    ? PHASE2_BLUR_AVATAR_SMALL
    : PHASE2_BLUR_AVATAR;

  return getEffectivePhotoBlur({
    isPhotoBlurred: options.isPhotoBlurred,
    canViewClearPhoto: options.canViewClearPhoto,
    defaultBlurRadius: defaultRadius,
  }).blurRadius;
}
