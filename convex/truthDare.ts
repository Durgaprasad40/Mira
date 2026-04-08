import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireAuthenticatedSessionUser, resolveUserIdByAuthId } from './helpers';
import { filterContent } from './contentFilter'; // P0-001: Content filtering

// 24-hour auto-delete rule (same as Confessions)
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Rate limiting constants
const RATE_LIMITS = {
  answer: { max: 10, windowMs: 60 * 1000 }, // 10 answers per minute
  reaction: { max: 30, windowMs: 60 * 1000 }, // 30 reactions per minute
  report: { max: 10, windowMs: 24 * 60 * 60 * 1000 }, // 10 reports per day
  claim_media: { max: 20, windowMs: 60 * 1000 }, // 20 media claims per minute
  prompt: { max: 5, windowMs: 60 * 60 * 1000 }, // P0-003: 5 prompts per hour
  connect: { max: 10, windowMs: 60 * 60 * 1000 }, // P0-004: 10 connect requests per hour
};

// Report threshold for global soft-remove (P1-002: reduced from 5 to 3)
const REPORT_HIDE_THRESHOLD = 3;

// TOD-P2-001 FIX: Rate limit error message
const RATE_LIMIT_ERROR = 'Rate limit exceeded. Please try again later.';

// P1-001 FIX: Check if either user has blocked the other
async function isBlockedBidirectional(
  ctx: any,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  const block1 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q: any) =>
      q.eq('blockerId', userId1).eq('blockedUserId', userId2)
    )
    .first();
  if (block1) return true;

  const block2 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q: any) =>
      q.eq('blockerId', userId2).eq('blockedUserId', userId1)
    )
    .first();
  return !!block2;
}

// PHASE-2 IDENTITY FIX: Helper to get Phase-2 displayName (nickname) instead of real name
// T/D is a Phase-2 feature, so MUST use Phase-2 displayName everywhere
// PRIVACY FIX: Always use handle from users table, never stored displayName
// This ensures old records with full names stored are overridden
async function getPhase2DisplayName(ctx: any, userId: Id<'users'>): Promise<string> {
  // ALWAYS prefer handle from users table - stored displayName may contain old full names
  const user = await ctx.db.get(userId);
  return user?.handle || 'Anonymous';
}

function isRemoteUrl(url: string | undefined | null): url is string {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

async function requireTodSession(
  ctx: any,
  token: string
): Promise<{ user: any; userId: Id<'users'>; userIdStr: string }> {
  const user = await requireAuthenticatedSessionUser(ctx, token);
  return {
    user,
    userId: user._id,
    userIdStr: user._id as string,
  };
}

function storedUserMatches(
  storedUserId: string | undefined | null,
  user: { _id: Id<'users'>; authUserId?: string | null; demoUserId?: string | null } | null
): boolean {
  if (!storedUserId || !user) return false;
  return (
    storedUserId === (user._id as string) ||
    storedUserId === user.authUserId ||
    storedUserId === user.demoUserId
  );
}

async function resolveStoredUserId(
  ctx: any,
  storedUserId: string | undefined | null
): Promise<Id<'users'> | null> {
  if (!storedUserId) return null;

  const directUser = await ctx.db.get(storedUserId as Id<'users'>);
  if (directUser) {
    return storedUserId as Id<'users'>;
  }

  return await resolveUserIdByAuthId(ctx, storedUserId);
}

async function getBlockedUserRefSet(
  ctx: any,
  viewerUserId: Id<'users'>
): Promise<Set<string>> {
  const blockedRefs = new Set<string>();

  const [blockedByMe, blockedMe] = await Promise.all([
    ctx.db.query('blocks').withIndex('by_blocker', (q: any) => q.eq('blockerId', viewerUserId)).collect(),
    ctx.db.query('blocks').withIndex('by_blocked', (q: any) => q.eq('blockedUserId', viewerUserId)).collect(),
  ]);

  const relatedUserIds = new Set<Id<'users'>>();
  blockedByMe.forEach((block: any) => relatedUserIds.add(block.blockedUserId));
  blockedMe.forEach((block: any) => relatedUserIds.add(block.blockerId));

  await Promise.all(
    Array.from(relatedUserIds).map(async (userId) => {
      blockedRefs.add(userId as string);
      const user = await ctx.db.get(userId);
      if (user?.authUserId) blockedRefs.add(user.authUserId);
      if (user?.demoUserId) blockedRefs.add(user.demoUserId);
    })
  );

  return blockedRefs;
}

async function assertNotBlockedWithStoredUser(
  ctx: any,
  viewerUserId: Id<'users'>,
  otherStoredUserId: string | undefined | null,
  errorMessage: string
): Promise<void> {
  const otherUserId = await resolveStoredUserId(ctx, otherStoredUserId);
  if (!otherUserId) return;

  if (await isBlockedBidirectional(ctx, viewerUserId, otherUserId)) {
    throw new Error(errorMessage);
  }
}

// Get trending prompts (1 truth + 1 dare), excluding expired
export const getTrendingPrompts = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireTodSession(ctx, token);
    const now = Date.now();
    const allTrending = await ctx.db
      .query('todPrompts')
      .withIndex('by_trending', (q) => q.eq('isTrending', true))
      .collect();

    const active = allTrending.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires <= now) return false;
      // P0-002: Filter out hidden prompts
      if (p.isHidden) return false;
      return true;
    });

    const truth = active.find((p) => p.type === 'truth') || null;
    const dare = active.find((p) => p.type === 'dare') || null;
    return { truth, dare };
  },
});

// Get answers for a prompt
// P0-001 FIX: Resolve viewer server-side, filter hidden/globally-hidden answers
export const getAnswersForPrompt = query({
  args: { promptId: v.string(), token: v.string() },
  handler: async (ctx, { promptId, token }) => {
    const viewer = await requireTodSession(ctx, token);
    const viewerId = viewer.userIdStr;

    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .order('desc')
      .collect();

    // P0-001 FIX: Filter out hidden/globally-hidden answers
    return answers.filter((answer) => {
      // Never show globally hidden answers (report threshold exceeded)
      if (answer.isGloballyHidden === true) {
        return false;
      }

      // If viewer is authenticated, filter out answers they reported
      if (viewerId && answer.hiddenForUserIds?.includes(viewerId)) {
        return false;
      }

      // Answer author can always see their own answer
      if (viewerId && answer.userId === viewerId) {
        return true;
      }

      return true;
    });
  },
});

// Check if CURRENT USER already answered a prompt
// P0-002 FIX: Use server-side auth only - cannot query other users' participation
export const hasUserAnswered = query({
  args: { promptId: v.string(), token: v.string() },
  handler: async (ctx, { promptId, token }) => {
    const viewer = await requireTodSession(ctx, token);
    const userId = viewer.userIdStr;

    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) => q.eq('promptId', promptId).eq('userId', userId))
      .first();
    return !!existing;
  },
});

// Create a new Truth or Dare prompt
// TOD-001 FIX: Auth hardening - verify caller identity server-side
export const createPrompt = mutation({
  args: {
    type: v.union(v.literal('truth'), v.literal('dare')),
    text: v.string(),
    token: v.string(),
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
    const { userId, userIdStr } = await requireTodSession(ctx, args.token);

    // P0-001: Content filtering - reject unsafe prompts
    const contentCheck = filterContent(args.text);
    if (!contentCheck.isClean) {
      throw new Error('This prompt violates community guidelines');
    }

    // P0-003: Rate limit prompt creation (5 per hour)
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'prompt');
    if (!rateCheck.allowed) {
      throw new Error('Too many prompts. Try again later.');
    }

    const now = Date.now();
    const expiresAt = now + TWENTY_FOUR_HOURS_MS;

    // Resolve photo URL from storage ID if provided (ensures HTTPS URL)
    let resolvedPhotoUrl = isRemoteUrl(args.ownerPhotoUrl) ? args.ownerPhotoUrl : undefined;
    if (args.ownerPhotoStorageId) {
      const storageUrl = await ctx.storage.getUrl(args.ownerPhotoStorageId);
      if (storageUrl) {
        resolvedPhotoUrl = storageUrl;
        console.log(`[T/D] Resolved photo storageId to URL: ${storageUrl.substring(0, 60)}...`);
      }
    } else if (args.ownerPhotoUrl && !resolvedPhotoUrl) {
      throw new Error('Only persisted profile photos can be attached to prompts');
    }

    const promptId = await ctx.db.insert('todPrompts', {
      type: args.type,
      text: args.text,
      isTrending: false, // User-created prompts are never trending
      ownerUserId: userIdStr,
      answerCount: 0,
      activeCount: 0,
      createdAt: now,
      expiresAt,
      isHidden: false,
      totalReactionCount: 0,
      // Owner profile snapshot (default anonymous)
      isAnonymous: args.isAnonymous ?? true,
      photoBlurMode: args.photoBlurMode ?? 'none',
      ownerName: args.ownerName,
      ownerPhotoUrl: resolvedPhotoUrl,
      ownerAge: args.ownerAge,
      ownerGender: args.ownerGender,
    });

    // Debug log for post creation
    const urlPrefix = resolvedPhotoUrl ? (resolvedPhotoUrl.startsWith('https://') ? 'https' : resolvedPhotoUrl.startsWith('http://') ? 'http' : 'other') : 'none';
    console.log(`[T/D] Created prompt: id=${promptId}, type=${args.type}, isAnon=${args.isAnonymous ?? true}, photoBlurMode=${args.photoBlurMode ?? 'none'}, photoUrlPrefix=${urlPrefix}`);

    return { promptId, expiresAt };
  },
});

// Edit an existing prompt (owner only, text only)
export const editPrompt = mutation({
  args: {
    promptId: v.id('todPrompts'),
    text: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { userIdStr } = await requireTodSession(ctx, args.token);
    const { promptId } = args;

    // Get the prompt
    const prompt = await ctx.db.get(promptId);
    if (!prompt) {
      throw new Error('Prompt not found');
    }

    // Verify ownership
    if (prompt.ownerUserId !== userIdStr) {
      throw new Error('You can only edit your own prompts');
    }

    // Check if prompt is expired
    if (prompt.expiresAt && prompt.expiresAt < Date.now()) {
      throw new Error('Cannot edit an expired prompt');
    }

    // Content filtering
    const contentCheck = filterContent(args.text);
    if (!contentCheck.isClean) {
      throw new Error('This prompt violates community guidelines');
    }

    // Update the prompt text
    await ctx.db.patch(promptId, {
      text: args.text,
    });

    console.log(`[T/D] Edited prompt: id=${promptId}, newText=${args.text.substring(0, 30)}...`);

    return { success: true };
  },
});

