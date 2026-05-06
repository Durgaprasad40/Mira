export type ConfessionModerationStatus =
  | 'normal'
  | 'under_review'
  | 'hidden_by_reports';

export const REPORT_THRESHOLDS = {
  TRENDING_SUPPRESS: 2,
  AUTO_HIDE: 3,
} as const;

export function moderationStatusForCount(count: number): ConfessionModerationStatus {
  if (count >= REPORT_THRESHOLDS.AUTO_HIDE) return 'hidden_by_reports';
  if (count >= REPORT_THRESHOLDS.TRENDING_SUPPRESS) return 'under_review';
  return 'normal';
}

export function isPubliclyVisible(
  confession: {
    isDeleted?: boolean;
    expiresAt?: number;
    moderationStatus?: ConfessionModerationStatus;
  },
  now: number
): boolean {
  return (
    !confession.isDeleted &&
    (confession.expiresAt === undefined || confession.expiresAt > now) &&
    confession.moderationStatus !== 'hidden_by_reports'
  );
}
