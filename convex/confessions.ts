import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId, validateSessionToken } from './helpers';
import { moderationStatusForCount } from './lib/confessionModeration';
import { ensureActiveMatchForPair } from './matches';
import type { ConfessionModerationStatus } from './lib/confessionModeration';

// Phone number & email patterns for server-side validation
const PHONE_PATTERN = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Confession expiry duration (24 hours in milliseconds)
const CONFESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const CONFESSION_CONNECT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const CONFESSION_CONNECT_LIST_LIMIT = 50;
const CONFESSION_CONNECT_EXPIRY_CLEANUP_BATCH = 100;

// P1-01: Server-side rate limit (5 confessions per 24 hours)
const CONFESSION_RATE_LIMIT = 5;

type SerializedConfession = {
  _id: Id<'confessions'>;
  _creationTime: number;
  userId: Id<'users'>;
  text: string;
  isAnonymous: boolean;
  authorVisibility?: 'anonymous' | 'open' | 'blur_photo';
  mood: 'romantic' | 'spicy' | 'emotional' | 'funny';
  visibility: 'global';
  imageUrl?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  replyCount: number;
  reactionCount: number;
  voiceReplyCount?: number;
  createdAt: number;
  expiresAt?: number;
  isDeleted?: boolean;
  deletedAt?: number;
  taggedUserId?: Id<'users'>;
  taggedUserName?: string;
  trendingScore?: number;
  isExpired?: boolean;
  moderationStatus?: ConfessionModerationStatus;
  isUnderReview?: boolean;
};

type ConfessionAuthorVisibility = 'anonymous' | 'open' | 'blur_photo';
type ConfessionConnectStatus =
  | 'pending'
  | 'mutual'
  | 'rejected_by_from'
  | 'rejected_by_to'
  | 'cancelled_by_from'
  | 'expired';
type ConfessionConnectViewerRole = 'requester' | 'owner';
type ConfessionConnectNotificationType =
  | 'confession_connect_requested'
  | 'confession_connect_accepted';

// Canonical reply identity mode used by the current product contract.
// Legacy 'blur' literal maps to 'blur_photo'; unknown/missing maps using isAnonymous.
type ReplyIdentityMode = 'anonymous' | 'blur_photo' | 'open';

function effectiveConfessionAuthorVisibility(
  raw: Doc<'confessions'>['authorVisibility'] | undefined,
  isAnonymousFallback: boolean
): ConfessionAuthorVisibility {
  const visibility = raw ?? (isAnonymousFallback ? 'anonymous' : 'open');
  switch (visibility) {
    case 'anonymous':
      return 'anonymous';
    case 'blur':
    case 'blur_photo':
      return 'blur_photo';
    case 'open':
    default:
      return 'open';
  }
}

function canonicalIdentityMode(
  raw: string | undefined,
  isAnonymousFallback: boolean
): ReplyIdentityMode {
  switch (raw) {
    case 'anonymous':
      return 'anonymous';
    case 'blur':
    case 'blur_photo':
      return 'blur_photo';
    case 'open':
      return 'open';
    default:
      return isAnonymousFallback ? 'anonymous' : 'open';
  }
}

// Build a map of userId → current primary profile photo URL from the users
// table source of truth. `users.primaryPhotoUrl` is kept in sync with the
// `photos` table by `setPrimaryPhoto` / `reorderPhotos` / photo upload &
// delete flows, and excludes verification reference photos.
//
// Confess surfaces use this to resolve the *current* author photo at read
// time instead of the stale snapshot persisted on the confession / reply
// row at create time. When the user changes their main photo in Edit
// Profile, the Convex reactive query re-runs (because it now reads the
// users table) and Confess feed / thread / my-confessions / replies all
// pick up the new photo automatically.
async function buildLivePrimaryPhotoMapForUserIds(
  ctx: Parameters<typeof validateSessionToken>[0],
  userIds: Iterable<Id<'users'>>
): Promise<Map<string, string | undefined>> {
  const map = new Map<string, string | undefined>();
  for (const id of userIds) {
    const key = String(id);
    if (map.has(key)) continue;
    const userDoc = await ctx.db.get(id);
    map.set(key, userDoc?.primaryPhotoUrl);
  }
  return map;
}

type SerializedReply = {
  _id: Id<'confessionReplies'>;
  _creationTime: number;
  confessionId: Id<'confessions'>;
  userId: Id<'users'>;
  text: string;
  isAnonymous: boolean;
  identityMode: ReplyIdentityMode;
  type?: 'text' | 'voice';
  voiceUrl?: string;
  voiceDurationSec?: number;
  parentReplyId?: Id<'confessionReplies'>;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  editedAt?: number;
  createdAt: number;
  isOwnReply?: boolean;
};

function serializeReply(
  reply: Doc<'confessionReplies'>,
  options?: {
    viewerId?: Id<'users'> | null;
    livePhotoUrlByUserId?: Map<string, string | undefined>;
  }
): SerializedReply {
  const identityMode = canonicalIdentityMode(reply.identityMode, reply.isAnonymous);
  const base: SerializedReply = {
    _id: reply._id,
    _creationTime: reply._creationTime,
    confessionId: reply.confessionId,
    userId: reply.userId,
    text: reply.text,
    isAnonymous: identityMode === 'anonymous',
    identityMode,
    type: reply.type,
    voiceUrl: reply.voiceUrl,
    voiceDurationSec: reply.voiceDurationSec,
    parentReplyId: reply.parentReplyId,
    editedAt: reply.editedAt,
    createdAt: reply.createdAt,
  };

  // Gate author display fields by identity mode. Anonymous must never leak identity.
  if (identityMode !== 'anonymous') {
    base.authorName = reply.authorName;
    // Photo: prefer the live primary photo from `users.primaryPhotoUrl`
    // when the caller pre-fetched the lookup map, so reorder/main-photo
    // changes propagate automatically. Fall back to the legacy snapshot
    // only if no override was supplied (defensive — every current call
    // site provides the map).
    base.authorPhotoUrl = options?.livePhotoUrlByUserId
      ? options.livePhotoUrlByUserId.get(String(reply.userId))
      : reply.authorPhotoUrl;
    base.authorAge = reply.authorAge;
    base.authorGender = reply.authorGender;
  }

  if (options?.viewerId) {
    base.isOwnReply = reply.userId === options.viewerId;
  }

  return base;
}

function serializeConfession(
  confession: Doc<'confessions'>,
  options?: {
    includeTaggedUserId?: boolean;
    trendingScore?: number;
    isExpired?: boolean;
    viewerIsOwner?: boolean;
    // P1-1: Viewer is the tagged recipient of this confession. The recipient
    // already received the tag through their notification + Tagged-for-you
    // sheet, so the thread is allowed to surface taggedUserId/taggedUserName
    // even for anonymous mode. Author identity (name/photo/age/gender)
    // remains stripped — only the tag fields are carved out.
    viewerIsTaggedRecipient?: boolean;
    livePhotoUrlByUserId?: Map<string, string | undefined>;
  }
): SerializedConfession {
  const effectiveVisibility = effectiveConfessionAuthorVisibility(
    confession.authorVisibility,
    confession.isAnonymous
  );
  const isAnonymousMode = effectiveVisibility === 'anonymous';

  // Resolve the author photo URL.
  //   anonymous (effective mode) → never leak a photo.
  //   open / blur_photo → return the live primary photo from the users
  //                       table when the caller pre-fetched the map. The
  //                       client decides whether to blur it based on
  //                       `authorVisibility`.
  // Falls back to the persisted snapshot only if the caller did not supply
  // the override map (defensive — every current call site does).
  const resolvedAuthorPhotoUrl: string | undefined = isAnonymousMode
    ? undefined
    : options?.livePhotoUrlByUserId
      ? options.livePhotoUrlByUserId.get(String(confession.userId))
      : confession.authorPhotoUrl;

  const result: SerializedConfession = {
    _id: confession._id,
    _creationTime: confession._creationTime,
    userId: confession.userId,
    text: confession.text,
    isAnonymous: confession.isAnonymous,
    authorVisibility: effectiveVisibility,
    mood: confession.mood,
    visibility: confession.visibility,
    imageUrl: confession.imageUrl,
    authorName: isAnonymousMode ? undefined : confession.authorName,
    authorPhotoUrl: resolvedAuthorPhotoUrl,
    authorAge: isAnonymousMode ? undefined : confession.authorAge,
    authorGender: isAnonymousMode ? undefined : confession.authorGender,
    replyCount: confession.replyCount,
    reactionCount: confession.reactionCount,
    voiceReplyCount: confession.voiceReplyCount,
    createdAt: confession.createdAt,
    expiresAt: confession.expiresAt,
    isDeleted: confession.isDeleted,
    deletedAt: confession.deletedAt,
  };

  // Tag-field exposure rule:
  //   - non-anonymous → expose to all callers that asked for the tag.
  //   - anonymous → expose ONLY to the tagged recipient (so the thread can
  //                 render "Confess-to: You") and to the owner (their own
  //                 confession). Unrelated viewers still get nothing.
  // Author identity remains stripped for anonymous mode regardless of viewer.
  const allowTaggedFields =
    !!options?.includeTaggedUserId &&
    (effectiveVisibility !== 'anonymous' ||
      options?.viewerIsTaggedRecipient === true ||
      options?.viewerIsOwner === true);

  if (allowTaggedFields) {
    result.taggedUserId = confession.taggedUserId;
    // Mention chip needs both id + name. The denormalised tagged user name
    // captured at create time is used here; thread is viewer-aware and will
    // substitute "You" when the viewer is the tagged recipient.
    if (confession.taggedUserId && confession.taggedUserName) {
      result.taggedUserName = confession.taggedUserName;
    }
  }

  if (typeof options?.trendingScore === 'number') {
    result.trendingScore = options.trendingScore;
  }

  if (typeof options?.isExpired === 'boolean') {
    result.isExpired = options.isExpired;
  }

  if (options?.viewerIsOwner) {
    const moderationStatus = getConfessionModerationStatus(confession);
    result.moderationStatus = moderationStatus;
    result.isUnderReview =
      moderationStatus === 'under_review' || moderationStatus === 'hidden_by_reports';
  }

  return result;
}

