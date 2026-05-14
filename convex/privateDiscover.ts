import { v } from 'convex/values';
import { query, mutation, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { isPrivateDataDeleted } from './privateDeletion';
import { computeFinalScore } from './phase2Ranking';
import { resolveUserIdByAuthId, isRevealed, validateSessionToken } from './helpers';
import { DEFAULT_MIN_AGE, normalizeDiscoveryPreferences } from '../lib/discoveryDefaults';
import {
  filterOwnedSafePrivatePhotoUrls,
  PHASE2_MIN_PRIVATE_PHOTOS,
} from './phase2PrivatePhotos';

// Phase 3: Shadow mode imports
import { shouldRunShadowComparison } from './ranking/rankingConfig';
import { computeRankScore, logBatchRankingComparison, DEFAULT_RANKING_CONFIG } from './ranking/sharedRankingEngine';

// Suppression window: 4 hours in milliseconds
const SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000;
const MAX_BLOCK_ROWS = 5000;
const MAX_CONVERSATION_ROWS = 500;
const MAX_PRIVATE_RELATIONSHIP_ROWS = 5000;
const MAX_PENDING_DELETION_ROWS = 5000;
const MAX_VIEWER_IMPRESSION_ROWS = 5000;
const IMPRESSION_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_IMPRESSIONS_PER_WINDOW = 300;

// P1-1: Phase-2 deck pagination caps.
// Bound the candidate slice we pull per request so a request never
// .collect()s the entire enabled-private-profile table. We pull the most
// recently-active enabled profiles using the new compound
// by_enabled_updatedAt index, so the cap retains the most-recently-active
// users while bounding memory + CPU. Tail of the distribution beyond this
// cap is excluded from a single request window; mitigated by 4h
// impression suppression and updatedAt-desc ordering rotating older
// profiles back into view over time.
const MAX_PHASE2_CANDIDATES = 1500;
// Server-side hard cap on requested limit; protects against client over-asks.
const MAX_PHASE2_RESULT_LIMIT = 100;

// P2-3: Phase-2 fallback pool helpers (inlined to avoid cross-file
// dependency churn). Mirrors the Phase-1 `qualifiesForFallback` pattern.
// When the strict ranked pool is too small (typically because the viewer
// applied narrow intent filters), we may relax the strict intent-key
// match constraint and admit candidates that still share strong
// compatibility signals. Hard safety / privacy exclusions (block, report,
// matched, swiped, deletion-pending, hideFromDeepConnect, !isSetupComplete,
// suppression) are NEVER bypassed — those are enforced separately at the
// fallback-block call-site below.
//
// Strong-signal categories (each contributes 1 toward the threshold):
//   1. >=1 shared private intent key (relaxed: any overlap, not exact key).
//   2. >=2 shared private desire tags.
//   3. >=3 shared hobbies.
//   4. Same smoking value.
//   5. Same drinking value.
//   6. Same city value.
const PHASE2_FALLBACK_MIN_SIGNALS = 2;

function arrayOverlapCount(
  a: ReadonlyArray<string> | undefined | null,
  b: ReadonlyArray<string> | undefined | null,
): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let count = 0;
  for (const x of a) if (setB.has(x)) count += 1;
  return count;
}

function countPhase2FallbackSignals(
  viewer: {
    privateIntentKeys?: string[];
    privateDesireTagKeys?: string[];
    hobbies?: string[];
    smoking?: string;
    drinking?: string;
    city?: string;
  },
  candidate: {
    privateIntentKeys?: string[];
    privateDesireTagKeys?: string[];
    hobbies?: string[];
    smoking?: string;
    drinking?: string;
    city?: string;
  },
): number {
  let signals = 0;
  if (arrayOverlapCount(viewer.privateIntentKeys, candidate.privateIntentKeys) >= 1) signals += 1;
  if (arrayOverlapCount(viewer.privateDesireTagKeys, candidate.privateDesireTagKeys) >= 2) signals += 1;
  if (arrayOverlapCount(viewer.hobbies, candidate.hobbies) >= 3) signals += 1;
  if (
    typeof viewer.smoking === 'string' &&
    typeof candidate.smoking === 'string' &&
    viewer.smoking.length > 0 &&
    viewer.smoking === candidate.smoking
  ) signals += 1;
  if (
    typeof viewer.drinking === 'string' &&
    typeof candidate.drinking === 'string' &&
    viewer.drinking.length > 0 &&
    viewer.drinking === candidate.drinking
  ) signals += 1;
  if (
    typeof viewer.city === 'string' &&
    typeof candidate.city === 'string' &&
    viewer.city.length > 0 &&
    viewer.city === candidate.city
  ) signals += 1;
  return signals;
}

/** Haversine distance in km (rounded), matches users.getUserById / discover helpers */
function distanceKmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

async function requireTokenBoundViewer(
  ctx: Parameters<typeof validateSessionToken>[0],
  token: string,
  hints: {
    userId?: Id<'users'>;
    authUserId?: string;
    viewerId?: Id<'users'>;
    viewerAuthUserId?: string;
  } = {},
): Promise<Id<'users'>> {
  const viewerUserId = await validateSessionToken(ctx, token.trim());
  if (!viewerUserId) {
    throw new Error('UNAUTHORIZED');
  }

  const assertedIds: Id<'users'>[] = [];
  if (hints.userId) assertedIds.push(hints.userId);
  if (hints.viewerId) assertedIds.push(hints.viewerId);

  for (const authHint of [hints.authUserId, hints.viewerAuthUserId]) {
    const trimmed = authHint?.trim();
    if (!trimmed) continue;
    const resolvedHint = await resolveUserIdByAuthId(ctx, trimmed);
    if (!resolvedHint) {
      throw new Error('UNAUTHORIZED');
    }
    assertedIds.push(resolvedHint);
  }

  for (const assertedId of assertedIds) {
    if (assertedId !== viewerUserId) {
      throw new Error('UNAUTHORIZED');
    }
  }

  return viewerUserId;
}

