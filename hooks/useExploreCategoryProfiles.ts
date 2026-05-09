/**
 * Hook for fetching profiles by category from backend Explore assignment.
 *
 * Relationship categories are exclusive per viewer-candidate pair and are
 * chosen from mutual relationship goals; Right Now categories keep their
 * existing signal priority. Swipe exclusions remain global.
 */
import { useEffect, useMemo } from 'react';
import { useMutation, useQueries, type RequestForQueries } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import {
  EXPLORE_CATEGORIES,
  profileMatchesExploreCategory,
} from '@/components/explore/exploreCategories';

type ExploreCategoryProfile = {
  id?: Id<'users'> | string;
  [key: string]: unknown;
};

const EMPTY_PROFILES: ExploreCategoryProfile[] = [];
const EMPTY_INTENTS: string[] = [];
const EXPLORE_CATEGORY_ERROR = 'Unable to load this vibe right now.';
const LIVE_QUERY_KEY = 'categoryProfiles';

export type ExploreCategoryStatus =
  | 'ok'
  | 'viewer_missing'
  | 'discovery_paused'
  | 'invalid_category'
  | 'location_required'
  | 'verification_required'
  | 'empty_category';

type UseExploreCategoryProfilesOptions = {
  categoryId: string;
  limit?: number;
  offset?: number;
  refreshKey?: number;
};

type UseExploreCategoryProfilesResult = {
  profiles: ExploreCategoryProfile[];
  totalCount: number;
  hasMore: boolean;
  status: ExploreCategoryStatus;
  partialBatchExhausted: boolean;
  isLoading: boolean;
  isUsingBackend: boolean;
  isStale: boolean;
  isError: boolean;
  error: string | null;
};

type ExploreCategoryProfilesPayload = {
  profiles?: ExploreCategoryProfile[];
  totalCount?: number;
  status?: string;
} | null;

function normalizeExploreCategoryStatus(
  status: string | null | undefined,
  hasProfiles: boolean,
): ExploreCategoryStatus {
  if (
    status === 'ok' ||
    status === 'viewer_missing' ||
    status === 'discovery_paused' ||
    status === 'invalid_category' ||
    status === 'location_required' ||
    status === 'verification_required' ||
    status === 'empty_category'
  ) {
    return status;
  }
  return hasProfiles ? 'ok' : 'empty_category';
}

function isUserId(value: unknown): value is Id<'users'> {
  return typeof value === 'string' && value.length > 0;
}

function getExploreCategoryDebugError(error: Error): string {
  return error.message || error.name || 'unknown_query_error';
}

