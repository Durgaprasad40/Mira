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

interface DemoDmState {
  /** conversationId → ordered message array */
  conversations: Record<string, DemoDmMessage[]>;

  /**
   * Seed a conversation with initial messages if it hasn't been
   * seeded yet.  Calling this multiple times is safe — it only
   * writes if the key is absent.
   */
  seedConversation: (id: string, seed: DemoDmMessage[]) => void;

  /** Append a new message to a conversation. */
  addMessage: (id: string, msg: DemoDmMessage) => void;
}

export const useDemoDmStore = create<DemoDmState>()(
  persist(
    (set, get) => ({
      conversations: {},

      seedConversation: (id, seed) => {
        // Only seed once — existing data takes precedence
        if (get().conversations[id]) return;
        set((s) => ({
          conversations: { ...s.conversations, [id]: seed },
        }));
      },

      addMessage: (id, msg) =>
        set((s) => ({
          conversations: {
            ...s.conversations,
            [id]: [...(s.conversations[id] ?? []), msg],
          },
        })),
    }),
    {
      name: 'demo-dm-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
