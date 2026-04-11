/**
 * DISCOVER-CATEGORY-FIX: Hook for fetching category counts from backend
 *
 * Uses the new single-category assignment system to get accurate counts
 * per category. This prevents duplicate profiles appearing in multiple
 * categories.
 *
 * P1-001 FIX: Now uses useQuery() (reactive) to share cache with the preload
 * in _layout.tsx. First Explore open benefits from preloaded data.
 *
 * P2-003 FIX: Empty result {} is treated as valid data, not an error.
 * Only actual query failures result in error state.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

export type ExploreCategoryCountsStatus = 'ok' | 'viewer_missing' | 'discovery_paused';
export type ExploreNearbyAvailabilityStatus = 'ok' | 'location_required' | 'verification_required';

type ExploreCategoryCountsResult = {
  data: Record<string, number> | null;
  status: ExploreCategoryCountsStatus | null;
  nearbyStatus: ExploreNearbyAvailabilityStatus;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
};

const EXPLORE_COUNTS_ERROR = 'Unable to load Explore right now.';

// Demo mode mock counts - realistic distribution for UI testing
const DEMO_CATEGORY_COUNTS: Record<string, number> = {
  // Relationship categories
  serious_vibes: 12,
  keep_it_casual: 8,
  exploring_vibes: 15,
  see_where_it_goes: 10,
  open_to_vibes: 7,
  just_friends: 5,
  open_to_anything: 9,
  single_parent: 3,
  new_to_dating: 6,
  // Right Now categories
  nearby: 4,
};

/**
 * Fetch category counts from the backend using the single-category system.
 * Returns explicit loading and error state so the homepage can stay truthful.
 *
 * P1-001: Uses useQuery() for reactive caching - shares cache with preload in _layout.tsx
 * P2-003: Empty {} is valid data (new user with no matches), not an error
 */
export function useExploreCategoryCounts(refreshKey = 0): ExploreCategoryCountsResult {
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);
  const lastGoodCountsRef = useRef<Record<string, number> | null>(null);
  const lastNearbyStatusRef = useRef<ExploreNearbyAvailabilityStatus>('ok');

  // Determine if we should skip the query
  // Skip if: demo mode (legacy store mode) OR auth not ready OR userId missing
  // NOTE: isDemoAuthMode uses real Convex backend with token-based auth - do NOT skip
  const shouldSkip = isDemoMode || !authReady || !userId;

  // P1-001 FIX: Use useQuery() for reactive caching
  // This shares cache with the preload in _layout.tsx, so first Explore open is faster
  // refreshKey in args triggers re-fetch when changed (for manual refresh)
  // IMPORTANT: Always call useQuery unconditionally (React hooks rule)
  // Pass token for demo auth mode support (backend uses requireAppUserId)
  const queryResult = useQuery(
    api.discover.getExploreCategoryCounts,
    shouldSkip ? 'skip' : { refreshKey, token: token ?? undefined }
  );

  useEffect(() => {
    if (queryResult && queryResult.status === 'ok' && queryResult.counts) {
      lastGoodCountsRef.current = queryResult.counts;
      lastNearbyStatusRef.current = queryResult.nearbyStatus ?? 'ok';
    }
  }, [queryResult]);

  // Legacy demo mode only: return mock counts (query was skipped above)
  // NOTE: isDemoAuthMode uses real Convex backend - NOT handled here
  if (isDemoMode) {
    return {
      data: DEMO_CATEGORY_COUNTS,
      status: 'ok',
      nearbyStatus: 'ok',
      isLoading: false,
      isError: false,
      error: null,
    };
  }

  // Auth not ready yet - show loading
  if (!authReady) {
    return { data: null, status: null, nearbyStatus: 'ok', isLoading: true, isError: false, error: null };
  }

  // Auth ready but no userId - viewer state is unavailable, not a healthy empty result
  if (!userId) {
    return {
      data: lastGoodCountsRef.current,
      status: 'viewer_missing',
      nearbyStatus: lastNearbyStatusRef.current,
      isLoading: false,
      isError: false,
      error: null,
    };
  }

  // Query is loading (undefined means still fetching)
  if (queryResult === undefined) {
    return {
      data: lastGoodCountsRef.current,
      status: lastGoodCountsRef.current ? 'ok' : null,
      nearbyStatus: lastNearbyStatusRef.current,
      isLoading: true,
      isError: false,
      error: null,
    };
  }

  // P2-003 FIX: Treat empty {} as valid data, not error
  // null result from query is a failure, but {} is valid (new user with no matches)
  if (queryResult === null) {
    return {
      data: lastGoodCountsRef.current,
      status: lastGoodCountsRef.current ? 'ok' : null,
      nearbyStatus: lastNearbyStatusRef.current,
      isLoading: false,
      isError: lastGoodCountsRef.current == null,
      error: lastGoodCountsRef.current == null ? EXPLORE_COUNTS_ERROR : null,
    };
  }

  return {
    data: queryResult.counts ?? null,
    status: queryResult.status ?? null,
    nearbyStatus: queryResult.nearbyStatus ?? 'ok',
    isLoading: false,
    isError: false,
    error: null,
  };
}
