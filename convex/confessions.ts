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

// Phase-1 Confess length rules.
// Keep these in sync with lib/confessionLimits.ts on the client so frontend
// and backend agree on validation.
const MIN_CONFESSION_LENGTH = 20;
const MAX_CONFESSION_LENGTH = 800;
const MAX_CONFESSION_REPLY_LENGTH = 500;
const MIN_CONFESSION_VOICE_REPLY_DURATION_SEC = 1;
const MAX_CONFESSION_VOICE_REPLY_DURATION_SEC = 120;
const MAX_CONFESSION_VOICE_URL_LENGTH = 2048;
const CONFESSION_MIN_LENGTH_MESSAGE =
  `Write at least ${MIN_CONFESSION_LENGTH} characters to post.`;
const CONFESSION_MAX_LENGTH_MESSAGE =
  `Confession must be ${MAX_CONFESSION_LENGTH} characters or less.`;
const CONFESSION_REPLY_MAX_LENGTH_MESSAGE =
  `Reply must be ${MAX_CONFESSION_REPLY_LENGTH} characters or less.`;
const CONFESSION_REACTION_TYPES = ['👍', '❤️', '😂', '😮', '😢'] as const;
const CONFESSION_ALLOWED_REACTIONS = new Set<string>(CONFESSION_REACTION_TYPES);
const CONFESSION_REACTION_RATE_LIMIT_MAX = 30;
const CONFESSION_REACTION_RATE_WINDOW_MS = 60 * 1000;
const CONFESSION_REACTION_RATE_CLEANUP_BATCH = 50;
const CONFESSION_UNAVAILABLE = 'This confession is no longer available.';
const INVALID_REACTION = 'INVALID_REACTION';
const REACTION_RATE_LIMITED = 'REACTION_RATE_LIMITED';
const CONFESSION_FEED_CANDIDATE_LIMIT = 100;
const CONFESSION_FEED_RETURN_LIMIT = 50;
const CONFESSION_TRENDING_CANDIDATE_LIMIT = 120;
const CONFESSION_REPLY_PREVIEW_SCAN_LIMIT = 12;
const CONFESSION_REACTION_PREVIEW_SCAN_LIMIT = 100;

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
  | 'confession_connect_accepted'
  | 'confession_connect_rejected';
type ConfessionEngagementNotificationType =
  | 'confession_reply'
  | 'confession_reaction';
type ConfessionConnectIneligibleReason =
  | 'self'
  | 'user_ineligible'
  | 'blocked'
  | 'reported'
  | 'already_matched'
  | 'already_conversing';
type ConfessionConnectEligibility =
  | { ok: true }
  | {
      ok: false;
      reason: ConfessionConnectIneligibleReason;
      matchId?: Id<'matches'>;
      conversationId?: Id<'conversations'>;
    };

// Canonical reply identity mode used by the current product contract.
// Legacy 'blur' literal maps to 'blur_photo'; unknown/missing maps using isAnonymous.
type ReplyIdentityMode = 'anonymous' | 'blur_photo' | 'open';
type ConfessionAuthorSnapshot = {
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
};

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

function calculateConfessionAuthorAge(dateOfBirth: string | undefined): number | undefined {
  if (!dateOfBirth) return undefined;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return undefined;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return Number.isFinite(age) && age >= 18 && age < 120 ? age : undefined;
}

async function pickConfessionAuthorPhoto(
  ctx: Parameters<typeof validateSessionToken>[0],
  user: Doc<'users'>
): Promise<string | undefined> {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .collect();

  const safePhotos = photos
    .filter((photo) =>
      photo.photoType !== 'verification_reference' &&
      photo.isNsfw !== true &&
      photo.moderationStatus !== 'flagged'
    )
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      return a.createdAt - b.createdAt;
    });

  const photoFromTable = safePhotos[0]?.url;
  return photoFromTable;
}

async function buildConfessionAuthorSnapshot(
  ctx: Parameters<typeof validateSessionToken>[0],
  userId: Id<'users'>,
  visibility: ConfessionAuthorVisibility | ReplyIdentityMode
): Promise<ConfessionAuthorSnapshot> {
  if (visibility === 'anonymous') return {};

  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  return {
    authorName: user.name.trim().slice(0, 64),
    authorPhotoUrl: await pickConfessionAuthorPhoto(ctx, user),
    authorAge: user.hideAge === true
      ? undefined
      : calculateConfessionAuthorAge(user.dateOfBirth),
    authorGender: user.gender,
  };
}

