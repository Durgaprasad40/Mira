/**
 * DISCOVER-CATEGORY-FIX: Single-category assignment system
 *
 * Purpose: Prevent duplicate profile visibility across Explore categories
 *
 * Rules:
 * 1. Each user belongs to ONE category at a time (mutual exclusivity)
 * 2. Category reassignment window: 28-48 hours
 * 3. After being shown in Discover, 7-day cooldown before showing again
 * 4. Assignment uses INTENT FILTER + HYBRID SCORING:
 *    - Step 1: HARD FILTER based on user's relationshipIntent (users ONLY in compatible categories)
 *    - Step 2: HYBRID SCORING within allowed categories:
 *      score = (intentScore * 0.45) + (activityScore * 0.25) + (interestScore * 0.25) + randomness
 *              + fairExposureBoost - loadPenalty - softRepeatPenalty + subscriptionBoost
 *
 * IMPORTANT: Intent IS a hard filter - users will ONLY appear in categories
 * compatible with their selected relationship intent.
 */

import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Time windows (in milliseconds)
const CATEGORY_MIN_REASSIGN_MS = 28 * 60 * 60 * 1000; // 28 hours
const CATEGORY_MAX_REASSIGN_MS = 48 * 60 * 60 * 1000; // 48 hours
const SHOWN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// HYBRID SCORING WEIGHTS (Task 1 & 2)
// ---------------------------------------------------------------------------

// Intent Score values
const INTENT_SCORES = {
  STRONG_MATCH: 100,    // Primary intent matches category perfectly
  MODERATE_MATCH: 60,   // Secondary/compatible intent
  WEAK_MATCH: 30,       // Loosely compatible
  NO_MATCH: 0,          // No intent alignment
};

// Activity Score values (based on lastActive)
const ACTIVITY_SCORES = {
  UNDER_10_MIN: 100,    // Active < 10 minutes ago
  UNDER_1_HOUR: 80,     // Active < 1 hour ago
  UNDER_24_HOURS: 60,   // Active < 24 hours ago
  UNDER_3_DAYS: 30,     // Active < 3 days ago
  OLDER: 10,            // Older than 3 days
};

// Interest Score values
const INTEREST_SCORES = {
  MULTIPLE_MATCHES: 100, // Multiple activity matches
  SINGLE_MATCH: 70,      // Single activity match
  NO_MATCH: 0,           // No matching activities
};

// Hybrid scoring weights (TUNED for balanced distribution)
// Total: 0.45 + 0.25 + 0.25 = 0.95 (+ small random)
const HYBRID_WEIGHTS = {
  INTENT: 0.45,         // 45% weight for intent (reduced from 50%)
  ACTIVITY: 0.25,       // 25% weight for activity recency (reduced from 30%)
  INTEREST: 0.25,       // 25% weight for interest alignment (increased from 20%)
};

// Randomness factor (0-15 added to final score - reduced for more deterministic results)
const RANDOMNESS_MAX = 15;

// Category load balancing
// If a category has too many users, apply a penalty to distribute load
const CATEGORY_LOAD_THRESHOLD = 50;    // Users above this triggers penalty
const CATEGORY_LOAD_PENALTY_MIN = 10;  // Minimum penalty
const CATEGORY_LOAD_PENALTY_MAX = 20;  // Maximum penalty

// Fair exposure boosts (prevent starvation)
// Users who haven't been shown recently get a score boost
const FAIR_EXPOSURE_24H_BOOST = 30;    // +30 if not shown in 24 hours
const FAIR_EXPOSURE_48H_BOOST = 50;    // +50 if not shown in 48 hours
const FAIR_EXPOSURE_24H_MS = 24 * 60 * 60 * 1000;
const FAIR_EXPOSURE_48H_MS = 48 * 60 * 60 * 1000;

// Soft repeat system (allow previously seen profiles after cooldown)
const SOFT_REPEAT_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 hours
const SOFT_REPEAT_SCORE_PENALTY = 25;  // Lower score to prioritize new users

// ---------------------------------------------------------------------------
// SUBSCRIPTION BOOST SYSTEM
// ---------------------------------------------------------------------------
// Small, controlled boosts based on subscription tier
// Boost is intentionally small to NOT dominate ranking
// For reference:
//   - Fair exposure: +30 to +50
//   - Activity score: up to 100 (weighted)
//   - Subscription boost: +5 to +15 (small advantage only)

