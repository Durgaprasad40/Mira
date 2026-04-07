/**
 * Debug Flags - Centralized control for verbose logging
 *
 * All flags default to FALSE to minimize log noise in normal development.
 * Set to TRUE only when actively debugging a specific feature.
 *
 * IMPORTANT: These only work in __DEV__ mode (development builds).
 * Production builds will never emit these logs.
 */

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVER & CARD RENDERING
// ═══════════════════════════════════════════════════════════════════════════

/** Enable verbose photo render debugging (PhotoStack, image loading) */
export const DEBUG_PHOTO_RENDER = false;

/** Enable discover card content planner debugging (wave distribution, units) */
export const DEBUG_DISCOVER_PLANNER = false;

/** Enable discover queue state debugging (card stack, refetch) */
export const DEBUG_DISCOVER_QUEUE = false;

/** Enable card presence badge debugging (active now, active today) */
export const DEBUG_CARD_PRESENCE = false;

/** Enable bio/content render debugging */
export const DEBUG_CONTENT_RENDER = false;

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP & AUTH
// ═══════════════════════════════════════════════════════════════════════════

/** Enable auth boot/validation debugging ([BOOT], [AUTH_BOOT], [AUTH_READY]) */
export const DEBUG_AUTH_BOOT = false;

/** Enable startup timing and reset epoch debugging ([STARTUP_TIMING], [RESET_EPOCH]) */
export const DEBUG_STARTUP = false;

/** Enable onboarding hydration debugging ([ONB_DRAFT], [BASIC_HYDRATE], [REF_PRIMARY]) */
export const DEBUG_ONBOARDING_HYDRATION = false;

// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE & LOCATION
// ═══════════════════════════════════════════════════════════════════════════

/** Enable presence heartbeat debugging */
export const DEBUG_PRESENCE = false;

/** Enable location sync debugging */
export const DEBUG_LOCATION = false;

/** Enable background location debugging ([BG], [BG_MANAGER]) */
export const DEBUG_BACKGROUND_LOCATION = false;

/** Enable notification state debugging ([useNotifications]) */
export const DEBUG_NOTIFICATIONS = false;

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2 (PRIVATE/INCOGNITO)
// ═══════════════════════════════════════════════════════════════════════════

/** Enable Phase-2 UI debugging (intent, distribution, slots) */
export const DEBUG_P2_UI = false;

/** Enable Phase-2 profile/action debugging */
export const DEBUG_P2_PROFILE = false;

/** Enable Phase-2 messaging debugging */
export const DEBUG_P2_MESSAGING = false;

/** Enable Phase-2 delivery/read receipt debugging */
export const DEBUG_P2_DELIVERY = false;

/** Enable Truth/Dare game debugging */
export const DEBUG_TRUTH_DARE = false;

// ═══════════════════════════════════════════════════════════════════════════
// SENTRY & ERROR TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enable FULL Sentry verbose debugging mode
 *
 * When TRUE:
 * - Sentry native SDK debug output enabled (Sentry Logger [log])
 * - Breadcrumb filtering bypassed (all debug breadcrumbs kept)
 * - Feature/screen change logs restored
 *
 * When FALSE (default):
 * - Clean Sentry mode, minimal log noise
 * - Breadcrumbs filtered to remove verbose debug tags
 * - Error capture still fully functional
 *
 * USAGE: Set to TRUE for deep Sentry diagnosis, FALSE for normal operation
 */
export const DEBUG_SENTRY_VERBOSE = false;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Conditional debug log - only logs if flag is true AND in dev mode
 * @param flag - Debug flag to check
 * @param tag - Log tag (e.g., '[PHOTO_RENDER]')
 * @param message - Short string message (not object)
 * @param data - Optional compact data (will be stringified if object)
 */
export function debugLog(
  flag: boolean,
  tag: string,
  message: string,
  data?: string | number | boolean | null
): void {
  if (__DEV__ && flag) {
    if (data !== undefined) {
      console.log(`${tag} ${message}`, data);
    } else {
      console.log(`${tag} ${message}`);
    }
  }
}

/**
 * Conditional debug log with object data - use sparingly
 * Only for cases where object inspection is truly needed
 * @param flag - Debug flag to check
 * @param tag - Log tag
 * @param data - Object to log (will be logged as-is)
 */
export function debugLogObject(
  flag: boolean,
  tag: string,
  data: Record<string, unknown>
): void {
  if (__DEV__ && flag) {
    console.log(tag, data);
  }
}

/**
 * Create a compact summary string from profile/card data
 * Use this instead of logging full objects
 */
export function compactCardSummary(card: {
  name?: string;
  id?: string;
  photoCount?: number;
}): string {
  const name = card.name || 'unknown';
  const id = card.id?.slice(-6) || '???';
  const photos = card.photoCount ?? '?';
  return `${name}(${id}) ${photos}p`;
}
