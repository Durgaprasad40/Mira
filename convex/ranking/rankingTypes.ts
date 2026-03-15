/**
 * Shared Ranking Types
 *
 * Defines the normalized data model used by the shared ranking engine.
 * Both Phase-1 and Phase-2 adapters map their schema-specific data
 * into these normalized types before calling the ranking engine.
 *
 * Phase 0: Scaffolding only - no production integration yet.
 */

// ---------------------------------------------------------------------------
// Normalized Candidate (Profile being ranked)
// ---------------------------------------------------------------------------

/**
 * Normalized profile representation for ranking.
 * Adapters map phase-specific schemas into this common format.
 */
export interface NormalizedCandidate {
  // Identity
  id: string;                           // Convex ID as string
  phase: 'phase1' | 'phase2';           // Source phase (for debugging/logging)

  // Compatibility signals (used for matching)
  relationshipIntent: string[];         // Phase-1: direct, Phase-2: intentKeys mapped
  activities: string[];                 // Phase-1: activities, Phase-2: hobbies

  lifestyle: {                          // Lifestyle preferences
    smoking?: string;
    drinking?: string;
    kids?: string;
    religion?: string;
  };

  lifeRhythm?: {                        // Phase-1 only (optional)
    socialRhythm?: string;
    sleepSchedule?: string;
    travelStyle?: string;
    workStyle?: string;
    coreValues?: string[];
  };

  seedQuestions?: {                     // Phase-1 only (optional)
    identityAnchor?: string;
    socialBattery?: number;
    valueTrigger?: string;
  };

  // Profile quality signals
  bioLength: number;                    // Character count of bio
  promptsAnswered: number;              // Number of prompts filled
  photoCount: number;                   // Number of photos

  hasOptionalFields: {                  // Optional profile fields filled
    height: boolean;
    jobTitle: boolean;
    education: boolean;
  };

  // Trust/verification
  isVerified: boolean;

  // Activity signals
  lastActiveAt: number;                 // Timestamp of last activity
  createdAt: number;                    // Account creation timestamp

  // Location
  distance?: number;                    // Distance from viewer in km (undefined = unknown)

  // Mutual interest
  theyLikedMe: boolean;                 // Phase-1: from likes table, Phase-2: false
  isBoosted: boolean;                   // Paid boost active

  // Trust signals (aggregate counts)
  reportCount: number;                  // Total reports against this user
  blockCount: number;                   // Total blocks against this user

  // Fairness signals (from phase2RankingMetrics or defaults)
  totalImpressions: number;             // How many times shown globally
  lastShownAt: number;                  // When last shown to any viewer
  onboardedAt: number;                  // When onboarding completed (for new user boost)
}

// ---------------------------------------------------------------------------
// Normalized Viewer (User viewing profiles)
// ---------------------------------------------------------------------------

/**
 * Normalized viewer representation for ranking.
 * Contains the viewer's preferences used for compatibility matching.
 */
export interface NormalizedViewer {
  id: string;                           // Convex ID as string
  phase: 'phase1' | 'phase2';

  // Compatibility preferences
  relationshipIntent: string[];
  activities: string[];

  lifestyle: {
    smoking?: string;
    drinking?: string;
    kids?: string;
    religion?: string;
  };

  lifeRhythm?: {
    socialRhythm?: string;
    sleepSchedule?: string;
    travelStyle?: string;
    workStyle?: string;
    coreValues?: string[];
  };

  seedQuestions?: {
    identityAnchor?: string;
    socialBattery?: number;
    valueTrigger?: string;
  };

  // Location preferences
  maxDistance: number;

  // Trust context (viewer-specific exclusions - already applied before ranking)
  // These are informational; hard filtering happens in the query layer
  blockedIds: Set<string>;              // Users viewer has blocked
  reportedIds: Set<string>;             // Users viewer has reported
}

// ---------------------------------------------------------------------------
// Trust Signals (Aggregate safety data)
// ---------------------------------------------------------------------------

