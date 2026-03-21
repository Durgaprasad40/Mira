/**
 * DISCOVER-CATEGORY-FIX: Hook for fetching profiles by category from backend
 *
 * Uses the new single-category assignment system to fetch profiles
 * assigned to a specific category. This ensures mutual exclusivity -
 * each profile only appears in one category.
 *
 * Features:
 * - Uses `getExploreCategoryProfiles` query with category-based filtering
 * - Applies 7-day cooldown (profiles shown recently are hidden)
 * - Tracks when profiles are shown via mutation (optional)
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';

const EMPTY_PROFILES: any[] = [];

type UseExploreCategoryProfilesOptions = {
  categoryId: string;
  trackShown?: boolean; // Whether to call markAsShown when profiles are loaded
  limit?: number;
  offset?: number;
  refreshKey?: number; // Increment to force refetch
};

type UseExploreCategoryProfilesResult = {
  profiles: any[];
  totalCount: number;
  isLoading: boolean;
  isUsingBackend: boolean; // True if using new category system
};

/**
 * Fetch profiles for a specific Explore category
 *
 * In demo mode or if backend query fails, falls back to client-side filtering.
 * When `trackShown` is true, marks profiles as shown for cooldown tracking.
 */
export function useExploreCategoryProfiles({
  categoryId,
  trackShown = false,
  limit = 20,
  offset = 0,
  refreshKey = 0,
}: UseExploreCategoryProfilesOptions): UseExploreCategoryProfilesResult {
  const userId = useAuthStore((s) => s.userId);
  const shownIdsRef = useRef<Set<string>>(new Set());

  // Reset shown IDs when refreshKey changes (enables manual refresh)
  useEffect(() => {
    if (refreshKey > 0) {
      shownIdsRef.current = new Set();
    }
  }, [refreshKey]);

  // Backend mutation for shown tracking
  const batchMarkAsShown = useMutation(api.discover.batchMarkProfilesAsShown);

  // Skip backend query in demo mode or when user is not logged in
  const shouldSkip = isDemoMode || !userId;


  // Backend query using single-category system
  const backendResult = useQuery(
    api.discover.getExploreCategoryProfiles,
    shouldSkip ? 'skip' : {
      viewerId: userId,
      categoryId,
      limit,
      offset,
    }
  );

  // Fallback: client-side filtering using predicate
  const allProfiles = useExploreProfiles();
  const category = EXPLORE_CATEGORIES.find((c) => c.id === categoryId);

  // Determine which profiles to use
  const isUsingBackend = !shouldSkip && backendResult !== undefined;
  const profiles = isUsingBackend
    ? (backendResult?.profiles ?? EMPTY_PROFILES)
    : allProfiles.filter(category?.predicate ?? (() => false));

  const totalCount = isUsingBackend
    ? (backendResult?.totalCount ?? 0)
    : profiles.length;

  // Track shown profiles (mark as shown in backend)
  // WARNING: This causes instant cooldown bug if enabled!
  // Profiles get marked on load, then subsequent queries exclude them immediately.
  // Leave trackShown=false. Swipe exclusion via likes table is the correct mechanism.
  useEffect(() => {
    if (!trackShown || !isUsingBackend || profiles.length === 0) return;

    // Find profiles that haven't been marked yet
    const newIds = profiles
      .map((p: any) => p.id)
      .filter((id: string) => !shownIdsRef.current.has(id));

    if (newIds.length === 0) return;

    // Mark them as shown
    newIds.forEach((id: string) => shownIdsRef.current.add(id));

    // Fire and forget - don't block rendering
    batchMarkAsShown({ userIds: newIds }).catch((err) => {
      console.warn('[useExploreCategoryProfiles] Failed to mark as shown:', err);
    });
  }, [profiles, trackShown, isUsingBackend, batchMarkAsShown]);

  return {
    profiles,
    totalCount,
    isLoading: !shouldSkip && backendResult === undefined,
    isUsingBackend,
  };
}
