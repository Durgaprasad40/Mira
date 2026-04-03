/**
 * Sentry Feature Filter
 *
 * SENTRY-FILTER: Restricts Sentry logging to ONLY Chat Rooms feature.
 * All other app areas are silenced to reduce noise and focus debugging.
 *
 * USAGE:
 * - In Chat Rooms screens: call setCurrentFeature('chat_rooms') on mount
 * - In Chat Rooms screens: call setCurrentFeature(null) on unmount
 * - Sentry only captures events/breadcrumbs when currentFeature === 'chat_rooms'
 */

// ---------------------------------------------------------------------------
// Global Feature Tracking Ref
// ---------------------------------------------------------------------------

/**
 * Global ref to track the currently active feature.
 * When set to 'chat_rooms', Sentry events and breadcrumbs are allowed.
 * When null or any other value, Sentry events are dropped.
 */
export const currentFeatureRef: { current: string | null } = { current: null };

/**
 * Set the current feature for Sentry filtering.
 * Call this on screen mount/unmount.
 *
 * @param feature - 'chat_rooms' to enable logging, null to disable
 */
export function setCurrentFeature(feature: string | null): void {
  currentFeatureRef.current = feature;

  if (__DEV__) {
    console.log('[SENTRY-FILTER] Feature set:', { feature });
  }
}

/**
 * Get the current feature being tracked.
 * Used by Sentry filters to determine if events should be captured.
 */
export function getCurrentFeature(): string | null {
  return currentFeatureRef.current;
}

/**
 * Check if the current feature is 'chat_rooms'.
 * Used by beforeSend and breadcrumb filters.
 */
export function isChatRoomsFeatureActive(): boolean {
  return currentFeatureRef.current === 'chat_rooms';
}

// ---------------------------------------------------------------------------
// Feature Constants
// ---------------------------------------------------------------------------

export const SENTRY_FEATURES = {
  CHAT_ROOMS: 'chat_rooms',
} as const;

export type SentryFeature = typeof SENTRY_FEATURES[keyof typeof SENTRY_FEATURES];
