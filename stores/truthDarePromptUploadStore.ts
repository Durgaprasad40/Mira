import { create } from 'zustand';

/*
 * truthDarePromptUploadStore
 *
 * Phase-5 (optimistic prompt posting):
 * In-memory queue for Truth/Dare PROMPT (post) creation with attached photo
 * or video. Mirrors `truthDareUploadStore` (which handles ANSWER uploads)
 * intentionally — same status enum / progress field / retry+remove API — so
 * the feed UI and background manager stay structurally consistent across
 * the answer and prompt surfaces.
 *
 * Why a separate store:
 *  - prompts have no parent `promptId` (the prompt itself doesn't exist yet)
 *  - prompts carry owner-identity fields (name/age/gender/photo) that
 *    answers do not
 *  - createPrompt has a different signature than createOrEditAnswer
 *
 * Persistence: in-memory only (matches the answer queue). If the user kills
 * the app mid-upload, the pending item is lost and the partial Convex
 * storage upload is garbage-collected by `cleanupPendingTodUploads` /
 * `releasePendingTodUploads` semantics handled by the manager. No
 * AsyncStorage / MMKV here in this task.
 */

export type TruthDarePromptUploadStatus =
  | 'queued'
  | 'uploading'
  | 'submitting'
  | 'success'
  | 'failed';
export type TruthDarePromptUploadKind = 'photo' | 'video' | 'voice';
export type TruthDarePromptType = 'truth' | 'dare';
export type TruthDarePromptVisibility = 'anonymous' | 'public' | 'no_photo';
export type TruthDarePromptPhotoBlurMode = 'none' | 'blur';

export type TruthDarePromptUploadError = {
  message: string;
  code?: string;
  retryable?: boolean;
};

export type TruthDarePromptUploadAttachment = {
  kind: TruthDarePromptUploadKind;
  localUri: string;
  mime: string;
  durationMs?: number;
  durationSec?: number;
  isFrontCamera?: boolean;
  fileSize?: number;
};

export type TruthDarePendingPromptUpload = {
  // Local identity
  clientId: string;
  userId: string;
  createdAt: number;
  updatedAt: number;

  // Prompt content
  type: TruthDarePromptType;
  text: string;
  visibility: TruthDarePromptVisibility;
  isAnonymous: boolean;
  photoBlurMode: TruthDarePromptPhotoBlurMode;

  // Owner identity snapshot (only used when visibility !== 'anonymous')
  ownerName?: string;
  ownerAge?: number;
  ownerGender?: string;
  // Owner photo: at most one of these is set at enqueue time.
  // - ownerPhotoUrl: already-https URL, sent directly to createPrompt
  // - ownerPhotoLocalUri: local file://, manager uploads → ownerPhotoStorageId
  ownerPhotoUrl?: string;
  ownerPhotoLocalUri?: string;
  ownerPhotoStorageId?: string;

  // Required attachment (this queue is exclusively for media prompts).
  // Text-only prompts keep the existing fast path in the composer.
  attachment: TruthDarePromptUploadAttachment;

  // Resolved during pipeline
  storageId?: string;
  serverPromptId?: string;
  serverExpiresAt?: number;

  // Lifecycle
  status: TruthDarePromptUploadStatus;
  progress: number;
  error?: TruthDarePromptUploadError;
  attempts: number;
};

export type TruthDarePromptUploadDraft = Omit<
  TruthDarePendingPromptUpload,
  'status' | 'progress' | 'error' | 'attempts' | 'createdAt' | 'updatedAt'
> & {
  status?: TruthDarePromptUploadStatus;
  progress?: number;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number;
};

type TruthDarePromptUploadPatch = Partial<
  Pick<
    TruthDarePendingPromptUpload,
    | 'storageId'
    | 'ownerPhotoStorageId'
    | 'serverPromptId'
    | 'serverExpiresAt'
    | 'progress'
    | 'error'
  >
>;

