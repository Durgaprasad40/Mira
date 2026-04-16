/**
 * Bell visibility by phase — must stay aligned with `shouldIncludeBellNotification`
 * in `hooks/useNotifications.ts` (list/badge parity).
 */

export const BELL_EXCLUDED_TYPES = new Set<string>(['message', 'new_message']);

export const PHASE1_ONLY_TYPES = new Set<string>(['crossed_paths', 'nearby']);

export const PHASE2_ONLY_TYPES = new Set<string>([
  'phase2_match',
  'phase2_like',
  'phase2_private_message',
  'tod_connect',
]);

/**
 * Whether an unread notification row should contribute to the bell badge for this phase.
 * Mirrors: shouldIncludeBellNotification(type, phase === 'phase2')
 */
export function bellNotificationCountsForPhase(
  type: string,
  phase: 'phase1' | 'phase2'
): boolean {
  if (BELL_EXCLUDED_TYPES.has(type)) {
    return false;
  }
  if (phase === 'phase2') {
    return !PHASE1_ONLY_TYPES.has(type);
  }
  return !PHASE2_ONLY_TYPES.has(type);
}
