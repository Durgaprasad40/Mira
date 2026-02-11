/**
 * Chat Truth-or-Dare Backend
 *
 * Convex backend for the mandatory in-chat T&D game.
 * Mirrors the Zustand store (chatTodStore.ts) for persistence & sync.
 *
 * GAME FLOW:
 * 1. initGame() → creates game record, sets idle phase
 * 2. spinBottle() → transitions to spinning
 * 3. completeSpinAnimation() → randomly picks chooser, transitions to choosing
 * 4. chooseTruthOrDare() → sets prompt type, transitions to writing
 * 5. setPrompt() → sets prompt text, transitions to answering
 * 6. submitAnswer() → records answer, transitions to round_complete
 * 7. completeMandatoryRound() → sets isMandatoryComplete, transitions to unlocked
 *
 * SECURITY:
 * - Only conversation participants can mutate game state
 * - Skip count cannot go below 0
 * - Phase transitions are validated
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ZUSTAND SYNC STRATEGY (for UI integration)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The UI continues to use the Zustand store (chatTodStore.ts) for optimistic
 * updates and fast local interactions. Convex serves as the source of truth.
 *
 * SYNC PATTERNS:
 *
 * 1. ON CHAT OPEN:
 *    - Query getChatTod() from Convex
 *    - If exists: hydrate Zustand store with Convex state
 *    - If null: call initGame() mutation, then update local store
 *
 * 2. ON USER ACTION (spin, choose, write, answer, skip):
 *    a) Update Zustand store immediately (optimistic UI)
 *    b) Call corresponding Convex mutation
 *    c) On success: no-op (state already matches)
 *    d) On error: revert Zustand to last known Convex state
 *
 * 3. REAL-TIME SYNC (for multiplayer):
 *    - Subscribe to Convex query for the game
 *    - On remote change: merge into Zustand (Convex wins conflicts)
 *    - This handles the other user's actions appearing in real-time
 *
 * 4. DEMO MODE FALLBACK:
 *    - When Convex is unavailable, Zustand + AsyncStorage persists locally
 *    - Works for single-device demo but won't sync between users
 *
 * FIELD MAPPING (Convex → Zustand):
 *   conversationId    → conversationId
 *   [p1Id, p2Id]      → userIds
 *   chooserUserId     → chooserUserId
 *   responderUserId   → responderUserId
 *   promptType        → promptType
 *   promptText        → promptText
 *   participant1Skips → skipsRemaining[p1Id]
 *   participant2Skips → skipsRemaining[p2Id]
 *   currentRound      → currentRound
 *   roundPhase        → roundPhase
 *   isMandatoryComplete → isMandatoryComplete
 *   lastAnswerType/Text/etc → lastAnswer { type, text, mediaUri, durationSec }
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ─── Constants ───────────────────────────────────────────────────────────────

const INITIAL_SKIPS = 3;

// ─── Validators ───────────────────────────────────────────────────────────────

const promptTypeValidator = v.union(v.literal('truth'), v.literal('dare'));

const roundPhaseValidator = v.union(
  v.literal('idle'),
  v.literal('spinning'),
  v.literal('choosing'),
  v.literal('writing'),
  v.literal('answering'),
  v.literal('round_complete'),
  v.literal('unlocked')
);

const answerTypeValidator = v.union(
  v.literal('text'),
  v.literal('voice'),
  v.literal('photo'),
  v.literal('video')
);

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get the T&D game state for a conversation.
 * Returns null if no game exists.
 */
export const getChatTod = query({
  args: {
    conversationId: v.string(),
  },
  handler: async (ctx, { conversationId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) return null;

    // Convert stored format to client-friendly format
    return {
      conversationId: game.conversationId,
      userIds: [game.participant1Id, game.participant2Id] as [string, string],
      chooserUserId: game.chooserUserId,
      responderUserId: game.responderUserId,
      promptType: game.promptType,
      promptText: game.promptText,
      skipsRemaining: {
        [game.participant1Id]: game.participant1Skips,
        [game.participant2Id]: game.participant2Skips,
      },
      currentRound: game.currentRound,
      roundPhase: game.roundPhase,
      isMandatoryComplete: game.isMandatoryComplete,
      lastAnswer: game.lastAnswerType
        ? {
            type: game.lastAnswerType,
            text: game.lastAnswerText,
            mediaUri: game.lastAnswerMediaUri,
            durationSec: game.lastAnswerDurationSec,
          }
        : null,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
    };
  },
});

/**
 * Check if mandatory T&D is complete for a conversation.
 * Lightweight query for gating chat access.
 */
