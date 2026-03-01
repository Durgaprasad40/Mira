/**
 * Chat Room DM Navigation Store
 *
 * Minimal store to hold the active DM data when navigating
 * from a chat room to a private DM conversation.
 *
 * This enables proper Expo Router navigation (router.push)
 * instead of component-level overlay rendering.
 */
import { create } from 'zustand';
import { DemoDM } from '@/lib/demoData';

interface ChatRoomDmState {
  /** The active DM being viewed (set before navigation) */
  activeDm: DemoDM | null;

  /** The source room ID (for back navigation context) */
  sourceRoomId: string | null;

  /** Set the active DM before navigating to DM screen */
  setActiveDm: (dm: DemoDM, roomId: string) => void;

  /** Clear the active DM (called on back/close) */
  clearActiveDm: () => void;
}

export const useChatRoomDmStore = create<ChatRoomDmState>((set) => ({
  activeDm: null,
  sourceRoomId: null,

  setActiveDm: (dm, roomId) => set({ activeDm: dm, sourceRoomId: roomId }),

  clearActiveDm: () => set({ activeDm: null, sourceRoomId: null }),
}));
