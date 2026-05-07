import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { useConvex } from 'convex/react';
import { api } from '@/convex/_generated/api';

type TodMediaKind = 'photo' | 'video' | 'voice';
type TodMediaPreloadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type TodMediaPreloadAnswer = {
  _id: string;
  type: string;
  hasMedia?: boolean;
  mediaUrl?: string;
  mediaStorageId?: string;
  durationSec?: number;
  editedAt?: number;
  createdAt?: number;
  isFrontCamera?: boolean;
};

export type TodMediaPreloadState = {
  status: TodMediaPreloadStatus;
  url?: string;
  kind?: TodMediaKind;
  mediaStorageId?: string;
  durationSec?: number;
  isFrontCamera?: boolean;
  error?: string;
};

type CacheEntry = TodMediaPreloadState & {
  key: string;
  answerId: string;
  touchedAt: number;
};

type UseTodMediaPreloadArgs = {
  answers: TodMediaPreloadAnswer[];
  authUserId?: string | null;
  viewableAnswerIds?: Set<string>;
  enabled?: boolean;
  lookaheadCount?: number;
};

const MAX_CACHE_ENTRIES = 50;
const MAX_CONCURRENT_PRELOADS = 3;
const PRELOAD_TIMEOUT_MS = 12_000;

const preloadCache = new Map<string, CacheEntry>();

function isMediaKind(type: string): type is TodMediaKind {
  return type === 'photo' || type === 'video' || type === 'voice';
}

function getAnswerId(answer: TodMediaPreloadAnswer): string {
  return String(answer._id);
}

function getCacheKey(answer: TodMediaPreloadAnswer): string {
  const answerId = getAnswerId(answer);
  const mediaVersion =
    answer.mediaStorageId ??
    answer.editedAt ??
    answer.createdAt ??
    answer.mediaUrl ??
    'unknown';
  return `${answerId}:${mediaVersion}`;
}

function touchCacheEntry(key: string, entry: TodMediaPreloadState, answerId: string) {
  preloadCache.set(key, {
    key,
    answerId,
    ...entry,
    touchedAt: Date.now(),
  });

  if (preloadCache.size <= MAX_CACHE_ENTRIES) return;

  const entries = Array.from(preloadCache.entries()).sort(
    (a, b) => a[1].touchedAt - b[1].touchedAt,
  );
  const overflow = entries.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    preloadCache.delete(entries[i][0]);
  }
}

function getCachedState(answer: TodMediaPreloadAnswer): TodMediaPreloadState {
  const key = getCacheKey(answer);
  const cached = preloadCache.get(key);
  if (!cached) return { status: 'idle' };
  cached.touchedAt = Date.now();
  return cached;
}

async function warmUrl(kind: TodMediaKind, url: string): Promise<void> {
  if (kind === 'photo') {
    await Image.prefetch(url);
  }
  // Video and voice preloading intentionally stops at signed-URL resolution.
  // Full media download here would be expensive and could look like autoplay.
}

