import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { loadDiscoveryExclusions } from './discoveryExclusions';
import {
  BG_CROSSED_PATHS_REQUIRED_CONSENT_VERSION,
  getRequiredBgCrossedPathsConsentVersion,
  getUserBgCrossedPathsConsent,
  hasCurrentBgCrossedPathsConsentOnUser,
  isBgCrossedPathsEnabled as readBgCrossedPathsFeatureFlag,
} from './backgroundCrossedPathsPolicy';

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
      .filter((q: any) => q.neq(q.field('photoType'), 'verification_reference'))
      .collect()
  );

  const photoResults = await Promise.all(photoPromises);

  userIds.forEach((uid, i) => {
    counts.set(uid, photoResults[i].length);
  });

  return counts;
}

async function fetchPhase1PrimaryPhotoUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: string
): Promise<string | null> {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user_order', (q: any) => q.eq('userId', userId))
    .filter((q: any) => q.neq(q.field('photoType'), 'verification_reference'))
    .collect();

  photos.sort((a: Doc<'photos'>, b: Doc<'photos'>) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });

  return photos[0]?.url ?? null;
}

async function prefetchPhase1PrimaryPhotoUrls(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    userIds.map(async (id) => [id, await fetchPhase1PrimaryPhotoUrl(ctx, id)] as const)
  );
  return new Map(entries);
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

// Legacy published-location map radius constants. getNearbyUsers no longer
// uses these for feed inclusion; Nearby inclusion is crossPathHistory-based.
// No 100 m minimum floor: co-located users (0 m / 10 m / 50 m...) are eligible.
const NEARBY_MIN_METERS = 0;    // No minimum floor; co-located users remain eligible
const NEARBY_MAX_METERS = 1000; // Maximum distance for nearby map

// Crossed paths: 0m - 1000m range.
// PRODUCT FIX: the previous 100m floor silently rejected co-located users
// (the strongest real-world crossing signal). We now allow anything from 0m
// upward, with a small anti-jitter floor applied post-hoc only if needed.
// The upper bound is widened slightly to match Nearby visibility (1km) so
// the two surfaces tell a consistent "we were near each other" story.
const CROSSED_MIN_METERS = 0;    // No minimum floor; co-located is the strongest crossing
const CROSSED_MAX_METERS = 1000; // Aligned with Nearby map upper bound

// Location update gate
const LOCATION_UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Published location window (privacy: coarse republish cadence — a user's
// published location refreshes at most once per 6 hours. Between republishes
// the previously-published location remains visible on the map — this is the
// persistent Nearby contract. The 6-hour gate only rate-limits writes, it no
// longer gates visibility.)
const PUBLISH_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// Marker visibility tiers (cosmetic only — for Nearby map marker styling)
const SOLID_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 1–3 days → solid marker
const FADED_WINDOW_MS = 6 * 24 * 60 * 60 * 1000; // 3–6 days → faded marker
// Note: these are display tiers only. They do NOT expire Nearby visibility.
// A user stays on the map regardless of the age of their published location
// until a later coarse republish replaces it or an exclusion fires.

// Foreground crossed-path detection should only compare against recent stored
// foreground locations, not old published/current-user snapshots.
const FOREGROUND_FRESHNESS_MS = 12 * 60 * 60 * 1000; // 12 hours

// Crossed paths history — retention set to 30 days. Older crossPathHistory
// rows are removed by the cleanupExpiredHistory cron and any time the
// per-pair record buffer is appended to.
const HISTORY_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_HISTORY_ENTRIES = 15; // Max crossed paths list entries
const GENERIC_CROSSING_AREA_NAME = 'Nearby area';

// Mirrors convex/discover.ts orientationAllowsCandidateGender exactly so
// Nearby/crossed-path eligibility matches the current Discover hard gate.
function orientationAllowsCandidateGender(args: {
  viewerGender: string | undefined;
  viewerOrientation: string | undefined;
  candidateGender: string | undefined;
}): boolean {
  const { viewerGender, viewerOrientation, candidateGender } = args;

  if (!viewerOrientation || viewerOrientation === 'prefer_not_to_say') return true;
  if (candidateGender !== 'male' && candidateGender !== 'female') return true;
  if (viewerGender !== 'male' && viewerGender !== 'female') return true;

  if (viewerOrientation === 'bisexual') {
    return candidateGender === 'male' || candidateGender === 'female';
  }

  if (viewerOrientation === 'straight') {
    return viewerGender === 'male' ? candidateGender === 'female' : candidateGender === 'male';
  }

  if (viewerOrientation === 'gay') {
    return candidateGender === viewerGender;
  }

  if (viewerOrientation === 'lesbian') {
    return viewerGender === 'female' && candidateGender === 'female';
  }

  return true;
}

// Grid size for approximate crossing location (privacy: round to ~300m)
const LOCATION_GRID_METERS = 300;

// ---------------------------------------------------------------------------
// Phase-2 Nearby constants
// ---------------------------------------------------------------------------

// Legacy published-location ghost cutoff. Active Nearby feed inclusion now
// comes from crossPathHistory.expiresAt, not published snapshot age.
const GHOST_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Legacy published-location map pin TTL. The crossed-path Nearby feed does
// not include candidates from publishedAt freshness.
const NEARBY_MAP_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Safe Nearby v2 — Snapshot regeneration movement threshold. Even after
// the 6h publish window expires, a user MUST have moved at least this
// distance from their previous snapshot cell before a new snapshot is
// recorded. Without this, a user who stays at home all day would have
// their snapshot reliably re-pinned at home every 6 hours, confirming
// home location to any observer.
const SNAPSHOT_MOVEMENT_THRESHOLD_M = 500;

// Coarse recency buckets for the UI freshness chip (Phase-2.5 three-tier).
//   <= 24h              → "recent"  → "Recently here"
//   > 24h, <= 7d        → "earlier" → "Earlier"
//   > 7d, <= 14d cutoff → "stale"   → "A while ago"
// No minutes / hours / "online now" — deliberately coarse for privacy.
const NEARBY_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEARBY_EARLIER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Phase-2.5 per-request map display jitter. The underlying stored coords are
// already snapped to LOCATION_GRID_METERS (~300m). The map renders a
// per-response randomized point INSIDE that same grid cell, so no stable or
// exact coordinate ever leaves the server. Radius is half the grid cell so
// the jittered point stays within the originating cell boundary.
const CELL_JITTER_RADIUS_M = LOCATION_GRID_METERS / 2;

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

// ---------------------------------------------------------------------------
// Nearby / Crossed Paths server-side consent gate
// ---------------------------------------------------------------------------
// Bump this string when the consent disclosure copy materially changes; any
// user whose nearbyConsentVersion does not match the current value is
// treated as un-consented and must re-accept the disclosure before any
// location / crossed-paths write is accepted server-side.
export const NEARBY_CONSENT_VERSION = 'nearby_crossed_paths_v1';

/**
 * Cap the crossing count we expose to clients at "3+". The raw count is
 * still tracked server-side (used for ordering and notification copy
 * thresholds) but UI never sees the precise number once it crosses 3.
 */
export function getCrossingCountDisplay(count: number): string {
  if (!Number.isFinite(count) || count <= 1) return '1';
  if (count === 2) return '2';
  return '3+';
}

/**
 * Server-side consent check. Returns true only when the user has explicitly
 * accepted the current Nearby / Crossed Paths disclosure. Defaults to false
 * when either field is missing so legacy clients cannot bypass the consent
 * flow.
 */
export function hasNearbyConsent(user: Doc<'users'>): boolean {
  return (
    typeof user.nearbyConsentAt === 'number' &&
    user.nearbyConsentAt > 0 &&
    user.nearbyConsentVersion === NEARBY_CONSENT_VERSION
  );
}

// Notification rate limiting
// Write-side cooldown: how often we update lastCrossedAt / append history per pair.
const CROSSED_PATH_WRITE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// Notification-side cooldown: how often we deliver a push for the same pair.
// Sliding window — a new push only after 6h since the previous push for this pair.
const CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_NOTIFICATIONS_PER_DAY = 3; // Maximum crossed-paths notifications per day per user
const CROSSED_PATH_NOTIFICATION_TITLE = 'Crossed Paths';
const CROSSED_PATH_NOTIFICATION_BODY = 'You crossed paths with someone nearby';

// Fix 7 — Daily distinct crossed-profile cap.
// Per-viewer cap on how many *new* crossed profiles can be surfaced in the
// Nearby feed in a single calendar day (UTC). Profiles the viewer already had
// a crossedPaths row for at the moment of display are not counted against the
// cap (a re-display of a known pair is "free").
const MAX_DAILY_NEW_CROSSED_PROFILES = 40;
const DAILY_SHOWN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Privacy Zones
const PRIVACY_ZONE_MAX_ZONES = 3;
const PRIVACY_ZONE_DEFAULT_RADIUS_METERS = 500;
const PRIVACY_ZONE_MIN_RADIUS_METERS = 200;
const PRIVACY_ZONE_MAX_RADIUS_METERS = 1000;
const PRIVACY_ZONE_LABEL_MAX_LENGTH = 32;
const PRIVACY_ZONE_AUDIT_ENABLED = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';

// ---------------------------------------------------------------------------
// GPS Jitter Protection Constants (server-side)
// ---------------------------------------------------------------------------

/** Maximum acceptable accuracy in meters for crossed-path detection */
const MAX_ACCURACY_FOR_CROSSING_METERS = 80;

/** Minimum movement in meters to trigger crossed-path detection.
 * PRODUCT FIX: unified to 25m across client + server. Previous 30m server
 * vs 60m client mismatch meant the server value was never actually reached
 * in normal flows. 25m is permissive enough to catch real crossings while
 * still filtering obvious stationary jitter. */
const MIN_MOVEMENT_FOR_CROSSING_METERS = 25;

/** Maximum realistic speed in meters per second for sanity check (~200 km/h) */
const MAX_SPEED_MPS = 55;

// ---------------------------------------------------------------------------
// Fix 3 — Impossible Travel / GPS spoof protection (server-side).
// ---------------------------------------------------------------------------
// Window we look back for the user's previously accepted location. Older
// points are ignored because reasonable travel can cover any distance.
const IMPOSSIBLE_TRAVEL_LOOKBACK_MS = 30 * 60 * 1000;
// Implied speed (km/h) above which we reject the new sample as impossible.
const IMPOSSIBLE_TRAVEL_MAX_SPEED_KMH = 250;
// Distance below which we never reject (avoid false positives from rapid
// re-publishes within a small radius).
const IMPOSSIBLE_TRAVEL_MIN_DISTANCE_KM = 2;
// Sliding window for the per-user reject counter.
const LOCATION_REJECT_WINDOW_MS = 24 * 60 * 60 * 1000;
// Threshold above which we set locationSpoofSuspect=true.
const LOCATION_REJECTS_TO_FLAG = 3;
// Treat rapid-fire rejects as a single event so a flapping client cannot
// burn through the suspect threshold in a few seconds.
const LOCATION_REJECT_DEDUPE_MS = 5000;
const LOCATION_SAFETY_AUDIT_ENABLED = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';

// ---------------------------------------------------------------------------
// "Someone crossed you" alert constants
// ---------------------------------------------------------------------------

const CROSS_COOLDOWN_MS = 60 * 60 * 1000;   // 1 hour between alerts (for faster feedback)
const CROSS_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h per person (prevents same-person spam)
const CROSS_EVENT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (cleanup)

// ---------------------------------------------------------------------------
// Deterministic dedupeKey generation for crossed paths
// Uses sorted user IDs to ensure A-B == B-A (symmetric).
// Stable per pair (no time bucket): one notification row per pair per recipient,
// upserted in place. Cooldown is enforced via createdAt comparison and the
// sliding CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS window.
// ---------------------------------------------------------------------------

/**
 * Generate a stable, symmetric dedupeKey for crossed-paths notifications.
 * Format: `crossed_paths:${minUserId}:${maxUserId}:pair`
 */
function makeCrossedPathsDedupeKey(userA: Id<'users'>, userB: Id<'users'>): string {
  const sorted = [userA as string, userB as string].sort();
  return `crossed_paths:${sorted[0]}:${sorted[1]}:pair`;
}

function orderUserPair(userA: Id<'users'>, userB: Id<'users'>): { user1Id: Id<'users'>; user2Id: Id<'users'> } {
  return userA < userB
    ? { user1Id: userA, user2Id: userB }
    : { user1Id: userB, user2Id: userA };
}

/**
 * Fix 7 — Daily distinct crossed-profile cap helpers.
 * Stable, symmetric pair key for the daily-shown ledger ("user1Id:user2Id").
 */
function makeDailyShownPairKey(viewerId: Id<'users'>, targetUserId: Id<'users'>): string {
  const { user1Id, user2Id } = orderUserPair(viewerId, targetUserId);
  return `${user1Id}:${user2Id}`;
}

/** UTC date slice ("YYYY-MM-DD") used as the ledger partition key. */
function getDailyShownDateKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Look up the (ordered) crossedPaths row for a pair without writing to it.
 * Used by the daily cap helper to check whether a candidate is "already
 * crossed" (free re-display) vs a brand-new surface.
 */
async function getCrossedPathPair(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userA: Id<'users'>,
  userB: Id<'users'>,
): Promise<Doc<'crossedPaths'> | null> {
  const { user1Id, user2Id } = orderUserPair(userA, userB);
  return await ctx.db
    .query('crossedPaths')
    .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
    .first();
}

/**
 * Apply the per-viewer daily cap on newly-surfaced crossed profiles.
 * Re-displays of profiles already shown today, or already in crossedPaths,
 * pass through unchanged. New pairs consume one slot until the daily quota
 * is exhausted.
 *
 * NOTE: this is read-only — it does NOT insert into crossedPathDailyShown.
 * The client is expected to call markDailyCrossedProfilesShown after the
 * list actually rendered so we only count items the user truly saw.
 */
async function applyDailyDistinctCrossedProfileCap<T extends { id: Id<'users'> | string }>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  viewerId: Id<'users'>,
  results: T[],
  now: number,
): Promise<T[]> {
  if (results.length === 0) return results;

  const dateKey = getDailyShownDateKey(now);
  const shownToday = await ctx.db
    .query('crossedPathDailyShown')
    .withIndex('by_viewer_date', (q: any) =>
      q.eq('viewerId', viewerId).eq('dateKey', dateKey),
    )
    .collect();

  const shownPairKeys = new Set<string>();
  const countedNewPairKeys = new Set<string>();
  for (const row of shownToday) {
    shownPairKeys.add(row.pairKey);
    if (row.wasExistingCrossedPath !== true) {
      countedNewPairKeys.add(row.pairKey);
    }
  }

  let remainingNewSlots = Math.max(
    0,
    MAX_DAILY_NEW_CROSSED_PROFILES - countedNewPairKeys.size,
  );

  const pairStates = await Promise.all(
    results.map(async (result) => {
      const targetUserId = result.id as Id<'users'>;
      const pairKey = makeDailyShownPairKey(viewerId, targetUserId);
      const existingCrossedPath = await getCrossedPathPair(ctx, viewerId, targetUserId);
      return {
        pairKey,
        alreadyShownToday: shownPairKeys.has(pairKey),
        alreadyCrossed: existingCrossedPath !== null,
      };
    }),
  );

  const capped: T[] = [];
  for (let i = 0; i < results.length; i++) {
    const state = pairStates[i];
    if (state.alreadyShownToday || state.alreadyCrossed) {
      capped.push(results[i]);
      continue;
    }
    if (remainingNewSlots > 0) {
      remainingNewSlots--;
      capped.push(results[i]);
    }
  }

  return capped;
}

/**
 * Stable per-pair dedupe prefix used to find ALL crossed-paths notifications
 * for a pair, regardless of dedupeKey suffix.
 */
function makeCrossedPathsPairDedupePrefix(userA: Id<'users'>, userB: Id<'users'>): string {
  const { user1Id, user2Id } = orderUserPair(userA, userB);
  return `crossed_paths:${user1Id}:${user2Id}:`;
}

/**
 * Returns true if the given notification belongs to the crossed-paths
 * pair (userA, userB). Matches by dedupeKey prefix, data.pairKey prefix,
 * or recipient/otherUserId fallback for older rows.
 */
function isCrossedPathNotificationForPair(
  notification: Doc<'notifications'>,
  userA: Id<'users'>,
  userB: Id<'users'>,
  pairPrefix: string,
): boolean {
  if (notification.type !== 'crossed_paths') return false;

  const dedupeKey = notification.dedupeKey;
  if (typeof dedupeKey === 'string' && dedupeKey.startsWith(pairPrefix)) {
    return true;
  }

  const pairKey = notification.data?.pairKey;
  if (typeof pairKey === 'string' && pairKey.startsWith(pairPrefix)) {
    return true;
  }

  const otherUserId = notification.data?.userId;
  return (
    (notification.userId === userA && otherUserId === (userB as string)) ||
    (notification.userId === userB && otherUserId === (userA as string))
  );
}

/**
 * Block-cleanup helper. Idempotent.
 * When user A blocks user B (or vice-versa), purge all crossed-paths state
 * for the pair: crossedPaths row, crossPathHistory rows (both directions of
 * pair ordering), crossedEvents in both directions, and any crossed-paths
 * notifications for either side that reference the pair.
 */
export const purgeCrossedPathPairForBlock = internalMutation({
  args: {
    userAId: v.id('users'),
    userBId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userAId, userBId } = args;
    if (userAId === userBId) {
      return {
        crossedPathsDeleted: 0,
        historyDeleted: 0,
        crossedEventsDeleted: 0,
        notificationsDeleted: 0,
      };
    }

    const { user1Id, user2Id } = orderUserPair(userAId, userBId);
    const pairPrefix = makeCrossedPathsPairDedupePrefix(userAId, userBId);

    let crossedPathsDeleted = 0;
    const crossedPathRows = await ctx.db
      .query('crossedPaths')
      .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .collect();
    for (const row of crossedPathRows) {
      await ctx.db.delete(row._id);
      crossedPathsDeleted++;
    }

    let historyDeleted = 0;
    const historyRows = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_users', (q) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .collect();
    for (const row of historyRows) {
      await ctx.db.delete(row._id);
      historyDeleted++;
    }

    let crossedEventsDeleted = 0;
    const eventRows = await Promise.all([
      ctx.db
        .query('crossedEvents')
        .withIndex('by_user_other', (q) =>
          q.eq('userId', userAId).eq('otherUserId', userBId),
        )
        .collect(),
      ctx.db
        .query('crossedEvents')
        .withIndex('by_user_other', (q) =>
          q.eq('userId', userBId).eq('otherUserId', userAId),
        )
        .collect(),
    ]);
    for (const row of eventRows.flat()) {
      await ctx.db.delete(row._id);
      crossedEventsDeleted++;
    }

    let notificationsDeleted = 0;
    const notificationRows = await Promise.all([
      ctx.db
        .query('notifications')
        .withIndex('by_user', (q) => q.eq('userId', userAId))
        .collect(),
      ctx.db
        .query('notifications')
        .withIndex('by_user', (q) => q.eq('userId', userBId))
        .collect(),
    ]);
    for (const row of notificationRows.flat()) {
      if (!isCrossedPathNotificationForPair(row, userAId, userBId, pairPrefix)) continue;
      await ctx.db.delete(row._id);
      notificationsDeleted++;
    }

    return {
      crossedPathsDeleted,
      historyDeleted,
      crossedEventsDeleted,
      notificationsDeleted,
    };
  },
});

async function getCrossedPathForPair(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userA: Id<'users'>,
  userB: Id<'users'>,
): Promise<Doc<'crossedPaths'> | null> {
  const { user1Id, user2Id } = orderUserPair(userA, userB);
  return await ctx.db
    .query('crossedPaths')
    .withIndex('by_users', (q: any) =>
      q.eq('user1Id', user1Id).eq('user2Id', user2Id),
    )
    .first();
}

// ---------------------------------------------------------------------------
// Fix 3 — Impossible Travel / GPS spoof protection helpers.
// ---------------------------------------------------------------------------
function isValidLatLng(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

type AcceptedLocationPoint = {
  latitude: number;
  longitude: number;
  acceptedAt: number;
};

function calculateDistanceKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  return (
    calculateDistanceMeters(fromLatitude, fromLongitude, toLatitude, toLongitude) / 1000
  );
}

function calculateImpliedSpeedKmh(distanceKm: number, elapsedMs: number): number | null {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return null;
  }
  const timeHours = elapsedMs / (60 * 60 * 1000);
  if (timeHours <= 0) return null;
  return distanceKm / timeHours;
}

