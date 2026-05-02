import { mutation, query, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { type Doc, Id } from './_generated/dataModel';
import { asUserId } from './id';
import { resolveUserIdByAuthId, getPhase2DisplayName } from './helpers';
import {
  BOTTLE_SPIN_COOLDOWN_MS,
  BOTTLE_SPIN_PENDING_INVITE_TIMEOUT_MS,
  BOTTLE_SPIN_NOT_STARTED_TIMEOUT_MS,
  BOTTLE_SPIN_INACTIVITY_TIMEOUT_MS,
} from '../lib/bottleSpin';

// ═══════════════════════════════════════════════════════════════════════════
// P2-TOD-CHAT-EVENTS: Phase-2 Truth-or-Dare in-chat system messages
// ───────────────────────────────────────────────────────────────────────────
// Bottle-spin lifecycle events are emitted as `type: 'system'` rows on the
// privateMessages table so they appear inline in the Phase-2 chat thread.
//
// Subtype semantics:
//   - 'tod_perm' → permanent transcript chip (invite, spin, bottle pick, T/D
//     choice). Stays in the thread for the 24h retention window.
//   - 'tod_temp' → transient chip (accept, start, skip, end, timeout). Hidden
//     by the client 5 minutes after the viewer's `readAt` is set.
//
// Strict isolation: writes only to Phase-2 tables (`privateMessages`,
// `privateConversations`). Skips unread-counter increment so game chips do
// not produce inbox badges or push-style notifications.
// ═══════════════════════════════════════════════════════════════════════════

type TodSystemSubtype = 'tod_perm' | 'tod_temp';

async function insertTodSystemMessage(
  ctx: MutationCtx,
  args: {
    conversationId: string;
    authUserId: string;
    content: string;
    subtype: TodSystemSubtype;
    eventKey: string;
  }
): Promise<void> {
  const conversationId = ctx.db.normalizeId(
    'privateConversations',
    args.conversationId
  );
  if (!conversationId) {
    // Bottle-spin sessions can technically reference a non-Phase-2 chat (legacy
    // demo path). Skip silently — never throw, since this is a side-effect of
    // a game mutation that has already succeeded.
    console.log(
      '[P2_TOD_CHAT_EVENT_SKIP] non-Phase-2 conversationId:',
      args.conversationId.slice(-8)
    );
    return;
  }

  const senderId = await resolveUserIdByAuthId(ctx, args.authUserId);
  if (!senderId) {
    console.log(
      '[P2_TOD_CHAT_EVENT_SKIP] could not resolve senderId for authUserId:',
      args.authUserId.slice(-8)
    );
    return;
  }

  // Verify the conversation still exists and the actor is a participant
  // (defence-in-depth — the calling game mutation already authenticated).
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return;
  if (!conversation.participants.includes(senderId)) return;

  const existing = await ctx.db
    .query('privateMessages')
    .withIndex('by_conversation_system_event', (q) =>
      q.eq('conversationId', conversationId).eq('systemEventKey', args.eventKey)
    )
    .first();
  if (existing) return;

  const now = Date.now();
  await ctx.db.insert('privateMessages', {
    conversationId,
    senderId,
    type: 'system',
    systemSubtype: args.subtype,
    systemEventKey: args.eventKey,
    content: args.content,
    createdAt: now,
  });

  // Bump lastMessageAt so the chat list shows recent activity, but DO NOT
  // touch unread counts or privateNotifications — game chips are not inbox
  // events.
  await ctx.db.patch(conversationId, { lastMessageAt: now });
}

async function todDisplayName(
  ctx: MutationCtx,
  authUserId: string
): Promise<string> {
  const userId = await resolveUserIdByAuthId(ctx, authUserId);
  if (!userId) return 'Someone';
  return (await getPhase2DisplayName(ctx, userId)) ?? 'Someone';
}

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
    const sessionId = await ctx.db.insert('bottleSpinSessions', {
      conversationId,
      inviterId: authUserId,
      inviteeId: otherUserId,
      status: 'pending',
      createdAt: now,
    });

    // P2-TOD-CHAT-EVENTS: Permanent transcript chip — invite sent.
    const inviterName = await todDisplayName(ctx, authUserId);
    await insertTodSystemMessage(ctx, {
      conversationId,
      authUserId,
      content: `${inviterName} invited you to play Truth or Dare`,
      subtype: 'tod_perm',
      eventKey: `tod:${sessionId}:invite_sent:${authUserId}:${otherUserId}`,
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

      // P2-TOD-CHAT-EVENTS: Transient chip — invite accepted.
      const accepterName = await todDisplayName(ctx, authUserId);
      await insertTodSystemMessage(ctx, {
        conversationId,
        authUserId,
        content: `${accepterName} accepted the invite`,
        subtype: 'tod_temp',
        eventKey: `tod:${session._id}:invite_accepted:${authUserId}`,
      });

      return { success: true, status: 'active' as const };
    } else {
      // Reject: set cooldown
      await ctx.db.patch(session._id, {
        status: 'rejected',
        respondedAt: now,
        cooldownUntil: now + BOTTLE_SPIN_COOLDOWN_MS,
      });

      // P2-TOD-CHAT-EVENTS: Transient chip — invite declined.
      const declinerName = await todDisplayName(ctx, authUserId);
      await insertTodSystemMessage(ctx, {
        conversationId,
        authUserId,
        content: `${declinerName} declined the invite`,
        subtype: 'tod_temp',
        eventKey: `tod:${session._id}:invite_declined:${authUserId}`,
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

    // P2-TOD-CHAT-EVENTS: Transient chip — game ended manually.
    const enderName = await todDisplayName(ctx, authUserId);
    await insertTodSystemMessage(ctx, {
      conversationId,
      authUserId,
      content: `${enderName} ended the game`,
      subtype: 'tod_temp',
      eventKey: `tod:${session._id}:manual_end:${authUserId}`,
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

    // P2-TOD-CHAT-EVENTS: Transient chip — game started.
    await insertTodSystemMessage(ctx, {
      conversationId,
      authUserId,
      content: `Game started`,
      subtype: 'tod_temp',
      eventKey: `tod:${session._id}:game_started`,
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
    const cleanedSessionIds: string[] = [];

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
        cleanedSessionIds.push(session._id);
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
        cleanedSessionIds.push(session._id);
      }
    }

    // P2-TOD-CHAT-EVENTS: Transient chip — timeout / expiry. Only emit when we
    // actually transitioned a session to 'expired' so we never spam the chat
    // on idempotent cleanup retries.
    if (cleanedCount > 0) {
      const expiryCopy =
        endedReason === 'invite_expired'
          ? 'Game invite expired'
          : 'Game ended due to inactivity';
      await insertTodSystemMessage(ctx, {
        conversationId,
        authUserId,
        content: expiryCopy,
        subtype: 'tod_temp',
        eventKey: `tod:${cleanedSessionIds.sort().join(',')}:expired:${endedReason}`,
      });
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

    const turnPhaseOrder = {
      idle: 0,
      spinning: 1,
      choosing: 2,
      complete: 3,
    } as const;
    const sessionTurnPhase = session.turnPhase ?? 'idle';
    const isCompleteToIdleReset =
      sessionTurnPhase === 'complete' &&
      turnPhase === 'idle' &&
      currentTurnRole === undefined;
    const isStaleOlderPhase =
      turnPhaseOrder[turnPhase] < turnPhaseOrder[sessionTurnPhase] &&
      !isCompleteToIdleReset;
    const isStalePostResetPhase =
      sessionTurnPhase === 'idle' &&
      (turnPhase === 'choosing' || turnPhase === 'complete');

    // Stale delayed retries can arrive after the live turn has already moved
    // forward. Ignore them before patching so old requests cannot rewrite turn
    // state or emit duplicate system chips with a newer lastActionAt key.
    if (isStaleOlderPhase || isStalePostResetPhase) {
      return { success: true, selectedTargetRole: session.currentTurnRole };
    }

    // SPIN-TURN-FIX: Only the current spin-turn owner can initiate a spin.
    if (turnPhase === 'spinning') {
      const currentSpinTurnRole = session.spinTurnRole || 'inviter';
      if (callerRole !== currentSpinTurnRole) {
        throw new Error('Not your turn to spin');
      }
    }

    // Idempotency guard for retried taps/mutations. If the active session is
    // already in the requested transition state, do not patch again and do not
    // emit another T/D system chip.
    if (
      turnPhase === 'spinning' &&
      session.turnPhase === 'spinning' &&
      session.currentTurnRole
    ) {
      return { success: true, selectedTargetRole: session.currentTurnRole };
    }
    if (
      turnPhase === 'choosing' &&
      session.turnPhase === 'choosing' &&
      session.currentTurnRole === currentTurnRole
    ) {
      return { success: true, selectedTargetRole: session.currentTurnRole };
    }
    if (
      turnPhase === 'complete' &&
      session.turnPhase === 'complete' &&
      lastSpinResult &&
      session.lastSpinResult === lastSpinResult
    ) {
      return { success: true, selectedTargetRole: session.currentTurnRole };
    }
    if (
      turnPhase === 'idle' &&
      session.turnPhase === 'idle' &&
      currentTurnRole === undefined
    ) {
      return { success: true, selectedTargetRole: session.currentTurnRole };
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
    const previousActionAt =
      session.lastActionAt ?? session.gameStartedAt ?? session.createdAt;

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

    // ═══════════════════════════════════════════════════════════════════════
    // P2-TOD-CHAT-EVENTS: Emit in-chat system messages for the user-visible
    // turn transitions. We only emit on the transition that actually
    // produced new state to avoid duplicate chips on idempotent retries.
    // ═══════════════════════════════════════════════════════════════════════
    if (turnPhase === 'spinning' && selectedTargetRole) {
      const callerName = await todDisplayName(ctx, authUserId);
      // Permanent: spinner identity stays in transcript.
      await insertTodSystemMessage(ctx, {
        conversationId,
        authUserId,
        content: `${callerName} spun the bottle`,
        subtype: 'tod_perm',
        eventKey: `tod:${session._id}:spun:${previousActionAt}:${authUserId}`,
      });
      // Permanent: bottle target. Resolve the target's display name from the
      // session.inviterId/inviteeId mapping so we never leak the wrong name.
      const targetAuthUserId =
        selectedTargetRole === 'inviter' ? session.inviterId : session.inviteeId;
      const targetName = await todDisplayName(ctx, targetAuthUserId);
      await insertTodSystemMessage(ctx, {
        conversationId,
        authUserId,
        content: `Bottle landed on ${targetName}`,
        subtype: 'tod_perm',
        eventKey: `tod:${session._id}:landed:${previousActionAt}:${selectedTargetRole}`,
      });
    } else if (turnPhase === 'choosing' && lastSpinResult === 'skip') {
      // Skip during the choose step — transient.
      const skipperName = await todDisplayName(ctx, authUserId);
      await insertTodSystemMessage(ctx, {
        conversationId,
        authUserId,
        content: `${skipperName} skipped this turn`,
        subtype: 'tod_temp',
        eventKey: `tod:${session._id}:skip_choosing:${previousActionAt}:${authUserId}`,
      });
    } else if (turnPhase === 'complete' && lastSpinResult) {
      const actorName = await todDisplayName(ctx, authUserId);
      if (lastSpinResult === 'truth' || lastSpinResult === 'dare') {
        const label = lastSpinResult === 'truth' ? 'Truth' : 'Dare';
        await insertTodSystemMessage(ctx, {
          conversationId,
          authUserId,
          content: `${actorName} chose ${label}`,
          subtype: 'tod_perm',
          eventKey: `tod:${session._id}:choice:${previousActionAt}:${authUserId}:${lastSpinResult}`,
        });
      } else if (lastSpinResult === 'skip') {
        await insertTodSystemMessage(ctx, {
          conversationId,
          authUserId,
          content: `${actorName} skipped this turn`,
          subtype: 'tod_temp',
          eventKey: `tod:${session._id}:choice:${previousActionAt}:${authUserId}:skip`,
        });
      }
    }

    // Return the selected target so frontend knows the animation direction.
    return {
      success: true,
      selectedTargetRole,
    };
  },
});
