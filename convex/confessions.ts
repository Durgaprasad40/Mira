/*
 * LOCKED (CONFESSIONS RANKING SYSTEM)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * LOCKED LOGIC:
 * - Engagement-based ranking (no baseScore, no timeDecay)
 * - New confessions appear at BOTTOM by default (score=0)
 * - Engaged confessions rise based on: reactions, replies, unique commenters
 * - Sort: rankingScore DESC, createdAt ASC tie-breaker
 * - computeRankingScore() formula
 * - updateConfessionRanking() on reactions/replies/reports
 */
import { mutation, query, MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, ensureUserByAuthId, isPairEligibleForPhase } from './helpers';

// ═══════════════════════════════════════════════════════════════════════════
// P0-002 FIX: Enhanced PII validation patterns for server-side safety
// Goal: Block phone numbers, emails, and social handles without false positives
// ═══════════════════════════════════════════════════════════════════════════

// Phone patterns - catch various formats while avoiding false positives on normal numbers
const PHONE_PATTERNS = [
  // International format: +1 (555) 123-4567, +91 98765 43210, +44 7911 123456
  /\+\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,
  // US/CA format with parentheses: (555) 123-4567, (555)123-4567
  /\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}/,
  // Standard formats: 555-123-4567, 555.123.4567, 555 123 4567
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  // 10+ consecutive digits (likely a phone number)
  /\b\d{10,14}\b/,
  // Indian format: 98765 43210, 9876543210
  /\b[6-9]\d{4}[-.\s]?\d{5}\b/,
];

// Email pattern (existing - already good)
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;

// Social handle patterns - detect attempts to share contact info
const SOCIAL_PATTERNS = [
  // Direct messaging URLs (high confidence PII sharing)
  /\b(wa\.me|t\.me|m\.me|discord\.gg|bit\.ly)\/[a-zA-Z0-9_-]+/i,
  // Full social profile URLs
  /\b(instagram\.com|snapchat\.com|tiktok\.com|twitter\.com|x\.com)\/[a-zA-Z0-9._]+/i,
  // "DM me on [platform]" or "my [platform] is" patterns (intent to share)
  /\b(dm|message|text|contact|add|follow)\s+(me\s+)?(on|at|@)?\s*(instagram|insta|snap|snapchat|telegram|whatsapp|discord|tiktok|twitter)\b/i,
  /\bmy\s+(instagram|insta|snap|snapchat|telegram|whatsapp|discord|tiktok|twitter)\s*(is|:|\s+@)/i,
  // Platform + username pattern: "insta: @username" or "snap: username123" or "telegram: @handle"
  /\b(instagram|insta|snap|snapchat|telegram|whatsapp|discord|tiktok|twitter)\s*[:@]\s*@?[a-zA-Z0-9._]{2,30}\b/i,
  // WhatsApp number sharing: "whatsapp 9876543210" or "wa +91..."
  /\b(whatsapp|wa)\s*[+\d][\d\s-]{8,}/i,
];

// P0-002 FIX: Unified PII check function
function containsPII(text: string): { hasPII: boolean; type: string } {
  // Check phone patterns
  for (const pattern of PHONE_PATTERNS) {
    if (pattern.test(text)) {
      return { hasPII: true, type: 'phone number' };
    }
  }

  // Check email
  if (EMAIL_PATTERN.test(text)) {
    return { hasPII: true, type: 'email address' };
  }

  // Check social patterns
  for (const pattern of SOCIAL_PATTERNS) {
    if (pattern.test(text)) {
      return { hasPII: true, type: 'social media contact' };
    }
  }

  return { hasPII: false, type: '' };
}

// Confession expiry duration (24 hours in milliseconds)
const CONFESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// RANKING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
// New posts start at bottom, rise based on engagement
// Formula:
//   rankingScore =
//     (likeCount * 2) + (reactionCount * 1.5) + (topLevelCommentCount * 6)
//     + (replyCount * 3) + (uniqueCommenters * 4)
//     + (recentReactions * 1) + (recentComments * 5)
//     - (ln(postAgeHours + 1) * 8) - (reportCount * 8)
// ═══════════════════════════════════════════════════════════════════════════

const RECENT_WINDOW_MS = 6 * 60 * 60 * 1000; // 6-hour rolling window for "recent" engagement

interface RankingInputs {
  reactionCount: number;
  replyCount: number; // top-level replies
  voiceReplyCount: number;
  uniqueCommenters: number;
  recentReactionCount: number;
  recentReplyCount: number;
  reportCount: number;
  createdAt: number;
  authorId: string;
}

function computeRankingScore(inputs: RankingInputs): number {
  // ═══════════════════════════════════════════════════════════════════════════
  // RANKING FIX: Engagement-only scoring
  // ═══════════════════════════════════════════════════════════════════════════
  // - NO baseScore: Posts start at 0, not 10
  // - NO timeDecay: Age doesn't penalize posts
  // - ONLY engagement matters for ranking
  // - Tie-breaker (createdAt ASC) ensures newer posts appear AFTER older posts
  //   when they have the same score
  //
  // Result:
  // - New post (0 engagement): score = 0, appears at BOTTOM (newest createdAt)
  // - Old post (0 engagement): score = 0, appears BEFORE new posts (older createdAt)
  // - Post with engagement: score > 0, rises based on engagement amount
  // ═══════════════════════════════════════════════════════════════════════════

  // Base engagement weights (reactions serve as "likes" in confessions)
  const reactionScore = inputs.reactionCount * 2; // Treat as likes (weight 2)
  const topLevelCommentScore = inputs.replyCount * 6;
  const uniqueCommenterScore = inputs.uniqueCommenters * 4;

  // Recent engagement bonus (within 6h window)
  const recentReactionScore = inputs.recentReactionCount * 1.5;
  const recentCommentScore = inputs.recentReplyCount * 5;

  // Report penalty
  const reportPenalty = inputs.reportCount * 8;

  // Compute final score - ENGAGEMENT ONLY
  // New post (0 engagement): 0
  // With 1 reaction: 2
  // With 1 comment: 6
  // With 1 comment + 2 reactions: 10
  const score =
    reactionScore +
    topLevelCommentScore +
    uniqueCommenterScore +
    recentReactionScore +
    recentCommentScore -
    reportPenalty;

  return score;
}

// Helper to count unique commenters for a confession
async function countUniqueCommenters(
  ctx: any,
  confessionId: Id<'confessions'>,
  authorId: Id<'users'>
): Promise<number> {
  const replies = await ctx.db
    .query('confessionReplies')
    .withIndex('by_confession', (q: any) => q.eq('confessionId', confessionId))
    .collect();

  const uniqueUserIds = new Set<string>();
  for (const reply of replies) {
    // Exclude author's own comments from unique commenter count
    if (reply.userId !== authorId) {
      uniqueUserIds.add(reply.userId as string);
    }
  }
  return uniqueUserIds.size;
}

// Helper to update ranking score for a confession
async function updateConfessionRanking(
  ctx: MutationCtx,
  confessionId: Id<'confessions'>
): Promise<void> {
  const confession = await ctx.db.get(confessionId);
  if (!confession) return;

  const now = Date.now();

  // Count unique commenters (excluding author)
  const uniqueCommenters = await countUniqueCommenters(ctx, confessionId, confession.userId);

  // Check if recent engagement window needs reset
  const windowStart = confession.recentEngagementWindowStart || now;
  const isWindowExpired = (now - windowStart) > RECENT_WINDOW_MS;

  // If window expired, reset recent counts
  let recentReplyCount = confession.recentReplyCount || 0;
  let recentReactionCount = confession.recentReactionCount || 0;

  if (isWindowExpired) {
    recentReplyCount = 0;
    recentReactionCount = 0;
  }

  const rankingScore = computeRankingScore({
    reactionCount: confession.reactionCount,
    replyCount: confession.replyCount,
    voiceReplyCount: confession.voiceReplyCount || 0,
    uniqueCommenters,
    recentReactionCount,
    recentReplyCount,
    reportCount: confession.reportCount || 0,
    createdAt: confession.createdAt,
    authorId: confession.userId as string,
  });

  await ctx.db.patch(confessionId, {
    rankingScore,
    uniqueCommenters,
    lastEngagementAt: now,
    ...(isWindowExpired ? {
      recentEngagementWindowStart: now,
      recentReplyCount: 0,
      recentReactionCount: 0,
    } : {}),
  });
}

