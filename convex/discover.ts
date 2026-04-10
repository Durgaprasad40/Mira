import { v } from 'convex/values';
import { query, mutation, QueryCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { requireAuthenticatedUserId, resolveUserIdByAuthId } from './helpers';
import {
  CandidateProfile,
  CurrentUser,
  TrustSignals,
  rankDiscoverCandidates,
  qualifiesForFallback,
  calculateRankScore, // P2-018 FIX: Import for fallback ranking
  DISCOVER_RANKING_CONFIG,
} from './discoverRanking';

// Phase 3: Shadow mode imports
import { shouldRunShadowComparison } from './ranking/rankingConfig';
import { rankCandidates as sharedRankCandidates, logBatchRankingComparison } from './ranking/sharedRankingEngine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUserPaused(user: { isDiscoveryPaused?: boolean; discoveryPausedUntil?: number }): boolean {
  return (
    user.isDiscoveryPaused === true &&
    typeof user.discoveryPausedUntil === 'number' &&
    user.discoveryPausedUntil > Date.now()
  );
}

// BUGFIX #21: Safe date parsing with NaN guard
function calculateAge(dateOfBirth: string): number {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Check if a calculated distance is within the allowed max.
 * Mirrors lib/distanceRules.ts - profiles without distance are allowed.
 */
function isDistanceAllowed(distance: number | undefined, maxDistanceKm: number): boolean {
  if (distance == null) return true;
  return distance <= maxDistanceKm;
}

function getSafeDiscoverPhotos<T extends { url?: string; isNsfw?: boolean; order: number }>(photos: T[]): T[] {
  return photos
    .filter((photo) => !photo.isNsfw && typeof photo.url === 'string' && photo.url.trim().length > 0)
    .sort((a, b) => a.order - b.order);
}

function hasDiscoverablePrimaryPhoto(
  user: { displayPrimaryPhotoUrl?: string | null; primaryPhotoUrl?: string | null },
): boolean {
  const publicDisplayPhotoUrl =
    typeof user.displayPrimaryPhotoUrl === 'string' && user.displayPrimaryPhotoUrl.trim().length > 0
      ? user.displayPrimaryPhotoUrl
      : user.primaryPhotoUrl;

  return typeof publicDisplayPhotoUrl === 'string' && publicDisplayPhotoUrl.trim().length > 0;
}

function getDiscoverSafeCoordinates(
  user: { publishedLat?: number | null; publishedLng?: number | null },
): { lat: number; lng: number } | null {
  if (typeof user.publishedLat !== 'number' || typeof user.publishedLng !== 'number') {
    return null;
  }

  return {
    lat: user.publishedLat,
    lng: user.publishedLng,
  };
}

function calculateDiscoverSafeDistance(
  viewer: { publishedLat?: number | null; publishedLng?: number | null },
  user: { publishedLat?: number | null; publishedLng?: number | null },
): number | undefined {
  const viewerCoords = getDiscoverSafeCoordinates(viewer);
  const userCoords = getDiscoverSafeCoordinates(user);

  if (!viewerCoords || !userCoords) {
    return undefined;
  }

  return calculateDistance(viewerCoords.lat, viewerCoords.lng, userCoords.lat, userCoords.lng);
}

function sanitizeDiscoverCandidateForClient<
  T extends {
    age?: number;
    distance?: number;
    lastActive?: number;
    hideAge?: boolean;
    hideDistance?: boolean;
    showLastSeen?: boolean;
  }
>(candidate: T) {
  const {
    hideAge,
    hideDistance,
    showLastSeen,
    ...rest
  } = candidate;

  return {
    ...rest,
    age: hideAge ? undefined : candidate.age,
    distance: hideDistance ? undefined : candidate.distance,
    lastActive: showLastSeen === false ? undefined : candidate.lastActive,
  };
}

function getDiscoverFetchLimit(
  offset: number,
  limit: number,
  sortBy: 'recommended' | 'distance' | 'age' | 'recently_active' | 'newest',
): number {
  const requestedWindow = Math.max(offset + limit, limit, 1);
  const bufferMultiplier = sortBy === 'recommended' ? 12 : 8;
  return Math.min(Math.max(requestedWindow * bufferMultiplier, 120), 400);
}

function shouldIncludeReducedReachCandidate(viewerId: string, candidateId: string): boolean {
  const pairId = `${viewerId}:${candidateId}`;
  let hash = 0;
  for (let i = 0; i < pairId.length; i++) {
    hash = (hash + pairId.charCodeAt(i)) % 100;
  }
  return hash < 50;
}

const DISCOVER_BOOTSTRAP_SHORTLIST_MIN = 60;
const DISCOVER_BOOTSTRAP_SHORTLIST_MAX = 120;
const DISCOVER_BOOTSTRAP_WINDOW_MULTIPLIER = 4;
const DISCOVER_NON_RECOMMENDED_BUFFER = 12;
const DISCOVER_PHOTO_HYDRATION_CHUNK_SIZE = 20;
const EXPLORE_CATEGORY_PAGE_SIZE = 50;
const EXPLORE_CATEGORY_FETCH_MULTIPLIER = 5;
const EXPLORE_CATEGORY_MAX_FETCH = 250;
const EXPLORE_NEARBY_DISTANCE_KM = 5;
const LIVE_EXPLORE_CATEGORY_IDS = [
  'serious_vibes',
  'keep_it_casual',
  'exploring_vibes',
  'see_where_it_goes',
  'open_to_vibes',
  'just_friends',
  'open_to_anything',
  'single_parent',
  'new_to_dating',
  'nearby',
] as const;
const LIVE_EXPLORE_CATEGORY_ID_SET = new Set<string>(LIVE_EXPLORE_CATEGORY_IDS);

type DiscoverSort =
  'recommended' | 'distance' | 'age' | 'recently_active' | 'newest';

type DiscoverGender =
  'male' | 'female' | 'non_binary' | 'lesbian' | 'other';

type DiscoverBootstrapCandidate = {
  id: Id<'users'>;
  name: string;
  age: number;
  gender: string;
  bio: string;
  height?: number;
  smoking?: string;
  drinking?: string;
  kids?: string;
  education?: string;
  religion?: string;
  jobTitle?: string;
  company?: string;
  school?: string;
  isVerified: boolean;
  city?: string;
  distance?: number;
  lastActive: number;
  createdAt: number;
  lookingFor: string[];
  relationshipIntent: string[];
  activities: string[];
  profilePrompts?: { question: string; answer: string }[];
  photoBlurred: boolean;
  isBoosted: boolean;
  theyLikedMe: boolean;
  photoCount: number;
  isIncognito: boolean;
  hideAge: boolean;
  hideDistance: boolean;
  showLastSeen: boolean;
};

type DiscoverHydratedCandidate = DiscoverBootstrapCandidate & {
  photos: { _id: Id<'photos'>; url: string }[];
};

function createDiscoverBootstrapCandidate(
  user: any,
  distance: number | undefined,
  theyLikedMe: boolean,
): DiscoverBootstrapCandidate {
  return {
    id: user._id,
    name: user.name,
    age: calculateAge(user.dateOfBirth),
    gender: user.gender,
    bio: user.bio,
    height: user.height,
    smoking: user.smoking,
    drinking: user.drinking,
    kids: user.kids,
    education: user.education,
    religion: user.religion,
    jobTitle: user.jobTitle,
    company: user.company,
    school: user.school,
    isVerified: user.isVerified,
    city: user.city,
    distance,
    lastActive: user.lastActive,
    createdAt: user.createdAt,
    lookingFor: Array.isArray(user.lookingFor) ? user.lookingFor : [],
    relationshipIntent: Array.isArray(user.relationshipIntent) ? user.relationshipIntent : [],
    activities: Array.isArray(user.activities) ? user.activities : [],
    profilePrompts: Array.isArray(user.profilePrompts) ? user.profilePrompts : [],
    photoBlurred: user.photoBlurred === true,
    isBoosted: !!(user.boostedUntil && user.boostedUntil > Date.now()),
    theyLikedMe,
    // Bootstrap phase only needs an approximate photo presence signal.
    // Full photo count is hydrated later for the shortlisted pool.
    photoCount: user.primaryPhotoUrl ? 1 : 0,
    isIncognito: user.incognitoMode === true,
    hideAge: user.hideAge === true,
    hideDistance: user.hideDistance === true,
    showLastSeen: user.showLastSeen !== false,
  };
}

function toRankingCandidate(candidate: DiscoverBootstrapCandidate): CandidateProfile {
  return {
    id: candidate.id as string,
    name: candidate.name,
    age: candidate.age,
    gender: candidate.gender,
    bio: candidate.bio,
    city: candidate.city,
    distance: candidate.distance,
    lastActive: candidate.lastActive,
    createdAt: candidate.createdAt,
    isVerified: candidate.isVerified,
    lookingFor: candidate.lookingFor,
    relationshipIntent: candidate.relationshipIntent,
    activities: candidate.activities,
    profilePrompts: candidate.profilePrompts,
    height: candidate.height,
    jobTitle: candidate.jobTitle,
    education: candidate.education,
    smoking: candidate.smoking,
    drinking: candidate.drinking,
    religion: candidate.religion,
    kids: candidate.kids,
    photoCount: candidate.photoCount,
    theyLikedMe: candidate.theyLikedMe,
    isBoosted: candidate.isBoosted,
  };
}

function mapDiscoverPhotosForClient(
  photos: Array<{ _id: Id<'photos'>; url: string }>,
): Array<{ _id: Id<'photos'>; url: string }> {
  return photos.map((photo) => ({
    _id: photo._id,
    url: photo.url,
  }));
}

async function getDiscoverSourceUsers(
  ctx: QueryCtx,
  currentUser: any,
  sortBy: DiscoverSort,
  fetchLimit: number,
) {
  const desiredGenders = Array.isArray(currentUser.lookingFor)
    ? (currentUser.lookingFor as unknown[])
    : [];
  const targetGenders = Array.from(new Set<DiscoverGender>(
    desiredGenders.filter(
      (gender: unknown): gender is DiscoverGender =>
        gender === 'male' ||
        gender === 'female' ||
        gender === 'non_binary' ||
        gender === 'lesbian' ||
        gender === 'other',
    ),
  ));
  if (targetGenders.length === 0) {
    return [];
  }

  // Recommended/recently_active benefit most from recent activity ordering.
  if (sortBy === 'recommended' || sortBy === 'recently_active') {
    const indexedLimit = Math.min(Math.max(fetchLimit, 120), 400);
    return ctx.db
      .query('users')
      .withIndex('by_last_active')
      .order('desc')
      .take(indexedLimit);
  }

  // Other sorts still benefit from narrowing the source pool to the viewer's
  // target genders before applying the remaining in-memory filters.
  const perGenderLimit = Math.max(
    Math.ceil(fetchLimit / Math.max(targetGenders.length, 1)),
    40,
  );

  const buckets = await Promise.all(
    targetGenders.map((gender) =>
      ctx.db
        .query('users')
        .withIndex('by_gender', (q) => q.eq('gender', gender))
        .take(perGenderLimit),
    ),
  );

  const merged: any[] = [];
  const seenUserIds = new Set<string>();
  for (const bucket of buckets) {
    for (const user of bucket) {
      const candidateId = String(user._id);
      if (seenUserIds.has(candidateId)) continue;
      seenUserIds.add(candidateId);
      merged.push(user);
    }
  }

  return merged;
}

function sortBootstrapCandidates(
  candidates: DiscoverBootstrapCandidate[],
  sortBy: Exclude<DiscoverSort, 'recommended'>,
) {
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    if (a.isBoosted && !b.isBoosted) return -1;
    if (!a.isBoosted && b.isBoosted) return 1;

    switch (sortBy) {
      case 'distance':
        return (a.distance ?? 999) - (b.distance ?? 999);
      case 'age':
        return a.age - b.age;
      case 'recently_active':
        return b.lastActive - a.lastActive;
      case 'newest':
        return b.createdAt - a.createdAt;
      default:
        return 0;
    }
  });
  return sorted;
}

