/**
 * DISCOVER-CATEGORY-FIX: Hook for fetching category counts from backend
 *
 * Uses the new single-category assignment system to get accurate counts
 * per category. This prevents duplicate profiles appearing in multiple
 * categories.
 *
 * Falls back to null when not available, allowing the UI to use
 * client-side counting as a fallback.
 */
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

/**
 * Fetch category counts from the backend using the single-category system
 *
 * @returns Category counts object or null if not available
 */
export function useExploreCategoryCounts(): Record<string, number> | null {
  const userId = useAuthStore((s) => s.userId);

  // Skip query in demo mode or when user is not logged in
  const shouldSkip = isDemoMode || !userId;

  const result = useQuery(
    api.discover.getExploreCategoryCounts,
    shouldSkip ? 'skip' : { viewerId: userId }
  );

  // Return null if query is loading/skipped, otherwise return counts
  return result ?? null;
}
