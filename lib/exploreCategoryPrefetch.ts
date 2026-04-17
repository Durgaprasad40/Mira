import { convex, isDemoMode } from '@/hooks/useConvex';
import { api } from '@/convex/_generated/api';

export const EXPLORE_CATEGORY_PAGE_SIZE = 50;

export type ExploreCategoryProfilesQueryResult = {
  profiles?: any[];
  totalCount?: number;
  status?: string | null;
};

export type ExploreCategoryPrefetchKey = {
  userId: string;
  token: string;
  authVersion: number;
  categoryId: string;
  limit: number;
  offset: number;
  refreshKey: number;
};

export interface ExploreCategoryPrefetchSnapshot extends ExploreCategoryPrefetchKey {
  promise: Promise<ExploreCategoryProfilesQueryResult> | null;
  result: ExploreCategoryProfilesQueryResult | null;
  startedAt: number;
}

const PREFETCH_MAX_AGE_MS = 30 * 1000;

let prefetchState: ExploreCategoryPrefetchSnapshot | null = null;
let prefetchUsed = false;

function isSamePrefetchKey(
  state: ExploreCategoryPrefetchSnapshot,
  key: ExploreCategoryPrefetchKey,
): boolean {
  return (
    state.userId === key.userId &&
    state.token === key.token &&
    state.authVersion === key.authVersion &&
    state.categoryId === key.categoryId &&
    state.limit === key.limit &&
    state.offset === key.offset &&
    state.refreshKey === key.refreshKey
  );
}

export function startExploreCategoryPrefetch(key: ExploreCategoryPrefetchKey): void {
  if (__DEV__ && isDemoMode) return;

  const trimmedToken = key.token.trim();
  if (!key.userId || !trimmedToken || !key.categoryId) return;

  const normalizedKey = {
    ...key,
    token: trimmedToken,
  };

  if (prefetchState && !isSamePrefetchKey(prefetchState, normalizedKey)) {
    prefetchState = null;
    prefetchUsed = false;
  }

  if (prefetchState && isSamePrefetchKey(prefetchState, normalizedKey)) {
    return;
  }

  const promise = convex.query(api.discover.getExploreCategoryProfiles, {
    token: trimmedToken,
    categoryId: key.categoryId,
    limit: key.limit,
    offset: key.offset,
    refreshKey: key.refreshKey,
  });

  prefetchState = {
    ...normalizedKey,
    promise,
    result: null,
    startedAt: Date.now(),
  };

  promise
    .then((result) => {
      if (prefetchState && isSamePrefetchKey(prefetchState, normalizedKey)) {
        prefetchState.result = result;
      }
    })
    .catch((error) => {
      console.warn('[PREFETCH] Explore category prefetch failed:', error);
      if (prefetchState && isSamePrefetchKey(prefetchState, normalizedKey)) {
        prefetchState = null;
      }
    });
}

export function getExploreCategoryPrefetchSnapshot(
  key: ExploreCategoryPrefetchKey,
): ExploreCategoryPrefetchSnapshot | null {
  if (!prefetchState) return null;
  if (!isSamePrefetchKey(prefetchState, key)) return null;

  if (Date.now() - prefetchState.startedAt > PREFETCH_MAX_AGE_MS) {
    prefetchState = null;
    prefetchUsed = false;
    return null;
  }

  return {
    ...prefetchState,
  };
}

export function markExploreCategoryPrefetchUsed(): void {
  prefetchUsed = true;
}

export function clearUsedExploreCategoryPrefetch(): void {
  if (prefetchUsed && prefetchState) {
    prefetchState = null;
    prefetchUsed = false;
  }
}
