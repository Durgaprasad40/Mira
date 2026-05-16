import type { Id } from './_generated/dataModel';
import { shouldCreatePhase2DeepConnectNotification } from './phase2NotificationPrefs';
import { dispatchPrivatePush } from './privateNotifications';

export type Phase2MatchSource = 'deep_connect' | 'truth_dare' | 'rematch';

type PrivateMatchKind = 'like' | 'super_like';
type PrivateConnectionSource = 'tod' | 'desire_match' | 'desire_super_like';

export function getPhase2UserPair(userA: Id<'users'>, userB: Id<'users'>) {
  const user1Id = userA < userB ? userA : userB;
  const user2Id = userA < userB ? userB : userA;
  return { user1Id, user2Id };
}

/**
 * Locate the unique Phase-2 conversation shared by two users, if any.
 *
 * P3-BOUNDS-01: The `.collect()` here is intentional and effectively bounded
 * by the number of conversations userA participates in (i.e. one user's
 * inbox size). At the worst-case Phase-2 inbox of ~200 (see
 * `MAX_PRIVATE_CONVERSATION_SCAN_LIMIT` in privateConversations.ts), this
 * scan reads at most ~200 small rows and then does a single indexed lookup
 * per row. Adding a `.take()` cap here would risk silently failing to find
 * an existing conversation for a heavy user and creating a duplicate row,
 * which would then need the `cleanDuplicatePairConversations` collapse to
 * recover. Leaving unbounded is the safer choice; the indexed query keeps
 * cost linear in user inbox size, not global Phase-2 traffic.
 */
async function findPrivateConversationForPair(
  ctx: any,
  userAId: Id<'users'>,
  userBId: Id<'users'>,
) {
  const userAParticipations = await ctx.db
    .query('privateConversationParticipants')
    .withIndex('by_user', (q: any) => q.eq('userId', userAId))
    .collect();

  for (const participation of userAParticipations) {
    const userBParticipation = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q: any) =>
        q.eq('userId', userBId).eq('conversationId', participation.conversationId)
      )
      .first();

    if (userBParticipation) {
      return participation.conversationId as Id<'privateConversations'>;
    }
  }

  return null;
}

async function ensurePrivateConversationParticipant(
  ctx: any,
  conversationId: Id<'privateConversations'>,
  userId: Id<'users'>,
  unreadCount: number,
  unhide: boolean,
) {
  const existing = await ctx.db
    .query('privateConversationParticipants')
    .withIndex('by_user_conversation', (q: any) =>
      q.eq('userId', userId).eq('conversationId', conversationId)
    )
    .first();

  if (existing) {
    if (unhide && existing.isHidden) {
      await ctx.db.patch(existing._id, { isHidden: false });
    }
    return existing._id;
  }

  return await ctx.db.insert('privateConversationParticipants', {
    conversationId,
    userId,
    unreadCount,
  });
}

async function ensurePrivateReveal(ctx: any, user1Id: Id<'users'>, user2Id: Id<'users'>, now: number) {
  const existingReveal = await ctx.db
    .query('privateReveals')
    .withIndex('by_pair', (q: any) => q.eq('userAId', user1Id).eq('userBId', user2Id))
    .first();

  if (!existingReveal) {
    await ctx.db.insert('privateReveals', {
      userAId: user1Id,
      userBId: user2Id,
      createdAt: now,
    });
  }
}

/**
 * Race-safe collapse for duplicate `privateConversations` rows that share
 * the same sorted-participants pair.
 *
 * P3-BOUNDS-02: Both `.collect()` calls in this function are intentionally
 * unbounded because:
 *   1. The outer scan is a sorted-pair equality, which in steady state
 *      returns 1 row and at worst (race collision) returns 2-3 rows. There
 *      is no realistic universe where it returns hundreds.
 *   2. The inner per-duplicate scan reads `privateConversationParticipants`
 *      keyed on `by_conversation`, which is structurally bounded to exactly
 *      2 rows per conversation (Phase-2 conversations are strictly 1:1).
 *   3. Capping these scans could leave orphan duplicate conversations alive
 *      and break the convergence guarantee that the post-insert collapse
 *      pattern relies on (see P2-RACE-01 in `ensurePhase2MatchAndConversation`).
 *
 * Race semantics: lexicographically-smallest `_id` wins. Convex OCC ensures
 * concurrent collapses agree on the same winner row.
 */
