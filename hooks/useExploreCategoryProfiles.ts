/**
 * DISCOVER-CATEGORY-FIX: Hook for fetching profiles by category from backend
 *
 * Uses the new single-category assignment system to fetch profiles
 * assigned to a specific category. This ensures mutual exclusivity -
 * each profile only appears in one category.
 *
 * Features:
 * - Uses `getExploreCategoryProfiles` query with category-based filtering
 * - Honors backend cooldown filtering
 * - Leaves client-side shown tracking disabled until a safe rollout is ready
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import {
  clearUsedExploreCategoryPrefetch,
  getExploreCategoryPrefetchSnapshot,
  markExploreCategoryPrefetchUsed,
  type ExploreCategoryProfilesQueryResult,
} from '@/lib/exploreCategoryPrefetch';

const EMPTY_PROFILES: any[] = [];
const EXPLORE_CATEGORY_ERROR = 'Unable to load this vibe right now.';
const EXPLORE_CATEGORY_STALE_ERROR = 'Showing saved results while we reconnect.';
const PREFETCH_HOLD_MS = 400;

export type ExploreCategoryStatus =
  | 'ok'
  | 'viewer_missing'
  | 'discovery_paused'
  | 'invalid_category'
  | 'empty_category';

type UseExploreCategoryProfilesOptions = {
  categoryId: string;
  trackShown?: boolean; // Reserved for compatibility; currently ignored.
  limit?: number;
  offset?: number;
  refreshKey?: number;
};

type UseExploreCategoryProfilesResult = {
  profiles: any[];
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

type ExploreCategoryCacheEntry = Pick<
  UseExploreCategoryProfilesResult,
  'profiles' | 'totalCount' | 'hasMore' | 'status' | 'partialBatchExhausted'
>;

const exploreCategoryResultCache = new Map<string, ExploreCategoryCacheEntry>();
const exploreCategoryLatestResultCache = new Map<string, ExploreCategoryCacheEntry>();

function normalizeExploreCategoryStatus(
  status: string | null | undefined,
  hasProfiles: boolean,
): ExploreCategoryStatus {
  if (
    status === 'ok' ||
    status === 'viewer_missing' ||
    status === 'discovery_paused' ||
    status === 'invalid_category' ||
    status === 'empty_category'
  ) {
    return status;
  }
  return hasProfiles ? 'ok' : 'empty_category';
}

function getExploreCategoryCacheKey(categoryId: string, limit: number, offset: number, refreshKey: number) {
  return `${categoryId}:${limit}:${offset}:${refreshKey}`;
}

function getExploreCategoryLatestCacheKey(categoryId: string, limit: number, offset: number) {
  return `${categoryId}:${limit}:${offset}`;
}

function computeHasMore(offset: number, profilesLength: number, totalCount: number) {
  return offset + profilesLength < totalCount;
}

function toCacheEntry(
  result: ExploreCategoryProfilesQueryResult,
  offset: number,
): ExploreCategoryCacheEntry {
  const profiles = result?.profiles ?? EMPTY_PROFILES;
  const totalCount = result?.totalCount ?? 0;
  return {
    profiles,
    totalCount,
    hasMore: computeHasMore(offset, profiles.length, totalCount),
    status: normalizeExploreCategoryStatus(result?.status, profiles.length > 0),
    partialBatchExhausted: false,
  };
}

export function useExploreCategoryProfiles({
  categoryId,
  trackShown: _trackShown = false,
  limit = 20,
  offset = 0,
  refreshKey = 0,
}: UseExploreCategoryProfilesOptions): UseExploreCategoryProfilesResult {
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);
  const authVersion = useAuthStore((s) => s.authVersion);
  const allProfiles = useExploreProfiles({ enabled: isDemoMode });
  const category = EXPLORE_CATEGORIES.find((c) => c.id === categoryId);
  const sessionToken = useMemo(
    () => (typeof token === 'string' ? token.trim() : ''),
    [token],
  );
  const cacheKey = useMemo(
    () => getExploreCategoryCacheKey(categoryId, limit, offset, refreshKey),
    [categoryId, limit, offset, refreshKey],
  );
  const latestCacheKey = useMemo(
    () => getExploreCategoryLatestCacheKey(categoryId, limit, offset),
    [categoryId, limit, offset],
  );

  const demoProfiles = useMemo(
    () => allProfiles.filter(category?.demoPredicate ?? (() => false)),
    [allProfiles, category],
  );

  const exactCachedEntry = exploreCategoryResultCache.get(cacheKey) ?? null;
  const cachedEntry = exactCachedEntry ?? exploreCategoryLatestResultCache.get(latestCacheKey) ?? null;

  const prefetchSnapshot = useMemo(() => {
    if (isDemoMode || !userId || !sessionToken || !categoryId || !category) return null;
    return getExploreCategoryPrefetchSnapshot({
      userId,
      token: sessionToken,
      authVersion,
      categoryId,
      limit,
      offset,
      refreshKey,
    });
  }, [authVersion, category, categoryId, limit, offset, refreshKey, sessionToken, userId]);

  const [prefetchedResult, setPrefetchedResult] = useState<ExploreCategoryProfilesQueryResult | null>(
    () => prefetchSnapshot?.result ?? null,
  );
  const [prefetchWaitExpired, setPrefetchWaitExpired] = useState(false);

  useEffect(() => {
    setPrefetchedResult(prefetchSnapshot?.result ?? null);
  }, [prefetchSnapshot?.result, prefetchSnapshot?.startedAt]);

  useEffect(() => {
    if (!prefetchSnapshot) {
      return;
    }

    if (prefetchSnapshot.result !== null) {
      markExploreCategoryPrefetchUsed();
      return;
    }

    let cancelled = false;
    prefetchSnapshot.promise
      ?.then((result) => {
        if (cancelled) return;
        markExploreCategoryPrefetchUsed();
        setPrefetchedResult(result);
      })
      .catch(() => {
        if (cancelled) return;
        setPrefetchedResult(null);
      });

    return () => {
      cancelled = true;
    };
  }, [prefetchSnapshot?.promise, prefetchSnapshot?.result, prefetchSnapshot?.startedAt]);

  useEffect(() => {
    if (!prefetchSnapshot?.promise || prefetchSnapshot.result !== null || exactCachedEntry) {
      setPrefetchWaitExpired(false);
      return;
    }

    const elapsed = Date.now() - prefetchSnapshot.startedAt;
    if (elapsed >= PREFETCH_HOLD_MS) {
      setPrefetchWaitExpired(true);
      return;
    }

    setPrefetchWaitExpired(false);
    const timer = setTimeout(() => {
      setPrefetchWaitExpired(true);
    }, PREFETCH_HOLD_MS - elapsed);

    return () => clearTimeout(timer);
  }, [exactCachedEntry, prefetchSnapshot?.promise, prefetchSnapshot?.result, prefetchSnapshot?.startedAt]);

  const shouldSkipQuery = isDemoMode || !authReady || !userId || !sessionToken || !categoryId || !category;
  const shouldHoldQuery =
    !shouldSkipQuery &&
    !exactCachedEntry &&
    !!prefetchSnapshot?.promise &&
    prefetchSnapshot.result === null &&
    prefetchedResult === null &&
    !prefetchWaitExpired;

  const queryResult = useQuery(
    api.discover.getExploreCategoryProfiles,
    shouldSkipQuery || shouldHoldQuery
      ? 'skip'
      : {
          token: sessionToken,
          categoryId,
          limit,
          offset,
          refreshKey,
        },
  );

  const resolvedResult =
    queryResult === undefined
      ? prefetchedResult
      : (queryResult ?? prefetchedResult);

  useEffect(() => {
    if (!resolvedResult) {
      return;
    }

    const cacheEntry = toCacheEntry(resolvedResult, offset);
    exploreCategoryResultCache.set(cacheKey, cacheEntry);
    exploreCategoryLatestResultCache.set(latestCacheKey, cacheEntry);
  }, [cacheKey, latestCacheKey, offset, resolvedResult]);

  useEffect(() => {
    if (queryResult !== undefined && prefetchedResult !== null) {
      clearUsedExploreCategoryPrefetch();
      setPrefetchedResult(null);
    }
  }, [prefetchedResult, queryResult]);

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
      profiles: cachedEntry?.profiles ?? EMPTY_PROFILES,
      totalCount: cachedEntry?.totalCount ?? 0,
      hasMore: cachedEntry ? computeHasMore(offset, cachedEntry.profiles.length, cachedEntry.totalCount) : false,
      status: cachedEntry?.status ?? 'ok',
      partialBatchExhausted: cachedEntry?.partialBatchExhausted ?? false,
      isLoading: true,
      isUsingBackend: true,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (!userId || !sessionToken || !categoryId || !category) {
    return {
      profiles: EMPTY_PROFILES,
      totalCount: 0,
      hasMore: false,
      status: !userId || !sessionToken ? 'viewer_missing' : 'invalid_category',
      partialBatchExhausted: false,
      isLoading: false,
      isUsingBackend: true,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (resolvedResult === undefined) {
    return {
      profiles: cachedEntry?.profiles ?? EMPTY_PROFILES,
      totalCount: cachedEntry?.totalCount ?? 0,
      hasMore: cachedEntry ? computeHasMore(offset, cachedEntry.profiles.length, cachedEntry.totalCount) : false,
      status: cachedEntry?.status ?? 'ok',
      partialBatchExhausted: cachedEntry?.partialBatchExhausted ?? false,
      isLoading: true,
      isUsingBackend: true,
      isStale: false,
      isError: false,
      error: null,
    };
  }

  if (resolvedResult === null) {
    if (cachedEntry) {
      return {
        profiles: cachedEntry.profiles,
        totalCount: cachedEntry.totalCount,
        hasMore: computeHasMore(offset, cachedEntry.profiles.length, cachedEntry.totalCount),
        status: cachedEntry.status,
        partialBatchExhausted: cachedEntry.partialBatchExhausted,
        isLoading: false,
        isUsingBackend: true,
        isStale: true,
        isError: false,
        error: EXPLORE_CATEGORY_STALE_ERROR,
      };
    }

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

  const profiles = resolvedResult?.profiles ?? EMPTY_PROFILES;
  const totalCount = resolvedResult?.totalCount ?? 0;

  return {
    profiles,
    totalCount,
    hasMore: computeHasMore(offset, profiles.length, totalCount),
    status: normalizeExploreCategoryStatus(resolvedResult?.status, profiles.length > 0),
    partialBatchExhausted: false,
    isLoading: false,
    isUsingBackend: true,
    isStale: false,
    isError: false,
    error: null,
  };
}
