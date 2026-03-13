/**
 * Chat Truth-or-Dare Game Store
 *
 * Manages per-conversation T&D game state for the mandatory in-chat game.
 * This is separate from the public T&D feed (truth-or-dare.tsx tab).
 *
 * GAME FLOW:
 * 1. Chat opens → initGame() → isMandatoryComplete = false
 * 2. Bottle spins → spinBottle() → chooserUserId set randomly
 * 3. Chooser picks → chooseTruthOrDare('truth' | 'dare')
 * 4. Chooser writes → setPrompt(text) → no prompt library
 * 5. Other user answers → submitAnswer(meta) → via Text/Voice/Camera
 * 6. Round complete → completeMandatoryRound() → chat unlocks
 *
 * SKIP RULES:
 * - Each user starts with 3 skips per conversation
 * - Can skip: choosing Truth/Dare OR answering
 * - After 3 skips: forced participation (no skip button)
 *
 * PERSISTENCE:
 * - Local only for now (Zustand + AsyncStorage)
 * - Convex integration later (1:1 schema mirror)
 */
/**
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 */

import { create } from 'zustand';

// ─── Constants ───────────────────────────────────────────────────────────────

const INITIAL_SKIPS = 3;
// C-003 FIX: Removed hardcoded CURRENT_USER_ID
// In demo mode, the caller should pass the actual user ID or 'me'

// ─── Types ───────────────────────────────────────────────────────────────────

export type TodPromptType = 'truth' | 'dare';

export type TodRoundPhase =
  | 'idle'           // Game not started
  | 'spinning'       // Bottle is spinning
  | 'choosing'       // Chooser picks Truth or Dare
  | 'writing'        // Chooser writes the prompt
  | 'answering'      // Other user is answering
  | 'round_complete' // Round finished, can continue or unlock chat
  | 'unlocked';      // Mandatory complete, chat is open

export interface TodAnswerMeta {
  type: 'text' | 'voice' | 'photo' | 'video';
  text?: string;           // For text answers
  mediaUri?: string;       // For photo/video/voice
  durationSec?: number;    // For voice/video
}

export interface TodGameState {
  conversationId: string;
  userIds: [string, string];           // [currentUser, otherUser]
  chooserUserId: string | null;        // Who chooses Truth/Dare this round
  responderUserId: string | null;      // Who answers this round
  promptType: TodPromptType | null;
  promptText: string | null;
  skipsRemaining: Record<string, number>; // userId -> remaining skips
  currentRound: number;
  roundPhase: TodRoundPhase;
  isMandatoryComplete: boolean;
  lastAnswer: TodAnswerMeta | null;
  // History (for display/analytics)
  roundHistory: TodRoundRecord[];
}

export interface TodRoundRecord {
  round: number;
  chooserUserId: string;
  responderUserId: string;
  promptType: TodPromptType;
  promptText: string;
  answer: TodAnswerMeta;
  completedAt: number;
}

// ─── Initial State Factory ───────────────────────────────────────────────────

function createInitialGameState(
  conversationId: string,
  userIds: [string, string]
): TodGameState {
  return {
    conversationId,
    userIds,
    chooserUserId: null,
    responderUserId: null,
    promptType: null,
    promptText: null,
    skipsRemaining: {
      [userIds[0]]: INITIAL_SKIPS,
      [userIds[1]]: INITIAL_SKIPS,
    },
    currentRound: 0,
    roundPhase: 'idle',
    isMandatoryComplete: false,
    lastAnswer: null,
    roundHistory: [],
  };
}

// ─── Store Interface ─────────────────────────────────────────────────────────

interface ChatTodStore {
  // State: per-conversation game records
  games: Record<string, TodGameState>;

  // Hydration tracking
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  // ─── Core Actions ───

  /**
   * Initialize a new game for a conversation.
   * Called when chat opens for the first time.
   * @param conversationId - The conversation ID
   * @param userIds - [currentUserId, otherUserId]
   */
  initGame: (conversationId: string, userIds: [string, string]) => void;

  /**
   * Spin the bottle to randomly select who chooses.
   * Transitions: idle/round_complete → spinning → choosing
   */
  spinBottle: (conversationId: string) => void;

  /**
   * Complete the spin animation and set the chooser.
   * Called after spin animation finishes.
   * @param winnerId - The pre-determined winner ID from the spin animation
   */
  completeSpinAnimation: (conversationId: string, winnerId: string) => void;

  /**
   * Chooser selects Truth or Dare.
   * Transitions: choosing → writing
   */
  chooseTruthOrDare: (conversationId: string, type: TodPromptType) => void;

  /**
   * Chooser writes the prompt text.
   * Transitions: writing → answering
   */
  setPrompt: (conversationId: string, text: string) => void;

  /**
   * Responder submits their answer.
   * Transitions: answering → round_complete
   */
  submitAnswer: (conversationId: string, answerMeta: TodAnswerMeta) => void;

