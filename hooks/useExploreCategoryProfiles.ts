/**
 * DISCOVER-CATEGORY-FIX: Hook for fetching profiles by category from backend
 *
 * Uses backend Explore assignment to fetch profiles assigned to a category.
 * Relationship categories are exclusive per viewer-candidate pair and are
 * chosen from mutual relationship goals; Right Now categories keep their
 * existing signal priority. Swipe exclusions remain global.
 *
 * Features:
 * - Uses `getExploreCategoryProfiles` query with category-based filtering
 * - Honors backend cooldown filtering
 * - Leaves client-side shown tracking disabled until a safe rollout is ready
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { isDemoMode, convex } from '@/hooks/useConvex';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import {
  FRONTEND_RELATIONSHIP_INTENT_IDS,
  normalizeRelationshipIntentValues,
} from '@/lib/discoveryNaming';

const EMPTY_PROFILES: any[] = [];
const EMPTY_INTENTS: string[] = [];
const EXPLORE_CATEGORY_ERROR = 'Unable to load this vibe right now.';
const EXPLORE_CATEGORY_STALE_ERROR = 'Showing saved results while we reconnect.';
const RELATIONSHIP_CATEGORY_IDS = new Set<string>(FRONTEND_RELATIONSHIP_INTENT_IDS);

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

const exploreCategoryResultCache = new Map<string, Pick<
  UseExploreCategoryProfilesResult,
  'profiles' | 'totalCount' | 'hasMore' | 'status' | 'partialBatchExhausted'
>>();
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
    status === 'location_required' ||
    status === 'verification_required' ||
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

function getMutualRelationshipCategory(
  viewerRelationshipIntent: readonly string[] | string | undefined | null,
  candidateRelationshipIntent: readonly string[] | string | undefined | null,
) {
  const viewerGoals = new Set<string>(normalizeRelationshipIntentValues(viewerRelationshipIntent));
  if (viewerGoals.size === 0) return null;

  const candidateGoals = new Set<string>(normalizeRelationshipIntentValues(candidateRelationshipIntent));
  if (candidateGoals.size === 0) return null;

  for (const categoryId of FRONTEND_RELATIONSHIP_INTENT_IDS) {
    if (viewerGoals.has(categoryId) && candidateGoals.has(categoryId)) {
      return categoryId;
    }
  }

  return null;
}

export function useExploreCategoryProfiles({
  categoryId,
  trackShown: _trackShown = false,
  limit = 20,
  offset = 0,
  refreshKey = 0,
}: UseExploreCategoryProfilesOptions): UseExploreCategoryProfilesResult {
  const userId = useAuthStore((s) => s.userId);
  const authReady = useAuthStore((s) => s.authReady);
  const demoViewerRelationshipIntent = useDemoStore((s) => {
    const currentDemoUserId = s.currentDemoUserId;
    if (!currentDemoUserId) return EMPTY_INTENTS;
    return s.demoProfiles[currentDemoUserId]?.relationshipIntent ?? EMPTY_INTENTS;
  });
  const allProfiles = useExploreProfiles({ enabled: isDemoMode });
  const category = EXPLORE_CATEGORIES.find((c) => c.id === categoryId);
  const cacheKey = useMemo(
    () => getExploreCategoryCacheKey(categoryId, limit, offset, refreshKey),
    [categoryId, limit, offset, refreshKey],
  );
  const latestCacheKey = useMemo(
    () => getExploreCategoryLatestCacheKey(categoryId, limit, offset),
    [categoryId, limit, offset],
  );

  const demoProfiles = useMemo(
    () => {
      if (!category) return EMPTY_PROFILES;
      if (RELATIONSHIP_CATEGORY_IDS.has(category.id)) {
        return allProfiles.filter(
          (profile) => getMutualRelationshipCategory(
            demoViewerRelationshipIntent,
            profile?.relationshipIntent,
          ) === category.id,
        );
      }
      return allProfiles.filter(category.predicate);
    },
    [allProfiles, category, demoViewerRelationshipIntent],
  );

  const [state, setState] = useState<UseExploreCategoryProfilesResult>(() => {
    const cached = exploreCategoryResultCache.get(cacheKey) ?? exploreCategoryLatestResultCache.get(latestCacheKey);
    return {
      profiles: cached?.profiles ?? EMPTY_PROFILES,
      totalCount: cached?.totalCount ?? 0,
      hasMore: cached?.hasMore ?? false,
      status: cached?.status ?? 'ok',
      partialBatchExhausted: cached?.partialBatchExhausted ?? false,
      isLoading: cached == null,
      // NOTE: isDemoAuthMode uses real Convex backend with token-based auth
      isUsingBackend: !isDemoMode,
      isStale: false,
      isError: false,
      error: null,
    };
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Legacy demo mode only: use local demo profiles
      // NOTE: isDemoAuthMode uses real Convex backend with token-based auth - NOT handled here
      if (isDemoMode) {
        if (!cancelled) {
          setState({
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
          });
        }
        return;
      }

      if (!authReady) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoading: true,
            isUsingBackend: true,
            isStale: false,
            isError: false,
            error: null,
          }));
        }
        return;
      }

      if (!userId || !categoryId || !category) {
        if (!cancelled) {
          setState({
            profiles: EMPTY_PROFILES,
            totalCount: 0,
            hasMore: false,
            status: !userId ? 'viewer_missing' : 'invalid_category',
            partialBatchExhausted: false,
            isLoading: false,
            isUsingBackend: true,
            isStale: false,
            isError: false,
            error: null,
          });
        }
        return;
      }

      if (!cancelled) {
        const cached = exploreCategoryLatestResultCache.get(latestCacheKey);
        setState({
          profiles: cached?.profiles ?? EMPTY_PROFILES,
          totalCount: cached?.totalCount ?? 0,
          hasMore: cached?.hasMore ?? false,
          status: cached?.status ?? 'ok',
          partialBatchExhausted: cached?.partialBatchExhausted ?? false,
          isLoading: true,
          isUsingBackend: true,
          isStale: false,
          isError: false,
          error: null,
        });
      }

      try {
        const result = await convex.query(api.discover.getExploreCategoryProfiles, {
          userId,
          categoryId,
          limit,
          offset,
          refreshKey,
        });

        if (cancelled) return;

        const nextProfiles = result?.profiles ?? EMPTY_PROFILES;
        const nextTotalCount = result?.totalCount ?? 0;
        const nextStatus = normalizeExploreCategoryStatus(result?.status, nextProfiles.length > 0);
        const nextHasMore = offset + nextProfiles.length < nextTotalCount;

        const nextState = {
          profiles: nextProfiles,
          totalCount: nextTotalCount,
          hasMore: nextHasMore,
          status: nextStatus,
          partialBatchExhausted: false,
          isLoading: false,
          isUsingBackend: true,
          isStale: false,
          isError: false,
          error: null,
        } satisfies UseExploreCategoryProfilesResult;

        const cacheEntry = {
          profiles: nextState.profiles,
          totalCount: nextState.totalCount,
          hasMore: nextState.hasMore,
          status: nextState.status,
          partialBatchExhausted: nextState.partialBatchExhausted,
        } satisfies ExploreCategoryCacheEntry;

        exploreCategoryResultCache.set(cacheKey, cacheEntry);
        exploreCategoryLatestResultCache.set(latestCacheKey, cacheEntry);

        setState(nextState);
      } catch (error) {
        if (cancelled) return;
        console.warn('[useExploreCategoryProfiles] Failed to load category profiles:', error);
        const cached = exploreCategoryLatestResultCache.get(latestCacheKey);
        if (cached) {
          setState({
            profiles: cached.profiles,
            totalCount: cached.totalCount,
            hasMore: cached.hasMore,
            status: cached.status,
            partialBatchExhausted: cached.partialBatchExhausted,
            isLoading: false,
            isUsingBackend: true,
            isStale: true,
            isError: false,
            error: EXPLORE_CATEGORY_STALE_ERROR,
          });
        } else {
          setState({
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
          });
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [authReady, cacheKey, category, userId, categoryId, latestCacheKey, limit, offset, refreshKey, demoProfiles]);

  return state;
}