// Build a map of userId -> current safe Confess author photo. This deliberately
// uses the same picker as write-time snapshots rather than trusting
// users.primaryPhotoUrl, because Confess must never surface verification,
// flagged, or NSFW photos.
async function buildLivePrimaryPhotoMapForUserIds(
  ctx: Parameters<typeof validateSessionToken>[0],
  userIds: Iterable<Id<'users'>>
): Promise<Map<string, string | undefined>> {
  const map = new Map<string, string | undefined>();
  for (const id of userIds) {
    const key = String(id);
    if (map.has(key)) continue;
    const userDoc = await ctx.db.get(id);
    map.set(key, userDoc ? await pickConfessionAuthorPhoto(ctx, userDoc) : undefined);
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
    // Photo: only use the live safe Confess photo map. Historical stored
    // snapshots may predate the safe picker, so they are never a display
    // fallback.
    base.authorPhotoUrl = options?.livePhotoUrlByUserId?.get(String(reply.userId));
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
  //   open / blur_photo -> return the live safe Confess photo when the caller
  //                       pre-fetched the map. The client decides whether to
  //                       blur it based on `authorVisibility`.
  // Historical stored snapshots may predate the safe picker, so the serializer
  // never falls back to persisted authorPhotoUrl.
  const resolvedAuthorPhotoUrl: string | undefined = isAnonymousMode
    ? undefined
    : options?.livePhotoUrlByUserId?.get(String(confession.userId));

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

function isAllowedConfessionReaction(type: string): boolean {
  return CONFESSION_ALLOWED_REACTIONS.has(type);
}

function validateConfessionReplyText(trimmed: string): void {
  if (trimmed.length < 1) {
    throw new Error('Reply cannot be empty.');
  }
  if (trimmed.length > MAX_CONFESSION_REPLY_LENGTH) {
    throw new Error(CONFESSION_REPLY_MAX_LENGTH_MESSAGE);
  }
  if (PHONE_PATTERN.test(trimmed)) {
    throw new Error('Do not include phone numbers.');
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    throw new Error('Do not include email addresses.');
  }
}

function validateOptionalConfessionReplyCaption(trimmed: string): void {
  if (trimmed.length > MAX_CONFESSION_REPLY_LENGTH) {
    throw new Error(CONFESSION_REPLY_MAX_LENGTH_MESSAGE);
  }
  if (trimmed.length > 0 && PHONE_PATTERN.test(trimmed)) {
    throw new Error('Do not include phone numbers.');
  }
  if (trimmed.length > 0 && EMAIL_PATTERN.test(trimmed)) {
    throw new Error('Do not include email addresses.');
  }
}

function normalizeConfessionVoiceUrl(voiceUrl: string | undefined): string {
  const trimmed = voiceUrl?.trim() ?? '';
  if (
    trimmed.length < 1 ||
    trimmed.length > MAX_CONFESSION_VOICE_URL_LENGTH ||
    !trimmed.startsWith('https://') ||
    /\s/.test(trimmed)
  ) {
    throw new Error('Invalid voice reply URL.');
  }
  return trimmed;
}

function normalizeConfessionVoiceDuration(durationSec: number | undefined): number {
  if (
    typeof durationSec !== 'number' ||
    !Number.isFinite(durationSec) ||
    durationSec < MIN_CONFESSION_VOICE_REPLY_DURATION_SEC ||
    durationSec > MAX_CONFESSION_VOICE_REPLY_DURATION_SEC
  ) {
    throw new Error(
      `Voice reply duration must be between ${MIN_CONFESSION_VOICE_REPLY_DURATION_SEC} and ${MAX_CONFESSION_VOICE_REPLY_DURATION_SEC} seconds.`
    );
  }
  return durationSec;
}

function normalizeConfessionReplyPayload(args: {
  type?: 'text' | 'voice';
  text: string;
  voiceUrl?: string;
  voiceDurationSec?: number;
}): {
  replyType: 'text' | 'voice';
  text: string;
  voiceUrl?: string;
  voiceDurationSec?: number;
} {
  const replyType = args.type || 'text';
  const trimmed = args.text.trim();

  if (replyType === 'text') {
    if (args.voiceUrl !== undefined || args.voiceDurationSec !== undefined) {
      throw new Error('Voice fields are only allowed for voice replies.');
    }
    validateConfessionReplyText(trimmed);
    return { replyType, text: trimmed };
  }

  validateOptionalConfessionReplyCaption(trimmed);
  return {
    replyType,
    text: trimmed || 'Voice reply',
    voiceUrl: normalizeConfessionVoiceUrl(args.voiceUrl),
    voiceDurationSec: normalizeConfessionVoiceDuration(args.voiceDurationSec),
  };
}

function isConfessVisibleUser(user: Doc<'users'> | null | undefined): user is Doc<'users'> {
  return !!user && user.isActive === true && user.isBanned !== true && !user.deletedAt;
}

function isConfessionActive(
  confession: Doc<'confessions'> | null | undefined,
  now: number
): confession is Doc<'confessions'> {
  return (
    !!confession &&
    confession.isDeleted !== true &&
    !confession.deletedAt &&
    (confession.expiresAt === undefined || confession.expiresAt > now)
  );
}

async function resolveConfessionReadViewer(
  ctx: Parameters<typeof validateSessionToken>[0],
  token?: string,
  claimedViewerId?: Id<'users'> | string
): Promise<Id<'users'> | null> {
  const viewerId = await getValidatedViewerFromToken(ctx, token);
  if (!viewerId) return null;

  if (claimedViewerId) {
    const claimedUserId = await resolveUserIdByAuthId(ctx, claimedViewerId as string);
    if (!claimedUserId || claimedUserId !== viewerId) {
      return null;
    }
  }

  return viewerId;
}

async function canViewerSeeConfession(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'> | null,
  confession: Doc<'confessions'> | null | undefined,
  options?: {
    now?: number;
    reportedConfessionIds?: Set<string>;
    requireNormalModeration?: boolean;
  }
): Promise<boolean> {
  const now = options?.now ?? Date.now();
  if (!isConfessionActive(confession, now)) return false;

  const author = await ctx.db.get(confession.userId);
  if (!isConfessVisibleUser(author)) return false;

  const viewerIsOwner = !!viewerId && viewerId === confession.userId;
  const moderationStatus = getConfessionModerationStatus(confession);
  if (options?.requireNormalModeration && moderationStatus !== 'normal') {
    return false;
  }
  if (moderationStatus === 'hidden_by_reports' && !viewerIsOwner) {
    return false;
  }

  if (!viewerId) return false;

  const viewer = viewerIsOwner ? author : await ctx.db.get(viewerId);
  if (!isConfessVisibleUser(viewer)) return false;

  if (!viewerIsOwner) {
    if (options?.reportedConfessionIds?.has(String(confession._id))) {
      return false;
    }
    if (
      !options?.reportedConfessionIds &&
      (await hasViewerReportedConfession(ctx, viewerId, confession._id))
    ) {
      return false;
    }
    if (await hasBlockBetweenUsers(ctx, viewerId, confession.userId)) {
      return false;
    }
  }

  return true;
}

async function requireConfessionMutationParent(
  ctx: Parameters<typeof validateSessionToken>[0],
  actorId: Id<'users'>,
  confessionId: Id<'confessions'>,
  now: number
): Promise<Doc<'confessions'>> {
  const confession = await ctx.db.get(confessionId);
  if (!confession) {
    throw new Error(CONFESSION_UNAVAILABLE);
  }
  if (
    !(await canViewerSeeConfession(ctx, actorId, confession, {
      now,
      requireNormalModeration: true,
    }))
  ) {
    throw new Error(CONFESSION_UNAVAILABLE);
  }
  return confession;
}

async function reserveConfessionReactionToggle(
  ctx: MutationCtx,
  confessionId: Id<'confessions'>,
  userId: Id<'users'>,
  now: number
): Promise<void> {
  const windowStart = now - CONFESSION_REACTION_RATE_WINDOW_MS;
  const staleEvents = await ctx.db
    .query('confessionReactionRateEvents')
    .withIndex('by_confession_user_created', (q) =>
      q.eq('confessionId', confessionId).eq('userId', userId).lt('createdAt', windowStart)
    )
    .take(CONFESSION_REACTION_RATE_CLEANUP_BATCH);

  for (const event of staleEvents) {
    await ctx.db.delete(event._id);
  }

  const recentEvents = await ctx.db
    .query('confessionReactionRateEvents')
    .withIndex('by_confession_user_created', (q) =>
      q.eq('confessionId', confessionId).eq('userId', userId).gte('createdAt', windowStart)
    )
    .take(CONFESSION_REACTION_RATE_LIMIT_MAX);

  if (recentEvents.length >= CONFESSION_REACTION_RATE_LIMIT_MAX) {
    throw new Error(REACTION_RATE_LIMITED);
  }

  await ctx.db.insert('confessionReactionRateEvents', {
    confessionId,
    userId,
    createdAt: now,
  });
}

async function filterVisibleConfessions(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'> | null,
  rows: Doc<'confessions'>[],
  options?: {
    now?: number;
    reportedConfessionIds?: Set<string>;
    requireNormalModeration?: boolean;
  }
): Promise<Doc<'confessions'>[]> {
  const visible: Doc<'confessions'>[] = [];
  for (const confession of rows) {
    if (await canViewerSeeConfession(ctx, viewerId, confession, options)) {
      visible.push(confession);
    }
  }
  return visible;
}

async function filterVisibleReplies(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'> | null,
  rows: Doc<'confessionReplies'>[]
): Promise<Doc<'confessionReplies'>[]> {
  if (!viewerId) return [];

  const viewer = await ctx.db.get(viewerId);
  if (!isConfessVisibleUser(viewer)) return [];

  const visible: Doc<'confessionReplies'>[] = [];
  for (const reply of rows) {
    const author = await ctx.db.get(reply.userId);
    if (!isConfessVisibleUser(author)) continue;
    if (viewerId !== reply.userId && (await hasBlockBetweenUsers(ctx, viewerId, reply.userId))) {
      continue;
    }
    visible.push(reply);
  }
  return visible;
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
    ineligibleReason: undefined as ConfessionConnectIneligibleReason | undefined,
    existingConversationId: undefined as Id<'conversations'> | undefined,
    existingMatchId: undefined as Id<'matches'> | undefined,
  };
}

const CONFESSION_UNAUTHORIZED = 'UNAUTHORIZED';

async function requireConfessionMutationActor(
  ctx: Parameters<typeof validateSessionToken>[0],
  token: string,
  claimedActorId: Id<'users'> | string
): Promise<Id<'users'>> {
  const sessionToken = token.trim();
  if (!sessionToken) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  const authenticatedUserId = await validateSessionToken(ctx, sessionToken);
  if (!authenticatedUserId) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  const claimedUserId = await resolveUserIdByAuthId(ctx, claimedActorId as string);
  if (!claimedUserId || claimedUserId !== authenticatedUserId) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  return authenticatedUserId;
}

async function requireConfessionReadViewer(
  ctx: Parameters<typeof validateSessionToken>[0],
  token: string,
  claimedViewerId: Id<'users'> | string
): Promise<Id<'users'>> {
  const sessionToken = token.trim();
  if (!sessionToken) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  const authenticatedUserId = await validateSessionToken(ctx, sessionToken);
  if (!authenticatedUserId) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  const claimedUserId = await resolveUserIdByAuthId(ctx, claimedViewerId as string);
  if (!claimedUserId || claimedUserId !== authenticatedUserId) {
    throw new Error(CONFESSION_UNAUTHORIZED);
  }

  return authenticatedUserId;
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

function getConnectPartnerUserId(
  connect: Doc<'confessionConnects'>,
  viewerId?: Id<'users'>
): Id<'users'> | undefined {
  if (!viewerId) return undefined;
  if (connect.fromUserId === viewerId) return connect.toUserId;
  if (connect.toUserId === viewerId) return connect.fromUserId;
  return undefined;
}

function serializeConfessionConnect(
  connect: Doc<'confessionConnects'>,
  options?: {
    viewerId?: Id<'users'>;
    matchId?: Id<'matches'>;
  }
) {
  const promoted = connect.status === 'mutual' && !!connect.conversationId;
  const partnerUserId =
    connect.status === 'mutual'
      ? getConnectPartnerUserId(connect, options?.viewerId)
      : undefined;
  return {
    connectId: connect._id,
    confessionId: connect.confessionId,
    status: connect.status,
    expiresAt: connect.expiresAt,
    respondedAt: connect.respondedAt,
    conversationId: connect.conversationId,
    matchId: options?.matchId,
    otherUserId: partnerUserId,
    partnerUserId,
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
  return isConfessVisibleUser(user);
}

async function findActivePhase1MatchForPair(
  ctx: Parameters<typeof validateSessionToken>[0],
  userAId: Id<'users'>,
  userBId: Id<'users'>
): Promise<Doc<'matches'> | null> {
  const [forward, reverse] = await Promise.all([
    ctx.db
      .query('matches')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', userAId).eq('user2Id', userBId)
      )
      .collect(),
    ctx.db
      .query('matches')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', userBId).eq('user2Id', userAId)
      )
      .collect(),
  ]);

  const seen = new Set<string>();
  const activeMatches = [...forward, ...reverse].filter((match) => {
    const key = String(match._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return match.isActive === true;
  });
  activeMatches.sort((a, b) => a._id.localeCompare(b._id));
  return activeMatches[0] ?? null;
}

function isActivePhase1ConversationForPair(
  conversation: Doc<'conversations'>,
  userAId: Id<'users'>,
  userBId: Id<'users'>,
  now: number
): boolean {
  if (conversation.isPreMatch === true) return false;
  if (conversation.expiresAt !== undefined && conversation.expiresAt <= now) {
    return false;
  }
  if (conversation.participants.length !== 2) return false;
  const participants = new Set(conversation.participants.map(String));
  return participants.has(String(userAId)) && participants.has(String(userBId));
}

async function findActivePhase1ConversationForPair(
  ctx: Parameters<typeof validateSessionToken>[0],
  userAId: Id<'users'>,
  userBId: Id<'users'>,
  now: number
): Promise<Doc<'conversations'> | null> {
  const participantRows = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_user', (q) => q.eq('userId', userAId))
    .collect();

  const conversations: Doc<'conversations'>[] = [];
  for (const participantRow of participantRows) {
    const conversation = await ctx.db.get(participantRow.conversationId);
    if (
      conversation &&
      isActivePhase1ConversationForPair(conversation, userAId, userBId, now)
    ) {
      if (conversation.matchId) {
        const match = await ctx.db.get(conversation.matchId);
        if (!match || match.isActive !== true) {
          continue;
        }
      }
      conversations.push(conversation);
    }
  }

  conversations.sort((a, b) => {
    const aTime = a.lastMessageAt ?? a.createdAt;
    const bTime = b.lastMessageAt ?? b.createdAt;
    return bTime - aTime;
  });
  return conversations[0] ?? null;
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
  return isConfessionActive(confession, now) && !isHiddenByReports(confession);
}

async function evaluateConfessionConnectEligibility(
  ctx: Parameters<typeof validateSessionToken>[0],
  requesterId: Id<'users'>,
  ownerId: Id<'users'>,
  options?: { skipConnectedCheck?: boolean }
): Promise<ConfessionConnectEligibility> {
  if (requesterId === ownerId) return { ok: false, reason: 'self' };

  const requester = await ctx.db.get(requesterId);
  const owner = await ctx.db.get(ownerId);
  if (!userIsConnectEligible(requester) || !userIsConnectEligible(owner)) {
    return { ok: false, reason: 'user_ineligible' };
  }

  if (await hasBlockBetweenUsers(ctx, requesterId, ownerId)) {
    return { ok: false, reason: 'blocked' };
  }
  if (await hasReportBetweenUsers(ctx, requesterId, ownerId)) {
    return { ok: false, reason: 'reported' };
  }

  if (options?.skipConnectedCheck === true) {
    return { ok: true };
  }

  const existingMatch = await findActivePhase1MatchForPair(
    ctx,
    requesterId,
    ownerId
  );
  if (existingMatch) {
    const existingConversation = await findActivePhase1ConversationForPair(
      ctx,
      requesterId,
      ownerId,
      Date.now()
    );
    return {
      ok: false,
      reason: 'already_matched',
      matchId: existingMatch._id,
      conversationId: existingConversation?._id,
    };
  }

  const existingConversation = await findActivePhase1ConversationForPair(
    ctx,
    requesterId,
    ownerId,
    Date.now()
  );
  if (existingConversation) {
    return {
      ok: false,
      reason: 'already_conversing',
      conversationId: existingConversation._id,
      matchId: existingConversation.matchId,
    };
  }

  return { ok: true };
}

async function pairCanUseConfessionConnect(
  ctx: Parameters<typeof validateSessionToken>[0],
  requesterId: Id<'users'>,
  ownerId: Id<'users'>,
  options?: { skipConnectedCheck?: boolean }
): Promise<boolean> {
  const eligibility = await evaluateConfessionConnectEligibility(
    ctx,
    requesterId,
    ownerId,
    options
  );
  return eligibility.ok;
}

async function canViewerUseConfessionTaggedProfile(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'>,
  confession: Doc<'confessions'> | null,
  profileUserId: Id<'users'>,
  options?: {
    now?: number;
    requireTaggedRecipient?: boolean;
    disallowAuthor?: boolean;
  }
): Promise<boolean> {
  const now = options?.now ?? Date.now();
  if (
    !(await canViewerSeeConfession(ctx, viewerId, confession, {
      now,
      requireNormalModeration: true,
    }))
  ) {
    return false;
  }

  if (!confession?.taggedUserId || confession.taggedUserId !== profileUserId) {
    return false;
  }

  if (options?.requireTaggedRecipient === true && confession.taggedUserId !== viewerId) {
    return false;
  }

  if (options?.disallowAuthor === true && confession.userId === viewerId) {
    return false;
  }

  const target = await ctx.db.get(profileUserId);
  if (!isConfessVisibleUser(target)) return false;

  if (viewerId !== profileUserId) {
    if (await hasBlockBetweenUsers(ctx, viewerId, profileUserId)) return false;
    if (await hasReportBetweenUsers(ctx, viewerId, profileUserId)) return false;
  }

  return true;
}

async function countTaggedConfessionBadgeForViewer(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'>
): Promise<number> {
  const now = Date.now();
  const reportedIds = await getReportedConfessionIdsForViewer(ctx, viewerId);
  const notifications = await ctx.db
    .query('confessionNotifications')
    .withIndex('by_user_seen', (q) => q.eq('userId', viewerId).eq('seen', false))
    .collect();

  let count = 0;
  for (const notification of notifications) {
    const confession = await ctx.db.get(notification.confessionId);
    if (
      await canViewerSeeConfession(ctx, viewerId, confession, {
        now,
        reportedConfessionIds: reportedIds,
      })
    ) {
      count += 1;
    }
  }
  return count;
}

async function countPendingConfessionConnectRequestsForViewer(
  ctx: Parameters<typeof validateSessionToken>[0],
  viewerId: Id<'users'>,
  now: number
): Promise<number> {
  const rows = await ctx.db
    .query('confessionConnects')
    .withIndex('by_to_status', (q) =>
      q.eq('toUserId', viewerId).eq('status', 'pending')
    )
    .order('desc')
    .take(CONFESSION_CONNECT_LIST_LIMIT);

  let count = 0;
  for (const connect of rows) {
    if (connect.expiresAt <= now || connect.seenByOwnerAt !== undefined) continue;

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

    count += 1;
  }

  return count;
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
      otherUserId?: string;
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

async function upsertConfessionEngagementNotification(
  ctx: MutationCtx,
  args: {
    confession: Doc<'confessions'>;
    actorId: Id<'users'>;
    type: ConfessionEngagementNotificationType;
    now: number;
  }
): Promise<void> {
  if (args.confession.userId === args.actorId) return;

  if (
    !(await canViewerSeeConfession(ctx, args.actorId, args.confession, {
      now: args.now,
      requireNormalModeration: true,
    }))
  ) {
    return;
  }

  const [author, actor] = await Promise.all([
    ctx.db.get(args.confession.userId),
    ctx.db.get(args.actorId),
  ]);
  if (!isConfessVisibleUser(author) || !isConfessVisibleUser(actor)) return;
  if (author.notificationsEnabled === false) return;

  const title = 'Confess';
  const body =
    args.type === 'confession_reply'
      ? 'Someone replied to your confession.'
      : 'Someone reacted to your confession.';
  const data = {
    confessionId: String(args.confession._id),
    fromUserId: String(args.actorId),
    source: 'confession',
  };
  const dedupeBucket = Math.floor(args.now / (60 * 1000));
  const dedupeKey = `${args.type}:${args.confession._id}:${args.actorId}:${dedupeBucket}`;
  const expiresAt = args.now + 24 * 60 * 60 * 1000;

  const existing = await ctx.db
    .query('notifications')
    .withIndex('by_user_dedupe', (q) =>
      q.eq('userId', args.confession.userId).eq('dedupeKey', dedupeKey)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      type: args.type,
      title,
      body,
      data,
      phase: 'phase1',
      createdAt: args.now,
      expiresAt,
      readAt: undefined,
    });
    return;
  }

  await ctx.db.insert('notifications', {
    userId: args.confession.userId,
    type: args.type,
    title,
    body,
    data,
    phase: 'phase1',
    dedupeKey,
    createdAt: args.now,
    expiresAt,
  });
}

async function deletePhase1NotificationsForConfession(
  ctx: MutationCtx,
  confessionId: Id<'confessions'>,
  recipientIds: Set<string>
): Promise<void> {
  const confessionIdString = String(confessionId);
  for (const recipientId of recipientIds) {
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', recipientId as Id<'users'>))
      .collect();

    for (const notification of notifications) {
      const isConfessRow =
        notification.phase === 'phase1' ||
        notification.type === 'tagged_confession' ||
        notification.type.startsWith('confession_');
      if (isConfessRow && notification.data?.confessionId === confessionIdString) {
        await ctx.db.delete(notification._id);
      }
    }
  }
}

async function cleanupDeletedConfessionChildren(
  ctx: MutationCtx,
  confession: Doc<'confessions'>,
  now: number
): Promise<void> {
  const recipientIds = new Set<string>([String(confession.userId)]);
  if (confession.taggedUserId) {
    recipientIds.add(String(confession.taggedUserId));
  }

  const connects = await ctx.db
    .query('confessionConnects')
    .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
    .collect();
  for (const connect of connects) {
    recipientIds.add(String(connect.fromUserId));
    recipientIds.add(String(connect.toUserId));
    if (connect.status === 'pending') {
      await ctx.db.patch(connect._id, {
        status: 'expired',
        updatedAt: now,
        respondedAt: now,
      });
    }
  }

  const taggedNotifications = await ctx.db
    .query('confessionNotifications')
    .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
    .collect();
  for (const notification of taggedNotifications) {
    recipientIds.add(String(notification.userId));
    await ctx.db.delete(notification._id);
  }

  const replies = await ctx.db
    .query('confessionReplies')
    .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
    .collect();
  for (const reply of replies) {
    await ctx.db.delete(reply._id);
  }

  const reactions = await ctx.db
    .query('confessionReactions')
    .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
    .collect();
  for (const reaction of reactions) {
    await ctx.db.delete(reaction._id);
  }

  const rateEvents = await ctx.db
    .query('confessionReactionRateEvents')
    .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
    .collect();
  for (const event of rateEvents) {
    await ctx.db.delete(event._id);
  }

  const profileViewGrants = await ctx.db
    .query('confessionTagProfileViews')
    .withIndex('by_confession', (q) => q.eq('confessionId', confession._id))
    .collect();
  for (const grant of profileViewGrants) {
    await ctx.db.delete(grant._id);
  }

  await deletePhase1NotificationsForConfession(ctx, confession._id, recipientIds);
}

async function markConfessionConnectRequestNotificationRead(
  ctx: MutationCtx,
  args: {
    ownerUserId: Id<'users'>;
    connectId: Id<'confessionConnects'>;
    now: number;
    expire?: boolean;
  }
): Promise<void> {
  const notification = await ctx.db
    .query('notifications')
    .withIndex('by_user_dedupe', (q) =>
      q
        .eq('userId', args.ownerUserId)
        .eq('dedupeKey', `confession_connect_requested:${args.connectId}`)
    )
    .first();

  if (!notification) return;

  await ctx.db.patch(notification._id, {
    readAt: notification.readAt ?? args.now,
    ...(args.expire ? { expiresAt: args.now } : {}),
  });
}

async function closeRedundantConfessionConnect(
  ctx: MutationCtx,
  connect: Doc<'confessionConnects'>,
  now: number
): Promise<Doc<'confessionConnects'>> {
  if (connect.status !== 'pending') {
    return connect;
  }

  await ctx.db.patch(connect._id, {
    status: 'expired',
    updatedAt: now,
    respondedAt: now,
  });
  await markConfessionConnectRequestNotificationRead(ctx, {
    ownerUserId: connect.toUserId,
    connectId: connect._id,
    now,
    expire: true,
  });

  return {
    ...connect,
    status: 'expired',
    updatedAt: now,
    respondedAt: now,
  };
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

async function notifyConfessionConnectRejected(
  ctx: MutationCtx,
  args: {
    requesterUserId: Id<'users'>;
    confessionId: Id<'confessions'>;
    connectId: Id<'confessionConnects'>;
    now: number;
  }
): Promise<void> {
  await upsertConfessionConnectNotification(ctx, {
    userId: args.requesterUserId,
    type: 'confession_connect_rejected',
    title: 'Connect request declined',
    body: 'Your connect request was declined.',
    data: {
      confessionId: String(args.confessionId),
      connectId: String(args.connectId),
      source: 'confession',
    },
    dedupeKey: `confession_connect_rejected:${args.connectId}`,
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
    otherUserId: Id<'users'>;
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
      otherUserId: String(args.otherUserId),
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
  if (confession.isDeleted || confession.deletedAt || isHiddenByReports(confession)) return false;

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
  const eligibility = await evaluateConfessionConnectEligibility(
    ctx,
    connect.fromUserId,
    connect.toUserId
  );
  if (!eligibility.ok) {
    if (
      !beingMarkedMutual &&
      connect.status === 'mutual' &&
      (eligibility.reason === 'already_matched' ||
        eligibility.reason === 'already_conversing') &&
      eligibility.conversationId &&
      eligibility.matchId
    ) {
      return {
        conversationId: eligibility.conversationId,
        matchId: eligibility.matchId,
      };
    }
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
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    authorVisibility: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur_photo'))),
    imageUrl: v.optional(v.string()),
    // Legacy compatibility: accepted but ignored. Author snapshots are
    // server-derived from the token-bound actor.
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
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

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
    if (trimmed.length < MIN_CONFESSION_LENGTH) {
      throw new Error(CONFESSION_MIN_LENGTH_MESSAGE);
    }
    // P2-1 FIX: Add max length validation to prevent DoS/database bloat
    if (trimmed.length > MAX_CONFESSION_LENGTH) {
      throw new Error(CONFESSION_MAX_LENGTH_MESSAGE);
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

    const effectiveVisibility = effectiveConfessionAuthorVisibility(
      args.authorVisibility,
      args.isAnonymous
    );
    const authorSnapshot = await buildConfessionAuthorSnapshot(
      ctx,
      userId,
      effectiveVisibility
    );

    const confessionId = await ctx.db.insert('confessions', {
      userId: userId,
      text: trimmed,
      isAnonymous: effectiveVisibility === 'anonymous',
      authorVisibility: effectiveVisibility,
      mood: args.mood,
      visibility: args.visibility,
      imageUrl: args.imageUrl,
      authorName: authorSnapshot.authorName,
      authorPhotoUrl: authorSnapshot.authorPhotoUrl,
      authorAge: authorSnapshot.authorAge,
      authorGender: authorSnapshot.authorGender,
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
    token: v.optional(v.string()),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, { sortBy, token, viewerId }) => {
    const now = Date.now();
    const resolvedViewerId = await resolveConfessionReadViewer(ctx, token, viewerId);
    if (!resolvedViewerId) return [];

    const candidateConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .take(CONFESSION_FEED_CANDIDATE_LIMIT);

    const reportedIds = await getReportedConfessionIdsForViewer(ctx, resolvedViewerId);
    let confessions = await filterVisibleConfessions(ctx, resolvedViewerId, candidateConfessions, {
      now,
      reportedConfessionIds: reportedIds,
      requireNormalModeration: sortBy === 'trending',
    });

    if (sortBy === 'trending') {
      // Improved trending scoring with time decay.
      // Replies are strongest signal (weight 5), reactions medium (weight 2).
      confessions = [...confessions].sort((a, b) => {
        const hoursSinceA = (now - a.createdAt) / (1000 * 60 * 60);
        const hoursSinceB = (now - b.createdAt) / (1000 * 60 * 60);
        const scoreA = (a.replyCount * 5 + a.reactionCount * 2) / (hoursSinceA + 2);
        const scoreB = (b.replyCount * 5 + b.reactionCount * 2) / (hoursSinceB + 2);
        return scoreB - scoreA;
      });
    }

    const visibleConfessions = confessions.slice(0, CONFESSION_FEED_RETURN_LIMIT);

    // Pre-fetch live safe Confess photos for all unique authors so the feed
    // reflects current profile ordering without trusting raw user photo URLs.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      visibleConfessions.map((c) => c.userId)
    );

    // Attach 2 reply previews per confession
    const withPreviews = await Promise.all(
      visibleConfessions.map(async (c) => {
        const replies = await ctx.db
          .query('confessionReplies')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .order('asc')
          .take(CONFESSION_REPLY_PREVIEW_SCAN_LIMIT);
        const visibleReplies = await filterVisibleReplies(ctx, resolvedViewerId, replies);

        // Get top 3 emoji reactions for display
        const allReactions = await ctx.db
          .query('confessionReactions')
          .withIndex('by_confession', (q) => q.eq('confessionId', c._id))
          .take(CONFESSION_REACTION_PREVIEW_SCAN_LIMIT);
        const emojiCounts: Record<string, number> = {};
        for (const r of allReactions) {
          // Skip legacy/non-Confess reaction keys.
          if (!isAllowedConfessionReaction(r.type)) continue;
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
          replyPreviews: visibleReplies.slice(0, 2).map((r) => ({
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

    return withPreviews;
  },
});

// Get trending confessions (last 48h, time-decay scoring)
// Only returns non-expired confessions
// P0-3: Viewer-aware — excludes confessions reported by viewer
export const getTrendingConfessions = query({
  args: {
    token: v.optional(v.string()),
    viewerId: v.optional(v.union(v.id('users'), v.string())),
  },
  handler: async (ctx, { token, viewerId }) => {
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000; // 48 hours ago

    const resolvedViewerId = await resolveConfessionReadViewer(ctx, token, viewerId);
    if (!resolvedViewerId) return [];

    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .take(CONFESSION_TRENDING_CANDIDATE_LIMIT);

    const reportedIds = await getReportedConfessionIdsForViewer(ctx, resolvedViewerId);

    // Filter to last 48h AND not expired AND not deleted AND not viewer-reported.
    // Trending excludes all moderated rows above normal visibility.
    const recent = (
      await filterVisibleConfessions(ctx, resolvedViewerId, confessions, {
        now,
        reportedConfessionIds: reportedIds,
        requireNormalModeration: true,
      })
    ).filter((c) => c.createdAt > cutoff);

    // Pre-fetch live safe Confess photos so trending cards reflect the
    // author's current safe profile photo, not a raw user photo URL.
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
// Fail closed for normal thread reads: missing, deleted, expired, blocked,
// reported, or unavailable-author rows return null. Owner archive reads use
// getMyConfessions instead.
export const getConfession = query({
  args: {
    confessionId: v.id('confessions'),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, token }) => {
    const confession = await ctx.db.get(confessionId);
    if (!confession) return null;
    const now = Date.now();
    const validatedViewerId = await resolveConfessionReadViewer(ctx, token);
    if (!(await canViewerSeeConfession(ctx, validatedViewerId, confession, { now }))) {
      return null;
    }

    const viewerIsOwner = !!validatedViewerId && validatedViewerId === confession.userId;
    // P1-1: Identify the tagged recipient so the serializer can carve out
    // taggedUserId/taggedUserName for them even when the confession is
    // anonymous. Author identity remains hidden — only the tag is exposed.
    const viewerIsTaggedRecipient =
      !!validatedViewerId &&
      !!confession.taggedUserId &&
      validatedViewerId === confession.taggedUserId;

    // Resolve the live safe Confess photo for the author so the thread hero
    // reflects current profile ordering without unsafe photo fallbacks.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      [confession.userId]
    );

    return serializeConfession(confession, {
      includeTaggedUserId: true,
      isExpired: false,
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
    token: v.string(),
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
    // Legacy compatibility: accepted but ignored. Author snapshots are
    // server-derived from the token-bound actor.
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

    const nowMs = Date.now();
    const parent = await requireConfessionMutationParent(ctx, userId, args.confessionId, nowMs);

    // Normalize identity mode. The request-provided value wins; otherwise derive
    // from the legacy isAnonymous boolean for backward compatibility with older clients.
    const identityMode = canonicalIdentityMode(args.identityMode, args.isAnonymous);
    const effectiveIsAnonymous = identityMode === 'anonymous';
    const authorSnapshot = await buildConfessionAuthorSnapshot(ctx, userId, identityMode);

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

    const replyPayload = normalizeConfessionReplyPayload(args);
    const replyType = replyPayload.replyType;

    const replyId = await ctx.db.insert('confessionReplies', {
      confessionId: args.confessionId,
      userId: userId,
      text: replyPayload.text,
      isAnonymous: effectiveIsAnonymous,
      identityMode,
      type: replyType,
      voiceUrl: replyPayload.voiceUrl,
      voiceDurationSec: replyPayload.voiceDurationSec,
      parentReplyId: args.parentReplyId,
      authorName: authorSnapshot.authorName,
      authorPhotoUrl: authorSnapshot.authorPhotoUrl,
      authorAge: authorSnapshot.authorAge,
      authorGender: authorSnapshot.authorGender,
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

    await upsertConfessionEngagementNotification(ctx, {
      confession: parent,
      actorId: userId,
      type: 'confession_reply',
      now: nowMs,
    });

    return replyId;
  },
});

// Update own reply. Owner-only. Allows editing text and/or identityMode.
// When switching to anonymous, author snapshot fields are cleared.
// When switching to a non-anonymous mode, display snapshots are refreshed from
// the token-bound server user; legacy client snapshot args are accepted but ignored.
export const updateReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
    text: v.optional(v.string()),
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('open'),
      v.literal('blur_photo')
    )),
    // Legacy compatibility: accepted but ignored. Author snapshots are
    // server-derived from the token-bound actor when identity mode changes.
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only edit your own replies.');

    const nowMs = Date.now();
    await requireConfessionMutationParent(ctx, userId, reply.confessionId, nowMs);

    const patch: Partial<Doc<'confessionReplies'>> = {};

    // Text edit — only meaningful for text replies.
    if (args.text !== undefined) {
      if (reply.type === 'voice') {
        throw new Error('Voice replies cannot be edited.');
      }
      const trimmed = args.text.trim();
      validateConfessionReplyText(trimmed);
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
        const authorSnapshot = await buildConfessionAuthorSnapshot(ctx, userId, nextMode);
        patch.authorName = authorSnapshot.authorName;
        patch.authorPhotoUrl = authorSnapshot.authorPhotoUrl;
        patch.authorAge = authorSnapshot.authorAge;
        patch.authorGender = authorSnapshot.authorGender;
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
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error('Reply not found.');
    if (reply.userId !== userId) throw new Error('You can only delete your own replies.');

    const nowMs = Date.now();
    const parent = await requireConfessionMutationParent(ctx, userId, reply.confessionId, nowMs);

    let deletedChildCount = 0;
    if (reply.parentReplyId === undefined) {
      const childReplies = await ctx.db
        .query('confessionReplies')
        .withIndex('by_confession', (q) => q.eq('confessionId', reply.confessionId))
        .filter((q) => q.eq(q.field('parentReplyId'), args.replyId))
        .collect();
      for (const child of childReplies) {
        await ctx.db.delete(child._id);
        deletedChildCount += 1;
      }
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

    return { success: true, deletedChildCount };
  },
});

// Get replies for a confession
// Fail closed — returns [] if parent missing, deleted, expired, blocked, or unavailable.
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

    const resolvedViewerId = await resolveConfessionReadViewer(ctx, token, viewerId);
    const now = Date.now();
    if (!(await canViewerSeeConfession(ctx, resolvedViewerId, parent, { now }))) {
      return [];
    }

    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .order('asc')
      .collect();
    const visibleReplies = await filterVisibleReplies(ctx, resolvedViewerId, replies);
    const visibleTopLevelReplyIds = new Set(
      visibleReplies
        .filter((reply) => reply.parentReplyId === undefined)
        .map((reply) => String(reply._id))
    );
    const visibleThreadReplies = visibleReplies.filter(
      (reply) =>
        reply.parentReplyId === undefined ||
        visibleTopLevelReplyIds.has(String(reply.parentReplyId))
    );

    // Pre-fetch live safe Confess photos for every replier so comment avatars
    // reflect current profile ordering without unsafe photo fallbacks.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      visibleThreadReplies.map((r) => r.userId)
    );

    return visibleThreadReplies.map((reply) =>
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

    const resolvedViewerId = await resolveConfessionReadViewer(ctx, token, viewerId);
    const now = Date.now();
    if (!(await canViewerSeeConfession(ctx, resolvedViewerId, parent, { now }))) {
      return null;
    }

    if (!resolvedViewerId) return null;

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
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);
    const reactionType = args.type.trim();
    if (!isAllowedConfessionReaction(reactionType)) {
      throw new Error(INVALID_REACTION);
    }

    const nowMs = Date.now();
    const confession = await requireConfessionMutationParent(ctx, userId, args.confessionId, nowMs);
    await reserveConfessionReactionToggle(ctx, args.confessionId, userId, nowMs);

    // Find existing reaction from this user on this confession
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();

    const patchReactionCount = async (delta: number) => {
      if (delta === 0) return;
      await ctx.db.patch(args.confessionId, {
        reactionCount: Math.max(0, confession.reactionCount + delta),
      });
    };

    if (existing) {
      if (existing.type === reactionType) {
        // Same emoji → remove (toggle off)
        await ctx.db.delete(existing._id);
        await patchReactionCount(isAllowedConfessionReaction(existing.type) ? -1 : 0);
        return { added: false, replaced: false, chatUnlocked: false };
      } else {
        // Different emoji → replace. If a legacy invalid reaction row existed,
        // converting it to an allowed Confess reaction increases the visible count.
        const countDelta = isAllowedConfessionReaction(existing.type) ? 0 : 1;
        await ctx.db.patch(existing._id, {
          type: reactionType,
          createdAt: nowMs,
        });
        await patchReactionCount(countDelta);
        await upsertConfessionEngagementNotification(ctx, {
          confession,
          actorId: userId,
          type: 'confession_reaction',
          now: nowMs,
        });
        return { added: false, replaced: true, chatUnlocked: false };
      }
    } else {
      // No existing → add new
      await ctx.db.insert('confessionReactions', {
        confessionId: args.confessionId,
        userId: userId,
        type: reactionType,
        createdAt: nowMs,
      });
      await patchReactionCount(1);
      await upsertConfessionEngagementNotification(ctx, {
        confession,
        actorId: userId,
        type: 'confession_reaction',
        now: nowMs,
      });

      return { added: true, replaced: false, chatUnlocked: false };
    }
  },
});

// Get all reactions for a confession (grouped by emoji)
export const getReactionCounts = query({
  args: {
    confessionId: v.id('confessions'),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { confessionId, token }) => {
    const viewerId = await resolveConfessionReadViewer(ctx, token);
    const confession = await ctx.db.get(confessionId);
    if (!(await canViewerSeeConfession(ctx, viewerId, confession, { now: Date.now() }))) {
      return [];
    }

    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .collect();
    const emojiCounts: Record<string, number> = {};
    for (const r of reactions) {
      // Skip legacy/non-Confess reaction keys.
      if (!isAllowedConfessionReaction(r.type)) continue;
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
    token: v.optional(v.string()),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveConfessionReadViewer(ctx, args.token, args.userId);
    if (!userId) {
      return null;
    }

    const confession = await ctx.db.get(args.confessionId);
    if (!(await canViewerSeeConfession(ctx, userId, confession, { now: Date.now() }))) {
      return null;
    }

    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();
    return existing && isAllowedConfessionReaction(existing.type) ? existing.type : null;
  },
});

// Get user's own confessions (all, including expired, with isExpired flag)
export const getMyConfessions = query({
  args: {
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionReadViewer(ctx, args.token, args.userId);

    const now = Date.now();
    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();

    // All rows here belong to the same user; fetch their safe Confess photo
    // once so My Confessions reflects current profile ordering without unsafe
    // photo fallbacks.
    const livePhotoUrlByUserId = await buildLivePrimaryPhotoMapForUserIds(
      ctx,
      [userId]
    );

    // Filter out manually deleted confessions (isDeleted: true)
    // Expired confessions are kept but marked as expired for the owner to see
    return confessions
      .filter((confession) => confession.isDeleted !== true && !confession.deletedAt)
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
    token: v.string(),
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
    const reporterId = await requireConfessionMutationActor(ctx, args.token, args.reporterId);

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
    if (
      !(await canViewerSeeConfession(ctx, reporterId, confession, {
        now,
        reportedConfessionIds: new Set(),
      }))
    ) {
      throw new Error(CONFESSION_UNAVAILABLE);
    }

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
    token: v.string(),
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
    const reporterId = await requireConfessionMutationActor(ctx, args.token, args.reporterId);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) {
      throw new Error('Comment not found.');
    }

    await requireConfessionMutationParent(ctx, reporterId, reply.confessionId, Date.now());

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
      replyContentSnapshot: reply.text,
      replyAuthorIdSnapshot: reply.userId,
      replyTypeSnapshot: reply.type ?? 'text',
      replyVoiceUrlSnapshot: reply.voiceUrl,
      replyVoiceDurationSecSnapshot: reply.voiceDurationSec,
      parentReplyIdSnapshot: reply.parentReplyId,
      replyCreatedAtSnapshot: reply.createdAt,
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
  args: {
    token: v.optional(v.string()),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveConfessionReadViewer(ctx, args.token, args.userId);
    if (!userId) {
      return 0;
    }

    return countTaggedConfessionBadgeForViewer(ctx, userId);
  },
});

// List tagged confessions for a user (privacy-safe: only for the tagged user's view)
export const listTaggedConfessionsForUser = query({
  args: {
    token: v.optional(v.string()),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveConfessionReadViewer(ctx, args.token, args.userId);
    if (!userId) {
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
      if (
        !(await canViewerSeeConfession(ctx, userId, confession, {
          now,
          reportedConfessionIds: reportedIds,
        }))
      ) {
        continue;
      }

      // Identity exposure rule for the "Tagged for you" sheet:
      //   anonymous   → leak nothing (matches feed behaviour for anonymous mode)
      //   blur_photo  → name + age + gender, photo is blurred client-side
      //   open        → full identity
      const effectiveVisibility = effectiveConfessionAuthorVisibility(
        confession.authorVisibility,
        confession.isAnonymous
      );
      const allowIdentity = effectiveVisibility !== 'anonymous';

      // Resolve the live safe Confess photo so the sheet reflects current
      // profile ordering without ever surfacing verification, flagged, or NSFW
      // photos. For blur_photo rows, the client applies the blur; anonymous rows
      // never fetch or return author identity.
      let liveAuthorPhotoUrl: string | undefined;
      if (allowIdentity) {
        const authorDoc = await ctx.db.get(confession.userId);
        liveAuthorPhotoUrl = authorDoc
          ? await pickConfessionAuthorPhoto(ctx, authorDoc)
          : undefined;
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
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
    notificationIds: v.optional(v.array(v.id('confessionNotifications'))),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);
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
//   2. Shared Confess visibility passes for this viewer.
//   3. confession.taggedUserId === args.profileUserId (mention-id match —
//      prevents using a benign confession id to open an unrelated profile).
//   4. Target user is active, not banned/deleted, and safe for this viewer.
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

    const now = Date.now();
    const resolvedTaggedUserId = await resolveUserIdByAuthId(ctx, taggedUserId as string);
    if (!resolvedTaggedUserId) return { allowed: false };

    const allowed = await canViewerUseConfessionTaggedProfile(
      ctx,
      viewerId,
      confession,
      resolvedTaggedUserId,
      {
        now,
        requireTaggedRecipient: true,
        disallowAuthor: true,
      }
    );

    return { allowed };
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

    // 2. Shared confession + tagged-profile visibility. This mirrors the
    // feed/thread gates so deleted, expired, hidden, blocked, or unavailable
    // users cannot mint profile grants from stale Confess rows.
    const confession = await ctx.db.get(confessionId);
    const now = Date.now();
    if (
      !(await canViewerUseConfessionTaggedProfile(ctx, viewerId, confession, profileUserId, {
        now,
      }))
    ) {
      throw new Error('Profile unavailable');
    }
    if (!confession) {
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

    // Idempotent upsert. We key on (viewer, confession) — the same chip can
    // be tapped multiple times during the 24h grant window without spamming
    // grant rows. profileUserId is locked by the shared helper to the
    // confession's taggedUserId.
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
    if (
      !confession ||
      !(await canViewerSeeConfession(ctx, viewerId, confession, {
        now,
        requireNormalModeration: true,
      }))
    ) {
      throw new Error('Connect unavailable');
    }

    if (!confession.taggedUserId || confession.taggedUserId !== viewerId) {
      throw new Error('Connect unavailable');
    }

    const eligibility = await evaluateConfessionConnectEligibility(
      ctx,
      viewerId,
      confession.userId
    );
    if (!eligibility.ok) {
      if (
        eligibility.reason === 'already_matched' ||
        eligibility.reason === 'already_conversing'
      ) {
        return {
          connectId: undefined as Id<'confessionConnects'> | undefined,
          confessionId,
          status: undefined as ConfessionConnectStatus | undefined,
          expiresAt: undefined as number | undefined,
          respondedAt: undefined as number | undefined,
          conversationId: undefined as Id<'conversations'> | undefined,
          matchId: undefined as Id<'matches'> | undefined,
          otherUserId: undefined as Id<'users'> | undefined,
          partnerUserId: undefined as Id<'users'> | undefined,
          promoted: false,
          promotionPending: false,
          canRequest: false as const,
          ineligibleReason: eligibility.reason,
          existingConversationId: eligibility.conversationId,
          existingMatchId: eligibility.matchId,
        };
      }
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
      const existingConversation =
        current.status === 'mutual' && current.conversationId
          ? await ctx.db.get(current.conversationId)
          : null;
      return serializeConfessionConnect(current, {
        viewerId,
        matchId: existingConversation?.matchId,
      });
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

    return serializeConfessionConnect(connect, { viewerId });
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
        otherUserId: connect.toUserId,
        now,
      });
      const updated = await ctx.db.get(connectId);
      if (!updated) {
        throw new Error('Connect request unavailable');
      }
      return serializeConfessionConnect(updated, { viewerId, matchId });
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
      const eligibility = await evaluateConfessionConnectEligibility(
        ctx,
        connect.fromUserId,
        connect.toUserId
      );
      if (
        !eligibility.ok &&
        (eligibility.reason === 'already_matched' ||
          eligibility.reason === 'already_conversing')
      ) {
        const closed = await closeRedundantConfessionConnect(ctx, connect, now);
        return {
          ...serializeConfessionConnect(closed),
          ineligibleReason: eligibility.reason,
          existingConversationId: eligibility.conversationId,
          existingMatchId: eligibility.matchId,
        };
      }
      if (!eligibility.ok) {
        throw new Error('Connect request unavailable');
      }
      await ctx.db.patch(connectId, {
        status: 'rejected_by_to',
        updatedAt: now,
        respondedAt: now,
      });
      await notifyConfessionConnectRejected(ctx, {
        requesterUserId: connect.fromUserId,
        confessionId: connect.confessionId,
        connectId,
        now,
      });
      const updated = await ctx.db.get(connectId);
      if (!updated) {
        throw new Error('Connect request unavailable');
      }
      return serializeConfessionConnect(updated);
    }

    const eligibility = await evaluateConfessionConnectEligibility(
      ctx,
      connect.fromUserId,
      connect.toUserId
    );
    if (
      !eligibility.ok &&
      (eligibility.reason === 'already_matched' ||
        eligibility.reason === 'already_conversing')
    ) {
      const closed = await closeRedundantConfessionConnect(ctx, connect, now);
      return {
        ...serializeConfessionConnect(closed, { viewerId }),
        conversationId: undefined,
        ineligibleReason: eligibility.reason,
        existingConversationId: eligibility.conversationId,
        existingMatchId: eligibility.matchId,
      };
    }
    if (!eligibility.ok) {
      throw new Error('Connect request unavailable');
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
      otherUserId: connect.toUserId,
      now,
    });

    const updated = await ctx.db.get(connectId);
    if (!updated) {
      throw new Error('Connect request unavailable');
    }
    return serializeConfessionConnect(updated, { viewerId, matchId });
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

    const updated = await ctx.db.get(connectId);
    if (!updated) {
      throw new Error('Connect request unavailable');
    }
    return serializeConfessionConnect(updated, { viewerId, matchId });
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
      await markConfessionConnectRequestNotificationRead(ctx, {
        ownerUserId: connect.toUserId,
        connectId,
        now,
        expire: true,
      });
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
    await markConfessionConnectRequestNotificationRead(ctx, {
      ownerUserId: connect.toUserId,
      connectId,
      now,
      expire: true,
    });

    const updated = await ctx.db.get(connectId);
    if (!updated) {
      throw new Error('Connect request unavailable');
    }
    return serializeConfessionConnect(updated);
  },
});

export const markConfessionConnectSeen = mutation({
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
    if (!connect || connect.toUserId !== viewerId) {
      throw new Error('Connect request unavailable');
    }

    const now = Date.now();
    if (connect.seenByOwnerAt === undefined) {
      await ctx.db.patch(connectId, {
        seenByOwnerAt: now,
        updatedAt: now,
      });
    }

    await markConfessionConnectRequestNotificationRead(ctx, {
      ownerUserId: viewerId,
      connectId,
      now,
    });

    return {
      success: true as const,
      seenByOwnerAt: connect.seenByOwnerAt ?? now,
    };
  },
});

export const getPendingConfessionConnectBadgeCount = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      return 0;
    }

    return countPendingConfessionConnectRequestsForViewer(ctx, viewerId, Date.now());
  },
});

export const getConfessInboxBadgeCount = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const viewerId = await getValidatedViewerFromToken(ctx, token);
    if (!viewerId) {
      return {
        taggedCount: 0,
        pendingConnectCount: 0,
        total: 0,
      };
    }

    const now = Date.now();
    const [taggedCount, pendingConnectCount] = await Promise.all([
      countTaggedConfessionBadgeForViewer(ctx, viewerId),
      countPendingConfessionConnectRequestsForViewer(ctx, viewerId, now),
    ]);

    return {
      taggedCount,
      pendingConnectCount,
      total: taggedCount + pendingConnectCount,
    };
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

    const now = Date.now();
    if (
      !(await canViewerSeeConfession(ctx, viewerId, confession, {
        now,
        requireNormalModeration: true,
      }))
    ) {
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
    let ineligibleReason: ConfessionConnectIneligibleReason | undefined;
    let existingConversationId: Id<'conversations'> | undefined;
    let existingMatchId: Id<'matches'> | undefined;

    if (confession.taggedUserId) {
      const confessionAvailable = confessionIsConnectable(confession, now);
      const eligibility = await evaluateConfessionConnectEligibility(
        ctx,
        confession.taggedUserId,
        confession.userId
      );
      const pairSafe = eligibility.ok;
      if (!eligibility.ok) {
        ineligibleReason = eligibility.reason;
        existingConversationId = eligibility.conversationId;
        existingMatchId = eligibility.matchId;
      }

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
        ineligibleReason,
        existingConversationId,
        existingMatchId,
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
      ineligibleReason,
      existingConversationId,
      existingMatchId,
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
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

    // Get the confession to find the author
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found');
    }
    const now = Date.now();
    if (
      !(await canViewerSeeConfession(ctx, userId, confession, {
        now,
        requireNormalModeration: true,
      }))
    ) {
      throw new Error(CONFESSION_UNAVAILABLE);
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
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }
    if (confession.userId !== userId) {
      throw new Error('You can only delete your own confessions.');
    }

    const now = Date.now();
    await cleanupDeletedConfessionChildren(ctx, confession, now);

    // Soft delete the parent row for moderation/audit continuity. User-visible
    // child rows are removed above so replies/reactions/notifications cannot
    // orphan into active surfaces.
    await ctx.db.patch(args.confessionId, {
      isDeleted: true,
      deletedAt: now,
      replyCount: 0,
      reactionCount: 0,
      voiceReplyCount: 0,
    });

    return { success: true };
  },
});

// Update own confession (text and mood only)
// Only the author can edit their own confession, and only if not deleted
export const updateConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    token: v.string(),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
  },
  handler: async (ctx, args) => {
    const userId = await requireConfessionMutationActor(ctx, args.token, args.userId);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }
    if (confession.userId !== userId) {
      throw new Error('You can only edit your own confessions.');
    }
    if (confession.isDeleted || confession.deletedAt) {
      throw new Error('Cannot edit a deleted confession.');
    }

    // Validate text
    const trimmedText = args.text.trim();
    if (trimmedText.length < MIN_CONFESSION_LENGTH) {
      throw new Error(CONFESSION_MIN_LENGTH_MESSAGE);
    }
    if (trimmedText.length > MAX_CONFESSION_LENGTH) {
      throw new Error(CONFESSION_MAX_LENGTH_MESSAGE);
    }
    if (PHONE_PATTERN.test(trimmedText)) {
      throw new Error('Do not include phone numbers.');
    }
    if (EMAIL_PATTERN.test(trimmedText)) {
      throw new Error('Do not include email addresses.');
    }

    const effectiveVisibility = effectiveConfessionAuthorVisibility(
      confession.authorVisibility,
      confession.isAnonymous
    );
    const authorSnapshot = await buildConfessionAuthorSnapshot(ctx, userId, effectiveVisibility);

    // Update text/mood and refresh server-owned identity snapshot at edit time.
    await ctx.db.patch(args.confessionId, {
      text: trimmedText,
      mood: args.mood,
      isAnonymous: effectiveVisibility === 'anonymous',
      authorVisibility: effectiveVisibility,
      authorName: authorSnapshot.authorName,
      authorPhotoUrl: authorSnapshot.authorPhotoUrl,
      authorAge: authorSnapshot.authorAge,
      authorGender: authorSnapshot.authorGender,
    });

    return { success: true };
  },
});
