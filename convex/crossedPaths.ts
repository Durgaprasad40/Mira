import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { Doc, Id } from './_generated/dataModel';
import { requireAuthenticatedSessionUser } from './helpers';
import { computePresenceStatus } from './presence';

// ---------------------------------------------------------------------------
// STABILITY FIX S1/S2/S3: Pre-fetch helpers to avoid full table scans
// ---------------------------------------------------------------------------

/**
 * Pre-fetch all blocks for a user (both directions) in a single pass.
 * Returns a Set for O(1) lookup.
 * STABILITY FIX S6/C2: Eliminates N+1 block queries inside loops.
 */
async function prefetchBlockedUserIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>
): Promise<Set<string>> {
  const [blocksOut, blocksIn] = await Promise.all([
    ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q: any) => q.eq('blockerId', userId))
      .collect(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q: any) => q.eq('blockedUserId', userId))
      .collect(),
  ]);

  return new Set([
    ...blocksOut.map((b: Doc<'blocks'>) => b.blockedUserId as string),
    ...blocksIn.map((b: Doc<'blocks'>) => b.blockerId as string),
  ]);
}

/**
 * Pre-fetch photo counts for all users in a single pass.
 * Returns a Map for O(1) lookup.
 * STABILITY FIX: Avoids fetching all photos; uses index-based query.
 */
async function prefetchPhotoCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  // Batch fetch photos for specific users using the by_user index
  const photoPromises = userIds.map((uid) =>
    ctx.db
      .query('photos')
      .withIndex('by_user', (q: any) => q.eq('userId', uid))
      .collect()
  );

  const photoResults = await Promise.all(photoPromises);

  userIds.forEach((uid, i) => {
    counts.set(uid, photoResults[i].length);
  });

  return counts;
}

function shouldIncludeReducedReachCandidate(viewerId: string, candidateId: string): boolean {
  const pairId = `${viewerId}:${candidateId}`;
  let hash = 0;
  for (let i = 0; i < pairId.length; i++) {
    hash = (hash + pairId.charCodeAt(i)) % 100;
  }
  return hash < 50;
}

function getSafeNearbyDisplayPhotos<
  T extends { url?: string | null; isNsfw?: boolean; order?: number; photoType?: string | null }