/**
 * Returns the most recent accepted location for the user (preferring the
 * later of `latitude`/`longitude` + `lastLocationUpdatedAt` and
 * `publishedLat`/`publishedLng` + `publishedAt`).
 * Returns null when no valid prior point is on file.
 */
function getLatestAcceptedLocation(user: Doc<'users'>): AcceptedLocationPoint | null {
  const candidates: AcceptedLocationPoint[] = [];

  if (
    typeof user.latitude === 'number' &&
    typeof user.longitude === 'number' &&
    typeof user.lastLocationUpdatedAt === 'number' &&
    isValidLatLng(user.latitude, user.longitude)
  ) {
    candidates.push({
      latitude: user.latitude,
      longitude: user.longitude,
      acceptedAt: user.lastLocationUpdatedAt,
    });
  }

  if (
    typeof user.publishedLat === 'number' &&
    typeof user.publishedLng === 'number' &&
    typeof user.publishedAt === 'number' &&
    isValidLatLng(user.publishedLat, user.publishedLng)
  ) {
    candidates.push({
      latitude: user.publishedLat,
      longitude: user.publishedLng,
      acceptedAt: user.publishedAt,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.acceptedAt - a.acceptedAt);
  return candidates[0];
}

/**
 * Pure function — decides whether the proposed `next` location is safe to
 * accept given a `previous` accepted point. Rejects only on clearly
 * impossible travel (>250 km/h implied speed over >=2 km / <=30min) or on
 * malformed coordinates.
 */
function evaluateImpossibleTravel(
  previous: AcceptedLocationPoint | null,
  next: AcceptedLocationPoint,
): {
  rejected: boolean;
  reason?: 'suspicious_location' | 'impossible_travel';
  speedKmh?: number;
  previousAcceptedAt?: number;
} {
  if (!isValidLatLng(next.latitude, next.longitude)) {
    return { rejected: true, reason: 'suspicious_location' };
  }

  if (
    !previous ||
    !isValidLatLng(previous.latitude, previous.longitude) ||
    !Number.isFinite(previous.acceptedAt) ||
    !Number.isFinite(next.acceptedAt)
  ) {
    return { rejected: false };
  }

  const elapsedMs = next.acceptedAt - previous.acceptedAt;
  if (elapsedMs <= 0 || elapsedMs > IMPOSSIBLE_TRAVEL_LOOKBACK_MS) {
    return { rejected: false };
  }

  const distanceKm = calculateDistanceKm(
    previous.latitude,
    previous.longitude,
    next.latitude,
    next.longitude,
  );
  if (distanceKm < IMPOSSIBLE_TRAVEL_MIN_DISTANCE_KM) {
    return { rejected: false };
  }

  const speedKmh = calculateImpliedSpeedKmh(distanceKm, elapsedMs);
  if (speedKmh === null || speedKmh <= IMPOSSIBLE_TRAVEL_MAX_SPEED_KMH) {
    return { rejected: false };
  }

  return {
    rejected: true,
    reason: 'impossible_travel',
    speedKmh,
    previousAcceptedAt: previous.acceptedAt,
  };
}

/**
 * Persist a server-side reject. Implements:
 *   - 5s dedupe window (rapid-fire rejects count as one)
 *   - 24h sliding reject-count window
 *   - flips `locationSpoofSuspect` once 3 rejects accumulate inside the
 *     same 24h window. The flag is sticky (we only set, never clear here).
 */
async function recordLocationSafetyReject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>,
  rejection: { reason?: string; speedKmh?: number; previousAcceptedAt?: number },
): Promise<void> {
  if (rejection.reason !== 'impossible_travel') return;

  const now = Date.now();
  const latestUser = await ctx.db.get(userId);
  if (!latestUser) return;

  if (
    typeof latestUser.locationLastRejectAt === 'number' &&
    now - latestUser.locationLastRejectAt < LOCATION_REJECT_DEDUPE_MS
  ) {
    return;
  }

  const existingWindowStart = latestUser.locationRejectWindowStartedAt;
  const inExistingWindow =
    typeof existingWindowStart === 'number' &&
    now - existingWindowStart <= LOCATION_REJECT_WINDOW_MS;
  const windowStartedAt = inExistingWindow ? existingWindowStart : now;
  const previousCount = inExistingWindow ? latestUser.locationRejectCount ?? 0 : 0;
  const nextCount = previousCount + 1;
  const shouldFlag = nextCount >= LOCATION_REJECTS_TO_FLAG;

  const updates: Record<string, unknown> = {
    locationRejectCount: nextCount,
    locationRejectWindowStartedAt: windowStartedAt,
    locationLastRejectAt: now,
  };

  if (shouldFlag) {
    updates.locationSpoofSuspect = true;
    updates.locationSpoofSuspectAt = latestUser.locationSpoofSuspectAt ?? now;
  }

  await ctx.db.patch(userId, updates);

  if (LOCATION_SAFETY_AUDIT_ENABLED) {
    console.log('[LOCATION_SAFETY] impossible travel rejected', {
      speedKmh: rejection.speedKmh ? Math.round(rejection.speedKmh) : null,
      rejectCount: nextCount,
      flagged: shouldFlag,
      previousAcceptedAt: rejection.previousAcceptedAt ?? null,
    });
  }
}

/**
 * Convenience wrapper: read the user's latest accepted point, evaluate the
 * incoming sample, and (on reject) record the safety event. Callers should
 * abort their write/upsert path when this returns rejected=true.
 */
async function rejectIfUnsafeLocation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>,
  user: Doc<'users'>,
  latitude: number,
  longitude: number,
  acceptedAt: number,
): Promise<{ rejected: boolean; reason?: 'suspicious_location' | 'impossible_travel' }> {
  const rejection = evaluateImpossibleTravel(getLatestAcceptedLocation(user), {
    latitude,
    longitude,
    acceptedAt,
  });

  if (!rejection.rejected) return { rejected: false };
  await recordLocationSafetyReject(ctx, userId, rejection);
  return { rejected: true, reason: rejection.reason };
}

function isPairDismissedForViewer(
  crossedPath: Doc<'crossedPaths'> | null | undefined,
  viewerId: Id<'users'>,
): boolean {
  if (!crossedPath) return false;
  const dismissals = crossedPath as Doc<'crossedPaths'> & {
    dismissedByUser1At?: number;
    dismissedByUser2At?: number;
  };
  if (dismissals.user1Id === viewerId) {
    return typeof dismissals.dismissedByUser1At === 'number';
  }
  if (dismissals.user2Id === viewerId) {
    return typeof dismissals.dismissedByUser2At === 'number';
  }
  return false;
}

function getPairDismissPatchForViewer(
  user1Id: Id<'users'>,
  user2Id: Id<'users'>,
  viewerId: Id<'users'>,
  now: number,
): { dismissedByUser1At?: number; dismissedByUser2At?: number } {
  if (viewerId === user1Id) return { dismissedByUser1At: now };
  if (viewerId === user2Id) return { dismissedByUser2At: now };
  return {};
}

function getHistoryHiddenPatchForViewer(
  user1Id: Id<'users'>,
  user2Id: Id<'users'>,
  viewerId: Id<'users'>,
): { hiddenByUser1?: boolean; hiddenByUser2?: boolean } {
  if (viewerId === user1Id) return { hiddenByUser1: true };
  if (viewerId === user2Id) return { hiddenByUser2: true };
  return {};
}

function getHistoryHiddenPatchForDismissedPair(
  crossedPath: Doc<'crossedPaths'> | null | undefined,
  user1Id: Id<'users'>,
  user2Id: Id<'users'>,
): { hiddenByUser1?: boolean; hiddenByUser2?: boolean } {
  const patch: { hiddenByUser1?: boolean; hiddenByUser2?: boolean } = {};
  if (crossedPath && isPairDismissedForViewer(crossedPath, user1Id)) {
    patch.hiddenByUser1 = true;
  }
  if (crossedPath && isPairDismissedForViewer(crossedPath, user2Id)) {
    patch.hiddenByUser2 = true;
  }
  return patch;
}

async function setPairDismissedForViewer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  viewerId: Id<'users'>,
  otherUserId: Id<'users'>,
  now: number,
): Promise<{ user1Id: Id<'users'>; user2Id: Id<'users'> }> {
  const { user1Id, user2Id } = orderUserPair(viewerId, otherUserId);
  const dismissPatch = getPairDismissPatchForViewer(user1Id, user2Id, viewerId, now);
  const crossedPath = await getCrossedPathForPair(ctx, user1Id, user2Id);

  if (crossedPath) {
    await ctx.db.patch(crossedPath._id, dismissPatch);
  } else {
    // Rare legacy case: a history row exists without its pair row. Insert a
    // dismiss-only pair row so future crossings stay hidden for this viewer.
    await ctx.db.insert('crossedPaths', {
      user1Id,
      user2Id,
      count: 0,
      lastCrossedAt: now,
      ...dismissPatch,
    });
  }

  return { user1Id, user2Id };
}

async function hideActiveHistoryRowsForViewer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  viewerId: Id<'users'>,
  user1Id: Id<'users'>,
  user2Id: Id<'users'>,
  now: number,
) {
  const hiddenPatch = getHistoryHiddenPatchForViewer(user1Id, user2Id, viewerId);
  if (!hiddenPatch.hiddenByUser1 && !hiddenPatch.hiddenByUser2) return;

  const histories = await ctx.db
    .query('crossPathHistory')
    .withIndex('by_users', (q: any) =>
      q.eq('user1Id', user1Id).eq('user2Id', user2Id),
    )
    .collect();

  for (const entry of histories as Doc<'crossPathHistory'>[]) {
    if (entry.expiresAt <= now) continue;
    const alreadyHidden =
      (hiddenPatch.hiddenByUser1 && entry.hiddenByUser1 === true) ||
      (hiddenPatch.hiddenByUser2 && entry.hiddenByUser2 === true);
    if (alreadyHidden) continue;
    await ctx.db.patch(entry._id, hiddenPatch);
  }
}

// STABILITY FIX (Crossed Paths): pick a marker coordinate that does NOT
// move on repeat crossings. Resolution order:
//   1. firstCrossingLatitude/Longitude on the pair record (set on first
//      ever crossing, never patched).
//   2. earliestEntry coordinates from crossPathHistory (immutable per-event).
//   3. legacy crossingLatitude/Longitude on the pair record (latest value;
//      used only as last-resort fallback for rows that pre-date this fix).
//   4. latestEntry coordinates as a final fallback.
// Returns null if no usable approximate coordinate is available.
function pickStableCrossingCoords(
  crossedPath: Doc<'crossedPaths'> | null | undefined,
  earliestEntry: Doc<'crossPathHistory'> | undefined,
  latestEntry: Doc<'crossPathHistory'> | undefined,
): { lat: number; lng: number } | null {
  if (
    crossedPath &&
    typeof (crossedPath as any).firstCrossingLatitude === 'number' &&
    typeof (crossedPath as any).firstCrossingLongitude === 'number'
  ) {
    return {
      lat: (crossedPath as any).firstCrossingLatitude as number,
      lng: (crossedPath as any).firstCrossingLongitude as number,
    };
  }
  if (
    earliestEntry &&
    typeof earliestEntry.crossedLatApprox === 'number' &&
    typeof earliestEntry.crossedLngApprox === 'number'
  ) {
    return { lat: earliestEntry.crossedLatApprox, lng: earliestEntry.crossedLngApprox };
  }
  if (
    crossedPath &&
    typeof crossedPath.crossingLatitude === 'number' &&
    typeof crossedPath.crossingLongitude === 'number'
  ) {
    return { lat: crossedPath.crossingLatitude, lng: crossedPath.crossingLongitude };
  }
  if (
    latestEntry &&
    typeof latestEntry.crossedLatApprox === 'number' &&
    typeof latestEntry.crossedLngApprox === 'number'
  ) {
    return { lat: latestEntry.crossedLatApprox, lng: latestEntry.crossedLngApprox };
  }
  return null;
}

async function getDismissedOtherUserIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  viewerId: Id<'users'>,
  otherUserIds: string[],
): Promise<Set<string>> {
  const uniqueOtherUserIds = [...new Set(otherUserIds)];
  const checks = await Promise.all(
    uniqueOtherUserIds.map(async (otherUserId) => {
      const crossedPath = await getCrossedPathForPair(
        ctx,
        viewerId,
        otherUserId as Id<'users'>,
      );
      return crossedPath && isPairDismissedForViewer(crossedPath, viewerId)
        ? otherUserId
        : null;
    }),
  );
  return new Set(checks.filter((id): id is string => id !== null));
}

function sanitizePrivacyZoneLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new Error('Privacy Zone name is required.');
  }
  if (trimmed.length > PRIVACY_ZONE_LABEL_MAX_LENGTH) {
    throw new Error(`Privacy Zone name must be ${PRIVACY_ZONE_LABEL_MAX_LENGTH} characters or less.`);
  }
  return trimmed;
}

function validatePrivacyZoneCoordinate(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('Privacy Zone latitude is invalid.');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Privacy Zone longitude is invalid.');
  }
}

function validatePrivacyZoneRadius(radiusMeters: number | undefined): number {
  const radius = radiusMeters ?? PRIVACY_ZONE_DEFAULT_RADIUS_METERS;
  if (!Number.isFinite(radius)) {
    throw new Error('Privacy Zone radius is invalid.');
  }
  if (
    radius < PRIVACY_ZONE_MIN_RADIUS_METERS ||
    radius > PRIVACY_ZONE_MAX_RADIUS_METERS
  ) {
    throw new Error(
      `Privacy Zone radius must be between ${PRIVACY_ZONE_MIN_RADIUS_METERS}m and ${PRIVACY_ZONE_MAX_RADIUS_METERS}m.`,
    );
  }
  return Math.round(radius);
}

async function resolvePrivacyZoneOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  authUserId: string,
): Promise<Id<'users'>> {
  const userId = await resolveUserIdByAuthId(ctx, authUserId);
  if (!userId) {
    throw new Error('Unauthorized: user not found');
  }
  return userId;
}

async function getPrivacyZonesForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>,
): Promise<Doc<'privacyZones'>[]> {
  return await ctx.db
    .query('privacyZones')
    .withIndex('by_userId', (q: any) => q.eq('userId', userId))
    .collect();
}

function isPointInsidePrivacyZone(
  latitude: number,
  longitude: number,
  zone: Pick<Doc<'privacyZones'>, 'latitude' | 'longitude' | 'radiusMeters'>,
): boolean {
  const distance = calculateDistanceMeters(
    latitude,
    longitude,
    zone.latitude,
    zone.longitude,
  );
  return distance <= zone.radiusMeters;
}

async function isPointInsideUserPrivacyZone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>,
  latitude: number,
  longitude: number,
  prefetchedZones?: Doc<'privacyZones'>[],
): Promise<boolean> {
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    return false;
  }

  const zones = prefetchedZones ?? await getPrivacyZonesForUser(ctx, userId);
  return zones.some((zone) => isPointInsidePrivacyZone(latitude, longitude, zone));
}

function logPrivacyZoneSkip(source: string, userId: Id<'users'> | string) {
  if (!PRIVACY_ZONE_AUDIT_ENABLED) return;
  console.log('[PRIVACY_ZONE] skipped location write', {
    source,
    userId,
    reason: 'privacy_zone',
  });
}

export const listPrivacyZones = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await resolvePrivacyZoneOwner(ctx, args.authUserId);
    const zones = await getPrivacyZonesForUser(ctx, userId);
    return zones
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((zone) => ({
        _id: zone._id,
        userId: zone.userId,
        label: zone.label,
        latitude: zone.latitude,
        longitude: zone.longitude,
        radiusMeters: zone.radiusMeters,
        createdAt: zone.createdAt,
        updatedAt: zone.updatedAt,
      }));
  },
});

