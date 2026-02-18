/**
 * demoDmStore — persists demo DM messages so they survive navigation
 * and app restarts.
 *
 * When the app runs in demo mode (no Convex backend), DM messages are
 * stored here instead of component-local useState.  The store seeds
 * each conversation lazily the first time it is opened, so the
 * hardcoded demo data still appears but new messages the user sends
 * are never lost.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '@/utils/logger';

// Hydration timing: capture when store module loads
const DM_STORE_LOAD_TIME = Date.now();

export interface DemoDmMessage {
  _id: string;
  content: string;
  type: string; // 'text' | 'image' | 'template' | 'dare' | 'voice'
  senderId: string;
  createdAt: number;
  readAt?: number;
  // Voice message fields
  audioUri?: string;
  durationMs?: number;
  // Protected media fields (synced from privateChatStore for bubble rendering)
  isProtected?: boolean;
  protectedMedia?: {
    timer: number;
    viewingMode: 'tap' | 'hold';
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
  };
  timerEndsAt?: number;   // Wall-clock time when timer expires (set on first view)
  isExpired?: boolean;
  expiredAt?: number;     // Wall-clock time when expired (for auto-removal after 60s)
}

/** Lightweight metadata so demo chat screens can render a header. */
export interface DemoConversationMeta {
  otherUser: { id?: string; name: string; lastActive: number; isVerified?: boolean; photoUrl?: string };
  isPreMatch: boolean;
  isConfessionChat?: boolean; // True if created from confession (tagged user liked)
  expiresAt?: number; // Only set for confession-based threads (24h after creation)
}

interface DemoDmState {
  /** conversationId → ordered message array */
  conversations: Record<string, DemoDmMessage[]>;

  /** conversationId → header / other-user metadata */
  meta: Record<string, DemoConversationMeta>;

  /** conversationId → draft text (pre-filled but not yet sent) */
  drafts: Record<string, string>;

  /**
   * Seed a conversation with initial messages if it hasn't been
   * seeded yet.  Calling this multiple times is safe — it only
   * writes if the key is absent.
   */
  seedConversation: (id: string, seed: DemoDmMessage[]) => void;

  /** Store or update conversation metadata (other-user info, etc.). */
  setMeta: (id: string, m: DemoConversationMeta) => void;

  /** Append a new message to a conversation. */
  addMessage: (id: string, msg: DemoDmMessage) => void;

  /** Set a draft message for a conversation (pre-fills the input). */
  setDraft: (id: string, text: string) => void;

  /** Clear the draft for a conversation (e.g. after sending). */
  clearDraft: (id: string) => void;

  /** Mark all incoming messages in a conversation as read. */
  markConversationRead: (id: string, currentUserId: string) => void;

  /** Delete a single message by ID. */
  deleteMessage: (conversationId: string, messageId: string) => void;

  /** Delete a conversation and its metadata/draft entirely. */
  deleteConversation: (id: string) => void;

  /** Delete multiple conversations by IDs (batch cleanup). */
  deleteConversations: (ids: string[]) => void;

  /** Cleanup expired confession threads — removes threads + meta + drafts */
  cleanupExpiredThreads: (expiredThreadIds: string[]) => void;

  /** Mark a secure photo as expired (for bubble to show Expired state) */
  markSecurePhotoExpired: (conversationId: string, messageId: string) => void;

  /** Sync timerEndsAt from privateChatStore (for live countdown on bubble) */
  syncTimerEndsAt: (conversationId: string, messageId: string, timerEndsAt: number) => void;

  /** Clear all conversations, metadata, and drafts. */
  reset: () => void;

