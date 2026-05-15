/**
 * Bell visibility by phase — must stay aligned with `shouldIncludeBellNotification`
 * in `hooks/useNotifications.ts` (list/badge parity).
 */

export const BELL_EXCLUDED_TYPES = new Set<string>(['message', 'new_message']);

export const PHASE1_ONLY_TYPES = new Set<string>([
  'crossed_paths',
  'nearby',
  'tagged_confession',
  'confession_reply',
  'confession_reaction',
  'confession_connect_requested',
  'confession_connect_accepted',
  'confession_connect_rejected',
]);

export const PHASE2_ONLY_TYPES = new Set<string>([
  'phase2_match',
  'phase2_like',
  'phase2_private_message',
  'phase2_deep_connect',
  // I-002 RESERVED/DEPRECATED — `phase2_chat_room` has NO writer. It is kept
  // here only so the Phase-1 bell never accidentally picks up a legacy
  // `phase2_chat_room` row (the Phase-1 bell excludes everything in this
  // set). Chat Room DMs stay bounded inside Chat Rooms and must not produce
  // out-of-room notifications. Do NOT add a writer for this type.
  'phase2_chat_room',
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