export const upsertPrivacyZone = mutation({
  args: {
    authUserId: v.string(),
    zoneId: v.optional(v.id('privacyZones')),
    label: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await resolvePrivacyZoneOwner(ctx, args.authUserId);
    const label = sanitizePrivacyZoneLabel(args.label);
    validatePrivacyZoneCoordinate(args.latitude, args.longitude);
    const radiusMeters = validatePrivacyZoneRadius(args.radiusMeters);
    const now = Date.now();

    if (args.zoneId) {
      const existing = await ctx.db.get(args.zoneId);
      if (!existing || existing.userId !== userId) {
        throw new Error('Privacy Zone not found.');
      }
      await ctx.db.patch(args.zoneId, {
        label,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusMeters,
        updatedAt: now,
      });
      return { success: true, zoneId: args.zoneId };
    }

    const existingZones = await getPrivacyZonesForUser(ctx, userId);
    if (existingZones.length >= PRIVACY_ZONE_MAX_ZONES) {
      throw new Error(`You can create up to ${PRIVACY_ZONE_MAX_ZONES} Privacy Zones.`);
    }

    const zoneId = await ctx.db.insert('privacyZones', {
      userId,
      label,
      latitude: args.latitude,
      longitude: args.longitude,
      radiusMeters,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, zoneId };
  },
});

export const deletePrivacyZone = mutation({
  args: {
    authUserId: v.string(),
    zoneId: v.id('privacyZones'),
  },
  handler: async (ctx, args) => {
    const userId = await resolvePrivacyZoneOwner(ctx, args.authUserId);
    const existing = await ctx.db.get(args.zoneId);
    if (!existing || existing.userId !== userId) {
      throw new Error('Privacy Zone not found.');
    }

    await ctx.db.delete(args.zoneId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// publishLocation — updates published location (max once per 6 hours)
// Called when Nearby screen is opened. Others see publishedLat/Lng, not live GPS.
// ---------------------------------------------------------------------------

export const publishLocation = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    // Resolve authUserId to Convex ID if needed
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      return { published: false, publishedAt: null, reason: 'user_not_found' };
    }
    const { latitude, longitude } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) return { success: false, reason: 'user_not_found' };

    // P1-2: Verification gate — unverified users must not publish a location.
    // Keeps publishLocation consistent with detectCrossedUsers/recordLocation,
    // which already skip crossing work for unverified callers.
    const currentStatus = user.verificationStatus || 'unverified';
    // DEV-ONLY bypass: allow unverified users to publish when demo auth mode is
    // enabled on the Convex deployment env. Production behavior is unchanged
    // because EXPO_PUBLIC_DEMO_AUTH_MODE must be explicitly set to the string
    // "true" on the Convex deployment (not just the Expo client bundle) for
    // this bypass to engage.
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentStatus !== 'verified' && !isDevBypass) {
      return { success: false, published: false, reason: 'unverified' };
    }

    // P1.6: Caller opt-out — a verified user who has disabled Nearby or is
    // actively paused must not publish a location. Mirrors the opt-out gates
    // in recordLocation (P1-1) and detectCrossedUsers (P1.5-1) so the
    // "Show me in Nearby" / "Pause Nearby" promise holds for publish too.
    if (user.nearbyEnabled === false) {
      return { success: false, published: false, reason: 'disabled_or_paused' };
    }
    if (user.nearbyPausedUntil && user.nearbyPausedUntil > now) {
      return { success: false, published: false, reason: 'disabled_or_paused' };
    }
    if (user.incognitoMode === true) {
      return { success: false, published: false, reason: 'incognito' };
    }

    // Server-side consent gate: drop writes from clients that have not
    // accepted the current Nearby / Crossed Paths disclosure.
    if (!hasNearbyConsent(user)) {
      return { success: false, published: false, reason: 'consent_required' };
    }

    // Fix 3 — Impossible Travel / GPS spoof protection. Reject writes that
    // imply >250 km/h travel from the user's last accepted point and bump
    // server-side counters; surfacing 'suspicious_location' or
    // 'impossible_travel' as the reject reason.
    const locationSafety = await rejectIfUnsafeLocation(
      ctx,
      userId,
      user,
      latitude,
      longitude,
      now,
    );
    if (locationSafety.rejected) {
      return {
        success: false,
        published: false,
        reason: locationSafety.reason ?? 'suspicious_location',
      };
    }

    if (await isPointInsideUserPrivacyZone(ctx, userId, latitude, longitude)) {
      logPrivacyZoneSkip('publishLocation', userId);
      return { success: true, published: false, skipped: true, reason: 'privacy_zone' };
    }

    // Safe Nearby v2 — Snapshot regeneration gate.
    // A new snapshot is allowed only when BOTH:
    //   (a) the previous snapshot is at least 6 hours old (PUBLISH_WINDOW_MS), AND
    //   (b) the user has moved at least 500 m from their previous snapshot cell.
    // The 6h gate locks the snapshot in place to prevent live-tracking via
    // refresh; the 500 m gate prevents same-cell re-snapshots from leaking
    // home/work location to observers who watch the publish cadence.
    if (user.publishedAt) {
      const elapsed = now - user.publishedAt;
      if (elapsed < PUBLISH_WINDOW_MS) {
        return {
          success: true,
          published: false,
          reason: 'within_window',
          nextPublishAt: user.publishedAt + PUBLISH_WINDOW_MS,
        };
      }
      if (
        typeof user.publishedLat === 'number' &&
        typeof user.publishedLng === 'number'
      ) {
        const movedMeters = calculateDistanceMeters(
          user.publishedLat,
          user.publishedLng,
          latitude,
          longitude,
        );
        if (movedMeters < SNAPSHOT_MOVEMENT_THRESHOLD_M) {
          return {
            success: true,
            published: false,
            reason: 'no_movement',
          };
        }
      }
    }

    // Phase-1 privacy fix: snap incoming coords to the 300m grid BEFORE writing.
    // Database no longer stores raw exact map coordinates for Nearby's published
    // position — this closes the server-side exposure even if the DB leaks.
    // Reuses the same roundToGrid helper already used by crossPathHistory so
    // both pipelines share the same precision floor.
    const snapped = roundToGrid(latitude, longitude);

    // Publish new location
    await ctx.db.patch(userId, {
      publishedLat: snapped.lat,
      publishedLng: snapped.lng,
      publishedAt: now,
      // Keep the crossed-path candidate fields in sync with the privacy-safe
      // published snapshot. recordLocation candidate filtering reads
      // users.latitude/users.longitude, so publish-only users still need a
      // compatible coarse location without storing exact GPS.
      latitude: snapped.lat,
      longitude: snapped.lng,
      lastLocationUpdatedAt: now,
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
// Uses recent sample-created crossPathHistory rows, not published snapshots.
// Returns { triggered: true } if alert should be shown, never reveals identity.
// This keeps the generic alert consistent with recordLocation /
// recordLocationBatch / detectCrossingsForSample crossed-path matching.
// ---------------------------------------------------------------------------

export const detectCrossedUsers = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    token: v.optional(v.string()),
    myLat: v.number(),
    myLng: v.number(),
  },
  handler: async (ctx, args) => {
    const { myLat, myLng } = args;
    const now = Date.now();

    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!resolvedUserId) {
      return { triggered: false, reason: 'user_not_found' };
    }
    let userId = resolvedUserId;
    const sessionToken = typeof args.token === 'string' ? args.token.trim() : '';
    if (sessionToken) {
      const tokenUserId = await validateSessionToken(ctx, sessionToken);
      if (!tokenUserId) {
        return { triggered: false, reason: 'not_authenticated' };
      }
      if (tokenUserId !== resolvedUserId) {
        return { triggered: false, reason: 'session_user_mismatch' };
      }
      userId = tokenUserId;
    }

    // 1) Validate user exists
    const currentUser = await ctx.db.get(userId);
    if (!currentUser) {
      return { triggered: false, reason: 'user_not_found' };
    }

    // P1.5-1: Caller opt-out — if Nearby is disabled or actively paused for
    // the caller, we must not run detection logic and must not insert any
    // crossedEvents row. Mirrors the recordLocation opt-out from P1-1 so the
    // "Show me in Nearby" / "Pause Nearby" UI promises hold end-to-end.
    if (currentUser.nearbyEnabled === false) {
      return { triggered: false, reason: 'disabled_or_paused' };
    }
    if (currentUser.nearbyPausedUntil && currentUser.nearbyPausedUntil > now) {
      return { triggered: false, reason: 'disabled_or_paused' };
    }
    // Phase-2: caller must also be opted into crossed-paths recording for
    // "Someone crossed you" alerts to fire. Treat undefined as opted-in.
    if (currentUser.recordCrossedPaths === false) {
      return { triggered: false, reason: 'crossed_paths_opt_out' };
    }
    if (currentUser.incognitoMode === true) {
      return { triggered: false, reason: 'incognito' };
    }
    // Server-side consent gate.
    if (!hasNearbyConsent(currentUser)) {
      return { triggered: false, reason: 'consent_required' };
    }
    // Fix 3 — Impossible Travel / GPS spoof protection.
    const locationSafety = await rejectIfUnsafeLocation(
      ctx,
      userId,
      currentUser,
      myLat,
      myLng,
      now,
    );
    if (locationSafety.rejected) {
      return { triggered: false, reason: locationSafety.reason ?? 'suspicious_location' };
    }
    if (await isPointInsideUserPrivacyZone(ctx, userId, myLat, myLng)) {
      logPrivacyZoneSkip('detectCrossedUsers', userId);
      return { triggered: false, reason: 'privacy_zone' };
    }

    // 2) Enforce cooldown — check most recent crossedEvent for this user
    const lastEvent = await ctx.db
      .query('crossedEvents')
      .withIndex('by_user_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .first();

    if (lastEvent && now - lastEvent.createdAt < CROSS_COOLDOWN_MS) {
      return { triggered: false, reason: 'cooldown' };
    }

    const currentStatus = currentUser.verificationStatus || 'unverified';
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentStatus !== 'verified' && !isDevBypass) {
      return { triggered: false, reason: 'unverified' };
    }
    if (!currentUser.name || !currentUser.bio || !currentUser.dateOfBirth) {
      return { triggered: false, reason: 'profile_incomplete' };
    }

    const {
      blockedUserIds: blockedIds,
      unmatchedUserIds,
      viewerReportedIds,
    } = await loadDiscoveryExclusions(ctx, userId);
    const myAge = calculateAge(currentUser.dateOfBirth);

    // Alert source is the same history rows written by the sample matchers.
    // This avoids a second, looser published-location crossing model.
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

    const recentHistoryCandidates: Array<{ otherUserId: Id<'users'> }> = [];
    const seenOtherUserIds = new Set<string>();
    const recentHistories = [...asUser1, ...asUser2]
      .filter((entry: Doc<'crossPathHistory'>) => {
        if (entry.expiresAt <= now) return false;
        if (now - entry.createdAt > SAMPLE_TIME_WINDOW_MS) return false;
        const isUser1 = entry.user1Id === userId;
        if (isUser1 && entry.hiddenByUser1) return false;
        if (!isUser1 && entry.hiddenByUser2) return false;
        return true;
      })
      .sort(
        (a: Doc<'crossPathHistory'>, b: Doc<'crossPathHistory'>) =>
          b.createdAt - a.createdAt,
      );

    for (const history of recentHistories) {
      const otherUserId = history.user1Id === userId ? history.user2Id : history.user1Id;
      const otherUserKey = otherUserId as string;
      if (seenOtherUserIds.has(otherUserKey)) continue;
      seenOtherUserIds.add(otherUserKey);
      recentHistoryCandidates.push({ otherUserId });
    }

    for (const { otherUserId } of recentHistoryCandidates) {
      const otherUserKey = otherUserId as string;
      if (blockedIds.has(otherUserKey)) continue;
      if (unmatchedUserIds.has(otherUserKey)) continue;
      if (viewerReportedIds.has(otherUserKey)) continue;

      const otherUser = await ctx.db.get(otherUserId);
      if (!otherUser || otherUser._id === userId) continue;
      if (!otherUser.isActive) continue;
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;
      if (otherUser.recordCrossedPaths === false) continue;
      if (otherUser.incognitoMode === true) continue;
      if (!otherUser.name || !otherUser.bio || !otherUser.dateOfBirth) continue;

      const otherStatus = otherUser.verificationStatus || 'unverified';
      if (otherStatus !== 'verified' && !isDevBypass) continue;

      const otherAge = calculateAge(otherUser.dateOfBirth);
      if (myAge < otherUser.minAge || myAge > otherUser.maxAge) continue;
      if (otherAge < currentUser.minAge || otherAge > currentUser.maxAge) continue;
      if (
        !orientationAllowsCandidateGender({
          viewerGender: currentUser.gender,
          viewerOrientation: currentUser.orientation ?? undefined,
          candidateGender: otherUser.gender,
        }) ||
        !orientationAllowsCandidateGender({
          viewerGender: otherUser.gender,
          viewerOrientation: otherUser.orientation ?? undefined,
          candidateGender: currentUser.gender,
        })
      ) continue;
      if (!currentUser.lookingFor.includes(otherUser.gender)) continue;
      if (!otherUser.lookingFor.includes(currentUser.gender)) continue;

      const crossedPath = await getCrossedPathForPair(ctx, userId, otherUserId);
      if (!crossedPath || isPairDismissedForViewer(crossedPath, userId)) continue;

      const existingEvent = await ctx.db
        .query('crossedEvents')
        .withIndex('by_user_other', (q) =>
          q.eq('userId', userId).eq('otherUserId', otherUserId),
        )
        .first();
      if (existingEvent && now - existingEvent.createdAt < CROSS_DEDUPE_WINDOW_MS) {
        continue;
      }

      await ctx.db.insert('crossedEvents', {
        userId,
        otherUserId,
        createdAt: now,
        expiresAt: now + CROSS_EVENT_EXPIRY_MS,
      });

      // Return triggered: true — client shows generic "Someone crossed you" toast
      // IMPORTANT: We do NOT return otherUserId or any identity info
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
// ---------------------------------------------------------------------------

export const recordLocation = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()), // Accept both Convex ID and authUserId
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.optional(v.number()), // GPS accuracy in meters (for jitter protection)
  },
  handler: async (ctx, args) => {
    // Resolve authUserId to Convex ID if needed
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) {
      return { nearbyCount: 0, reason: 'user_not_found' };
    }
    const { latitude, longitude, accuracy } = args;
    const now = Date.now();

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return { success: false };

    // [CROSSED_PATHS_AUDIT] dev-only gate — emits structured logs so we can
    // trace every accepted/rejected candidate during QA. Can be flipped to
    // false to silence without removing the logging blocks.
    const CROSSED_PATHS_AUDIT_ENABLED = true;

    // P1-1: Caller opt-out — if the user has disabled Nearby or paused it,
    // we must NOT record any location/crossings for them. The UI promises
    // "Show me in Nearby" and "Pause Nearby" include both map visibility
    // AND crossing detection; respect that end-to-end.
    if (currentUser.nearbyEnabled === false) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'disabled_or_paused' };
    }
    if (currentUser.nearbyPausedUntil && currentUser.nearbyPausedUntil > now) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'disabled_or_paused' };
    }
    // Crossed-paths is a separate opt-in from "Show me in Nearby".
    // If the caller has explicitly turned off "Save crossed paths" we must
    // not insert any crossedPaths / crossPathHistory / crossedEvents rows for
    // them. Map visibility (publishLocation / getNearbyUsers) is unaffected.
    // Treat undefined as true for backward compatibility with existing users.
    if (currentUser.recordCrossedPaths === false) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'crossed_paths_opt_out' };
    }
    if (currentUser.incognitoMode === true) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'incognito' };
    }
    // Server-side consent gate.
    if (!hasNearbyConsent(currentUser)) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'consent_required' };
    }
    // Fix 3 — Impossible Travel / GPS spoof protection.
    const locationSafety = await rejectIfUnsafeLocation(
      ctx,
      userId,
      currentUser,
      latitude,
      longitude,
      now,
    );
    if (locationSafety.rejected) {
      return {
        success: true,
        nearbyCount: 0,
        skipped: true,
        reason: locationSafety.reason ?? 'suspicious_location',
      };
    }
    const currentUserPrivacyZones = await getPrivacyZonesForUser(ctx, userId);
    if (
      await isPointInsideUserPrivacyZone(
        ctx,
        userId,
        latitude,
        longitude,
        currentUserPrivacyZones,
      )
    ) {
      logPrivacyZoneSkip('recordLocation', userId);
      return { success: true, nearbyCount: 0, skipped: true, reason: 'privacy_zone' };
    }

    // ---------------------------------------------------------------------------
    // GPS JITTER PROTECTION (server-side)
    // ---------------------------------------------------------------------------

    // 1. Accuracy filter: reject low-accuracy points for crossed-path detection
    const accuracyTooLow = accuracy !== undefined && accuracy > MAX_ACCURACY_FOR_CROSSING_METERS;

    // 2. Speed sanity check: detect impossible jumps
    let impossibleSpeed = false;
    let movementTooSmall = false;
    const lastUpdateWasPublishMirror = Boolean(
      currentUser.lastLocationUpdatedAt &&
      currentUser.publishedAt === currentUser.lastLocationUpdatedAt &&
      currentUser.publishedLat === currentUser.latitude &&
      currentUser.publishedLng === currentUser.longitude
    );

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

    // 30-minute gate: skip tiny repeats, but still allow meaningful foreground
    // movement through so Nearby can detect 25-40m crossed-path walks.
    const withinLocationUpdateWindow = Boolean(
      currentUser.lastLocationUpdatedAt &&
      now - currentUser.lastLocationUpdatedAt < LOCATION_UPDATE_INTERVAL_MS
    );
    if (withinLocationUpdateWindow && movementTooSmall && !lastUpdateWasPublishMirror) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'within_location_update_window' };
    }

    const snappedCurrentLocation = roundToGrid(latitude, longitude);

    // Save location + timestamp using the same privacy grid as published
    // snapshots/locationSamples. Even if GPS quality is low, we update the
    // coarse location for map/candidate consistency; exact GPS is not stored.
    await ctx.db.patch(userId, {
      latitude: snappedCurrentLocation.lat,
      longitude: snappedCurrentLocation.lng,
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
    if (
      movementTooSmall &&
      currentUser.latitude &&
      currentUser.longitude &&
      !lastUpdateWasPublishMirror
    ) {
      return {
        success: true,
        nearbyCount: 0,
        skipped: true,
        reason: 'movement_too_small',
      };
    }

    // Skip crossed-path computation if current user is not verified
    const currentStatus = currentUser.verificationStatus || 'unverified';
    // DEV-ONLY bypass (matches publishLocation). Engages only when the Convex
    // deployment env explicitly sets EXPO_PUBLIC_DEMO_AUTH_MODE to "true".
    // Production behavior is unchanged because this env is NOT auto-propagated
    // from .env.local to the Convex deployment.
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentStatus !== 'verified' && !isDevBypass) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'unverified' };
    }

    // Get current user's age for filtering
    const myAge = calculateAge(currentUser.dateOfBirth);

    // STABILITY FIX S3: Use indexed query for verified users only (production).
    // In DEV bypass: widen to all users so unverified demo peers are discoverable.
    // All downstream filters (isActive, nearbyEnabled, pause, blocks, etc.) still apply.
    const verifiedUsers = isDevBypass
      ? await ctx.db.query('users').collect()
      : await ctx.db
          .query('users')
          .withIndex('by_verification_status', (q) => q.eq('verificationStatus', 'verified'))
          .collect();

    // STABILITY FIX S6/C2: Pre-fetch blocks before loop
    // P1 EXCLUSION: Load full negative-relationship exclusion set.
    const {
      blockedUserIds: blockedIds,
      unmatchedUserIds,
      viewerReportedIds,
    } = await loadDiscoveryExclusions(ctx, userId);

    if (CROSSED_PATHS_AUDIT_ENABLED) {
      console.log('[CROSSED_PATHS_AUDIT][trigger]', {
        viewer: userId,
        poolSize: verifiedUsers.length,
        minM: CROSSED_MIN_METERS,
        maxM: CROSSED_MAX_METERS,
        movementGateM: MIN_MOVEMENT_FOR_CROSSING_METERS,
      });
    }

    // First pass: collect candidate user IDs that pass basic filters
    const candidateUserIds: string[] = [];
    type UserWithDistance = (typeof verifiedUsers)[0] & { distance: number };
    const candidateUsers: UserWithDistance[] = [];
    const preFilterRejects: Array<{ candidate: string; reason: string; distance?: number }> = [];

    for (const user of verifiedUsers) {
      if (user._id === userId) continue;
      if (!user.isActive) { preFilterRejects.push({ candidate: user._id as string, reason: 'inactive' }); continue; }
      if (!user.latitude || !user.longitude) { preFilterRejects.push({ candidate: user._id as string, reason: 'no_location' }); continue; }

      // Incognito Nearby is fully hidden from crossed-path recording and
      // notifications. Incognito users can still browse Nearby themselves,
      // but other users must not receive new crossing rows involving them.
      if (user.incognitoMode === true) { preFilterRejects.push({ candidate: user._id as string, reason: 'incognito' }); continue; }

      // Nearby visibility opt-out: Skip users who opted out of nearby
      if (user.nearbyEnabled === false) { preFilterRejects.push({ candidate: user._id as string, reason: 'nearby_disabled' }); continue; }

      // Phase-2: skip users who opted out of crossed-paths recording.
      // Both sides must have recordCrossedPaths !== false for a crossing to
      // be persisted. undefined is treated as opted-in (default true) so
      // existing accounts are unaffected.
      if (user.recordCrossedPaths === false) { preFilterRejects.push({ candidate: user._id as string, reason: 'other_opted_out' }); continue; }

      // Basic info completeness
      if (!user.name || !user.bio || !user.dateOfBirth) { preFilterRejects.push({ candidate: user._id as string, reason: 'profile_incomplete' }); continue; }

      // Location freshness check: foreground detection must not compare against
      // very old stored locations.
      const userLocationUpdatedAt = user.lastLocationUpdatedAt ?? user.lastActive;
      if (now - userLocationUpdatedAt > FOREGROUND_FRESHNESS_MS) { preFilterRejects.push({ candidate: user._id as string, reason: 'location_stale' }); continue; }
      if (await isPointInsideUserPrivacyZone(ctx, user._id, user.latitude, user.longitude)) {
        preFilterRejects.push({ candidate: user._id as string, reason: 'privacy_zone' });
        continue;
      }

      const distance = calculateDistanceMeters(
        latitude,
        longitude,
        user.latitude,
        user.longitude,
      );

      // Within crossed paths range (0m - 1000m)?
      if (distance >= CROSSED_MIN_METERS && distance <= CROSSED_MAX_METERS) {
        candidateUserIds.push(user._id as string);
        candidateUsers.push({ ...user, distance });
      } else {
        preFilterRejects.push({ candidate: user._id as string, reason: 'out_of_range', distance });
      }
    }

    if (CROSSED_PATHS_AUDIT_ENABLED) {
      console.log('[CROSSED_PATHS_AUDIT][candidate_set]', {
        viewer: userId,
        candidateCount: candidateUsers.length,
        candidateIds: candidateUsers.map((u) => u._id),
        preFilterRejectCount: preFilterRejects.length,
        preFilterRejects: preFilterRejects.slice(0, 10), // cap log size
      });
    }

    // STABILITY FIX: Fetch photo counts only for candidates (not all users)
    const photoCountsMap = await prefetchPhotoCounts(ctx, candidateUserIds);

    // Second pass: filter by photo count
    const nearbyUsers: UserWithDistance[] = [];
    for (const user of candidateUsers) {
      const photoCount = photoCountsMap.get(user._id as string) || 0;
      if (photoCount < 2) continue;
      nearbyUsers.push(user);
    }

    // Record crossed paths + history
    let writtenCount = 0;
    let cooldownSkipCount = 0;
    for (const nearbyUser of nearbyUsers) {
      const candidateId = nearbyUser._id as string;

      if (CROSSED_PATHS_AUDIT_ENABLED) {
        console.log('[CROSSED_PATHS_AUDIT][distance_check]', {
          pair: [userId, candidateId],
          distanceM: Math.round(nearbyUser.distance),
          inBand: true,
        });
      }

      // Age filtering (both directions)
      const otherAge = calculateAge(nearbyUser.dateOfBirth);
      if (myAge < nearbyUser.minAge || myAge > nearbyUser.maxAge) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'age_out_of_other_range' });
        continue;
      }
      if (otherAge < currentUser.minAge || otherAge > currentUser.maxAge) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'age_out_of_viewer_range' });
        continue;
      }

      // Gender/orientation preference match (both directions)
      if (
        !orientationAllowsCandidateGender({
          viewerGender: currentUser.gender,
          viewerOrientation: currentUser.orientation ?? undefined,
          candidateGender: nearbyUser.gender,
        }) ||
        !orientationAllowsCandidateGender({
          viewerGender: nearbyUser.gender,
          viewerOrientation: nearbyUser.orientation ?? undefined,
          candidateGender: currentUser.gender,
        })
      ) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'orientation_incompatible' });
        continue;
      }
      if (!currentUser.lookingFor.includes(nearbyUser.gender)) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'viewer_not_into_other_gender' });
        continue;
      }
      if (!nearbyUser.lookingFor.includes(currentUser.gender)) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'other_not_into_viewer_gender' });
        continue;
      }

      // STABILITY FIX S6/C2: Check if blocked using pre-fetched set (O(1) lookup)
      if (blockedIds.has(candidateId)) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'blocked' });
        continue;
      }
      // P1 EXCLUSION: skip unmatched pairs (bidirectional) and reporter-hidden
      // users before recording a crossed-paths entry.
      if (unmatchedUserIds.has(candidateId)) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'unmatched_pair' });
        continue;
      }
      if (viewerReportedIds.has(candidateId)) {
        if (CROSSED_PATHS_AUDIT_ENABLED) console.log('[CROSSED_PATHS_AUDIT][reject]', { pair: [userId, candidateId], reason: 'viewer_reported' });
        continue;
      }

      // --- COMPATIBILITY (metadata / ranking signal, NO LONGER A HARD GATE) ---
      // PRODUCT FIX: Crossed Paths means "we were physically near each other".
      // It is based on proximity + recency, not compatibility. Compatibility
      // is still computed so we can store reasonTags and preserve the
      // "You both enjoy coffee"-style context line when one exists. When
      // there is no overlap, we fall back to a neutral "nearby" tag and
      // still write the crossing.
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
      const reasonTags = compatibility.isCompatible
        ? compatibility.reasonTags
        : ['nearby'];

      // Order user IDs for consistent lookup
      const user1Id = userId < nearbyUser._id ? userId : nearbyUser._id;
      const user2Id = userId < nearbyUser._id ? nearbyUser._id : userId;

      // --- Crossed paths record (for unlock logic) ---
      // BUGFIX #28: Use idempotent upsert pattern to prevent duplicate records
      let crossedPath = await ctx.db
        .query('crossedPaths')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .first();

      if (crossedPath) {
        // 1-hour write cooldown per pair (debounces lastCrossedAt updates)
        if (now - crossedPath.lastCrossedAt < CROSSED_PATH_WRITE_COOLDOWN_MS) {
          if (CROSSED_PATHS_AUDIT_ENABLED) {
            console.log('[CROSSED_PATHS_AUDIT][reject]', {
              pair: [userId, candidateId],
              reason: 'pair_cooldown',
              msSinceLastCrossed: now - crossedPath.lastCrossedAt,
            });
          }
          cooldownSkipCount++;
          continue;
        }

        const approxLocation = roundToGrid(latitude, longitude);
        const newCount = crossedPath.count + 1;
        const updates: Record<string, unknown> = {
          count: newCount,
          lastCrossedAt: now,
          // Legacy coordinate fields store grid-snapped approximate crossing
          // coordinates only. They hold the LATEST crossing location and are
          // not used as the marker source. Never write raw GPS here and never
          // return these fields from public queries.
          crossingLatitude: approxLocation.lat,
          crossingLongitude: approxLocation.lng,
        };
        // STABILITY FIX (Crossed Paths): Lazy back-fill the immutable
        // first-crossing fields on the next crossing for legacy rows that
        // pre-date this fix. Once set, these fields are NEVER patched again
        // so the marker location stays anchored to the first crossing.
        const cp = crossedPath as Doc<'crossedPaths'> & {
          firstCrossedAt?: number;
          firstCrossingLatitude?: number;
          firstCrossingLongitude?: number;
        };
        if (typeof cp.firstCrossedAt !== 'number') {
          updates.firstCrossedAt = now;
        }
        if (
          typeof cp.firstCrossingLatitude !== 'number' ||
          typeof cp.firstCrossingLongitude !== 'number'
        ) {
          updates.firstCrossingLatitude = approxLocation.lat;
          updates.firstCrossingLongitude = approxLocation.lng;
        }

        await ctx.db.patch(crossedPath._id, updates);
      } else {
        const approxLocation = roundToGrid(latitude, longitude);
        // BUGFIX #28: Insert new record, then check for race condition duplicate
        // STABILITY FIX (Crossed Paths): Set immutable first-crossing fields
        // on first insert. Repeat crossings will only update count/lastCrossedAt.
        const newId = await ctx.db.insert('crossedPaths', {
          user1Id,
          user2Id,
          count: 1,
          lastCrossedAt: now,
          crossingLatitude: approxLocation.lat,
          crossingLongitude: approxLocation.lng,
          firstCrossedAt: now,
          firstCrossingLatitude: approxLocation.lat,
          firstCrossingLongitude: approxLocation.lng,
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
        }
      }

      // --- Cross-path history entry (MUTUAL — both users see this) ---
      // BUGFIX #28: Check 24h duplicate control for same pair
      const pairHistories = await ctx.db
        .query('crossPathHistory')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .collect();
      const existingHistory = [...pairHistories]
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

      if (existingHistory && now - existingHistory.createdAt < CROSSED_PATH_WRITE_COOLDOWN_MS) {
        // Already have a recent history entry for this pair — skip
        if (CROSSED_PATHS_AUDIT_ENABLED) {
          console.log('[CROSSED_PATHS_AUDIT][reject]', {
            pair: [userId, candidateId],
            reason: 'history_cooldown',
            msSinceLastHistory: now - existingHistory.createdAt,
          });
        }
        cooldownSkipCount++;
        continue;
      }

      const pairDismissalState = await getCrossedPathForPair(ctx, user1Id, user2Id);
      const hiddenForDismissedViewers = getHistoryHiddenPatchForDismissedPair(
        pairDismissalState,
        user1Id,
        user2Id,
      );
      const hiddenByUser1 = hiddenForDismissedViewers.hiddenByUser1 === true;
      const hiddenByUser2 = hiddenForDismissedViewers.hiddenByUser2 === true;
      if (hiddenByUser1 && hiddenByUser2) {
        // Both viewers removed this pair. Keep the pair row for suppression,
        // but do not create history or notifications.
        continue;
      }

      // Compute approximate crossing location (privacy: rounded to ~300m grid)
      const approxLocation = roundToGrid(latitude, longitude);
      const pairCellKey = makePairCellKeyFromParts(
        user1Id,
        user2Id,
        approxLocation.lat,
        approxLocation.lng,
      );
      const existingSameCellCrossings = pairCellKey
        ? pairHistories.filter(
          (entry) => entry.expiresAt > now && makePairCellKey(entry) === pairCellKey,
        ).length
        : 0;

      // Sensitive-place protection: repeated crossings in the same approximate
      // cell keep the event, but store generic copy so a home/work-like area is
      // not upgraded into a named place through repetition.
      const areaName = existingSameCellCrossings > 0
        ? GENERIC_CROSSING_AREA_NAME
        : (nearbyUser.city ? `Near ${nearbyUser.city}` : GENERIC_CROSSING_AREA_NAME);

      // BUGFIX #28: Insert history entry, then check for race condition duplicate
      const newHistoryId = await ctx.db.insert('crossPathHistory', {
        user1Id,
        user2Id,
        areaName,
        crossedLatApprox: approxLocation.lat,
        crossedLngApprox: approxLocation.lng,
        reasonTags,
        ...hiddenForDismissedViewers,
        createdAt: now,
        expiresAt: now + HISTORY_EXPIRY_MS,
      });

      if (CROSSED_PATHS_AUDIT_ENABLED) {
        console.log('[CROSSED_PATHS_AUDIT][write]', {
          pair: [userId, candidateId],
          historyCreated: true,
          distanceM: Math.round(nearbyUser.distance),
          reasonTags,
        });
      }
      writtenCount++;

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

      // Re-fetch crossedPath to get latest state (may have been created/updated above)
      const currentCrossedPath = await ctx.db
        .query('crossedPaths')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .first();

      // Check notification cooldown on the canonical crossedPaths record
      // (sliding 6h per pair)
      const canNotify = currentCrossedPath && (
        !currentCrossedPath.lastNotifiedAt ||
        now - currentCrossedPath.lastNotifiedAt >= CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS
      );

      if (canNotify && currentCrossedPath) {
        const user1Dismissed = isPairDismissedForViewer(currentCrossedPath, user1Id);
        const user2Dismissed = isPairDismissedForViewer(currentCrossedPath, user2Id);
        if (user1Dismissed && user2Dismissed) {
          continue;
        }

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
        await ctx.db.patch(currentCrossedPath._id, { lastNotifiedAt: now });

        const title = CROSSED_PATH_NOTIFICATION_TITLE;
        const body = CROSSED_PATH_NOTIFICATION_BODY;

        // Stable per-pair dedupeKey (symmetric, no time bucket).
        // One notification row per pair per recipient — upserted in place.
        const pairDedupeKey = makeCrossedPathsDedupeKey(user1Id, user2Id);

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
        // 1. Under daily rate limit (max 3/day)
        // 2. No existing notification within sliding 6h pair cooldown
        const shouldNotifyUser1 = !user1Dismissed &&
          recentNotificationsUser1.length < MAX_NOTIFICATIONS_PER_DAY &&
          (!existingNotifUser1 || now - existingNotifUser1.createdAt >= CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS);

        const shouldNotifyUser2 = !user2Dismissed &&
          recentNotificationsUser2.length < MAX_NOTIFICATIONS_PER_DAY &&
          (!existingNotifUser2 || now - existingNotifUser2.createdAt >= CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS);

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
              phase: 'phase1',
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
              phase: 'phase1',
              dedupeKey: pairDedupeKey,
              createdAt: now,
              expiresAt: now + 24 * 60 * 60 * 1000,
            });
          }
        }
      }

      // Enforce max entries per user — trim oldest
      await trimHistoryForUser(ctx, userId);
    }

    if (CROSSED_PATHS_AUDIT_ENABLED) {
      console.log('[CROSSED_PATHS_AUDIT][summary]', {
        viewer: userId,
        nearbyCount: nearbyUsers.length,
        historyWritten: writtenCount,
        cooldownSkipped: cooldownSkipCount,
      });
    }

    // Phase-1 Background Crossed Paths: mirror this foreground sample into the
    // short-lived locationSamples ring-buffer so the background ±10min
    // detection path can find foreground users too. Snapped to privacy grid
    // before write — same grid used for crossPathHistory.
    try {
      const snapped = roundToGrid(latitude, longitude);
      await ctx.db.insert('locationSamples', {
        userId,
        lat: snapped.lat,
        lng: snapped.lng,
        capturedAt: now,
        source: 'fg',
        accuracy,
        expiresAt: now + LOCATION_SAMPLE_TTL_MS,
      });
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][sample_written]', {
          userId,
          source: 'fg',
          capturedAt: now,
        });
      }
    } catch (err) {
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][dropped]', {
          userId,
          source: 'fg',
          reason: 'insert_failed',
          err: String(err),
        });
      }
    }

    return { success: true, nearbyCount: nearbyUsers.length };
  },
});

