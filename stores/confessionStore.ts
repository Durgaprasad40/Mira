import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Confession,
  ConfessionChat,
  ConfessionChatMessage,
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

interface ConfessionState {
  confessions: Confession[];
  userReactions: Record<string, string | null>; // confessionId → emoji string (one per user)
  chats: ConfessionChat[];
  secretCrushes: SecretCrush[];
  reportedIds: string[];
  blockedIds: string[];
  seeded: boolean;

  seedConfessions: () => void;
  addConfession: (confession: Confession) => void;
  toggleReaction: (confessionId: string, emoji: string) => void;
  addChat: (chat: ConfessionChat) => void;
  addChatMessage: (chatId: string, message: ConfessionChatMessage) => void;
  addSecretCrush: (crush: SecretCrush) => void;
  reportConfession: (confessionId: string) => void;
  blockUser: (userId: string) => void;
  revealCrush: (crushId: string) => void;

  // Mutual Reveal
  agreeMutualReveal: (chatId: string, userId: string) => void;
  declineMutualReveal: (chatId: string, userId: string) => void;

  // Time-Locked Reveal
  setTimedReveal: (confessionId: string, option: TimedRevealOption, targetUserId?: string) => void;
  cancelTimedReveal: (confessionId: string) => void;
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
      chats: [],
      secretCrushes: [],
      reportedIds: [],
      blockedIds: [],
      seeded: false,

      seedConfessions: () => {
        if (get().seeded) {
          // Migrate persisted confessions: fix old reaction keys + backfill replyPreviews
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
            return updated;
          });
          const changed = migrated.some((c, i) => c !== current[i]);
          if (changed) {
            set({ confessions: migrated });
          }
          return;
        }
        // Backfill revealPolicy, replyPreviews, and mutualRevealStatus on demo data
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
          });
        });
        const chats = DEMO_CONFESSION_CHATS.map((ch) => ({
          ...ch,
          mutualRevealStatus: ch.mutualRevealStatus || ('none' as MutualRevealStatus),
        }));
        set({
          confessions,
          userReactions: DEMO_CONFESSION_USER_REACTIONS,
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

      toggleReaction: (confessionId, emoji) => {
        set((state) => {
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

          return { userReactions: newUserReactions, confessions };
        });
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
      },

      reportConfession: (confessionId) => {
        set((state) => ({
          reportedIds: [...state.reportedIds, confessionId],
          confessions: state.confessions.filter((c) => c.id !== confessionId),
        }));
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

      // ── Mutual Reveal ──
      agreeMutualReveal: (chatId, userId) => {
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
    }),
    {
      name: 'confession-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        confessions: state.confessions,
        userReactions: state.userReactions,
        chats: state.chats,
        secretCrushes: state.secretCrushes,
        reportedIds: state.reportedIds,
        blockedIds: state.blockedIds,
        seeded: state.seeded,
      }),
    }
  )
);
