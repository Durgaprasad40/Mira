/**
 * Minimal analytics event hooks.
 *
 * Currently console-only (no-op in production builds where __DEV__ is false).
 * Replace the body of `trackEvent` with your analytics provider
 * (e.g. Amplitude, Mixpanel, PostHog) when ready.
 */

type AnalyticsEvent =
  | { name: 'match_created'; matchId?: string; otherUserId: string; source?: string }
  | { name: 'first_message_sent'; conversationId: string }
  | { name: 'block_user'; blockedUserId: string }
  | { name: 'report_user'; reportedUserId: string; reason: string }
  // Phase-2 (Desire Land) analytics
  | { name: 'phase2_intent_filter_selected'; intentKey: string }
  | { name: 'phase2_profile_viewed'; profileId: string; privateIntentKey?: string }
  | { name: 'phase2_match_started'; conversationId: string; privateIntentKey?: string }
  // F2: Random match popup events
  | { name: 'random_match_popup_shown'; profileId: string }
  | { name: 'random_match_popup_accepted'; profileId: string }
  | { name: 'random_match_popup_dismissed'; profileId: string };

/**
 * Track a named event with structured payload.
 * Safe to call anywhere — no-ops gracefully if analytics provider is absent.
 */
export function trackEvent(event: AnalyticsEvent): void {
  if (__DEV__) {
    console.log(`[analytics] ${event.name}`, event);
  }
  // TODO: wire to production analytics provider
}