async function cleanDuplicatePairConversations(
  ctx: any,
  sortedParticipants: [Id<'users'>, Id<'users'>],
  preferredConversationId: Id<'privateConversations'>,
) {
  const allPairConvos = await ctx.db
    .query('privateConversations')
    .filter((q: any) => q.eq(q.field('participants'), sortedParticipants))
    .collect();

  if (allPairConvos.length <= 1) {
    return preferredConversationId;
  }

  allPairConvos.sort((a: any, b: any) => a._id.localeCompare(b._id));
  const winnerConversationId = allPairConvos[0]._id as Id<'privateConversations'>;

  for (let i = 1; i < allPairConvos.length; i++) {
    const duplicate = allPairConvos[i];
    const duplicateParticipants = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_conversation', (q: any) => q.eq('conversationId', duplicate._id))
      .collect();

    for (const participant of duplicateParticipants) {
      await ctx.db.delete(participant._id);
    }
    await ctx.db.delete(duplicate._id);
  }

  return winnerConversationId;
}

export async function ensurePhase2MatchAndConversation(
  ctx: any,
  args: {
    userAId: Id<'users'>;
    userBId: Id<'users'>;
    now: number;
    source: Phase2MatchSource;
    matchKind: PrivateMatchKind;
    connectionSource: PrivateConnectionSource;
    reactivateInactive?: boolean;
    unhideExistingConversation?: boolean;
    updateLastMessageAt?: boolean;
    existingConversationMeansAlreadyMatched?: boolean;
  },
) {
  const {
    userAId,
    userBId,
    now,
    source,
    matchKind,
    connectionSource,
    reactivateInactive = false,
    unhideExistingConversation = false,
    updateLastMessageAt = false,
    existingConversationMeansAlreadyMatched = true,
  } = args;

  const { user1Id, user2Id } = getPhase2UserPair(userAId, userBId);
  const sortedParticipants = [user1Id, user2Id] as [Id<'users'>, Id<'users'>];

  const existingMatch = await ctx.db
    .query('privateMatches')
    .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
    .first();

  const existingConversationId = await findPrivateConversationForPair(ctx, user1Id, user2Id);
  const existingConversation = existingConversationId ? await ctx.db.get(existingConversationId) : null;

  const activeMatchExisted = existingMatch?.isActive === true;
  let alreadyMatched =
    activeMatchExisted ||
    (existingConversationMeansAlreadyMatched && existingConversationId !== null);

  let matchId: Id<'privateMatches'>;
  let matchCreated = false;
  let reactivatedMatch = false;
  let publicSource: Phase2MatchSource = source;

  if (existingMatch) {
    matchId = existingMatch._id;
    if (!existingMatch.isActive && reactivateInactive) {
      await ctx.db.patch(existingMatch._id, {
        isActive: true,
        matchedAt: now,
      });
      reactivatedMatch = true;
      publicSource = 'rematch';
    }
  } else {
    // P2-RACE-01: Concurrent-reciprocal-like duplicate-match prevention.
    //
    //   Threat model: two clients (A→B and B→A) submit the second-half of a
    //   mutual like within the same Convex commit window. Because the
    //   `existingMatch` check above can return null in both transactions
    //   before either insert commits, both transactions would race to
    //   insert a `privateMatches` row for the same (user1Id, user2Id) pair.
    //   Convex does NOT enforce uniqueness on `by_users` — the index is
    //   non-unique — so both rows would persist absent this collapse step.
    //
    //   Protection: post-insert, re-query ALL rows on `by_users` and keep
    //   ONLY the row with the lexicographically-smallest `_id`. Convex
    //   `_id` values are monotonic and globally unique, so both racing
    //   transactions deterministically converge on the SAME winner row.
    //   The loser transaction(s) delete their just-inserted row, rebind
    //   the local `matchId` to the winner, and flag `alreadyMatched=true`
    //   so downstream notification/conversation hooks don't double-fire.
    //   Convex's OCC (optimistic concurrency control) ensures the
    //   post-insert .collect() reads the committed view, so even if both
    //   transactions race to the .collect() step, both will see both rows
    //   and both will agree on which to keep.
    //
    //   The mirror pattern for `privateConversations` lives in
    //   `cleanDuplicatePairConversations` above, which is invoked from the
    //   conversation-create path below.
    //
    //   Why not a unique index? Convex schemas don't expose unique
    //   constraints today; this post-insert collapse is the idiomatic
    //   Convex pattern for race-safe singletons keyed on a composite
    //   non-unique index.
    matchId = await ctx.db.insert('privateMatches', {
      user1Id,
      user2Id,
      matchedAt: now,
      isActive: true,
      matchSource: matchKind,
    });
    matchCreated = true;

    const allMatches = await ctx.db
      .query('privateMatches')
      .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .collect();

    if (allMatches.length > 1) {
      allMatches.sort((a: any, b: any) => a._id.localeCompare(b._id));
      const winnerMatchId = allMatches[0]._id as Id<'privateMatches'>;

      if (matchId !== winnerMatchId) {
        matchId = winnerMatchId;
        matchCreated = false;
        alreadyMatched = true;
      }

      for (let i = 1; i < allMatches.length; i++) {
        if (allMatches[i]._id !== matchId) {
          await ctx.db.delete(allMatches[i]._id);
        }
      }
    }
  }

  await ensurePrivateReveal(ctx, user1Id, user2Id, now);

  let conversationId: Id<'privateConversations'>;
  let conversationCreated = false;

  if (existingConversationId) {
    conversationId = existingConversationId;
    const patch: Record<string, unknown> = {};
    if (existingConversation && !existingConversation.matchId) {
      patch.matchId = matchId as string;
    }
    if (updateLastMessageAt) {
      patch.lastMessageAt = now;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(conversationId, patch);
    }
    await ensurePrivateConversationParticipant(ctx, conversationId, user1Id, 0, unhideExistingConversation);
    await ensurePrivateConversationParticipant(ctx, conversationId, user2Id, 0, unhideExistingConversation);
  } else {
    conversationId = await ctx.db.insert('privateConversations', {
      matchId: matchId as string,
      participants: sortedParticipants,
      isPreMatch: false,
      connectionSource,
      createdAt: now,
      ...(updateLastMessageAt ? { lastMessageAt: now } : {}),
    });
    conversationCreated = true;

    await ctx.db.insert('privateConversationParticipants', {
      conversationId,
      userId: user1Id,
      unreadCount: 0,
    });
    await ctx.db.insert('privateConversationParticipants', {
      conversationId,
      userId: user2Id,
      unreadCount: 0,
    });

    conversationId = await cleanDuplicatePairConversations(ctx, sortedParticipants, conversationId);

    // PHASE2_TOD_PARTICIPANTS_HEAL: cleanDuplicatePairConversations picks the
    // lexicographically-smallest `_id` as the winner. If that older winner had
    // lost its `privateConversationParticipants` rows (e.g. from a prior
    // partial reset or a race that orphaned the conversation row), the
    // freshly-inserted participants on the just-created loser get deleted as
    // "duplicates" while the older winner survives WITHOUT participants.
    // `getUserPrivateConversations` joins through participants, so a
    // participant-less conversation is invisible to Messages/New Matches
    // even though `participants[]` on the conversation row contains both
    // users. Idempotently ensure both users have participant rows on the
    // final winner so the pair is always reachable from either side.
    await ensurePrivateConversationParticipant(ctx, conversationId, user1Id, 0, false);
    await ensurePrivateConversationParticipant(ctx, conversationId, user2Id, 0, false);
  }

  return {
    matchId,
    conversationId,
    matchCreated,
    conversationCreated,
    alreadyMatched,
    reactivatedMatch,
    source: publicSource,
  };
}

