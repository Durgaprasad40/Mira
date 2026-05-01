/**
 * Identity helpers — keep display names visually stable across loading.
 *
 * The literal string "Anonymous" must ONLY appear when the user intentionally
 * selected an anonymous mode (Confess, TOD, Phase-1 anonymous flag).
 * It must NOT appear because profile/conversation data is still loading.
 *
 * resolveStableName returns the most recent non-empty, non-"anonymous" name,
 * or undefined to signal that the caller should render a skeleton/placeholder.
 */
export function resolveStableName(
  next: string | null | undefined,
  prev: string | undefined,
): string | undefined {
  const n = typeof next === 'string' ? next.trim() : '';
  if (n.length > 0 && n.toLowerCase() !== 'anonymous') return n;
  return prev;
}
