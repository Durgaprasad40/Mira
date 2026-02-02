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

export function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