function isPrivateDiscoverVisibleUser(
  user: Doc<'users'> | null | undefined,
): user is Doc<'users'> {
  return !!user && user.isActive === true && user.isBanned !== true && !user.deletedAt;
}

function calculateAgeFromDateOfBirth(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return null;
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Number.isFinite(age) && age >= 0 && age < 120 ? age : null;
}

function hasEligibleAdultAge(age: number | null): age is number {
  return age !== null && age >= DEFAULT_MIN_AGE;
}

type DeepConnectAccessContext = {
  user: Doc<'users'>;
  profile: Doc<'userPrivateProfiles'>;
  age: number;
  safePhotoUrls: string[];
};

async function getDeepConnectAccessContext(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<DeepConnectAccessContext | null> {
  const [user, profile] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first(),
  ]);

  if (!isPrivateDiscoverVisibleUser(user)) return null;
  if (user.phase2OnboardingCompleted !== true) return null;

  const age = calculateAgeFromDateOfBirth(user.dateOfBirth);
  if (!hasEligibleAdultAge(age)) return null;

  if (
    !profile ||
    profile.isPrivateEnabled !== true ||
    profile.isSetupComplete !== true ||
    profile.hideFromDeepConnect === true
  ) {
    return null;
  }

  if (await isPrivateDataDeleted(ctx as QueryCtx, userId)) return null;

  const safePhotoUrls = await filterOwnedSafePrivatePhotoUrls(
    ctx,
    userId,
    profile.privatePhotoUrls ?? [],
  );
  if (safePhotoUrls.length < PHASE2_MIN_PRIVATE_PHOTOS) return null;

  return { user, profile, age, safePhotoUrls };
}

function distanceBetweenUsersKm(
  viewer: Doc<'users'>,
  candidate: Doc<'users'>,
): number | undefined {
  if (
    typeof viewer.latitude !== 'number' ||
    !Number.isFinite(viewer.latitude) ||
    typeof viewer.longitude !== 'number' ||
    !Number.isFinite(viewer.longitude) ||
    typeof candidate.latitude !== 'number' ||
    !Number.isFinite(candidate.latitude) ||
    typeof candidate.longitude !== 'number' ||
    !Number.isFinite(candidate.longitude)
  ) {
    return undefined;
  }
  return distanceKmBetween(
    viewer.latitude,
    viewer.longitude,
    candidate.latitude,
    candidate.longitude,
  );
}

function isDistanceAllowed(distanceKm: number | undefined, maxDistanceKm: number): boolean {
  return typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm <= maxDistanceKm;
}

async function isDeepConnectBlockedPair(
  ctx: QueryCtx | MutationCtx,
  userAId: Id<'users'>,
  userBId: Id<'users'>,
): Promise<boolean> {
  const [aBlockedB, bBlockedA] = await Promise.all([
    ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', userAId).eq('blockedUserId', userBId)
      )
      .first(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', userBId).eq('blockedUserId', userAId)
      )
      .first(),
  ]);
  return !!aBlockedB || !!bBlockedA;
}

async function hasDeepConnectViewerReportedTarget(
  ctx: QueryCtx | MutationCtx,
  viewerUserId: Id<'users'>,
  targetUserId: Id<'users'>,
): Promise<boolean> {
  const reports = await ctx.db
    .query('reports')
    .withIndex('by_reporter_reported_created', (q) =>
      q.eq('reporterId', viewerUserId).eq('reportedUserId', targetUserId)
    )
    .collect();
  return reports.some((report) => !report.roomId);
}

export async function canDeepConnectInteract(
  ctx: QueryCtx | MutationCtx,
  viewerUserId: Id<'users'>,
  targetUserId: Id<'users'>,
): Promise<boolean> {
  if (viewerUserId === targetUserId) return false;

  const [viewerAccess, targetAccess] = await Promise.all([
    getDeepConnectAccessContext(ctx, viewerUserId),
    getDeepConnectAccessContext(ctx, targetUserId),
  ]);

  if (!viewerAccess || !targetAccess) return false;
  if (await isDeepConnectBlockedPair(ctx, viewerUserId, targetUserId)) return false;
  if (await hasDeepConnectViewerReportedTarget(ctx, viewerUserId, targetUserId)) return false;

  const viewerPrefs = normalizeDiscoveryPreferences(viewerAccess.user);
  const targetPrefs = normalizeDiscoveryPreferences(targetAccess.user);
  const distanceKm = distanceBetweenUsersKm(viewerAccess.user, targetAccess.user);
  if (!isDistanceAllowed(distanceKm, viewerPrefs.maxDistance)) return false;
  if (!isDistanceAllowed(distanceKm, targetPrefs.maxDistance)) return false;
  if (targetAccess.age < viewerPrefs.minAge || targetAccess.age > viewerPrefs.maxAge) return false;
  if (viewerAccess.age < targetPrefs.minAge || viewerAccess.age > targetPrefs.maxAge) return false;

  return true;
}