>(photos: T[]): T[] {
  return photos
    .filter(
      (photo) =>
        photo.photoType !== 'verification_reference' &&
        !photo.isNsfw &&
        typeof photo.url === 'string' &&
        photo.url.trim().length > 0
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function prefetchPhotoSummaries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userIds: string[]
): Promise<Map<string, { count: number; safeDisplayUrl: string | null }>> {
  const summaries = new Map<string, { count: number; safeDisplayUrl: string | null }>();
  const photoPromises = userIds.map((uid) =>
    ctx.db
      .query('photos')
      .withIndex('by_user', (q: any) => q.eq('userId', uid))
      .collect()
  );

  const photoResults = await Promise.all(photoPromises);

  userIds.forEach((uid, i) => {
    const photos = photoResults[i];
    const safePhotos = getSafeNearbyDisplayPhotos(photos);
    summaries.set(uid, {
      count: photos.length,
      safeDisplayUrl: safePhotos[0]?.url ?? null,
    });
  });

  return summaries;
}

/**
 * Pre-fetch swipes from a user in a single query.
 * Returns a Map for O(1) lookup.
 */
async function prefetchSwipes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>
): Promise<Map<string, { action: string; createdAt: number }>> {
  const swipes = await ctx.db
    .query('likes')
    .withIndex('by_from_user', (q: any) => q.eq('fromUserId', userId))
    .collect();

  const map = new Map<string, { action: string; createdAt: number }>();
  for (const swipe of swipes) {
    map.set(swipe.toUserId as string, {
      action: swipe.action,
      createdAt: swipe.createdAt,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Nearby map: 100m - 1km range (users closer than 100m are hidden for privacy)
const NEARBY_MIN_METERS = 100;  // Minimum distance to show on map
const NEARBY_MAX_METERS = 1000; // Maximum distance for nearby map

// Crossed paths: 100m - 750m range
const CROSSED_MIN_METERS = 100;  // Minimum distance to trigger crossing
const CROSSED_MAX_METERS = 750;  // Maximum distance for crossed paths

// Location update gate
const LOCATION_UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds

// Published location window (how often user can refresh their published location)
const PUBLISH_WINDOW_MS = 30 * 1000; // 30 seconds
const PUBLISH_MOVEMENT_OVERRIDE_METERS = 100; // allow refresh within window after meaningful movement

// Marker visibility tiers (for map)
const SOLID_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 1–3 days → solid marker
const FADED_WINDOW_MS = 6 * 24 * 60 * 60 * 1000; // 3–6 days → faded marker
// >6 days → hidden

// Map visibility freshness window (users visible if published within this window)
const MAP_VISIBILITY_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

// Crossed paths history
const HISTORY_EXPIRY_MS = 28 * 24 * 60 * 60 * 1000; // 4 weeks (28 days)
const MAX_HISTORY_ENTRIES = 15; // Max crossed paths list entries

// Grid size for approximate crossing location (privacy: round to ~300m)
const LOCATION_GRID_METERS = 300;

// SEC-1 FIX: Privacy fuzzing constants for Nearby map coordinates
// Prevents exact location reconstruction from API responses
const FUZZ_MIN_METERS = 50;
const FUZZ_MAX_METERS = 150;
const STRONG_PRIVACY_FUZZ_MIN = 200;
const STRONG_PRIVACY_FUZZ_MAX = 400;

// ---------------------------------------------------------------------------
// Shared Places Constants (Phase-1)
// ---------------------------------------------------------------------------

// Coarse grid for shared places (~1km clusters to prevent exact location exposure)
const SHARED_PLACES_GRID_METERS = 1000;

// Time window for shared places detection (14 days)
const SHARED_PLACES_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Minimum visits from each user to count as "shared place" (prevents noise)
const SHARED_PLACES_MIN_VISITS = 2;

// Maximum shared places to return (keep it minimal)
const SHARED_PLACES_MAX_RESULTS = 3;

// Delayed crossing: same area within 10 minutes counts as crossing
const DELAYED_CROSSING_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Notification rate limiting
const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour minimum between notifications per pair
const MAX_NOTIFICATIONS_PER_DAY = 3; // Maximum notifications per day per user

// ---------------------------------------------------------------------------
// GPS Jitter Protection Constants (server-side)
// ---------------------------------------------------------------------------

/** Maximum acceptable accuracy in meters for crossed-path detection */
const MAX_ACCURACY_FOR_CROSSING_METERS = 80;

/** Minimum movement in meters to trigger crossed-path detection */
const MIN_MOVEMENT_FOR_CROSSING_METERS = 30;

/** Maximum realistic speed in meters per second for sanity check (~200 km/h) */
const MAX_SPEED_MPS = 55;

// ---------------------------------------------------------------------------
// "Someone crossed you" alert constants
// ---------------------------------------------------------------------------

const CROSS_COOLDOWN_MS = 60 * 60 * 1000;   // 1 hour between alerts (for faster feedback)
const CROSS_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h per person (prevents same-person spam)
const CROSS_EVENT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (cleanup)

// ---------------------------------------------------------------------------
// DEV-ONLY NEARBY TEST MODE
// ---------------------------------------------------------------------------
// SAFE, TEMPORARY testing mode for real-device Nearby testing.
// - ONLY active when ENABLE_NEARBY_DEV_TEST_MODE is true
// - Production behavior is UNCHANGED when disabled
// - Allows two phones in same room to see each other during testing
// - Adds diagnostic logging to identify visibility failures
//
// TO ENABLE: Set ENABLE_NEARBY_DEV_TEST_MODE = true below
// TO DISABLE: Set ENABLE_NEARBY_DEV_TEST_MODE = false (default)
//
// SAFETY: This flag ONLY affects Convex server-side logic.
// The flag is checked at runtime; production builds should set this to false.
// ---------------------------------------------------------------------------

/**
 * DEV TEST MODE FLAG
 * Set to true to enable relaxed Nearby testing mode.
 * MUST be false for production deployments.
 */
const ENABLE_NEARBY_DEV_TEST_MODE = false; // <-- SET TO false FOR PRODUCTION

/**
 * DEV test mode configuration overrides.
 * These values ONLY apply when ENABLE_NEARBY_DEV_TEST_MODE is true.
 */
const DEV_TEST_CONFIG = {
  // Visibility: 60 minutes instead of 10 minutes
  MAP_VISIBILITY_WINDOW_MS: 60 * 60 * 1000, // 60 minutes

  // Publish throttle: 15 seconds for faster real-device testing
  PUBLISH_WINDOW_MS: 15 * 1000, // 15 seconds

  // Distance: Allow 0m minimum (same room testing)
  NEARBY_MIN_METERS: 0,
  NEARBY_MAX_METERS: 5000, // 5km for wider testing

  // Crossed paths: Allow 0m minimum
  CROSSED_MIN_METERS: 0,
  CROSSED_MAX_METERS: 2000, // 2km for testing

  // Location update gate: 15 seconds for faster real-device testing
  LOCATION_UPDATE_INTERVAL_MS: 15 * 1000, // 15 seconds

  // Profile requirements relaxation
  SKIP_VERIFICATION_CHECK: true,
  SKIP_PHOTO_COUNT_CHECK: true,
  SKIP_PRIMARY_PHOTO_CHECK: true,
  MIN_PHOTO_COUNT: 0, // Allow 0 photos in dev mode
};

/**
 * Get effective Nearby configuration.
 * Returns production values unless DEV test mode is enabled.
 */
function getEffectiveNearbyConfig() {
  if (ENABLE_NEARBY_DEV_TEST_MODE) {
    return {
      MAP_VISIBILITY_WINDOW_MS: DEV_TEST_CONFIG.MAP_VISIBILITY_WINDOW_MS,
      PUBLISH_WINDOW_MS: DEV_TEST_CONFIG.PUBLISH_WINDOW_MS,
      NEARBY_MIN_METERS: DEV_TEST_CONFIG.NEARBY_MIN_METERS,
      NEARBY_MAX_METERS: DEV_TEST_CONFIG.NEARBY_MAX_METERS,
      CROSSED_MIN_METERS: DEV_TEST_CONFIG.CROSSED_MIN_METERS,
      CROSSED_MAX_METERS: DEV_TEST_CONFIG.CROSSED_MAX_METERS,
      LOCATION_UPDATE_INTERVAL_MS: DEV_TEST_CONFIG.LOCATION_UPDATE_INTERVAL_MS,
      SKIP_VERIFICATION_CHECK: DEV_TEST_CONFIG.SKIP_VERIFICATION_CHECK,
      SKIP_PHOTO_COUNT_CHECK: DEV_TEST_CONFIG.SKIP_PHOTO_COUNT_CHECK,
      SKIP_PRIMARY_PHOTO_CHECK: DEV_TEST_CONFIG.SKIP_PRIMARY_PHOTO_CHECK,
      MIN_PHOTO_COUNT: DEV_TEST_CONFIG.MIN_PHOTO_COUNT,
      IS_DEV_MODE: true,
    };
  }

  // Production defaults (unchanged)
  return {
    MAP_VISIBILITY_WINDOW_MS,
    PUBLISH_WINDOW_MS,
    NEARBY_MIN_METERS: NEARBY_MIN_METERS,
    NEARBY_MAX_METERS: NEARBY_MAX_METERS,
    CROSSED_MIN_METERS: CROSSED_MIN_METERS,
    CROSSED_MAX_METERS: CROSSED_MAX_METERS,
    LOCATION_UPDATE_INTERVAL_MS,
    SKIP_VERIFICATION_CHECK: false,
    SKIP_PHOTO_COUNT_CHECK: false,
    SKIP_PRIMARY_PHOTO_CHECK: false,
    MIN_PHOTO_COUNT: 2,
    IS_DEV_MODE: false,
  };
}

type NearbyEligibilityStatus = 'ok' | 'viewer_unverified' | 'location_required';

type NearbyEligibleCandidate = {
  user: Doc<'users'>;
  distance: number;
  locationAgeMs: number;
  photoSummary: {
    count: number;
    safeDisplayUrl: string | null;
  };
};

function hasNearbyCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return typeof lat === 'number' && typeof lng === 'number';
}

async function prefetchPresenceRecords(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userIds: Id<'users'>[],
): Promise<Map<string, { lastSeenAt: number; appState: 'foreground' | 'background' | 'inactive' } | null>> {
  const records = await Promise.all(
    userIds.map((userId) =>
      ctx.db
        .query('presence')
        .withIndex('by_user', (q: any) => q.eq('userId', userId))
        .first()
    )
  );

  const presenceMap = new Map<string, { lastSeenAt: number; appState: 'foreground' | 'background' | 'inactive' } | null>();
  userIds.forEach((userId, index) => {
    const record = records[index];
    presenceMap.set(
      userId as string,
      record
        ? {
            lastSeenAt: record.lastSeenAt,
            appState: record.appState,
          }
        : null
    );
  });

  return presenceMap;
}

function passesNearbyVisibilityMode(
  user: Doc<'users'>,
  now: number,
  presenceRecord: { lastSeenAt: number; appState: 'foreground' | 'background' | 'inactive' } | null,
): boolean {
  if (user.nearbyVisibilityMode === 'always' || !user.nearbyVisibilityMode) {
    return true;
  }

  const fallbackLastSeenAt = typeof user.lastActive === 'number' ? user.lastActive : 0;
  const lastSeenAt = presenceRecord?.lastSeenAt ?? fallbackLastSeenAt;
  const appState = presenceRecord?.appState ?? 'inactive';

  if (!lastSeenAt) {
    return false;
  }

  if (user.nearbyVisibilityMode === 'app_open') {
    return computePresenceStatus(lastSeenAt, appState, now).status === 'online';
  }

  if (user.nearbyVisibilityMode === 'recent') {
    const recentThreshold = 30 * 60 * 1000;
    return now - lastSeenAt <= recentThreshold;
  }

  return true;
}

export async function getEligibleNearbyCandidatesForViewer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  currentUser: Doc<'users'>,
): Promise<{
  status: NearbyEligibilityStatus;
  candidates: NearbyEligibleCandidate[];
  now: number;
}> {
  const now = Date.now();

  const config = getEffectiveNearbyConfig();

  devLog('getNearbyUsers: STARTING QUERY', {
    isDevMode: config.IS_DEV_MODE,
    effectiveVisibilityWindowMs: config.MAP_VISIBILITY_WINDOW_MS,
    effectiveMinMeters: config.NEARBY_MIN_METERS,
    effectiveMaxMeters: config.NEARBY_MAX_METERS,
    skipVerificationCheck: config.SKIP_VERIFICATION_CHECK,
    skipPhotoCountCheck: config.SKIP_PHOTO_COUNT_CHECK,
  });

  const userId = currentUser._id;

  devLog('getNearbyUsers: currentUser', {
    userId,
    name: currentUser.name,
    verificationStatus: currentUser.verificationStatus,
    publishedAt: currentUser.publishedAt ? new Date(currentUser.publishedAt).toISOString() : null,
  });

  if (!config.SKIP_VERIFICATION_CHECK && currentUser.verificationStatus !== 'verified') {
    devLog('getNearbyUsers: BLOCKED - currentUser not verified', {
      verificationStatus: currentUser.verificationStatus,
    });
    return {
      status: 'viewer_unverified',
      candidates: [],
      now,
    };
  }

  const myLat = hasNearbyCoordinatePair(currentUser.publishedLat, currentUser.publishedLng)
    ? currentUser.publishedLat
    : currentUser.latitude;
  const myLng = hasNearbyCoordinatePair(currentUser.publishedLat, currentUser.publishedLng)
    ? currentUser.publishedLng
    : currentUser.longitude;

  if (!hasNearbyCoordinatePair(myLat, myLng)) {
    devLog('getNearbyUsers: BLOCKED - currentUser has no location', {
      publishedLat: currentUser.publishedLat,
      publishedLng: currentUser.publishedLng,
      latitude: currentUser.latitude,
      longitude: currentUser.longitude,
    });
    return {
      status: 'location_required',
      candidates: [],
      now,
    };
  }

  const viewerLat = myLat as number;
  const viewerLng = myLng as number;

  const myAge = calculateAge(currentUser.dateOfBirth);

  let allUsers;
  if (config.SKIP_VERIFICATION_CHECK) {
    allUsers = await ctx.db
      .query('users')
      .filter((q: any) => q.eq(q.field('isActive'), true))
      .collect();
    devLog('getNearbyUsers: DEV MODE - querying ALL active users', { count: allUsers.length });
  } else {
    allUsers = await ctx.db
      .query('users')
      .withIndex('by_verification_status', (q: any) => q.eq('verificationStatus', 'verified'))
      .collect();
  }

  const [blockedIds, swipedUsersMap] = await Promise.all([
    prefetchBlockedUserIds(ctx, userId),
    prefetchSwipes(ctx, userId),
  ]);

  const preVisibilityCandidates: Array<{
    user: Doc<'users'>;
    distance: number;
    locationAgeMs: number;
  }> = [];

  const filterStats = {
    total: 0,
    passed: 0,
    filtered_self: 0,
    filtered_inactive: 0,
    filtered_banned: 0,
    filtered_incognito: 0,
    filtered_nearbyDisabled: 0,
    filtered_paused: 0,
    filtered_visibilityMode: 0,
    filtered_incompleteProfile: 0,
    filtered_verificationEnforcement: 0,
    filtered_noPublishedLocation: 0,
    filtered_staleLocation: 0,
    filtered_tooClose: 0,
    filtered_tooFar: 0,
    filtered_ageMismatch: 0,
    filtered_genderMismatch: 0,
    filtered_blocked: 0,
    filtered_swiped: 0,
    filtered_noSafePhoto: 0,
  };

  for (const user of allUsers) {
    filterStats.total++;

    if (user._id === userId) {
      filterStats.filtered_self++;
      continue;
    }

    if (!user.isActive) {
      filterStats.filtered_inactive++;
      devLog('FILTERED: inactive', { userId: user._id, name: user.name });
      continue;
    }

    if (user.isBanned) {
      filterStats.filtered_banned++;
      devLog('FILTERED: banned', { userId: user._id, name: user.name });
      continue;
    }

    if (user.verificationEnforcementLevel === 'security_only') {
      filterStats.filtered_verificationEnforcement++;
      devLog('FILTERED: security_only', { userId: user._id, name: user.name });
      continue;
    }

    if (
      user.verificationEnforcementLevel === 'reduced_reach' &&
      !shouldIncludeReducedReachCandidate(String(userId), String(user._id))
    ) {
      filterStats.filtered_verificationEnforcement++;
      devLog('FILTERED: reduced_reach', { userId: user._id, name: user.name });
      continue;
    }

    if (user.incognitoMode === true) {
      filterStats.filtered_incognito++;
      devLog('FILTERED: incognito', { userId: user._id, name: user.name });
      continue;
    }

    if (user.nearbyEnabled === false) {
      filterStats.filtered_nearbyDisabled++;
      devLog('FILTERED: nearbyDisabled', { userId: user._id, name: user.name });
      continue;
    }

    if (user.nearbyPausedUntil && user.nearbyPausedUntil > now) {
      filterStats.filtered_paused++;
      devLog('FILTERED: paused', {
        userId: user._id,
        name: user.name,
        pausedUntil: new Date(user.nearbyPausedUntil).toISOString(),
      });
      continue;
    }

    if (!user.name || !user.bio || !user.dateOfBirth) {
      filterStats.filtered_incompleteProfile++;
      devLog('FILTERED: incompleteProfile', {
        userId: user._id,
        name: user.name,
        hasBio: !!user.bio,
        hasDateOfBirth: !!user.dateOfBirth,
      });
      continue;
    }

    if (
      !hasNearbyCoordinatePair(user.publishedLat, user.publishedLng) ||
      typeof user.publishedAt !== 'number'
    ) {
      filterStats.filtered_noPublishedLocation++;
      devLog('FILTERED: noPublishedLocation', {
        userId: user._id,
        name: user.name,
        publishedLat: user.publishedLat,
        publishedLng: user.publishedLng,
        publishedAt: user.publishedAt,
      });
      continue;
    }

    const locationAgeMs = now - user.publishedAt;
    if (locationAgeMs > config.MAP_VISIBILITY_WINDOW_MS) {
      filterStats.filtered_staleLocation++;
      devLog('FILTERED: staleLocation', {
        userId: user._id,
        name: user.name,
        publishedAt: new Date(user.publishedAt).toISOString(),
        locationAgeMinutes: Math.round(locationAgeMs / 60000),
        windowMinutes: Math.round(config.MAP_VISIBILITY_WINDOW_MS / 60000),
      });
      continue;
    }

    const distance = calculateDistanceMeters(
      viewerLat,
      viewerLng,
      user.publishedLat as number,
      user.publishedLng as number,
    );

    if (distance < config.NEARBY_MIN_METERS) {
      filterStats.filtered_tooClose++;
      devLog('FILTERED: tooClose', {
        userId: user._id,
        name: user.name,
        distanceMeters: Math.round(distance),
        minMeters: config.NEARBY_MIN_METERS,
      });
      continue;
    }

    if (distance > config.NEARBY_MAX_METERS) {
      filterStats.filtered_tooFar++;
      devLog('FILTERED: tooFar', {
        userId: user._id,
        name: user.name,
        distanceMeters: Math.round(distance),
        maxMeters: config.NEARBY_MAX_METERS,
      });
      continue;
    }

    const otherAge = calculateAge(user.dateOfBirth);
    if (myAge < user.minAge || myAge > user.maxAge) {
      filterStats.filtered_ageMismatch++;
      devLog('FILTERED: ageMismatch (viewer not in target range)', {
        userId: user._id,
        name: user.name,
        myAge,
        targetMinAge: user.minAge,
        targetMaxAge: user.maxAge,
      });
      continue;
    }
    if (otherAge < currentUser.minAge || otherAge > currentUser.maxAge) {
      filterStats.filtered_ageMismatch++;
      devLog('FILTERED: ageMismatch (target not in viewer range)', {
        userId: user._id,
        name: user.name,
        otherAge,
        viewerMinAge: currentUser.minAge,
        viewerMaxAge: currentUser.maxAge,
      });
      continue;
    }

    if (!currentUser.lookingFor.includes(user.gender)) {
      filterStats.filtered_genderMismatch++;
      devLog('FILTERED: genderMismatch (viewer not looking for target gender)', {
        userId: user._id,
        name: user.name,
        targetGender: user.gender,
        viewerLookingFor: currentUser.lookingFor,
      });
      continue;
    }
    if (!user.lookingFor.includes(currentUser.gender)) {
      filterStats.filtered_genderMismatch++;
      devLog('FILTERED: genderMismatch (target not looking for viewer gender)', {
        userId: user._id,
        name: user.name,
        viewerGender: currentUser.gender,
        targetLookingFor: user.lookingFor,
      });
      continue;
    }

    if (blockedIds.has(user._id as string)) {
      filterStats.filtered_blocked++;
      devLog('FILTERED: blocked', { userId: user._id, name: user.name });
      continue;
    }

    const existingSwipe = swipedUsersMap.get(user._id as string);
    if (existingSwipe) {
      if (existingSwipe.action !== 'pass') {
        filterStats.filtered_swiped++;
        devLog('FILTERED: swiped (liked/super_liked)', {
          userId: user._id,
          name: user.name,
          action: existingSwipe.action,
        });
        continue;
      }
      if (existingSwipe.createdAt > now - 7 * 24 * 60 * 60 * 1000) {
        filterStats.filtered_swiped++;
        devLog('FILTERED: swiped (recent pass)', {
          userId: user._id,
          name: user.name,
          passedAt: new Date(existingSwipe.createdAt).toISOString(),
        });
        continue;
      }
    }

    preVisibilityCandidates.push({
      user,
      distance,
      locationAgeMs,
    });
  }

  const presenceCheckUserIds = preVisibilityCandidates
    .filter(({ user }) => user.nearbyVisibilityMode && user.nearbyVisibilityMode !== 'always')
    .map(({ user }) => user._id);

  const presenceByUserId = presenceCheckUserIds.length > 0
    ? await prefetchPresenceRecords(ctx, presenceCheckUserIds)
    : new Map<
        string,
        { lastSeenAt: number; appState: 'foreground' | 'background' | 'inactive' } | null
      >();

  const candidateUsers: Array<{
    user: Doc<'users'>;
    distance: number;
    locationAgeMs: number;
  }> = [];

  for (const candidate of preVisibilityCandidates) {
    if (
      !passesNearbyVisibilityMode(
        candidate.user,
        now,
        presenceByUserId.get(candidate.user._id as string) ?? null,
      )
    ) {
      filterStats.filtered_visibilityMode++;
      devLog('FILTERED: visibilityMode', {
        userId: candidate.user._id,
        name: candidate.user.name,
        visibilityMode: candidate.user.nearbyVisibilityMode,
      });
      continue;
    }

    filterStats.passed++;
    devLog('PASSED: User passed all filters', {
      userId: candidate.user._id,
      name: candidate.user.name,
      distanceMeters: Math.round(candidate.distance),
      locationAgeMinutes: Math.round(candidate.locationAgeMs / 60000),
    });

    candidateUsers.push(candidate);
  }

  devLog('getNearbyUsers: FILTER SUMMARY', filterStats);

  const photoSummariesMap = await prefetchPhotoSummaries(
    ctx,
    candidateUsers.map(({ user }) => user._id as string)
  );

  const results: NearbyEligibleCandidate[] = [];
  for (const candidate of candidateUsers) {
    const photoSummary = photoSummariesMap.get(candidate.user._id as string);
    const photoCount = photoSummary?.count ?? 0;

    if (!config.SKIP_PHOTO_COUNT_CHECK && photoCount < config.MIN_PHOTO_COUNT) {
      devLog('FILTERED (2nd pass): photoCount too low', {
        userId: candidate.user._id,
        name: candidate.user.name,
        photoCount,
        requiredMin: config.MIN_PHOTO_COUNT,
      });
      continue;
    }

    if (!config.SKIP_PRIMARY_PHOTO_CHECK && !photoSummary?.safeDisplayUrl) {
      filterStats.filtered_noSafePhoto++;
      devLog('FILTERED (2nd pass): no safe display photo', {
        userId: candidate.user._id,
        name: candidate.user.name,
      });
      continue;
    }

    results.push({
      ...candidate,
      photoSummary: photoSummary ?? {
        count: photoCount,
        safeDisplayUrl: null,
      },
    });
  }

  return {
    status: 'ok',
    candidates: results,
    now,
  };
}

/**
 * DEV-ONLY: Log why a user was filtered out.
 * Only logs when DEV test mode is enabled.
 */
function devLog(message: string, data?: Record<string, unknown>) {
  if (ENABLE_NEARBY_DEV_TEST_MODE) {
    console.log(`[NEARBY-DEV] ${message}`, data ? JSON.stringify(data) : '');
  }
}

// ---------------------------------------------------------------------------
// Deterministic dedupeKey generation for crossed paths
// Uses sorted user IDs to ensure A-B == B-A (symmetric)
// Includes 1-hour time bucket to allow new crossings in future hours
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic dedupeKey for crossed paths notifications.
 * Uses sorted user IDs to ensure symmetric detection (A crossing B == B crossing A).
 * Includes 1-hour time bucket to:
 * - Prevent duplicate notifications within the same hour
 * - Allow new notifications in future hours for repeat crossings
 *
 * Format: `crossed_paths:${minUserId}:${maxUserId}:${hourBucket}`
 */
function makeCrossedPathsDedupeKey(userA: Id<'users'>, userB: Id<'users'>, now: number): string {
  const sorted = [userA as string, userB as string].sort();
  // 1-hour time bucket (milliseconds -> hours)
  const bucket = Math.floor(now / (60 * 60 * 1000));
  return `crossed_paths:${sorted[0]}:${sorted[1]}:${bucket}`;
}

// ---------------------------------------------------------------------------
// publishLocation — updates published location (short throttle for Nearby freshness)
// Called when Nearby screen is opened. Others see publishedLat/Lng, not live GPS.
// P1 AUTH HARDENING: Uses validated session token for current-user resolution
// ---------------------------------------------------------------------------

export const publishLocation = mutation({
  args: {
    token: v.string(),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const { token, latitude, longitude } = args;
    const now = Date.now();

    // Get effective config (DEV vs production)
    const config = getEffectiveNearbyConfig();

    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    // Check if published location is still within the publish window
    // DEV MODE: Uses shorter window than production for faster testing
    const effectivePublishWindow = config.PUBLISH_WINDOW_MS;
    if (user.publishedAt && now - user.publishedAt < effectivePublishWindow) {
      const hasPublishedCoords =
        user.publishedLat !== undefined &&
        user.publishedLng !== undefined;
      const distanceSincePublish = hasPublishedCoords
        ? calculateDistanceMeters(user.publishedLat!, user.publishedLng!, latitude, longitude)
        : Number.POSITIVE_INFINITY;

      if (!hasPublishedCoords || distanceSincePublish < PUBLISH_MOVEMENT_OVERRIDE_METERS) {
      const timeRemaining = Math.round((user.publishedAt + effectivePublishWindow - now) / 1000);
        devLog('publishLocation: within_window (throttled)', {
          userId: userId,
          userName: user.name,
          publishedAt: new Date(user.publishedAt).toISOString(),
          windowMs: effectivePublishWindow,
          timeRemainingSeconds: timeRemaining,
          distanceSincePublishMeters: hasPublishedCoords ? Math.round(distanceSincePublish) : null,
          isDevMode: config.IS_DEV_MODE,
        });
        return {
          success: true,
          published: false,
          reason: 'within_window',
          nextPublishAt: user.publishedAt + effectivePublishWindow,
        };
      }

      devLog('publishLocation: movement override within window', {
        userId: userId,
        userName: user.name,
        distanceSincePublishMeters: Math.round(distanceSincePublish),
        overrideThresholdMeters: PUBLISH_MOVEMENT_OVERRIDE_METERS,
        windowMs: effectivePublishWindow,
      });
    }

    // Publish new location
    await ctx.db.patch(userId, {
      publishedLat: latitude,
      publishedLng: longitude,
      publishedAt: now,
    });

    devLog('publishLocation: SUCCESS - location published', {
      userId: userId,
      userName: user.name,
      lat: latitude.toFixed(4),
      lng: longitude.toFixed(4),
      publishedAt: new Date(now).toISOString(),
      effectiveWindowMs: effectivePublishWindow,
      isDevMode: config.IS_DEV_MODE,
    });

    return {
      success: true,
      published: true,
      publishedAt: now,
    };
  },
});

// ---------------------------------------------------------------------------
// detectCrossedUsers — privacy-safe "Someone crossed you" alert
// Uses PUBLISHED locations only (not live GPS).
// Returns { triggered: true } if alert should be shown, never reveals identity.
// STABILITY FIX S2: Uses indexed query instead of full table scan
// STABILITY FIX S6: Pre-fetches blocks before loop
// P1 AUTH HARDENING: Uses validated session token for current-user resolution
// ---------------------------------------------------------------------------

export const detectCrossedUsers = mutation({
  args: {
    token: v.string(),
    myLat: v.number(),
    myLng: v.number(),
  },
  handler: async (ctx, args) => {
    const { token, myLat, myLng } = args;
    const now = Date.now();

    const currentUser = await requireAuthenticatedSessionUser(ctx, token);
    const userId = currentUser._id;

    // 2) Enforce cooldown — check most recent crossedEvent for this user
    const lastEvent = await ctx.db
      .query('crossedEvents')
      .withIndex('by_user_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .first();

    if (lastEvent && now - lastEvent.createdAt < CROSS_COOLDOWN_MS) {
      return { triggered: false, reason: 'cooldown' };
    }

    // STABILITY FIX S2: Use indexed query for verified users only
    // Crossed paths detection only applies to verified users
    const verifiedUsers = await ctx.db
      .query('users')
      .withIndex('by_verification_status', (q) => q.eq('verificationStatus', 'verified'))
      .collect();

    // STABILITY FIX S6: Pre-fetch blocks before loop
    const blockedIds = await prefetchBlockedUserIds(ctx, userId);

    const candidates: Id<'users'>[] = [];

    for (const user of verifiedUsers) {
      // Skip self
      if (user._id === userId) continue;
      // Skip inactive
      if (!user.isActive) continue;
      // Skip blocked (using pre-fetched set)
      if (blockedIds.has(user._id as string)) continue;
      // Skip if no published location
      if (!user.publishedLat || !user.publishedLng || !user.publishedAt) continue;
      // Skip if published location is stale (>6 days)
      if (now - user.publishedAt > FADED_WINDOW_MS) continue;

      // Compute distance using published location
      const distance = calculateDistanceMeters(
        myLat,
        myLng,
        user.publishedLat,
        user.publishedLng,
      );

      // Within crossed paths range (100m - 750m)?
      if (distance >= CROSSED_MIN_METERS && distance <= CROSSED_MAX_METERS) {
        candidates.push(user._id);
      }
    }

    // 4) Dedupe — filter out people we've already alerted about recently
    // Fetch current user's recent events once instead of querying per candidate
    const validCandidates: Id<'users'>[] = [];
    const recentEventUserIds = new Set(
      (
        await ctx.db
          .query('crossedEvents')
          .withIndex('by_user_createdAt', (q) => q.eq('userId', userId))
          .collect()
      )
        .filter((event) => now - event.createdAt < CROSS_DEDUPE_WINDOW_MS)
        .map((event) => event.otherUserId as string)
    );

    for (let i = 0; i < candidates.length; i++) {
      if (!recentEventUserIds.has(candidates[i] as string)) {
        validCandidates.push(candidates[i]);
      }
    }

    // 5) If any valid candidates, insert ONE event and return triggered
    if (validCandidates.length > 0) {
      // Pick the first candidate (doesn't matter which — we don't reveal identity)
      const pickedOther = validCandidates[0];

      await ctx.db.insert('crossedEvents', {
        userId,
        otherUserId: pickedOther,
        createdAt: now,
        expiresAt: now + CROSS_EVENT_EXPIRY_MS,
      });

      // Return triggered: true — client shows generic "Someone crossed you" toast
      // IMPORTANT: We do NOT return pickedOther or any identity info
      return { triggered: true };
    }

    // 6) No valid candidates
    return { triggered: false, reason: 'none' };
  },
});

// ---------------------------------------------------------------------------
// cleanupExpiredCrossedEvents — call periodically to purge old entries
// ---------------------------------------------------------------------------

export const cleanupExpiredCrossedEvents = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('crossedEvents')
      .withIndex('by_expires')
      .filter((q) => q.lt(q.field('expiresAt'), now))
      .collect();

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }

    return { deleted: expired.length };
  },
});

