/**
 * Chat Time Utilities
 *
 * Shared helpers for timestamp formatting and grouping across all chat components.
 * Reduces timestamp noise by showing timestamps only when meaningful.
 */

// Minimum gap (in ms) before showing a new timestamp (5 minutes)
const TIMESTAMP_GAP_MS = 5 * 60 * 1000;

/**
 * Check if two dates are the same calendar day
 */
export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Determine whether to show a timestamp for the current message.
 *
 * Shows timestamp if:
 * 1. No previous message exists
 * 2. Day changed between messages
 * 3. Time gap >= 5 minutes
 *
 * @param currTimestamp - Current message timestamp (ms)
 * @param prevTimestamp - Previous message timestamp (ms), or undefined if first message
 */
export function shouldShowTimestamp(
  currTimestamp: number,
  prevTimestamp?: number
): boolean {
  // Always show for first message
  if (prevTimestamp === undefined) return true;

  const currDate = new Date(currTimestamp);
  const prevDate = new Date(prevTimestamp);

  // Show if day changed
  if (!isSameDay(currDate, prevDate)) return true;

  // Show if time gap >= 5 minutes
  const gap = currTimestamp - prevTimestamp;
  if (gap >= TIMESTAMP_GAP_MS) return true;

  return false;
}

/**
 * Determine whether to show a day divider before the current message.
 *
 * Shows divider if the day changed from the previous message.
 *
 * @param currTimestamp - Current message timestamp (ms)
 * @param prevTimestamp - Previous message timestamp (ms), or undefined if first message
 */
export function shouldShowDayDivider(
  currTimestamp: number,
  prevTimestamp?: number
): boolean {
  // Show divider for first message (start of conversation)
  if (prevTimestamp === undefined) return true;

  const currDate = new Date(currTimestamp);
  const prevDate = new Date(prevTimestamp);

  return !isSameDay(currDate, prevDate);
}

/**
 * Format a timestamp as time only (e.g., "4:07 PM")
 */
export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes < 10 ? `0${minutes}` : minutes;
  return `${h}:${m} ${ampm}`;
}

/**
 * Format a date as a day label for dividers.
 * Returns "Today", "Yesterday", or "DD MMM YYYY" for older dates.
 */
export function formatDayLabel(timestamp: number, now: Date = new Date()): string {
  const d = new Date(timestamp);

  // Today
  if (isSameDay(d, now)) return 'Today';

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';

  // Older: DD MMM YYYY
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format timestamp with smart date handling.
 * Shows time only for today, "Yesterday HH:MM" for yesterday, or "DD MMM HH:MM" for older.
 */
export function formatSmartTimestamp(timestamp: number, now: Date = new Date()): string {
  const d = new Date(timestamp);
  const timeStr = formatTime(timestamp);

  if (isSameDay(d, now)) return timeStr;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return `Yesterday ${timeStr}`;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${timeStr}`;
}