export async function assertCanDeepConnectInteract(
  ctx: QueryCtx | MutationCtx,
  viewerUserId: Id<'users'>,
  targetUserId: Id<'users'>,
): Promise<void> {
  if (!(await canDeepConnectInteract(ctx, viewerUserId, targetUserId))) {
    throw new Error('Profile is no longer available');
  }
}

function getProfileIntentKeys(profile: { privateIntentKeys?: string[]; privateIntentKey?: string | null | undefined }): string[] {
  return (profile.privateIntentKeys && profile.privateIntentKeys.length > 0)
    ? profile.privateIntentKeys
    : (profile.privateIntentKey ? [profile.privateIntentKey] : []);
}

function shouldExcludeDeepConnectConversationPartner(conversation: Doc<'privateConversations'>): boolean {
  if (
    conversation.connectionSource === 'room' ||
    Boolean((conversation as any).sourceRoomId)
  ) {
    return false;
  }

  if (conversation.isPreMatch === true) {
    return false;
  }

  if (conversation.matchId) {
    return true;
  }

  return (
    conversation.connectionSource === 'tod' ||
    conversation.connectionSource === 'desire' ||
    conversation.connectionSource === 'desire_match' ||
    conversation.connectionSource === 'desire_super_like' ||
    conversation.connectionSource === 'friend'
  );
}

async function isWithinDeepConnectImpressionRateLimit(
  ctx: any,
  viewerId: Id<'users'>,
  increment: number
): Promise<boolean> {
  if (increment <= 0) return true;

  const now = Date.now();
  const existing = await ctx.db
    .query('phase2ImpressionRateLimits')
    .withIndex('by_viewer', (q: any) => q.eq('viewerId', viewerId))
    .first();

  if (!existing) {
    await ctx.db.insert('phase2ImpressionRateLimits', {
      viewerId,
      windowStart: now,
      count: increment,
      updatedAt: now,
    });
    return true;
  }

  if (existing.windowStart < now - IMPRESSION_RATE_LIMIT_WINDOW_MS) {
    await ctx.db.patch(existing._id, {
      windowStart: now,
      count: increment,
      updatedAt: now,
    });
    return true;
  }

  if (existing.count + increment > MAX_IMPRESSIONS_PER_WINDOW) {
    return false;
  }

  await ctx.db.patch(existing._id, {
    count: existing.count + increment,
    updatedAt: now,
  });
  return true;
}