// ---------------------------------------------------------------------------
// Phase-1 Background Crossed Paths: constants + helpers
// ---------------------------------------------------------------------------

/** Window around a sample's capturedAt used by background detection. Samples
 * in other users' locationSamples that fall within ±10 minutes of the current
 * sample's capturedAt are treated as potentially co-present. */
const SAMPLE_TIME_WINDOW_MS = 10 * 60 * 1000; // ±10 minutes

/** TTL for locationSamples rows (swept by cron). Matches the 6-hour retention
 * already used for crossedEvents / short-term crossed-path state. */
const LOCATION_SAMPLE_TTL_MS = 6 * 60 * 60 * 1000;

/** Minimum time between two accepted background samples from the same user.
 * Prevents batch payloads from hammering the table with near-duplicate rows
 * when the OS wakes the app multiple times for the same coarse cell. */
const SAMPLE_DEDUPE_MIN_GAP_MS = 60 * 1000; // 1 minute

/** Max samples accepted per batch (prevents abuse from a compromised client). */
const MAX_SAMPLES_PER_BATCH = 20;

/** [BG_LOCATION] audit log master switch. Mirrors [CROSSED_PATHS_AUDIT]. */
const BG_LOCATION_AUDIT_ENABLED = true;

// ---------------------------------------------------------------------------
// recordLocationBatch — Phase-1 Background Crossed Paths entry point
//
// Called from the iOS Significant Location Change background task with one or
// more accumulated samples. Each sample is validated, privacy-snapped, and
// written to locationSamples. The latest sample also updates the user's
// lastLocationUpdatedAt + latitude/longitude so Nearby map stays coherent,
// and triggers a ±10min windowed detection pass.
//
// Rules (all-or-nothing per batch — we never half-apply):
//   - Caller must be a verified user
//   - Caller must be opted in (recordCrossedPaths !== false)
//   - Caller must have backgroundLocationEnabled === true
//   - Caller must not be in an active Nearby pause
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 1 Background Crossed Paths — feature flag, consent, rate-limit, audit
// ---------------------------------------------------------------------------

/** Background-Crossed-Paths consent disclosure version. Bump to invalidate
 *  every existing consent and force re-acceptance. Mirrors the
 *  NEARBY_CONSENT_VERSION pattern. Kept here (not on users.ts) so the gate
 *  helper below can compare against it without an import cycle. */
export const BG_LOCATION_CONSENT_VERSION = BG_CROSSED_PATHS_REQUIRED_CONSENT_VERSION;

/** Background-pipeline kill switch. Reads featureFlags table. Returns false
 *  when the flag row is absent OR present with value !== true. Phase 1
 *  ships with the row absent so the entire pipeline is OFF by default. */
async function isBgCrossedPathsEnabled(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): Promise<boolean> {
  return readBgCrossedPathsFeatureFlag(ctx);
}

/** Returns true only when the user has explicitly accepted the current
 *  background-location disclosure. Mirrors hasNearbyConsent() but checks
 *  the separate background-consent fields so a foreground-consenting user
 *  cannot have any background sample accepted. */
export function hasBackgroundLocationConsent(user: Doc<'users'>): boolean {
  return hasCurrentBgCrossedPathsConsentOnUser(user);
}

export const getBackgroundCrossedPathsStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessionToken = args.token.trim();
    const userId = await validateSessionToken(ctx, sessionToken);
    const serverFeatureEnabled = await isBgCrossedPathsEnabled(ctx);
    const requiredConsentVersion = await getRequiredBgCrossedPathsConsentVersion();

    if (!userId) {
      return {
        serverFeatureEnabled,
        requiredConsentVersion,
        userConsentVersion: null,
        userConsentAcceptedAt: null,
        serverSideBackgroundConsentEnabled: false,
        backgroundLocationEnabled: false,
        discoveryModeEnabled: false,
        discoveryModeExpiresAt: null,
        reconsentRequired: false,
        enabled: false,
        reason: 'not_authenticated' as const,
      };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return {
        serverFeatureEnabled,
        requiredConsentVersion,
        userConsentVersion: null,
        userConsentAcceptedAt: null,
        serverSideBackgroundConsentEnabled: false,
        backgroundLocationEnabled: false,
        discoveryModeEnabled: false,
        discoveryModeExpiresAt: null,
        reconsentRequired: false,
        enabled: false,
        reason: 'not_authenticated' as const,
      };
    }

    const now = Date.now();
    const consent = await getUserBgCrossedPathsConsent(ctx, userId);
    const backgroundLocationEnabled = user.backgroundLocationEnabled === true;
    const discoveryModeEnabled =
      user.discoveryModeEnabled === true &&
      typeof user.discoveryModeExpiresAt === 'number' &&
      user.discoveryModeExpiresAt > now;
    const serverSideBackgroundConsentEnabled =
      backgroundLocationEnabled || discoveryModeEnabled;
    const consentCurrent = consent.version === requiredConsentVersion;
    const reconsentRequired =
      serverFeatureEnabled && serverSideBackgroundConsentEnabled && !consentCurrent;

    return {
      serverFeatureEnabled,
      requiredConsentVersion,
      userConsentVersion: consent.version,
      userConsentAcceptedAt: consent.acceptedAt,
      serverSideBackgroundConsentEnabled,
      backgroundLocationEnabled,
      discoveryModeEnabled,
      discoveryModeExpiresAt: user.discoveryModeExpiresAt ?? null,
      reconsentRequired,
      enabled: serverFeatureEnabled && !reconsentRequired,
      reason: !serverFeatureEnabled
        ? ('feature_disabled_server' as const)
        : reconsentRequired
          ? ('consent_required' as const)
          : null,
    };
  },
});

// Sliding-window rate-limit thresholds. Tuned to comfortably allow
// legitimate Discovery Mode + iOS SLC sampling cadence (~1 sample / 5min)
// while bounding any tampered client to a few hundred samples per day.
const BG_RATE_LIMIT_SHORT_WINDOW_MS = 10 * 60 * 1000;        // 10 minutes
const BG_RATE_LIMIT_SHORT_WINDOW_MAX_SAMPLES = 30;           // per device per 10 min
const BG_RATE_LIMIT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24 hours
const BG_RATE_LIMIT_DAILY_WINDOW_MAX_SAMPLES = 200;          // per device per day

const BG_AUDIT_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;        // 30 days

/** Pre-flight rate-limit check + reservation. Increments the (userId,
 *  deviceHash, kind) counters by `samplesIncoming`. Returns `accept:true`
 *  when both windows still have room; otherwise `accept:false` with the
 *  reason. Performed BEFORE any locationSamples insert so quota cost is
 *  predictable. */
async function reserveBgRateLimitSlots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>,
  deviceHash: string,
  samplesIncoming: number,
): Promise<{ accept: true } | { accept: false; reason: 'rate_limited_short' | 'rate_limited_daily' }> {
  const now = Date.now();
  const dh = deviceHash || '__unknown__';

  // Short window
  const shortRow = await ctx.db
    .query('locationBatchRateLimit')
    .withIndex('by_user_device_window', (q: any) =>
      q.eq('userId', userId).eq('deviceHash', dh).eq('windowKind', '10min'),
    )
    .first();
  let shortStartedAt = shortRow?.windowStartedAt ?? now;
  let shortCount = shortRow?.count ?? 0;
  if (now - shortStartedAt > BG_RATE_LIMIT_SHORT_WINDOW_MS) {
    shortStartedAt = now;
    shortCount = 0;
  }
  if (shortCount + samplesIncoming > BG_RATE_LIMIT_SHORT_WINDOW_MAX_SAMPLES) {
    return { accept: false, reason: 'rate_limited_short' };
  }

  // Daily window
  const dailyRow = await ctx.db
    .query('locationBatchRateLimit')
    .withIndex('by_user_device_window', (q: any) =>
      q.eq('userId', userId).eq('deviceHash', dh).eq('windowKind', 'daily'),
    )
    .first();
  let dailyStartedAt = dailyRow?.windowStartedAt ?? now;
  let dailyCount = dailyRow?.count ?? 0;
  if (now - dailyStartedAt > BG_RATE_LIMIT_DAILY_WINDOW_MS) {
    dailyStartedAt = now;
    dailyCount = 0;
  }
  if (dailyCount + samplesIncoming > BG_RATE_LIMIT_DAILY_WINDOW_MAX_SAMPLES) {
    return { accept: false, reason: 'rate_limited_daily' };
  }

  // Both windows have headroom — reserve the slots.
  const shortPatch = { windowStartedAt: shortStartedAt, count: shortCount + samplesIncoming, updatedAt: now };
  if (shortRow) {
    await ctx.db.patch(shortRow._id, shortPatch);
  } else {
    await ctx.db.insert('locationBatchRateLimit', {
      userId, deviceHash: dh, windowKind: '10min', ...shortPatch,
    });
  }
  const dailyPatch = { windowStartedAt: dailyStartedAt, count: dailyCount + samplesIncoming, updatedAt: now };
  if (dailyRow) {
    await ctx.db.patch(dailyRow._id, dailyPatch);
  } else {
    await ctx.db.insert('locationBatchRateLimit', {
      userId, deviceHash: dh, windowKind: 'daily', ...dailyPatch,
    });
  }
  return { accept: true };
}

/** Persist a row into bgLocationAuditLog. Best-effort — failures are logged
 *  but never thrown so an audit-log write cannot break the user's batch. */