export function useExploreCategoryProfiles({
  categoryId,
  limit = 20,
  offset = 0,
  refreshKey = 0,
}: UseExploreCategoryProfilesOptions): UseExploreCategoryProfilesResult {
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);
  const sessionToken = typeof token === 'string' ? token.trim() : '';
  const demoViewerRelationshipIntent = useDemoStore((s) => {
    const currentDemoUserId = s.currentDemoUserId;
    if (!currentDemoUserId) return EMPTY_INTENTS;
    return s.demoProfiles[currentDemoUserId]?.relationshipIntent ?? EMPTY_INTENTS;
  });
  const allProfiles = useExploreProfiles({ enabled: isDemoMode });
  const category = EXPLORE_CATEGORIES.find((c) => c.id === categoryId);
  const recordExploreImpression = useMutation(api.discover.recordExploreImpression);

  const demoProfiles = useMemo(
    () => {
      if (!category) return EMPTY_PROFILES;
      return allProfiles.filter((profile) =>
        profileMatchesExploreCategory(category, profile, demoViewerRelationshipIntent),
      );
    },
    [allProfiles, category, demoViewerRelationshipIntent],
  );

  const liveQueries = useMemo<RequestForQueries>(() => {
    if (isDemoMode || !authReady || sessionToken.length === 0 || !categoryId || !category) {
      return {};
    }
    const queries: RequestForQueries = {};
    queries[LIVE_QUERY_KEY] = {
      query: api.discover.getExploreCategoryProfiles,
      args: {
        token: sessionToken,
        categoryId,
        limit,
        offset,
        refreshKey,
      },
    };
    return queries;
  }, [authReady, category, categoryId, limit, offset, refreshKey, sessionToken]);

  const liveQueryResult = useQueries(liveQueries);
  const liveQueryValue = liveQueryResult[LIVE_QUERY_KEY];
  const liveError = liveQueryValue instanceof Error ? liveQueryValue : null;
  const liveResult = liveError
    ? undefined
    : (liveQueryValue as ExploreCategoryProfilesPayload | undefined);

  const liveProfiles = liveResult?.profiles ?? EMPTY_PROFILES;
  const liveTotalCount = liveResult?.totalCount ?? 0;
  const liveStatus = normalizeExploreCategoryStatus(liveResult?.status, liveProfiles.length > 0);

  useEffect(() => {
    if (__DEV__ && liveError) {
      console.warn('[useExploreCategoryProfiles] live query failed', {
        categoryId,
        reason: getExploreCategoryDebugError(liveError),
      });
    }
  }, [categoryId, liveError]);

  useEffect(() => {
    if (
      isDemoMode ||
      !authReady ||
      sessionToken.length === 0 ||
      !categoryId ||
      liveStatus !== 'ok' ||
      liveProfiles.length === 0
    ) {
      return;
    }

    const viewedUserIds = liveProfiles
      .map((p) => p?.id)
      .filter(isUserId);
    if (viewedUserIds.length === 0) return;

    recordExploreImpression({
      token: sessionToken,
      viewedUserIds,
      categoryId,
    }).catch((error) => {
      if (__DEV__) {
        console.warn(
          '[EXPLORE_IMPRESSION_FAIL]',
          error instanceof Error ? getExploreCategoryDebugError(error) : String(error),
        );
      }
    });
  }, [authReady, categoryId, liveProfiles, liveStatus, recordExploreImpression, sessionToken]);

  if (isDemoMode) {
    return {
      profiles: demoProfiles,
      totalCount: demoProfiles.length,
      hasMore: false,
      status: demoProfiles.length > 0 ? 'ok' : 'empty_category',
      partialBatchExhausted: false,
      isLoading: false,
      isUsingBackend: false,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (!authReady) {
    return {
      profiles: EMPTY_PROFILES,
      totalCount: 0,
      hasMore: false,
      status: 'ok',
      partialBatchExhausted: false,
      isLoading: true,
      isUsingBackend: true,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (sessionToken.length === 0 || !categoryId || !category) {
    return {
      profiles: EMPTY_PROFILES,
      totalCount: 0,
      hasMore: false,
      status: sessionToken.length === 0 ? 'viewer_missing' : 'invalid_category',
      partialBatchExhausted: false,
      isLoading: false,
      isUsingBackend: true,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (liveResult === undefined) {
    if (liveError) {
      return {
        profiles: EMPTY_PROFILES,
        totalCount: 0,
        hasMore: false,
        status: 'ok',
        partialBatchExhausted: false,
        isLoading: false,
        isUsingBackend: true,
        isStale: false,
        isError: true,
        error: EXPLORE_CATEGORY_ERROR,
      };
    }

    return {
      profiles: EMPTY_PROFILES,
      totalCount: 0,
      hasMore: false,
      status: 'ok',
      partialBatchExhausted: false,
      isLoading: true,
      isUsingBackend: true,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (liveResult === null) {
    return {
      profiles: EMPTY_PROFILES,
      totalCount: 0,
      hasMore: false,
      status: 'ok',
      partialBatchExhausted: false,
      isLoading: false,
      isUsingBackend: true,
      isStale: false,
      isError: true,
      error: EXPLORE_CATEGORY_ERROR,
    };
  }

  return {
    profiles: liveProfiles,
    totalCount: liveTotalCount,
    hasMore: offset + liveProfiles.length < liveTotalCount,
    status: liveStatus,
    partialBatchExhausted: false,
    isLoading: false,
    isUsingBackend: true,
    isStale: false,
    isError: false,
    error: null,
  };
}