export function useTodMediaPreload({
  answers,
  authUserId,
  viewableAnswerIds,
  enabled = true,
  lookaheadCount = 5,
}: UseTodMediaPreloadArgs) {
  const convex = useConvex();
  const [revision, setRevision] = useState(0);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(new Set<string>());
  const timeoutRefs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const mediaAnswers = useMemo(
    () => answers.filter((answer) => isMediaKind(answer.type) && (answer.hasMedia || answer.mediaUrl)),
    [answers],
  );

  const targetAnswers = useMemo(() => {
    if (mediaAnswers.length === 0) return [];

    const targetIds = new Set<string>();
    const visibleIds = viewableAnswerIds && viewableAnswerIds.size > 0
      ? viewableAnswerIds
      : new Set([getAnswerId(mediaAnswers[0])]);

    for (const visibleId of visibleIds) {
      const startIndex = mediaAnswers.findIndex((answer) => getAnswerId(answer) === visibleId);
      if (startIndex < 0) continue;

      for (
        let index = startIndex;
        index < mediaAnswers.length && index <= startIndex + lookaheadCount;
        index += 1
      ) {
        targetIds.add(getAnswerId(mediaAnswers[index]));
      }
    }

    if (targetIds.size === 0) {
      mediaAnswers.slice(0, lookaheadCount).forEach((answer) => targetIds.add(getAnswerId(answer)));
    }

    return mediaAnswers.filter((answer) => targetIds.has(getAnswerId(answer)));
  }, [lookaheadCount, mediaAnswers, viewableAnswerIds]);

  const notify = useCallback(() => {
    if (cancelledRef.current) return;
    setRevision((value) => value + 1);
  }, []);

  const clearPreloadTimeout = useCallback((key: string) => {
    const timeout = timeoutRefs.current.get(key);
    if (timeout) {
      clearTimeout(timeout);
      timeoutRefs.current.delete(key);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !authUserId || targetAnswers.length === 0) return undefined;

    let cancelled = false;
    let cursor = 0;

    const preloadOne = async (answer: TodMediaPreloadAnswer) => {
      const answerId = getAnswerId(answer);
      const key = getCacheKey(answer);
      const current = preloadCache.get(key);
      if (current?.status === 'ready' || current?.status === 'loading') {
        if (__DEV__ && current.status === 'ready') {
          console.log('[TOD_MEDIA_PRELOAD] cache_hit', { answerId, kind: current.kind });
        }
        return;
      }
      if (inFlightRef.current.has(key)) return;
      if (!isMediaKind(answer.type)) return;
      const answerKind = answer.type;

      inFlightRef.current.add(key);
      touchCacheEntry(key, { status: 'loading', kind: answerKind }, answerId);
      notify();
      clearPreloadTimeout(key);
      timeoutRefs.current.set(
        key,
        setTimeout(() => {
          const current = preloadCache.get(key);
          if (cancelled || cancelledRef.current || current?.status !== 'loading') {
            timeoutRefs.current.delete(key);
            return;
          }
          inFlightRef.current.delete(key);
          timeoutRefs.current.delete(key);
          touchCacheEntry(key, { status: 'error', kind: answerKind, error: 'timeout' }, answerId);
          if (__DEV__) {
            console.log('[TOD_MEDIA_PRELOAD] failed', { answerId, kind: answerKind, reason: 'timeout' });
          }
          notify();
        }, PRELOAD_TIMEOUT_MS),
      );

      if (__DEV__) {
        console.log('[TOD_MEDIA_PRELOAD] queued', { answerId, kind: answerKind });
      }

      try {
        let preloadResult:
          | {
              url: string;
              kind: TodMediaKind;
              mediaStorageId?: string;
              durationSec?: number;
              isFrontCamera?: boolean;
            }
          | null = null;

        if (answer.mediaUrl) {
          preloadResult = {
            url: answer.mediaUrl,
            kind: answer.type,
            mediaStorageId: answer.mediaStorageId,
            durationSec: answer.durationSec,
            isFrontCamera: answer.isFrontCamera,
          };
        } else {
          preloadResult = await convex.query(api.truthDare.preloadAnswerMediaUrl, {
            answerId,
            authUserId,
          });
        }

        // RECEIVER-SIDE SPINNER FIX: do NOT bail here on `cancelled` /
        // `cancelledRef.current`. Earlier we returned early when the effect
        // had been cancelled mid-flight (e.g. `viewableAnswerIds` changed
        // while `convex.query` was awaiting). That left the cache stuck on
        // `status: 'loading'` from the earlier `touchCacheEntry` call. The
        // next effect run then short-circuits on line 183 (`current.status
        // === 'loading'`), so the cache never advances to `ready`/`error`
        // and the tile spinner never stops. Always commit the resolved
        // state to the module-scoped cache; `notify()` is internally gated
        // by `cancelledRef.current` so it's safe after unmount.
        if (!preloadResult?.url || !isMediaKind(preloadResult.kind)) {
          clearPreloadTimeout(key);
          touchCacheEntry(key, { status: 'error', kind: answerKind, error: 'unavailable' }, answerId);
          if (__DEV__) {
            console.log('[TOD_MEDIA_PRELOAD] failed', { answerId, kind: answerKind, reason: 'unavailable' });
          }
          notify();
          return;
        }

        await warmUrl(preloadResult.kind, preloadResult.url);

        clearPreloadTimeout(key);
        touchCacheEntry(
          key,
          {
            status: 'ready',
            url: preloadResult.url,
            kind: preloadResult.kind,
            mediaStorageId: preloadResult.mediaStorageId,
            durationSec: preloadResult.durationSec,
            isFrontCamera: preloadResult.isFrontCamera,
          },
          answerId,
        );

        if (__DEV__) {
          console.log('[TOD_MEDIA_PRELOAD] success', { answerId, kind: preloadResult.kind });
        }
        notify();
      } catch (error) {
        // Same rationale as the success branch above: always commit a
        // terminal state so the cache leaves `loading` and the tile can
        // re-render. `notify()` is gated for unmounted components.
        clearPreloadTimeout(key);
        const message = error instanceof Error ? error.message : 'preload_failed';
        touchCacheEntry(key, { status: 'error', kind: answerKind, error: message }, answerId);
        if (__DEV__) {
          console.log('[TOD_MEDIA_PRELOAD] failed', { answerId, kind: answerKind, reason: message });
        }
        notify();
      } finally {
        inFlightRef.current.delete(key);
        clearPreloadTimeout(key);
      }
    };

    const runWorker = async () => {
      while (!cancelled && cursor < targetAnswers.length) {
        const answer = targetAnswers[cursor];
        cursor += 1;
        await preloadOne(answer);
      }
    };

    const workerCount = Math.min(MAX_CONCURRENT_PRELOADS, targetAnswers.length);
    for (let i = 0; i < workerCount; i += 1) {
      void runWorker();
    }

    return () => {
      cancelled = true;
      targetAnswers.forEach((answer) => clearPreloadTimeout(getCacheKey(answer)));
    };
  }, [authUserId, clearPreloadTimeout, convex, enabled, notify, targetAnswers]);

  const getPreloadState = useCallback((answer: TodMediaPreloadAnswer): TodMediaPreloadState => {
    return getCachedState(answer);
  }, []);

  return {
    getPreloadState,
    revision,
  };
}