async function emitBgLocationAuditLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  args: {
    userId: Id<'users'>;
    sampleCount: number;
    accepted: number;
    sources: string[];
    outcome: 'accepted' | 'rejected' | 'partial';
    reason?: string;
    deviceHash?: string;
  },
): Promise<void> {
  try {
    const at = Date.now();
    await ctx.db.insert('bgLocationAuditLog', {
      userId: args.userId,
      at,
      sampleCount: args.sampleCount,
      accepted: args.accepted,
      dropped: Math.max(0, args.sampleCount - args.accepted),
      sources: args.sources,
      outcome: args.outcome,
      reason: args.reason,
      deviceHash: args.deviceHash,
      expiresAt: at + BG_AUDIT_LOG_TTL_MS,
    });
  } catch (err) {
    console.warn('[BG_LOCATION][audit_log_write_failed]', { err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// debugBgPipelineStatus — current-user support diagnostics.
// Returns only gates, counters, and timestamps. It never exposes coordinates
// or other users' data.
// ---------------------------------------------------------------------------

export const debugBgPipelineStatus = query({
  args: {
    token: v.string(),
    deviceHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) {
      return { ok: false as const, reason: 'missing_token' as const };
    }

    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { ok: false as const, reason: 'unauthorized' as const };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { ok: false as const, reason: 'user_not_found' as const };
    }

    const now = Date.now();
    const sampleRows = await ctx.db
      .query('locationSamples')
      .withIndex('by_user_capturedAt', (q) => q.eq('userId', userId))
      .order('desc')
      .take(50);
    const recentSamples = sampleRows.filter(
      (row) => row.capturedAt >= now - LOCATION_SAMPLE_TTL_MS,
    );

    const lastAudit = await ctx.db
      .query('bgLocationAuditLog')
      .withIndex('by_user_at', (q) => q.eq('userId', userId))
      .order('desc')
      .first();

    const deviceHash = args.deviceHash?.trim();
    const rateLimitRows = deviceHash
      ? await Promise.all([
          ctx.db
            .query('locationBatchRateLimit')
            .withIndex('by_user_device_window', (q) =>
              q.eq('userId', userId).eq('deviceHash', deviceHash).eq('windowKind', '10min'),
            )
            .first(),
          ctx.db
            .query('locationBatchRateLimit')
            .withIndex('by_user_device_window', (q) =>
              q.eq('userId', userId).eq('deviceHash', deviceHash).eq('windowKind', 'daily'),
            )
            .first(),
        ])
      : null;

    return {
      ok: true as const,
      serverFeatureFlagEnabled: await isBgCrossedPathsEnabled(ctx),
      nearbyConsentVersion: user.nearbyConsentVersion ?? null,
      nearbyConsentCurrent: hasNearbyConsent(user),
      bgLocationConsentVersion: user.backgroundLocationConsentVersion ?? null,
      bgLocationConsentCurrent: hasBackgroundLocationConsent(user),
      backgroundLocationEnabled: user.backgroundLocationEnabled === true,
      discoveryModeEnabled: user.discoveryModeEnabled === true,
      discoveryModeExpiresAt: user.discoveryModeExpiresAt ?? null,
      discoveryModeActive:
        user.discoveryModeEnabled === true &&
        typeof user.discoveryModeExpiresAt === 'number' &&
        user.discoveryModeExpiresAt > now,
      nearbyEnabled: user.nearbyEnabled !== false,
      nearbyPausedActive:
        typeof user.nearbyPausedUntil === 'number' && user.nearbyPausedUntil > now,
      nearbyPausedUntil: user.nearbyPausedUntil ?? null,
      recordCrossedPaths: user.recordCrossedPaths !== false,
      incognitoMode: user.incognitoMode === true,
      opsDisabled: user.bgCrossedPathsOpsDisabled === true,
      lastNearbyUpdateAt: user.lastLocationUpdatedAt ?? null,
      lastNearbyPublishedAt: user.publishedAt ?? null,
      recentLocationSampleWindowMs: LOCATION_SAMPLE_TTL_MS,
      recentLocationSampleCount: recentSamples.length,
      recentLocationSampleCountCappedAt: 50,
      lastLocationSampleAt: sampleRows[0]?.capturedAt ?? null,
      lastBgLocationAuditLog: lastAudit
        ? {
            at: lastAudit.at,
            outcome: lastAudit.outcome,
            reason: lastAudit.reason ?? null,
            sampleCount: lastAudit.sampleCount,
            accepted: lastAudit.accepted,
            dropped: lastAudit.dropped,
            sources: lastAudit.sources,
            hasDeviceHash: Boolean(lastAudit.deviceHash),
          }
        : null,
      rateLimitBuckets: rateLimitRows
        ? rateLimitRows
            .flatMap((row) =>
              row
                ? [{
                    windowKind: row.windowKind,
                    windowStartedAt: row.windowStartedAt,
                    count: row.count,
                    updatedAt: row.updatedAt,
                  }]
                : [],
            )
        : null,
    };
  },
});

// ---------------------------------------------------------------------------
// recordLocationBatch — Phase 1 Background Crossed Paths entry point.
// (Restored from commit ebb838b with new server-side gates layered on top.)
//
// Called from:
//   * iOS Significant Location Change background task — source='slc'
//   * Android Discovery Mode foreground service — source='bg'
//   * Foreground mirror writes (rare; recordLocation usually owns this) — source='fg'
//
// Order of gates (each early-returns + writes audit log on first failure):
//   1. bgCrossedPathsEnabled feature flag must be true
//   2. resolveUserIdByAuthId must return a real user
//   3. samples non-empty + below MAX_SAMPLES_PER_BATCH
//   4. user exists and is verified
//   5. nearbyEnabled !== false / nearbyPausedUntil not active
//   6. recordCrossedPaths !== false
//   7. incognitoMode !== true
//   8. hasNearbyConsent (foreground consent — required for any sample)
//   9. hasBackgroundLocationConsent (background-specific consent — required
//      whenever any sample in the batch is source='slc' or source='bg')
//  10. source-specific opt-in (backgroundLocationEnabled OR Discovery window)
//  11. per-user + per-device rate limit (10min + daily windows)
//  12. per-sample validators: coord, age, future, dedupe, privacy zone,
//      impossible-travel, retry-duplicate
// ---------------------------------------------------------------------------

export const recordLocationBatch = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    token: v.optional(v.string()),
    samples: v.array(
      v.object({
        lat: v.number(),
        lng: v.number(),
        capturedAt: v.number(),
        accuracy: v.optional(v.number()),
        source: v.union(v.literal('bg'), v.literal('fg'), v.literal('slc')),
      }),
    ),
    // Optional client-provided salted device hash — bound rate limit
    // per device so a single tampered client cannot starve every other
    // device the same user owns. Never logged in plaintext.
    deviceHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Feature-flag kill switch — short-circuit before any user lookup
    //    so the disabled path has zero observable side effects.
    if (!(await isBgCrossedPathsEnabled(ctx))) {
      return {
        success: false,
        accepted: 0,
        skipped: true,
        reason: 'feature_not_ready',
      };
    }

    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!resolvedUserId) {
      return { success: false, accepted: 0, reason: 'user_not_found' };
    }
    let userId = resolvedUserId;
    const sessionToken = typeof args.token === 'string' ? args.token.trim() : '';
    if (sessionToken) {
      const tokenUserId = await validateSessionToken(ctx, sessionToken);
      if (!tokenUserId) {
        return { success: false, accepted: 0, reason: 'not_authenticated' };
      }
      if (tokenUserId !== resolvedUserId) {
        return { success: false, accepted: 0, reason: 'session_user_mismatch' };
      }
      userId = tokenUserId;
    }
    const now = Date.now();
    const sources = Array.from(new Set(args.samples.map((s) => s.source)));

    if (BG_LOCATION_AUDIT_ENABLED) {
      console.log('[BG_LOCATION][sample_received]', {
        userId,
        sampleCount: args.samples.length,
        sources,
      });
    }

    if (args.samples.length === 0) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: 0, accepted: 0, sources,
        outcome: 'rejected', reason: 'empty_batch', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'empty_batch' };
    }
    if (args.samples.length > MAX_SAMPLES_PER_BATCH) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'batch_too_large', deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: 'batch_too_large' };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false, accepted: 0, reason: 'user_not_found' };
    }

    if (user.bgCrossedPathsOpsDisabled === true) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'ops_disabled', deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: 'ops_disabled' };
    }

    // Early opt-out gates (no background-consent specifics yet — those
    // come below only when the batch carries bg/slc samples).
    if (user.nearbyEnabled === false) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'disabled_or_paused', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'disabled_or_paused' };
    }
    if (user.nearbyPausedUntil && user.nearbyPausedUntil > now) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'disabled_or_paused', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'disabled_or_paused' };
    }
    if (user.recordCrossedPaths === false) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'crossed_paths_opt_out', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'crossed_paths_opt_out' };
    }
    if (user.incognitoMode === true) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'incognito', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'incognito' };
    }
    // Foreground consent gate (required for any location write).
    if (!hasNearbyConsent(user)) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'consent_required', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'consent_required' };
    }

    const currentStatus = user.verificationStatus || 'unverified';
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentStatus !== 'verified' && !isDevBypass) {
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'unverified', deviceHash: args.deviceHash,
      });
      return { success: true, accepted: 0, reason: 'unverified' };
    }

    // Source-specific opt-in gates. Background writes are strictly opt-in
    // and the gate is checked server-side so a stale / spoofed client can
    // never write background samples without the user's consent flag.
    //
    //   source='slc' : iOS Significant Location Change — requires
    //                  backgroundLocationEnabled === true.
    //   source='bg'  : Android Discovery Mode — requires
    //                  discoveryModeEnabled === true AND
    //                  discoveryModeExpiresAt > now. Expired windows are
    //                  rejected so a client whose timer failed to stop
    //                  cannot keep writing.
    //   source='fg'  : foreground mirror writes — still require at least
    //                  one of the background toggles to be on, matching
    //                  the Phase-1 semantics (fg mirroring from
    //                  recordLocation already bypasses this mutation).
    const sourceSet = new Set(args.samples.map((s) => s.source));
    const hasSlc = sourceSet.has('slc');
    const hasBg = sourceSet.has('bg');
    const bgLocationOn = user.backgroundLocationEnabled === true;
    const discoveryOn =
      user.discoveryModeEnabled === true &&
      typeof user.discoveryModeExpiresAt === 'number' &&
      user.discoveryModeExpiresAt > now;

    // Background-specific consent gate — required for any bg/slc sample.
    // A user who accepted only the foreground disclosure (nearbyConsent)
    // cannot have a background sample accepted, even if the toggle on
    // their user doc is somehow true.
    if ((hasSlc || hasBg) && !hasBackgroundLocationConsent(user)) {
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][dropped]', {
          userId,
          reason: 'bg_consent_required',
          sampleCount: args.samples.length,
        });
      }
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'bg_consent_required', deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: 'consent_required' };
    }

    if (hasSlc && !bgLocationOn) {
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][dropped]', {
          userId,
          reason: 'background_not_enabled',
          sampleCount: args.samples.length,
        });
      }
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'background_not_enabled', deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: 'background_not_enabled' };
    }

    if (hasBg && !discoveryOn) {
      // Intentionally logged under ANDROID_DISCOVERY so Phase-2 telemetry
      // is separable from Phase-1 iOS logs.
      console.log('[ANDROID_DISCOVERY][dropped]', {
        userId,
        reason: 'discovery_mode_not_active',
        discoveryModeEnabled: user.discoveryModeEnabled ?? false,
        discoveryModeExpiresAt: user.discoveryModeExpiresAt ?? null,
        now,
        sampleCount: args.samples.length,
      });
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'discovery_mode_not_active', deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: 'discovery_mode_not_active' };
    }

    // If the batch has neither slc nor bg sources, fall back to checking that
    // at least one of the background opt-ins is on (defensive; shouldn't
    // happen in practice because recordLocation handles fg mirror writes).
    if (!hasSlc && !hasBg && !bgLocationOn && !discoveryOn) {
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][dropped]', {
          userId,
          reason: 'no_opt_in',
          sampleCount: args.samples.length,
        });
      }
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: 'no_opt_in', deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: 'no_opt_in' };
    }

    // Rate-limit pre-flight. Reserves quota for `samples.length` even if
    // some samples are later rejected by per-sample validators — this
    // intentionally bounds compute spent on attacker-controlled batches.
    const rl = await reserveBgRateLimitSlots(
      ctx, userId, args.deviceHash || '__unknown__', args.samples.length,
    );
    if (!rl.accept) {
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][dropped]', {
          userId,
          reason: rl.reason,
          sampleCount: args.samples.length,
        });
      }
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: rl.reason, deviceHash: args.deviceHash,
      });
      return { success: false, accepted: 0, reason: rl.reason };
    }

    const userPrivacyZones = await getPrivacyZonesForUser(ctx, userId);

    // Sort incoming samples by capturedAt ascending so downstream dedupe +
    // "latest sample wins" semantics are deterministic.
    const sortedSamples = [...args.samples].sort((a, b) => a.capturedAt - b.capturedAt);

    // Pre-fetch this user's most recent sample for dedupe.
    const mostRecentExisting = await ctx.db
      .query('locationSamples')
      .withIndex('by_user_capturedAt', (q: any) => q.eq('userId', userId))
      .order('desc')
      .first();
    let lastAcceptedAt = mostRecentExisting ? mostRecentExisting.capturedAt : 0;

    let accepted = 0;
    let droppedStale = 0;
    let droppedFuture = 0;
    let droppedDedupe = 0;
    let droppedPrivacyZone = 0;
    let duplicateCount = 0;
    let droppedInvalid = 0;
    // Fix 3 — count samples rejected by impossible-travel evaluation.
    let droppedSuspiciousLocation = 0;
    let latestAcceptedSample: { lat: number; lng: number; capturedAt: number; accuracy?: number } | null = null;
    // Fix 3 — track the latest accepted location across the loop so each
    // sample is checked against the running point (not a stale user doc).
    let lastAcceptedSafetyPoint = getLatestAcceptedLocation(user);

    for (const raw of sortedSamples) {
      // Basic coord validity (reject NaN / out-of-range).
      if (
        !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng) ||
        raw.lat < -90 || raw.lat > 90 ||
        raw.lng < -180 || raw.lng > 180 ||
        !Number.isFinite(raw.capturedAt)
      ) {
        droppedInvalid++;
        if (BG_LOCATION_AUDIT_ENABLED) {
          console.log('[BG_LOCATION][dropped]', { userId, reason: 'invalid_coord', source: raw.source });
        }
        continue;
      }
      // Reject samples older than the TTL — can't detect crossings we'd
      // immediately sweep out anyway.
      if (now - raw.capturedAt > LOCATION_SAMPLE_TTL_MS) {
        droppedStale++;
        continue;
      }
      // Reject samples dated in the future (clock skew / replay).
      if (raw.capturedAt > now + 5 * 60 * 1000) {
        droppedFuture++;
        continue;
      }
      if (
        await isPointInsideUserPrivacyZone(
          ctx,
          userId,
          raw.lat,
          raw.lng,
          userPrivacyZones,
        )
      ) {
        droppedPrivacyZone++;
        logPrivacyZoneSkip(`recordLocationBatch:${raw.source}`, userId);
        continue;
      }
      // Fix 3 — evaluate impossible-travel against the running last-accepted
      // safety point so each sample in the batch is checked in isolation.
      const locationSafety = evaluateImpossibleTravel(lastAcceptedSafetyPoint, {
        latitude: raw.lat,
        longitude: raw.lng,
        acceptedAt: raw.capturedAt,
      });
      if (locationSafety.rejected) {
        droppedSuspiciousLocation++;
        await recordLocationSafetyReject(ctx, userId, locationSafety);
        continue;
      }
      const snapped = roundToGrid(raw.lat, raw.lng);
      const existingSameCapture = await ctx.db
        .query('locationSamples')
        .withIndex('by_user_capturedAt', (q: any) =>
          q.eq('userId', userId).eq('capturedAt', raw.capturedAt),
        )
        .collect();
      const isRetryDuplicate = existingSameCapture.some((sample: any) =>
        sample.source === raw.source &&
        Math.abs(sample.lat - snapped.lat) < 0.000001 &&
        Math.abs(sample.lng - snapped.lng) < 0.000001,
      );
      if (isRetryDuplicate) {
        duplicateCount++;
        continue;
      }
      // Dedupe against last accepted sample for this user.
      if (raw.capturedAt - lastAcceptedAt < SAMPLE_DEDUPE_MIN_GAP_MS) {
        droppedDedupe++;
        continue;
      }

      await ctx.db.insert('locationSamples', {
        userId,
        lat: snapped.lat,
        lng: snapped.lng,
        capturedAt: raw.capturedAt,
        source: raw.source,
        accuracy: raw.accuracy,
        expiresAt: raw.capturedAt + LOCATION_SAMPLE_TTL_MS,
      });

      lastAcceptedAt = raw.capturedAt;
      accepted++;
      latestAcceptedSample = {
        lat: snapped.lat,
        lng: snapped.lng,
        capturedAt: raw.capturedAt,
        accuracy: raw.accuracy,
      };
      // Fix 3 — advance the running safety point so subsequent samples in
      // this batch are evaluated against the most recent accepted location.
      lastAcceptedSafetyPoint = {
        latitude: snapped.lat,
        longitude: snapped.lng,
        acceptedAt: raw.capturedAt,
      };

      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][sample_written]', {
          userId,
          source: raw.source,
          capturedAt: raw.capturedAt,
        });
      }
    }

    if (BG_LOCATION_AUDIT_ENABLED) {
      const droppedCountForLog =
        droppedDedupe + droppedStale + droppedFuture + droppedInvalid + droppedPrivacyZone + droppedSuspiciousLocation;
      const skippedCount = droppedCountForLog + duplicateCount;
      console.log('[BG_LOCATION][batch_result]', {
        userId,
        acceptedCount: accepted,
        duplicateCount,
        droppedCount: droppedCountForLog,
        skippedCount,
        droppedDedupe,
        droppedStale,
        droppedFuture,
        droppedPrivacyZone,
        droppedInvalid,
        droppedSuspiciousLocation,
        sources,
      });
    }

    // Only continue to user-doc update + detection if at least one sample
    // was accepted. Otherwise the batch is effectively a no-op.
    if (!latestAcceptedSample) {
      const droppedCount =
        droppedDedupe + droppedStale + droppedFuture + droppedInvalid + droppedPrivacyZone + droppedSuspiciousLocation;
      const reason =
        droppedSuspiciousLocation > 0
          ? 'suspicious_location'
          : droppedPrivacyZone > 0
            ? 'privacy_zone'
            : undefined;
      await emitBgLocationAuditLog(ctx, {
        userId, sampleCount: args.samples.length, accepted: 0, sources,
        outcome: 'rejected', reason: reason ?? 'all_samples_dropped', deviceHash: args.deviceHash,
      });
      return {
        success: true,
        accepted: 0,
        acceptedCount: 0,
        droppedStale,
        droppedFuture,
        droppedDedupe,
        droppedPrivacyZone,
        duplicateCount,
        droppedInvalid,
        droppedSuspiciousLocation,
        droppedCount,
        skippedCount: droppedCount + duplicateCount,
        reason,
      };
    }

    // Update the user doc's last-known coordinate + activity timestamp using
    // the latest accepted (snapped) sample. This keeps Nearby map visibility
    // coherent without requiring the user to open the app. We only update
    // when the background sample is newer than what's already stored.
    const userLastUpdated = user.lastLocationUpdatedAt ?? 0;
    if (latestAcceptedSample.capturedAt > userLastUpdated) {
      await ctx.db.patch(userId, {
        latitude: latestAcceptedSample.lat,
        longitude: latestAcceptedSample.lng,
        lastActive: Math.max(user.lastActive ?? 0, latestAcceptedSample.capturedAt),
        lastLocationUpdatedAt: latestAcceptedSample.capturedAt,
      });
    }

    // Run windowed detection using the latest accepted sample as the anchor.
    // Detection looks at locationSamples from other users with capturedAt
    // within ±10min of this sample. All existing opt-out / block / compat
    // rules apply.
    const detection = await detectCrossingsForSample(ctx, {
      viewerId: userId,
      viewer: user,
      lat: latestAcceptedSample.lat,
      lng: latestAcceptedSample.lng,
      sampleTime: latestAcceptedSample.capturedAt,
      accuracy: latestAcceptedSample.accuracy,
    });

    const droppedCount =
      droppedDedupe + droppedStale + droppedFuture + droppedInvalid + droppedPrivacyZone + droppedSuspiciousLocation;

    await emitBgLocationAuditLog(ctx, {
      userId,
      sampleCount: args.samples.length,
      accepted,
      sources,
      outcome: accepted === args.samples.length ? 'accepted' : 'partial',
      deviceHash: args.deviceHash,
    });

    return {
      success: true,
      accepted,
      droppedStale,
      droppedFuture,
      droppedDedupe,
      droppedPrivacyZone,
      duplicateCount,
      droppedInvalid,
      droppedSuspiciousLocation,
      droppedCount,
      skippedCount: droppedCount + duplicateCount,
      acceptedCount: accepted,
      crossingsWritten: detection.crossingsWritten,
    };
  },
});


