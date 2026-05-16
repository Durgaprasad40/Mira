/**
 * LEGACY DARE V1
 * Not part of the active Phase-2 Truth or Dare tab flow.
 * Retained because the older chat-driven dare route is still reachable from
 * `app/(main)/dare/send.tsx` and `app/(main)/dare/index.tsx`.
 *
 * P0 HARDENING (TOD-AUTH-1 / TOD-AUTH-2):
 *   All public mutations and queries now require a session token validated
 *   server-side via `validateSessionToken`. The legacy `authUserId` arg is
 *   accepted only as an optional cross-check hint — it is NEVER trusted as
 *   the actor. Sender/receiver ownership is enforced against the
 *   token-resolved user id. `getDareCount` was removed because it had no
 *   frontend callsites and had no auth at all (PRIV-1).
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { reserveActionSlots, type RateLimitWindow } from './actionRateLimits';

/**
 * Resolve the calling user from a session token (TOD-AUTH-1).
 *
 * SECURITY CONTRACT — DO NOT WEAKEN:
 *   - The token is the ONLY source of truth for the caller's identity.
 *   - `authUserIdHint` (legacy arg) is accepted only as a defense-in-depth
 *     cross-check; if present it MUST resolve to the same user id, but it
 *     is NEVER trusted as the authoritative actor.
 *   - Throws on missing/invalid token or hint mismatch.  Every public
 *     `dares.ts` mutation/query starts with this call (or the inline
 *     equivalent in query handlers) — do not skip it on new endpoints.
 */
async function requireDareActor(
  ctx: any,
  token: string,
  authUserIdHint?: string,
): Promise<Id<'users'>> {
  const trimmedToken = (token ?? '').trim();
  if (trimmedToken.length === 0) {
    throw new Error('Unauthorized: authentication required');
  }
  const userId = await validateSessionToken(ctx, trimmedToken);
  if (!userId) {
    throw new Error('Unauthorized: invalid session');
  }
  const hint = authUserIdHint?.trim();
  if (hint) {
    const resolvedHint = await resolveUserIdByAuthId(ctx, hint);
    if (!resolvedHint || resolvedHint !== userId) {
      throw new Error('Unauthorized: identity mismatch');
    }
  }
  return userId;
}

// ============================================================
// P1 HARDENING: STRONGER RATE LIMITS (P1-DARE-RL-*)
// ============================================================
//
// Legacy V1 dares had NO rate limit at all on sendDare/acceptDare/declineDare.
// This section adds per-user minute/hour/day caps via the shared
// `reserveActionSlots` infrastructure plus a per-(sender, recipient) cap on
// sendDare to prevent targeted harassment without breaking the recipient
// anonymity rule.  P0 token-binding is preserved.
//
// Idempotency notes:
//   - sendDare already rejects when a pending dare exists from the same
//     sender to the same recipient (`existingDare` check), so rate-limit
//     denials never silently consume that check.
//   - acceptDare / declineDare already reject when `dare.isAccepted !==
//     undefined`, so replay after-action is a no-op; the rate limit caps
//     per-user accept/decline velocity.
//
// `getDareCount` was removed in P0 (PRIV-1) and is NOT being reintroduced.

const DARE_RATE_LIMIT_ERROR = 'Rate limit exceeded. Please try again later.';

const DARE_SEND_WINDOWS: RateLimitWindow[] = [
  { kind: 'minute', windowMs: 60_000, max: 5 },
  { kind: 'hour', windowMs: 60 * 60_000, max: 30 },
  { kind: 'day', windowMs: 24 * 60 * 60_000, max: 100 },
];

const DARE_ACCEPT_WINDOWS: RateLimitWindow[] = [
  { kind: 'minute', windowMs: 60_000, max: 10 },
  { kind: 'hour', windowMs: 60 * 60_000, max: 60 },
  { kind: 'day', windowMs: 24 * 60 * 60_000, max: 200 },
];

const DARE_DECLINE_WINDOWS: RateLimitWindow[] = [
  { kind: 'minute', windowMs: 60_000, max: 20 },
  { kind: 'hour', windowMs: 60 * 60_000, max: 120 },
  { kind: 'day', windowMs: 24 * 60 * 60_000, max: 400 },
];

// Per-(sender, recipient) cap to prevent one user spamming dares at one
// specific target user.  Recipient id is folded into the action string;
// counter row is keyed by the SENDER's userId.
const DARE_PER_TARGET_SEND_WINDOWS: RateLimitWindow[] = [
  { kind: 'hour', windowMs: 60 * 60_000, max: 3 },
  { kind: 'day', windowMs: 24 * 60 * 60_000, max: 8 },
];

async function enforceDareRateLimit(
  ctx: any,
  userId: Id<'users'>,
  action: string,
  windows: RateLimitWindow[],
): Promise<void> {
  const result = await reserveActionSlots(ctx, userId, action, windows, 1);
  if (!result.accept) {
    throw new Error(DARE_RATE_LIMIT_ERROR);
  }
}