function getConfessionModerationStatus(
  confession: Doc<'confessions'>
): ConfessionModerationStatus {
  return (
    ((confession as any).moderationStatus as ConfessionModerationStatus | undefined) ?? 'normal'
  );
}

function isHiddenByReports(confession: Doc<'confessions'>): boolean {
  return getConfessionModerationStatus(confession) === 'hidden_by_reports';
}

async function hasViewerReportedConfession(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'>,
  confessionId: Id<'confessions'>
): Promise<boolean> {
  const report = await ctx.db
    .query('confessionReports')
    .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
    .filter((q) => q.eq(q.field('confessionId'), confessionId))
    .first();
  return !!report;
}

async function getReportedConfessionIdsForViewer(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'>
): Promise<Set<string>> {
  const reports = await ctx.db
    .query('confessionReports')
    .withIndex('by_reporter', (q) => q.eq('reporterId', viewerId))
    .collect();
  return new Set(reports.map((report) => String(report.confessionId)));
}

async function getValidatedViewerFromToken(
  ctx: Parameters<typeof validateSessionToken>[0],
  token?: string
): Promise<Id<'users'> | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return validateSessionToken(ctx, trimmed);
}

function emptyConfessionConnectStatus() {
  return {
    exists: false as const,
    status: undefined as ConfessionConnectStatus | undefined,
    viewerRole: null as ConfessionConnectViewerRole | null,
    canRequest: false,
    canRespond: false,
    canCancel: false,
    expiresAt: undefined as number | undefined,
    respondedAt: undefined as number | undefined,
    conversationId: undefined as Id<'conversations'> | undefined,
  };
}

function getEffectiveConnectStatus(
  connect: Doc<'confessionConnects'>,
  now: number
): ConfessionConnectStatus {
  if (connect.status === 'pending' && connect.expiresAt <= now) {
    return 'expired';
  }
  return connect.status;
}

async function patchExpiredConnectIfNeeded(
  ctx: MutationCtx,
  connect: Doc<'confessionConnects'>,
  now: number
): Promise<Doc<'confessionConnects'>> {
  if (connect.status !== 'pending' || connect.expiresAt > now) {
    return connect;
  }
  await ctx.db.patch(connect._id, {
    status: 'expired',
    updatedAt: now,
  });
  return {
    ...connect,
    status: 'expired',
    updatedAt: now,
  };
}

function serializeConfessionConnect(connect: Doc<'confessionConnects'>) {
  const promoted = connect.status === 'mutual' && !!connect.conversationId;
  return {
    connectId: connect._id,
    confessionId: connect.confessionId,
    status: connect.status,
    expiresAt: connect.expiresAt,
    respondedAt: connect.respondedAt,
    conversationId: connect.conversationId,
    promoted,
    promotionPending: connect.status === 'mutual' && !promoted,
  };
}

async function getExistingConfessionConnect(
  ctx: Parameters<typeof validateSessionToken>[0],
  confessionId: Id<'confessions'>
): Promise<Doc<'confessionConnects'> | null> {
  return ctx.db
    .query('confessionConnects')
    .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
    .first();
}

function userIsConnectEligible(user: Doc<'users'> | null): boolean {
  return !!user && user.isActive !== false && !user.deletedAt && !user.isBanned;
}

async function ensureConversationParticipantRow(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
  userId: Id<'users'>
): Promise<void> {
  const existing = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_user_conversation', (q) =>
      q.eq('userId', userId).eq('conversationId', conversationId)
    )
    .first();
  if (existing) return;

  await ctx.db.insert('conversationParticipants', {
    conversationId,
    userId,
    unreadCount: 0,
  });
}

async function hasBlockBetweenUsers(
  ctx: Parameters<typeof validateSessionToken>[0],
  userA: Id<'users'>,
  userB: Id<'users'>
): Promise<boolean> {
  const direct = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userA).eq('blockedUserId', userB)
    )
    .first();
  if (direct) return true;

  const reverse = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userB).eq('blockedUserId', userA)
    )
    .first();
  return !!reverse;
}

async function hasReportBetweenUsers(
  ctx: Parameters<typeof validateSessionToken>[0],
  userA: Id<'users'>,
  userB: Id<'users'>
): Promise<boolean> {
  const reportAToB = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', userA).eq('reportedUserId', userB)
    )
    .first();
  if (reportAToB) return true;

  const reportBToA = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', userB).eq('reportedUserId', userA)
    )
    .first();
  return !!reportBToA;
}

function confessionIsConnectable(confession: Doc<'confessions'>, now: number): boolean {
  return (
    !confession.isDeleted &&
    (confession.expiresAt === undefined || confession.expiresAt > now) &&
    !isHiddenByReports(confession)
  );
}

async function pairCanUseConfessionConnect(
  ctx: Parameters<typeof validateSessionToken>[0],
  requesterId: Id<'users'>,
  ownerId: Id<'users'>
): Promise<boolean> {
  if (requesterId === ownerId) return false;

  const requester = await ctx.db.get(requesterId);
  const owner = await ctx.db.get(ownerId);
  if (!userIsConnectEligible(requester) || !userIsConnectEligible(owner)) return false;

  if (await hasBlockBetweenUsers(ctx, requesterId, ownerId)) return false;
  if (await hasReportBetweenUsers(ctx, requesterId, ownerId)) return false;

  return true;
}

async function upsertConfessionConnectNotification(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    type: ConfessionConnectNotificationType;
    title: string;
    body: string;
    data: {
      confessionId: string;
      connectId: string;
      fromUserId?: string;
      conversationId?: string;
      matchId?: string;
      source?: string;
    };
    dedupeKey: string;
    now: number;
  }
): Promise<void> {
  const expiresAt = args.now + 24 * 60 * 60 * 1000;
  const existing = await ctx.db
    .query('notifications')
    .withIndex('by_user_dedupe', (q) =>
      q.eq('userId', args.userId).eq('dedupeKey', args.dedupeKey)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      type: args.type,
      title: args.title,
      body: args.body,
      data: args.data,
      phase: 'phase1',
      createdAt: args.now,
      expiresAt,
      readAt: undefined,
    });
    return;
  }

  await ctx.db.insert('notifications', {
    userId: args.userId,
    type: args.type,
    title: args.title,
    body: args.body,
    data: args.data,
    phase: 'phase1',
    dedupeKey: args.dedupeKey,
    createdAt: args.now,
    expiresAt,
  });

  await ctx.scheduler.runAfter(0, internal.pushNotifications.send, {
    userId: args.userId,
    title: args.title,
    body: args.body,
    data: args.data,
    type: args.type,
  });
}

async function notifyConfessionConnectRequested(
  ctx: MutationCtx,
  args: {
    toUserId: Id<'users'>;
    fromUserId: Id<'users'>;
    confessionId: Id<'confessions'>;
    connectId: Id<'confessionConnects'>;
    now: number;
  }
): Promise<void> {
  await upsertConfessionConnectNotification(ctx, {
    userId: args.toUserId,
    type: 'confession_connect_requested',
    title: 'New connect request',
    body: 'Someone wants to connect from your confession.',
    data: {
      confessionId: String(args.confessionId),
      connectId: String(args.connectId),
      fromUserId: String(args.fromUserId),
      source: 'confession',
    },
    dedupeKey: `confession_connect_requested:${args.connectId}`,
    now: args.now,
  });
}

async function notifyConfessionConnectAccepted(
  ctx: MutationCtx,
  args: {
    requesterUserId: Id<'users'>;
    confessionId: Id<'confessions'>;
    connectId: Id<'confessionConnects'>;
    conversationId: Id<'conversations'>;
    matchId: Id<'matches'>;
    now: number;
  }
): Promise<void> {
  await upsertConfessionConnectNotification(ctx, {
    userId: args.requesterUserId,
    type: 'confession_connect_accepted',
    title: 'You connected',
    body: "You both connected. Say hi when you're ready.",
    data: {
      confessionId: String(args.confessionId),
      connectId: String(args.connectId),
      conversationId: String(args.conversationId),
      matchId: String(args.matchId),
      source: 'confession',
    },
    dedupeKey: `confession_connect_accepted:${args.connectId}`,
    now: args.now,
  });
}

function confessionAllowsConnectPromotion(
  confession: Doc<'confessions'>,
  connect: Doc<'confessionConnects'>,
  now: number,
  beingMarkedMutual: boolean
): boolean {
  if (confession.isDeleted || isHiddenByReports(confession)) return false;

  if (confession.expiresAt === undefined || confession.expiresAt > now) {
    return true;
  }

  // Retry path: if a connect had already become mutual before confession
  // expiry, a missing conversationId can still be repaired into a permanent
  // conversation. A pending connect cannot be accepted after expiry.
  return (
    !beingMarkedMutual &&
    connect.status === 'mutual' &&
    typeof connect.respondedAt === 'number' &&
    connect.respondedAt <= confession.expiresAt
  );
}

function confessionConversationMatchesConnect(
  conversation: Doc<'conversations'>,
  connect: Doc<'confessionConnects'>,
  confession: Doc<'confessions'>
): boolean {
  if (conversation.confessionId && conversation.confessionId !== confession._id) {
    return false;
  }
  const participants = new Set(conversation.participants.map(String));
  return (
    participants.has(String(connect.fromUserId)) &&
    participants.has(String(connect.toUserId))
  );
}

function canAttachConfessionMetadataToConversation(
  conversation: Doc<'conversations'>,
  confession: Doc<'confessions'>
): boolean {
  return !conversation.confessionId || conversation.confessionId === confession._id;
}

