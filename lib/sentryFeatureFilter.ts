/**
 * Sentry Feature Filter & Context
 *
 * APP-WIDE SENTRY: Full app coverage with feature tagging for filtering.
 * All features are now tracked, not just Chat Rooms.
 *
 * USAGE:
 * - Call setCurrentFeature('feature_name') when entering a feature
 * - Call setCurrentFeature(null) when leaving
 * - All errors/breadcrumbs are tagged with the current feature
 * - Filter by feature in Sentry dashboard: feature:deepconnect
 */

// ---------------------------------------------------------------------------
// Feature Constants - ALL app features for tagging
// ---------------------------------------------------------------------------

export const SENTRY_FEATURES = {
  // Onboarding
  ONBOARDING: 'onboarding',
  AUTH: 'auth',

  // Phase-1 (Public Mira)
  DISCOVER: 'discover',
  EXPLORE: 'explore',
  MESSAGES: 'messages',
  PROFILE: 'profile',

  // Phase-2 (Deep Connect)
  DEEP_CONNECT: 'deepconnect',
  PHASE2_DISCOVER: 'phase2_discover',
  PHASE2_PROFILE: 'phase2_profile',
  PHASE2_MESSAGES: 'phase2_messages',
  PHASE2_LIKES: 'phase2_likes',

  // Chat Rooms
  CHAT_ROOMS: 'chat_rooms',
  CHAT_ROOM_DETAIL: 'chat_room_detail',

  // Truth or Dare
  TRUTH_OR_DARE: 'truth_or_dare',

  // Settings & Support
  SETTINGS: 'settings',
  SUPPORT: 'support',
  SAFETY: 'safety',

  // Other
  NOTIFICATIONS: 'notifications',
  MATCH: 'match',
} as const;

export type SentryFeature = typeof SENTRY_FEATURES[keyof typeof SENTRY_FEATURES] | string;

// ---------------------------------------------------------------------------
// Global Feature Tracking
// ---------------------------------------------------------------------------

/**
 * Global ref to track the currently active feature.
 * Used for auto-tagging errors and breadcrumbs.
 */
export const currentFeatureRef: { current: SentryFeature | null } = { current: null };

/**
 * Screen name tracking for navigation context.
 */
export const currentScreenRef: { current: string | null } = { current: null };

/**
 * Set the current feature for Sentry tagging.
 * Call this on screen mount.
 *
 * @param feature - Feature identifier (use SENTRY_FEATURES constants)
 */
export function setCurrentFeature(feature: SentryFeature | null): void {
  const previous = currentFeatureRef.current;
  currentFeatureRef.current = feature;

  if (__DEV__ && feature !== previous) {
    console.log('[SENTRY] Feature changed:', { from: previous, to: feature });
  }
}

/**
 * Get the current feature being tracked.
 */
export function getCurrentFeature(): SentryFeature | null {
  return currentFeatureRef.current;
}

/**
 * Set the current screen name for navigation context.
 *
 * @param screenName - Screen identifier
 */
export function setCurrentScreen(screenName: string | null): void {
  currentScreenRef.current = screenName;

  if (__DEV__ && screenName) {
    console.log('[SENTRY] Screen:', screenName);
  }
}

/**
 * Get the current screen name.
 */
export function getCurrentScreen(): string | null {
  return currentScreenRef.current;
}

// ---------------------------------------------------------------------------
// Legacy compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use feature tagging instead. Returns true for app-wide coverage.
 */
export function isChatRoomsFeatureActive(): boolean {
  // APP-WIDE: Always return true for backwards compatibility
  // The old filter is removed - all features are now tracked
  return true;
}

// ---------------------------------------------------------------------------
// Feature Grouping (for Sentry dashboard filtering)
// ---------------------------------------------------------------------------

/**
 * Get the feature group for a feature (useful for broad filtering).
 */
export function getFeatureGroup(feature: SentryFeature | null): string {
  if (!feature) return 'unknown';

  if (feature.startsWith('phase2') || feature === 'deepconnect') return 'phase2';
  if (feature.startsWith('chat_room')) return 'chatrooms';
  if (feature === 'onboarding' || feature === 'auth') return 'auth';
  if (['discover', 'explore', 'messages', 'profile'].includes(feature)) return 'phase1';
  if (feature === 'truth_or_dare') return 'games';
  if (['settings', 'support', 'safety'].includes(feature)) return 'settings';

  return 'other';
}
