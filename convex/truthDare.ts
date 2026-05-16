import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { reserveActionSlots, type RateLimitWindow } from './actionRateLimits';
import {
  filterOwnedSafePrivatePhotoUrls,
  PHASE2_MIN_PRIVATE_PHOTOS,
} from './phase2PrivatePhotos';
import { isPrivateDataDeleted } from './privateDeletion';
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
const TOD_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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
const TOD_CONNECT_REQUEST_SCAN_LIMIT = 80;
const TOD_PROMPT_THREAD_ANSWER_SCAN_LIMIT = 160;
const TOD_REACTION_SCAN_LIMIT = 500;
const TOD_MEDIA_VIEW_COUNT_SCAN_LIMIT = 500;

function debugTodLog(..._args: unknown[]) {}

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

type TodIdentityAssertion = {
  authUserId?: string;
  viewerUserId?: string;
  userId?: string;
  ownerUserId?: string;
  authorUserId?: string;
};

async function assertTodIdentityAssertions(
  ctx: any,
  tokenUserId: Id<'users'>,
  assertions: TodIdentityAssertion = {},
): Promise<void> {
  const hints = [
    assertions.authUserId,
    assertions.viewerUserId,
    assertions.userId,
    assertions.ownerUserId,
    assertions.authorUserId,
  ];

  for (const hint of hints) {
    const trimmed = hint?.trim();
    if (!trimmed) continue;
    const resolved = await resolveUserIdByAuthId(ctx, trimmed);
    if (!resolved || resolved !== tokenUserId) {
      throw new Error('UNAUTHORIZED');
    }
  }
}

async function requireAuthenticatedTodUserId(
  ctx: any,
  token: string,
  assertions: TodIdentityAssertion = {},
  errorMessage: string = 'UNAUTHORIZED'
): Promise<Id<'users'>> {
  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    throw new Error(errorMessage);
  }

  const tokenUserId = await validateSessionToken(ctx, trimmedToken);
  if (!tokenUserId) {
    throw new Error(errorMessage);
  }
  await assertTodIdentityAssertions(ctx, tokenUserId, assertions);
  return tokenUserId;
}

async function getOptionalAuthenticatedTodUserId(
  ctx: any,
  token?: string,
  assertions: TodIdentityAssertion = {},
  contextLabel: string = 'truthDare'
): Promise<Id<'users'> | undefined> {
  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    return undefined;
  }

  const tokenUserId = await validateSessionToken(ctx, trimmedToken);
  if (!tokenUserId) {
    throw new Error('UNAUTHORIZED');
  }
  await assertTodIdentityAssertions(ctx, tokenUserId, assertions);

  return tokenUserId;
}

// ============================================================
// P0 HARDENING HELPERS (TOD-MEDIA-1..6, TOD-BIZ-1)
// ============================================================

// Maximum number of media upload attempts per (promptId, responder).
// Counted in `todAnswerUploadAttempts` / `todPrivateMediaAttempts`.
// MONOTONIC: incremented on every successful media upload acceptance.
// NEVER decremented on remove-media / deleteMyAnswer / answer recreate —
// so refresh / retry / reinstall / multi-device cannot bypass the cap.
const MAX_TOD_MEDIA_UPLOAD_ATTEMPTS = 2;
const TOD_MEDIA_ATTEMPTS_EXCEEDED_ERROR =
  'Upload limit reached. You can upload media at most 2 times per answer.';
const TOD_MEDIA_REPLACE_AFTER_VIEW_ERROR =
  'This media has already been viewed and cannot be replaced.';

/**
 * Read the durable upload-attempt counter for the answer media path
 * (TOD-MEDIA-1). Returns 0 when no row exists yet.
 */
async function getAnswerMediaUploadAttemptCount(
  ctx: any,
  promptId: string,
  userId: string,
): Promise<number> {
  const row = await ctx.db
    .query('todAnswerUploadAttempts')
    .withIndex('by_prompt_user', (q: any) =>
      q.eq('promptId', promptId).eq('userId', userId),
    )
    .first();
  return row?.attemptCount ?? 0;
}

/**
 * Increment the durable answer upload-attempt counter by 1. Creates the row
 * on first call. Caller MUST have already checked the cap and called
 * `assertAnswerMediaCapNotExceeded` first; this only writes.
 *
 * P0 SECURITY CONTRACT — DO NOT WEAKEN:
 *   Rows in `todAnswerUploadAttempts` MUST NEVER be deleted when an answer
 *   is deleted (see `deleteMyAnswer` and the cascade in
 *   `runDeletePromptCascadeBounded`).  The 2-attempt cap survives
 *   delete-and-recreate, which is the only thing that prevents an attacker
 *   from burning unlimited fresh storage objects by spamming
 *   `createOrEditAnswer` → `deleteMyAnswer` loops.  Resetting the counter
 *   on delete silently downgrades the upload-attempt cap to "per current
 *   answer existence" instead of "per (prompt, user) for all time".
 */
async function incrementAnswerMediaUploadAttempt(
  ctx: any,
  promptId: string,
  userId: string,
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query('todAnswerUploadAttempts')
    .withIndex('by_prompt_user', (q: any) =>
      q.eq('promptId', promptId).eq('userId', userId),
    )
    .first();
  if (row) {
    await ctx.db.patch(row._id, {
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
    });
  } else {
    await ctx.db.insert('todAnswerUploadAttempts', {
      promptId,
      userId,
      attemptCount: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
    });
  }
}

/**
 * Throws if the responder has already used all permitted upload attempts.
 * Convex serializes mutations so the read + later increment in the same
 * mutation cannot race.
 */
async function assertAnswerMediaCapNotExceeded(
  ctx: any,
  promptId: string,
  userId: string,
): Promise<void> {
  const count = await getAnswerMediaUploadAttemptCount(ctx, promptId, userId);
  if (count >= MAX_TOD_MEDIA_UPLOAD_ATTEMPTS) {
    throw new Error(TOD_MEDIA_ATTEMPTS_EXCEEDED_ERROR);
  }
}

/**
 * Throws if the existing answer's media has any view footprint:
 *   - `mediaViewedAt` is set, OR
 *   - `promptOwnerViewedAt` is set, OR
 *   - any `todAnswerViews` row references this answer.
 *
 * Used by `createOrEditAnswer` (TOD-MEDIA-2) to block replacement-after-view.
 * Once any non-author viewer has burned a one-time view, the author can never
 * upload a replacement that the same viewer would see fresh.
 */
async function assertNoPriorAnswerView(
  ctx: any,
  answer: { _id: Id<'todAnswers'>; mediaViewedAt?: number; promptOwnerViewedAt?: number },
): Promise<void> {
  if (answer.mediaViewedAt !== undefined || answer.promptOwnerViewedAt !== undefined) {
    throw new Error(TOD_MEDIA_REPLACE_AFTER_VIEW_ERROR);
  }
  const existingView = await ctx.db
    .query('todAnswerViews')
    .withIndex('by_answer', (q: any) => q.eq('answerId', answer._id as string))
    .first();
  if (existingView) {
    throw new Error(TOD_MEDIA_REPLACE_AFTER_VIEW_ERROR);
  }
}

/** Read the durable V1 private-media upload-attempt counter (TOD-MEDIA-3). */
async function getPrivateMediaUploadAttemptCount(
  ctx: any,
  promptId: string,
  fromUserId: string,
): Promise<number> {
  const row = await ctx.db
    .query('todPrivateMediaAttempts')
    .withIndex('by_prompt_from', (q: any) =>
      q.eq('promptId', promptId).eq('fromUserId', fromUserId),
    )
    .first();
  return row?.attemptCount ?? 0;
}

/**
 * Increment the durable V1 private-media upload-attempt counter (TOD-MEDIA-3).
 *
 * P0 SECURITY CONTRACT — DO NOT WEAKEN:
 *   Rows in `todPrivateMediaAttempts` MUST NEVER be deleted by the V1
 *   submit/reject/expire flows.  The 2-attempt cap is per-(prompt, sender)
 *   for all time so the sender cannot use rejection or expiry as a way to
 *   regain upload budget.
 */
async function incrementPrivateMediaUploadAttempt(
  ctx: any,
  promptId: string,
  fromUserId: string,
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query('todPrivateMediaAttempts')
    .withIndex('by_prompt_from', (q: any) =>
      q.eq('promptId', promptId).eq('fromUserId', fromUserId),
    )
    .first();
  if (row) {
    await ctx.db.patch(row._id, {
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
    });
  } else {
    await ctx.db.insert('todPrivateMediaAttempts', {
      promptId,
      fromUserId,
      attemptCount: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
    });
  }
}

async function assertPrivateMediaCapNotExceeded(
  ctx: any,
  promptId: string,
  fromUserId: string,
): Promise<void> {
  const count = await getPrivateMediaUploadAttemptCount(ctx, promptId, fromUserId);
  if (count >= MAX_TOD_MEDIA_UPLOAD_ATTEMPTS) {
    throw new Error(TOD_MEDIA_ATTEMPTS_EXCEEDED_ERROR);
  }
}

// ============================================================
// P1 HARDENING: STRONGER MULTI-WINDOW RATE LIMITS (P1-TOD-RL-*)
// ============================================================
//
// The legacy `checkRateLimit` (defined further below) uses a single
// fixed-window bucket per action and is preserved for backward compat
// on the heaviest user paths.  This section adds a SECOND layer on top
// using `reserveActionSlots` so we can:
//   - Apply minute + hour + daily backstops to expensive paths
//     (anti-bot-loop hardening for prompt/answer/connect/media flows).
//   - Apply per-(sender, recipient) caps for connect requests to
//     prevent targeted harassment without breaking the anonymity rule
//     (target id is hashed into the `action` string, never persisted in
//     a way that exposes the relationship outside this counter row).
//   - Cover the ~12 mutations that previously had NO rate limit at all
//     (track/release/cleanup pending uploads, edit/delete prompt,
//     respondToConnect, submit/begin/finalize/reject private media,
//     deleteMyAnswer, markPromptMediaViewed).
//
// `reserveActionSlots` is two-phase: it reads all windows first and
// only patches the counters when EVERY window accepts.  Denials never
// charge a slot, so user-tripped limits stay self-correcting.
//
// Windows are listed MOST permissive to LEAST permissive so the
// minute bucket is denied first on micro-bursts, with hour/day buckets
// catching sustained abuse.

type TodRateLimitBucket = {
  /** Internal action key used as the `action` arg to reserveActionSlots. */
  action: string;
  /** Ordered list of windows (most -> least permissive). */
  windows: RateLimitWindow[];
};

const TOD_P1_RL_WINDOWS: Record<string, TodRateLimitBucket> = {
  // --- Pending upload tracking (no per-action cost; cheap rows) ---
  track_pending_upload: {
    action: 'tod_track_pending_upload',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 60 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 600 },
    ],
  },
  release_pending_upload: {
    action: 'tod_release_pending_upload',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 60 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 600 },
    ],
  },
  cleanup_pending_upload: {
    action: 'tod_cleanup_pending_upload',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 30 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
    ],
  },

  // --- Prompt lifecycle (edit/delete had no limit before) ---
  edit_prompt: {
    action: 'tod_edit_prompt',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 10 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 60 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 200 },
    ],
  },
  delete_prompt: {
    action: 'tod_delete_prompt',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 5 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 30 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 120 },
    ],
  },

  // --- Connect responses (V2 + V1 private media) ---
  respond_to_connect: {
    action: 'tod_respond_to_connect',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 30 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 1500 },
    ],
  },
  reject_private_media_connect: {
    action: 'tod_reject_private_media_connect',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 30 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
    ],
  },

  // --- V1 private-media submission + view lifecycle ---
  submit_private_media: {
    action: 'tod_submit_private_media',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 5 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 30 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 150 },
    ],
  },
  begin_private_media_view: {
    action: 'tod_begin_private_media_view',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 30 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
    ],
  },
  finalize_private_media_view: {
    action: 'tod_finalize_private_media_view',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 30 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
    ],
  },

  // --- Answer lifecycle ---
  delete_answer: {
    action: 'tod_delete_answer',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 10 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 60 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 300 },
    ],
  },

  // --- Prompt media one-time view (TOD-BIZ-1) ---
  mark_prompt_media_viewed: {
    action: 'tod_mark_prompt_media_viewed',
    windows: [
      { kind: 'minute', windowMs: 60_000, max: 30 },
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
    ],
  },

  // --- Hourly/daily backstops for the heaviest existing-checkRateLimit
  //     mutations.  The legacy minute window stays in `checkRateLimit`;
  //     these add a sustained-abuse ceiling.
  prompt_backstop: {
    action: 'tod_prompt_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 30 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 100 },
    ],
  },
  answer_backstop: {
    action: 'tod_answer_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 120 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 600 },
    ],
  },
  media_upload_backstop: {
    action: 'tod_media_upload_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 120 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 400 },
    ],
  },
  claim_media_backstop: {
    action: 'tod_claim_media_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 200 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 1000 },
    ],
  },
  connect_backstop: {
    action: 'tod_connect_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 120 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 500 },
    ],
  },

  // P2-TOD-RL: Hour+day backstops for the remaining legacy-checkRateLimit
  // paths (reactions, reports).  The legacy minute bucket stays in place;
  // these add sustained-abuse ceilings without changing the user-facing
  // per-minute throttling.  Reactions are high-frequency by design
  // (legitimate scroll/tap), so caps are loose; reports are already daily
  // in the legacy bucket so the hour cap here is the strictest enforcement.
  reaction_backstop: {
    action: 'tod_reaction_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 2000 },
    ],
  },
  prompt_reaction_backstop: {
    action: 'tod_prompt_reaction_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 300 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 2000 },
    ],
  },
  report_backstop: {
    action: 'tod_report_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 5 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 10 },
    ],
  },
  prompt_report_backstop: {
    action: 'tod_prompt_report_backstop',
    windows: [
      { kind: 'hour', windowMs: 60 * 60_000, max: 5 },
      { kind: 'day', windowMs: 24 * 60 * 60_000, max: 10 },
    ],
  },
};

