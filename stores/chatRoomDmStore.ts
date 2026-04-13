/**
 * Chat Room DM Navigation Store
 *
 * Minimal store to hold the active DM data when navigating
 * from a chat room to a private DM conversation.
 *
 * DM-ID-FIX: Now includes threadId for Convex backend sync.
 */
import { create } from 'zustand';

// DM info for display (peer details)
interface DmInfo {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  peerGender?: 'male' | 'female' | 'other';
}

interface ChatRoomDmState {
  /** The active DM being viewed (set before navigation) */
  activeDm: DmInfo | null;

  /** Convex thread ID for backend sync */
  activeThreadId: string | null;

  /** The source room ID (for back navigation context) */
  sourceRoomId: string | null;

  /** Set the active DM before navigating to DM screen */
  setActiveDm: (dm: DmInfo, threadId: string | null, roomId: string) => void;

  /** Clear the active DM (called on back/close) */
  clearActiveDm: () => void;
}

export const useChatRoomDmStore = create<ChatRoomDmState>((set) => ({
  activeDm: null,
  activeThreadId: null,
  sourceRoomId: null,

  setActiveDm: (dm, threadId, roomId) => set({
    activeDm: dm,
    activeThreadId: threadId,
    sourceRoomId: roomId,
  }),

  clearActiveDm: () => set({
    activeDm: null,
    activeThreadId: null,
    sourceRoomId: null,
  }),
}));
