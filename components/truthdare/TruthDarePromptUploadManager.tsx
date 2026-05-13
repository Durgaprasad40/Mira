import { useCallback, useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { uploadMediaToConvexWithProgress, UploadError } from '@/lib/uploadUtils';
import {
  TOD_MEDIA_LIMITS,
  type TodMediaLimitKind,
  formatTodMediaLimit,
  resolveTodMime,
} from '@/lib/todMediaLimits';
import { useAuthStore } from '@/stores/authStore';
import {
  TruthDarePendingPromptUpload,
  TruthDarePromptUploadKind,
  useTruthDarePromptUploadStore,
} from '@/stores/truthDarePromptUploadStore';

/*
 * TruthDarePromptUploadManager
 *
 * Mirror of TruthDareUploadManager but for the prompt (post) creation queue.
 * Watches `useTruthDarePromptUploadStore` and, for each `queued` item:
 *   1. Tracks the pending storage upload (so backend knows it's not orphaned).
 *   2. Uploads the prompt media (photo/video) with byte-progress callback,
 *      throttled to ~50ms.
 *   3. Optionally uploads the owner avatar (only if a local file:// URI was
 *      provided by the composer; remote https URLs go straight to createPrompt).
 *   4. Calls `truthDare.createPrompt` with the resolved storage IDs.
 *   5. Releases the tracked uploads and marks the item `success` with the
 *      returned `serverPromptId`.
 *
 * Failure handling: on any error we cleanup tracked uploads (so storage isn't
 * leaked) and mark the item `failed` with a sanitized error. The user gets
 * Retry / Remove on the pending card.
 *
 * User switch: clears items belonging to other users (mirrors the answer
 * manager's behavior to avoid cross-user posts being submitted).
 */

const MAX_PARALLEL_UPLOADS = 2;
const PROGRESS_THROTTLE_MS = 50;
const TOD_UPLOAD_FALLBACK_ERROR = 'Upload failed. Please try again.';

function uploadKindFor(kind: TruthDarePromptUploadKind): 'photo' | 'video' | 'audio' {
  if (kind === 'video') return 'video';
  if (kind === 'voice') return 'audio';
  return 'photo';
}

function limitKindFor(kind: TruthDarePromptUploadKind): TodMediaLimitKind {
  if (kind === 'video') return 'video';
  if (kind === 'voice') return 'voice';
  return 'photo';
}

function getTodUploadOptions(
  kind: TodMediaLimitKind,
  localUri: string,
  mime?: string
) {
  const contentType = resolveTodMime(kind, localUri, mime);
  if (!contentType) {
    throw new Error('Unsupported media format.');
  }
  return {
    contentType,
    maxBytes: TOD_MEDIA_LIMITS[kind].maxBytes,
    limitMessage: formatTodMediaLimit(kind),
  };
}

function extractCleanTodUploadErrorMessage(error: unknown): string {
  const directDataMessage =
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof (error as { data?: { message?: unknown } }).data?.message === 'string'
      ? (error as { data: { message: string } }).data.message
      : undefined;
  const rawMessage =
    directDataMessage ??
    (error instanceof Error ? error.message : typeof error === 'string' ? error : '');

  const knownMessages = [
    formatTodMediaLimit('photo'),
    formatTodMediaLimit('video'),
    formatTodMediaLimit('voice'),
    'Unsupported media format.',
  ];
  for (const message of knownMessages) {
    if (rawMessage.includes(message)) return message;
  }

  const uncaughtMatch = rawMessage.match(/Uncaught Error:\s*([^\n]+)/);
  if (uncaughtMatch?.[1]) {
    return uncaughtMatch[1].replace(/\s+at\s+.*$/, '').trim();
  }

  const firstLine = rawMessage.split('\n')[0]?.trim();
  if (firstLine && !firstLine.includes(' at ') && firstLine.length <= 180) {
    return firstLine;
  }

  return TOD_UPLOAD_FALLBACK_ERROR;
}

function isNonRetryableTodUploadError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('must be under') ||
    lower.includes('seconds or less') ||
    lower.includes('unsupported media format') ||
    lower.includes('rate limit exceeded')
  );
}

