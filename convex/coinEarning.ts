/**
 * coinEarning.ts - Anti-spam coin earning system
 *
 * Rewards meaningful chat interaction, not spam.
 *
 * GROUP CHAT LOGIC:
 * - When User B sends a message, check if User A sent recently
 * - If yes, User A gets a coin (their message created engagement)
 * - User B can also get a coin for participating (if not in cooldown)
 * - Pair farming prevention: limit coins between same two users
 *
 * 1-ON-1 DM LOGIC:
 * - Same interaction-based approach as group chats
 *
 * ANTI-SPAM RULES:
 * 1. Two-way interaction required: Coins only when interaction happens
 * 2. Cooldown: Max 1 coin per 12 seconds per user (global)
 * 3. Per-context cap: Max 20 coins per hour per user per room/conversation
 * 4. Pair cap: Max 5 coins per hour between same two users (anti-farming)
 * 5. Spam filter: No reward for repeated/short spam messages
 * 6. Private rooms excluded: No coins in private chat rooms
 *
 * All rules enforced server-side (Convex backend).
 */

import { MutationCtx } from './_generated/server';
import { Id } from './_generated/dataModel';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Cooldown: 12 seconds between coin earnings (per user, global)
const COOLDOWN_MS = 12_000;

// Per-context cap: 20 coins per hour per user per room/conversation
const HOURLY_CAP_PER_CONTEXT = 20;

// Per-pair cap: 5 coins per hour between same two users (anti-farming)
const HOURLY_CAP_PER_PAIR = 5;

const ONE_HOUR_MS = 60 * 60 * 1000;

// Interaction time window: 90 seconds (must reply within this time to trigger coin)
const INTERACTION_WINDOW_MS = 90_000;

// Spam detection thresholds
const MIN_MESSAGE_LENGTH = 3; // Messages shorter than this don't earn
const SPAM_PATTERNS = [
  /^(hi+|hey+|ok+|lol+|haha+|hmm+|yes+|no+|ya+|yea+|yeah+|yo+|sup+|k+|kk+|gg+|ty+|thx+|np+)$/i,
  /^(.)\1+$/, // Repeated single character (e.g., "aaaa", "???")
  /^[.!?,]+$/, // Only punctuation
  /^[\s]+$/, // Only whitespace
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple hash function for message content (for duplicate detection)
 */
function hashMessage(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if message content looks like spam
 */
function isSpamMessage(text: string | undefined): boolean {
  if (!text) return true; // No text = no coin (media-only)

  const trimmed = text.trim();

  // Too short
  if (trimmed.length < MIN_MESSAGE_LENGTH) return true;

  // Matches spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Create a canonical pair key for two users (order-independent)
 */
function createPairKey(userId1: Id<'users'>, userId2: Id<'users'>): string {
  const ids = [userId1 as string, userId2 as string].sort();
  return `${ids[0]}:${ids[1]}`;
}

/**
 * Check if user is in cooldown (earned a coin within COOLDOWN_MS)
 */
async function isInCooldown(ctx: MutationCtx, userId: Id<'users'>, now: number): Promise<boolean> {
  const recentEarning = await ctx.db
    .query('coinEarningLog')
    .withIndex('by_user_earned', (q) =>
      q.eq('userId', userId).gt('earnedAt', now - COOLDOWN_MS)
    )
    .first();
  return !!recentEarning;
}

/**
 * Check if user has reached hourly cap in a specific context
 */
async function hasReachedContextCap(
  ctx: MutationCtx,
  userId: Id<'users'>,
  contextType: 'room' | 'dm',
  contextId: string,
  now: number
): Promise<boolean> {
  const hourAgo = now - ONE_HOUR_MS;
  const earnings = await ctx.db
    .query('coinEarningLog')
    .withIndex('by_user_context', (q) =>
      q.eq('userId', userId).eq('contextType', contextType).eq('contextId', contextId)
    )
    .filter((q) => q.gt(q.field('earnedAt'), hourAgo))
    .collect();
  return earnings.length >= HOURLY_CAP_PER_CONTEXT;
}

/**
 * Check if pair has reached hourly interaction cap (anti-farming)
 */
async function hasReachedPairCap(
  ctx: MutationCtx,
  userId: Id<'users'>,
  otherUserId: Id<'users'>,
  contextType: 'room' | 'dm',
  contextId: string,
  now: number
): Promise<boolean> {
  const hourAgo = now - ONE_HOUR_MS;
  // Check earnings where this user got coin from interaction with otherUser
  const earnings = await ctx.db
    .query('coinEarningLog')
    .withIndex('by_user_context', (q) =>
      q.eq('userId', userId).eq('contextType', contextType).eq('contextId', contextId)
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('otherUserId'), otherUserId),
        q.gt(q.field('earnedAt'), hourAgo)
      )
    )
    .collect();
  return earnings.length >= HOURLY_CAP_PER_PAIR;
}

/**
 * Check for duplicate message hash (repeated messages)
 */
async function hasDuplicateMessage(
  ctx: MutationCtx,
  userId: Id<'users'>,
  contextType: 'room' | 'dm',
  contextId: string,
  messageHash: string,
  now: number
): Promise<boolean> {
  const hourAgo = now - ONE_HOUR_MS;
  const duplicate = await ctx.db
    .query('coinEarningLog')
    .withIndex('by_user_context', (q) =>
      q.eq('userId', userId).eq('contextType', contextType).eq('contextId', contextId)
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('messageHash'), messageHash),
        q.gt(q.field('earnedAt'), hourAgo)
      )
    )
    .first();
  return !!duplicate;
}