// P0-003 FIX: Helper to check if either user has blocked the other (bidirectional)
// Returns true if blocked (should prevent conversation creation)
async function isBlockedBidirectional(
  ctx: MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  // Check if userId1 blocked userId2
  const block1 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId1).eq('blockedUserId', userId2)
    )
    .first();
  if (block1) return true;

  // Check if userId2 blocked userId1
  const block2 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId2).eq('blockedUserId', userId1)
    )
    .first();
  return !!block2;
}

// P2-001 FIX: Helper to deduplicate conversations after creation
// Handles race condition where concurrent mutations create duplicate conversations
// Strategy: Keep oldest conversation (by _creationTime), delete duplicates
async function dedupeConversationsForConfession(
  ctx: MutationCtx,
  confessionId: Id<'confessions'>,
  participantIds: [Id<'users'>, Id<'users'>]
): Promise<Id<'conversations'>> {
  // Query all conversations for this confession
  const allConversations = await ctx.db
    .query('conversations')
    .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
    .collect();

  // Filter to only those with matching participants (order-independent)
  const matchingConversations = allConversations.filter((c) => {
    const hasUser1 = c.participants.includes(participantIds[0]);
    const hasUser2 = c.participants.includes(participantIds[1]);
    return hasUser1 && hasUser2;
  });

  if (matchingConversations.length === 0) {
    throw new Error('No conversation found after creation - unexpected state');
  }

  if (matchingConversations.length === 1) {
    // No duplicates, return the single conversation
    return matchingConversations[0]._id;
  }

  // Multiple conversations found - keep oldest, delete duplicates
  // Sort by _creationTime ascending (oldest first)
  matchingConversations.sort((a, b) => a._creationTime - b._creationTime);
  const keepConversation = matchingConversations[0];
  const duplicates = matchingConversations.slice(1);

  // Delete duplicate conversations and their participant junction rows
  for (const dupe of duplicates) {
    // Delete participant junction rows for this conversation
    const dupeParticipants = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_conversation', (q) => q.eq('conversationId', dupe._id))
      .collect();
    for (const p of dupeParticipants) {
      await ctx.db.delete(p._id);
    }
    // Delete the duplicate conversation
    await ctx.db.delete(dupe._id);
  }

  return keepConversation._id;
}

// Create a new confession
export const createConfession = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(),
    // New 3-mode visibility: anonymous (hidden), open (visible), blur_photo (blurred photo + visible info)
    authorVisibility: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur_photo'))),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    taggedUserId: v.optional(v.union(v.id('users'), v.string())), // User being confessed to
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // NOTE: Confession creation limit removed - users can create unlimited confessions
    const now = Date.now();

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
    // P0-002 FIX: Enhanced PII validation (phone, email, social handles)
    const piiCheck = containsPII(trimmed);
    if (piiCheck.hasPII) {
      throw new Error(`Do not include ${piiCheck.type} in confessions. Keep it anonymous!`);
    }

    // If taggedUserId provided, verify the current user has liked them
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
    }

    // Determine effective visibility (backward compat: derive from isAnonymous if not provided)
    const effectiveVisibility = args.authorVisibility || (args.isAnonymous ? 'anonymous' : 'open');
    // Include author info for 'open' and 'blur_photo' modes
    const includeAuthorInfo = effectiveVisibility !== 'anonymous';

    // Compute initial ranking score (0 with no engagement - new posts start at bottom)
    const initialRankingScore = computeRankingScore({
      reactionCount: 0,
      replyCount: 0,
      voiceReplyCount: 0,
      uniqueCommenters: 0,
      recentReactionCount: 0,
      recentReplyCount: 0,
      reportCount: 0,
      createdAt: now,
      authorId: userId as string,
    });

    const confessionId = await ctx.db.insert('confessions', {
      userId: userId,
      text: trimmed,
      isAnonymous: args.isAnonymous,
      authorVisibility: effectiveVisibility,
      mood: args.mood,
      visibility: args.visibility,
      imageUrl: args.imageUrl,
      authorName: includeAuthorInfo ? args.authorName : undefined,
      authorPhotoUrl: includeAuthorInfo ? args.authorPhotoUrl : undefined,
      authorAge: includeAuthorInfo ? args.authorAge : undefined,
      authorGender: includeAuthorInfo ? args.authorGender : undefined,
      replyCount: 0,
      reactionCount: 0,
      voiceReplyCount: 0,
      createdAt: now,
      expiresAt: now + CONFESSION_EXPIRY_MS,
      taggedUserId: taggedUserId,
      // Initialize ranking fields - new posts start at bottom
      rankingScore: initialRankingScore,
      lastEngagementAt: now,
      uniqueCommenters: 0,
      reportCount: 0,
      recentReplyCount: 0,
      recentReactionCount: 0,
      recentEngagementWindowStart: now,
    });

    // If tagged, create notification for the tagged user
    if (taggedUserId) {
      await ctx.db.insert('confessionNotifications', {
        userId: taggedUserId,
        confessionId,
        fromUserId: userId,
        type: 'TAGGED_CONFESSION',
        seen: false,
        createdAt: now,
      });
    }

    return confessionId;
  },
});

// List confessions (latest) with 2 reply previews per confession
// Only returns non-expired confessions for public feed
export const listConfessions = query({
  args: {
    sortBy: v.union(v.literal('trending'), v.literal('latest')),
  },
  handler: async (ctx, { sortBy }) => {
    const now = Date.now();
    const allConfessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // Filter out expired and deleted confessions
    const confessions = allConfessions.filter(
      (c) => (c.expiresAt === undefined || c.expiresAt > now) && !c.isDeleted
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

        // P1-02: Omit taggedUserId from anonymous confessions to prevent privacy leak
        const { taggedUserId: _omitTagged, ...confessionWithoutTagged } = c;
        const safeConfession = c.isAnonymous ? confessionWithoutTagged : c;

        // Fetch tagged user's display name (privacy-safe: only name, not other PII)
        let taggedUserName: string | undefined;
        if (c.taggedUserId) {
          const taggedUser = await ctx.db.get(c.taggedUserId);
          taggedUserName = taggedUser?.name;
        }

        return {
          ...safeConfession,
          taggedUserName, // Display name for tagged user (visible to all)
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

    // ═══════════════════════════════════════════════════════════════════════════
    // RANKING-BASED SORTING
    // ═══════════════════════════════════════════════════════════════════════════
    // 'trending' = sort by rankingScore DESC (new posts at bottom, engaged posts rise)
    // 'latest' = sort by createdAt DESC (newest first - for users who want to see new content)
    if (sortBy === 'trending') {
      // Sort by ranking score (primary), createdAt ASC (tie-breaker)
      // - Higher engagement score = higher position
      // - Same score: older posts first, newer posts LAST
      // - New posts with 0 engagement appear at BOTTOM (newest createdAt)
      withPreviews.sort((a, b) => {
        // Primary: rankingScore DESC (higher score = higher position)
        const scoreA = a.rankingScore ?? -Infinity;
        const scoreB = b.rankingScore ?? -Infinity;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }

        // Tie-breaker: createdAt ASC (older posts first, newer posts LAST)
        // This ensures brand new posts with 0 engagement appear at the bottom
        const createdAtA = a.createdAt ?? now;
        const createdAtB = b.createdAt ?? now;
        return createdAtA - createdAtB;
      });
    }
    // 'latest' sorting: already fetched in createdAt DESC order, no re-sort needed

    return withPreviews;
  },
});

// Get trending confessions (last 48h, time-decay scoring)
// Only returns non-expired confessions
export const getTrendingConfessions = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000; // 48 hours ago

    const confessions = await ctx.db
      .query('confessions')
      .withIndex('by_created')
      .order('desc')
      .collect();

    // Filter to last 48h AND not expired AND not deleted
    const recent = confessions.filter(
      (c) => c.createdAt > cutoff && (c.expiresAt === undefined || c.expiresAt > now) && !c.isDeleted
    );

    // Use precomputed rankingScore for trending (with fallback for legacy data)
    const scored = await Promise.all(
      recent.map(async (c) => {
        // Use rankingScore if available, otherwise compute on-the-fly for legacy
        let trendingScore = c.rankingScore;
        if (trendingScore === undefined) {
          // Fallback for legacy confessions without rankingScore
          const createdAt = c.createdAt ?? now;
          const hoursSince = (now - createdAt) / (1000 * 60 * 60);
          const voiceReplies = c.voiceReplyCount || 0;
          trendingScore =
            (c.replyCount * 5 + c.reactionCount * 2 + voiceReplies * 1) /
            (hoursSince + 2);
        }
        // P1-02: Omit taggedUserId from anonymous confessions to prevent privacy leak
        const { taggedUserId: _omitTagged, ...confessionWithoutTagged } = c;
        const safeConfession = c.isAnonymous ? confessionWithoutTagged : c;

        // Fetch tagged user's display name (privacy-safe: only name)
        let taggedUserName: string | undefined;
        if (c.taggedUserId) {
          const taggedUser = await ctx.db.get(c.taggedUserId);
          taggedUserName = taggedUser?.name;
        }

        return { ...safeConfession, taggedUserName, trendingScore };
      })
    );

    // Sort by trendingScore (rankingScore) DESC
    scored.sort((a, b) => (b.trendingScore ?? -Infinity) - (a.trendingScore ?? -Infinity));

    // Return top 5 trending
    return scored.slice(0, 5);
  },
});