async function hydrateDiscoverCandidates(
  ctx: QueryCtx,
  orderedCandidates: DiscoverBootstrapCandidate[],
  targetCount: number,
): Promise<DiscoverHydratedCandidate[]> {
  const hydrated: DiscoverHydratedCandidate[] = [];

  for (
    let i = 0;
    i < orderedCandidates.length && hydrated.length < targetCount;
    i += DISCOVER_PHOTO_HYDRATION_CHUNK_SIZE
  ) {
    const chunk = orderedCandidates.slice(
      i,
      i + DISCOVER_PHOTO_HYDRATION_CHUNK_SIZE,
    );

    const chunkPhotos = await Promise.all(
      chunk.map((candidate) =>
        ctx.db
          .query('photos')
          .withIndex('by_user_order', (q) => q.eq('userId', candidate.id))
          .collect(),
      ),
    );

    for (let j = 0; j < chunk.length; j++) {
      const rawPhotos = chunkPhotos[j];
      const safePhotos = getSafeDiscoverPhotos(
        rawPhotos.filter((photo: any) => photo.photoType !== 'verification_reference'),
      );
      if (safePhotos.length === 0) continue;

      hydrated.push({
        ...chunk[j],
        photos: mapDiscoverPhotosForClient(safePhotos),
        photoCount: safePhotos.length,
      });

      if (hydrated.length >= targetCount) {
        break;
      }
    }
  }

  return hydrated;
}

async function fetchDiscoverTrustSignals(
  ctx: QueryCtx,
  candidateIds: Id<'users'>[],
  viewerBlockedIds: Set<string>,
  viewerReportedIds: Set<string>,
): Promise<TrustSignals> {
  const aggregateReportCounts = new Map<string, number>();
  const aggregateBlockCounts = new Map<string, number>();

  const TRUST_BATCH_SIZE = 50;
  for (let i = 0; i < candidateIds.length; i += TRUST_BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + TRUST_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.flatMap((candidateId) => [
        ctx.db
          .query('reports')
          .withIndex('by_reported_user', (q) => q.eq('reportedUserId', candidateId))
          .collect(),
        ctx.db
          .query('blocks')
          .withIndex('by_blocked', (q) => q.eq('blockedUserId', candidateId))
          .collect(),
      ]),
    );

    for (let j = 0; j < batch.length; j++) {
      const candidateId = batch[j] as string;
      const reports = batchResults[j * 2] || [];
      const blocks = batchResults[j * 2 + 1] || [];

      if (reports.length > 0) {
        aggregateReportCounts.set(candidateId, reports.length);
      }
      if (blocks.length > 0) {
        aggregateBlockCounts.set(candidateId, blocks.length);
      }
    }
  }

  return {
    viewerBlockedIds,
    viewerReportedIds,
    aggregateReportCounts,
    aggregateBlockCounts,
  };
}

function finalizeDiscoverCandidatesForClient(
  candidates: DiscoverHydratedCandidate[],
) {
  return candidates.map((candidate) =>
    sanitizeDiscoverCandidateForClient({
      id: candidate.id,
      name: candidate.name,
      age: candidate.age,
      gender: candidate.gender,
      bio: candidate.bio,
      height: candidate.height,
      smoking: candidate.smoking,
      drinking: candidate.drinking,
      isVerified: candidate.isVerified,
      city: candidate.city,
      distance: candidate.distance,
      lastActive: candidate.lastActive,
      createdAt: candidate.createdAt,
      lookingFor: candidate.lookingFor,
      relationshipIntent: candidate.relationshipIntent,
      activities: candidate.activities,
      profilePrompts: candidate.profilePrompts,
      photos: candidate.photos,
      photoBlurred: candidate.photoBlurred,
      isIncognito: candidate.isIncognito,
      hideAge: candidate.hideAge,
      hideDistance: candidate.hideDistance,
      showLastSeen: candidate.showLastSeen,
    }),
  );
}

// ---------------------------------------------------------------------------
// DISCOVER-CATEGORY-FIX: Shared eligibility helper for counts + detail consistency
// ---------------------------------------------------------------------------

type ExclusionSets = {
  swipedUserIds: Set<string>;
  matchedUserIds: Set<string>;
  blockedUserIds: Set<string>;
  viewerReportedIds: Set<string>;
  conversationPartnerIds: Set<string>;
};

