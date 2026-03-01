import { create } from 'zustand';

/**
 * Per-thread identity choice for Truth/Dare answers.
 * Stores the user's identity visibility choice for each thread (by promptId).
 * Once set, reused for all answer types (text/voice/photo/video) in that thread.
 */

export type TodIdentityChoice = 'anonymous' | 'no_photo' | 'public';

interface TodIdentityState {
  /** Map of promptId -> identity choice */
  byThread: Record<string, TodIdentityChoice>;

  /** Get identity choice for a thread (undefined if not set) */
  getChoice: (promptId: string) => TodIdentityChoice | undefined;

  /** Set identity choice for a thread */
  setChoice: (promptId: string, choice: TodIdentityChoice) => void;

  /** Clear choice for a thread (optional) */
  clearChoice: (promptId: string) => void;

  /** Clear all choices */
  clearAll: () => void;
}

export const useTodIdentityStore = create<TodIdentityState>((set, get) => ({
  byThread: {},

  getChoice: (promptId: string) => {
    return get().byThread[promptId];
  },

  setChoice: (promptId: string, choice: TodIdentityChoice) => {
    set((state) => ({
      byThread: {
        ...state.byThread,
        [promptId]: choice,
      },
    }));
  },

  clearChoice: (promptId: string) => {
    set((state) => {
      const { [promptId]: _, ...rest } = state.byThread;
      return { byThread: rest };
    });
  },

  clearAll: () => {
    set({ byThread: {} });
  },
}));
