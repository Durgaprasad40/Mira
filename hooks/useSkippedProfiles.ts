import { useMemo } from "react";
import { useDemoStore } from "@/stores/demoStore";
import { useDemoDmStore } from "@/stores/demoDmStore";

/**
 * Hook to get list of skipped/swiped profile IDs.
 * In demo mode, this includes conversation partners (people you've messaged).
 */
export function useSkippedProfiles(): string[] {
  const matches = useDemoStore((s) => s.matches);
  const dmMeta = useDemoDmStore((s) => s.meta);

  return useMemo(() => {
    const skipped = new Set<string>();

    // Add all matched user IDs
    for (const m of matches) {
      skipped.add(m.otherUser.id);
    }

    // Add all conversation partner IDs
    for (const key of Object.keys(dmMeta)) {
      const partnerId = dmMeta[key]?.otherUser?.id;
      if (partnerId) skipped.add(partnerId);
    }

    return Array.from(skipped);
  }, [matches, dmMeta]);
}
