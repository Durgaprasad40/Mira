import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useBlockStore } from '@/stores/blockStore';
import { useShallow } from 'zustand/react/shallow';
import type { ExploreProfileLike } from '@/components/explore/exploreCategories';

type ExploreProfile = ExploreProfileLike & {
  _id?: string;
  id?: string;
};

const EMPTY_PROFILES: ExploreProfile[] = [];

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
export function useExploreProfiles(options: { enabled?: boolean } = {}): ExploreProfile[] {
  const { enabled = true } = options;
  // Demo Vibes data is development-only. Production must never render demo
  // profiles even if a demo env flag is accidentally present.
  const canUseDemoMode = __DEV__ && isDemoMode;
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const demo = useDemoStore(useShallow((s) => ({
    matchCount: s.matches.length,
    likesCount: s.likes.length,
    profiles: s.profiles,
    getExcludedUserIds: s.getExcludedUserIds,
  })));
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);

  // Derive excluded IDs as Set for O(1) lookup
  // Depends on matches, likes, and blocked users to stay fresh
  const excludedSet = useMemo(() => {
    if (!canUseDemoMode) return new Set(blockedUserIds);
    return new Set(demo.getExcludedUserIds());
  }, [blockedUserIds, canUseDemoMode, demo.matchCount, demo.likesCount, demo.getExcludedUserIds]);

  const queryArgs = useMemo(() => {
    const sessionToken = typeof token === 'string' ? token.trim() : '';
    if (!enabled || canUseDemoMode || !userId || sessionToken.length === 0) return 'skip' as const;
    return { token: sessionToken };
  }, [canUseDemoMode, enabled, userId, token]);

  const result = useQuery(api.discover.getExploreCategoryProfiles, queryArgs);

  return useMemo(() => {
    // P0-004 FIX: Demo mode only available in __DEV__ builds
    if (canUseDemoMode) {
      // Use demoStore.profiles if available (mutable), else fallback to static DEMO_PROFILES
      const sourceProfiles = demo.profiles.length > 0 ? demo.profiles : DEMO_PROFILES;
      return (sourceProfiles as ExploreProfile[]).filter(
        (p) => !p._id || !excludedSet.has(p._id),
      );
    }
    // getExploreCategoryProfiles returns { profiles: [], totalCount }
    if (result && Array.isArray(result.profiles)) return result.profiles;
    return EMPTY_PROFILES;
  }, [canUseDemoMode, result, excludedSet, demo.profiles]);
}