// Matches schema.ts subscription tiers: 'free' | 'basic' | 'premium'
export const SUBSCRIPTION_TIERS = {
  FREE: 'free',
  BASIC: 'basic',
  PREMIUM: 'premium',
} as const;

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS];

// Boost values per tier (intentionally small)
// - free: 0 (no boost)
// - basic: +5 (small advantage)
// - premium: +15 (max advantage, still small vs other factors)
const SUBSCRIPTION_BOOST_VALUES: Record<SubscriptionTier, number> = {
  free: 0,
  basic: 5,
  premium: 15,
};

// Category definitions - CURRENT PRODUCT TAXONOMY
// These are the canonical category keys used across backend and frontend
export const CATEGORY_IDS = {
  // Relationship (9)
  serious_vibes: 'serious_vibes',
  keep_it_casual: 'keep_it_casual',
  exploring_vibes: 'exploring_vibes',
  see_where_it_goes: 'see_where_it_goes',
  open_to_vibes: 'open_to_vibes',
  just_friends: 'just_friends',
  open_to_anything: 'open_to_anything',
  single_parent: 'single_parent',
  new_to_dating: 'new_to_dating',
  // Right Now (4)
  nearby: 'nearby',
  online_now: 'online_now',
  active_today: 'active_today',
  free_tonight: 'free_tonight',
  // Interest (7)
  coffee_date: 'coffee_date',
  nature_lovers: 'nature_lovers',
  binge_watchers: 'binge_watchers',
  travel: 'travel',
  gaming: 'gaming',
  fitness: 'fitness',
  music: 'music',
} as const;

export type CategoryId = typeof CATEGORY_IDS[keyof typeof CATEGORY_IDS];

// Intent compatibility map - maps CATEGORY IDs to user relationshipIntent values
// CURRENT 9 RELATIONSHIP CATEGORIES are BOTH the category IDs AND the intent values
// They are now unified - category ID === relationshipIntent value
const INTENT_COMPATIBILITY: Record<string, string[]> = {
  serious_vibes: ['serious_vibes', 'see_where_it_goes'],
  keep_it_casual: ['keep_it_casual', 'open_to_vibes'],
  exploring_vibes: ['exploring_vibes', 'open_to_anything'],
  see_where_it_goes: ['see_where_it_goes', 'serious_vibes'],
  open_to_vibes: ['open_to_vibes', 'keep_it_casual'],
  just_friends: ['just_friends', 'open_to_anything'],
  open_to_anything: ['open_to_anything', 'exploring_vibes', 'just_friends'],
  single_parent: ['single_parent', 'serious_vibes', 'exploring_vibes'],
  new_to_dating: ['new_to_dating', 'exploring_vibes', 'open_to_anything'],
};

// ---------------------------------------------------------------------------
// INTENT → ALLOWED CATEGORIES MAPPING (Task 1: Hard Filter)
// ---------------------------------------------------------------------------
// Maps user's relationshipIntent to categories they CAN appear in
// This is the REVERSE of INTENT_COMPATIBILITY - ensures users ONLY appear
// in categories compatible with their selected intent
//
// IMPORTANT: This is a HARD FILTER - users will NOT appear in other categories

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
// Intent values and category IDs are now UNIFIED - same names everywhere
const INTENT_TO_ALLOWED_CATEGORIES: Record<string, CategoryId[]> = {
  // Each intent maps to its own category + compatible categories
  'serious_vibes': ['serious_vibes', 'see_where_it_goes'],
  'keep_it_casual': ['keep_it_casual', 'open_to_vibes'],
  'exploring_vibes': ['exploring_vibes', 'open_to_anything'],
  'see_where_it_goes': ['see_where_it_goes', 'serious_vibes'],
  'open_to_vibes': ['open_to_vibes', 'keep_it_casual'],
  'just_friends': ['just_friends', 'open_to_anything'],
  'open_to_anything': ['open_to_anything', 'exploring_vibes', 'just_friends'],
  'single_parent': ['single_parent', 'serious_vibes', 'exploring_vibes'],
  'new_to_dating': ['new_to_dating', 'exploring_vibes', 'open_to_anything'],
};

