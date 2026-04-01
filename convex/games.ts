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

    console.log('[P2_TD_INVITE_QUERY] Conv:', conversationId?.slice(-8), 'sessions:', allSessions.length);

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
        // SPIN-TURN-FIX: Include spinTurnRole in response
        spinTurnRole: session.spinTurnRole,
        turnPhase: session.turnPhase,
        lastSpinResult: session.lastSpinResult,
        // RANDOM-TARGET-FIX: Include streak tracking for fairness cap
        lastSelectedRole: session.lastSelectedRole,
        consecutiveSelectedCount: session.consecutiveSelectedCount ?? 0,
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
        console.log('[P2_TD_INVITE_QUERY] Found PENDING session:', (session._id as string).slice(-8), 'inviter:', session.inviterId?.slice(-8), 'invitee:', session.inviteeId?.slice(-8));
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

    // ROOT CAUSE FIX: Only block VALID (non-expired) pending sessions
    // Must match PENDING_INVITE_TIMEOUT_MS (5 min) from getBottleSpinSession
    // Previously: old expired pending sessions blocked new invites indefinitely
    const pendingSession = allSessions.find((s) =>
      s.status === 'pending' && (now - s.createdAt) < PENDING_INVITE_TIMEOUT_MS
    );
    if (pendingSession) {
      return { success: false, status: 'already_pending' };
    }

    // CLEANUP: Mark expired pending sessions as 'expired' to prevent future blocking
    const expiredPendingSessions = allSessions.filter((s) =>
      s.status === 'pending' && (now - s.createdAt) >= PENDING_INVITE_TIMEOUT_MS
    );
    for (const expired of expiredPendingSessions) {
      await ctx.db.patch(expired._id, { status: 'expired' });
      console.log('[P2_TD_CLEANUP] Marked expired pending session:', (expired._id as string).slice(-8));
    }

    // Block if ANY session is active - return status, do NOT throw
    const activeSession = allSessions.find((s) => s.status === 'active');
    if (activeSession) {
      return { success: false, status: 'game_active' };
    }

    // Block if most recent ended/rejected session has active cooldown
    const sessionsWithCooldown = allSessions.filter(
      (s) => (s.status === 'ended' || s.status === 'rejected') && s.cooldownUntil && s.cooldownUntil > now
    );
    if (sessionsWithCooldown.length > 0) {
      return { success: false, status: 'cooldown_active' };
    }

    // Create new invite session - use Convex IDs directly (passed from frontend)
    const sessionId = await ctx.db.insert('bottleSpinSessions', {
      conversationId,
      inviterId: authUserId,
      inviteeId: otherUserId,
      status: 'pending',
      createdAt: now,
    });

    console.log('[P2_TD_INVITE_SEND] Created session:', (sessionId as string).slice(-8), 'inviter:', authUserId?.slice(-8), 'invitee:', otherUserId?.slice(-8));

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
      // SPIN-TURN-FIX: Initialize spinTurnRole to 'inviter' (inviter spins first)
      await ctx.db.patch(session._id, {
        status: 'active',
        respondedAt: now,
        // Initialize turn state to avoid undefined issues
        turnPhase: 'idle',
        spinTurnRole: 'inviter', // Inviter gets first spin
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
// SPIN-TURN-FIX: Added spin turn ownership validation and alternation
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

    // SPIN-TURN-FIX: Determine caller's role
    const callerRole: 'inviter' | 'invitee' = session.inviterId === authUserId ? 'inviter' : 'invitee';

    // SPIN-TURN-FIX: Enforce spin turn ownership
    // Only the current spin turn owner can initiate a spin (transition to 'spinning')
    if (turnPhase === 'spinning') {
      const currentSpinTurnRole = session.spinTurnRole || 'inviter'; // Default to inviter if not set
      if (callerRole !== currentSpinTurnRole) {
        console.log('[SPIN-TURN-FIX] Rejected spin attempt - not turn owner', {
          callerRole,
          currentSpinTurnRole,
          authUserId,
          conversationId,
        });
        throw new Error('Not your turn to spin');
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RANDOM-TARGET-FIX: Backend-only random selection with fairness cap
    // ALL randomness happens in backend to ensure both devices stay in sync
    // ═══════════════════════════════════════════════════════════════════════════
    const MAX_CONSECUTIVE_SAME_TARGET = 3;
    let selectedTargetRole: 'inviter' | 'invitee' | undefined = currentTurnRole;
    let nextLastSelectedRole = session.lastSelectedRole;
    let nextConsecutiveCount = session.consecutiveSelectedCount ?? 0;

    // When spinning starts, generate the random selection NOW (not in frontend)
    if (turnPhase === 'spinning') {
      const lastSelected = session.lastSelectedRole;
      const consecutiveCount = session.consecutiveSelectedCount ?? 0;

      // Check if fairness cap is triggered
      if (lastSelected && consecutiveCount >= MAX_CONSECUTIVE_SAME_TARGET) {
        // Force the opposite of lastSelectedRole
        selectedTargetRole = lastSelected === 'inviter' ? 'invitee' : 'inviter';
        console.log('[RANDOM-TARGET-FIX] Backend: Fairness cap triggered!', {
          lastSelected,
          consecutiveCount,
          forcedTarget: selectedTargetRole,
        });
      } else {
        // Normal random selection (50/50) - BACKEND Math.random()
        const randomValue = Math.random();
        selectedTargetRole = randomValue < 0.5 ? 'inviter' : 'invitee';
        console.log('[RANDOM-TARGET-FIX] Backend: Random selection', {
          randomValue,
          selectedTarget: selectedTargetRole,
          lastSelected,
          consecutiveCount,
        });
      }

      // Update streak tracking immediately
      if (selectedTargetRole === lastSelected) {
        nextConsecutiveCount = consecutiveCount + 1;
      } else {
        nextConsecutiveCount = 1;
      }
      nextLastSelectedRole = selectedTargetRole;
    }

    // SPIN-TURN-FIX: Calculate next spinTurnRole when round completes
    // After each complete round, alternate who gets to spin next
    let nextSpinTurnRole = session.spinTurnRole;
    if (turnPhase === 'complete') {
      // Alternate spin turn: inviter -> invitee -> inviter ...
      nextSpinTurnRole = session.spinTurnRole === 'inviter' ? 'invitee' : 'inviter';
      console.log('[SPIN-TURN-FIX] Round complete, alternating spinTurnRole', {
        previousSpinTurnRole: session.spinTurnRole,
        nextSpinTurnRole,
      });
    }

    // Update turn state with role-based ownership and streak tracking
    await ctx.db.patch(session._id, {
      currentTurnRole: selectedTargetRole,
      turnPhase,
      spinTurnRole: nextSpinTurnRole,
      lastSpinResult: lastSpinResult ?? session.lastSpinResult,
      // RANDOM-TARGET-FIX: Persist streak tracking
      lastSelectedRole: nextLastSelectedRole,
      consecutiveSelectedCount: nextConsecutiveCount,
    });

    // Return the selected target so frontend knows animation direction
    return {
      success: true,
      selectedTargetRole: selectedTargetRole,
    };
  },
});