type TruthDarePromptUploadStore = {
  items: TruthDarePendingPromptUpload[];
  enqueue: (draft: TruthDarePromptUploadDraft) => TruthDarePendingPromptUpload;
  markUploading: (clientId: string) => void;
  updateProgress: (clientId: string, progress: number) => void;
  markSubmitting: (clientId: string, patch?: TruthDarePromptUploadPatch) => void;
  markSuccess: (
    clientId: string,
    serverPromptId?: string,
    serverExpiresAt?: number
  ) => void;
  markFailed: (clientId: string, error: TruthDarePromptUploadError) => void;
  retry: (clientId: string) => void;
  remove: (clientId: string) => void;
  clearForUserSwitch: (userId?: string | null) => void;
  selectByUserId: (userId: string) => TruthDarePendingPromptUpload[];
};

const MAX_QUEUE_ITEMS = 20;
const ACTIVE_STATUSES = new Set<TruthDarePromptUploadStatus>([
  'queued',
  'uploading',
  'submitting',
]);

export function isActiveTruthDarePromptUpload(
  item: Pick<TruthDarePendingPromptUpload, 'status'>
): boolean {
  return ACTIVE_STATUSES.has(item.status);
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function trimQueue(
  items: TruthDarePendingPromptUpload[]
): TruthDarePendingPromptUpload[] {
  if (items.length <= MAX_QUEUE_ITEMS) return items;
  const active = items.filter(isActiveTruthDarePromptUpload);
  const terminal = items
    .filter((item) => !isActiveTruthDarePromptUpload(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const terminalSlots = Math.max(0, MAX_QUEUE_ITEMS - active.length);
  return [...active, ...terminal.slice(0, terminalSlots)].sort(
    (a, b) => a.createdAt - b.createdAt
  );
}

export const useTruthDarePromptUploadStore = create<TruthDarePromptUploadStore>()(
  (set, get) => ({
    items: [],

    enqueue: (draft) => {
      const now = Date.now();
      const item: TruthDarePendingPromptUpload = {
        ...draft,
        status: draft.status ?? 'queued',
        progress: clampProgress(draft.progress ?? 0),
        attempts: draft.attempts ?? 0,
        createdAt: draft.createdAt ?? now,
        updatedAt: draft.updatedAt ?? now,
      };
      set((state) => ({ items: trimQueue([...state.items, item]) }));
      return item;
    },

    markUploading: (clientId) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                status: 'uploading',
                progress: item.progress > 0 ? item.progress : 0,
                error: undefined,
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
    },

    updateProgress: (clientId, progress) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                progress: clampProgress(progress),
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
    },

    markSubmitting: (clientId, patch) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                ...patch,
                status: 'submitting',
                progress: 100,
                error: undefined,
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
    },

    markSuccess: (clientId, serverPromptId, serverExpiresAt) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                serverPromptId: serverPromptId ?? item.serverPromptId,
                serverExpiresAt: serverExpiresAt ?? item.serverExpiresAt,
                status: 'success',
                progress: 100,
                error: undefined,
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
    },

    markFailed: (clientId, error) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                status: 'failed',
                error,
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
    },

    retry: (clientId) => {
      set((state) => ({
        items: state.items.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                status: 'queued',
                progress: 0,
                error: undefined,
                attempts: item.attempts + 1,
                // Reset resolved storage IDs so the pipeline re-uploads.
                storageId: undefined,
                ownerPhotoStorageId: item.ownerPhotoLocalUri
                  ? undefined
                  : item.ownerPhotoStorageId,
                updatedAt: Date.now(),
              }
            : item
        ),
      }));
    },

    remove: (clientId) => {
      set((state) => ({
        items: state.items.filter((item) => item.clientId !== clientId),
      }));
    },

    clearForUserSwitch: (userId) => {
      set((state) => ({
        items: userId
          ? state.items.filter((item) => item.userId === userId)
          : [],
      }));
    },

    selectByUserId: (userId) => {
      return get()
        .items.filter((item) => item.userId === userId)
        .sort((a, b) => a.createdAt - b.createdAt);
    },
  })
);