// Get a single confession by ID
export const getConfession = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    const confession = await ctx.db.get(confessionId);
    if (!confession) return null;

    // Lookup tagged user name (like listConfessions does)
    let taggedUserName: string | undefined;
    if (confession.taggedUserId) {
      const taggedUser = await ctx.db.get(confession.taggedUserId);
      taggedUserName = taggedUser?.name;
    }

    // P1-02: Omit taggedUserId from anonymous confessions to prevent privacy leak
    if (confession.isAnonymous) {
      const { taggedUserId: _omitTagged, ...safeConfession } = confession;
      return { ...safeConfession, taggedUserName };
    }
    return { ...confession, taggedUserName };
  },
});

// Create a reply to a confession (text or voice only — no images/videos/gifs)
// FIX 2: Added identityMode for commenter visibility control
export const createReply = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
    isAnonymous: v.boolean(), // Legacy field - derived from identityMode
    // FIX 2: Identity mode - anonymous/blur/open (default: blur)
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('blur'),
      v.literal('open')
    )),
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    parentReplyId: v.optional(v.id('confessionReplies')), // For OP reply-to-reply
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Fetch confession to check if user is OP (confession author)
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found.');
    }

    const isOP = confession.userId === userId;
    const isTopLevel = !args.parentReplyId;

    // REPLY RULES:
    // - Non-OP: can reply ONLY ONCE (top-level)
    // - OP: can make unlimited nested replies, but only ONE top-level reply
    if (!isOP) {
      // Non-OP: check for any existing reply
      const existingReply = await ctx.db
        .query('confessionReplies')
        .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
        .filter((q) => q.eq(q.field('userId'), userId))
        .first();

      if (existingReply) {
        throw new Error('You can reply only once to this confession.');
      }
    } else if (isOP && isTopLevel) {
      // OP: check for existing top-level reply only
      const existingTopLevel = await ctx.db
        .query('confessionReplies')
        .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
        .filter((q) =>
          q.and(
            q.eq(q.field('userId'), userId),
            q.eq(q.field('parentReplyId'), undefined)
          )
        )
        .first();

      if (existingTopLevel) {
        throw new Error('You already posted a main reply.');
      }
    }
    // OP nested replies (parentReplyId provided) → allowed freely

    const replyType = args.type || 'text';

    if (replyType === 'text') {
      const trimmed = args.text.trim();
      if (trimmed.length < 1) {
        throw new Error('Reply cannot be empty.');
      }
      // P0-002 FIX: Enhanced PII validation for replies too
      const piiCheck = containsPII(trimmed);
      if (piiCheck.hasPII) {
        throw new Error(`Do not include ${piiCheck.type}. Keep it anonymous!`);
      }
    }

    // FIX 2: Default identity mode is 'blur' if not specified
    const identityMode = args.identityMode || 'blur';
    // Derive isAnonymous from identityMode for backward compatibility
    const isAnonymousFromMode = identityMode !== 'open';

    const replyId = await ctx.db.insert('confessionReplies', {
      confessionId: args.confessionId,
      userId: userId,
      text: args.text.trim(),
      isAnonymous: isAnonymousFromMode, // Derived from identityMode
      identityMode, // FIX 2: Store the identity mode
      type: replyType,
      voiceUrl: args.voiceUrl,
      voiceDurationSec: args.voiceDurationSec,
      parentReplyId: args.parentReplyId,
      createdAt: Date.now(),
    });

    // Increment reply count ONLY for top-level replies (not nested child replies)
    // Nested replies (with parentReplyId) should not inflate the main reply count
    // Note: confession was already fetched above for OP check
    const now = Date.now();
    const patch: any = {};
    // Only count top-level replies in replyCount
    if (!args.parentReplyId) {
      patch.replyCount = confession.replyCount + 1;
      // Update recent reply count for ranking (only for non-author replies)
      if (userId !== confession.userId) {
        const windowStart = confession.recentEngagementWindowStart || now;
        const isWindowExpired = (now - windowStart) > RECENT_WINDOW_MS;
        if (isWindowExpired) {
          patch.recentReplyCount = 1;
          patch.recentEngagementWindowStart = now;
        } else {
          patch.recentReplyCount = (confession.recentReplyCount || 0) + 1;
        }
      }
    }
    if (replyType === 'voice') {
      patch.voiceReplyCount = (confession.voiceReplyCount || 0) + 1;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.confessionId, patch);
    }

    // Update ranking score after reply (author replies don't boost ranking as much)
    await updateConfessionRanking(ctx, args.confessionId);

    return replyId;
  },
});

// Delete own reply
// P1-003 FIX: Also delete nested replies (child replies to this reply)
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

    // FIX 5: Block deletion if reply has active connect request
    if (reply.hasActiveConnectRequest) {
      throw new Error('Cannot delete reply with active connection request');
    }

    // P1-003 FIX: Find and delete any nested replies (child replies to this reply)
    const childReplies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', reply.confessionId))
      .filter((q) => q.eq(q.field('parentReplyId'), args.replyId))
      .collect();

    // Delete child replies first
    let childVoiceCount = 0;
    for (const child of childReplies) {
      if (child.type === 'voice') childVoiceCount++;
      await ctx.db.delete(child._id);
    }

    // Delete the main reply
    await ctx.db.delete(args.replyId);

    // Decrement reply count ONLY if this was a top-level reply
    // Nested replies (with parentReplyId) don't affect the main reply count
    const confession = await ctx.db.get(reply.confessionId);
    if (confession) {
      const voiceDeleted = (reply.type === 'voice' ? 1 : 0) + childVoiceCount;
      const patch: any = {};
      // Only decrement replyCount if this was a top-level reply (no parentReplyId)
      if (!reply.parentReplyId) {
        patch.replyCount = Math.max(0, confession.replyCount - 1);
      }
      if (voiceDeleted > 0) {
        patch.voiceReplyCount = Math.max(0, (confession.voiceReplyCount || 0) - voiceDeleted);
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(reply.confessionId, patch);
      }
      // Update ranking score after reply deletion
      await updateConfessionRanking(ctx, reply.confessionId);
    }

    return { success: true };
  },
});

