/**
 * useChatTodConvex - Dual-mode hook for Chat T&D game
 *
 * Abstracts the choice between Convex (real mode) and Zustand (demo mode).
 *
 * REAL MODE (Convex):
 * - Reads game state from Convex query
 * - Mutations call Convex backend
 * - Persists across devices/restarts
 *
 * DEMO MODE (Zustand):
 * - Uses local chatTodStore
 * - No network calls
 * - Persists via AsyncStorage only
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { isDemoMode } from '@/config/demo';
import {
  useChatTodStore,
  useGameState,
  useMySkipsRemaining,
  type TodAnswerMeta,
  type TodGameState,
  type TodPromptType,
} from '@/stores/chatTodStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatTodGameState {
  conversationId: string;
  userIds: [string, string];
  chooserUserId: string | null;
  responderUserId: string | null;
  promptType: 'truth' | 'dare' | null;
  promptText: string | null;
  skipsRemaining: Record<string, number>;
  currentRound: number;
  roundPhase: string;
  isMandatoryComplete: boolean;
  lastAnswer: TodAnswerMeta | null;
}

interface UseChatTodConvexReturn {
  /** Current game state (null if loading or not initialized) */
  game: ChatTodGameState | null;
  /** Whether the query is loading (Convex only) */
  isLoading: boolean;
  /** Skips remaining for current user */
  mySkipsRemaining: number;
  /** Whether mandatory T&D is complete */
  isMandatoryComplete: boolean;

  // Actions
  initGame: (userIds: [string, string]) => Promise<void>;
  spinBottle: () => Promise<void>;
  completeSpinAnimation: (winnerId: string) => Promise<void>;
  chooseTruthOrDare: (type: TodPromptType) => Promise<void>;
  setPrompt: (text: string) => Promise<void>;
  submitAnswer: (meta: TodAnswerMeta) => Promise<void>;
  useSkip: () => Promise<boolean>;
  completeMandatoryRound: () => Promise<void>;
}

