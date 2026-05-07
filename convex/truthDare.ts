import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { resolveUserIdByAuthId } from './helpers';
import { shouldCreatePhase2DeepConnectNotification } from './phase2NotificationPrefs';
import {
  createPhase2MatchNotificationIfMissing,
  ensurePhase2MatchAndConversation,
  findPhase2MatchConversationStatus,
} from './phase2MatchHelpers';
import {
  TOD_REPORT_THRESHOLDS,
  moderationStatusForTodReportCount,
} from './lib/todModeration';
import {
  TOD_MEDIA_LIMITS,
  formatTodMediaLimit,
  isTodAllowedMime,
} from '../lib/todMediaLimits';

// 24-hour auto-delete rule (same as Confessions)
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Rate limiting constants
const RATE_LIMITS = {
  prompt: { max: 5, windowMs: 60 * 1000 }, // 5 prompts per minute
  connect: { max: 30, windowMs: 60 * 1000 }, // 30 connect requests per minute
  answer: { max: 10, windowMs: 60 * 1000 }, // 10 answers per minute
  reaction: { max: 30, windowMs: 60 * 1000 }, // 30 reactions per minute
  prompt_reaction: { max: 30, windowMs: 60 * 1000 }, // 30 prompt reactions per minute
  report: { max: 10, windowMs: 24 * 60 * 60 * 1000 }, // 10 reports per day
  prompt_report: { max: 10, windowMs: 24 * 60 * 60 * 1000 }, // 10 prompt reports per day
  claim_media: { max: 20, windowMs: 60 * 1000 }, // 20 media claims per minute
  media_upload: { max: 30, windowMs: 60 * 1000 }, // 30 upload URLs/finalizations per minute
};

// TOD-P2-001 FIX: Rate limit error message
const RATE_LIMIT_ERROR = 'Rate limit exceeded. Please try again later.';
const TOD_SYSTEM_OWNER_ID = 'system';

const MIN_PROMPT_CHARS = 20;
const MAX_PROMPT_CHARS = 400;
const MAX_ANSWER_CHARS = 400;
const MIN_MEDIA_VIEW_DURATION_SEC = 1;
const MAX_MEDIA_VIEW_DURATION_SEC = 60;
const SHOULD_DEBUG_TOD = process.env.NODE_ENV !== 'production';

function debugTodLog(...args: any[]) {
  if (SHOULD_DEBUG_TOD) {
    console.log(...args);
  }
}

