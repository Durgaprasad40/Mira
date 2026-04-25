import { mutation, query, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { type Doc, Id } from './_generated/dataModel';
import { asUserId } from './id';
import { resolveUserIdByAuthId } from './helpers';
import {
  BOTTLE_SPIN_COOLDOWN_MS,
  BOTTLE_SPIN_PENDING_INVITE_TIMEOUT_MS,
  BOTTLE_SPIN_NOT_STARTED_TIMEOUT_MS,
  BOTTLE_SPIN_INACTIVITY_TIMEOUT_MS,
} from '../lib/bottleSpin';

// ═══════════════════════════════════════════════════════════════════════════
// GAME LIMITS: Bottle Spin Skip Tracking (Convex-backed persistence)
// ═══════════════════════════════════════════════════════════════════════════

// Get bottle spin skip count for a conversation and time window
export const getBottleSpinSkips = query({
  args: {
    convoId: v.string(),
    windowKey: v.string(),
  },
  handler: async (ctx, { convoId, windowKey }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { skipCount: 0 };
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return { skipCount: 0 };
    }

    // Look up skip tracking record
    const record = await ctx.db
      .query('userGameLimits')
      .withIndex('by_user_game_convo', (q) =>
        q.eq('userId', userId).eq('game', 'bottleSpin').eq('convoId', convoId).eq('windowKey', windowKey)
      )
      .first();

    return { skipCount: record?.skipCount ?? 0 };
  },
});

// Increment bottle spin skip count
export const incrementBottleSpinSkip = mutation({
  args: {
    convoId: v.string(),
    windowKey: v.string(),
    delta: v.optional(v.number()),
  },
  handler: async (ctx, { convoId, windowKey, delta = 1 }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    const now = Date.now();

    // Check if record exists
    const existing = await ctx.db
      .query('userGameLimits')
      .withIndex('by_user_game_convo', (q) =>
        q.eq('userId', userId).eq('game', 'bottleSpin').eq('convoId', convoId).eq('windowKey', windowKey)
      )
      .first();

    let newSkipCount: number;

    if (existing) {
      // Update existing record
      newSkipCount = existing.skipCount + delta;
      await ctx.db.patch(existing._id, {
        skipCount: newSkipCount,
        updatedAt: now,
      });
    } else {
      // Create new record
      newSkipCount = delta;
      await ctx.db.insert('userGameLimits', {
        userId,
        game: 'bottleSpin',
        convoId,
        windowKey,
        skipCount: newSkipCount,
        updatedAt: now,
      });
    }

    return { skipCount: newSkipCount };
  },
});