  /**
   * Use a skip (for choosing OR answering).
   * Returns true if skip was used, false if no skips remaining.
   */
  useSkip: (conversationId: string, userId: string) => boolean;

  /**
   * Mark the mandatory round as complete. Unlocks chat.
   * Transitions: round_complete → unlocked
   */
  completeMandatoryRound: (conversationId: string) => void;

  /**
   * Reset game state for a conversation.
   * Used for testing or if user wants to replay.
   */
  resetGame: (conversationId: string) => void;

  // ─── Selectors ───

  /**
   * Get game state for a conversation.
   * Returns null if no game exists.
   */
  getGame: (conversationId: string) => TodGameState | null;

  /**
   * Check if a user can still skip.
   */
  canSkip: (conversationId: string, userId: string) => boolean;

  /**
   * Check if it's the current user's turn to act.
   * C-003 FIX: Added userId parameter
   */
  isMyTurn: (conversationId: string, userId: string) => boolean;

  /**
   * Get the action required from current user.
   * C-003 FIX: Added userId parameter
   */
  getMyAction: (conversationId: string, userId: string) => 'spin' | 'choose' | 'write' | 'answer' | 'wait' | 'done';
}

// ─── Store Implementation ────────────────────────────────────────────────────

export const useChatTodStore = create<ChatTodStore>()((set, get) => ({
  games: {},
  // M-009 FIX: Store has no persistence (Convex is source of truth), so it starts hydrated.
  // The flag is kept for API compatibility with persistence patterns.
  _hasHydrated: true,
  setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

  // ─── Core Actions ───

  initGame: (conversationId, userIds) => {
    set((state) => {
      // Don't reinitialize if game exists and is unlocked
      const existing = state.games[conversationId];
      if (existing?.isMandatoryComplete) {
        return state; // Chat already unlocked, keep state
      }

      // Create new game or reset existing
      return {
        games: {
          ...state.games,
          [conversationId]: createInitialGameState(conversationId, userIds),
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] initGame:', { conversationId, userIds });
    }
  },

  spinBottle: (conversationId) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game) return state;

      // Can only spin from idle or round_complete
      if (game.roundPhase !== 'idle' && game.roundPhase !== 'round_complete') {
        if (__DEV__) {
          console.warn('[ChatTodStore] Cannot spin: wrong phase', game.roundPhase);
        }
        return state;
      }

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...game,
            roundPhase: 'spinning',
            currentRound: game.currentRound + 1,
            // Clear previous round data
            chooserUserId: null,
            responderUserId: null,
            promptType: null,
            promptText: null,
            lastAnswer: null,
          },
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] spinBottle:', { conversationId });
    }
  },

  completeSpinAnimation: (conversationId, winnerId) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game || game.roundPhase !== 'spinning') return state;

      // C-001 FIX: Use the passed winnerId instead of randomly selecting
      // The winnerId is pre-determined by the caller (overlay) for animation sync
      const chooserIndex = game.userIds.indexOf(winnerId);
      const chooserId = chooserIndex >= 0 ? winnerId : game.userIds[0];
      const responderId = game.userIds[chooserIndex >= 0 ? (1 - chooserIndex) : 1];

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...game,
            roundPhase: 'choosing',
            chooserUserId: chooserId,
            responderUserId: responderId,
          },
        },
      };
    });

    if (__DEV__) {
      const game = get().games[conversationId];
      console.log('[ChatTodStore] completeSpinAnimation:', {
        conversationId,
        chooser: game?.chooserUserId,
        passedWinnerId: winnerId,
      });
    }
  },

  chooseTruthOrDare: (conversationId, type) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game || game.roundPhase !== 'choosing') return state;

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...game,
            roundPhase: 'writing',
            promptType: type,
          },
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] chooseTruthOrDare:', { conversationId, type });
    }
  },

  setPrompt: (conversationId, text) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game || game.roundPhase !== 'writing') return state;

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...game,
            roundPhase: 'answering',
            promptText: text.trim(),
          },
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] setPrompt:', { conversationId, textLength: text.length });
    }
  },

  submitAnswer: (conversationId, answerMeta) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game || game.roundPhase !== 'answering') return state;

      // Record the round in history
      const roundRecord: TodRoundRecord = {
        round: game.currentRound,
        chooserUserId: game.chooserUserId!,
        responderUserId: game.responderUserId!,
        promptType: game.promptType!,
        promptText: game.promptText!,
        answer: answerMeta,
        completedAt: Date.now(),
      };

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...game,
            roundPhase: 'round_complete',
            lastAnswer: answerMeta,
            roundHistory: [...game.roundHistory, roundRecord],
          },
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] submitAnswer:', { conversationId, type: answerMeta.type });
    }
  },

  useSkip: (conversationId, userId) => {
    const game = get().games[conversationId];
    if (!game) return false;

    const remaining = game.skipsRemaining[userId] ?? 0;
    if (remaining <= 0) {
      if (__DEV__) {
        console.log('[ChatTodStore] useSkip: no skips remaining', { conversationId, userId });
      }
      return false;
    }

    set((state) => {
      const currentGame = state.games[conversationId];
      if (!currentGame) return state;

      const newSkips = {
        ...currentGame.skipsRemaining,
        [userId]: (currentGame.skipsRemaining[userId] ?? 0) - 1,
      };

      // Determine next phase after skip
      let nextPhase = currentGame.roundPhase;
      let newChooser = currentGame.chooserUserId;
      let newResponder = currentGame.responderUserId;

      if (currentGame.roundPhase === 'choosing') {
        // Skipping choice: swap roles, other user becomes chooser
        newChooser = currentGame.responderUserId;
        newResponder = currentGame.chooserUserId;
      } else if (currentGame.roundPhase === 'answering') {
        // Skipping answer: round ends, back to spin
        nextPhase = 'idle';
        newChooser = null;
        newResponder = null;
      }

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...currentGame,
            skipsRemaining: newSkips,
            roundPhase: nextPhase,
            chooserUserId: newChooser,
            responderUserId: newResponder,
          },
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] useSkip:', {
        conversationId,
        userId,
        remaining: remaining - 1,
      });
    }

    return true;
  },

  completeMandatoryRound: (conversationId) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game) return state;

      // Can only complete from round_complete phase
      if (game.roundPhase !== 'round_complete') {
        if (__DEV__) {
          console.warn('[ChatTodStore] Cannot complete: wrong phase', game.roundPhase);
        }
        return state;
      }

      return {
        games: {
          ...state.games,
          [conversationId]: {
            ...game,
            roundPhase: 'unlocked',
            isMandatoryComplete: true,
          },
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] completeMandatoryRound:', { conversationId });
    }
  },

  resetGame: (conversationId) => {
    set((state) => {
      const game = state.games[conversationId];
      if (!game) return state;

      return {
        games: {
          ...state.games,
          [conversationId]: createInitialGameState(conversationId, game.userIds),
        },
      };
    });

    if (__DEV__) {
      console.log('[ChatTodStore] resetGame:', { conversationId });
    }
  },

  // ─── Selectors ───

  getGame: (conversationId) => {
    return get().games[conversationId] ?? null;
  },

  canSkip: (conversationId, userId) => {
    const game = get().games[conversationId];
    if (!game) return false;
    return (game.skipsRemaining[userId] ?? 0) > 0;
  },

  // C-003 FIX: Accept userId parameter instead of using hardcoded CURRENT_USER_ID
  isMyTurn: (conversationId, userId) => {
    const game = get().games[conversationId];
    if (!game) return false;

    switch (game.roundPhase) {
      case 'idle':
      case 'spinning':
        return true; // Either can spin
      case 'choosing':
      case 'writing':
        return game.chooserUserId === userId;
      case 'answering':
        return game.responderUserId === userId;
      case 'round_complete':
        return true; // Either can continue/unlock
      case 'unlocked':
        return false; // Game over
      default:
        return false;
    }
  },

  // C-003 FIX: Accept userId parameter instead of using hardcoded CURRENT_USER_ID
  getMyAction: (conversationId, userId) => {
    const game = get().games[conversationId];
    if (!game) return 'done';

    switch (game.roundPhase) {
      case 'idle':
        return 'spin';
      case 'spinning':
        return 'wait'; // Animation playing
      case 'choosing':
        return game.chooserUserId === userId ? 'choose' : 'wait';
      case 'writing':
        return game.chooserUserId === userId ? 'write' : 'wait';
      case 'answering':
        return game.responderUserId === userId ? 'answer' : 'wait';
      case 'round_complete':
        return 'done'; // Can unlock or continue
      case 'unlocked':
        return 'done';
      default:
        return 'done';
    }
  },
}));

// ─── Selector Hooks (for cleaner component usage) ────────────────────────────

/**
 * Get game state for a conversation (reactive).
 */
export const useGameState = (conversationId: string): TodGameState | null => {
  return useChatTodStore((s) => s.games[conversationId] ?? null);
};

/**
 * Check if mandatory T&D is complete for a conversation.
 */
export const useIsMandatoryComplete = (conversationId: string): boolean => {
  return useChatTodStore((s) => s.games[conversationId]?.isMandatoryComplete ?? false);
};

/**
 * Get current round phase for a conversation.
 */
export const useRoundPhase = (conversationId: string): TodRoundPhase => {
  return useChatTodStore((s) => s.games[conversationId]?.roundPhase ?? 'idle');
};

/**
 * Get skips remaining for a specific user.
 * C-003 FIX: Added userId parameter (defaults to 'me' for demo mode compat)
 */
export const useMySkipsRemaining = (conversationId: string, userId: string = 'me'): number => {
  return useChatTodStore(
    (s) => s.games[conversationId]?.skipsRemaining[userId] ?? INITIAL_SKIPS
  );
};
