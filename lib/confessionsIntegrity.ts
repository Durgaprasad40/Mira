/**
 * confessionsIntegrity.ts — Pure helper module for confession state management
 *
 * Single source of truth for:
 *   - Confession post states (ACTIVE / EXPIRED / REMOVED)
 *   - Confession thread states (active/expired based on linked post or thread expiry)
 *   - Badge computation (unseen ACTIVE confessions only)
 *   - Filtering by blocked users
 *   - Deduplication
 *   - Sorting (newest first)
 *
 * This module is PURE: it takes raw state and returns computed results.
 * No store calls, no side effects.
 */

import type { Confession, SecretCrush, ConfessionChat } from '@/types';
import type { DemoConversationMeta } from '@/stores/demoDmStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Confession post states */
export type ConfessionPostState = 'ACTIVE' | 'EXPIRED' | 'REMOVED';

/** Tagged confession item (unified for demo + Convex) */
export interface TaggedConfessionItem {
  notificationId: string;
  confessionId: string;
  seen: boolean;
  notificationCreatedAt: number;
  confessionText: string;
  confessionMood: string;
  confessionCreatedAt: number;
  confessionExpiresAt: number;
  isExpired: boolean;
  replyCount: number;
  reactionCount: number;
}

/** Input for processConfessionsIntegrity */
export interface ConfessionsIntegrityInput {
  /** All confession posts from store */
  confessions: Confession[];
  /** Tagged confession notifications (for badge computation) */
  taggedConfessions: TaggedConfessionItem[];
  /** Confession threads mapped by confessionId -> conversationId */
  confessionThreads: Record<string, string>;
  /** Conversation metadata from demoDmStore (for thread expiry) */
  conversationMeta: Record<string, DemoConversationMeta>;
  /** User IDs blocked by the current user */
  blockedUserIds: string[];
  /** User IDs blocked in the confession store */
  confessionBlockedIds: string[];
  /** Reported confession IDs */
  reportedConfessionIds: string[];
  /** Secret crushes (for expiry handling) */
  secretCrushes: SecretCrush[];
  /** Confession chats from store */
  confessionChats: ConfessionChat[];
  /** IDs of confessions the user has seen (for badge) */
  seenConfessionIds?: Set<string>;
  /** Current timestamp for expiry checks */
  now?: number;
  /** Current user ID (for filtering own tagged confessions) */
  currentUserId?: string;
}