async function ensureMutualConfessionConversation(
  ctx: MutationCtx,
  connect: Doc<'confessionConnects'>,
  confession: Doc<'confessions'>,
  now: number,
  options?: { beingMarkedMutual?: boolean }
): Promise<{ conversationId: Id<'conversations'>; matchId: Id<'matches'> }> {
  const beingMarkedMutual = options?.beingMarkedMutual === true;
  if (connect.status !== 'mutual' && !beingMarkedMutual) {
    throw new Error('Connect request unavailable');
  }
  if (
    confession._id !== connect.confessionId ||
    confession.userId !== connect.toUserId ||
    confession.taggedUserId !== connect.fromUserId
  ) {
    throw new Error('Connect request unavailable');
  }
  if (!confessionAllowsConnectPromotion(confession, connect, now, beingMarkedMutual)) {
    throw new Error('Connect request unavailable');
  }
  if (!(await pairCanUseConfessionConnect(ctx, connect.fromUserId, connect.toUserId))) {
    throw new Error('Connect request unavailable');
  }

  const matchId = await ensureActiveMatchForPair(
    ctx,
    connect.fromUserId,
    connect.toUserId,
    'confession'
  );

  let conversation: Doc<'conversations'> | null = null;
  if (connect.conversationId) {
    const existingById = await ctx.db.get(connect.conversationId);
    if (
      existingById &&
      confessionConversationMatchesConnect(existingById, connect, confession)
    ) {
      conversation = existingById;
    }
  }

  if (!conversation) {
    conversation = await ctx.db
      .query('conversations')
      .withIndex('by_match', (q) => q.eq('matchId', matchId))
      .first();
  }

  if (!conversation) {
    conversation = await ctx.db
      .query('conversations')
      .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
      .first();
    if (conversation && !confessionConversationMatchesConnect(conversation, connect, confession)) {
      conversation = null;
    }
  }

  const participants = [connect.fromUserId, connect.toUserId];
  if (conversation) {
    await ctx.db.patch(conversation._id, {
      matchId,
      ...(canAttachConfessionMetadataToConversation(conversation, confession)
        ? { confessionId: confession._id }
        : {}),
      participants,
      isPreMatch: false,
      expiresAt: undefined,
      anonymousParticipantId: undefined,
      connectionSource: 'confession',
    });
    await ensureConversationParticipantRow(ctx, conversation._id, connect.fromUserId);
    await ensureConversationParticipantRow(ctx, conversation._id, connect.toUserId);
    return { conversationId: conversation._id, matchId };
  }

  const conversationId = await ctx.db.insert('conversations', {
    matchId,
    confessionId: confession._id,
    participants,
    isPreMatch: false,
    createdAt: now,
    lastMessageAt: now,
    connectionSource: 'confession',
  });

  await ensureConversationParticipantRow(ctx, conversationId, connect.fromUserId);
  await ensureConversationParticipantRow(ctx, conversationId, connect.toUserId);
  return { conversationId, matchId };
}

// Create a new confession
export const createConfession = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    authorVisibility: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur_photo'))),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    taggedUserId: v.optional(v.union(v.id('users'), v.string())), // User being confessed to
    // Optional client-suggested tagged user display name. The backend prefers
    // the canonical name fetched from the users table when available; this
    // arg is only used as a fallback if the user lookup yields no name.
    taggedUserName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // P1-01: Server-side rate limiting - count confessions in last 24 hours
    const now = Date.now();
    const twentyFourHoursAgo = now - CONFESSION_EXPIRY_MS;
    const recentConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.gt(q.field('createdAt'), twentyFourHoursAgo))
      .collect();

    if (recentConfessions.length >= CONFESSION_RATE_LIMIT) {
      throw new Error('You have reached the confession limit. Please try again later.');
    }

    // Map taggedUserId if provided (MUTATION: can create)
    let taggedUserId: Id<'users'> | undefined;
    if (args.taggedUserId) {
      taggedUserId = await ensureUserByAuthId(ctx, args.taggedUserId as string);
    }

    const trimmed = args.text.trim();
    if (trimmed.length < 10) {
      throw new Error('Confession must be at least 10 characters.');
    }
    // P2-1 FIX: Add max length validation to prevent DoS/database bloat
    if (trimmed.length > 5000) {
      throw new Error('Confession must be 5000 characters or less.');
    }
    if (PHONE_PATTERN.test(trimmed)) {
      throw new Error('Do not include phone numbers in confessions.');
    }
    if (EMAIL_PATTERN.test(trimmed)) {
      throw new Error('Do not include email addresses in confessions.');
    }

    // If taggedUserId provided, verify the current user has liked them
    let resolvedTaggedUserName: string | undefined;
    if (taggedUserId) {
      const likeRecord = await ctx.db
        .query('likes')
        .withIndex('by_from_to', (q) =>
          q.eq('fromUserId', userId).eq('toUserId', taggedUserId!)
        )
        .filter((q) =>
          q.or(
            q.eq(q.field('action'), 'like'),
            q.eq(q.field('action'), 'super_like'),
            q.eq(q.field('action'), 'text')
          )
        )
        .first();

      if (!likeRecord) {
        throw new Error('You can only confess to users you have liked.');
      }

      // Prefer the canonical name from the users table over the client-supplied
      // string. Falls back to the trimmed/sanitised client value only if the
      // backend lookup yields no usable name (defensive — user docs always have
      // a name in this app's schema).
      const taggedUserDoc = await ctx.db.get(taggedUserId);
      const canonicalName = taggedUserDoc?.name?.trim();
      if (canonicalName && canonicalName.length > 0) {
        resolvedTaggedUserName = canonicalName.slice(0, 64);
      } else if (typeof args.taggedUserName === 'string') {
        const fallback = args.taggedUserName.trim();
        if (fallback.length > 0) {
          resolvedTaggedUserName = fallback.slice(0, 64);
        }
      }
    }

    const confessionId = await ctx.db.insert('confessions', {
      userId: userId,
      text: trimmed,
      isAnonymous: args.isAnonymous,
      authorVisibility: args.authorVisibility,
      mood: args.mood,
      visibility: args.visibility,
      imageUrl: args.imageUrl,
      authorName: args.isAnonymous ? undefined : args.authorName,
      authorPhotoUrl: args.isAnonymous ? undefined : args.authorPhotoUrl,
      authorAge: args.isAnonymous ? undefined : args.authorAge,
      authorGender: args.isAnonymous ? undefined : args.authorGender,
      replyCount: 0,
      reactionCount: 0,
      voiceReplyCount: 0,
      createdAt: now,
      expiresAt: now + CONFESSION_EXPIRY_MS,
      taggedUserId: taggedUserId,
      // Persisted only when a tagged user was successfully resolved. Anonymous
      // confessions still record this — visibility is gated by the serializer,
      // not by storage.
      taggedUserName: resolvedTaggedUserName,
    });

    // If tagged, create notification for the tagged user
    if (taggedUserId) {
      // 1) Confess-tab "Tagged for you" sheet feed (kept as fallback surface).
      await ctx.db.insert('confessionNotifications', {
        userId: taggedUserId,
        confessionId,
        fromUserId: userId,
        type: 'TAGGED_CONFESSION',
        seen: false,
        createdAt: now,
      });

      // 2) Phase-1 main bell deep-link row. Generic body — never reveals
      //    author identity, regardless of authorVisibility, so that anonymous
      //    confessions don't leak the poster via the notification surface or
      //    the push payload. Tap routes to /(main)/confession-thread using
      //    data.confessionId.
      const taggedDedupeKey = `tagged_confession:${confessionId}`;
      const existingTaggedNotif = await ctx.db
        .query('notifications')
        .withIndex('by_user_dedupe', (q) =>
          q.eq('userId', taggedUserId!).eq('dedupeKey', taggedDedupeKey)
        )
        .first();

      const notifTitle = 'New confession';
      const notifBody = 'Someone tagged you in a confession.';
      const notifData = {
        confessionId: String(confessionId),
        fromUserId: String(userId),
      };
      const notifExpiresAt = now + 24 * 60 * 60 * 1000;

      if (existingTaggedNotif) {
        // Same confession id → idempotent refresh (handles retries).
        await ctx.db.patch(existingTaggedNotif._id, {
          title: notifTitle,
          body: notifBody,
          data: notifData,
          phase: 'phase1',
          createdAt: now,
          expiresAt: notifExpiresAt,
          readAt: undefined,
        });
      } else {
        await ctx.db.insert('notifications', {
          userId: taggedUserId,
          type: 'tagged_confession',
          title: notifTitle,
          body: notifBody,
          data: notifData,
          phase: 'phase1',
          dedupeKey: taggedDedupeKey,
          createdAt: now,
          expiresAt: notifExpiresAt,
        });
        await ctx.scheduler.runAfter(0, internal.pushNotifications.send, {
          userId: taggedUserId,
          title: notifTitle,
          body: notifBody,
          data: notifData,
          type: 'tagged_confession',
        });
      }
    }

    return confessionId;
  },
});

