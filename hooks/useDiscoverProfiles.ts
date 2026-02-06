import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useShallow } from "zustand/react/shallow";

const EMPTY_PROFILES: any[] = [];

/**
 * Hook to get discover profiles.
 * Works in both demo mode (uses demoStore) and live mode (queries Convex).
 * Returns profiles excluding blocked users, matched users, and conversation partners.
 */
export function useDiscoverProfiles(): any[] {
  const userId = useAuthStore((s) => s.userId);

  const demo = useDemoStore(
    useShallow((s) => ({
      profiles: s.profiles,
      blockedUserIds: s.blockedUserIds,
      matchCount: s.matches.length,
      getExcludedUserIds: s.getExcludedUserIds,
    }))
  );

  // Derive excluded IDs as Set for O(1) lookup
  const excludedSet = useMemo(() => {
    if (!isDemoMode) return new Set(demo.blockedUserIds);
    return new Set(demo.getExcludedUserIds());
  }, [demo.blockedUserIds, demo.matchCount, demo.getExcludedUserIds]);

  // Query args for Convex (skip in demo mode)
  const queryArgs = useMemo(() => {
    if (isDemoMode || !userId) return "skip" as const;
    return { userId: userId as any };
  }, [userId]);

  const result = useQuery(api.discover.getDiscoverProfiles, queryArgs);

  return useMemo(() => {
    // Demo mode: filter from demoStore profiles
    if (isDemoMode) {
      return demo.profiles.filter((p) => !excludedSet.has(p._id));
    }

    // Live mode: use Convex query result (returns array directly)
    if (result && Array.isArray(result)) {
      return result;
    }

    return EMPTY_PROFILES;
  }, [demo.profiles, result, excludedSet]);
}
