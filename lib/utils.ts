/**
 * Returns true if the string looks like an emoji (not plain ASCII letters/numbers).
 * Used to filter out old reaction keys like "relatable", "bold" that should never render.
 */
export function isProbablyEmoji(s: string): boolean {
  if (!s || s.length === 0) return false;
  // Reject strings that are only ASCII letters, digits, underscores, or spaces
  if (/^[a-zA-Z0-9_\s]+$/.test(s)) return false;
  return true;
}

/**
 * Convert height from centimeters to feet and inches display format.
 * Example: 172 → "5'8"", 180 → "5'11""
 * @param cm Height in centimeters
 * @returns Formatted string like "5'8"" or null if invalid
 */
export function cmToFeetInches(cm: number | null | undefined): string | null {
  if (cm == null || !Number.isFinite(cm) || cm <= 0) return null;
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  // Handle edge case where rounding gives 12 inches
  if (inches === 12) {
    return `${feet + 1}'0"`;
  }
  return `${feet}'${inches}"`;
}

// P1-004 FIX: Guard against undefined/null timestamp (legacy data)
export function getTimeAgo(timestamp: number | undefined | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return 'now';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'now'; // Future timestamp protection
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
