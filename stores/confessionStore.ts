/**
 * LOCKED (CONFESSIONS STORE - RANKING BEHAVIOR)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * LOCKED LOGIC:
 * - addConfession: APPENDS to end (new posts at bottom)
 * - Rate limit bypassed for TESTING (TODO: re-enable for production)
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 */
import { create } from 'zustand';
import {
  Confession,
  ConfessionChat,
  ConfessionChatMessage,
  ConfessionReply,
  SecretCrush,
  TimedRevealOption,
} from '@/types';
import {
  DEMO_CONFESSIONS,
  DEMO_CONFESSION_USER_REACTIONS,
  DEMO_CONFESSION_CHATS,
  DEMO_SECRET_CRUSHES,
  DEMO_CONFESSION_REPLIES,
} from '@/lib/demoData';
import { isProbablyEmoji } from '@/lib/utils';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { logDebugEvent } from '@/lib/debugEventLogger';
import { useBlockStore } from './blockStore';

// Map old fixed reaction keys → emoji characters
const OLD_REACTION_TO_EMOJI: Record<string, string> = {
  relatable: '\u2764\uFE0F',
  feel_you: '\uD83D\uDE2D',
  bold: '\uD83D\uDD25',
  curious: '\uD83D\uDC40',
};

/** Convert old string-keyed reactions to emoji-keyed, drop invalid keys, and recompute topEmojis */
function migrateConfessionReactions(c: Confession): Confession {
  if (!c.reactions) return c;
  const reactions: Record<string, number> = {};
  let needsMigration = false;
  for (const [key, count] of Object.entries(c.reactions)) {
    if (OLD_REACTION_TO_EMOJI[key]) {
      // Known old key → convert to emoji
      reactions[OLD_REACTION_TO_EMOJI[key]] = (reactions[OLD_REACTION_TO_EMOJI[key]] || 0) + count;
      needsMigration = true;
    } else if (isProbablyEmoji(key)) {
      // Already a real emoji → keep
      reactions[key] = count;
    } else {
      // Unknown non-emoji string → drop it
      needsMigration = true;
    }
  }
  const topEmojis = Object.entries(reactions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emoji, count]) => ({ emoji, count }));
  if (needsMigration || !c.topEmojis || c.topEmojis.length === 0) {
    return { ...c, reactions, topEmojis };
  }
  return c;
}

// Demo-only legacy thread tracking kept for cleanup of existing data.
// Emoji reactions no longer add to this map; Connect / Reject owns chat creation.
interface ConfessionThreads {
  [confessionId: string]: string; // conversationId
}

// Rate limiting constants
const CONFESSION_RATE_LIMIT = 1; // Max confessions per 24 hours
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in ms
const CONFESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours in ms

interface ConfessionState {
  confessions: Confession[];
  userReactions: Record<string, string | null>; // confessionId → emoji string (one per user)
  replies: Record<string, ConfessionReply[]>; // confessionId → replies array
  chats: ConfessionChat[];
  secretCrushes: SecretCrush[];
  reportedIds: string[];
  blockedIds: string[];
  seeded: boolean;
  confessionThreads: ConfessionThreads; // Demo-only legacy threads kept for cleanup

  // Seen tracking for demo mode (tagged confessions)
  seenTaggedConfessionIds: string[];

  // Rate limiting: timestamps of user's own confessions (within 24h window)
  confessionTimestamps: number[];

  seedConfessions: () => void;
  addConfession: (confession: Confession) => void;
  toggleReaction: (confessionId: string, emoji: string, userId?: string) => { chatUnlocked: boolean };
  addChat: (chat: ConfessionChat) => void;
  addChatMessage: (chatId: string, message: ConfessionChatMessage) => void;
  addSecretCrush: (crush: SecretCrush) => void;
  reportConfession: (confessionId: string) => void;
  blockUser: (userId: string) => void;
  revealCrush: (crushId: string) => void;

  // Replies
  addReply: (confessionId: string, reply: ConfessionReply) => void;
  deleteReply: (confessionId: string, replyId: string) => void;
  getReplies: (confessionId: string) => ConfessionReply[];

  // Time-Locked Reveal
  setTimedReveal: (confessionId: string, option: TimedRevealOption, taggedUserId?: string) => void;
  cancelTimedReveal: (confessionId: string) => void;