// ---------------------------------------------------------------------------
// recordLocation — called when user opens app / becomes active
// STABILITY FIX S3: Uses indexed query instead of full table scan
// STABILITY FIX S6/C2: Pre-fetches blocks before loop (eliminates N+1)
// P1 AUTH HARDENING: Uses validated session token for current-user resolution
// ---------------------------------------------------------------------------

export const recordLocation = mutation({
  args: {
    token: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.optional(v.number()), // GPS accuracy in meters (for jitter protection)
  },
  handler: async (ctx, args) => {
    const { token, latitude, longitude, accuracy } = args;
    const now = Date.now();

    const currentUser = await requireAuthenticatedSessionUser(ctx, token);
    const userId = currentUser._id;

    // ---------------------------------------------------------------------------
    // GPS JITTER PROTECTION (server-side)
    // ---------------------------------------------------------------------------

    // 1. Accuracy filter: reject low-accuracy points for crossed-path detection
    const accuracyTooLow = accuracy !== undefined && accuracy > MAX_ACCURACY_FOR_CROSSING_METERS;

    // 2. Speed sanity check: detect impossible jumps
    let impossibleSpeed = false;
    let movementTooSmall = false;

    if (currentUser.latitude && currentUser.longitude && currentUser.lastLocationUpdatedAt) {
      const distance = calculateDistanceMeters(
        currentUser.latitude,
        currentUser.longitude,
        latitude,
        longitude
      );
      const timeGapMs = now - currentUser.lastLocationUpdatedAt;

      // Check for impossible speed (teleportation)
      if (timeGapMs > 1000) { // At least 1 second gap
        const speedMps = distance / (timeGapMs / 1000);
        if (speedMps > MAX_SPEED_MPS) {
          impossibleSpeed = true;
        }
      }

      // Check for tiny movement (likely jitter, not real movement)
      if (distance < MIN_MOVEMENT_FOR_CROSSING_METERS) {
        movementTooSmall = true;
      }
    }

    // Determine if we should skip crossed-path detection due to GPS quality issues
    const skipCrossedPathsDueToGPS = accuracyTooLow || impossibleSpeed;

    // 30-minute gate: skip update if too recent
    if (
      currentUser.lastLocationUpdatedAt &&
      now - currentUser.lastLocationUpdatedAt < LOCATION_UPDATE_INTERVAL_MS
    ) {
      return { success: true, nearbyCount: 0, skipped: true };
    }

    // Save location + timestamp (always save valid coordinates for map display)
    // Even if GPS quality is low, we update location for the map; just skip crossed-path detection
    await ctx.db.patch(userId, {
      latitude,
      longitude,
      lastActive: now,
      lastLocationUpdatedAt: now,
    });

    // Skip crossed-path detection if GPS quality is poor
    if (skipCrossedPathsDueToGPS) {
      return {
        success: true,
        nearbyCount: 0,
        skipped: true,
        reason: accuracyTooLow ? 'accuracy_too_low' : 'impossible_speed',
      };
    }

    // Skip crossed-path detection if movement is too small (likely stationary jitter)
    // But only if we had a previous location to compare against
    if (movementTooSmall && currentUser.latitude && currentUser.longitude) {
      return {
        success: true,
        nearbyCount: 0,
        skipped: true,
        reason: 'movement_too_small',
      };
    }

    // Skip crossed-path computation if current user is not verified
    const currentStatus = currentUser.verificationStatus || 'unverified';
    if (currentStatus !== 'verified') {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'unverified' };
    }

    // Skip crossed-path computation if current user has disabled crossed paths
    if (currentUser.crossedPathsEnabled === false) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'crossed_paths_disabled' };
    }

    // Get current user's age for filtering
    const myAge = calculateAge(currentUser.dateOfBirth);

    // STABILITY FIX S3: Use indexed query for verified users only
    const verifiedUsers = await ctx.db
      .query('users')
      .withIndex('by_verification_status', (q) => q.eq('verificationStatus', 'verified'))
      .collect();

    // STABILITY FIX S6/C2: Pre-fetch blocks before loop
    const blockedIds = await prefetchBlockedUserIds(ctx, userId);

    // First pass: collect candidate user IDs that pass basic filters
    const candidateUserIds: string[] = [];
    type UserWithDistance = (typeof verifiedUsers)[0] & { distance: number };
    const candidateUsers: UserWithDistance[] = [];

    for (const user of verifiedUsers) {
      if (user._id === userId) continue;
      if (!user.isActive) continue;
      if (user.isBanned) continue;
      if (!user.latitude || !user.longitude) continue;
      if (user.verificationEnforcementLevel === 'security_only') continue;
      if (
        user.verificationEnforcementLevel === 'reduced_reach' &&
        !shouldIncludeReducedReachCandidate(String(userId), String(user._id))
      ) {
        continue;
      }

      // Incognito mode: Skip users who are hidden (but they can still BE detected for crossings)
      // Note: Incognito users can still trigger crossings, they just don't appear on map
      // This is intentional per spec: "Incognito: hidden from map, but crossed-path detection may still happen"

      // Nearby visibility opt-out: Skip users who opted out of nearby
      if (user.nearbyEnabled === false) continue;

      // Crossed paths opt-out: Skip users who disabled crossed paths
      if (user.crossedPathsEnabled === false) continue;

      // Basic info completeness
      if (!user.name || !user.bio || !user.dateOfBirth) continue;

      // Location freshness check
      const userLocationUpdatedAt = user.lastLocationUpdatedAt ?? user.lastActive;
      if (now - userLocationUpdatedAt > FADED_WINDOW_MS) continue;

      const distance = calculateDistanceMeters(
        latitude,
        longitude,
        user.latitude,
        user.longitude,
      );

      // Within crossed paths range (100m - 750m)?
      if (distance >= CROSSED_MIN_METERS && distance <= CROSSED_MAX_METERS) {
        candidateUserIds.push(user._id as string);
        candidateUsers.push({ ...user, distance });
      }
    }

    // STABILITY FIX: Fetch photo counts only for candidates (not all users)
    const photoSummariesMap = await prefetchPhotoSummaries(ctx, candidateUserIds);

    // Second pass: filter by photo count
    const nearbyUsers: UserWithDistance[] = [];
    for (const user of candidateUsers) {
      const photoSummary = photoSummariesMap.get(user._id as string);
      const photoCount = photoSummary?.count ?? 0;
      if (photoCount < 2) continue;
      if (!photoSummary?.safeDisplayUrl) continue;
      nearbyUsers.push(user);
    }

    const [existingCrossedPathsAsUser1, existingCrossedPathsAsUser2, existingHistoryAsUser1, existingHistoryAsUser2] = await Promise.all([
      ctx.db
        .query('crossedPaths')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .collect(),
      ctx.db
        .query('crossedPaths')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .collect(),
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .collect(),
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .collect(),
    ]);

    const crossedPathsByOtherUserId = new Map<string, Doc<'crossedPaths'>>();
    for (const crossedPath of [...existingCrossedPathsAsUser1, ...existingCrossedPathsAsUser2]) {
      const otherUserId =
        crossedPath.user1Id === userId ? crossedPath.user2Id : crossedPath.user1Id;
      crossedPathsByOtherUserId.set(otherUserId as string, crossedPath);
    }

    const recentHistoryByOtherUserId = new Map<string, number>();
    for (const historyEntry of [...existingHistoryAsUser1, ...existingHistoryAsUser2]) {
      const otherUserId =
        historyEntry.user1Id === userId ? historyEntry.user2Id : historyEntry.user1Id;
      const latestForPair = recentHistoryByOtherUserId.get(otherUserId as string) ?? 0;
      if (historyEntry.createdAt > latestForPair) {
        recentHistoryByOtherUserId.set(otherUserId as string, historyEntry.createdAt);
      }
    }

    let insertedHistoryEntry = false;

    // Record crossed paths + history
    for (const nearbyUser of nearbyUsers) {
      // Age filtering (both directions)
      const otherAge = calculateAge(nearbyUser.dateOfBirth);
      if (myAge < nearbyUser.minAge || myAge > nearbyUser.maxAge) continue;
      if (otherAge < currentUser.minAge || otherAge > currentUser.maxAge) continue;

      // Gender/orientation preference match (both directions)
      if (!currentUser.lookingFor.includes(nearbyUser.gender)) continue;
      if (!nearbyUser.lookingFor.includes(currentUser.gender)) continue;

      // STABILITY FIX S6/C2: Check if blocked using pre-fetched set (O(1) lookup)
      if (blockedIds.has(nearbyUser._id as string)) continue;

      // --- COMPATIBILITY GATE: At least ONE common element required ---
      const compatibility = computeCompatibility(
        {
          activities: currentUser.activities,
          relationshipIntent: currentUser.relationshipIntent,
          profilePrompts: currentUser.profilePrompts,
        },
        {
          activities: nearbyUser.activities,
          relationshipIntent: nearbyUser.relationshipIntent,
          profilePrompts: nearbyUser.profilePrompts,
        },
      );

      // Skip if no compatibility (no shared interests/intent/prompts)
      if (!compatibility.isCompatible) continue;

      // Order user IDs for consistent lookup
      const user1Id = userId < nearbyUser._id ? userId : nearbyUser._id;
      const user2Id = userId < nearbyUser._id ? nearbyUser._id : userId;

      // --- Crossed paths record (for unlock logic) ---
      // BUGFIX #28: Use idempotent upsert pattern to prevent duplicate records
      let crossedPath = crossedPathsByOtherUserId.get(nearbyUser._id as string) ?? null;

      if (crossedPath) {
        // 1-hour cooldown per pair (faster notification for better UX)
        if (now - crossedPath.lastCrossedAt < NOTIFICATION_COOLDOWN_MS) continue;

        const newCount = crossedPath.count + 1;
        const updates: Record<string, unknown> = {
          count: newCount,
          lastCrossedAt: now,
          // Store latest crossing location
          crossingLatitude: latitude,
          crossingLongitude: longitude,
        };

        await ctx.db.patch(crossedPath._id, updates);
        crossedPath = {
          ...crossedPath,
          ...updates,
          count: newCount,
        };
        crossedPathsByOtherUserId.set(nearbyUser._id as string, crossedPath);
      } else {
        const insertedCrossedPathId = await ctx.db.insert('crossedPaths', {
          user1Id,
          user2Id,
          count: 1,
          lastCrossedAt: now,
        });

        // BUGFIX #28: Re-query to detect concurrent insert race condition
        const allForPair = await ctx.db
          .query('crossedPaths')
          .withIndex('by_users', (q) =>
            q.eq('user1Id', user1Id).eq('user2Id', user2Id),
          )
          .collect();

        // If multiple records exist, keep oldest (lowest _creationTime), delete rest
        if (allForPair.length > 1) {
          // Sort by _creationTime ascending to keep oldest
          allForPair.sort((a, b) => a._creationTime - b._creationTime);
          // Delete all except the first (oldest)
          for (let i = 1; i < allForPair.length; i++) {
            await ctx.db.delete(allForPair[i]._id);
          }
          // Update crossedPath reference to the kept record
          crossedPath = allForPair[0];
        } else {
          crossedPath = {
            _id: insertedCrossedPathId,
            _creationTime: now,
            user1Id,
            user2Id,
            count: 1,
            lastCrossedAt: now,
          } as Doc<'crossedPaths'>;
        }

        if (crossedPath) {
          crossedPathsByOtherUserId.set(nearbyUser._id as string, crossedPath);
        }
      }

      // --- Cross-path history entry (MUTUAL — both users see this) ---
      const existingHistoryCreatedAt = recentHistoryByOtherUserId.get(
        nearbyUser._id as string,
      ) ?? 0;

      if (existingHistoryCreatedAt && now - existingHistoryCreatedAt < NOTIFICATION_COOLDOWN_MS) {
        // Already have a recent history entry for this pair — skip
        continue;
      }

      // Derive area name from city or generic label
      const areaName = nearbyUser.city
        ? `Near ${nearbyUser.city}`
        : 'Nearby area';

      // Compute approximate crossing location (privacy: rounded to ~500m grid)
      const approxLocation = roundToGrid(latitude, longitude);

      // BUGFIX #28: Insert history entry, then check for race condition duplicate
      const newHistoryId = await ctx.db.insert('crossPathHistory', {
        user1Id,
        user2Id,
        areaName,
        crossedLatApprox: approxLocation.lat,
        crossedLngApprox: approxLocation.lng,
        reasonTags: compatibility.reasonTags,
        createdAt: now,
        expiresAt: now + HISTORY_EXPIRY_MS,
      });
      insertedHistoryEntry = true;
      recentHistoryByOtherUserId.set(nearbyUser._id as string, now);

      // BUGFIX #28: Re-query to detect concurrent insert race condition for history
      const recentHistories = await ctx.db
        .query('crossPathHistory')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .filter((q) => q.gt(q.field('createdAt'), now - 60000)) // Within last minute
        .collect();

      // If multiple records created in last minute, keep oldest, delete rest
      if (recentHistories.length > 1) {
        recentHistories.sort((a, b) => a._creationTime - b._creationTime);
        for (let i = 1; i < recentHistories.length; i++) {
          await ctx.db.delete(recentHistories[i]._id);
        }
        // If our record was deleted, skip notifications
        if (recentHistories[0]._id !== newHistoryId) {
          continue;
        }
      }

      // Check notification cooldown on the canonical crossedPaths record
      const canNotify = crossedPath && (
        !crossedPath.lastNotifiedAt ||
        now - crossedPath.lastNotifiedAt >= NOTIFICATION_COOLDOWN_MS
      );

      if (canNotify && crossedPath) {
        // Rate limiting: Check if user has received too many notifications in the last 24 hours
        const recentNotificationsUser1 = await ctx.db
          .query('notifications')
          .withIndex('by_user', (q) => q.eq('userId', user1Id))
          .filter((q) =>
            q.and(
              q.eq(q.field('type'), 'crossed_paths'),
              q.gt(q.field('createdAt'), now - 24 * 60 * 60 * 1000)
            )
          )
          .collect();

        const recentNotificationsUser2 = await ctx.db
          .query('notifications')
          .withIndex('by_user', (q) => q.eq('userId', user2Id))
          .filter((q) =>
            q.and(
              q.eq(q.field('type'), 'crossed_paths'),
              q.gt(q.field('createdAt'), now - 24 * 60 * 60 * 1000)
            )
          )
          .collect();

        // Update lastNotifiedAt to prevent race condition duplicates
        await ctx.db.patch(crossedPath._id, { lastNotifiedAt: now });
        crossedPath = { ...crossedPath, lastNotifiedAt: now };
        crossedPathsByOtherUserId.set(nearbyUser._id as string, crossedPath);

        // Generate dynamic notification text based on crossing count
        const crossingCount = crossedPath.count;
        const reasonText = formatReasonForNotification(compatibility.reasonTags[0] ?? 'common');

        // Dynamic title and body based on state
        let title: string;
        let body: string;

        if (crossingCount === 1) {
          // First crossing
          title = 'Someone crossed your path';
          body = `${reasonText}`;
        } else if (crossingCount < 5) {
          // Early crossings
          title = 'Someone interesting crossed your path';
          body = `You've crossed paths ${crossingCount} times. ${reasonText}`;
        } else {
          // Frequent crossings - stronger suggestion
          title = 'You keep crossing paths with someone';
          body = `${crossingCount} times now! ${reasonText}. Maybe say hi?`;
        }

        // Generate deterministic dedupeKey using sorted user IDs + time bucket (symmetric)
        const pairDedupeKey = makeCrossedPathsDedupeKey(user1Id, user2Id, now);

        // IDEMPOTENCY: Check for existing notification with same dedupeKey within cooldown window
        // This prevents duplicate notifications even with concurrent updates
        const existingNotifUser1 = await ctx.db
          .query('notifications')
          .withIndex('by_user_dedupe', (q) =>
            q.eq('userId', user1Id).eq('dedupeKey', pairDedupeKey)
          )
          .first();

        const existingNotifUser2 = await ctx.db
          .query('notifications')
          .withIndex('by_user_dedupe', (q) =>
            q.eq('userId', user2Id).eq('dedupeKey', pairDedupeKey)
          )
          .first();

        // Only send notification if:
        // 1. Under rate limit (max 3/hour)
        // 2. No existing notification with same dedupeKey within cooldown window
        const shouldNotifyUser1 = recentNotificationsUser1.length < MAX_NOTIFICATIONS_PER_DAY &&
          (!existingNotifUser1 || now - existingNotifUser1.createdAt >= NOTIFICATION_COOLDOWN_MS);

        const shouldNotifyUser2 = recentNotificationsUser2.length < MAX_NOTIFICATIONS_PER_DAY &&
          (!existingNotifUser2 || now - existingNotifUser2.createdAt >= NOTIFICATION_COOLDOWN_MS);

        if (shouldNotifyUser1) {
          // Upsert pattern: update existing or insert new
          if (existingNotifUser1) {
            await ctx.db.patch(existingNotifUser1._id, {
              title,
              body,
              data: { userId: user2Id as string, pairKey: pairDedupeKey },
              createdAt: now,
              expiresAt: now + 24 * 60 * 60 * 1000,
              readAt: undefined, // Reset read status on update
            });
          } else {
            await ctx.db.insert('notifications', {
              userId: user1Id,
              type: 'crossed_paths' as const,
              title,
              body,
              data: { userId: user2Id as string, pairKey: pairDedupeKey },
              dedupeKey: pairDedupeKey,
              createdAt: now,
              expiresAt: now + 24 * 60 * 60 * 1000,
            });
          }
        }

        if (shouldNotifyUser2) {
          // Upsert pattern: update existing or insert new
          if (existingNotifUser2) {
            await ctx.db.patch(existingNotifUser2._id, {
              title,
              body,
              data: { userId: user1Id as string, pairKey: pairDedupeKey },
              createdAt: now,
              expiresAt: now + 24 * 60 * 60 * 1000,
              readAt: undefined, // Reset read status on update
            });
          } else {
            await ctx.db.insert('notifications', {
              userId: user2Id,
              type: 'crossed_paths' as const,
              title,
              body,
              data: { userId: user1Id as string, pairKey: pairDedupeKey },
              dedupeKey: pairDedupeKey,
              createdAt: now,
              expiresAt: now + 24 * 60 * 60 * 1000,
            });
          }
        }
      }

    }

    if (insertedHistoryEntry) {
      await trimHistoryForUser(ctx, userId);
    }

    return { success: true, nearbyCount: nearbyUsers.length };
  },
});

async function getVisibleCrossPathHistoryEntriesForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  currentUser: Doc<'users'>,
): Promise<{ entries: Doc<'crossPathHistory'>[]; now: number }> {
  const userId = currentUser._id;
  const now = Date.now();

  const [mySwipes, blockedIds, asUser1, asUser2] = await Promise.all([
    ctx.db
      .query('likes')
      .withIndex('by_from_user', (q: any) => q.eq('fromUserId', userId))
      .collect(),
    prefetchBlockedUserIds(ctx, userId),
    ctx.db
      .query('crossPathHistory')
      .withIndex('by_user1', (q: any) => q.eq('user1Id', userId))
      .collect(),
    ctx.db
      .query('crossPathHistory')
      .withIndex('by_user2', (q: any) => q.eq('user2Id', userId))
      .collect(),
  ]);

  const swipedUsersMap = new Map<string, { action: string; createdAt: number }>();
  for (const swipe of mySwipes) {
    swipedUsersMap.set(swipe.toUserId as string, {
      action: swipe.action,
      createdAt: swipe.createdAt,
    });
  }

  const entries = [...asUser1, ...asUser2]
    .filter((entry) => {
      if (entry.expiresAt <= now) return false;

      const isUser1 = entry.user1Id === userId;
      if (isUser1 && entry.hiddenByUser1) return false;
      if (!isUser1 && entry.hiddenByUser2) return false;

      const otherUserId = isUser1 ? entry.user2Id : entry.user1Id;
      if (blockedIds.has(otherUserId as string)) return false;

      const existingSwipe = swipedUsersMap.get(otherUserId as string);
      if (existingSwipe) {
        if (existingSwipe.action !== 'pass') return false;
        if (existingSwipe.createdAt > now - 7 * 24 * 60 * 60 * 1000) return false;
      }

      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return { entries, now };
}

// ---------------------------------------------------------------------------
// getNearbyUsers — map markers with jittered coords & freshness
// STABILITY FIX S1: Uses indexed query instead of full table scan
// STABILITY FIX S6: Pre-fetches blocks before loop (eliminates N+1)
// P1 AUTH HARDENING: Uses validated session token for current-user resolution
// DEV TEST MODE: When enabled, relaxes filters for real-device testing
// ---------------------------------------------------------------------------

export const getNearbyUsers = query({
  args: {
    token: v.string(),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { token }) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, token);
    const nearbyEligibility = await getEligibleNearbyCandidatesForViewer(ctx, currentUser);
    const config = getEffectiveNearbyConfig();

    if (nearbyEligibility.status !== 'ok') {
      return {
        status: nearbyEligibility.status,
        users: [],
      };
    }

    const userId = currentUser._id;
    const results = nearbyEligibility.candidates.map(({ user, distance, locationAgeMs, photoSummary }) => {
      const freshness: 'solid' | 'faded' = locationAgeMs <= SOLID_WINDOW_MS ? 'solid' : 'faded';

      const fuzzed = applyPrivacyFuzz(
        user.publishedLat!,
        user.publishedLng!,
        user._id,
        userId,
        user.strongPrivacyMode ?? false,
      );

      return {
        id: user._id,
        name: user.handle || 'Anonymous',
        age: calculateAge(user.dateOfBirth),
        publishedLat: fuzzed.lat,
        publishedLng: fuzzed.lng,
        publishedAt: user.publishedAt,
        distance: user.hideDistance === true ? undefined : distance,
        freshness,
        photoUrl: photoSummary.safeDisplayUrl,
        isVerified: user.isVerified,
        strongPrivacyMode: user.strongPrivacyMode ?? false,
        hideDistance: user.hideDistance ?? false,
      };
    });

    // Sort by recency first, then by distance
    results.sort((a, b) => {
      const recencyDiff = (b.publishedAt || 0) - (a.publishedAt || 0);
      if (Math.abs(recencyDiff) > 60 * 60 * 1000) {
        return recencyDiff;
      }
      return (a.distance ?? NEARBY_MAX_METERS) - (b.distance ?? NEARBY_MAX_METERS);
    });

    devLog('getNearbyUsers: FINAL RESULTS', {
      resultCount: results.length,
      isDevMode: config.IS_DEV_MODE,
      users: results.map((r) => ({
        id: r.id,
        name: r.name,
        distance: r.distance === undefined ? 'hidden' : Math.round(r.distance),
      })),
    });

    return {
      status: 'ok' as const,
      users: results,
    };
  },
});

