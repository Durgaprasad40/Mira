/**
 * Discovery Types
 *
 * Shared normalized types for the compatibility-based discovery engine.
 * Used by both Phase-1 (Discover) and Phase-2 (Desire Land) through adapters.
 *
 * This module is ADDITIVE - it does not modify any existing ranking/discovery logic.
 */

// No external imports needed - pure type definitions

// ---------------------------------------------------------------------------
// Core Normalized Types
// ---------------------------------------------------------------------------

/**
 * Normalized candidate profile for discovery scoring.
 * Both Phase-1 and Phase-2 profiles are mapped to this shape via adapters.
 */
export interface NormalizedDiscoveryCandidate {
  // Identity
  id: string;
  phase: 'phase1' | 'phase2';

  // Demographics
  age: number;
  gender: string;
  city?: string;

  // Location (Phase-1 only - Phase-2 has no coordinates)
  latitude?: number;
  longitude?: number;
  distance?: number; // Pre-computed if viewer has location

  // Relationship & Intent
  relationshipIntent: string[];
  lookingFor: string[];

  // Children preference
  kids?: string;

  // Activities/Interests
  activities: string[];

  // Lifestyle
  lifestyle: {
    smoking?: string;
    drinking?: string;
    exercise?: string;
    religion?: string;
    pets?: string[];
  };

  // Archetype (identity anchor: builder/performer/seeker/grounded)
  // Phase-2 may not have this - adapter provides neutral fallback
  archetype?: string;
  archetypeAvailable: boolean;

  // Bucket/Section Prompts
  // Section prompts indicate which "bucket" the user relates to
  bucketSignals: {
    builder: number;   // 0-1 strength based on prompts answered
    performer: number;
    seeker: number;
    grounded: number;
  };
  bucketAvailable: boolean;

  // Social Battery (1-5 scale)
  // Phase-2 may not have this - adapter provides neutral fallback
  socialBattery?: number;
  batteryAvailable: boolean;

  // Core Values
  coreValues: string[];
  valuesAvailable: boolean;

  // Life Rhythm
  lifeRhythm: {
    socialRhythm?: string;
    sleepSchedule?: string;
    travelStyle?: string;
    workStyle?: string;
  };
  lifeRhythmAvailable: boolean;

  // Profile Content
  bio: string;
  bioLength: number;
  prompts: { question: string; answer: string }[];
  promptsAnswered: number;
  photoCount: number;

  // Activity & Freshness
  lastActiveAt: number;
  createdAt: number;
  onboardedAt?: number;

  // Verification
  isVerified: boolean;
  verificationStatus?: string;

  // Inbound Interest Signals
  theyLikedMe: boolean;
  theySuperLikedMe: boolean;
  theyTextedMe: boolean;

  // Viewed You Signal (if available)
  viewedYou: boolean;

  // Trust Signals (for penalty calculation)
  reportCount: number;
  blockCount: number;

  // Fairness Signals
  totalImpressions?: number;
  lastShownAt?: number;

  // Phase-2 Specific
  preferenceStrength?: {
    smoking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    drinking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    intent?: 'not_important' | 'prefer_similar' | 'important' | 'must_match_exactly';
  };
}

/**
 * Viewer context for discovery - the person viewing the feed.
 */
export interface DiscoveryViewerContext {
  // Identity
  id: string;
  phase: 'phase1' | 'phase2';

  // Demographics
  age: number;
  gender: string;
  city?: string;

  // Location
  latitude?: number;
  longitude?: number;

  // Preferences
  lookingFor: string[];
  minAge: number;
  maxAge: number;
  maxDistance: number;

  // Relationship & Intent
  relationshipIntent: string[];

  // Children preference
  kids?: string;

  // Activities/Interests
  activities: string[];

  // Lifestyle
  lifestyle: {
    smoking?: string;
    drinking?: string;
    exercise?: string;
    religion?: string;
    pets?: string[];
  };

  // Archetype
  archetype?: string;
  archetypeAvailable: boolean;

  // Bucket Signals
  bucketSignals: {
    builder: number;
    performer: number;
    seeker: number;
    grounded: number;
  };
  bucketAvailable: boolean;

  // Social Battery
  socialBattery?: number;
  batteryAvailable: boolean;

  // Core Values
  coreValues: string[];
  valuesAvailable: boolean;

  // Life Rhythm
  lifeRhythm: {
    socialRhythm?: string;
    sleepSchedule?: string;
    travelStyle?: string;
    workStyle?: string;
  };
  lifeRhythmAvailable: boolean;

  // Bio/Prompts (for chemistry scoring)
  bio: string;
  prompts: { question: string; answer: string }[];

  // Blocked/Reported Sets (for filtering)
  blockedIds: Set<string>;
  reportedIds: Set<string>;

  // Phase-2 Specific
  preferenceStrength?: {
    smoking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    drinking?: 'not_important' | 'slight_preference' | 'important' | 'deal_breaker';
    intent?: 'not_important' | 'prefer_similar' | 'important' | 'must_match_exactly';
  };
}

// ---------------------------------------------------------------------------
// Score Breakdown Types
// ---------------------------------------------------------------------------

/**
 * Breakdown of compatibility subscores (all 0-1 scale).
 */
export interface DiscoveryScoreBreakdown {
  // Base subscores (0-1 each)
  archetypeScore: number;
  valuesScore: number;
  lifestyleScore: number;
  interestScore: number;
  bucketScore: number;
  batteryScore: number;
  expressionScore: number;
  intentScore: number;

