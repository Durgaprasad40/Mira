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
 * - TOD-009 FIX: All mutations now verify caller identity server-side
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
import { type Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { validateSessionToken } from './helpers';

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

// ─── Auth Helper ──────────────────────────────────────────────────────────────

/**
 * Legacy chatTod remains a deployed Convex surface even though the active chat
 * game path uses convex/games.ts. Keep this token-bound so direct API calls
 * cannot impersonate another participant with callerId/authUserId.
 */
type ChatTodActor = {
  userId: Id<'users'>;
  identityRefs: Set<string>;
};

function isUnavailableUser(user: any): boolean {
  return (
    !user ||
    user.deletedAt !== undefined ||
    user.isActive === false ||
    user.isBanned === true
  );
}

async function resolveChatTodActor(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<ChatTodActor | null> {
  const sessionToken = token.trim();
  if (!sessionToken) return null;

  const userId = await validateSessionToken(ctx, sessionToken);
  if (!userId) return null;

  const user = await ctx.db.get(userId);
  if (isUnavailableUser(user)) return null;

  const refs = new Set<string>([String(userId)]);
  if (typeof user?.authUserId === 'string' && user.authUserId.trim().length > 0) {
    refs.add(user.authUserId);
  }
  if (typeof user?.demoUserId === 'string' && user.demoUserId.trim().length > 0) {
    refs.add(user.demoUserId);
  }

  return {
    userId,
    identityRefs: refs,
  };
}

async function requireChatTodActor(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<ChatTodActor> {
  const actor = await resolveChatTodActor(ctx, token);
  if (!actor) {
    throw new Error('Unauthorized: authentication required');
  }
  return actor;
}

function isActorRef(actor: ChatTodActor, value: string | null | undefined): boolean {
  return typeof value === 'string' && actor.identityRefs.has(value);
}

async function getConversationParticipants(
  ctx: QueryCtx | MutationCtx,
  conversationId: string,
  actor: ChatTodActor
): Promise<string[] | null> {
  const phase1ConversationId = ctx.db.normalizeId('conversations', conversationId);
  if (phase1ConversationId) {
    const conversation = await ctx.db.get(phase1ConversationId);
    if (conversation) {
      if (conversation.expiresAt !== undefined && conversation.expiresAt <= Date.now()) {
        return null;
      }
      if (!conversation.participants.some((participantId) => participantId === actor.userId)) {
        return null;
      }
      return conversation.participants.map((participantId) => String(participantId));
    }
  }

  const privateConversationId = ctx.db.normalizeId('privateConversations', conversationId);
  if (privateConversationId) {
    const conversation = await ctx.db.get(privateConversationId);
    if (conversation) {
      if (!conversation.participants.some((participantId) => participantId === actor.userId)) {
        return null;
      }
      return conversation.participants.map((participantId) => String(participantId));
    }
  }

  return null;
}

async function getGameForActor(
  ctx: QueryCtx | MutationCtx,
  conversationId: string,
  actor: ChatTodActor
) {
  const game = await ctx.db
    .query('chatTodGames')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
    .first();

  if (!game) return null;

  const participants = await getConversationParticipants(ctx, conversationId, actor);
  if (!participants) return null;

  if (!isActorRef(actor, game.participant1Id) && !isActorRef(actor, game.participant2Id)) {
    return null;
  }

  return game;
}

async function requireGameForActor(
  ctx: QueryCtx | MutationCtx,
  conversationId: string,
  actor: ChatTodActor
) {
  const game = await getGameForActor(ctx, conversationId, actor);
  if (!game) {
    throw new Error('Game not found');
  }
  return game;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get the T&D game state for a conversation.
 * Returns null if no game exists.
 */
export const getChatTod = query({
  args: {
    conversationId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await resolveChatTodActor(ctx, token);
    if (!actor) return null;

    const game = await getGameForActor(ctx, conversationId, actor);
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
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await resolveChatTodActor(ctx, token);
    if (!actor) return false;

    const game = await getGameForActor(ctx, conversationId, actor);
    return game?.isMandatoryComplete ?? false;
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Initialize a new T&D game for a conversation.
 * Idempotent: won't overwrite if game exists and is unlocked.
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const initGame = mutation({
  args: {
    conversationId: v.string(),
    participant1Id: v.string(),
    participant2Id: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const participants = await getConversationParticipants(ctx, conversationId, actor);
    if (!participants || participants.length < 2) {
      throw new Error('Only conversation participants can initialize T&D game');
    }
    const [participant1Id, participant2Id] = participants;

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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const spinBottle = mutation({
  args: {
    conversationId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const completeSpinAnimation = mutation({
  args: {
    conversationId: v.string(),
    winnerId: v.string(), // Pre-determined winner from client animation
    token: v.string(),
  },
  handler: async (ctx, { conversationId, winnerId, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const chooseTruthOrDare = mutation({
  args: {
    conversationId: v.string(),
    promptType: promptTypeValidator,
    token: v.string(),
  },
  handler: async (ctx, { conversationId, promptType, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

    // Security: only the chooser can choose
    if (!isActorRef(actor, game.chooserUserId)) {
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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const setPrompt = mutation({
  args: {
    conversationId: v.string(),
    promptText: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, promptText, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

    // Security: only the chooser can set prompt
    if (!isActorRef(actor, game.chooserUserId)) {
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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const submitAnswer = mutation({
  args: {
    conversationId: v.string(),
    answerType: answerTypeValidator,
    answerText: v.optional(v.string()),
    answerMediaUri: v.optional(v.string()),
    answerDurationSec: v.optional(v.number()),
    token: v.string(),
  },
  handler: async (
    ctx,
    { conversationId, answerType, answerText, answerMediaUri, answerDurationSec, token }
  ) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

    // Security: only the responder can answer
    if (!isActorRef(actor, game.responderUserId)) {
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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const useSkip = mutation({
  args: {
    conversationId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

    // Check skip eligibility based on phase
    const isChooser = isActorRef(actor, game.chooserUserId);
    const isResponder = isActorRef(actor, game.responderUserId);

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
    const isParticipant1 = isActorRef(actor, game.participant1Id);
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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const completeMandatoryRound = mutation({
  args: {
    conversationId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

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
 * TOD-009 FIX: Auth hardening - verify caller identity server-side
 */
export const resetGame = mutation({
  args: {
    conversationId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    const actor = await requireChatTodActor(ctx, token);
    const game = await requireGameForActor(ctx, conversationId, actor);

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