/**
 * Get allowed categories for a user based on their relationship intent (Task 2)
 * This is the HARD FILTER - users can ONLY be assigned to these categories
 *
 * @param userIntents - Array of user's relationship intents (primary first)
 * @returns Array of allowed category IDs
 */
function getAllowedCategoriesForIntent(userIntents: string[]): CategoryId[] {
  if (!userIntents || userIntents.length === 0) {
    // No intent set - fallback to exploring_vibes only
    return ['exploring_vibes' as CategoryId];
  }

  // Collect allowed categories from all user intents
  const allowedSet = new Set<CategoryId>();

  for (const intent of userIntents) {
    const categories = INTENT_TO_ALLOWED_CATEGORIES[intent];
    if (categories) {
      categories.forEach(cat => allowedSet.add(cat));
    }
  }

  // If no mapping found for any intent, fallback to exploring_vibes
  if (allowedSet.size === 0) {
    return ['exploring_vibes' as CategoryId];
  }

  return Array.from(allowedSet);
}

// Activity map for interest categories
const INTEREST_ACTIVITIES: Record<string, string[]> = {
  coffee_date: ['coffee'],
  nature_lovers: ['outdoors', 'hiking', 'camping', 'nature_walks'],
  binge_watchers: ['movies', 'binge_watching', 'thrillers', 'documentaries', 'anime', 'k_dramas'],
  travel: ['travel', 'weekend_getaways', 'road_trip'],
  gaming: ['gaming', 'board_games', 'chess', 'escape_rooms'],
  fitness: ['gym_partner', 'gym', 'yoga', 'running', 'cycling', 'pilates'],
  music: ['music_lover', 'concerts', 'live_concerts', 'singing'],
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Calculate subscription boost score (Task 2)
 *
 * Returns small boost based on subscription tier:
 * - none: 0
 * - basic: +5
 * - standard: +10
 * - premium: +15
 *
 * Auto-expires: if subscription expired, returns 0
 *
 * @param user - User with subscription fields
 * @param now - Current timestamp (for expiry check)
 */
function getSubscriptionBoostScore(
  user: {
    subscriptionTier?: SubscriptionTier;
    subscriptionExpiresAt?: number;
  },
  now: number = Date.now()
): number {
  // No subscription tier set or free tier
  if (!user.subscriptionTier || user.subscriptionTier === 'free') {
    return 0;
  }

  // Check if subscription has expired (Task 5: Auto expiry)
  if (user.subscriptionExpiresAt && now > user.subscriptionExpiresAt) {
    return 0; // Expired - no boost
  }

  // Return boost for active subscription
  const boost = SUBSCRIPTION_BOOST_VALUES[user.subscriptionTier] ?? 0;

  return boost;
}

/**
 * Calculate category load penalty based on REAL DB counts
 * Applies a small penalty to over-populated categories to balance distribution.
 *
 * @param categoryLoad - Actual count from DB (passed in, not fetched per-call)
 */
function calculateCategoryLoadPenalty(categoryLoad: number): number {
  // Task 6: Fallback - if load unavailable, no penalty
  if (categoryLoad <= 0) {
    return 0;
  }

  if (categoryLoad <= CATEGORY_LOAD_THRESHOLD) {
    return 0; // No penalty below threshold
  }

  // Linear penalty between MIN and MAX based on how far over threshold
  const overload = categoryLoad - CATEGORY_LOAD_THRESHOLD;
  const penaltyRatio = Math.min(overload / CATEGORY_LOAD_THRESHOLD, 1); // Cap at 1x
  const penalty = CATEGORY_LOAD_PENALTY_MIN +
    (CATEGORY_LOAD_PENALTY_MAX - CATEGORY_LOAD_PENALTY_MIN) * penaltyRatio;

  return Math.round(penalty);
}

/**
 * Calculate fair exposure boost (prevent starvation)
 * Users who haven't been shown recently get a score boost.
 *
 * @param lastShownAt - Timestamp when user was last shown (undefined = never shown)
 */
function calculateFairExposureBoost(lastShownAt: number | undefined): number {
  // Never shown - maximum boost
  if (!lastShownAt) {
    return FAIR_EXPOSURE_48H_BOOST;
  }

  const now = Date.now();
  const timeSinceShown = now - lastShownAt;

  // Not shown in 48+ hours - high boost
  if (timeSinceShown >= FAIR_EXPOSURE_48H_MS) {
    return FAIR_EXPOSURE_48H_BOOST;
  }

  // Not shown in 24+ hours - moderate boost
  if (timeSinceShown >= FAIR_EXPOSURE_24H_MS) {
    return FAIR_EXPOSURE_24H_BOOST;
  }

  // Recently shown - no boost
  return 0;
}

/**
 * Check if a profile is eligible for soft repeat (previously seen but cooled down)
 * Returns penalty to apply if soft repeat, 0 if new profile
 *
 * @param lastShownToViewer - When this profile was last shown to THIS viewer
 */
function calculateSoftRepeatPenalty(lastShownToViewer: number | undefined): number {
  // Never shown to this viewer - no penalty (new profile)
  if (!lastShownToViewer) {
    return 0;
  }

  const now = Date.now();
  const timeSinceShown = now - lastShownToViewer;

  // Still in hard cooldown - should be filtered out at query level
  if (timeSinceShown < SOFT_REPEAT_COOLDOWN_MS) {
    return 0; // Will be filtered by query
  }

  // Past cooldown but was previously seen - apply penalty to prioritize new users
  return SOFT_REPEAT_SCORE_PENALTY;
}

/**
 * Check if profile is eligible for soft repeat viewing
 */
export function isEligibleForSoftRepeat(lastShownAt: number | undefined): boolean {
  if (!lastShownAt) return false;
  return Date.now() - lastShownAt >= SOFT_REPEAT_COOLDOWN_MS;
}

/**
 * Calculate INTENT SCORE for a user in a given category
 * Intent is NOT a hard filter - it contributes to the hybrid score only.
 */
function calculateIntentScore(
  userIntents: string[],
  categoryId: CategoryId,
): number {
  // Check if category has intent mapping
  const compatibleIntents = INTENT_COMPATIBILITY[categoryId];
  if (!compatibleIntents || compatibleIntents.length === 0) {
    // Category doesn't use intent scoring (e.g., interest/right-now categories)
    // Return weak match to allow participation
    return INTENT_SCORES.WEAK_MATCH;
  }

  if (userIntents.length === 0) {
    return INTENT_SCORES.NO_MATCH;
  }

  // Check primary intent (first in array) - STRONG MATCH
  if (compatibleIntents.includes(userIntents[0])) {
    return INTENT_SCORES.STRONG_MATCH;
  }

  // Check secondary intents - MODERATE MATCH
  const hasSecondaryMatch = userIntents.slice(1).some(i => compatibleIntents.includes(i));
  if (hasSecondaryMatch) {
    return INTENT_SCORES.MODERATE_MATCH;
  }

  // Check any loose compatibility - WEAK MATCH
  // For relationship categories, give weak match if user has any relationship intent
  if (categoryId in INTENT_COMPATIBILITY && userIntents.length > 0) {
    return INTENT_SCORES.WEAK_MATCH;
  }

  return INTENT_SCORES.NO_MATCH;
}

/**
 * Calculate ACTIVITY SCORE based on user's lastActive time
 */
function calculateActivityScore(lastActive: number): number {
  const now = Date.now();
  const minutesAgo = (now - lastActive) / (1000 * 60);

  if (minutesAgo < 10) return ACTIVITY_SCORES.UNDER_10_MIN;
  if (minutesAgo < 60) return ACTIVITY_SCORES.UNDER_1_HOUR;
  if (minutesAgo < 24 * 60) return ACTIVITY_SCORES.UNDER_24_HOURS;
  if (minutesAgo < 3 * 24 * 60) return ACTIVITY_SCORES.UNDER_3_DAYS;

  return ACTIVITY_SCORES.OLDER;
}

/**
 * Calculate INTEREST SCORE for a user in a given category
 */
function calculateInterestScore(
  userActivities: string[],
  categoryId: CategoryId,
): number {
  // Check interest categories
  const relevantActivities = INTEREST_ACTIVITIES[categoryId];
  if (!relevantActivities || relevantActivities.length === 0) {
    // Category doesn't use interest scoring
    // Give base score to allow participation
    return INTEREST_SCORES.SINGLE_MATCH * 0.5; // 35 - moderate base
  }

  const matchCount = userActivities.filter(a => relevantActivities.includes(a)).length;

  if (matchCount >= 2) return INTEREST_SCORES.MULTIPLE_MATCHES;
  if (matchCount === 1) return INTEREST_SCORES.SINGLE_MATCH;

  // For "right now" categories, check specific signals
  if (categoryId === 'free_tonight' && userActivities.includes('free_tonight')) {
    return INTEREST_SCORES.SINGLE_MATCH;
  }

  return INTEREST_SCORES.NO_MATCH;
}

/**
 * Calculate HYBRID score for a user in a given category
 *
 * Formula (TUNED):
 * score = base + fairExposureBoost - loadPenalty - softRepeatPenalty + subscriptionBoost
 * where base = (intentScore * 0.45) + (activityScore * 0.25) + (interestScore * 0.25) + randomness
 *
 * IMPORTANT: No hard filters - all scores contribute to final ranking.
 * Users can appear in ANY category if their hybrid score is high enough.
 *
 * @param user - User profile data
 * @param categoryId - Category to score
 * @param categoryLoad - Real count from DB (fetched once per batch, not per-call)
 * @param lastShownToViewer - When user was last shown to THIS viewer (for soft repeat)
 */
function calculateCategoryScore(
  user: {
    relationshipIntent: string[];
    activities: string[];
    lastActive: number;
    latitude?: number;
    longitude?: number;
    lastShownInDiscoverAt?: number;
    // Subscription fields (Task 1)
    subscriptionTier?: SubscriptionTier;
    subscriptionExpiresAt?: number;
  },
  categoryId: CategoryId,
  categoryLoad: number = 0,
  lastShownToViewer?: number, // For soft repeat penalty
): number {
  // Skip 'nearby' - requires viewer context
  if (categoryId === 'nearby') return 0;

  // Calculate component scores
  const intentScore = calculateIntentScore(user.relationshipIntent, categoryId);
  const activityScore = calculateActivityScore(user.lastActive);
  const interestScore = calculateInterestScore(user.activities, categoryId);

  // Apply hybrid weights (TUNED: 0.45 + 0.25 + 0.25 = 0.95)
  const weightedIntent = intentScore * HYBRID_WEIGHTS.INTENT;
  const weightedActivity = activityScore * HYBRID_WEIGHTS.ACTIVITY;
  const weightedInterest = interestScore * HYBRID_WEIGHTS.INTEREST;

  // Add randomness (0-15)
  const randomness = Math.floor(Math.random() * (RANDOMNESS_MAX + 1));

  // Fair exposure boost (prevent starvation - users not shown get priority)
  const fairExposureBoost = calculateFairExposureBoost(user.lastShownInDiscoverAt);

  // Category load penalty based on REAL DB count
  const loadPenalty = calculateCategoryLoadPenalty(categoryLoad);

  // Soft repeat penalty (prioritize new users over previously seen)
  const softRepeatPenalty = calculateSoftRepeatPenalty(lastShownToViewer);

  // Subscription boost (Task 3: small tier-based advantage)
  const subscriptionBoost = getSubscriptionBoostScore({
    subscriptionTier: user.subscriptionTier,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
  });

  // Final hybrid score with all modifiers (Task 3: boost added at the end)
  const score = weightedIntent + weightedActivity + weightedInterest + randomness
    + fairExposureBoost - loadPenalty - softRepeatPenalty + subscriptionBoost;

  return Math.max(0, score); // Ensure non-negative
}

/**
 * Find the best category for a user based on HYBRID scoring
 *
 * UPDATED: Now uses HARD FILTER based on user's relationship intent
 * - Step 1: Get allowed categories from user's intent (HARD FILTER)
 * - Step 2: Score ONLY allowed categories using hybrid scoring
 * - Step 3: Pick highest scoring category
 * - Step 4: Fallback to 'exploring_vibes' if no match
 *
 * Includes:
 * - Intent-based filtering (users ONLY appear in compatible categories)
 * - Fair exposure boost (users not shown in 24h/48h get priority)
 * - Load balancing penalty
 * - Subscription boost (small tier-based advantage)
 *
 * @param user - User profile data (including lastShownInDiscoverAt for fair exposure)
 * @param categoryLoads - Real counts from DB (fetched once per batch for performance)
 */
export function findBestCategory(
  user: {
    _id?: Id<'users'>;
    relationshipIntent: string[];
    activities: string[];
    lastActive: number;
    lastShownInDiscoverAt?: number; // For fair exposure boost
    // Subscription fields (Task 1)
    subscriptionTier?: SubscriptionTier;
    subscriptionExpiresAt?: number;
  },
  categoryLoads: Record<string, number> = {},
): CategoryId {
  // ---------------------------------------------------------------------------
  // TASK 2: HARD FILTER - Get allowed categories based on user's intent
  // ---------------------------------------------------------------------------
  const allowedCategories = getAllowedCategoriesForIntent(user.relationshipIntent);

  // ---------------------------------------------------------------------------
  // TASK 4: Hybrid scoring WITHIN allowed categories only
  // ---------------------------------------------------------------------------
  const categoryScores: Array<{ categoryId: CategoryId; score: number; load: number }> = [];

  for (const categoryId of allowedCategories) {
    // Skip 'nearby' - requires viewer context
    if (categoryId === 'nearby') continue;

    const load = categoryLoads[categoryId] ?? 0;
    // Pass user object with all fields for scoring (including subscription)
    const score = calculateCategoryScore(
      {
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        lastActive: user.lastActive,
        lastShownInDiscoverAt: user.lastShownInDiscoverAt,
        subscriptionTier: user.subscriptionTier,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
      },
      categoryId,
      load
    );
    categoryScores.push({ categoryId, score, load });
  }

  // Sort by score descending
  categoryScores.sort((a, b) => b.score - a.score);

  // Get best category
  const best = categoryScores[0];

  // ---------------------------------------------------------------------------
  // TASK 3: Fallback to 'exploring_vibes' if no allowed categories or all scores = 0
  // ---------------------------------------------------------------------------
  const selectedCategory = (best && best.score > 0)
    ? best.categoryId
    : 'exploring_vibes' as CategoryId;

  const topScore = best?.score ?? 0;

  return selectedCategory;
}

/**
 * Check if a user's category assignment needs refresh
 */
export function needsCategoryRefresh(
  assignedAt: number | undefined,
  lastShownAt: number | undefined,
): boolean {
  const now = Date.now();

  // No assignment yet - needs refresh
  if (!assignedAt) return true;

  // Within minimum window - keep current assignment
  if (now - assignedAt < CATEGORY_MIN_REASSIGN_MS) return false;

  // Past maximum window - force refresh
  if (now - assignedAt > CATEGORY_MAX_REASSIGN_MS) return true;

  // In 28-48h window: refresh only if not recently shown
  // If shown in cooldown, don't reassign to avoid churn
  if (lastShownAt && now - lastShownAt < SHOWN_COOLDOWN_MS) return false;

  // In window and not recently shown - allow refresh
  return true;
}

/**
 * Check if a user is in cooldown (was recently shown)
 */
export function isInShowCooldown(lastShownAt: number | undefined): boolean {
  if (!lastShownAt) return false;
  return Date.now() - lastShownAt < SHOWN_COOLDOWN_MS;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Fetch approximate category loads efficiently (Task 2 & 5)
 * Called once per assignment batch to avoid per-user DB queries
 */
async function fetchCategoryLoads(ctx: any): Promise<Record<string, number>> {
  const loads: Record<string, number> = {};

  // Fetch counts for all categories in parallel (Task 5: Keep it light)
  const allCategories = Object.values(CATEGORY_IDS).filter(c => c !== 'nearby');

  await Promise.all(
    allCategories.map(async (categoryId) => {
      try {
        const users = await ctx.db
          .query('users')
          .withIndex('by_discover_category', (q: any) =>
            q.eq('assignedDiscoverCategory', categoryId)
          )
          .filter((q: any) =>
            q.and(
              q.eq(q.field('isActive'), true),
              q.neq(q.field('isBanned'), true)
            )
          )
          .take(100); // Cap for efficiency

        loads[categoryId] = users.length;
      } catch {
        // Task 6: Fallback to 0 if error
        loads[categoryId] = 0;
      }
    })
  );

  return loads;
}

/**
 * Internal mutation to assign a category to a user
 * Called by discover queries when assignment is needed
 */
export const assignCategory = internalMutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    // Check if refresh is needed
    if (!needsCategoryRefresh(
      user.discoverCategoryAssignedAt,
      user.lastShownInDiscoverAt
    )) {
      // Return existing assignment
      return user.assignedDiscoverCategory;
    }

    // Task 2 & 5: Fetch category loads ONCE for this assignment
    const categoryLoads = await fetchCategoryLoads(ctx);

    // Calculate best category using HYBRID SCORING with real load data, fair exposure, and subscription boost
    const bestCategory = findBestCategory({
      _id: user._id,
      relationshipIntent: user.relationshipIntent ?? [],
      activities: user.activities ?? [],
      lastActive: user.lastActive ?? Date.now(),
      lastShownInDiscoverAt: user.lastShownInDiscoverAt, // For fair exposure boost
      // Subscription fields for boost scoring
      subscriptionTier: user.subscriptionTier as SubscriptionTier | undefined,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    }, categoryLoads);

    // Update user with new assignment
    await ctx.db.patch(args.userId, {
      assignedDiscoverCategory: bestCategory,
      discoverCategoryAssignedAt: Date.now(),
    });

    return bestCategory;
  },
});