async function enforceDarePerTargetSendLimit(
  ctx: any,
  fromUserId: Id<'users'>,
  toUserId: string,
): Promise<void> {
  const result = await reserveActionSlots(
    ctx,
    fromUserId,
    `dare_send_target:${toUserId}`,
    DARE_PER_TARGET_SEND_WINDOWS,
    1,
  );
  if (!result.accept) {
    throw new Error(DARE_RATE_LIMIT_ERROR);
  }
}

// Send a dare to a user (Truth or Dare feature)
// TOD-AUTH-1 FIX: session-token-bound; client-provided authUserId is only a hint.
export const sendDare = mutation({
  args: {
    token: v.string(),
    toUserId: v.id('users'),
    content: v.string(),
    authUserId: v.optional(v.string()), // legacy hint only, cross-checked
  },
  handler: async (ctx, args) => {
    const fromUserId = await requireDareActor(ctx, args.token, args.authUserId);
    // P1-DARE-RL: per-user minute/hour/day caps on send.
    await enforceDareRateLimit(ctx, fromUserId, 'dare_send', DARE_SEND_WINDOWS);
    // P1-DARE-RL: per-(sender, recipient) cap (anti-harassment).  Recipient
    // anonymity is preserved — toUserId is only stored in the counter row
    // keyed by the SENDER's userId.
    await enforceDarePerTargetSendLimit(ctx, fromUserId, args.toUserId);

    const now = Date.now();

    const fromUser = await ctx.db.get(fromUserId);
    if (!fromUser) throw new Error('User not found');

    if (fromUserId === args.toUserId) {
      throw new Error('Cannot send a dare to yourself');
    }

    const toUser = await ctx.db.get(args.toUserId);
    if (!toUser || !toUser.isActive) throw new Error('User not found');

    // Check if already sent a dare to this user.  Acts as a per-(sender,
    // recipient) dedupe — together with the per-target rate limit above this
    // prevents both micro-burst spam and slow-burn harassment.
    const existingDare = await ctx.db
      .query('dares')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', fromUserId))
      .filter((q) =>
        q.and(
          q.eq(q.field('toUserId'), args.toUserId),
          q.eq(q.field('isAccepted'), undefined)
        )
      )
      .first();

    if (existingDare) {
      throw new Error('You already have a pending dare with this user');
    }

    // Create dare
    const dareId = await ctx.db.insert('dares', {
      fromUserId,
      toUserId: args.toUserId,
      content: args.content,
      createdAt: now,
    });

    // Send notification (anonymously).  P1-DARE-RL: dedupeKey scoped to the
    // dareId so a second attempt that somehow re-enters this branch cannot
    // create a duplicate notification row.  Recipient anonymity preserved —
    // the dareId is opaque from the recipient's perspective.
    await ctx.db.insert('notifications', {
      userId: args.toUserId,
      type: 'message', // Generic to keep it anonymous
      title: 'New Dare Received!',
      body: 'Someone sent you a dare. Accept to reveal who!',
      phase: 'phase1',
      dedupeKey: `dare_recv:${dareId}`,
      createdAt: now,
    });

    return { success: true, dareId };
  },
});

// Get pending dares received
// TOD-AUTH-1 FIX: token-bound; returns only the caller's own pending dares.
export const getPendingDares = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()), // legacy hint only, cross-checked
  },
  handler: async (ctx, args) => {
    const trimmedToken = (args.token ?? '').trim();
    if (trimmedToken.length === 0) {
      return [];
    }
    const callerId = await validateSessionToken(ctx, trimmedToken);
    if (!callerId) {
      return [];
    }
    const hint = args.authUserId?.trim();
    if (hint) {
      const resolvedHint = await resolveUserIdByAuthId(ctx, hint);
      if (!resolvedHint || resolvedHint !== callerId) {
        return [];
      }
    }

    const dares = await ctx.db
      .query('dares')
      .withIndex('by_to_user', (q) => q.eq('toUserId', callerId))
      .filter((q) => q.eq(q.field('isAccepted'), undefined))
      .collect();

    // Don't reveal who sent the dare
    return dares.map((dare) => ({
      id: dare._id,
      content: dare.content,
      createdAt: dare.createdAt,
    }));
  },
});

// Get dares sent by user
// TOD-AUTH-1 FIX: token-bound; returns only the caller's own sent dares.
export const getDaresSent = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()), // legacy hint only, cross-checked
  },
  handler: async (ctx, args) => {
    const trimmedToken = (args.token ?? '').trim();
    if (trimmedToken.length === 0) {
      return [];
    }
    const callerId = await validateSessionToken(ctx, trimmedToken);
    if (!callerId) {
      return [];
    }
    const hint = args.authUserId?.trim();
    if (hint) {
      const resolvedHint = await resolveUserIdByAuthId(ctx, hint);
      if (!resolvedHint || resolvedHint !== callerId) {
        return [];
      }
    }

    const dares = await ctx.db
      .query('dares')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', callerId))
      .order('desc')
      .take(50);

    const result = [];
    for (const dare of dares) {
      const toUser = await ctx.db.get(dare.toUserId);
      result.push({
        id: dare._id,
        content: dare.content,
        isAccepted: dare.isAccepted,
        respondedAt: dare.respondedAt,
        createdAt: dare.createdAt,
        // Only show user info if accepted
        toUser: dare.isAccepted && toUser
          ? {
              id: toUser._id,
              name: toUser.name,
            }
          : null,
      });
    }

    return result;
  },
});

