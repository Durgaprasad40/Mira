/**
 * Activity-Based Ranking Boost
 *
 * LIGHTWEIGHT, ADDITIVE system that rewards:
 * - Recent activity (presence)
 * - Reply behavior (engagement)
 * - Conversation continuation (not abandoning chats)
 *
 * CRITICAL RULES:
 * - Max boost = +3 (NOT 4)
 * - Missing data = neutral (0), NOT penalty
 * - New users = neutral (no penalty)
 * - Null-safe throughout
 *
 * ANTI-GAMING:
 * - Does NOT reward message volume
 * - Does NOT reward swipe count
 * - Does NOT reward app opens
 * - Only rewards presence + quality engagement
 *
 * TIER SYSTEM:
 * - Tier 0: No data / inactive → +0
 * - Tier 1: Active within 72h → +1
 * - Tier 2: Active within 24h AND has reply presence → +2
 * - Tier 3: Active within 24h AND good reply presence AND conversation continuation → +3
 */

import { CandidateProfile } from '../discoverRanking';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum activity boost (HARD LIMIT)
 */
const MAX_ACTIVITY_BOOST = 3;

/**
 * Activity time windows
 */
const ACTIVITY_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_72H_MS = 72 * 60 * 60 * 1000;

/**
 * New user threshold (7 days)
 * Users newer than this get neutral treatment (no penalty)
 */
const NEW_USER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum reply ratio for "good reply presence"
 * User has replied to at least this fraction of their conversations
 */
const MIN_REPLY_RATIO = 0.3; // 30%

/**
 * Minimum conversations for engagement metrics to apply
 * Below this, we don't penalize or boost based on engagement
 */
const MIN_CONVERSATIONS_FOR_METRICS = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extended candidate profile with optional activity metrics.
 * These fields may be populated by the discover query if available.
 */
export interface ActivityMetrics {
  /**
   * User's last active timestamp (required - from user profile)
   */
  lastActive: number;

  /**
   * User's account creation timestamp (for new user detection)
   */
  createdAt: number;

  /**
   * Number of conversations user has participated in (optional)
   */
  conversationCount?: number;

  /**
   * Number of conversations where user has replied (optional)
   * "Replied" = sent at least one message after receiving one
   */
  repliedConversationCount?: number;

  /**
   * Number of conversations with recent activity (optional)
   * "Recent" = last message within 7 days
   */
  activeConversationCount?: number;
}

// ---------------------------------------------------------------------------
// Activity Tier Calculation
// ---------------------------------------------------------------------------

/**
 * Check if user is recently active (within window).
 */
function isActiveWithin(lastActive: number, windowMs: number): boolean {
  if (!lastActive || typeof lastActive !== 'number') return false;
  const now = Date.now();
  return (now - lastActive) <= windowMs;
}

/**
 * Check if user is a new user (created recently).
 */
function isNewUser(createdAt: number): boolean {
  if (!createdAt || typeof createdAt !== 'number') return false;
  const now = Date.now();
  return (now - createdAt) <= NEW_USER_THRESHOLD_MS;
}

/**
 * Check if user has reply presence (has replied to conversations).
 *
 * Returns true if:
 * - User has no conversations yet (neutral - don't penalize)
 * - User has replied to at least one conversation
 */
function hasReplyPresence(metrics: ActivityMetrics): boolean {
  // No conversation data = neutral (assume positive)
  if (metrics.conversationCount === undefined) return true;

  // No conversations yet = neutral
  if (metrics.conversationCount === 0) return true;

  // Below threshold = neutral
  if (metrics.conversationCount < MIN_CONVERSATIONS_FOR_METRICS) return true;

  // Check if has replied to any conversations
  const repliedCount = metrics.repliedConversationCount ?? 0;
  return repliedCount > 0;
}

/**
 * Check if user has good reply presence (replies to reasonable fraction).
 *
 * Returns true if:
 * - User has no conversations yet (neutral)
 * - User has replied to at least MIN_REPLY_RATIO of conversations
 */
function hasGoodReplyPresence(metrics: ActivityMetrics): boolean {
  // No conversation data = neutral (assume positive)
  if (metrics.conversationCount === undefined) return true;

  // No conversations yet = neutral
  if (metrics.conversationCount === 0) return true;

  // Below threshold = neutral
  if (metrics.conversationCount < MIN_CONVERSATIONS_FOR_METRICS) return true;

  // Calculate reply ratio
  const repliedCount = metrics.repliedConversationCount ?? 0;
  const ratio = repliedCount / metrics.conversationCount;

  return ratio >= MIN_REPLY_RATIO;
}

/**
 * Check if user has conversation continuation (maintains some active chats).
 *
 * Returns true if:
 * - User has no conversations yet (neutral)
 * - User has at least one active conversation
 */