// ---------------------------------------------------------------------------
// detectCrossingsForSample — shared helper used by recordLocationBatch.
//
// Looks for other users whose most recent locationSamples row falls within
// ±SAMPLE_TIME_WINDOW_MS of the anchor sample AND within CROSSED_MAX_METERS
// of the anchor coordinate. Applies the same opt-out / block / age /
// orientation / compat rules as recordLocation, then upserts
// crossedPaths + crossPathHistory and emits in-app notifications.
//
// Kept deliberately separate from the recordLocation loop so the foreground
// path remains untouched (Phase-1 rule: do NOT break existing logic).
// ---------------------------------------------------------------------------

async function detectCrossingsForSample(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  args: {
    viewerId: Id<'users'>;
    viewer: Doc<'users'>;
    lat: number;
    lng: number;
    sampleTime: number;
    accuracy?: number;
  },
): Promise<{ crossingsWritten: number }> {
  const { viewerId, viewer, lat, lng, sampleTime, accuracy } = args;
  const now = Date.now();
  const windowStart = sampleTime - SAMPLE_TIME_WINDOW_MS;
  const windowEnd = sampleTime + SAMPLE_TIME_WINDOW_MS;

  if (viewer.incognitoMode === true) {
    return { crossingsWritten: 0 };
  }
  if (await isPointInsideUserPrivacyZone(ctx, viewerId, lat, lng)) {
    logPrivacyZoneSkip('detectCrossingsForSample', viewerId);
    return { crossingsWritten: 0 };
  }

  // GPS quality short-circuit (same thresholds as recordLocation).
  if (accuracy !== undefined && accuracy > MAX_ACCURACY_FOR_CROSSING_METERS) {
    if (BG_LOCATION_AUDIT_ENABLED) {
      console.log('[BG_LOCATION][dropped]', {
        userId: viewerId,
        reason: 'accuracy_too_low',
        accuracy,
      });
    }
    return { crossingsWritten: 0 };
  }

  // 1) Pull recent samples from every OTHER user within the time window.
  //    The by_capturedAt index lets us scan only rows inside the window.
  const windowedSamples = await ctx.db
    .query('locationSamples')
    .withIndex('by_capturedAt', (q: any) => q.gte('capturedAt', windowStart))
    .filter((q: any) => q.lte(q.field('capturedAt'), windowEnd))
    .collect();

  // Keep only the latest sample per peer (excluding self).
  type SampleRow = Doc<'locationSamples'>;
  const latestByPeer = new Map<string, SampleRow>();
  for (const s of windowedSamples as SampleRow[]) {
    const peerId = s.userId as string;
    if (peerId === (viewerId as string)) continue;
    const prev = latestByPeer.get(peerId);
    if (!prev || s.capturedAt > prev.capturedAt) {
      latestByPeer.set(peerId, s);
    }
  }

  if (BG_LOCATION_AUDIT_ENABLED) {
    console.log('[BG_LOCATION][window_scan]', {
      viewer: viewerId,
      windowStart,
      windowEnd,
      peerCount: latestByPeer.size,
    });
  }

  if (latestByPeer.size === 0) {
    return { crossingsWritten: 0 };
  }

  // 2) Distance pre-filter against each peer's latest sample.
  type Candidate = { peerId: string; peerSample: SampleRow; distance: number };
  const candidates: Candidate[] = [];
  for (const [peerId, peerSample] of latestByPeer) {
    if (
      await isPointInsideUserPrivacyZone(
        ctx,
        peerId as Id<'users'>,
        peerSample.lat,
        peerSample.lng,
      )
    ) {
      continue;
    }
    const distance = calculateDistanceMeters(lat, lng, peerSample.lat, peerSample.lng);
    if (distance >= CROSSED_MIN_METERS && distance <= CROSSED_MAX_METERS) {
      candidates.push({ peerId, peerSample, distance });
    }
  }
  if (candidates.length === 0) {
    return { crossingsWritten: 0 };
  }

  // 3) Exclusion set + my basic gates (same as recordLocation).
  const {
    blockedUserIds: blockedIds,
    unmatchedUserIds,
    viewerReportedIds,
  } = await loadDiscoveryExclusions(ctx, viewerId);
  const myAge = calculateAge(viewer.dateOfBirth);

  // 4) Per-peer full-gate loop (age, orientation, opt-outs, compat, cooldown).
  let crossingsWritten = 0;
  for (const { peerId, distance } of candidates) {
    const peerUser = await ctx.db.get(peerId as Id<'users'>);
    if (!peerUser) continue;
    if (!peerUser.isActive) continue;
    if (peerUser.nearbyEnabled === false) continue;
    if (peerUser.recordCrossedPaths === false) continue;
    if (peerUser.incognitoMode === true) continue;
    if (!peerUser.name || !peerUser.bio || !peerUser.dateOfBirth) continue;

    // Verification parity with recordLocation (DEV bypass respected).
    const peerStatus = peerUser.verificationStatus || 'unverified';
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (peerStatus !== 'verified' && !isDevBypass) continue;

    // Age / orientation / gender filters (bi-directional).
    const peerAge = calculateAge(peerUser.dateOfBirth);
    if (myAge < peerUser.minAge || myAge > peerUser.maxAge) continue;
    if (peerAge < viewer.minAge || peerAge > viewer.maxAge) continue;
    if (
      !orientationAllowsCandidateGender({
        viewerGender: viewer.gender,
        viewerOrientation: viewer.orientation ?? undefined,
        candidateGender: peerUser.gender,
      }) ||
      !orientationAllowsCandidateGender({
        viewerGender: peerUser.gender,
        viewerOrientation: peerUser.orientation ?? undefined,
        candidateGender: viewer.gender,
      })
    ) continue;
    if (!viewer.lookingFor.includes(peerUser.gender)) continue;
    if (!peerUser.lookingFor.includes(viewer.gender)) continue;

    // Negative-relationship exclusions.
    if (blockedIds.has(peerId)) continue;
    if (unmatchedUserIds.has(peerId)) continue;
    if (viewerReportedIds.has(peerId)) continue;

    // Compatibility (metadata only — same product-fix rule as recordLocation).
    const compatibility = computeCompatibility(
      {
        activities: viewer.activities,
        relationshipIntent: viewer.relationshipIntent,
        profilePrompts: viewer.profilePrompts,
      },
      {
        activities: peerUser.activities,
        relationshipIntent: peerUser.relationshipIntent,
        profilePrompts: peerUser.profilePrompts,
      },
    );
    const reasonTags = compatibility.isCompatible ? compatibility.reasonTags : ['nearby'];

    const user1Id = (viewerId as string) < (peerUser._id as string) ? viewerId : peerUser._id;
    const user2Id = (viewerId as string) < (peerUser._id as string) ? peerUser._id : viewerId;

    // Upsert crossedPaths with per-pair cooldown.
    let crossedPath = await ctx.db
      .query('crossedPaths')
      .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .first();

    if (crossedPath) {
      if (now - crossedPath.lastCrossedAt < CROSSED_PATH_WRITE_COOLDOWN_MS) {
        continue; // pair write cooldown (1h)
      }
      const approxLocation = roundToGrid(lat, lng);
      const updates: Record<string, unknown> = {
        count: crossedPath.count + 1,
        lastCrossedAt: now,
        // Legacy coordinate fields store grid-snapped approximate crossing
        // coordinates only. They hold the LATEST crossing location and are
        // not used as the marker source. Never write raw GPS here and never
        // return these fields from public queries.
        crossingLatitude: approxLocation.lat,
        crossingLongitude: approxLocation.lng,
      };
      // STABILITY FIX (Crossed Paths): Lazy back-fill immutable first-crossing
      // fields for legacy rows. Once set, these fields are NEVER patched again.
      const cp = crossedPath as Doc<'crossedPaths'> & {
        firstCrossedAt?: number;
        firstCrossingLatitude?: number;
        firstCrossingLongitude?: number;
      };
      if (typeof cp.firstCrossedAt !== 'number') {
        updates.firstCrossedAt = now;
      }
      if (
        typeof cp.firstCrossingLatitude !== 'number' ||
        typeof cp.firstCrossingLongitude !== 'number'
      ) {
        updates.firstCrossingLatitude = approxLocation.lat;
        updates.firstCrossingLongitude = approxLocation.lng;
      }
      await ctx.db.patch(crossedPath._id, updates);
    } else {
      const approxLocation = roundToGrid(lat, lng);
      // STABILITY FIX (Crossed Paths): Set immutable first-crossing fields
      // on first insert.
      await ctx.db.insert('crossedPaths', {
        user1Id,
        user2Id,
        count: 1,
        lastCrossedAt: now,
        crossingLatitude: approxLocation.lat,
        crossingLongitude: approxLocation.lng,
        firstCrossedAt: now,
        firstCrossingLatitude: approxLocation.lat,
        firstCrossingLongitude: approxLocation.lng,
      });
    }

    // History cooldown (same pattern as recordLocation).
    const pairHistories = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .collect();
    const existingHistory = [...pairHistories]
      .sort(
        (a: Doc<'crossPathHistory'>, b: Doc<'crossPathHistory'>) =>
          b.createdAt - a.createdAt,
      )[0] ?? null;
    if (existingHistory && now - existingHistory.createdAt < CROSSED_PATH_WRITE_COOLDOWN_MS) {
      continue;
    }

    const pairDismissalState = await getCrossedPathForPair(ctx, user1Id, user2Id);
    const hiddenForDismissedViewers = getHistoryHiddenPatchForDismissedPair(
      pairDismissalState,
      user1Id,
      user2Id,
    );
    const hiddenByUser1 = hiddenForDismissedViewers.hiddenByUser1 === true;
    const hiddenByUser2 = hiddenForDismissedViewers.hiddenByUser2 === true;
    if (hiddenByUser1 && hiddenByUser2) {
      continue;
    }

    const approxLocation = roundToGrid(lat, lng);
    const pairCellKey = makePairCellKeyFromParts(
      user1Id,
      user2Id,
      approxLocation.lat,
      approxLocation.lng,
    );
    const existingSameCellCrossings = pairCellKey
      ? pairHistories.filter(
        (entry: Doc<'crossPathHistory'>) =>
          entry.expiresAt > now && makePairCellKey(entry) === pairCellKey,
      ).length
      : 0;

    // Sensitive-place protection: repeated crossings in the same approximate
    // cell keep the event, but store generic copy so a home/work-like area is
    // not upgraded into a named place through repetition.
    const areaName = existingSameCellCrossings > 0
      ? GENERIC_CROSSING_AREA_NAME
      : (peerUser.city ? `Near ${peerUser.city}` : GENERIC_CROSSING_AREA_NAME);
    await ctx.db.insert('crossPathHistory', {
      user1Id,
      user2Id,
      areaName,
      crossedLatApprox: approxLocation.lat,
      crossedLngApprox: approxLocation.lng,
      reasonTags,
      ...hiddenForDismissedViewers,
      createdAt: now,
      expiresAt: now + HISTORY_EXPIRY_MS,
    });

    crossingsWritten++;
    if (BG_LOCATION_AUDIT_ENABLED) {
      console.log('[BG_LOCATION][crossing_detected]', {
        pair: [viewerId, peerId],
        distanceM: Math.round(distance),
        reasonTags,
        sampleTime,
      });
    }

    // In-app notification (upsert — same pattern as recordLocation).
    const currentCrossedPath = await ctx.db
      .query('crossedPaths')
      .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .first();
    if (!currentCrossedPath) continue;

    const canNotify = !currentCrossedPath.lastNotifiedAt ||
      now - currentCrossedPath.lastNotifiedAt >= CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS;
    if (!canNotify) continue;

    const user1Dismissed = isPairDismissedForViewer(currentCrossedPath, user1Id);
    const user2Dismissed = isPairDismissedForViewer(currentCrossedPath, user2Id);
    if (user1Dismissed && user2Dismissed) continue;

    await ctx.db.patch(currentCrossedPath._id, { lastNotifiedAt: now });

    const title = CROSSED_PATH_NOTIFICATION_TITLE;
    const body = CROSSED_PATH_NOTIFICATION_BODY;
    const pairDedupeKey = makeCrossedPathsDedupeKey(user1Id, user2Id);

    for (const [recipient, other] of [
      [user1Id, user2Id],
      [user2Id, user1Id],
    ] as const) {
      if (isPairDismissedForViewer(currentCrossedPath, recipient)) continue;

      const existing = await ctx.db
        .query('notifications')
        .withIndex('by_user_dedupe', (q: any) =>
          q.eq('userId', recipient).eq('dedupeKey', pairDedupeKey))
        .first();
      const recentCount = (
        await ctx.db
          .query('notifications')
          .withIndex('by_user', (q: any) => q.eq('userId', recipient))
          .filter((q: any) =>
            q.and(
              q.eq(q.field('type'), 'crossed_paths'),
              q.gt(q.field('createdAt'), now - 24 * 60 * 60 * 1000),
            ),
          )
          .collect()
      ).length;
      const shouldNotify = recentCount < MAX_NOTIFICATIONS_PER_DAY &&
        (!existing || now - existing.createdAt >= CROSSED_PATH_PAIR_NOTIFICATION_COOLDOWN_MS);
      if (!shouldNotify) continue;
      if (existing) {
        await ctx.db.patch(existing._id, {
          title,
          body,
          data: { userId: other as string, pairKey: pairDedupeKey },
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
          readAt: undefined,
        });
      } else {
        await ctx.db.insert('notifications', {
          userId: recipient,
          type: 'crossed_paths' as const,
          title,
          body,
          data: { userId: other as string, pairKey: pairDedupeKey },
          phase: 'phase1',
          dedupeKey: pairDedupeKey,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        });
      }
    }

    await trimHistoryForUser(ctx, viewerId);
  }

  return { crossingsWritten };
}

// ---------------------------------------------------------------------------
// cleanupExpiredLocationSamples — TTL sweep for the samples ring-buffer.
// Referenced by the 'cleanup-expired-location-samples' cron (6h cadence).
// ---------------------------------------------------------------------------

export const cleanupExpiredLocationSamples = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('locationSamples')
      .withIndex('by_expires')
      .filter((q) => q.lt(q.field('expiresAt'), now))
      .collect();
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});

// ---------------------------------------------------------------------------
// cleanupExpiredBgLocationAuditLog — TTL sweep for bgLocationAuditLog.
// Referenced by the 'cleanup-expired-bg-location-audit-log' cron (daily).
// ---------------------------------------------------------------------------

export const cleanupExpiredBgLocationAuditLog = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('bgLocationAuditLog')
      .withIndex('by_expires')
      .filter((q) => q.lt(q.field('expiresAt'), now))
      .collect();
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});

// ---------------------------------------------------------------------------
// cleanupStaleLocationBatchRateLimit — sweeps any rate-limit row whose
// daily window expired more than 7 days ago. Short-window rows roll over
// in place, so they don't need cleanup; this only protects against
// accumulating rows for users who have stopped sampling entirely.
// ---------------------------------------------------------------------------