  // Integrity / Cleanup actions
  /** Mark a tagged confession as seen (for badge computation) */
  markTaggedConfessionSeen: (confessionId: string) => void;
  /** Mark all tagged confessions as seen */
  markAllTaggedConfessionsSeen: (confessionIds: string[]) => void;
  /** Cleanup expired confessions from store */
  cleanupExpiredConfessions: (expiredIds: string[]) => void;
  /** Cleanup expired confession chats from store */
  cleanupExpiredChats: (expiredChatIds: string[]) => void;
  /** Cleanup expired secret crushes from store */
  cleanupExpiredSecretCrushes: (expiredIds: string[]) => void;
  /** Remove confession threads by conversation IDs */
  removeConfessionThreads: (conversationIds: string[]) => void;
  /** Delete a confession by ID (author manual delete) */
  deleteConfession: (confessionId: string) => void;
  /** Update a confession's text and mood (author edit) */
  updateConfession: (confessionId: string, newText: string, newMood?: 'romantic' | 'spicy' | 'emotional' | 'funny') => void;
  // Rate limiting
  /** Check if user can post a new confession (rate limit check) */
  canPostConfession: () => boolean;
  /** Get count of confessions posted in last 24h */
  getConfessionCountToday: () => number;
  /** Record a confession timestamp (called when posting) */
  recordConfessionTimestamp: () => void;
  /** Get milliseconds until next confession is allowed (0 if can post now) */
  getTimeUntilNextConfession: () => number;
  /** Get user's most recent confession */
  getMyLatestConfession: (userId: string) => Confession | null;

  // Block author (hide their confessions from me)
  /** Block an author - hide their confessions from current user */
  blockAuthor: (authorId: string) => void;
  /** Check if an author is blocked */
  isAuthorBlocked: (authorId: string) => boolean;

  /** Purge expired confessions (24h) - removes from public feeds, deletes replies/chats */
  purgeExpiredNow: (currentUserId: string) => void;
  /** Get expiry time for a confession */
  getExpiresAt: (confession: Confession) => number;

