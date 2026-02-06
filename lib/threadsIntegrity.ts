/**
 * threadsIntegrity.ts — Pure helper module for message/thread categorization
 *
 * Single source of truth for:
 *   - Separating New Matches vs Message Threads vs Confession Threads
 *   - Filtering blocked users
 *   - Filtering expired confession threads
 *   - Deduplication
 *   - Sorting by recency
 *
 * This module is PURE: it takes raw state and returns computed results.
 * No store calls, no side effects.
 */

import type { DemoMatch } from '@/stores/demoStore';
import type { DemoDmMessage, DemoConversationMeta } from '@/stores/demoDmStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadsIntegrityInput {
  /** All matches from demoStore */
  matches: DemoMatch[];
  /** All conversations from demoDmStore */
  conversations: Record<string, DemoDmMessage[]>;
  /** All conversation metadata from demoDmStore */
  meta: Record<string, DemoConversationMeta>;
  /** Blocked user IDs from demoStore */
  blockedUserIds: string[];
  /** Current timestamp for expiry checks */
  now?: number;
  /** Current user ID for unread calculation */
  currentUserId?: string;
}

export interface ProcessedThread {
  id: string;
  conversationId: string;
  otherUser: {
    id: string;
    name: string;
    photoUrl?: string;
    lastActive: number;
    isVerified?: boolean;
  };
  lastMessage: {
    content: string;
    type: string;
    senderId: string;
    createdAt: number;
  } | null;
  unreadCount: number;
  isPreMatch: boolean;
  isConfessionChat: boolean;
  expiresAt?: number;
  /** Internal sort key — latest activity timestamp */
  _sortTs: number;
}