// ---------------------------------------------------------------------------
// getCrossPathHistory — crossed paths history list (30-day retention)
// Returns crossed paths with approximate location and reason tags.
// Filters out hidden entries for the requesting user.
// ---------------------------------------------------------------------------

export const getCrossPathHistory = query({
  args: {
    token: v.string(),
    refreshKey: v.optional(v.number()),
  },
  handler: async (ctx, { token }) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, token);
    const userId = currentUser._id;
    const { entries, now } = await getVisibleCrossPathHistoryEntriesForUser(ctx, currentUser);

    const myLat = currentUser?.publishedLat ?? currentUser?.latitude;
    const myLng = currentUser?.publishedLng ?? currentUser?.longitude;
    const all = entries.slice(0, MAX_HISTORY_ENTRIES);

    // Collect unique other user IDs
    const otherUserIds = [...new Set(
      all.map((entry) => entry.user1Id === userId ? entry.user2Id : entry.user1Id)
    )];

    const [crossedPathsAsUser1, crossedPathsAsUser2] = await Promise.all([
      ctx.db
        .query('crossedPaths')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .collect(),
      ctx.db
        .query('crossedPaths')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .collect(),
    ]);

    // Batch fetch crossing counts from crossedPaths table without per-user lookups
    const crossingCountsMap = new Map<string, number>();
    for (const crossedPath of [...crossedPathsAsUser1, ...crossedPathsAsUser2]) {
      const otherUserId =
        crossedPath.user1Id === userId ? crossedPath.user2Id : crossedPath.user1Id;
      crossingCountsMap.set(otherUserId as string, crossedPath.count);
    }

    // Parallel fetch all users
    const usersMap = new Map<string, Doc<'users'>>();
    const userFetches = await Promise.all(
      otherUserIds.map((id) => ctx.db.get(id))
    );
    otherUserIds.forEach((id, i) => {
      const user = userFetches[i];
      if (user) usersMap.set(id as string, user as Doc<'users'>);
    });

    const photoSummariesMap = await prefetchPhotoSummaries(
      ctx,
      otherUserIds.map((id) => String(id))
    );

    // Build results using pre-fetched data
    const results = [];
    for (const entry of all) {
      const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
      const otherUser = usersMap.get(otherUserId as string);
      if (!otherUser || !otherUser.isActive) continue;
      if (otherUser.isBanned) continue;
      if (otherUser.verificationEnforcementLevel === 'security_only') continue;
      if (
        otherUser.verificationEnforcementLevel === 'reduced_reach' &&
        !shouldIncludeReducedReachCandidate(String(userId), String(otherUserId))
      ) {
        continue;
      }

      // P0 FIX: Privacy filtering - hide users who disabled/paused Nearby
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;

      const photoSummary = photoSummariesMap.get(otherUserId as string);
      if (!photoSummary?.safeDisplayUrl) continue;

      const crossingCount = crossingCountsMap.get(otherUserId as string) || 1;

      // Format reason for "why am I seeing this?" explanation
      const reasonTags = entry.reasonTags ?? [];
      const reasonText = reasonTags.length > 0
        ? formatReasonForNotification(reasonTags[0])
        : null;

      // Build "why am I seeing this" explanation
      let whyExplanation: string;
      if (crossingCount > 1) {
        whyExplanation = `You've crossed paths ${crossingCount} times in similar areas. ${reasonText || 'You have something in common.'}`;
      } else {
        whyExplanation = `You were in the same area within the last 24 hours. ${reasonText || 'You have something in common.'}`;
      }

      // Area name: Only reveal after repeated crossings (privacy)
      const displayAreaName = crossingCount > 1 ? entry.areaName : 'Nearby area';

      // Calculate distance range for display (Phase-2: no exact km)
      let distanceRange: string | null = null;
      if (myLat && myLng && entry.crossedLatApprox && entry.crossedLngApprox) {
        const distanceMeters = calculateDistanceMeters(
          myLat,
          myLng,
          entry.crossedLatApprox,
          entry.crossedLngApprox,
        );
        distanceRange = formatDistanceRange(distanceMeters);
      }

      // Calculate relative time for display
      const relativeTime = formatRelativeTime(entry.createdAt, now);

      // PHASE-2 PRIVACY FIX: Use handle (anonymous username) ONLY, never real name
      // Phase-2 surfaces must NEVER expose first name or last name
      const displayName = otherUser.handle || 'Anonymous';

      results.push({
        id: entry._id,
        otherUserId,
        otherUserName: displayName,
        otherUserAge: calculateAge(otherUser.dateOfBirth),
        areaName: displayAreaName,
        // Approximate crossing location (not current location — persists across travel)
        crossedLatApprox: entry.crossedLatApprox,
        crossedLngApprox: entry.crossedLngApprox,
        // Crossing count (for UI display)
        crossingCount,
        // Distance range (e.g., "4-5 km")
        distanceRange,
        // Relative time (e.g., "today", "yesterday", "3 days ago")
        relativeTime,
        // Reason tags and formatted text
        reasonTags,
        reasonText,
        // "Why am I seeing this?" explanation
        whyExplanation,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        photoUrl: photoSummary.safeDisplayUrl,
        initial: displayName.charAt(0).toUpperCase(),
        isVerified: otherUser.isVerified,
      });
    }

    // Sort: crossing count (higher first), then recency
    results.sort((a, b) => {
      if (b.crossingCount !== a.crossingCount) return b.crossingCount - a.crossingCount;
      return b.createdAt - a.createdAt;
    });

    return results;
  },
});

