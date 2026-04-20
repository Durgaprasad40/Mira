/**
 * Minimal analytics event hooks.
 *
 * Currently console-only (no-op in production builds where __DEV__ is false).
 * Replace the body of `trackEvent` with your analytics provider
 * (e.g. Amplitude, Mixpanel, PostHog) when ready.
 */

type AnalyticsEvent =
  | { name: 'match_created'; matchId?: string; otherUserId: string }
  | { name: 'first_message_sent'; conversationId: string }
  | { name: 'block_user'; blockedUserId: string }
  | { name: 'report_user'; reportedUserId: string; reason: string }
  // Chat menu actions
  | { name: 'chat_action'; action: 'unmatch' | 'uncrush' | 'block' | 'report' | 'spam' | 'scam' | 'inappropriate' | 'other'; userId: string; conversationId?: string; timestamp: number; reason?: string }
  // Phase-2 (Deep Connect) analytics
  | { name: 'phase2_intent_filter_selected'; intentKey: string }
  | { name: 'phase2_profile_viewed'; profileId?: string; profileUserId?: string; privateIntentKey?: string; source?: string }
  | { name: 'phase2_match_started'; conversationId: string; privateIntentKey?: string }
  | { name: 'phase2_message_sent'; conversationId: string; messageType: string }
  | { name: 'phase2_swipe_action'; action: string; targetUserId: string; isMatch: boolean }
  | { name: 'phase2_standout_sent'; targetUserId: string; hasMessage: boolean }
  | { name: 'phase2_tod_answered'; promptId: string; answerType: string }
  | { name: 'phase2_secure_photo_sent'; conversationId: string; timer: number; viewingMode: string }
  | { name: 'phase2_secure_photo_viewed'; conversationId: string; messageId: string }
  | { name: 'phase2_screen_opened'; screenName: string; [key: string]: string | number | boolean | undefined }
  | { name: 'phase2_error'; context: string; errorMessage: string; errorCode?: string }
  // Phase-3 Nearby discovery surface
  | { name: 'nearby_map_open'; userCount?: number; isDemo?: boolean }
  | { name: 'nearby_pin_tap'; targetUserId: string; freshnessLabel?: string; distanceBucket?: string }
  | { name: 'nearby_preview_open'; targetUserId: string; freshnessLabel?: string }
  | { name: 'nearby_profile_open'; targetUserId: string; via: 'preview' | 'direct' }
  | { name: 'nearby_to_like'; targetUserId: string }
  | { name: 'nearby_to_message'; targetUserId: string };

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