// Submit an answer (one per user per prompt)
export const submitAnswer = mutation({
  args: {
    promptId: v.string(),
    token: v.string(),
    type: v.union(v.literal('text'), v.literal('photo'), v.literal('video'), v.literal('voice')),
    text: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    mediaStorageId: v.optional(v.id('_storage')),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userIdStr: userId } = await requireTodSession(ctx, args.token);

    if (args.mediaUrl && !isRemoteUrl(args.mediaUrl)) {
      throw new Error('Only persisted media URLs can be attached to answers');
    }

    // TOD-P2-001 FIX: Enforce rate limit (10 answers per minute)
    const now = Date.now();
    const windowStart = now - RATE_LIMITS.answer.windowMs;
    const recentAnswers = await ctx.db
      .query('todAnswers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.gte(q.field('createdAt'), windowStart))
      .collect();
    if (recentAnswers.length >= RATE_LIMITS.answer.max) {
      throw new Error(RATE_LIMIT_ERROR);
    }

    // Enforce one answer per user per prompt
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) => q.eq('promptId', args.promptId).eq('userId', userId))
      .first();
    if (existing) {
      throw new Error('You already posted for this prompt.');
    }

    // SELF-COMMENT RESTRICTION: Owner cannot answer their own prompt
    // Mirrors Confess pattern where self-interaction is blocked
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();
    if (prompt && prompt.ownerUserId === userId) {
      throw new Error('You cannot answer your own prompt.');
    }

    const answerId = await ctx.db.insert('todAnswers', {
      promptId: args.promptId,
      userId,
      type: args.type,
      text: args.text,
      mediaUrl: args.mediaUrl,
      mediaStorageId: args.mediaStorageId,
      durationSec: args.durationSec,
      likeCount: 0,
      createdAt: Date.now(),
    });

    // Increment answer count on prompt (reuse prompt from self-comment check above)
    if (prompt) {
      await ctx.db.patch(prompt._id, {
        answerCount: prompt.answerCount + 1,
        activeCount: prompt.activeCount + 1,
      });
    }

    return answerId;
  },
});

// Like an answer
export const likeAnswer = mutation({
  args: {
    answerId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { answerId, token }) => {
    const { userId, userIdStr: likedByUserId } = await requireTodSession(ctx, token);

    // TOD-P2-001 FIX: Enforce rate limit (30 reactions per minute)
    const now = Date.now();
    const windowStart = now - RATE_LIMITS.reaction.windowMs;
    const recentLikes = await ctx.db
      .query('todAnswerLikes')
      .withIndex('by_user', (q) => q.eq('likedByUserId', likedByUserId))
      .filter((q) => q.gte(q.field('createdAt'), windowStart))
      .collect();
    if (recentLikes.length >= RATE_LIMITS.reaction.max) {
      throw new Error(RATE_LIMIT_ERROR);
    }

    // Check if already liked
    const existing = await ctx.db
      .query('todAnswerLikes')
      .withIndex('by_answer_user', (q) => q.eq('answerId', answerId).eq('likedByUserId', likedByUserId))
      .first();
    if (existing) return { alreadyLiked: true };

    await ctx.db.insert('todAnswerLikes', {
      answerId,
      likedByUserId,
      createdAt: Date.now(),
    });

    // Increment like count on answer
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (answer) {
      await ctx.db.patch(answer._id, { likeCount: answer.likeCount + 1 });

      // Get the prompt to find owner
      const prompt = await ctx.db
        .query('todPrompts')
        .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
        .first();

      // Create connect request for prompt owner
      // CONNECT FIX: Resolve user IDs to Convex IDs for consistent storage format
      if (prompt && prompt.ownerUserId !== likedByUserId) {
        const likerDbId = userId;
        const ownerDbId = await resolveStoredUserId(ctx, prompt.ownerUserId);
        if (likerDbId && ownerDbId) {
          await ctx.db.insert('todConnectRequests', {
            promptId: answer.promptId,
            answerId,
            fromUserId: likerDbId,
            toUserId: ownerDbId,
            status: 'pending',
            createdAt: Date.now(),
          });
        }
      }
    }

    return { alreadyLiked: false };
  },
});

// Unlike an answer
export const unlikeAnswer = mutation({
  args: {
    answerId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { answerId, token }) => {
    const { userIdStr: likedByUserId } = await requireTodSession(ctx, token);

    const existing = await ctx.db
      .query('todAnswerLikes')
      .withIndex('by_answer_user', (q) => q.eq('answerId', answerId).eq('likedByUserId', likedByUserId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      const answer = await ctx.db
        .query('todAnswers')
        .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
        .first();
      if (answer && answer.likeCount > 0) {
        await ctx.db.patch(answer._id, { likeCount: answer.likeCount - 1 });
      }
    }
  },
});

// Get pending connect requests for current user (as recipient)
// Returns enriched data with sender profile for UI display
export const getPendingConnectRequests = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { userId, userIdStr } = await requireTodSession(ctx, token);

    // FIX: Query all pending requests and filter by toUserId in memory
    // This bypasses potential index issues while we debug
    // Query pending requests for this user
    let requests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', userIdStr))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .order('desc')
      .collect();

    // Fallback: If index returns nothing, try filter-based query (handles ID format edge cases)
    if (requests.length === 0) {
      const allPending = await ctx.db
        .query('todConnectRequests')
        .filter((q) => q.eq(q.field('status'), 'pending'))
        .collect();

      // Normalize IDs for comparison
      const normalizedQueryId = userIdStr.trim();
      requests = allPending.filter((r) => {
        const normalizedStoredId = (r.toUserId || '').trim();
        return normalizedStoredId === normalizedQueryId;
      });
    }

    // Enrich with sender profile and prompt data
    const enriched = await Promise.all(
      requests.map(async (req) => {
        // P0-FIX: req.fromUserId is stored as Convex ID (resolved in sendTodConnectRequest)
        // DO NOT double-resolve - use directly as Convex ID
        // ID CONTRACT: todConnectRequests stores Convex IDs, NOT authUserIds
        const senderDbId = req.fromUserId as Id<'users'>;
        const sender = await ctx.db.get(senderDbId);

        // [TD_ID_FLOW] Validate sender exists - log if mismatch (indicates corrupted request)
        if (!sender) {
          console.log('[TD_ID_MISMATCH] Sender not found for stored Convex ID:', {
            requestId: req._id,
            fromUserId: req.fromUserId,
          });
          return null; // Skip this request - data integrity issue
        }

        if (await isBlockedBidirectional(ctx, senderDbId, userId)) {
          return null;
        }

        // PHASE-2 ISOLATION: Get Phase-2 private profile for photo (NO Phase-1 fallback)
        const senderPrivateProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q: any) => q.eq('userId', senderDbId))
          .first();

        // Get prompt for context
        const prompt = await ctx.db
          .query('todPrompts')
          .filter((q) => q.eq(q.field('_id'), req.promptId as Id<'todPrompts'>))
          .first();

        // Calculate age from dateOfBirth
        let senderAge: number | null = null;
        if (sender.dateOfBirth) {
          const birthDate = new Date(sender.dateOfBirth);
          const today = new Date();
          senderAge = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            senderAge--;
          }
        }

        // PHASE-2 IDENTITY FIX: Use Phase-2 displayName (nickname), NOT real name
        const senderDisplayName = await getPhase2DisplayName(ctx, senderDbId);

        return {
          _id: req._id,
          promptId: req.promptId,
          answerId: req.answerId,
          fromUserId: req.fromUserId,
          createdAt: req.createdAt,
          // Sender profile snapshot - PHASE-2 IDENTITY: Use displayName
          senderName: senderDisplayName,
          // PHASE-2 ISOLATION: Use ONLY Phase-2 private photos, NO Phase-1 fallback
          senderPhotoUrl: senderPrivateProfile?.privatePhotoUrls?.[0] ?? null,
          senderAge,
          senderGender: sender.gender ?? null,
          // Prompt context
          promptType: prompt?.type ?? 'truth',
          promptText: prompt?.text ?? '',
        };
      })
    );

    // Filter out null entries (corrupted requests with missing sender)
    return enriched.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// Send a T&D connect request (prompt owner → answer author)
export const sendTodConnectRequest = mutation({
  args: {
    promptId: v.string(),
    answerId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { promptId, answerId, token }) => {
    const { userId, userIdStr } = await requireTodSession(ctx, token);

    // [T/D SEND] Debug: Log input params
    console.log('[T/D SEND] Input:', {
      promptId: promptId?.slice(-8),
      answerId: answerId?.slice(-8),
      userId: userIdStr?.slice(-8),
    });
    const fromUserId = userId;
    console.log('[T/D SEND] Resolved fromUserId:', userIdStr?.slice(-8) ?? 'NULL');

    // P0-004: Rate limit connect requests
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'connect');
    if (!rateCheck.allowed) {
      return { success: false, reason: RATE_LIMIT_ERROR };
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
      console.log('[T/D SEND] Ownership mismatch:', {
        promptOwner: prompt.ownerUserId?.slice(-8),
        fromUserId: fromUserId?.slice(-8),
      });
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

    // CONNECT FIX: Resolve stored answer author reference to a canonical user ID
    console.log('[T/D SEND] Answer userId (raw):', answer.userId?.slice(-8));
    const toUserId = await resolveStoredUserId(ctx, answer.userId);
    console.log('[T/D SEND] Resolved toUserId:', toUserId?.slice(-8) ?? 'NULL');
    if (!toUserId) {
      console.log('[T/D SEND] ERROR: Could not resolve answer.userId to Convex ID');
      return { success: false, reason: 'Recipient user not found' };
    }

    // Cannot connect to self
    if (toUserId === fromUserId) {
      return { success: false, reason: 'Cannot connect to yourself' };
    }

    // P1-003 FIX: Check if either user has blocked the other
    const blockAtoB = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', fromUserId as Id<'users'>).eq('blockedUserId', toUserId as Id<'users'>)
      )
      .first();
    const blockBtoA = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', toUserId as Id<'users'>).eq('blockedUserId', fromUserId as Id<'users'>)
      )
      .first();
    if (blockAtoB || blockBtoA) {
      return { success: false, reason: 'Cannot connect with this user' };
    }

    // P1-001 & P1-002 FIX: Check for ANY existing request between this pair (including removed)
    // This prevents: 1) race conditions with simultaneous requests, 2) re-spam after rejection
    // Check A→B (current user → answer author) - ALL statuses
    const existingAtoB = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', fromUserId).eq('toUserId', toUserId))
      .first();

    if (existingAtoB) {
      if (existingAtoB.status === 'removed') {
        return { success: false, reason: 'Connect request was previously declined' };
      }
      return { success: false, reason: 'Request already exists' };
    }

    // Check B→A (answer author → current user) - ALL statuses to prevent duplicate pairs
    const existingBtoA = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', toUserId).eq('toUserId', fromUserId))
      .first();

    if (existingBtoA) {
      if (existingBtoA.status === 'removed') {
        return { success: false, reason: 'This user previously declined a request from you' };
      }
      return { success: false, reason: 'You already have a pending request from this user' };
    }

    // Create connect request
    // FIX: Ensure IDs are stored as strings to match schema (v.string())
    const fromUserIdStr = fromUserId as string;
    const toUserIdStr = toUserId as string;
    const requestDoc = {
      promptId,
      answerId,
      fromUserId: fromUserIdStr,
      toUserId: toUserIdStr,
      status: 'pending' as const,
      createdAt: Date.now(),
    };
    console.log('[T/D SEND] Creating request:', {
      fromUserId: fromUserIdStr,
      toUserId: toUserIdStr,
      status: requestDoc.status,
    });
    const requestId = await ctx.db.insert('todConnectRequests', requestDoc);
    console.log('[T/D SEND] SUCCESS - Created request:', requestId);

    return { success: true };
  },
});

