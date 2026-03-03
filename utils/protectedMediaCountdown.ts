/**
 * Shared countdown logic for protected media timers.
 * Used by both Phase2ProtectedMediaViewer (inside/fullscreen) and ProtectedMediaBubble (outside/thumbnail).
 * Ensures consistent timer behavior and formatting across both views.
 */

export interface ProtectedMediaCountdown {
  remainingSeconds: number; // Seconds remaining (>=0)
  label: string;            // Formatted string (e.g., "0:09", "1:32")
  expired: boolean;         // True when timer has expired
}

/**
 * Calculate countdown from wall-clock timestamp.
 *
 * @param timerEndsAt - Wall-clock timestamp (ms) when timer expires
 * @returns Countdown state with remainingSeconds, formatted label, and expired flag
 */
export function calculateProtectedMediaCountdown(
  timerEndsAt: number | null | undefined
): ProtectedMediaCountdown {
  if (!timerEndsAt) {
    return {
      remainingSeconds: 0,
      label: '0:00',
      expired: true,
    };
  }

  const now = Date.now();
  const remainingMs = timerEndsAt - now;
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const expired = remainingSeconds <= 0;

  // Format as M:SS (e.g., "0:09", "1:32", "12:05")
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return {
    remainingSeconds,
    label,
    expired,
  };
}