// P2-TOD-MOD: Bounded scan cap for moderation report recount.
// The recount is only used to detect whether the answer/prompt has crossed
// the `hidden_by_reports` threshold (~3 unique reports).  Scanning up to
// REPORT_COUNT_SCAN_CAP reports gives us either the exact count (when
// returned < CAP) or a lower bound that already trips the threshold (when
// returned == CAP).  This replaces the previous unbounded `.collect()`
// recount which would scan every historical report row.
const TOD_REPORT_COUNT_SCAN_CAP = 16;

// P2-TOD-CASCADE: Per-section batch caps for `deleteMyPrompt`.  Each cascade
// section uses `.take(BATCH)`; when any section fills its batch the
// continuation internalMutation is scheduled to pick up the remainder.  The
// prompt row itself is hard-deleted at the top of the parent mutation so the
// user sees an immediate disappearance; orphaned children become invisible
// (their `canShow*` checks fail without a parent) until the cascade finishes.
const TOD_PROMPT_CASCADE_BATCH = 200;

// P2-TOD-CLEANUP: Bounded batch for `cleanupExpiredPrivateMedia`.  The cron
// is idempotent so any rows left over after one run are picked up on the
// next invocation.  Previous code used unbounded `.collect()` over an
// index that could grow to all historical 'viewing'/'pending' rows.
const TOD_PRIVATE_MEDIA_CLEANUP_BATCH = 200;

// Per-(sender, recipient) caps for connect requests.  The target user id is
// folded into the `action` string so reserveActionSlots scopes the counter
// per pair.  This prevents targeted harassment (one user spamming connects to
// one victim) without breaking anonymity (target id never leaves this row,
// which is keyed by the SENDER's userId).
const TOD_PER_TARGET_CONNECT_WINDOWS: RateLimitWindow[] = [
  { kind: 'hour', windowMs: 60 * 60_000, max: 5 },
  { kind: 'day', windowMs: 24 * 60 * 60_000, max: 15 },
];

/**
 * Throws on denial.  Used inline at the top of mutations to enforce a
 * named bucket from `TOD_P1_RL_WINDOWS`.  Never decrements on later
 * mutation failure — the cost is paid for attempting the action, which
 * is exactly the anti-loop property we want.
 */
async function enforceTodActionLimit(
  ctx: any,
  userId: Id<'users'>,
  bucketKey: keyof typeof TOD_P1_RL_WINDOWS,
): Promise<void> {
  const bucket = TOD_P1_RL_WINDOWS[bucketKey];
  if (!bucket) return;
  const result = await reserveActionSlots(ctx, userId, bucket.action, bucket.windows, 1);
  if (!result.accept) {
    throw new Error(RATE_LIMIT_ERROR);
  }
}

/**
 * Per-target anti-harassment cap for connect-style actions.  Encodes the
 * recipient id into the action string so the counter is scoped per
 * (sender, recipient) pair.
 */
async function enforceTodPerTargetConnectLimit(
  ctx: any,
  fromUserId: Id<'users'>,
  toUserId: string,
): Promise<void> {
  const result = await reserveActionSlots(
    ctx,
    fromUserId,
    `tod_connect_target:${toUserId}`,
    TOD_PER_TARGET_CONNECT_WINDOWS,
    1,
  );
  if (!result.accept) {
    throw new Error(RATE_LIMIT_ERROR);
  }
}

/**
 * Atomic one-time-view claim helper for prompt-owner photo/video media
 * (TOD-BIZ-1 / TOD-MEDIA-5 / TOD-MEDIA-6).
 *
 * Convex mutations are serializable: a read of the
 * `by_prompt_viewer` index that returned empty will conflict with any
 * concurrent insert touching the same (promptId, viewerUserId) pair. Two
 * parallel `openPromptMedia` / `preparePromptMedia` / `markPromptMediaViewed`
 * calls therefore CANNOT both insert; the loser retries, observes the row,
 * and returns `alreadyViewed: true`.
 *
 * Always returns the canonical (existing or freshly inserted) row id and
 * timestamp so callers can return consistent metadata.
 *
 * IMPORTANT: callers MUST short-circuit owner and voice branches BEFORE
 * calling this helper. Owner self-views and voice playback are never tracked
 * by `todPromptMediaViews`.
 */
async function consumePromptMediaViewOnce(
  ctx: any,
  args: {
    promptId: string;
    viewerUserId: string;
    ownerUserId: string;
    mediaKind: 'photo' | 'video';
  },
): Promise<{ alreadyViewed: boolean; viewedAt: number; rowId: Id<'todPromptMediaViews'> }> {
  const { promptId, viewerUserId, ownerUserId, mediaKind } = args;

  const existing = await ctx.db
    .query('todPromptMediaViews')
    .withIndex('by_prompt_viewer', (q: any) =>
      q.eq('promptId', promptId).eq('viewerUserId', viewerUserId),
    )
    .first();
  if (existing) {
    return {
      alreadyViewed: true,
      viewedAt: existing.viewedAt,
      rowId: existing._id as Id<'todPromptMediaViews'>,
    };
  }

  const viewedAt = Date.now();
  const rowId = await ctx.db.insert('todPromptMediaViews', {
    promptId,
    viewerUserId,
    ownerUserId,
    mediaKind,
    viewedAt,
  });
  return { alreadyViewed: false, viewedAt, rowId: rowId as Id<'todPromptMediaViews'> };
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
  void user;
  void fallbackUrl;
  // Connect identity helpers are synchronous and cannot validate ownership or
  // moderation state. Active feed/thread payloads use buildTodAuthorSnapshot,
  // which filters through owned safe Phase-2 photos; these legacy connect
  // helpers must fail closed instead of returning raw stored URLs.
  return null;
}

type TodAuthorSnapshot = {
  name?: string;
  photoUrl?: string;
  age?: number;
  gender?: string;
};

async function buildTodAuthorSnapshot(
  ctx: any,
  userId: Id<'users'>,
): Promise<TodAuthorSnapshot> {
  const [user, privateProfile] = await Promise.all([
    ctx.db.get(userId) as Promise<Doc<'users'> | null>,
    ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q: any) => q.eq('userId', userId))
      .first() as Promise<Doc<'userPrivateProfiles'> | null>,
  ]);

  const safePrivatePhotoUrls = privateProfile
    ? await filterOwnedSafePrivatePhotoUrls(ctx, userId, privateProfile.privatePhotoUrls ?? [])
    : [];

  return {
    name: trimText(privateProfile?.displayName) ?? trimText(user?.name ?? undefined) ?? trimText(user?.handle ?? undefined),
    photoUrl: safePrivatePhotoUrls[0],
    age: calculateTodAge(user?.dateOfBirth) ?? undefined,
    gender: trimText(privateProfile?.gender ?? undefined) ?? trimText(user?.gender ?? undefined),
  };
}

async function buildTodSnapshotForStoredUserId(
  ctx: any,
  storedUserId: string | Id<'users'> | undefined,
): Promise<TodAuthorSnapshot> {
  if (!storedUserId || isSystemTodOwnerId(storedUserId as string)) {
    return {};
  }
  const resolvedUserId = await resolveStoredTodUserId(ctx, storedUserId);
  if (!resolvedUserId) {
    return {};
  }
  return buildTodAuthorSnapshot(ctx, resolvedUserId);
}

async function resolveStoredTodUserId(
  ctx: any,
  storedUserId: string | Id<'users'> | undefined,
): Promise<Id<'users'> | null> {
  if (!storedUserId || isSystemTodOwnerId(storedUserId as string)) return null;
  try {
    const direct = await ctx.db.get(storedUserId as Id<'users'>);
    if (direct) return direct._id;
  } catch {
    // Legacy rows may carry auth ids instead of Convex ids.
  }
  return await resolveUserIdByAuthId(ctx, storedUserId as string);
}

type TodAccessContext = {
  user: Doc<'users'>;
  profile: Doc<'userPrivateProfiles'>;
  age: number;
  safePhotoUrls: string[];
};

type TodVisibilityOptions = {
  ignoreViewerReport?: boolean;
};

function isTodVisibleUser(user: Doc<'users'> | null | undefined): user is Doc<'users'> {
  return !!user && user.isActive === true && user.isBanned !== true && !user.deletedAt;
}

async function getTodAccessContext(
  ctx: any,
  userId: Id<'users'>,
): Promise<TodAccessContext | null> {
  const [user, profile] = await Promise.all([
    ctx.db.get(userId) as Promise<Doc<'users'> | null>,
    ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q: any) => q.eq('userId', userId))
      .first() as Promise<Doc<'userPrivateProfiles'> | null>,
  ]);

  if (!isTodVisibleUser(user)) return null;
  if (user.phase2OnboardingCompleted !== true) return null;

  const age = calculateTodAge(user.dateOfBirth);
  if (age === null || age < 18) return null;

  if (
    !profile ||
    profile.isPrivateEnabled !== true ||
    profile.isSetupComplete !== true ||
    profile.hideFromDeepConnect === true
  ) {
    return null;
  }

  if (await isPrivateDataDeleted(ctx, userId)) return null;

  const safePhotoUrls = await filterOwnedSafePrivatePhotoUrls(
    ctx,
    userId,
    profile.privatePhotoUrls ?? [],
  );
  if (safePhotoUrls.length < PHASE2_MIN_PRIVATE_PHOTOS) return null;

  return { user, profile, age, safePhotoUrls };
}

async function getTodAccessContextForStoredUserId(
  ctx: any,
  storedUserId: string | Id<'users'> | undefined,
): Promise<TodAccessContext | null> {
  if (!storedUserId || isSystemTodOwnerId(storedUserId as string)) return null;
  const resolvedUserId = await resolveStoredTodUserId(ctx, storedUserId);
  if (!resolvedUserId) return null;
  return getTodAccessContext(ctx, resolvedUserId);
}

async function canShowTodPromptForViewer(
  ctx: any,
  prompt: TodReportModeratedItem & {
    _id: Id<'todPrompts'>;
    ownerUserId: string;
    expiresAt?: number;
    createdAt: number;
  },
  viewerUserId: Id<'users'>,
  blockedUserIds?: Set<string>,
  reportedPromptIds?: Set<string>,
  options: TodVisibilityOptions = {},
): Promise<boolean> {
  const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
  if (expires <= Date.now()) return false;
  if (blockedUserIds?.has(prompt.ownerUserId as string)) return false;
  if (!options.ignoreViewerReport && reportedPromptIds?.has(prompt._id as unknown as string)) return false;
  if (isPromptHiddenForViewer(prompt, viewerUserId)) return false;
  if (
    !options.ignoreViewerReport &&
    await hasViewerReportedPrompt(ctx, prompt._id as unknown as string, viewerUserId)
  ) {
    return false;
  }

  if (isSystemTodOwnerId(prompt.ownerUserId)) {
    return true;
  }

  const ownerAccess = await getTodAccessContextForStoredUserId(ctx, prompt.ownerUserId);
  return !!ownerAccess;
}