export const getCrossedPathSummary = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const currentUser = await requireAuthenticatedSessionUser(ctx, token);
    const { entries } = await getVisibleCrossPathHistoryEntriesForUser(ctx, currentUser);

    return {
      count: entries.length,
      latestCreatedAt: entries.length > 0 ? entries[0].createdAt : null,
    };
  },
});

// ---------------------------------------------------------------------------
// hideCrossedPath — mark a crossed path as hidden for the current user
// ---------------------------------------------------------------------------

// P1 AUTH HARDENING: Uses validated session token for current-user resolution.
export const hideCrossedPath = mutation({
  args: {
    token: v.string(),
    historyId: v.id('crossPathHistory'),
  },
  handler: async (ctx, args) => {
    const { token, historyId } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    const entry = await ctx.db.get(historyId);
    if (!entry) {
      return { success: false, reason: 'not_found' };
    }

    // Determine which user is hiding this entry
    const isUser1 = entry.user1Id === userId;
    const isUser2 = entry.user2Id === userId;

    if (!isUser1 && !isUser2) {
      return { success: false, reason: 'unauthorized' };
    }

    // Set the appropriate hidden flag
    if (isUser1) {
      await ctx.db.patch(historyId, { hiddenByUser1: true });
    } else {
      await ctx.db.patch(historyId, { hiddenByUser2: true });
    }

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// deleteCrossedPath — permanently delete a crossed path entry
// ---------------------------------------------------------------------------

// P1 AUTH HARDENING: Uses validated session token for current-user resolution.
export const deleteCrossedPath = mutation({
  args: {
    token: v.string(),
    historyId: v.id('crossPathHistory'),
  },
  handler: async (ctx, args) => {
    const { token, historyId } = args;
    const user = await requireAuthenticatedSessionUser(ctx, token);
    const userId = user._id;

    const entry = await ctx.db.get(historyId);
    if (!entry) {
      return { success: false, reason: 'not_found' };
    }

    // Verify user is part of this crossed path
    if (entry.user1Id !== userId && entry.user2Id !== userId) {
      return { success: false, reason: 'unauthorized' };
    }

    // Delete the entry
    await ctx.db.delete(historyId);

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// cleanupExpiredHistory — call periodically to purge old entries
// ---------------------------------------------------------------------------

export const cleanupExpiredHistory = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_expires')
      .filter((q) => q.lt(q.field('expiresAt'), now))
      .collect();

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }

    return { deleted: expired.length };
  },
});

// ---------------------------------------------------------------------------
// getDelayedCrossedPathEntries — Lightweight Hybrid Nearby Feed query
// Returns ONLY crossed path history entries (NO user/photo joins).
// Filtering: delay + window + optional radius.
// Client handles user/photo resolution separately to avoid N+1.
// ---------------------------------------------------------------------------

export const getDelayedCrossedPathEntries = query({
  args: {
    userId: v.id('users'),
    delayMs: v.optional(v.number()),   // Default: 10 minutes (600_000)
    windowMs: v.optional(v.number()),  // Default: 72 hours (259_200_000)
    radiusMeters: v.optional(v.number()), // Optional: filter by distance
    myLat: v.optional(v.number()),
    myLng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      userId,
      delayMs = 10 * 60 * 1000,         // 10 minutes
      windowMs = 72 * 60 * 60 * 1000,   // 72 hours
      radiusMeters,
      myLat,
      myLng,
    } = args;
    const now = Date.now();

    // Time bounds: entries must be past delay but within window
    const visibleAfter = now - windowMs;   // oldest allowed
    const visibleBefore = now - delayMs;   // most recent allowed (past delay)

    // Query both sides of the relationship
    const asUser1 = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect();

    const asUser2 = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .collect();

    // Merge and filter
    const filtered = [...asUser1, ...asUser2].filter((entry) => {
      // Time window check
      if (entry.createdAt < visibleAfter) return false;
      if (entry.createdAt > visibleBefore) return false;

      // Hidden flag check
      const isUser1 = entry.user1Id === userId;
      if (isUser1 && entry.hiddenByUser1) return false;
      if (!isUser1 && entry.hiddenByUser2) return false;

      // Optional radius filter
      if (
        radiusMeters != null &&
        myLat != null &&
        myLng != null &&
        entry.crossedLatApprox != null &&
        entry.crossedLngApprox != null
      ) {
        const distance = calculateDistanceMeters(
          myLat,
          myLng,
          entry.crossedLatApprox,
          entry.crossedLngApprox,
        );
        if (distance > radiusMeters) return false;
      }

      return true;
    });

    // Sort newest first
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    // Return minimal entry data — NO user/photo joins
    return filtered.map((entry) => ({
      id: entry._id,
      otherUserId: entry.user1Id === userId ? entry.user2Id : entry.user1Id,
      createdAt: entry.createdAt,
      crossedLatApprox: entry.crossedLatApprox ?? null,
      crossedLngApprox: entry.crossedLngApprox ?? null,
      areaName: entry.areaName,
      reasonTags: entry.reasonTags ?? [],
    }));
  },
});

// ---------------------------------------------------------------------------
// getCrossedPaths — crossed paths list (no unlock system)
// Returns crossing counts and user info for display.
// ---------------------------------------------------------------------------

export const getCrossedPaths = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 15 } = args;
    const now = Date.now();

    // Get current user for distance calculation
    const currentUser = await ctx.db.get(userId);
    const myLat = currentUser?.publishedLat ?? currentUser?.latitude;
    const myLng = currentUser?.publishedLng ?? currentUser?.longitude;

    const asUser1 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .take(limit);

    const asUser2 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .take(limit);

    const allCrossedPaths = [...asUser1, ...asUser2];

    // Sort by recency first (most recent), then distance second (closer first)
    allCrossedPaths.sort((a, b) => {
      // Primary: recency (most recent first)
      const recencyDiff = b.lastCrossedAt - a.lastCrossedAt;
      if (Math.abs(recencyDiff) > 60 * 60 * 1000) { // More than 1 hour difference
        return recencyDiff;
      }
      // Secondary: distance (closer first) if we have location data
      if (myLat && myLng) {
        const distA = a.crossingLatitude && a.crossingLongitude
          ? calculateDistanceMeters(myLat, myLng, a.crossingLatitude, a.crossingLongitude)
          : Infinity;
        const distB = b.crossingLatitude && b.crossingLongitude
          ? calculateDistanceMeters(myLat, myLng, b.crossingLatitude, b.crossingLongitude)
          : Infinity;
        return distA - distB;
      }
      return recencyDiff;
    });

    const topCrossedPaths = allCrossedPaths.slice(0, limit);

    // Collect unique other user IDs
    const otherUserIds = [...new Set(
      topCrossedPaths.map((cp) => cp.user1Id === userId ? cp.user2Id : cp.user1Id)
    )];

    // Parallel fetch all users
    const usersMap = new Map<string, Doc<'users'>>();
    const userFetches = await Promise.all(
      otherUserIds.map((id) => ctx.db.get(id))
    );
    otherUserIds.forEach((id, i) => {
      const user = userFetches[i];
      if (user) usersMap.set(id as string, user as Doc<'users'>);
    });

    // Parallel fetch all primary photos
    const photosMap = new Map<string, string | undefined>();
    const photoFetches = await Promise.all(
      otherUserIds.map((id) =>
        ctx.db
          .query('photos')
          .withIndex('by_user', (q) => q.eq('userId', id))
          .filter((q) => q.eq(q.field('isPrimary'), true))
          .first()
      )
    );
    otherUserIds.forEach((id, i) => {
      photosMap.set(id as string, photoFetches[i]?.url);
    });

    // Build results using pre-fetched data
    const result = [];
    for (const cp of topCrossedPaths) {
      const otherUserId = cp.user1Id === userId ? cp.user2Id : cp.user1Id;
      const otherUser = usersMap.get(otherUserId as string);

      if (!otherUser || !otherUser.isActive) continue;

      // P0 FIX: Privacy filtering - hide users who disabled/paused Nearby
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;

      // P0 FIX: Require valid primary photo URL
      if (!otherUser.primaryPhotoUrl) continue;

      // Calculate distance range if we have location data
      let distanceRange: string | null = null;
      if (myLat && myLng && cp.crossingLatitude && cp.crossingLongitude) {
        const distanceMeters = calculateDistanceMeters(
          myLat,
          myLng,
          cp.crossingLatitude,
          cp.crossingLongitude,
        );
        distanceRange = formatDistanceRange(distanceMeters);
      }

      // Calculate relative time
      const relativeTime = formatRelativeTime(cp.lastCrossedAt, now);

      result.push({
        id: cp._id,
        count: cp.count,
        lastCrossedAt: cp.lastCrossedAt,
        relativeTime,
        distanceRange,
        user: {
          id: otherUserId,
          // PHASE-2 PRIVACY: Use handle (anonymous username) ONLY, never real name
          name: otherUser.handle || 'Anonymous',
          age: calculateAge(otherUser.dateOfBirth),
          photoUrl: photosMap.get(otherUserId as string),
          isVerified: otherUser.isVerified,
        },
      });
    }

    return result;
  },
});