// Respond to connect request (Connect or Remove)
// Creates conversation in EXISTING conversations table for both users
export const respondToConnect = mutation({
  args: {
    requestId: v.id('todConnectRequests'),
    action: v.union(v.literal('connect'), v.literal('remove')),
    token: v.string(),
  },
  handler: async (ctx, { requestId, action, token }) => {
    const { user, userId, userIdStr } = await requireTodSession(ctx, token);
    const recipientDbId = userId;
    console.log('[T/D RESPOND] Auth check:', {
      inputAuthUserId: userIdStr?.slice(-8),
      resolvedRecipientDbId: userIdStr?.slice(-8) ?? 'NULL',
    });

    const request = await ctx.db.get(requestId);
    if (!request || request.status !== 'pending') {
      return { success: false, reason: 'Request not found or already processed' };
    }

    // Only the intended recipient can respond
    // FIX: Convert both to string for comparison (avoid type coercion issues)
    const storedToUserId = request.toUserId as string;
    const resolvedRecipient = recipientDbId as string;
    console.log('[T/D RESPOND] Authorization check:', {
      storedToUserId: storedToUserId?.slice(-8),
      resolvedRecipient: resolvedRecipient?.slice(-8),
      exactMatch: storedToUserId === resolvedRecipient,
    });
    if (storedToUserId !== resolvedRecipient) {
      throw new Error('Unauthorized: only the request recipient can respond');
    }

    if (action === 'connect') {
      // P0-003: Re-verify that fromUserId actually owns the prompt before accepting
      const prompt = await ctx.db.get(request.promptId as Id<'todPrompts'>);
      if (!prompt) {
        return { success: false, reason: 'Prompt not found' };
      }
      if (prompt.ownerUserId !== request.fromUserId) {
        console.log('[T/D RESPOND] SECURITY: fromUserId does not match prompt owner', {
          fromUserId: request.fromUserId?.slice(-8),
          promptOwner: prompt.ownerUserId?.slice(-8),
        });
        return { success: false, reason: 'Invalid connect request' };
      }

      // P1-001 FIX: Block check before creating connection
      const senderDbId = request.fromUserId as Id<'users'>;
      const isBlocked = await isBlockedBidirectional(ctx, senderDbId, recipientDbId as Id<'users'>);
      if (isBlocked) {
        return { success: false, reason: 'Cannot connect with blocked user' };
      }

      await ctx.db.patch(requestId, { status: 'connected' });
      const sender = await ctx.db.get(senderDbId);
      if (!sender) {
        return { success: false, reason: 'Sender user not found' };
      }

      // Get sender profile for response (sender already fetched above)

      // Get recipient profile for response
      const recipient = await ctx.db.get(recipientDbId as Id<'users'>);

      // PHASE-2 ISOLATION FIX: Fetch private profiles for Phase-2 photos
      // Do NOT use primaryPhotoUrl (Phase-1) - use privatePhotoUrls (Phase-2) only
      const senderPrivateProfile = await ctx.db
        .query('userPrivateProfiles')
        .withIndex('by_user', (q: any) => q.eq('userId', senderDbId))
        .first();
      const recipientPrivateProfile = await ctx.db
        .query('userPrivateProfiles')
        .withIndex('by_user', (q: any) => q.eq('userId', recipientDbId as Id<'users'>))
        .first();

      // Calculate ages
      const calculateAge = (dob: string | undefined): number | null => {
        if (!dob) return null;
        const birthDate = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        return age;
      };

      const senderAge = calculateAge(sender?.dateOfBirth);
      const recipientAge = calculateAge(recipient?.dateOfBirth);

      // PHASE-2 IDENTITY FIX: Get Phase-2 displayNames (nicknames), NOT real names
      const senderDisplayName = await getPhase2DisplayName(ctx, senderDbId as Id<'users'>);
      const recipientDisplayName = await getPhase2DisplayName(ctx, recipientDbId as Id<'users'>);

      // Order participants for consistent deduplication (lower ID first)
      const participantIds = [senderDbId as Id<'users'>, recipientDbId as Id<'users'>].sort() as [Id<'users'>, Id<'users'>];

      // PHASE-2 FIX: Check if PRIVATE conversation already exists for this user pair
      // Query privateConversationParticipants to find shared conversations
      console.log('[T/D ACCEPT PHASE2] Creating Phase-2 conversation for T/D connect');
      const senderParticipations = await ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', senderDbId as Id<'users'>))
        .collect();

      let existingConversationId: Id<'privateConversations'> | null = null;

      for (const sp of senderParticipations) {
        // Check if recipient is also in this conversation
        const recipientInConvo = await ctx.db
          .query('privateConversationParticipants')
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
      let conversationId: Id<'privateConversations'>;

      if (existingConversationId) {
        // Reuse existing Phase-2 conversation
        conversationId = existingConversationId;
        // Update lastMessageAt
        await ctx.db.patch(conversationId, { lastMessageAt: now });
        console.log('[CONVO_IDEMPOTENT] T/D reusing existing conversation:', {
          sender: (senderDbId as string)?.slice(-8),
          recipient: (recipientDbId as string)?.slice(-8),
          conversationId: (conversationId as string)?.slice(-8),
        });
      } else {
        // P1-009 FIX: Final defensive check - query by T/D source for this pair
        // This catches any conversation created between the participant check and now
        const recentTodConvos = await ctx.db
          .query('privateConversations')
          .withIndex('by_connection_source', (q) => q.eq('connectionSource', 'tod'))
          .filter((q) =>
            q.and(
              q.eq(q.field('participants'), participantIds)
            )
          )
          .first();

        if (recentTodConvos) {
          // Another T/D conversation was just created for this pair - reuse it
          conversationId = recentTodConvos._id;
          await ctx.db.patch(conversationId, { lastMessageAt: now });
          console.log('[CONVO_IDEMPOTENT] T/D found concurrent conversation:', {
            sender: (senderDbId as string)?.slice(-8),
            recipient: (recipientDbId as string)?.slice(-8),
            conversationId: (conversationId as string)?.slice(-8),
          });
        } else {
          // PHASE-2 FIX: Create new conversation in privateConversations table (NOT conversations)
          conversationId = await ctx.db.insert('privateConversations', {
            participants: participantIds,
            connectionSource: 'tod',
            createdAt: now,
            lastMessageAt: now,
          });

          // Create privateConversationParticipants for BOTH users
          await ctx.db.insert('privateConversationParticipants', {
            conversationId,
            userId: senderDbId as Id<'users'>,
            unreadCount: 1, // Sender will see the system message as unread
          });

          await ctx.db.insert('privateConversationParticipants', {
            conversationId,
            userId: recipientDbId as Id<'users'>,
            unreadCount: 0, // Recipient is accepting, they'll see it immediately
          });

          // RACE CONDITION PROTECTION: Post-hoc duplicate cleanup (matches privateSwipes.ts pattern)
          // Check for any duplicate conversations created for this pair during the gap
          const allPairConvos = await ctx.db
            .query('privateConversations')
            .filter((q) => q.eq(q.field('participants'), participantIds))
            .collect();

          if (allPairConvos.length > 1) {
            // Duplicates detected - keep the one with lowest _id (deterministic winner)
            allPairConvos.sort((a, b) => a._id.localeCompare(b._id));
            const winnerConvoId = allPairConvos[0]._id;

            if (conversationId !== winnerConvoId) {
              // Our conversation lost the race - delete it and its participants, use winner
              console.log('[T/D RACE] Lost race, cleaning up duplicate conversation:', {
                ours: (conversationId as string)?.slice(-8),
                winner: (winnerConvoId as string)?.slice(-8),
              });
              const ourParticipants = await ctx.db
                .query('privateConversationParticipants')
                .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
                .collect();
              for (const p of ourParticipants) {
                await ctx.db.delete(p._id);
              }
              await ctx.db.delete(conversationId);
              conversationId = winnerConvoId;
            } else {
              // We won the race - delete duplicate conversations and their participants
              console.log('[T/D RACE] Won race, cleaning up', allPairConvos.length - 1, 'duplicates');
              for (let i = 1; i < allPairConvos.length; i++) {
                const dupeConvo = allPairConvos[i];
                const dupeParticipants = await ctx.db
                  .query('privateConversationParticipants')
                  .withIndex('by_conversation', (q) => q.eq('conversationId', dupeConvo._id))
                  .collect();
                for (const p of dupeParticipants) {
                  await ctx.db.delete(p._id);
                }
                await ctx.db.delete(dupeConvo._id);
              }
            }
          } else {
            console.log('[T/D ACCEPT] Created new conversation:', (conversationId as string)?.slice(-8));
          }

          // Create initial system message in privateMessages table (only for winner)
          // Check if system message already exists to avoid duplicates
          const existingSystemMsg = await ctx.db
            .query('privateMessages')
            .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
            .filter((q) => q.eq(q.field('type'), 'system'))
            .first();

          if (!existingSystemMsg) {
            await ctx.db.insert('privateMessages', {
              conversationId,
              senderId: recipientDbId as Id<'users'>, // System message attributed to recipient
              type: 'system',
              content: 'T&D connection accepted! Say hi 👋',
              createdAt: now,
            });
          }
        }
      }

      // P0-008: Notify sender that their connect request was accepted
      // PHASE-2 ROUTING FIX: Use 'tod_connect' type so notification appears in Phase-2 bell only
      await ctx.db.insert('notifications', {
        userId: senderDbId as Id<'users'>,
        type: 'tod_connect',
        title: 'T/D Connect Accepted!',
        body: `${recipientDisplayName} accepted your connect request`,
        data: { conversationId: conversationId as string },
        dedupeKey: `tod_connect:${conversationId}`,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });

      return {
        success: true,
        action: 'connected' as const,
        conversationId: conversationId as string,
        // Sender profile (for recipient's display) - PHASE-2 IDENTITY: Use displayName
        senderUserId: request.fromUserId,
        senderDbId: senderDbId as string,
        senderName: senderDisplayName,
        // PHASE-2 ISOLATION: Use Phase-2 private photos ONLY, NO fallback to primaryPhotoUrl
        senderPhotoUrl: senderPrivateProfile?.privatePhotoUrls?.[0] ?? null,
        senderAge,
        senderGender: sender?.gender ?? null,
        // Recipient profile (for sender's display) - PHASE-2 IDENTITY: Use displayName
        recipientUserId: user.authUserId ?? userIdStr,
        recipientDbId: recipientDbId as string,
        recipientName: recipientDisplayName,
        // PHASE-2 ISOLATION: Use Phase-2 private photos ONLY, NO fallback to primaryPhotoUrl
        recipientPhotoUrl: recipientPrivateProfile?.privatePhotoUrls?.[0] ?? null,
        recipientAge,
        recipientGender: recipient?.gender ?? null,
      };
    } else {
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
    token: v.string(),
  },
  handler: async (ctx, { promptId, answerId, token }) => {
    const { userId, userIdStr } = await requireTodSession(ctx, token);

    // Get the answer to find the other user
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();
    if (!answer) return { status: 'none' as const };

    // CONNECT FIX: Resolve answer.userId to Convex ID to match storage format
    const answerAuthorDbId = await resolveStoredUserId(ctx, answer.userId);
    if (!answerAuthorDbId) return { status: 'none' as const };

    // Check for request from current user to answer author
    const requestSent = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', userId).eq('toUserId', answerAuthorDbId))
      .first();

    if (requestSent) {
      return { status: requestSent.status };
    }

    // Check for request from answer author to current user
    const requestReceived = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', answerAuthorDbId).eq('toUserId', userId))
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
      ownerUserId: 'system',
      answerCount: 42,
      activeCount: 18,
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS,
    });

    await ctx.db.insert('todPrompts', {
      type: 'dare',
      text: 'Record a 15-second video of your best impression of your celebrity crush!',
      isTrending: true,
      ownerUserId: 'system',
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

      for (const answer of answers) {
        // Delete media from storage if present
        if (answer.mediaStorageId) {
          await ctx.storage.delete(answer.mediaStorageId);
        }
        // Delete likes for this answer
        const likes = await ctx.db
          .query('todAnswerLikes')
          .withIndex('by_answer', (q) => q.eq('answerId', answer._id as string))
          .collect();
        for (const like of likes) {
          await ctx.db.delete(like._id);
        }
        // Delete connect requests for this answer
        const connects = await ctx.db
          .query('todConnectRequests')
          .filter((q) => q.eq(q.field('answerId'), answer._id as string))
          .collect();
        for (const cr of connects) {
          await ctx.db.delete(cr._id);
        }
        await ctx.db.delete(answer._id);
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
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireTodSession(ctx, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

// ============================================================
// PRIVATE MEDIA FUNCTIONS (One-time view photo/video responses)
// ============================================================

/**
 * Submit a private photo/video response to a prompt.
 * Only the prompt owner can ever view this media.
 * Replaces any existing pending media from the same user.
 */
export const submitPrivateMediaResponse = mutation({
  args: {
    promptId: v.string(),
    token: v.string(),
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
    const { user, userIdStr: fromUserId } = await requireTodSession(ctx, args.token);

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
 * P0-003 FIX: Resolve viewer identity server-side, not from client param
 */
export const getPrivateMediaForOwner = query({
  args: {
    promptId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { promptId, token }) => {
    const { user } = await requireTodSession(ctx, token);

    // Get the prompt to verify ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return [];

    // Only prompt owner can see private media
    if (!storedUserMatches(prompt.ownerUserId, user)) {
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
 * Sets status to 'viewing', starts timer, returns short-lived URL.
 * This is the ONLY way to get the media URL, and only works once.
 * P0-004 FIX: Resolve viewer identity server-side
 */
export const beginPrivateMediaView = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    token: v.string(),
  },
  handler: async (ctx, { privateMediaId, token }) => {
    const { userIdStr: viewerId, user } = await requireTodSession(ctx, token);

    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // AUTH CHECK: Only prompt owner (toUserId) can view
    if (!storedUserMatches(item.toUserId, user)) {
      throw new Error('Access denied: You are not the prompt owner');
    }

    // Only allow viewing if status is 'pending'
    if (item.status !== 'pending') {
      throw new Error('Media already viewed or expired');
    }

    // Ensure storageId exists
    if (!item.storageId) {
      throw new Error('Media file not found');
    }

    const now = Date.now();
    const expiresAt = now + item.durationSec * 1000;

    // Update status to viewing
    await ctx.db.patch(privateMediaId, {
      status: 'viewing',
      viewedAt: now,
      expiresAt,
    });

    // Generate short-lived URL (Convex URLs expire automatically)
    const url = await ctx.storage.getUrl(item.storageId);
    if (!url) {
      throw new Error('Failed to generate media URL');
    }

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
 * Deletes the storage file and marks as expired/deleted.
 * P0-004 FIX: Resolve viewer identity server-side
 */
export const finalizePrivateMediaView = mutation({
  args: {
    privateMediaId: v.id('todPrivateMedia'),
    token: v.string(),
  },
  handler: async (ctx, { privateMediaId, token }) => {
    const { userIdStr: viewerId, user } = await requireTodSession(ctx, token);

    const item = await ctx.db.get(privateMediaId);
    if (!item) return { success: false };

    // AUTH CHECK: Only prompt owner can finalize
    if (!storedUserMatches(item.toUserId, user)) {
      throw new Error('Access denied');
    }

    // Delete storage file if exists
    if (item.storageId) {
      try {
        await ctx.storage.delete(item.storageId);
      } catch {
        // Storage may already be deleted
      }
    }

    // Mark as deleted
    await ctx.db.patch(privateMediaId, {
      status: 'deleted',
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
    token: v.string(),
  },
  handler: async (ctx, { privateMediaId, token }) => {
    const { user, userIdStr: fromUserId } = await requireTodSession(ctx, token);
    const item = await ctx.db.get(privateMediaId);
    if (!item) {
      throw new Error('Private media not found');
    }

    // Only prompt owner can send connect
    if (!storedUserMatches(item.toUserId, user)) {
      throw new Error('Access denied');
    }

    // Can only connect if not already connected/pending
    if (item.connectStatus !== 'none') {
      return { success: false, reason: 'Already processed' };
    }

    // CONNECT FIX: Resolve user IDs to Convex IDs for consistent storage format
    const senderDbId = await resolveStoredUserId(ctx, fromUserId);
    const recipientDbId = await resolveStoredUserId(ctx, item.fromUserId);
    if (!senderDbId || !recipientDbId) {
      throw new Error('User not found');
    }

    // Update connect status
    await ctx.db.patch(privateMediaId, {
      connectStatus: 'pending',
    });

    // Create a connect request in todConnectRequests
    await ctx.db.insert('todConnectRequests', {
      promptId: item.promptId,
      answerId: item._id as string, // using privateMediaId as reference
      fromUserId: senderDbId, // prompt owner (Convex ID)
      toUserId: recipientDbId, // responder (Convex ID)
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
    token: v.string(),
  },
  handler: async (ctx, { privateMediaId, token }) => {
    const { user } = await requireTodSession(ctx, token);
    const item = await ctx.db.get(privateMediaId);
    if (!item) return { success: false };

    // Only prompt owner can reject
    if (!storedUserMatches(item.toUserId, user)) {
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
        // Delete storage first
        if (pm.storageId) {
          try {
            await ctx.storage.delete(pm.storageId);
          } catch { /* already deleted */ }
        }
        // Delete record
        await ctx.db.delete(pm._id);
        deletedPrivateMedia++;
      }

      // 2) Get all answers for this prompt
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q) => q.eq('promptId', promptIdStr))
        .collect();

      for (const answer of answers) {
        // 2a) Delete all likes for this answer
        const likes = await ctx.db
          .query('todAnswerLikes')
          .withIndex('by_answer', (q) => q.eq('answerId', answer._id as string))
          .collect();
        for (const like of likes) {
          await ctx.db.delete(like._id);
          deletedLikes++;
        }

        // 2b) Delete media from storage if present
        if (answer.mediaStorageId) {
          try {
            await ctx.storage.delete(answer.mediaStorageId);
          } catch { /* already deleted */ }
        }

        // 2c) Delete the answer record
        await ctx.db.delete(answer._id);
        deletedAnswers++;
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
        if (pm.storageId) {
          try {
            await ctx.storage.delete(pm.storageId);
          } catch { /* already deleted */ }
        }
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

// P2-004: Safe limits to prevent excessive data loading
const FEED_PROMPTS_LIMIT = 50; // Max prompts to return in feed
const THREAD_ANSWERS_LIMIT = 100; // Max answers to load per thread

function sortAnswersByEngagement(a: any, b: any) {
  const aReactions = a.totalReactionCount ?? 0;
  const bReactions = b.totalReactionCount ?? 0;
  if (bReactions !== aReactions) return bReactions - aReactions;
  return b.createdAt - a.createdAt;
}

function isAnswerVisibleToViewer(
  answer: any,
  viewer: { user: any; userIdStr: string },
  blockedUserIds: Set<string>
): boolean {
  if (storedUserMatches(answer.userId, viewer.user)) return true;
  if (blockedUserIds.has(answer.userId)) return false;

  const hiddenForUserIds = (answer.hiddenForUserIds as string[] | undefined) ?? [];
  if (viewer.userIdStr && hiddenForUserIds.includes(viewer.userIdStr)) return false;
  if (answer.isGloballyHidden) return false;

  return (answer.reportCount ?? 0) < REPORT_HIDE_THRESHOLD;
}

async function getAnswersByPromptIds(
  ctx: any,
  promptIds: string[]
): Promise<Record<string, any[]>> {
  const answerEntries = await Promise.all(
    promptIds.map(async (promptId) => {
      const answers = await ctx.db
        .query('todAnswers')
        .withIndex('by_prompt', (q: any) => q.eq('promptId', promptId))
        .collect();
      return [promptId, answers] as const;
    })
  );

  return Object.fromEntries(answerEntries);
}

function buildPromptAnswerMetrics(
  answersByPrompt: Record<string, any[]>,
  viewer: { user: any; userIdStr: string },
  blockedUserIds: Set<string>
) {
  const visibleAnswersByPrompt: Record<string, any[]> = {};
  const visibleAnswerCounts: Record<string, number> = {};
  const visibleReactionCounts: Record<string, number> = {};

  for (const [promptId, answers] of Object.entries(answersByPrompt)) {
    const visibleAnswers = answers
      .filter((answer) => isAnswerVisibleToViewer(answer, viewer, blockedUserIds))
      .sort(sortAnswersByEngagement);

    visibleAnswersByPrompt[promptId] = visibleAnswers;
    visibleAnswerCounts[promptId] = visibleAnswers.length;
    visibleReactionCounts[promptId] = visibleAnswers.reduce(
      (sum, answer) => sum + (answer.totalReactionCount ?? 0),
      0
    );
  }

  return { visibleAnswersByPrompt, visibleAnswerCounts, visibleReactionCounts };
}

/**
 * List all active (non-expired) prompts with their top 2 answers.
 * Ranking: totalReactionCount DESC, then createdAt DESC.
 * Respects hidden-by-reports logic for non-authors.
 * P2-004: Limited to FEED_PROMPTS_LIMIT prompts for performance.
 */
export const listActivePromptsWithTop2Answers = query({
  args: {
    token: v.string(),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { token }) => {
    const now = Date.now();
    const viewer = await requireTodSession(ctx, token);
    const isViewerPromptOwner = (ownerUserId: string) => storedUserMatches(ownerUserId, viewer.user);

    // TOD-P2-002 FIX: Get blocked user IDs for viewer (both directions)
    const blockedUserIds = await getBlockedUserRefSet(ctx, viewer.userId);

    // Get all prompts
    const allPrompts = await ctx.db.query('todPrompts').collect();

    // Filter to active (not expired) and not from blocked users
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires <= now) return false;
      // TOD-P2-002 FIX: Filter out prompts from blocked users
      if (blockedUserIds.has(p.ownerUserId as string)) return false;
      // P0-002: Filter out hidden prompts (unless viewer is owner)
      if (p.isHidden && !isViewerPromptOwner(p.ownerUserId)) return false;
      return true;
    });

    const promptIds = activePrompts.map((prompt) => prompt._id as unknown as string);
    const answersByPrompt = await getAnswersByPromptIds(ctx, promptIds);
    const { visibleAnswersByPrompt, visibleAnswerCounts, visibleReactionCounts } =
      buildPromptAnswerMetrics(answersByPrompt, viewer, blockedUserIds);

    // CONFESS-STYLE RANKING: engagement score using exact Confess weights
    // Confess formula (confessions.ts:125-126): replyCount * 6 + reactionCount * 2
    // Applied here using visible answers only: visibleAnswerCount * 6 + visibleReactionCount * 2
    // New posts (0 engagement) = score 0, appear at BOTTOM
    // Tie-breaker: createdAt ASC (older first, newer posts go to bottom)
    activePrompts.sort((a, b) => {
      const promptIdA = a._id as unknown as string;
      const promptIdB = b._id as unknown as string;
      // Exact Confess weights: comments * 6, reactions * 2
      const scoreA = ((visibleAnswerCounts[promptIdA] ?? 0) * 6) + ((visibleReactionCounts[promptIdA] ?? 0) * 2);
      const scoreB = ((visibleAnswerCounts[promptIdB] ?? 0) * 6) + ((visibleReactionCounts[promptIdB] ?? 0) * 2);

      // Primary: score DESC (higher engagement = higher position)
      if (scoreB !== scoreA) return scoreB - scoreA;
      // Tie-breaker: createdAt ASC (older first, new prompts go to bottom)
      return a.createdAt - b.createdAt;
    });

    const rankedPrompts = activePrompts.slice(0, FEED_PROMPTS_LIMIT);

    // For each prompt, get top 2 visible answers
    const promptsWithAnswers = await Promise.all(
      rankedPrompts.map(async (prompt) => {
        const promptId = prompt._id as unknown as string;
        const answers = answersByPrompt[promptId] ?? [];
        const visibleAnswers = visibleAnswersByPrompt[promptId] ?? [];
        const top2WithPreviews = visibleAnswers.slice(0, 2).map((answer) => ({
          _id: answer._id,
          promptId: answer.promptId,
          userId: answer.userId,
          type: answer.type,
          text: answer.text,
          mediaUrl: answer.mediaUrl,
          createdAt: answer.createdAt,
          editedAt: answer.editedAt,
          isAnonymous: answer.isAnonymous,
          visibility: answer.visibility,
          authorName: answer.authorName,
        }));

        // Check if viewer has answered this prompt
        const myAnswer = answers.find((answer) => storedUserMatches(answer.userId, viewer.user));
        const hasAnswered = !!myAnswer;
        const myAnswerId = myAnswer ? (myAnswer._id as unknown as string) : null;

        const promptIdStr = prompt._id as unknown as string;
        return {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          activeCount: prompt.activeCount,
          createdAt: prompt.createdAt,
          expiresAt: prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS,
          // Owner profile fields for feed display
          isAnonymous: prompt.isAnonymous,
          ownerName: prompt.ownerName,
          ownerPhotoUrl: prompt.ownerPhotoUrl,
          ownerAge: prompt.ownerAge,
          ownerGender: prompt.ownerGender,
          // Engagement metrics
          answerCount: visibleAnswerCounts[promptIdStr] ?? 0,
          totalReactionCount: visibleReactionCounts[promptIdStr] ?? 0,
          // Answers and viewer state
          top2Answers: top2WithPreviews,
          totalAnswers: visibleAnswerCounts[promptIdStr] ?? 0,
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
 * P1-006 FIX: Added block filtering to exclude blocked users
 */
export const getTrendingTruthAndDare = query({
  args: {
    token: v.string(),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { token }) => {
    const now = Date.now();
    const viewer = await requireTodSession(ctx, token);
    const isViewerPromptOwner = (ownerUserId: string) => storedUserMatches(ownerUserId, viewer.user);

    // P1-006 FIX: Resolve viewer ID and get blocked user IDs
    const blockedUserIds = await getBlockedUserRefSet(ctx, viewer.userId);

    // Get all prompts
    const allPrompts = await ctx.db.query('todPrompts').collect();

    // Filter to active (not expired) and not from blocked users
    const activePrompts = allPrompts.filter((p) => {
      const expires = p.expiresAt ?? p.createdAt + TWENTY_FOUR_HOURS_MS;
      if (expires <= now) return false;
      // P1-006 FIX: Exclude prompts from blocked users
      if (blockedUserIds.has(p.ownerUserId)) return false;
      if (p.isHidden && !isViewerPromptOwner(p.ownerUserId)) return false;
      return true;
    });

    const promptIds = activePrompts.map((prompt) => prompt._id as unknown as string);
    const answersByPrompt = await getAnswersByPromptIds(ctx, promptIds);
    const { visibleAnswerCounts, visibleReactionCounts } =
      buildPromptAnswerMetrics(answersByPrompt, viewer, blockedUserIds);

    // Separate by type
    const darePrompts = activePrompts.filter((p) => p.type === 'dare');
    const truthPrompts = activePrompts.filter((p) => p.type === 'truth');

    // Sort each by visible answer count DESC, then visible reaction count DESC, then createdAt DESC
    const sortByEngagement = (a: typeof activePrompts[0], b: typeof activePrompts[0]) => {
      const promptIdA = a._id as unknown as string;
      const promptIdB = b._id as unknown as string;
      const answerCountA = visibleAnswerCounts[promptIdA] ?? 0;
      const answerCountB = visibleAnswerCounts[promptIdB] ?? 0;
      if (answerCountB !== answerCountA) return answerCountB - answerCountA;

      const reactionCountA = visibleReactionCounts[promptIdA] ?? 0;
      const reactionCountB = visibleReactionCounts[promptIdB] ?? 0;
      if (reactionCountB !== reactionCountA) return reactionCountB - reactionCountA;

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
        ownerUserId: prompt.ownerUserId,
        answerCount: visibleAnswerCounts[promptId] ?? 0,
        totalAnswers: visibleAnswerCounts[promptId] ?? 0,
        activeCount: prompt.activeCount,
        createdAt: prompt.createdAt,
        expiresAt: prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS,
        // Owner profile fields
        isAnonymous: prompt.isAnonymous,
        ownerName: prompt.ownerName,
        ownerPhotoUrl: prompt.ownerPhotoUrl,
        ownerAge: prompt.ownerAge,
        ownerGender: prompt.ownerGender,
        // Engagement metrics
        totalReactionCount: visibleReactionCounts[promptId] ?? 0,
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
 * P2-004: Limited to THREAD_ANSWERS_LIMIT answers for performance.
 */
export const getPromptThread = query({
  args: {
    promptId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { promptId, token }) => {
    const viewer = await requireTodSession(ctx, token);
    const viewerUserId = viewer.userIdStr;
    const blockedUserIds = await getBlockedUserRefSet(ctx, viewer.userId);

    // Get prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) return null;

    // CONNECT FIX: Resolve viewerUserId to Convex ID for proper comparison
    // prompt.ownerUserId is stored as Convex ID, viewerUserId is authUserId format
    // Check if viewer is the prompt owner (using Convex IDs for both)
    const isViewerPromptOwner = storedUserMatches(prompt.ownerUserId, viewer.user);

    if (!isViewerPromptOwner && blockedUserIds.has(prompt.ownerUserId)) {
      return {
        prompt: null,
        answers: [],
        isExpired: false,
        isBlocked: true,
        isViewerPromptOwner: false,
      };
    }

    // P0-002: Check if prompt is hidden (unless viewer is owner)
    if (prompt.isHidden && !isViewerPromptOwner) {
      return {
        prompt: null,
        answers: [],
        isExpired: false,
        isHidden: true, // P0-002: Indicates prompt was hidden due to reports
        isViewerPromptOwner: false,
      };
    }

    // Get all answers
    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    // Filter hidden answers (except for author)
    // P1-002: Also check per-user hiding (hiddenForUserIds) and global hide (isGloballyHidden)
    const visibleAnswers = answers
      .filter((answer) => isAnswerVisibleToViewer(answer, viewer, blockedUserIds))
      .sort(sortAnswersByEngagement);
    const visibleAnswerCount = visibleAnswers.length;
    const visibleReactionCount = visibleAnswers.reduce(
      (sum, answer) => sum + (answer.totalReactionCount ?? 0),
      0
    );

    // Check if expired after we compute visible counts so the thread count stays truthful.
    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      return {
        prompt: {
          _id: prompt._id,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          answerCount: visibleAnswerCount,
          visibleAnswerCount,
          createdAt: prompt.createdAt,
          expiresAt: expires,
          // Owner profile snapshot
          isAnonymous: prompt.isAnonymous,
          ownerName: prompt.ownerName,
          ownerPhotoUrl: prompt.ownerPhotoUrl,
          ownerAge: prompt.ownerAge,
          ownerGender: prompt.ownerGender,
        },
        answers: [],
        isExpired: true,
        isViewerPromptOwner,
      };
    }

    // P2-004: Apply limit to prevent loading too many answers
    const limitedAnswers = visibleAnswers.slice(0, THREAD_ANSWERS_LIMIT);

    // Enrich with reactions
    const enrichedAnswers = await Promise.all(
      limitedAnswers.map(async (answer) => {
        const answerId = answer._id as unknown as string;

        const reactions = await ctx.db
          .query('todAnswerReactions')
          .withIndex('by_answer', (q) => q.eq('answerId', answerId))
          .collect();

        // Group by emoji - use array format for Convex compatibility (no emoji keys)
        const emojiCountMap: Map<string, number> = new Map();
        for (const r of reactions) {
          emojiCountMap.set(r.emoji, (emojiCountMap.get(r.emoji) || 0) + 1);
        }
        const reactionCounts = Array.from(emojiCountMap.entries()).map(
          ([emoji, count]) => ({ emoji, count })
        );

        // Get viewer's reaction
        const myReaction = reactions.find((r) => storedUserMatches(r.userId, viewer.user))?.emoji ?? null;

        // Check if viewer reported this
        const report = await ctx.db
          .query('todAnswerReports')
          .withIndex('by_answer_reporter', (q) =>
            q.eq('answerId', answerId).eq('reporterId', viewerUserId)
          )
          .first();
        const hasReported = !!report;

        // Check if viewer has viewed this media (one-time view tracking)
        let hasViewedMedia = false;
        if (!storedUserMatches(answer.userId, viewer.user) && answer.mediaUrl) {
          const viewRecord = await ctx.db
            .query('todAnswerViews')
            .withIndex('by_answer_viewer', (q) =>
              q.eq('answerId', answerId).eq('viewerUserId', viewerUserId)
            )
            .first();
          hasViewedMedia = viewRecord?.viewedAt !== undefined;
        }

        // Check if viewer (as prompt owner) has sent a connect request for this answer
        // CONNECT FIX: Resolve both viewer and answer author to Convex IDs to match storage format
        // P0-FIX: Also return connectStatus ('pending'/'connected') for UI differentiation
        // RESTORED: hasSentConnect true for both 'pending' and 'connected' to prevent reconnect
        let hasSentConnect = false;
        let connectStatus: 'none' | 'pending' | 'connected' = 'none';
        if (!storedUserMatches(answer.userId, viewer.user)) {
          const viewerDbId = viewer.userId;
          const answerAuthorDbId = await resolveStoredUserId(ctx, answer.userId);
          if (answerAuthorDbId) {
            const connectReq = await ctx.db
              .query('todConnectRequests')
              .withIndex('by_from_to', (q) =>
                q.eq('fromUserId', viewerDbId).eq('toUserId', answerAuthorDbId)
              )
              .filter((q) =>
                q.or(
                  q.eq(q.field('status'), 'pending'),
                  q.eq(q.field('status'), 'connected')
                )
              )
              .first();
            hasSentConnect = !!connectReq;
            connectStatus = connectReq?.status === 'connected' ? 'connected' : connectReq?.status === 'pending' ? 'pending' : 'none';
          }
        }

        // P0-004 FIX: Server-side access control for private media
        // Do NOT expose mediaUrl to unauthorized viewers
        // Authorized viewers: answer author, prompt owner (for owner_only), everyone (for public)
        const isAnswerAuthor = storedUserMatches(answer.userId, viewer.user);
        const isPromptOwnerViewer = isViewerPromptOwner;
        const isOwnerOnlyMedia = answer.visibility === 'owner_only';

        // Determine if viewer is authorized to receive the media URL
        let authorizedForMediaUrl = false;
        if (isAnswerAuthor) {
          // Answer author can always see their own media
          authorizedForMediaUrl = true;
        } else if (isOwnerOnlyMedia) {
          // Owner-only media: only prompt owner can access
          authorizedForMediaUrl = isPromptOwnerViewer;
        } else {
          // Public media: everyone can access (will go through claim flow)
          authorizedForMediaUrl = true;
        }

        // P0-004 FIX: Only return mediaUrl if authorized, otherwise return null
        // Keep hasMedia flag so UI can show "media exists" placeholder
        const safeMediaUrl = authorizedForMediaUrl ? answer.mediaUrl : null;
        const safeMediaStorageId = authorizedForMediaUrl ? answer.mediaStorageId : null;

        // MEDIA ALWAYS EDITABLE: No lock based on views - sender can edit until expiry
        // View tracking kept for analytics but does NOT affect edit ability

        return {
          _id: answer._id,
          promptId: answer.promptId,
          userId: answer.userId,
          type: answer.type,
          text: answer.text,
          mediaUrl: safeMediaUrl,
          mediaStorageId: safeMediaStorageId,
          // P0-004 FIX: Flag indicating media exists (for UI placeholder) even if URL hidden
          hasMedia: !!answer.mediaStorageId,
          durationSec: answer.durationSec,
          createdAt: answer.createdAt,
          editedAt: answer.editedAt,
          totalReactionCount: answer.totalReactionCount ?? 0,
          reactionCounts,
          myReaction,
          isAnonymous: answer.isAnonymous,
          visibility: answer.visibility,
          viewMode: answer.viewMode,
          viewDurationSec: answer.viewDurationSec,
          isHiddenForOthers: (answer.reportCount ?? 0) >= REPORT_HIDE_THRESHOLD,
          isOwnAnswer: storedUserMatches(answer.userId, viewer.user),
          hasReported,
          hasViewedMedia,
          hasSentConnect,
          connectStatus, // P0-FIX: 'none' | 'pending' | 'connected' for UI differentiation
          // Author identity snapshot
          authorName: answer.authorName,
          authorPhotoUrl: answer.authorPhotoUrl,
          authorAge: answer.authorAge,
          authorGender: answer.authorGender,
          photoBlurMode: answer.photoBlurMode,
          identityMode: answer.identityMode,
          isFrontCamera: answer.isFrontCamera ?? false,
          // MEDIA ALWAYS EDITABLE: No lock - sender can update until expiry
          isVisualMediaConsumed: false,
        };
      })
    );

    // Get prompt reactions
    const promptReactions = await ctx.db
      .query('todPromptReactions')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    // Group prompt reactions by emoji
    const promptEmojiCountMap: Map<string, number> = new Map();
    for (const r of promptReactions) {
      promptEmojiCountMap.set(r.emoji, (promptEmojiCountMap.get(r.emoji) || 0) + 1);
    }
    const promptReactionCounts = Array.from(promptEmojiCountMap.entries()).map(
      ([emoji, count]) => ({ emoji, count })
    );

    // Get viewer's reaction on prompt
    const promptMyReaction = promptReactions.find((r) => storedUserMatches(r.userId, viewer.user))?.emoji ?? null;

    return {
      prompt: {
        _id: prompt._id,
        type: prompt.type,
        text: prompt.text,
        isTrending: prompt.isTrending,
        ownerUserId: prompt.ownerUserId,
        answerCount: visibleAnswerCount,
        visibleAnswerCount,
        createdAt: prompt.createdAt,
        expiresAt: expires,
        // Owner profile snapshot
        isAnonymous: prompt.isAnonymous,
        ownerName: prompt.ownerName,
        ownerPhotoUrl: prompt.ownerPhotoUrl,
        ownerAge: prompt.ownerAge,
        ownerGender: prompt.ownerGender,
        // Prompt reactions
        totalReactionCount: visibleReactionCount,
        reactionCounts: promptReactionCounts,
        myReaction: promptMyReaction,
      },
      answers: enrichedAnswers,
      isExpired: false,
      isViewerPromptOwner,
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
  actionType: 'answer' | 'reaction' | 'report' | 'claim_media' | 'prompt' | 'connect' // P0-003: Added 'prompt', P0-004: Added 'connect'
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
    token: v.string(),
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
    const { user, userId, userIdStr } = await requireTodSession(ctx, args.token);

    // Validate prompt exists and not expired
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), args.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    if (prompt.isHidden && !storedUserMatches(prompt.ownerUserId, user)) {
      throw new Error('Prompt is no longer available');
    }

    // SELF-COMMENT RESTRICTION: Owner cannot answer their own prompt
    if (storedUserMatches(prompt.ownerUserId, user)) {
      throw new Error('You cannot answer your own prompt.');
    }

    await assertNotBlockedWithStoredUser(
      ctx,
      userId,
      prompt.ownerUserId,
      'Cannot interact with this user'
    );

    const now = Date.now();
    const expires = prompt.expiresAt ?? prompt.createdAt + TWENTY_FOUR_HOURS_MS;
    if (expires <= now) {
      throw new Error('Prompt has expired');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'answer');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment before posting again.');
    }

    // Check for existing answer
    const existing = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', args.promptId).eq('userId', userIdStr)
      )
      .first();

    // Generate media URL if storage ID provided
    let mediaUrl: string | undefined;
    if (args.mediaStorageId) {
      mediaUrl = await ctx.storage.getUrl(args.mediaStorageId) ?? undefined;
    }

    let authorPhotoUrl = isRemoteUrl(args.authorPhotoUrl) ? args.authorPhotoUrl : undefined;
    if (args.authorPhotoStorageId) {
      authorPhotoUrl = await ctx.storage.getUrl(args.authorPhotoStorageId) ?? undefined;
    } else if (args.authorPhotoUrl && !authorPhotoUrl) {
      throw new Error('Only persisted profile photos can be attached to answers');
    }

    if (existing) {
      // EDIT existing answer - MERGE updates
      // Build patch object with only changed fields
      const patch: Record<string, any> = { editedAt: now };

      // MEDIA ALWAYS EDITABLE: No lock based on views
      // Sender can replace/remove media anytime until prompt expires

      console.log(`[T/D] EDIT existing answer`, {
        existingText: existing.text,
        argsText: args.text,
        argsMediaStorageId: !!args.mediaStorageId,
        removeMedia: args.removeMedia,
      });

      // Text: update if provided, otherwise keep existing
      if (args.text !== undefined) {
        patch.text = args.text.trim() || undefined;
        console.log(`[T/D] text updated to: ${patch.text}`);
      } else {
        console.log(`[T/D] text preserved: ${existing.text}`);
      }

      // Media: handle remove, replace, or keep
      if (args.removeMedia) {
        // Remove media only
        if (existing.mediaStorageId) {
          try {
            await ctx.storage.delete(existing.mediaStorageId);
          } catch { /* already deleted */ }
        }
        patch.mediaStorageId = undefined;
        patch.mediaUrl = undefined;
        patch.mediaMime = undefined;
        patch.durationSec = undefined;
        patch.isFrontCamera = undefined;
        // ONE-TIME VIEW RESET: Clear all view records when media is removed
        const existingViews = await ctx.db
          .query('todAnswerViews')
          .withIndex('by_answer', (q) => q.eq('answerId', existing._id as any))
          .collect();
        for (const view of existingViews) {
          await ctx.db.delete(view._id);
        }
        console.log(`[T/D] media removed from answer, cleared ${existingViews.length} view records`);
      } else if (args.mediaStorageId) {
        // Replace media
        if (existing.mediaStorageId && existing.mediaStorageId !== args.mediaStorageId) {
          try {
            await ctx.storage.delete(existing.mediaStorageId);
          } catch { /* already deleted */ }
          // ONE-TIME VIEW RESET: Clear all view records when media is replaced
          const existingViews = await ctx.db
            .query('todAnswerViews')
            .withIndex('by_answer', (q) => q.eq('answerId', existing._id as any))
            .collect();
          for (const view of existingViews) {
            await ctx.db.delete(view._id);
          }
          console.log(`[T/D] media replaced, cleared ${existingViews.length} view records`);
        }
        patch.mediaStorageId = args.mediaStorageId;
        patch.mediaUrl = mediaUrl;
        patch.mediaMime = args.mediaMime;
        patch.durationSec = args.durationSec;
        patch.isFrontCamera = args.isFrontCamera;
        console.log(`[T/D] media replaced, storageId=${args.mediaStorageId}`);
      }
      // else: keep existing media unchanged

      // Determine type based on final content
      const finalText = patch.text !== undefined ? patch.text : existing.text;
      const finalMedia = patch.mediaStorageId !== undefined ? patch.mediaStorageId : existing.mediaStorageId;
      const finalMime = patch.mediaMime !== undefined ? patch.mediaMime : existing.mediaMime;

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
      // Only update author snapshot if explicitly provided
      if (args.authorName !== undefined) patch.authorName = args.authorName;
      if (args.authorPhotoUrl !== undefined || args.authorPhotoStorageId !== undefined) {
        patch.authorPhotoUrl = authorPhotoUrl;
      }
      if (args.authorAge !== undefined) patch.authorAge = args.authorAge;
      if (args.authorGender !== undefined) patch.authorGender = args.authorGender;

      // View mode for media
      if (finalMedia) {
        patch.viewMode = args.viewMode ?? existing.viewMode ?? 'tap';
      }

      console.log(`[T/D] identityMode reused=${existing.identityMode ?? 'anonymous'}`);

      await ctx.db.patch(existing._id, patch);

      // Record Phase-2 activity for ranking freshness (throttled to 1 update/hour)
      await ctx.runMutation(internal.phase2Ranking.recordPhase2Activity, {});

      return { answerId: existing._id, isEdit: true };
    } else {
      // CREATE new answer
      // Require at least text or media
      const hasText = args.text && args.text.trim().length > 0;
      const hasMedia = !!args.mediaStorageId;

      if (!hasText && !hasMedia) {
        throw new Error('Answer requires text or media');
      }

      // Determine identity mode (default to anonymous)
      const identityMode = args.identityMode ?? 'anonymous';
      const isAnon = identityMode === 'anonymous';
      const isNoPhoto = identityMode === 'no_photo';

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
        userId: userIdStr,
        type,
        text: hasText ? args.text!.trim() : undefined,
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
        viewDurationSec: args.viewDurationSec,
        totalReactionCount: 0,
        reportCount: 0,
        hiddenForUserIds: [],
        isGloballyHidden: false,
        // Author identity snapshot (cleared for anonymous, photo cleared for no_photo)
        authorName: isAnon ? undefined : args.authorName,
        authorPhotoUrl: isAnon || isNoPhoto ? undefined : authorPhotoUrl,
        authorAge: isAnon ? undefined : args.authorAge,
        authorGender: isAnon ? undefined : args.authorGender,
        photoBlurMode: isNoPhoto ? 'blur' : 'none',
        isFrontCamera: args.isFrontCamera,
      });

      // Increment answer count on prompt
      await ctx.db.patch(prompt._id, {
        answerCount: prompt.answerCount + 1,
        activeCount: prompt.activeCount + 1,
      });

      // Record Phase-2 activity for ranking freshness (throttled to 1 update/hour)
      await ctx.runMutation(internal.phase2Ranking.recordPhase2Activity, {});

      console.log(`[T/D] answer created, identityMode=${identityMode}`);
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
    token: v.string(),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { answerId, token, emoji }) => {
    const { user, userId, userIdStr } = await requireTodSession(ctx, token);

    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    await assertNotBlockedWithStoredUser(ctx, userId, answer.userId, 'Cannot interact with this user');

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    const now = Date.now();

    // Check for existing reaction
    const existing = await ctx.db
      .query('todAnswerReactions')
      .withIndex('by_answer_user', (q) =>
        q.eq('answerId', answerId).eq('userId', userIdStr)
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
        userId: userIdStr,
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
 * Set (upsert) an emoji reaction on a prompt.
 * One reaction per user per prompt. Changing updates counts.
 */
export const setPromptReaction = mutation({
  args: {
    promptId: v.string(),
    token: v.string(),
    emoji: v.string(), // pass empty string to remove reaction
  },
  handler: async (ctx, { promptId, token, emoji }) => {
    const { userId, userIdStr } = await requireTodSession(ctx, token);

    // Validate prompt exists
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    await assertNotBlockedWithStoredUser(ctx, userId, prompt.ownerUserId, 'Cannot interact with this user');

    // Check rate limit
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'reaction');
    if (!rateCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait a moment.');
    }

    const now = Date.now();

    // Check for existing reaction
    const existing = await ctx.db
      .query('todPromptReactions')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', userIdStr)
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
        userId: userIdStr,
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
 * Report an answer.
 * Rate limited per day. Same user can't report same answer twice.
 * If answer reaches 5 unique reports, it's hidden from everyone except author.
 */
export const reportAnswer = mutation({
  args: {
    answerId: v.string(),
    token: v.string(),
    // Structured report reason (required)
    // P0-002 FIX: Added 'privacy' and 'scam' to match reportPrompt and UI options
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
  handler: async (ctx, { answerId, token, reasonCode, reasonText, reason }) => {
    const { userId, userIdStr } = await requireTodSession(ctx, token);

    // Validate answer exists
    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    await assertNotBlockedWithStoredUser(ctx, userId, answer.userId, 'Cannot interact with this user');

    // Can't report own answer
    if (storedUserMatches(answer.userId, { _id: userId })) {
      throw new Error("You can't report your own answer");
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('todAnswerReports')
      .withIndex('by_answer_reporter', (q) =>
        q.eq('answerId', answerId).eq('reporterId', userIdStr)
      )
      .first();

    if (existingReport) {
      throw new Error('You have already reported this answer');
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    // Create report with structured reason
    await ctx.db.insert('todAnswerReports', {
      answerId,
      reporterId: userIdStr,
      reasonCode,
      reasonText,
      reason, // Legacy field for backwards compatibility
      createdAt: Date.now(),
    });

    // Increment report count
    const newReportCount = (answer.reportCount ?? 0) + 1;

    // P1-002: Add reporter to hiddenForUserIds for immediate per-user hiding
    const currentHiddenFor = (answer.hiddenForUserIds as string[] | undefined) ?? [];
    const updatedHiddenFor = currentHiddenFor.includes(userIdStr)
      ? currentHiddenFor
      : [...currentHiddenFor, userIdStr];

    // Check if global threshold reached (3+ reports = hidden for everyone)
    const isNowGloballyHidden = newReportCount >= REPORT_HIDE_THRESHOLD;

    // Update answer with new report count and hiddenForUserIds
    await ctx.db.patch(answer._id, {
      reportCount: newReportCount,
      hiddenForUserIds: updatedHiddenFor,
      // P1-002: Set isGloballyHidden flag when threshold reached
      ...(isNowGloballyHidden ? { isGloballyHidden: true } : {}),
    });

    console.log(`[T/D] reportAnswer success: answerId=${answerId}, reporterId=${userIdStr}, reportCount=${newReportCount}, isNowGloballyHidden=${isNowGloballyHidden}`);

    return {
      success: true,
      reportCount: newReportCount,
      isNowHidden: isNowGloballyHidden,
      // P1-002: Content is immediately hidden for the reporter
      hiddenForReporter: true,
    };
  },
});

/**
 * P0-002: Report a prompt
 * Rate limited per day. Same user can't report same prompt twice.
 * If prompt reaches 3 unique reports, it's hidden from everyone except owner.
 * P1-002 FIX: Added demo mode support and reporterId arg for compatibility.
 */
export const reportPrompt = mutation({
  args: {
    promptId: v.string(),
    token: v.string(),
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
  handler: async (ctx, { promptId, token, reasonCode, reasonText }) => {
    const { userId, userIdStr } = await requireTodSession(ctx, token);

    // Get the prompt
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    await assertNotBlockedWithStoredUser(ctx, userId, prompt.ownerUserId, 'Cannot interact with this user');

    // Can't report own prompt
    if (storedUserMatches(prompt.ownerUserId, { _id: userId })) {
      throw new Error('Cannot report your own prompt');
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt_reporter', (q) =>
        q.eq('promptId', promptId).eq('reporterId', userIdStr)
      )
      .first();

    if (existingReport) {
      throw new Error('You have already reported this prompt');
    }

    // Check rate limit (daily)
    const rateCheck = await checkRateLimit(ctx, userIdStr, 'report');
    if (!rateCheck.allowed) {
      throw new Error('You have reached your daily report limit');
    }

    // Create report
    await ctx.db.insert('todPromptReports', {
      promptId,
      reporterId: userIdStr,
      reasonCode,
      reasonText,
      createdAt: Date.now(),
    });

    // Count total reports for this prompt
    const allReports = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    const reportCount = allReports.length;

    // Check if threshold reached - mark prompt as hidden
    const isNowHidden = reportCount >= REPORT_HIDE_THRESHOLD;
    if (isNowHidden && !prompt.isHidden) {
      await ctx.db.patch(prompt._id, { isHidden: true });
    }

    return {
      success: true,
      reportCount,
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
    token: v.string(),
  },
  handler: async (ctx, { promptId, token }) => {
    const { userIdStr: userId } = await requireTodSession(ctx, token);
    const answer = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt_user', (q) =>
        q.eq('promptId', promptId).eq('userId', userId)
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
    token: v.string(),
  },
  handler: async (ctx, { answerId, token }) => {
    const { user } = await requireTodSession(ctx, token);

    const answer = await ctx.db
      .query('todAnswers')
      .filter((q) => q.eq(q.field('_id'), answerId as Id<'todAnswers'>))
      .first();

    if (!answer) {
      throw new Error('Answer not found');
    }

    if (!storedUserMatches(answer.userId, user)) {
      throw new Error('You can only delete your own answers');
    }

    console.log(`[T/D] deleteMyAnswer allowed for answerId=${answerId}`);

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

    // Decrement prompt answer count
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();
    if (prompt && prompt.answerCount > 0) {
      await ctx.db.patch(prompt._id, {
        answerCount: prompt.answerCount - 1,
        activeCount: Math.max(0, prompt.activeCount - 1),
      });
    }

    // Delete the answer
    await ctx.db.delete(answer._id);

    return { success: true };
  },
});

/**
 * Delete user's own prompt (Truth or Dare post)
 */
export const deleteMyPrompt = mutation({
  args: {
    promptId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { promptId, token }) => {
    const { user } = await requireTodSession(ctx, token);

    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    if (!storedUserMatches(prompt.ownerUserId, user)) {
      throw new Error('You can only delete your own prompts');
    }

    console.log(`[T/D] deleteMyPrompt allowed for promptId=${promptId}`);

    // 1. Delete all answers and their related data
    const answers = await ctx.db
      .query('todAnswers')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();

    for (const answer of answers) {
      // Delete answer media if exists
      if (answer.mediaStorageId) {
        try {
          await ctx.storage.delete(answer.mediaStorageId);
        } catch { /* already deleted */ }
      }

      // Delete reactions
      const reactions = await ctx.db
        .query('todAnswerReactions')
        .withIndex('by_answer', (q) => q.eq('answerId', answer._id))
        .collect();
      for (const r of reactions) {
        await ctx.db.delete(r._id);
      }

      // Delete reports
      const reports = await ctx.db
        .query('todAnswerReports')
        .withIndex('by_answer', (q) => q.eq('answerId', answer._id))
        .collect();
      for (const r of reports) {
        await ctx.db.delete(r._id);
      }

      // Delete views
      const views = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer', (q) => q.eq('answerId', answer._id))
        .collect();
      for (const v of views) {
        await ctx.db.delete(v._id);
      }

      // Delete the answer
      await ctx.db.delete(answer._id);
    }

    // 2. Delete connect requests for this prompt
    const connectRequests = await ctx.db
      .query('todConnectRequests')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const cr of connectRequests) {
      await ctx.db.delete(cr._id);
    }

    // 3. Delete private media for this prompt
    const privateMedia = await ctx.db
      .query('todPrivateMedia')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const pm of privateMedia) {
      if (pm.storageId) {
        try {
          await ctx.storage.delete(pm.storageId);
        } catch { /* already deleted */ }
      }
      await ctx.db.delete(pm._id);
    }

    // 4. Delete prompt reports
    const promptReports = await ctx.db
      .query('todPromptReports')
      .withIndex('by_prompt', (q) => q.eq('promptId', promptId))
      .collect();
    for (const pr of promptReports) {
      await ctx.db.delete(pr._id);
    }

    // 5. Delete the prompt itself
    await ctx.db.delete(prompt._id);

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
 * Enforces one-time viewing via todAnswerViews tracking.
 */
export const claimAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { answerId, token }) => {
    const { user, userId, userIdStr: viewerId } = await requireTodSession(ctx, token);

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
    if (!answer.mediaStorageId) {
      return { status: 'no_media' as const };
    }

    // MEDIA ALWAYS VIEWABLE: No block based on promptOwnerViewedAt
    // Media remains accessible until prompt expires

    // Get the prompt to check ownership
    const prompt = await ctx.db
      .query('todPrompts')
      .filter((q) => q.eq(q.field('_id'), answer.promptId as Id<'todPrompts'>))
      .first();

    if (!prompt) {
      return { status: 'no_media' as const };
    }

    await assertNotBlockedWithStoredUser(ctx, userId, prompt.ownerUserId, 'Access denied');
    await assertNotBlockedWithStoredUser(ctx, userId, answer.userId, 'Access denied');

    const isPromptOwner = storedUserMatches(prompt.ownerUserId, user);
    const isAnswerAuthor = storedUserMatches(answer.userId, user);

    // Authorization check based on visibility
    if (answer.visibility === 'owner_only') {
      // Only prompt owner can view owner_only media
      if (!isPromptOwner) {
        return { status: 'not_authorized' as const };
      }
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

    // ONE-TIME PER USER: Each user can view media only once
    // Answer author can always re-view their own media
    if (!isAnswerAuthor) {
      const existingView = await ctx.db
        .query('todAnswerViews')
        .withIndex('by_answer_viewer', (q) =>
          q.eq('answerId', answerId).eq('viewerUserId', viewerId)
        )
        .first();

      // BLOCK re-view: Return already_viewed status
      if (existingView) {
        console.log(`[T/D] mediaView BLOCKED already_viewed viewerId=${viewerId} answerId=${answerId}`);
        return { status: 'already_viewed' as const };
      }

      // First view: record it
      await ctx.db.insert('todAnswerViews', {
        answerId,
        viewerUserId: viewerId,
        viewedAt: Date.now(),
      });
      console.log(`[T/D] mediaViewed first-view viewerId=${viewerId} answerId=${answerId}`);
    } else {
      console.log(`[T/D] mediaViewed allowed (answer author) answerId=${answerId}`);
    }

    // Mark first claim time if not set
    if (!answer.mediaViewedAt) {
      await ctx.db.patch(answer._id, {
        mediaViewedAt: Date.now(),
      });
    }

    // Generate fresh URL via storage
    const url = await ctx.storage.getUrl(answer.mediaStorageId);
    if (!url) {
      return { status: 'no_media' as const };
    }

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
 * If prompt owner is viewing, marks media as viewed and deletes storage.
 */
export const finalizeAnswerMediaView = mutation({
  args: {
    answerId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { answerId, token }) => {
    const { user, userId, userIdStr: viewerId } = await requireTodSession(ctx, token);

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

    await assertNotBlockedWithStoredUser(ctx, userId, prompt.ownerUserId, 'Access denied');
    await assertNotBlockedWithStoredUser(ctx, userId, answer.userId, 'Access denied');

    const isPromptOwner = storedUserMatches(prompt.ownerUserId, user);

    // MEDIA ALWAYS EDITABLE: Do NOT delete media on owner view
    // Just mark as viewed for analytics - sender can still update until expiry
    if (isPromptOwner && answer.mediaStorageId && !answer.promptOwnerViewedAt) {
      // Mark as viewed by owner (for analytics only, no locking)
      await ctx.db.patch(answer._id, {
        promptOwnerViewedAt: Date.now(),
        // DO NOT clear mediaStorageId/mediaUrl - keep media accessible
      });
    }

    return { status: 'ok' as const };
  },
});

/**
 * Get URL for voice message playback.
 * Voice messages are NOT one-time secure - they can be replayed.
 * P0-006 FIX: Added authorization check for owner_only visibility.
 */
export const getVoiceUrl = query({
  args: {
    answerId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, { answerId, token }) => {
    const viewer = await requireTodSession(ctx, token);
    const viewerUserId = viewer.userIdStr;

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

    // P0-006 FIX: Authorization check for owner_only visibility
    if (answer.visibility === 'owner_only') {
      // Get the prompt to find the owner
      const prompt = await ctx.db.get(answer.promptId as Id<'todPrompts'>);
      const isAnswerAuthor = viewerUserId === answer.userId;
      const isPromptOwner = prompt && viewerUserId === prompt.ownerUserId;

      if (!isAnswerAuthor && !isPromptOwner) {
        return { status: 'unauthorized' as const };
      }
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
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { userId: userDbId } = await requireTodSession(ctx, token);

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

        // Calculate age
        let otherAge: number | null = null;
        if (otherUser.dateOfBirth) {
          const birthDate = new Date(otherUser.dateOfBirth);
          const today = new Date();
          otherAge = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            otherAge--;
          }
        }

        // PHASE-2 IDENTITY FIX: Get Phase-2 displayName (nickname), NOT real name
        const participantDisplayName = await getPhase2DisplayName(ctx, otherParticipantId);

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
          participantName: participantDisplayName,
          participantPhotoUrl: otherUser.primaryPhotoUrl ?? null,
          participantAge: otherAge,
          participantGender: otherUser.gender ?? null,
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
