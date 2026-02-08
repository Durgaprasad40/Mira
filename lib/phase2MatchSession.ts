/**
 * Phase 2 Match Session Tracking
 *
 * Module-scoped session tracking for Phase 2 (Desire Land) matches.
 * Prevents duplicate match events for the same user within a session.
 *
 * Used by:
 * - DiscoverCardStack.tsx (match creation)
 * - demoStore.ts (reset)
 */

// Session-scoped set of matched user IDs
const matchedThisSession = new Set<string>();

/**
 * Mark a user as matched this session.
 * @returns true if newly added (first match), false if already matched
 */
export function markPhase2Matched(userId: string): boolean {
  if (matchedThisSession.has(userId)) {
    return false;
  }
  matchedThisSession.add(userId);
  return true;
}

/**
 * Check if a user was already matched this session.
 */
export function hasPhase2Matched(userId: string): boolean {
  return matchedThisSession.has(userId);
}

/**
 * Clear all session match tracking (for testing reset).
 */
export function resetPhase2MatchSession(): void {
  matchedThisSession.clear();
  if (__DEV__) {
    console.log('[Phase2Match] session cleared');
  }
}
