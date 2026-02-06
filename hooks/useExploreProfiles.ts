import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useShallow } from 'zustand/react/shallow';

const EMPTY_PROFILES: any[] = [];

/**
 * Single source of truth for explore profiles.
 * Returns the same stable array whether in demo or live mode.
 * Both the Explore tab and the category detail screen import this.
 *
 * The hook re-evaluates whenever:
 * - demoStore profiles change
 * - excluded users change (blocked, matches, swipes)
 * - Convex query returns new data
 */
export function useExploreProfiles(): any[] {
  const userId = useAuthStore((s) => s.userId);
  const demo = useDemoStore(useShallow((s) => ({
    blockedUserIds: s.blockedUserIds,
    matchCount: s.matches.length,
    likesCount: s.likes.length,
    profiles: s.profiles,
    getExcludedUserIds: s.getExcludedUserIds,
  })));

  // Derive excluded IDs as Set for O(1) lookup
  // Depends on matches, likes, and blocked users to stay fresh
  const excludedSet = useMemo(() => {
    if (!isDemoMode) return new Set(demo.blockedUserIds);
    return new Set(demo.getExcludedUserIds());
  }, [demo.blockedUserIds, demo.matchCount, demo.likesCount, demo.getExcludedUserIds]);

  const queryArgs = useMemo(() => {
    if (isDemoMode || !userId) return 'skip' as const;
    return { userId: userId as any };
  }, [userId]);

  const result = useQuery(api.discover.getExploreProfiles, queryArgs);

  return useMemo(() => {
    if (isDemoMode) {
      // Use demoStore.profiles if available (mutable), else fallback to static DEMO_PROFILES
      const sourceProfiles = demo.profiles.length > 0 ? demo.profiles : DEMO_PROFILES;
      return (sourceProfiles as any[]).filter(
        (p) => !excludedSet.has(p._id),
      );
    }
    // getExploreProfiles returns { profiles: [], totalCount }
    if (result && Array.isArray(result.profiles)) return result.profiles;
    return EMPTY_PROFILES;
  }, [result, excludedSet, demo.profiles]);
}