  // Weighted base score (0-1)
  baseScore: number;

  // Scaled base score (0-100)
  scaledBaseScore: number;
}

/**
 * Breakdown of penalties applied.
 */
export interface DiscoveryPenaltyBreakdown {
  distancePenalty: number;
  childrenPenalty: number;
  lifestyleDealbreaker: number;
  lowEffortPenalty: number;
  trustPenalty: number;

  // Total penalty applied
  totalPenalty: number;
}

/**
 * Breakdown of boosts applied.
 * Note: No premium-style artificial boosts. Verification is handled in eligibility, not here.
 */
export interface DiscoveryBoostBreakdown {
  activeUserBoost: number;
  inboundInterestBoost: number;
  viewedYouBoost: number;
  fairnessAdjustment: number;
  explorationRandomness: number;

  // Total boost applied
  totalBoost: number;
}

/**
 * Full breakdown for a ranked candidate.
 */
export interface DiscoveryFullBreakdown {
  scores: DiscoveryScoreBreakdown;
  penalties: DiscoveryPenaltyBreakdown;
  boosts: DiscoveryBoostBreakdown;
}

/**
 * Final ranked candidate with score and breakdown.
 */
export interface RankedDiscoveryCandidate {
  candidate: NormalizedDiscoveryCandidate;
  finalScore: number;
  breakdown: DiscoveryFullBreakdown;
}

// ---------------------------------------------------------------------------
// Filter Result Types
// ---------------------------------------------------------------------------

/**
 * Result of eligibility filtering.
 */
export interface FilterResult {
  eligible: NormalizedDiscoveryCandidate[];
  excluded: {
    candidate: NormalizedDiscoveryCandidate;
    reason: ExclusionReason;
  }[];
}

/**
 * Reasons for hard exclusion.
 */
export type ExclusionReason =
  | 'self'
  | 'blocked_by_viewer'
  | 'blocked_viewer'
  | 'reported_by_viewer'
  | 'distance_exceeded'
  | 'unavailable'
  | 'unverified'; // Only if product rules require verification

// ---------------------------------------------------------------------------
// Discovery Engine Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the discovery engine.
 */
export interface DiscoveryEngineConfig {
  // Score weights (must sum to 1.0)
  weights: {
    archetype: number;
    values: number;
    lifestyle: number;
    interest: number;
    bucket: number;
    battery: number;
    expression: number;
    intent: number;
  };

  // Distance thresholds (km)
  distance: {
    softPenaltyStart: number;  // Start soft penalty at this distance
    hardRejectAt: number;      // Hard reject beyond this distance
    maxPenalty: number;        // Max penalty points for distance
  };

  // Penalty caps
  penalties: {
    childrenMismatchMax: number;
    lifestyleDealbreaker: number;
    lowEffortMax: number;
    trustPerReport: number;
    trustPerBlock: number;
    trustMax: number;
  };

  // Boost values (kept modest so compatibility remains dominant)
  boosts: {
    activeRecent: number;      // Active in last 1 hour
    activeToday: number;       // Active in last 24 hours
    inboundLike: number;       // They liked you
    inboundSuperLike: number;  // They super liked you
    inboundText: number;       // They texted you
    viewedYou: number;         // They viewed your profile
    fairnessMax: number;       // Max fairness adjustment
    explorationMax: number;    // Max exploration randomness
  };

  // Exploration settings
  exploration: {
    ratio: number;             // % of results from exploration pool
    fairnessWeight: number;    // Weight for underexposed profiles
  };
}

/**
 * Default configuration for the discovery engine.
 * Follows the approved formula from product specification.
 */
export const DEFAULT_DISCOVERY_CONFIG: DiscoveryEngineConfig = {
  weights: {
    archetype: 0.20,
    values: 0.20,
    lifestyle: 0.18,
    interest: 0.12,
    bucket: 0.15,
    battery: 0.07,
    expression: 0.03,
    intent: 0.05,
  },

  distance: {
    softPenaltyStart: 50,     // No penalty under 50km
    hardRejectAt: 200,        // Reject beyond 200km
    maxPenalty: 15,           // Max 15 points penalty
  },

  penalties: {
    childrenMismatchMax: 10,
    lifestyleDealbreaker: 8,
    lowEffortMax: 12,
    trustPerReport: 5,
    trustPerBlock: 3,
    trustMax: 30,
  },

  boosts: {
    activeRecent: 4,
    activeToday: 2,
    inboundLike: 8,
    inboundSuperLike: 12,
    inboundText: 10,
    viewedYou: 3,
    fairnessMax: 4,
    explorationMax: 3,
  },

  exploration: {
    ratio: 0.15,              // 15% exploration
    fairnessWeight: 0.5,
  },
};

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

/**
 * Options for running the discovery engine.
 */
export interface DiscoveryEngineOptions {
  limit: number;
  includeBreakdown?: boolean;
  enableExploration?: boolean;
  enableFairness?: boolean;
  config?: Partial<DiscoveryEngineConfig>;
}

/**
 * Result from the discovery engine.
 */
export interface DiscoveryEngineResult {
  ranked: RankedDiscoveryCandidate[];
  totalCandidates: number;
  totalEligible: number;
  excluded: number;
  explorationUsed: boolean;
}