const CURRENT_USER_ID = 'me';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChatTodConvex(
  conversationId: string,
  currentUserId: string = CURRENT_USER_ID
): UseChatTodConvexReturn {
  // ─── Zustand (Demo Mode) ───
  const zustandGame = useGameState(conversationId);
  const zustandSkips = useMySkipsRemaining(conversationId);
  const zustandActions = useChatTodStore((s) => ({
    initGame: s.initGame,
    spinBottle: s.spinBottle,
    completeSpinAnimation: s.completeSpinAnimation,
    chooseTruthOrDare: s.chooseTruthOrDare,
    setPrompt: s.setPrompt,
    submitAnswer: s.submitAnswer,
    useSkip: s.useSkip,
    completeMandatoryRound: s.completeMandatoryRound,
  }));

  // ─── Convex (Real Mode) ───
  // Only run queries/mutations in real mode
  const convexGame = useQuery(
    api.chatTod.getChatTod,
    isDemoMode ? 'skip' : { conversationId }
  );

  const convexIsMandatoryComplete = useQuery(
    api.chatTod.isMandatoryComplete,
    isDemoMode ? 'skip' : { conversationId }
  );

  // Convex mutations
  const initGameMutation = useMutation(api.chatTod.initGame);
  const spinBottleMutation = useMutation(api.chatTod.spinBottle);
  const completeSpinMutation = useMutation(api.chatTod.completeSpinAnimation);
  const chooseMutation = useMutation(api.chatTod.chooseTruthOrDare);
  const setPromptMutation = useMutation(api.chatTod.setPrompt);
  const submitAnswerMutation = useMutation(api.chatTod.submitAnswer);
  const useSkipMutation = useMutation(api.chatTod.useSkip);
  const completeMandatoryMutation = useMutation(api.chatTod.completeMandatoryRound);

  // ─── Unified Game State ───
  const game = useMemo((): ChatTodGameState | null => {
    if (isDemoMode) {
      return zustandGame;
    }
    // Real mode: use Convex data
    if (!convexGame) return null;

    // Convert Convex nulls to undefined for TodAnswerMeta compatibility
    const lastAnswer: TodAnswerMeta | null = convexGame.lastAnswer
      ? {
          type: convexGame.lastAnswer.type,
          text: convexGame.lastAnswer.text ?? undefined,
          mediaUri: convexGame.lastAnswer.mediaUri ?? undefined,
          durationSec: convexGame.lastAnswer.durationSec ?? undefined,
        }
      : null;

    return {
      conversationId: convexGame.conversationId,
      userIds: convexGame.userIds,
      chooserUserId: convexGame.chooserUserId,
      responderUserId: convexGame.responderUserId,
      promptType: convexGame.promptType,
      promptText: convexGame.promptText,
      skipsRemaining: convexGame.skipsRemaining,
      currentRound: convexGame.currentRound,
      roundPhase: convexGame.roundPhase,
      isMandatoryComplete: convexGame.isMandatoryComplete,
      lastAnswer,
    };
  }, [isDemoMode, zustandGame, convexGame]);

  const isLoading = !isDemoMode && convexGame === undefined;

  const mySkipsRemaining = useMemo(() => {
    if (isDemoMode) {
      return zustandSkips;
    }
    return game?.skipsRemaining?.[currentUserId] ?? 3;
  }, [isDemoMode, zustandSkips, game, currentUserId]);

  const isMandatoryComplete = useMemo(() => {
    if (isDemoMode) {
      return zustandGame?.isMandatoryComplete ?? false;
    }
    return convexIsMandatoryComplete ?? false;
  }, [isDemoMode, zustandGame, convexIsMandatoryComplete]);

  // ─── Unified Actions ───

  const initGame = useCallback(
    async (userIds: [string, string]) => {
      if (isDemoMode) {
        zustandActions.initGame(conversationId, userIds);
        return;
      }
      await initGameMutation({
        conversationId,
        participant1Id: userIds[0],
        participant2Id: userIds[1],
        callerId: currentUserId,
      });
    },
    [conversationId, currentUserId, zustandActions, initGameMutation]
  );

  const spinBottle = useCallback(async () => {
    if (isDemoMode) {
      zustandActions.spinBottle(conversationId);
      return;
    }
    await spinBottleMutation({
      conversationId,
      callerId: currentUserId,
    });
  }, [conversationId, currentUserId, zustandActions, spinBottleMutation]);

  const completeSpinAnimation = useCallback(
    async (winnerId: string) => {
      if (isDemoMode) {
        zustandActions.completeSpinAnimation(conversationId);
        return;
      }
      await completeSpinMutation({
        conversationId,
        callerId: currentUserId,
        winnerId,
      });
    },
    [conversationId, currentUserId, zustandActions, completeSpinMutation]
  );

  const chooseTruthOrDare = useCallback(
    async (type: TodPromptType) => {
      if (isDemoMode) {
        zustandActions.chooseTruthOrDare(conversationId, type);
        return;
      }
      await chooseMutation({
        conversationId,
        callerId: currentUserId,
        promptType: type,
      });
    },
    [conversationId, currentUserId, zustandActions, chooseMutation]
  );

  const setPrompt = useCallback(
    async (text: string) => {
      if (isDemoMode) {
        zustandActions.setPrompt(conversationId, text);
        return;
      }
      await setPromptMutation({
        conversationId,
        callerId: currentUserId,
        promptText: text,
      });
    },
    [conversationId, currentUserId, zustandActions, setPromptMutation]
  );

  const submitAnswer = useCallback(
    async (meta: TodAnswerMeta) => {
      if (isDemoMode) {
        zustandActions.submitAnswer(conversationId, meta);
        return;
      }
      await submitAnswerMutation({
        conversationId,
        callerId: currentUserId,
        answerType: meta.type,
        answerText: meta.text,
        answerMediaUri: meta.mediaUri,
        answerDurationSec: meta.durationSec,
      });
    },
    [conversationId, currentUserId, zustandActions, submitAnswerMutation]
  );

  const useSkipAction = useCallback(async (): Promise<boolean> => {
    if (isDemoMode) {
      return zustandActions.useSkip(conversationId, currentUserId);
    }
    try {
      await useSkipMutation({
        conversationId,
        callerId: currentUserId,
      });
      return true;
    } catch {
      return false;
    }
  }, [conversationId, currentUserId, zustandActions, useSkipMutation]);

  const completeMandatoryRound = useCallback(async () => {
    if (isDemoMode) {
      zustandActions.completeMandatoryRound(conversationId);
      return;
    }
    await completeMandatoryMutation({
      conversationId,
      callerId: currentUserId,
    });
  }, [conversationId, currentUserId, zustandActions, completeMandatoryMutation]);

  return {
    game,
    isLoading,
    mySkipsRemaining,
    isMandatoryComplete,
    initGame,
    spinBottle,
    completeSpinAnimation,
    chooseTruthOrDare,
    setPrompt,
    submitAnswer,
    useSkip: useSkipAction,
    completeMandatoryRound,
  };
}

/**
 * Lightweight hook just for gating (overlay visibility).
 * Uses Convex query in real mode, Zustand in demo mode.
 */
export function useIsMandatoryCompleteConvex(conversationId: string): {
  isMandatoryComplete: boolean;
  isLoading: boolean;
} {
  // Zustand (demo)
  const zustandComplete = useChatTodStore(
    (s) => s.games[conversationId]?.isMandatoryComplete ?? false
  );

  // Convex (real)
  const convexComplete = useQuery(
    api.chatTod.isMandatoryComplete,
    isDemoMode ? 'skip' : { conversationId }
  );

  if (isDemoMode) {
    return { isMandatoryComplete: zustandComplete, isLoading: false };
  }

  return {
    isMandatoryComplete: convexComplete ?? false,
    isLoading: convexComplete === undefined,
  };
}