function hasConversationContinuation(metrics: ActivityMetrics): boolean {
  // No conversation data = neutral (assume positive)
  if (metrics.conversationCount === undefined) return true;

  // No conversations yet = neutral
  if (metrics.conversationCount === 0) return true;

  // Below threshold = neutral
  if (metrics.conversationCount < MIN_CONVERSATIONS_FOR_METRICS) return true;

  // Check if has any active conversations
  const activeCount = metrics.activeConversationCount ?? 0;
  return activeCount > 0;
}

// ---------------------------------------------------------------------------
// Main Boost Function
// ---------------------------------------------------------------------------

/**
 * Calculate activity boost for a candidate.
 *
 * TIER SYSTEM:
 * - Tier 0: No data / inactive → +0
 * - Tier 1: Active within 72h → +1
 * - Tier 2: Active within 24h AND has reply presence → +2
 * - Tier 3: Active within 24h AND good reply presence AND continuation → +3
 *
 * @param profile - Candidate profile with activity data
 * @returns Boost value (0 to MAX_ACTIVITY_BOOST)
 */
export function getActivityBoost(
  profile: CandidateProfile | null | undefined
): number {
  // Null safety
  if (!profile) return 0;

  // Build activity metrics from profile
  const metrics: ActivityMetrics = {
    lastActive: profile.lastActive,
    createdAt: profile.createdAt,
    // Optional fields (may not be present)
    conversationCount: (profile as any).conversationCount,
    repliedConversationCount: (profile as any).repliedConversationCount,
    activeConversationCount: (profile as any).activeConversationCount,
  };

  // New user protection: give neutral treatment
  // New users don't have enough data for activity scoring
  if (isNewUser(metrics.createdAt)) {
    // Give a small baseline boost to new users so they're not disadvantaged
    // This is intentionally +1 (not +0) to ensure visibility
    return 1;
  }

  // TIER 0: No activity data or inactive
  if (!metrics.lastActive) return 0;

  // Check activity windows
  const activeWithin24h = isActiveWithin(metrics.lastActive, ACTIVITY_WINDOW_24H_MS);
  const activeWithin72h = isActiveWithin(metrics.lastActive, ACTIVITY_WINDOW_72H_MS);

  // Not active within 72h = Tier 0
  if (!activeWithin72h) return 0;

  // TIER 1: Active within 72h (but not 24h)
  if (!activeWithin24h) return 1;

  // Active within 24h - check engagement metrics

  // TIER 2: Active within 24h AND has reply presence
  const replyPresent = hasReplyPresence(metrics);
  if (!replyPresent) return 1; // Fall back to Tier 1

  // TIER 3: Active within 24h AND good reply presence AND continuation
  const goodReplies = hasGoodReplyPresence(metrics);
  const hasContinuation = hasConversationContinuation(metrics);

  if (goodReplies && hasContinuation) {
    return MAX_ACTIVITY_BOOST; // +3
  }

  // Has reply presence but not full engagement = Tier 2
  return 2;
}

/**
 * Get activity boost with explicit metrics (for testing/direct use).
 *
 * @param metrics - Activity metrics
 * @returns Boost value (0 to MAX_ACTIVITY_BOOST)
 */
export function getActivityBoostFromMetrics(
  metrics: ActivityMetrics | null | undefined
): number {
  if (!metrics) return 0;

  // New user protection
  if (isNewUser(metrics.createdAt)) {
    return 1;
  }

  // Check activity windows
  const activeWithin24h = isActiveWithin(metrics.lastActive, ACTIVITY_WINDOW_24H_MS);
  const activeWithin72h = isActiveWithin(metrics.lastActive, ACTIVITY_WINDOW_72H_MS);

  if (!activeWithin72h) return 0;
  if (!activeWithin24h) return 1;

  const replyPresent = hasReplyPresence(metrics);
  if (!replyPresent) return 1;

  const goodReplies = hasGoodReplyPresence(metrics);
  const hasContinuation = hasConversationContinuation(metrics);

  if (goodReplies && hasContinuation) {
    return MAX_ACTIVITY_BOOST;
  }

  return 2;
}

// ---------------------------------------------------------------------------
// Exported Constants
// ---------------------------------------------------------------------------

export const ACTIVITY_BOOST_CONFIG = {
  maxBoost: MAX_ACTIVITY_BOOST,
  activityWindow24hMs: ACTIVITY_WINDOW_24H_MS,
  activityWindow72hMs: ACTIVITY_WINDOW_72H_MS,
  newUserThresholdMs: NEW_USER_THRESHOLD_MS,
  minReplyRatio: MIN_REPLY_RATIO,
  minConversationsForMetrics: MIN_CONVERSATIONS_FOR_METRICS,
  tiers: {
    tier0: 0, // Inactive
    tier1: 1, // Active within 72h
    tier2: 2, // Active within 24h + reply presence
    tier3: 3, // Active within 24h + good replies + continuation
  },
};
