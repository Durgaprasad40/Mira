import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Confession,
  ConfessionReactionType,
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
} from '@/lib/demoData';

interface ConfessionState {
  confessions: Confession[];
  userReactions: Record<string, ConfessionReactionType[]>;
  chats: ConfessionChat[];
  secretCrushes: SecretCrush[];
  reportedIds: string[];
  blockedIds: string[];
  seeded: boolean;

  seedConfessions: () => void;
  addConfession: (confession: Confession) => void;
  toggleReaction: (confessionId: string, type: ConfessionReactionType) => void;
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
        if (get().seeded) return;
        // Backfill revealPolicy and mutualRevealStatus on demo data
        const confessions = DEMO_CONFESSIONS.map((c) => ({
          ...c,
          revealPolicy: c.revealPolicy || ('never' as const),
        }));
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

      toggleReaction: (confessionId, type) => {
        set((state) => {
          const current = state.userReactions[confessionId] || [];
          const hasReaction = current.includes(type);
          const newReactions = hasReaction
            ? current.filter((r) => r !== type)
            : [...current, type];

          const newUserReactions = { ...state.userReactions };
          if (newReactions.length === 0) {
            delete newUserReactions[confessionId];
          } else {
            newUserReactions[confessionId] = newReactions;
          }

          const confessions = state.confessions.map((c) => {
            if (c.id !== confessionId) return c;
            const reactions = { ...(c.reactions || { relatable: 0, feel_you: 0, bold: 0, curious: 0 }) };
            reactions[type] = hasReaction
              ? Math.max(0, reactions[type] - 1)
              : reactions[type] + 1;
            const reactionCount = hasReaction
              ? Math.max(0, c.reactionCount - 1)
              : c.reactionCount + 1;
            return { ...c, reactions, reactionCount };
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
