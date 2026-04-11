import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useBlockStore } from '@/stores/blockStore';
import { useShallow } from 'zustand/react/shallow';
import { EXPLORE_CATEGORIES, countProfilesPerCategory } from '@/components/explore/exploreCategories';

export type ExploreCategoryCountsState = {
  counts: Record<string, number>;
  totalEligibleCount: number;
  isLoading: boolean;
  isReady: boolean;
  isEmpty: boolean;
};

export function useExploreCategoryCounts(
  refreshKey = 0,
): ExploreCategoryCountsState {
  const userId = useAuthStore((s) => s.userId);
  const demo = useDemoStore(useShallow((s) => ({
    matchCount: s.matches.length,
    likesCount: s.likes.length,
    profiles: s.profiles,
    getExcludedUserIds: s.getExcludedUserIds,
  })));
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);

  const excludedSet = useMemo(() => {
    if (!isDemoMode) return new Set(blockedUserIds);
    return new Set(demo.getExcludedUserIds());
  }, [blockedUserIds, demo.matchCount, demo.likesCount, demo.getExcludedUserIds]);

  const queryArgs = useMemo(() => {
    if (isDemoMode || !userId) return 'skip' as const;
    return {
      authUserId: userId,
      refreshKey,
    };
  }, [userId, refreshKey]);

  const result = useQuery(api.discover.getExploreCategoryCounts, queryArgs);

  return useMemo(() => {
    if (isDemoMode) {
      const sourceProfiles = demo.profiles.length > 0 ? demo.profiles : DEMO_PROFILES;
      const filteredProfiles = (sourceProfiles as any[]).filter(
        (profile) => !excludedSet.has(profile._id),
      );

      const counts = Object.fromEntries(
        EXPLORE_CATEGORIES.map((category) => [
          category.id,
          countProfilesPerCategory(category, filteredProfiles),
        ]),
      );

      return {
        counts,
        totalEligibleCount: filteredProfiles.length,
        isLoading: false,
        isReady: true,
        isEmpty: filteredProfiles.length === 0,
      };
    }

    if (!userId) {
      return {
        counts: {},
        totalEligibleCount: 0,
        isLoading: false,
        isReady: true,
        isEmpty: true,
      };
    }

    const isLoading = result === undefined;
    const counts = result?.counts ?? {};
    const totalEligibleCount = result?.totalEligibleCount ?? 0;

    return {
      counts,
      totalEligibleCount,
      isLoading,
      isReady: !isLoading,
      isEmpty: !isLoading && totalEligibleCount === 0,
    };
  }, [result, excludedSet, demo.profiles, userId]);
}