type ExploreEligibleCandidate = {
  user: any;
  distance?: number;
};

type ExploreUnavailableReason = 'unsupported_category' | 'location_required';
type ExploreCategoryStatus =
  | 'ok'
  | 'viewer_missing'
  | 'discovery_paused'
  | 'invalid_category'
  | 'location_required'
  | 'empty_category';
type ExploreCategoryCountsStatus = 'ok' | 'viewer_missing' | 'discovery_paused';

function createEmptyExploreCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const categoryId of LIVE_EXPLORE_CATEGORY_IDS) {
    counts[categoryId] = 0;
  }
  return counts;
}

function mapExploreUnavailableReasonToStatus(
  unavailableReason: ExploreUnavailableReason,
): Exclude<ExploreCategoryStatus, 'ok'> {
  if (unavailableReason === 'location_required') {
    return 'location_required';
  }
  return 'invalid_category';
}

/**
 * Build exclusion sets for a viewer (swipes, matches, blocks, reports, conversations)
 * P2-007 FIX: Use QueryCtx for proper type safety instead of any
 */
async function buildExclusionSets(
  ctx: QueryCtx,
  viewerId: Id<'users'>,
): Promise<ExclusionSets> {
  const now = Date.now();
  const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

  // P2-007 FIX: Removed `q: any` annotations - QueryCtx provides proper types
  const [
    mySwipes,
    matchesAsUser1,
    matchesAsUser2,
    blocksICreated,
    blocksAgainstMe,
    myReports,
    myConversationParticipations,
  ] = await Promise.all([
    ctx.db.query('likes').withIndex('by_from_user', (q) => q.eq('fromUserId', viewerId)).collect(),
    ctx.db.query('matches').withIndex('by_user1', (q) => q.eq('user1Id', viewerId)).filter((q) => q.eq(q.field('isActive'), true)).collect(),
    ctx.db.query('matches').withIndex('by_user2', (q) => q.eq('user2Id', viewerId)).filter((q) => q.eq(q.field('isActive'), true)).collect(),
    ctx.db.query('blocks').withIndex('by_blocker', (q) => q.eq('blockerId', viewerId)).collect(),
    ctx.db.query('blocks').withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerId)).collect(),
    ctx.db.query('reports').withIndex('by_reporter', (q) => q.eq('reporterId', viewerId)).collect(),
    ctx.db.query('conversationParticipants').withIndex('by_user', (q) => q.eq('userId', viewerId)).collect(),
  ]);

  const swipedUserIds = new Set<string>();
  for (const swipe of mySwipes) {
    if (swipe.action === 'pass' && swipe.createdAt < passExpiry) continue;
    swipedUserIds.add(swipe.toUserId as string);
  }

  const matchedUserIds = new Set<string>();
  for (const m of matchesAsUser1) matchedUserIds.add(m.user2Id as string);
  for (const m of matchesAsUser2) matchedUserIds.add(m.user1Id as string);

  const blockedUserIds = new Set<string>();
  for (const b of blocksICreated) blockedUserIds.add(b.blockedUserId as string);
  for (const b of blocksAgainstMe) blockedUserIds.add(b.blockerId as string);

  const viewerReportedIds = new Set<string>();
  for (const report of myReports) viewerReportedIds.add(report.reportedUserId as string);

  const conversationPartnerIds = new Set<string>();
  if (myConversationParticipations.length > 0) {
    // P2-007 FIX: Remove any annotation - type inferred from query result
    const conversations = await Promise.all(
      myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
    );
    for (const conv of conversations) {
      if (!conv) continue;
      for (const participantId of conv.participants) {
        if (participantId !== viewerId) {
          conversationPartnerIds.add(participantId as string);
        }
      }
    }
  }

  return {
    swipedUserIds,
    matchedUserIds,
    blockedUserIds,
    viewerReportedIds,
    conversationPartnerIds,
  };
}

/**
 * Check if a user is eligible to be shown to a viewer
 * SINGLE SOURCE OF TRUTH for category counts AND category detail
 */