// Reset bottle spin skip count (optional utility)
export const resetBottleSpinSkips = mutation({
  args: {
    convoId: v.string(),
    windowKey: v.string(),
  },
  handler: async (ctx, { convoId, windowKey }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // Find and delete the record
    const existing = await ctx.db
      .query('userGameLimits')
      .withIndex('by_user_game_convo', (q) =>
        q.eq('userId', userId).eq('game', 'bottleSpin').eq('convoId', convoId).eq('windowKey', windowKey)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BOTTLE SPIN V2: Per-User Global Skip Tracking (not per-conversation)
// Uses app's custom auth pattern (authUserId + resolveUserIdByAuthId)
// ═══════════════════════════════════════════════════════════════════════════

// Get global bottle spin skip count for user (across all conversations)
export const getGlobalBottleSpinSkips = query({
  args: {
    authUserId: v.string(),
    windowKey: v.string(),
  },
  handler: async (ctx, { authUserId, windowKey }) => {
    // Resolve auth ID to Convex user ID using app's custom auth pattern
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { skipCount: 0 };
    }

    // Look up skip tracking record with special "global" convoId
    const record = await ctx.db
      .query('userGameLimits')
      .withIndex('by_user_game_convo', (q) =>
        q.eq('userId', userId).eq('game', 'bottleSpin').eq('convoId', '_global_').eq('windowKey', windowKey)
      )
      .first();

    return { skipCount: record?.skipCount ?? 0 };
  },
});

// Increment global bottle spin skip count for user
export const incrementGlobalBottleSpinSkip = mutation({
  args: {
    authUserId: v.string(),
    windowKey: v.string(),
    delta: v.optional(v.number()),
  },
  handler: async (ctx, { authUserId, windowKey, delta = 1 }) => {
    // Resolve auth ID to Convex user ID using app's custom auth pattern
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();
    const convoId = '_global_'; // Special key for global tracking

    // Check if record exists
    const existing = await ctx.db
      .query('userGameLimits')
      .withIndex('by_user_game_convo', (q) =>
        q.eq('userId', userId).eq('game', 'bottleSpin').eq('convoId', convoId).eq('windowKey', windowKey)
      )
      .first();

    let newSkipCount: number;

    if (existing) {
      // Update existing record
      newSkipCount = existing.skipCount + delta;
      await ctx.db.patch(existing._id, {
        skipCount: newSkipCount,
        updatedAt: now,
      });
    } else {
      // Create new record
      newSkipCount = delta;
      await ctx.db.insert('userGameLimits', {
        userId,
        game: 'bottleSpin',
        convoId,
        windowKey,
        skipCount: newSkipCount,
        updatedAt: now,
      });
    }

    return { skipCount: newSkipCount };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BOTTLE SPIN GAME SESSIONS: Invite, Accept, Reject, End flow
// ═══════════════════════════════════════════════════════════════════════════

type BottleSpinSessionDoc = Doc<'bottleSpinSessions'>;

const isPendingInviteExpired = (session: BottleSpinSessionDoc, now: number) =>
  session.status === 'pending' && now - session.createdAt >= BOTTLE_SPIN_PENDING_INVITE_TIMEOUT_MS;

async function expireStalePendingSessions(
  ctx: MutationCtx,
  sessions: BottleSpinSessionDoc[],
  now: number
) {
  const stalePendingSessions = sessions.filter((session) => isPendingInviteExpired(session, now));

  await Promise.all(
    stalePendingSessions.map((session) =>
      ctx.db.patch(session._id, {
        status: 'expired',
        respondedAt: session.respondedAt ?? now,
      })
    )
  );
}

// Get current game session status for a conversation
// CRITICAL FIX: Query ALL sessions and find the active/pending one, not just the latest
export const getBottleSpinSession = query({
  args: {
    conversationId: v.string(),
  },
  handler: async (ctx, { conversationId }) => {
    // FIX: Collect ALL sessions for this conversation to find the right one
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    if (allSessions.length === 0) {
      return { state: 'none' as const };
    }

    const now = Date.now();

    // Priority 1: Find ACTIVE session (should only be one, but take the most recent)
    const activeSessions = allSessions.filter((s) => s.status === 'active');
    if (activeSessions.length > 0) {
      // Sort by createdAt descending to get most recent active
      activeSessions.sort((a, b) => b.createdAt - a.createdAt);
      const session = activeSessions[0];

      // TD-LIFECYCLE: Check for "accepted but not started" timeout
      // If game was accepted but never manually started within the timeout window,
      // surface it as 'expired' so the client can call cleanupExpiredSession.
      const hasGameStarted = !!session.gameStartedAt;
      const acceptedAt = session.acceptedAt || session.respondedAt || session.createdAt;
      const timeSinceAccepted = now - acceptedAt;

      if (!hasGameStarted && timeSinceAccepted >= BOTTLE_SPIN_NOT_STARTED_TIMEOUT_MS) {
        return {
          state: 'expired' as const,
          endedReason: 'not_started' as const,
          sessionId: session._id,
        };
      }

      // TD-LIFECYCLE: Inactivity timeout (only meaningful once the game has started)
      if (hasGameStarted) {
        const lastAction = session.lastActionAt || session.gameStartedAt || acceptedAt;
        const timeSinceLastAction = now - lastAction;

        if (timeSinceLastAction >= BOTTLE_SPIN_INACTIVITY_TIMEOUT_MS) {
          return {
            state: 'expired' as const,
            endedReason: 'timeout' as const,
            sessionId: session._id,
          };
        }
      }

      return {
        state: 'active' as const,
        sessionId: session._id,
        inviterId: session.inviterId,
        inviteeId: session.inviteeId,
        currentTurnUserId: session.currentTurnUserId,
        currentTurnRole: session.currentTurnRole,
        spinTurnRole: session.spinTurnRole,
        turnPhase: session.turnPhase,
        lastSpinResult: session.lastSpinResult,
        // RANDOM-TARGET-FIX: Surface streak tracking so frontend can render
        // fairness-aware UI hints and stay in sync with backend selection.
        lastSelectedRole: session.lastSelectedRole,
        consecutiveSelectedCount: session.consecutiveSelectedCount ?? 0,
        // TD-LIFECYCLE: Frontend uses these to gate auto-open and detect expiry
        gameStartedAt: session.gameStartedAt,
        acceptedAt: session.acceptedAt,
        lastActionAt: session.lastActionAt,
      };
    }

    // Priority 2: Find PENDING session (invite waiting for response)
    // WAIT-FIX: Pending invites expire after 5 minutes - treat expired ones as 'expired'
    // so the client can clean them up rather than silently swallowing them.
    const pendingSessions = allSessions.filter((session) => session.status === 'pending');
    const freshPendingSessions = pendingSessions.filter(
      (session) => !isPendingInviteExpired(session, now)
    );
    if (freshPendingSessions.length > 0) {
      freshPendingSessions.sort((a, b) => b.createdAt - a.createdAt);
      const session = freshPendingSessions[0];
      return {
        state: 'pending' as const,
        sessionId: session._id,
        inviterId: session.inviterId,
        inviteeId: session.inviteeId,
        createdAt: session.createdAt,
      };
    }
    if (pendingSessions.length > 0) {
      // All pending sessions are stale → expired (will be cleaned up on next mutation).
      pendingSessions.sort((a, b) => b.createdAt - a.createdAt);
      const session = pendingSessions[0];
      return {
        state: 'expired' as const,
        endedReason: 'invite_expired' as const,
        sessionId: session._id,
      };
    }

    // Priority 3: Check for cooldown from most recent ended/rejected/expired session
    const endedSessions = allSessions.filter(
      (s) => (s.status === 'ended' || s.status === 'rejected' || s.status === 'expired') && s.cooldownUntil
    );
    if (endedSessions.length > 0) {
      endedSessions.sort((a, b) => b.createdAt - a.createdAt);
      const session = endedSessions[0];
      if (session.cooldownUntil && session.cooldownUntil > now) {
        return {
          state: 'cooldown' as const,
          cooldownUntil: session.cooldownUntil,
          remainingMs: session.cooldownUntil - now,
        };
      }
    }

    // No active/pending session and no cooldown = can start fresh
    return { state: 'none' as const };
  },
});

// Send a game invite
// CRITICAL FIX: Check ALL sessions for active/pending status
export const sendBottleSpinInvite = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
    otherUserId: v.string(),
  },
  handler: async (ctx, { authUserId, conversationId, otherUserId }) => {
    if (authUserId === otherUserId) {
      throw new Error('You cannot invite yourself');
    }

    if (!await resolveUserIdByAuthId(ctx, authUserId)) {
      throw new Error('Unauthorized: user not found');
    }

    if (!await resolveUserIdByAuthId(ctx, otherUserId)) {
      throw new Error('Invited user not found');
    }

    const now = Date.now();

    // FIX: Check ALL sessions for this conversation
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    await expireStalePendingSessions(ctx, allSessions, now);

    const freshPendingSession = allSessions.find(
      (session) => session.status === 'pending' && !isPendingInviteExpired(session, now)
    );
    if (freshPendingSession) {
      throw new Error('Invite already pending');
    }

    // Block if ANY session is active
    const activeSession = allSessions.find((s) => s.status === 'active');
    if (activeSession) {
      throw new Error('Game already active');
    }

    // Block if most recent ended/rejected session has active cooldown
    const sessionsWithCooldown = allSessions.filter(
      (s) => (s.status === 'ended' || s.status === 'rejected') && s.cooldownUntil && s.cooldownUntil > now
    );
    if (sessionsWithCooldown.length > 0) {
      throw new Error('Cooldown active');
    }

    // Create new invite session using the auth IDs passed by the Messages UI.
    await ctx.db.insert('bottleSpinSessions', {
      conversationId,
      inviterId: authUserId,
      inviteeId: otherUserId,
      status: 'pending',
      createdAt: now,
    });

    return { success: true };
  },
});

// Respond to a game invite (accept or reject)
// CRITICAL FIX: Find the PENDING session specifically
export const respondToBottleSpinInvite = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
    accept: v.boolean(),
  },
  handler: async (ctx, { authUserId, conversationId, accept }) => {
    if (!await resolveUserIdByAuthId(ctx, authUserId)) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();

    // FIX: Find the PENDING session specifically
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    const hadAnyPendingSession = allSessions.some((session) => session.status === 'pending');
    await expireStalePendingSessions(ctx, allSessions, now);

    const pendingSessions = allSessions.filter(
      (session) => session.status === 'pending' && !isPendingInviteExpired(session, now)
    );
    if (pendingSessions.length === 0) {
      throw new Error(hadAnyPendingSession ? 'Invite expired' : 'No pending invite found');
    }

    // Get most recent pending session
    pendingSessions.sort((a, b) => b.createdAt - a.createdAt);
    const session = pendingSessions[0];

    // Only the invitee can respond
    if (session.inviteeId !== authUserId) {
      throw new Error('Only the invited user can respond');
    }

    if (accept) {
      // TD-LIFECYCLE: Accept invite - set to active but game NOT started yet
      // Game remains in 'idle' state until inviter manually starts it
      await ctx.db.patch(session._id, {
        status: 'active',
        respondedAt: now,
        acceptedAt: now,           // TD-LIFECYCLE: Track when accepted
        lastActionAt: now,         // TD-LIFECYCLE: Track last activity
        // Initialize turn state - game is idle until manual start
        turnPhase: 'idle',
        spinTurnRole: 'inviter',   // Inviter gets first spin when game starts
        currentTurnRole: undefined,
        lastSpinResult: undefined,
        // gameStartedAt remains undefined - set when inviter manually starts
      });
      return { success: true, status: 'active' as const };
    } else {
      // Reject: set cooldown
      await ctx.db.patch(session._id, {
        status: 'rejected',
        respondedAt: now,
        cooldownUntil: now + BOTTLE_SPIN_COOLDOWN_MS,
      });
      return { success: true, status: 'rejected' as const };
    }
  },
});