// ---------------------------------------------------------------------------
// getCrossedPathCount — get crossing count between two users
// ---------------------------------------------------------------------------

export const getCrossedPathCount = query({
  args: {
    user1Id: v.id('users'),
    user2Id: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { user1Id, user2Id } = args;

    const orderedUser1 = user1Id < user2Id ? user1Id : user2Id;
    const orderedUser2 = user1Id < user2Id ? user2Id : user1Id;

    const crossedPath = await ctx.db
      .query('crossedPaths')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2),
      )
      .first();

    if (!crossedPath) return { count: 0, exists: false };

    return {
      count: crossedPath.count,
      exists: true,
      lastCrossedAt: crossedPath.lastCrossedAt,
    };
  },
});

// ---------------------------------------------------------------------------
// getCrossedPathsCount (badge)
// ---------------------------------------------------------------------------

export const getCrossedPathsCount = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const { userId } = args;

    const asUser1 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect();

    const asUser2 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .collect();

    return asUser1.length + asUser2.length;
  },
});

// ---------------------------------------------------------------------------
// getSharedPlaces — Privacy-safe shared places detection (Phase-1)
// ---------------------------------------------------------------------------
/**
 * Get shared places between two users based on their location history.
 *
 * PRIVACY PROTECTIONS:
 * - Uses coarse 1km grid clustering (no exact locations)
 * - Returns generic labels only (no venue names or addresses)
 * - No timestamps exposed
 * - Minimum visit threshold to filter noise
 * - Max 3 results to prevent profiling
 * - Only recent history (14 days)
 */
export const getSharedPlaces = query({
  args: {
    token: v.string(),
    profileUserId: v.id('users'), // User whose profile is being viewed
  },
  handler: async (ctx, args) => {
    const { token, profileUserId } = args;
    const viewer = await requireAuthenticatedSessionUser(ctx, token);
    const viewerId = viewer._id;

    // Don't show shared places for self
    if (viewerId === profileUserId) {
      return [];
    }

    const blockedIds = await prefetchBlockedUserIds(ctx, viewerId);
    if (blockedIds.has(profileUserId as string)) {
      return [];
    }

    const now = Date.now();
    const windowStart = now - SHARED_PLACES_WINDOW_MS;

    // Query history entries for both users
    // Using crossPathHistory which has approximate coordinates
    const [viewerAsUser1, viewerAsUser2, profileAsUser1, profileAsUser2] = await Promise.all([
      // Viewer's crossings where they were user1
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user1', (q) => q.eq('user1Id', viewerId))
        .filter((q) => q.gte(q.field('createdAt'), windowStart))
        .collect(),
      // Viewer's crossings where they were user2
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user2', (q) => q.eq('user2Id', viewerId))
        .filter((q) => q.gte(q.field('createdAt'), windowStart))
        .collect(),
      // Profile user's crossings where they were user1
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user1', (q) => q.eq('user1Id', profileUserId))
        .filter((q) => q.gte(q.field('createdAt'), windowStart))
        .collect(),
      // Profile user's crossings where they were user2
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user2', (q) => q.eq('user2Id', profileUserId))
        .filter((q) => q.gte(q.field('createdAt'), windowStart))
        .collect(),
    ]);

    // Combine entries for each user
    const viewerEntries = [...viewerAsUser1, ...viewerAsUser2];
    const profileEntries = [...profileAsUser1, ...profileAsUser2];

    // Build place key maps for each user
    // Map: placeKey -> count of entries in that area
    const viewerPlaces = new Map<string, number>();
    const profilePlaces = new Map<string, number>();

    for (const entry of viewerEntries) {
      if (entry.crossedLatApprox != null && entry.crossedLngApprox != null) {
        const key = generatePlaceKey(entry.crossedLatApprox, entry.crossedLngApprox);
        viewerPlaces.set(key, (viewerPlaces.get(key) || 0) + 1);
      }
    }

    for (const entry of profileEntries) {
      if (entry.crossedLatApprox != null && entry.crossedLngApprox != null) {
        const key = generatePlaceKey(entry.crossedLatApprox, entry.crossedLngApprox);
        profilePlaces.set(key, (profilePlaces.get(key) || 0) + 1);
      }
    }

    // Find overlapping place keys where both users have minimum visits
    const sharedPlaces: { label: string; placeKey: string }[] = [];

    for (const [placeKey, viewerCount] of viewerPlaces) {
      const profileCount = profilePlaces.get(placeKey);

      // Both users must have visited this place
      if (
        profileCount &&
        viewerCount >= SHARED_PLACES_MIN_VISITS &&
        profileCount >= SHARED_PLACES_MIN_VISITS
      ) {
        sharedPlaces.push({
          placeKey,
          label: getPlaceLabel(placeKey, sharedPlaces.length),
        });

        // Limit results
        if (sharedPlaces.length >= SHARED_PLACES_MAX_RESULTS) {
          break;
        }
      }
    }

    // Return only labels (no coordinates, no counts, no timestamps)
    return sharedPlaces.map((p, idx) => ({
      id: `shared_place_${idx}`,
      label: p.label,
    }));
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * SEC-1 FIX: Server-side privacy fuzzing for location coordinates.
 * Applies deterministic random offset based on user ID hash.
 * Ensures same user always gets same fuzzing for consistent map rendering.
 *
 * @param lat - Original latitude
 * @param lng - Original longitude
 * @param userId - User ID (for deterministic hash)
 * @param viewerId - Viewer ID (combined with userId for unique offset per viewer)
 * @param strongPrivacyMode - If true, apply larger fuzz radius
 * @returns Fuzzed coordinates
 */
function applyPrivacyFuzz(
  lat: number,
  lng: number,
  userId: string,
  viewerId: string,
  strongPrivacyMode: boolean,
): { lat: number; lng: number } {
  // Create deterministic hash from combined IDs (consistent across sessions)
  const combined = `${userId}_${viewerId}_privacy_fuzz`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash |= 0;
  }

  // Convert hash to pseudo-random values between 0 and 1
  const hashAbs = Math.abs(hash);
  const r1 = (hashAbs % 10000) / 10000;
  const r2 = ((hashAbs >> 8) % 10000) / 10000;

  // Determine fuzz radius based on privacy mode
  const minMeters = strongPrivacyMode ? STRONG_PRIVACY_FUZZ_MIN : FUZZ_MIN_METERS;
  const maxMeters = strongPrivacyMode ? STRONG_PRIVACY_FUZZ_MAX : FUZZ_MAX_METERS;

  // Random distance within range
  const fuzzDistance = minMeters + r1 * (maxMeters - minMeters);

  // Random angle (0 to 2π)
  const angle = r2 * 2 * Math.PI;

  // Convert meters to degrees (approximate: 1 degree ≈ 111km at equator)
  // Adjust for latitude to account for longitude compression
  const metersPerDegreeLat = 111000;
  const metersPerDegreeLng = 111000 * Math.cos(lat * Math.PI / 180);

  const latOffset = (fuzzDistance * Math.cos(angle)) / metersPerDegreeLat;
  const lngOffset = (fuzzDistance * Math.sin(angle)) / metersPerDegreeLng;

  return {
    lat: lat + latOffset,
    lng: lng + lngOffset,
  };
}

function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/** Simple deterministic hash for seeding jitter. */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Offset a lat/lng by a distance (meters) and bearing (radians). */
function offsetCoords(
  lat: number,
  lng: number,
  distanceMeters: number,
  bearingRad: number,
): { lat: number; lng: number } {
  const R = 6371000;
  const latRad = toRad(lat);
  const lngRad = toRad(lng);
  const d = distanceMeters / R;

  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) +
    Math.cos(latRad) * Math.sin(d) * Math.cos(bearingRad),
  );
  const newLng =
    lngRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(newLat),
    );

  return {
    lat: newLat * (180 / Math.PI),
    lng: newLng * (180 / Math.PI),
  };
}