  /** Hydration flag — true once AsyncStorage data has been restored. */
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

function computeTimedRevealAt(option: TimedRevealOption): number | null {
  if (option === 'never') return null;
  const hours = option === '24h' ? 24 : 48;
  return Date.now() + hours * 60 * 60 * 1000;
}

export const useConfessionStore = create<ConfessionState>()((set, get) => ({
  confessions: [],
  userReactions: {},
  replies: {},
  chats: [],
  secretCrushes: [],
  reportedIds: [],
  blockedIds: [],
  seeded: false,
  confessionThreads: {},
  seenTaggedConfessionIds: [],
  confessionTimestamps: [],
  _hasHydrated: true,

  setHasHydrated: (state) => set({ _hasHydrated: true }),

  seedConfessions: () => {
    if (get().seeded) {
      // Migrate persisted confessions: fix old reaction keys + backfill replyPreviews + expiresAt
      const current = get().confessions;
      const migrated = current.map((c) => {
        let updated = migrateConfessionReactions(c);
        // Backfill replyPreviews if missing
        if (!updated.replyPreviews || updated.replyPreviews.length === 0) {
          const replies = DEMO_CONFESSION_REPLIES[updated.id] || [];
          if (replies.length > 0) {
            updated = {
              ...updated,
              replyPreviews: replies.slice(0, 2).map((r) => ({
                text: r.text,
                isAnonymous: r.isAnonymous,
                type: (r as any).type || 'text',
                createdAt: r.createdAt,
              })),
            };
          }
        }
        // Backfill expiresAt if missing
        if (!updated.expiresAt) {
          updated = {
            ...updated,
            expiresAt: updated.createdAt + CONFESSION_EXPIRY_MS,
          };
        }
        return updated;
      });
      const changed = migrated.some((c, i) => c !== current[i]);
      if (changed) {
        set({ confessions: migrated });
      }
      return;
    }
    // Backfill revealPolicy, replyPreviews, and expiresAt on demo data.
    const confessions = DEMO_CONFESSIONS.map((c) => {
      const replies = DEMO_CONFESSION_REPLIES[c.id] || [];
      const replyPreviews = replies.slice(0, 2).map((r) => ({
        text: r.text,
        isAnonymous: r.isAnonymous,
        type: (r as any).type || 'text',
        createdAt: r.createdAt,
      }));
      return migrateConfessionReactions({
        ...c,
        replyPreviews,
        revealPolicy: c.revealPolicy || ('never' as const),
        expiresAt: c.expiresAt || (c.createdAt + CONFESSION_EXPIRY_MS),
      });
    });
    set({
      confessions,
      userReactions: DEMO_CONFESSION_USER_REACTIONS,
      replies: { ...DEMO_CONFESSION_REPLIES },
      chats: DEMO_CONFESSION_CHATS,
      secretCrushes: DEMO_SECRET_CRUSHES,
      seeded: true,
    });
  },

  addConfession: (confession) => {
    const normalizedConfession = confession.expiresAt
      ? confession
      : {
          ...confession,
          expiresAt: confession.createdAt + CONFESSION_EXPIRY_MS,
        };

    // RANKING FIX: APPEND new confession to END of list (not prepend)
    // New posts start at bottom with negative ranking score
    // They rise based on engagement (likes, comments, reactions)
    set((state) => ({
      confessions: [...state.confessions, normalizedConfession],
    }));
  },

  toggleReaction: (confessionId, emoji, _userId) => {
    const state = get();
    const currentEmoji = state.userReactions[confessionId];
    const newUserReactions = { ...state.userReactions };

    let countDelta = 0;
    let oldEmoji: string | null = null;

    if (currentEmoji === emoji) {
      // Same emoji → toggle off
      delete newUserReactions[confessionId];
      countDelta = -1;
      oldEmoji = emoji;
    } else if (currentEmoji) {
      // Different emoji → replace (count stays same)
      newUserReactions[confessionId] = emoji;
      oldEmoji = currentEmoji;
    } else {
      // No existing → add
      newUserReactions[confessionId] = emoji;
      countDelta = 1;
    }

    const confessions = state.confessions.map((c) => {
      if (c.id !== confessionId) return c;
      const reactions = { ...(c.reactions || {}) };
      // Remove old emoji count
      if (oldEmoji && reactions[oldEmoji]) {
        reactions[oldEmoji] = Math.max(0, reactions[oldEmoji] - 1);
        if (reactions[oldEmoji] === 0) delete reactions[oldEmoji];
      }
      // Add new emoji count (if not toggling off)
      if (countDelta >= 0 && newUserReactions[confessionId]) {
        reactions[emoji] = (reactions[emoji] || 0) + 1;
      }

      // Recompute topEmojis (only valid emojis)
      const topEmojis = Object.entries(reactions)
        .filter(([e]) => isProbablyEmoji(e))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([e, count]) => ({ emoji: e, count }));

      const reactionCount = Math.max(0, c.reactionCount + countDelta);
      return { ...c, reactions, topEmojis, reactionCount };
    });

    set({ userReactions: newUserReactions, confessions });

    return { chatUnlocked: false };
  },

  addChat: (chat) => {
    set((state) => ({
      chats: [chat, ...state.chats],
    }));
  },

  addChatMessage: (chatId, message) => {
    set((state) => ({
      chats: state.chats.map((c) =>
        c.id === chatId
          ? { ...c, messages: [...c.messages, message] }
          : c
      ),
    }));
  },

  addSecretCrush: (crush) => {
    set((state) => ({
      secretCrushes: [crush, ...state.secretCrushes],
    }));
    // Log tag notification (secret crush = someone was tagged in a confession)
    logDebugEvent('TAG_NOTIFICATION', 'Tagged confession notification sent');
  },

  reportConfession: (confessionId) => {
    set((state) => ({
      reportedIds: [...state.reportedIds, confessionId],
      confessions: state.confessions.filter((c) => c.id !== confessionId),
    }));
    logDebugEvent('BLOCK_OR_REPORT', 'Confession reported');
  },

  blockUser: (userId) => {
    set((state) => ({
      blockedIds: [...state.blockedIds, userId],
      confessions: state.confessions.filter((c) => c.userId !== userId),
    }));
  },

  revealCrush: (crushId) => {
    set((state) => ({
      secretCrushes: state.secretCrushes.map((sc) =>
        sc.id === crushId ? { ...sc, isRevealed: true } : sc
      ),
    }));
  },

  // ── Replies ──
  addReply: (confessionId, reply) => {
    if (__DEV__) console.log('[CONFESS] addReply:', { confessionId, replyId: reply.id, parentReplyId: reply.parentReplyId });
    set((state) => {
      const currentReplies = state.replies[confessionId] || [];
      const newReplies = [...currentReplies, reply];

      // Only count OUTSIDE-USER top-level replies. Owner replies (threaded or
      // hypothetical top-level self-comments) must not inflate engagement.
      const ownerId = state.confessions.find((c) => c.id === confessionId)?.userId;
      const topLevelReplies = newReplies.filter((r) => !r.parentReplyId);
      const countableReplies = topLevelReplies.filter((r) => r.userId !== ownerId);

      // Update the confession's replyCount and replyPreviews
      const updatedConfessions = state.confessions.map((c) => {
        if (c.id !== confessionId) return c;
        // Preview only shows top-level replies (visible history, all authors)
        const replyPreviews = topLevelReplies.slice(-2).map((r) => ({
          text: r.text,
          isAnonymous: r.isAnonymous,
          type: r.type || 'text',
          createdAt: r.createdAt,
        }));
        return {
          ...c,
          replyCount: countableReplies.length,
          replyPreviews,
        };
      });

      return {
        replies: { ...state.replies, [confessionId]: newReplies },
        confessions: updatedConfessions,
      };
    });
  },

  deleteReply: (confessionId, replyId) => {
    if (__DEV__) console.log('[CONFESS] deleteReply:', { confessionId, replyId });
    set((state) => {
      const currentReplies = state.replies[confessionId] || [];
      // Also delete any child replies that have this reply as parent
      const newReplies = currentReplies.filter((r) => r.id !== replyId && r.parentReplyId !== replyId);

      // Only count OUTSIDE-USER top-level replies. Owner replies (threaded or
      // hypothetical top-level self-comments) must not inflate engagement.
      const ownerId = state.confessions.find((c) => c.id === confessionId)?.userId;
      const topLevelReplies = newReplies.filter((r) => !r.parentReplyId);
      const countableReplies = topLevelReplies.filter((r) => r.userId !== ownerId);

      // Update the confession's replyCount and replyPreviews
      const updatedConfessions = state.confessions.map((c) => {
        if (c.id !== confessionId) return c;
        // Preview only shows top-level replies (visible history, all authors)
        const replyPreviews = topLevelReplies.slice(-2).map((r) => ({
          text: r.text,
          isAnonymous: r.isAnonymous,
          type: r.type || 'text',
          createdAt: r.createdAt,
        }));
        return {
          ...c,
          replyCount: countableReplies.length,
          replyPreviews,
        };
      });

      return {
        replies: { ...state.replies, [confessionId]: newReplies },
        confessions: updatedConfessions,
      };
    });
  },

  getReplies: (confessionId) => {
    return get().replies[confessionId] || [];
  },

  // ── Time-Locked Reveal ──
  setTimedReveal: (confessionId, option, _taggedUserId) => {
    set((state) => ({
      confessions: state.confessions.map((c) =>
        c.id === confessionId
          ? {
              ...c,
              timedReveal: option,
              timedRevealAt: computeTimedRevealAt(option),
              timedRevealCancelled: false,
            }
          : c
      ),
    }));
  },

  cancelTimedReveal: (confessionId) => {
    set((state) => ({
      confessions: state.confessions.map((c) =>
        c.id === confessionId
          ? { ...c, timedRevealAt: null, timedRevealCancelled: true }
          : c
      ),
    }));
  },

  // ── Integrity / Cleanup Actions ──

  markTaggedConfessionSeen: (confessionId) => {
    set((state) => {
      if (state.seenTaggedConfessionIds.includes(confessionId)) return state;
      return {
        seenTaggedConfessionIds: [...state.seenTaggedConfessionIds, confessionId],
      };
    });
  },

  markAllTaggedConfessionsSeen: (confessionIds) => {
    set((state) => {
      const newIds = confessionIds.filter(
        (id) => !state.seenTaggedConfessionIds.includes(id)
      );
      if (newIds.length === 0) return state;
      return {
        seenTaggedConfessionIds: [...state.seenTaggedConfessionIds, ...newIds],
      };
    });
  },

  cleanupExpiredConfessions: (expiredIds) => {
    if (expiredIds.length === 0) return;
    const expiredSet = new Set(expiredIds);
    set((state) => ({
      confessions: state.confessions.filter((c) => !expiredSet.has(c.id)),
      // Also clean up user reactions for expired confessions
      userReactions: Object.fromEntries(
        Object.entries(state.userReactions).filter(
          ([confessionId]) => !expiredSet.has(confessionId)
        )
      ),
    }));
    // Clean up related DM threads via demoDmStore
    const dmStore = useDemoDmStore?.getState?.();
    const confessionThreads = get().confessionThreads;
    const conversationIdsToDelete: string[] = [];
    for (const expiredId of expiredIds) {
      const convoId = confessionThreads[expiredId];
      if (convoId) {
        conversationIdsToDelete.push(convoId);
      }
    }
    if (conversationIdsToDelete.length > 0 && dmStore) {
      dmStore.deleteConversations(conversationIdsToDelete);
    }
    // Clean up thread tracking
    if (expiredIds.length > 0) {
      const newThreads = { ...get().confessionThreads };
      for (const id of expiredIds) {
        delete newThreads[id];
      }
      set({ confessionThreads: newThreads });
    }
  },

  cleanupExpiredChats: (expiredChatIds) => {
    if (expiredChatIds.length === 0) return;
    const expiredSet = new Set(expiredChatIds);
    set((state) => ({
      chats: state.chats.filter((c) => !expiredSet.has(c.id)),
    }));
  },

  cleanupExpiredSecretCrushes: (expiredIds) => {
    if (expiredIds.length === 0) return;
    const expiredSet = new Set(expiredIds);
    set((state) => ({
      secretCrushes: state.secretCrushes.filter((sc) => !expiredSet.has(sc.id)),
    }));
  },

  removeConfessionThreads: (conversationIds) => {
    if (conversationIds.length === 0) return;
    const convoIdSet = new Set(conversationIds);
    set((state) => {
      const newThreads: ConfessionThreads = {};
      for (const [confessionId, convoId] of Object.entries(state.confessionThreads)) {
        if (!convoIdSet.has(convoId)) {
          newThreads[confessionId] = convoId;
        }
      }
      return { confessionThreads: newThreads };
    });
    // Also delete from DM store
    const dmStore = useDemoDmStore?.getState?.();
    if (dmStore) {
      dmStore.deleteConversations(conversationIds);
    }
  },

  deleteConfession: (confessionId) => {
    const state = get();

    // CONSISTENCY FIX B5: Atomic deletion cascade
    // Prepare all cleanup in one pass, then commit atomically

    // 1. Remove from confessions array
    const confessions = state.confessions.filter((c) => c.id !== confessionId);

    // 2. Remove user reaction for this confession
    const userReactions = { ...state.userReactions };
    delete userReactions[confessionId];

    // 3. Remove confession thread if exists
    const confessionThreads = { ...state.confessionThreads };
    const convoId = confessionThreads[confessionId];
    delete confessionThreads[confessionId];

    // 4. Remove replies for this confession
    const replies = { ...state.replies };
    delete replies[confessionId];

    // 5. Remove chats tied to this confession
    const chats = state.chats.filter((c) => c.confessionId !== confessionId);

    // 6. Remove from seenTaggedConfessionIds if present (B5-minor fix)
    const seenTaggedConfessionIds = state.seenTaggedConfessionIds.filter(
      (id) => id !== confessionId
    );

    // 7. Atomic state update - all or nothing
    set({
      confessions,
      userReactions,
      confessionThreads,
      replies,
      chats,
      seenTaggedConfessionIds,
    });

    // 8. External cleanup (best effort, doesn't affect local state)
    if (convoId) {
      try {
        const dmStore = useDemoDmStore?.getState?.();
        dmStore?.deleteConversations([convoId]);
      } catch (err) {
        if (__DEV__) console.warn('[CONFESS] deleteConfession: DM cleanup failed:', err);
      }
    }
  },

  updateConfession: (confessionId, newText, newMood) => {
    set((state) => ({
      confessions: state.confessions.map((c) =>
        c.id === confessionId
          ? { ...c, text: newText, ...(newMood ? { mood: newMood } : {}) }
          : c
      ),
    }));
  },

  // ── Rate Limiting ──

  canPostConfession: () => {
    const state = get();
    const now = Date.now();
    // Filter timestamps within the 24h window
    const recentTimestamps = state.confessionTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );
    return recentTimestamps.length < CONFESSION_RATE_LIMIT;
  },

  getConfessionCountToday: () => {
    const state = get();
    const now = Date.now();
    return state.confessionTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    ).length;
  },