// Get replies for a confession
// FIX 2: Enriched with commenter info based on identity mode
// FIX 5: Reveals blur if viewer has accepted connect with commenter
export const getReplies = query({
  args: {
    confessionId: v.id('confessions'),
    viewerId: v.optional(v.union(v.id('users'), v.string())), // FIX 5: Optional viewer for blur reveal check
  },
  handler: async (ctx, { confessionId, viewerId }) => {
    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .order('asc')
      .collect();

    // FIX 5: Get all accepted connects for this confession to check for reveals
    let acceptedConnects: { fromUserId: string; toUserId: string }[] = [];
    if (viewerId) {
      const resolvedViewerId = typeof viewerId === 'string'
        ? (await ctx.db
            .query('users')
            .withIndex('by_auth_user_id', (q) => q.eq('authUserId', viewerId))
            .first())?._id
        : viewerId;

      if (resolvedViewerId) {
        const connects = await ctx.db
          .query('confessionCommentConnects')
          .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
          .filter((q) => q.eq(q.field('status'), 'accepted'))
          .collect();

        // Filter to connects involving the viewer
        acceptedConnects = connects
          .filter((c) => c.fromUserId === resolvedViewerId || c.toUserId === resolvedViewerId)
          .map((c) => ({ fromUserId: c.fromUserId as string, toUserId: c.toUserId as string }));
      }
    }

    // FIX 2: Enrich replies with commenter info based on identity mode
    const enrichedReplies = await Promise.all(
      replies.map(async (reply) => {
        const user = await ctx.db.get(reply.userId);
        if (!user) {
          return {
            ...reply,
            commenterInfo: null,
          };
        }

        // Get commenter's primary photo
        const photos = await ctx.db
          .query('photos')
          .withIndex('by_user_order', (q) => q.eq('userId', reply.userId))
          .collect();
        const primaryPhoto = photos.find((p) => p.isPrimary) || photos[0];

        // Determine identity mode (backward compat: default to 'blur' if not set)
        let mode = reply.identityMode || (reply.isAnonymous ? 'blur' : 'open');

        // FIX 5: Check if viewer has accepted connect with this commenter - reveal blur
        const isConnectedWithViewer = acceptedConnects.some(
          (c) => c.fromUserId === (reply.userId as string) || c.toUserId === (reply.userId as string)
        );
        if (isConnectedWithViewer && mode === 'blur') {
          mode = 'open'; // Reveal blur for connected users
        }

        // Calculate age
        const dateOfBirth = user.dateOfBirth;
        let age: number | undefined;
        if (dateOfBirth) {
          const birthDate = new Date(dateOfBirth);
          const today = new Date();
          age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
        }

        // Build commenter info based on identity mode
        let commenterInfo: {
          mode: string;
          name?: string;
          photoUrl?: string;
          photoBlurred?: boolean;
          gender?: string;
          age?: number;
          revealed?: boolean; // FIX 5: Flag to indicate reveal from connect
        };

        if (mode === 'anonymous') {
          // ANONYMOUS: everything hidden (cannot be revealed)
          commenterInfo = { mode: 'anonymous' };
        } else if (mode === 'blur') {
          // BLUR: partial name, blurred photo, gender, age
          const firstName = user.name?.split(' ')[0] || 'Someone';
          commenterInfo = {
            mode: 'blur',
            name: firstName,
            photoUrl: primaryPhoto?.url,
            photoBlurred: true,
            gender: user.gender,
            age,
          };
        } else {
          // OPEN: full identity (or revealed from connect)
          commenterInfo = {
            mode: 'open',
            name: user.name,
            photoUrl: primaryPhoto?.url,
            photoBlurred: false,
            gender: user.gender,
            age,
            revealed: isConnectedWithViewer && reply.identityMode === 'blur', // Was blur, now revealed
          };
        }

        return {
          ...reply,
          commenterInfo,
        };
      })
    );

    return enrichedReplies;
  },
});

// Toggle emoji reaction — one emoji per user per confession (toggle/replace)
// Special behavior: if tagged user likes a tagged confession, create a DM thread
export const toggleReaction = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    type: v.string(), // any emoji string
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users"> (MUTATION: can create)
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Find existing reaction from this user on this confession
    const existing = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .first();

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) return { added: false, replaced: false, chatUnlocked: false };

    // P1-001 FIX: Helper to clean up duplicate reactions and recompute count atomically
    // This handles race conditions where multiple concurrent mutations insert duplicates
    const cleanupAndRecomputeCount = async () => {
      // Get all reactions for this confession
      const allReactions = await ctx.db
        .query('confessionReactions')
        .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
        .collect();

      // Group by userId to find duplicates
      const reactionsByUser = new Map<string, typeof allReactions>();
      for (const reaction of allReactions) {
        const key = reaction.userId as string;
        if (!reactionsByUser.has(key)) {
          reactionsByUser.set(key, []);
        }
        reactionsByUser.get(key)!.push(reaction);
      }

      // Clean up duplicates: keep the oldest reaction per user
      let cleanCount = 0;
      for (const [, userReactions] of reactionsByUser) {
        if (userReactions.length > 1) {
          // P1-004 FIX: Sort by createdAt ascending (oldest first), with null-safe fallback
          userReactions.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
          // Delete all but the oldest
          for (let i = 1; i < userReactions.length; i++) {
            await ctx.db.delete(userReactions[i]._id);
          }
          cleanCount++; // Count this user's single remaining reaction
        } else {
          cleanCount++; // Single reaction, count it
        }
      }

      // Update confession with accurate count
      await ctx.db.patch(args.confessionId, { reactionCount: cleanCount });
      return cleanCount;
    };

    const now = Date.now();
    const isAuthorReaction = userId === confession.userId;

    if (existing) {
      if (existing.type === args.type) {
        // Same emoji → remove (toggle off)
        await ctx.db.delete(existing._id);
        // P1-001 FIX: Clean up any duplicates and recompute
        await cleanupAndRecomputeCount();
        // Update ranking score
        await updateConfessionRanking(ctx, args.confessionId);
        return { added: false, replaced: false, chatUnlocked: false };
      } else {
        // Different emoji → replace (count stays the same)
        await ctx.db.patch(existing._id, {
          type: args.type,
          createdAt: now,
        });
        // P1-001 FIX: Still clean up in case of race-created duplicates
        await cleanupAndRecomputeCount();
        // Ranking doesn't change for emoji replacement
        return { added: false, replaced: true, chatUnlocked: false };
      }
    } else {
      // No existing → add new
      await ctx.db.insert('confessionReactions', {
        confessionId: args.confessionId,
        userId: userId,
        type: args.type,
        createdAt: now,
      });
      // P1-001 FIX: Clean up any race-created duplicates and recompute
      await cleanupAndRecomputeCount();

      // Update recent reaction count for ranking (only for non-author reactions)
      if (!isAuthorReaction) {
        const windowStart = confession.recentEngagementWindowStart || now;
        const isWindowExpired = (now - windowStart) > RECENT_WINDOW_MS;
        if (isWindowExpired) {
          await ctx.db.patch(args.confessionId, {
            recentReactionCount: 1,
            recentEngagementWindowStart: now,
          });
        } else {
          await ctx.db.patch(args.confessionId, {
            recentReactionCount: (confession.recentReactionCount || 0) + 1,
          });
        }
      }

      // Update ranking score
      await updateConfessionRanking(ctx, args.confessionId);

      // NOTE: DM creation on tagged user reaction has been removed.
      // Tagged users now use respondToTaggedConfession mutation with Reject/Connect actions.
      // Reactions are purely for engagement - no chat is created.

      return { added: true, replaced: false, chatUnlocked: false };
    }
  },
});

// Get all reactions for a confession (grouped by emoji)
// P1-001 FIX: Dedupe by user to handle any race-created duplicates
export const getReactionCounts = query({
  args: { confessionId: v.id('confessions') },
  handler: async (ctx, { confessionId }) => {
    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
      .collect();

    // P1-001 FIX: Dedupe - only count one reaction per user (keep newest)
    // P1-004 FIX: Guard against undefined createdAt (legacy data)
    const userReactionMap = new Map<string, { type: string; createdAt: number }>();
    for (const r of reactions) {
      const userId = r.userId as string;
      const existing = userReactionMap.get(userId);
      const rCreatedAt = r.createdAt ?? 0;
      // Keep the newest reaction per user
      if (!existing || rCreatedAt > existing.createdAt) {
        userReactionMap.set(userId, { type: r.type, createdAt: rCreatedAt });
      }
    }

    // Count emojis from deduped reactions
    const emojiCounts: Record<string, number> = {};
    for (const [, reaction] of userReactionMap) {
      // Skip old string-based reaction keys (e.g. "relatable", "bold")
      if (/^[a-zA-Z0-9_\s]+$/.test(reaction.type)) continue;
      emojiCounts[reaction.type] = (emojiCounts[reaction.type] || 0) + 1;
    }

    // Return top emojis sorted by count
    const topEmojis = Object.entries(emojiCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji, count]) => ({ emoji, count }));
    return topEmojis;
  },
});

// Get user's reaction on a confession (single emoji or null)
// P1-001 FIX: Handle duplicates by returning newest reaction
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

    // P1-001 FIX: Collect all reactions and return newest (handles race-created duplicates)
    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('userId', userId)
      )
      .collect();

    if (reactions.length === 0) return null;

    // P1-004 FIX: Return the newest reaction's type, guarding against undefined createdAt
    const newest = reactions.reduce((a, b) => ((a.createdAt ?? 0) > (b.createdAt ?? 0) ? a : b));
    return newest.type;
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

    // Add isExpired flag for each confession
    return confessions.map((c) => ({
      ...c,
      isExpired: c.expiresAt !== undefined && c.expiresAt <= now,
    }));
  },
});

