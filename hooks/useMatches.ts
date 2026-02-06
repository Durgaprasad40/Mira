import { useMemo } from "react";
import { useDemoStore } from "@/stores/demoStore";

/**
 * Hook to get list of matched user IDs.
 */
export function useMatches(): string[] {
  const matches = useDemoStore((s) => s.matches);

  return useMemo(() => {
    return matches.map((m) => m.otherUser.id);
  }, [matches]);
}
