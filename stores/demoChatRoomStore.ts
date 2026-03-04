/**
 * demoChatRoomStore — in-memory demo chat-room messages.
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 *
 * Follows the same pattern as demoDmStore: lazy-seed per room, then
 * append user-sent messages via addMessage().
 */
import { create } from 'zustand';
import { DemoChatMessage } from '@/lib/demoData';

interface DemoChatRoomState {
  /** roomId → ordered message array */
  rooms: Record<string, DemoChatMessage[]>;

  /** Hydration flag (always true - in-memory only) */
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

export const useDemoChatRoomStore = create<DemoChatRoomState>()((set, get) => ({
  rooms: {},
  _hasHydrated: true, // Always ready - no AsyncStorage

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
      // RETENTION: Match backend behavior — at 1000 messages, trim to 900 (delete 100 oldest)
      // If overshoot (e.g., 1005), still trim to 900. This matches convex/chatRooms.ts logic.
      return {
        rooms: {
          ...s.rooms,
          [roomId]: next.length >= 1000 ? next.slice(next.length - 900) : next,
        },
      };
    }),

  setMessages: (roomId, msgs) =>
    set((s) => ({
      rooms: { ...s.rooms, [roomId]: msgs },
    })),
}));
