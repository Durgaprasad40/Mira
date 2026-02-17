import { useBlockStore } from "@/stores/blockStore";

/**
 * Hook to get list of blocked user IDs (shared across Phase-1 and Phase-2).
 */
export function useBlockedUsers(): string[] {
  return useBlockStore((s) => s.blockedUserIds);
}
