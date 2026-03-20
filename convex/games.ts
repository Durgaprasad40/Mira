import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { asUserId } from './id';
import { resolveUserIdByAuthId } from './helpers';

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

const TEN_MINUTES_MS = 10 * 60 * 1000;
// WAIT-FIX: Pending invites expire after 5 minutes if not responded
const PENDING_INVITE_TIMEOUT_MS = 5 * 60 * 1000;

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
      return {
        state: 'active' as const,
        sessionId: session._id,
        inviterId: session.inviterId,
        inviteeId: session.inviteeId,
        currentTurnUserId: session.currentTurnUserId,
        currentTurnRole: session.currentTurnRole,
        turnPhase: session.turnPhase,
        lastSpinResult: session.lastSpinResult,
      };
    }

    // Priority 2: Find PENDING session (invite waiting for response)
    // WAIT-FIX: Pending invites expire after 5 minutes - treat expired ones as 'none'
    const pendingSessions = allSessions.filter((s) => s.status === 'pending');
    if (pendingSessions.length > 0) {
      pendingSessions.sort((a, b) => b.createdAt - a.createdAt);
      const session = pendingSessions[0];

      // WAIT-FIX: Check if pending invite has expired
      const pendingAge = now - session.createdAt;
      if (pendingAge < PENDING_INVITE_TIMEOUT_MS) {
        // Still valid pending invite
        return {
          state: 'pending' as const,
          sessionId: session._id,
          inviterId: session.inviterId,
          inviteeId: session.inviteeId,
          createdAt: session.createdAt,
        };
      }
      // WAIT-FIX: Expired pending invite - fall through to cooldown/none check
      // The pending session is stale, don't return it as pending
    }

    // Priority 3: Check for cooldown from most recent ended/rejected session
    const endedSessions = allSessions.filter(
      (s) => (s.status === 'ended' || s.status === 'rejected') && s.cooldownUntil
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
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // P0-T&D-FIX: Use Convex IDs directly for both inviter and invitee
    // Frontend passes Convex document IDs (user._id) as "authUserId" parameter
    // DO NOT convert to user.authUserId field - that causes ID format mismatch
    // because frontend's useAuthStore().userId is the Convex ID, not the authUserId field

    const now = Date.now();

    // FIX: Check ALL sessions for this conversation
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    // Block if ANY session is pending
    const pendingSession = allSessions.find((s) => s.status === 'pending');
    if (pendingSession) {
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

    // Create new invite session - use Convex IDs directly (passed from frontend)
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
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const now = Date.now();

    // FIX: Find the PENDING session specifically
    const allSessions = await ctx.db
      .query('bottleSpinSessions')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .collect();

    const pendingSessions = allSessions.filter((s) => s.status === 'pending');
    if (pendingSessions.length === 0) {
      throw new Error('No pending invite found');
    }

    // Get most recent pending session
    pendingSessions.sort((a, b) => b.createdAt - a.createdAt);
    const session = pendingSessions[0];

    // Only the invitee can respond
    if (session.inviteeId !== authUserId) {
      throw new Error('Only the invited user can respond');
    }

    if (accept) {
      // Accept: activate the game AND initialize turn state
      await ctx.db.patch(session._id, {
        status: 'active',
        respondedAt: now,
        // Initialize turn state to avoid undefined issues
        turnPhase: 'idle',
        currentTurnRole: undefined,
        lastSpinResult: undefined,
      });
      return { success: true, status: 'active' as const };
    } else {
      // Reject: set cooldown
      await ctx.db.patch(session._id, {
        status: 'rejected',
        respondedAt: now,
        cooldownUntil: now + TEN_MINUTES_MS,
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
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
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

    // End the game with cooldown
    await ctx.db.patch(session._id, {
      status: 'ended',
      endedAt: now,
      cooldownUntil: now + TEN_MINUTES_MS,
    });

    return { success: true };
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
      // Debug: Log what sessions exist for this conversation
      console.log('[BOTTLE_SPIN_DEBUG] setBottleSpinTurn - No active session found', {
        conversationId,
        authUserId,
        totalSessions: allSessions.length,
        sessionStatuses: allSessions.map((s) => ({ id: s._id, status: s.status, createdAt: s.createdAt })),
      });
      throw new Error('No active game found');
    }

    // Get most recent active session (should only be one, but be safe)
    activeSessions.sort((a, b) => b.createdAt - a.createdAt);
    const session = activeSessions[0];

    // Only participants can update turn state
    if (session.inviterId !== authUserId && session.inviteeId !== authUserId) {
      throw new Error('Only participants can update turn state');
    }

    // Update turn state with role-based ownership
    await ctx.db.patch(session._id, {
      currentTurnRole,
      turnPhase,
      lastSpinResult: lastSpinResult ?? session.lastSpinResult,
    });

    return { success: true };
  },
});