/**
 * Award a coin to a user and log the earning
 */
async function awardCoin(
  ctx: MutationCtx,
  userId: Id<'users'>,
  contextType: 'room' | 'dm',
  contextId: string,
  otherUserId: Id<'users'> | undefined,
  messageHash: string | undefined,
  now: number
): Promise<void> {
  // Log the earning
  await ctx.db.insert('coinEarningLog', {
    userId,
    contextType,
    contextId,
    otherUserId,
    earnedAt: now,
    messageHash,
  });

  // Add coin to user's wallet
  const user = await ctx.db.get(userId);
  if (user) {
    const currentCoins = user.walletCoins ?? 0;
    await ctx.db.patch(userId, { walletCoins: currentCoins + 1 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP CHAT COIN EARNING
// ═══════════════════════════════════════════════════════════════════════════

interface RoomCoinEarnParams {
  ctx: MutationCtx;
  senderId: Id<'users'>;
  roomId: Id<'chatRooms'>;
  messageText: string | undefined;
  isPublicRoom: boolean;
}

/**
 * Process coin earning for a message in a group chat room.
 *
 * INTERACTION-BASED LOGIC:
 * 1. When User B sends a message, find the most recent message from a different user (User A)
 * 2. If User A's message is within INTERACTION_WINDOW_MS, User A gets a coin (engagement reward)
 * 3. User B can also get a coin for participating (if all checks pass)
 *
 * Requirements:
 * - Room must be public (no coins in private rooms)
 * - Message must not be spam
 * - Users must pass cooldown, context cap, and pair cap checks
 */
export async function tryEarnCoinInRoom(params: RoomCoinEarnParams): Promise<{
  previousSenderRewarded: boolean;
  currentSenderRewarded: boolean;
}> {
  const { ctx, senderId, roomId, messageText, isPublicRoom } = params;
  const now = Date.now();
  const result = { previousSenderRewarded: false, currentSenderRewarded: false };

  // Rule: No coins in private rooms
  if (!isPublicRoom) {
    return result;
  }

  // Rule: Spam filter for current message
  if (isSpamMessage(messageText)) {
    return result;
  }

  const roomIdStr = roomId as string;
  const msgHash = messageText ? hashMessage(messageText) : undefined;

  // Find the most recent message from a DIFFERENT user (within interaction window)
  const recentOtherMessages = await ctx.db
    .query('chatRoomMessages')
    .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
    .order('desc')
    .filter((q) =>
      q.and(
        q.neq(q.field('senderId'), senderId),
        q.gt(q.field('createdAt'), now - INTERACTION_WINDOW_MS),
        // Exclude deleted messages
        q.eq(q.field('deletedAt'), undefined)
      )
    )
    .take(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // REWARD PREVIOUS SENDER (User A) - They got engagement!
  // ═══════════════════════════════════════════════════════════════════════════
  if (recentOtherMessages.length > 0) {
    const previousMessage = recentOtherMessages[0];
    const previousSenderId = previousMessage.senderId;

    // Check if previous sender can receive a coin
    const canReward =
      // Not in cooldown
      !(await isInCooldown(ctx, previousSenderId, now)) &&
      // Not reached hourly cap in this room
      !(await hasReachedContextCap(ctx, previousSenderId, 'room', roomIdStr, now)) &&
      // Not reached pair cap with current sender
      !(await hasReachedPairCap(ctx, previousSenderId, senderId, 'room', roomIdStr, now));

    if (canReward) {
      await awardCoin(ctx, previousSenderId, 'room', roomIdStr, senderId, undefined, now);
      result.previousSenderRewarded = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REWARD CURRENT SENDER (User B) - They participated in interaction
  // Only if there was a previous message to respond to
  // ═══════════════════════════════════════════════════════════════════════════
  if (recentOtherMessages.length > 0) {
    const previousSenderId = recentOtherMessages[0].senderId;

    // Check if current sender can receive a coin
    const canReward =
      // Not in cooldown
      !(await isInCooldown(ctx, senderId, now)) &&
      // Not reached hourly cap in this room
      !(await hasReachedContextCap(ctx, senderId, 'room', roomIdStr, now)) &&
      // Not reached pair cap with previous sender
      !(await hasReachedPairCap(ctx, senderId, previousSenderId, 'room', roomIdStr, now)) &&
      // Not sending duplicate message
      (!msgHash || !(await hasDuplicateMessage(ctx, senderId, 'room', roomIdStr, msgHash, now)));

    if (canReward) {
      await awardCoin(ctx, senderId, 'room', roomIdStr, previousSenderId, msgHash, now);
      result.currentSenderRewarded = true;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1-ON-1 DM COIN EARNING
// ═══════════════════════════════════════════════════════════════════════════

interface DmCoinEarnParams {
  ctx: MutationCtx;
  senderId: Id<'users'>;
  recipientId: Id<'users'>;
  conversationId: Id<'conversations'>;
  messageText: string;
}

/**
 * Process coin earning for a message in a 1-on-1 DM.
 *
 * INTERACTION-BASED LOGIC:
 * 1. When User B sends a message, check if User A sent recently
 * 2. If yes, User A gets a coin (their message got engagement)
 * 3. User B can also get a coin for participating
 *
 * Requirements:
 * - Message must not be spam
 * - Users must pass cooldown, context cap, and pair cap checks
 */
export async function tryEarnCoinInDm(params: DmCoinEarnParams): Promise<{
  previousSenderRewarded: boolean;
  currentSenderRewarded: boolean;
}> {
  const { ctx, senderId, recipientId, conversationId, messageText } = params;
  const now = Date.now();
  const result = { previousSenderRewarded: false, currentSenderRewarded: false };

  // Rule: Spam filter
  if (isSpamMessage(messageText)) {
    return result;
  }

  const conversationIdStr = conversationId as string;
  const msgHash = hashMessage(messageText);

  // Find the most recent message from the OTHER user (within interaction window)
  const recentRecipientMessages = await ctx.db
    .query('messages')
    .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId))
    .order('desc')
    .filter((q) =>
      q.and(
        q.eq(q.field('senderId'), recipientId),
        q.gt(q.field('createdAt'), now - INTERACTION_WINDOW_MS)
      )
    )
    .take(1);

  // ═══════════════════════════════════════════════════════════════════════════
  // REWARD PREVIOUS SENDER (Recipient) - They got engagement!
  // ═══════════════════════════════════════════════════════════════════════════
  if (recentRecipientMessages.length > 0) {
    // Check if recipient can receive a coin
    const canReward =
      // Not in cooldown
      !(await isInCooldown(ctx, recipientId, now)) &&
      // Not reached hourly cap in this conversation
      !(await hasReachedContextCap(ctx, recipientId, 'dm', conversationIdStr, now)) &&
      // Not reached pair cap with current sender
      !(await hasReachedPairCap(ctx, recipientId, senderId, 'dm', conversationIdStr, now));

    if (canReward) {
      await awardCoin(ctx, recipientId, 'dm', conversationIdStr, senderId, undefined, now);
      result.previousSenderRewarded = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REWARD CURRENT SENDER - They participated in interaction
  // Only if there was a previous message to respond to
  // ═══════════════════════════════════════════════════════════════════════════
  if (recentRecipientMessages.length > 0) {
    // Check if sender can receive a coin
    const canReward =
      // Not in cooldown
      !(await isInCooldown(ctx, senderId, now)) &&
      // Not reached hourly cap in this conversation
      !(await hasReachedContextCap(ctx, senderId, 'dm', conversationIdStr, now)) &&
      // Not reached pair cap with recipient
      !(await hasReachedPairCap(ctx, senderId, recipientId, 'dm', conversationIdStr, now)) &&
      // Not sending duplicate message
      !(await hasDuplicateMessage(ctx, senderId, 'dm', conversationIdStr, msgHash, now));

    if (canReward) {
      await awardCoin(ctx, senderId, 'dm', conversationIdStr, recipientId, msgHash, now);
      result.currentSenderRewarded = true;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP (optional - for data hygiene)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal function to clean up old coin earning logs (> 24 hours old).
 * Can be called periodically via cron job.
 */
export async function cleanupOldCoinLogs(ctx: MutationCtx): Promise<number> {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Fetch old logs (batch of 100)
  const oldLogs = await ctx.db
    .query('coinEarningLog')
    .filter((q) => q.lt(q.field('earnedAt'), oneDayAgo))
    .take(100);

  for (const log of oldLogs) {
    await ctx.db.delete(log._id);
  }

  return oldLogs.length;
}