// Report a confession
// Creates a record in confessionReports for moderation review
export const reportConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    reporterId: v.union(v.id('users'), v.string()),
    reason: v.union(
      v.literal('spam'),
      v.literal('harassment'),
      v.literal('hate'),
      v.literal('sexual'),
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

    // Create report record
    await ctx.db.insert('confessionReports', {
      confessionId: args.confessionId,
      reporterId: reporterId,
      reportedUserId: confession.userId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: Date.now(),
    });

    // Increment report count for ranking penalty
    const newReportCount = (confession.reportCount || 0) + 1;
    await ctx.db.patch(args.confessionId, { reportCount: newReportCount });

    // Update ranking score (reports penalize ranking)
    await updateConfessionRanking(ctx, args.confessionId);

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

      result.push({
        notificationId: notif._id,
        confessionId: notif.confessionId,
        seen: notif.seen,
        notificationCreatedAt: notif.createdAt,
        // Confession data (do NOT include authorName or any identity info)
        confessionText: confession.text,
        confessionMood: confession.mood,
        confessionCreatedAt: confession.createdAt,
        confessionExpiresAt: confession.expiresAt,
        isExpired: confession.expiresAt !== undefined && confession.expiresAt <= now,
        replyCount: confession.replyCount,
        reactionCount: confession.reactionCount,
        // P1-PREVIEW FIX: Include preview consumption status for persistence
        previewConsumed: !!(confession.previewConsumedAt && confession.previewConsumedBy === userId),
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
// DEPRECATED: Get or create a conversation for an anonymous confession reply
// ═══════════════════════════════════════════════════════════════════════════
// This mutation is no longer used. Anonymous reply/chat path has been removed.
// Tagged users now use respondToTaggedConfession with Reject/Connect actions.
// Keeping this mutation for backward compatibility - it throws an error.
// ═══════════════════════════════════════════════════════════════════════════
export const getOrCreateForConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async () => {
    // Private anonymous chat path has been removed from Confess.
    // Use public replies instead, or respondToTaggedConfession for tagged users.
    throw new Error('Anonymous chat feature has been removed. Use public replies instead.');
  },
});

// Delete own confession (soft delete via isDeleted flag)
// Only the author can delete their own confession
// P1-003 FIX: Properly clean up related data to prevent orphans
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

    const now = Date.now();

    // P1-003 FIX: Clean up related data in parallel for efficiency
    // 1. Delete all reactions (no reason to keep reactions on deleted confession)
    const reactions = await ctx.db
      .query('confessionReactions')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // 2. Delete all replies (replies are meaningless without the confession)
    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // 3. Delete all notifications (notifications for deleted confessions are spam)
    const notifications = await ctx.db
      .query('confessionNotifications')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // 4. Expire any linked conversations (don't delete - preserve message history)
    const conversations = await ctx.db
      .query('conversations')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // Execute deletes
    for (const reaction of reactions) {
      await ctx.db.delete(reaction._id);
    }
    for (const reply of replies) {
      await ctx.db.delete(reply._id);
    }
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
    }
    // Mark conversations as expired (not deleted - preserves chat history)
    for (const conversation of conversations) {
      await ctx.db.patch(conversation._id, { expiresAt: now });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING FIX 2: Cancel any pending comment connect requests
    // ═══════════════════════════════════════════════════════════════════════════
    const commentConnects = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    for (const connect of commentConnects) {
      // Only cancel pending requests - accepted matches should remain
      if (connect.status === 'pending') {
        // Mark as expired (not deleted - preserves audit trail)
        await ctx.db.patch(connect._id, {
          status: 'expired',
          respondedAt: now,
        });
        // Clear the lock on the reply (if reply still exists - it might be deleted above)
        const reply = await ctx.db.get(connect.replyId);
        if (reply && reply.hasActiveConnectRequest) {
          await ctx.db.patch(connect.replyId, { hasActiveConnectRequest: false });
        }
      }
    }

    // Soft delete the confession itself
    await ctx.db.patch(args.confessionId, {
      isDeleted: true,
      deletedAt: now,
      // Reset counts since we deleted the related data
      reactionCount: 0,
      replyCount: 0,
    });

    return { success: true };
  },
});

// =============================================================================
// Respond to a tagged confession (Reject or Connect)
// =============================================================================
// Called by the tagged user to respond to a confession directed at them.
// - reject: Mark as handled, no DM created, confession remains visible
// - connect: Notify author for step 2 response (NO Discover boost - independent flow)
// =============================================================================
export const respondToTaggedConfession = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    action: v.union(v.literal('reject'), v.literal('connect')),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Get the confession
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found');
    }

    // Verify this user is the tagged user
    if (confession.taggedUserId !== userId) {
      throw new Error('Only the tagged user can respond to this confession');
    }

    // Check if already responded
    if (confession.taggedUserResponse && confession.taggedUserResponse !== 'pending') {
      throw new Error('You have already responded to this confession');
    }

    // Check if confession is deleted or expired
    const now = Date.now();
    if (confession.isDeleted) {
      throw new Error('This confession has been deleted');
    }
    if (confession.expiresAt && confession.expiresAt < now) {
      throw new Error('This confession has expired');
    }

    if (args.action === 'reject') {
      // REJECT: Mark as handled, no further action
      await ctx.db.patch(args.confessionId, {
        taggedUserResponse: 'rejected',
        taggedUserRespondedAt: now,
      });

      return { success: true, action: 'rejected' };
    } else {
      // CONNECT (Step 1): Tagged user is open to connect
      // Set authorResponse to 'pending' to signal author needs to respond
      // NO Discover boost - this flow is independent of Discover
      await ctx.db.patch(args.confessionId, {
        taggedUserResponse: 'connected',
        taggedUserRespondedAt: now,
        authorResponse: 'pending', // Signal author needs to respond
      });

      return { success: true, action: 'connected' };
    }
  },
});

// =============================================================================
// Author responds to tagged user's connect request (Step 2)
// =============================================================================
// - reject: No match created
// - connect: Create match and chat thread
// =============================================================================
export const authorRespondToConnect = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
    action: v.union(v.literal('reject'), v.literal('connect')),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Get the confession
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found');
    }

    // Verify this user is the author
    if (confession.userId !== userId) {
      throw new Error('Only the confession author can respond');
    }

    // Verify tagged user has connected (step 1 complete)
    if (confession.taggedUserResponse !== 'connected') {
      throw new Error('Tagged user has not connected yet');
    }

    // Check if author already responded
    if (confession.authorResponse && confession.authorResponse !== 'pending') {
      throw new Error('You have already responded');
    }

    // Check if confession is deleted or expired
    const now = Date.now();
    if (confession.isDeleted) {
      throw new Error('This confession has been deleted');
    }
    if (confession.expiresAt && confession.expiresAt < now) {
      throw new Error('This confession has expired');
    }

    if (args.action === 'reject') {
      // REJECT: Mark as handled, no match created
      await ctx.db.patch(args.confessionId, {
        authorResponse: 'rejected',
        authorRespondedAt: now,
      });

      return { success: true, action: 'rejected', matchCreated: false };
    } else {
      // CONNECT (Step 2): Both users want to connect - create match!
      const taggedUserId = confession.taggedUserId;
      if (!taggedUserId) {
        throw new Error('No tagged user found');
      }

      // Check for existing match between these users (idempotency)
      const existingMatch = await ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('user2Id'), taggedUserId))
        .first();

      const existingMatchReverse = await ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', taggedUserId))
        .filter((q) => q.eq(q.field('user2Id'), userId))
        .first();

      let matchId: any = existingMatch?._id || existingMatchReverse?._id;

      if (!matchId) {
        // Create new match
        matchId = await ctx.db.insert('matches', {
          user1Id: userId,
          user2Id: taggedUserId,
          matchedAt: now,
          isActive: true,
          matchSource: 'confession', // Track that this came from confession connect
        });
      }

      // Update confession
      await ctx.db.patch(args.confessionId, {
        authorResponse: 'connected',
        authorRespondedAt: now,
      });

      return { success: true, action: 'connected', matchCreated: true, matchId };
    }
  },
});