/**
 * Read-only status lookup for a Phase-2 (user, user) pair.
 *
 * Returns the active match (if any), the shared conversation ID (if any),
 * and `isConnected` (true iff either an active match OR a conversation
 * exists for the sorted pair).
 *
 * SECURITY CONTRACT:
 *   - This helper takes already-validated user IDs from the caller; the
 *     CALLER is responsible for token-bound viewer auth. Do NOT call this
 *     from a public mutation/query handler without first resolving and
 *     validating the viewer's identity via `validateSessionToken`.
 *   - Sorted-pair ordering is enforced via `getPhase2UserPair`, matching
 *     the `by_users` index shape. Calling with unsorted IDs would miss
 *     the match.
 */
export async function findPhase2MatchConversationStatus(
  ctx: any,
  userAId: Id<'users'>,
  userBId: Id<'users'>,
) {
  const { user1Id, user2Id } = getPhase2UserPair(userAId, userBId);
  const [match, conversationId] = await Promise.all([
    ctx.db
      .query('privateMatches')
      .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .first(),
    findPrivateConversationForPair(ctx, user1Id, user2Id),
  ]);

  return {
    match,
    matchId: match?._id as Id<'privateMatches'> | undefined,
    conversationId: conversationId as Id<'privateConversations'> | null,
    isConnected: match?.isActive === true || conversationId !== null,
  };
}

