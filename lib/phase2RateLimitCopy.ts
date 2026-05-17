/**
 * Phase-2 Rate-Limit Copy
 *
 * P3-2: Shared, calm, premium copy for Phase-2 rate-limit alerts.
 *
 * Replaces ad-hoc "Slow down" messaging in Phase-2 Profile flows with a
 * consistent voice that explains *why* we're pacing the user (safety) and
 * sets the expectation that they can retry shortly. Structured retry
 * handling at the call site is preserved — this helper only produces the
 * display text.
 *
 * Notes:
 *   - Title is short and non-blaming.
 *   - Body is one sentence, friendly, and actionable.
 *   - We deliberately avoid exposing the underlying window or count so
 *     the copy doesn't become a probing oracle.
 */

export type Phase2RateLimitContext =
  | 'profile_save'
  | 'photo_blur'
  | 'sync_main_profile';

const CONTEXT_BODIES: Record<Phase2RateLimitContext, string> = {
  profile_save:
    "We're pacing your changes for your safety. Please try again in a moment.",
  photo_blur:
    "We're pacing photo blur changes for your safety. Please try again in a moment.",
  sync_main_profile:
    "We're pacing your sync for your safety. Please try again in a moment.",
};

const DEFAULT_TITLE = 'Just a moment';

/**
 * Returns `{ title, message }` for a Phase-2 rate-limit Alert.alert call.
 *
 * Usage:
 *   const { title, message } = getPhase2RateLimitCopy('profile_save');
 *   Alert.alert(title, message);
 */
export function getPhase2RateLimitCopy(
  context: Phase2RateLimitContext,
): { title: string; message: string } {
  return {
    title: DEFAULT_TITLE,
    message: CONTEXT_BODIES[context],
  };
}
