import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useBlockStore } from "@/stores/blockStore";
import { useShallow } from "zustand/react/shallow";
import { unwrapPhase1DiscoverQueryResult } from "@/lib/phase1DiscoverQuery";

const EMPTY_PROFILES: any[] = [];

/**
 * Hook to get discover profiles.
 * Works in both demo mode (uses demoStore) and live mode (queries Convex).
 * Returns profiles excluding blocked users, matched users, and conversation partners.
 */
export function useDiscoverProfiles(): any[] {
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  const demo = useDemoStore(
    useShallow((s) => ({
      profiles: s.profiles,
      matchCount: s.matches.length,
      getExcludedUserIds: s.getExcludedUserIds,
    }))
  );
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);

  // Derive excluded IDs as Set for O(1) lookup
  const excludedSet = useMemo(() => {
    if (!isDemoMode) return new Set(blockedUserIds);
    return new Set(demo.getExcludedUserIds());
  }, [blockedUserIds, demo.matchCount, demo.getExcludedUserIds]);

  // Query args for Convex (skip in demo mode)
  const queryArgs = useMemo(() => {
    if (isDemoMode || !userId || !token || !String(token).trim()) return "skip" as const;
    return { token: String(token).trim() };
  }, [userId, token]);

  const result = useQuery(api.discover.getDiscoverProfiles, queryArgs);

  return useMemo(() => {
    // P0-004 FIX: Demo mode only available in __DEV__ builds
    if (__DEV__ && isDemoMode) {
      return demo.profiles.filter((p) => !excludedSet.has(p._id));
    }

    // Live mode: Convex returns { profiles, phase1EmptyReason? } or legacy array
    if (result != null) {
      return unwrapPhase1DiscoverQueryResult(result).profiles;
    }

    return EMPTY_PROFILES;
  }, [demo.profiles, result, excludedSet]);
}