// End an active game
// CRITICAL FIX: Find the ACTIVE session specifically
export const endBottleSpinGame = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, { authUserId, conversationId }) => {
    if (!await resolveUserIdByAuthId(ctx, authUserId)) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();

    // FIX: Find the ACTIVE session specifically
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    const activeSessions = allSessions.filter((s) => s.status === 'active');
    if (activeSessions.length === 0) {
      throw new Error('No active game found');
    }

    // Get most recent active session
    activeSessions.sort((a, b) => b.createdAt - a.createdAt);
    const session = activeSessions[0];

    // Either participant can end the game
    if (session.inviterId !== authUserId && session.inviteeId !== authUserId) {
      throw new Error('Only participants can end the game');
    }

    // TD-LIFECYCLE: End the game with proper reason tracking
    await ctx.db.patch(session._id, {
      status: 'ended',
      endedAt: now,
      endedReason: 'manual',
      cooldownUntil: now + BOTTLE_SPIN_COOLDOWN_MS,
    });

    return { success: true };
  },
});

// TD-LIFECYCLE: Manual start game (inviter must explicitly start after acceptance)
// This is the critical fix: game modal should only open after this mutation succeeds
export const startBottleSpinGame = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, { authUserId, conversationId }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();

    // Find the ACTIVE session
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    const activeSessions = allSessions.filter((s) => s.status === 'active');
    if (activeSessions.length === 0) {
      throw new Error('No active game session found');
    }

    activeSessions.sort((a, b) => b.createdAt - a.createdAt);
    const session = activeSessions[0];

    // Only the INVITER can start the game
    if (session.inviterId !== authUserId) {
      return { success: false, reason: 'only_inviter_can_start' as const };
    }

    // Check if game already started (idempotent)
    if (session.gameStartedAt) {
      return { success: true, alreadyStarted: true as const };
    }

    // TD-LIFECYCLE: Mark game as started
    await ctx.db.patch(session._id, {
      gameStartedAt: now,
      lastActionAt: now,
    });

    return { success: true, gameStartedAt: now };
  },
});