function trimText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validatePromptText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < MIN_PROMPT_CHARS) {
    throw new Error(`Prompt must be at least ${MIN_PROMPT_CHARS} characters.`);
  }
  if (trimmed.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt cannot exceed ${MAX_PROMPT_CHARS} characters.`);
  }
  return trimmed;
}

function validateAnswerText(text: string | undefined): string | undefined {
  const trimmed = trimText(text);
  if (trimmed && trimmed.length > MAX_ANSWER_CHARS) {
    throw new Error(`Answer cannot exceed ${MAX_ANSWER_CHARS} characters.`);
  }
  return trimmed;
}

function validateViewDuration(durationSec: number | undefined): number | undefined {
  if (durationSec === undefined) return undefined;
  if (durationSec < MIN_MEDIA_VIEW_DURATION_SEC || durationSec > MAX_MEDIA_VIEW_DURATION_SEC) {
    throw new Error(`View duration must be between ${MIN_MEDIA_VIEW_DURATION_SEC} and ${MAX_MEDIA_VIEW_DURATION_SEC} seconds.`);
  }
  return durationSec;
}

// TOD-AUTH-FIX (P0): Two-tier auth resolution — matches the canonical pattern
// used across the rest of the app (see `privateConversations.ts`,
// `conversations.ts`, `messages.ts`, etc.).
//
// The app does NOT configure Convex's built-in auth provider (no
// `convex/auth.config.ts`), so `ctx.auth.getUserIdentity()` ALWAYS returns
// null in the current demo/custom-auth setup. All T/D writes therefore threw
// "Unauthorized" unconditionally.
//
// Resolution order:
//   1. Primary:  `ctx.auth.getUserIdentity()` (future-proof for JWT auth).
//   2. Fallback: client-supplied `authUserId` (current demo/custom auth).
//
// Trust model: `resolveUserIdByAuthId` only returns IDs of existing user
// records — the client cannot fabricate identities. This matches the rest of
// the active app's contract for demo mode.
async function requireAuthenticatedTodUserId(
  ctx: any,
  authUserId?: string,
  errorMessage: string = 'Unauthorized'
): Promise<Id<'users'>> {
  // Primary: Convex-authenticated identity
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.subject) {
    const resolved = await resolveUserIdByAuthId(ctx, identity.subject);
    if (resolved) return resolved;
  }

  // Fallback: client-supplied authUserId (current demo/custom auth path)
  if (authUserId && authUserId.trim().length > 0) {
    const resolved = await resolveUserIdByAuthId(ctx, authUserId.trim());
    if (resolved) return resolved;
  }

  throw new Error(errorMessage);
}

async function getOptionalAuthenticatedTodUserId(
  ctx: any,
  authUserId?: string,
  contextLabel: string = 'truthDare'
): Promise<Id<'users'> | undefined> {
  // Primary: Convex-authenticated identity
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.subject) {
    const resolved = await resolveUserIdByAuthId(ctx, identity.subject);
    if (resolved) return resolved;
    console.warn(`[T/D] Auth identity resolved without user record in ${contextLabel}`);
  }

  // Fallback: client-supplied authUserId (current demo/custom auth path)
  if (authUserId && authUserId.trim().length > 0) {
    const resolved = await resolveUserIdByAuthId(ctx, authUserId.trim());
    if (resolved) return resolved;
  }

  return undefined;
}

function getTodDisplayName(
  user: { handle?: string | null; name?: string | null } | null | undefined,
  fallback: string = 'Someone'
): string {
  // T/D identity cards must show the user's real display name (the `name`
  // field — same source the client writes via `authorProfile.name` at create
  // time). `handle` is a system/internal identifier that can legitimately
  // differ from the displayed name; preferring it caused wrong-name leaks in
  // T/D comments where the snapshot was stripped (no_photo mode) and the
  // read-time fallback landed here.
  return user?.name?.trim() || user?.handle?.trim() || fallback;
}

function isSystemTodOwnerId(userId: string | null | undefined): boolean {
  return userId === TOD_SYSTEM_OWNER_ID;
}

function calculateTodAge(dateOfBirth: string | undefined): number | null {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function getSafePhotoUrl(
  user: { primaryPhotoUrl?: string | null } | null | undefined,
  fallbackUrl?: string | null
): string | null {
  return trimText(user?.primaryPhotoUrl ?? undefined) ?? trimText(fallbackUrl ?? undefined) ?? null;
}

type TodReportModeratedItem = {
  reportCount?: number;
  moderationStatus?: 'normal' | 'under_review' | 'hidden_by_reports';
};

function isTodHiddenByReports(item: TodReportModeratedItem): boolean {
  return (
    item.moderationStatus === 'hidden_by_reports' ||
    (item.reportCount ?? 0) >= TOD_REPORT_THRESHOLDS.AUTO_HIDE
  );
}

function isTodSuppressedFromHighVisibility(item: TodReportModeratedItem): boolean {
  return (
    isTodHiddenByReports(item) ||
    item.moderationStatus === 'under_review' ||
    (item.reportCount ?? 0) >= TOD_REPORT_THRESHOLDS.TRENDING_SUPPRESS
  );
}

function isPromptHiddenForViewer(
  prompt: TodReportModeratedItem & { ownerUserId: string },
  viewerUserId: Id<'users'> | undefined
): boolean {
  return isTodHiddenByReports(prompt) && prompt.ownerUserId !== viewerUserId;
}

function isAnswerHiddenForViewer(
  answer: TodReportModeratedItem & { userId: string },
  viewerUserId: Id<'users'> | undefined
): boolean {
  return isTodHiddenByReports(answer) && answer.userId !== viewerUserId;
}

async function deleteStorageIfPresent(
  ctx: any,
  storageId: Id<'_storage'> | undefined
): Promise<void> {
  if (!storageId) return;
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Storage may already be deleted.
  }
}

type TodUploadMediaKind = 'photo' | 'video' | 'voice';

type ValidatedTodUploadReference = {
  size: number;
  contentType: string;
  kind: TodUploadMediaKind;
};

function normalizeTodMime(mime: string | undefined | null): string {
  return mime?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function getTodUploadKindFromMime(mime: string | undefined | null): TodUploadMediaKind | undefined {
  const normalizedMime = normalizeTodMime(mime);
  if (isTodAllowedMime('photo', normalizedMime)) return 'photo';
  if (isTodAllowedMime('video', normalizedMime)) return 'video';
  if (isTodAllowedMime('voice', normalizedMime)) return 'voice';
  if (normalizedMime.startsWith('image/')) return 'photo';
  if (normalizedMime.startsWith('video/')) return 'video';
  if (normalizedMime.startsWith('audio/')) return 'voice';
  return undefined;
}

function getTodUploadKindFromMedia(
  mediaMime: string | undefined,
  fallbackType: 'text' | 'photo' | 'video' | 'voice' | undefined
): TodUploadMediaKind | undefined {
  const mimeKind = getTodUploadKindFromMime(mediaMime);
  if (mimeKind) return mimeKind;
  if (fallbackType === 'voice') return 'voice';
  if (fallbackType === 'video') return 'video';
  if (fallbackType === 'photo') return 'photo';
  return undefined;
}

function getTodAnswerTypeFromUploadKind(
  mediaKind: TodUploadMediaKind | undefined
): 'text' | 'photo' | 'video' | 'voice' {
  if (mediaKind === 'voice') return 'voice';
  if (mediaKind === 'video') return 'video';
  if (mediaKind === 'photo') return 'photo';
  return 'text';
}

function validateTodMediaDurationSec(
  mediaKind: TodUploadMediaKind | 'text' | undefined,
  durationSec: number | undefined
): number | undefined {
  if (mediaKind === 'video' || mediaKind === 'voice') {
    if (
      typeof durationSec !== 'number' ||
      !Number.isFinite(durationSec) ||
      durationSec <= 0 ||
      durationSec > TOD_MEDIA_LIMITS[mediaKind].maxDurationSec
    ) {
      throw new Error(formatTodMediaLimit(mediaKind));
    }
    return durationSec;
  }

  return undefined;
}

async function validateTodUploadReference(
  ctx: any,
  storageId: Id<'_storage'>,
  userId: Id<'users'>,
  declaredMediaKind?: TodUploadMediaKind
): Promise<ValidatedTodUploadReference> {
  const pending = await ctx.db
    .query('pendingUploads')
    .withIndex('by_storage', (q: any) => q.eq('storageId', storageId))
    .first();

  if (!pending || pending.userId !== userId) {
    throw new Error('Unauthorized storage reference');
  }

  const meta = (await ctx.db.system.get(storageId)) as
    | { size?: number; contentType?: string }
    | null;
  if (!meta) {
    throw new Error('Invalid storage reference: metadata unavailable');
  }

  if (
    typeof meta.size !== 'number' ||
    !Number.isFinite(meta.size) ||
    meta.size <= 0
  ) {
    throw new Error('Invalid storage reference: size metadata unavailable');
  }

  const contentType = normalizeTodMime(meta.contentType);
  const actualMediaKind = getTodUploadKindFromMime(contentType);
  if (!actualMediaKind || !isTodAllowedMime(actualMediaKind, contentType)) {
    throw new Error('Unsupported media format.');
  }

  if (declaredMediaKind && declaredMediaKind !== actualMediaKind) {
    throw new Error('Unsupported media format.');
  }

  if (meta.size > TOD_MEDIA_LIMITS[actualMediaKind].maxBytes) {
    throw new Error(formatTodMediaLimit(actualMediaKind));
  }

  return {
    size: meta.size,
    contentType,
    kind: actualMediaKind,
  };
}

function getNormalizedTodAnswerIdentity(
  answer: {
    isAnonymous?: boolean;
    identityMode?: 'anonymous' | 'no_photo' | 'profile';
    photoBlurMode?: 'none' | 'blur';
    authorName?: string;
    authorPhotoUrl?: string;
    authorAge?: number;
    authorGender?: string;
  }
): {
  identityMode: 'anonymous' | 'no_photo' | 'profile';
  isAnonymous: boolean;
  photoBlurMode: 'none' | 'blur';
  authorName: string | undefined;
  authorPhotoUrl: string | undefined;
  authorAge: number | undefined;
  authorGender: string | undefined;
} {
  const identityMode =
    answer.identityMode === 'anonymous' ||
    answer.identityMode === 'no_photo' ||
    answer.identityMode === 'profile'
      ? answer.identityMode
      : answer.isAnonymous !== false
        ? 'anonymous'
        : answer.photoBlurMode === 'blur'
          ? 'no_photo'
          : 'profile';
  const isAnonymous = identityMode === 'anonymous';
  const isNoPhoto = identityMode === 'no_photo';

  return {
    identityMode,
    isAnonymous,
    photoBlurMode: isNoPhoto ? 'blur' : 'none',
    authorName: isAnonymous ? undefined : trimText(answer.authorName ?? undefined),
    // BLUR-PHOTO PARITY WITH CONFESS: preserve the real photo URL for `no_photo`;
    // the renderer applies blur on top. Only anonymous mode strips it.
    authorPhotoUrl: isAnonymous ? undefined : trimText(answer.authorPhotoUrl ?? undefined),
    authorAge: isAnonymous ? undefined : answer.authorAge,
    authorGender: isAnonymous ? undefined : trimText(answer.authorGender ?? undefined),
  };
}

type TodConnectIdentity = {
  name: string;
  photoUrl: string | null;
  photoBlurMode: 'none' | 'blur';
  age: number | null;
  gender: string | null;
  isAnonymous: boolean;
};

function getPromptConnectIdentity(
  prompt: {
    isAnonymous?: boolean;
    photoBlurMode?: 'none' | 'blur';
    ownerName?: string;
    ownerPhotoUrl?: string;
    ownerAge?: number;
    ownerGender?: string;
  },
  user:
    | {
        handle?: string | null;
        name?: string | null;
        primaryPhotoUrl?: string | null;
        dateOfBirth?: string;
        gender?: string | null;
      }
    | null
    | undefined
): TodConnectIdentity {
  const isAnonymous = prompt.isAnonymous !== false;
  const photoBlurMode: 'none' | 'blur' =
    !isAnonymous && prompt.photoBlurMode === 'blur' ? 'blur' : 'none';

  return {
    name: isAnonymous ? 'Anonymous' : getTodDisplayName(user, trimText(prompt.ownerName) ?? 'Someone'),
    photoUrl: isAnonymous || photoBlurMode === 'blur' ? null : getSafePhotoUrl(user, prompt.ownerPhotoUrl),
    photoBlurMode,
    age: isAnonymous ? null : (prompt.ownerAge ?? calculateTodAge(user?.dateOfBirth)),
    gender: isAnonymous
      ? null
      : (trimText(prompt.ownerGender ?? undefined) ?? trimText(user?.gender ?? undefined) ?? null),
    isAnonymous,
  };
}

function getAnswerConnectIdentity(
  answer: {
    isAnonymous?: boolean;
    identityMode?: 'anonymous' | 'no_photo' | 'profile';
    photoBlurMode?: 'none' | 'blur';
    authorName?: string;
    authorPhotoUrl?: string;
    authorAge?: number;
    authorGender?: string;
  },
  user:
    | {
        handle?: string | null;
        name?: string | null;
        primaryPhotoUrl?: string | null;
        dateOfBirth?: string;
        gender?: string | null;
      }
    | null
    | undefined
): TodConnectIdentity {
  const normalized = getNormalizedTodAnswerIdentity(answer);

  return {
    name: normalized.isAnonymous
      ? 'Anonymous'
      : getTodDisplayName(user, normalized.authorName ?? 'Someone'),
    photoUrl:
      normalized.isAnonymous || normalized.photoBlurMode === 'blur'
        ? null
        : getSafePhotoUrl(user, normalized.authorPhotoUrl),
    photoBlurMode: normalized.photoBlurMode,
    age: normalized.isAnonymous ? null : (normalized.authorAge ?? calculateTodAge(user?.dateOfBirth)),
    gender: normalized.isAnonymous
      ? null
      : (normalized.authorGender ?? trimText(user?.gender ?? undefined) ?? null),
    isAnonymous: normalized.isAnonymous,
  };
}

function getDefaultConnectIdentity(
  user:
    | {
        handle?: string | null;
        name?: string | null;
        primaryPhotoUrl?: string | null;
        dateOfBirth?: string;
        gender?: string | null;
      }
    | null
    | undefined
): TodConnectIdentity {
  return {
    name: getTodDisplayName(user),
    photoUrl: getSafePhotoUrl(user),
    photoBlurMode: 'none',
    age: calculateTodAge(user?.dateOfBirth),
    gender: trimText(user?.gender ?? undefined) ?? null,
    isAnonymous: false,
  };
}

async function getBlockedUserIdsForViewer(
  ctx: any,
  viewerUserId: Id<'users'> | undefined
): Promise<Set<string>> {
  if (!viewerUserId) return new Set();

  const blocksOut = await ctx.db
    .query('blocks')
    .withIndex('by_blocker', (q: any) => q.eq('blockerId', viewerUserId as Id<'users'>))
    .collect();
  const blocksIn = await ctx.db
    .query('blocks')
    .withIndex('by_blocked', (q: any) => q.eq('blockedUserId', viewerUserId as Id<'users'>))
    .collect();

  return new Set([
    ...blocksOut.map((b: any) => b.blockedUserId as string),
    ...blocksIn.map((b: any) => b.blockerId as string),
  ]);
}

async function hasBlockBetween(ctx: any, userA: string, userB: string): Promise<boolean> {
  if (isSystemTodOwnerId(userA) || isSystemTodOwnerId(userB)) {
    return false;
  }
  const direct = await ctx.db
    .query('blocks')
    .withIndex('by_blocker', (q: any) => q.eq('blockerId', userA as Id<'users'>))
    .filter((q: any) => q.eq(q.field('blockedUserId'), userB as Id<'users'>))
    .first();
  if (direct) return true;

  const reverse = await ctx.db
    .query('blocks')
    .withIndex('by_blocker', (q: any) => q.eq('blockerId', userB as Id<'users'>))
    .filter((q: any) => q.eq(q.field('blockedUserId'), userA as Id<'users'>))
    .first();
  return !!reverse;
}

async function getTodPromptIdsReportedByViewer(
  ctx: any,
  viewerUserId: Id<'users'> | undefined
): Promise<Set<string>> {
  if (!viewerUserId) return new Set();

  const reports = await ctx.db
    .query('todPromptReports')
    .withIndex('by_reporter', (q: any) => q.eq('reporterId', viewerUserId as string))
    .collect();

  return new Set(reports.map((report: any) => report.promptId as string));
}

async function getTodAnswerIdsReportedByViewer(
  ctx: any,
  viewerUserId: Id<'users'> | undefined
): Promise<Set<string>> {
  if (!viewerUserId) return new Set();

  const reports = await ctx.db
    .query('todAnswerReports')
    .withIndex('by_reporter', (q: any) => q.eq('reporterId', viewerUserId as string))
    .collect();

  return new Set(reports.map((report: any) => report.answerId as string));
}

async function hasViewerReportedPrompt(
  ctx: any,
  promptId: string,
  viewerUserId: Id<'users'> | undefined
): Promise<boolean> {
  if (!viewerUserId) return false;

  const report = await ctx.db
    .query('todPromptReports')
    .withIndex('by_prompt_reporter', (q: any) =>
      q.eq('promptId', promptId).eq('reporterId', viewerUserId as string)
    )
    .first();

  return !!report;
}

async function hasViewerReportedAnswer(
  ctx: any,
  answerId: string,
  viewerUserId: Id<'users'> | undefined
): Promise<boolean> {
  if (!viewerUserId) return false;

  const report = await ctx.db
    .query('todAnswerReports')
    .withIndex('by_answer_reporter', (q: any) =>
      q.eq('answerId', answerId).eq('reporterId', viewerUserId as string)
    )
    .first();

  return !!report;
}

type TodConnectRequestStatus = 'pending' | 'connected' | 'removed';

async function findTodConnectRequestForPromptPair(
  ctx: any,
  promptId: string,
  fromUserId: string,
  toUserId: string,
  statuses: TodConnectRequestStatus[] = ['pending', 'connected', 'removed'],
) {
  return await ctx.db
    .query('todConnectRequests')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .filter((q: any) =>
      q.and(
        q.eq(q.field('fromUserId'), fromUserId),
        q.eq(q.field('toUserId'), toUserId),
        q.or(...statuses.map((status) => q.eq(q.field('status'), status))),
      )
    )
    .first();
}

function getTodConnectDuplicateAction(status: TodConnectRequestStatus) {
  if (status === 'connected') return 'already_connected' as const;
  if (status === 'removed') return 'already_removed' as const;
  return 'already_pending' as const;
}

function getVoiceMediaUrlForViewer(
  answer: TodReportModeratedItem & {
    type: string;
    mediaUrl?: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'> | undefined,
  promptOwnerUserId: string
): string | undefined {
  if (answer.type !== 'voice' || !answer.mediaUrl || !viewerUserId) {
    return undefined;
  }
  if (isAnswerHiddenForViewer(answer, viewerUserId)) {
    return undefined;
  }
  if (viewerUserId === answer.userId) {
    return answer.mediaUrl;
  }
  if (answer.visibility === 'owner_only') {
    return promptOwnerUserId === viewerUserId ? answer.mediaUrl : undefined;
  }
  return answer.mediaUrl;
}

function getInlineAnswerMediaUrlForViewer(
  answer: TodReportModeratedItem & {
    type: string;
    mediaUrl?: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'> | undefined,
  promptOwnerUserId: string
): string | undefined {
  if (!viewerUserId) {
    return undefined;
  }
  if (isAnswerHiddenForViewer(answer, viewerUserId)) {
    return undefined;
  }
  if (answer.type === 'voice') {
    return getVoiceMediaUrlForViewer(answer, viewerUserId, promptOwnerUserId);
  }
  if ((answer.type === 'photo' || answer.type === 'video') && viewerUserId === answer.userId) {
    return answer.mediaUrl;
  }
  return undefined;
}

async function canViewerAccessAnswerMedia(
  ctx: any,
  answer: TodReportModeratedItem & {
    _id?: Id<'todAnswers'> | string;
    promptId: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: (TodReportModeratedItem & { ownerUserId: string }) | null
): Promise<boolean> {
  const promptDoc =
    prompt ?? (await ctx.db.get(answer.promptId as Id<'todPrompts'>));
  if (!promptDoc) {
    return false;
  }

  if (isPromptHiddenForViewer(promptDoc, viewerUserId)) {
    return false;
  }
  if (await hasViewerReportedPrompt(ctx, answer.promptId, viewerUserId)) {
    return false;
  }

  if (viewerUserId === answer.userId) {
    return true;
  }

  if (isAnswerHiddenForViewer(answer, viewerUserId)) {
    return false;
  }

  const answerId = answer._id ? (answer._id as string) : undefined;
  if (answerId && await hasViewerReportedAnswer(ctx, answerId, viewerUserId)) {
    return false;
  }

  if (await hasBlockBetween(ctx, viewerUserId as string, answer.userId)) {
    return false;
  }
  if (
    !isSystemTodOwnerId(promptDoc.ownerUserId) &&
    promptDoc.ownerUserId !== answer.userId &&
    await hasBlockBetween(ctx, viewerUserId as string, promptDoc.ownerUserId)
  ) {
    return false;
  }

  if (answer.visibility === 'owner_only') {
    return promptDoc.ownerUserId === viewerUserId;
  }

  return true;
}

async function canViewerAccessVoiceAnswer(
  ctx: any,
  answer: TodReportModeratedItem & {
    _id?: Id<'todAnswers'> | string;
    promptId: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: (TodReportModeratedItem & { ownerUserId: string }) | null
): Promise<boolean> {
  return canViewerAccessAnswerMedia(ctx, answer, viewerUserId, prompt);
}

async function getAnswerReactionSummary(
  ctx: any,
  answerId: string,
  totalReactionCount: number,
  viewerUserId: Id<'users'> | undefined
): Promise<{ reactionCounts: { emoji: string; count: number }[]; myReaction: string | null }> {
  if (totalReactionCount <= 0) {
    return {
      reactionCounts: [],
      myReaction: null,
    };
  }

  const reactions = await ctx.db
    .query('todAnswerReactions')
    .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
    .collect();

  const emojiCountMap: Map<string, number> = new Map();
  for (const reaction of reactions) {
    emojiCountMap.set(reaction.emoji, (emojiCountMap.get(reaction.emoji) || 0) + 1);
  }

  let myReaction: string | null = null;
  if (viewerUserId) {
    const myReactionDoc = reactions.find((reaction: any) => reaction.userId === viewerUserId);
    if (myReactionDoc) {
      myReaction = myReactionDoc.emoji;
    }
  }

  return {
    reactionCounts: Array.from(emojiCountMap.entries()).map(([emoji, count]) => ({ emoji, count })),
    myReaction,
  };
}

function sortTodAnswersByDisplayRank(
  a: { totalReactionCount?: number; createdAt: number },
  b: { totalReactionCount?: number; createdAt: number }
): number {
  const aReactions = a.totalReactionCount ?? 0;
  const bReactions = b.totalReactionCount ?? 0;
  if (bReactions !== aReactions) {
    return bReactions - aReactions;
  }
  return b.createdAt - a.createdAt;
}

async function syncPromptAnswerCounts(
  ctx: any,
  promptId: string
): Promise<{ answerCount: number; activeCount: number }> {
  const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
  if (!prompt) {
    return { answerCount: 0, activeCount: 0 };
  }

  const answers = await ctx.db
    .query('todAnswers')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .collect();

  const answerCount = answers.length;
  const activeCount = answerCount;

  if (
    prompt.answerCount !== answerCount ||
    (prompt.activeCount ?? 0) !== activeCount
  ) {
    await ctx.db.patch(prompt._id, {
      answerCount,
      activeCount,
    });
  }

  return { answerCount, activeCount };
}

async function isTodStorageStillReferenced(
  ctx: any,
  storageId: Id<'_storage'>
): Promise<boolean> {
  const answerUsingStorage = await ctx.db
    .query('todAnswers')
    .filter((q: any) => q.eq(q.field('mediaStorageId'), storageId))
    .first();
  if (answerUsingStorage) {
    return true;
  }

  const privateMediaUsingStorage = await ctx.db
    .query('todPrivateMedia')
    .filter((q: any) => q.eq(q.field('storageId'), storageId))
    .first();
  if (privateMediaUsingStorage) {
    return true;
  }

  const photoUsingStorage = await ctx.db
    .query('photos')
    .filter((q: any) => q.eq(q.field('storageId'), storageId))
    .first();

  return !!photoUsingStorage;
}

async function deleteTodAnswerForCleanup(
  ctx: any,
  answer: {
    _id: Id<'todAnswers'>;
    mediaStorageId?: Id<'_storage'>;
  }
): Promise<void> {
  const answerId = answer._id as string;

  const likes = await ctx.db
    .query('todAnswerLikes')
    .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
    .collect();
  for (const like of likes) {
    await ctx.db.delete(like._id);
  }

  const reactions = await ctx.db
    .query('todAnswerReactions')
    .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
    .collect();
  for (const reaction of reactions) {
    await ctx.db.delete(reaction._id);
  }

  const reports = await ctx.db
    .query('todAnswerReports')
    .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
    .collect();
  for (const report of reports) {
    await ctx.db.delete(report._id);
  }

  const views = await ctx.db
    .query('todAnswerViews')
    .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
    .collect();
  for (const view of views) {
    await ctx.db.delete(view._id);
  }

  const connectRequests = await ctx.db
    .query('todConnectRequests')
    .filter((q: any) => q.eq(q.field('answerId'), answerId))
    .collect();
  for (const request of connectRequests) {
    await ctx.db.delete(request._id);
  }

  await deleteStorageIfPresent(ctx, answer.mediaStorageId);
  await ctx.db.delete(answer._id);
}

export const trackPendingTodUploads = mutation({
  args: {
    storageIds: v.array(v.id('_storage')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { storageIds, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');
    const uniqueStorageIds = Array.from(new Set(storageIds));
    const trackedIds: Id<'_storage'>[] = [];

    for (const storageId of uniqueStorageIds) {
      const existing = await ctx.db
        .query('pendingUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first();

      if (existing) {
        if (existing.userId !== userId) {
          throw new Error('Storage ID already claimed by another user');
        }
        trackedIds.push(storageId);
        continue;
      }

      await ctx.db.insert('pendingUploads', {
        storageId,
        userId,
        createdAt: Date.now(),
      });
      trackedIds.push(storageId);
    }

    return {
      success: true,
      trackedCount: trackedIds.length,
      trackedIds,
    };
  },
});

export const releasePendingTodUploads = mutation({
  args: {
    storageIds: v.array(v.id('_storage')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { storageIds, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');
    const uniqueStorageIds = Array.from(new Set(storageIds));
    let releasedCount = 0;

    for (const storageId of uniqueStorageIds) {
      const pending = await ctx.db
        .query('pendingUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first();

      if (!pending) {
        continue;
      }
      if (pending.userId !== userId) {
        throw new Error('Not authorized to release this upload');
      }

      await ctx.db.delete(pending._id);
      releasedCount++;
    }

    return {
      success: true,
      releasedCount,
    };
  },
});

export const cleanupPendingTodUploads = mutation({
  args: {
    storageIds: v.array(v.id('_storage')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { storageIds, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');
    const uniqueStorageIds = Array.from(new Set(storageIds));
    let deletedCount = 0;
    let skippedInUseCount = 0;

    for (const storageId of uniqueStorageIds) {
      const pending = await ctx.db
        .query('pendingUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first();

      if (!pending) {
        continue;
      }
      if (pending.userId !== userId) {
        throw new Error('Not authorized to clean up this upload');
      }

      if (await isTodStorageStillReferenced(ctx, storageId)) {
        await ctx.db.delete(pending._id);
        skippedInUseCount++;
        continue;
      }

      await deleteStorageIfPresent(ctx, storageId);
      await ctx.db.delete(pending._id);
      deletedCount++;
    }

    return {
      success: true,
      deletedCount,
      skippedInUseCount,
    };
  },
});

// Create a new Truth or Dare prompt
// TOD-001 FIX: Auth hardening - verify caller identity server-side
export const createPrompt = mutation({
  args: {
    type: v.union(v.literal('truth'), v.literal('dare')),
    text: v.string(),
    authUserId: v.string(), // TOD-001: Auth verification required
    isAnonymous: v.optional(v.boolean()),
    photoBlurMode: v.optional(v.union(v.literal('none'), v.literal('blur'))),
    // Owner profile snapshot (for feed display)
    ownerName: v.optional(v.string()),
    ownerPhotoUrl: v.optional(v.string()),
    // NEW: Accept storage ID for uploaded photos (resolves to HTTPS URL server-side)
    ownerPhotoStorageId: v.optional(v.id('_storage')),
    ownerAge: v.optional(v.number()),
    ownerGender: v.optional(v.string()),
    // Owner-attached prompt media (optional, Phase-2). Media follows prompt
    // visibility: if a viewer can see the text, they can see the media. No
    // separate one-time-view gating; mediaUrl + fileSize are derived
    // server-side from the storage reference.
    mediaStorageId: v.optional(v.id('_storage')),
    mediaMime: v.optional(v.string()),
    mediaKind: v.optional(v.union(v.literal('photo'), v.literal('video'), v.literal('voice'))),
    durationSec: v.optional(v.number()),
    isFrontCamera: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedTodUserId(ctx, args.authUserId, 'Unauthorized');
    const promptText = validatePromptText(args.text);

    const now = Date.now();
    const expiresAt = now + TWENTY_FOUR_HOURS_MS;

    const rateCheck = await checkRateLimit(ctx, ownerUserId, 'prompt');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }

    // Resolve photo URL from storage ID if provided (ensures HTTPS URL)
    let resolvedPhotoUrl = args.ownerPhotoUrl;
    if (args.ownerPhotoStorageId) {
      const storageUrl = await ctx.storage.getUrl(args.ownerPhotoStorageId);
      if (storageUrl) {
        resolvedPhotoUrl = storageUrl;
        debugTodLog(`[T/D] Resolved photo storageId to URL: ${storageUrl.substring(0, 60)}...`);
      }
    }

    // SERVER-SIDE IDENTITY FIX: When isAnonymous=false and frontend didn't provide identity,
    // fetch from the user's canonical profile. This ensures "Everyone" posts always show real identity.
    let finalOwnerName = args.ownerName;
    let finalOwnerAge = args.ownerAge;
    let finalOwnerGender = args.ownerGender;
    let finalOwnerPhotoUrl = resolvedPhotoUrl;

    const isPublicPost = args.isAnonymous === false;
    const needsNameFallback = isPublicPost && (!finalOwnerName || finalOwnerName.trim() === '');
    // BLUR-PARITY FIX: For any non-anonymous post (including the blurred-identity
    // "Without photo" branch), ensure a real photo URL is persisted so the
    // renderer can apply the Confess-style native blur. Without this, posts
    // created before the composer-side fix or with an empty private-profile
    // photo set would land with `ownerPhotoUrl=undefined`, causing TodAvatar
    // to fall through to the initial-letter placeholder.
    const needsPhotoFallback = isPublicPost && !finalOwnerPhotoUrl;
    const needsIdentityFallback = needsNameFallback || needsPhotoFallback;

    if (needsIdentityFallback) {
      // Fetch user's canonical profile for identity
      const userProfile = await ctx.db.get(ownerUserId);
      if (userProfile) {
        // Only overwrite name when name is actually missing — the photo-only
        // fallback path must not clobber a client-supplied display name.
        if (needsNameFallback) {
          // Prefer the user's display `name` over `handle` so the T/D identity
          // card matches what the client writes (and what profile cards show).
          // See matching change in `getTodDisplayName` for identity consistency.
          finalOwnerName = userProfile.name || userProfile.handle || undefined;
        }

        // Calculate age from dateOfBirth if not provided
        if (!finalOwnerAge && userProfile.dateOfBirth) {
          const birthDate = new Date(userProfile.dateOfBirth);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
          finalOwnerAge = age > 0 ? age : undefined;
        }

        // Use gender if not provided
        if (!finalOwnerGender && userProfile.gender) {
          finalOwnerGender = userProfile.gender;
        }

        // Use primary photo if no photo provided
        if (!finalOwnerPhotoUrl && userProfile.primaryPhotoUrl) {
          finalOwnerPhotoUrl = userProfile.primaryPhotoUrl;
        }

        debugTodLog(`[T/D] Server-side identity fallback: name=${finalOwnerName}, age=${finalOwnerAge}, gender=${finalOwnerGender}, hasPhoto=${!!finalOwnerPhotoUrl}`);
      }
    }

    // Resolve & validate owner-attached prompt media (Phase-2). Mirrors the
    // canonical answer-side flow: validate the pendingUploads reference,
    // verify MIME + size limits via TOD_MEDIA_LIMITS, validate duration for
    // video/voice, then resolve the persisted Convex storage URL.
    let promptMediaUpload: ValidatedTodUploadReference | undefined;
    let promptMediaDurationSec: number | undefined;
    let resolvedPromptMediaMime: string | undefined;
    let resolvedPromptMediaUrl: string | undefined;
    let resolvedPromptMediaKind: TodUploadMediaKind | undefined;
    if (args.mediaStorageId) {
      const declaredKind = getTodUploadKindFromMedia(args.mediaMime, args.mediaKind);
      promptMediaUpload = await validateTodUploadReference(
        ctx,
        args.mediaStorageId,
        ownerUserId,
        declaredKind,
      );
      promptMediaDurationSec = validateTodMediaDurationSec(
        promptMediaUpload.kind,
        args.durationSec,
      );
      resolvedPromptMediaMime = promptMediaUpload.contentType;
      resolvedPromptMediaKind = promptMediaUpload.kind;
      const url = await ctx.storage.getUrl(args.mediaStorageId);
      if (!url) {
        throw new Error('Invalid media storage reference');
      }
      resolvedPromptMediaUrl = url;
    }

    const promptId = await ctx.db.insert('todPrompts', {
      type: args.type,
      text: promptText,
      isTrending: false, // User-created prompts are never trending
      ownerUserId, // TOD-001: Use resolved userId from authUserId
      answerCount: 0,
      activeCount: 0,
      createdAt: now,
      expiresAt,
      // Owner profile snapshot (default anonymous)
      isAnonymous: args.isAnonymous ?? true,
      photoBlurMode: args.photoBlurMode ?? 'none',
      ownerName: finalOwnerName,
      ownerPhotoUrl: finalOwnerPhotoUrl,
      ownerAge: finalOwnerAge,
      ownerGender: finalOwnerGender,
      // Owner-attached prompt media (only persisted when supplied)
      mediaKind: resolvedPromptMediaKind,
      mediaStorageId: args.mediaStorageId,
      mediaUrl: resolvedPromptMediaUrl,
      mediaMime: resolvedPromptMediaMime,
      fileSize: promptMediaUpload?.size,
      durationSec: promptMediaDurationSec,
      isFrontCamera: args.mediaStorageId ? args.isFrontCamera : undefined,
    });

    // Debug log for post creation
    const urlPrefix = finalOwnerPhotoUrl ? (finalOwnerPhotoUrl.startsWith('https://') ? 'https' : finalOwnerPhotoUrl.startsWith('http://') ? 'http' : 'other') : 'none';
    debugTodLog(`[T/D] Created prompt: id=${promptId}, type=${args.type}, isAnon=${args.isAnonymous ?? true}, photoBlurMode=${args.photoBlurMode ?? 'none'}, photoUrlPrefix=${urlPrefix}, identityFallback=${needsIdentityFallback}`);
    if (resolvedPromptMediaKind) {
      debugTodLog(`[T/D] Prompt media attached: kind=${resolvedPromptMediaKind}, size=${promptMediaUpload?.size}, durationSec=${promptMediaDurationSec ?? 'n/a'}`);
    }

    return { promptId, expiresAt };
  },
});

// Edit own prompt (text only - type cannot be changed)
export const editMyPrompt = mutation({
  args: {
    promptId: v.string(),
    authUserId: v.string(),
    newText: v.string(),
  },
  handler: async (ctx, { promptId, authUserId, newText }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');

    // Get the prompt
    const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
    if (!prompt) {
      throw new Error('Prompt not found');
    }
    if (isSystemTodOwnerId(prompt.ownerUserId)) {
      throw new Error('Prompt owner unavailable for private media');
    }

    // Verify ownership
    if (prompt.ownerUserId !== userId) {
      throw new Error('Unauthorized: you can only edit your own prompts');
    }

    // Check if expired
    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      throw new Error('Cannot edit expired prompts');
    }

    // Validate new text
    const validatedText = validatePromptText(newText);

    // Update prompt
    await ctx.db.patch(prompt._id, {
      text: validatedText,
    });

    debugTodLog(`[T/D] Edited prompt: id=${promptId}, newTextLength=${validatedText.length}`);

    return { success: true };
  },
});

// Delete own prompt (and all associated answers, reactions, reports)
export const deleteMyPrompt = mutation({
  args: {
    promptId: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { promptId, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');

    // Get the prompt
    const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
    if (!prompt) {
      throw new Error('Prompt not found');
    }

    // Verify ownership
    if (prompt.ownerUserId !== userId) {
      throw new Error('Unauthorized: you can only delete your own prompts');
    }

    // Delete all answers for this prompt
    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    for (const answer of answers) {
      const answerId = answer._id as unknown as string;

      await deleteStorageIfPresent(ctx, answer.mediaStorageId);

      const legacyLikes = await ctx.db
        .query('todAnswerLikes')
        .withIndex('by_answer', (q) => q.eq('answerId', answerId))
        .collect();
      for (const like of legacyLikes) {
        await ctx.db.delete(like._id);
      }

      // Delete all reactions for this answer
      const reactions = await ctx.db
        .query('todAnswerReactions')
        .withIndex('by_answer', (q) => q.eq('answerId', answerId))
        .collect();
      for (const reaction of reactions) {
        await ctx.db.delete(reaction._id);
      }

      // Delete all reports for this answer
      const reports = await ctx.db
        .query('todAnswerReports')
        .withIndex('by_answer', (q) => q.eq('answerId', answerId))
        .collect();
      for (const report of reports) {
        await ctx.db.delete(report._id);
      }

      // Delete all views for this answer
      const views = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer', (q) => q.eq('answerId', answerId))
        .collect();
      for (const view of views) {
        await ctx.db.delete(view._id);
      }

      // Delete the answer itself
      await ctx.db.delete(answer._id);
    }

    const promptReactions = await ctx.db
      .query('todPromptReactions')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const reaction of promptReactions) {
      await ctx.db.delete(reaction._id);
    }

    const promptReports = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const report of promptReports) {
      await ctx.db.delete(report._id);
    }

    const privateMediaItems = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const item of privateMediaItems) {
      await deleteStorageIfPresent(ctx, item.storageId);
      await ctx.db.delete(item._id);
    }

    // Delete all connect requests for this prompt
    const connectRequests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const req of connectRequests) {
      await ctx.db.delete(req._id);
    }

    // Delete the prompt itself
    await ctx.db.delete(prompt._id);

    debugTodLog(`[T/D] Deleted prompt: id=${promptId}, deletedAnswers=${answers.length}, deletedConnectRequests=${connectRequests.length}, deletedPrivateMedia=${privateMediaItems.length}`);

    return { success: true };
  },
});

// Get pending connect requests for current user (as recipient)
// Returns enriched data with sender profile for UI display
export const getPendingConnectRequests = query({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    const userId = await getOptionalAuthenticatedTodUserId(ctx, authUserId, 'getPendingConnectRequests');
    if (!userId) return [];

    const requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .order('desc')
      .collect();

    // Enrich with sender profile and prompt data
    const enriched = await Promise.all(
      requests.map(async (req) => {
        // fromUserId is stored as the Convex user id for this feature.
        const sender =
          await ctx.db.get(req.fromUserId as Id<'users'>) ??
          (await (async () => {
            const legacySenderId = await resolveUserIdByAuthId(ctx, req.fromUserId);
            return legacySenderId ? ctx.db.get(legacySenderId) : null;
          })());

        // Get prompt for context
        const prompt = await ctx.db
          .query('todPrompts')
          .filter((q) => q.eq(q.field('_id'), req.promptId as Id<'todPrompts'>))
          .first();
        if (!prompt) {
          return null;
        }

        if (await hasBlockBetween(ctx, req.fromUserId, userId as string)) {
          return null;
        }

        const senderIdentity = getPromptConnectIdentity(prompt, sender);

        return {
          _id: req._id,
          promptId: req.promptId,
          answerId: req.answerId,
          fromUserId: req.fromUserId,
          createdAt: req.createdAt,
          // Sender profile snapshot
          senderName: senderIdentity.name,
          senderPhotoUrl: senderIdentity.photoUrl,
          senderPhotoBlurMode: senderIdentity.photoBlurMode,
          senderIsAnonymous: senderIdentity.isAnonymous,
          senderAge: senderIdentity.age,
          senderGender: senderIdentity.gender,
          // Prompt context
          promptType: prompt?.type ?? 'truth',
          promptText: prompt?.text ?? '',
        };
      })
    );

    return enriched.filter((request): request is NonNullable<typeof request> => request !== null);
  },
});

// Cheap reactive count for the Phase-2 T/D request tray and badge surfaces.
export const getPendingTodConnectRequestsCount = query({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    const userId = await getOptionalAuthenticatedTodUserId(ctx, authUserId, 'getPendingTodConnectRequestsCount');
    if (!userId) return 0;

    const requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect();

    let count = 0;
    for (const req of requests) {
      if (await hasBlockBetween(ctx, req.fromUserId, userId as string)) {
        continue;
      }
      count += 1;
    }
    return count;
  },
});

// Rich inbox list for pending incoming Phase-2 Truth or Dare connect requests.
export const getPendingTodConnectRequestInbox = query({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    const userId = await getOptionalAuthenticatedTodUserId(ctx, authUserId, 'getPendingTodConnectRequestInbox');
    if (!userId) return [];

    const requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .order('desc')
      .collect();

    const enriched = await Promise.all(
      requests.map(async (req) => {
        let senderDbId: Id<'users'> | null = null;
        try {
          const direct = await ctx.db.get(req.fromUserId as Id<'users'>);
          if (direct) {
            senderDbId = direct._id;
          }
        } catch {
          // Legacy rows may carry auth ids instead of Convex ids.
        }
        if (!senderDbId) {
          senderDbId = await resolveUserIdByAuthId(ctx, req.fromUserId);
        }
        if (!senderDbId) {
          return null;
        }

        if (await hasBlockBetween(ctx, senderDbId as string, userId as string)) {
          return null;
        }

        const sender = await ctx.db.get(senderDbId);
        const prompt = await ctx.db.get(req.promptId as Id<'todPrompts'>);
        if (!prompt) {
          return null;
        }

        const senderIdentity = getPromptConnectIdentity(prompt, sender);
        const answer = await ctx.db.get(req.answerId as Id<'todAnswers'>);
        const answerIdentity = answer ? getNormalizedTodAnswerIdentity(answer) : null;
        const answerPreview =
          answer &&
          !answerIdentity?.isAnonymous &&
          answer.text &&
          answer.text.trim().length > 0
            ? answer.text.trim().slice(0, 180)
            : null;

        const connectionStatus = await findPhase2MatchConversationStatus(
          ctx,
          userId as Id<'users'>,
          senderDbId as Id<'users'>,
        );

        return {
          requestId: req._id as string,
          createdAt: req.createdAt,
          promptId: req.promptId,
          answerId: req.answerId,
          fromUserId: senderDbId as string,
          senderName: senderIdentity.name,
          senderPhotoUrl: senderIdentity.photoUrl,
          senderPhotoBlurMode: senderIdentity.photoBlurMode,
          senderIsAnonymous: senderIdentity.isAnonymous,
          senderAge: senderIdentity.age,
          senderGender: senderIdentity.gender,
          promptType: prompt.type,
          promptText: prompt.text,
          answerPreview,
          relationship: connectionStatus.isConnected
            ? {
                state: 'connected' as const,
                conversationId: connectionStatus.conversationId as string | undefined,
                matchId: connectionStatus.matchId as string | undefined,
              }
            : {
                state: 'none' as const,
              },
        };
      })
    );

    return enriched.filter((request): request is NonNullable<typeof request> => request !== null);
  },
});

// Send a T&D connect request (prompt owner → answer author)
export const sendTodConnectRequest = mutation({
  args: {
    promptId: v.string(),
    answerId: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { promptId, answerId, authUserId }) => {
    const fromUserId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');

    // Get prompt to verify ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      return { success: false, reason: 'Prompt not found' };
    }
    if (prompt.ownerUserId !== fromUserId) {
      return { success: false, reason: 'Only prompt owner can send connect' };
    }
    const fromUser = await ctx.db.get(fromUserId as Id<'users'>);
    if (!fromUser || fromUser.isBanned || fromUser.deletedAt || fromUser.phase2OnboardingCompleted !== true) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }

    // Get answer to find recipient
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (!answer) {
      return { success: false, reason: 'Answer not found' };
    }
    if (answer.promptId !== promptId) {
      return { success: false, reason: 'Answer does not belong to this prompt' };
    }
    if (
      isAnswerHiddenForViewer(answer, fromUserId) ||
      await hasViewerReportedAnswer(ctx, answerId, fromUserId)
    ) {
      return { success: false, reason: 'Connect unavailable for this answer' };
    }

    // Anonymous answers ARE connectable: identity is revealed only on accept.
    const toUserId = answer.userId;
    const toUser = await ctx.db.get(toUserId as Id<'users'>);
    if (!toUser || toUser.isBanned || toUser.deletedAt || toUser.phase2OnboardingCompleted !== true) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }

    // Cannot connect to self
    if (toUserId === fromUserId) {
      return { success: false, reason: 'Cannot connect to yourself' };
    }

    if (await hasBlockBetween(ctx, fromUserId as string, toUserId as string)) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }

    const existingConnection = await findPhase2MatchConversationStatus(
      ctx,
      fromUserId as Id<'users'>,
      toUserId as Id<'users'>,
    );
    if (existingConnection.isConnected) {
      return {
        success: true,
        action: 'already_connected' as const,
        conversationId: existingConnection.conversationId as string | null,
        matchId: existingConnection.matchId as string | undefined,
        alreadyMatched: true,
        source: 'truth_dare' as const,
      };
    }

    // One request per recipient per prompt. Do not use the pair-wide index
    // here: the prompt owner may have multiple prompts with the same commenter,
    // but must not spam the same commenter repeatedly from this prompt.
    const existing = await findTodConnectRequestForPromptPair(
      ctx,
      promptId,
      fromUserId as string,
      toUserId as string,
    );

    if (existing) {
      console.log('[TOD_CONNECT_SEND] Duplicate prompt request:', {
        from: (fromUserId as string).slice(-8),
        to: (toUserId as string).slice(-8),
        promptId,
        status: existing.status,
      });
      return {
        success: true,
        action: getTodConnectDuplicateAction(existing.status),
        requestId: existing._id as string,
      };
    }

    const reverseExisting = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', toUserId).eq('toUserId', fromUserId))
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'connected')
        )
      )
      .first();

    if (reverseExisting) {
      // Reverse request exists: surface it instead of erroring so UI can prompt accept.
      console.log('[TOD_CONNECT_SEND] Reverse request exists:', {
        from: (fromUserId as string).slice(-8),
        to: (toUserId as string).slice(-8),
        reverseRequestId: reverseExisting._id,
        status: reverseExisting.status,
      });
      return {
        success: true,
        action: reverseExisting.status === 'connected' ? 'already_connected' : 'reverse_pending',
        reverseRequestId: reverseExisting._id as string,
      };
    }

    const rateCheck = await checkRateLimit(ctx, fromUserId, 'connect');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }

    // Create connect request
    const requestId = await ctx.db.insert('todConnectRequests', {
      promptId,
      answerId,
      fromUserId,
      toUserId,
      status: 'pending',
      createdAt: Date.now(),
    });

    console.log('[TOD_CONNECT_SEND] Created request:', {
      requestId,
      from: (fromUserId as string).slice(-8),
      to: (toUserId as string).slice(-8),
      promptId,
      answerId,
    });

    // Phase-2 in-app notification for the recipient (toUser).
    // STRICT ISOLATION: Phase-2 rows live in `privateNotifications` only.
    // T&D is a Deep Connect–adjacent flow, so we gate on the deepConnect preference.
    // Body is identity-safe because T&D answers may be anonymous; identity is
    // revealed only on accept (see respondToConnect).
    if (await shouldCreatePhase2DeepConnectNotification(ctx, toUserId as Id<'users'>)) {
      const now = Date.now();
      await ctx.db.insert('privateNotifications', {
        userId: toUserId as Id<'users'>,
        type: 'phase2_deep_connect',
        title: 'New Truth or Dare connect',
        body: 'Someone wants to connect on your answer.',
        data: {
          otherUserId: fromUserId as string,
          threadId: requestId as string,
        },
        phase: 'phase2',
        dedupeKey: `p2_tod_request:${requestId}`,
        createdAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      });
    }

    return { success: true, action: 'pending' as const, requestId: requestId as string };
  },
});

// Respond to connect request (Connect or Remove)
// Creates conversation in Phase-2 privateConversations for both users
export const respondToConnect = mutation({
  args: {
    requestId: v.id('todConnectRequests'),
    action: v.union(v.literal('connect'), v.literal('remove')),
    authUserId: v.string(),
  },
  handler: async (ctx, { requestId, action, authUserId }) => {
    const recipientDbId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');

    const request = await ctx.db.get(requestId);
    if (!request || request.status !== 'pending') {
      return { success: false, reason: 'Request not found or already processed' };
    }

    // Only the intended recipient can respond
    if (request.toUserId !== recipientDbId) {
      throw new Error('Unauthorized: only the request recipient can respond');
    }

    if (action === 'connect') {
      const prompt = await ctx.db.get(request.promptId as Id<'todPrompts'>);
      if (!prompt || isSystemTodOwnerId(prompt.ownerUserId)) {
        return { success: false, reason: 'Prompt unavailable for connect' };
      }

      const answer = await ctx.db
        .query('todAnswers')
        .filter((q) => q.eq(q.field('_id'), request.answerId as Id<'todAnswers'>))
        .first();
      const privateMedia = answer
        ? null
        : await ctx.db
            .query('todPrivateMedia')
            .filter((q) => q.eq(q.field('_id'), request.answerId as Id<'todPrivateMedia'>))
            .first();

      if (prompt.ownerUserId !== request.fromUserId) {
        return { success: false, reason: 'Connect request is no longer valid' };
      }
      if (answer && answer.userId !== recipientDbId) {
        return { success: false, reason: 'Connect request is no longer valid' };
      }
      if (privateMedia && privateMedia.fromUserId !== recipientDbId) {
        return { success: false, reason: 'Connect request is no longer valid' };
      }

      // P1-5: request.fromUserId is the Convex users-table id stored as a string at send time.
      // Resolve directly; fall back to lookup-by-authId only if direct fetch fails.
      let senderDbId: Id<'users'> | null = null;
      try {
        const direct = await ctx.db.get(request.fromUserId as Id<'users'>);
        if (direct) {
          senderDbId = direct._id;
        }
      } catch {
        // Not a valid Convex ID format - fall through.
      }
      if (!senderDbId) {
        senderDbId = await resolveUserIdByAuthId(ctx, request.fromUserId);
      }
      if (!senderDbId) {
        console.log('[TOD_CONNECT_RESPOND] Sender not found:', {
          requestId,
          fromUserId: request.fromUserId,
        });
        return { success: false, reason: 'Sender user not found' };
      }

      if (await hasBlockBetween(ctx, senderDbId as string, recipientDbId as string)) {
        console.log('[TOD_CONNECT_RESPOND] Blocked between users:', {
          sender: (senderDbId as string).slice(-8),
          recipient: (recipientDbId as string).slice(-8),
        });
        return { success: false, reason: 'Connect unavailable for this user' };
      }

      // Get sender + recipient profiles for response
      const sender = await ctx.db.get(senderDbId as Id<'users'>);
      const recipient = await ctx.db.get(recipientDbId as Id<'users'>);

      const senderIdentity = getPromptConnectIdentity(prompt, sender);
      const recipientIdentity = answer
        ? getAnswerConnectIdentity(answer, recipient)
        : getDefaultConnectIdentity(recipient);
      // Anonymous identity is allowed: identity is revealed on accept by design.

      const now = Date.now();
      const ensured = await ensurePhase2MatchAndConversation(ctx, {
        userAId: senderDbId as Id<'users'>,
        userBId: recipientDbId as Id<'users'>,
        now,
        source: 'truth_dare',
        // The privateMatches schema stores Deep Connect-like match kinds.
        // The public response below carries the T/D source for UI behavior.
        matchKind: 'like',
        connectionSource: 'tod',
        reactivateInactive: true,
        unhideExistingConversation: true,
        updateLastMessageAt: true,
        existingConversationMeansAlreadyMatched: true,
      });

      const matchId = ensured.matchId;
      const conversationId = ensured.conversationId;
      const conversationCreated = ensured.conversationCreated;

      if (conversationCreated) {
        await ctx.db.insert('privateMessages', {
          conversationId,
          senderId: recipientDbId as Id<'users'>,
          type: 'system',
          content: '[SYSTEM:truthdare]T&D connection accepted! Say hi!',
          createdAt: now,
        });

        const senderParticipant = await ctx.db
          .query('privateConversationParticipants')
          .withIndex('by_user_conversation', (q) =>
            q.eq('userId', senderDbId as Id<'users'>).eq('conversationId', conversationId)
          )
          .first();
        if (senderParticipant) {
          await ctx.db.patch(senderParticipant._id, {
            unreadCount: senderParticipant.unreadCount + 1,
          });
        }
      }

      console.log('[TOD_CONNECT_RESPOND] Accepted:', {
        requestId,
        matchId,
        conversationId,
        conversationCreated,
        alreadyMatched: ensured.alreadyMatched,
        sender: (senderDbId as string).slice(-8),
        recipient: (recipientDbId as string).slice(-8),
      });

      if (privateMedia) {
        await ctx.db.patch(privateMedia._id, {
          connectStatus: 'accepted',
        });
      }
      await ctx.db.patch(requestId, { status: 'connected' });

      // Phase-2 in-app notification for the inviter (sender) confirming the
      // T&D connect was accepted and a Phase-2 conversation now exists.
      // STRICT ISOLATION: Phase-2 rows live in `privateNotifications` only.
      if (!ensured.alreadyMatched) {
        await createPhase2MatchNotificationIfMissing(ctx, {
          userId: senderDbId as Id<'users'>,
          matchId,
          conversationId,
          title: 'Truth or Dare connect accepted',
          body: `${recipientIdentity.name} accepted your T&D connect.`,
          data: {
            otherUserId: recipientDbId as string,
          },
          now,
        });
      }

      return {
        success: true,
        action: 'connected' as const,
        conversationId: conversationId as string,
        matchId: matchId as string,
        source: 'truth_dare' as const,
        alreadyMatched: ensured.alreadyMatched,
        // Sender profile (for recipient's display)
        senderUserId: request.fromUserId,
        senderDbId: senderDbId as string,
        senderName: senderIdentity.name,
        senderPhotoUrl: senderIdentity.photoUrl,
        senderPhotoBlurMode: senderIdentity.photoBlurMode,
        senderIsAnonymous: senderIdentity.isAnonymous,
        senderAge: senderIdentity.age,
        senderGender: senderIdentity.gender,
        // Recipient profile (for sender's display when they query)
        recipientUserId: recipientDbId as string,
        recipientDbId: recipientDbId as string,
        recipientName: recipientIdentity.name,
        recipientPhotoUrl: recipientIdentity.photoUrl,
        recipientPhotoBlurMode: recipientIdentity.photoBlurMode,
        recipientIsAnonymous: recipientIdentity.isAnonymous,
        recipientAge: recipientIdentity.age,
        recipientGender: recipientIdentity.gender,
      };
    } else {
      const privateMedia = await ctx.db
        .query('todPrivateMedia')
        .filter((q) => q.eq(q.field('_id'), request.answerId as Id<'todPrivateMedia'>))
        .first();
      if (privateMedia) {
        await ctx.db.patch(privateMedia._id, {
          connectStatus: 'rejected',
        });
      }
      await ctx.db.patch(requestId, { status: 'removed' });
      console.log('[TOD_CONNECT_RESPOND] Removed:', {
        requestId,
        recipient: (recipientDbId as string).slice(-8),
      });
      return { success: true, action: 'removed' as const };
    }
  },
});

// Check if a connect request exists between prompt owner and answer author
export const checkTodConnectStatus = query({
  args: {
    promptId: v.string(),
    answerId: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { promptId, answerId, authUserId }) => {
    const userId = await getOptionalAuthenticatedTodUserId(ctx, authUserId, 'checkTodConnectStatus');
    if (!userId) return { status: 'none' as const };

    // Get the answer to find the other user
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (!answer) return { status: 'none' as const };

    // Check for request from current user to answer author on this prompt.
    const requestSent = await findTodConnectRequestForPromptPair(
      ctx,
      promptId,
      userId as string,
      answer.userId,
    );

    if (requestSent) {
      return { status: requestSent.status };
    }

    // Check for request from answer author to current user on this prompt.
    const requestReceived = await findTodConnectRequestForPromptPair(
      ctx,
      promptId,
      answer.userId,
      userId as string,
    );

    if (requestReceived) {
      return { status: requestReceived.status };
    }

    return { status: 'none' as const };
  },
});

// Seed default trending prompts (call once)
// TOD-007 FIX: Converted to internal mutation - not exposed to clients
export const seedTrendingPrompts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('todPrompts')
      .withIndex('by_trending', (q) => q.eq('isTrending', true))
      .collect();
    if (existing.length >= 2) return;

    const now = Date.now();
    await ctx.db.insert('todPrompts', {
      type: 'truth',
      text: "What's the most spontaneous thing you've ever done for someone you liked?",
      isTrending: true,
      ownerUserId: TOD_SYSTEM_OWNER_ID,
      answerCount: 42,
      activeCount: 18,
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS,
    });

    await ctx.db.insert('todPrompts', {
      type: 'dare',
      text: 'Record a 15-second video of your best impression of your celebrity crush!',
      isTrending: true,
      ownerUserId: TOD_SYSTEM_OWNER_ID,
      answerCount: 27,
      activeCount: 11,
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS,
    });
  },
});

// Cleanup expired prompts and their answers + media
// TOD-010 FIX: Converted to internal mutation - only callable by cron/scheduler
export const cleanupExpiredPrompts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const BATCH = 200;
    const expiredPrompts = await ctx.db
      .query('todPrompts')
      .withIndex('by_expires', (q) => q.lte('expiresAt', now))
      .take(BATCH);
    let deleted = 0;

    for (const prompt of expiredPrompts) {
      const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires > now) continue;

      // Delete all answers for this prompt
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as string))
        .collect();

      const privateMediaItems = await ctx.db
        .query('todPrivateMedia')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as string))
        .collect();
      for (const privateMedia of privateMediaItems) {
        await deleteStorageIfPresent(ctx, privateMedia.storageId);
        await ctx.db.delete(privateMedia._id);
      }

      for (const answer of answers) {
        await deleteTodAnswerForCleanup(ctx, answer);
      }

      const promptReactions = await ctx.db
        .query('todPromptReactions')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as string))
        .collect();
      for (const reaction of promptReactions) {
        await ctx.db.delete(reaction._id);
      }

      const promptReports = await ctx.db
        .query('todPromptReports')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as string))
        .collect();
      for (const report of promptReports) {
        await ctx.db.delete(report._id);
      }

      const connects = await ctx.db
        .query('todConnectRequests')
        .withIndex('by_prompt', (q) => q.eq('promptId', prompt._id as string))
        .collect();
      for (const connect of connects) {
        await ctx.db.delete(connect._id);
      }

      // Delete the prompt itself
      await ctx.db.delete(prompt._id);
      deleted++;
    }

    return { deleted };
  },
});

// Generate upload URL for media
export const generateUploadUrl = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');
    const rateCheck = await checkRateLimit(ctx, userId, 'media_upload');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }
    return await ctx.storage.generateUploadUrl();
  },
});

// ============================================================
// LEGACY PRIVATE MEDIA V1 (not used by the active Phase-2 tab flow)
// Retained only for backward compatibility with older data/tooling.
// Active Phase-2 prompt answers use todAnswers + claimAnswerMediaView instead.
// ============================================================

/**
 * Submit a private photo/video response to a prompt.
 * Only the prompt owner can ever view this media.
 * Replaces any existing pending media from the same user.
 */
export const submitPrivateMediaResponse = mutation({
  args: {
    promptId: v.string(),
    fromUserId: v.string(),
    mediaType: v.union(v.literal('photo'), v.literal('video')),
    storageId: v.id('_storage'),
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))), // tap = tap once, hold = hold to view
    durationSec: v.optional(v.number()), // 1-60 seconds, default 20
    // Responder profile info for display
    responderName: v.optional(v.string()),
    responderAge: v.optional(v.number()),
    responderGender: v.optional(v.string()),
    responderPhotoUrl: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fromUserId = await requireAuthenticatedTodUserId(ctx, args.authUserId, 'Unauthorized');

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      throw new Error('Prompt not found');
    }

    const mediaUpload = await validateTodUploadReference(
      ctx,
      args.storageId,
      fromUserId,
      args.mediaType
    );
    const viewDurationSec = validateViewDuration(args.durationSec ?? 20) ?? 20;

    // Check for existing pending media from this user for this prompt
    const existing = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_prompt_from', (q) =>
        q.eq('promptId', args.promptId).eq('fromUserId', fromUserId)
      )
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .first();

    // If existing, delete old storage and remove record (replace policy)
    if (existing) {
      if (existing.storageId) {
        await ctx.storage.delete(existing.storageId);
      }
      await ctx.db.delete(existing._id);
    }

    // Create new private media record with 24h expiry
    const now = Date.now();
    const id = await ctx.db.insert('todPrivateMedia', {
      promptId: args.promptId,
      fromUserId,
      toUserId: prompt.ownerUserId,
      mediaType: args.mediaType,
      storageId: args.storageId,
      fileSize: mediaUpload.size,
      viewMode: args.viewMode ?? 'tap', // default to tap-to-view
      durationSec: viewDurationSec,
      status: 'pending',
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS, // 24h auto-delete
      connectStatus: 'none',
      responderName: args.responderName,
      responderAge: args.responderAge,
      responderGender: args.responderGender,
      responderPhotoUrl: args.responderPhotoUrl,
    });

    return { id, success: true };
  },
});

/**
 * Get private media items for a prompt (owner only).
 * Returns metadata only, NOT the media URL.
 */
export const getPrivateMediaForOwner = query({
  args: {
    promptId: v.string(),
    viewerUserId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { promptId, viewerUserId, authUserId }) => {
    const currentUserId = await getOptionalAuthenticatedTodUserId(ctx, authUserId ?? viewerUserId, 'getPrivateMediaForOwner');
    if (!currentUserId) return [];

    // Get the prompt to verify ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return [];
    if (isSystemTodOwnerId(prompt.ownerUserId)) return [];

    // Only prompt owner can see private media
    if (prompt.ownerUserId !== currentUserId) {
      return [];
    }

    // Get all private media for this prompt
    const items = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    // Return metadata without storage URLs
    return items.map((item) => ({
      _id: item._id,
      fromUserId: item.fromUserId,
      mediaType: item.mediaType,
      viewMode: item.viewMode, // 'tap' or 'hold'
      durationSec: item.durationSec,
      status: item.status,
      createdAt: item.createdAt,
      viewedAt: item.viewedAt,
      expiresAt: item.expiresAt,
      connectStatus: item.connectStatus,
      responderName: item.responderName,
      responderAge: item.responderAge,
      responderGender: item.responderGender,
      responderPhotoUrl: item.responderPhotoUrl,
      // NEVER include storageId or URL here
    }));
  },
});

/**
 * Begin viewing private media (owner only).
 * Returns a short-lived URL without durably consuming the one-time view.
 * Durable consumption happens in finalizePrivateMediaView after successful display.
 */
export const beginPrivateMediaView = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    viewerUserId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { privateMediaId, viewerUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, authUserId ?? viewerUserId, 'Unauthorized');
    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // AUTH CHECK: Only prompt owner can view
    if (item.toUserId !== currentUserId) {
      throw new Error('Access denied: You are not the prompt owner');
    }

    if (await hasBlockBetween(ctx, currentUserId as string, item.fromUserId)) {
      throw new Error('Access denied');
    }

    // Allow retrying records that were previously stuck in the old pre-finalize "viewing" state.
    if (item.status !== 'pending' && item.status !== 'viewing') {
      throw new Error('Media already viewed or expired');
    }

    // Ensure storageId exists
    if (!item.storageId) {
      throw new Error('Media file not found');
    }

    // Generate short-lived URL (Convex URLs expire automatically)
    const url = await ctx.storage.getUrl(item.storageId);
    if (!url) {
      throw new Error('Failed to generate media URL');
    }

    const now = Date.now();
    const expiresAt = now + item.durationSec * 1000;

    return {
      url,
      mediaType: item.mediaType,
      viewMode: item.viewMode, // 'tap' or 'hold' - frontend enforces this
      durationSec: item.durationSec,
      expiresAt,
    };
  },
});

/**
 * Finalize private media view (called when timer ends or user closes).
 * Deletes the storage file and durably consumes the one-time view.
 */
export const finalizePrivateMediaView = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    viewerUserId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { privateMediaId, viewerUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, authUserId ?? viewerUserId, 'Unauthorized');
    const item = await ctx.db.get(privateMediaId);
    if (!item) return { success: false };

    // AUTH CHECK: Only prompt owner can finalize
    if (item.toUserId !== currentUserId) {
      throw new Error('Access denied');
    }

    if (await hasBlockBetween(ctx, currentUserId as string, item.fromUserId)) {
      throw new Error('Access denied');
    }

    const finalizedAt = Date.now();

    // Delete storage file if exists
    await deleteStorageIfPresent(ctx, item.storageId);

    // Mark as deleted
    await ctx.db.patch(privateMediaId, {
      status: 'deleted',
      viewedAt: finalizedAt,
      expiresAt: finalizedAt,
      storageId: undefined,
    });

    return { success: true };
  },
});

/**
 * Send connect request after viewing private media.
 * Creates a pending request to the responder.
 */
export const sendPrivateMediaConnect = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    fromUserId: v.string(), // prompt owner sending the request
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { privateMediaId, fromUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, authUserId ?? fromUserId, 'Unauthorized');
    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // Only prompt owner can send connect
    if (item.toUserId !== currentUserId) {
      throw new Error('Access denied');
    }

    // Can only connect if not already connected/pending
    if (item.connectStatus !== 'none') {
      return { success: false, reason: 'Already processed' };
    }

    const rateCheck = await checkRateLimit(ctx, currentUserId, 'connect');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }

    // Update connect status
    await ctx.db.patch(privateMediaId, {
      connectStatus: 'pending',
    });

    // Create a connect request in todConnectRequests
    await ctx.db.insert('todConnectRequests', {
      promptId: item.promptId,
      answerId: item._id as string, // using privateMediaId as reference
      fromUserId: currentUserId, // prompt owner
      toUserId: item.fromUserId, // responder
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Reject/remove a private media connect opportunity.
 */
export const rejectPrivateMediaConnect = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    fromUserId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { privateMediaId, fromUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, authUserId ?? fromUserId, 'Unauthorized');
    const item = await ctx.db.get(privateMediaId);
    if (!item) return { success: false };

    // Only prompt owner can reject
    if (item.toUserId !== currentUserId) {
      throw new Error('Access denied');
    }

    await ctx.db.patch(privateMediaId, {
      connectStatus: 'rejected',
    });

    return { success: true };
  },
});

/**
 * Cleanup expired private media (called periodically).
 * Deletes storage and marks records where timer expired.
 * TOD-P1-003 FIX: Converted to internalMutation - only callable by cron/scheduler
 */
export const cleanupExpiredPrivateMedia = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find items that are viewing and past expiry
    const expiredViewing = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_status', (q) => q.eq('status', 'viewing'))
      .collect();

    let cleaned = 0;
    for (const item of expiredViewing) {
      if (item.expiresAt && item.expiresAt < now) {
        // Delete storage
        if (item.storageId) {
          try {
            await ctx.storage.delete(item.storageId);
          } catch { /* already deleted */ }
        }
        // Mark as expired
        await ctx.db.patch(item._id, {
          status: 'expired',
          storageId: undefined,
        });
        cleaned++;
      }
    }

    // Also cleanup very old pending items (> 24 hours)
    const oldPending = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect();

    for (const item of oldPending) {
      if (item.createdAt < now - TWENTY_FOUR_HOURS_MS) {
        if (item.storageId) {
          try {
            await ctx.storage.delete(item.storageId);
          } catch { /* already deleted */ }
        }
        await ctx.db.patch(item._id, {
          status: 'expired',
          storageId: undefined,
        });
        cleaned++;
      }
    }

    return { cleaned };
  },
});

// ============================================================
// COMPREHENSIVE CLEANUP (for cron job)
// ============================================================

/**
 * cleanupExpiredTodData - Internal mutation for cron job
 *
 * Cascade deletes all expired Truth/Dare data:
 * 1) Find expired todPrompts where expiresAt <= now
 * 2) For each expired prompt:
 *    - Delete all todPrivateMedia (storage first, then record)
 *    - Delete all todAnswerLikes for answers
 *    - Delete all todConnectRequests for the prompt
 *    - Delete all todAnswers (storage first, then record)
 *    - Finally delete the todPrompts record
 */
export const cleanupExpiredTodData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const BATCH = 200;
    const expiredPrompts = await ctx.db
      .query('todPrompts')
      .withIndex('by_expires', (q) => q.lte('expiresAt', now))
      .take(BATCH);

    let deletedPrompts = 0;
    let deletedAnswers = 0;
    let deletedLikes = 0;
    let deletedConnects = 0;
    let deletedPrivateMedia = 0;

    for (const prompt of expiredPrompts) {
      const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires > now) continue; // Not expired

      const promptIdStr = prompt._id as string;

      // 1) Delete all todPrivateMedia for this prompt
      const privateMedia = await ctx.db
        .query('todPrivateMedia')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();

      for (const pm of privateMedia) {
        await deleteStorageIfPresent(ctx, pm.storageId);
        await ctx.db.delete(pm._id);
        deletedPrivateMedia++;
      }

      // 2) Get all answers for this prompt
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();

      for (const answer of answers) {
        const likes = await ctx.db
          .query('todAnswerLikes')
          .withIndex('by_answer', (q) => q.eq('answerId', answer._id as string))
          .collect();
        deletedLikes += likes.length;
        await deleteTodAnswerForCleanup(ctx, answer);
        deletedAnswers++;
      }

      const promptReactions = await ctx.db
        .query('todPromptReactions')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();
      for (const reaction of promptReactions) {
        await ctx.db.delete(reaction._id);
      }

      const promptReports = await ctx.db
        .query('todPromptReports')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();
      for (const report of promptReports) {
        await ctx.db.delete(report._id);
      }

      // 3) Delete all connect requests for this prompt
      const connects = await ctx.db
        .query('todConnectRequests')
        .filter((q) => q.eq(q.field('promptId'), promptIdStr))
        .collect();
      for (const cr of connects) {
        await ctx.db.delete(cr._id);
        deletedConnects++;
      }

      // 4) Finally delete the prompt itself
      await ctx.db.delete(prompt._id);
      deletedPrompts++;
    }

    // Also cleanup orphaned private media past 24h expiry
    const allPrivateMedia = await ctx.db
      .query('todPrivateMedia')
      .collect();

    for (const pm of allPrivateMedia) {
      const pmExpires = pm.expiresAt ?? pm.createdAt + TWENTY_FOUR_HOURS_MS;
      if (pmExpires <= now) {
        await deleteStorageIfPresent(ctx, pm.storageId);
        await ctx.db.delete(pm._id);
        deletedPrivateMedia++;
      }
    }

    return {
      deletedPrompts,
      deletedAnswers,
      deletedLikes,
      deletedConnects,
      deletedPrivateMedia,
    };
  },
});

// ============================================================
// GLOBAL FEED & THREAD QUERIES
// ============================================================

/**
 * Owner-only prompt history for "My Truth & Dare".
 *
 * Returns prompt metadata and aggregate counts only. It intentionally does not
 * return answer text, answer author identity, media URLs, report details, or
 * private moderation internals.
 */
export const getMyPrompts = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    const ownerUserId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');
    const now = Date.now();

    const prompts = await ctx.db
      .query('todPrompts')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
      .collect();

    prompts.sort((a, b) => b.createdAt - a.createdAt);
    const cappedPrompts = prompts.slice(0, 60);

    return await Promise.all(
      cappedPrompts.map(async (prompt) => {
        const promptId = prompt._id as unknown as string;
        const answers = await ctx.db
          .query('todAnswers')
          .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
          .collect();

        const expiresAt = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
        const moderationStatus =
          prompt.moderationStatus ??
          moderationStatusForTodReportCount(prompt.uniqueReportCount ?? prompt.reportCount ?? 0);

        return {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          createdAt: prompt.createdAt,
          expiresAt,
          isExpired: expiresAt <= now,
          answerCount: answers.length,
          totalReactionCount: prompt.totalReactionCount ?? 0,
          moderationStatus,
          hiddenByReportsAt: prompt.hiddenByReportsAt,
          moderationStatusAt: prompt.moderationStatusAt,
          editedAt: (prompt as any).editedAt,
          hasMedia: answers.some(
            (answer) =>
              answer.type !== 'text' &&
              (Boolean(answer.mediaStorageId) || Boolean(answer.mediaUrl)),
          ),
        };
      }),
    );
  },
});

/**
 * List all active (non-expired) prompts with up to 2 ranked preview answers.
 * Preview-answer ordering uses totalReactionCount DESC, then createdAt DESC.
 * Respects hidden-by-reports logic for non-authors.
 */
export const listActivePromptsWithTop2Answers = query({
  args: {
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { viewerUserId }) => {
    const now = Date.now();
    const viewerDbId = await getOptionalAuthenticatedTodUserId(ctx, viewerUserId, 'listActivePromptsWithTop2Answers');

    // TOD-P2-002 FIX: Get blocked user IDs for viewer (both directions)
    const [blockedUserIds, reportedPromptIds, reportedAnswerIds] = await Promise.all([
      getBlockedUserIdsForViewer(ctx, viewerDbId),
      getTodPromptIdsReportedByViewer(ctx, viewerDbId),
      getTodAnswerIdsReportedByViewer(ctx, viewerDbId),
    ]);

    // Get recent prompts first, then apply the existing visibility filters below.
    const allPrompts = await ctx.db
      .query('todPrompts')
      .withIndex('by_created', (q) =>
        q.gt('createdAt', now - TWENTY_FOUR_HOURS_MS)
      )
      .order('desc')
      .take(180);

    // Filter to active (not expired) and not from blocked users
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires <= now) return false;
      // TOD-P2-002 FIX: Filter out prompts from blocked users
      if (blockedUserIds.has(p.ownerUserId as string)) return false;
      if (reportedPromptIds.has(p._id as unknown as string)) return false;
      if (isPromptHiddenForViewer(p, viewerDbId)) return false;
      return true;
    });

    // Sort by answerCount DESC, then createdAt ASC (older first for ties)
    // Prompts with more answers float to top; ties = older appears first (new goes to bottom)
    activePrompts.sort((a, b) => {
      // Primary: answerCount DESC (more comments = higher)
      if (b.answerCount !== a.answerCount) return b.answerCount - a.answerCount;
      // Secondary: createdAt ASC (older first, new prompts go to bottom)
      return a.createdAt - b.createdAt;
    });

    const cappedPrompts = activePrompts.slice(0, 60);

    // For each prompt, get up to 2 ranked preview answers
    const promptsWithAnswers = await Promise.all(
      cappedPrompts.map(async (prompt) => {
        const promptId = prompt._id as unknown as string;

        // Get a bounded set of answers for this prompt, then reuse existing filtering/ranking.
        const answers = await ctx.db
          .query('todAnswers')
          .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
          .take(10);

        // Filter: exclude report-hidden answers unless the viewer is the author.
        // TOD-P2-002 FIX: Also exclude answers from blocked users
        const visibleAnswers = answers.filter((a) => {
          // TOD-P2-002 FIX: Filter out answers from blocked users
          if (blockedUserIds.has(a.userId as string)) return false;
          if (reportedAnswerIds.has(a._id as unknown as string)) return false;
          return !isAnswerHiddenForViewer(a, viewerDbId);
        });

        visibleAnswers.sort(sortTodAnswersByDisplayRank);

        // Take up to 2 ranked preview answers
        const top2 = visibleAnswers.slice(0, 2);

        // Get reaction counts for each answer
        const top2WithReactions = await Promise.all(
          top2.map(async (answer) => {
            const answerId = answer._id as unknown as string;
            const normalizedIdentity = getNormalizedTodAnswerIdentity(answer);
            const { reactionCounts, myReaction } = await getAnswerReactionSummary(
              ctx,
              answerId,
              answer.totalReactionCount ?? 0,
              viewerDbId
            );

            return {
              _id: answer._id,
              promptId: answer.promptId,
              type: answer.type,
              text: answer.text,
              mediaUrl: getInlineAnswerMediaUrlForViewer(
                answer,
                viewerDbId,
                prompt.ownerUserId as string
              ),
              durationSec: answer.durationSec,
              createdAt: answer.createdAt,
              editedAt: answer.editedAt,
              totalReactionCount: answer.totalReactionCount ?? 0,
              reactionCounts,
              myReaction,
              isAnonymous: normalizedIdentity.isAnonymous,
              authorName: normalizedIdentity.authorName,
              authorPhotoUrl: normalizedIdentity.authorPhotoUrl,
              authorAge: normalizedIdentity.authorAge,
              authorGender: normalizedIdentity.authorGender,
              photoBlurMode: normalizedIdentity.photoBlurMode,
              identityMode: normalizedIdentity.identityMode,
              isFrontCamera: answer.isFrontCamera ?? false,
              visibility: answer.visibility,
              viewMode: answer.viewMode,
              viewDurationSec: answer.viewDurationSec,
              isHiddenForOthers: isTodHiddenByReports(answer),
            };
          })
        );

        // Check if viewer has answered this prompt
        let hasAnswered = false;
        let myAnswerId: string | null = null;
        if (viewerDbId) {
          const myAnswer = answers.find((a) => a.userId === viewerDbId);
          if (myAnswer) {
            hasAnswered = true;
            myAnswerId = myAnswer._id as unknown as string;
          }
        }

        const promptIdStr = prompt._id as unknown as string;
        return {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          answerCount: prompt.answerCount,
          activeCount: prompt.activeCount,
          createdAt: prompt.createdAt,
          expiresAt: prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS,
          // Owner profile fields for feed display
          isAnonymous: prompt.isAnonymous,
          photoBlurMode: prompt.photoBlurMode, // FIX: Include blur mode for renderer
          ownerName: prompt.ownerName,
          ownerPhotoUrl: prompt.ownerPhotoUrl,
          ownerAge: prompt.ownerAge,
          ownerGender: prompt.ownerGender,
          ownerUserId: prompt.ownerUserId, // FIX: Include for owner detection in feed
          // Engagement metrics
          totalReactionCount: prompt.totalReactionCount ?? 0,
          // Owner-attached prompt media (Phase-2). Media follows prompt
          // visibility; `mediaStorageId` is intentionally omitted client-side
          // (already resolved into `mediaUrl` server-side).
          mediaKind: prompt.mediaKind,
          mediaUrl: prompt.mediaUrl,
          mediaMime: prompt.mediaMime,
          durationSec: prompt.durationSec,
          isFrontCamera: prompt.isFrontCamera ?? false,
          hasMedia: !!prompt.mediaStorageId,
          // Answers and viewer state
          top2Answers: top2WithReactions,
          totalAnswers: visibleAnswers.length,
          hasAnswered,
          myAnswerId,
        };
      })
    );

    return promptsWithAnswers;
  },
});

/**
 * Get trending Truth and Dare prompts (one of each type with highest engagement).
 * Used for the "🔥 Trending" section at top of feed.
 */
export const getTrendingTruthAndDare = query({
  args: {
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { viewerUserId }) => {
    const now = Date.now();
    const viewerDbId = await getOptionalAuthenticatedTodUserId(ctx, viewerUserId, 'getTrendingTruthAndDare');
    const [blockedUserIds, reportedPromptIds] = await Promise.all([
      getBlockedUserIdsForViewer(ctx, viewerDbId),
      getTodPromptIdsReportedByViewer(ctx, viewerDbId),
    ]);

    // Get bounded recent prompt candidates by type, then reuse the existing filters below.
    const [dareCandidates, truthCandidates] = await Promise.all([
      ctx.db
        .query('todPrompts')
        .withIndex('by_type_created', (q) =>
          q.eq('type', 'dare').gt('createdAt', now - TWENTY_FOUR_HOURS_MS)
        )
        .order('desc')
        .take(30),
      ctx.db
        .query('todPrompts')
        .withIndex('by_type_created', (q) =>
          q.eq('type', 'truth').gt('createdAt', now - TWENTY_FOUR_HOURS_MS)
        )
        .order('desc')
        .take(30),
    ]);
    const allPrompts = [...dareCandidates, ...truthCandidates];

    // Filter to active (not expired)
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      return (
        expires > now &&
        !blockedUserIds.has(p.ownerUserId as string) &&
        !reportedPromptIds.has(p._id as unknown as string) &&
        !isTodSuppressedFromHighVisibility(p) &&
        !isPromptHiddenForViewer(p, viewerDbId)
      );
    });

    // Separate by type
    const darePrompts = activePrompts.filter((p) => p.type === 'dare');
    const truthPrompts = activePrompts.filter((p) => p.type === 'truth');

    // Sort each by answerCount DESC, then createdAt DESC (newer wins ties)
    // Trending = highest engagement based on answer count
    const sortByEngagement = (a: typeof activePrompts[0], b: typeof activePrompts[0]) => {
      // Primary: answerCount DESC
      if (b.answerCount !== a.answerCount) return b.answerCount - a.answerCount;
      // Secondary: createdAt DESC (newer first)
      return b.createdAt - a.createdAt;
    };

    darePrompts.sort(sortByEngagement);
    truthPrompts.sort(sortByEngagement);

    // Get top 1 of each
    const topDare = darePrompts[0] ?? null;
    const topTruth = truthPrompts[0] ?? null;

    // Helper to format prompt for response
    const formatPrompt = (prompt: typeof activePrompts[0] | null) => {
      if (!prompt) return null;
      const promptId = prompt._id as unknown as string;
      return {
        _id: prompt._id,
        type: prompt.type,
        text: prompt.text,
        isTrending: true,
        answerCount: prompt.answerCount,
        activeCount: prompt.activeCount,
        createdAt: prompt.createdAt,
        expiresAt: prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS,
        // Owner profile fields
        isAnonymous: prompt.isAnonymous,
        photoBlurMode: prompt.photoBlurMode, // FIX: Include blur mode for renderer
        ownerName: prompt.ownerName,
        ownerPhotoUrl: prompt.ownerPhotoUrl,
        ownerAge: prompt.ownerAge,
        ownerGender: prompt.ownerGender,
        ownerUserId: prompt.ownerUserId, // FIX: Include for owner detection
        // Engagement metrics
        totalReactionCount: prompt.totalReactionCount ?? 0,
        // Owner-attached prompt media (Phase-2). Media follows prompt
        // visibility; `mediaStorageId` is intentionally omitted client-side
        // (already resolved into `mediaUrl` server-side).
        mediaKind: prompt.mediaKind,
        mediaUrl: prompt.mediaUrl,
        mediaMime: prompt.mediaMime,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        hasMedia: !!prompt.mediaStorageId,
      };
    };

    return {
      trendingDarePrompt: formatPrompt(topDare),
      trendingTruthPrompt: formatPrompt(topTruth),
    };
  },
});

/**
 * Get full thread for a prompt - all answers with reactions.
 * Respects hidden-by-reports: hidden answers only visible to their author.
 */
export const getPromptThread = query({
  args: {
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { promptId, viewerUserId }) => {
    const viewerDbId = await getOptionalAuthenticatedTodUserId(ctx, viewerUserId, 'getPromptThread');
    const blockedUserIds = await getBlockedUserIdsForViewer(ctx, viewerDbId);

    // Get prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return null;
    const promptIdStr = prompt._id as unknown as string;
    if (blockedUserIds.has(prompt.ownerUserId as string)) return null;
    if (isPromptHiddenForViewer(prompt, viewerDbId)) return null;
    if (await hasViewerReportedPrompt(ctx, promptIdStr, viewerDbId)) return null;

    // Check if expired
    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      return {
        prompt: {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          answerCount: prompt.answerCount,
          visibleAnswerCount: 0, // No visible answers when expired
          createdAt: prompt.createdAt,
          expiresAt: expires,
          isPromptOwner: !isSystemTodOwnerId(prompt.ownerUserId) && viewerDbId === prompt.ownerUserId,
          // Prompt-level reactions (empty for expired)
          reactionCounts: [],
          myReaction: null,
          // Owner profile snapshot
          isAnonymous: prompt.isAnonymous,
          photoBlurMode: prompt.photoBlurMode, // FIX: Include blur mode for renderer
          ownerName: prompt.ownerName,
          ownerPhotoUrl: prompt.ownerPhotoUrl,
          ownerAge: prompt.ownerAge,
          ownerGender: prompt.ownerGender,
          ownerUserId: prompt.ownerUserId, // FIX: Include for owner checks
          // Owner-attached prompt media (Phase-2). Media follows prompt
          // visibility — if the viewer can see this payload, they can see
          // the media. `mediaStorageId` is intentionally omitted client-side
          // (already resolved into `mediaUrl` server-side).
          mediaKind: prompt.mediaKind,
          mediaUrl: prompt.mediaUrl,
          mediaMime: prompt.mediaMime,
          fileSize: prompt.fileSize,
          durationSec: prompt.durationSec,
          isFrontCamera: prompt.isFrontCamera ?? false,
          hasMedia: !!prompt.mediaStorageId,
        },
        answers: [],
        isExpired: true,
      };
    }

    // Get all answers
    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    const reportedAnswerIds = await getTodAnswerIdsReportedByViewer(ctx, viewerDbId);

    // Filter hidden/reported answers. A hidden answer stays visible to its author.
    const visibleAnswers = answers.filter((a) => {
      if (blockedUserIds.has(a.userId as string)) return false;
      if (reportedAnswerIds.has(a._id as unknown as string)) return false;
      return !isAnswerHiddenForViewer(a, viewerDbId);
    });

    visibleAnswers.sort(sortTodAnswersByDisplayRank);

    // Get prompt-level reactions
    const promptReactions = await ctx.db
      .query('todPromptReactions')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    // Group by emoji for prompt reactions
    const promptEmojiCountMap: Map<string, number> = new Map();
    for (const r of promptReactions) {
      promptEmojiCountMap.set(r.emoji, (promptEmojiCountMap.get(r.emoji) || 0) + 1);
    }
    const promptReactionCounts = Array.from(promptEmojiCountMap.entries()).map(
      ([emoji, count]) => ({ emoji, count })
    );

    // Get viewer's prompt reaction
    let promptMyReaction: string | null = null;
    if (viewerDbId) {
      const myR = promptReactions.find((r) => r.userId === viewerDbId);
      if (myR) promptMyReaction = myR.emoji;
    }

    // Enrich with reactions
    const enrichedAnswers = await Promise.all(
      visibleAnswers.map(async (answer) => {
        const answerId = answer._id as unknown as string;
        const normalizedIdentity = getNormalizedTodAnswerIdentity(answer);
        // PHOTO-BLUR FALLBACK: `no_photo` mode intentionally does not persist
        // `authorPhotoUrl` in the snapshot (privacy — we don't cache the
        // photo), but the renderer needs a source URL to blur. When the
        // answer is non-anonymous and `photoBlurMode === 'blur'`, fetch the
        // author user record so we can supply `primaryPhotoUrl` at read
        // time. Same server-side fallback pattern used by the prompt create
        // flow at `finalOwnerPhotoUrl`.
        const needsBlurPhotoFallback =
          !normalizedIdentity.isAnonymous &&
          normalizedIdentity.photoBlurMode === 'blur' &&
          !normalizedIdentity.authorPhotoUrl;
        const authorProfileFallbackNeeded =
          !normalizedIdentity.isAnonymous &&
          (!normalizedIdentity.authorName ||
            normalizedIdentity.authorAge === undefined ||
            !normalizedIdentity.authorGender ||
            needsBlurPhotoFallback);
        const answerUser = authorProfileFallbackNeeded
          ? await ctx.db.get(answer.userId as Id<'users'>)
          : null;
        const { reactionCounts, myReaction } = await getAnswerReactionSummary(
          ctx,
          answerId,
          answer.totalReactionCount ?? 0,
          viewerDbId
        );

        // Reported answers are hidden above, so this flag remains false for visible rows.
        const hasReported = false;

        // Check if viewer has viewed this media (one-time view tracking)
        let hasViewedMedia = false;
        if (
          viewerDbId &&
          viewerDbId !== answer.userId &&
          answer.type !== 'voice' &&
          answer.mediaStorageId
        ) {
          const viewRecord = await ctx.db
            .query('todAnswerViews')
            .withIndex('by_answer_viewer', (q) =>
              q.eq('answerId', answerId).eq('viewerUserId', viewerDbId)
            )
            .first();
          hasViewedMedia = viewRecord?.viewedAt !== undefined;
        }

        // Author-only media view count for own photo/video answers.
        // Voice answers never write `todAnswerViews`, so we skip them.
        // todAnswerViews rows are unique per (answerId, viewerUserId) because
        // `claimAnswerMediaView` inserts only when no row exists for the
        // (answer, viewer) pair, and skips author self-views entirely.
        let viewCount: number | undefined;
        if (
          viewerDbId &&
          viewerDbId === answer.userId &&
          (answer.type === 'photo' || answer.type === 'video') &&
          answer.mediaStorageId
        ) {
          const viewRows = await ctx.db
            .query('todAnswerViews')
            .withIndex('by_answer', (q) => q.eq('answerId', answerId))
            .collect();
          viewCount = viewRows.length;
        }

        // Check if viewer (as prompt owner) has sent a connect request for
        // this prompt/commenter pair. Scope this to the prompt so a request
        // on another prompt does not incorrectly hide this prompt's Connect
        // affordance. Accepted private relationships are still global.
        let hasSentConnect = false;
        let connectStatus: 'none' | 'pending' | 'connected' | 'removed' = 'none';
        if (
          viewerDbId &&
          !isSystemTodOwnerId(prompt.ownerUserId) &&
          viewerDbId === prompt.ownerUserId &&
          viewerDbId !== answer.userId
        ) {
          const connectReq = await findTodConnectRequestForPromptPair(
            ctx,
            promptId,
            viewerDbId as string,
            answer.userId,
          );
          hasSentConnect = !!connectReq;
          connectStatus = (connectReq?.status as 'pending' | 'connected' | 'removed' | undefined) ?? 'none';

          if (!hasSentConnect) {
            const existingConnection = await findPhase2MatchConversationStatus(
              ctx,
              viewerDbId as Id<'users'>,
              answer.userId as Id<'users'>,
            );
            if (existingConnection.isConnected) {
              hasSentConnect = true;
              connectStatus = 'connected';
            }
          }
        }

        return {
          _id: answer._id,
          promptId: answer.promptId,
          userId: answer.userId,
          type: answer.type,
          text: answer.text,
          mediaUrl: getInlineAnswerMediaUrlForViewer(
            answer,
            viewerDbId,
            prompt.ownerUserId as string
          ),
          durationSec: answer.durationSec,
          createdAt: answer.createdAt,
          editedAt: answer.editedAt,
          totalReactionCount: answer.totalReactionCount ?? 0,
          reactionCounts,
          myReaction,
          visibility: answer.visibility,
          viewMode: answer.viewMode,
          viewDurationSec: answer.viewDurationSec,
          isHiddenForOthers: isTodHiddenByReports(answer),
          isOwnAnswer: viewerDbId === answer.userId,
          hasReported,
          hasViewedMedia,
          hasSentConnect,
          connectStatus,
          hasMedia: !!answer.mediaStorageId,
          // Standard T/D answer media is replayable; the composer no longer
          // locks photo/video after a view. Always `false` for normal answers.
          isVisualMediaConsumed: false,
          viewCount,
          // Author identity snapshot
          authorName: normalizedIdentity.isAnonymous
            ? undefined
            : (normalizedIdentity.authorName ?? getTodDisplayName(answerUser, 'User')),
          // PHOTO-BLUR FALLBACK: when `photoBlurMode === 'blur'` but no photo
          // was persisted in the snapshot (legacy `no_photo` rows, or the
          // current privacy-preserving create path), supply the author's
          // `primaryPhotoUrl` so the renderer has a source to blur. For all
          // other non-anonymous cases, prefer the snapshot URL.
          authorPhotoUrl:
            normalizedIdentity.authorPhotoUrl
            ?? (normalizedIdentity.photoBlurMode === 'blur' && answerUser?.primaryPhotoUrl
              ? (answerUser.primaryPhotoUrl ?? undefined)
              : undefined),
          authorAge: normalizedIdentity.isAnonymous
            ? undefined
            : (normalizedIdentity.authorAge ?? calculateTodAge(answerUser?.dateOfBirth)),
          authorGender: normalizedIdentity.isAnonymous
            ? undefined
            : (normalizedIdentity.authorGender ?? trimText(answerUser?.gender ?? undefined)),
          photoBlurMode: normalizedIdentity.photoBlurMode,
          identityMode: normalizedIdentity.identityMode,
          isAnonymous: normalizedIdentity.isAnonymous,
          isFrontCamera: answer.isFrontCamera ?? false,
        };
      })
    );

    return {
      prompt: {
        _id: prompt._id,
        type: prompt.type,
        text: prompt.text,
        isTrending: prompt.isTrending,
        answerCount: prompt.answerCount,
        visibleAnswerCount: enrichedAnswers.length, // FIX: Count of visible answers for UI
        createdAt: prompt.createdAt,
        expiresAt: expires,
        isPromptOwner: !isSystemTodOwnerId(prompt.ownerUserId) && viewerDbId === prompt.ownerUserId,
        // Prompt-level reactions
        reactionCounts: promptReactionCounts,
        myReaction: promptMyReaction,
        // Owner profile snapshot
        isAnonymous: prompt.isAnonymous,
        photoBlurMode: prompt.photoBlurMode, // FIX: Include blur mode for renderer
        ownerName: prompt.ownerName,
        ownerPhotoUrl: prompt.ownerPhotoUrl,
        ownerAge: prompt.ownerAge,
        ownerGender: prompt.ownerGender,
        ownerUserId: prompt.ownerUserId, // FIX: Include for owner checks
        // Owner-attached prompt media (Phase-2). Media follows prompt
        // visibility — if the viewer can see this payload, they can see
        // the media. `mediaStorageId` is intentionally omitted client-side
        // (already resolved into `mediaUrl` server-side).
        mediaKind: prompt.mediaKind,
        mediaUrl: prompt.mediaUrl,
        mediaMime: prompt.mediaMime,
        fileSize: prompt.fileSize,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        hasMedia: !!prompt.mediaStorageId,
      },
      answers: enrichedAnswers,
      isExpired: false,
    };
  },
});

// ============================================================
// MUTATIONS WITH RATE LIMITING
// ============================================================

/**
 * Helper: Check and update rate limit
 * Returns { allowed: boolean, remaining: number }
 */
async function checkRateLimit(
  ctx: any,
  userId: string,
  actionType:
    | 'prompt'
    | 'connect'
    | 'answer'
    | 'reaction'
    | 'prompt_reaction'
    | 'report'
    | 'prompt_report'
    | 'claim_media'
    | 'media_upload'
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const limit = RATE_LIMITS[actionType];
  const windowStart = now - limit.windowMs;

  // Get existing rate limit record
  const existing = await ctx.db
    .query('todRateLimits')
    .withIndex('by_user_action', (q: any) =>
      q.eq('userId', userId).eq('actionType', actionType)
    )
    .first();

  if (!existing) {
    // Create new record
    await ctx.db.insert('todRateLimits', {
      userId,
      actionType,
      windowStart: now,
      count: 1,
    });
    return { allowed: true, remaining: limit.max - 1 };
  }

  // Check if window has expired
  if (existing.windowStart < windowStart) {
    // Reset window
    await ctx.db.patch(existing._id, {
      windowStart: now,
      count: 1,
    });
    return { allowed: true, remaining: limit.max - 1 };
  }

  // Check if under limit
  if (existing.count < limit.max) {
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
    });
    return { allowed: true, remaining: limit.max - existing.count - 1 };
  }

  return { allowed: false, remaining: 0 };
}

/**
 * Create or edit an answer (one per user per prompt).
 * MERGE behavior: updates only provided fields, preserves existing text/media.
 * - If text provided, updates text
 * - If media provided, updates media (replaces any existing)
 * - If removeMedia=true, removes media only
 * - identityMode is set ONLY on first creation, reused for all edits
 */
export const createOrEditAnswer = mutation({
  args: {
    promptId: v.string(),
    userId: v.string(),
    // Optional: if provided, update text
    text: v.optional(v.string()),
    // Optional: if provided, set/replace media
    mediaStorageId: v.optional(v.id('_storage')),
    mediaMime: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    // Optional: if true, remove media (but keep text)
    removeMedia: v.optional(v.boolean()),
    // Identity mode (only used on first creation)
    identityMode: v.optional(v.union(v.literal('anonymous'), v.literal('no_photo'), v.literal('profile'))),
    // Legacy fields for backwards compatibility
    isAnonymous: v.optional(v.boolean()),
    visibility: v.optional(v.union(v.literal('owner_only'), v.literal('public'))),
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    viewDurationSec: v.optional(v.number()),
    // Author identity snapshot (for non-anonymous comments)
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorPhotoStorageId: v.optional(v.id('_storage')),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    photoBlurMode: v.optional(v.union(v.literal('none'), v.literal('blur'))),
    // Camera metadata: true if captured from front camera (for mirroring correction in UI)
    isFrontCamera: v.optional(v.boolean()),
    // Legacy type field - computed from content
    type: v.optional(v.union(v.literal('text'), v.literal('photo'), v.literal('video'), v.literal('voice'))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedTodUserId(ctx, args.userId, 'Unauthorized');

    // Validate prompt exists and not expired
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      throw new Error('Prompt has expired');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userId, 'answer');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment before posting again.');
    }

    // Check for existing answer
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', args.promptId).eq('userId', userId)
      )
      .first();

    const normalizedText = validateAnswerText(args.text);
    const viewDurationSec = validateViewDuration(args.viewDurationSec);

    let mediaUpload: ValidatedTodUploadReference | undefined;
    let mediaDurationSec: number | undefined;
    let resolvedMediaMime = args.mediaMime;
    if (args.mediaStorageId) {
      const mediaKind = getTodUploadKindFromMedia(args.mediaMime, args.type);
      mediaUpload = await validateTodUploadReference(ctx, args.mediaStorageId, userId, mediaKind);
      mediaDurationSec = validateTodMediaDurationSec(mediaUpload.kind, args.durationSec);
      resolvedMediaMime = mediaUpload.contentType;
    }
    if (args.authorPhotoStorageId) {
      await validateTodUploadReference(ctx, args.authorPhotoStorageId, userId, 'photo');
    }

    // Generate media URL if storage ID provided
    let mediaUrl: string | undefined;
    if (args.mediaStorageId) {
      mediaUrl = await ctx.storage.getUrl(args.mediaStorageId) ?? undefined;
      if (!mediaUrl) {
        throw new Error('Invalid media storage reference');
      }
    }
    let resolvedAuthorPhotoUrl = args.authorPhotoUrl;
    if (args.authorPhotoStorageId) {
      resolvedAuthorPhotoUrl = await ctx.storage.getUrl(args.authorPhotoStorageId) ?? undefined;
      if (!resolvedAuthorPhotoUrl) {
        throw new Error('Invalid author photo storage reference');
      }
    }

    if (existing) {
      // EDIT existing answer - MERGE updates
      // Build patch object with only changed fields
      const patch: Record<string, any> = { editedAt: now };

      debugTodLog(`[T/D] EDIT existing answer`, {
        existingText: existing.text,
        argsText: args.text,
        argsMediaStorageId: !!args.mediaStorageId,
        removeMedia: args.removeMedia,
      });

      // Text: update if provided, otherwise keep existing
      if (args.text !== undefined) {
        patch.text = normalizedText;
        debugTodLog(`[T/D] text updated to: ${patch.text}`);
      } else {
        debugTodLog(`[T/D] text preserved: ${existing.text}`);
      }

      // Media: handle remove, replace, or keep
      if (args.removeMedia) {
        // Remove media only
        patch.mediaStorageId = undefined;
        patch.mediaUrl = undefined;
        patch.mediaMime = undefined;
        patch.fileSize = undefined;
        patch.durationSec = undefined;
        patch.isFrontCamera = undefined;
        patch.viewMode = undefined;
        patch.viewDurationSec = undefined;
        patch.mediaViewedAt = undefined;
        patch.promptOwnerViewedAt = undefined;
        debugTodLog(`[T/D] media removed from answer`);
      } else if (args.mediaStorageId) {
        // Replace media
        patch.mediaStorageId = args.mediaStorageId;
        patch.mediaUrl = mediaUrl;
        patch.mediaMime = resolvedMediaMime;
        patch.fileSize = mediaUpload?.size;
        patch.durationSec = mediaDurationSec;
        patch.isFrontCamera = args.isFrontCamera;
        patch.viewMode = args.viewMode ?? existing.viewMode ?? 'tap';
        patch.viewDurationSec = viewDurationSec ?? existing.viewDurationSec;
        patch.mediaViewedAt = undefined;
        patch.promptOwnerViewedAt = undefined;
        debugTodLog(`[T/D] media replaced, storageId=${args.mediaStorageId}`);
      } else if (args.viewMode !== undefined || args.viewDurationSec !== undefined) {
        patch.viewMode = args.viewMode ?? existing.viewMode ?? 'tap';
        patch.viewDurationSec = viewDurationSec ?? existing.viewDurationSec;
      }
      // else: keep existing media unchanged

      // Determine type based on final content
      const finalText = args.text !== undefined ? normalizedText : existing.text;
      const finalMedia = args.removeMedia ? undefined : (args.mediaStorageId ?? existing.mediaStorageId);
      const finalMime = args.removeMedia ? undefined : (resolvedMediaMime ?? existing.mediaMime);

      if (!finalText && !finalMedia) {
        throw new Error('Answer requires text or media');
      }

      // Compute type from content
      let type: 'text' | 'photo' | 'video' | 'voice' = 'text';
      if (finalMedia) {
        type = getTodAnswerTypeFromUploadKind(
          args.mediaStorageId && mediaUpload
            ? mediaUpload.kind
            : getTodUploadKindFromMedia(finalMime, existing.type)
        );
      }
      patch.type = type;

      // Identity: KEEP existing identityMode (do not change on edit)
      // BLUR-PHOTO PARITY WITH CONFESS: only anonymous strips identity. `no_photo`
      // keeps the snapshot (name + real photo URL); the renderer applies blur on top.
      const existingIdentityMode = getNormalizedTodAnswerIdentity(existing).identityMode;
      const shouldStripIdentitySnapshot = existingIdentityMode === 'anonymous';

      if (shouldStripIdentitySnapshot) {
        patch.authorName = undefined;
        patch.authorPhotoUrl = undefined;
        patch.authorAge = undefined;
        patch.authorGender = undefined;
      } else {
        // Only update author snapshot if explicitly provided
        if (args.authorName !== undefined) patch.authorName = args.authorName;
        if (args.authorPhotoUrl !== undefined || args.authorPhotoStorageId !== undefined) {
          patch.authorPhotoUrl = resolvedAuthorPhotoUrl;
        }
        if (args.authorAge !== undefined) patch.authorAge = args.authorAge;
        if (args.authorGender !== undefined) patch.authorGender = args.authorGender;
      }

      debugTodLog(`[T/D] identityMode reused=${existingIdentityMode}`);

      await ctx.db.patch(existing._id, patch);

      if (args.removeMedia || args.mediaStorageId) {
        const priorViews = await ctx.db
          .query('todAnswerViews')
          .withIndex('by_answer', (q) => q.eq('answerId', existing._id as string))
          .collect();
        for (const view of priorViews) {
          await ctx.db.delete(view._id);
        }
      }

      if (args.removeMedia) {
        await deleteStorageIfPresent(ctx, existing.mediaStorageId);
      } else if (
        args.mediaStorageId &&
        existing.mediaStorageId &&
        existing.mediaStorageId !== args.mediaStorageId
      ) {
        await deleteStorageIfPresent(ctx, existing.mediaStorageId);
      }

      // Record Phase-2 activity for ranking freshness (throttled to 1 update/hour)
      await ctx.runMutation(internal.phase2Ranking.recordPhase2Activity, {});

      return { answerId: existing._id, isEdit: true };
    } else {
      // CREATE new answer
      // Require at least text or media
      const hasText = !!normalizedText;
      const hasMedia = !!args.mediaStorageId;

      if (!hasText && !hasMedia) {
        throw new Error('Answer requires text or media');
      }

      // Determine identity mode (default to anonymous)
      const identityMode = args.identityMode ?? 'anonymous';
      const isAnon = identityMode === 'anonymous';
      const isNoPhoto = identityMode === 'no_photo';
      // BLUR-PHOTO PARITY WITH CONFESS: only anonymous strips the identity snapshot.
      // `no_photo` persists the real photo URL so the renderer can blur it.
      const shouldStripIdentitySnapshot = isAnon;

      // Compute type
      let type: 'text' | 'photo' | 'video' | 'voice' = 'text';
      if (hasMedia) {
        type = getTodAnswerTypeFromUploadKind(mediaUpload?.kind);
      }

      const answerId = await ctx.db.insert('todAnswers', {
        promptId: args.promptId,
        userId,
        type,
        text: normalizedText,
        mediaStorageId: args.mediaStorageId,
        mediaUrl,
        mediaMime: resolvedMediaMime,
        fileSize: mediaUpload?.size,
        durationSec: mediaDurationSec,
        likeCount: 0,
        createdAt: now,
        identityMode,
        isAnonymous: isAnon,
        visibility: args.visibility ?? 'public',
        viewMode: hasMedia ? (args.viewMode ?? 'tap') : undefined,
        viewDurationSec: hasMedia ? viewDurationSec : undefined,
        totalReactionCount: 0,
        reportCount: 0,
        // Author identity snapshot (cleared only for anonymous; `no_photo` keeps
        // the real photo URL and the renderer applies blur on top — parity with Confess)
        authorName: shouldStripIdentitySnapshot ? undefined : args.authorName,
        authorPhotoUrl: shouldStripIdentitySnapshot ? undefined : resolvedAuthorPhotoUrl,
        authorAge: shouldStripIdentitySnapshot ? undefined : args.authorAge,
        authorGender: shouldStripIdentitySnapshot ? undefined : args.authorGender,
        photoBlurMode: isNoPhoto ? 'blur' : 'none',
        isFrontCamera: args.isFrontCamera,
      });

      await syncPromptAnswerCounts(ctx, args.promptId);

      // Record Phase-2 activity for ranking freshness (throttled to 1 update/hour)
      await ctx.runMutation(internal.phase2Ranking.recordPhase2Activity, {});

      debugTodLog(`[T/D] answer created, identityMode=${identityMode}`);
      return { answerId, isEdit: false };
    }
  },
});

/**
 * Set (upsert) an emoji reaction on an answer.
 * One reaction per user per answer. Changing updates counts.
 */
export const setAnswerReaction = mutation({
  args: {
    answerId: v.string(),
    userId: v.string(),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { answerId, userId: argsUserId, emoji }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, argsUserId, 'Unauthorized');

    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userId, 'reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    const now = Date.now();

    // Check for existing reaction
    const existing = await ctx.db
      .query('todAnswerReactions')
      .withIndex('by_answer_user', (q) =>
        q.eq('answerId', answerId).eq('userId', userId)
      )
      .first();

    if (emoji === '' || !emoji) {
      // Remove reaction
      if (existing) {
        await ctx.db.delete(existing._id);
        // Decrement count
        const newCount = Math.max(0, (answer.totalReactionCount ?? 0) - 1);
        await ctx.db.patch(answer._id, { totalReactionCount: newCount });
      }
      return { ok: true, action: 'removed' };
    }

    if (existing) {
      // Update reaction
      if (existing.emoji !== emoji) {
        await ctx.db.patch(existing._id, {
          emoji,
          updatedAt: now,
        });
        return { ok: true, action: 'changed', oldEmoji: existing.emoji, newEmoji: emoji };
      }
      return { ok: true, action: 'unchanged' };
    } else {
      // Create new reaction
      await ctx.db.insert('todAnswerReactions', {
        answerId,
        userId,
        emoji,
        createdAt: now,
      });
      // Increment count
      await ctx.db.patch(answer._id, {
        totalReactionCount: (answer.totalReactionCount ?? 0) + 1,
      });
      return { ok: true, action: 'added', emoji };
    }
  },
});

/**
 * Report an answer.
 * Rate limited per day. Duplicate reports are idempotent.
 * Three unique reports hides the answer from everyone except author.
 */
export const reportAnswer = mutation({
  args: {
    answerId: v.string(),
    reporterId: v.string(),
    reasonCode: v.union(
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other')
    ),
    // Optional additional details
    reasonText: v.optional(v.string()),
    // Legacy field for backwards compatibility (deprecated)
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { answerId, reporterId: argsReporterId, reasonCode, reasonText }) => {
    const reporterId = await requireAuthenticatedTodUserId(ctx, argsReporterId, 'Unauthorized');

    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    // Can't report own answer
    if (answer.userId === reporterId) {
      throw new Error("You can't report your own answer");
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer_reporter', (q) =>
        q.eq('answerId', answerId).eq('reporterId', reporterId)
      )
      .first();

    if (existingReport) {
      const answerModeration = answer as typeof answer & {
        uniqueReportCount?: number;
        moderationStatus?: 'normal' | 'under_review' | 'hidden_by_reports';
      };
      const currentStatus =
        answerModeration.moderationStatus ??
        moderationStatusForTodReportCount(answerModeration.uniqueReportCount ?? answer.reportCount ?? 0);

      return {
        success: true,
        alreadyReported: true,
        moderationStatus: currentStatus,
        isNowHidden: currentStatus === 'hidden_by_reports',
      };
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, reporterId, 'report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    const now = Date.now();

    // Create report with structured reason
    await ctx.db.insert('todAnswerReports', {
      answerId,
      reporterId,
      reasonCode: reasonCode as any,
      reasonText,
      createdAt: now,
    });

    const reports = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();

    const nextCount = reports.length;
    const nextStatus = moderationStatusForTodReportCount(nextCount);
    const answerModeration = answer as typeof answer & {
      moderationStatus?: 'normal' | 'under_review' | 'hidden_by_reports';
      hiddenByReportsAt?: number;
    };
    const answerPatch: any = {
      uniqueReportCount: nextCount,
      reportCount: nextCount,
      moderationStatus: nextStatus,
    };

    if (answerModeration.moderationStatus !== nextStatus) {
      answerPatch.moderationStatusAt = now;
    }
    if (nextStatus === 'hidden_by_reports' && !answerModeration.hiddenByReportsAt) {
      answerPatch.hiddenByReportsAt = now;
    }

    await ctx.db.patch(answer._id, answerPatch);

    return {
      success: true,
      alreadyReported: false,
      moderationStatus: nextStatus,
      isNowHidden: nextStatus === 'hidden_by_reports',
    };
  },
});

/**
 * Set/change/remove a reaction on a prompt.
 * One reaction per user per prompt. Changing updates counts.
 */
export const setPromptReaction = mutation({
  args: {
    promptId: v.string(),
    userId: v.string(),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { promptId, userId: argsUserId, emoji }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, argsUserId, 'Unauthorized');

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userId, 'prompt_reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    const now = Date.now();

    // Check for existing reaction
    const existing = await ctx.db
      .query('todPromptReactions')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', userId)
      )
      .first();

    if (emoji === '' || !emoji) {
      // Remove reaction
      if (existing) {
        await ctx.db.delete(existing._id);
        // Decrement count
        const newCount = Math.max(0, (prompt.totalReactionCount ?? 0) - 1);
        await ctx.db.patch(prompt._id, { totalReactionCount: newCount });
      }
      return { ok: true, action: 'removed' };
    }

    if (existing) {
      // Update reaction
      if (existing.emoji !== emoji) {
        await ctx.db.patch(existing._id, {
          emoji,
          updatedAt: now,
        });
        return { ok: true, action: 'changed', oldEmoji: existing.emoji, newEmoji: emoji };
      }
      return { ok: true, action: 'unchanged' };
    } else {
      // Create new reaction
      await ctx.db.insert('todPromptReactions', {
        promptId,
        userId,
        emoji,
        createdAt: now,
      });
      // Increment count
      await ctx.db.patch(prompt._id, {
        totalReactionCount: (prompt.totalReactionCount ?? 0) + 1,
      });
      return { ok: true, action: 'added', emoji };
    }
  },
});

/**
 * Report a prompt.
 * Rate limited per day. Duplicate reports are idempotent.
 * Three unique reports hides the prompt from public surfaces.
 */
export const reportPrompt = mutation({
  args: {
    promptId: v.string(),
    reporterId: v.string(),
    reasonCode: v.union(
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other')
    ),
    reasonText: v.optional(v.string()),
  },
  handler: async (ctx, { promptId, reporterId: argsReporterId, reasonCode, reasonText }) => {
    const reporterId = await requireAuthenticatedTodUserId(ctx, argsReporterId, 'Unauthorized');

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    // Can't report own prompt
    if (prompt.ownerUserId === reporterId) {
      throw new Error("Cannot report your own prompt");
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt_reporter', (q) =>
        q.eq('promptId', promptId).eq('reporterId', reporterId)
      )
      .first();

    if (existingReport) {
      const promptModeration = prompt as typeof prompt & {
        uniqueReportCount?: number;
        moderationStatus?: 'normal' | 'under_review' | 'hidden_by_reports';
      };
      const currentStatus =
        promptModeration.moderationStatus ??
        moderationStatusForTodReportCount(promptModeration.uniqueReportCount ?? prompt.reportCount ?? 0);

      return {
        success: true,
        alreadyReported: true,
        moderationStatus: currentStatus,
        isNowHidden: currentStatus === 'hidden_by_reports',
      };
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, reporterId, 'prompt_report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    const now = Date.now();

    // Create report
    await ctx.db.insert('todPromptReports', {
      promptId,
      reporterId,
      reasonCode: reasonCode as any,
      reasonText,
      createdAt: now,
    });

    const reports = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    const nextCount = reports.length;
    const nextStatus = moderationStatusForTodReportCount(nextCount);
    const promptModeration = prompt as typeof prompt & {
      moderationStatus?: 'normal' | 'under_review' | 'hidden_by_reports';
      hiddenByReportsAt?: number;
    };
    const promptPatch: any = {
      uniqueReportCount: nextCount,
      reportCount: nextCount,
      moderationStatus: nextStatus,
    };

    if (promptModeration.moderationStatus !== nextStatus) {
      promptPatch.moderationStatusAt = now;
    }
    if (nextStatus === 'hidden_by_reports' && !promptModeration.hiddenByReportsAt) {
      promptPatch.hiddenByReportsAt = now;
    }

    await ctx.db.patch(prompt._id, promptPatch);

    return {
      success: true,
      alreadyReported: false,
      moderationStatus: nextStatus,
      isNowHidden: nextStatus === 'hidden_by_reports',
    };
  },
});

/**
 * Get user's answer for a prompt (for editing)
 */
export const getUserAnswer = query({
  args: {
    promptId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, { promptId, userId }) => {
    const currentUserId = await getOptionalAuthenticatedTodUserId(ctx, userId, 'getUserAnswer');
    if (!currentUserId) {
      return null;
    }
    const answer = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', currentUserId)
      )
      .first();

    if (!answer) return null;

    const safeAnswer = { ...(answer as any) };
    delete safeAnswer.reportCount;
    delete safeAnswer.uniqueReportCount;
    delete safeAnswer.moderationStatus;
    delete safeAnswer.moderationStatusAt;
    delete safeAnswer.hiddenByReportsAt;

    return safeAnswer;
  },
});

/**
 * Delete user's own answer
 */
export const deleteMyAnswer = mutation({
  args: {
    answerId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, { answerId, userId: argsUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, argsUserId, 'Unauthorized');

    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    if (answer.userId !== userId) {
      throw new Error('You can only delete your own answers');
    }

    debugTodLog(`[T/D] deleteMyAnswer allowed for answerId=${answerId}`);

    // Delete media if exists
    if (answer.mediaStorageId) {
      try {
        await ctx.storage.delete(answer.mediaStorageId);
      } catch { /* already deleted */ }
    }

    // Delete all reactions for this answer
    const reactions = await ctx.db
      .query('todAnswerReactions')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();
    for (const r of reactions) {
      await ctx.db.delete(r._id);
    }

    // Delete all reports for this answer
    const reports = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();
    for (const r of reports) {
      await ctx.db.delete(r._id);
    }

    // Delete all view records for this answer (cleanup todAnswerViews)
    const views = await ctx.db
      .query('todAnswerViews')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .collect();
    for (const v of views) {
      await ctx.db.delete(v._id);
    }

    const connectRequests = await ctx.db
      .query('todConnectRequests')
      .filter((q) => q.eq(q.field('answerId'), answerId))
      .collect();
    for (const request of connectRequests) {
      await ctx.db.delete(request._id);
    }

    // Delete the answer
    await ctx.db.delete(answer._id);

    await syncPromptAnswerCounts(ctx, answer.promptId);

    return { success: true };
  },
});

// ============================================================
// SECURE ANSWER MEDIA VIEWING APIs
// ============================================================

/**
 * Read-only media URL preloader for prompt threads.
 *
 * This intentionally does NOT write todAnswerViews, does NOT call claim-media
 * rate limits, and must never be treated as a real view. The tap/open path
 * still goes through claimAnswerMediaView for photo/video one-time media.
 */
export const preloadAnswerMediaUrl = query({
  args: {
    answerId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { answerId, authUserId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');

    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (
      !answer ||
      answer.type === 'text' ||
      (!answer.mediaStorageId && !answer.mediaUrl)
    ) {
      return null;
    }

    if ((answer.type === 'photo' || answer.type === 'video') && !answer.mediaStorageId) {
      return null;
    }

    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return null;
    }

    const canAccess = await canViewerAccessAnswerMedia(ctx, answer, viewerId, prompt);
    if (!canAccess) {
      return null;
    }

    const isAnswerAuthor = answer.userId === viewerId;
    if (!isAnswerAuthor && (answer.type === 'photo' || answer.type === 'video')) {
      const existingView = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer_viewer', (q) =>
          q.eq('answerId', answerId).eq('viewerUserId', viewerId)
        )
        .first();

      if (existingView) {
        return null;
      }
    }

    const url = answer.mediaStorageId
      ? await ctx.storage.getUrl(answer.mediaStorageId)
      : answer.mediaUrl;

    if (!url) {
      return null;
    }

    return {
      url,
      kind: answer.type as 'photo' | 'video' | 'voice',
      mediaStorageId: answer.mediaStorageId,
      durationSec: answer.durationSec ?? answer.viewDurationSec,
      isFrontCamera: answer.isFrontCamera ?? false,
    };
  },
});

/**
 * Claim viewing rights for an answer's secure media.
 * - For 'owner_only' visibility: only prompt owner can view
 * - For 'public' visibility: anyone can view, but only once
 * Atomically records the viewer's one-time claim before returning a URL.
 */
export const claimAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    viewerId: v.string(),
  },
  handler: async (ctx, { answerId, viewerId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, argsViewerId, 'Unauthorized');

    // Rate limit check
    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    // Get the answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      return { status: 'no_media' as const };
    }

    // Must have media
    if (
      !answer.mediaStorageId ||
      (answer.type !== 'photo' && answer.type !== 'video')
    ) {
      return { status: 'no_media' as const };
    }

    // Get the prompt to check ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return { status: 'no_media' as const };
    }

    const canAccess = await canViewerAccessAnswerMedia(ctx, answer, viewerId, prompt);
    if (!canAccess) {
      return { status: 'not_authorized' as const };
    }

    const isPromptOwner = prompt.ownerUserId === viewerId;
    const isAnswerAuthor = answer.userId === viewerId;

    if (answer.visibility === 'owner_only' && !isPromptOwner && !isAnswerAuthor) {
      return { status: 'not_authorized' as const };
    }

    // Determine role for frontend
    let role: 'owner' | 'sender' | 'viewer';
    if (isPromptOwner) {
      role = 'owner';
    } else if (isAnswerAuthor) {
      role = 'sender';
    } else {
      role = 'viewer';
    }

    // Look up any existing view ledger row for this (answer, viewer). Standard
    // T/D answer media is replayable, so an existing row no longer blocks
    // playback — it just means we should NOT insert a duplicate (unique-viewer
    // count is preserved via the single row per viewer).
    let existingView: any = null;
    if (!isAnswerAuthor) {
      existingView = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer_viewer', (q) =>
          q.eq('answerId', answerId).eq('viewerUserId', viewerId)
        )
        .first();
    }

    // Generate a fresh URL. The author always sees their own upload; other
    // viewers may replay as long as access checks above still allow it.
    const url = await ctx.storage.getUrl(answer.mediaStorageId);
    if (!url) {
      return { status: 'no_media' as const };
    }

    const viewedAt = Date.now();
    if (!isAnswerAuthor && !existingView) {
      // First non-author open ever: record the unique view exactly once.
      await ctx.db.insert('todAnswerViews', {
        answerId,
        viewerUserId: viewerId,
        viewedAt,
      });
    }

    const answerPatch: Record<string, any> = {};
    if (!answer.mediaViewedAt) {
      answerPatch.mediaViewedAt = viewedAt;
    }
    if (isPromptOwner && !answer.promptOwnerViewedAt) {
      answerPatch.promptOwnerViewedAt = viewedAt;
    }
    if (Object.keys(answerPatch).length > 0) {
      await ctx.db.patch(answer._id, answerPatch);
    }

    debugTodLog(
      `[T/D] mediaClaim allowed=true viewerId=${viewerId} answerId=${answerId} role=${role}`
    );

    return {
      status: 'ok' as const,
      url,
      mediaType: answer.type as 'photo' | 'video',
      viewMode: (answer.viewMode ?? 'tap') as 'tap' | 'hold',
      durationSec: answer.viewDurationSec ?? 10,
      role,
      isFrontCamera: answer.isFrontCamera ?? false,
      viewedAt,
    };
  },
});

/**
 * Legacy finalize hook retained for older clients. Current Phase-2 clients
 * consume photo/video access in claimAnswerMediaView before receiving a URL.
 * This mutation is idempotent and never deletes shared storage.
 */
export const finalizeAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    viewerId: v.string(),
  },
  handler: async (ctx, { answerId, viewerId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, argsViewerId, 'Unauthorized');

    // Rate limit
    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    // Get the answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      return { status: 'not_found' as const };
    }

    // Get the prompt to check ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return { status: 'not_found' as const };
    }

    const isPromptOwner = prompt.ownerUserId === viewerId;
    const isAnswerAuthor = answer.userId === viewerId;

    if (
      (answer.type !== 'photo' && answer.type !== 'video') ||
      !answer.mediaStorageId
    ) {
      return { status: 'not_found' as const };
    }

    const canAccess = await canViewerAccessAnswerMedia(ctx, answer, viewerId, prompt);
    if (!canAccess) {
      return { status: 'not_authorized' as const };
    }

    const finalizedAt = Date.now();

    if (!isAnswerAuthor) {
      const existingView = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer_viewer', (q) =>
          q.eq('answerId', answerId).eq('viewerUserId', viewerId)
        )
        .first();

      if (!existingView) {
        await ctx.db.insert('todAnswerViews', {
          answerId,
          viewerUserId: viewerId,
          viewedAt: finalizedAt,
        });
      }
    }

    if (!answer.mediaViewedAt) {
      await ctx.db.patch(answer._id, {
        mediaViewedAt: finalizedAt,
      });
    }

    if (isPromptOwner && !answer.promptOwnerViewedAt) {
      await ctx.db.patch(answer._id, {
        promptOwnerViewedAt: finalizedAt,
      });
    }

    return { status: 'ok' as const };
  },
});

/**
 * Get URL for voice message playback.
 * Voice messages are NOT one-time secure - they can be replayed.
 */
export const getVoiceUrl = query({
  args: {
    answerId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { answerId, authUserId }) => {
    const viewerUserId = await requireAuthenticatedTodUserId(ctx, authUserId, 'Unauthorized');

    // Get the answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      return { status: 'not_found' as const };
    }

    // Must be voice type
    if (answer.type !== 'voice') {
      return { status: 'not_voice' as const };
    }

    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return { status: 'not_found' as const };
    }

    const canAccess = await canViewerAccessVoiceAnswer(ctx, answer, viewerUserId, prompt);
    if (!canAccess) {
      throw new Error('Access denied');
    }

    // Try mediaUrl first (may already be set)
    if (answer.mediaUrl) {
      return { status: 'ok' as const, url: answer.mediaUrl };
    }

    // Generate from storageId
    if (answer.mediaStorageId) {
      const url = await ctx.storage.getUrl(answer.mediaStorageId);
      if (url) {
        return { status: 'ok' as const, url };
      }
    }

    return { status: 'no_media' as const };
  },
});
