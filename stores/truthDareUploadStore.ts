import { create } from 'zustand';

export type TruthDareUploadStatus = 'queued' | 'uploading' | 'submitting' | 'success' | 'failed';
export type TruthDareUploadMediaKind = 'photo' | 'video' | 'voice' | 'audio';
export type TruthDareIdentityMode = 'anonymous' | 'no_photo' | 'profile';
export type TruthDareMediaVisibility = 'private' | 'public';
export type TruthDareAnswerVisibility = 'owner_only' | 'public';
export type TruthDarePhotoBlurMode = 'none' | 'blur';

export type TruthDareUploadError = {
  message: string;
  code?: string;
  retryable?: boolean;
};

export type TruthDareUploadAttachment = {
  kind: TruthDareUploadMediaKind;
  localUri: string;
  mime?: string;
  durationMs?: number;
  durationSec?: number;
  isFrontCamera?: boolean;
};

export type TruthDarePendingUpload = {
  clientId: string;
  promptId: string;
  userId: string;
  existingAnswerId?: string;
  text?: string;
  attachment?: TruthDareUploadAttachment;
  localUri?: string;
  mediaKind?: TruthDareUploadMediaKind;
  mediaVisibility: TruthDareMediaVisibility;
  visibility: TruthDareAnswerVisibility;
  removeMedia?: boolean;
  identityMode: TruthDareIdentityMode;
  isAnonymous: boolean;
  photoBlurMode: TruthDarePhotoBlurMode;
  authorName?: string;
  authorPhotoUrl?: string;
  authorPhotoLocalUri?: string;
  authorPhotoStorageId?: string;
  authorAge?: number;
  authorGender?: string;
  mediaMime?: string;
  durationSec?: number;
  isFrontCamera?: boolean;
  storageId?: string;
  serverAnswerId?: string;
  status: TruthDareUploadStatus;
  progress: number;
  error?: TruthDareUploadError;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

export type TruthDareUploadDraft = Omit<
  TruthDarePendingUpload,
  'status' | 'progress' | 'error' | 'attempts' | 'createdAt' | 'updatedAt'
> & {
  status?: TruthDareUploadStatus;
  progress?: number;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number;
};

type TruthDareUploadPatch = Partial<
  Pick<
    TruthDarePendingUpload,
    | 'storageId'
    | 'authorPhotoStorageId'
    | 'serverAnswerId'
    | 'progress'
    | 'error'
    | 'mediaMime'
    | 'durationSec'
    | 'isFrontCamera'
  >
>;

type TruthDareUploadStore = {
  items: TruthDarePendingUpload[];
  enqueue: (draft: TruthDareUploadDraft) => TruthDarePendingUpload;
  markUploading: (clientId: string) => void;
  updateProgress: (clientId: string, progress: number) => void;
  markSubmitting: (clientId: string, patch?: TruthDareUploadPatch) => void;
  markSuccess: (clientId: string, serverAnswerId?: string) => void;
  markFailed: (clientId: string, error: TruthDareUploadError) => void;
  retry: (clientId: string) => void;
  remove: (clientId: string) => void;
  clearForUserSwitch: (userId?: string | null) => void;
  selectByPromptId: (promptId: string) => TruthDarePendingUpload[];
  hasActiveForPromptUser: (promptId: string, userId: string) => boolean;
};

const MAX_QUEUE_ITEMS = 30;
const ACTIVE_STATUSES = new Set<TruthDareUploadStatus>(['queued', 'uploading', 'submitting']);

export function isActiveTruthDareUpload(item: Pick<TruthDarePendingUpload, 'status'>): boolean {
  return ACTIVE_STATUSES.has(item.status);
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function trimQueue(items: TruthDarePendingUpload[]): TruthDarePendingUpload[] {
  if (items.length <= MAX_QUEUE_ITEMS) return items;

  const active = items.filter(isActiveTruthDareUpload);
  const terminal = items
    .filter((item) => !isActiveTruthDareUpload(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const terminalSlots = Math.max(0, MAX_QUEUE_ITEMS - active.length);

  return [...active, ...terminal.slice(0, terminalSlots)].sort((a, b) => a.createdAt - b.createdAt);
}

export const useTruthDareUploadStore = create<TruthDareUploadStore>()((set, get) => ({
  items: [],

  enqueue: (draft) => {
    const now = Date.now();
    const existingActive = get().items.find(
      (item) =>
        item.promptId === draft.promptId &&
        item.userId === draft.userId &&
        isActiveTruthDareUpload(item)
    );

    if (existingActive) {
      return existingActive;
    }

    const item: TruthDarePendingUpload = {
      ...draft,
      status: draft.status ?? 'queued',
      progress: clampProgress(draft.progress ?? 0),
      attempts: draft.attempts ?? 0,
      createdAt: draft.createdAt ?? now,
      updatedAt: draft.updatedAt ?? now,
      mediaVisibility: draft.mediaVisibility ?? 'public',
      visibility: draft.visibility ?? 'public',
    };

    set((state) => ({
      items: trimQueue([...state.items, item]),
    }));

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

  markSuccess: (clientId, serverAnswerId) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.clientId === clientId
          ? {
              ...item,
              serverAnswerId: serverAnswerId ?? item.serverAnswerId,
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
              storageId: undefined,
              authorPhotoStorageId: undefined,
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

  selectByPromptId: (promptId) => {
    return get()
      .items.filter((item) => item.promptId === promptId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  hasActiveForPromptUser: (promptId, userId) => {
    return get().items.some(
      (item) =>
        item.promptId === promptId &&
        item.userId === userId &&
        isActiveTruthDareUpload(item)
    );
  },
}));