// Get private discovery profiles (blurred photos only) with Phase-2 ranking
// Filters out:
// - The requesting user
// - Incomplete profiles
// - Blocked users (in BOTH directions - shared across phases)
// - Users outside reciprocal age/distance hard preferences
// - Users with pending deletion
// Ranking behavior:
// - Users seen within 4-hour suppression window are pushed to back
// - Users without ranking metrics use fallback defaults for scoring
// Returns profiles sorted by ranking score (descending)
export const getProfiles = query({
  args: {
    token: v.string(),
    // Legacy viewer hints are compatibility assertions only.
    userId: v.optional(v.id('users')),
    authUserId: v.optional(v.string()),
    intentKeys: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const suppressionCutoff = now - SUPPRESSION_WINDOW_MS;
    const requestedIntentKeys = (args.intentKeys ?? [])
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    const requestedIntentKeySet =
      requestedIntentKeys.length > 0 ? new Set(requestedIntentKeys) : null;

    const viewerUserId = await requireTokenBoundViewer(ctx, args.token, {
      userId: args.userId,
      authUserId: args.authUserId,
    });
    const viewerAccess = await getDeepConnectAccessContext(ctx, viewerUserId);
    if (!viewerAccess) {
      return [];
    }
    const viewerUserDoc = viewerAccess.user;
    const viewerAge = viewerAccess.age;
    const viewerPrefs = normalizeDiscoveryPreferences(viewerUserDoc);

    // Phase 3: Shadow mode decision (once per request)
    const runShadow = shouldRunShadowComparison();

    // Get blocks for current user (both directions - shared across Phase-1 and Phase-2)
    const [
      blocksOut,
      blocksIn,
      myConversationParticipations,
      matchesAsUser1,
      matchesAsUser2,
      myPrivateSwipes,
      myReports,
    ] = await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', viewerUserId))
        .take(MAX_BLOCK_ROWS),
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerUserId))
        .take(MAX_BLOCK_ROWS),
      // CONVERSATION PARTNER EXCLUSION: Users with existing chats must not reappear
      ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', viewerUserId))
        .take(MAX_CONVERSATION_ROWS),
      ctx.db
        .query('privateMatches')
        .withIndex('by_user1', (q) => q.eq('user1Id', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
      ctx.db
        .query('privateMatches')
        .withIndex('by_user2', (q) => q.eq('user2Id', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
      ctx.db
        .query('privateLikes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
      ctx.db
        .query('reports')
        .withIndex('by_reporter', (q) => q.eq('reporterId', viewerUserId))
        .take(MAX_PRIVATE_RELATIONSHIP_ROWS),
    ]);

    // Combine into a set of blocked user IDs
    const blockedUserIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    // CONVERSATION PARTNER EXCLUSION: Build set of users with existing message threads
    const conversationPartnerIds = new Set<string>();
    if (myConversationParticipations.length > 0) {
      const conversations = await Promise.all(
        myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
      );
      for (const conv of conversations) {
        if (!conv) continue;
        if (!shouldExcludeDeepConnectConversationPartner(conv)) continue;
        for (const participantId of conv.participants) {
          if (participantId !== viewerUserId) {
            conversationPartnerIds.add(participantId as string);
          }
        }
      }
    }

    const matchedUserIds = new Set<string>();
    const unmatchedUserIds = new Set<string>();
    for (const match of matchesAsUser1) {
      const isUnmatched =
        match.isActive === false ||
        (match as any).unmatchedAt != null ||
        (match as any).user1UnmatchedAt != null ||
        (match as any).user2UnmatchedAt != null;
      (isUnmatched ? unmatchedUserIds : matchedUserIds).add(match.user2Id as string);
    }
    for (const match of matchesAsUser2) {
      const isUnmatched =
        match.isActive === false ||
        (match as any).unmatchedAt != null ||
        (match as any).user1UnmatchedAt != null ||
        (match as any).user2UnmatchedAt != null;
      (isUnmatched ? unmatchedUserIds : matchedUserIds).add(match.user1Id as string);
    }

    const swipedUserIds = new Set(myPrivateSwipes.map((s) => s.toUserId as string));
    const reportedUserIds = new Set(
      myReports.filter((r) => !r.roomId).map((r) => r.reportedUserId as string)
    );

    // P1-1: Bounded, recency-ordered candidate fetch.
    // Replaces the prior unbounded .collect() over the entire enabled
    // private-profile table. Uses the new compound index
    // by_enabled_updatedAt to pull at most MAX_PHASE2_CANDIDATES rows
    // ordered by updatedAt desc. Hard safety / privacy filters below
    // (self / setup-incomplete / blocked / reported / matched / swiped /
    // conversation-partner / deletion-pending / hideFromDeepConnect /
    // intent-key match / suppression) are unchanged.
    const profiles = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_enabled_updatedAt', (q) => q.eq('isPrivateEnabled', true))
      .order('desc')
      .take(MAX_PHASE2_CANDIDATES);
    const ownerIds = [...new Set(profiles.map((p) => p.userId as string))];
    const ownerDocs = await Promise.all(ownerIds.map((id) => ctx.db.get(id as Id<'users'>)));
    const ownerById = new Map(ownerIds.map((id, i) => [id, ownerDocs[i]]));

    // Viewer private profile signals (Phase-2 only) for compatibility-aware ranking.
    // Viewer eligibility has already been enforced by getDeepConnectAccessContext.
    const viewerPrivateProfile = viewerAccess.profile;

    // Get all deletion states to filter out pending deletions
    const deletionStates = await ctx.db
      .query('privateDeletionStates')
      .withIndex('by_status', (q) => q.eq('status', 'pending_deletion'))
      .take(MAX_PENDING_DELETION_ROWS);
    const deletedUserIds = new Set(deletionStates.map((d) => d.userId as string));

    // Get viewer's recent impressions for suppression check via compound index
    const viewerImpressions = await ctx.db
      .query('phase2ViewerImpressions')
      .withIndex('by_viewer_lastSeenAt', (q) =>
        q.eq('viewerId', viewerUserId).gt('lastSeenAt', suppressionCutoff)
      )
      .take(MAX_VIEWER_IMPRESSION_ROWS);
    const recentlySeen = new Set(
      viewerImpressions.map((imp) => imp.viewedUserId as string)
    );

    const passesStage1PreferenceGates = (p: typeof profiles[number]): boolean => {
      const ownerUser = ownerById.get(p.userId as string);
      if (!isPrivateDiscoverVisibleUser(ownerUser)) return false;
      if (ownerUser.phase2OnboardingCompleted !== true) return false;

      const candidateAge = calculateAgeFromDateOfBirth(ownerUser.dateOfBirth);
      if (!hasEligibleAdultAge(candidateAge)) return false;

      const candidatePrefs = normalizeDiscoveryPreferences(ownerUser);
      if (candidateAge < viewerPrefs.minAge || candidateAge > viewerPrefs.maxAge) return false;
      if (viewerAge < candidatePrefs.minAge || viewerAge > candidatePrefs.maxAge) return false;

      const distanceKm = distanceBetweenUsersKm(viewerUserDoc, ownerUser);
      if (!isDistanceAllowed(distanceKm, viewerPrefs.maxDistance)) return false;
      if (!isDistanceAllowed(distanceKm, candidatePrefs.maxDistance)) return false;

      return true;
    };

    // Filter out:
    // - The requesting user
    // - Incomplete profiles
    // - Blocked users (either direction)
    // - Existing private conversation partners
    // - Existing private matches and unmatched private matches
    // - Users already swiped in Deep Connect
    // - Users reported by the viewer
    // - Users with pending deletion
    // - Users who opted out of Deep Connect discovery (hideFromDeepConnect === true; missing = visible)
    // NOTE: Profiles without ranking metrics are still eligible (use fallback defaults)
    //
    // STAGE-1 DISCOVERY PREFERENCE GATES.
    // ─────────────────────────────────────────────────────────────────────
    // Deep Connect keeps its Phase-2 intent/vibes ranking, but hard age and
    // distance eligibility comes from users.* so frontend-only defaults cannot
    // bypass it. Orientation, gender, and relationship-intent behavior are left
    // unchanged in this pass.
    const eligible = profiles.filter(
      (p) => {
        const profileIntentKeys = getProfileIntentKeys(
          p as typeof p & { privateIntentKey?: string | null | undefined }
        );
        return (
          p.userId !== viewerUserId &&
          p.isSetupComplete &&
          !blockedUserIds.has(p.userId as string) &&
          !conversationPartnerIds.has(p.userId as string) &&
          !matchedUserIds.has(p.userId as string) &&
          !unmatchedUserIds.has(p.userId as string) &&
          !swipedUserIds.has(p.userId as string) &&
          !reportedUserIds.has(p.userId as string) &&
          !deletedUserIds.has(p.userId as string) &&
          p.hideFromDeepConnect !== true &&
          passesStage1PreferenceGates(p) &&
          (!requestedIntentKeySet ||
            profileIntentKeys.some((key) => requestedIntentKeySet.has(key)))
        );
      }
    );

    // Fetch ranking metrics only for the profiles we may score.
    const metricEntries = await Promise.all(
      eligible.map(async (profile) => ({
        userId: profile.userId as string,
        metrics: await ctx.db
          .query('phase2RankingMetrics')
          .withIndex('by_user', (q) => q.eq('userId', profile.userId))
          .first(),
      }))
    );
    const metricsMap = new Map(
      metricEntries.flatMap(({ userId, metrics }) => (metrics ? [[userId, metrics] as const] : []))
    );

    // Compute scores and separate suppressed vs unsuppressed profiles
    const viewerId = viewerUserId as string;
    const unsuppressed: Array<{ profile: typeof eligible[0]; score: number }> = [];
    const suppressed: Array<{ profile: typeof eligible[0]; score: number }> = [];

    const viewerSignals = viewerPrivateProfile
      ? {
          privateIntentKeys: viewerPrivateProfile.privateIntentKeys ?? [],
          privateDesireTagKeys: viewerPrivateProfile.privateDesireTagKeys ?? [],
          hobbies: (viewerPrivateProfile as any).hobbies ?? [],
          privateBio: viewerPrivateProfile.privateBio ?? '',
          promptAnswers: (viewerPrivateProfile as any).promptAnswers ?? [],
          smoking: (viewerPrivateProfile as any).smoking,
          drinking: (viewerPrivateProfile as any).drinking,
          city: viewerPrivateProfile.city,
          preferenceStrength: (viewerPrivateProfile as any).preferenceStrength,
        }
      : undefined;

    for (const p of eligible) {
      // Use fallback defaults for profiles without ranking metrics
      const metrics = metricsMap.get(p.userId as string) ?? {
        phase2OnboardedAt: p.createdAt ?? now,
        lastPhase2ActiveAt: p.updatedAt ?? now,
        totalImpressions: 0,
        lastShownAt: 0,
      };
      const score = computeFinalScore(p, metrics, viewerId, viewerSignals);

      if (recentlySeen.has(p.userId as string)) {
        suppressed.push({ profile: p, score });
      } else {
        unsuppressed.push({ profile: p, score });
      }
    }

    // Sort both arrays by score descending
    unsuppressed.sort((a, b) => b.score - a.score);
    suppressed.sort((a, b) => b.score - a.score);

    // Combine: unsuppressed first, then suppressed at back
    const ranked = [...unsuppressed, ...suppressed];

    // P2-5: Server-side cap on requested limit. Frontend may ask for up to
    // 80 per request; we hard-cap at MAX_PHASE2_RESULT_LIMIT = 100.
    const requestedLimit = Math.max(1, args.limit ?? 50);
    const limit = Math.min(requestedLimit, MAX_PHASE2_RESULT_LIMIT);

    // P2-3: Phase-2 fallback pool.
    // ─────────────────────────────────────────────────────────────────────
    // If the strict ranked pool comes up short (typically because the viewer
    // applied narrow intent filters via requestedIntentKeySet), append a
    // fallback block of profiles that:
    //   * pass ALL hard safety / privacy exclusions (re-applied below — we
    //     re-evaluate against the same Sets used for `eligible`),
    //   * relax ONLY the intent-key match constraint, and
    //   * still share at least PHASE2_FALLBACK_MIN_SIGNALS strong
    //     compatibility signals with the viewer (countPhase2FallbackSignals).
    // The fallback block is always rendered AFTER the strict ranked pool,
    // is de-duplicated against it, and never bypasses block / report /
    // matched / swiped / conversation-partner / deletion-pending /
    // hideFromDeepConnect / setup-incomplete / suppression rules.
    const fallbackBlock: typeof ranked = [];
    if (
      viewerSignals &&
      requestedIntentKeySet &&
      ranked.length < limit
    ) {
      const rankedIds = new Set(
        ranked.map(({ profile }) => profile.userId as string)
      );
      const fallbackCandidates: typeof ranked = [];
      for (const p of profiles) {
        // Re-apply ALL hard exclusions; ONLY intent-key match is relaxed.
        if (p.userId === viewerUserId) continue;
        if (!p.isSetupComplete) continue;
        if (blockedUserIds.has(p.userId as string)) continue;
        if (conversationPartnerIds.has(p.userId as string)) continue;
        if (matchedUserIds.has(p.userId as string)) continue;
        if (unmatchedUserIds.has(p.userId as string)) continue;
        if (swipedUserIds.has(p.userId as string)) continue;
        if (reportedUserIds.has(p.userId as string)) continue;
        if (deletedUserIds.has(p.userId as string)) continue;
        if (p.hideFromDeepConnect === true) continue;
        if (rankedIds.has(p.userId as string)) continue;
        if (!passesStage1PreferenceGates(p)) continue;

        if (countPhase2FallbackSignals(viewerSignals as any, p as any) < PHASE2_FALLBACK_MIN_SIGNALS) continue;

        const metrics = metricsMap.get(p.userId as string);
        const score = computeFinalScore(p, metrics, viewerId, viewerSignals);
        fallbackCandidates.push({ profile: p, score });
      }
      fallbackCandidates.sort((a, b) => b.score - a.score);
      // Suppression order preserved within the fallback block: not-recently-seen
      // first, then recently-seen at the end (mirrors the strict-pool ordering).
      const fbUnsuppressed = fallbackCandidates.filter(
        ({ profile }) => !recentlySeen.has(profile.userId as string)
      );
      const fbSuppressed = fallbackCandidates.filter(
        ({ profile }) => recentlySeen.has(profile.userId as string)
      );
      fallbackBlock.push(...fbUnsuppressed, ...fbSuppressed);
    }

    const combined = [...ranked, ...fallbackBlock];
    const limited = combined.slice(0, limit);

    // Phase 3: Shadow mode rank comparison (no production impact)
    // Legacy result is finalized above - this only logs for analysis
    if (runShadow) {
      try {
        // Build minimal normalized viewer for Phase-2
        // NOTE: Viewer preferences are intentionally neutral because Phase-2
        // has limited viewer preference data and this is rank-only shadow comparison
        const normalizedViewer: import('./ranking/rankingTypes').NormalizedViewer = {
          id: viewerId,
          phase: 'phase2',
          relationshipIntent: [],
          activities: [],
          lifestyle: {},
          maxDistance: 0,
          blockedIds: new Set<string>(),
          reportedIds: new Set<string>(),
        };

        // Build normalized candidates from limited results only (capped)
        const normalizedCandidates: import('./ranking/rankingTypes').NormalizedCandidate[] = limited.map(({ profile: p }) => {
          const profile = p as typeof p & { hobbies?: string[]; isVerified?: boolean; verificationStatus?: string; promptAnswers?: Array<{ answer?: string }>; height?: number; education?: string };
          const metrics = metricsMap.get(p.userId as string);

          // Count filled prompts if available (Phase-2 uses promptAnswers field)
          const promptsAnswered = Array.isArray(profile.promptAnswers)
            ? profile.promptAnswers.filter((pr: any) => pr.answer?.trim().length > 0).length
            : 0;

          return {
            id: p.userId as string,
            phase: 'phase2' as const,
            relationshipIntent: [],
            activities: profile.hobbies ?? [],
            lifestyle: {},
            bioLength: p.privateBio?.trim().length ?? 0,
            promptsAnswered,
            photoCount: p.privatePhotoUrls?.length ?? 0,
            isVerified: profile.isVerified ?? false,
            hasOptionalFields: { height: !!profile.height, jobTitle: false, education: !!profile.education },
            lastActiveAt: metrics?.lastPhase2ActiveAt ?? p.updatedAt ?? now,
            onboardedAt: metrics?.phase2OnboardedAt ?? p.createdAt ?? now,
            createdAt: p.createdAt ?? now,
            distance: undefined,
            theyLikedMe: false,   // Phase-2 has no swipe system
            isBoosted: false,     // Phase-2 has no boost system
            reportCount: 0,
            blockCount: 0,
            totalImpressions: metrics?.totalImpressions ?? 0,
            lastShownAt: metrics?.lastShownAt ?? 0,
          };
        });

        // Compute shared scores and build rank lookup
        const sharedScored = normalizedCandidates.map((c, i) => ({
          id: c.id,
          score: computeRankScore(c, normalizedViewer, DEFAULT_RANKING_CONFIG).score,
          originalIndex: i,
        }));
        sharedScored.sort((a, b) => b.score - a.score);
        const sharedRankMap = new Map<string, number>();
        sharedScored.forEach((s, i) => sharedRankMap.set(s.id, i));

        // Build comparisons: [candidateId, legacyRank, sharedRank]
        const comparisons: Array<[string, number, number]> = [];
        for (let i = 0; i < limited.length; i++) {
          const candidateId = limited[i].profile.userId as string;
          const sharedRank = sharedRankMap.get(candidateId) ?? -1;
          comparisons.push([candidateId, i, sharedRank]);
        }

        logBatchRankingComparison(viewerId, comparisons, 'phase2');
      } catch {
        // Silent fail - shadow mode must never break production
      }
    }

    // P1-009: Batch-compute reveal status for each candidate against the viewer.
    // Discover normally excludes conversation partners (who include matches), but we
    // compute defensively so the field is always accurate.
    const revealMap = new Map<string, boolean>();
    await Promise.all(
      limited.map(async ({ profile: p }) => {
        const revealed = await isRevealed(ctx, viewerUserId as Id<'users'>, p.userId);
        revealMap.set(p.userId as string, revealed);
      })
    );

    // Return only blurred data — never expose original photos
    // Cast to access optional schema fields that may not be in generated types yet
    const serialized = await Promise.all(limited.map(async ({ profile: p }) => {
      const profile = p as typeof p & {
        hobbies?: string[];
        isVerified?: boolean;
        verificationStatus?: string;
        privateIntentKey?: string;
        education?: string;
        religion?: string;
      };
      // Backward compat: older records may only have privateIntentKey (single)
      const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);
      const targetAccess = await getDeepConnectAccessContext(ctx, p.userId);
      if (!targetAccess || targetAccess.profile._id !== p._id) return null;
      const ownerUser = targetAccess.user;
      const ownerAge = targetAccess.age;
      const safePhotoUrls = targetAccess.safePhotoUrls;
      // Privacy: hide age from others in Deep Connect (viewer is never self here — excluded above)
      const age = profile.hideAge === true ? undefined : ownerAge;
      let distanceKm: number | undefined;
      if (profile.hideDistance !== true) {
        distanceKm = distanceBetweenUsersKm(viewerUserDoc, ownerUser);
      }
      return {
        _id: p._id,
        userId: p.userId,
        displayName: p.displayName,
        displayNameInitial: p.displayName.charAt(0).toUpperCase(),
        age,
        gender: p.gender,
        photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
        photoBlurSlots: p.photoBlurSlots ?? undefined,
        blurredPhotoUrl: safePhotoUrls[0] ?? null,
        blurredPhotoUrls: safePhotoUrls,
        intentKeys,
        privateIntentKeys: intentKeys,
        desireTagKeys: p.privateDesireTagKeys,
        promptAnswers: p.promptAnswers,
        height: p.height,
        smoking: p.smoking,
        drinking: p.drinking,
        education: profile.education,
        religion: profile.religion,
        isSetupComplete: p.isSetupComplete,
        privateBio: p.privateBio,
        revealPolicy: p.revealPolicy ?? 'mutual_only',
        // P1-009: mutual reveal for this pair — client uses to skip blur
        isRevealed: revealMap.get(p.userId as string) ?? false,
        // Include hobbies and verification status if available
        hobbies: profile.hobbies ?? [],
        isVerified: profile.isVerified ?? false,
        verificationStatus: ownerUser.verificationStatus ?? profile.verificationStatus ?? (profile.isVerified ? 'verified' : 'unverified'),
        ...(distanceKm !== undefined ? { distanceKm } : {}),
      };
    }));

    return serialized.filter(Boolean);
  },
});

