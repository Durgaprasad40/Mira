import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Confession,
  ConfessionChat,
  ConfessionChatMessage,
  ConfessionReply,
  SecretCrush,
  MutualRevealStatus,
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
import { useDemoStore, DemoMatch } from '@/stores/demoStore';
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

// Track confession-based threads to prevent duplicates (confessionId → conversationId)
// This is stored separately to support idempotent thread creation
interface ConfessionThreads {
  [confessionId: string]: string; // conversationId
}

// Rate limiting constants
const CONFESSION_RATE_LIMIT = 5; // Max confessions per 24 hours
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
  confessionThreads: ConfessionThreads; // Track threads created from confessions

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

  // Mutual Reveal
  agreeMutualReveal: (chatId: string, userId: string) => void;
  declineMutualReveal: (chatId: string, userId: string) => void;

  // Time-Locked Reveal
  setTimedReveal: (confessionId: string, option: TimedRevealOption, targetUserId?: string) => void;
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
  /** Connect to a confession (tagged user starts chat with author) */
  connectToConfession: (confessionId: string, currentUserId: string) => boolean;
  /** Check if a confession is connected */
  isConfessionConnected: (confessionId: string) => boolean;
  /** Track connected confessions */
  connectedConfessionIds: string[];

  /** Track skip actions during reveal (chatId -> [userIds who skipped]) */
  revealSkippedChats: Record<string, string[]>;

  /** Mark that a user skipped during active reveal (hides buttons, keeps profile viewable) */
  markRevealSkipped: (chatId: string, userId: string) => void;
  /** Check if user has skipped a reveal */
  hasSkippedReveal: (chatId: string, userId: string) => boolean;
  /** Create a permanent match from confession reveal (Like action) */
  createRevealMatch: (confessionId: string, chatId: string, fromUserId: string, toUserId: string) => void;

  // Rate limiting
  /** Check if user can post a new confession (rate limit check) */
  canPostConfession: () => boolean;
  /** Get count of confessions posted in last 24h */
  getConfessionCountToday: () => number;
  /** Record a confession timestamp (called when posting) */
  recordConfessionTimestamp: () => void;

  // Block author (hide their confessions from me)
  /** Block an author - hide their confessions from current user */
  blockAuthor: (authorId: string) => void;
  /** Check if an author is blocked */
  isAuthorBlocked: (authorId: string) => boolean;

  /** Purge expired confessions (24h) - removes from public feeds, deletes replies/chats */
  purgeExpiredNow: (currentUserId: string) => void;
  /** Get expiry time for a confession */
  getExpiresAt: (confession: Confession) => number;
}

function computeTimedRevealAt(option: TimedRevealOption): number | null {
  if (option === 'never') return null;
  const hours = option === '24h' ? 24 : 48;
  return Date.now() + hours * 60 * 60 * 1000;
}

