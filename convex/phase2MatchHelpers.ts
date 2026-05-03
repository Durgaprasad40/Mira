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
