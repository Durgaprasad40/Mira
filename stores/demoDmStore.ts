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
/**
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 */
import { create } from 'zustand';
import { log } from '@/utils/logger';

export interface DemoDmMessage {
  _id: string;
  content: string;
  type: string; // 'text' | 'image' | 'video' | 'template' | 'dare' | 'voice'
  senderId: string;
  createdAt: number;
  readAt?: number;
  deliveredAt?: number;
  // Voice message fields
  audioUri?: string;
  durationMs?: number;
  // Video message fields
  videoUri?: string;
  videoDurationMs?: number;
  // Protected media fields (synced from privateChatStore for bubble rendering)
  isProtected?: boolean;
  protectedMedia?: {
    timer: number;
    viewingMode: 'tap' | 'hold';
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
    isMirrored?: boolean; // True if front-camera video (needs render-time flip)
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
  /** Phase-2: Room this DM originated from (for per-room unread badge) */
  sourceRoomId?: string;
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

/**
 * Phase-2: Compute DISTINCT SENDER counts grouped by sourceRoomId.
 * Returns: { byRoomId: Record<roomId, distinctSenderCount>, roomsWithUnread: number }
 *
 * Rules:
 * - Counts DISTINCT people who have sent unseen messages, NOT message count
 * - Same person sends 5 messages → counts as 1
 * - Two different people each send messages → counts as 2
 * - Once a conversation is marked read, that sender no longer counts
 */
export function computeUnreadDmCountsByRoom(
  state: Pick<DemoDmState, 'conversations' | 'meta'>,
  currentUserId: string,
): { byRoomId: Record<string, number>; roomsWithUnread: number } {
  const byRoomId: Record<string, number> = {};

  for (const [convId, msgs] of Object.entries(state.conversations)) {
    if (!msgs || msgs.length === 0) continue;

    // Get sourceRoomId from meta
    const meta = state.meta[convId];
    const sourceRoomId = meta?.sourceRoomId;
    if (!sourceRoomId) continue; // Skip DMs without sourceRoomId

    // Check if this conversation has ANY unread incoming message
    const hasUnread = msgs.some(
      (m) => m.senderId !== currentUserId && !m.readAt,
    );

    // If has unread, count as 1 distinct sender for this room
    if (hasUnread) {
      byRoomId[sourceRoomId] = (byRoomId[sourceRoomId] || 0) + 1;
    }
  }

  const roomsWithUnread = Object.keys(byRoomId).length;
  return { byRoomId, roomsWithUnread };
}

export const useDemoDmStore = create<DemoDmState>()((set, get) => ({
  conversations: {},
  meta: {},
  drafts: {},
  _hasHydrated: true,

  setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op

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
    // Phase-2 Fix C: Message cap at 1000 per conversation
    const MESSAGE_CAP = 1000;

    set((s) => {
      const existing = s.conversations[id] ?? [];
      let updated = [...existing, msg];

      // Enforce cap: if > 1000, trim oldest messages
      if (updated.length > MESSAGE_CAP) {
        const trimCount = updated.length - MESSAGE_CAP;
        updated = updated.slice(trimCount);
        if (__DEV__) {
          log.info('[DM]', 'message cap enforced', {
            conversationId: id,
            trimmed: trimCount,
            newLength: updated.length,
          });
        }
      }

      // DEBUG: Log message send for persistence verification
      log.info('[DM]', 'message added', {
        conversationId: id,
        messageCount: updated.length,
      });

      return {
        conversations: {
          ...s.conversations,
          [id]: updated,
        },
      };
    });
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
}));
