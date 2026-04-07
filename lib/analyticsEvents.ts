/**
 * Phase-2 Analytics Events Catalog
 *
 * P3-004: Typed analytics events for consistent tracking across Phase-2.
 * Use these helpers instead of inline event objects.
 */

import { trackEvent } from '@/lib/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════════════

export type Phase2EventName =
  | 'phase2_match_started'
  | 'phase2_message_sent'
  | 'phase2_profile_viewed'
  | 'phase2_swipe_action'
  | 'phase2_standout_sent'
  | 'phase2_tod_answered'
  | 'phase2_secure_photo_sent'
  | 'phase2_secure_photo_viewed'
  | 'phase2_screen_opened'
  | 'phase2_error';

// ═══════════════════════════════════════════════════════════════════════════
// Event Tracking Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Track when a Phase-2 chat is opened */
export function trackPhase2MatchStarted(
  conversationId: string,
  privateIntentKey?: string
): void {
  trackEvent({
    name: 'phase2_match_started',
    conversationId,
    privateIntentKey,
  });
}

/** Track when a message is sent in Phase-2 */
export function trackPhase2MessageSent(
  conversationId: string,
  messageType: 'text' | 'voice' | 'image' | 'video'
): void {
  trackEvent({
    name: 'phase2_message_sent',
    conversationId,
    messageType,
  });
}

/** Track when a profile is viewed in Phase-2 */
export function trackPhase2ProfileViewed(
  profileUserId: string,
  source: 'discover' | 'likes' | 'chat'
): void {
  trackEvent({
    name: 'phase2_profile_viewed',
    profileUserId,
    source,
  });
}

/** Track swipe actions in Desire Land */
export function trackPhase2SwipeAction(
  action: 'like' | 'pass' | 'standout',
  targetUserId: string,
  isMatch: boolean
): void {
  trackEvent({
    name: 'phase2_swipe_action',
    action,
    targetUserId,
    isMatch,
  });
}

/** Track Stand Out (super like) sent */
export function trackPhase2StandoutSent(
  targetUserId: string,
  message?: string
): void {
  trackEvent({
    name: 'phase2_standout_sent',
    targetUserId,
    hasMessage: !!message,
  });
}

/** Track ToD answer submitted */
export function trackPhase2TodAnswered(
  promptId: string,
  answerType: 'text' | 'photo' | 'video' | 'voice'
): void {
  trackEvent({
    name: 'phase2_tod_answered',
    promptId,
    answerType,
  });
}

/** Track secure photo sent */
export function trackPhase2SecurePhotoSent(
  conversationId: string,
  timer: number,
  viewingMode: 'tap' | 'hold'
): void {
  trackEvent({
    name: 'phase2_secure_photo_sent',
    conversationId,
    timer,
    viewingMode,
  });
}

/** Track secure photo viewed by recipient */
export function trackPhase2SecurePhotoViewed(
  conversationId: string,
  messageId: string
): void {
  trackEvent({
    name: 'phase2_secure_photo_viewed',
    conversationId,
    messageId,
  });
}

/** Track screen opened */
export function trackPhase2ScreenOpened(
  screenName: string,
  params?: Record<string, string | number | boolean>
): void {
  trackEvent({
    name: 'phase2_screen_opened',
    screenName,
    ...params,
  });
}

/** Track errors in Phase-2 */
export function trackPhase2Error(
  context: string,
  errorMessage: string,
  errorCode?: string
): void {
  trackEvent({
    name: 'phase2_error',
    context,
    errorMessage,
    errorCode,
  });
}