// List confessions (latest) with 2 reply previews per confession
// Only returns non-expired confessions for public feed
// P0-3: Viewer-aware — excludes confessions reported by viewer
export const listConfessions = query({
  args: {
    sortBy: v.union(v.literal('trending'), v.literal('latest')),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, { sortBy, viewerId }) => {
    const now = Date.now();
    const allConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // P0-3: Build set of confession IDs the viewer has reported (server-side filter)
    let reportedIds: Set<string> = new Set();
    let resolvedViewerId: Id<'users'> | null = null;
    if (viewerId) {
      resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
      if (resolvedViewerId) {
        reportedIds = await getReportedConfessionIdsForViewer(ctx, resolvedViewerId);
      }
    }

    // Filter out expired, deleted, viewer-reported, and non-owner hidden confessions.
    const confessions = allConfessions.filter(
      (c) => {
        const viewerIsOwner = !!resolvedViewerId && c.userId === resolvedViewerId;
        const moderationStatus = getConfessionModerationStatus(c);
        return (
          (c.expiresAt === undefined || c.expiresAt > now) &&
          !c.isDeleted &&
          !reportedIds.has(String(c._id)) &&
          (moderationStatus !== 'hidden_by_reports' || viewerIsOwner) &&
          (sortBy !== 'trending' || moderationStatus === 'normal')
        );
      }
    );

    // Pre-fetch live primary photos for all unique authors so the feed
    // reflects the current `users.primaryPhotoUrl` instead of the stale
    // snapshot stored on each confession at create time.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      confessions.map((c) => c.userId)
    );

    // Attach 2 reply previews per confession
    const withPreviews = await Promise.all(
      confessions.map(async (c) => {
        const replies = await ctx.db
          .query('confessionReplies')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .order('asc')
          .take(2);

        // Get top 3 emoji reactions for display
        const allReactions = await ctx.db
          .query('confessionReactions')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .collect();
        const emojiCounts: Record<string, number> = {};
        for (const r of allReactions) {
          // Skip old string-based reaction keys (e.g. "relatable", "bold")
          if (/^[a-zA-Z0-9_\s]+$/.test(r.type)) continue;
          emojiCounts[r.type] = (emojiCounts[r.type] || 0) + 1;
        }
        const topEmojis = Object.entries(emojiCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([emoji, count]) => ({ emoji, count }));

        return {
          ...serializeConfession(c, {
            includeTaggedUserId: true,
            viewerIsOwner: !!resolvedViewerId && c.userId === resolvedViewerId,
            livePhotoUrlByUserId,
          }),
          replyPreviews: replies.map((r) => ({
            _id: r._id,
            text: r.text,
            isAnonymous: r.isAnonymous,
            type: r.type || 'text',
            createdAt: r.createdAt,
          })),
          topEmojis,
        };
      })
    );

    if (sortBy === 'trending') {
      // Improved trending scoring with time decay
      // Replies are strongest signal (weight 5), reactions medium (weight 2)
      // Time decay reduces score for older confessions
      withPreviews.sort((a, b) => {
        const hoursSinceA = (now - a.createdAt) / (1000 * 60 * 60);
        const hoursSinceB = (now - b.createdAt) / (1000 * 60 * 60);

        // Score formula: (replies * 5 + reactions * 2) / (hours + 2)
        // The +2 prevents division by zero and gives new posts a baseline
        const scoreA = (a.replyCount * 5 + a.reactionCount * 2) / (hoursSinceA + 2);
        const scoreB = (b.replyCount * 5 + b.reactionCount * 2) / (hoursSinceB + 2);
        return scoreB - scoreA;
      });
    }

    return withPreviews;
  },
});

// Get trending confessions (last 48h, time-decay scoring)
// Only returns non-expired confessions
// P0-3: Viewer-aware — excludes confessions reported by viewer
export const getTrendingConfessions = query({
  args: {
    viewerId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, { viewerId }) => {
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000; // 48 hours ago

    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // P0-3: Build set of confession IDs the viewer has reported (server-side filter)
    let reportedIds: Set<string> = new Set();
    if (viewerId) {
      const resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
      if (resolvedViewerId) {
        reportedIds = await getReportedConfessionIdsForViewer(ctx, resolvedViewerId);
      }
    }

    // Filter to last 48h AND not expired AND not deleted AND not viewer-reported.
    // Trending excludes all moderated rows above normal visibility.
    const recent = confessions.filter(
      (c) =>
        c.createdAt > cutoff &&
        (c.expiresAt === undefined || c.expiresAt > now) &&
        !c.isDeleted &&
        !reportedIds.has(String(c._id)) &&
        getConfessionModerationStatus(c) === 'normal'
    );

    // Pre-fetch live primary photos so trending cards reflect the author's
    // current main profile photo, not the create-time snapshot.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      recent.map((c) => c.userId)
    );

    // Improved trending scoring with consistent weights
    // Replies are strongest signal (weight 5), reactions medium (weight 2)
    // Voice replies get additional bonus (+1 each)
    const scored = recent.map((c) => {
      const hoursSince = (now - c.createdAt) / (1000 * 60 * 60);
      const voiceReplies = c.voiceReplyCount || 0;
      const score =
        (c.replyCount * 5 + c.reactionCount * 2 + voiceReplies * 1) /
        (hoursSince + 2);
      return serializeConfession(c, {
        includeTaggedUserId: true,
        trendingScore: score,
        livePhotoUrlByUserId,
      });
    });

    scored.sort((a, b) => (b.trendingScore ?? 0) - (a.trendingScore ?? 0));

    // Return top 5 trending
    return scored.slice(0, 5);
  },
});

// Get a single confession by ID
// P0-2: Fail closed — returns null if missing, deleted, or expired.
// Expired rows remain readable only by their owner for My Confessions history.
export const getConfession = query({
  args: {
    confessionId: v.id('confessions'),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, token }) => {
    const confession = await ctx.db.get(confessionId);
    if (!confession) return null;
    if (confession.isDeleted) return null;
    const now = Date.now();
    const isExpired = confession.expiresAt !== undefined && confession.expiresAt <= now;
    const validatedViewerId = await getValidatedViewerFromToken(ctx, token);
    const viewerIsOwner = !!validatedViewerId && validatedViewerId === confession.userId;
    // P1-1: Identify the tagged recipient so the serializer can carve out
    // taggedUserId/taggedUserName for them even when the confession is
    // anonymous. Author identity remains hidden — only the tag is exposed.
    const viewerIsTaggedRecipient =
      !!validatedViewerId &&
      !!confession.taggedUserId &&
      validatedViewerId === confession.taggedUserId;

    if (isExpired) {
      if (!viewerIsOwner) return null;
    }

    if (isHiddenByReports(confession) && !viewerIsOwner) {
      return null;
    }

    if (
      validatedViewerId &&
      !viewerIsOwner &&
      (await hasViewerReportedConfession(ctx, validatedViewerId, confessionId))
    ) {
      return null;
    }

    // Resolve the live primary photo for the author so the thread hero
    // reflects the current main photo, not the create-time snapshot.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      [confession.userId]
    );

    return serializeConfession(confession, {
      includeTaggedUserId: true,
      isExpired,
      viewerIsOwner,
      viewerIsTaggedRecipient,
      livePhotoUrlByUserId,
    });
  },
});

// Create a reply to a confession (text or voice only — no images/videos/gifs)
// Rules:
//  - Top-level comments (no parentReplyId): one per user per confession.
//  - Threaded replies (parentReplyId set): only the confession owner may create them,
//    and the parent must belong to the same confession.
//  - identityMode is the canonical source of truth for render mode. isAnonymous is
//    derived from it and kept in sync for backward compatibility.
export const createReply = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(),
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('open'),
      v.literal('blur_photo')
    )),
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    parentReplyId: v.optional(v.id('confessionReplies')), // OP-only reply to a comment
    // Author display snapshot (ignored for anonymous mode).
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // P0-2: Fail closed — refuse replies on missing/deleted/expired parent
    const parent = await ctx.db.get(args.confessionId);
    if (!parent) {
      throw new Error('Confession not found.');
    }
    if (parent.isDeleted) {
      throw new Error('This confession is no longer available.');
    }
    const nowMs = Date.now();
    if (parent.expiresAt !== undefined && parent.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }
    if (isHiddenByReports(parent) && parent.userId !== userId) {
      throw new Error('This confession is no longer accepting interactions.');
    }

    // Normalize identity mode. The request-provided value wins; otherwise derive
    // from the legacy isAnonymous boolean for backward compatibility with older clients.
    const identityMode = canonicalIdentityMode(args.identityMode, args.isAnonymous);
    const effectiveIsAnonymous = identityMode === 'anonymous';

    // Threaded reply rules (OP-only).
    if (args.parentReplyId !== undefined) {
      if (parent.userId !== userId) {
        throw new Error('Only the confession owner can reply to comments.');
      }
      const parentReply = await ctx.db.get(args.parentReplyId);
      if (!parentReply) {
        throw new Error('Parent comment not found.');
      }
      if (parentReply.confessionId !== args.confessionId) {
        throw new Error('Parent comment does not belong to this confession.');
      }
      // Don't allow deeply nested replies (reply-to-reply-to-reply).
      if (parentReply.parentReplyId !== undefined) {
        throw new Error('Cannot reply to a reply.');
      }
    } else {
      // Top-level: enforce one comment per user per confession.
      const existingTopLevel = await ctx.db
        .query('confessionReplies')
        .withIndex('by_confession_user', (q) =>
          q.eq('confessionId', args.confessionId).eq('userId', userId)
        )
        .filter((q) => q.eq(q.field('parentReplyId'), undefined))
        .first();
      if (existingTopLevel) {
        throw new Error('You have already commented on this confession.');
      }
    }

    const replyType = args.type || 'text';

    if (replyType === 'text') {
      const trimmed = args.text.trim();
      if (trimmed.length < 1) {
        throw new Error('Reply cannot be empty.');
      }
      if (PHONE_PATTERN.test(trimmed)) {
        throw new Error('Do not include phone numbers.');
      }
      if (EMAIL_PATTERN.test(trimmed)) {
        throw new Error('Do not include email addresses.');
      }
    }

    const replyId = await ctx.db.insert('confessionReplies', {
      confessionId: args.confessionId,
      userId: userId,
      text: args.text.trim(),
      isAnonymous: effectiveIsAnonymous,
      identityMode,
      type: replyType,
      voiceUrl: args.voiceUrl,
      voiceDurationSec: args.voiceDurationSec,
      parentReplyId: args.parentReplyId,
      // Snapshot author display fields only when the mode may reveal them.
      authorName: effectiveIsAnonymous ? undefined : args.authorName,
      authorPhotoUrl: effectiveIsAnonymous ? undefined : args.authorPhotoUrl,
      authorAge: effectiveIsAnonymous ? undefined : args.authorAge,
      authorGender: effectiveIsAnonymous ? undefined : args.authorGender,
      createdAt: nowMs,
    });

    // Engagement count — only OUTSIDE-USER top-level comments count.
    // Owner replies to comments (parentReplyId set) and any owner self-authored
    // reply must NOT increment replyCount / voiceReplyCount, otherwise the
    // confession owner could artificially inflate trending by replying to
    // every comment on their own post.
    const isCountableReply =
      args.parentReplyId === undefined && parent.userId !== userId;

    if (isCountableReply) {
      const patch: any = { replyCount: parent.replyCount + 1 };
      if (replyType === 'voice') {
        patch.voiceReplyCount = (parent.voiceReplyCount || 0) + 1;
      }
      await ctx.db.patch(args.confessionId, patch);
    }

    return replyId;
  },
});