// =============================================================================
// Get eligible tag targets for confession tagging
// =============================================================================
// Returns users that the current user can tag in a confession:
// - Matched users (mutual likes)
// - Users the current user has liked (one-way)
// Excludes: self, blocked users, inactive users
// =============================================================================
export const getEligibleTagTargets = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve userId
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return [];

    // Get blocked users (bidirectional)
    const [myBlocks, blocksOnMe] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
    ]);
    const blockedUserIds = new Set([
      ...myBlocks.map((b) => b.blockedUserId as string),
      ...blocksOnMe.map((b) => b.blockerId as string),
    ]);

    // Collect unique target user IDs
    const targetUserIds = new Set<string>();

    // 1. Get matched users
    const [matchesAsUser1, matchesAsUser2] = await Promise.all([
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
    ]);

    for (const match of [...matchesAsUser1, ...matchesAsUser2]) {
      const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
      if (!blockedUserIds.has(otherUserId as string)) {
        targetUserIds.add(otherUserId as string);
      }
    }

    // 2. Get users I've liked (like, super_like, text)
    const likes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .filter((q) =>
        q.or(
          q.eq(q.field('action'), 'like'),
          q.eq(q.field('action'), 'super_like'),
          q.eq(q.field('action'), 'text')
        )
      )
      .collect();

    for (const like of likes) {
      if (!blockedUserIds.has(like.toUserId as string)) {
        targetUserIds.add(like.toUserId as string);
      }
    }

    // Remove self
    targetUserIds.delete(userId as string);

    if (targetUserIds.size === 0) return [];

    // Batch fetch user profiles and photos
    const userIdArray = Array.from(targetUserIds);
    const [users, photos] = await Promise.all([
      Promise.all(userIdArray.map((id) => ctx.db.get(id as Id<'users'>))),
      Promise.all(
        userIdArray.map((id) =>
          ctx.db
            .query('photos')
            .withIndex('by_user', (q) => q.eq('userId', id as Id<'users'>))
            .filter((q) => q.eq(q.field('isPrimary'), true))
            .first()
        )
      ),
    ]);

    // Build result with minimal fields
    const result: { id: string; name: string; photoUrl: string | null }[] = [];
    for (let i = 0; i < userIdArray.length; i++) {
      const user = users[i];
      if (!user || !user.isActive) continue;

      result.push({
        id: userIdArray[i],
        name: user.name || 'Unknown',
        photoUrl: photos[i]?.url || null,
      });
    }

    // Sort alphabetically by name
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  },
});

// =============================================================================
// One-time Profile Preview for Tagged Users
// =============================================================================
// When a tagged user views the confessor's profile, they consume their one-time
// preview. This is persisted on the confession record itself for durability.
// =============================================================================

// Query to check if preview has been consumed for a confession
export const isPreviewConsumed = query({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return false;

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) return false;

    // Only the tagged user can have preview status
    if (confession.taggedUserId !== userId) return false;

    // Preview is consumed if previewConsumedAt is set and matches this user
    return !!(confession.previewConsumedAt && confession.previewConsumedBy === userId);
  },
});

// Mutation to consume the one-time profile preview
export const consumePreview = mutation({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found');
    }

    // Only the tagged user can consume the preview
    if (confession.taggedUserId !== userId) {
      throw new Error('Only the tagged user can view this profile');
    }

    // Check if confession is deleted or expired
    const now = Date.now();
    if (confession.isDeleted) {
      throw new Error('This confession has been deleted');
    }
    if (confession.expiresAt && confession.expiresAt < now) {
      throw new Error('This confession has expired');
    }

    // Idempotent: if already consumed by this user, return success
    if (confession.previewConsumedAt && confession.previewConsumedBy === userId) {
      return { success: true, alreadyConsumed: true };
    }

    // Consume the preview
    await ctx.db.patch(args.confessionId, {
      previewConsumedAt: now,
      previewConsumedBy: userId,
    });

    return { success: true, alreadyConsumed: false };
  },
});

// =============================================================================
// Edit own reply
// =============================================================================
// Users can edit their own replies. Validates content and updates editedAt timestamp.
// =============================================================================
export const editReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) {
      throw new Error('Reply not found.');
    }
    if (reply.userId !== userId) {
      throw new Error('You can only edit your own replies.');
    }

    // FIX 5: Block editing if reply has active connect request
    if (reply.hasActiveConnectRequest) {
      throw new Error('Cannot edit reply with active connection request');
    }

    // Validate text
    const trimmed = args.text.trim();
    if (trimmed.length < 1) {
      throw new Error('Reply cannot be empty.');
    }
    if (trimmed.length > 300) {
      throw new Error('Reply must be 300 characters or less.');
    }

    // PII validation
    const piiCheck = containsPII(trimmed);
    if (piiCheck.hasPII) {
      throw new Error(`Do not include ${piiCheck.type}. Keep it anonymous!`);
    }

    // Update the reply
    await ctx.db.patch(args.replyId, {
      text: trimmed,
      editedAt: Date.now(),
    });

    return { success: true };
  },
});

