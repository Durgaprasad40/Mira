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
  TruthDarePendingUpload,
  TruthDareUploadMediaKind,
  useTruthDareUploadStore,
} from '@/stores/truthDareUploadStore';

const MAX_PARALLEL_UPLOADS = 2;
const PROGRESS_THROTTLE_MS = 50;
const TOD_UPLOAD_FALLBACK_ERROR = 'Upload failed. Please try again.';

function uploadKindFor(kind?: TruthDareUploadMediaKind): 'photo' | 'video' | 'audio' {
  if (kind === 'video') return 'video';
  if (kind === 'voice' || kind === 'audio') return 'audio';
  return 'photo';
}

function limitKindFor(kind?: TruthDareUploadMediaKind): TodMediaLimitKind {
  if (kind === 'video') return 'video';
  if (kind === 'voice' || kind === 'audio') return 'voice';
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
    'Prompt has expired',
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
    lower.includes('prompt has expired') ||
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
    code: lower.includes('expired') ? 'PROMPT_EXPIRED' : undefined,
    retryable: nonRetryable
      ? false
      : lower.includes('network') ||
        lower.includes('timeout') ||
        lower.includes('temporarily') ||
        lower.includes('try again'),
  };
}

export function TruthDareUploadManager() {
  const items = useTruthDareUploadStore((state) => state.items);
  const markUploading = useTruthDareUploadStore((state) => state.markUploading);
  const updateProgress = useTruthDareUploadStore((state) => state.updateProgress);
  const markSubmitting = useTruthDareUploadStore((state) => state.markSubmitting);
  const markSuccess = useTruthDareUploadStore((state) => state.markSuccess);
  const markFailed = useTruthDareUploadStore((state) => state.markFailed);
  const clearForUserSwitch = useTruthDareUploadStore((state) => state.clearForUserSwitch);
  const currentUserId = useAuthStore((state) => state.userId);

  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);
  const createOrEditAnswer = useMutation(api.truthDare.createOrEditAnswer);
  const trackPendingTodUploads = useMutation(api.truthDare.trackPendingTodUploads);
  const releasePendingTodUploads = useMutation(api.truthDare.releasePendingTodUploads);
  const cleanupPendingTodUploads = useMutation(api.truthDare.cleanupPendingTodUploads);

  const runningRef = useRef<Set<string>>(new Set());
  const lastUserIdRef = useRef<string | null | undefined>(currentUserId);

  const processItem = useCallback(async (item: TruthDarePendingUpload) => {
    const trackedStorageIds: string[] = [];
    let mediaStorageId = item.storageId;
    let authorPhotoStorageId = item.authorPhotoStorageId;
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
      const token = ensureCurrentUser();
      await trackPendingTodUploads({
        token,
        storageIds: [storageId as Id<'_storage'>],
        authUserId: item.userId,
      });
      trackedStorageIds.push(storageId);
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

      if (item.attachment?.localUri && !mediaStorageId) {
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
          getTodUploadOptions(
            limitKind,
            item.attachment.localUri,
            item.mediaMime ?? item.attachment.mime
          )
        );
        await trackStorageId(mediaStorageId);
      }

      if (item.authorPhotoLocalUri && !authorPhotoStorageId) {
        ensureCurrentUser();
        authorPhotoStorageId = await uploadMediaToConvexWithProgress(
          item.authorPhotoLocalUri,
          () => generateUploadUrl({ token: ensureCurrentUser(), authUserId: item.userId }),
          'photo',
          undefined,
          getTodUploadOptions('photo', item.authorPhotoLocalUri, 'image/jpeg')
        );
        await trackStorageId(authorPhotoStorageId);
      }

      markSubmitting(item.clientId, {
        storageId: mediaStorageId,
        authorPhotoStorageId,
      });

      ensureCurrentUser();
      const durationSecSent = item.durationSec ?? item.attachment?.durationSec;
      const result = await createOrEditAnswer({
        token: ensureCurrentUser(),
        promptId: item.promptId,
        userId: item.userId,
        text: item.text?.trim() || undefined,
        mediaStorageId: mediaStorageId as Id<'_storage'> | undefined,
        mediaMime: item.mediaMime,
        durationSec: durationSecSent,
        removeMedia: item.removeMedia,
        identityMode: item.identityMode,
        isAnonymous: item.isAnonymous,
        visibility: item.visibility,
        viewMode: item.attachment ? 'tap' : undefined,
        authorName: item.isAnonymous ? undefined : item.authorName,
        authorPhotoUrl: item.isAnonymous ? undefined : item.authorPhotoUrl,
        authorPhotoStorageId: item.isAnonymous ? undefined : (authorPhotoStorageId as Id<'_storage'> | undefined),
        authorAge: item.isAnonymous ? undefined : item.authorAge,
        authorGender: item.isAnonymous ? undefined : item.authorGender,
        photoBlurMode: item.photoBlurMode,
        isFrontCamera: item.isFrontCamera,
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

      markSuccess(item.clientId, result?.answerId as string | undefined);
    } catch (error) {
      await cleanupTrackedUploads();
      markFailed(item.clientId, sanitizeError(error));
    }
  }, [
    cleanupPendingTodUploads,
    createOrEditAnswer,
    generateUploadUrl,
    markFailed,
    markSubmitting,
    markSuccess,
    markUploading,
    releasePendingTodUploads,
    trackPendingTodUploads,
    updateProgress,
  ]);

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
