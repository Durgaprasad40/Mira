/**
 * Phase-2 Configuration Constants
 *
 * P3-002: Centralized magic numbers and timing constants for Phase-2.
 * Import these instead of hardcoding values throughout the codebase.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting & Quotas
// ═══════════════════════════════════════════════════════════════════════════

/** Daily like limit for Phase-2 Deep Connect */
export const PHASE2_DAILY_LIKE_LIMIT = 25;

/** Daily Stand Out (super like) limit */
export const PHASE2_DAILY_STANDOUT_LIMIT = 2;

/** Messages per minute rate limit */
export const PHASE2_MESSAGES_PER_MINUTE = 10;

/** Maximum message length (characters) */
export const PHASE2_MAX_MESSAGE_LENGTH = 5000;

// ═══════════════════════════════════════════════════════════════════════════
// Suppression Windows (milliseconds)
// ═══════════════════════════════════════════════════════════════════════════

/** Swipe action suppression window (prevent duplicate swipes) */
export const SWIPE_SUPPRESSION_MS = 500;

/** Double-tap suppression window */
export const DOUBLE_TAP_SUPPRESSION_MS = 300;

/** Navigation debounce window */
export const NAVIGATION_DEBOUNCE_MS = 200;

/** ToD result message auto-delete delay (1 hour) */
export const TOD_MESSAGE_DELETE_DELAY_MS = 3_600_000;

/** Secure photo auto-delete delay after expiry (1 minute) */
export const SECURE_PHOTO_DELETE_DELAY_MS = 60_000;

// ═══════════════════════════════════════════════════════════════════════════
// Pagination & Limits
// ═══════════════════════════════════════════════════════════════════════════

/** Default profile fetch limit for Discover */
export const DISCOVER_PROFILES_LIMIT = 20;

/** Default messages fetch limit per page */
export const MESSAGES_PAGE_SIZE = 50;

/** Maximum profiles to cache in prefetch */
export const PREFETCH_CACHE_LIMIT = 20;

// ═══════════════════════════════════════════════════════════════════════════
// Timing Constants (milliseconds)
// ═══════════════════════════════════════════════════════════════════════════

/** Live countdown update interval */
export const COUNTDOWN_UPDATE_INTERVAL_MS = 250;

/** Message tick status refresh interval */
export const TICK_REFRESH_INTERVAL_MS = 1000;

/** Prune interval for expired messages */
export const PRUNE_INTERVAL_MS = 30_000;

/** Match celebration display duration */
export const MATCH_CELEBRATION_DURATION_MS = 3000;

// ═══════════════════════════════════════════════════════════════════════════
// Protected Media Timers (seconds)
// ═══════════════════════════════════════════════════════════════════════════

/** Default secure photo timer options */
export const SECURE_PHOTO_TIMER_OPTIONS = [0, 3, 5, 10, 30] as const;

/** View once timer value (0 = single view) */
export const VIEW_ONCE_TIMER = 0;

// ═══════════════════════════════════════════════════════════════════════════
// UI Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Number of recent messages to track for status hash */
export const MESSAGE_STATUS_HASH_COUNT = 20;

/** Maximum photos per profile */
export const MAX_PROFILE_PHOTOS = 9;

/** Age range limits */
export const AGE_MIN = 18;
export const AGE_MAX = 99;