// =============================================================================
// Report a reply
// =============================================================================
// Users can report other users' replies for moderation review.
// =============================================================================
export const reportReply = mutation({
  args: {
    replyId: v.id('confessionReplies'),
    reporterId: v.union(v.id('users'), v.string()),
    reason: v.union(
      v.literal('spam'),
      v.literal('harassment'),
      v.literal('hate'),
      v.literal('sexual'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const reporterId = await ensureUserByAuthId(ctx, args.reporterId as string);

    const reply = await ctx.db.get(args.replyId);
    if (!reply) {
      throw new Error('Reply not found.');
    }

    // Cannot report own replies
    if (reply.userId === reporterId) {
      throw new Error('You cannot report your own reply.');
    }

    // Check if already reported by this user
    const existingReport = await ctx.db
      .query('replyReports')
      .withIndex('by_reply', (q) => q.eq('replyId', args.replyId))
      .filter((q) => q.eq(q.field('reporterId'), reporterId))
      .first();

    if (existingReport) {
      // Already reported - return success (idempotent)
      return { success: true, alreadyReported: true };
    }

    // Create report record
    await ctx.db.insert('replyReports', {
      replyId: args.replyId,
      confessionId: reply.confessionId,
      reporterId: reporterId,
      reportedUserId: reply.userId,
      reason: args.reason,
      description: args.description,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true, alreadyReported: false };
  },
});

// =============================================================================
// COMMENT-BASED CONFESSION CONNECTION
// =============================================================================
// Allows confession authors (OP) to request a connection with anonymous commenters.
// Flow: OP sees a reply they like → sends connect request → commenter accepts/rejects
// If accepted, a match is created and both users can start chatting.
//
// CRITICAL RULES ENFORCED:
// 1. ONE active request per confession (pending/accepted blocks new requests)
// 2. Race condition prevention via atomic checks
// 3. Cannot request same user twice for same confession
// 4. 24h expiry on pending requests (allows OP to choose again after expiry)
// 5. Tagged confession connect flow blocks comment-based connect
// 6. Reply cannot be edited/deleted after request is sent
// =============================================================================

const COMMENT_CONNECT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Helper: Check if any active (pending/accepted) request exists for a confession
async function hasActiveCommentConnect(
  ctx: MutationCtx,
  confessionId: Id<'confessions'>
): Promise<{ hasActive: boolean; activeRequest?: any }> {
  const now = Date.now();

  // Get all requests for this confession
  const allRequests = await ctx.db
    .query('confessionCommentConnects')
    .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
    .collect();

  // Check for any pending (non-expired) or accepted request
  for (const req of allRequests) {
    if (req.status === 'accepted') {
      return { hasActive: true, activeRequest: req };
    }
    if (req.status === 'pending' && req.expiresAt > now) {
      return { hasActive: true, activeRequest: req };
    }
  }

  return { hasActive: false };
}

// Helper: Auto-expire pending requests that have passed 24h
// HARDENING FIX 2: Also clears hasActiveConnectRequest flag on associated replies
async function expirePendingRequests(
  ctx: MutationCtx,
  confessionId: Id<'confessions'>
): Promise<number> {
  const now = Date.now();
  let expiredCount = 0;

  const pendingRequests = await ctx.db
    .query('confessionCommentConnects')
    .withIndex('by_confession', (q) => q.eq('confessionId', confessionId))
    .filter((q) => q.eq(q.field('status'), 'pending'))
    .collect();

  for (const req of pendingRequests) {
    if (req.expiresAt <= now) {
      // Mark request as expired
      await ctx.db.patch(req._id, { status: 'expired' });
      expiredCount++;

      // HARDENING FIX 2: Clear the lock on the reply
      const reply = await ctx.db.get(req.replyId);
      if (reply && reply.hasActiveConnectRequest) {
        await ctx.db.patch(req.replyId, { hasActiveConnectRequest: false });
      }
    }
  }

  return expiredCount;
}

// Request to connect with a commenter (OP only)
export const requestCommentConnect = mutation({
  args: {
    confessionId: v.id('confessions'),
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()), // OP's userId
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);
    const now = Date.now();

    // Get the confession
    const confession = await ctx.db.get(args.confessionId);
    if (!confession) {
      throw new Error('Confession not found');
    }

    // Verify the user is the confession author (OP)
    if (confession.userId !== userId) {
      throw new Error('Only the confession author can request connections');
    }

    // Check if confession is deleted or expired
    if (confession.isDeleted) {
      throw new Error('This confession has been deleted');
    }
    if (confession.expiresAt && confession.expiresAt < now) {
      throw new Error('This confession has expired');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 7: BLOCK TAG FLOW CONFLICT
    // ═══════════════════════════════════════════════════════════════════════════
    // If this is a tagged confession and tagged user has connected or author is pending,
    // block comment-based connect entirely
    if (confession.taggedUserId) {
      const taggedResponse = confession.taggedUserResponse;
      const authorResponse = confession.authorResponse;

      // If tagged flow is active (connected or pending), block comment connect
      if (taggedResponse === 'connected' || authorResponse === 'pending' || authorResponse === 'connected') {
        throw new Error('Cannot use comment connect when tagged connect is active');
      }
    }

    // Get the reply
    const reply = await ctx.db.get(args.replyId);
    if (!reply) {
      throw new Error('Reply not found');
    }

    // Verify the reply belongs to this confession
    if (reply.confessionId !== args.confessionId) {
      throw new Error('Reply does not belong to this confession');
    }

    // Cannot connect with yourself
    if (reply.userId === userId) {
      throw new Error('Cannot connect with your own reply');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 4: AUTO-EXPIRE PENDING REQUESTS
    // ═══════════════════════════════════════════════════════════════════════════
    // First, expire any pending requests that have passed 24h
    await expirePendingRequests(ctx, args.confessionId);

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 1 & 2: ONE ACTIVE REQUEST PER CONFESSION (with race condition guard)
    // ═══════════════════════════════════════════════════════════════════════════
    // Check if any active (pending/accepted) request exists for this confession
    const { hasActive, activeRequest } = await hasActiveCommentConnect(ctx, args.confessionId);

    if (hasActive) {
      // If this exact reply already has the active request, return idempotent
      if (activeRequest.replyId === args.replyId) {
        return {
          success: true,
          alreadyRequested: true,
          status: activeRequest.status,
          connectId: activeRequest._id,
        };
      }
      // Otherwise, block - can only have ONE active request per confession
      throw new Error('You already have an active connection request for this confession');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 3: BLOCK REPEATED REQUEST TO SAME USER
    // ═══════════════════════════════════════════════════════════════════════════
    // Check if we already sent a request to this user for this confession (any status)
    const existingToUser = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_confession_to_user', (q) =>
        q.eq('confessionId', args.confessionId).eq('toUserId', reply.userId)
      )
      .first();

    if (existingToUser) {
      // If it's expired or rejected, we COULD allow re-request, but for now block
      // to prevent harassment. OP must wait for expiry of active request.
      if (existingToUser.status === 'pending' || existingToUser.status === 'accepted') {
        return {
          success: true,
          alreadyRequested: true,
          status: existingToUser.status,
          connectId: existingToUser._id,
        };
      }
      // Rejected/expired - user already declined, do not allow re-request
      if (existingToUser.status === 'rejected') {
        throw new Error('This user has already declined your connection request');
      }
      // Expired - allow new request (fall through)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ONE PAIR, ONE CONNECTION: Check pair eligibility (replaces block + match checks)
    // ═══════════════════════════════════════════════════════════════════════════
    // If users have ANY prior Phase-1 history (blocks, matches, likes, etc.), block connect
    const isEligible = await isPairEligibleForPhase(ctx, userId, reply.userId, 'phase1');
    if (!isEligible) {
      throw new Error('Cannot connect with this user');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING FIX 1: ATOMIC + IDEMPOTENT REQUEST CREATION
    // ═══════════════════════════════════════════════════════════════════════════
    // Convex mutations are serializable - concurrent calls are executed sequentially.
    // This final check ensures we don't create duplicates even under retry scenarios.
    const finalCheck = await hasActiveCommentConnect(ctx, args.confessionId);
    if (finalCheck.hasActive) {
      // IDEMPOTENT: If active request exists for same reply, return it
      if (finalCheck.activeRequest.replyId === args.replyId) {
        return {
          success: true,
          alreadyRequested: true,
          status: finalCheck.activeRequest.status,
          connectId: finalCheck.activeRequest._id,
          expiresAt: finalCheck.activeRequest.expiresAt,
        };
      }
      // Different reply - cannot have multiple active requests
      throw new Error('You already have an active connection request for this confession');
    }

    // Create the connection request with 24h expiry
    const expiresAt = now + COMMENT_CONNECT_EXPIRY_MS;
    const connectId = await ctx.db.insert('confessionCommentConnects', {
      confessionId: args.confessionId,
      replyId: args.replyId,
      fromUserId: userId,
      toUserId: reply.userId,
      status: 'pending',
      createdAt: now,
      expiresAt,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING FIX 1: POST-INSERT VERIFICATION (belt + suspenders)
    // ═══════════════════════════════════════════════════════════════════════════
    // Verify we don't have duplicate active requests after insert
    // This catches any edge case where concurrent requests might have both passed
    const allActive = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'accepted')
        )
      )
      .collect();

    // Filter to only valid pending (not expired)
    const validActive = allActive.filter((r) =>
      r.status === 'accepted' || (r.status === 'pending' && r.expiresAt > now)
    );

    if (validActive.length > 1) {
      // Multiple active requests detected - keep oldest, delete newest (ours)
      const oldest = validActive.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      if (oldest._id !== connectId) {
        // Our request is not the oldest - delete it and return the existing one
        await ctx.db.delete(connectId);
        return {
          success: true,
          alreadyRequested: true,
          status: oldest.status,
          connectId: oldest._id,
          expiresAt: oldest.expiresAt,
        };
      }
      // Our request is the oldest - delete the others
      for (const req of validActive) {
        if (req._id !== connectId) {
          await ctx.db.delete(req._id);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 5: LOCK THE REPLY (mark as having active connection request)
    // ═══════════════════════════════════════════════════════════════════════════
    // Mark the reply as locked (cannot be edited/deleted)
    await ctx.db.patch(args.replyId, {
      hasActiveConnectRequest: true,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 4: CREATE NOTIFICATION FOR COMMENTER
    // ═══════════════════════════════════════════════════════════════════════════
    await ctx.db.insert('notifications', {
      userId: reply.userId,
      type: 'comment_connect',
      title: 'Connection Request',
      body: 'Someone wants to connect based on your confession reply!',
      data: {
        confessionId: args.confessionId as string,
        connectId: connectId as string,
      },
      dedupeKey: `comment_connect:${connectId}`,
      createdAt: now,
      expiresAt, // Same expiry as the connect request (24h)
    });

    return {
      success: true,
      alreadyRequested: false,
      status: 'pending',
      connectId,
      expiresAt,
    };
  },
});

// Respond to a comment connection request (commenter only)
export const respondToCommentConnect = mutation({
  args: {
    connectId: v.id('confessionCommentConnects'),
    userId: v.union(v.id('users'), v.string()), // Commenter's userId
    action: v.union(v.literal('accept'), v.literal('reject')),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await ensureUserByAuthId(ctx, args.userId as string);

    // Get the connection request
    const connect = await ctx.db.get(args.connectId);
    if (!connect) {
      throw new Error('Connection request not found');
    }

    // Verify this user is the recipient (commenter)
    if (connect.toUserId !== userId) {
      throw new Error('Only the recipient can respond to this request');
    }

    // Check if already responded
    if (connect.status !== 'pending') {
      return {
        success: true,
        alreadyResponded: true,
        status: connect.status,
        matchId: connect.matchId,
      };
    }

    const now = Date.now();

    // FIX 4: Check if request has expired (24h limit)
    if (connect.expiresAt && connect.expiresAt <= now) {
      // Mark as expired
      await ctx.db.patch(args.connectId, {
        status: 'expired',
        respondedAt: now,
      });
      // Clear the lock on the reply
      const reply = await ctx.db.get(connect.replyId);
      if (reply && reply.hasActiveConnectRequest) {
        await ctx.db.patch(connect.replyId, { hasActiveConnectRequest: false });
      }
      return {
        success: false,
        expired: true,
        message: 'This connection request has expired',
      };
    }

    if (args.action === 'reject') {
      // REJECT: Mark as rejected, no match created
      await ctx.db.patch(args.connectId, {
        status: 'rejected',
        respondedAt: now,
      });

      // Clear the lock on the reply so OP can try another comment
      const reply = await ctx.db.get(connect.replyId);
      if (reply && reply.hasActiveConnectRequest) {
        await ctx.db.patch(connect.replyId, { hasActiveConnectRequest: false });
      }

      return { success: true, action: 'rejected', matchCreated: false };
    } else {
      // ACCEPT: Create match!
      const fromUserId = connect.fromUserId;

      // Check if bidirectionally blocked (may have changed since request)
      const isBlocked = await isBlockedBidirectional(ctx, fromUserId, userId);
      if (isBlocked) {
        // Mark as rejected due to block
        await ctx.db.patch(args.connectId, {
          status: 'rejected',
          respondedAt: now,
        });
        throw new Error('Cannot connect due to block status');
      }

      // Check for existing match between these users (idempotency)
      const existingMatch = await ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', fromUserId))
        .filter((q) => q.eq(q.field('user2Id'), userId))
        .first();

      const existingMatchReverse = await ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('user2Id'), fromUserId))
        .first();

      let matchId: any = existingMatch?._id || existingMatchReverse?._id;

      if (!matchId) {
        // Create new match
        matchId = await ctx.db.insert('matches', {
          user1Id: fromUserId,
          user2Id: userId,
          matchedAt: now,
          isActive: true,
          matchSource: 'confession_comment', // Track that this came from comment connect
        });
      }

      // Update connection request
      await ctx.db.patch(args.connectId, {
        status: 'accepted',
        respondedAt: now,
        matchId,
      });

      // FIX 1: Return the other user's ID for match-celebration navigation
      return {
        success: true,
        action: 'accepted',
        matchCreated: true,
        matchId,
        otherUserId: fromUserId, // The confession author (OP)
      };
    }
  },
});

// Query: Get connection status for a specific reply (for OP to see if they've requested)
export const getCommentConnectStatus = query({
  args: {
    confessionId: v.id('confessions'),
    replyId: v.id('confessionReplies'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return null;

    const connect = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_confession_reply', (q) =>
        q.eq('confessionId', args.confessionId).eq('replyId', args.replyId)
      )
      .first();

    if (!connect) return null;

    // Return status if user is the requester (OP) or recipient (commenter)
    if (connect.fromUserId !== userId && connect.toUserId !== userId) {
      return null; // Not involved in this connection
    }

    return {
      connectId: connect._id,
      status: connect.status,
      isRequester: connect.fromUserId === userId,
      isRecipient: connect.toUserId === userId,
      matchId: connect.matchId,
      createdAt: connect.createdAt,
      respondedAt: connect.respondedAt,
    };
  },
});

// Query: Get pending connection requests for a user (commenter view)
// HARDENING FIX 4: Also check request expiry
export const getPendingCommentConnects = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return [];

    const now = Date.now();

    // Get pending connection requests where this user is the recipient
    const pendingConnects = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_to_user_status', (q) =>
        q.eq('toUserId', userId).eq('status', 'pending')
      )
      .collect();

    // Enrich with confession and reply data
    const result = [];
    for (const connect of pendingConnects) {
      // HARDENING FIX 4: Skip if request itself is expired (24h limit)
      if (connect.expiresAt && connect.expiresAt <= now) continue;

      // Get the confession
      const confession = await ctx.db.get(connect.confessionId);
      if (!confession) continue;

      // Skip expired or deleted confessions
      if (confession.isDeleted) continue;
      if (confession.expiresAt && confession.expiresAt < now) continue;

      // Get the reply (user's own reply)
      const reply = await ctx.db.get(connect.replyId);
      if (!reply) continue;

      result.push({
        connectId: connect._id,
        confessionId: connect.confessionId,
        replyId: connect.replyId,
        confessionText: confession.text,
        confessionMood: confession.mood,
        replyText: reply.text,
        requestedAt: connect.createdAt,
        expiresAt: connect.expiresAt, // Include expiry for UI display
      });
    }

    // Sort by most recent first
    result.sort((a, b) => b.requestedAt - a.requestedAt);

    return result;
  },
});

// Query: Get badge count of pending comment connect requests
// HARDENING FIX 4: Also check request expiry, not just confession expiry
export const getPendingCommentConnectCount = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return 0;

    const pendingConnects = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_to_user_status', (q) =>
        q.eq('toUserId', userId).eq('status', 'pending')
      )
      .collect();

    // HARDENING FIX 4: Filter to only non-expired requests and confessions
    const now = Date.now();
    let count = 0;
    for (const connect of pendingConnects) {
      // Skip if request itself is expired (24h limit)
      if (connect.expiresAt && connect.expiresAt <= now) continue;

      const confession = await ctx.db.get(connect.confessionId);
      if (!confession) continue;
      if (confession.isDeleted) continue;
      if (confession.expiresAt && confession.expiresAt < now) continue;
      count++;
    }

    return count;
  },
});