export interface ThreadsIntegrityOutput {
  /** Matches with 0 messages — shown in "New Matches" row */
  newMatches: ProcessedThread[];
  /** Threads with >= 1 message (excluding confession threads) */
  messageThreads: ProcessedThread[];
  /** Active (non-expired) confession threads */
  confessionThreads: ProcessedThread[];
  /** IDs of expired confession threads — caller should clean these */
  expiredThreadIds: string[];
  /** Total unread count across all visible threads */
  totalUnreadCount: number;
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Process raw store state and return categorized, filtered, deduplicated threads.
 *
 * Rules:
 *   - New Match: match exists AND messages.length === 0
 *   - Message Thread: messages.length >= 1 AND NOT confession thread
 *   - Confession Thread: meta.isConfessionChat === true AND NOT expired
 *   - Expired: isConfessionChat && expiresAt && expiresAt <= now
 *
 * Dedup:
 *   - Match-based lists: by otherUserId, keep newest activity
 *   - Confession threads: by conversationId (threadId)
 *
 * All blocked users are filtered out.
 */
export function processThreadsIntegrity(input: ThreadsIntegrityInput): ThreadsIntegrityOutput {
  const {
    matches,
    conversations,
    meta,
    blockedUserIds,
    now = Date.now(),
    currentUserId,
  } = input;

  const blockedSet = new Set(blockedUserIds);
  const newMatches: ProcessedThread[] = [];
  const messageThreads: ProcessedThread[] = [];
  const confessionThreads: ProcessedThread[] = [];
  const expiredThreadIds: string[] = [];

  // Track seen otherUserIds to dedupe match-based threads
  const seenUserIds = new Set<string>();
  // Track seen conversationIds to dedupe confession threads
  const seenConvoIds = new Set<string>();

  // First pass: collect all threads with their activity timestamps
  const allThreads: Array<{ thread: ProcessedThread; type: 'newMatch' | 'message' | 'confession' | 'expired' }> = [];

  for (const match of matches) {
    const otherUserId = match.otherUser?.id;
    const convoId = match.conversationId;

    // Skip if no user ID or blocked
    if (!otherUserId || blockedSet.has(otherUserId)) continue;

    const msgs = conversations[convoId] ?? [];
    const convoMeta = meta[convoId];
    const isConfession = convoMeta?.isConfessionChat === true;
    const expiresAt = convoMeta?.expiresAt;
    const isExpired = isConfession && expiresAt != null && expiresAt <= now;

    // Calculate unread count
    const unreadCount = currentUserId
      ? msgs.filter((m) => m.senderId !== currentUserId && !m.readAt).length
      : 0;

    // Get last message for display and sorting
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const sortTs = lastMsg?.createdAt ?? match.otherUser?.lastActive ?? 0;

    const thread: ProcessedThread = {
      id: match.id,
      conversationId: convoId,
      otherUser: {
        id: otherUserId,
        name: match.otherUser.name,
        photoUrl: match.otherUser.photoUrl,
        lastActive: match.otherUser.lastActive,
        isVerified: match.otherUser.isVerified,
      },
      lastMessage: lastMsg
        ? {
            content: lastMsg.content,
            type: lastMsg.type,
            senderId: lastMsg.senderId,
            createdAt: lastMsg.createdAt,
          }
        : match.lastMessage,
      unreadCount,
      isPreMatch: match.isPreMatch,
      isConfessionChat: isConfession,
      expiresAt,
      _sortTs: sortTs,
    };

    // Categorize
    if (isExpired) {
      expiredThreadIds.push(convoId);
      // Don't add expired threads to any visible list
      continue;
    }

    if (isConfession) {
      allThreads.push({ thread, type: 'confession' });
    } else if (msgs.length === 0) {
      allThreads.push({ thread, type: 'newMatch' });
    } else {
      allThreads.push({ thread, type: 'message' });
    }
  }

  // Sort all threads by activity (newest first) before deduping
  allThreads.sort((a, b) => b.thread._sortTs - a.thread._sortTs);

  // Second pass: dedupe and categorize
  for (const { thread, type } of allThreads) {
    const userId = thread.otherUser.id;
    const convoId = thread.conversationId;

    if (type === 'confession') {
      // Confession threads dedupe by conversationId
      if (seenConvoIds.has(convoId)) continue;
      seenConvoIds.add(convoId);
      confessionThreads.push(thread);
    } else {
      // Match-based threads dedupe by otherUserId
      if (seenUserIds.has(userId)) continue;
      seenUserIds.add(userId);

      if (type === 'newMatch') {
        newMatches.push(thread);
      } else {
        messageThreads.push(thread);
      }
    }
  }

  // Calculate total unread count
  const totalUnreadCount =
    messageThreads.reduce((acc, t) => acc + t.unreadCount, 0) +
    confessionThreads.reduce((acc, t) => acc + t.unreadCount, 0);

  return {
    newMatches,
    messageThreads,
    confessionThreads,
    expiredThreadIds,
    totalUnreadCount,
  };
}

// ---------------------------------------------------------------------------
// Likes Filtering (for completeness — keeps likes logic in one place)
// ---------------------------------------------------------------------------

export interface LikeItem {
  likeId: string;
  userId: string;
  action: 'like' | 'super_like';
  name?: string;
  age?: number;
  photoUrl?: string;
  isBlurred?: boolean;
  createdAt?: number;
  message?: string | null;
}

export interface LikesIntegrityInput {
  likes: LikeItem[];
  blockedUserIds: string[];
  matchedUserIds: Set<string>;
}

export interface LikesIntegrityOutput {
  superLikes: LikeItem[];
  regularLikes: LikeItem[];
}

/**
 * Filter and categorize likes.
 * - Excludes blocked users
 * - Excludes already-matched users
 * - Dedupes by userId
 * - Separates super likes from regular likes
 */
export function processLikesIntegrity(input: LikesIntegrityInput): LikesIntegrityOutput {
  const { likes, blockedUserIds, matchedUserIds } = input;
  const blockedSet = new Set(blockedUserIds);
  const seenUserIds = new Set<string>();

  const superLikes: LikeItem[] = [];
  const regularLikes: LikeItem[] = [];

  for (const like of likes) {
    // Skip blocked or matched users
    if (blockedSet.has(like.userId)) continue;
    if (matchedUserIds.has(like.userId)) continue;

    // Dedupe by userId
    if (seenUserIds.has(like.userId)) continue;
    seenUserIds.add(like.userId);

    if (like.action === 'super_like') {
      superLikes.push(like);
    } else {
      regularLikes.push(like);
    }
  }

  return { superLikes, regularLikes };
}

// ---------------------------------------------------------------------------
// Navigation Guard Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a user is blocked.
 */
export function isUserBlocked(userId: string, blockedUserIds: string[]): boolean {
  return blockedUserIds.includes(userId);
}

/**
 * Check if a conversation is an expired confession thread.
 */
export function isExpiredConfessionThread(
  meta: DemoConversationMeta | undefined,
  now: number = Date.now(),
): boolean {
  if (!meta) return false;
  return (
    meta.isConfessionChat === true &&
    meta.expiresAt != null &&
    meta.expiresAt <= now
  );
}

/**
 * Get the other user ID from a conversation metadata or match.
 */
export function getOtherUserIdFromMeta(meta: DemoConversationMeta | undefined): string | undefined {
  return meta?.otherUser?.id;
}