// Update own reply. Owner-only. Allows editing text and/or identityMode.
// When switching to anonymous, author snapshot fields are cleared.
// When switching to a non-anonymous mode, the caller may pass fresh snapshot fields
// so display stays consistent with the new mode.
export const updateReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()),
    text: v.optional(v.string()),
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('open'),
      v.literal('blur_photo')
    )),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only edit your own replies.');

    // Refuse edits on replies whose parent confession is gone/expired.
    const parent = await ctx.db.get(reply.confessionId);
    if (!parent || parent.isDeleted) {
      throw new Error('This confession is no longer available.');
    }
    const nowMs = Date.now();
    if (parent.expiresAt !== undefined && parent.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }

    const patch: Partial<Doc<'confessionReplies'>> = {};

    // Text edit — only meaningful for text replies.
    if (args.text !== undefined) {
      if (reply.type === 'voice') {
        throw new Error('Voice replies cannot be edited.');
      }
      const trimmed = args.text.trim();
      if (trimmed.length < 1) {
        throw new Error('Reply cannot be empty.');
      }
      if (PHONE_PATTERN.test(trimmed)) {
        throw new Error('Do not include phone numbers.');
      }
      if (EMAIL_PATTERN.test(trimmed)) {
        throw new Error('Do not include email addresses.');
      }
      patch.text = trimmed;
    }

    // Identity mode switch.
    if (args.identityMode !== undefined) {
      const nextMode = canonicalIdentityMode(args.identityMode, false);
      patch.identityMode = nextMode;
      patch.isAnonymous = nextMode === 'anonymous';
      if (nextMode === 'anonymous') {
        // Clear leakable fields.
        patch.authorName = undefined;
        patch.authorPhotoUrl = undefined;
        patch.authorAge = undefined;
        patch.authorGender = undefined;
      } else {
        // Accept fresh snapshot if caller provided one; otherwise keep existing.
        if (args.authorName !== undefined) patch.authorName = args.authorName;
        if (args.authorPhotoUrl !== undefined) patch.authorPhotoUrl = args.authorPhotoUrl;
        if (args.authorAge !== undefined) patch.authorAge = args.authorAge;
        if (args.authorGender !== undefined) patch.authorGender = args.authorGender;
      }
    }

    if (Object.keys(patch).length === 0) {
      // Nothing to do — treat as a no-op rather than an error.
      return { success: true, noChange: true };
    }

    patch.editedAt = nowMs;

    await ctx.db.patch(args.replyId, patch);

    return { success: true, noChange: false };
  },
});

// Delete own reply. Fails closed when the parent confession is missing/deleted/expired
// so comment actions never outlive the parent.
export const deleteReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only delete your own replies.');

    // Fail closed — no comment action should succeed on a dead/expired confession.
    const parent = await ctx.db.get(reply.confessionId);
    if (!parent || parent.isDeleted) {
      throw new Error('This confession is no longer available.');
    }
    const nowMs = Date.now();
    if (parent.expiresAt !== undefined && parent.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }

    await ctx.db.delete(args.replyId);

    // Mirror the createReply counting rule: only decrement if THIS reply was
    // itself counted (an outside-user top-level comment). Owner replies were
    // never counted, so deleting them must not drift the count downward.
    const wasCounted =
      reply.parentReplyId === undefined && reply.userId !== parent.userId;

    if (wasCounted) {
      const patch: any = {
        replyCount: Math.max(0, parent.replyCount - 1),
      };
      if (reply.type === 'voice') {
        patch.voiceReplyCount = Math.max(0, (parent.voiceReplyCount || 0) - 1);
      }
      await ctx.db.patch(reply.confessionId, patch);
    }

    return { success: true };
  },
});

// Get replies for a confession
// P0-2: Fail closed — returns [] if parent missing, deleted, or expired
// If viewerId is supplied, each reply carries isOwnReply for convenient client gating.
// Author identity fields are only returned for non-anonymous rows.
export const getReplies = query({
  args: {
    confessionId: v.id('confessions'),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, viewerId, token }) => {
    const parent = await ctx.db.get(confessionId);
    if (!parent) return [];
    if (parent.isDeleted) return [];

    const validatedViewerId = await getValidatedViewerFromToken(ctx, token);
    const viewerIsValidatedOwner = !!validatedViewerId && validatedViewerId === parent.userId;
    const now = Date.now();
    const isExpired = parent.expiresAt !== undefined && parent.expiresAt <= now;
    if (isExpired) {
      if (!viewerIsValidatedOwner) return [];
    }

    if (isHiddenByReports(parent) && !viewerIsValidatedOwner) {
      return [];
    }

    // Resolve viewer for display-only isOwnReply. Expired access never relies on
    // client-provided viewerId; when expired, use the validated token owner.
    let resolvedViewerId: Id<'users'> | null = validatedViewerId;
    if (!resolvedViewerId && !isExpired && viewerId) {
      resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
    }

    if (
      resolvedViewerId &&
      resolvedViewerId !== parent.userId &&
      (await hasViewerReportedConfession(ctx, resolvedViewerId, confessionId))
    ) {
      return [];
    }

    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .order('asc')
      .collect();

    // Pre-fetch live primary photos for every replier so comment avatars
    // reflect the current `users.primaryPhotoUrl` source of truth instead
    // of the snapshot stored on the reply at create time.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      replies.map((r) => r.userId)
    );

    return replies.map((reply) =>
      serializeReply(reply, {
        viewerId: resolvedViewerId,
        livePhotoUrlByUserId,
      })
    );
  },
});

// Return the viewer's own top-level reply (if any) on this confession.
// Used by the composer to decide between "new comment" and "edit your comment" UX.
// Fails closed like getReplies: returns null when the confession is missing/deleted/expired,
// or when the viewer has no top-level comment on this confession.
export const getMyReplyForConfession = query({
  args: {
    confessionId: v.id('confessions'),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, viewerId, token }) => {
    const parent = await ctx.db.get(confessionId);
    if (!parent) return null;
    if (parent.isDeleted) return null;

    const validatedViewerId = await getValidatedViewerFromToken(ctx, token);
    const viewerIsValidatedOwner = !!validatedViewerId && validatedViewerId === parent.userId;
    const now = Date.now();
    const isExpired = parent.expiresAt !== undefined && parent.expiresAt <= now;
    if (isExpired) {
      if (!viewerIsValidatedOwner) return null;
    }

    if (isHiddenByReports(parent) && !viewerIsValidatedOwner) {
      return null;
    }

    let resolvedViewerId: Id<'users'> | null = validatedViewerId;
    if (!resolvedViewerId && !isExpired && viewerId) {
      resolvedViewerId = await resolveUserIdByAuthId(ctx, viewerId as string);
    }
    if (!resolvedViewerId) return null;
    if (
      resolvedViewerId !== parent.userId &&
      (await hasViewerReportedConfession(ctx, resolvedViewerId, confessionId))
    ) {
      return null;
    }

    const own = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', confessionId).eq('userId', resolvedViewerId)
      )
      .filter((q) => q.eq(q.field('parentReplyId'), undefined))
      .first();

    if (!own) return null;
    // Single-user lookup so the composer's "edit your comment" preview shows
    // the viewer's current main profile photo, not the create-time snapshot.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      [own.userId]
    );
    return serializeReply(own, { viewerId: resolvedViewerId, livePhotoUrlByUserId });
  },
});

// Toggle emoji reaction — one emoji per user per confession (toggle/replace)
// Emoji reactions are reaction-only; Connect / Reject owns chat and match creation.
export const toggleReaction = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    type: v.string(), // any emoji string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) return { added: false, replaced: false, chatUnlocked: false };
    const nowMs = Date.now();
    if (confession.expiresAt !== undefined && confession.expiresAt <= nowMs) {
      throw new Error('This confession has expired.');
    }
    if (isHiddenByReports(confession) && confession.userId !== userId) {
      throw new Error('This confession is no longer accepting interactions.');
    }

    // Find existing reaction from this user on this confession
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();

    // CONSISTENCY FIX B3: Helper to recompute reaction count from source of truth
    const recomputeReactionCount = async () => {
      const allReactions = await ctx.db
        .query('confessionReactions')
        .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
        .collect();
      return allReactions.length;
    };

    if (existing) {
      if (existing.type === args.type) {
        // Same emoji → remove (toggle off)
        await ctx.db.delete(existing._id);
        // CONSISTENCY FIX B3: Recompute count from actual reactions to avoid race
        const actualCount = await recomputeReactionCount();
        await ctx.db.patch(args.confessionId, { reactionCount: actualCount });
        return { added: false, replaced: false, chatUnlocked: false };
      } else {
        // Different emoji → replace (count stays the same)
        await ctx.db.patch(existing._id, {
          type: args.type,
          createdAt: Date.now(),
        });
        return { added: false, replaced: true, chatUnlocked: false };
      }
    } else {
      // No existing → add new
      await ctx.db.insert('confessionReactions', {
        confessionId: args.confessionId,
        userId: userId,
        type: args.type,
        createdAt: Date.now(),
      });
      // CONSISTENCY FIX B3: Recompute count from actual reactions to avoid race
      const actualCount = await recomputeReactionCount();
      await ctx.db.patch(args.confessionId, { reactionCount: actualCount });

      return { added: true, replaced: false, chatUnlocked: false };
    }
  },
});

// Get all reactions for a confession (grouped by emoji)
export const getReactionCounts = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .collect();
    const emojiCounts: Record<string, number> = {};
    for (const r of reactions) {
      // Skip old string-based reaction keys (e.g. "relatable", "bold")
      if (/^[a-zA-Z0-9_\s]+$/.test(r.type)) continue;
      emojiCounts[r.type] = (emojiCounts[r.type] || 0) + 1;
    }
    // Return top emojis sorted by count
    const topEmojis = Object.entries(emojiCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji, count]) => ({ emoji, count }));
    return topEmojis;
  },
});

