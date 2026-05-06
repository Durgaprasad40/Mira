export type TodModerationStatus =
  | 'normal'
  | 'under_review'
  | 'hidden_by_reports';

export const TOD_REPORT_THRESHOLDS = {
  TRENDING_SUPPRESS: 2,
  AUTO_HIDE: 3,
} as const;

export function moderationStatusForTodReportCount(count: number): TodModerationStatus {
  if (count >= TOD_REPORT_THRESHOLDS.AUTO_HIDE) return 'hidden_by_reports';
  if (count >= TOD_REPORT_THRESHOLDS.TRENDING_SUPPRESS) return 'under_review';
  return 'normal';
}

export function isTodPubliclyVisible(
  item: {
    isDeleted?: boolean;
    expiresAt?: number;
    moderationStatus?: TodModerationStatus;
    reportCount?: number;
  },
  now: number
): boolean {
  const fallbackHidden = (item.reportCount ?? 0) >= TOD_REPORT_THRESHOLDS.AUTO_HIDE;
  return (
    !item.isDeleted &&
    (item.expiresAt === undefined || item.expiresAt > now) &&
    item.moderationStatus !== 'hidden_by_reports' &&
    !fallbackHidden
  );
}