/** Output from processConfessionsIntegrity */
export interface ConfessionsIntegrityOutput {
  /** ACTIVE confession posts (not expired, not blocked, not reported) */
  activePosts: Confession[];
  /** IDs of expired confession posts (for cleanup) */
  expiredPostIds: string[];
  /** IDs of ACTIVE confession threads (conversationIds) */
  activeThreadIds: string[];
  /** IDs of expired confession threads (conversationIds) - for cleanup */
  expiredThreadIds: string[];
  /** ACTIVE tagged confessions (for "Tagged for you" section) */
  activeTaggedConfessions: TaggedConfessionItem[];
  /** Badge count: unseen ACTIVE tagged confessions */
  badgeCount: number;
  /** ACTIVE secret crushes */
  activeSecretCrushes: SecretCrush[];
  /** IDs of expired secret crushes */
  expiredSecretCrushIds: string[];
  /** ACTIVE confession chats */
  activeChats: ConfessionChat[];
  /** IDs of expired confession chats */
  expiredChatIds: string[];
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Determine the state of a confession post.
 */
export function getConfessionPostState(
  confession: Confession,
  now: number,
  reportedIds: string[],
): ConfessionPostState {
  // Check if removed (reported)
  if (reportedIds.includes(confession.id)) {
    return 'REMOVED';
  }

  // Check if expired (use expiresAt field if exists, else fallback to createdAt + 24h)
  const expiresAt = confession.expiresAt ?? (confession.createdAt + TWENTY_FOUR_HOURS_MS);
  if (now > expiresAt) {
    return 'EXPIRED';
  }

  return 'ACTIVE';
}

/**
 * Check if a confession thread is expired.
 * A thread is expired if:
 * - The linked confession post is expired
 * - OR the thread's own expiresAt has passed
 */
export function isConfessionThreadExpired(
  confessionId: string,
  conversationId: string,
  conversationMeta: Record<string, DemoConversationMeta>,
  confessionExpiresAt: number | undefined,
  now: number,
): boolean {
  // Check thread-level expiry
  const meta = conversationMeta[conversationId];
  if (meta?.expiresAt && now > meta.expiresAt) {
    return true;
  }

  // Check linked confession expiry
  if (confessionExpiresAt && now > confessionExpiresAt) {
    return true;
  }

  return false;
}

/**
 * Check if a tagged confession item is expired.
 */
export function isTaggedConfessionExpired(item: TaggedConfessionItem, now: number): boolean {
  return now > item.confessionExpiresAt;
}

// ---------------------------------------------------------------------------
// Core Processing Function
// ---------------------------------------------------------------------------

/**
 * Process raw confession state and return filtered, deduplicated, sorted results.
 *
 * Rules applied:
 * 1. Filter out confessions from blocked users
 * 2. Filter out reported confessions
 * 3. Filter out expired confessions (but collect IDs for cleanup)
 * 4. Dedupe by confessionId (keep the one with newest createdAt)
 * 5. Sort by createdAt (newest first)
 * 6. Compute badge from unseen ACTIVE tagged confessions
 */
export function processConfessionsIntegrity(
  input: ConfessionsIntegrityInput,
): ConfessionsIntegrityOutput {
  const {
    confessions,
    taggedConfessions,
    confessionThreads,
    conversationMeta,
    blockedUserIds,
    confessionBlockedIds,
    reportedConfessionIds,
    secretCrushes,
    confessionChats,
    seenConfessionIds = new Set(),
    now = Date.now(),
    currentUserId,
  } = input;

  // Combine all blocked user IDs
  const allBlockedIds = new Set([...blockedUserIds, ...confessionBlockedIds]);

  const activePosts: Confession[] = [];
  const expiredPostIds: string[] = [];
  const seenConfessionIdsSet = new Set<string>();

  // Process confession posts
  for (const confession of confessions) {
    // Skip if from blocked user
    if (allBlockedIds.has(confession.userId)) {
      continue;
    }

    // Get state
    const state = getConfessionPostState(confession, now, reportedConfessionIds);

    if (state === 'EXPIRED') {
      expiredPostIds.push(confession.id);
      continue;
    }

    if (state === 'REMOVED') {
      continue;
    }

    // Dedupe check
    if (seenConfessionIdsSet.has(confession.id)) {
      continue;
    }
    seenConfessionIdsSet.add(confession.id);

    activePosts.push(confession);
  }

  // Sort by createdAt (newest first)
  activePosts.sort((a, b) => b.createdAt - a.createdAt);

  // Process confession threads
  const activeThreadIds: string[] = [];
  const expiredThreadIds: string[] = [];
  const activePostIds = new Set(activePosts.map((p) => p.id));

  for (const [confessionId, conversationId] of Object.entries(confessionThreads)) {
    // Find the linked confession to get its expiry
    const linkedConfession = confessions.find((c) => c.id === confessionId);
    // Prefer expiresAt field; fallback to createdAt + 24h for backward compat
    const confessionExpiresAt = linkedConfession
      ? (linkedConfession.expiresAt ?? linkedConfession.createdAt + TWENTY_FOUR_HOURS_MS)
      : undefined;

    const isExpired = isConfessionThreadExpired(
      confessionId,
      conversationId,
      conversationMeta,
      confessionExpiresAt,
      now,
    );

    if (isExpired || !activePostIds.has(confessionId)) {
      expiredThreadIds.push(conversationId);
    } else {
      activeThreadIds.push(conversationId);
    }
  }

  // Process tagged confessions
  const activeTaggedConfessions: TaggedConfessionItem[] = [];
  let badgeCount = 0;

  for (const tagged of taggedConfessions) {
    // Skip expired
    if (isTaggedConfessionExpired(tagged, now)) {
      continue;
    }

    activeTaggedConfessions.push(tagged);

    // Count unseen for badge
    if (!tagged.seen) {
      badgeCount++;
    }
  }

  // Sort tagged confessions by notification date (newest first)
  activeTaggedConfessions.sort((a, b) => b.notificationCreatedAt - a.notificationCreatedAt);

  // Process secret crushes
  const activeSecretCrushes: SecretCrush[] = [];
  const expiredSecretCrushIds: string[] = [];

  for (const crush of secretCrushes) {
    // Filter by current user if provided
    if (currentUserId && crush.toUserId !== currentUserId) {
      continue;
    }

    // Check expiry
    if (now > crush.expiresAt) {
      expiredSecretCrushIds.push(crush.id);
      continue;
    }

    // Skip revealed
    if (crush.isRevealed) {
      continue;
    }

    activeSecretCrushes.push(crush);
  }

  // Process confession chats
  const activeChats: ConfessionChat[] = [];
  const expiredChatIds: string[] = [];

  for (const chat of confessionChats) {
    // Check chat expiry
    if (now > chat.expiresAt) {
      expiredChatIds.push(chat.id);
      continue;
    }

    // Check if linked confession is still active
    if (!activePostIds.has(chat.confessionId)) {
      expiredChatIds.push(chat.id);
      continue;
    }

    activeChats.push(chat);
  }

  return {
    activePosts,
    expiredPostIds,
    activeThreadIds,
    expiredThreadIds,
    activeTaggedConfessions,
    badgeCount,
    activeSecretCrushes,
    expiredSecretCrushIds,
    activeChats,
    expiredChatIds,
  };
}

// ---------------------------------------------------------------------------
// Navigation Guard Helpers
// ---------------------------------------------------------------------------

/**
 * Check if opening a confession post should be blocked.
 * Returns a reason string if blocked, null if allowed.
 */
export function shouldBlockConfessionOpen(
  confessionId: string,
  confessions: Confession[],
  blockedUserIds: string[],
  reportedConfessionIds: string[],
  now: number = Date.now(),
): string | null {
  const confession = confessions.find((c) => c.id === confessionId);

  if (!confession) {
    return 'not_found';
  }

  if (blockedUserIds.includes(confession.userId)) {
    return 'blocked_user';
  }

  if (reportedConfessionIds.includes(confessionId)) {
    return 'reported';
  }

  const state = getConfessionPostState(confession, now, reportedConfessionIds);
  if (state === 'EXPIRED') {
    return 'expired';
  }

  return null;
}

/**
 * Check if opening a confession thread should be blocked.
 */
export function shouldBlockConfessionThreadOpen(
  conversationId: string,
  confessionId: string,
  conversationMeta: Record<string, DemoConversationMeta>,
  confessions: Confession[],
  blockedUserIds: string[],
  now: number = Date.now(),
): string | null {
  const meta = conversationMeta[conversationId];

  // Check if other user is blocked
  const otherUserId = meta?.otherUser?.id;
  if (otherUserId && blockedUserIds.includes(otherUserId)) {
    return 'blocked_user';
  }

  // Check thread expiry
  if (meta?.expiresAt && now > meta.expiresAt) {
    return 'thread_expired';
  }

  // Check linked confession expiry
  const linkedConfession = confessions.find((c) => c.id === confessionId);
  if (linkedConfession) {
    const confessionExpiresAt = linkedConfession.createdAt + TWENTY_FOUR_HOURS_MS;
    if (now > confessionExpiresAt) {
      return 'confession_expired';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Badge Computation (standalone for simple use cases)
// ---------------------------------------------------------------------------

/**
 * Compute badge count from tagged confessions.
 * Badge = count of unseen ACTIVE tagged confessions.
 */
export function computeConfessionBadgeCount(
  taggedConfessions: TaggedConfessionItem[],
  now: number = Date.now(),
): number {
  return taggedConfessions.filter(
    (t) => !t.seen && !isTaggedConfessionExpired(t, now),
  ).length;
}

// ---------------------------------------------------------------------------
// Demo Mode Tagged Confession Builder
// ---------------------------------------------------------------------------

/**
 * Build tagged confession items from demo confessions.
 * In demo mode, we derive tagged confessions from the main confessions list.
 */
export function buildDemoTaggedConfessions(
  confessions: Confession[],
  currentUserId: string,
  seenIds: Set<string> = new Set(),
  now: number = Date.now(),
): TaggedConfessionItem[] {
  return confessions
    .filter((c) => c.targetUserId === currentUserId)
    .map((c) => ({
      notificationId: `notif_${c.id}`,
      confessionId: c.id,
      seen: seenIds.has(c.id),
      notificationCreatedAt: c.createdAt,
      confessionText: c.text,
      confessionMood: c.mood,
      confessionCreatedAt: c.createdAt,
      confessionExpiresAt: c.createdAt + TWENTY_FOUR_HOURS_MS,
      isExpired: now > c.createdAt + TWENTY_FOUR_HOURS_MS,
      replyCount: c.replyCount,
      reactionCount: c.reactionCount,
    }))
    .sort((a, b) => b.notificationCreatedAt - a.notificationCreatedAt);
}