  /** Hydration state for startup safety */
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

/**
 * Pure function: count conversations that have at least one unread incoming message.
 * Use as a Zustand selector: `useDemoDmStore(s => computeUnreadConversationCount(s, userId))`
 */
export function computeUnreadConversationCount(
  state: Pick<DemoDmState, 'conversations'>,
  currentUserId: string,
): number {
  let count = 0;
  for (const msgs of Object.values(state.conversations)) {
    if (!msgs || msgs.length === 0) continue;
    // Check if any incoming message is unread
    const hasUnread = msgs.some(
      (m) => m.senderId !== currentUserId && !m.readAt,
    );
    if (hasUnread) count++;
  }
  return count;
}

export const useDemoDmStore = create<DemoDmState>()(
  persist(
    (set, get) => ({
      conversations: {},
      meta: {},
      drafts: {},
      _hasHydrated: false,

      setHasHydrated: (state) => set({ _hasHydrated: state }),

      seedConversation: (id, seed) => {
        // Only seed once — existing data takes precedence
        if (get().conversations[id]) return;
        set((s) => ({
          conversations: { ...s.conversations, [id]: seed },
        }));
      },

      setMeta: (id, m) =>
        set((s) => ({
          meta: { ...s.meta, [id]: m },
        })),

      addMessage: (id, msg) => {
        // DEBUG: Log message send for persistence verification
        const currentCount = get().conversations[id]?.length ?? 0;
        log.info('[DM]', 'message added', {
          conversationId: id,
          messageCount: currentCount + 1,
        });
        set((s) => ({
          conversations: {
            ...s.conversations,
            [id]: [...(s.conversations[id] ?? []), msg],
          },
        }));
      },

      setDraft: (id, text) =>
        set((s) => ({
          drafts: { ...s.drafts, [id]: text },
        })),

      clearDraft: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.drafts;
          return { drafts: rest };
        }),

      markConversationRead: (id, currentUserId) =>
        set((s) => {
          const msgs = s.conversations[id];
          if (!msgs) return {};
          const now = Date.now();
          const updated = msgs.map((m) =>
            m.senderId !== currentUserId && !m.readAt
              ? { ...m, readAt: now }
              : m,
          );
          return { conversations: { ...s.conversations, [id]: updated } };
        }),

      deleteMessage: (conversationId, messageId) =>
        set((s) => {
          const msgs = s.conversations[conversationId];
          if (!msgs) return s;
          const filtered = msgs.filter((m) => m._id !== messageId);
          return { conversations: { ...s.conversations, [conversationId]: filtered } };
        }),

      deleteConversation: (id) =>
        set((s) => {
          const { [id]: _c, ...restConvos } = s.conversations;
          const { [id]: _m, ...restMeta } = s.meta;
          const { [id]: _d, ...restDrafts } = s.drafts;
          return { conversations: restConvos, meta: restMeta, drafts: restDrafts };
        }),

      deleteConversations: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const idsSet = new Set(ids);
          const conversations: Record<string, DemoDmMessage[]> = {};
          const meta: Record<string, DemoConversationMeta> = {};
          const drafts: Record<string, string> = {};
          for (const key of Object.keys(s.conversations)) {
            if (!idsSet.has(key)) conversations[key] = s.conversations[key];
          }
          for (const key of Object.keys(s.meta)) {
            if (!idsSet.has(key)) meta[key] = s.meta[key];
          }
          for (const key of Object.keys(s.drafts)) {
            if (!idsSet.has(key)) drafts[key] = s.drafts[key];
          }
          return { conversations, meta, drafts };
        }),

      cleanupExpiredThreads: (expiredThreadIds) => {
        if (expiredThreadIds.length === 0) return;
        // Use deleteConversations for the actual cleanup
        get().deleteConversations(expiredThreadIds);
      },

      markSecurePhotoExpired: (conversationId, messageId) =>
        set((s) => {
          const msgs = s.conversations[conversationId];
          if (!msgs) return s;
          const now = Date.now();
          const updated = msgs.map((m) =>
            m._id === messageId && !m.isExpired
              ? { ...m, isExpired: true, expiredAt: now }
              : m
          );
          return { conversations: { ...s.conversations, [conversationId]: updated } };
        }),

      syncTimerEndsAt: (conversationId, messageId, timerEndsAt) =>
        set((s) => {
          const msgs = s.conversations[conversationId];
          if (!msgs) return s;
          const updated = msgs.map((m) =>
            m._id === messageId && !m.timerEndsAt
              ? { ...m, timerEndsAt }
              : m
          );
          return { conversations: { ...s.conversations, [conversationId]: updated } };
        }),

      reset: () => set({ conversations: {}, meta: {}, drafts: {} }),
    }),
    {
      name: 'demo-dm-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state, error) => {
        const hydrationTime = Date.now() - DM_STORE_LOAD_TIME;
        if (error) {
          log.error('[DM]', 'rehydration error', error);
        }
        if (state) {
          // DEBUG: Log conversation/message counts on hydrate for persistence verification
          const convoIds = Object.keys(state.conversations);
          const totalMessages = convoIds.reduce(
            (sum, id) => sum + (state.conversations[id]?.length ?? 0),
            0
          );
          log.info('[DM]', 'hydrated from storage', {
            conversations: convoIds.length,
            totalMessages,
          });
          if (__DEV__) {
            console.log(`[HYDRATION] demoDmStore: ${hydrationTime}ms (convos=${convoIds.length}, messages=${totalMessages})`);
          }
          state.setHasHydrated(true);
        }
      },
    },
  ),
);

// CR-3: Hydration timeout fallback (matches authStore/demoStore/blockStore pattern)
const HYDRATION_TIMEOUT_MS = 5000;
let _dmHydrationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function setupDmHydrationTimeout() {
  // Clear any existing timeout (hot reload safety)
  if (_dmHydrationTimeoutId !== null) {
    clearTimeout(_dmHydrationTimeoutId);
  }
  _dmHydrationTimeoutId = setTimeout(() => {
    if (!useDemoDmStore.getState()._hasHydrated) {
      if (__DEV__) {
        console.warn('[demoDmStore] Hydration timeout — forcing hydrated state');
      }
      useDemoDmStore.getState().setHasHydrated(true);
    }
    _dmHydrationTimeoutId = null;
  }, HYDRATION_TIMEOUT_MS);
}

// CR-3 fix: hydration timeout fallback — if AsyncStorage blocks, force hydration after timeout
setupDmHydrationTimeout();