export const useConfessionStore = create<ConfessionState>()(
  persist(
    (set, get) => ({
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
      connectedConfessionIds: [],
      confessionTimestamps: [],
      revealSkippedChats: {},

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
        // Backfill revealPolicy, replyPreviews, expiresAt, and mutualRevealStatus on demo data
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
        const chats = DEMO_CONFESSION_CHATS.map((ch) => ({
          ...ch,
          mutualRevealStatus: ch.mutualRevealStatus || ('none' as MutualRevealStatus),
        }));
        set({
          confessions,
          userReactions: DEMO_CONFESSION_USER_REACTIONS,
          replies: { ...DEMO_CONFESSION_REPLIES },
          chats,
          secretCrushes: DEMO_SECRET_CRUSHES,
          seeded: true,
        });
      },

      addConfession: (confession) => {
        set((state) => ({
          confessions: [confession, ...state.confessions],
        }));
      },

      toggleReaction: (confessionId, emoji, userId) => {
        const state = get();
        const currentEmoji = state.userReactions[confessionId];
        const newUserReactions = { ...state.userReactions };

        let countDelta = 0;
        let oldEmoji: string | null = null;
        let isNewReaction = false;

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
          isNewReaction = true;
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

        // Check if we should create a confession-based thread
        // Only when: 1) new reaction 2) tagged confession 3) liker is the tagged user
        let chatUnlocked = false;
        const confession = state.confessions.find((c) => c.id === confessionId);
        if (
          isNewReaction &&
          userId &&
          confession?.targetUserId &&
          userId === confession.targetUserId &&
          !state.confessionThreads[confessionId] // idempotency check
        ) {
          // Create a confession-based thread
          const convoId = `demo_convo_confession_${confessionId}`;
          const matchId = `match_confession_${confessionId}`;
          const dmStore = useDemoDmStore.getState();
          const demoStore = useDemoStore.getState();

          const otherUserName = confession.isAnonymous
            ? 'Anonymous Confessor'
            : (confession.authorName || 'Someone');

          // Seed conversation with initial system message so it shows in Messages
          const now = Date.now();
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
          dmStore.seedConversation(convoId, [{
            _id: `sys_${confessionId}`,
            content: `💌 You liked their confession: "${confession.text.slice(0, 50)}${confession.text.length > 50 ? '...' : ''}"`,
            type: 'system',
            senderId: 'system',
            createdAt: now,
          }]);
          dmStore.setMeta(convoId, {
            otherUser: {
              id: confession.userId,
              name: otherUserName,
              lastActive: now,
              isVerified: false,
            },
            isPreMatch: true,
            isConfessionChat: true, // Confession-based thread
            expiresAt: now + TWENTY_FOUR_HOURS, // Expires in 24h
          });

          // Add to matches so it appears in Messages list
          const newMatch: DemoMatch = {
            id: matchId,
            conversationId: convoId,
            otherUser: {
              id: confession.userId,
              name: otherUserName,
              photoUrl: confession.authorPhotoUrl || '',
              lastActive: now,
              isVerified: false,
            },
            lastMessage: {
              content: `💌 Confession thread`,
              type: 'system',
              senderId: 'system',
              createdAt: now,
            },
            unreadCount: 0,
            isPreMatch: true,
          };
          demoStore.addMatch(newMatch);

          // Track this thread to prevent duplicates
          set({
            userReactions: newUserReactions,
            confessions,
            confessionThreads: { ...state.confessionThreads, [confessionId]: convoId },
          });
          chatUnlocked = true;
        } else {
          set({ userReactions: newUserReactions, confessions });
        }

        return { chatUnlocked };
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
        if (__DEV__) console.log('[CONFESS] addReply:', { confessionId, replyId: reply.id });
        set((state) => {
          const currentReplies = state.replies[confessionId] || [];
          const newReplies = [...currentReplies, reply];

          // Update the confession's replyCount and replyPreviews
          const updatedConfessions = state.confessions.map((c) => {
            if (c.id !== confessionId) return c;
            const replyPreviews = newReplies.slice(-2).map((r) => ({
              text: r.text,
              isAnonymous: r.isAnonymous,
              type: r.type || 'text',
              createdAt: r.createdAt,
            }));
            return {
              ...c,
              replyCount: newReplies.length,
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
          const newReplies = currentReplies.filter((r) => r.id !== replyId);

          // Update the confession's replyCount and replyPreviews
          const updatedConfessions = state.confessions.map((c) => {
            if (c.id !== confessionId) return c;
            const replyPreviews = newReplies.slice(-2).map((r) => ({
              text: r.text,
              isAnonymous: r.isAnonymous,
              type: r.type || 'text',
              createdAt: r.createdAt,
            }));
            return {
              ...c,
              replyCount: newReplies.length,
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

      // ── Mutual Reveal ──
      agreeMutualReveal: (chatId, userId) => {
        // Guard: no-op if chat is expired (expiry overrides pending reveal)
        const now = Date.now();
        const targetChat = get().chats.find((c) => c.id === chatId);
        if (!targetChat || now > targetChat.expiresAt) {
          if (__DEV__) console.log('[CONFESS] agreeMutualReveal: skipped (chat expired or not found)');
          return;
        }

        set((state) => ({
          chats: state.chats.map((ch) => {
            if (ch.id !== chatId) return ch;
            if (ch.mutualRevealStatus === 'declined') return ch; // permanently blocked

            const isInitiator = ch.initiatorId === userId;
            const isResponder = ch.responderId === userId;
            if (!isInitiator && !isResponder) return ch;

            let newStatus: MutualRevealStatus = ch.mutualRevealStatus;

            if (isInitiator) {
              if (ch.mutualRevealStatus === 'none') {
                newStatus = 'initiator_agreed';
              } else if (ch.mutualRevealStatus === 'responder_agreed') {
                newStatus = 'both_agreed';
              }
            } else if (isResponder) {
              if (ch.mutualRevealStatus === 'none') {
                newStatus = 'responder_agreed';
              } else if (ch.mutualRevealStatus === 'initiator_agreed') {
                newStatus = 'both_agreed';
              }
            }

            return {
              ...ch,
              mutualRevealStatus: newStatus,
              isRevealed: newStatus === 'both_agreed',
            };
          }),
        }));
      },

      declineMutualReveal: (chatId, userId) => {
        // Guard: no-op if chat is expired (expiry overrides pending reveal)
        const now = Date.now();
        const targetChat = get().chats.find((c) => c.id === chatId);
        if (!targetChat || now > targetChat.expiresAt) {
          if (__DEV__) console.log('[CONFESS] declineMutualReveal: skipped (chat expired or not found)');
          return;
        }

        set((state) => ({
          chats: state.chats.map((ch) =>
            ch.id === chatId
              ? { ...ch, mutualRevealStatus: 'declined' as MutualRevealStatus, declinedBy: userId }
              : ch
          ),
        }));
      },

      // ── Time-Locked Reveal ──
      setTimedReveal: (confessionId, option, _targetUserId) => {
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
        const dmStore = useDemoDmStore.getState();
        const confessionThreads = get().confessionThreads;
        const conversationIdsToDelete: string[] = [];
        for (const expiredId of expiredIds) {
          const convoId = confessionThreads[expiredId];
          if (convoId) {
            conversationIdsToDelete.push(convoId);
          }
        }
        if (conversationIdsToDelete.length > 0) {
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
        const dmStore = useDemoDmStore.getState();
        dmStore.deleteConversations(conversationIds);
      },

      deleteConfession: (confessionId) => {
        const state = get();
        // Remove from confessions array
        const confessions = state.confessions.filter((c) => c.id !== confessionId);
        // Remove user reaction for this confession
        const userReactions = { ...state.userReactions };
        delete userReactions[confessionId];
        // Remove confession thread if exists
        const confessionThreads = { ...state.confessionThreads };
        const convoId = confessionThreads[confessionId];
        delete confessionThreads[confessionId];
        // Update state
        set({ confessions, userReactions, confessionThreads });
        // Clean up related DM thread if it existed
        if (convoId) {
          const dmStore = useDemoDmStore.getState();
          dmStore.deleteConversations([convoId]);
        }
      },

      isConfessionConnected: (confessionId) => {
        return get().connectedConfessionIds.includes(confessionId);
      },

      connectToConfession: (confessionId, currentUserId) => {
        const state = get();
        const confession = state.confessions.find((c) => c.id === confessionId);

        // Hard gate: only tagged user can connect
        if (!confession || confession.targetUserId !== currentUserId) {
          return false;
        }

        // Idempotency: already connected?
        if (state.connectedConfessionIds.includes(confessionId)) {
          return true; // Already connected, don't create duplicate
        }

        // Create a conversation thread in the DM store
        const convoId = `demo_convo_connect_${confessionId}`;
        const dmStore = useDemoDmStore.getState();
        const demoStore = useDemoStore.getState();
        const now = Date.now();
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

        const otherUserName = confession.isAnonymous
          ? 'Anonymous Confessor'
          : (confession.authorName || 'Someone');

        // Seed conversation with initial system message
        dmStore.seedConversation(convoId, [{
          _id: `sys_connect_${confessionId}`,
          content: `💬 You connected with ${otherUserName} on their confession`,
          type: 'system',
          senderId: 'system',
          createdAt: now,
        }]);

        dmStore.setMeta(convoId, {
          otherUser: {
            id: confession.userId,
            name: otherUserName,
            lastActive: now,
            isVerified: false,
          },
          isPreMatch: true,
          isConfessionChat: true,
          expiresAt: now + TWENTY_FOUR_HOURS,
        });

        // Add to matches so it appears in Messages list
        const newMatch: DemoMatch = {
          id: `match_connect_${confessionId}`,
          conversationId: convoId,
          otherUser: {
            id: confession.userId,
            name: otherUserName,
            photoUrl: confession.authorPhotoUrl || '',
            lastActive: now,
            isVerified: false,
          },
          lastMessage: {
            content: `💬 Connected via confession`,
            type: 'system',
            senderId: 'system',
            createdAt: now,
          },
          unreadCount: 0,
          isPreMatch: true,
        };
        demoStore.addMatch(newMatch);

        // Mark as connected
        set({
          connectedConfessionIds: [...state.connectedConfessionIds, confessionId],
        });

        return true;
      },

      // ── Reveal Actions (Like/Skip during active mutual reveal) ──

      markRevealSkipped: (chatId, userId) => {
        set((state) => {
          const existing = state.revealSkippedChats[chatId] || [];
          if (existing.includes(userId)) return state; // Already skipped
          return {
            revealSkippedChats: {
              ...state.revealSkippedChats,
              [chatId]: [...existing, userId],
            },
          };
        });
        if (__DEV__) console.log('[CONFESS] markRevealSkipped:', { chatId, userId });
      },

      hasSkippedReveal: (chatId, userId) => {
        const skipped = get().revealSkippedChats[chatId] || [];
        return skipped.includes(userId);
      },

      createRevealMatch: (confessionId, chatId, fromUserId, toUserId) => {
        const state = get();
        const confession = state.confessions.find((c) => c.id === confessionId);
        if (!confession) return;

        const dmStore = useDemoDmStore.getState();
        const demoStore = useDemoStore.getState();
        const now = Date.now();

        // Determine the other user's display name
        // If fromUserId is the tagged person, toUserId is the confessor
        const isFromTagged = confession.targetUserId === fromUserId;
        const otherUserId = isFromTagged ? confession.userId : confession.targetUserId;
        const otherUserName = isFromTagged
          ? (confession.isAnonymous ? 'Confessor' : (confession.authorName || 'Someone'))
          : (confession.targetUserName || 'Someone');

        // Create a PERMANENT conversation (no expiry)
        const convoId = `demo_convo_reveal_match_${confessionId}_${fromUserId}`;
        const matchId = `match_reveal_${confessionId}_${fromUserId}`;

        // Check if match already exists (idempotency)
        const existingMatch = demoStore.matches.find((m) => m.id === matchId);
        if (existingMatch) {
          if (__DEV__) console.log('[CONFESS] createRevealMatch: match already exists');
          return;
        }

        // Seed conversation with system message about the match origin
        dmStore.seedConversation(convoId, [{
          _id: `sys_reveal_${confessionId}`,
          content: `💕 You matched through Confessions! Start chatting...`,
          type: 'system',
          senderId: 'system',
          createdAt: now,
        }]);

        // Set meta WITHOUT expiry (permanent match)
        dmStore.setMeta(convoId, {
          otherUser: {
            id: otherUserId || '',
            name: otherUserName,
            lastActive: now,
            isVerified: confession.isAnonymous ? false : true,
          },
          isPreMatch: false, // This is a REAL match now
          isConfessionChat: false, // No longer a confession thread, it's a real match
          // No expiresAt - permanent thread
        });

        // Add to matches
        const newMatch: DemoMatch = {
          id: matchId,
          conversationId: convoId,
          otherUser: {
            id: otherUserId || '',
            name: otherUserName,
            photoUrl: confession.authorPhotoUrl || '',
            lastActive: now,
            isVerified: false,
          },
          lastMessage: {
            content: `💕 Matched via Confessions`,
            type: 'system',
            senderId: 'system',
            createdAt: now,
          },
          unreadCount: 0,
          isPreMatch: false, // Real match
        };
        demoStore.addMatch(newMatch);

        if (__DEV__) console.log('[CONFESS] createRevealMatch: created permanent match', { matchId, confessionId });
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
        const dmStore = useDemoDmStore.getState();
        const conversationIdsToDelete: string[] = [];
        for (const expiredId of expiredConfessionIds) {
          const convoId = state.confessionThreads[expiredId];
          if (convoId) {
            conversationIdsToDelete.push(convoId);
          }
        }
        if (conversationIdsToDelete.length > 0) {
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
    }),
    {
      name: 'confession-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        confessions: state.confessions,
        userReactions: state.userReactions,
        replies: state.replies,
        chats: state.chats,
        secretCrushes: state.secretCrushes,
        reportedIds: state.reportedIds,
        blockedIds: state.blockedIds,
        seeded: state.seeded,
        confessionThreads: state.confessionThreads,
        seenTaggedConfessionIds: state.seenTaggedConfessionIds,
        connectedConfessionIds: state.connectedConfessionIds,
        confessionTimestamps: state.confessionTimestamps,
        revealSkippedChats: state.revealSkippedChats,
      }),
    }
  )
);
