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

export interface DemoDmMessage {
  _id: string;
  content: string;
  type: string;
  senderId: string;
  createdAt: number;
  readAt?: number;
}

/** Lightweight metadata so demo chat screens can render a header. */
export interface DemoConversationMeta {
  otherUser: { id?: string; name: string; lastActive: number; isVerified?: boolean };
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

  /** Delete a conversation and its metadata/draft entirely. */
  deleteConversation: (id: string) => void;

  /** Delete multiple conversations by IDs (batch cleanup). */
  deleteConversations: (ids: string[]) => void;

  /** Cleanup expired confession threads — removes threads + meta + drafts */
  cleanupExpiredThreads: (expiredThreadIds: string[]) => void;

  /** Clear all conversations, metadata, and drafts. */
  reset: () => void;
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

      addMessage: (id, msg) =>
        set((s) => ({
          conversations: {
            ...s.conversations,
            [id]: [...(s.conversations[id] ?? []), msg],
          },
        })),

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

      reset: () => set({ conversations: {}, meta: {}, drafts: {} }),
    }),
    {
      name: 'demo-dm-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
