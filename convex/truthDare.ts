import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { resolveUserIdByAuthId } from './helpers';

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
};

// Report threshold for hiding
const REPORT_HIDE_THRESHOLD = 5;

// TOD-P2-001 FIX: Rate limit error message
const RATE_LIMIT_ERROR = 'Rate limit exceeded. Please try again later.';
const TOD_SYSTEM_OWNER_ID = 'system';

const MIN_PROMPT_CHARS = 10;
const MAX_PROMPT_CHARS = 280;
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

async function requireAuthenticatedTodUserId(
  ctx: any,
  errorMessage: string = 'Unauthorized'
): Promise<Id<'users'>> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error(errorMessage);
  }
  const userId = await resolveUserIdByAuthId(ctx, identity.subject);
  if (!userId) {
    throw new Error(errorMessage);
  }
  return userId;
}

async function getOptionalAuthenticatedTodUserId(
  ctx: any,
  contextLabel: string = 'truthDare'
): Promise<Id<'users'> | undefined> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return undefined;
  }
  const userId = await resolveUserIdByAuthId(ctx, identity.subject);
  if (!userId) {
    console.warn(`[T/D] Auth identity resolved without user record in ${contextLabel}`);
    return undefined;
  }
  return userId;
}

function getTodDisplayName(
  user: { handle?: string | null; name?: string | null } | null | undefined,
  fallback: string = 'Someone'
): string {
  return user?.handle?.trim() || user?.name?.trim() || fallback;
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

function isPromptHiddenForViewer(
  prompt: { ownerUserId: string; reportCount?: number },
  viewerUserId: Id<'users'> | undefined
): boolean {
  return (prompt.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD && prompt.ownerUserId !== viewerUserId;
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
    authorPhotoUrl:
      isAnonymous || isNoPhoto ? undefined : trimText(answer.authorPhotoUrl ?? undefined),
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

function getVoiceMediaUrlForViewer(
  answer: {
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
  if (viewerUserId === answer.userId) {
    return answer.mediaUrl;
  }
  if (answer.visibility === 'owner_only') {
    return promptOwnerUserId === viewerUserId ? answer.mediaUrl : undefined;
  }
  return answer.mediaUrl;
}

function getInlineAnswerMediaUrlForViewer(
  answer: {
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
  answer: {
    promptId: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: { ownerUserId: string } | null
): Promise<boolean> {
  if (viewerUserId === answer.userId) {
    return true;
  }

  const promptDoc =
    prompt ?? (await ctx.db.get(answer.promptId as Id<'todPrompts'>));
  if (!promptDoc) {
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
  answer: {
    promptId: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: { ownerUserId: string } | null
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
  },
  handler: async (ctx, { storageIds }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, { storageIds }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, { storageIds }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
    const needsIdentityFallback = isPublicPost && (!finalOwnerName || finalOwnerName.trim() === '');

    if (needsIdentityFallback) {
      // Fetch user's canonical profile for identity
      const userProfile = await ctx.db.get(ownerUserId);
      if (userProfile) {
        // Use handle (nickname) if available, otherwise use real name
        finalOwnerName = userProfile.handle || userProfile.name || undefined;

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
    });

    // Debug log for post creation
    const urlPrefix = finalOwnerPhotoUrl ? (finalOwnerPhotoUrl.startsWith('https://') ? 'https' : finalOwnerPhotoUrl.startsWith('http://') ? 'http' : 'other') : 'none';
    debugTodLog(`[T/D] Created prompt: id=${promptId}, type=${args.type}, isAnon=${args.isAnonymous ?? true}, photoBlurMode=${args.photoBlurMode ?? 'none'}, photoUrlPrefix=${urlPrefix}, identityFallback=${needsIdentityFallback}`);

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
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
    const userId = await getOptionalAuthenticatedTodUserId(ctx, 'getPendingConnectRequests');
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

// Send a T&D connect request (prompt owner → answer author)
export const sendTodConnectRequest = mutation({
  args: {
    promptId: v.string(),
    answerId: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { promptId, answerId, authUserId }) => {
    const fromUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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

    const isAnonymousAnswer = getNormalizedTodAnswerIdentity(answer).isAnonymous;
    if (isAnonymousAnswer) {
      return { success: false, reason: 'Cannot connect to an anonymous answer' };
    }

    const toUserId = answer.userId;

    // Cannot connect to self
    if (toUserId === fromUserId) {
      return { success: false, reason: 'Cannot connect to yourself' };
    }

    if (await hasBlockBetween(ctx, fromUserId as string, toUserId as string)) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }

    // Check for existing pending/connected request for this user pair
    const existing = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', fromUserId).eq('toUserId', toUserId))
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'connected')
        )
      )
      .first();

    if (existing) {
      return { success: false, reason: 'Request already exists' };
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
      return { success: false, reason: 'Request already exists' };
    }

    const rateCheck = await checkRateLimit(ctx, fromUserId, 'connect');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }

    // Create connect request
    await ctx.db.insert('todConnectRequests', {
      promptId,
      answerId,
      fromUserId,
      toUserId,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Respond to connect request (Connect or Remove)
// Creates conversation in EXISTING conversations table for both users
export const respondToConnect = mutation({
  args: {
    requestId: v.id('todConnectRequests'),
    action: v.union(v.literal('connect'), v.literal('remove')),
    authUserId: v.string(),
  },
  handler: async (ctx, { requestId, action, authUserId }) => {
    const recipientDbId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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

      // Resolve sender to Id<'users'>
      const senderDbId = await resolveUserIdByAuthId(ctx, request.fromUserId);
      if (!senderDbId) {
        return { success: false, reason: 'Sender user not found' };
      }

      if (await hasBlockBetween(ctx, senderDbId as string, recipientDbId as string)) {
        return { success: false, reason: 'Connect unavailable for this user' };
      }

      // Get sender profile for response
      const sender = await ctx.db.get(senderDbId as Id<'users'>);

      // Get recipient profile for response
      const recipient = await ctx.db.get(recipientDbId as Id<'users'>);

      const senderIdentity = getPromptConnectIdentity(prompt, sender);
      const recipientIdentity = answer
        ? getAnswerConnectIdentity(answer, recipient)
        : getDefaultConnectIdentity(recipient);

      if (recipientIdentity.isAnonymous) {
        return { success: false, reason: 'Connect unavailable for this user' };
      }

      // Order participants for consistent deduplication (lower ID first)
      const participantIds = [senderDbId as Id<'users'>, recipientDbId as Id<'users'>].sort();

      // Check if conversation already exists for this user pair
      // Query conversationParticipants to find shared conversations
      const senderParticipations = await ctx.db
        .query('conversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', senderDbId as Id<'users'>))
        .collect();

      let existingConversationId: Id<'conversations'> | null = null;

      for (const sp of senderParticipations) {
        // Check if recipient is also in this conversation
        const recipientInConvo = await ctx.db
          .query('conversationParticipants')
          .withIndex('by_user_conversation', (q) =>
            q.eq('userId', recipientDbId as Id<'users'>).eq('conversationId', sp.conversationId)
          )
          .first();

        if (recipientInConvo) {
          existingConversationId = sp.conversationId;
          break;
        }
      }

      const now = Date.now();
      let conversationId: Id<'conversations'>;

      if (existingConversationId) {
        // Reuse existing conversation
        conversationId = existingConversationId;
        // Update lastMessageAt
        await ctx.db.patch(conversationId, { lastMessageAt: now });
      } else {
        // Create new conversation in EXISTING conversations table
        conversationId = await ctx.db.insert('conversations', {
          participants: participantIds,
          isPreMatch: false,
          connectionSource: 'tod',
          createdAt: now,
          lastMessageAt: now,
        });

        // Create conversationParticipants for BOTH users
        await ctx.db.insert('conversationParticipants', {
          conversationId,
          userId: senderDbId as Id<'users'>,
          unreadCount: 1, // Sender will see the system message as unread
        });

        await ctx.db.insert('conversationParticipants', {
          conversationId,
          userId: recipientDbId as Id<'users'>,
          unreadCount: 0, // Recipient is accepting, they'll see it immediately
        });

        // Create initial system message
        await ctx.db.insert('messages', {
          conversationId,
          senderId: recipientDbId as Id<'users'>,
          type: 'text',
          content: '[SYSTEM:truthdare]T&D connection accepted! Say hi!',
          createdAt: now,
        });
      }

      if (privateMedia) {
        await ctx.db.patch(privateMedia._id, {
          connectStatus: 'accepted',
        });
      }
      await ctx.db.patch(requestId, { status: 'connected' });

      return {
        success: true,
        action: 'connected' as const,
        conversationId: conversationId as string,
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
    const userId = await getOptionalAuthenticatedTodUserId(ctx, 'checkTodConnectStatus');
    if (!userId) return { status: 'none' as const };

    // Get the answer to find the other user
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (!answer) return { status: 'none' as const };

    // Check for request from current user to answer author
    const requestSent = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', userId).eq('toUserId', answer.userId))
      .first();

    if (requestSent) {
      return { status: requestSent.status };
    }

    // Check for request from answer author to current user
    const requestReceived = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', answer.userId).eq('toUserId', userId))
      .first();

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
    const allPrompts = await ctx.db.query('todPrompts').collect();
    let deleted = 0;

    for (const prompt of allPrompts) {
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
    await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, args) => {
    const fromUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      throw new Error('Prompt not found');
    }

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
      viewMode: args.viewMode ?? 'tap', // default to tap-to-view
      durationSec: args.durationSec ?? 20,
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
  },
  handler: async (ctx, { promptId, viewerUserId }) => {
    const currentUserId = await getOptionalAuthenticatedTodUserId(ctx, 'getPrivateMediaForOwner');
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
  },
  handler: async (ctx, { privateMediaId, viewerUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, { privateMediaId, viewerUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, { privateMediaId, fromUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
  },
  handler: async (ctx, { privateMediaId, fromUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');
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
    const allPrompts = await ctx.db.query('todPrompts').collect();

    let deletedPrompts = 0;
    let deletedAnswers = 0;
    let deletedLikes = 0;
    let deletedConnects = 0;
    let deletedPrivateMedia = 0;

    for (const prompt of allPrompts) {
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
    const viewerDbId = await getOptionalAuthenticatedTodUserId(ctx, 'listActivePromptsWithTop2Answers');

    // TOD-P2-002 FIX: Get blocked user IDs for viewer (both directions)
    const blockedUserIds = await getBlockedUserIdsForViewer(ctx, viewerDbId);

    // Get all prompts
    const allPrompts = await ctx.db.query('todPrompts').collect();

    // Filter to active (not expired) and not from blocked users
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires <= now) return false;
      // TOD-P2-002 FIX: Filter out prompts from blocked users
      if (blockedUserIds.has(p.ownerUserId as string)) return false;
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

    // For each prompt, get up to 2 ranked preview answers
    const promptsWithAnswers = await Promise.all(
      activePrompts.map(async (prompt) => {
        const promptId = prompt._id as unknown as string;

        // Get all answers for this prompt
        const answers = await ctx.db
          .query('todAnswers')
          .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
          .collect();

        // Filter: exclude hidden answers (reportCount >= 5) UNLESS viewer is the author
        // TOD-P2-002 FIX: Also exclude answers from blocked users
        const visibleAnswers = answers.filter((a) => {
          // TOD-P2-002 FIX: Filter out answers from blocked users
          if (blockedUserIds.has(a.userId as string)) return false;
          const isHidden = (a.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD;
          if (!isHidden) return true;
          // Author can always see their own answer
          return viewerDbId && a.userId === viewerDbId;
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
              visibility: answer.visibility,
              viewMode: answer.viewMode,
              viewDurationSec: answer.viewDurationSec,
              isHiddenForOthers: (answer.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD,
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
    const viewerDbId = await getOptionalAuthenticatedTodUserId(ctx, 'getTrendingTruthAndDare');
    const blockedUserIds = await getBlockedUserIdsForViewer(ctx, viewerDbId);

    // Get all prompts
    const allPrompts = await ctx.db.query('todPrompts').collect();

    // Filter to active (not expired)
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      return (
        expires > now &&
        !blockedUserIds.has(p.ownerUserId as string) &&
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
    const viewerDbId = await getOptionalAuthenticatedTodUserId(ctx, 'getPromptThread');
    const blockedUserIds = await getBlockedUserIdsForViewer(ctx, viewerDbId);

    // Get prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return null;
    if (blockedUserIds.has(prompt.ownerUserId as string)) return null;
    if (isPromptHiddenForViewer(prompt, viewerDbId)) return null;

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

    // Filter hidden answers (except for author)
    const visibleAnswers = answers.filter((a) => {
      if (blockedUserIds.has(a.userId as string)) return false;
      const isHidden = (a.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD;
      if (!isHidden) return true;
      return viewerDbId && a.userId === viewerDbId;
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
        const authorProfileFallbackNeeded =
          !normalizedIdentity.isAnonymous &&
          (!normalizedIdentity.authorName ||
            normalizedIdentity.authorAge === undefined ||
            !normalizedIdentity.authorGender);
        const answerUser = authorProfileFallbackNeeded
          ? await ctx.db.get(answer.userId as Id<'users'>)
          : null;
        const { reactionCounts, myReaction } = await getAnswerReactionSummary(
          ctx,
          answerId,
          answer.totalReactionCount ?? 0,
          viewerDbId
        );

        // Check if viewer reported this
        let hasReported = false;
        if (viewerDbId) {
          const report = await ctx.db
            .query('todAnswerReports')
            .withIndex('by_answer_reporter', (q) =>
              q.eq('answerId', answerId).eq('reporterId', viewerDbId)
            )
            .first();
          hasReported = !!report;
        }

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

        // Check if viewer (as prompt owner) has sent a connect request for this answer
        let hasSentConnect = false;
        let connectStatus: 'none' | 'pending' | 'connected' = 'none';
        if (viewerDbId && viewerDbId !== answer.userId) {
          const connectReq = await ctx.db
            .query('todConnectRequests')
            .withIndex('by_from_to', (q) =>
              q.eq('fromUserId', viewerDbId).eq('toUserId', answer.userId)
            )
            .filter((q) =>
              q.or(
                q.eq(q.field('status'), 'pending'),
                q.eq(q.field('status'), 'connected')
              )
            )
            .first();
          hasSentConnect = !!connectReq;
          connectStatus = (connectReq?.status as 'pending' | 'connected' | undefined) ?? 'none';
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
          isHiddenForOthers: (answer.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD,
          isOwnAnswer: viewerDbId === answer.userId,
          hasReported,
          hasViewedMedia,
          hasSentConnect,
          connectStatus,
          hasMedia: !!answer.mediaStorageId,
          isVisualMediaConsumed: !!answer.mediaViewedAt || !!answer.promptOwnerViewedAt,
          // Author identity snapshot
          authorName: normalizedIdentity.isAnonymous
            ? undefined
            : (normalizedIdentity.authorName ?? getTodDisplayName(answerUser, 'User')),
          authorPhotoUrl: normalizedIdentity.authorPhotoUrl,
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
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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

    // Generate media URL if storage ID provided
    let mediaUrl: string | undefined;
    if (args.mediaStorageId) {
      mediaUrl = await ctx.storage.getUrl(args.mediaStorageId) ?? undefined;
    }
    let resolvedAuthorPhotoUrl = args.authorPhotoUrl;
    if (args.authorPhotoStorageId) {
      resolvedAuthorPhotoUrl = await ctx.storage.getUrl(args.authorPhotoStorageId) ?? undefined;
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
        patch.mediaMime = args.mediaMime;
        patch.durationSec = args.durationSec;
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
      const finalMime = args.removeMedia ? undefined : (args.mediaMime ?? existing.mediaMime);

      if (!finalText && !finalMedia) {
        throw new Error('Answer requires text or media');
      }

      // Compute type from content
      let type: 'text' | 'photo' | 'video' | 'voice' = 'text';
      if (finalMedia) {
        if (finalMime?.startsWith('audio/')) type = 'voice';
        else if (finalMime?.startsWith('video/')) type = 'video';
        else if (finalMime?.startsWith('image/')) type = 'photo';
        else if (args.type) type = args.type; // fallback to provided type
      }
      patch.type = type;

      // Identity: KEEP existing identityMode (do not change on edit)
      const existingIdentityMode = getNormalizedTodAnswerIdentity(existing).identityMode;
      const shouldStripIdentitySnapshot =
        existingIdentityMode === 'anonymous' || existingIdentityMode === 'no_photo';

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
      const shouldStripIdentitySnapshot = isAnon || isNoPhoto;

      // Compute type
      let type: 'text' | 'photo' | 'video' | 'voice' = 'text';
      if (hasMedia) {
        if (args.mediaMime?.startsWith('audio/')) type = 'voice';
        else if (args.mediaMime?.startsWith('video/')) type = 'video';
        else if (args.mediaMime?.startsWith('image/')) type = 'photo';
        else if (args.type) type = args.type;
      }

      const answerId = await ctx.db.insert('todAnswers', {
        promptId: args.promptId,
        userId,
        type,
        text: normalizedText,
        mediaStorageId: args.mediaStorageId,
        mediaUrl,
        mediaMime: args.mediaMime,
        durationSec: args.durationSec,
        likeCount: 0,
        createdAt: now,
        identityMode,
        isAnonymous: isAnon,
        visibility: args.visibility ?? 'public',
        viewMode: hasMedia ? (args.viewMode ?? 'tap') : undefined,
        viewDurationSec: hasMedia ? viewDurationSec : undefined,
        totalReactionCount: 0,
        reportCount: 0,
        // Author identity snapshot (cleared for anonymous and no_photo)
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
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
 * Rate limited per day. Same user can't report same answer twice.
 * If answer reaches 5 unique reports, it's hidden from everyone except author.
 */
export const reportAnswer = mutation({
  args: {
    answerId: v.string(),
    reporterId: v.string(),
    // Structured report reason (must stay aligned with the T/D UI options)
    reasonCode: v.union(
      v.literal('harassment'),
      v.literal('sexual'),
      v.literal('spam'),
      v.literal('hate'),
      v.literal('violence'),
      v.literal('privacy'),
      v.literal('scam'),
      v.literal('other')
    ),
    // Optional additional details
    reasonText: v.optional(v.string()),
    // Legacy field for backwards compatibility (deprecated)
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { answerId, reporterId: argsReporterId, reasonCode, reasonText, reason }) => {
    const reporterId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
      throw new Error('You have already reported this answer');
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, reporterId, 'report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    // Create report with structured reason
    await ctx.db.insert('todAnswerReports', {
      answerId,
      reporterId,
      reasonCode,
      reasonText,
      reason, // Legacy field for backwards compatibility
      createdAt: Date.now(),
    });

    // Increment report count
    const newReportCount = (answer.reportCount ?? 0) + 1;
    await ctx.db.patch(answer._id, { reportCount: newReportCount });

    // Check if threshold reached
    const isNowHidden = newReportCount >= REPORT_HIDE_THRESHOLD;

    return {
      success: true,
      reportCount: newReportCount,
      isNowHidden,
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
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
 * Rate limited per day. Same user can't report same prompt twice.
 * If prompt reaches 5 unique reports, it's hidden from feeds.
 */
export const reportPrompt = mutation({
  args: {
    promptId: v.string(),
    reporterId: v.string(),
    reasonCode: v.union(
      v.literal('harassment'),
      v.literal('sexual'),
      v.literal('spam'),
      v.literal('hate'),
      v.literal('violence'),
      v.literal('privacy'),
      v.literal('scam'),
      v.literal('other')
    ),
    reasonText: v.optional(v.string()),
  },
  handler: async (ctx, { promptId, reporterId: argsReporterId, reasonCode, reasonText }) => {
    const reporterId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
      throw new Error('You have already reported this prompt');
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, reporterId, 'prompt_report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    // Create report
    await ctx.db.insert('todPromptReports', {
      promptId,
      reporterId,
      reasonCode,
      reasonText,
      createdAt: Date.now(),
    });

    // Increment report count
    const newReportCount = (prompt.reportCount ?? 0) + 1;
    await ctx.db.patch(prompt._id, { reportCount: newReportCount });

    // Check if threshold reached
    const isNowHidden = newReportCount >= REPORT_HIDE_THRESHOLD;

    return {
      success: true,
      reportCount: newReportCount,
      isNowHidden,
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
    const currentUserId = await getOptionalAuthenticatedTodUserId(ctx, 'getUserAnswer');
    if (!currentUserId) {
      return null;
    }
    const answer = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', currentUserId)
      )
      .first();

    return answer;
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
    const userId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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
 * Claim viewing rights for an answer's secure media.
 * - For 'owner_only' visibility: only prompt owner can view
 * - For 'public' visibility: anyone can view, but only once
 * Generates a one-time media URL without durably consuming the view.
 * Durable consumption happens in finalizeAnswerMediaView after successful display.
 */
export const claimAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    viewerId: v.string(),
  },
  handler: async (ctx, { answerId, viewerId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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

    // Check if media was already deleted (prompt owner viewed it)
    if (answer.promptOwnerViewedAt) {
      return { status: 'already_deleted' as const };
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

    // Check if already viewed (one-time enforcement)
    // Answer author can always re-view their own media
    if (!isAnswerAuthor) {
      const existingView = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer_viewer', (q) =>
          q.eq('answerId', answerId).eq('viewerUserId', viewerId)
        )
        .first();

      if (existingView) {
        return { status: 'already_viewed' as const };
      }
    }

    // Generate a fresh URL before consuming one-time access.
    const url = await ctx.storage.getUrl(answer.mediaStorageId);
    if (!url) {
      return { status: 'no_media' as const };
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
    };
  },
});

/**
 * Finalize answer media view.
 * Durably consumes a one-time view after successful display.
 * If prompt owner is viewing, also deletes the underlying storage for everyone.
 */
export const finalizeAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    viewerId: v.string(),
  },
  handler: async (ctx, { answerId, viewerId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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

    // If prompt owner finalized viewing, delete media for everyone
    if (isPromptOwner && answer.mediaStorageId && !answer.promptOwnerViewedAt) {
      // Delete storage file
      await deleteStorageIfPresent(ctx, answer.mediaStorageId);

      // Mark as viewed by owner (this locks it for everyone)
      await ctx.db.patch(answer._id, {
        promptOwnerViewedAt: finalizedAt,
        mediaStorageId: undefined,
        mediaUrl: undefined,
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
  },
  handler: async (ctx, { answerId }) => {
    const viewerUserId = await requireAuthenticatedTodUserId(ctx, 'Unauthorized');

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

// ============================================================
// USER CONVERSATIONS QUERY (for Messages tab integration)
// ============================================================

/**
 * Get all conversations for a user from the EXISTING conversations table.
 * Returns conversations with participant info for display.
 * Used by chats.tsx to rehydrate from backend.
 */
export const getUserConversations = query({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    const userDbId = await getOptionalAuthenticatedTodUserId(ctx, 'getUserConversations');
    if (!userDbId) return [];

    // Get all conversation participations for this user
    const participations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userDbId as Id<'users'>))
      .collect();

    if (participations.length === 0) return [];

    // Fetch conversation details and other participant info
    const results = await Promise.all(
      participations.map(async (p) => {
        const conversation = await ctx.db.get(p.conversationId);
        if (!conversation) return null;

        // Find the other participant
        const otherParticipantId = conversation.participants.find(
          (pid) => pid !== userDbId
        );
        if (!otherParticipantId) return null;

        // Get other participant's profile
        const otherUser = await ctx.db.get(otherParticipantId);
        if (!otherUser) return null;

        let participantIdentity = getDefaultConnectIdentity(otherUser);

        if (conversation.connectionSource === 'tod') {
          const outgoingTodRequests = await ctx.db
            .query('todConnectRequests')
            .withIndex('by_from_to', (q) =>
              q.eq('fromUserId', userDbId as string).eq('toUserId', otherParticipantId as string)
            )
            .collect();
          const incomingTodRequests = await ctx.db
            .query('todConnectRequests')
            .withIndex('by_from_to', (q) =>
              q.eq('fromUserId', otherParticipantId as string).eq('toUserId', userDbId as string)
            )
            .collect();

          const latestConnectedRequest = [...outgoingTodRequests, ...incomingTodRequests]
            .filter((request) => request.status === 'connected')
            .sort((a, b) => b.createdAt - a.createdAt)[0];

          if (latestConnectedRequest) {
            const prompt = await ctx.db.get(latestConnectedRequest.promptId as Id<'todPrompts'>);
            const answer = await ctx.db
              .query('todAnswers')
              .filter((q) => q.eq(q.field('_id'), latestConnectedRequest.answerId as Id<'todAnswers'>))
              .first();

            if (prompt && prompt.ownerUserId === (otherParticipantId as string)) {
              participantIdentity = getPromptConnectIdentity(prompt, otherUser);
            } else if (answer && answer.userId === (otherParticipantId as string)) {
              participantIdentity = getAnswerConnectIdentity(answer, otherUser);
            }
          }
        }

        // Get last message for preview
        const lastMessage = await ctx.db
          .query('messages')
          .withIndex('by_conversation_created', (q) => q.eq('conversationId', p.conversationId))
          .order('desc')
          .first();

        return {
          id: conversation._id,
          participantId: otherParticipantId,
          participantAuthId: otherUser.authUserId ?? null,
          participantName: participantIdentity.name,
          participantPhotoUrl: participantIdentity.photoUrl,
          participantAge: participantIdentity.age,
          participantGender: participantIdentity.gender,
          participantIsAnonymous: participantIdentity.isAnonymous,
          participantPhotoBlurMode: participantIdentity.photoBlurMode,
          isPhotoBlurred:
            participantIdentity.isAnonymous || participantIdentity.photoBlurMode === 'blur',
          canViewClearPhoto:
            !participantIdentity.isAnonymous && participantIdentity.photoBlurMode !== 'blur',
          connectionSource: conversation.connectionSource ?? 'match',
          lastMessage: lastMessage?.content ?? null,
          lastMessageAt: conversation.lastMessageAt ?? conversation.createdAt,
          unreadCount: p.unreadCount,
          createdAt: conversation.createdAt,
        };
      })
    );

    // Filter out nulls and sort by last message time
    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  },
});