// Get user's reaction on a confession (single emoji or null)
export const getUserReaction = query({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getUserReaction] User not found for authUserId:', args.userId);
      return null;
    }

    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();
    return existing ? existing.type : null;
  },
});

// Get user's own confessions (all, including expired, with isExpired flag)
export const getMyConfessions = query({
  args: { userId: v.union(v.id('users'), v.string()) },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getMyConfessions] User not found for authUserId:', args.userId);
      return [];
    }

    const now = Date.now();
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();

    // All rows here belong to the same user — fetch their primary photo
    // once so My Confessions reflects the current main photo, not the
    // create-time snapshot.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      [userId]
    );

    // Filter out manually deleted confessions (isDeleted: true)
    // Expired confessions are kept but marked as expired for the owner to see
    return confessions
      .filter((confession) => !confession.isDeleted)
      .map((confession) =>
        serializeConfession(confession, {
          includeTaggedUserId: true,
          isExpired: confession.expiresAt !== undefined && confession.expiresAt <= now,
          viewerIsOwner: true,
          livePhotoUrlByUserId,
        })
      );
  },
});

// Report a confession
// Creates a record in confessionReports for moderation review
export const reportConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    reporterId: v.union(v.id('users'), v.string()),
    reason: v.union(
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const reporterId = await ensureUserByAuthId(ctx, args.reporterId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }

    if (confession.userId === reporterId) {
      throw new Error('You cannot report your own confession.');
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('confessionReports')
      .filter((q) =>
        q.and(
          q.eq(q.field('confessionId'), args.confessionId),
          q.eq(q.field('reporterId'), reporterId)
        )
      )
      .first();

    if (existingReport) {
      // Already reported - just return success (idempotent)
      return { success: true, alreadyReported: true };
    }

    const now = Date.now();

    // Create report record
    await ctx.db.insert('confessionReports', {
      confessionId: args.confessionId,
      reporterId: reporterId,
      reportedUserId: confession.userId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: now,
    });

    const reports = await ctx.db
      .query('confessionReports')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();
    const nextCount = new Set(reports.map((report) => String(report.reporterId))).size;
    const nextStatus = moderationStatusForCount(nextCount);
    const previousStatus = (confession as any).moderationStatus;
    const statusChanged = previousStatus !== nextStatus;
    const patch: Record<string, unknown> = {
      uniqueReportCount: nextCount,
      moderationStatus: nextStatus,
    };

    if (statusChanged) {
      patch.moderationStatusAt = now;
    }

    if (nextStatus === 'hidden_by_reports' && !(confession as any).hiddenByReportsAt) {
      patch.hiddenByReportsAt = now;
    }

    await ctx.db.patch(args.confessionId, patch as any);

    return { success: true, alreadyReported: false };
  },
});

// Report a specific comment/reply
// Creates a record in confessionReplyReports for moderation review.
// Idempotent per (reporter, reply) — repeat reports short-circuit to success.
export const reportReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    reporterId: v.union(v.id('users'), v.string()),
    reason: v.union(
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reporterId = await ensureUserByAuthId(ctx, args.reporterId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) {
      throw new Error('Comment not found.');
    }

    // Users cannot report their own comments.
    if (reply.userId === reporterId) {
      throw new Error('You cannot report your own comment.');
    }

    // Idempotency — same reporter + same reply is a no-op.
    const existing = await ctx.db
      .query('confessionReplyReports')
      .withIndex('by_reply', (q) => q.eq('replyId', args.replyId))
      .filter((q) => q.eq(q.field('reporterId'), reporterId))
      .first();

    if (existing) {
      return { success: true, alreadyReported: true };
    }

    await ctx.db.insert('confessionReplyReports', {
      replyId: args.replyId,
      confessionId: reply.confessionId,
      reporterId,
      reportedUserId: reply.userId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true, alreadyReported: false };
  },
});

// ============ TAGGED CONFESSION NOTIFICATIONS ============

// Get badge count of unseen tagged confessions for a user
export const getTaggedConfessionBadgeCount = query({
  args: { userId: v.union(v.id('users'), v.string()) },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getTaggedConfessionBadgeCount] User not found for authUserId:', args.userId);
      return 0;
    }

    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_seen', (q) => q.eq('userId', userId).eq('seen', false))
      .collect();
    return notifications.length;
  },
});

// List tagged confessions for a user (privacy-safe: only for the tagged user's view)
export const listTaggedConfessionsForUser = query({
  args: { userId: v.union(v.id('users'), v.string()) },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[listTaggedConfessionsForUser] User not found for authUserId:', args.userId);
      return [];
    }

    const now = Date.now();
    const reportedIds = await getReportedConfessionIdsForViewer(ctx, userId);
    const taggedUserDoc = await ctx.db.get(userId);

    // Get notifications for this user (limit 50)
    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .order('desc')
      .take(50);

    // Join with confession data
    const result = [];
    for (const notif of notifications) {
      const confession = await ctx.db.get(notif.confessionId);
      if (!confession) continue;
      if (confession.isDeleted) continue;
      if (isHiddenByReports(confession)) continue;
      if (reportedIds.has(String(confession._id))) continue;

      // Identity exposure rule for the "Tagged for you" sheet:
      //   anonymous   → leak nothing (matches feed behaviour for anonymous mode)
      //   blur_photo  → name + age + gender, photo is blurred client-side
      //   open        → full identity
      const effectiveVisibility = effectiveConfessionAuthorVisibility(
        confession.authorVisibility,
        confession.isAnonymous
      );
      const allowIdentity = effectiveVisibility !== 'anonymous';

      // Resolve the live primary photo from `users.primaryPhotoUrl` so the
      // sheet reflects the author's current main photo, not the snapshot
      // captured at create time. For blur_photo rows, the client applies the
      // blur; anonymous rows never fetch or return author identity.
      let liveAuthorPhotoUrl: string | undefined;
      if (allowIdentity) {
        const authorDoc = await ctx.db.get(confession.userId);
        liveAuthorPhotoUrl = authorDoc?.primaryPhotoUrl;
      }

      result.push({
        notificationId: notif._id,
        confessionId: notif.confessionId,
        seen: notif.seen,
        notificationCreatedAt: notif.createdAt,
        // Confession data
        confessionText: confession.text,
        confessionMood: confession.mood,
        confessionCreatedAt: confession.createdAt,
        confessionExpiresAt: confession.expiresAt,
        isExpired: confession.expiresAt !== undefined && confession.expiresAt <= now,
        replyCount: confession.replyCount,
        reactionCount: confession.reactionCount,
        // Author identity (privacy-gated — never leaked for anonymous mode)
        authorVisibility: effectiveVisibility,
        authorName: allowIdentity ? confession.authorName : undefined,
        authorPhotoUrl: liveAuthorPhotoUrl,
        authorAge: allowIdentity ? confession.authorAge : undefined,
        authorGender: allowIdentity ? confession.authorGender : undefined,
        taggedUserId: confession.taggedUserId ?? userId,
        taggedUserName: confession.taggedUserName ?? taggedUserDoc?.name,
      });
    }

    return result;
  },
});

// Mark tagged confession notifications as seen
export const markTaggedConfessionsSeen = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    notificationIds: v.optional(v.array(v.id('confessionNotifications'))),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);
    const { notificationIds } = args;

    if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications as seen
      for (const notifId of notificationIds) {
        const notif = await ctx.db.get(notifId);
        if (notif && notif.userId === userId && !notif.seen) {
          await ctx.db.patch(notifId, { seen: true });
        }
      }
    } else {
      // Mark all unseen notifications for this user as seen
      const unseen = await ctx.db
        .query('confessionNotifications')
        .withIndex('by_user_seen', (q) => q.eq('userId', userId).eq('seen', false))
        .collect();

      for (const notif of unseen) {
        await ctx.db.patch(notif._id, { seen: true });
      }
    }

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Consume a confession-tag profile-view grant.
//
// Validates that the viewer is allowed to open the tagged user's profile via
// the @mention chip on a specific confession, and records a (viewer,
// confession, profileUser)-scoped grant on success. Anonymous-author identity
// is never disclosed because we only ever return / reference the *tagged*
// user, never the confession author.
//
// Validation order (fails closed at every step with the same generic
// "Profile unavailable" copy on the client side — we never disclose the
// reason to avoid leaking block/report status):
//   1. Viewer resolved server-side from session token (no client viewerId).
//   2. Confession exists, not deleted, not expired (or viewer is the owner —
//      owners can re-open their own thread's mention even after expiry).
//   3. Confession is not hidden by reports for the viewer.
//   4. Viewer has not reported the confession.
//   5. confession.taggedUserId === args.profileUserId (mention-id match —
//      prevents using a benign confession id to open an unrelated profile).
//   6. Target user exists.
//   7. Bidirectional block check between viewer and target.
//   8. Viewer has not reported the target.
//
// Self-tap is permitted (viewer === profileUserId): no grant row is written
// because no bypass is needed — opening your own profile is always allowed
// and is governed by the existing self-profile flow.
// ═══════════════════════════════════════════════════════════════════════════
const TAG_PROFILE_VIEW_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export const canUseConfessTagActions = query({
  args: {
    token: v.string(),
    confessionId: v.union(v.id('confessions'), v.string()),
    taggedUserId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, { token, confessionId, taggedUserId }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      return { allowed: false };
    }

    let confession: Doc<'confessions'> | null = null;
    try {
      confession = await ctx.db.get(confessionId as Id<'confessions'>);
    } catch {
      return { allowed: false };
    }

    if (!confession || confession.isDeleted) {
      return { allowed: false };
    }

    const now = Date.now();
    if (confession.expiresAt !== undefined && confession.expiresAt <= now) {
      return { allowed: false };
    }

    if (isHiddenByReports(confession)) {
      return { allowed: false };
    }

    if (await hasViewerReportedConfession(ctx, viewerId, confession._id)) {
      return { allowed: false };
    }

    // Confess-tag dating actions are only for the tagged recipient. The
    // confession author and unrelated viewers always get profile-only context.
    if (
      !confession.taggedUserId ||
      confession.taggedUserId !== viewerId ||
      confession.userId === viewerId
    ) {
      return { allowed: false };
    }

    const resolvedTaggedUserId = await resolveUserIdByAuthId(ctx, taggedUserId as string);
    if (!resolvedTaggedUserId || resolvedTaggedUserId !== confession.taggedUserId) {
      return { allowed: false };
    }

    const target = await ctx.db.get(resolvedTaggedUserId);
    if (!target || !target.isActive || target.deletedAt || target.isBanned) {
      return { allowed: false };
    }

    if (viewerId !== resolvedTaggedUserId) {
      const blockedByViewer = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', viewerId).eq('blockedUserId', resolvedTaggedUserId)
        )
        .first();
      if (blockedByViewer) {
        return { allowed: false };
      }

      const blockedByTarget = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', resolvedTaggedUserId).eq('blockedUserId', viewerId)
        )
        .first();
      if (blockedByTarget) {
        return { allowed: false };
      }

      const reportedByViewer = await ctx.db
        .query('reports')
        .withIndex('by_reporter_reported_created', (q) =>
          q.eq('reporterId', viewerId).eq('reportedUserId', resolvedTaggedUserId)
        )
        .first();
      if (reportedByViewer) {
        return { allowed: false };
      }
    }

    return { allowed: true };
  },
});