/**
 * Aggregate trust signals used for soft penalties.
 * Viewer-specific exclusions are handled at the query layer (hard filter).
 * These aggregate counts create soft ranking penalties.
 */
export interface TrustSignals {
  aggregateReportCounts: Map<string, number>;  // userId -> report count
  aggregateBlockCounts: Map<string, number>;   // userId -> block count
}

// ---------------------------------------------------------------------------
// Fairness Context (Per-viewer fairness data)
// ---------------------------------------------------------------------------

/**
 * Per-viewer fairness context for suppression and impression tracking.
 * Used by the fairness layer to ensure variety in results.
 */
export interface FairnessContext {
  recentlySeenIds: Set<string>;         // Candidate IDs seen within suppression window
  impressionCounts: Map<string, number>; // userId -> times shown to this viewer
}

// ---------------------------------------------------------------------------
// Ranking Configuration (Tunable parameters)
// ---------------------------------------------------------------------------

/**
 * Configuration for the ranking engine.
 * Weights must sum to 1.0.
 */
export interface RankingConfig {
  // Weights (must sum to 1.0)
  weights: {
    compatibility: number;       // Default: 0.40
    profileQuality: number;      // Default: 0.20
    mutualInterest: number;      // Default: 0.10
    activityRecency: number;     // Default: 0.10
    distance: number;            // Default: 0.10
    fairness: number;            // Default: 0.10
  };

  // Exploration
  explorationRatio: number;      // Default: 0.20 (20% exploration)

  // Boosts (added to final score)
  boosts: {
    theyLikedMe: number;         // Default: +25
    isBoosted: number;           // Default: +20
    verified: number;            // Default: +15
    newUser7Days: number;        // Default: +10 (decaying)
    lowImpressions: number;      // Default: +10 (for < 10 impressions)
  };

  // Trust penalties
  trustPenalty: {
    perReport: number;           // Default: -5
    perBlock: number;            // Default: -3
    maxPenalty: number;          // Default: -30
  };

  // Fairness
  suppressionWindowMs: number;   // Default: 4 hours (14400000ms)
  newUserBoostDays: number;      // Default: 7 days

  // Fallback
  fallbackMinSignals: number;    // Default: 2
}

// ---------------------------------------------------------------------------
// Ranking Result
// ---------------------------------------------------------------------------

/**
 * Result from the ranking engine.
 */
export interface RankingResult {
  rankedCandidates: NormalizedCandidate[];
  exhausted: boolean;            // True if pool was smaller than requested
  fallbackUsed: boolean;         // True if fallback pool was activated
}

// ---------------------------------------------------------------------------
// Scored Candidate (Internal)
// ---------------------------------------------------------------------------

/**
 * Internal type used during scoring.
 */
export interface ScoredCandidate {
  candidate: NormalizedCandidate;
  score: number;
  scoreBreakdown?: {             // Optional debug info
    compatibility: number;
    profileQuality: number;
    mutualInterest: number;
    activityRecency: number;
    distance: number;
    fairness: number;
    boosts: number;
    penalty: number;
  };
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

/**
 * Default ranking configuration matching Phase-1 behavior.
 * These values are proven in production.
 */
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  weights: {
    compatibility: 0.40,
    profileQuality: 0.20,
    mutualInterest: 0.10,
    activityRecency: 0.10,
    distance: 0.10,
    fairness: 0.10,
  },

  explorationRatio: 0.20,

  boosts: {
    theyLikedMe: 25,
    isBoosted: 20,
    verified: 15,
    newUser7Days: 10,
    lowImpressions: 10,
  },

  trustPenalty: {
    perReport: 5,
    perBlock: 3,
    maxPenalty: 30,
  },

  suppressionWindowMs: 4 * 60 * 60 * 1000, // 4 hours
  newUserBoostDays: 7,

  fallbackMinSignals: 2,
};