/** Trim cross-path history to MAX_HISTORY_ENTRIES for a given user. */
async function trimHistoryForUser(ctx: any, userId: Id<'users'>) {
  const [asUser1, asUser2] = await Promise.all([
    ctx.db
      .query('crossPathHistory')
      .withIndex('by_user1', (q: any) => q.eq('user1Id', userId))
      .collect(),
    ctx.db
      .query('crossPathHistory')
      .withIndex('by_user2', (q: any) => q.eq('user2Id', userId))
      .collect(),
  ]);

  const visibleEntries = [
    ...asUser1.filter((entry: any) => !entry.hiddenByUser1),
    ...asUser2.filter((entry: any) => !entry.hiddenByUser2),
  ].sort((a: any, b: any) => b.createdAt - a.createdAt);

  if (visibleEntries.length > MAX_HISTORY_ENTRIES) {
    const toHide = visibleEntries.slice(MAX_HISTORY_ENTRIES);
    for (const entry of toHide) {
      if (entry.user1Id === userId) {
        if (!entry.hiddenByUser1) {
          await ctx.db.patch(entry._id, { hiddenByUser1: true });
        }
      } else if (!entry.hiddenByUser2) {
        await ctx.db.patch(entry._id, { hiddenByUser2: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compatibility Gate: At least ONE common element required
// ---------------------------------------------------------------------------

interface CompatibilityResult {
  isCompatible: boolean;
  reasonTags: string[]; // e.g. ["interest:coffee", "lookingFor:long_term"]
}

/**
 * Check if two users have at least ONE common element across Phase-1 data.
 * Required for crossed paths to appear.
 *
 * Checks:
 * 1. Shared activities/interests (e.g., both like "coffee")
 * 2. Shared relationship intent (e.g., both want "long_term")
 * 3. Shared profile prompt topic (e.g., both answered travel-related prompts)
 */
function computeCompatibility(
  userA: {
    activities?: string[];
    relationshipIntent?: string[];
    profilePrompts?: { question: string; answer: string }[];
  },
  userB: {
    activities?: string[];
    relationshipIntent?: string[];
    profilePrompts?: { question: string; answer: string }[];
  },
): CompatibilityResult {
  const reasonTags: string[] = [];

  // 1. Shared activities/interests
  const activitiesA = new Set(userA.activities ?? []);
  const activitiesB = new Set(userB.activities ?? []);
  for (const activity of activitiesA) {
    if (activitiesB.has(activity)) {
      reasonTags.push(`interest:${activity}`);
    }
  }

  // 2. Shared relationship intent
  const intentA = new Set(userA.relationshipIntent ?? []);
  const intentB = new Set(userB.relationshipIntent ?? []);
  for (const intent of intentA) {
    if (intentB.has(intent)) {
      reasonTags.push(`lookingFor:${intent}`);
    }
  }

  // 3. Shared profile prompt topics (basic keyword matching)
  // Extract keywords from prompts and check for overlap
  const promptKeywordsA = extractPromptKeywords(userA.profilePrompts ?? []);
  const promptKeywordsB = extractPromptKeywords(userB.profilePrompts ?? []);
  for (const keyword of promptKeywordsA) {
    if (promptKeywordsB.has(keyword)) {
      reasonTags.push(`prompt:${keyword}`);
    }
  }

  return {
    isCompatible: reasonTags.length > 0,
    reasonTags: reasonTags.slice(0, 3), // Limit to top 3 reasons
  };
}

/** Extract topic keywords from profile prompts for matching. */
function extractPromptKeywords(
  prompts: { question: string; answer: string }[],
): Set<string> {
  const keywords = new Set<string>();

  // Common topic keywords to look for
  const topicPatterns: Record<string, RegExp> = {
    travel: /travel|trip|vacation|explore|adventure/i,
    food: /food|cook|cuisine|restaurant|eat/i,
    music: /music|song|concert|band|singer/i,
    movies: /movie|film|cinema|watch|series/i,
    fitness: /gym|fitness|workout|exercise|run/i,
    reading: /book|read|author|novel|story/i,
    art: /art|paint|draw|museum|creative/i,
    nature: /nature|hike|outdoor|mountain|beach/i,
    pets: /dog|cat|pet|animal/i,
    coffee: /coffee|café|cafe/i,
  };

  for (const prompt of prompts) {
    const text = `${prompt.question} ${prompt.answer}`.toLowerCase();
    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(text)) {
        keywords.add(topic);
      }
    }
  }

  return keywords;
}

/**
 * Round coordinates to a grid for privacy.
 * Returns approximate location that doesn't reveal exact position.
 */
function roundToGrid(lat: number, lng: number): { lat: number; lng: number } {
  // 1 degree latitude ≈ 111km, so 500m ≈ 0.0045 degrees
  const gridSize = LOCATION_GRID_METERS / 111000;
  return {
    lat: Math.round(lat / gridSize) * gridSize,
    lng: Math.round(lng / gridSize) * gridSize,
  };
}

/**
 * Generate a coarse place key for shared places clustering.
 * Uses ~1km grid to prevent exact location exposure.
 * Returns a string key like "lat:12.34_lng:56.78" for map-based grouping.
 */
function generatePlaceKey(lat: number, lng: number): string {
  // 1 degree latitude ≈ 111km, so 1km ≈ 0.009 degrees
  const gridSize = SHARED_PLACES_GRID_METERS / 111000;
  const roundedLat = Math.round(lat / gridSize) * gridSize;
  const roundedLng = Math.round(lng / gridSize) * gridSize;
  // Use fixed precision to ensure consistent keys
  return `lat:${roundedLat.toFixed(3)}_lng:${roundedLng.toFixed(3)}`;
}

/**
 * Generic place labels for Phase-1 (no venue API).
 * Returns privacy-safe area descriptions.
 */
const GENERIC_PLACE_LABELS = [
  'Shared place nearby',
  'Common area',
  'Frequent spot',
  'Visited area',
  'Nearby location',
];

/**
 * Get a deterministic but varied place label based on place key.
 * Uses the key hash to pick a label, ensuring same place = same label.
 */
function getPlaceLabel(placeKey: string, index: number): string {
  // Simple hash to pick a label deterministically
  let hash = 0;
  for (let i = 0; i < placeKey.length; i++) {
    hash = ((hash << 5) - hash) + placeKey.charCodeAt(i);
    hash |= 0;
  }
  // Add index to vary labels for multiple places
  const labelIndex = Math.abs(hash + index) % GENERIC_PLACE_LABELS.length;
  return GENERIC_PLACE_LABELS[labelIndex];
}

/**
 * Format distance in meters to a privacy-safe range string.
 * Uses rounded ranges like "4-5 km", "9-10 km" to avoid exact distances.
 */
function formatDistanceRange(distanceMeters: number): string {
  const distanceKm = distanceMeters / 1000;

  if (distanceKm < 1) {
    return 'Less than 1 km';
  } else if (distanceKm < 2) {
    return '1-2 km';
  } else if (distanceKm < 3) {
    return '2-3 km';
  } else if (distanceKm < 5) {
    return '3-5 km';
  } else if (distanceKm < 7) {
    return '5-7 km';
  } else if (distanceKm < 10) {
    return '7-10 km';
  } else if (distanceKm < 15) {
    return '10-15 km';
  } else if (distanceKm < 20) {
    return '15-20 km';
  } else if (distanceKm < 30) {
    return '20-30 km';
  } else if (distanceKm < 50) {
    return '30-50 km';
  } else {
    return '50+ km';
  }
}

/**
 * Format timestamp to a human-friendly relative time string.
 * "just now", "today", "yesterday", "3 days ago", etc.
 */
function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 5) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minutes ago`;
  } else if (diffHours < 2) {
    return 'about an hour ago';
  } else if (diffHours < 24) {
    return 'today';
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 14) {
    return 'about a week ago';
  } else if (diffDays < 21) {
    return '2 weeks ago';
  } else if (diffDays < 28) {
    return '3 weeks ago';
  } else {
    return 'about a month ago';
  }
}

/**
 * Format reason tag for notification display.
 * "interest:coffee" → "You both enjoy coffee"
 * "lookingFor:long_term" → "You're both looking for long-term"
 */
function formatReasonForNotification(reasonTag: string): string {
  const [type, value] = reasonTag.split(':');

  if (type === 'interest') {
    const labels: Record<string, string> = {
      coffee: 'coffee',
      travel: 'traveling',
      foodie: 'food',
      movies: 'movies',
      concerts: 'concerts',
      sports: 'sports',
      gaming: 'gaming',
      nightlife: 'nightlife',
      outdoors: 'the outdoors',
      gym_partner: 'fitness',
      art_culture: 'art & culture',
    };
    return `You both enjoy ${labels[value] ?? value}`;
  }

  if (type === 'lookingFor') {
    // CURRENT 9 RELATIONSHIP CATEGORIES
    const labels: Record<string, string> = {
      serious_vibes: 'something serious',
      keep_it_casual: 'keeping it casual',
      exploring_vibes: 'figuring things out',
      see_where_it_goes: 'seeing where it goes',
      open_to_vibes: 'staying open',
      just_friends: 'new friends',
      open_to_anything: 'open to anything',
      single_parent: 'a fellow parent',
      new_to_dating: 'starting fresh',
    };
    return `You're both looking for ${labels[value] ?? value}`;
  }

  if (type === 'prompt') {
    return `You both mentioned ${value}`;
  }

  return 'You have something in common';
}
