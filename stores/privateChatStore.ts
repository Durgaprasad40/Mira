import { create } from 'zustand';
import type { IncognitoConversation, IncognitoMessage } from '@/types';
import {
  DEMO_INCOGNITO_CONVERSATIONS,
  DEMO_INCOGNITO_MESSAGES,
} from '@/lib/demoData';

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

  // Conversations (demo-seeded)
  conversations: IncognitoConversation[];
  messages: Record<string, IncognitoMessage[]>; // keyed by conversationId
  addMessage: (conversationId: string, msg: IncognitoMessage) => void;
  createConversation: (convo: IncognitoConversation) => void;

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

// Pre-seed some unlocked users from demo conversations
const DEMO_UNLOCKED: UnlockedUser[] = DEMO_INCOGNITO_CONVERSATIONS.map((c) => ({
  id: c.participantId,
  username: c.participantName,
  photoUrl: c.participantPhotoUrl,
  age: c.participantAge,
  source: c.connectionSource === 'tod' || c.connectionSource === 'desire' ? 'tod' : 'room',
  unlockedAt: c.lastMessageAt,
}));

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

export const usePrivateChatStore = create<PrivateChatState>((set, get) => ({
  unlockedUsers: DEMO_UNLOCKED,
  isUnlocked: (userId) => get().unlockedUsers.some((u) => u.id === userId),

  unlockUser: (user) =>
    set((s) => {
      if (s.unlockedUsers.some((u) => u.id === user.id)) return s;
      return { unlockedUsers: [...s.unlockedUsers, user] };
    }),

  conversations: [...DEMO_INCOGNITO_CONVERSATIONS],
  messages: groupMessages(DEMO_INCOGNITO_MESSAGES),

  addMessage: (conversationId, msg) =>
    set((s) => {
      const existing = s.messages[conversationId] || [];
      const convos = s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: msg.content, lastMessageAt: msg.createdAt }
          : c
      );
      return {
        messages: { ...s.messages, [conversationId]: [...existing, msg] },
        conversations: convos,
      };
    }),

  createConversation: (convo) =>
    set((s) => {
      if (s.conversations.some((c) => c.id === convo.id)) return s;
      return { conversations: [convo, ...s.conversations] };
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
      return {
        blockedUserIds: [...s.blockedUserIds, userId],
        conversations: s.conversations.filter((c) => c.participantId !== userId),
        unlockedUsers: s.unlockedUsers.filter((u) => u.id !== userId),
      };
    }),
  unblockUser: (userId) =>
    set((s) => ({
      blockedUserIds: s.blockedUserIds.filter((id) => id !== userId),
    })),
  isBlocked: (userId) => get().blockedUserIds.includes(userId),
}));