function sanitizeError(error: unknown): { message: string; code?: string; retryable?: boolean } {
  if (error instanceof UploadError) {
    return {
      message: error.message,
      code: error.type,
      retryable: error.retryable,
    };
  }

  const message = extractCleanTodUploadErrorMessage(error);
  const lower = message.toLowerCase();
  const nonRetryable = isNonRetryableTodUploadError(message);
  return {
    message,
    retryable: nonRetryable
      ? false
      : lower.includes('network') ||
        lower.includes('timeout') ||
        lower.includes('temporarily') ||
        lower.includes('try again') ||
        // Default: treat unknown errors as retryable so the user can recover.
        (!nonRetryable && true),
  };
}

export function TruthDarePromptUploadManager() {
  const items = useTruthDarePromptUploadStore((state) => state.items);
  const markUploading = useTruthDarePromptUploadStore((state) => state.markUploading);
  const updateProgress = useTruthDarePromptUploadStore((state) => state.updateProgress);
  const markSubmitting = useTruthDarePromptUploadStore((state) => state.markSubmitting);
  const markSuccess = useTruthDarePromptUploadStore((state) => state.markSuccess);
  const markFailed = useTruthDarePromptUploadStore((state) => state.markFailed);
  const clearForUserSwitch = useTruthDarePromptUploadStore(
    (state) => state.clearForUserSwitch
  );
  const currentUserId = useAuthStore((state) => state.userId);

  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);
  const createPrompt = useMutation(api.truthDare.createPrompt);
  const trackPendingTodUploads = useMutation(api.truthDare.trackPendingTodUploads);
  const releasePendingTodUploads = useMutation(api.truthDare.releasePendingTodUploads);
  const cleanupPendingTodUploads = useMutation(api.truthDare.cleanupPendingTodUploads);

  const runningRef = useRef<Set<string>>(new Set());
  const lastUserIdRef = useRef<string | null | undefined>(currentUserId);

  const processItem = useCallback(
    async (item: TruthDarePendingPromptUpload) => {
      const trackedStorageIds: string[] = [];
      let mediaStorageId = item.storageId;
      let ownerPhotoStorageId = item.ownerPhotoStorageId;
      let lastProgressAt = 0;

      const ensureCurrentUser = () => {
        const authState = useAuthStore.getState();
        if (authState.userId !== item.userId) {
          throw new Error('Upload cancelled after user switch');
        }
        if (!authState.token) {
          throw new Error('Upload requires an active session');
        }
        return authState.token;
      };

      const trackStorageId = async (storageId: string | undefined) => {
        if (!storageId) return;
        try {
          const token = ensureCurrentUser();
          await trackPendingTodUploads({
            token,
            storageIds: [storageId as Id<'_storage'>],
            authUserId: item.userId,
          });
          trackedStorageIds.push(storageId);
        } catch {
          // Best-effort tracking; upload ownership is revalidated before attach.
        }
      };

      const cleanupTrackedUploads = async () => {
        if (trackedStorageIds.length === 0) return;
        try {
          const token = ensureCurrentUser();
          await cleanupPendingTodUploads({
            token,
            storageIds: trackedStorageIds as Id<'_storage'>[],
            authUserId: item.userId,
          });
        } catch {
          // Best-effort cleanup only; the queue surfaces the upload failure.
        }
      };

      try {
        ensureCurrentUser();
        markUploading(item.clientId);

        // 1. Prompt media upload (always present in this queue — text-only
        //    posts use the existing fast path in the composer).
        if (!mediaStorageId) {
          ensureCurrentUser();
          const mediaType = uploadKindFor(item.attachment.kind);
          const limitKind = limitKindFor(item.attachment.kind);
          mediaStorageId = await uploadMediaToConvexWithProgress(
            item.attachment.localUri,
            () => generateUploadUrl({ token: ensureCurrentUser(), authUserId: item.userId }),
            mediaType,
            (progress) => {
              const now = Date.now();
              if (now - lastProgressAt < PROGRESS_THROTTLE_MS && progress < 100) return;
              lastProgressAt = now;
              updateProgress(item.clientId, progress);
            },
            getTodUploadOptions(limitKind, item.attachment.localUri, item.attachment.mime)
          );
          await trackStorageId(mediaStorageId);
        }

        // 2. Owner photo upload — only when the composer handed us a local
        //    file:// URI. Already-https photos are passed through directly.
        if (item.ownerPhotoLocalUri && !ownerPhotoStorageId) {
          ensureCurrentUser();
          try {
            ownerPhotoStorageId = await uploadMediaToConvexWithProgress(
              item.ownerPhotoLocalUri,
              () => generateUploadUrl({ token: ensureCurrentUser(), authUserId: item.userId }),
              'photo',
              undefined,
              getTodUploadOptions('photo', item.ownerPhotoLocalUri, 'image/jpeg')
            );
            await trackStorageId(ownerPhotoStorageId);
          } catch {
            // Owner-photo upload failure is non-fatal: prompt still posts,
            // just without the avatar (matches existing composer behavior).
            ownerPhotoStorageId = undefined;
          }
        }

        markSubmitting(item.clientId, {
          storageId: mediaStorageId,
          ownerPhotoStorageId,
        });

        ensureCurrentUser();
        const result = await createPrompt({
          token: ensureCurrentUser(),
          type: item.type,
          text: item.text,
          authUserId: item.userId,
          isAnonymous: item.isAnonymous,
          photoBlurMode: item.photoBlurMode,
          ownerName: item.isAnonymous ? undefined : item.ownerName,
          ownerAge: item.isAnonymous ? undefined : item.ownerAge,
          ownerGender: item.isAnonymous ? undefined : item.ownerGender,
          ownerPhotoUrl: item.isAnonymous ? undefined : item.ownerPhotoUrl,
          ownerPhotoStorageId: item.isAnonymous
            ? undefined
            : (ownerPhotoStorageId as Id<'_storage'> | undefined),
          mediaStorageId: mediaStorageId as Id<'_storage'>,
          mediaMime: item.attachment.mime,
          mediaKind: item.attachment.kind,
          durationSec: item.attachment.durationSec,
          isFrontCamera: item.attachment.isFrontCamera,
        });

        if (trackedStorageIds.length > 0) {
          try {
            const token = ensureCurrentUser();
            await releasePendingTodUploads({
              token,
              storageIds: trackedStorageIds as Id<'_storage'>[],
              authUserId: item.userId,
            });
          } catch {
            // Release is best effort; retry cleanup handles stale pending rows.
          }
        }

        markSuccess(
          item.clientId,
          result?.promptId as string | undefined,
          result?.expiresAt as number | undefined
        );
      } catch (error) {
        await cleanupTrackedUploads();
        markFailed(item.clientId, sanitizeError(error));
      }
    },
    [
      cleanupPendingTodUploads,
      createPrompt,
      generateUploadUrl,
      markFailed,
      markSubmitting,
      markSuccess,
      markUploading,
      releasePendingTodUploads,
      trackPendingTodUploads,
      updateProgress,
    ]
  );

  useEffect(() => {
    if (lastUserIdRef.current === currentUserId) return;
    lastUserIdRef.current = currentUserId;
    clearForUserSwitch(currentUserId);
  }, [clearForUserSwitch, currentUserId]);

  useEffect(() => {
    const availableSlots = Math.max(0, MAX_PARALLEL_UPLOADS - runningRef.current.size);
    if (availableSlots === 0) return;

    const queuedItems = items.filter(
      (item) => item.status === 'queued' && !runningRef.current.has(item.clientId)
    );

    queuedItems.slice(0, availableSlots).forEach((item) => {
      runningRef.current.add(item.clientId);
      processItem(item).finally(() => {
        runningRef.current.delete(item.clientId);
      });
    });
  }, [items, processItem]);

  return null;
}