// Accept a dare (reveals identities and creates match)
// TOD-AUTH-1 FIX: token-bound; only the dare recipient can accept.
export const acceptDare = mutation({
  args: {
    token: v.string(),
    dareId: v.id('dares'),
    authUserId: v.optional(v.string()), // legacy hint only, cross-checked
  },
  handler: async (ctx, args) => {
    const userId = await requireDareActor(ctx, args.token, args.authUserId);
    // P1-DARE-RL: per-user minute/hour/day caps on accept (anti-bot-loop).
    // The `dare.isAccepted !== undefined` idempotency check below means a
    // replayed accept on an already-processed dare is a no-op; this limit
    // additionally caps the velocity of legitimate accepts.
    await enforceDareRateLimit(ctx, userId, 'dare_accept', DARE_ACCEPT_WINDOWS);

    const now = Date.now();

    const dare = await ctx.db.get(args.dareId);
    if (!dare) {
      throw new Error('Dare not found');
    }

    // Caller must be the dare recipient
    if (dare.toUserId !== userId) {
      throw new Error('Unauthorized: only the dare recipient can accept');
    }

    if (dare.isAccepted !== undefined) {
      throw new Error('Dare already responded to');
    }

    // Mark as accepted
    await ctx.db.patch(args.dareId, {
      isAccepted: true,
      respondedAt: now,
    });

    const fromUser = await ctx.db.get(dare.fromUserId);
    const toUser = await ctx.db.get(dare.toUserId);

    if (!fromUser || !toUser) {
      throw new Error('User not found');
    }

    // Create a match!
    const user1Id = dare.fromUserId < dare.toUserId ? dare.fromUserId : dare.toUserId;
    const user2Id = dare.fromUserId < dare.toUserId ? dare.toUserId : dare.fromUserId;

    // Check if match already exists
    let match = await ctx.db
      .query('matches')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', user1Id).eq('user2Id', user2Id)
      )
      .first();

    if (!match) {
      const matchId = await ctx.db.insert('matches', {
        user1Id,
        user2Id,
        matchedAt: now,
        isActive: true,
      });
      match = await ctx.db.get(matchId);

      // Create conversation
      await ctx.db.insert('conversations', {
        matchId,
        participants: [dare.fromUserId, dare.toUserId],
        isPreMatch: false,
        createdAt: now,
      });
    }

    // Notify the dare sender.  P1-DARE-RL: dedupeKey scoped to the dareId so
    // a re-entry into this branch (which is gated by `isAccepted !==
    // undefined` above, but defense-in-depth) cannot create duplicate
    // notifications.
    await ctx.db.insert('notifications', {
      userId: dare.fromUserId,
      type: 'match',
      title: 'Dare Accepted!',
      body: `${toUser.name} accepted your dare! It's a match!`,
      data: { matchId: match?._id },
      phase: 'phase1',
      dedupeKey: `dare_accept:${args.dareId}`,
      createdAt: now,
    });

    return {
      success: true,
      isMatch: true,
      matchId: match?._id,
      fromUser: {
        id: fromUser._id,
        name: fromUser.name,
      },
    };
  },
});

// Decline a dare
// TOD-AUTH-1 FIX: token-bound; only the dare recipient can decline.
export const declineDare = mutation({
  args: {
    token: v.string(),
    dareId: v.id('dares'),
    authUserId: v.optional(v.string()), // legacy hint only, cross-checked
  },
  handler: async (ctx, args) => {
    const userId = await requireDareActor(ctx, args.token, args.authUserId);
    // P1-DARE-RL: per-user minute/hour/day caps on decline (anti-bot-loop).
    // The `dare.isAccepted !== undefined` idempotency check below means a
    // replayed decline on an already-processed dare is a no-op; this limit
    // caps decline velocity for fan-out abuse patterns.
    await enforceDareRateLimit(ctx, userId, 'dare_decline', DARE_DECLINE_WINDOWS);

    const dare = await ctx.db.get(args.dareId);
    if (!dare) {
      throw new Error('Dare not found');
    }

    // Caller must be the dare recipient
    if (dare.toUserId !== userId) {
      throw new Error('Unauthorized: only the dare recipient can decline');
    }

    if (dare.isAccepted !== undefined) {
      throw new Error('Dare already responded to');
    }

    // Mark as declined
    await ctx.db.patch(args.dareId, {
      isAccepted: false,
      respondedAt: Date.now(),
    });

    // Don't notify sender about decline to keep it anonymous

    return { success: true };
  },
});

// TOD-AUTH-2 / TOD-PRIV-1 FIX: `getDareCount` was removed in this hardening
// pass. It had zero frontend callsites (grep `api.dares.getDareCount` returns
// no matches) and previously exposed any user's pending-dare count to any
// caller (no auth check). If a future badge surface needs this count, it
// should be reimplemented as a token-bound query that returns ONLY the
// caller's own count.
