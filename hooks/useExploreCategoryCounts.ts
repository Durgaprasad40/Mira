/**
 * Hook for fetching category counts from backend Explore assignment.
 *
 * Relationship categories are exclusive per viewer-candidate pair and are
 * chosen from mutual relationship goals; Right Now categories keep their
 * existing signal priority. Swipe exclusions remain global.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { countDemoProfilesPerExploreCategory } from '@/components/explore/exploreCategories';

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
const EMPTY_INTENTS: string[] = [];

function normalizeExploreCategoryCountsStatus(
  status: string | null | undefined,
): ExploreCategoryCountsStatus | null {
  if (status === 'ok' || status === 'viewer_missing' || status === 'discovery_paused') {
    return status;
  }
  return null;
}

function normalizeExploreNearbyStatus(
  status: string | null | undefined,
): ExploreNearbyAvailabilityStatus {
  if (status === 'location_required' || status === 'verification_required') {
    return status;
  }
  return 'ok';
}

/**
 * Fetch category counts from the backend using the mutual category system.
 * Returns explicit loading and error state so the homepage can stay truthful.
 *
 * P1-001: Uses useQuery() for reactive caching inside the current Explore session
 * P2-003: Empty {} is valid data (new user with no matches), not an error
 */
export function useExploreCategoryCounts(refreshKey = 0): ExploreCategoryCountsResult {
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);
  const sessionToken = typeof token === 'string' ? token.trim() : '';
  const demoViewerRelationshipIntent = useDemoStore((s) => {
    const currentDemoUserId = s.currentDemoUserId;
    if (!currentDemoUserId) return EMPTY_INTENTS;
    return s.demoProfiles[currentDemoUserId]?.relationshipIntent ?? EMPTY_INTENTS;
  });
  const demoProfiles = useExploreProfiles({ enabled: isDemoMode });
  const demoCategoryCounts = useMemo(
    () => countDemoProfilesPerExploreCategory(demoProfiles, demoViewerRelationshipIntent),
    [demoProfiles, demoViewerRelationshipIntent],
  );
  const lastGoodCountsRef = useRef<Record<string, number> | null>(null);
  const lastNearbyStatusRef = useRef<ExploreNearbyAvailabilityStatus>('ok');
  const lastGoodTokenRef = useRef<string | null>(null);

  // Determine if we should skip the query
  // Skip if: demo mode (legacy store mode) OR auth not ready OR session token missing
  // NOTE: isDemoAuthMode uses real Convex backend with token-based auth - do NOT skip
  const shouldSkip = isDemoMode || !authReady || sessionToken.length === 0;

  // P1-001 FIX: Use useQuery() for reactive caching during the current Explore session.
  // refreshKey in args triggers re-fetch when changed (for manual refresh)
  // IMPORTANT: Always call useQuery unconditionally (React hooks rule)
  // Pass token so the backend can resolve the trusted session user.
  const queryResult = useQuery(
    api.discover.getExploreCategoryCounts,
    shouldSkip ? 'skip' : { refreshKey, token: sessionToken }
  );

  useEffect(() => {
    if (queryResult && queryResult.status === 'ok' && queryResult.counts) {
      lastGoodCountsRef.current = queryResult.counts;
      lastNearbyStatusRef.current = normalizeExploreNearbyStatus(queryResult.nearbyStatus);
      lastGoodTokenRef.current = sessionToken;
    }
  }, [queryResult, sessionToken]);

  useEffect(() => {
    if (lastGoodTokenRef.current && lastGoodTokenRef.current !== sessionToken) {
      lastGoodCountsRef.current = null;
      lastNearbyStatusRef.current = 'ok';
      lastGoodTokenRef.current = null;
    }
  }, [sessionToken]);

  // Legacy demo mode only: return mock counts (query was skipped above)
  // NOTE: isDemoAuthMode uses real Convex backend - NOT handled here
  if (isDemoMode) {
    return {
      data: demoCategoryCounts,
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

  // Auth ready but no token - viewer state is unavailable, not a healthy empty result
  if (sessionToken.length === 0) {
    return {
      data: null,
      status: 'viewer_missing',
      nearbyStatus: 'ok',
      isLoading: false,
      isError: false,
      error: null,
    };
  }

  // Query is loading (undefined means still fetching)
  if (queryResult === undefined) {
    const canUseLastGood = lastGoodTokenRef.current === sessionToken;
    return {
      data: canUseLastGood ? lastGoodCountsRef.current : null,
      status: canUseLastGood && lastGoodCountsRef.current ? 'ok' : null,
      nearbyStatus: canUseLastGood ? lastNearbyStatusRef.current : 'ok',
      isLoading: true,
      isError: false,
      error: null,
    };
  }

  // P2-003 FIX: Treat empty {} as valid data, not error
  // null result from query is a failure, but {} is valid (new user with no matches)
  if (queryResult === null) {
    const canUseLastGood = lastGoodTokenRef.current === sessionToken;
    return {
      data: canUseLastGood ? lastGoodCountsRef.current : null,
      status: canUseLastGood && lastGoodCountsRef.current ? 'ok' : null,
      nearbyStatus: canUseLastGood ? lastNearbyStatusRef.current : 'ok',
      isLoading: false,
      isError: !canUseLastGood || lastGoodCountsRef.current == null,
      error: !canUseLastGood || lastGoodCountsRef.current == null ? EXPLORE_COUNTS_ERROR : null,
    };
  }

  return {
    data: queryResult.counts ?? null,
    status: normalizeExploreCategoryCountsStatus(queryResult.status),
    nearbyStatus: normalizeExploreNearbyStatus(queryResult.nearbyStatus),
    isLoading: false,
    isError: false,
    error: null,
  };
}
