import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IncognitoConversation, IncognitoMessage } from '@/types';
// NOTE: Phase-2 no longer seeds demo conversations/messages.
// Conversations are created dynamically via Desire Land matches.
// Messages are created when users actually chat.

/** Tracks which users are unlocked for private chat (via accepted T&D or room interaction) */
interface UnlockedUser {
  id: string;
  username: string;
  photoUrl: string;
  age: number;
  source: 'tod' | 'room';
  unlockedAt: number;
}

/** A pending dare sent TO the current user (sender hidden) */
interface PendingDare {
  id: string;
  senderId: string;       // hidden from UI until accepted
  senderUsername: string;  // hidden from UI until accepted
  senderPhotoUrl: string;  // hidden from UI until accepted
  senderAge: number;
  type: 'truth' | 'dare';
  content: string;
  createdAt: number;
}

/** A dare sent BY the current user */
interface SentDare {
  id: string;
  targetId: string;
  targetUsername: string;
  type: 'truth' | 'dare';
  content: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

interface PrivateChatState {
  // Unlock tracking
  unlockedUsers: UnlockedUser[];
  isUnlocked: (userId: string) => boolean;
  unlockUser: (user: UnlockedUser) => void;

  // Conversations (created dynamically via matches)
  conversations: IncognitoConversation[];
  messages: Record<string, IncognitoMessage[]>; // keyed by conversationId
  addMessage: (conversationId: string, msg: IncognitoMessage) => void;
  createConversation: (convo: IncognitoConversation) => void;
  /** Mark a conversation as read (clears unread count) */
  markAsRead: (conversationId: string) => void;
  /** Delete a single message by ID */
  deleteMessage: (conversationId: string, messageId: string) => void;
  /** Remove a conversation and its messages (for unmatch/uncrush) */
  removeConversation: (conversationId: string) => void;
  /** Remove a conversation by participant ID (for block/unmatch) */
  removeConversationByParticipant: (participantId: string) => void;

  // Truth or Dare
  pendingDares: PendingDare[];
  sentDares: SentDare[];
  addPendingDare: (dare: PendingDare) => void;
  sendDare: (dare: SentDare) => void;
  acceptDare: (dareId: string) => void;
  declineDare: (dareId: string) => void;

  // Block/Report
  blockedUserIds: string[];
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  isBlocked: (userId: string) => boolean;

  // Secure Photo viewing (Phase-2 parity with Phase-1)
  markSecurePhotoViewed: (conversationId: string, messageId: string) => void;
  markSecurePhotoExpired: (conversationId: string, messageId: string) => void;

  // Auto-cleanup: Remove messages past their deleteAt timestamp
  pruneDeletedMessages: () => void;
}

// Group demo messages by conversationId
function groupMessages(msgs: IncognitoMessage[]): Record<string, IncognitoMessage[]> {
  const grouped: Record<string, IncognitoMessage[]> = {};
  for (const m of msgs) {
    if (!grouped[m.conversationId]) grouped[m.conversationId] = [];
    grouped[m.conversationId].push(m);
  }
  return grouped;
}

// NOTE: Phase-2 unlocked users are now created dynamically when:
// - User accepts a Truth-or-Dare
// - User matches via Desire Land swipe/super-like
// No pre-seeded unlocked users.

// Pre-seed pending dares for demo
const DEMO_PENDING_DARES: PendingDare[] = [
  {
    id: 'pd_1',
    senderId: 'inc_9',
    senderUsername: 'Electric_Sage',
    senderPhotoUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400',
    senderAge: 26,
    type: 'truth',
    content: 'What is the most spontaneous thing you have ever done?',
    createdAt: Date.now() - 1000 * 60 * 15,
  },
  {
    id: 'pd_2',
    senderId: 'inc_13',
    senderUsername: 'Rebel_Heart',
    senderPhotoUrl: 'https://images.unsplash.com/photo-1464863979621-258859e62245?w=400',
    senderAge: 24,
    type: 'dare',
    content: 'Share a song that perfectly describes your current mood!',
    createdAt: Date.now() - 1000 * 60 * 45,
  },
];

export const usePrivateChatStore = create<PrivateChatState>()(
  persist(
    (set, get) => ({
  unlockedUsers: [],
  isUnlocked: (userId) => get().unlockedUsers.some((u) => u.id === userId),

  unlockUser: (user) =>
    set((s) => {
      if (s.unlockedUsers.some((u) => u.id === user.id)) return s;
      return { unlockedUsers: [...s.unlockedUsers, user] };
    }),

  conversations: [],
  messages: {},

  addMessage: (conversationId, msg) =>
    set((s) => {
      const existing = s.messages[conversationId] || [];

      // GOAL D2: If this is a normal user message (not ToD/system),
      // schedule deletion for any ToD messages that don't have deleteAt yet
      const isNormalMessage = msg.senderId !== 'tod' && msg.senderId !== 'system';
      const updatedExisting = isNormalMessage
        ? existing.map((m) => {
            // Only ToD messages without deleteAt get scheduled
            if (m.senderId === 'tod' && !m.deleteAt) {
              return { ...m, deleteAt: Date.now() + 3_600_000 }; // 1 hour
            }
            return m;
          })
        : existing;

      const convos = s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: msg.content, lastMessageAt: msg.createdAt }
          : c
      );
      return {
        messages: { ...s.messages, [conversationId]: [...updatedExisting, msg] },
        conversations: convos,
      };
    }),

  createConversation: (convo) =>
    set((s) => {
      if (s.conversations.some((c) => c.id === convo.id)) return s;
      return { conversations: [convo, ...s.conversations] };
    }),

  markAsRead: (conversationId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
    })),