async function canShowTodAnswerForViewer(
  ctx: any,
  answer: TodReportModeratedItem & {
    _id: Id<'todAnswers'>;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  blockedUserIds?: Set<string>,
  reportedAnswerIds?: Set<string>,
  options: TodVisibilityOptions = {},
): Promise<boolean> {
  if (blockedUserIds?.has(answer.userId as string)) return false;
  if (!options.ignoreViewerReport && reportedAnswerIds?.has(answer._id as unknown as string)) return false;
  if (isAnswerHiddenForViewer(answer, viewerUserId)) return false;
  if (
    !options.ignoreViewerReport &&
    await hasViewerReportedAnswer(ctx, answer._id as unknown as string, viewerUserId)
  ) {
    return false;
  }

  const authorAccess = await getTodAccessContextForStoredUserId(ctx, answer.userId);
  return !!authorAccess;
}

async function canEligibleTodViewerSeePrompt(
  ctx: any,
  prompt: TodReportModeratedItem & {
    _id: Id<'todPrompts'>;
    ownerUserId: string;
    createdAt: number;
    expiresAt?: number;
  },
  viewerUserId: Id<'users'>,
  options: { ignoreViewerPromptReport?: boolean } = {},
): Promise<boolean> {
  if (!(await getTodAccessContext(ctx, viewerUserId))) return false;

  const [blockedUserIds, reportedPromptIds] = await Promise.all([
    getBlockedUserIdsForViewer(ctx, viewerUserId),
    options.ignoreViewerPromptReport
      ? Promise.resolve(new Set<string>())
      : getTodPromptIdsReportedByViewer(ctx, viewerUserId),
  ]);

  return canShowTodPromptForViewer(
    ctx,
    prompt,
    viewerUserId,
    blockedUserIds,
    reportedPromptIds,
    { ignoreViewerReport: options.ignoreViewerPromptReport === true },
  );
}

async function canEligibleTodViewerSeeAnswer(
  ctx: any,
  answer: TodReportModeratedItem & {
    _id: Id<'todAnswers'> | string;
    promptId: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: (TodReportModeratedItem & {
    _id: Id<'todPrompts'>;
    ownerUserId: string;
    createdAt: number;
    expiresAt?: number;
  }) | null,
  options: {
    ignoreViewerPromptReport?: boolean;
    ignoreViewerAnswerReport?: boolean;
  } = {},
): Promise<boolean> {
  if (!(await getTodAccessContext(ctx, viewerUserId))) return false;

  const promptDoc =
    prompt ?? (await ctx.db.get(answer.promptId as Id<'todPrompts'>));
  if (!promptDoc) return false;

  const [blockedUserIds, reportedPromptIds, reportedAnswerIds] = await Promise.all([
    getBlockedUserIdsForViewer(ctx, viewerUserId),
    options.ignoreViewerPromptReport
      ? Promise.resolve(new Set<string>())
      : getTodPromptIdsReportedByViewer(ctx, viewerUserId),
    options.ignoreViewerAnswerReport
      ? Promise.resolve(new Set<string>())
      : getTodAnswerIdsReportedByViewer(ctx, viewerUserId),
  ]);

  if (
    !(await canShowTodPromptForViewer(
      ctx,
      promptDoc,
      viewerUserId,
      blockedUserIds,
      reportedPromptIds,
      { ignoreViewerReport: options.ignoreViewerPromptReport === true },
    ))
  ) {
    return false;
  }

  return canShowTodAnswerForViewer(
    ctx,
    {
      ...answer,
      _id: answer._id as Id<'todAnswers'>,
    },
    viewerUserId,
    blockedUserIds,
    reportedAnswerIds,
    { ignoreViewerReport: options.ignoreViewerAnswerReport === true },
  );
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

/**
 * Resolve prompt-owner media view metadata for a feed/thread payload.
 * - For prompt-owner photo/video: returns unique-viewer count (owner-only) and
 *   the viewer's already-viewed flag (non-owner only).
 * - For voice or no-media: count is omitted and viewed flag stays false (voice
 *   media is replayable and is intentionally NOT tracked in this ledger).
 *
 * `isPromptMediaOwner` is computed from prompt.ownerUserId and reused by
 * clients to decide whether to render owner-only UI (count badge) or
 * non-owner UI (covered tile + already-viewed badge).
 */
async function getPromptMediaViewMeta(
  ctx: any,
  prompt: {
    _id: Id<'todPrompts'> | string;
    ownerUserId: string;
    mediaKind?: string | null;
    mediaStorageId?: Id<'_storage'> | undefined;
  },
  viewerDbId: Id<'users'> | undefined
): Promise<{
  promptMediaViewCount?: number;
  viewerHasViewedPromptMedia: boolean;
  isPromptMediaOwner: boolean;
}> {
  const isPromptMediaOwner =
    !isSystemTodOwnerId(prompt.ownerUserId) &&
    !!viewerDbId &&
    prompt.ownerUserId === viewerDbId;

  // Only photo/video media participates in the one-time view ledger.
  // Voice is replayable and never recorded; "no media" prompts have nothing
  // to count or gate.
  if (
    !prompt.mediaStorageId ||
    (prompt.mediaKind !== 'photo' && prompt.mediaKind !== 'video')
  ) {
    return {
      promptMediaViewCount: undefined,
      viewerHasViewedPromptMedia: false,
      isPromptMediaOwner,
    };
  }

  const promptIdStr = prompt._id as unknown as string;

  if (isPromptMediaOwner) {
    // Owner: compute unique-viewer count by counting view rows for this prompt.
    // The mutation below NEVER inserts a row for the owner, so this count is
    // already "non-owner unique viewers" by construction.
    const rows = await ctx.db
      .query('todPromptMediaViews')
      .withIndex('by_prompt', (q: any) => q.eq('promptId', promptIdStr))
      .take(TOD_MEDIA_VIEW_COUNT_SCAN_LIMIT);
    return {
      promptMediaViewCount: rows.length,
      viewerHasViewedPromptMedia: false,
      isPromptMediaOwner: true,
    };
  }

  // Non-owner: only need to know whether THIS viewer has already opened the
  // media. No count is exposed to non-owners.
  if (!viewerDbId) {
    return {
      promptMediaViewCount: undefined,
      viewerHasViewedPromptMedia: false,
      isPromptMediaOwner: false,
    };
  }

  const existing = await ctx.db
    .query('todPromptMediaViews')
    .withIndex('by_prompt_viewer', (q: any) =>
      q.eq('promptId', promptIdStr).eq('viewerUserId', viewerDbId as string)
    )
    .first();

  return {
    promptMediaViewCount: undefined,
    viewerHasViewedPromptMedia: !!existing,
    isPromptMediaOwner: false,
  };
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

type TodAnswerMediaCounts = {
  photoCount: number;
  videoCount: number;
  totalMediaCount: number;
};

function hasTodAnswerMedia(answer: { type: string }): boolean {
  return answer.type === 'photo' || answer.type === 'video' || answer.type === 'voice';
}

function getTodAnswerMediaCounts(answers: Array<{ type: string }>): TodAnswerMediaCounts {
  return answers.reduce<TodAnswerMediaCounts>(
    (counts, answer) => {
      if (!hasTodAnswerMedia(answer)) return counts;
      if (answer.type === 'photo') counts.photoCount += 1;
      if (answer.type === 'video') counts.videoCount += 1;
      counts.totalMediaCount += 1;
      return counts;
    },
    { photoCount: 0, videoCount: 0, totalMediaCount: 0 },
  );
}

async function canViewerAccessAnswerMedia(
  ctx: any,
  answer: TodReportModeratedItem & {
    _id: Id<'todAnswers'> | string;
    promptId: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: (TodReportModeratedItem & {
    _id: Id<'todPrompts'>;
    ownerUserId: string;
    createdAt: number;
    expiresAt?: number;
  }) | null
): Promise<boolean> {
  const promptDoc =
    prompt ?? (await ctx.db.get(answer.promptId as Id<'todPrompts'>));
  if (!promptDoc) {
    return false;
  }

  if (!(await canEligibleTodViewerSeeAnswer(ctx, answer, viewerUserId, promptDoc))) {
    return false;
  }

  if (answer.visibility === 'owner_only') {
    return promptDoc.ownerUserId === viewerUserId || answer.userId === viewerUserId;
  }

  return true;
}

async function canViewerAccessPromptMedia(
  ctx: any,
  prompt: TodReportModeratedItem & {
    _id: Id<'todPrompts'>;
    ownerUserId: string;
    createdAt: number;
    expiresAt?: number;
  },
  viewerUserId: Id<'users'>,
): Promise<boolean> {
  return canEligibleTodViewerSeePrompt(ctx, prompt, viewerUserId);
}

async function canViewerAccessVoiceAnswer(
  ctx: any,
  answer: TodReportModeratedItem & {
    _id: Id<'todAnswers'> | string;
    promptId: string;
    visibility?: string;
    userId: string;
  },
  viewerUserId: Id<'users'>,
  prompt?: (TodReportModeratedItem & {
    _id: Id<'todPrompts'>;
    ownerUserId: string;
    createdAt: number;
    expiresAt?: number;
  }) | null
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
    .take(TOD_REACTION_SCAN_LIMIT);

  const emojiCountMap: Map<string, number> = new Map();
  for (const reaction of reactions) {
    emojiCountMap.set(reaction.emoji, (emojiCountMap.get(reaction.emoji) || 0) + 1);
  }

  let myReaction: string | null = null;
  if (viewerUserId) {
    const myReactionDoc =
      reactions.find((reaction: any) => reaction.userId === viewerUserId) ??
      (await ctx.db
        .query('todAnswerReactions')
        .withIndex('by_answer_user', (q: any) =>
          q.eq('answerId', answerId).eq('userId', viewerUserId as string)
        )
        .first());
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
    token: v.string(),
    storageIds: v.array(v.id('_storage')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, storageIds, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap pending-upload tracking churn (anti-bot-loop).
    await enforceTodActionLimit(ctx, userId, 'track_pending_upload');
    const uniqueStorageIds = Array.from(new Set(storageIds));
    const trackedIds: Id<'_storage'>[] = [];

    for (const storageId of uniqueStorageIds) {
      const existing = await ctx.db
        .query('pendingUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first();

      if (existing) {
        if (existing.userId !== userId) {
          // P3-TOD-ERR: generic message avoids confirming that another
          // user already owns this storage id (was: "...by another user").
          throw new Error('Upload reference unavailable');
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
    token: v.string(),
    storageIds: v.array(v.id('_storage')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, storageIds, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap pending-upload release churn (anti-bot-loop).
    await enforceTodActionLimit(ctx, userId, 'release_pending_upload');
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
        // P3-TOD-ERR: generic message; do not confirm the storage id is
        // owned by another user.
        throw new Error('Upload reference unavailable');
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
    token: v.string(),
    storageIds: v.array(v.id('_storage')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, storageIds, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap pending-upload cleanup churn (anti-bot-loop).
    await enforceTodActionLimit(ctx, userId, 'cleanup_pending_upload');
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
        // P3-TOD-ERR: generic message; do not confirm the storage id is
        // owned by another user.
        throw new Error('Upload reference unavailable');
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
    token: v.string(),
    type: v.union(v.literal('truth'), v.literal('dare')),
    text: v.string(),
    authUserId: v.optional(v.string()),
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
    const ownerUserId = await requireAuthenticatedTodUserId(
      ctx,
      args.token,
      { authUserId: args.authUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, ownerUserId))) {
      throw new Error('Phase-2 setup is required to create Truth or Dare prompts');
    }
    const promptText = validatePromptText(args.text);

    const now = Date.now();
    const expiresAt = now + TWENTY_FOUR_HOURS_MS;

    const rateCheck = await checkRateLimit(ctx, ownerUserId, 'prompt');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }
    // P1-TOD-RL: hour+day backstop on top of legacy minute bucket.
    await enforceTodActionLimit(ctx, ownerUserId, 'prompt_backstop');

    const ownerSnapshot = await buildTodAuthorSnapshot(ctx, ownerUserId);
    const isPublicPost = args.isAnonymous === false;
    const finalOwnerName = isPublicPost ? ownerSnapshot.name : undefined;
    const finalOwnerAge = ownerSnapshot.age;
    const finalOwnerGender = ownerSnapshot.gender;
    const finalOwnerPhotoUrl = isPublicPost ? ownerSnapshot.photoUrl : undefined;

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

    if (args.mediaStorageId) {
      const recentOwnerPrompts = await ctx.db
        .query('todPrompts')
        .withIndex('by_owner', (q) => q.eq('ownerUserId', ownerUserId))
        .order('desc')
        .take(20);
      const duplicatePrompt = recentOwnerPrompts.find(
        (prompt) => prompt.mediaStorageId === args.mediaStorageId
      );
      if (duplicatePrompt) {
        return {
          promptId: duplicatePrompt._id,
          expiresAt: duplicatePrompt.expiresAt ?? duplicatePrompt.createdAt + TWENTY_FOUR_HOURS_MS,
          alreadyExisted: true,
        };
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
    debugTodLog(`[T/D] Created prompt: id=${promptId}, type=${args.type}, isAnon=${args.isAnonymous ?? true}, photoBlurMode=${args.photoBlurMode ?? 'none'}, hasServerPhoto=${!!finalOwnerPhotoUrl}`);
    if (resolvedPromptMediaKind) {
      debugTodLog(`[T/D] Prompt media attached: kind=${resolvedPromptMediaKind}, size=${promptMediaUpload?.size}, durationSec=${promptMediaDurationSec ?? 'n/a'}`);
    }

    return { promptId, expiresAt };
  },
});

// Edit own prompt — text only.
//
// Product decision: prompt slots are scarce (weekly/monthly/subscription gated)
// so an owner is intentionally not allowed to mutate type, identity/visibility
// or attached media after posting. Re-using a slot to swap content/media would
// undermine the slot economy. Edits are restricted to the prompt text.
//
// Validation: `validatePromptText` enforces 20–400 trimmed chars (same bounds
// as createPrompt) and trims surrounding whitespace.
export const editMyPrompt = mutation({
  args: {
    token: v.string(),
    promptId: v.string(),
    authUserId: v.optional(v.string()),
    newText: v.string(),
  },
  handler: async (ctx, { token, promptId, authUserId, newText }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap prompt edits (anti-bot-loop; text-only edit churn).
    await enforceTodActionLimit(ctx, userId, 'edit_prompt');

    const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
    if (!prompt) {
      throw new Error('Prompt not found');
    }
    if (isSystemTodOwnerId(prompt.ownerUserId)) {
      throw new Error('Prompt owner unavailable for private media');
    }
    if (prompt.ownerUserId !== userId) {
      throw new Error('Unauthorized: you can only edit your own prompts');
    }

    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      throw new Error('Cannot edit expired prompts');
    }

    const validatedText = validatePromptText(newText);
    await ctx.db.patch(prompt._id, { text: validatedText });

    debugTodLog(`[T/D] Edited prompt: id=${promptId}`);
    return { success: true };
  },
});

// Delete own prompt (and all associated answers, reactions, reports)
/**
 * P2-TOD-CASCADE: One bounded pass through every cascade section for
 * `deleteMyPrompt`.  Each section uses `.take(TOD_PROMPT_CASCADE_BATCH)`.
 *
 * Returns `{ complete: true }` only if every section returned strictly fewer
 * rows than the BATCH cap (i.e. fully drained).  Returns `{ complete: false }`
 * if any section filled its cap so the parent can schedule a continuation.
 *
 * The prompt row itself is NOT touched here — the parent mutation hard-deletes
 * it up front so the user sees immediate disappearance and downstream
 * `canShow*` visibility checks return false for orphaned children that this
 * helper has not yet purged.
 *
 * Section order is intentional: per-answer fan-out first (so we can free
 * storage and clean child indexes), then prompt-scoped children, finally
 * connect requests.  No cross-section dependencies inside a single pass.
 */
async function runDeletePromptCascadeBounded(
  ctx: any,
  promptId: string,
): Promise<{
  complete: boolean;
  deletedAnswers: number;
  deletedConnectRequests: number;
  deletedPrivateMedia: number;
}> {
  let complete = true;

  // --- Answers + per-answer fan-out (likes, reactions, reports, views) ---
  const answers = await ctx.db
    .query('todAnswers')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .take(TOD_PROMPT_CASCADE_BATCH);
  if (answers.length === TOD_PROMPT_CASCADE_BATCH) complete = false;

  for (const answer of answers) {
    const answerId = answer._id as unknown as string;

    await deleteStorageIfPresent(ctx, answer.mediaStorageId);

    // Per-answer child rows are themselves bounded by .take(BATCH); a single
    // answer with >BATCH child rows of one kind would leave residue picked up
    // on the next continuation pass (the answer row is only deleted once all
    // its child loops complete below).
    const legacyLikes = await ctx.db
      .query('todAnswerLikes')
      .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
      .take(TOD_PROMPT_CASCADE_BATCH);
    if (legacyLikes.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
    for (const like of legacyLikes) {
      await ctx.db.delete(like._id);
    }

    const reactions = await ctx.db
      .query('todAnswerReactions')
      .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
      .take(TOD_PROMPT_CASCADE_BATCH);
    if (reactions.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
    for (const reaction of reactions) {
      await ctx.db.delete(reaction._id);
    }

    const reports = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
      .take(TOD_PROMPT_CASCADE_BATCH);
    if (reports.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
    for (const report of reports) {
      await ctx.db.delete(report._id);
    }

    const views = await ctx.db
      .query('todAnswerViews')
      .withIndex('by_answer', (q: any) => q.eq('answerId', answerId))
      .take(TOD_PROMPT_CASCADE_BATCH);
    if (views.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
    for (const view of views) {
      await ctx.db.delete(view._id);
    }

    // Only delete the answer row once we have purged its child rows this
    // pass.  If a child loop hit the cap we still delete the answer row
    // because the by_answer indexes for the orphaned children remain valid;
    // the next continuation pass will pick them up via the same `by_answer`
    // index (the answerId string is stable even after the row is gone).
    await ctx.db.delete(answer._id);
  }

  // --- Prompt-scoped fan-out (reactions, reports, media-view ledger) ---
  const promptReactions = await ctx.db
    .query('todPromptReactions')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .take(TOD_PROMPT_CASCADE_BATCH);
  if (promptReactions.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
  for (const reaction of promptReactions) {
    await ctx.db.delete(reaction._id);
  }

  const promptReports = await ctx.db
    .query('todPromptReports')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .take(TOD_PROMPT_CASCADE_BATCH);
  if (promptReports.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
  for (const report of promptReports) {
    await ctx.db.delete(report._id);
  }

  const promptMediaViews = await ctx.db
    .query('todPromptMediaViews')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .take(TOD_PROMPT_CASCADE_BATCH);
  if (promptMediaViews.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
  for (const view of promptMediaViews) {
    await ctx.db.delete(view._id);
  }

  const privateMediaItems = await ctx.db
    .query('todPrivateMedia')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .take(TOD_PROMPT_CASCADE_BATCH);
  if (privateMediaItems.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
  for (const item of privateMediaItems) {
    await deleteStorageIfPresent(ctx, item.storageId);
    await ctx.db.delete(item._id);
  }

  // --- Connect requests for this prompt ---
  const connectRequests = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
    .take(TOD_PROMPT_CASCADE_BATCH);
  if (connectRequests.length === TOD_PROMPT_CASCADE_BATCH) complete = false;
  for (const req of connectRequests) {
    await ctx.db.delete(req._id);
  }

  return {
    complete,
    deletedAnswers: answers.length,
    deletedConnectRequests: connectRequests.length,
    deletedPrivateMedia: privateMediaItems.length,
  };
}

/**
 * P2-TOD-CASCADE: scheduled continuation for `deleteMyPrompt`.  Runs one
 * bounded cascade pass against an already-deleted prompt and re-schedules
 * itself if any section still has residue.  Idempotent — if the prompt has
 * no remaining children, the helper returns `{complete: true}` and the chain
 * stops naturally.
 */
export const _continueDeleteMyPromptCascade = internalMutation({
  args: { promptId: v.string() },
  handler: async (ctx, { promptId }) => {
    const result = await runDeletePromptCascadeBounded(ctx, promptId);
    if (!result.complete) {
      await ctx.scheduler.runAfter(
        0,
        internal.truthDare._continueDeleteMyPromptCascade,
        { promptId },
      );
    }
    return result;
  },
});

/**
 * Delete a prompt the caller owns.
 *
 * SECURITY CONTRACT:
 *   - Token-bound auth (caller resolved from session token, not args).
 *   - Ownership check: `prompt.ownerUserId === userId` (no admin override).
 *   - Rate limited (P1-TOD-RL `delete_prompt`) — deletion is expensive
 *     because it purges all child records and frees storage objects.
 *
 * Cascade strategy (P2-TOD-CASCADE):
 *   - The `todPrompts` row is hard-deleted FIRST so `canShowTodPromptForViewer`
 *     immediately returns false for any orphaned children (answers,
 *     reactions, reports, private media, connect requests).  The user sees
 *     the prompt disappear on the next reactive tick.
 *   - `runDeletePromptCascadeBounded` then drains child rows in
 *     TOD_PROMPT_CASCADE_BATCH chunks per section.  If any section fills
 *     its batch, the continuation internalMutation
 *     `_continueDeleteMyPromptCascade` is scheduled to drain the rest.
 *   - The cascade NEVER touches `todAnswerUploadAttempts` /
 *     `todPrivateMediaAttempts` — those counters are durable on purpose
 *     (see `incrementAnswerMediaUploadAttempt` security contract).
 */
export const deleteMyPrompt = mutation({
  args: {
    token: v.string(),
    promptId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap prompt deletes (anti-loop; deletion is expensive — purges
    // answers/reactions/reports + storage objects).
    await enforceTodActionLimit(ctx, userId, 'delete_prompt');

    // Get the prompt
    const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
    if (!prompt) {
      throw new Error('Prompt not found');
    }

    // Verify ownership
    if (prompt.ownerUserId !== userId) {
      throw new Error('Unauthorized: you can only delete your own prompts');
    }

    // P2-TOD-CASCADE: hard-delete the prompt row FIRST.  Once it is gone:
    //   - `canShowTodPromptForViewer` returns false everywhere (orphaned
    //     answers / reactions / reports / private media / connect requests
    //     all stop rendering immediately),
    //   - the user sees the prompt disappear on the next reactive tick,
    //   - the cascade work below — which may now be bounded across one or
    //     more continuations — is purely backend garbage collection.
    await ctx.db.delete(prompt._id);

    // Run one bounded cascade pass synchronously so small/typical prompts
    // (which fit well under TOD_PROMPT_CASCADE_BATCH per section) are fully
    // cleaned up in this single request.  For pathological cases with very
    // many answers/reactions/etc, schedule a continuation that re-runs the
    // bounded helper until every section drains.
    const result = await runDeletePromptCascadeBounded(ctx, promptId);
    if (!result.complete) {
      await ctx.scheduler.runAfter(
        0,
        internal.truthDare._continueDeleteMyPromptCascade,
        { promptId },
      );
    }

    debugTodLog(`[T/D] Deleted prompt: id=${promptId}, deletedAnswersThisPass=${result.deletedAnswers}, deletedConnectRequestsThisPass=${result.deletedConnectRequests}, deletedPrivateMediaThisPass=${result.deletedPrivateMedia}, complete=${result.complete}`);

    return { success: true };
  },
});

// Get pending connect requests for current user (as recipient)
// Returns enriched data with sender profile for UI display
export const getPendingConnectRequests = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, userId))) return [];

    const requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .order('desc')
      .take(TOD_CONNECT_REQUEST_SCAN_LIMIT);

    // Enrich with sender profile and prompt data
    const enriched = await Promise.all(
      requests.map(async (req) => {
        const senderAccess = await getTodAccessContextForStoredUserId(ctx, req.fromUserId);
        if (!senderAccess) {
          return null;
        }
        const sender = senderAccess.user;

        // Get prompt for context
        const prompt = await ctx.db
          .query('todPrompts')
          .filter((q) => q.eq(q.field('_id'), req.promptId as Id<'todPrompts'>))
          .first();
        if (!prompt) {
          return null;
        }
        if (!(await canShowTodPromptForViewer(ctx, prompt, userId))) {
          return null;
        }
        const answer = await ctx.db.get(req.answerId as Id<'todAnswers'>);
        if (answer && !(await canShowTodAnswerForViewer(ctx, answer, userId))) {
          return null;
        }
        if (await hasBlockBetween(ctx, sender._id as string, userId as string)) {
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
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, userId))) return 0;

    const requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .take(TOD_CONNECT_REQUEST_SCAN_LIMIT);

    let count = 0;
    for (const req of requests) {
      const senderAccess = await getTodAccessContextForStoredUserId(ctx, req.fromUserId);
      if (!senderAccess) {
        continue;
      }
      const prompt = await ctx.db.get(req.promptId as Id<'todPrompts'>);
      if (!prompt || !(await canShowTodPromptForViewer(ctx, prompt, userId))) {
        continue;
      }
      const answer = await ctx.db.get(req.answerId as Id<'todAnswers'>);
      if (answer && !(await canShowTodAnswerForViewer(ctx, answer, userId))) {
        continue;
      }
      if (await hasBlockBetween(ctx, senderAccess.user._id as string, userId as string)) {
        continue;
      }
      count += 1;
    }
    return count;
  },
});

// Rich inbox list for pending incoming Phase-2 Truth or Dare connect requests.
export const getPendingTodConnectRequestInbox = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, userId))) return [];

    const requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .order('desc')
      .take(TOD_CONNECT_REQUEST_SCAN_LIMIT);

    const enriched = await Promise.all(
      requests.map(async (req) => {
        const senderAccess = await getTodAccessContextForStoredUserId(ctx, req.fromUserId);
        if (!senderAccess) {
          return null;
        }
        const senderDbId = senderAccess.user._id;

        if (await hasBlockBetween(ctx, senderDbId as string, userId as string)) {
          return null;
        }

        const prompt = await ctx.db.get(req.promptId as Id<'todPrompts'>);
        if (!prompt) {
          return null;
        }
        if (!(await canShowTodPromptForViewer(ctx, prompt, userId))) {
          return null;
        }

        const senderIdentity = getPromptConnectIdentity(prompt, senderAccess.user);
        const answer = await ctx.db.get(req.answerId as Id<'todAnswers'>);
        if (answer && !(await canShowTodAnswerForViewer(ctx, answer, userId))) {
          return null;
        }
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

/**
 * Send a T&D connect request from a prompt owner to an answer author.
 *
 * SECURITY / PRIVACY CONTRACT:
 *   - Token-bound auth (sender = caller).
 *   - Only the prompt owner can connect on an answer to their own prompt.
 *   - ANONYMOUS RULE: anonymous answers ARE connectable; the answer
 *     author's identity is never revealed to the sender at this stage and
 *     is only resolved on the recipient's accept (see `respondToConnect`).
 *   - Pre-accept notification body is identity-free and the data payload
 *     does NOT include the sender's user id (P2-TOD-PRIV).  Identity
 *     rendering goes through `getPendingTodConnectRequestInbox`, which
 *     honors `getPromptConnectIdentity` masking server-side.
 *   - Rate limits: legacy minute bucket + P1 hour/day backstop
 *     (`connect_backstop`) + per-(sender, recipient) anti-harassment cap
 *     (`enforceTodPerTargetConnectLimit`).  Recipient id is folded into
 *     the per-target counter's action string but never persisted in a
 *     way that exposes the relationship outside the counter row.
 *   - Idempotent: duplicate request from same (prompt, sender, recipient)
 *     returns the existing requestId with a stable `action` label rather
 *     than creating a second pending row.
 */
export const sendTodConnectRequest = mutation({
  args: {
    token: v.string(),
    promptId: v.string(),
    answerId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, answerId, authUserId }) => {
    const fromUserId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, fromUserId))) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }

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
    if (!(await canShowTodPromptForViewer(ctx, prompt, fromUserId))) {
      return { success: false, reason: 'Prompt unavailable for connect' };
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
    if (!(await canShowTodAnswerForViewer(ctx, answer, fromUserId))) {
      return { success: false, reason: 'Connect unavailable for this answer' };
    }

    // Anonymous answers ARE connectable: identity is revealed only on accept.
    const toUserId = answer.userId;
    if (!(await getTodAccessContextForStoredUserId(ctx, toUserId))) {
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
      debugTodLog('[TOD_CONNECT_SEND] Duplicate prompt request:', {
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
      debugTodLog('[TOD_CONNECT_SEND] Reverse request exists:', {
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
    // P1-TOD-RL: hour+day backstop on connect throughput (anti-bot-loop).
    await enforceTodActionLimit(ctx, fromUserId, 'connect_backstop');
    // P1-TOD-RL: per-(sender, recipient) cap to prevent targeted harassment
    // (one user spamming connect requests to a single victim across multiple
    // prompts/answers). Counter is keyed by the SENDER's userId; recipient id
    // is folded into the action string and not exposed elsewhere.
    await enforceTodPerTargetConnectLimit(ctx, fromUserId, toUserId as string);

    const latestExisting = await findTodConnectRequestForPromptPair(
      ctx,
      promptId,
      fromUserId as string,
      toUserId as string,
    );
    if (latestExisting) {
      return {
        success: true,
        action: getTodConnectDuplicateAction(latestExisting.status),
        requestId: latestExisting._id as string,
      };
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

    debugTodLog('[TOD_CONNECT_SEND] Created request:', {
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
      // P2-TOD-PRIV: do NOT include `data.otherUserId` (sender id) in the
      // pre-accept notification.  T&D prompt authors may have posted
      // anonymously, and even when not, the prompt owner's Convex user id
      // is a stable cross-feature identifier that the recipient could use
      // to look up profile data via other queries before consenting.
      // The recipient's UI navigates via `threadId` (= requestId) and
      // resolves identity through `getPendingTodConnectRequestInbox`,
      // which enforces ACL-aware identity rendering server-side (anonymous
      // prompts render as Anonymous with no photo/age/gender leak).
      // Identity reveal happens in `respondToConnect` after accept, where
      // the response payload returns sender profile fields.
      await ctx.db.insert('privateNotifications', {
        userId: toUserId as Id<'users'>,
        type: 'phase2_deep_connect',
        title: 'New Truth or Dare connect',
        body: 'Someone wants to connect on your answer.',
        data: {
          // otherUserId intentionally omitted (P2-TOD-PRIV).
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

/**
 * Respond to a T&D connect request (Connect or Remove).
 * On Connect creates a Phase-2 privateConversation for both users so they
 * can start chatting; on Remove permanently dismisses the request.
 *
 * SECURITY / PRIVACY CONTRACT:
 *   - Token-bound auth (recipient = caller).
 *   - Ownership check (`request.toUserId === recipientDbId`) runs BEFORE
 *     any idempotency early-return so a non-recipient cannot probe
 *     request status via 'already_connected'/'already_removed' responses.
 *   - Identity reveal happens HERE on accept: the response payload returns
 *     sender profile fields so the recipient learns who connected with
 *     them (even if the original answer was posted anonymously).  Prior
 *     to this point the recipient only had the request via the inbox
 *     query, which masks identity per `getPromptConnectIdentity`.
 *   - Idempotency (P2-TOD-IDEM): repeated calls in the desired terminal
 *     state return `{success: true, action: 'already_*'}` with no DB
 *     writes, no notifications, and NO rate-limit consumption (the
 *     `enforceTodActionLimit` call runs AFTER the idempotency branches).
 *   - Rate limit (`respond_to_connect`) only charges when actual work
 *     happens; double-taps from flaky networks are free.
 */
export const respondToConnect = mutation({
  args: {
    token: v.string(),
    requestId: v.id('todConnectRequests'),
    action: v.union(v.literal('connect'), v.literal('remove')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, requestId, action, authUserId }) => {
    const recipientDbId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');

    const request = await ctx.db.get(requestId);
    if (!request) {
      return { success: false, reason: 'Request not found' };
    }

    // Authorization check BEFORE returning idempotent status so the
    // "already_connected"/"already_removed" probe cannot be used by a
    // non-recipient to enumerate request states.
    if (request.toUserId !== recipientDbId) {
      throw new Error('Unauthorized: only the request recipient can respond');
    }

    // P2-TOD-IDEM: idempotent double-tap protection.  If the request is
    // already in the desired terminal state, return a stable success-shape
    // response with no side effects (no DB writes, no notifications, no
    // rate-limit consumption).  This protects against:
    //   - retry storms from flaky networks (mobile reconnects),
    //   - rapid double-tap on the accept/reject button,
    //   - duplicate Phase-2 match creation (the underlying
    //     `ensurePhase2MatchAndConversation` already deduplicates, but
    //     skipping it entirely avoids redundant work and notification
    //     dedupe-key churn).
    if (request.status === 'connected') {
      if (action === 'connect') {
        return { success: true, action: 'already_connected' as const };
      }
      return { success: false, reason: 'Request already connected; cannot remove' };
    }
    if (request.status === 'removed') {
      if (action === 'remove') {
        return { success: true, action: 'already_removed' as const };
      }
      return { success: false, reason: 'Request already removed' };
    }
    if (request.status !== 'pending') {
      return { success: false, reason: 'Request not found or already processed' };
    }

    // P1/P2-TOD-RL: cap connect-response throughput (anti-bot-loop on the
    // accept/reject button).  Charge ONLY when we're actually going to do
    // work — moved below the idempotency early-returns so retries/double
    // taps on already-processed requests don't burn quota slots.
    await enforceTodActionLimit(ctx, recipientDbId, 'respond_to_connect');

    if (action === 'connect') {
      const recipientAccess = await getTodAccessContext(ctx, recipientDbId);
      if (!recipientAccess) {
        return { success: false, reason: 'Connect unavailable for this user' };
      }

      const prompt = await ctx.db.get(request.promptId as Id<'todPrompts'>);
      if (!prompt || isSystemTodOwnerId(prompt.ownerUserId)) {
        return { success: false, reason: 'Prompt unavailable for connect' };
      }
      if (!(await canShowTodPromptForViewer(ctx, prompt, recipientDbId))) {
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
        debugTodLog('[TOD_CONNECT_RESPOND] Sender not found:', {
          requestId,
          fromUserId: request.fromUserId,
        });
        return { success: false, reason: 'Sender user not found' };
      }
      const senderAccess = await getTodAccessContext(ctx, senderDbId);
      if (!senderAccess) {
        return { success: false, reason: 'Connect unavailable for this user' };
      }

      if (await hasBlockBetween(ctx, senderDbId as string, recipientDbId as string)) {
        debugTodLog('[TOD_CONNECT_RESPOND] Blocked between users:', {
          sender: (senderDbId as string).slice(-8),
          recipient: (recipientDbId as string).slice(-8),
        });
        return { success: false, reason: 'Connect unavailable for this user' };
      }
      if (answer && !(await canShowTodAnswerForViewer(ctx, answer, recipientDbId))) {
        return { success: false, reason: 'Connect request is no longer valid' };
      }

      // Get sender + recipient profiles for response
      const senderIdentity = getPromptConnectIdentity(prompt, senderAccess.user);
      const recipientIdentity = answer
        ? getAnswerConnectIdentity(answer, recipientAccess.user)
        : getDefaultConnectIdentity(recipientAccess.user);
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

      // Phase-2 chat should open cleanly after a T/D connection. Do not
      // persist a visible system intro row; the connected request/match
      // records above are the internal source of truth.

      debugTodLog('[TOD_CONNECT_RESPOND] Accepted:', {
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
      debugTodLog('[TOD_CONNECT_RESPOND] Removed:', {
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
    token: v.string(),
    promptId: v.string(),
    answerId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, answerId, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, userId))) return { status: 'none' as const };

    const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
    if (!prompt || !(await canShowTodPromptForViewer(ctx, prompt, userId))) {
      return { status: 'none' as const };
    }

    // Get the answer to find the other user
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (!answer) return { status: 'none' as const };
    if (!(await canShowTodAnswerForViewer(ctx, answer, userId))) {
      return { status: 'none' as const };
    }

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

// Cleanup very old prompt history after a long retention window.
// TOD-010 FIX: Converted to internal mutation - only callable by cron/scheduler
export const cleanupExpiredPrompts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cleanupCutoff = now - TOD_HISTORY_RETENTION_MS;
    const BATCH = 200;
    const expiredPrompts = await ctx.db
      .query('todPrompts')
      .withIndex('by_expires', (q) => q.lte('expiresAt', cleanupCutoff))
      .take(BATCH);
    let deleted = 0;

    for (const prompt of expiredPrompts) {
      const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires > cleanupCutoff) continue;

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

    return { deleted, retentionMs: TOD_HISTORY_RETENTION_MS };
  },
});

// Generate upload URL for media
export const generateUploadUrl = mutation({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, userId))) {
      throw new Error('Phase-2 setup is required to upload Truth or Dare media');
    }
    const rateCheck = await checkRateLimit(ctx, userId, 'media_upload');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }
    // P1-TOD-RL: hour+day backstop on upload-URL generation (anti-bot-loop;
    // every URL backs a storage object, so unbounded URL creation = storage abuse).
    await enforceTodActionLimit(ctx, userId, 'media_upload_backstop');
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
    token: v.string(),
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
    const fromUserId = await requireAuthenticatedTodUserId(
      ctx,
      args.token,
      { authUserId: args.authUserId, userId: args.fromUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, fromUserId))) {
      throw new Error('Phase-2 setup is required to submit private media');
    }
    // P1-TOD-RL: cap V1 private-media submissions (anti-bot-loop). Works in
    // tandem with the P0 `todPrivateMediaAttempts` 2-attempt cap which is
    // per-(prompt, sender) — this adds a per-user velocity ceiling that is
    // independent of the prompt to prevent broad-sweep abuse.
    await enforceTodActionLimit(ctx, fromUserId, 'submit_private_media');

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      throw new Error('Prompt not found');
    }
    if (isSystemTodOwnerId(prompt.ownerUserId)) {
      throw new Error('Private media is unavailable for this prompt');
    }
    if (!(await canShowTodPromptForViewer(ctx, prompt, fromUserId))) {
      throw new Error('Prompt unavailable');
    }

    // TOD-MEDIA-3 FIX: enforce durable 2-upload-attempt cap for the V1
    // private-media path. Counter lives in `todPrivateMediaAttempts` keyed
    // by (promptId, fromUserId) and is never reset by pending-row deletion,
    // so refresh / retry / reinstall / multi-device cannot bypass.
    await assertPrivateMediaCapNotExceeded(ctx, args.promptId, fromUserId);

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

    // If existing, delete old storage and remove record (replace policy).
    // NOTE: this DOES delete the pending row, but the durable
    // `todPrivateMediaAttempts` counter is untouched — see TOD-MEDIA-3 fix.
    if (existing) {
      if (existing.storageId) {
        await ctx.storage.delete(existing.storageId);
      }
      await ctx.db.delete(existing._id);
    }

    // Create new private media record with 24h expiry
    const now = Date.now();
    const responderSnapshot = await buildTodAuthorSnapshot(ctx, fromUserId);
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
      responderName: responderSnapshot.name,
      responderAge: responderSnapshot.age,
      responderGender: responderSnapshot.gender,
      responderPhotoUrl: responderSnapshot.photoUrl,
    });

    // TOD-MEDIA-3 FIX: monotonically increment durable upload-attempt counter.
    await incrementPrivateMediaUploadAttempt(ctx, args.promptId, fromUserId);

    return { id, success: true };
  },
});

/**
 * Get private media items for a prompt (owner only).
 * Returns metadata only, NOT the media URL.
 */
export const getPrivateMediaForOwner = query({
  args: {
    token: v.string(),
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, viewerUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { authUserId, viewerUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, currentUserId))) return [];

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
    if (!(await canShowTodPromptForViewer(ctx, prompt, currentUserId))) {
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
 * Begin viewing legacy V1 private media (owner only).
 * Returns a short-lived URL and atomically transitions the row to
 * 'viewing' so the one-time view is reserved BEFORE the URL is handed out
 * (TOD-MEDIA-4).
 *
 * SECURITY CONTRACT:
 *   - Token-bound auth (viewer = caller).
 *   - Recipient-only: `item.toUserId === currentUserId` is required;
 *     the sender cannot self-view through this endpoint and therefore
 *     cannot burn the receiver's one-time view.
 *   - Block check on (sender, recipient) — blocked senders cannot trigger
 *     a view URL even if the row exists.
 *   - State machine (pending → viewing → finalized/deleted) is enforced
 *     atomically in a single serializable Convex mutation; two parallel
 *     `begin` calls cannot both transition pending → viewing.  See the
 *     in-handler comment for the full state diagram.
 *   - Durable consumption (storage deletion + status='deleted') happens
 *     in `finalizePrivateMediaView` after the display timer ends.
 */
export const beginPrivateMediaView = mutation({
  args: {
    token: v.string(),
    privateMediaId: v.id('todPrivateMedia'),
    viewerUserId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, privateMediaId, viewerUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { authUserId, viewerUserId },
      'UNAUTHORIZED',
    );
    // P1-TOD-RL: cap one-time view claims (anti-bot-loop on view-burn endpoint).
    // The P0 atomic state transitions inside this handler are the
    // correctness backstop; this adds a per-user velocity ceiling.
    await enforceTodActionLimit(ctx, currentUserId, 'begin_private_media_view');
    if (!(await getTodAccessContext(ctx, currentUserId))) {
      throw new Error('Phase-2 setup is required to view this media');
    }
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
    if (!(await getTodAccessContextForStoredUserId(ctx, item.fromUserId))) {
      throw new Error('Access denied');
    }

    // TOD-MEDIA-4 FIX: atomically consume the one-time view BEFORE returning
    // the URL.
    //
    // Status transitions (single Convex mutation, serializable):
    //   pending  → viewing  (set viewedAt = now, expiresAt = now + duration)
    //                       and return URL.
    //   viewing  AND now < expiresAt  → idempotent retry within the active
    //                       view window: return the SAME URL (same item,
    //                       same expiresAt). Convex storage URLs are
    //                       short-lived and bound to the storage id, so this
    //                       is safe — no extra view is granted.
    //   viewing  AND now >= expiresAt → the timer has expired without a
    //                       finalize call. Reject; the cleanup or finalize
    //                       path must transition the record before any
    //                       further view is allowed.
    //   any other status (expired / deleted) → reject.
    //
    // Two parallel `beginPrivateMediaView` calls cannot both succeed:
    // the loser's read of (status='pending') conflicts with the winner's
    // patch and is retried; on retry it observes status='viewing' and
    // either returns the same URL (within window) or rejects.
    if (!item.storageId) {
      throw new Error('Media file not found');
    }

    const now = Date.now();

    if (item.status === 'pending') {
      const expiresAt = now + item.durationSec * 1000;
      const url = await ctx.storage.getUrl(item.storageId);
      if (!url) {
        throw new Error('Failed to generate media URL');
      }
      await ctx.db.patch(item._id, {
        status: 'viewing',
        viewedAt: now,
        expiresAt,
      });
      return {
        url,
        mediaType: item.mediaType,
        viewMode: item.viewMode, // 'tap' or 'hold' - frontend enforces this
        durationSec: item.durationSec,
        expiresAt,
      };
    }

    if (item.status === 'viewing') {
      const existingExpiresAt = item.expiresAt ?? 0;
      if (now < existingExpiresAt) {
        // Idempotent retry within the active view window.
        const url = await ctx.storage.getUrl(item.storageId);
        if (!url) {
          throw new Error('Failed to generate media URL');
        }
        return {
          url,
          mediaType: item.mediaType,
          viewMode: item.viewMode,
          durationSec: item.durationSec,
          expiresAt: existingExpiresAt,
        };
      }
      throw new Error('Media already viewed or expired');
    }

    throw new Error('Media already viewed or expired');
  },
});

/**
 * Finalize a legacy V1 private-media view (called when the display timer
 * ends or the user closes the viewer).  Deletes the underlying storage
 * object and durably marks the row as 'deleted' so the one-time view can
 * never be replayed.
 *
 * SECURITY CONTRACT:
 *   - Token-bound auth (viewer = caller).
 *   - Recipient-only: `item.toUserId === currentUserId`.
 *   - Block check on (sender, recipient).
 *   - Idempotent over missing rows (returns `success: false` instead of
 *     throwing) so a delayed second finalize from the viewer does not
 *     surface a user-visible error.
 *   - Storage delete is fail-soft via `deleteStorageIfPresent`; the row
 *     transition still happens so a partially-failed storage delete
 *     cannot leave the view unconsumed.
 */
export const finalizePrivateMediaView = mutation({
  args: {
    token: v.string(),
    privateMediaId: v.id('todPrivateMedia'),
    viewerUserId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, privateMediaId, viewerUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { authUserId, viewerUserId },
      'UNAUTHORIZED',
    );
    // P1-TOD-RL: cap finalize calls (anti-bot-loop on storage-delete trigger).
    await enforceTodActionLimit(ctx, currentUserId, 'finalize_private_media_view');
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
    token: v.string(),
    privateMediaId: v.id('todPrivateMedia'),
    fromUserId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, privateMediaId, fromUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { authUserId, userId: fromUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, currentUserId))) {
      throw new Error('Phase-2 setup is required to connect');
    }
    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // Only prompt owner can send connect
    if (item.toUserId !== currentUserId) {
      throw new Error('Access denied');
    }
    if (!(await getTodAccessContextForStoredUserId(ctx, item.fromUserId))) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }
    if (await hasBlockBetween(ctx, currentUserId as string, item.fromUserId)) {
      return { success: false, reason: 'Connect unavailable for this user' };
    }

    // Can only connect if not already connected/pending
    if (item.connectStatus !== 'none') {
      return { success: false, reason: 'Already processed' };
    }
    const existing = await findTodConnectRequestForPromptPair(
      ctx,
      item.promptId,
      currentUserId as string,
      item.fromUserId,
    );
    if (existing) {
      return {
        success: true,
        action: getTodConnectDuplicateAction(existing.status),
        requestId: existing._id as string,
      };
    }

    const rateCheck = await checkRateLimit(ctx, currentUserId, 'connect');
    if (!rateCheck.allowed) {
      throw new Error(RATE_LIMIT_ERROR);
    }
    // P1-TOD-RL: hour+day backstop on V1 private-media connect throughput.
    await enforceTodActionLimit(ctx, currentUserId, 'connect_backstop');
    // P1-TOD-RL: per-(sender, recipient) cap (anti-harassment) on V1 path.
    await enforceTodPerTargetConnectLimit(ctx, currentUserId, item.fromUserId);

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
    token: v.string(),
    privateMediaId: v.id('todPrivateMedia'),
    fromUserId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, privateMediaId, fromUserId, authUserId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { authUserId, userId: fromUserId },
      'UNAUTHORIZED',
    );
    // P1-TOD-RL: cap reject throughput (anti-bot-loop; cheap mutation but
    // unbounded calls churn `connectStatus` patches).
    await enforceTodActionLimit(ctx, currentUserId, 'reject_private_media_connect');
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

    // P2-TOD-CLEANUP: Bounded scan.  The previous `.collect()` could
    // load every historical row in 'viewing' / 'pending' status; the cron
    // is idempotent and re-runs, so per-invocation BATCH cap is safe and
    // bounds Convex transaction cost.
    const expiredViewing = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_status', (q) => q.eq('status', 'viewing'))
      .take(TOD_PRIVATE_MEDIA_CLEANUP_BATCH);

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
    // P2-TOD-CLEANUP: same bounded-scan rationale as above.
    const oldPending = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .take(TOD_PRIVATE_MEDIA_CLEANUP_BATCH);

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
 * Cascade deletes only very old Truth/Dare data:
 * 1) Find todPrompts where expiresAt is beyond the retention window
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
    const cleanupCutoff = now - TOD_HISTORY_RETENTION_MS;
    const BATCH = 200;
    const expiredPrompts = await ctx.db
      .query('todPrompts')
      .withIndex('by_expires', (q) => q.lte('expiresAt', cleanupCutoff))
      .take(BATCH);

    let deletedPrompts = 0;
    let deletedAnswers = 0;
    let deletedLikes = 0;
    let deletedConnects = 0;
    let deletedPrivateMedia = 0;

    for (const prompt of expiredPrompts) {
      const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires > cleanupCutoff) continue;

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

    // Also cleanup orphaned private media only after the same long retention window.
    const allPrivateMedia = await ctx.db
      .query('todPrivateMedia')
      .collect();

    for (const pm of allPrivateMedia) {
      const pmExpires = pm.expiresAt ?? pm.createdAt + TWENTY_FOUR_HOURS_MS;
      if (pmExpires <= cleanupCutoff) {
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
      retentionMs: TOD_HISTORY_RETENTION_MS,
    };
  },
});

// ============================================================
// GLOBAL FEED & THREAD QUERIES
// ============================================================

/**
 * Owner-only prompt history for "My Truth or Dare".
 *
 * Returns prompt metadata and aggregate counts only. It intentionally does not
 * return answer text, answer author identity, media URLs, report details, or
 * private moderation internals.
 */
export const getMyPrompts = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const ownerUserId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, ownerUserId))) return [];
    const now = Date.now();
    const [blockedUserIds, reportedAnswerIds] = await Promise.all([
      getBlockedUserIdsForViewer(ctx, ownerUserId),
      getTodAnswerIdsReportedByViewer(ctx, ownerUserId),
    ]);

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
        const visibleAnswers: typeof answers = [];
        for (const answer of answers) {
          if (
            await canShowTodAnswerForViewer(
              ctx,
              answer,
              ownerUserId,
              blockedUserIds,
              reportedAnswerIds,
            )
          ) {
            visibleAnswers.push(answer);
          }
        }

        const expiresAt = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
        const moderationStatus =
          prompt.moderationStatus ??
          moderationStatusForTodReportCount(prompt.uniqueReportCount ?? prompt.reportCount ?? 0);
        const mediaCounts = getTodAnswerMediaCounts(visibleAnswers);

        return {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          createdAt: prompt.createdAt,
          expiresAt,
          isExpired: expiresAt <= now,
          answerCount: visibleAnswers.length,
          visibleAnswerCount: visibleAnswers.length,
          photoCount: mediaCounts.photoCount,
          videoCount: mediaCounts.videoCount,
          totalMediaCount: mediaCounts.totalMediaCount,
          totalReactionCount: prompt.totalReactionCount ?? 0,
          moderationStatus,
          hiddenByReportsAt: prompt.hiddenByReportsAt,
          moderationStatusAt: prompt.moderationStatusAt,
          editedAt: (prompt as any).editedAt,
          hasMedia: mediaCounts.totalMediaCount > 0,
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
    token: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, viewerUserId }) => {
    const now = Date.now();
    const viewerDbId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { viewerUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, viewerDbId))) return [];

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

    // Filter to active, visible Phase-2 authors and non-blocked/non-reported rows.
    const activePrompts: typeof allPrompts = [];
    for (const prompt of allPrompts) {
      if (
        await canShowTodPromptForViewer(
          ctx,
          prompt,
          viewerDbId,
          blockedUserIds,
          reportedPromptIds,
        )
      ) {
        activePrompts.push(prompt);
      }
    }

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
        const visibleAnswers: typeof answers = [];
        for (const answer of answers) {
          if (
            await canShowTodAnswerForViewer(
              ctx,
              answer,
              viewerDbId,
              blockedUserIds,
              reportedAnswerIds,
            )
          ) {
            visibleAnswers.push(answer);
          }
        }

        visibleAnswers.sort(sortTodAnswersByDisplayRank);

        // Take up to 2 ranked preview answers
        const top2 = visibleAnswers.slice(0, 2);

        // Get reaction counts for each answer
        const top2WithReactions = await Promise.all(
          top2.map(async (answer) => {
            const answerId = answer._id as unknown as string;
            const normalizedIdentity = getNormalizedTodAnswerIdentity(answer);
            const authorSnapshot = normalizedIdentity.isAnonymous
              ? undefined
              : await buildTodSnapshotForStoredUserId(ctx, answer.userId);
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
              authorName: normalizedIdentity.isAnonymous ? undefined : authorSnapshot?.name,
              authorPhotoUrl: normalizedIdentity.isAnonymous ? undefined : authorSnapshot?.photoUrl,
              authorAge: normalizedIdentity.isAnonymous ? undefined : authorSnapshot?.age,
              authorGender: normalizedIdentity.isAnonymous ? undefined : authorSnapshot?.gender,
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

        const promptMediaMeta = await getPromptMediaViewMeta(ctx, prompt, viewerDbId);
        // Phase 4 safety: prompt-owner photo/video is one-time-view per
        // non-owner. Always redact the inline mediaUrl for non-owner
        // photo/video so the only path to playback is `openPromptMedia`.
        // Voice and owner keep direct URL (voice is replayable; owner is
        // unlimited).
        const isPhotoOrVideo = prompt.mediaKind === 'photo' || prompt.mediaKind === 'video';
        const sanitizedMediaUrl =
          isPhotoOrVideo && !promptMediaMeta.isPromptMediaOwner ? undefined : prompt.mediaUrl;
        const ownerSnapshot = prompt.isAnonymous
          ? undefined
          : await buildTodSnapshotForStoredUserId(ctx, prompt.ownerUserId);
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
          ownerName: prompt.isAnonymous ? undefined : ownerSnapshot?.name,
          ownerPhotoUrl: prompt.isAnonymous ? undefined : ownerSnapshot?.photoUrl,
          ownerAge: ownerSnapshot?.age,
          ownerGender: ownerSnapshot?.gender,
          ownerUserId: prompt.ownerUserId, // FIX: Include for owner detection in feed
          // Engagement metrics
          totalReactionCount: prompt.totalReactionCount ?? 0,
          // Owner-attached prompt media (Phase-2). Media follows prompt
          // visibility; `mediaStorageId` is intentionally omitted client-side
          // (already resolved into `mediaUrl` server-side).
          mediaKind: prompt.mediaKind,
          mediaUrl: sanitizedMediaUrl,
          mediaMime: prompt.mediaMime,
          durationSec: prompt.durationSec,
          isFrontCamera: prompt.isFrontCamera ?? false,
          hasMedia: !!prompt.mediaStorageId,
          // Phase 4: prompt-owner media one-time-view metadata.
          promptMediaViewCount: promptMediaMeta.promptMediaViewCount,
          viewerHasViewedPromptMedia: promptMediaMeta.viewerHasViewedPromptMedia,
          isPromptMediaOwner: promptMediaMeta.isPromptMediaOwner,
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
    token: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, viewerUserId }) => {
    const now = Date.now();
    const viewerDbId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { viewerUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, viewerDbId))) {
      return {
        trendingDarePrompt: null,
        trendingTruthPrompt: null,
      };
    }
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

    const activePrompts: typeof allPrompts = [];
    for (const prompt of allPrompts) {
      if (isTodSuppressedFromHighVisibility(prompt)) continue;
      if (
        await canShowTodPromptForViewer(
          ctx,
          prompt,
          viewerDbId,
          blockedUserIds,
          reportedPromptIds,
        )
      ) {
        activePrompts.push(prompt);
      }
    }

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
    const formatPrompt = async (prompt: typeof activePrompts[0] | null) => {
      if (!prompt) return null;
      const promptId = prompt._id as unknown as string;
      const promptMediaMeta = await getPromptMediaViewMeta(ctx, prompt, viewerDbId);
      // Phase 4: redact inline mediaUrl for non-owner photo/video so playback
      // is forced through the `openPromptMedia` mutation.
      const isPhotoOrVideo = prompt.mediaKind === 'photo' || prompt.mediaKind === 'video';
      const sanitizedMediaUrl =
        isPhotoOrVideo && !promptMediaMeta.isPromptMediaOwner ? undefined : prompt.mediaUrl;
      const ownerSnapshot = prompt.isAnonymous
        ? undefined
        : await buildTodSnapshotForStoredUserId(ctx, prompt.ownerUserId);
      // Viewer-state: did the viewer already answer this prompt? Mirrors the
      // logic in `listActivePromptsWithTop2Answers`. Backend-derived so the
      // "Answered" indicator persists across sessions/devices/reinstalls.
      // Uses the `by_prompt_user` index for an O(1) point lookup.
      let hasAnswered = false;
      if (viewerDbId) {
        const myAnswer = await ctx.db
          .query('todAnswers')
          .withIndex('by_prompt_user', (q) =>
            q.eq('promptId', promptId).eq('userId', viewerDbId as unknown as string)
          )
          .first();
        if (myAnswer) hasAnswered = true;
      }
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
        ownerName: prompt.isAnonymous ? undefined : ownerSnapshot?.name,
        ownerPhotoUrl: prompt.isAnonymous ? undefined : ownerSnapshot?.photoUrl,
        ownerAge: ownerSnapshot?.age,
        ownerGender: ownerSnapshot?.gender,
        ownerUserId: prompt.ownerUserId, // FIX: Include for owner detection
        // Engagement metrics
        totalReactionCount: prompt.totalReactionCount ?? 0,
        // Owner-attached prompt media (Phase-2). Media follows prompt
        // visibility; `mediaStorageId` is intentionally omitted client-side
        // (already resolved into `mediaUrl` server-side).
        mediaKind: prompt.mediaKind,
        mediaUrl: sanitizedMediaUrl,
        mediaMime: prompt.mediaMime,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        hasMedia: !!prompt.mediaStorageId,
        // Phase 4: prompt-owner media one-time-view metadata.
        promptMediaViewCount: promptMediaMeta.promptMediaViewCount,
        viewerHasViewedPromptMedia: promptMediaMeta.viewerHasViewedPromptMedia,
        isPromptMediaOwner: promptMediaMeta.isPromptMediaOwner,
        // Viewer state for "Answered" indicator on Trending cards.
        hasAnswered,
      };
    };

    const [trendingDarePrompt, trendingTruthPrompt] = await Promise.all([
      formatPrompt(topDare),
      formatPrompt(topTruth),
    ]);
    return {
      trendingDarePrompt,
      trendingTruthPrompt,
    };
  },
});

/**
 * Get full thread for a prompt - all answers with reactions.
 * Respects hidden-by-reports: hidden answers only visible to their author.
 */
export const getPromptThread = query({
  args: {
    token: v.string(),
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, viewerUserId }) => {
    const viewerDbId = await requireAuthenticatedTodUserId(
      ctx,
      token,
      { viewerUserId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, viewerDbId))) return null;
    const blockedUserIds = await getBlockedUserIdsForViewer(ctx, viewerDbId);

    // Get prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return null;
    if (!(await canShowTodPromptForViewer(ctx, prompt, viewerDbId, blockedUserIds))) return null;

    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    const isExpired = expires <= now;

    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .order('desc')
      .take(TOD_PROMPT_THREAD_ANSWER_SCAN_LIMIT);
    const reportedAnswerIds = await getTodAnswerIdsReportedByViewer(ctx, viewerDbId);

    const visibleAnswers: typeof answers = [];
    for (const answer of answers) {
      if (
        await canShowTodAnswerForViewer(
          ctx,
          answer,
          viewerDbId,
          blockedUserIds,
          reportedAnswerIds,
        )
      ) {
        visibleAnswers.push(answer);
      }
    }

    visibleAnswers.sort(sortTodAnswersByDisplayRank);
    const visibleMediaCounts = getTodAnswerMediaCounts(visibleAnswers);

    // Get prompt-level reactions
    const promptReactions = await ctx.db
      .query('todPromptReactions')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .take(TOD_REACTION_SCAN_LIMIT);

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
      const myR =
        promptReactions.find((r) => r.userId === viewerDbId) ??
        (await ctx.db
          .query('todPromptReactions')
          .withIndex('by_prompt_user', (q) =>
            q.eq('promptId', promptId).eq('userId', viewerDbId as string)
          )
          .first());
      if (myR) promptMyReaction = myR.emoji;
    }

    // Enrich with reactions
    const enrichedAnswers = await Promise.all(
      visibleAnswers.map(async (answer) => {
        const answerId = answer._id as unknown as string;
        const normalizedIdentity = getNormalizedTodAnswerIdentity(answer);
        const answerSnapshot = normalizedIdentity.isAnonymous
          ? undefined
          : await buildTodSnapshotForStoredUserId(ctx, answer.userId);
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
            .take(TOD_MEDIA_VIEW_COUNT_SCAN_LIMIT);
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

        const answerHasMediaAttachment =
          hasTodAnswerMedia(answer) && (Boolean(answer.mediaStorageId) || Boolean(answer.mediaUrl));
        const isExpiredMediaHidden = isExpired && hasTodAnswerMedia(answer);

        return {
          _id: answer._id,
          promptId: answer.promptId,
          userId: answer.userId,
          type: answer.type,
          text: answer.text,
          mediaUrl: isExpiredMediaHidden
            ? undefined
            : getInlineAnswerMediaUrlForViewer(
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
          hasMedia: isExpiredMediaHidden ? true : answerHasMediaAttachment,
          mediaHidden: isExpiredMediaHidden,
          // Standard T/D answer media is replayable; the composer no longer
          // locks photo/video after a view. Always `false` for normal answers.
          isVisualMediaConsumed: false,
          viewCount,
          authorName: normalizedIdentity.isAnonymous ? undefined : answerSnapshot?.name,
          authorPhotoUrl: normalizedIdentity.isAnonymous ? undefined : answerSnapshot?.photoUrl,
          authorAge: normalizedIdentity.isAnonymous ? undefined : answerSnapshot?.age,
          authorGender: normalizedIdentity.isAnonymous ? undefined : answerSnapshot?.gender,
          photoBlurMode: normalizedIdentity.photoBlurMode,
          identityMode: normalizedIdentity.identityMode,
          isAnonymous: normalizedIdentity.isAnonymous,
          isFrontCamera: answer.isFrontCamera ?? false,
        };
      })
    );

    const promptMediaMeta = await getPromptMediaViewMeta(ctx, prompt, viewerDbId);
    const isPhotoOrVideo = prompt.mediaKind === 'photo' || prompt.mediaKind === 'video';
    const sanitizedMediaUrl =
      isExpired || (isPhotoOrVideo && !promptMediaMeta.isPromptMediaOwner)
        ? undefined
        : prompt.mediaUrl;
    const ownerSnapshot = prompt.isAnonymous
      ? undefined
      : await buildTodSnapshotForStoredUserId(ctx, prompt.ownerUserId);

    return {
      prompt: {
        _id: prompt._id,
        type: prompt.type,
        text: prompt.text,
        isTrending: prompt.isTrending,
        answerCount: prompt.answerCount,
        visibleAnswerCount: enrichedAnswers.length, // FIX: Count of visible answers for UI
        photoCount: visibleMediaCounts.photoCount,
        videoCount: visibleMediaCounts.videoCount,
        totalMediaCount: visibleMediaCounts.totalMediaCount,
        createdAt: prompt.createdAt,
        expiresAt: expires,
        isPromptOwner: !isSystemTodOwnerId(prompt.ownerUserId) && viewerDbId === prompt.ownerUserId,
        // Prompt-level reactions
        reactionCounts: promptReactionCounts,
        myReaction: promptMyReaction,
        // Owner profile snapshot
        isAnonymous: prompt.isAnonymous,
        photoBlurMode: prompt.photoBlurMode, // FIX: Include blur mode for renderer
        ownerName: prompt.isAnonymous ? undefined : ownerSnapshot?.name,
        ownerPhotoUrl: prompt.isAnonymous ? undefined : ownerSnapshot?.photoUrl,
        ownerAge: ownerSnapshot?.age,
        ownerGender: ownerSnapshot?.gender,
        ownerUserId: prompt.ownerUserId, // FIX: Include for owner checks
        // Owner-attached prompt media (Phase-2). Media follows prompt
        // visibility — if the viewer can see this payload, they can see
        // the media. `mediaStorageId` is intentionally omitted client-side
        // (already resolved into `mediaUrl` server-side).
        mediaKind: prompt.mediaKind,
        mediaUrl: sanitizedMediaUrl,
        mediaMime: prompt.mediaMime,
        fileSize: prompt.fileSize,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        hasMedia: !!prompt.mediaStorageId,
        // Phase 4: prompt-owner media one-time-view metadata.
        promptMediaViewCount: promptMediaMeta.promptMediaViewCount,
        viewerHasViewedPromptMedia: promptMediaMeta.viewerHasViewedPromptMedia,
        isPromptMediaOwner: promptMediaMeta.isPromptMediaOwner,
      },
      answers: enrichedAnswers,
      isExpired,
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
    token: v.string(),
    promptId: v.string(),
    userId: v.optional(v.string()),
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
    const userId = await requireAuthenticatedTodUserId(
      ctx,
      args.token,
      { userId: args.userId },
      'UNAUTHORIZED',
    );
    if (!(await getTodAccessContext(ctx, userId))) {
      throw new Error('Phase-2 setup is required to answer Truth or Dare prompts');
    }
    const authorSnapshot = await buildTodAuthorSnapshot(ctx, userId);

    // Validate prompt exists and not expired
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }
    if (!(await canShowTodPromptForViewer(ctx, prompt, userId))) {
      throw new Error('Prompt unavailable');
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
    // P1-TOD-RL: hour+day backstop on top of legacy minute bucket.
    await enforceTodActionLimit(ctx, userId, 'answer_backstop');

    // Check for existing answer
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', args.promptId).eq('userId', userId)
      )
      .first();

    const normalizedText = validateAnswerText(args.text);
    const viewDurationSec = validateViewDuration(args.viewDurationSec);

    // TOD-MEDIA-1 FIX: enforce durable 2-upload-attempt cap BEFORE accepting
    // any new storage id. Read-then-write inside one Convex mutation is
    // serializable; two parallel uploads cannot both pass this gate.
    //
    // TOD-MEDIA-2 FIX: if this is a replacement onto an existing answer that
    // already has any view footprint (mediaViewedAt / promptOwnerViewedAt /
    // todAnswerViews row), reject before any storage is touched.
    if (args.mediaStorageId) {
      await assertAnswerMediaCapNotExceeded(ctx, args.promptId, userId);
      if (existing && existing.mediaStorageId) {
        await assertNoPriorAnswerView(ctx, {
          _id: existing._id as Id<'todAnswers'>,
          mediaViewedAt: existing.mediaViewedAt,
          promptOwnerViewedAt: existing.promptOwnerViewedAt,
        });
      }
    }

    let mediaUpload: ValidatedTodUploadReference | undefined;
    let mediaDurationSec: number | undefined;
    let resolvedMediaMime = args.mediaMime;
    if (args.mediaStorageId) {
      const mediaKind = getTodUploadKindFromMedia(args.mediaMime, args.type);
      mediaUpload = await validateTodUploadReference(ctx, args.mediaStorageId, userId, mediaKind);
      mediaDurationSec = validateTodMediaDurationSec(mediaUpload.kind, args.durationSec);
      resolvedMediaMime = mediaUpload.contentType;
    }
    // Generate media URL if storage ID provided
    let mediaUrl: string | undefined;
    if (args.mediaStorageId) {
      mediaUrl = await ctx.storage.getUrl(args.mediaStorageId) ?? undefined;
      if (!mediaUrl) {
        throw new Error('Invalid media storage reference');
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
        // TOD-MEDIA-2 FIX: do NOT reset mediaViewedAt / promptOwnerViewedAt
        // on remove. The view footprint must survive remove so a subsequent
        // re-upload (within the 2-attempt cap) cannot bypass the
        // replace-after-view gate by removing-then-uploading.
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
        // TOD-MEDIA-2 FIX: do NOT reset mediaViewedAt / promptOwnerViewedAt
        // on replace. The pre-replacement gate (assertNoPriorAnswerView)
        // already guaranteed neither was set before we reached this branch.
        // If a future code path bypasses that gate, preserving these values
        // ensures the one-time view contract is not silently downgraded.
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
        patch.authorName = authorSnapshot.name;
        patch.authorPhotoUrl = authorSnapshot.photoUrl;
        patch.authorAge = authorSnapshot.age;
        patch.authorGender = authorSnapshot.gender;
      }

      debugTodLog(`[T/D] identityMode reused=${existingIdentityMode}`);

      await ctx.db.patch(existing._id, patch);

      // TOD-MEDIA-2 FIX: NEVER wipe `todAnswerViews` rows. The per-viewer
      // ledger is the source of truth for one-time-view consumption; the
      // pre-edit gate (assertNoPriorAnswerView) blocks media replacement
      // when any row exists, so reaching this branch with rows present
      // would already have thrown. Removing media (without replacing) is
      // permitted but does NOT clear the ledger — preserving the gate's
      // invariant for any future re-upload attempt.

      // TOD-MEDIA-1 FIX: monotonically increment the durable upload-attempt
      // counter ONLY when the caller actually set new media. removeMedia
      // does not count against the cap (no upload happened).
      if (args.mediaStorageId) {
        await incrementAnswerMediaUploadAttempt(ctx, args.promptId, userId);
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

      const latestExisting = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt_user', (q) =>
          q.eq('promptId', args.promptId).eq('userId', userId)
        )
        .first();
      if (latestExisting) {
        return { answerId: latestExisting._id, isEdit: true };
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
        authorName: shouldStripIdentitySnapshot ? undefined : authorSnapshot.name,
        authorPhotoUrl: shouldStripIdentitySnapshot ? undefined : authorSnapshot.photoUrl,
        authorAge: shouldStripIdentitySnapshot ? undefined : authorSnapshot.age,
        authorGender: shouldStripIdentitySnapshot ? undefined : authorSnapshot.gender,
        photoBlurMode: isNoPhoto ? 'blur' : 'none',
        isFrontCamera: args.isFrontCamera,
      });

      // TOD-MEDIA-1 FIX: increment durable upload-attempt counter on CREATE
      // when the new answer carries media. Survives deleteMyAnswer (the
      // counter table is intentionally never deleted), so the cap holds
      // across delete+recreate cycles.
      if (hasMedia) {
        await incrementAnswerMediaUploadAttempt(ctx, args.promptId, userId);
      }

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
    token: v.string(),
    answerId: v.string(),
    userId: v.optional(v.string()),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { token, answerId, userId: argsUserId, emoji }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { userId: argsUserId }, 'UNAUTHORIZED');

    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    if (!(await canEligibleTodViewerSeeAnswer(ctx, answer, userId))) {
      throw new Error('Answer unavailable');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userId, 'reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    // P2-TOD-RL: hour+day backstop on top of legacy minute bucket (reaction).
    await enforceTodActionLimit(ctx, userId, 'reaction_backstop');

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
    token: v.string(),
    answerId: v.string(),
    reporterId: v.optional(v.string()),
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
  handler: async (ctx, { token, answerId, reporterId: argsReporterId, reasonCode, reasonText }) => {
    const reporterId = await requireAuthenticatedTodUserId(ctx, token, { userId: argsReporterId }, 'UNAUTHORIZED');

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

    if (
      !(await canEligibleTodViewerSeeAnswer(ctx, answer, reporterId, undefined, {
        ignoreViewerAnswerReport: true,
      }))
    ) {
      throw new Error('Answer unavailable');
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
    // P2-TOD-RL: hour+day backstop on top of legacy daily bucket (report).
    await enforceTodActionLimit(ctx, reporterId, 'report_backstop');

    const now = Date.now();

    // Create report with structured reason
    await ctx.db.insert('todAnswerReports', {
      answerId,
      reporterId,
      reasonCode: reasonCode as any,
      reasonText,
      createdAt: now,
    });

    // P2-TOD-MOD: Bounded recount.  Previously this `.collect()` scanned
    // every historical report row for the answer.  We now `take(CAP)`
    // because the only consumer is `moderationStatusForTodReportCount`
    // which monotonically transitions normal -> under_review ->
    // hidden_by_reports at small fixed thresholds (~3).  When the scan
    // returns CAP rows we conservatively treat it as >= CAP, which still
    // resolves to `hidden_by_reports`.
    const reports = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer', (q) => q.eq('answerId', answerId))
      .take(TOD_REPORT_COUNT_SCAN_CAP);

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
    token: v.string(),
    promptId: v.string(),
    userId: v.optional(v.string()),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { token, promptId, userId: argsUserId, emoji }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { userId: argsUserId }, 'UNAUTHORIZED');

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    if (!(await canEligibleTodViewerSeePrompt(ctx, prompt, userId))) {
      throw new Error('Prompt unavailable');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userId, 'prompt_reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    // P2-TOD-RL: hour+day backstop on top of legacy minute bucket (prompt_reaction).
    await enforceTodActionLimit(ctx, userId, 'prompt_reaction_backstop');

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
    token: v.string(),
    promptId: v.string(),
    reporterId: v.optional(v.string()),
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
  handler: async (ctx, { token, promptId, reporterId: argsReporterId, reasonCode, reasonText }) => {
    const reporterId = await requireAuthenticatedTodUserId(ctx, token, { userId: argsReporterId }, 'UNAUTHORIZED');

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

    if (
      !(await canEligibleTodViewerSeePrompt(ctx, prompt, reporterId, {
        ignoreViewerPromptReport: true,
      }))
    ) {
      throw new Error('Prompt unavailable');
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
    // P2-TOD-RL: hour+day backstop on top of legacy daily bucket (prompt_report).
    await enforceTodActionLimit(ctx, reporterId, 'prompt_report_backstop');

    const now = Date.now();

    // Create report
    await ctx.db.insert('todPromptReports', {
      promptId,
      reporterId,
      reasonCode: reasonCode as any,
      reasonText,
      createdAt: now,
    });

    // P2-TOD-MOD: Bounded recount (see reportAnswer for rationale).
    const reports = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .take(TOD_REPORT_COUNT_SCAN_CAP);

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
    token: v.string(),
    promptId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, userId }) => {
    const currentUserId = await requireAuthenticatedTodUserId(ctx, token, { userId }, 'UNAUTHORIZED');
    if (!(await getTodAccessContext(ctx, currentUserId))) return null;

    const prompt = await ctx.db.get(promptId as Id<'todPrompts'>);
    if (!prompt || !(await canShowTodPromptForViewer(ctx, prompt, currentUserId))) {
      return null;
    }

    const answer = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', currentUserId)
      )
      .first();

    if (!answer) return null;
    if (!(await canShowTodAnswerForViewer(ctx, answer, currentUserId))) {
      return null;
    }

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
    token: v.string(),
    answerId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { token, answerId, userId: argsUserId }) => {
    const userId = await requireAuthenticatedTodUserId(ctx, token, { userId: argsUserId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap answer deletes (anti delete/recreate loop). Note that
    // the P0 `todAnswerUploadAttempts` counter is NEVER reset on delete, so
    // this limit only constrains delete velocity — it cannot be used to
    // recover upload-attempt budget by spamming deletes.
    await enforceTodActionLimit(ctx, userId, 'delete_answer');

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
    token: v.string(),
    answerId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, answerId, authUserId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');

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
    const promptExpires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (promptExpires <= Date.now()) {
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
    token: v.string(),
    answerId: v.string(),
    viewerId: v.optional(v.string()),
  },
  handler: async (ctx, { token, answerId, viewerId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, token, { viewerUserId: argsViewerId }, 'UNAUTHORIZED');

    // Rate limit check
    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    // P1-TOD-RL: hour+day backstop on top of legacy minute bucket (claim_media).
    await enforceTodActionLimit(ctx, viewerId, 'claim_media_backstop');

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
    const promptExpires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (promptExpires <= Date.now()) {
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
    token: v.string(),
    answerId: v.string(),
    viewerId: v.optional(v.string()),
  },
  handler: async (ctx, { token, answerId, viewerId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, token, { viewerUserId: argsViewerId }, 'UNAUTHORIZED');

    // Rate limit
    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    // P1-TOD-RL: hour+day backstop on top of legacy minute bucket (claim_media).
    await enforceTodActionLimit(ctx, viewerId, 'claim_media_backstop');

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
 * Claim viewing rights for prompt-owner photo/video media (Phase 4).
 *
 * Behavior:
 *  - Owner: unlimited views, never inserts a ledger row, returns a fresh URL.
 *  - Voice: replayable for everyone, never inserts a ledger row, returns URL.
 *  - Non-owner photo/video: one-time per viewer.
 *      * If a `todPromptMediaViews` row already exists for (promptId, viewerId)
 *        the mutation returns `{ status: 'already_viewed' }` and NO URL.
 *      * Otherwise it inserts a row and returns a fresh URL.
 *
 * Intentionally NOT shared with `claimAnswerMediaView`: answer media is
 * replayable; existence of a `todAnswerViews` row never blocks playback.
 * Prompt media uses a stricter gate, so it lives in its own table/mutation.
 */
export const openPromptMedia = mutation({
  args: {
    token: v.string(),
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, viewerUserId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, token, { viewerUserId: argsViewerId }, 'UNAUTHORIZED');

    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    // P1-TOD-RL: hour+day backstop on top of legacy minute bucket (claim_media).
    await enforceTodActionLimit(ctx, viewerId, 'claim_media_backstop');

    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      return { status: 'no_media' as const };
    }
    const promptExpires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (promptExpires <= Date.now()) {
      return { status: 'no_media' as const };
    }
    if (!prompt.mediaStorageId || !prompt.mediaKind) {
      return { status: 'no_media' as const };
    }
    if (!(await canViewerAccessPromptMedia(ctx, prompt, viewerId))) {
      return { status: 'not_authorized' as const };
    }

    const isOwner =
      !isSystemTodOwnerId(prompt.ownerUserId) && prompt.ownerUserId === viewerId;
    const kind = prompt.mediaKind as 'photo' | 'video' | 'voice';

    // Voice is replayable for everyone — return URL without recording a view.
    if (kind === 'voice') {
      const url = await ctx.storage.getUrl(prompt.mediaStorageId);
      if (!url) return { status: 'no_media' as const };
      return {
        status: 'ok' as const,
        mediaUrl: url,
        mediaKind: kind,
        mediaMime: prompt.mediaMime,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        viewedAt: Date.now(),
        alreadyViewed: false,
        isOwner,
      };
    }

    // Owner: unlimited access, never recorded.
    if (isOwner) {
      const url = await ctx.storage.getUrl(prompt.mediaStorageId);
      if (!url) return { status: 'no_media' as const };
      return {
        status: 'ok' as const,
        mediaUrl: url,
        mediaKind: kind,
        mediaMime: prompt.mediaMime,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        viewedAt: Date.now(),
        alreadyViewed: false,
        isOwner: true,
      };
    }

    // Non-owner photo/video: one-time gate.
    // TOD-BIZ-1 / TOD-MEDIA-6 FIX: claim via single atomic helper. Convex
    // serializable mutations + index-read conflict detection guarantee that
    // two parallel `openPromptMedia` / `preparePromptMedia` /
    // `markPromptMediaViewed` calls cannot both insert. The loser retries
    // and sees `alreadyViewed: true`, so no fresh URL is leaked.
    const url = await ctx.storage.getUrl(prompt.mediaStorageId);
    if (!url) return { status: 'no_media' as const };

    const claim = await consumePromptMediaViewOnce(ctx, {
      promptId,
      viewerUserId: viewerId as string,
      ownerUserId: prompt.ownerUserId as string,
      mediaKind: kind,
    });

    if (claim.alreadyViewed) {
      return {
        status: 'already_viewed' as const,
        alreadyViewed: true,
        isOwner: false,
      };
    }

    debugTodLog(
      `[T/D] openPromptMedia inserted view viewerId=${viewerId} promptId=${promptId} kind=${kind}`
    );

    return {
      status: 'ok' as const,
      mediaUrl: url,
      mediaKind: kind,
      mediaMime: prompt.mediaMime,
      durationSec: prompt.durationSec,
      isFrontCamera: prompt.isFrontCamera ?? false,
      viewedAt: claim.viewedAt,
      alreadyViewed: false,
      isOwner: false,
    };
  },
});

/**
 * Phase 4 (preload split): preparation step for prompt-owner photo/video.
 *
 * Returns a fresh, authorized media URL only after inserting a durable row in
 * `todPromptMediaViews`. Used by the two-tap client flow:
 *
 *   1) First tap (preload): client claims the view and warms the asset locally.
 *   2) Second tap (open):   client opens the viewer with the cached URL.
 *   3) Consumption complete:client calls `markPromptMediaViewed`, which is
 *                           idempotent because the claim already exists.
 *
 * Authorization, hidden-by-reports, blocked-user, and rate-limit gates
 * mirror `openPromptMedia` exactly. If the viewer has already burned the
 * one-time view (a `todPromptMediaViews` row exists for the pair), this
 * mutation returns `already_viewed` so the client can show the friendly
 * alert without leaking a fresh URL.
 *
 * Voice and owner branches behave identically to `openPromptMedia` (no
 * ledger row is ever written for those).
 */
export const preparePromptMedia = mutation({
  args: {
    token: v.string(),
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, viewerUserId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, token, { viewerUserId: argsViewerId }, 'UNAUTHORIZED');

    const rateCheck = await checkRateLimit(ctx, viewerId, 'claim_media');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }
    // P1-TOD-RL: hour+day backstop on top of legacy minute bucket (claim_media).
    await enforceTodActionLimit(ctx, viewerId, 'claim_media_backstop');

    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      return { status: 'no_media' as const };
    }
    const promptExpires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (promptExpires <= Date.now()) {
      return { status: 'no_media' as const };
    }
    if (!prompt.mediaStorageId || !prompt.mediaKind) {
      return { status: 'no_media' as const };
    }
    if (!(await canViewerAccessPromptMedia(ctx, prompt, viewerId))) {
      return { status: 'not_authorized' as const };
    }

    const isOwner =
      !isSystemTodOwnerId(prompt.ownerUserId) && prompt.ownerUserId === viewerId;
    const kind = prompt.mediaKind as 'photo' | 'video' | 'voice';

    // Voice: replayable for everyone — return URL, never inserts a row.
    if (kind === 'voice') {
      const url = await ctx.storage.getUrl(prompt.mediaStorageId);
      if (!url) return { status: 'no_media' as const };
      return {
        status: 'ok' as const,
        mediaUrl: url,
        mediaKind: kind,
        mediaMime: prompt.mediaMime,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        isOwner,
      };
    }

    // Owner: unlimited access, never inserts a row.
    if (isOwner) {
      const url = await ctx.storage.getUrl(prompt.mediaStorageId);
      if (!url) return { status: 'no_media' as const };
      return {
        status: 'ok' as const,
        mediaUrl: url,
        mediaKind: kind,
        mediaMime: prompt.mediaMime,
        durationSec: prompt.durationSec,
        isFrontCamera: prompt.isFrontCamera ?? false,
        isOwner: true,
      };
    }

    // Non-owner photo/video: claim before returning the URL.
    // TOD-BIZ-1 / TOD-MEDIA-5 FIX: shares the single atomic claim helper
    // with openPromptMedia and markPromptMediaViewed so all three entry
    // points agree on consumption semantics and cannot race.
    const url = await ctx.storage.getUrl(prompt.mediaStorageId);
    if (!url) return { status: 'no_media' as const };

    const claim = await consumePromptMediaViewOnce(ctx, {
      promptId,
      viewerUserId: viewerId as string,
      ownerUserId: prompt.ownerUserId as string,
      mediaKind: kind,
    });

    if (claim.alreadyViewed) {
      return { status: 'already_viewed' as const, isOwner: false };
    }

    debugTodLog(
      `[T/D] preparePromptMedia claimed view viewerId=${viewerId} promptId=${promptId} kind=${kind}`
    );

    return {
      status: 'ok' as const,
      mediaUrl: url,
      mediaKind: kind,
      mediaMime: prompt.mediaMime,
      durationSec: prompt.durationSec,
      isFrontCamera: prompt.isFrontCamera ?? false,
      isOwner: false,
      viewedAt: claim.viewedAt,
    };
  },
});

/**
 * Phase 4 (preload split): completion step for prompt-owner photo/video.
 *
 * Called by the client only after actual consumption:
 *   - photo: viewer was open and the image rendered, then user closed/back
 *   - video: playback reached the end (didJustFinish)
 *   - voice/audio: playback finished
 *
 * Inserts the one-time-view row in `todPromptMediaViews` if not already
 * present. Idempotent: re-calling for the same (promptId, viewerId) pair
 * is a no-op success and reports `alreadyViewed: true`.
 *
 * Owner and voice branches are intentional no-ops: the ledger never tracks
 * those (owner is unlimited, voice is replayable). Calling this for those
 * branches is safe — the client may unconditionally call it on completion
 * without special-casing.
 */
export const markPromptMediaViewed = mutation({
  args: {
    token: v.string(),
    promptId: v.string(),
    viewerUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, promptId, viewerUserId: argsViewerId }) => {
    const viewerId = await requireAuthenticatedTodUserId(ctx, token, { viewerUserId: argsViewerId }, 'UNAUTHORIZED');
    // P1-TOD-RL: cap mark-viewed throughput (anti-bot-loop on the one-time
    // view consume endpoint). P0 `consumePromptMediaViewOnce` already enforces
    // idempotency; this adds a per-user velocity ceiling.
    await enforceTodActionLimit(ctx, viewerId, 'mark_prompt_media_viewed');

    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();
    if (!prompt) {
      return { status: 'no_media' as const };
    }
    const promptExpires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (promptExpires <= Date.now()) {
      return { status: 'no_media' as const };
    }
    if (!prompt.mediaStorageId || !prompt.mediaKind) {
      return { status: 'no_media' as const };
    }
    if (!(await canViewerAccessPromptMedia(ctx, prompt, viewerId))) {
      return { status: 'not_authorized' as const };
    }

    const isOwner =
      !isSystemTodOwnerId(prompt.ownerUserId) && prompt.ownerUserId === viewerId;
    const kind = prompt.mediaKind as 'photo' | 'video' | 'voice';

    // Owner / voice: ledger is intentionally not tracked.
    if (isOwner || kind === 'voice') {
      return {
        status: 'ok' as const,
        alreadyViewed: false,
        viewedAt: Date.now(),
        isOwner,
        recorded: false,
      };
    }

    // Non-owner photo/video: idempotent ledger insert.
    // TOD-BIZ-1 / TOD-MEDIA-5 FIX: single atomic claim helper shared with
    // openPromptMedia / preparePromptMedia. Idempotent — re-calls for the
    // same (promptId, viewer) return `alreadyViewed: true`.
    const claim = await consumePromptMediaViewOnce(ctx, {
      promptId,
      viewerUserId: viewerId as string,
      ownerUserId: prompt.ownerUserId as string,
      mediaKind: kind,
    });

    if (!claim.alreadyViewed) {
      debugTodLog(
        `[T/D] markPromptMediaViewed inserted view viewerId=${viewerId} promptId=${promptId} kind=${kind}`
      );
    }

    return {
      status: 'ok' as const,
      alreadyViewed: claim.alreadyViewed,
      viewedAt: claim.viewedAt,
      isOwner: false,
      recorded: !claim.alreadyViewed,
    };
  },
});

/**
 * Get URL for voice message playback.
 * Voice messages are NOT one-time secure - they can be replayed.
 */
export const getVoiceUrl = query({
  args: {
    token: v.string(),
    answerId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, answerId, authUserId }) => {
    const viewerUserId = await requireAuthenticatedTodUserId(ctx, token, { authUserId }, 'UNAUTHORIZED');

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
    const promptExpires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (promptExpires <= Date.now()) {
      return { status: 'no_media' as const };
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