export const cleanupStaleLocationBatchRateLimit = internalMutation({
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const all = await ctx.db.query('locationBatchRateLimit').collect();
    let deleted = 0;
    for (const row of all) {
      if ((row.updatedAt ?? 0) < cutoff) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

// ---------------------------------------------------------------------------
// getNearbyUsers — crossed-path-event based map markers
//
// Privacy contract:
//   - Nearby feed inclusion MUST come from active crossPathHistory rows only.
//     Do not include users merely because publishedLat/publishedLng is near
//     the viewer.
//   - Public Nearby/crossed-path queries must never return raw users.latitude,
//     users.longitude, crossedPaths.crossingLatitude, or crossingLongitude.
//   - Response coordinates must represent only approximate crossed-path event
//     locations: crossedLatApprox/crossedLngApprox plus per-request display
//     jitter. Never return current/latest candidate location.
//   - No numeric distance leaves the server; distanceBucket is a coarse label.
// ---------------------------------------------------------------------------

export const getNearbyUsers = query({
  args: { userId: v.union(v.id('users'), v.string()) }, // Accept both Convex ID and authUserId
  handler: async (ctx, args) => {
    const now = Date.now();

    // Resolve authUserId to Convex ID if needed
    const userId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!userId) return [];

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return [];

    // P2 — Consent read-gate. Requester must have accepted the current
    // Nearby / Crossed Paths disclosure before any list payload is exposed.
    // Write paths already gate on this; the read gate prevents leaking
    // existing data to a user who has not (re-)consented.
    if (!hasNearbyConsent(currentUser)) return [];

    // Current user must be verified to see nearby users.
    // DEV-ONLY bypass (matches publishLocation / detectCrossedUsers). Engages
    // only when the Convex deployment env explicitly sets
    // EXPO_PUBLIC_DEMO_AUTH_MODE to "true". Production behavior is unchanged
    // because this env is NOT auto-propagated from .env.local to the Convex
    // deployment.
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentUser.verificationStatus !== 'verified' && !isDevBypass) return [];

    // Viewer coordinates are server-only and used solely for optional coarse
    // distance buckets. They are never returned to the client.
    const myLat = currentUser.publishedLat ?? currentUser.latitude;
    const myLng = currentUser.publishedLng ?? currentUser.longitude;

    // Get current user's age for filtering
    const myAge = calculateAge(currentUser.dateOfBirth);

    // Inclusion source: active, non-hidden crossed-path history only.
    // This deliberately does NOT read candidate publishedLat/publishedLng.
    const [asUser1, asUser2] = await Promise.all([
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .collect(),
      ctx.db
        .query('crossPathHistory')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .collect(),
    ]);

    const latestHistoryByUser = new Map<string, Doc<'crossPathHistory'>>();
    // STABILITY FIX (Crossed Paths): Track the EARLIEST history entry per
    // pair as well. We anchor the marker to this immutable origin event when
    // the pair record's firstCrossing* fields are absent (legacy rows).
    const earliestHistoryByUser = new Map<string, Doc<'crossPathHistory'>>();
    for (const entry of [...asUser1, ...asUser2]) {
      if (entry.expiresAt <= now) continue;
      const isUser1 = entry.user1Id === userId;
      if (isUser1 && entry.hiddenByUser1) continue;
      if (!isUser1 && entry.hiddenByUser2) continue;
      if (
        typeof entry.crossedLatApprox !== 'number' ||
        typeof entry.crossedLngApprox !== 'number'
      ) {
        continue;
      }

      const otherUserId = isUser1 ? entry.user2Id : entry.user1Id;
      const previous = latestHistoryByUser.get(otherUserId as string);
      if (!previous || entry.createdAt > previous.createdAt) {
        latestHistoryByUser.set(otherUserId as string, entry);
      }
      const previousEarliest = earliestHistoryByUser.get(otherUserId as string);
      if (!previousEarliest || entry.createdAt < previousEarliest.createdAt) {
        earliestHistoryByUser.set(otherUserId as string, entry);
      }
    }

    const historyEntries = [...latestHistoryByUser.entries()]
      .sort((a, b) => b[1].createdAt - a[1].createdAt);
    const otherUserIds = historyEntries.map(([id]) => id);
    if (otherUserIds.length === 0) return [];

    const crossedPathEntries = await Promise.all(
      otherUserIds.map(async (otherUserId) => [
        otherUserId,
        await getCrossedPathForPair(ctx, userId, otherUserId as Id<'users'>),
      ] as const),
    );
    const crossedPathByOtherUserId = new Map<string, Doc<'crossedPaths'>>();
    const dismissedOtherUserIds = new Set<string>();
    for (const [otherUserId, crossedPath] of crossedPathEntries) {
      if (!crossedPath) continue;
      crossedPathByOtherUserId.set(otherUserId, crossedPath);
      if (isPairDismissedForViewer(crossedPath, userId)) {
        dismissedOtherUserIds.add(otherUserId);
      }
    }

    const [
      exclusions,
      swipedUsersMap,
      photoCountsMap,
      primaryPhotoUrlMap,
      fetchedUsers,
    ] = await Promise.all([
      loadDiscoveryExclusions(ctx, userId),
      prefetchSwipes(ctx, userId),
      prefetchPhotoCounts(ctx, otherUserIds),
      prefetchPhase1PrimaryPhotoUrls(ctx, otherUserIds),
      Promise.all(otherUserIds.map((id) => ctx.db.get(id as Id<'users'>))),
    ]);
    const blockedIds = exclusions.blockedUserIds;
    const unmatchedUserIds = exclusions.unmatchedUserIds;
    const viewerReportedIds = exclusions.viewerReportedIds;

    const usersMap = new Map<string, Doc<'users'>>();
    otherUserIds.forEach((id, i) => {
      const user = fetchedUsers[i];
      if (user) usersMap.set(id, user as Doc<'users'>);
    });

    // Build results from crossed-path event coordinates. No current/latest
    // candidate location is used for inclusion or returned to the frontend.
    const viewerActivities = new Set(currentUser.activities ?? []);
    const viewerIntent = new Set(currentUser.relationshipIntent ?? []);

    const results = [];

    for (const [otherUserId, entry] of historyEntries) {
      if (dismissedOtherUserIds.has(otherUserId)) continue;

      const user = usersMap.get(otherUserId);
      if (!user || user._id === userId) continue;
      if (!user.isActive) continue;

      // Candidate privacy gates. These remain server-side so a client cannot
      // opt into seeing someone who is hidden, paused, blocked, unmatched, or
      // reported.
      if (user.incognitoMode === true) continue;
      if (user.nearbyEnabled === false) continue;
      if (user.nearbyPausedUntil && user.nearbyPausedUntil > now) continue;

      const candidateStatus = user.verificationStatus || 'unverified';
      if (candidateStatus !== 'verified' && !isDevBypass) continue;

      // Basic info completeness
      if (!user.name || !user.bio || !user.dateOfBirth) continue;

      // Age filtering (both directions)
      const otherAge = calculateAge(user.dateOfBirth);
      if (myAge < user.minAge || myAge > user.maxAge) continue;
      if (otherAge < currentUser.minAge || otherAge > currentUser.maxAge) continue;

      // Gender/orientation preference match (both directions)
      if (
        !orientationAllowsCandidateGender({
          viewerGender: currentUser.gender,
          viewerOrientation: currentUser.orientation ?? undefined,
          candidateGender: user.gender,
        }) ||
        !orientationAllowsCandidateGender({
          viewerGender: user.gender,
          viewerOrientation: user.orientation ?? undefined,
          candidateGender: currentUser.gender,
        })
      ) continue;
      if (!currentUser.lookingFor.includes(user.gender)) continue;
      if (!user.lookingFor.includes(currentUser.gender)) continue;

      if (blockedIds.has(otherUserId)) continue;
      if (unmatchedUserIds.has(otherUserId)) continue;
      if (viewerReportedIds.has(otherUserId)) continue;

      // Skip filter (using pre-fetched map)
      const existingSwipe = swipedUsersMap.get(otherUserId);
      if (existingSwipe) {
        if (existingSwipe.action !== 'pass') continue;
        if (existingSwipe.createdAt > now - 7 * 24 * 60 * 60 * 1000) continue;
      }

      const photoUrl = primaryPhotoUrlMap.get(user._id as string) ?? null;
      if (!photoUrl) continue;

      const photoCount = photoCountsMap.get(user._id as string) || 0;
      if (photoCount < 2) continue;

      const crossedPath = crossedPathByOtherUserId.get(otherUserId);
      const crossingCount = Math.max(1, crossedPath?.count ?? 1);
      const lastCrossedAt = crossedPath?.lastCrossedAt ?? entry.createdAt;

      const crossingAge = now - entry.createdAt;
      const freshness: 'solid' | 'faded' = crossingAge <= SOLID_WINDOW_MS ? 'solid' : 'faded';
      const freshnessLabel: 'recent' | 'earlier' | 'stale' =
        crossingAge <= NEARBY_RECENT_WINDOW_MS
          ? 'recent'
          : crossingAge <= NEARBY_EARLIER_WINDOW_MS
          ? 'earlier'
          : 'stale';

      // STABILITY FIX (Crossed Paths): Anchor the marker to the immutable
      // first-crossing point so the pin does NOT move on repeat crossings.
      // Resolution order (see pickStableCrossingCoords):
      //   1. crossedPaths.firstCrossingLat/Long (set on first crossing).
      //   2. earliest crossPathHistory entry (immutable per-event approx).
      //   3. legacy crossedPaths.crossingLat/Long (latest; only as fallback).
      //   4. latest crossPathHistory entry as a final fallback.
      const earliestEntry = earliestHistoryByUser.get(otherUserId);
      const stableCoords = pickStableCrossingCoords(
        crossedPath,
        earliestEntry,
        entry,
      );
      if (!stableCoords) continue;
      let cellLat = stableCoords.lat;
      let cellLng = stableCoords.lng;
      if (user.strongPrivacyMode === true) {
        // Pair-stable seed so the Strong Privacy fuzz does NOT change when a
        // new crossPathHistory row is inserted for the same pair.
        const seed = simpleHash(`${String(user._id)}:pair:${String(crossedPath?._id ?? otherUserId)}`);
        const bearingRad = (seed % 360) * (Math.PI / 180);
        const distanceMeters = 200 + (seed % 201);
        const fuzzed = offsetCoords(cellLat, cellLng, distanceMeters, bearingRad);
        const resnapped = roundToGrid(fuzzed.lat, fuzzed.lng);
        cellLat = resnapped.lat;
        cellLng = resnapped.lng;
      }

      // STABILITY FIX (Crossed Paths): Pair-stable jitter seed. The previous
      // event-bound seed (`crossed:${entry._id}:${entry.createdAt}`) caused
      // the marker to wobble whenever a new crossPathHistory entry was
      // inserted for the same pair. Anchoring on the pair record id (or the
      // ordered pair as a fallback) keeps the displayed point stable across
      // refreshes and across repeat crossings while still randomising
      // *inside* the same ~300 m grid cell for privacy.
      const pairStableSeedKey = crossedPath?._id
        ? `crossed-pair:${String(crossedPath._id)}`
        : `crossed-pair:${String(userId)}:${String(otherUserId)}`;
      const display = makeDisplayLatLng(cellLat, cellLng, pairStableSeedKey);
      const cellId = makeCellId(cellLat, cellLng);

      let distanceBucket: NearbyDistanceBucket | undefined;
      if (
        user.hideDistance !== true &&
        typeof myLat === 'number' &&
        typeof myLng === 'number'
      ) {
        distanceBucket = bucketNearbyDistance(
          calculateDistanceMeters(myLat, myLng, cellLat, cellLng),
        ).label;
      }

      // --- Phase-3: preview fields + ranking signals ---

      // Shared interests: intersection of activities + relationshipIntent,
      // capped at 3. Only existing profile fields — no new data collection.
      const shared: string[] = [];
      for (const a of user.activities ?? []) {
        if (shared.length >= 3) break;
        if (viewerActivities.has(a)) shared.push(a);
      }
      for (const intent of user.relationshipIntent ?? []) {
        if (shared.length >= 3) break;
        if (viewerIntent.has(intent) && !shared.includes(intent)) shared.push(intent);
      }

      // Tagline: short human-readable hint derived from the target's own
      // profile (no per-viewer leakage). Preference order:
      //   1) first profile prompt answer (trimmed, <= 80 chars)
      //   2) first activity / interest
      //   3) bio snippet (<= 80 chars)
      const firstPrompt = (user.profilePrompts ?? []).find(
        (p: { question?: string; answer?: string }) =>
          typeof p?.answer === 'string' && p.answer.trim().length > 0,
      );
      const firstActivity = (user.activities ?? []).find(
        (a: string) => typeof a === 'string' && a.trim().length > 0,
      );
      let tagline: string | undefined;
      if (firstPrompt && typeof firstPrompt.answer === 'string') {
        tagline = clipText(firstPrompt.answer, 80);
      } else if (firstActivity) {
        tagline = `Into ${firstActivity.replace(/_/g, ' ')}`;
      } else if (user.bio) {
        tagline = clipText(user.bio, 80);
      }

      results.push({
        crossedAt: entry.createdAt,
        item: {
          id: user._id,
          historyId: entry._id,
          name: user.name,
          age: calculateAge(user.dateOfBirth),
          cellId,
          displayLat: display.lat,
          displayLng: display.lng,
          distanceBucket,
          freshness,
          freshnessLabel,
          photoUrl,
          isVerified: user.isVerified || candidateStatus === 'verified',
          verificationStatus: user.verificationStatus ?? 'unverified',
          strongPrivacyMode: user.strongPrivacyMode ?? false,
          hideDistance: user.hideDistance ?? false,
          crossingCount,
          // Capped display ("1" / "2" / "3+") — clients should prefer this
          // over crossingCount for any UI string.
          crossingCountDisplay: getCrossingCountDisplay(crossingCount),
          lastCrossedAt,
          areaName: entry.areaName,
          // Phase-3 preview payload.
          tagline,
          sharedInterests: shared.length > 0 ? shared : undefined,
        },
      });
    }

    // Main Nearby feed order is latest crossed-path event first. It is not
    // ranked by latest published location or exact distance.
    results.sort((a, b) => b.crossedAt - a.crossedAt);

    // Fix 7 — apply per-viewer daily distinct crossed-profile cap. Existing
    // pairs and same-day re-displays pass through; brand-new pairs consume
    // one slot until the daily quota is exhausted.
    const flatResults = results.map((result) => result.item);
    return await applyDailyDistinctCrossedProfileCap(ctx, userId, flatResults, now);
  },
});

// ---------------------------------------------------------------------------
// Fix 7 — markDailyCrossedProfilesShown
// Persist the set of crossed profiles a viewer actually saw today so the
// daily-cap helper above can correctly count "new" surfaces vs re-displays.
// Clients call this after the Nearby list renders. The mutation is
// idempotent: re-marking the same pair on the same UTC day patches
// lastShownAt without consuming an additional slot.
// ---------------------------------------------------------------------------
export const markDailyCrossedProfilesShown = mutation({
  args: {
    authUserId: v.string(),
    targetUserIds: v.array(v.id('users')),
  },
  handler: async (ctx, args) => {
    const viewerId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!viewerId) {
      return { success: false, reason: 'unauthorized' };
    }

    const now = Date.now();
    const dateKey = getDailyShownDateKey(now);
    // Bound the work per call so a misbehaving client cannot make us scan
    // unbounded pairs in a single mutation.
    const uniqueTargetIds = [...new Set(args.targetUserIds.map(String))]
      .filter((id) => id !== (viewerId as string))
      .slice(0, MAX_DAILY_NEW_CROSSED_PROFILES * 2) as Id<'users'>[];

    let inserted = 0;
    let updated = 0;

    for (const targetUserId of uniqueTargetIds) {
      const pairKey = makeDailyShownPairKey(viewerId, targetUserId);
      const existingShown = await ctx.db
        .query('crossedPathDailyShown')
        .withIndex('by_viewer_date_pair', (q) =>
          q.eq('viewerId', viewerId).eq('dateKey', dateKey).eq('pairKey', pairKey),
        )
        .first();
      const existingCrossedPath = await getCrossedPathPair(ctx, viewerId, targetUserId);
      const wasExistingCrossedPath = existingCrossedPath !== null;

      if (existingShown) {
        await ctx.db.patch(existingShown._id, {
          lastShownAt: now,
          expiresAt: now + DAILY_SHOWN_RETENTION_MS,
          // Latch this flag — once a pair was "free" because it was already
          // crossed, future re-displays should remain "free" even if the
          // crossedPaths row is later removed.
          wasExistingCrossedPath:
            existingShown.wasExistingCrossedPath === true || wasExistingCrossedPath,
        });
        updated++;
      } else {
        await ctx.db.insert('crossedPathDailyShown', {
          viewerId,
          dateKey,
          pairKey,
          targetUserId,
          firstShownAt: now,
          lastShownAt: now,
          expiresAt: now + DAILY_SHOWN_RETENTION_MS,
          wasExistingCrossedPath,
        });
        inserted++;
      }
    }

    return { success: true, inserted, updated };
  },
});

// ---------------------------------------------------------------------------
// cleanupExpiredCrossedPathDailyShown — TTL sweep for daily-shown ledger rows.
// New rows expire via expiresAt; legacy rows without expiresAt are swept by
// dateKey after the same 30-day retention window.
// ---------------------------------------------------------------------------

export const cleanupExpiredCrossedPathDailyShown = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffDateKey = getDailyShownDateKey(now - DAILY_SHOWN_RETENTION_MS);
    const BATCH = 100;

    const expiredRows = await ctx.db
      .query('crossedPathDailyShown')
      .withIndex('by_expires')
      .filter((q) =>
        q.and(
          q.neq(q.field('expiresAt'), undefined),
          q.lte(q.field('expiresAt'), now),
        )
      )
      .take(BATCH);

    let deleted = 0;
    for (const row of expiredRows) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    const legacyRows = await ctx.db
      .query('crossedPathDailyShown')
      .withIndex('by_date_key', (q) => q.lt('dateKey', cutoffDateKey))
      .take(BATCH);

    for (const row of legacyRows) {
      await ctx.db.delete(row._id);
      deleted++;
    }

    return { deleted };
  },
});

// ---------------------------------------------------------------------------
// getCrossPathHistory — crossed paths history list (30-day retention)
// Returns crossed paths with approximate location and reason tags.
// Filters out hidden entries for the requesting user.
//
// Privacy contract:
//   - Never return raw users.latitude/users.longitude or crossedPaths legacy
//     crossingLatitude/crossingLongitude fields.
//   - Only return approximate crossed-path coordinates from crossPathHistory.
//   - Area copy is downgraded to a generic label when repeated same-cell
//     crossings could expose a sensitive routine location.
// ---------------------------------------------------------------------------

export const getCrossPathHistory = query({
  args: { authUserId: v.string() }, // CONTRACT FIX: Changed from userId: v.id('users')
  handler: async (ctx, { authUserId }) => {
    // Resolve authUserId to Convex user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return []; // Graceful fallback
    }

    const now = Date.now();

    // Get current user for distance calculation
    const currentUser = await ctx.db.get(userId);

    // P2 — Consent read-gate. Requester must have accepted the current
    // Nearby / Crossed Paths disclosure before any history payload is
    // returned. Mirrors the gate on getNearbyUsers and the existing
    // write-path gates.
    if (!currentUser || !hasNearbyConsent(currentUser)) return [];

    const myLat = currentUser?.publishedLat ?? currentUser?.latitude;
    const myLng = currentUser?.publishedLng ?? currentUser?.longitude;

    // P1-3: Block filter — blocked users (either direction) must never
    // appear in crossed-paths history.
    // P1 EXCLUSION: also hide unmatched pairs (bidirectional) and users the
    // viewer has reported (one-way).
    const {
      blockedUserIds: blockedIds,
      unmatchedUserIds,
      viewerReportedIds,
    } = await loadDiscoveryExclusions(ctx, userId);

    // Pre-fetch swipes for skip filtering (matches Discover behavior per Rule 9)
    const mySwipes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', userId))
      .collect();
    const swipedUsersMap = new Map<string, { action: string; createdAt: number }>();
    for (const swipe of mySwipes) {
      swipedUsersMap.set(swipe.toUserId as string, {
        action: swipe.action,
        createdAt: swipe.createdAt,
      });
    }

    const asUser1 = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect();

    const asUser2 = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .collect();

    const filteredHistory = [...asUser1, ...asUser2]
      .filter((entry) => {
        // Filter expired entries (14 days)
        if (entry.expiresAt <= now) return false;

        // Filter hidden entries for this user
        const isUser1 = entry.user1Id === userId;
        if (isUser1 && entry.hiddenByUser1) return false;
        if (!isUser1 && entry.hiddenByUser2) return false;

        // P1-3: Block filter — drop entries where the other party is blocked
        // in either direction (using pre-fetched set for O(1) lookup).
        const otherUserId = isUser1 ? entry.user2Id : entry.user1Id;
        if (blockedIds.has(otherUserId as string)) return false;
        // P1 EXCLUSION: drop history rows for unmatched pairs and viewer-reported
        // users so history stays consistent with the Nearby/Discover surfaces.
        if (unmatchedUserIds.has(otherUserId as string)) return false;
        if (viewerReportedIds.has(otherUserId as string)) return false;

        // Skip filter: Same as Discover behavior (Rule 9)
        const existingSwipe = swipedUsersMap.get(otherUserId as string);
        if (existingSwipe) {
          if (existingSwipe.action !== 'pass') return false; // Skip likes/super_likes
          if (existingSwipe.createdAt > now - 7 * 24 * 60 * 60 * 1000) return false; // Skip recent passes
        }

        return true;
      });

    const filteredOtherUserIds = filteredHistory.map((entry) =>
      entry.user1Id === userId ? String(entry.user2Id) : String(entry.user1Id),
    );
    const dismissedOtherUserIds = await getDismissedOtherUserIds(
      ctx,
      userId,
      filteredOtherUserIds,
    );

    const all = filteredHistory
      .filter((entry) => {
        const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
        return !dismissedOtherUserIds.has(otherUserId as string);
      })
      .sort((a, b) => b.createdAt - a.createdAt) // newest first
      .slice(0, MAX_HISTORY_ENTRIES);

    const pairCellCounts = buildPairCellCounts(all);

    // Collect unique other user IDs
    const otherUserIds = [...new Set(
      all.map((entry) => entry.user1Id === userId ? entry.user2Id : entry.user1Id)
    )];

    // Batch fetch crossing counts from crossedPaths table
    const crossingCountsMap = new Map<string, number>();
    for (const otherUserId of otherUserIds) {
      const orderedUser1 = userId < otherUserId ? userId : otherUserId;
      const orderedUser2 = userId < otherUserId ? otherUserId : userId;
      const crossedPath = await ctx.db
        .query('crossedPaths')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2),
        )
        .first();
      crossingCountsMap.set(otherUserId as string, crossedPath?.count ?? 1);
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

    // Parallel fetch phase-1 primary photos from the user's public photo grid.
    const photosMap = await prefetchPhase1PrimaryPhotoUrls(ctx, otherUserIds.map(String));

    // Build results using pre-fetched data
    const results = [];
    for (const entry of all) {
      const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
      const otherUser = usersMap.get(otherUserId as string);
      if (!otherUser || !otherUser.isActive) continue;

      // P0 FIX: Privacy filtering - hide users who disabled/paused Nearby
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;
      if (otherUser.incognitoMode === true) continue;

      const photoUrl = photosMap.get(otherUserId as string) ?? null;
      if (!photoUrl) continue;

      const crossingCount = crossingCountsMap.get(otherUserId as string) || 1;

      // Format reason for "why am I seeing this?" explanation
      const reasonTags = entry.reasonTags ?? [];
      const reasonText = reasonTags.length > 0
        ? formatReasonForNotification(reasonTags[0])
        : null;

      // Build "why am I seeing this" explanation. Use the bucketed display so
      // we never leak raw crossing counts (Fix 4).
      const crossingCountDisplayForWhy = getCrossingCountDisplay(crossingCount);
      let whyExplanation: string;
      if (crossingCount > 1) {
        whyExplanation = `You've crossed paths ${crossingCountDisplayForWhy} times in similar areas. ${reasonText || 'You have something in common.'}`;
      } else {
        whyExplanation = `You were in the same area within the last 24 hours. ${reasonText || 'You have something in common.'}`;
      }

      // Area name: only reveal after repeated crossings, and never reveal when
      // repeat crossings cluster in the same approximate cell.
      const pairCellKey = makePairCellKey(entry);
      const pairCellCount = pairCellKey ? (pairCellCounts.get(pairCellKey) ?? 1) : 1;
      const displayAreaName = getPrivacySafeAreaName(
        entry.areaName,
        crossingCount,
        pairCellCount,
      );

      // P0-3: Strong Privacy consistency for crossed-path history.
      // When the other user has Strong Privacy Mode on, both the approximate
      // location AND the distance we return must be coarsened by the same
      // deterministic offset — otherwise the viewer could back-solve the real
      // location from (self coord, distance).
      let approxLat = entry.crossedLatApprox;
      let approxLng = entry.crossedLngApprox;
      if (
        otherUser.strongPrivacyMode === true &&
        approxLat !== undefined &&
        approxLng !== undefined
      ) {
        const seed = simpleHash(String(otherUser._id));
        const bearingRad = (seed % 360) * (Math.PI / 180);
        const offsetMeters = 200 + (seed % 201); // 200–400 m, deterministic
        const fuzzed = offsetCoords(approxLat, approxLng, offsetMeters, bearingRad);
        approxLat = fuzzed.lat;
        approxLng = fuzzed.lng;
      }

      // Calculate distance range for display (Phase-2: no exact km).
      // Uses the (possibly fuzzed) approxLat/approxLng so the returned range is
      // consistent with the location the client can see.
      let distanceRange: string | null = null;
      if (myLat && myLng && approxLat !== undefined && approxLng !== undefined) {
        const distanceMeters = calculateDistanceMeters(
          myLat,
          myLng,
          approxLat,
          approxLng,
        );
        distanceRange = formatDistanceRange(distanceMeters);
      }
      if (otherUser.hideDistance === true) {
        distanceRange = null;
      }
      const locationDisclosure =
        otherUser.hideDistance === true
          ? 'distance_hidden'
          : otherUser.strongPrivacyMode === true
          ? 'approximate_area'
          : null;

      // Calculate relative time for display
      const relativeTime = formatRelativeTime(entry.createdAt, now);

      results.push({
        id: entry._id,
        otherUserId,
        otherUserName: otherUser.name,
        otherUserAge: calculateAge(otherUser.dateOfBirth),
        areaName: displayAreaName,
        // Approximate crossing location (not current location — persists across travel)
        crossedLatApprox: approxLat,
        crossedLngApprox: approxLng,
        // Crossing count (for UI display)
        crossingCount,
        // Capped display ("1" / "2" / "3+") — clients should prefer this
        // over crossingCount for any UI string.
        crossingCountDisplay: getCrossingCountDisplay(crossingCount),
        // Distance range (e.g., "4-5 km")
        distanceRange,
        locationDisclosure,
        // Relative time (e.g., "today", "yesterday", "3 days ago")
        relativeTime,
        // Reason tags and formatted text
        reasonTags,
        reasonText,
        // "Why am I seeing this?" explanation
        whyExplanation,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        photoUrl,
        initial: otherUser.name.charAt(0),
        isVerified: otherUser.isVerified,
      });
    }

    // Sort: crossing count (higher first), then recency
    results.sort((a, b) => {
      if (b.crossingCount !== a.crossingCount) return b.crossingCount - a.crossingCount;
      return b.createdAt - a.createdAt;
    });

    // Fix 7 (P1) — apply per-viewer daily distinct crossed-profile cap.
    // History rows can repeat the same other user, so dedupe by user ID
    // before running the cap and use the surviving set to filter the
    // result list. Already-shown-today and already-crossed pairs pass
    // through unchanged. Order is preserved by filter().
    const uniqueOtherUserIds = [
      ...new Set(results.map((r) => String(r.otherUserId))),
    ];
    const cappedUsers = await applyDailyDistinctCrossedProfileCap(
      ctx,
      userId,
      uniqueOtherUserIds.map((id) => ({ id: id as Id<'users'> })),
      now,
    );
    const allowedOtherUserIds = new Set(cappedUsers.map((u) => String(u.id)));
    const cappedResults = results.filter((r) =>
      allowedOtherUserIds.has(String(r.otherUserId)),
    );

    // [CROSSED_PATHS_AUDIT] ui — what the client-side list receives.
    console.log('[CROSSED_PATHS_AUDIT][ui]', {
      viewer: userId,
      entriesReturned: cappedResults.length,
      hasReasonOverlap: cappedResults.filter((r) => (r.reasonTags?.[0] ?? '') !== 'nearby').length,
      nearbyOnly: cappedResults.filter((r) => (r.reasonTags?.[0] ?? '') === 'nearby').length,
    });

    return cappedResults;
  },
});

