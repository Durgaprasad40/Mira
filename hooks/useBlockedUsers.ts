import { useDemoStore } from "@/stores/demoStore";

/**
 * Hook to get list of blocked user IDs.
 */
export function useBlockedUsers(): string[] {
  return useDemoStore((s) => s.blockedUserIds);
}