export const isMandatoryComplete = query({
  args: {
    conversationId: v.string(),
  },
  handler: async (ctx, { conversationId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    return game?.isMandatoryComplete ?? false;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Initialize a new T&D game for a conversation.
 * Idempotent: won't overwrite if game exists and is unlocked.
 */
export const initGame = mutation({
  args: {
    conversationId: v.string(),
    participant1Id: v.string(),
    participant2Id: v.string(),
    callerId: v.string(), // The user initiating (for auth)
  },
  handler: async (ctx, { conversationId, participant1Id, participant2Id, callerId }) => {
    // Security: caller must be a participant
    if (callerId !== participant1Id && callerId !== participant2Id) {
      throw new Error('Only conversation participants can initialize T&D game');
    }

    // Check if game already exists
    const existing = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    // Don't reinitialize if game is already unlocked
    if (existing?.isMandatoryComplete) {
      return { gameId: existing._id, alreadyUnlocked: true };
    }

    // Delete existing incomplete game (reset)
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    const now = Date.now();
    const gameId = await ctx.db.insert('chatTodGames', {
      conversationId,
      participant1Id,
      participant2Id,
      chooserUserId: null,
      responderUserId: null,
      promptType: null,
      promptText: null,
      participant1Skips: INITIAL_SKIPS,
      participant2Skips: INITIAL_SKIPS,
      currentRound: 0,
      roundPhase: 'idle',
      isMandatoryComplete: false,
      lastAnswerType: null,
      lastAnswerText: null,
      lastAnswerMediaUri: null,
      lastAnswerDurationSec: null,
      createdAt: now,
      updatedAt: now,
    });

    return { gameId, alreadyUnlocked: false };
  },
});

/**
 * Start spinning the bottle.
 * Transitions: idle/round_complete → spinning
 */
export const spinBottle = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
  },
  handler: async (ctx, { conversationId, callerId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: caller must be a participant
    if (callerId !== game.participant1Id && callerId !== game.participant2Id) {
      throw new Error('Only participants can spin the bottle');
    }

    // Phase validation
    if (game.roundPhase !== 'idle' && game.roundPhase !== 'round_complete') {
      throw new Error(`Cannot spin from phase: ${game.roundPhase}`);
    }

    await ctx.db.patch(game._id, {
      roundPhase: 'spinning',
      currentRound: game.currentRound + 1,
      // Clear previous round data
      chooserUserId: null,
      responderUserId: null,
      promptType: null,
      promptText: null,
      lastAnswerType: null,
      lastAnswerText: null,
      lastAnswerMediaUri: null,
      lastAnswerDurationSec: null,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Complete the spin animation and randomly select the chooser.
 * Transitions: spinning → choosing
 */
export const completeSpinAnimation = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
    winnerId: v.string(), // Pre-determined winner from client animation
  },
  handler: async (ctx, { conversationId, callerId, winnerId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: caller must be a participant
    if (callerId !== game.participant1Id && callerId !== game.participant2Id) {
      throw new Error('Only participants can complete spin');
    }

    // Phase validation
    if (game.roundPhase !== 'spinning') {
      throw new Error(`Cannot complete spin from phase: ${game.roundPhase}`);
    }

    // Validate winnerId is a participant
    if (winnerId !== game.participant1Id && winnerId !== game.participant2Id) {
      throw new Error('Winner must be a participant');
    }

    const responderId =
      winnerId === game.participant1Id ? game.participant2Id : game.participant1Id;

    await ctx.db.patch(game._id, {
      roundPhase: 'choosing',
      chooserUserId: winnerId,
      responderUserId: responderId,
      updatedAt: Date.now(),
    });

    return { chooserId: winnerId, responderId };
  },
});

/**
 * Chooser selects Truth or Dare.
 * Transitions: choosing → writing
 */
export const chooseTruthOrDare = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
    promptType: promptTypeValidator,
  },
  handler: async (ctx, { conversationId, callerId, promptType }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: only the chooser can choose
    if (callerId !== game.chooserUserId) {
      throw new Error('Only the chooser can select Truth or Dare');
    }

    // Phase validation
    if (game.roundPhase !== 'choosing') {
      throw new Error(`Cannot choose from phase: ${game.roundPhase}`);
    }

    await ctx.db.patch(game._id, {
      roundPhase: 'writing',
      promptType,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Chooser writes the prompt text.
 * Transitions: writing → answering
 */
export const setPrompt = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
    promptText: v.string(),
  },
  handler: async (ctx, { conversationId, callerId, promptText }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: only the chooser can set prompt
    if (callerId !== game.chooserUserId) {
      throw new Error('Only the chooser can write the prompt');
    }

    // Phase validation
    if (game.roundPhase !== 'writing') {
      throw new Error(`Cannot set prompt from phase: ${game.roundPhase}`);
    }

    // Validate prompt text
    const trimmed = promptText.trim();
    if (trimmed.length < 3) {
      throw new Error('Prompt must be at least 3 characters');
    }
    if (trimmed.length > 500) {
      throw new Error('Prompt must be at most 500 characters');
    }

    await ctx.db.patch(game._id, {
      roundPhase: 'answering',
      promptText: trimmed,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Responder submits their answer.
 * Transitions: answering → round_complete
 */
export const submitAnswer = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
    answerType: answerTypeValidator,
    answerText: v.optional(v.string()),
    answerMediaUri: v.optional(v.string()),
    answerDurationSec: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { conversationId, callerId, answerType, answerText, answerMediaUri, answerDurationSec }
  ) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: only the responder can answer
    if (callerId !== game.responderUserId) {
      throw new Error('Only the responder can submit an answer');
    }

    // Phase validation
    if (game.roundPhase !== 'answering') {
      throw new Error(`Cannot submit answer from phase: ${game.roundPhase}`);
    }

    // Validate answer has content
    if (answerType === 'text' && (!answerText || answerText.trim().length < 1)) {
      throw new Error('Text answer cannot be empty');
    }
    if ((answerType === 'voice' || answerType === 'photo' || answerType === 'video') && !answerMediaUri) {
      throw new Error('Media answer requires a media URI');
    }

    await ctx.db.patch(game._id, {
      roundPhase: 'round_complete',
      lastAnswerType: answerType,
      lastAnswerText: answerText?.trim() ?? null,
      lastAnswerMediaUri: answerMediaUri ?? null,
      lastAnswerDurationSec: answerDurationSec ?? null,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Use a skip (for choosing OR answering).
 * Skip logic:
 * - In 'choosing' phase: swap roles, other user becomes chooser
 * - In 'answering' phase: round ends, back to idle for new spin
 */
export const useSkip = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
  },
  handler: async (ctx, { conversationId, callerId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: caller must be a participant
    if (callerId !== game.participant1Id && callerId !== game.participant2Id) {
      throw new Error('Only participants can use skip');
    }

    // Check skip eligibility based on phase
    const isChooser = callerId === game.chooserUserId;
    const isResponder = callerId === game.responderUserId;

    if (game.roundPhase === 'choosing' && !isChooser) {
      throw new Error('Only the chooser can skip during choosing phase');
    }
    if (game.roundPhase === 'answering' && !isResponder) {
      throw new Error('Only the responder can skip during answering phase');
    }
    if (game.roundPhase !== 'choosing' && game.roundPhase !== 'answering') {
      throw new Error(`Cannot skip in phase: ${game.roundPhase}`);
    }

    // Check remaining skips
    const isParticipant1 = callerId === game.participant1Id;
    const currentSkips = isParticipant1 ? game.participant1Skips : game.participant2Skips;

    if (currentSkips <= 0) {
      throw new Error('No skips remaining');
    }

    // Calculate new state after skip
    const newSkips = currentSkips - 1;
    const skipField = isParticipant1 ? 'participant1Skips' : 'participant2Skips';

    let updates: Record<string, unknown> = {
      [skipField]: newSkips,
      updatedAt: Date.now(),
    };

    if (game.roundPhase === 'choosing') {
      // Skipping choice: swap roles
      updates = {
        ...updates,
        chooserUserId: game.responderUserId,
        responderUserId: game.chooserUserId,
        // Stay in choosing phase
      };
    } else if (game.roundPhase === 'answering') {
      // Skipping answer: round ends, back to idle
      updates = {
        ...updates,
        roundPhase: 'idle',
        chooserUserId: null,
        responderUserId: null,
        promptType: null,
        promptText: null,
      };
    }

    await ctx.db.patch(game._id, updates);

    return { success: true, skipsRemaining: newSkips };
  },
});

/**
 * Mark the mandatory round as complete. Unlocks chat.
 * Transitions: round_complete → unlocked
 */
export const completeMandatoryRound = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
  },
  handler: async (ctx, { conversationId, callerId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: caller must be a participant
    if (callerId !== game.participant1Id && callerId !== game.participant2Id) {
      throw new Error('Only participants can unlock chat');
    }

    // Phase validation: must have completed at least 1 full round
    if (game.roundPhase !== 'round_complete') {
      throw new Error(`Cannot complete mandatory round from phase: ${game.roundPhase}`);
    }

    // Verify at least 1 round was actually completed
    if (game.currentRound < 1) {
      throw new Error('Must complete at least 1 round to unlock');
    }

    await ctx.db.patch(game._id, {
      roundPhase: 'unlocked',
      isMandatoryComplete: true,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Reset game state for a conversation.
 * Used for testing or if users want to replay.
 */
export const resetGame = mutation({
  args: {
    conversationId: v.string(),
    callerId: v.string(),
  },
  handler: async (ctx, { conversationId, callerId }) => {
    const game = await ctx.db
      .query('chatTodGames')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .first();

    if (!game) {
      throw new Error('Game not found');
    }

    // Security: caller must be a participant
    if (callerId !== game.participant1Id && callerId !== game.participant2Id) {
      throw new Error('Only participants can reset game');
    }

    await ctx.db.patch(game._id, {
      chooserUserId: null,
      responderUserId: null,
      promptType: null,
      promptText: null,
      participant1Skips: INITIAL_SKIPS,
      participant2Skips: INITIAL_SKIPS,
      currentRound: 0,
      roundPhase: 'idle',
      isMandatoryComplete: false,
      lastAnswerType: null,
      lastAnswerText: null,
      lastAnswerMediaUri: null,
      lastAnswerDurationSec: null,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
