/**
 * demoChatRoomStore — persists demo chat-room messages so they survive
 * navigation and app restarts.
 *
 * Follows the same pattern as demoDmStore: lazy-seed per room, then
 * append user-sent messages via addMessage().
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DemoChatMessage } from '@/lib/demoData';

interface DemoChatRoomState {
  /** roomId → ordered message array */
  rooms: Record<string, DemoChatMessage[]>;

  /** P1 CR-004: Hydration flag to prevent race conditions */
  _hasHydrated: boolean;

  /**
   * Seed a room with initial messages if it hasn't been seeded yet.
   * Calling this multiple times is safe — it only writes if the key
   * is absent.
   */
  seedRoom: (roomId: string, seed: DemoChatMessage[]) => void;

  /** Append a new message to a room. */
  addMessage: (roomId: string, msg: DemoChatMessage) => void;

  /** Replace all messages for a room (used by reload). */
  setMessages: (roomId: string, msgs: DemoChatMessage[]) => void;
}

export const useDemoChatRoomStore = create<DemoChatRoomState>()(
  persist(
    (set, get) => ({
      rooms: {},
      _hasHydrated: false,

      seedRoom: (roomId, seed) => {
        if (get().rooms[roomId]) return;
        set((s) => ({
          rooms: { ...s.rooms, [roomId]: seed },
        }));
      },

      addMessage: (roomId, msg) =>
        set((s) => {
          const current = s.rooms[roomId] ?? [];
          const next = [...current, msg];
          return {
            rooms: {
              ...s.rooms,
              [roomId]: next.length > 1000 ? next.slice(next.length - 1000) : next,
            },
          };
        }),

      setMessages: (roomId, msgs) =>
        set((s) => ({
          rooms: { ...s.rooms, [roomId]: msgs },
        })),
    }),
    {
      name: 'demo-chatroom-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // P1 CR-004: Set hydration flag when rehydration completes
      onRehydrateStorage: () => (state) => {
        if (state) {
          useDemoChatRoomStore.setState({ _hasHydrated: true });
        }
      },
    },
  ),
);