/**
 * Mark a user as "shown" in Discover
 * Called when a profile is displayed to a viewer
 */
export const markAsShown = internalMutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      lastShownInDiscoverAt: Date.now(),
    });
  },
});

/**
 * Batch mark multiple users as shown (for efficiency)
 */
export const batchMarkAsShown = internalMutation({
  args: {
    userIds: v.array(v.id('users')),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await Promise.all(
      args.userIds.map(userId =>
        ctx.db.patch(userId, { lastShownInDiscoverAt: now })
      )
    );
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get users assigned to a specific category
 * Used by Explore grid to show profiles in a category
 *
 * Includes SOFT REPEAT system:
 * - First prioritizes new profiles (not shown in 7 days)
 * - If no new profiles, includes soft repeat eligible profiles (shown 48h-7d ago)
 * - Soft repeat profiles have lower score to prioritize new users
 */
export const getUsersByCategory = query({
  args: {
    categoryId: v.string(),
    viewerId: v.id('users'),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    includeSoftRepeat: v.optional(v.boolean()), // Enable soft repeat when no new profiles
  },
  handler: async (ctx, args) => {
    const { categoryId, viewerId, limit = 20, offset = 0, includeSoftRepeat = false } = args;
    const now = Date.now();

    // Fetch NEW users (not shown in 7 days)
    const newUsers = await ctx.db
      .query('users')
      .withIndex('by_discover_category', (q) =>
        q.eq('assignedDiscoverCategory', categoryId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('isActive'), true),
          q.neq(q.field('isBanned'), true),
          // Exclude users shown in last 7 days
          q.or(
            q.eq(q.field('lastShownInDiscoverAt'), undefined),
            q.lt(q.field('lastShownInDiscoverAt'), now - SHOWN_COOLDOWN_MS)
          )
        )
      )
      .take(offset + limit + 50);

    // Filter out self and apply viewer-specific rules
    const viewer = await ctx.db.get(viewerId);
    if (!viewer) return [];

    const filterUser = (user: any) => {
      if (user._id === viewerId) return false;
      if (!viewer.lookingFor.includes(user.gender)) return false;
      if (!user.lookingFor.includes(viewer.gender)) return false;
      return true;
    };

    let filteredNew = newUsers.filter(filterUser);

    // SOFT REPEAT: If not enough new users and soft repeat enabled, include eligible repeats
    let softRepeatUsers: any[] = [];
    if (includeSoftRepeat && filteredNew.length < limit) {
      // Fetch users shown 48h-7d ago (eligible for soft repeat)
      const softRepeatCandidates = await ctx.db
        .query('users')
        .withIndex('by_discover_category', (q) =>
          q.eq('assignedDiscoverCategory', categoryId)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field('isActive'), true),
            q.neq(q.field('isBanned'), true),
            // Between 48h and 7d ago
            q.gte(q.field('lastShownInDiscoverAt'), now - SHOWN_COOLDOWN_MS),
            q.lt(q.field('lastShownInDiscoverAt'), now - SOFT_REPEAT_COOLDOWN_MS)
          )
        )
        .take(limit - filteredNew.length + 20);

      softRepeatUsers = softRepeatCandidates.filter(filterUser);
    }

    // Combine: new users first, then soft repeat (with marker)
    const combined = [
      ...filteredNew.slice(offset, offset + limit).map(user => ({
        id: user._id,
        name: user.name,
        assignedCategory: user.assignedDiscoverCategory,
        lastShownAt: user.lastShownInDiscoverAt,
        isSoftRepeat: false,
      })),
      ...softRepeatUsers.slice(0, Math.max(0, limit - filteredNew.length)).map(user => ({
        id: user._id,
        name: user.name,
        assignedCategory: user.assignedDiscoverCategory,
        lastShownAt: user.lastShownInDiscoverAt,
        isSoftRepeat: true, // Mark as soft repeat for scoring penalty
      })),
    ];

    return combined;
  },
});