// Get a single private profile for viewing (blurred only)
// Also checks blocks before returning
// viewer resolves from the custom session token; optional viewer hints are assertions only.
export const getProfileCard = query({
  args: {
    token: v.string(),
    profileId: v.id('userPrivateProfiles'),
    viewerId: v.optional(v.id('users')),
    viewerAuthUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await requireTokenBoundViewer(ctx, args.token, {
      viewerId: args.viewerId,
      viewerAuthUserId: args.viewerAuthUserId,
    });
    if (!(await getDeepConnectAccessContext(ctx, viewerUserId))) return null;

    const p = await ctx.db.get(args.profileId);
    if (!p) return null;
    const targetAccess = await getDeepConnectAccessContext(ctx, p.userId);
    if (!targetAccess || targetAccess.profile._id !== p._id) return null;
    const owner = targetAccess.user;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', viewerUserId).eq('blockedUserId', p.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', p.userId).eq('blockedUserId', viewerUserId)
      )
      .first();
    if (blockedByOwner) return null;

    const reportsByViewer = await ctx.db
      .query('reports')
      .withIndex('by_reporter_reported_created', (q) =>
        q.eq('reporterId', viewerUserId).eq('reportedUserId', p.userId)
      )
      .collect();
    if (reportsByViewer.some((report) => !report.roomId)) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & {
      hobbies?: string[];
      isVerified?: boolean;
      verificationStatus?: string;
      privateIntentKey?: string;
      education?: string;
      religion?: string;
    };
    // Backward compat: older records may only have privateIntentKey (single)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    const hideAgeFromViewer = profile.hideAge === true && viewerUserId !== p.userId;

    let distanceKm: number | undefined;
    if (viewerUserId !== p.userId && profile.hideDistance !== true) {
      const [viewerU, ownerU] = await Promise.all([ctx.db.get(viewerUserId), Promise.resolve(owner)]);
      if (
        viewerU?.latitude != null &&
        viewerU?.longitude != null &&
        ownerU?.latitude != null &&
        ownerU?.longitude != null
      ) {
        distanceKm = distanceKmBetween(
          viewerU.latitude,
          viewerU.longitude,
          ownerU.latitude,
          ownerU.longitude
        );
      }
    }

    // P1-009: reveal check for this exact pair (viewerUserId is guaranteed defined above)
    const revealed = await isRevealed(ctx, viewerUserId, p.userId);
    const safePhotoUrls = targetAccess.safePhotoUrls;

    return {
      _id: p._id,
      userId: p.userId,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: hideAgeFromViewer ? undefined : p.age,
      gender: p.gender,
      photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
      photoBlurSlots: p.photoBlurSlots ?? undefined,
      blurredPhotoUrl: safePhotoUrls[0] ?? null,
      blurredPhotoUrls: safePhotoUrls,
      intentKeys,
      desireTagKeys: p.privateDesireTagKeys,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // P1-009: mutual reveal for this pair — client uses to skip blur
      isRevealed: revealed,
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
      verificationStatus: owner.verificationStatus ?? profile.verificationStatus ?? (profile.isVerified ? 'verified' : 'unverified'),
      education: profile.education,
      religion: profile.religion,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    };
  },
});

