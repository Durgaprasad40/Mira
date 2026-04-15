/**
 * Phase-2 Adapter
 *
 * Maps Phase-2 schema (userPrivateProfiles table) into the shared ranking input model.
 * This adapter is called by privateDiscover.ts to prepare data for the shared engine.
 *
 * Phase 1: Adapter scaffolding only - no production integration yet.
 *
 * Schema differences from Phase-1:
 * - Uses `privateIntentKeys` instead of `relationshipIntent`
 * - Uses `hobbies` instead of `activities`
 * - Uses `privateBio` instead of `bio`
 * - Has `promptAnswers` array instead of `profilePrompts`
 * - No swipe system (theyLikedMe always false)
 * - No boost system (isBoosted always false)
 * - No distance computation
 * - Has impression tracking (totalImpressions, lastShownAt)
 * - No life rhythm or seed questions
 *
 * Usage (future integration):
 * ```ts
 * const candidate = toNormalizedCandidate(profile, metrics, {
 *   blockCount: blockCounts.get(profile.userId) ?? 0,
 * });
 * ```
 */

import { Id } from '../_generated/dataModel';
import { NormalizedCandidate, NormalizedViewer, FairnessContext } from './rankingTypes';
import { normalizeRelationshipIntentValues } from '../../lib/discoveryNaming';

// ---------------------------------------------------------------------------
// Phase-2 Profile Type (matches userPrivateProfiles table schema)
// ---------------------------------------------------------------------------

/**
 * Phase-2 private profile record shape.
 * This mirrors the relevant fields from schema.ts userPrivateProfiles table.
 */
export interface Phase2PrivateProfile {
  _id: Id<'userPrivateProfiles'>;
  userId: Id<'users'>;

  // Basic info
  displayName: string;
  age: number;
  city?: string;
  gender: string;

  // Phase-2 specific fields
  privateIntentKeys: string[];          // Maps to relationshipIntent
  privateDesireTagKeys: string[];
  privateBio?: string;                  // Maps to bio
  privatePhotoUrls: string[];           // Photo URLs

  // Profile details (imported from Phase-1 or edited)
  hobbies?: string[];                   // Maps to activities
  isVerified?: boolean;
  height?: number;
  weight?: number;
  smoking?: string;
  drinking?: string;
  education?: string;
  religion?: string;

  // Prompts
  promptAnswers?: Array<{
    promptId: string;
    answer: string;
  }>;

  // Status
  isPrivateEnabled: boolean;
  isSetupComplete: boolean;

