/**
 * Phase-1 Adapter
 *
 * Maps Phase-1 schema (users table) into the shared ranking input model.
 * This adapter is called by discover.ts to prepare data for the shared engine.
 *
 * Phase 1: Adapter scaffolding only - no production integration yet.
 *
 * Usage (future integration):
 * ```ts
 * const candidate = toNormalizedCandidate(user, {
 *   photoCount: photos.length,
 *   distance: computedDistance,
 *   theyLikedMe: likesSet.has(user._id),
 *   reportCount: reportCounts.get(user._id) ?? 0,
 *   blockCount: blockCounts.get(user._id) ?? 0,
 * });
 * ```
 */

import { Id } from '../_generated/dataModel';
import { NormalizedCandidate, NormalizedViewer } from './rankingTypes';

// ---------------------------------------------------------------------------
// Phase-1 User Type (matches users table schema)
// ---------------------------------------------------------------------------

/**
 * Phase-1 user record shape from the users table.
 * This mirrors the relevant fields from schema.ts users table.
 */
export interface Phase1User {
  _id: Id<'users'>;

  // Basic info
  name: string;
  dateOfBirth: string;
  gender: string;
  bio: string;

  // Profile details
  height?: number;
  jobTitle?: string;
  education?: string;
  smoking?: string;
  drinking?: string;
  religion?: string;
  kids?: string;

  // Verification
  isVerified: boolean;

  // Activity
  lastActive: number;
  createdAt: number;

  // Preferences (for viewer mapping)
  lookingFor: string[];
  relationshipIntent: string[];
  activities: string[];
  minAge: number;
  maxAge: number;
  maxDistance: number;

  // Location
  city?: string;
  latitude?: number;
  longitude?: number;

  // Boost
  boostedUntil?: number;

  // Profile prompts
  profilePrompts?: { question: string; answer: string }[];

  // Onboarding draft (for life rhythm and seed questions)
  onboardingDraft?: {
    lifeRhythm?: {
      socialRhythm?: string;
      sleepSchedule?: string;
      travelStyle?: string;
      workStyle?: string;
      coreValues?: string[];
    };
    profileDetails?: {
      seedQuestions?: {
        identityAnchor?: string;
        socialBattery?: number;
        valueTrigger?: string;
      };
    };
  };
}

// ---------------------------------------------------------------------------
// Additional Context (passed from query layer)
// ---------------------------------------------------------------------------

/**
 * Additional context provided by the query layer.
 * These values require database lookups that happen in discover.ts.
 */
export interface Phase1CandidateContext {
  photoCount: number;              // Count of non-NSFW photos
  distance?: number;               // Computed distance in km (undefined if unknown)
  theyLikedMe: boolean;            // Whether this user has liked the viewer
  reportCount: number;             // Aggregate report count
  blockCount: number;              // Aggregate block count
}

/**
 * Context for the viewer (current user).
 */
export interface Phase1ViewerContext {
  blockedIds: Set<string>;         // Users the viewer has blocked
  reportedIds: Set<string>;        // Users the viewer has reported
}

// ---------------------------------------------------------------------------
// Candidate Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a Phase-1 user to a NormalizedCandidate.
 *
 * @param user - The Phase-1 user record from the users table
 * @param context - Additional context from query layer (photos, likes, trust signals)
 * @returns NormalizedCandidate for use with the shared ranking engine
 */
