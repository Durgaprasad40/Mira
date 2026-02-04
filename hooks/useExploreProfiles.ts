import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';

const EMPTY_PROFILES: any[] = [];

/**
 * Single source of truth for explore profiles.
 * Returns the same stable array whether in demo or live mode.
 * Both the Explore tab and the category detail screen import this.
 */
export function useExploreProfiles(): any[] {
  const userId = useAuthStore((s) => s.userId);
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);

  const queryArgs = useMemo(() => {
    if (isDemoMode || !userId) return 'skip' as const;
    return { userId: userId as any };
  }, [userId]);

  const result = useQuery(api.discover.getExploreProfiles, queryArgs);

  return useMemo(() => {
    if (isDemoMode) {
      return (DEMO_PROFILES as any[]).filter(
        (p) => !blockedUserIds.includes(p._id),
      );
    }
    // getExploreProfiles returns { profiles: [], totalCount }
    if (result && Array.isArray(result.profiles)) return result.profiles;
    return EMPTY_PROFILES;
  }, [result, blockedUserIds]);
}