  deleteMessage: (conversationId, messageId) =>
    set((s) => {
      const msgs = s.messages[conversationId];
      if (!msgs) return s;
      const filtered = msgs.filter((m) => m.id !== messageId);
      return { messages: { ...s.messages, [conversationId]: filtered } };
    }),

  removeConversation: (conversationId) =>
    set((s) => {
      const { [conversationId]: removed, ...remainingMessages } = s.messages;
      return {
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        messages: remainingMessages,
      };
    }),

  removeConversationByParticipant: (participantId) =>
    set((s) => {
      const conversationIds = s.conversations
        .filter((c) => c.participantId === participantId)
        .map((c) => c.id);
      const remainingMessages = { ...s.messages };
      for (const id of conversationIds) {
        delete remainingMessages[id];
      }
      return {
        conversations: s.conversations.filter((c) => c.participantId !== participantId),
        messages: remainingMessages,
        unlockedUsers: s.unlockedUsers.filter((u) => u.id !== participantId),
      };
    }),

  pendingDares: DEMO_PENDING_DARES,
  sentDares: [],

  addPendingDare: (dare) =>
    set((s) => ({ pendingDares: [dare, ...s.pendingDares] })),

  sendDare: (dare) =>
    set((s) => ({ sentDares: [dare, ...s.sentDares] })),

  acceptDare: (dareId) =>
    set((s) => {
      const dare = s.pendingDares.find((d) => d.id === dareId);
      if (!dare) return s;

      // Remove from pending
      const pendingDares = s.pendingDares.filter((d) => d.id !== dareId);

      // Unlock the sender
      const alreadyUnlocked = s.unlockedUsers.some((u) => u.id === dare.senderId);
      const unlockedUsers = alreadyUnlocked
        ? s.unlockedUsers
        : [
            ...s.unlockedUsers,
            {
              id: dare.senderId,
              username: dare.senderUsername,
              photoUrl: dare.senderPhotoUrl,
              age: dare.senderAge,
              source: 'tod' as const,
              unlockedAt: Date.now(),
            },
          ];

      // Create conversation if not exists
      const convoId = `ic_tod_${dare.senderId}`;
      const alreadyHasConvo = s.conversations.some(
        (c) => c.participantId === dare.senderId
      );
      const conversations = alreadyHasConvo
        ? s.conversations
        : [
            {
              id: convoId,
              participantId: dare.senderId,
              participantName: dare.senderUsername,
              participantAge: dare.senderAge,
              participantPhotoUrl: dare.senderPhotoUrl,
              lastMessage: `T&D accepted! Start chatting.`,
              lastMessageAt: Date.now(),
              unreadCount: 0,
              connectionSource: 'tod' as const,
            },
            ...s.conversations,
          ];

      // Seed first message
      const messages = { ...s.messages };
      if (!alreadyHasConvo) {
        messages[convoId] = [
          {
            id: `im_accept_${Date.now()}`,
            conversationId: convoId,
            senderId: 'system',
            content: `You accepted a ${dare.type} from ${dare.senderUsername}. Say hi!`,
            createdAt: Date.now(),
            isRead: true,
          },
        ];
      }

      return { pendingDares, unlockedUsers, conversations, messages };
    }),

  declineDare: (dareId) =>
    set((s) => ({
      pendingDares: s.pendingDares.filter((d) => d.id !== dareId),
    })),

