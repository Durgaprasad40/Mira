/**
 * Check if a user is currently active (within last 5 minutes).
 */
export function isActiveNow(lastActive?: number): boolean {
  if (!lastActive) return false;
  return Date.now() - lastActive < 5 * 60 * 1000;
}

/**
 * Format a last-seen timestamp into a human-readable string.
 */
export function formatLastSeen(lastActive?: number): string {
  if (!lastActive) return 'Offline';
  if (isActiveNow(lastActive)) return 'Active now';

  const diff = Date.now() - lastActive;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(lastActive).toLocaleDateString();
}
