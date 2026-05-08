export const FREE_TONIGHT_ACTIVITY_ID = "free_tonight";
export const FREE_TONIGHT_EXPIRY_HOUR = 6;
export const FREE_TONIGHT_MAX_DURATION_MS = 18 * 60 * 60 * 1000;

export function getNextLocalFreeTonightExpiry(nowMs = Date.now()): number {
  const expiry = new Date(nowMs);
  expiry.setHours(FREE_TONIGHT_EXPIRY_HOUR, 0, 0, 0);

  if (expiry.getTime() <= nowMs) {
    expiry.setDate(expiry.getDate() + 1);
  }

  return expiry.getTime();
}

export function isFreeTonightActive(
  activities: readonly string[] | null | undefined,
  freeTonightExpiresAt: number | null | undefined,
  nowMs = Date.now(),
): boolean {
  return (
    Array.isArray(activities) &&
    activities.includes(FREE_TONIGHT_ACTIVITY_ID) &&
    typeof freeTonightExpiresAt === "number" &&
    Number.isFinite(freeTonightExpiresAt) &&
    freeTonightExpiresAt > nowMs
  );
}