export const consumeConfessionTagProfileViewGrant = mutation({
  args: {
    token: v.string(),
    confessionId: v.id('confessions'),
    profileUserId: v.id('users'),
  },
  handler: async (ctx, { token, confessionId, profileUserId }) => {
    // 1. Server-side viewer resolution. We do NOT accept a client viewerId
    //    here — the grant is bound to whoever the session token authorises.
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      throw new Error('Profile unavailable');
    }

    // 2. Confession existence + lifecycle.
    const confession = await ctx.db.get(confessionId);
    if (!confession || confession.isDeleted) {
      throw new Error('Profile unavailable');
    }
    const now = Date.now();
    const viewerIsOwner = confession.userId === viewerId;
    if (
      confession.expiresAt !== undefined &&
      confession.expiresAt <= now &&
      !viewerIsOwner
    ) {
      throw new Error('Profile unavailable');
    }

    // 3. Hidden-by-reports gate (consistent with getConfession).
    if (isHiddenByReports(confession) && !viewerIsOwner) {
      throw new Error('Profile unavailable');
    }

    // 4. Viewer-reported-confession gate.
    if (
      !viewerIsOwner &&
      (await hasViewerReportedConfession(ctx, viewerId, confessionId))
    ) {
      throw new Error('Profile unavailable');
    }

    // 5. Mention-id match — the cornerstone of the grant. The viewer can
    //    only open the *tagged* user, never an arbitrary user. This is what
    //    prevents the chip endpoint from being abused as a generic profile
    //    opener.
    if (!confession.taggedUserId || confession.taggedUserId !== profileUserId) {
      throw new Error('Profile unavailable');
    }

    // 6. Target existence.
    const target = await ctx.db.get(profileUserId);
    if (!target) {
      throw new Error('Profile unavailable');
    }

    // Self-tap → allow without writing a grant row.
    if (viewerId === profileUserId) {
      return {
        success: true as const,
        profileUserId: String(profileUserId),
        fromConfessionId: String(confessionId),
        source: 'confess_tag' as const,
        canUseDatingActions:
          confession.taggedUserId === viewerId && confession.userId !== viewerId,
      };
    }

    // 7. Bidirectional block check.
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', viewerId).eq('blockedUserId', profileUserId)
      )
      .first();
    if (blockedByViewer) {
      throw new Error('Profile unavailable');
    }
    const blockedByTarget = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', profileUserId).eq('blockedUserId', viewerId)
      )
      .first();
    if (blockedByTarget) {
      throw new Error('Profile unavailable');
    }

    // 8. Viewer-reported-target gate. Mirror of the report check used by
    //    other profile-opening flows (e.g. privateDiscover.getProfileByUserId).
    const reportedByViewer = await ctx.db
      .query('reports')
      .withIndex('by_reporter_reported_created', (q) =>
        q.eq('reporterId', viewerId).eq('reportedUserId', profileUserId)
      )
      .first();
    if (reportedByViewer) {
      throw new Error('Profile unavailable');
    }

    // Idempotent upsert. We key on (viewer, confession) — the same chip can
    // be tapped multiple times during the 24h grant window without spamming
    // grant rows. profileUserId is locked because step 5 already pinned it
    // to the confession's taggedUserId.
    const expiresAt = now + TAG_PROFILE_VIEW_GRANT_TTL_MS;
    const existing = await ctx.db
      .query('confessionTagProfileViews')
      .withIndex('by_viewer_confession', (q) =>
        q.eq('viewerId', viewerId).eq('confessionId', confessionId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        profileUserId,
        consumedAt: now,
        expiresAt,
      });
    } else {
      await ctx.db.insert('confessionTagProfileViews', {
        viewerId,
        profileUserId,
        confessionId,
        createdAt: now,
        consumedAt: now,
        expiresAt,
      });
    }

    return {
      success: true as const,
      profileUserId: String(profileUserId),
      fromConfessionId: String(confessionId),
      source: 'confess_tag' as const,
      canUseDatingActions:
        confession.taggedUserId === viewerId && confession.userId !== viewerId,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Confess Connect / Reject backend foundation.
//
// Stores the authoritative two-sided decision state. Once mutual, the
// backend promotes/creates a permanent Phase-1 conversation without revealing
// identity before both sides have opted in.
// ═══════════════════════════════════════════════════════════════════════════
export const requestConfessionConnect = mutation({
  args: {
    token: v.string(),
    confessionId: v.id('confessions'),
  },
  handler: async (ctx, { token, confessionId }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      throw new Error('Connect unavailable');
    }

    const confession = await ctx.db.get(confessionId);
    const now = Date.now();
    if (!confession || !confessionIsConnectable(confession, now)) {
      throw new Error('Connect unavailable');
    }

    if (!confession.taggedUserId || confession.taggedUserId !== viewerId) {
      throw new Error('Connect unavailable');
    }

    if (await hasViewerReportedConfession(ctx, viewerId, confessionId)) {
      throw new Error('Connect unavailable');
    }

    if (!(await pairCanUseConfessionConnect(ctx, viewerId, confession.userId))) {
      throw new Error('Connect unavailable');
    }

    const existing = await getExistingConfessionConnect(ctx, confessionId);
    if (existing) {
      if (existing.fromUserId !== viewerId || existing.toUserId !== confession.userId) {
        throw new Error('Connect unavailable');
      }
      const current = await patchExpiredConnectIfNeeded(ctx, existing, now);
      if (current.status === 'pending') {
        await notifyConfessionConnectRequested(ctx, {
          toUserId: confession.userId,
          fromUserId: viewerId,
          confessionId,
          connectId: current._id,
          now,
        });
      }
      return serializeConfessionConnect(current);
    }

    const connectId = await ctx.db.insert('confessionConnects', {
      confessionId,
      fromUserId: viewerId,
      toUserId: confession.userId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + CONFESSION_CONNECT_EXPIRY_MS,
    });

    const connect = await ctx.db.get(connectId);
    if (!connect) {
      throw new Error('Connect unavailable');
    }

    await notifyConfessionConnectRequested(ctx, {
      toUserId: confession.userId,
      fromUserId: viewerId,
      confessionId,
      connectId,
      now,
    });

    return serializeConfessionConnect(connect);
  },
});

export const respondToConfessionConnect = mutation({
  args: {
    token: v.string(),
    connectId: v.id('confessionConnects'),
    decision: v.union(v.literal('connect'), v.literal('reject')),
  },
  handler: async (ctx, { token, connectId, decision }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      throw new Error('Connect request unavailable');
    }

    let connect = await ctx.db.get(connectId);
    if (!connect || connect.toUserId !== viewerId) {
      throw new Error('Connect request unavailable');
    }

    const now = Date.now();
    connect = await patchExpiredConnectIfNeeded(ctx, connect, now);
    if (connect.status === 'expired') {
      return serializeConfessionConnect(connect);
    }

    const confession = await ctx.db.get(connect.confessionId);
    if (
      !confession ||
      confession.userId !== viewerId ||
      confession.userId !== connect.toUserId ||
      confession.taggedUserId !== connect.fromUserId
    ) {
      throw new Error('Connect request unavailable');
    }

    if (decision === 'connect' && connect.status === 'mutual') {
      const { conversationId, matchId } = await ensureMutualConfessionConversation(
        ctx,
        connect,
        confession,
        now
      );
      if (connect.conversationId !== conversationId) {
        await ctx.db.patch(connectId, {
          conversationId,
          updatedAt: now,
        });
      }
      await notifyConfessionConnectAccepted(ctx, {
        requesterUserId: connect.fromUserId,
        confessionId: connect.confessionId,
        connectId,
        conversationId,
        matchId,
        now,
      });
      const updated = await ctx.db.get(connectId);
      if (!updated) {
        throw new Error('Connect request unavailable');
      }
      return serializeConfessionConnect(updated);
    }
    if (decision === 'reject' && connect.status === 'rejected_by_to') {
      return serializeConfessionConnect(connect);
    }
    if (connect.status !== 'pending') {
      return serializeConfessionConnect(connect);
    }

    if (decision === 'reject') {
      if (!confessionIsConnectable(confession, now)) {
        throw new Error('Connect request unavailable');
      }
      if (!(await pairCanUseConfessionConnect(ctx, connect.fromUserId, connect.toUserId))) {
        throw new Error('Connect request unavailable');
      }
      await ctx.db.patch(connectId, {
        status: 'rejected_by_to',
        updatedAt: now,
        respondedAt: now,
      });
      const updated = await ctx.db.get(connectId);
      if (!updated) {
        throw new Error('Connect request unavailable');
      }
      return serializeConfessionConnect(updated);
    }

    const { conversationId, matchId } = await ensureMutualConfessionConversation(
      ctx,
      connect,
      confession,
      now,
      { beingMarkedMutual: true }
    );

    await ctx.db.patch(connectId, {
      status: 'mutual',
      conversationId,
      updatedAt: now,
      respondedAt: now,
    });

    await notifyConfessionConnectAccepted(ctx, {
      requesterUserId: connect.fromUserId,
      confessionId: connect.confessionId,
      connectId,
      conversationId,
      matchId,
      now,
    });

    const updated = await ctx.db.get(connectId);
    if (!updated) {
      throw new Error('Connect request unavailable');
    }
    return serializeConfessionConnect(updated);
  },
});

