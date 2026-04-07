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
  isLoading: boolean;
  isUsingBackend: boolean;
  isError: boolean;
  error: string | null;
};

export function useExploreCategoryProfiles({
  categoryId,
  trackShown: _trackShown = false,
  limit = 20,
  offset = 0,
  refreshKey = 0,
}: UseExploreCategoryProfilesOptions): UseExploreCategoryProfilesResult {
  const userId = useAuthStore((s) => s.userId);
  const authReady = useAuthStore((s) => s.authReady);
  const allProfiles = useExploreProfiles({ enabled: isDemoMode });
  const category = EXPLORE_CATEGORIES.find((c) => c.id === categoryId);

  const demoProfiles = useMemo(
    () => allProfiles.filter(category?.predicate ?? (() => false)),
    [allProfiles, category],
  );

  const [state, setState] = useState<UseExploreCategoryProfilesResult>({
    profiles: EMPTY_PROFILES,
    totalCount: 0,
    isLoading: true,
    isUsingBackend: !isDemoMode,
    isError: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isDemoMode) {
        if (!cancelled) {
          setState({
            profiles: demoProfiles,
            totalCount: demoProfiles.length,
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

      if (!userId || !categoryId) {
        if (!cancelled) {
          setState({
            profiles: EMPTY_PROFILES,
            totalCount: 0,
            isLoading: false,
            isUsingBackend: true,
            isError: true,
            error: EXPLORE_CATEGORY_ERROR,
          });
        }
        return;
      }

      if (!cancelled) {
        setState((prev) => ({ ...prev, isLoading: true, isError: false, error: null, isUsingBackend: true }));
      }

      try {
        const result = await convex.query(api.discover.getExploreCategoryProfiles as any, {
          viewerId: userId,
          categoryId,
          limit,
          offset,
          refreshKey,
        });

        if (cancelled) return;

        setState({
          profiles: result?.profiles ?? EMPTY_PROFILES,
          totalCount: result?.totalCount ?? 0,
          isLoading: false,
          isUsingBackend: true,
          isError: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn('[useExploreCategoryProfiles] Failed to load category profiles:', error);
        setState({
          profiles: EMPTY_PROFILES,
          totalCount: 0,
          isLoading: false,
          isUsingBackend: true,
          isError: true,
          error: EXPLORE_CATEGORY_ERROR,
        });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [authReady, userId, categoryId, limit, offset, refreshKey, demoProfiles]);

  return state;
}