// TD-LIFECYCLE: Clean up expired sessions (mark them as expired in DB)
// Called by frontend when it detects an expired state
export const cleanupExpiredSession = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
    endedReason: v.union(
      v.literal('invite_expired'),
      v.literal('not_started'),
      v.literal('timeout')
    ),
  },
  handler: async (ctx, { authUserId, conversationId, endedReason }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();

    // Find sessions that need cleanup
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    let cleanedCount = 0;

    // Mark expired pending sessions
    if (endedReason === 'invite_expired') {
      const pendingSessions = allSessions.filter((s) => s.status === 'pending');
      for (const session of pendingSessions) {
        if (session.cooldownUntil && session.cooldownUntil <= now) {
          continue;
        }

        await ctx.db.patch(session._id, {
          status: 'expired',
          endedAt: now,
          endedReason,
          ...(session.cooldownUntil && session.cooldownUntil > now
            ? {}
            : { cooldownUntil: now + BOTTLE_SPIN_COOLDOWN_MS }),
        });
        cleanedCount++;
      }
    }

    // Mark expired active sessions (not started or timeout)
    if (endedReason === 'not_started' || endedReason === 'timeout') {
      const activeSessions = allSessions.filter((s) => s.status === 'active');
      for (const session of activeSessions) {
        if (session.cooldownUntil && session.cooldownUntil <= now) {
          continue;
        }

        await ctx.db.patch(session._id, {
          status: 'expired',
          endedAt: now,
          endedReason,
          ...(session.cooldownUntil && session.cooldownUntil > now
            ? {}
            : { cooldownUntil: now + BOTTLE_SPIN_COOLDOWN_MS }),
        });
        cleanedCount++;
      }
    }

    return { success: true, cleanedCount };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BOTTLE SPIN TURN TRACKING: Real-time sync of turn ownership across devices
// ═══════════════════════════════════════════════════════════════════════════

// Update turn state after spin completes or choice is made
// CRITICAL FIX: Find the ACTIVE session specifically, not just the latest one
export const setBottleSpinTurn = mutation({
  args: {
    authUserId: v.string(),
    conversationId: v.string(),
    // Role-based turn tracking (avoids ID format mismatch issues)
    currentTurnRole: v.optional(v.union(
      v.literal('inviter'),
      v.literal('invitee')
    )),
    turnPhase: v.union(
      v.literal('idle'),
      v.literal('spinning'),
      v.literal('choosing'),
      v.literal('complete')
    ),
    lastSpinResult: v.optional(v.string()), // 'truth' | 'dare' | 'skip'
  },
  handler: async (ctx, { authUserId, conversationId, currentTurnRole, turnPhase, lastSpinResult }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // FIX: Find the ACTIVE session specifically, not just the latest one
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    // Filter for active sessions only
    const activeSessions = allSessions.filter((s) => s.status === 'active');

    if (activeSessions.length === 0) {
      throw new Error('No active game found');
    }

    // Get most recent active session (should only be one, but be safe)
    activeSessions.sort((a, b) => b.createdAt - a.createdAt);
    const session = activeSessions[0];

    // Only participants can update turn state
    if (session.inviterId !== authUserId && session.inviteeId !== authUserId) {
      throw new Error('Only participants can update turn state');
    }

    // SPIN-TURN-FIX: Determine caller's role for ownership enforcement.
    const callerRole: 'inviter' | 'invitee' = session.inviterId === authUserId ? 'inviter' : 'invitee';

    // SPIN-TURN-FIX: Only the current spin-turn owner can initiate a spin.
    if (turnPhase === 'spinning') {
      const currentSpinTurnRole = session.spinTurnRole || 'inviter';
      if (callerRole !== currentSpinTurnRole) {
        throw new Error('Not your turn to spin');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RANDOM-TARGET-FIX: Backend-only random selection with fairness cap.
    // ALL randomness happens in backend so both devices stay in sync.
    // ═══════════════════════════════════════════════════════════════════════════
    const MAX_CONSECUTIVE_SAME_TARGET = 3;
    let selectedTargetRole: 'inviter' | 'invitee' | undefined = currentTurnRole;
    let nextLastSelectedRole = session.lastSelectedRole;
    let nextConsecutiveCount = session.consecutiveSelectedCount ?? 0;

    if (turnPhase === 'spinning') {
      const lastSelected = session.lastSelectedRole;
      const consecutiveCount = session.consecutiveSelectedCount ?? 0;

      if (lastSelected && consecutiveCount >= MAX_CONSECUTIVE_SAME_TARGET) {
        // Force the opposite of lastSelectedRole to enforce fairness cap.
        selectedTargetRole = lastSelected === 'inviter' ? 'invitee' : 'inviter';
      } else {
        // Normal 50/50 random selection, performed in backend.
        selectedTargetRole = Math.random() < 0.5 ? 'inviter' : 'invitee';
      }

      // Update streak tracking immediately.
      if (selectedTargetRole === lastSelected) {
        nextConsecutiveCount = consecutiveCount + 1;
      } else {
        nextConsecutiveCount = 1;
      }
      nextLastSelectedRole = selectedTargetRole;
    }

    // SPIN-TURN-FIX: Alternate spinTurnRole when round completes
    // (inviter -> invitee -> inviter ...).
    let nextSpinTurnRole = session.spinTurnRole;
    if (turnPhase === 'complete') {
      nextSpinTurnRole = session.spinTurnRole === 'inviter' ? 'invitee' : 'inviter';
    }

    const now = Date.now();

    // TD-LIFECYCLE: Persist turn state, streak tracking, and bump lastActionAt
    // so the inactivity timeout only fires when the game is genuinely idle.
    await ctx.db.patch(session._id, {
      currentTurnRole: selectedTargetRole,
      turnPhase,
      spinTurnRole: nextSpinTurnRole,
      lastSpinResult: lastSpinResult ?? session.lastSpinResult,
      lastSelectedRole: nextLastSelectedRole,
      consecutiveSelectedCount: nextConsecutiveCount,
      lastActionAt: now,
    });

    // Return the selected target so frontend knows the animation direction.
    return {
      success: true,
      selectedTargetRole,
    };
  },
});