  recordConfessionTimestamp: () => {
    const state = get();
    const now = Date.now();
    // Clean up old timestamps and add new one
    const recentTimestamps = state.confessionTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );
    set({
      confessionTimestamps: [...recentTimestamps, now],
    });
  },

  getTimeUntilNextConfession: () => {
    const state = get();
    const now = Date.now();
    // Filter timestamps within the 24h window
    const recentTimestamps = state.confessionTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );
    // If under limit, can post now
    if (recentTimestamps.length < CONFESSION_RATE_LIMIT) {
      return 0;
    }
    // Find the oldest timestamp in the window - that's when the next slot opens
    const oldestTimestamp = Math.min(...recentTimestamps);
    const timeUntilExpiry = (oldestTimestamp + RATE_LIMIT_WINDOW_MS) - now;
    return Math.max(0, timeUntilExpiry);
  },

  getMyLatestConfession: (userId) => {
    const state = get();
    // Get all confessions by this user, sorted by createdAt descending
    const myConfessions = state.confessions
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return myConfessions[0] || null;
  },

  // ── Block Author (delegates to shared blockStore) ──

  blockAuthor: (authorId) => {
    // Delegate to shared blockStore (single source of truth)
    useBlockStore.getState().blockUser(authorId);
    if (__DEV__) console.log('[CONFESS] confess_blocked_user:', authorId);
  },

  isAuthorBlocked: (authorId) => {
    return useBlockStore.getState().isBlocked(authorId);
  },

  getExpiresAt: (confession) => {
    return confession.expiresAt || (confession.createdAt + CONFESSION_EXPIRY_MS);
  },

  purgeExpiredNow: (currentUserId) => {
    const state = get();
    const now = Date.now();

    // Find expired confessions (not owned by current user for public feed removal)
    const expiredConfessionIds: string[] = [];
    const expiredOtherUserIds: string[] = []; // Confessions from other users (remove completely)

    for (const c of state.confessions) {
      const expiresAt = c.expiresAt || (c.createdAt + CONFESSION_EXPIRY_MS);
      if (expiresAt <= now) {
        expiredConfessionIds.push(c.id);
        if (c.userId !== currentUserId) {
          expiredOtherUserIds.push(c.id);
        }
      }
    }

    if (expiredConfessionIds.length === 0) return;

    if (__DEV__) console.log('[CONFESS] purgeExpiredNow: found', expiredConfessionIds.length, 'expired confessions');

    // 1) Remove replies for ALL expired confessions
    const newReplies = { ...state.replies };
    for (const id of expiredConfessionIds) {
      delete newReplies[id];
    }

    // 2) Remove chats tied to expired confessions
    const expiredChatIds = state.chats
      .filter((ch) => expiredConfessionIds.includes(ch.confessionId))
      .map((ch) => ch.id);
    const newChats = state.chats.filter((ch) => !expiredConfessionIds.includes(ch.confessionId));

    // 3) Remove confessions from OTHER users (not OP's own) from main list
    // OP's confessions stay in store but are filtered out from public feeds by screens
    const newConfessions = state.confessions.filter((c) => !expiredOtherUserIds.includes(c.id));

    // 4) Clean up related DM threads via demoDmStore
    const dmStore = useDemoDmStore?.getState?.();
    const conversationIdsToDelete: string[] = [];
    for (const expiredId of expiredConfessionIds) {
      const convoId = state.confessionThreads[expiredId];
      if (convoId) {
        conversationIdsToDelete.push(convoId);
      }
    }
    if (conversationIdsToDelete.length > 0 && dmStore) {
      dmStore.deleteConversations(conversationIdsToDelete);
    }

    // 5) Clean up thread tracking
    const newThreads = { ...state.confessionThreads };
    for (const id of expiredConfessionIds) {
      delete newThreads[id];
    }

    // 6) Clean up user reactions for expired OTHER user confessions
    const newUserReactions = { ...state.userReactions };
    for (const id of expiredOtherUserIds) {
      delete newUserReactions[id];
    }

    set({
      confessions: newConfessions,
      replies: newReplies,
      chats: newChats,
      confessionThreads: newThreads,
      userReactions: newUserReactions,
    });

    if (__DEV__) console.log('[CONFESS] purgeExpiredNow: cleaned up', expiredConfessionIds.length, 'confessions,', expiredChatIds.length, 'chats');
  },
}));