  blockedUserIds: [],
  blockUser: (userId) =>
    set((s) => {
      if (s.blockedUserIds.includes(userId)) return s;
      // Find conversation IDs for this user to remove their messages
      const conversationIds = s.conversations
        .filter((c) => c.participantId === userId)
        .map((c) => c.id);
      const remainingMessages = { ...s.messages };
      for (const id of conversationIds) {
        delete remainingMessages[id];
      }
      return {
        blockedUserIds: [...s.blockedUserIds, userId],
        conversations: s.conversations.filter((c) => c.participantId !== userId),
        messages: remainingMessages,
        unlockedUsers: s.unlockedUsers.filter((u) => u.id !== userId),
      };
    }),
  unblockUser: (userId) =>
    set((s) => ({
      blockedUserIds: s.blockedUserIds.filter((id) => id !== userId),
    })),
  isBlocked: (userId) => get().blockedUserIds.includes(userId),

  // Secure Photo viewing: Set viewedAt and timerEndsAt on first open
  markSecurePhotoViewed: (conversationId, messageId) =>
    set((s) => {
      const msgs = s.messages[conversationId];
      if (!msgs) return s;

      const updated = msgs.map((m) => {
        if (m.id !== messageId) return m;
        // Already viewed - don't reset timer
        if (m.viewedAt || m.timerEndsAt) return m;

        const timer = m.protectedMedia?.timer ?? 0;
        return {
          ...m,
          viewedAt: Date.now(),
          timerEndsAt: timer > 0 ? Date.now() + timer * 1000 : undefined,
        };
      });

      return { messages: { ...s.messages, [conversationId]: updated } };
    }),

  // Secure Photo expiry: Mark as expired and schedule deletion in 1 minute
  markSecurePhotoExpired: (conversationId, messageId) =>
    set((s) => {
      const msgs = s.messages[conversationId];
      if (!msgs) return s;

      const now = Date.now();
      const updated = msgs.map((m) => {
        if (m.id !== messageId) return m;
        // Already expired - don't reset timestamps
        if (m.isExpired) return m;
        return {
          ...m,
          isExpired: true,
          expiredAt: now,
          deleteAt: now + 60_000, // 1 minute after expiry
        };
      });

      return { messages: { ...s.messages, [conversationId]: updated } };
    }),

  // Auto-cleanup: Remove messages past their deleteAt timestamp
  pruneDeletedMessages: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;

      const prunedMessages: Record<string, IncognitoMessage[]> = {};
      for (const [convId, msgs] of Object.entries(s.messages)) {
        const filtered = msgs.filter((m) => {
          if (m.deleteAt && m.deleteAt <= now) {
            changed = true;
            return false; // Remove this message
          }
          return true;
        });
        prunedMessages[convId] = filtered;
      }

      if (!changed) return s;

      if (__DEV__) {
        const totalBefore = Object.values(s.messages).flat().length;
        const totalAfter = Object.values(prunedMessages).flat().length;
        console.log(`[Phase2Prune] Removed ${totalBefore - totalAfter} expired messages`);
      }

      return { messages: prunedMessages };
    }),
    }),
    {
      name: 'mira-private-chat-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        unlockedUsers: state.unlockedUsers,
        conversations: state.conversations,
        messages: state.messages,
        pendingDares: state.pendingDares,
        sentDares: state.sentDares,
        blockedUserIds: state.blockedUserIds,
      }),
      // Auto-cleanup on rehydrate: remove messages past deleteAt
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Delay slightly to ensure store is fully initialized
          setTimeout(() => {
            state.pruneDeletedMessages();
          }, 100);
        }
      },
    }
  )
);

/**
 * DEV ONLY: Full Phase 2 "Start Fresh" reset for testing.
 * Clears ALL Phase 2 state: conversations, messages, metadata, unread counts, unlocked users.
 */
export function resetPrivateChatForTesting(): void {
  const stateBefore = usePrivateChatStore.getState();
  const convoBefore = stateBefore.conversations.length;
  const unreadBefore = stateBefore.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const messageThreads = Object.keys(stateBefore.messages).length;
  const unlockedBefore = stateBefore.unlockedUsers.length;

  usePrivateChatStore.setState({
    conversations: [],
    messages: {},
    unlockedUsers: [],
    pendingDares: [],
    sentDares: [],
    blockedUserIds: [],
  });

  if (__DEV__) {
    console.log(
      `[Phase2Reset] BEFORE: conversations=${convoBefore} unread=${unreadBefore} ` +
      `messageThreads=${messageThreads} unlockedUsers=${unlockedBefore}`
    );
    console.log(`[Phase2Reset] AFTER: conversations=0 unread=0 messageThreads=0 unlockedUsers=0`);
  }
}