/**
 * Get category counts for the Explore grid badges
 * Shows how many users are in each category
 */
export const getCategoryCounts = query({
  args: {
    viewerId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const viewer = await ctx.db.get(args.viewerId);
    if (!viewer) return {};

    const counts: Record<string, number> = {};
    const cooldownThreshold = Date.now() - SHOWN_COOLDOWN_MS;

    // Count users per category
    for (const categoryId of Object.values(CATEGORY_IDS)) {
      if (categoryId === 'nearby') continue; // nearby requires location context

      const users = await ctx.db
        .query('users')
        .withIndex('by_discover_category', (q) =>
          q.eq('assignedDiscoverCategory', categoryId)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field('isActive'), true),
            q.neq(q.field('isBanned'), true),
            q.or(
              q.eq(q.field('lastShownInDiscoverAt'), undefined),
              q.lt(q.field('lastShownInDiscoverAt'), cooldownThreshold)
            )
          )
        )
        .take(100); // Cap for efficiency

      // Apply viewer filters
      const validCount = users.filter(user => {
        if (user._id === args.viewerId) return false;
        if (!viewer.lookingFor.includes(user.gender)) return false;
        if (!user.lookingFor.includes(viewer.gender)) return false;
        return true;
      }).length;

      counts[categoryId] = validCount;
    }

    return counts;
  },
});

