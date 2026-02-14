/**
 * Auto-generated demo avatar mapping.
 * DO NOT EDIT MANUALLY — run: node scripts/generateDemoAvatars.mjs
 *
 * These are pre-generated circular PNG avatars for use as native Marker images.
 * Using native images avoids Android snapshot bugs (1/4 quadrant / white circles).
 */

// Avatar images keyed by profile ID
export const DEMO_AVATAR_IMG: Record<string, any> = {
  "demo_profile_12": require("../../assets/demo/avatars/demo_profile_12.png"),
  "demo_profile_18": require("../../assets/demo/avatars/demo_profile_18.png"),
  "demo_profile_9": require("../../assets/demo/avatars/demo_profile_9.png"),
};

// Fallback avatar for unknown IDs
export const DEMO_AVATAR_FALLBACK = require("../../assets/demo/avatars/_default.png");

/**
 * Get the avatar image source for a demo profile.
 * Returns a require() reference suitable for Marker image prop.
 */
export function getDemoAvatarImage(id: string): any {
  return DEMO_AVATAR_IMG[id] ?? DEMO_AVATAR_FALLBACK;
}
