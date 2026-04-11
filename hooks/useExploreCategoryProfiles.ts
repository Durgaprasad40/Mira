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
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode, convex } from '@/hooks/useConvex';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';

const EMPTY_PROFILES: any[] = [];
const EXPLORE_CATEGORY_ERROR = 'Unable to load this vibe right now.';

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
  isError: boolean;
  error: string | null;
};

const exploreCategoryResultCache = new Map<string, Pick<
  UseExploreCategoryProfilesResult,
  'profiles' | 'totalCount' | 'hasMore' | 'status' | 'partialBatchExhausted'
>>();

function getExploreCategoryCacheKey(categoryId: string, limit: number, offset: number) {
  return `${categoryId}:${limit}:${offset}`;
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
  const allProfiles = useExploreProfiles({ enabled: isDemoMode });
  const category = EXPLORE_CATEGORIES.find((c) => c.id === categoryId);
  const cacheKey = useMemo(
    () => getExploreCategoryCacheKey(categoryId, limit, offset),
    [categoryId, limit, offset],
  );

  const demoProfiles = useMemo(
    () => allProfiles.filter(category?.predicate ?? (() => false)),
    [allProfiles, category],
  );

  const [state, setState] = useState<UseExploreCategoryProfilesResult>(() => {
    const cached = exploreCategoryResultCache.get(cacheKey);
    return {
      profiles: cached?.profiles ?? EMPTY_PROFILES,
      totalCount: cached?.totalCount ?? 0,
      hasMore: cached?.hasMore ?? false,
      status: cached?.status ?? 'ok',
      partialBatchExhausted: cached?.partialBatchExhausted ?? false,
      isLoading: cached == null,
      // NOTE: isDemoAuthMode uses real Convex backend with token-based auth
      isUsingBackend: !isDemoMode,
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
            isError: false,
            error: null,
          });
        }
        return;
      }

      if (!authReady) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoading: true, isError: false, error: null, isUsingBackend: true }));
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
            isError: false,
            error: null,
          });
        }
        return;
      }

      if (!cancelled) {
        const cached = exploreCategoryResultCache.get(cacheKey);
        setState({
          profiles: cached?.profiles ?? EMPTY_PROFILES,
          totalCount: cached?.totalCount ?? 0,
          hasMore: cached?.hasMore ?? false,
          status: cached?.status ?? 'ok',
          partialBatchExhausted: cached?.partialBatchExhausted ?? false,
          isLoading: true,
          isUsingBackend: true,
          isError: false,
          error: null,
        });
      }

      try {
        // Pass token for demo auth mode support (backend uses requireAppUserId)
        const result = await convex.query(api.discover.getExploreCategoryProfiles as any, {
          categoryId,
          limit,
          offset,
          refreshKey,
          token: token ?? undefined,
        });

        if (cancelled) return;

        const nextState = {
          profiles: result?.profiles ?? EMPTY_PROFILES,
          totalCount: result?.totalCount ?? 0,
          hasMore: result?.hasMore === true,
          status: result?.status ?? 'ok',
          partialBatchExhausted: result?.partialBatchExhausted === true,
          isLoading: false,
          isUsingBackend: true,
          isError: false,
          error: null,
        } satisfies UseExploreCategoryProfilesResult;

        exploreCategoryResultCache.set(cacheKey, {
          profiles: nextState.profiles,
          totalCount: nextState.totalCount,
          hasMore: nextState.hasMore,
          status: nextState.status,
          partialBatchExhausted: nextState.partialBatchExhausted,
        });

        setState(nextState);
      } catch (error) {
        if (cancelled) return;
        console.warn('[useExploreCategoryProfiles] Failed to load category profiles:', error);
        const cached = exploreCategoryResultCache.get(cacheKey);
        if (cached) {
          setState({
            profiles: cached.profiles,
            totalCount: cached.totalCount,
            hasMore: cached.hasMore,
            status: cached.status,
            partialBatchExhausted: cached.partialBatchExhausted,
            isLoading: false,
            isUsingBackend: true,
            isError: false,
            error: null,
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
  }, [authReady, cacheKey, category, userId, categoryId, limit, offset, refreshKey, demoProfiles, token]);

  return state;
}