export function toNormalizedCandidate(
  user: Phase1User,
  context: Phase1CandidateContext
): NormalizedCandidate {
  // SAFETY: Guard all array accesses
  const relationshipIntent = user.relationshipIntent ?? [];
  const activities = user.activities ?? [];
  const profilePrompts = user.profilePrompts ?? [];

  // Count filled prompts
  const promptsAnswered = profilePrompts.filter(
    p => p.answer?.trim().length > 0
  ).length;

  // Bio length
  const bioLength = user.bio?.trim().length ?? 0;

  // Check if boosted
  const isBoosted = !!(user.boostedUntil && user.boostedUntil > Date.now());

  return {
    // Identity
    id: user._id as string,
    phase: 'phase1',

    // Compatibility signals
    relationshipIntent,
    activities,

    lifestyle: {
      smoking: user.smoking,
      drinking: user.drinking,
      kids: user.kids,
      religion: user.religion,
    },

    lifeRhythm: user.onboardingDraft?.lifeRhythm,

    seedQuestions: user.onboardingDraft?.profileDetails?.seedQuestions,

    // Profile quality signals
    bioLength,
    promptsAnswered,
    photoCount: context.photoCount,

    hasOptionalFields: {
      height: !!user.height,
      jobTitle: !!user.jobTitle,
      education: !!user.education,
    },

    // Trust/verification
    isVerified: user.isVerified,

    // Activity signals
    lastActiveAt: user.lastActive,
    createdAt: user.createdAt,

    // Location
    distance: context.distance,

    // Mutual interest
    theyLikedMe: context.theyLikedMe,
    isBoosted,

    // Trust signals
    reportCount: context.reportCount,
    blockCount: context.blockCount,

    // Fairness signals (Phase-1 doesn't track impressions)
    totalImpressions: 0,
    lastShownAt: 0,
    onboardedAt: user.createdAt, // Use account creation as proxy
  };
}

// ---------------------------------------------------------------------------
// Viewer Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a Phase-1 current user to a NormalizedViewer.
 *
 * @param user - The Phase-1 user record (viewer)
 * @param context - Trust context (blocked/reported IDs)
 * @returns NormalizedViewer for use with the shared ranking engine
 */
export function toNormalizedViewer(
  user: Phase1User,
  context: Phase1ViewerContext
): NormalizedViewer {
  return {
    id: user._id as string,
    phase: 'phase1',

    // Compatibility preferences
    relationshipIntent: user.relationshipIntent ?? [],
    activities: user.activities ?? [],

    lifestyle: {
      smoking: user.smoking,
      drinking: user.drinking,
      kids: user.kids,
      religion: user.religion,
    },

    lifeRhythm: user.onboardingDraft?.lifeRhythm,

    seedQuestions: user.onboardingDraft?.profileDetails?.seedQuestions,

    // Location preferences
    maxDistance: user.maxDistance,

    // Trust context
    blockedIds: context.blockedIds,
    reportedIds: context.reportedIds,
  };
}

// ---------------------------------------------------------------------------
// Batch Adapter (for efficiency)
// ---------------------------------------------------------------------------

/**
 * Convert multiple Phase-1 users to NormalizedCandidates.
 * Useful for batch processing in discover.ts.
 *
 * @param users - Array of Phase-1 user records
 * @param contextMap - Map of userId to context
 * @returns Array of NormalizedCandidates
 */
export function toNormalizedCandidates(
  users: Phase1User[],
  contextMap: Map<string, Phase1CandidateContext>
): NormalizedCandidate[] {
  return users.map(user => {
    const context = contextMap.get(user._id as string);
    if (!context) {
      // Default context if missing (shouldn't happen in practice)
      return toNormalizedCandidate(user, {
        photoCount: 0,
        distance: undefined,
        theyLikedMe: false,
        reportCount: 0,
        blockCount: 0,
      });
    }
    return toNormalizedCandidate(user, context);
  });
}

// ---------------------------------------------------------------------------
// Validation Helper
// ---------------------------------------------------------------------------

/**
 * Validate that a Phase-1 user has minimum required fields.
 * Used for defensive programming - catches schema issues early.
 */
export function isValidPhase1User(user: unknown): user is Phase1User {
  if (!user || typeof user !== 'object') return false;
  const u = user as Record<string, unknown>;

  return (
    typeof u._id === 'string' &&
    typeof u.name === 'string' &&
    typeof u.bio === 'string' &&
    typeof u.isVerified === 'boolean' &&
    typeof u.lastActive === 'number' &&
    typeof u.createdAt === 'number' &&
    Array.isArray(u.lookingFor) &&
    Array.isArray(u.relationshipIntent) &&
    Array.isArray(u.activities) &&
    typeof u.maxDistance === 'number'
  );
}