export const promoteConfessionConnectToConversation = mutation({
  args: {
    token: v.string(),
    connectId: v.id('confessionConnects'),
  },
  handler: async (ctx, { token, connectId }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      throw new Error('Connect request unavailable');
    }

    const connect = await ctx.db.get(connectId);
    if (
      !connect ||
      (connect.fromUserId !== viewerId && connect.toUserId !== viewerId) ||
      connect.status !== 'mutual'
    ) {
      throw new Error('Connect request unavailable');
    }

    const confession = await ctx.db.get(connect.confessionId);
    if (!confession) {
      throw new Error('Connect request unavailable');
    }

    const now = Date.now();
    const { conversationId } = await ensureMutualConfessionConversation(
      ctx,
      connect,
      confession,
      now
    );

    if (connect.conversationId !== conversationId) {
      await ctx.db.patch(connectId, {
        conversationId,
        updatedAt: now,
      });
    }

    const updated = await ctx.db.get(connectId);
    if (!updated) {
      throw new Error('Connect request unavailable');
    }
    return serializeConfessionConnect(updated);
  },
});

export const cancelConfessionConnect = mutation({
  args: {
    token: v.string(),
    connectId: v.id('confessionConnects'),
  },
  handler: async (ctx, { token, connectId }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      throw new Error('Connect request unavailable');
    }

    let connect = await ctx.db.get(connectId);
    if (!connect || connect.fromUserId !== viewerId) {
      throw new Error('Connect request unavailable');
    }

    const now = Date.now();
    connect = await patchExpiredConnectIfNeeded(ctx, connect, now);
    if (connect.status === 'expired' || connect.status === 'cancelled_by_from') {
      return serializeConfessionConnect(connect);
    }
    if (connect.status !== 'pending') {
      return serializeConfessionConnect(connect);
    }

    await ctx.db.patch(connectId, {
      status: 'cancelled_by_from',
      updatedAt: now,
      respondedAt: now,
    });

    const updated = await ctx.db.get(connectId);
    if (!updated) {
      throw new Error('Connect request unavailable');
    }
    return serializeConfessionConnect(updated);
  },
});

export const getConfessionConnectStatus = query({
  args: {
    token: v.string(),
    confessionId: v.id('confessions'),
  },
  handler: async (ctx, { token, confessionId }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      return emptyConfessionConnectStatus();
    }

    const confession = await ctx.db.get(confessionId);
    if (!confession) {
      return emptyConfessionConnectStatus();
    }

    const viewerRole: ConfessionConnectViewerRole | null =
      confession.taggedUserId === viewerId
        ? 'requester'
        : confession.userId === viewerId
          ? 'owner'
          : null;

    if (!viewerRole) {
      return emptyConfessionConnectStatus();
    }

    const now = Date.now();
    const existing = await getExistingConfessionConnect(ctx, confessionId);
    const effectiveStatus = existing
      ? getEffectiveConnectStatus(existing, now)
      : undefined;
    const pendingIsActive =
      existing !== null &&
      effectiveStatus === 'pending' &&
      existing.expiresAt > now;

    let canRequest = false;
    let canRespond = false;
    let canCancel = false;

    if (confession.taggedUserId) {
      const confessionAvailable = confessionIsConnectable(confession, now);
      const pairSafe = await pairCanUseConfessionConnect(
        ctx,
        confession.taggedUserId,
        confession.userId
      );

      canRequest =
        viewerRole === 'requester' &&
        !existing &&
        confessionAvailable &&
        pairSafe &&
        !(await hasViewerReportedConfession(ctx, viewerId, confessionId));

      canRespond =
        viewerRole === 'owner' &&
        pendingIsActive &&
        confessionAvailable &&
        pairSafe;

      canCancel = viewerRole === 'requester' && pendingIsActive;
    }

    if (!existing) {
      return {
        ...emptyConfessionConnectStatus(),
        viewerRole,
        canRequest,
      };
    }

    return {
      exists: true as const,
      connectId: existing._id,
      status: effectiveStatus,
      viewerRole,
      canRequest,
      canRespond,
      canCancel,
      expiresAt: existing.expiresAt,
      respondedAt: existing.respondedAt,
      conversationId: effectiveStatus === 'mutual' ? existing.conversationId : undefined,
    };
  },
});

export const listPendingConfessionConnectsForMe = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { token, limit }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      return [];
    }

    const now = Date.now();
    const boundedLimit = Math.max(
      1,
      Math.min(CONFESSION_CONNECT_LIST_LIMIT, limit ?? CONFESSION_CONNECT_LIST_LIMIT)
    );
    const rows = await ctx.db
      .query('confessionConnects')
      .withIndex('by_to_status', (q) =>
        q.eq('toUserId', viewerId).eq('status', 'pending')
      )
      .order('desc')
      .take(boundedLimit);

    const result: Array<{
      connectId: Id<'confessionConnects'>;
      confessionId: Id<'confessions'>;
      status: 'pending';
      createdAt: number;
      updatedAt: number;
      expiresAt: number;
      confessionText: string;
      confessionMood: Doc<'confessions'>['mood'];
      confessionCreatedAt: number;
    }> = [];

    for (const connect of rows) {
      if (connect.expiresAt <= now) continue;

      const confession = await ctx.db.get(connect.confessionId);
      if (
        !confession ||
        confession.userId !== viewerId ||
        confession.taggedUserId !== connect.fromUserId ||
        !confessionIsConnectable(confession, now)
      ) {
        continue;
      }

      if (!(await pairCanUseConfessionConnect(ctx, connect.fromUserId, connect.toUserId))) {
        continue;
      }

      result.push({
        connectId: connect._id,
        confessionId: connect.confessionId,
        status: 'pending',
        createdAt: connect.createdAt,
        updatedAt: connect.updatedAt,
        expiresAt: connect.expiresAt,
        confessionText: confession.text,
        confessionMood: confession.mood,
        confessionCreatedAt: confession.createdAt,
      });
    }

    return result;
  },
});

export const cleanupExpiredConfessionConnects = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const boundedLimit = Math.max(
      1,
      Math.min(CONFESSION_CONNECT_EXPIRY_CLEANUP_BATCH, limit ?? CONFESSION_CONNECT_EXPIRY_CLEANUP_BATCH)
    );
    const expiredPending = await ctx.db
      .query('confessionConnects')
      .withIndex('by_status_expires', (q) =>
        q.eq('status', 'pending').lte('expiresAt', now)
      )
      .take(boundedLimit);

    let expired = 0;
    for (const connect of expiredPending) {
      if (connect.status !== 'pending' || connect.expiresAt > now) continue;
      await ctx.db.patch(connect._id, {
        status: 'expired',
        updatedAt: now,
      });
      expired += 1;
    }

    return { expired };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Get or create a conversation for an anonymous confession reply
// This unifies confession chats with the Messages system
// ═══════════════════════════════════════════════════════════════════════════
export const getOrCreateForConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Get the confession to find the author
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found');
    }

    const authorId = confession.userId;

    // Prevent self-chat
    if (userId === authorId) {
      throw new Error('Cannot start a chat with yourself');
    }

    // Look for existing conversation for this confession between these users
    const existingConversations = await ctx.db
      .query('conversations')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // Find one where both users are participants
    const existingConvo = existingConversations.find(
      (c) => c.participants.includes(userId) && c.participants.includes(authorId)
    );

    if (existingConvo) {
      return { conversationId: existingConvo._id, isNew: false };
    }

    // Create new conversation
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const conversationId = await ctx.db.insert('conversations', {
      confessionId: args.confessionId,
      participants: [userId, authorId],
      isPreMatch: true,
      createdAt: now,
      lastMessageAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS,
      // PRIVACY FIX: Mark confession author as anonymous participant if confession is anonymous
      // Their real identity should not be revealed to the replying user
      anonymousParticipantId: confession.isAnonymous ? authorId : undefined,
    });

    // Create participant junction rows for efficient queries
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      userId,
      unreadCount: 0,
    });
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      userId: authorId,
      unreadCount: 0,
    });

    return { conversationId, isNew: true };
  },
});

// Delete own confession (soft delete via isDeleted flag)
// Only the author can delete their own confession
export const deleteConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }
    if (confession.userId !== userId) {
      throw new Error('You can only delete your own confessions.');
    }

    // Soft delete: mark as deleted rather than hard delete
    // This preserves referential integrity with replies, reactions, conversations
    await ctx.db.patch(args.confessionId, {
      isDeleted: true,
      deletedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update own confession (text and mood only)
// Only the author can edit their own confession, and only if not deleted
export const updateConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }
    if (confession.userId !== userId) {
      throw new Error('You can only edit your own confessions.');
    }
    if (confession.isDeleted) {
      throw new Error('Cannot edit a deleted confession.');
    }

    // Validate text
    const trimmedText = args.text.trim();
    if (trimmedText.length < 1) {
      throw new Error('Confession cannot be empty.');
    }
    if (trimmedText.length > 500) {
      throw new Error('Confession exceeds 500 character limit.');
    }
    if (PHONE_PATTERN.test(trimmedText)) {
      throw new Error('Do not include phone numbers.');
    }
    if (EMAIL_PATTERN.test(trimmedText)) {
      throw new Error('Do not include email addresses.');
    }

    // Update only text and mood (preserves original author info, anonymity, etc.)
    await ctx.db.patch(args.confessionId, {
      text: trimmedText,
      mood: args.mood,
    });

    return { success: true };
  },
});