function isUserEligibleForViewer(
  user: any,
  viewer: any,
  viewerId: Id<'users'>,
  exclusions: ExclusionSets,
  cooldownThreshold: number,
  debug?: { categoryId: string; logs: string[] },
): boolean {
  // Self exclusion
  if (user._id === viewerId) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: self`);
    return false;
  }

  // Basic filters
  if (!user.isActive) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: not active`);
    return false;
  }
  if (user.isBanned) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: banned`);
    return false;
  }
  if (isUserPaused(user)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: paused`);
    return false;
  }

  // Cooldown check
  if (user.lastShownInDiscoverAt && user.lastShownInDiscoverAt > cooldownThreshold) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: cooldown`);
    return false;
  }

  // Incognito check
  if (user.incognitoMode) {
    const canSee = viewer.gender === 'female' || viewer.subscriptionTier === 'premium';
    if (!canSee) {
      debug?.logs.push(`  [EXCLUDE] ${user.name}: incognito`);
      return false;
    }
  }

  // Gender preference (both ways)
  if (!viewer.lookingFor?.includes(user.gender)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: viewer gender pref`);
    return false;
  }
  if (!user.lookingFor?.includes(viewer.gender)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: user gender pref`);
    return false;
  }

  // Age range (both ways)
  const userAge = calculateAge(user.dateOfBirth);
  const viewerAge = calculateAge(viewer.dateOfBirth);
  if (userAge > 0 && viewer.minAge && viewer.maxAge) {
    if (userAge < viewer.minAge || userAge > viewer.maxAge) {
      debug?.logs.push(`  [EXCLUDE] ${user.name}: viewer age pref (user=${userAge}, range=${viewer.minAge}-${viewer.maxAge})`);
      return false;
    }
  }
  if (viewerAge > 0 && user.minAge && user.maxAge) {
    if (viewerAge < user.minAge || viewerAge > user.maxAge) {
      debug?.logs.push(`  [EXCLUDE] ${user.name}: user age pref (viewer=${viewerAge}, range=${user.minAge}-${user.maxAge})`);
      return false;
    }
  }

  // Distance check
  const distance = calculateDiscoverSafeDistance(viewer, user);
  if (distance != null && viewer.maxDistance) {
    if (!isDistanceAllowed(distance, viewer.maxDistance)) {
      debug?.logs.push(`  [EXCLUDE] ${user.name}: distance (${distance}km > ${viewer.maxDistance}km)`);
      return false;
    }
  }

  // Exclusion sets
  if (exclusions.swipedUserIds.has(user._id as string)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: already swiped`);
    return false;
  }
  if (exclusions.matchedUserIds.has(user._id as string)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: already matched`);
    return false;
  }
  if (exclusions.blockedUserIds.has(user._id as string)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: blocked`);
    return false;
  }
  if (exclusions.viewerReportedIds.has(user._id as string)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: reported`);
    return false;
  }
  if (exclusions.conversationPartnerIds.has(user._id as string)) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: conversation partner`);
    return false;
  }

  // Verification enforcement
  if (user.verificationEnforcementLevel === 'security_only') {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: security_only enforcement`);
    return false;
  }
  if (
    user.verificationEnforcementLevel === 'reduced_reach' &&
    !shouldIncludeReducedReachCandidate(String(viewerId), String(user._id))
  ) {
    debug?.logs.push(`  [EXCLUDE] ${user.name}: reduced_reach enforcement`);
    return false;
  }

  debug?.logs.push(`  [ELIGIBLE] ${user.name}`);
  return true;
}

async function getEligibleExploreCategoryUsers(
  ctx: QueryCtx,
  viewer: any,
  viewerId: Id<'users'>,
  categoryId: string,
  rawFetchLimit: number,
  exclusions: ExclusionSets,
  cooldownThreshold: number,
): Promise<{
  candidates: ExploreEligibleCandidate[];
  unavailableReason: ExploreUnavailableReason | null;
  sourceHitFetchLimit: boolean;
}> {
  if (!LIVE_EXPLORE_CATEGORY_ID_SET.has(categoryId)) {
    return { candidates: [], unavailableReason: 'unsupported_category', sourceHitFetchLimit: false };
  }

  const debug = { categoryId, logs: [] as string[] };
  const filteredCandidates: ExploreEligibleCandidate[] = [];

  if (categoryId === 'nearby') {
    const viewerCoords = getDiscoverSafeCoordinates(viewer);
    if (!viewerCoords) {
      return { candidates: [], unavailableReason: 'location_required', sourceHitFetchLimit: false };
    }

    const allActiveUsers = await ctx.db
      .query('users')
      .withIndex('by_last_active')
      .order('desc')
      .filter((q) => q.eq(q.field('isActive'), true))
      .take(rawFetchLimit);
    const sourceHitFetchLimit = allActiveUsers.length === rawFetchLimit;

    for (const user of allActiveUsers) {
      if (!hasDiscoverablePrimaryPhoto(user)) continue;

      const distance = calculateDiscoverSafeDistance(viewer, user);
      if (distance == null || distance > EXPLORE_NEARBY_DISTANCE_KM) continue;

      if (!isUserEligibleForViewer(user, viewer, viewerId, exclusions, cooldownThreshold, debug)) {
        continue;
      }

      filteredCandidates.push({ user, distance });
    }

    return { candidates: filteredCandidates, unavailableReason: null, sourceHitFetchLimit };
  }

  const categoryUsers = await ctx.db
    .query('users')
    .withIndex('by_discover_category', (q) => q.eq('assignedDiscoverCategory', categoryId))
    .take(rawFetchLimit);
  const sourceHitFetchLimit = categoryUsers.length === rawFetchLimit;

  for (const user of categoryUsers) {
    if (!hasDiscoverablePrimaryPhoto(user)) continue;

    if (!isUserEligibleForViewer(user, viewer, viewerId, exclusions, cooldownThreshold, debug)) {
      continue;
    }

    filteredCandidates.push({
      user,
      distance: calculateDiscoverSafeDistance(viewer, user),
    });
  }

  return { candidates: filteredCandidates, unavailableReason: null, sourceHitFetchLimit };
}

// ---------------------------------------------------------------------------
// Simple 4-signal scoring (0–100 each, then weighted)
//
//   score = 0.45 * activity + 0.35 * completeness
//         + 0.15 * preference + 0.05 * rotation
//
// No hard-blocks — everyone appears; complete profiles rank higher.
// ---------------------------------------------------------------------------

/** A) Activity score (0–100) — recently active users rank higher. */
function activityScore(lastActive: number): number {
  const now = Date.now();
  const hoursAgo = (now - lastActive) / (1000 * 60 * 60);
  if (hoursAgo < 1)  return 100;
  if (hoursAgo < 4)  return 85;
  if (hoursAgo < 12) return 70;
  if (hoursAgo < 24) return 55;
  if (hoursAgo < 72) return 35;
  if (hoursAgo < 168) return 15; // 7 days
  return 5;
}

/** B) Profile completeness score (0–100). */
function completenessScore(user: {
  bio: string;
  profilePrompts?: { question: string; answer: string }[];
  activities: string[];
  isVerified: boolean;
  height?: number;
  jobTitle?: string;
  education?: string;
}, photoCount: number): number {
  let score = 0;

  // Bio filled? (0–20)
  if (user.bio && user.bio.trim().length >= 100) score += 20;
  else if (user.bio && user.bio.trim().length >= 50) score += 15;
  else if (user.bio && user.bio.trim().length > 0) score += 5;

  // 3 prompts answered? (0–25)
  const filledPrompts = (user.profilePrompts ?? []).filter(
    (p) => p.answer.trim().length > 0,
  ).length;
  score += Math.min(filledPrompts, 3) * 8; // 0, 8, 16, 24 — cap at 24
  if (filledPrompts >= 3) score += 1; // bonus for hitting 3

  // Interests selected? (0–15)
  if (user.activities.length >= 3) score += 15;
  else if (user.activities.length >= 1) score += 8;

  // At least 1 photo? (0–20)
  if (photoCount >= 4) score += 20;
  else if (photoCount >= 2) score += 15;
  else if (photoCount >= 1) score += 10;

  // Verified? (0–10)
  if (user.isVerified) score += 10;

  // Optional extras (0–10)
  if (user.height) score += 3;
  if (user.jobTitle) score += 3;
  if (user.education) score += 4;

  return Math.min(score, 100);
}

/** C) Preference match score (0–100) — age/city + common interests. */
function preferenceMatchScore(
  candidate: {
    city?: string;
    activities: string[];
    relationshipIntent: string[];
  },
  currentUser: {
    city?: string;
    activities: string[];
    relationshipIntent: string[];
  },
): number {
  let score = 0;

  // Same city? (0–30)
  if (candidate.city && currentUser.city && candidate.city === currentUser.city) {
    score += 30;
  }

  // Common interests (0–40) — 10 pts each, cap at 40
  const shared = candidate.activities.filter((a) => currentUser.activities.includes(a));
  score += Math.min(shared.length * 10, 40);

  // Relationship intent alignment (0–30) - CURRENT 9 RELATIONSHIP CATEGORIES
  const intentCompat: Record<string, string[]> = {
    serious_vibes: ['serious_vibes', 'see_where_it_goes'],
    keep_it_casual: ['keep_it_casual', 'open_to_vibes'],
    exploring_vibes: ['exploring_vibes', 'open_to_anything', 'new_to_dating'],
    see_where_it_goes: ['see_where_it_goes', 'serious_vibes'],
    open_to_vibes: ['open_to_vibes', 'keep_it_casual'],
    just_friends: ['just_friends', 'open_to_anything'],
    open_to_anything: ['open_to_anything', 'exploring_vibes', 'just_friends'],
    single_parent: ['single_parent', 'serious_vibes', 'exploring_vibes'],
    new_to_dating: ['new_to_dating', 'exploring_vibes', 'open_to_anything'],
  };
  let bestIntent = 0;
  for (const mine of currentUser.relationshipIntent) {
    for (const theirs of candidate.relationshipIntent) {
      if (mine === theirs) bestIntent = Math.max(bestIntent, 30);
      else if (intentCompat[mine]?.includes(theirs)) bestIntent = Math.max(bestIntent, 15);
    }
  }
  score += bestIntent;

  return Math.min(score, 100);
}

/** D) Rotation score (0–100) — pseudo-random per viewer+candidate pair per day. */
function rotationScore(viewerId: string, candidateId: string): number {
  // Simple day-seeded hash so the order shuffles daily
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  let h = day;
  for (let i = 0; i < viewerId.length; i++) h = ((h << 5) - h + viewerId.charCodeAt(i)) | 0;
  for (let i = 0; i < candidateId.length; i++) h = ((h << 5) - h + candidateId.charCodeAt(i)) | 0;
  return Math.abs(h) % 101; // 0–100
}

// NOTE: Old rankScore function removed (P1 dead code cleanup)
// New ranking system in discoverRanking.ts is now the only scoring logic

// ---------------------------------------------------------------------------
// getDiscoverProfiles — main swipe deck query
// ---------------------------------------------------------------------------

export const getDiscoverProfiles = query({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId string
    sortBy: v.optional(v.union(
      v.literal('recommended'),
      v.literal('distance'),
      v.literal('age'),
      v.literal('recently_active'),
      v.literal('newest'),
    )),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    // filterVersion is a cache-busting param — not used in logic, just forces re-fetch
    filterVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { sortBy = 'recommended', limit = 20, offset = 0 } = args;
    // filterVersion intentionally unused — it's only to bust query cache

    // Map authUserId -> Convex Id<"users"> (QUERY: read-only, no creation)
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      console.log('[getDiscoverProfiles] User not found for authUserId:', args.userId);
      return [];
    }

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return [];

    if (isUserPaused(currentUser)) return [];

    // PERF #8: Pre-fetch all swipes, matches, blocks, and incoming likes upfront
    // This converts O(6*N) queries into O(6) queries
    const now = Date.now();
    const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

    const [
      mySwipes,
      matchesAsUser1,
      matchesAsUser2,
      blocksICreated,
      blocksAgainstMe,
      likesToMe,
      myReports,
      myConversationParticipations,
    ] = await Promise.all([
      // All my swipes (likes/passes)
      ctx.db
        .query('likes')
        .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
        .collect(),
      // Matches where I'm user1
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
      // Matches where I'm user2
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .filter((q) => q.eq(q.field('isActive'), true))
        .collect(),
      // Blocks I created
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
        .collect(),
      // Blocks against me
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
        .collect(),
      // Likes to me (for theyLikedMe feature)
      ctx.db
        .query('likes')
        .withIndex('by_to_user', (q) => q.eq('toUserId', userId))
        .filter((q) => q.eq(q.field('action'), 'like'))
        .collect(),
      // Reports I created (viewer-specific hard exclusion)
      ctx.db
        .query('reports')
        .withIndex('by_reporter', (q) => q.eq('reporterId', userId))
        .collect(),
      // P1-004 SCALABILITY FIX: Trust signals now fetched AFTER filtering (see below)
      // Removed global .collect() - trust penalties are fetched only for filtered candidates
      // CONVERSATION PARTNER EXCLUSION: All my conversation participations
      // Users with existing message threads must not reappear in Discover
      ctx.db
        .query('conversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    ]);

    // Build Sets for O(1) lookups
    const swipedUserIds = new Set<string>();
    for (const swipe of mySwipes) {
      // Skip expired passes (can re-show after 7 days)
      if (swipe.action === 'pass' && swipe.createdAt < passExpiry) continue;
      swipedUserIds.add(swipe.toUserId as string);
    }

    const matchedUserIds = new Set<string>();
    for (const m of matchesAsUser1) matchedUserIds.add(m.user2Id as string);
    for (const m of matchesAsUser2) matchedUserIds.add(m.user1Id as string);

    const blockedUserIds = new Set<string>();
    for (const b of blocksICreated) blockedUserIds.add(b.blockedUserId as string);
    for (const b of blocksAgainstMe) blockedUserIds.add(b.blockerId as string);

    const usersWhoLikedMe = new Set<string>();
    for (const like of likesToMe) usersWhoLikedMe.add(like.fromUserId as string);

    // TRUST SIGNALS: Viewer-specific reports (hard exclusion)
    const viewerReportedIds = new Set<string>();
    for (const report of myReports) viewerReportedIds.add(report.reportedUserId as string);

    // CONVERSATION PARTNER EXCLUSION: Build set of users with existing message threads
    // This ensures users who already have a chat connection don't reappear in Discover
    const conversationPartnerIds = new Set<string>();
    if (myConversationParticipations.length > 0) {
      // Batch fetch all conversations for efficiency
      const conversations = await Promise.all(
        myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
      );
      for (const conv of conversations) {
        if (!conv) continue;
        // Extract partner IDs from participants array (excluding self)
        for (const participantId of conv.participants) {
          if (participantId !== userId) {
            conversationPartnerIds.add(participantId as string);
          }
        }
      }
    }

    // P1-004 SCALABILITY FIX: Trust signals (aggregateReportCounts, aggregateBlockCounts)
    // are now fetched AFTER filtering, only for the filtered candidate set.
    // This avoids loading full reports/blocks tables. See below after candidates are built.

    const requestedWindow = Math.max(offset + limit, limit, 1);
    const fetchLimit = getDiscoverFetchLimit(offset, limit, sortBy);
    const sourcedUsers = await getDiscoverSourceUsers(
      ctx,
      currentUser,
      sortBy,
      fetchLimit,
    );

    // First pass: build a lightweight shortlist without photo or trust hydration.
    const bootstrapCandidates: DiscoverBootstrapCandidate[] = [];

    for (const user of sourcedUsers) {
      if (user._id === userId) continue;
      if (!user.isActive || user.isBanned) continue;
      if (isUserPaused(user)) continue;

      // NOTE: Verification is NOT a hard filter - it's a ranking boost
      // Unverified users appear lower in ranking, not excluded

      // Incognito check
      if (user.incognitoMode) {
        const canSee = currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';
        if (!canSee) continue;
      }

      // Gender preference match (both ways)
      if (!currentUser.lookingFor.includes(user.gender)) continue;
      if (!user.lookingFor.includes(currentUser.gender)) continue;

      // Age range
      const userAge = calculateAge(user.dateOfBirth);
      if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;
      const myAge = calculateAge(currentUser.dateOfBirth);
      if (myAge < user.minAge || myAge > user.maxAge) continue;

      // Distance
      let distance: number | undefined;
      if (
        typeof currentUser.publishedLat === 'number' &&
        typeof currentUser.publishedLng === 'number' &&
        typeof user.publishedLat === 'number' &&
        typeof user.publishedLng === 'number'
      ) {
        distance = calculateDistance(
          currentUser.publishedLat, currentUser.publishedLng,
          user.publishedLat, user.publishedLng,
        );
        if (!isDistanceAllowed(distance, currentUser.maxDistance)) continue;
      }

      // PERF #8: O(1) Set lookups instead of database queries
      if (swipedUserIds.has(user._id as string)) continue;
      if (matchedUserIds.has(user._id as string)) continue;
      if (blockedUserIds.has(user._id as string)) continue;
      // TRUST: Viewer-specific report exclusion (hard filter)
      if (viewerReportedIds.has(user._id as string)) continue;
      // CONVERSATION PARTNER EXCLUSION: Users with existing chat threads must not reappear
      if (conversationPartnerIds.has(user._id as string)) continue;

      // Enforcement
      if (user.verificationEnforcementLevel === 'security_only') continue;
      // P1-027 FIX: Use deterministic hash instead of Math.random() for reduced_reach
      // This ensures consistent results across page loads for the same viewer+user pair
      if (
        user.verificationEnforcementLevel === 'reduced_reach' &&
        !shouldIncludeReducedReachCandidate(String(userId), String(user._id))
      ) {
        continue;
      }

      bootstrapCandidates.push(
        createDiscoverBootstrapCandidate(
          user,
          distance,
          usersWhoLikedMe.has(user._id as string),
        ),
      );
    }

    // Sort
    if (sortBy === 'recommended') {
      if (bootstrapCandidates.length === 0) {
        return [];
      }

      const shortlistTarget = Math.min(
        bootstrapCandidates.length,
        Math.max(
          requestedWindow * DISCOVER_BOOTSTRAP_WINDOW_MULTIPLIER,
          DISCOVER_BOOTSTRAP_SHORTLIST_MIN,
        ),
        DISCOVER_BOOTSTRAP_SHORTLIST_MAX,
      );

      // Phase 3: Shadow mode decision (once per request)
      const runShadow = shouldRunShadowComparison();

      // Build CurrentUser object for ranking
      const rankingCurrentUser: CurrentUser = {
        _id: currentUser._id as string,
        city: currentUser.city,
        activities: currentUser.activities,
        relationshipIntent: currentUser.relationshipIntent,
        lookingFor: currentUser.lookingFor,
        minAge: currentUser.minAge,
        maxAge: currentUser.maxAge,
        maxDistance: currentUser.maxDistance,
        smoking: currentUser.smoking,
        drinking: currentUser.drinking,
        religion: currentUser.religion,
        kids: currentUser.kids,
        // Life rhythm from onboarding draft (if available)
        lifeRhythm: currentUser.onboardingDraft?.lifeRhythm,
        // Seed questions from onboarding draft (if available)
        seedQuestions: currentUser.onboardingDraft?.profileDetails?.seedQuestions,
      };

      // Bootstrap ranking runs on lightweight user docs first so we only hydrate
      // full photo arrays for the near-final recommendation pool.
      const bootstrapTrustSignals: TrustSignals = {
        viewerBlockedIds: blockedUserIds,
        viewerReportedIds,
        aggregateReportCounts: new Map(),
        aggregateBlockCounts: new Map(),
      };
      const bootstrapProfiles = bootstrapCandidates.map(toRankingCandidate);
      const { rankedCandidates: bootstrapRankedCandidates } = rankDiscoverCandidates(
        bootstrapProfiles,
        rankingCurrentUser,
        bootstrapTrustSignals,
        shortlistTarget,
        false // useFallback flag - fallback logic handled below
      );
      const bootstrapRankMap = new Map(
        bootstrapRankedCandidates.map((candidate, index) => [candidate.id, index]),
      );
      const bootstrapShortlist = bootstrapCandidates
        .filter((candidate) => bootstrapRankMap.has(candidate.id as string))
        .sort(
          (a, b) =>
            (bootstrapRankMap.get(a.id as string) ?? 0) -
            (bootstrapRankMap.get(b.id as string) ?? 0),
        );

      const hydratedCandidates = await hydrateDiscoverCandidates(
        ctx,
        bootstrapShortlist,
        shortlistTarget,
      );
      if (hydratedCandidates.length === 0) {
        return [];
      }

      const trustSignals = await fetchDiscoverTrustSignals(
        ctx,
        hydratedCandidates.map((candidate) => candidate.id),
        blockedUserIds,
        viewerReportedIds,
      );
      const candidateProfiles = hydratedCandidates.map(toRankingCandidate);

      // Apply final ranking only after full hydration for the near-final pool.
      const { rankedCandidates, exhausted } = rankDiscoverCandidates(
        candidateProfiles,
        rankingCurrentUser,
        trustSignals,
        requestedWindow,
        false,
      );
      const rankedIds = new Set(rankedCandidates.map(c => c.id));
      const rankedMap = new Map(rankedCandidates.map((c, i) => [c.id, i]));
      let result = hydratedCandidates
        .filter(c => rankedIds.has(c.id as string))
        .sort((a, b) => (rankedMap.get(a.id as string) || 0) - (rankedMap.get(b.id as string) || 0));

      // P1 FIX: Fallback mechanism when primary pool is exhausted
      // If we have fewer results than requested, activate fallback pool
      // Fallback candidates must have 2+ compatibility signals.
      // Safe incremental version: fallback is limited to the hydrated shortlist.
      if (exhausted && result.length < requestedWindow) {
        const needed = requestedWindow - result.length;
        const usedIds = new Set(result.map(r => r.id as string));

        const fallbackCandidates = candidateProfiles
          .filter(c => !usedIds.has(c.id) && qualifiesForFallback(c, rankingCurrentUser))
          .map(c => ({ c, score: calculateRankScore(c, rankingCurrentUser, trustSignals) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, needed)
          .map(({ c }) => c);

        const candidateById = new Map(hydratedCandidates.map(c => [c.id as string, c]));
        const fallbackResults: DiscoverHydratedCandidate[] = [];
        for (const c of fallbackCandidates) {
          const original = candidateById.get(c.id);
          if (original) fallbackResults.push(original);
        }

        result = [...result, ...fallbackResults];
      }

      // Phase 3: Shadow mode rank comparison (no production impact)
      // Legacy result is finalized above - this only logs for analysis
      if (runShadow) {
        try {
          // Build normalized viewer inline (avoids adapter type mismatch)
          const normalizedViewer: import('./ranking/rankingTypes').NormalizedViewer = {
            id: currentUser._id as string,
            phase: 'phase1',
            relationshipIntent: rankingCurrentUser.relationshipIntent ?? [],
            activities: rankingCurrentUser.activities ?? [],
            lifestyle: {
              smoking: rankingCurrentUser.smoking,
              drinking: rankingCurrentUser.drinking,
              kids: rankingCurrentUser.kids,
              religion: rankingCurrentUser.religion,
            },
            maxDistance: rankingCurrentUser.maxDistance,
            lifeRhythm: rankingCurrentUser.lifeRhythm,
            seedQuestions: rankingCurrentUser.seedQuestions,
            blockedIds: blockedUserIds,
            reportedIds: viewerReportedIds,
          };

          // Build normalized candidates inline from the hydrated shortlist only.
          const normalizedCandidates: import('./ranking/rankingTypes').NormalizedCandidate[] = candidateProfiles.map(c => ({
            id: c.id,
            phase: 'phase1' as const,
            relationshipIntent: c.relationshipIntent ?? [],
            activities: c.activities ?? [],
            lifestyle: {
              smoking: c.smoking,
              drinking: c.drinking,
              kids: c.kids,
              religion: c.religion,
            },
            bioLength: c.bio?.trim().length ?? 0,
            promptsAnswered: (c.profilePrompts ?? []).filter(p => p.answer?.trim().length > 0).length,
            photoCount: c.photoCount,
            isVerified: c.isVerified,
            hasOptionalFields: {
              height: !!c.height,
              jobTitle: !!c.jobTitle,
              education: !!c.education,
            },
            lastActiveAt: c.lastActive,
            onboardedAt: c.createdAt,
            createdAt: c.createdAt,
            distance: c.distance,
            theyLikedMe: c.theyLikedMe,
            isBoosted: c.isBoosted,
            lifeRhythm: c.lifeRhythm,
            seedQuestions: c.seedQuestions,
            reportCount: c.reportCount ?? 0,
            blockCount: c.blockCount ?? 0,
            totalImpressions: 0,
            lastShownAt: 0,
          }));

          // Run shared ranking engine
          const sharedResult = sharedRankCandidates(normalizedCandidates, normalizedViewer, undefined, { limit });

          // Build rank lookup for shared results
          const sharedRankMap = new Map<string, number>();
          sharedResult.rankedCandidates.forEach((c, i) => sharedRankMap.set(c.id, i));

          // Build comparisons for returned window only (capped)
          // Using [candidateId, legacyRank, sharedRank] for rank-diff analysis
          // logBatchRankingComparison computes |sharedRank - legacyRank| as diff
          const finalResult = result.slice(offset, offset + limit);
          const comparisons: Array<[string, number, number]> = [];
          for (let i = 0; i < finalResult.length; i++) {
            const candidateId = finalResult[i].id as string;
            const sharedRank = sharedRankMap.get(candidateId) ?? -1;
            comparisons.push([candidateId, i, sharedRank]);
          }

          logBatchRankingComparison(currentUser._id as string, comparisons, 'phase1');
        } catch (shadowError) {
          // P2-009 FIX: Log shadow mode errors for debugging
          // Shadow mode must never break production, but we need visibility into failures
          // Note: Using console.warn (not __DEV__ which is React Native only)
          console.warn('[Shadow Ranking] Error during comparison:', shadowError);
        }
      }

      return finalizeDiscoverCandidatesForClient(
        result.slice(offset, offset + limit),
      );
    } else {
      const orderedBootstrapCandidates = sortBootstrapCandidates(
        bootstrapCandidates,
        sortBy,
      );
      const hydrationTarget = Math.min(
        orderedBootstrapCandidates.length,
        requestedWindow + Math.max(limit, DISCOVER_NON_RECOMMENDED_BUFFER),
      );
      const hydratedCandidates = await hydrateDiscoverCandidates(
        ctx,
        orderedBootstrapCandidates,
        hydrationTarget,
      );

      return finalizeDiscoverCandidatesForClient(
        hydratedCandidates.slice(offset, offset + limit),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// getExploreProfiles — filtered category view
// ---------------------------------------------------------------------------

export const getExploreProfiles = query({
  args: {
    userId: v.union(v.id('users'), v.string()),
    genderFilter: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('other')))),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    maxDistance: v.optional(v.number()),
    // CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
    relationshipIntent: v.optional(v.array(v.union(
      v.literal('serious_vibes'), v.literal('keep_it_casual'), v.literal('exploring_vibes'),
      v.literal('see_where_it_goes'), v.literal('open_to_vibes'), v.literal('just_friends'),
      v.literal('open_to_anything'), v.literal('single_parent'), v.literal('new_to_dating'),
    ))),
    activities: v.optional(v.array(v.union(
      v.literal('coffee'), v.literal('date_night'), v.literal('sports'),
      v.literal('movies'), v.literal('free_tonight'), v.literal('foodie'),
      v.literal('gym_partner'), v.literal('concerts'), v.literal('travel'),
      v.literal('outdoors'), v.literal('art_culture'), v.literal('gaming'),
      v.literal('nightlife'), v.literal('brunch'), v.literal('study_date'),
      v.literal('this_weekend'), v.literal('beach_pool'), v.literal('road_trip'),
      v.literal('photography'), v.literal('volunteering'),
    ))),
    sortByInterests: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      genderFilter, minAge, maxAge, maxDistance,
      relationshipIntent, activities, sortByInterests,
      limit = 20, offset = 0,
    } = args;

    const viewerId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!viewerId) return { profiles: [], totalCount: 0 };

    const currentUser = await ctx.db.get(viewerId);
    if (!currentUser) return { profiles: [], totalCount: 0 };
    if (isUserPaused(currentUser)) return { profiles: [], totalCount: 0 };

    const effectiveGender = genderFilter ?? currentUser.lookingFor ?? [];
    const effectiveMinAge = minAge ?? currentUser.minAge;
    const effectiveMaxAge = maxAge ?? currentUser.maxAge;
    const effectiveMaxDistance = maxDistance ?? currentUser.maxDistance;

    const hasStrictFilters = (relationshipIntent && relationshipIntent.length > 0) ||
      (activities && activities.length > 0);
    const bufferMultiplier = hasStrictFilters ? 20 : 10;
    const fetchLimit = Math.max((offset + limit) * bufferMultiplier, 200);
    const cooldownThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const [allUsers, exclusions] = await Promise.all([
      ctx.db.query('users').take(fetchLimit),
      buildExclusionSets(ctx, viewerId),
    ]);

    type FilteredUser = { user: typeof allUsers[number]; userAge: number; distance: number | undefined };
    const filteredUsers: FilteredUser[] = [];

    for (const user of allUsers) {
      if (!isUserEligibleForViewer(user, currentUser, viewerId, exclusions, cooldownThreshold)) {
        continue;
      }

      if (effectiveGender.length > 0 && !effectiveGender.includes(user.gender)) continue;

      const userAge = calculateAge(user.dateOfBirth);
      if (effectiveMinAge != null && userAge < effectiveMinAge) continue;
      if (effectiveMaxAge != null && userAge > effectiveMaxAge) continue;

      const distance = calculateDiscoverSafeDistance(currentUser, user);
      if (effectiveMaxDistance != null && !isDistanceAllowed(distance, effectiveMaxDistance)) continue;

      if (relationshipIntent && relationshipIntent.length > 0) {
        const userRelationshipIntent = Array.isArray(user.relationshipIntent) ? user.relationshipIntent : [];
        if (!relationshipIntent.some((i) => userRelationshipIntent.includes(i))) continue;
      }

      if (activities && activities.length > 0) {
        const userActivities = Array.isArray(user.activities) ? user.activities : [];
        if (!activities.some((a) => userActivities.includes(a))) continue;
      }

      filteredUsers.push({ user, userAge, distance });
    }

    const CHUNK_SIZE = 20;
    const photosByUser = new Map<string, any[]>();
    for (let i = 0; i < filteredUsers.length; i += CHUNK_SIZE) {
      const chunk = filteredUsers.slice(i, i + CHUNK_SIZE);
      const chunkPhotos = await Promise.all(
        chunk.map((f) =>
          ctx.db
            .query('photos')
            .withIndex('by_user_order', (q) => q.eq('userId', f.user._id))
            .collect()
        )
      );
      for (let j = 0; j < chunk.length; j++) {
        photosByUser.set(chunk[j].user._id as string, chunkPhotos[j]);
      }
    }

    const candidates = [];
    for (const { user, userAge, distance } of filteredUsers) {
      const rawPhotos = photosByUser.get(user._id as string) ?? [];
      const photos = getSafeDiscoverPhotos(
        rawPhotos.filter((photo: any) => photo.photoType !== 'verification_reference')
      );
      if (photos.length === 0) continue;

      candidates.push(sanitizeDiscoverCandidateForClient({
        id: user._id,
        name: user.name,
        age: userAge,
        gender: user.gender,
        bio: user.bio,
        isVerified: user.isVerified,
        city: user.city,
        distance,
        lastActive: user.lastActive,
        lookingFor: user.lookingFor,
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        profilePrompts: user.profilePrompts,
        photos: mapDiscoverPhotosForClient(photos),
        photoBlurred: user.photoBlurred === true,
        photoCount: photos.length,
        isIncognito: user.incognitoMode === true,
        hideAge: user.hideAge === true,
        hideDistance: user.hideDistance === true,
        showLastSeen: user.showLastSeen !== false,
      }));
    }

    const currentActivities = Array.isArray(currentUser.activities) ? currentUser.activities : [];

    if (sortByInterests && currentActivities.length > 0) {
      candidates.sort((a, b) => {
        const shA = a.activities.filter((act) => currentActivities.includes(act)).length;
        const shB = b.activities.filter((act) => currentActivities.includes(act)).length;
        return shB - shA;
      });
    } else if ((relationshipIntent && relationshipIntent.length > 0) || (activities && activities.length > 0)) {
      candidates.sort((a, b) => {
        let sA = 0, sB = 0;
        if (relationshipIntent) {
          sA += relationshipIntent.filter((i) => a.relationshipIntent.includes(i)).length;
          sB += relationshipIntent.filter((i) => b.relationshipIntent.includes(i)).length;
        }
        if (activities) {
          sA += activities.filter((act) => a.activities.includes(act)).length;
          sB += activities.filter((act) => b.activities.includes(act)).length;
        }
        return sB - sA;
      });
    } else {
      candidates.sort((a, b) => {
        const scoreA = 0.45 * activityScore(a.lastActive) +
          0.35 * completenessScore(a, a.photoCount) +
          0.15 * preferenceMatchScore(a, currentUser) +
          0.05 * rotationScore(currentUser._id as string, a.id as string);
        const scoreB = 0.45 * activityScore(b.lastActive) +
          0.35 * completenessScore(b, b.photoCount) +
          0.15 * preferenceMatchScore(b, currentUser) +
          0.05 * rotationScore(currentUser._id as string, b.id as string);
        return scoreB - scoreA;
      });
    }

    return {
      profiles: candidates.slice(offset, offset + limit),
      totalCount: candidates.length,
    };
  },
});

// ---------------------------------------------------------------------------
// getFilterCounts — badge numbers for explore grid
// ---------------------------------------------------------------------------

export const getFilterCounts = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const { userId } = args;
    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return {};

    const intentCounts: Record<string, number> = {};
    const activityCounts: Record<string, number> = {};

    // P1-001 FIX: Use by_gender index with bounded reads instead of .collect()
    // Dedupe genders to avoid querying same bucket twice
    const genders = Array.from(new Set(currentUser.lookingFor ?? []));
    if (genders.length === 0) return { intentCounts, activityCounts };

    // Track seen users to avoid double-counting if user appears in multiple queries
    const seenUserIds = new Set<string>();
    const MAX_PER_GENDER = 2500;

    for (const gender of genders) {
      const users = await ctx.db
        .query('users')
        .withIndex('by_gender', (q) => q.eq('gender', gender))
        .take(MAX_PER_GENDER);

      for (const user of users) {
        if (String(user._id) === String(userId)) continue;
        if (seenUserIds.has(String(user._id))) continue;
        seenUserIds.add(String(user._id));

        if (!user.isActive || user.isBanned) continue;
        if (isUserPaused(user)) continue;

        // P0 FIX: Verification is a ranking boost, not a hard filter
        // Removed verification check - unverified users are included in counts

        const userAge = calculateAge(user.dateOfBirth);
        if (userAge < currentUser.minAge || userAge > currentUser.maxAge) continue;

        for (const intent of user.relationshipIntent) {
          intentCounts[intent] = (intentCounts[intent] || 0) + 1;
        }
        for (const activity of user.activities) {
          activityCounts[activity] = (activityCounts[activity] || 0) + 1;
        }
      }
    }

    return { intentCounts, activityCounts };
  },
});

// ---------------------------------------------------------------------------
// DISCOVER-CATEGORY-FIX: Category-based profile query
// Uses single-category assignment to prevent duplicate visibility
// ---------------------------------------------------------------------------

// Constants imported from discoverCategories.ts
const SHOWN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get profiles for a specific Explore category
 * Uses the single-category assignment system to ensure mutual exclusivity
 * FIXED: Now uses shared isUserEligibleForViewer for consistency with getExploreCategoryCounts
 */
export const getExploreCategoryProfiles = query({
  args: {
    categoryId: v.string(), // Category key from exploreCategories.ts
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    refreshKey: v.optional(v.number()), // Client-only cache busting / refetch trigger
  },
  handler: async (ctx, args) => {
    const { categoryId, limit = EXPLORE_CATEGORY_PAGE_SIZE, offset = 0 } = args;
    const viewerId = await requireAuthenticatedUserId(ctx);
    const emptyResponse = (
      status: Exclude<ExploreCategoryStatus, 'ok'>,
    ) => ({
      status,
      profiles: [] as any[],
      totalCount: 0,
      hasMore: false,
      partialBatchExhausted: false,
    });

    const viewer = await ctx.db.get(viewerId);
    if (!viewer) return emptyResponse('viewer_missing');
    if (isUserPaused(viewer)) return emptyResponse('discovery_paused');

    const cooldownThreshold = Date.now() - SHOWN_COOLDOWN_MS;
    const exclusions = await buildExclusionSets(ctx, viewerId);
    const rawFetchLimit = Math.min(
      Math.max((offset + limit) * EXPLORE_CATEGORY_FETCH_MULTIPLIER, limit, EXPLORE_CATEGORY_PAGE_SIZE),
      EXPLORE_CATEGORY_MAX_FETCH,
    );

    // Also fetch likes for "they liked me" badge
    const likesToMe = await ctx.db
      .query('likes')
      .withIndex('by_to_user', (q) => q.eq('toUserId', viewerId))
      .filter((q) => q.eq(q.field('action'), 'like'))
      .collect();
    const usersWhoLikedMe = new Set<string>();
    for (const like of likesToMe) usersWhoLikedMe.add(like.fromUserId as string);
    const {
      candidates: filteredCandidates,
      unavailableReason,
      sourceHitFetchLimit,
    } = await getEligibleExploreCategoryUsers(
      ctx,
      viewer,
      viewerId,
      categoryId,
      rawFetchLimit,
      exclusions,
      cooldownThreshold,
    );

    if (unavailableReason) {
      return emptyResponse(mapExploreUnavailableReasonToStatus(unavailableReason));
    }

    // Batch fetch photos for filtered candidates
    const photoResults = await Promise.all(
      filteredCandidates.map(({ user }) =>
        ctx.db
          .query('photos')
          .withIndex('by_user_order', (q) => q.eq('userId', user._id))
          .collect()
      )
    );

    // Build final profiles
    const candidates = [];
    for (let i = 0; i < filteredCandidates.length; i++) {
      const { user, distance } = filteredCandidates[i];
      const rawPhotos = photoResults[i];

      const safePhotos = getSafeDiscoverPhotos(
        rawPhotos.filter((p) => p.photoType !== 'verification_reference')
      );
      if (safePhotos.length === 0) continue;

      const userAge = calculateAge(user.dateOfBirth);
      const theyLikedMe = usersWhoLikedMe.has(user._id as string);

      candidates.push(sanitizeDiscoverCandidateForClient({
        id: user._id,
        name: user.name,
        age: userAge,
        gender: user.gender,
        bio: user.bio,
        height: user.height,
        smoking: user.smoking,
        drinking: user.drinking,
        kids: user.kids,
        education: user.education,
        religion: user.religion,
        jobTitle: user.jobTitle,
        company: user.company,
        school: user.school,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus || 'unverified',
        city: user.city,
        distance,
        lastActive: user.lastActive,
        createdAt: user.createdAt,
        lookingFor: user.lookingFor,
        relationshipIntent: user.relationshipIntent,
        activities: user.activities,
        profilePrompts: user.profilePrompts,
        photos: mapDiscoverPhotosForClient(safePhotos),
        photoBlurred: user.photoBlurred === true,
        isBoosted: !!(user.boostedUntil && user.boostedUntil > Date.now()),
        theyLikedMe,
        photoCount: safePhotos.length,
        isIncognito: user.incognitoMode === true,
        hideAge: user.hideAge === true,
        hideDistance: user.hideDistance === true,
        showLastSeen: user.showLastSeen !== false,
      }));
    }

    // Sort by activity score (recently active first)
    candidates.sort((a, b) => {
      // Boosted profiles first
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;
      // Then by recency
      const aLastActive = typeof a.lastActive === 'number' ? a.lastActive : 0;
      const bLastActive = typeof b.lastActive === 'number' ? b.lastActive : 0;
      return bLastActive - aLastActive;
    });

    const totalCount = candidates.length;
    const hasMore = offset + limit < totalCount;
    const status: ExploreCategoryStatus = totalCount > 0 ? 'ok' : 'empty_category';

    return {
      status,
      profiles: candidates.slice(offset, offset + limit),
      totalCount,
      hasMore,
      partialBatchExhausted: status === 'ok' && !hasMore && sourceHitFetchLimit,
    };
  },
});

// ---------------------------------------------------------------------------
// DISCOVER-CATEGORY-FIX: Shown tracking mutations
// Track when profiles are displayed to enable 7-day cooldown
// ---------------------------------------------------------------------------

/**
 * Mark a single profile as shown in Discover
 * Called when a profile card is rendered/viewed
 */
export const markProfileAsShown = mutation({
  args: {
    userId: v.id('users'), // The profile that was shown
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    await ctx.db.patch(args.userId, {
      lastShownInDiscoverAt: Date.now(),
    });
  },
});

/**
 * Batch mark multiple profiles as shown (for efficiency)
 * Called when a batch of profiles is loaded in Discover
 * P2-011 FIX: Dedupe userIds to prevent redundant writes and potential race conditions
 */
export const batchMarkProfilesAsShown = mutation({
  args: {
    userIds: v.array(v.id('users')),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // P2-011 FIX: Deduplicate userIds to prevent double-patching the same user
    // This handles edge cases where the same profile appears multiple times in the batch
    const uniqueUserIds = [...new Set(args.userIds)];

    // Skip if no valid userIds
    if (uniqueUserIds.length === 0) {
      return { updated: 0 };
    }

    await Promise.all(
      uniqueUserIds.map(userId =>
        ctx.db.patch(userId, { lastShownInDiscoverAt: now })
      )
    );

    return { updated: uniqueUserIds.length };
  },
});

/**
 * Assign a category to a user (or refresh if needed)
 * Called during onboarding completion or when category refresh is needed
 */
export const assignUserCategory = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    // Import category assignment logic
    const { findBestCategory, needsCategoryRefresh } = await import('./discoverCategories');

    // Check if refresh is needed
    if (!needsCategoryRefresh(
      user.discoverCategoryAssignedAt,
      user.lastShownInDiscoverAt
    )) {
      // Return existing assignment
      return user.assignedDiscoverCategory;
    }

    // Calculate best category
    const bestCategory = findBestCategory({
      relationshipIntent: user.relationshipIntent ?? [],
      activities: user.activities ?? [],
      lastActive: user.lastActive ?? Date.now(),
      lastShownInDiscoverAt: user.lastShownInDiscoverAt,
    });

    // Update user with new assignment
    await ctx.db.patch(userId, {
      assignedDiscoverCategory: bestCategory,
      discoverCategoryAssignedAt: Date.now(),
    });

    return bestCategory;
  },
});

/**
 * Get category counts for Explore grid badges
 * Uses the single-category assignment system
 * FIXED: Now uses shared isUserEligibleForViewer for consistency with getExploreCategoryProfiles
 */
export const getExploreCategoryCounts = query({
  args: {
    refreshKey: v.optional(v.number()), // Client-only cache busting / refetch trigger
  },
  handler: async (ctx) => {
    const viewerId = await requireAuthenticatedUserId(ctx);
    const emptyCounts = createEmptyExploreCounts();
    const viewer = await ctx.db.get(viewerId);
    if (!viewer) {
      return {
        status: 'viewer_missing' as ExploreCategoryCountsStatus,
        counts: emptyCounts,
      };
    }

    if (isUserPaused(viewer)) {
      return {
        status: 'discovery_paused' as ExploreCategoryCountsStatus,
        counts: emptyCounts,
      };
    }

    const cooldownThreshold = Date.now() - SHOWN_COOLDOWN_MS;
    const exclusions = await buildExclusionSets(ctx, viewerId);

    const counts = createEmptyExploreCounts();

    for (const categoryId of LIVE_EXPLORE_CATEGORY_IDS) {
      const { candidates, unavailableReason } = await getEligibleExploreCategoryUsers(
        ctx,
        viewer,
        viewerId,
        categoryId,
        EXPLORE_CATEGORY_MAX_FETCH,
        exclusions,
        cooldownThreshold,
      );

      counts[categoryId] = unavailableReason ? 0 : candidates.length;
    }

    return {
      status: 'ok' as ExploreCategoryCountsStatus,
      counts,
    };
  },
});
