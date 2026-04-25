// PRODUCT-RULE: T/D cooldown window is 30 minutes (was 60 min).
export const BOTTLE_SPIN_COOLDOWN_MS = 30 * 60 * 1000;
export const BOTTLE_SPIN_PENDING_INVITE_TIMEOUT_MS = 5 * 60 * 1000;
// TD-LIFECYCLE (restored from c471732):
//   - NOT_STARTED: how long an accepted-but-not-manually-started session
//     remains valid before being marked expired.
//   - INACTIVITY: how long a started game can sit idle before being marked
//     expired due to inactivity.
// STABILIZATION-FIX: Extended from 2min to 10min so real-device usage doesn't
// expire before the inviter can press "Start" after the invitee accepts.
export const BOTTLE_SPIN_NOT_STARTED_TIMEOUT_MS = 10 * 60 * 1000;
// PRODUCT-RULE (Option B final lifecycle): inactivity timeout for an ACTIVE,
// already-started game. Bumped from 10 min → 30 min so normal gameplay pauses
// (reading a dare, composing a truth answer, brief interruptions, etc.) never
// accidentally end the session. Only genuinely-idle 30-min windows transition
// to cooldown via the existing cleanupExpiredSession('timeout') path.
export const BOTTLE_SPIN_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

export function formatBottleSpinCooldown(remainingMs: number): string {
  const safeRemainingMs = Math.max(0, remainingMs);
  const totalMinutes = Math.max(1, Math.ceil(safeRemainingMs / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
}

export function normalizeId(id: any): string {
  return String(id ?? '').trim();
}

export function deriveMyRole(session: any, userId: any): 'inviter' | 'invitee' | null {
  if (!session || !userId) return null;

  const normalizedUserId = normalizeId(userId);
  const normalizedInviterId = normalizeId(session.inviterId);
  const normalizedInviteeId = normalizeId(session.inviteeId);

  if (normalizedUserId === normalizedInviterId) return 'inviter';
  if (normalizedUserId === normalizedInviteeId) return 'invitee';

  return null;
}