// Query: Get connection statuses for all replies in a confession (batch for efficiency)
// FIX 6: Also returns activeReplyId to enable UI lock (hide connect on non-selected replies)
export const getCommentConnectStatusesForConfession = query({
  args: {
    confessionId: v.id('confessions'),
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Map authUserId -> Convex Id<"users">
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return { statusMap: {}, activeReplyId: null, hasActiveRequest: false, alreadyConnectedUserIds: [] };

    const now = Date.now();

    // Get all connection requests for this confession
    const connects = await ctx.db
      .query('confessionCommentConnects')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // Build a map of replyId -> status for quick lookup
    const statusMap: Record<string, {
      connectId: string;
      status: 'pending' | 'accepted' | 'rejected' | 'expired';
      isRequester: boolean;
      isRecipient: boolean;
      matchId?: string;
      expiresAt?: number;
    }> = {};

    // FIX 6: Track active request for UI lock
    let activeReplyId: string | null = null;
    let hasActiveRequest = false;

    for (const connect of connects) {
      // Determine effective status (treat expired pending as 'expired')
      let effectiveStatus = connect.status;
      if (connect.status === 'pending' && connect.expiresAt && connect.expiresAt <= now) {
        effectiveStatus = 'expired';
      }

      // Track active requests (for UI lock - applies to all users viewing)
      if (effectiveStatus === 'accepted' || effectiveStatus === 'pending') {
        activeReplyId = connect.replyId as string;
        hasActiveRequest = true;
      }

      // Only include in statusMap if user is involved
      if (connect.fromUserId !== userId && connect.toUserId !== userId) continue;

      statusMap[connect.replyId as string] = {
        connectId: connect._id as string,
        status: effectiveStatus,
        isRequester: connect.fromUserId === userId,
        isRecipient: connect.toUserId === userId,
        matchId: connect.matchId as string | undefined,
        expiresAt: connect.expiresAt,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ONE PAIR, ONE CONNECTION: Return ineligible commenter IDs
    // ═══════════════════════════════════════════════════════════════════════════
    // Get all replies on this confession to find unique commenter IDs
    const replies = await ctx.db
      .query('confessionReplies')
      .withIndex('by_confession', (q) => q.eq('confessionId', args.confessionId))
      .collect();

    // Get unique commenter user IDs (excluding self)
    const commenterUserIds = [...new Set(
      replies
        .filter((r) => r.userId !== userId)
        .map((r) => r.userId)
    )];

    // Check which commenters are ineligible (have any prior relationship with OP)
    const ineligibleUserIds: string[] = [];
    for (const commenterId of commenterUserIds) {
      const isEligible = await isPairEligibleForPhase(ctx, userId, commenterId, 'phase1');
      if (!isEligible) {
        ineligibleUserIds.push(commenterId as string);
      }
    }

    // Keep alreadyConnectedUserIds for backward compatibility (alias)
    return { statusMap, activeReplyId, hasActiveRequest, alreadyConnectedUserIds: ineligibleUserIds };
  },
});