/**
 * Idempotent producer for Phase-2 match notifications.
 *
 * CONTRACT (do not weaken):
 *   - Dedupe is keyed on `p2_match:${matchId}:${userId}` — racing inserts
 *     for the same (match, recipient) pair will see the existing row via
 *     the `by_user_dedupe` index and short-circuit. This is the ONLY guard
 *     against double-notifying a recipient when a match is established by
 *     two simultaneous reciprocal-like transactions.
 *   - User preferences are checked via `shouldCreatePhase2DeepConnectNotification`
 *     BEFORE the dedupe lookup, so an opted-out user never has a row
 *     written even once.
 *   - `data` is filtered through an allowlist (`allowedDataKeys`) — never
 *     spread user-provided data straight into the notification row. Adding
 *     a new field requires updating both the allowlist AND any consumer
 *     UI that needs to read it.
 *   - TTL: 7 days (vs the standard 24h on transient inbox rows) because
 *     match notifications are higher-value and shown in the bell longer.
 *   - Push is optional and dispatched via the Phase-2-specific helper so
 *     the side-channel never crosses into Phase-1's push pipeline.
 */
export async function createPhase2MatchNotificationIfMissing(
  ctx: any,
  args: {
    userId: Id<'users'>;
    matchId: Id<'privateMatches'> | string;
    conversationId: Id<'privateConversations'> | string;
    title: string;
    body: string;
    now: number;
    data?: Record<string, string>;
    push?: boolean;
  },
) {
  const dedupeKey = `p2_match:${args.matchId}:${args.userId}`;
  const allowedDataKeys = [
    'chatRoomId',
    'conversationId',
    'matchId',
    'otherUserId',
    'privateConversationId',
    'threadId',
    'userId',
  ] as const;
  const notificationData: Partial<Record<(typeof allowedDataKeys)[number], string>> = {};
  for (const key of allowedDataKeys) {
    const value = args.data?.[key];
    if (typeof value === 'string') {
      notificationData[key] = value;
    }
  }
  notificationData.matchId = args.matchId as string;
  notificationData.privateConversationId = args.conversationId as string;

  if (!(await shouldCreatePhase2DeepConnectNotification(ctx, args.userId))) {
    return { inserted: false, dedupeKey, reason: 'disabled' as const };
  }

  const existing = await ctx.db
    .query('privateNotifications')
    .withIndex('by_user_dedupe', (q: any) => q.eq('userId', args.userId).eq('dedupeKey', dedupeKey))
    .first();

  if (existing) {
    return { inserted: false, dedupeKey, reason: 'duplicate' as const };
  }

  await ctx.db.insert('privateNotifications', {
    userId: args.userId,
    type: 'phase2_match',
    title: args.title,
    body: args.body,
    data: notificationData,
    phase: 'phase2',
    dedupeKey,
    createdAt: args.now,
    expiresAt: args.now + 7 * 24 * 60 * 60 * 1000,
  });

  if (args.push) {
    await dispatchPrivatePush(ctx, {
      userId: args.userId,
      type: 'phase2_match',
      title: args.title,
      body: args.body,
      data: notificationData,
    });
  }

  return { inserted: true, dedupeKey, reason: 'inserted' as const };
}
