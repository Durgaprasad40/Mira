/**
 * DISCOVER-CATEGORY-FIX: Hook for fetching category counts from backend
 *
 * Uses the new single-category assignment system to get accurate counts
 * per category. This prevents duplicate profiles appearing in multiple
 * categories.
 */
import { useEffect, useState } from 'react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode, convex } from '@/hooks/useConvex';

type ExploreCategoryCountsResult = {
  data: Record<string, number> | null;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
};

const EXPLORE_COUNTS_ERROR = 'Unable to load Explore right now.';

/**
 * Fetch category counts from the backend using the single-category system.
 * Returns explicit loading and error state so the homepage can stay truthful.
 */
export function useExploreCategoryCounts(refreshKey = 0): ExploreCategoryCountsResult {
  const userId = useAuthStore((s) => s.userId);
  const authReady = useAuthStore((s) => s.authReady);
  const [state, setState] = useState<ExploreCategoryCountsResult>({
    data: null,
    isLoading: true,
    isError: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isDemoMode) {
        if (!cancelled) {
          setState({ data: null, isLoading: false, isError: true, error: EXPLORE_COUNTS_ERROR });
        }
        return;
      }

      if (!authReady) {
        if (!cancelled) {
          setState({ data: null, isLoading: true, isError: false, error: null });
        }
        return;
      }

      if (!userId) {
        if (!cancelled) {
          setState({ data: null, isLoading: false, isError: true, error: EXPLORE_COUNTS_ERROR });
        }
        return;
      }

      if (!cancelled) {
        setState((prev) => ({ data: prev.data, isLoading: true, isError: false, error: null }));
      }

      try {
        const result = await convex.query(api.discover.getExploreCategoryCounts as any, {
          viewerId: userId,
          refreshKey,
        });

        if (cancelled) return;

        if (!result || Object.keys(result).length === 0) {
          setState({ data: null, isLoading: false, isError: true, error: EXPLORE_COUNTS_ERROR });
          return;
        }

        setState({ data: result, isLoading: false, isError: false, error: null });
      } catch (error) {
        if (cancelled) return;
        console.warn('[useExploreCategoryCounts] Failed to load counts:', error);
        setState({ data: null, isLoading: false, isError: true, error: EXPLORE_COUNTS_ERROR });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [authReady, userId, refreshKey]);

  return state;
}
