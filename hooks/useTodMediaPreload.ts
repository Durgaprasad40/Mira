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
  const [, setRevision] = useState(0);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(new Set<string>());

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

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
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

      inFlightRef.current.add(key);
      touchCacheEntry(key, { status: 'loading', kind: answer.type }, answerId);
      notify();

      if (__DEV__) {
        console.log('[TOD_MEDIA_PRELOAD] queued', { answerId, kind: answer.type });
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

        if (cancelled || cancelledRef.current) return;

        if (!preloadResult?.url || !isMediaKind(preloadResult.kind)) {
          touchCacheEntry(key, { status: 'error', kind: answer.type, error: 'unavailable' }, answerId);
          if (__DEV__) {
            console.log('[TOD_MEDIA_PRELOAD] failed', { answerId, kind: answer.type, reason: 'unavailable' });
          }
          notify();
          return;
        }

        await warmUrl(preloadResult.kind, preloadResult.url);
        if (cancelled || cancelledRef.current) return;

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
        if (cancelled || cancelledRef.current) return;
        const message = error instanceof Error ? error.message : 'preload_failed';
        touchCacheEntry(key, { status: 'error', kind: answer.type, error: message }, answerId);
        if (__DEV__) {
          console.log('[TOD_MEDIA_PRELOAD] failed', { answerId, kind: answer.type, reason: message });
        }
        notify();
      } finally {
        inFlightRef.current.delete(key);
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
    };
  }, [authUserId, convex, enabled, notify, targetAnswers]);

  const getPreloadState = useCallback((answer: TodMediaPreloadAnswer): TodMediaPreloadState => {
    return getCachedState(answer);
  }, []);

  return {
    getPreloadState,
  };
}