  // Timestamps
  createdAt?: number;
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// Phase-2 Ranking Metrics Type
// ---------------------------------------------------------------------------

/**
 * Phase-2 ranking metrics from phase2RankingMetrics table.
 */
export interface Phase2RankingMetrics {
  userId: Id<'users'>;
  phase2OnboardedAt: number;
  lastPhase2ActiveAt: number;
  totalImpressions: number;
  lastShownAt: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Additional Context (passed from query layer)
// ---------------------------------------------------------------------------

/**
 * Additional context provided by the query layer.
 */
export interface Phase2CandidateContext {
  blockCount: number;              // Aggregate block count (shared with Phase-1)
}

/**
 * Context for the viewer.
 */
export interface Phase2ViewerContext {
  blockedIds: Set<string>;         // Users the viewer has blocked
  desireTagKeys?: string[];        // Viewer's desire tags for ranking boost
}

// ---------------------------------------------------------------------------
// Candidate Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a Phase-2 private profile to a NormalizedCandidate.
 *
 * @param profile - The Phase-2 private profile record
 * @param metrics - Optional ranking metrics (may not exist for new profiles)
 * @param context - Additional context from query layer
 * @returns NormalizedCandidate for use with the shared ranking engine
 */
export function toNormalizedCandidate(
  profile: Phase2PrivateProfile,
  metrics: Phase2RankingMetrics | null | undefined,
  context: Phase2CandidateContext
): NormalizedCandidate {
  const now = Date.now();

  // SAFETY: Guard all array accesses
  const intentKeys = normalizeRelationshipIntentValues(profile.privateIntentKeys ?? []);
  const hobbies = profile.hobbies ?? [];
  const desireTagKeys = profile.privateDesireTagKeys ?? [];
  const promptAnswers = profile.promptAnswers ?? [];
  const photoUrls = profile.privatePhotoUrls ?? [];

  // Count filled prompts
  const promptsAnswered = promptAnswers.filter(
    p => p.answer?.trim().length > 0
  ).length;

  // Bio length
  const bioLength = profile.privateBio?.trim().length ?? 0;

  // Default metrics if not available
  const onboardedAt = metrics?.phase2OnboardedAt ?? profile.createdAt ?? now;
  const lastActiveAt = metrics?.lastPhase2ActiveAt ?? profile.updatedAt ?? now;
  const totalImpressions = metrics?.totalImpressions ?? 0;
  const lastShownAt = metrics?.lastShownAt ?? 0;

  return {
    // Identity
    id: profile.userId as string,  // Use userId, not _id (profile ID)
    phase: 'phase2',

    // Compatibility signals
    // NOTE: Phase-2 uses different field names
    relationshipIntent: intentKeys,  // privateIntentKeys -> relationshipIntent
    activities: hobbies,             // hobbies -> activities
    desireTagKeys,                   // Phase-2 desire alignment boost

    lifestyle: {
      smoking: profile.smoking,
      drinking: profile.drinking,
      kids: undefined,               // Not in Phase-2 schema
      religion: profile.religion,
    },

    // Not available in Phase-2
    lifeRhythm: undefined,
    seedQuestions: undefined,

    // Profile quality signals
    bioLength,
    promptsAnswered,
    photoCount: photoUrls.length,

    hasOptionalFields: {
      height: !!profile.height,
      jobTitle: false,               // Not in Phase-2 schema
      education: !!profile.education,
    },

    // Trust/verification
    isVerified: profile.isVerified ?? false,

    // Activity signals
    lastActiveAt,
    createdAt: profile.createdAt ?? now,

    // Location - Phase-2 doesn't compute distance
    distance: undefined,

    // Mutual interest - Phase-2 has no swipe system
    theyLikedMe: false,
    isBoosted: false,

    // Trust signals
    reportCount: 0,                  // Phase-2 uses blocks only
    blockCount: context.blockCount,

    // Fairness signals (Phase-2 tracks impressions)
    totalImpressions,
    lastShownAt,
    onboardedAt,
  };
}

// ---------------------------------------------------------------------------
// Viewer Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a Phase-2 viewer context to a NormalizedViewer.
 *
 * Note: Phase-2 viewers have minimal compatibility data because
 * Phase-2 (Deep Connect) doesn't do compatibility matching the same way.
 * The shared engine will still work, but compatibility scores will be low.
 *
 * @param viewerId - The viewer's user ID
 * @param context - Trust context (blocked IDs)
 * @returns NormalizedViewer for use with the shared ranking engine
 */
export function toNormalizedViewer(
  viewerId: Id<'users'> | string,
  context: Phase2ViewerContext
): NormalizedViewer {
  return {
    id: viewerId as string,
    phase: 'phase2',

    // Phase-2 doesn't filter by compatibility in the same way
    // These empty arrays mean compatibility scoring will be minimal
    relationshipIntent: [],
    activities: [],
    desireTagKeys: context.desireTagKeys,  // Viewer's desire tags for ranking boost

    lifestyle: {
      smoking: undefined,
      drinking: undefined,
      kids: undefined,
      religion: undefined,
    },

    // Not available in Phase-2
    lifeRhythm: undefined,
    seedQuestions: undefined,

    // Phase-2 doesn't filter by distance
    maxDistance: Infinity,

    // Trust context
    blockedIds: context.blockedIds,
    reportedIds: new Set(),  // Phase-2 uses blocks only
  };
}

// ---------------------------------------------------------------------------
// Batch Adapter (for efficiency)
// ---------------------------------------------------------------------------

/**
 * Convert multiple Phase-2 profiles to NormalizedCandidates.
 *
 * @param profiles - Array of Phase-2 private profile records
 * @param metricsMap - Map of userId to ranking metrics
 * @param contextMap - Map of userId to context
 * @returns Array of NormalizedCandidates
 */
export function toNormalizedCandidates(
  profiles: Phase2PrivateProfile[],
  metricsMap: Map<string, Phase2RankingMetrics>,
  contextMap: Map<string, Phase2CandidateContext>
): NormalizedCandidate[] {
  return profiles.map(profile => {
    const userId = profile.userId as string;
    const metrics = metricsMap.get(userId);
    const context = contextMap.get(userId) ?? { blockCount: 0 };
    return toNormalizedCandidate(profile, metrics, context);
  });
}

// ---------------------------------------------------------------------------
// Fairness Context Builder
// ---------------------------------------------------------------------------

/**
 * Build FairnessContext from Phase-2 viewer impressions data.
 *
 * @param recentlySeenUserIds - Set of user IDs seen within suppression window
 * @param impressionCounts - Optional map of user ID to impression count
 * @returns FairnessContext for use with the shared ranking engine
 */
export function buildFairnessContext(
  recentlySeenUserIds: Set<string>,
  impressionCounts?: Map<string, number>
): FairnessContext {
  return {
    recentlySeenIds: recentlySeenUserIds,
    impressionCounts: impressionCounts ?? new Map(),
  };
}

// ---------------------------------------------------------------------------
// Validation Helper
// ---------------------------------------------------------------------------

/**
 * Validate that a Phase-2 profile has minimum required fields.
 * Used for defensive programming - catches schema issues early.
 */
export function isValidPhase2Profile(profile: unknown): profile is Phase2PrivateProfile {
  if (!profile || typeof profile !== 'object') return false;
  const p = profile as Record<string, unknown>;

  return (
    typeof p._id === 'string' &&
    typeof p.userId === 'string' &&
    typeof p.displayName === 'string' &&
    typeof p.age === 'number' &&
    typeof p.gender === 'string' &&
    typeof p.isPrivateEnabled === 'boolean' &&
    typeof p.isSetupComplete === 'boolean' &&
    Array.isArray(p.privateIntentKeys) &&
    Array.isArray(p.privatePhotoUrls)
  );
}

// ---------------------------------------------------------------------------
// Schema Gap Documentation
// ---------------------------------------------------------------------------

/**
 * SCHEMA GAPS: Phase-2 vs Shared Model
 *
 * The following fields are NOT available in Phase-2 and use defaults:
 *
 * 1. lifeRhythm: undefined
 *    - Phase-2 onboarding doesn't collect life rhythm data
 *    - Impact: Life rhythm matching will not contribute to compatibility score
 *
 * 2. seedQuestions: undefined
 *    - Phase-2 onboarding doesn't collect seed questions
 *    - Impact: Identity anchor and value trigger matching won't work
 *
 * 3. lifestyle.kids: undefined
 *    - Phase-2 schema doesn't have kids field
 *    - Impact: Kids preference matching won't work
 *
 * 4. hasOptionalFields.jobTitle: always false
 *    - Phase-2 schema doesn't have jobTitle field
 *    - Impact: Minor profile quality score reduction
 *
 * 5. distance: always undefined
 *    - Phase-2 doesn't compute or filter by distance
 *    - Impact: Distance score will be neutral (50/100)
 *
 * 6. theyLikedMe: always false
 *    - Phase-2 has no swipe/like system
 *    - Impact: No mutual interest boost
 *
 * 7. isBoosted: always false
 *    - Phase-2 has no boost system
 *    - Impact: No boost points
 *
 * 8. reportCount: always 0
 *    - Phase-2 uses blocks instead of reports
 *    - Impact: Report-based trust penalty won't apply
 *
 * These gaps are intentional and acceptable. Phase-2 (Deep Connect) has
 * different product requirements than Phase-1 (Discover). The shared
 * ranking engine handles missing data gracefully with neutral defaults.
 */