// Get a Phase-2 profile by userId (for full profile view)
// Returns full profile data including intentKeys for display
// viewer resolves from the custom session token; optional viewer hints are assertions only.
export const getProfileByUserId = query({
  args: {
    token: v.string(),
    userId: v.id('users'),
    viewerId: v.optional(v.id('users')),
    viewerAuthUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await requireTokenBoundViewer(ctx, args.token, {
      viewerId: args.viewerId,
      viewerAuthUserId: args.viewerAuthUserId,
    });
    if (!(await getDeepConnectAccessContext(ctx, viewerUserId))) return null;

    // Find the private profile for this user
    const p = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!p) return null;
    const targetAccess = await getDeepConnectAccessContext(ctx, args.userId);
    if (!targetAccess || targetAccess.profile._id !== p._id) return null;
    const owner = targetAccess.user;

    // Check if viewer blocked the profile owner
    const blockedByViewer = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', viewerUserId).eq('blockedUserId', args.userId)
      )
      .first();
    if (blockedByViewer) return null;

    // Check if profile owner blocked the viewer
    const blockedByOwner = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', args.userId).eq('blockedUserId', viewerUserId)
      )
      .first();
    if (blockedByOwner) return null;

    // If the viewer reported this profile owner, fail closed like an unavailable profile.
    const reportsByViewer = await ctx.db
      .query('reports')
      .withIndex('by_reporter_reported_created', (q) =>
        q.eq('reporterId', viewerUserId).eq('reportedUserId', args.userId)
      )
      .collect();
    if (reportsByViewer.some((report) => !report.roomId)) return null;

    // Cast to access optional schema fields that may not be in generated types yet
    const profile = p as typeof p & {
      hobbies?: string[];
      isVerified?: boolean;
      verificationStatus?: string;
      privateIntentKey?: string;
      education?: string;
      religion?: string;
    };

    // Backward compat: older records may only have privateIntentKey (single), not privateIntentKeys (array)
    const intentKeys = p.privateIntentKeys ?? (profile.privateIntentKey ? [profile.privateIntentKey] : []);

    const hideAgeFromViewer = profile.hideAge === true && viewerUserId !== args.userId;

    let distanceKm: number | undefined;
    if (viewerUserId !== args.userId && profile.hideDistance !== true) {
      const [viewerU, ownerU] = await Promise.all([ctx.db.get(viewerUserId), Promise.resolve(owner)]);
      if (
        viewerU?.latitude != null &&
        viewerU?.longitude != null &&
        ownerU?.latitude != null &&
        ownerU?.longitude != null
      ) {
        distanceKm = distanceKmBetween(
          viewerU.latitude,
          viewerU.longitude,
          ownerU.latitude,
          ownerU.longitude
        );
      }
    }

    // P1-009: reveal check for this exact pair (viewerUserId is guaranteed defined above)
    const revealed = await isRevealed(ctx, viewerUserId, args.userId);
    const safePhotoUrls = targetAccess.safePhotoUrls;

    return {
      _id: p._id,
      userId: p.userId,
      name: p.displayName,
      displayNameInitial: p.displayName.charAt(0).toUpperCase(),
      age: hideAgeFromViewer ? undefined : p.age,
      gender: p.gender,
      bio: p.privateBio,
      photos: safePhotoUrls.map((url, i) => ({ _id: `photo_${i}`, url })),
      photoBlurEnabled: (profile as any).photoBlurEnabled ?? undefined,
      photoBlurSlots: p.photoBlurSlots ?? undefined,
      blurredPhotoUrl: safePhotoUrls[0] ?? null,
      blurredPhotoUrls: safePhotoUrls,
      // Phase-2 intents (array)
      intentKeys,
      // Legacy single key for backward compat
      privateIntentKey: intentKeys[0] ?? null,
      desireTagKeys: p.privateDesireTagKeys,
      promptAnswers: p.promptAnswers,
      height: p.height,
      smoking: p.smoking,
      drinking: p.drinking,
      education: profile.education,
      religion: profile.religion,
      privateBio: p.privateBio,
      revealPolicy: p.revealPolicy ?? 'mutual_only',
      // P1-009: mutual reveal for this pair — client uses to skip blur
      isRevealed: revealed,
      // Include hobbies and verification status if available
      hobbies: profile.hobbies ?? [],
      isVerified: profile.isVerified ?? false,
      verificationStatus: owner?.verificationStatus ?? profile.verificationStatus ?? (profile.isVerified ? 'verified' : 'unverified'),
      activities: profile.hobbies ?? [],
      // Phase-2 does NOT have Phase-1 fields
      relationshipIntent: [],
      profilePrompts: [],
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 6: Impression Recording for Deep Connect ranking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record Deep Connect impressions for ranking system.
 * Called after profiles are displayed to the viewer.
 * Updates both global metrics (totalImpressions, lastShownAt) and
 * per-viewer impressions (for suppression window).
 *
 * Safe: token-bound to the real viewer; rejects spoofed viewer hints.
 * Fire-and-forget: client should not await or block on this.
 */
export const recordDeepConnectImpressions = mutation({
  args: {
    token: v.string(),
    viewedUserIds: v.array(v.id('users')),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireTokenBoundViewer(ctx, args.token, {
      authUserId: args.authUserId,
    });

    const viewedUserIds = [...new Set(args.viewedUserIds)]
      .filter((viewedUserId) => viewedUserId !== viewerId);
    if (viewedUserIds.length === 0) return;

    const allowed = await isWithinDeepConnectImpressionRateLimit(
      ctx,
      viewerId,
      viewedUserIds.length
    );
    if (!allowed) return;

    const now = Date.now();

    for (const viewedUserId of viewedUserIds) {

      // Update global metrics row (if exists)
      const metrics = await ctx.db
        .query('phase2RankingMetrics')
        .withIndex('by_user', (q) => q.eq('userId', viewedUserId))
        .first();

      if (metrics) {
        await ctx.db.patch(metrics._id, {
          totalImpressions: metrics.totalImpressions + 1,
          lastShownAt: now,
          updatedAt: now,
        });
      }

      // Update per-viewer impression row
      const existing = await ctx.db
        .query('phase2ViewerImpressions')
        .withIndex('by_pair', (q) =>
          q.eq('viewerId', viewerId).eq('viewedUserId', viewedUserId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          lastSeenAt: now,
          seenCount: existing.seenCount + 1,
        });
      } else {
        await ctx.db.insert('phase2ViewerImpressions', {
          viewerId,
          viewedUserId,
          lastSeenAt: now,
          seenCount: 1,
        });
      }
    }
  },
});
