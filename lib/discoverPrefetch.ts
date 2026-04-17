/**
 * Discover Prefetch Cache
 *
 * Enables parallel fetching of Discover profiles during auth validation.
 * This eliminates the serial wait: auth → navigate → mount → query → render
 * Instead: auth + prefetch (parallel) → navigate → mount → render immediately
 *
 * IMPORTANT: Prefetched data is ONLY used for initial render bootstrap.
 * The useQuery subscription takes over immediately for live updates.
 *
 * SAFETY:
 * - Prefetch is tied to specific userId + authVersion
 * - Cleared on logout (authVersion mismatch)
 * - Cleared when used (single-use bootstrap)
 * - Does NOT affect existing subscription behavior
 */

import { convex, isDemoMode } from '@/hooks/useConvex';
import { api } from '@/convex/_generated/api';
import {
  unwrapPhase1DiscoverQueryResult,
  type Phase1DiscoverQueryResult,
} from '@/lib/phase1DiscoverQuery';

interface DiscoverPrefetchState {
  userId: string;
  token: string;
  authVersion: number;
  promise: Promise<unknown> | null;
  result: Phase1DiscoverQueryResult | null;
  startedAt: number;
}

// Module-level cache - survives across renders
let prefetchState: DiscoverPrefetchState | null = null;

// Track if prefetch has been used (for cleanup)
let prefetchUsed = false;

/**
 * Start prefetching Discover profiles for a user.
 * Called during auth validation in index.tsx.
 *
 * @param userId - The user's Convex ID (cache key; identity comes from token)
 * @param token - Validated session or demo token (required for Discover query)
 * @param authVersion - Current auth version (for invalidation on logout)
 */
export function startDiscoverPrefetch(userId: string, token: string, authVersion: number): void {
  // P0-004 FIX: Demo bypass only in __DEV__ builds
  if (__DEV__ && isDemoMode) return;

  const trimmedToken = token.trim();
  if (!trimmedToken) return;

  // Clear any stale prefetch from different user/session
  if (
    prefetchState &&
    (prefetchState.userId !== userId ||
      prefetchState.token !== trimmedToken ||
      prefetchState.authVersion !== authVersion)
  ) {
    prefetchState = null;
    prefetchUsed = false;
  }

  // Don't re-prefetch if already in progress for same user
  if (
    prefetchState?.userId === userId &&
    prefetchState?.token === trimmedToken &&
    prefetchState?.authVersion === authVersion
  ) {
    return;
  }

  // Prefetch start log disabled to reduce DEV noise

  const promise = convex.query(api.discover.getDiscoverProfiles, {
    token: trimmedToken,
    sortBy: 'recommended',
    limit: 20,
  });

  prefetchState = {
    userId,
    token: trimmedToken,
    authVersion,
    promise,
    result: null,
    startedAt: Date.now(),
  };

  // Resolve and store result
  promise
    .then((result) => {
      // Only store if this prefetch is still valid
      if (prefetchState?.userId === userId && prefetchState?.authVersion === authVersion) {
        prefetchState.result = unwrapPhase1DiscoverQueryResult(result);
        // Prefetch complete log disabled to reduce DEV noise
      }
    })
    .catch((error) => {
      // Log but don't crash - useQuery will handle the real fetch
      console.warn('[PREFETCH] Discover prefetch failed:', error);
      // Clear the failed prefetch so useQuery takes over
      if (prefetchState?.userId === userId) {
        prefetchState = null;
      }
    });
}

/**
 * Get prefetched Discover profiles if available.
 * Returns null if:
 * - No prefetch started
 * - Prefetch for different user
 * - Auth version mismatch (logout happened)
 * - Prefetch still in progress (result not ready)
 *
 * IMPORTANT: This is safe to call multiple times (for React StrictMode).
 * The result persists until explicitly cleared.
 *
 * @param userId - Expected user ID
 * @param authVersion - Expected auth version
 */
export function getDiscoverPrefetch(userId: string, authVersion: number): Phase1DiscoverQueryResult | null {
  if (!prefetchState) return null;
  if (prefetchState.userId !== userId) return null;
  if (prefetchState.authVersion !== authVersion) return null;
  if (prefetchState.result === null) return null;

  return prefetchState.result;
}

export function getDiscoverPrefetchSnapshot(
  userId: string,
  authVersion: number
): DiscoverPrefetchState | null {
  if (!prefetchState) return null;
  if (prefetchState.userId !== userId) return null;
  if (prefetchState.authVersion !== authVersion) return null;

  return {
    userId: prefetchState.userId,
    token: prefetchState.token,
    authVersion: prefetchState.authVersion,
    promise: prefetchState.promise,
    result: prefetchState.result,
    startedAt: prefetchState.startedAt,
  };
}

/**
 * Mark prefetch as used (called after consuming in DiscoverCardStack).
 * This allows cleanup once useQuery takes over.
 */
export function markPrefetchUsed(): void {
  prefetchUsed = true;
}

/**
 * Clear prefetch cache if it has been used.
 * Called after useQuery returns real data to free memory.
 */
export function clearUsedPrefetch(): void {
  if (prefetchUsed && prefetchState) {
    prefetchState = null;
    prefetchUsed = false;
  }
}

/**
 * Clear prefetch cache unconditionally (called on logout or auth failure).
 */
export function clearDiscoverPrefetch(): void {
  prefetchState = null;
  prefetchUsed = false;
}

/**
 * Check if prefetch result is ready (for logging/debugging).
 */
export function isPrefetchReady(userId: string, authVersion: number): boolean {
  return !!(
    prefetchState?.userId === userId &&
    prefetchState?.authVersion === authVersion &&
    prefetchState?.result !== null
  );
}
