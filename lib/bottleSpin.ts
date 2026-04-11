export const BOTTLE_SPIN_COOLDOWN_MS = 60 * 60 * 1000;
export const BOTTLE_SPIN_PENDING_INVITE_TIMEOUT_MS = 5 * 60 * 1000;

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