// ---------------------------------------------------------------------------
// Test Mutations (Task 6: Debug helpers)
// ---------------------------------------------------------------------------

/**
 * Set subscription tier for a user (TEST ONLY)
 * Used to test subscription boost scoring
 *
 * @param userId - User to update
 * @param tier - Subscription tier ('free' | 'basic' | 'premium')
 * @param expiresInDays - Optional: days until expiration (default: 30)
 */
export const setSubscriptionTier = mutation({
  args: {
    userId: v.id('users'),
    tier: v.union(
      v.literal('free'),
      v.literal('basic'),
      v.literal('premium')
    ),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, tier, expiresInDays = 30 } = args;

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const expiresAt = tier === 'free'
      ? undefined
      : Date.now() + (expiresInDays * 24 * 60 * 60 * 1000);

    await ctx.db.patch(userId, {
      subscriptionTier: tier,
      subscriptionExpiresAt: expiresAt,
    });

    // Debug logging
    console.log('[SetSubscription]', {
      userId,
      tier,
      expiresAt,
      expiresInDays,
      boostValue: SUBSCRIPTION_BOOST_VALUES[tier as SubscriptionTier],
    });

    return {
      success: true,
      tier,
      expiresAt,
      boostValue: SUBSCRIPTION_BOOST_VALUES[tier as SubscriptionTier],
    };
  },
});

/**
 * Clear subscription for a user (TEST ONLY)
 * Removes subscription tier and expiration
 */
export const clearSubscription = mutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error('User not found');
    }

    await ctx.db.patch(args.userId, {
      subscriptionTier: 'free',
      subscriptionExpiresAt: undefined,
    });

    console.log('[ClearSubscription]', { userId: args.userId });

    return { success: true };
  },
});
