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

interface DiscoverPrefetchState {
  userId: string;
  authVersion: number;
  promise: Promise<any[]> | null;
  result: any[] | null;
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
 * @param userId - The user's Convex ID
 * @param authVersion - Current auth version (for invalidation on logout)
 */
export function startDiscoverPrefetch(userId: string, authVersion: number): void {
  // P0-004 FIX: Demo bypass only in __DEV__ builds
  if (__DEV__ && isDemoMode) return;

  // Clear any stale prefetch from different user/session
  if (prefetchState && (prefetchState.userId !== userId || prefetchState.authVersion !== authVersion)) {
    prefetchState = null;
    prefetchUsed = false;
  }

  // Don't re-prefetch if already in progress for same user
  if (prefetchState?.userId === userId && prefetchState?.authVersion === authVersion) {
    return;
  }

  if (__DEV__) {
    console.log('[PREFETCH] Starting Discover prefetch for user:', userId.slice(0, 15) + '...');
  }

  const promise = convex.query(api.discover.getDiscoverProfiles, {
    userId: userId as any,
    sortBy: 'recommended',
    limit: 20,
  });

  prefetchState = {
    userId,
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
        prefetchState.result = result;
        if (__DEV__) {
          const elapsed = Date.now() - prefetchState.startedAt;
          console.log(`[PREFETCH] Discover prefetch completed: ${result?.length ?? 0} profiles in ${elapsed}ms`);
        }
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
export function getDiscoverPrefetch(userId: string, authVersion: number): any[] | null {
  if (!prefetchState) return null;
  if (prefetchState.userId !== userId) return null;
  if (prefetchState.authVersion !== authVersion) return null;
  if (prefetchState.result === null) return null;

  return prefetchState.result;
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
    if (__DEV__) {
      console.log('[PREFETCH] Clearing used prefetch cache');
    }
    prefetchState = null;
    prefetchUsed = false;
  }
}

/**
 * Clear prefetch cache unconditionally (called on logout or auth failure).
 */
export function clearDiscoverPrefetch(): void {
  if (prefetchState) {
    if (__DEV__) {
      console.log('[PREFETCH] Clearing prefetch cache');
    }
  }
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