// ---------------------------------------------------------------------------
// hideCrossedPath — mark a crossed path as hidden for the current user
// ---------------------------------------------------------------------------

// P2 SECURITY: Uses authUserId + server-side resolution to prevent spoofing.
export const hideCrossedPath = mutation({
  args: {
    authUserId: v.string(), // P2 SECURITY: Server-side auth instead of trusting client
    historyId: v.id('crossPathHistory'),
  },
  handler: async (ctx, args) => {
    const { authUserId, historyId } = args;
    const now = Date.now();

    // P2 SECURITY: Resolve auth ID to Convex user ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

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

    const otherUserId = isUser1 ? entry.user2Id : entry.user1Id;
    const { user1Id, user2Id } = await setPairDismissedForViewer(
      ctx,
      userId,
      otherUserId,
      now,
    );

    // Backward compatibility: hide current and existing active history rows
    // for this viewer only. The other viewer's visibility is untouched.
    await hideActiveHistoryRowsForViewer(ctx, userId, user1Id, user2Id, now);

    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// deleteCrossedPath — permanently delete a crossed path entry
// ---------------------------------------------------------------------------

// P2 SECURITY: Uses authUserId + server-side resolution to prevent spoofing.
export const deleteCrossedPath = mutation({
  args: {
    authUserId: v.string(), // P2 SECURITY: Server-side auth instead of trusting client
    historyId: v.id('crossPathHistory'),
  },
  handler: async (ctx, args) => {
    const { authUserId, historyId } = args;
    const now = Date.now();

    // P2 SECURITY: Resolve auth ID to Convex user ID server-side
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const entry = await ctx.db.get(historyId);
    if (!entry) {
      return { success: false, reason: 'not_found' };
    }

    // Verify user is part of this crossed path
    if (entry.user1Id !== userId && entry.user2Id !== userId) {
      return { success: false, reason: 'unauthorized' };
    }

    const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
    const { user1Id, user2Id } = await setPairDismissedForViewer(
      ctx,
      userId,
      otherUserId,
      now,
    );

    // Viewer-scoped remove: keep shared rows for the other user, but hide all
    // active history rows from the requester and suppress future resurfacing.
    await hideActiveHistoryRowsForViewer(ctx, userId, user1Id, user2Id, now);

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
// Privacy: returns only approximate crossed-path coordinates and generic area
// copy. Never return raw user coordinates or legacy crossedPaths coordinates.
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
      if (entry.expiresAt <= now) return false;
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
    const dismissedOtherUserIds = await getDismissedOtherUserIds(
      ctx,
      userId,
      filtered.map((entry) =>
        entry.user1Id === userId ? String(entry.user2Id) : String(entry.user1Id),
      ),
    );

    // Return minimal entry data — NO photo joins. We do fetch the other user
    // only to enforce current visibility/privacy state server-side, including
    // Incognito Nearby suppressing old history for everyone else.
    const visibleEntries: Array<{
      entry: Doc<'crossPathHistory'>;
      otherUserId: Id<'users'>;
    }> = [];
    for (const entry of filtered) {
      const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
      if (dismissedOtherUserIds.has(otherUserId as string)) continue;

      const otherUser = await ctx.db.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;
      if (otherUser.incognitoMode === true) continue;

      visibleEntries.push({ entry, otherUserId });
    }

    return visibleEntries.map(({ entry, otherUserId }) => ({
      id: entry._id,
      otherUserId,
      createdAt: entry.createdAt,
      crossedLatApprox: entry.crossedLatApprox ?? null,
      crossedLngApprox: entry.crossedLngApprox ?? null,
      areaName: GENERIC_CROSSING_AREA_NAME,
      reasonTags: entry.reasonTags ?? [],
    }));
  },
});

// ---------------------------------------------------------------------------
// getCrossedPaths — crossed paths list (no unlock system)
// Returns crossing counts and user info for display.
// Privacy: legacy crossedPaths crossingLatitude/crossingLongitude are not
// returned and are not used for public distance labels; labels use active
// crossPathHistory approximate event coordinates when available.
// ---------------------------------------------------------------------------

export const getCrossedPaths = query({
  args: {
    authUserId: v.string(), // CONTRACT FIX: Changed from userId: v.id('users') to authUserId
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { authUserId, limit = 15 } = args;

    // Resolve authUserId to Convex user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return []; // Graceful fallback for missing user
    }
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

    const allCrossedPaths = [...asUser1, ...asUser2].filter(
      (cp) => cp.count > 0 && !isPairDismissedForViewer(cp, userId),
    );

    // Sort by recency only. Do not rank by legacy crossingLatitude/Longitude
    // because older rows may contain pre-hardening raw coordinates.
    allCrossedPaths.sort((a, b) => {
      return b.lastCrossedAt - a.lastCrossedAt;
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

    // Parallel fetch phase-1 primary photos from the user's public photo grid.
    const photosMap = await prefetchPhase1PrimaryPhotoUrls(ctx, otherUserIds.map(String));

    // Build results using pre-fetched data
    const result = [];
    for (const cp of topCrossedPaths) {
      const otherUserId = cp.user1Id === userId ? cp.user2Id : cp.user1Id;
      const otherUser = usersMap.get(otherUserId as string);

      if (!otherUser || !otherUser.isActive) continue;

      // P0 FIX: Privacy filtering - hide users who disabled/paused Nearby
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;
      if (otherUser.incognitoMode === true) continue;

      const photoUrl = photosMap.get(otherUserId as string) ?? null;
      if (!photoUrl) continue;

      const orderedUser1 = userId < otherUserId ? userId : otherUserId;
      const orderedUser2 = userId < otherUserId ? otherUserId : userId;
      const latestHistories = await ctx.db
        .query('crossPathHistory')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2),
        )
        .collect();
      const latestHistory = latestHistories
        .filter((entry) => entry.expiresAt > now)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      let approxLat = latestHistory?.crossedLatApprox;
      let approxLng = latestHistory?.crossedLngApprox;
      if (
        otherUser.strongPrivacyMode === true &&
        approxLat !== undefined &&
        approxLng !== undefined
      ) {
        const seed = simpleHash(String(otherUser._id));
        const bearingRad = (seed % 360) * (Math.PI / 180);
        const offsetMeters = 200 + (seed % 201);
        const fuzzed = offsetCoords(approxLat, approxLng, offsetMeters, bearingRad);
        approxLat = fuzzed.lat;
        approxLng = fuzzed.lng;
      }

      // Calculate distance range from active approximate history only.
      let distanceRange: string | null = null;
      if (
        typeof myLat === 'number' &&
        typeof myLng === 'number' &&
        approxLat !== undefined &&
        approxLng !== undefined
      ) {
        const distanceMeters = calculateDistanceMeters(
          myLat,
          myLng,
          approxLat,
          approxLng,
        );
        distanceRange = formatDistanceRange(distanceMeters);
      }
      if (otherUser.hideDistance === true) {
        distanceRange = null;
      }

      // Calculate relative time
      const relativeTime = formatRelativeTime(cp.lastCrossedAt, now);

      result.push({
        id: cp._id,
        count: cp.count,
        // Capped display — clients never see the precise count once it
        // crosses 3. Use this for any UI string.
        crossingCountDisplay: getCrossingCountDisplay(cp.count),
        lastCrossedAt: cp.lastCrossedAt,
        relativeTime,
        distanceRange,
        user: {
          id: otherUserId,
          name: otherUser.name,
          age: calculateAge(otherUser.dateOfBirth),
          photoUrl,
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
    const now = Date.now();

    const [user1, user2] = await Promise.all([
      ctx.db.get(user1Id),
      ctx.db.get(user2Id),
    ]);
    if (!user1 || !user2) return { count: 0, exists: false };
    if (user1.incognitoMode === true || user2.incognitoMode === true) {
      return { count: 0, exists: false };
    }
    if (user1.nearbyEnabled === false || user2.nearbyEnabled === false) {
      return { count: 0, exists: false };
    }
    if (
      (user1.nearbyPausedUntil && user1.nearbyPausedUntil > now) ||
      (user2.nearbyPausedUntil && user2.nearbyPausedUntil > now)
    ) {
      return { count: 0, exists: false };
    }

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
    const now = Date.now();

    const asUser1 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect();

    const asUser2 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .collect();

    const visibleCrossedPaths = [...asUser1, ...asUser2].filter(
      (cp) => cp.count > 0 && !isPairDismissedForViewer(cp, userId),
    );

    let count = 0;
    for (const cp of visibleCrossedPaths) {
      const otherUserId = cp.user1Id === userId ? cp.user2Id : cp.user1Id;
      const otherUser = await ctx.db.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;
      if (otherUser.incognitoMode === true) continue;
      count++;
    }

    return count;
  },
});

// ---------------------------------------------------------------------------
// getCrossedPathSummary — get count and latest timestamp for badge display
// FIX: Use userId (authUserId) instead of token for consistency
// ---------------------------------------------------------------------------

export const getCrossedPathSummary = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Resolve authUserId to Convex ID
    const userId = await resolveUserIdByAuthId(ctx, args.userId);
    if (!userId) {
      return { count: 0, latestCreatedAt: null };
    }

    // P2 — Consent read-gate. Requester must have accepted the current
    // Nearby / Crossed Paths disclosure before any summary is exposed.
    const requester = await ctx.db.get(userId);
    if (!requester || !hasNearbyConsent(requester)) {
      return { count: 0, latestCreatedAt: null };
    }

    // Get all crossed paths for this user
    const [asUser1, asUser2] = await Promise.all([
      ctx.db
        .query('crossedPaths')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .collect(),
      ctx.db
        .query('crossedPaths')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .collect(),
    ]);

    const allCrossedPaths = [...asUser1, ...asUser2].filter(
      (path) => path.count > 0 && !isPairDismissedForViewer(path, userId),
    );

    // Find the latest createdAt timestamp
    const now = Date.now();
    let count = 0;
    let latestCreatedAt: number | null = null;
    for (const path of allCrossedPaths) {
      const otherUserId = path.user1Id === userId ? path.user2Id : path.user1Id;
      const otherUser = await ctx.db.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;
      if (otherUser.incognitoMode === true) continue;

      count++;
      const ts = path.lastCrossedAt ?? path._creationTime;
      if (latestCreatedAt === null || ts > latestCreatedAt) {
        latestCreatedAt = ts;
      }
    }

    return { count, latestCreatedAt };
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
    viewerId: v.id('users'),    // Current user viewing the profile
    profileUserId: v.id('users'), // User whose profile is being viewed
  },
  handler: async (ctx, args) => {
    const { viewerId, profileUserId } = args;

    // Don't show shared places for self
    if (viewerId === profileUserId) {
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
  const asUser1 = await ctx.db
    .query('crossPathHistory')
    .withIndex('by_user1', (q: any) => q.eq('user1Id', userId))
    .collect();

  const asUser2 = await ctx.db
    .query('crossPathHistory')
    .withIndex('by_user2', (q: any) => q.eq('user2Id', userId))
    .collect();

  const all = [...asUser1, ...asUser2].sort(
    (a: any, b: any) => b.createdAt - a.createdAt,
  );

  // Delete entries beyond the limit
  if (all.length > MAX_HISTORY_ENTRIES) {
    const toDelete = all.slice(MAX_HISTORY_ENTRIES);
    for (const entry of toDelete) {
      await ctx.db.delete(entry._id);
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
 * Phase-1 privacy helper: bucket a computed distance (in meters) into a coarse
 * label + a bucket-midpoint numeric value. The midpoint is what gets returned
 * on the Nearby payload in place of raw meters, so clients can still sort
 * stably (nearer buckets rank before farther ones) without learning
 * sub-bucket precision.
 *
 *   very_close    : < 200 m  (midpoint 100)
 *   nearby        : 200–500 m (midpoint 350)
 *   in_your_area  : 500–1000 m (midpoint 750)
 *
 * Anything above 1 km is already filtered out by the Nearby eligibility loop,
 * but we clamp to 'in_your_area' defensively.
 */
type NearbyDistanceBucket = 'very_close' | 'nearby' | 'in_your_area';
function bucketNearbyDistance(meters: number): { label: NearbyDistanceBucket; midpoint: number } {
  if (meters < 200) return { label: 'very_close', midpoint: 100 };
  if (meters < 500) return { label: 'nearby', midpoint: 350 };
  return { label: 'in_your_area', midpoint: 750 };
}

/**
 * Round coordinates to a grid for privacy.
 * Returns approximate location that doesn't reveal exact position.
 */
function roundToGrid(lat: number, lng: number): { lat: number; lng: number } {
  // 1 degree latitude is about 111km, so LOCATION_GRID_METERS sets the
  // precision floor used by Nearby and crossed-path event locations.
  const gridSize = LOCATION_GRID_METERS / 111000;
  return {
    lat: Math.round(lat / gridSize) * gridSize,
    lng: Math.round(lng / gridSize) * gridSize,
  };
}

/**
 * Phase-3 helper: clip a string to `max` characters without cutting in the
 * middle of a word when avoidable. Returns the trimmed + ellipsised value.
 * Defensive against non-string / empty input.
 */
function clipText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Phase-2.5 privacy helper: stable cell identifier for a published (already
 * grid-snapped) coordinate. The cellId is what leaves the server as the
 * "location primitive" — it is coarse (LOCATION_GRID_METERS, ~300m) and the
 * same for everyone in the same grid cell.
 */
function makeCellId(gridLat: number, gridLng: number): string {
  return `cell:${gridLat.toFixed(5)}_${gridLng.toFixed(5)}`;
}

function makePairCellKeyFromParts(
  user1Id: Id<'users'>,
  user2Id: Id<'users'>,
  lat?: number,
  lng?: number,
): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return `${String(user1Id)}:${String(user2Id)}:${makeCellId(lat, lng)}`;
}

function makePairCellKey(entry: Doc<'crossPathHistory'>): string | null {
  return makePairCellKeyFromParts(
    entry.user1Id,
    entry.user2Id,
    entry.crossedLatApprox,
    entry.crossedLngApprox,
  );
}

function buildPairCellCounts(entries: Doc<'crossPathHistory'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = makePairCellKey(entry);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function getPrivacySafeAreaName(
  areaName: string | undefined,
  crossingCount: number,
  pairCellCount: number,
): string {
  if (crossingCount <= 1) return GENERIC_CROSSING_AREA_NAME;
  if (pairCellCount > 1) return GENERIC_CROSSING_AREA_NAME;
  return areaName || GENERIC_CROSSING_AREA_NAME;
}

/**
 * Safe Nearby v2 — snapshot-bound display point inside the originating grid
 * cell. The jitter (bearing + distance inside CELL_JITTER_RADIUS_M) is
 * deterministic per snapshot, seeded on userId + publishedAt. This means:
 *   - same snapshot → same displayLat/displayLng across viewers and requests
 *   - new snapshot (new publishedAt) → new jitter
 * This closes the multi-query jitter-averaging attack where a previous
 * Math.random() implementation let an attacker average N observations to
 * recover the ~300m grid centre.
 */
function makeDisplayLatLng(
  gridLat: number,
  gridLng: number,
  seedKey: string,
): { lat: number; lng: number } {
  const bearingSeed = simpleHash(`${seedKey}:bearing`);
  const distanceSeed = simpleHash(`${seedKey}:distance`);
  const bearingRad = ((bearingSeed % 36000) / 36000) * 2 * Math.PI;
  const distanceMeters = ((distanceSeed % 10000) / 10000) * CELL_JITTER_RADIUS_M;
  return offsetCoords(gridLat, gridLng, distanceMeters, bearingRad);
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
 * Format timestamp to a vague past-tense relative time label.
 *
 * Safe Nearby v2 — no minute-precision labels, no "just now", no hour
 * precision. The label set is intentionally short and coarse so that
 * (a) historical entries always read as past events, never as live
 * tracking signals, and (b) refresh-tracking cannot resolve the user's
 * recent activity to better than half-a-day.
 *
 * Buckets:
 *   < 24 h          → "earlier today"
 *   exactly 1 day   → "yesterday"
 *   2 – 6 days      → "{N} days ago"
 *   7 – 13 days     → "last week"
 *   ≥ 14 days       → not surfaced (HISTORY_EXPIRY_MS prunes it before this)
 */
function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffHours < 24) {
    return 'earlier today';
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return 'last week';
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
    const labels: Record<string, string> = {
      long_term: 'something long-term',
      short_term: 'something casual',
      fwb: 'keeping it casual',
      figuring_out: 'figuring things out',
      new_friends: 'new friends',
    };
    return `You're both looking for ${labels[value] ?? value}`;
  }

  if (type === 'prompt') {
    return `You both mentioned ${value}`;
  }

  // PRODUCT FIX: 'nearby' is the neutral tag written when two users crossed
  // paths in the real world without any detected shared interest/intent.
  // Previously crossings were silently rejected in this case; now we keep
  // the crossing and show a honest, simple context line.
  if (reasonTag === 'nearby' || type === 'nearby') {
    return 'You were near each other';
  }

  return 'You have something in common';
}
