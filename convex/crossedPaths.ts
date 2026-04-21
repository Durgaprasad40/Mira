import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { Doc, Id } from './_generated/dataModel';
import { resolveUserIdByAuthId } from './helpers';
import { loadDiscoveryExclusions } from './discoveryExclusions';

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

// Nearby map: 0 – 1 km radius. Persistent eligibility model — once a user
// has published a coarse location, they stay visible to eligible viewers
// within this radius until their next coarse republish moves them out, or
// an explicit exclusion fires (pause/incognito/disabled/skip/block).
// No 100 m minimum floor: co-located users (0 m / 10 m / 50 m…) are eligible.
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

// Crossed paths history
const HISTORY_EXPIRY_MS = 28 * 24 * 60 * 60 * 1000; // 4 weeks (28 days)
const MAX_HISTORY_ENTRIES = 15; // Max crossed paths list entries

// Grid size for approximate crossing location (privacy: round to ~300m)
const LOCATION_GRID_METERS = 300;

// ---------------------------------------------------------------------------
// Phase-2 Nearby constants
// ---------------------------------------------------------------------------

// Ghost cutoff — users whose last coarse publish is older than this are
// hidden from the Nearby map. This is NOT a short TTL / live-freshness
// rule (we keep the persistent eligibility model). It only evicts users
// who opened the app a long time ago and never came back, so the map does
// not fill up with abandoned accounts.
const GHOST_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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

// Notification rate limiting
const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour minimum between notifications per pair
const MAX_NOTIFICATIONS_PER_DAY = 3; // Maximum notifications per day per user

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
// "Someone crossed you" alert constants
// ---------------------------------------------------------------------------

const CROSS_COOLDOWN_MS = 60 * 60 * 1000;   // 1 hour between alerts (for faster feedback)
const CROSS_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h per person (prevents same-person spam)
const CROSS_EVENT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (cleanup)

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

    // Check if published location is still within the 6-hour window
    if (user.publishedAt && now - user.publishedAt < PUBLISH_WINDOW_MS) {
      return {
        success: true,
        published: false,
        reason: 'within_window',
        nextPublishAt: user.publishedAt + PUBLISH_WINDOW_MS,
      };
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
// ---------------------------------------------------------------------------

export const detectCrossedUsers = mutation({
  args: {
    userId: v.id('users'),
    myLat: v.number(),
    myLng: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, myLat, myLng } = args;
    const now = Date.now();

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
    // P1 EXCLUSION: Load the full negative-relationship exclusion set
    // (blocks bidirectional, unmatched bidirectional, reports one-way).
    const {
      blockedUserIds: blockedIds,
      unmatchedUserIds,
      viewerReportedIds,
    } = await loadDiscoveryExclusions(ctx, userId);

    const candidates: Id<'users'>[] = [];

    for (const user of verifiedUsers) {
      // Skip self
      if (user._id === userId) continue;
      // Skip inactive
      if (!user.isActive) continue;
      // Skip blocked (using pre-fetched set)
      if (blockedIds.has(user._id as string)) continue;
      // P1 EXCLUSION: skip any pair that has ever unmatched (bidirectional)
      if (unmatchedUserIds.has(user._id as string)) continue;
      // P1 EXCLUSION: skip users the viewer has reported (one-way)
      if (viewerReportedIds.has(user._id as string)) continue;
      // Phase-2: the other side must also be opted into crossed-paths
      // recording. undefined treated as opted-in.
      if (user.recordCrossedPaths === false) continue;
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
    // Batch fetch existing events for all candidates to avoid N+1
    const validCandidates: Id<'users'>[] = [];

    // Pre-fetch existing events for candidates
    const eventPromises = candidates.map((otherUserId) =>
      ctx.db
        .query('crossedEvents')
        .withIndex('by_user_other', (q) =>
          q.eq('userId', userId).eq('otherUserId', otherUserId),
        )
        .first()
    );
    const existingEvents = await Promise.all(eventPromises);

    for (let i = 0; i < candidates.length; i++) {
      const existingEvent = existingEvents[i];
      // If no existing event, or existing event is older than dedupe window, allow
      if (!existingEvent || now - existingEvent.createdAt >= CROSS_DEDUPE_WINDOW_MS) {
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
    // Phase-2: Crossed-paths is now a separate opt-in from "Show on Nearby map".
    // If the caller has explicitly turned off "Record crossed paths" we must
    // not insert any crossedPaths / crossPathHistory / crossedEvents rows for
    // them. Map visibility (publishLocation / getNearbyUsers) is unaffected.
    // Treat undefined as true for backward compatibility with existing users.
    if (currentUser.recordCrossedPaths === false) {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'crossed_paths_opt_out' };
    }

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

      // Incognito mode: Skip users who are hidden (but they can still BE detected for crossings)
      // Note: Incognito users can still trigger crossings, they just don't appear on map
      // This is intentional per spec: "Incognito: hidden from map, but crossed-path detection may still happen"

      // Nearby visibility opt-out: Skip users who opted out of nearby
      if (user.nearbyEnabled === false) { preFilterRejects.push({ candidate: user._id as string, reason: 'nearby_disabled' }); continue; }

      // Phase-2: skip users who opted out of crossed-paths recording.
      // Both sides must have recordCrossedPaths !== false for a crossing to
      // be persisted. undefined is treated as opted-in (default true) so
      // existing accounts are unaffected.
      if (user.recordCrossedPaths === false) { preFilterRejects.push({ candidate: user._id as string, reason: 'other_opted_out' }); continue; }

      // Basic info completeness
      if (!user.name || !user.bio || !user.dateOfBirth) { preFilterRejects.push({ candidate: user._id as string, reason: 'profile_incomplete' }); continue; }

      // Location freshness check
      const userLocationUpdatedAt = user.lastLocationUpdatedAt ?? user.lastActive;
      if (now - userLocationUpdatedAt > FADED_WINDOW_MS) { preFilterRejects.push({ candidate: user._id as string, reason: 'location_stale' }); continue; }

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
        // 1-hour cooldown per pair (faster notification for better UX)
        if (now - crossedPath.lastCrossedAt < NOTIFICATION_COOLDOWN_MS) {
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

        const newCount = crossedPath.count + 1;
        const updates: Record<string, unknown> = {
          count: newCount,
          lastCrossedAt: now,
          // Store latest crossing location
          crossingLatitude: latitude,
          crossingLongitude: longitude,
        };

        await ctx.db.patch(crossedPath._id, updates);
      } else {
        // BUGFIX #28: Insert new record, then check for race condition duplicate
        const newId = await ctx.db.insert('crossedPaths', {
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
        }
      }

      // --- Cross-path history entry (MUTUAL — both users see this) ---
      // BUGFIX #28: Check 24h duplicate control for same pair
      const existingHistory = await ctx.db
        .query('crossPathHistory')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .order('desc')
        .first();

      if (existingHistory && now - existingHistory.createdAt < NOTIFICATION_COOLDOWN_MS) {
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
        reasonTags,
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
      const canNotify = currentCrossedPath && (
        !currentCrossedPath.lastNotifiedAt ||
        now - currentCrossedPath.lastNotifiedAt >= NOTIFICATION_COOLDOWN_MS
      );

      if (canNotify && currentCrossedPath) {
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

        // Generate dynamic notification text based on crossing count
        const crossingCount = currentCrossedPath.count;
        const reasonText = formatReasonForNotification(reasonTags[0] ?? 'common');

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

export const recordLocationBatch = mutation({
  args: {
    userId: v.union(v.id('users'), v.string()),
    samples: v.array(
      v.object({
        lat: v.number(),
        lng: v.number(),
        capturedAt: v.number(),
        accuracy: v.optional(v.number()),
        source: v.union(v.literal('bg'), v.literal('fg'), v.literal('slc')),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.userId as string);
    if (!resolvedUserId) {
      return { success: false, accepted: 0, reason: 'user_not_found' };
    }
    const userId = resolvedUserId;
    const now = Date.now();

    if (BG_LOCATION_AUDIT_ENABLED) {
      console.log('[BG_LOCATION][sample_received]', {
        userId,
        sampleCount: args.samples.length,
        sources: args.samples.map((s) => s.source),
      });
    }

    if (args.samples.length === 0) {
      return { success: true, accepted: 0, reason: 'empty_batch' };
    }
    if (args.samples.length > MAX_SAMPLES_PER_BATCH) {
      return { success: false, accepted: 0, reason: 'batch_too_large' };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false, accepted: 0, reason: 'user_not_found' };
    }

    // Platform-specific opt-in gates. Background writes are strictly opt-in
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
    const sources = new Set(args.samples.map((s) => s.source));
    const hasSlc = sources.has('slc');
    const hasBg = sources.has('bg');
    const bgLocationOn = user.backgroundLocationEnabled === true;
    const discoveryOn =
      user.discoveryModeEnabled === true &&
      typeof user.discoveryModeExpiresAt === 'number' &&
      user.discoveryModeExpiresAt > now;

    if (hasSlc && !bgLocationOn) {
      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][dropped]', {
          userId,
          reason: 'background_not_enabled',
          sampleCount: args.samples.length,
        });
      }
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
      return { success: false, accepted: 0, reason: 'no_opt_in' };
    }

    // Mirror the opt-out gates from recordLocation so background samples
    // respect the same Nearby / crossed-paths toggles.
    if (user.nearbyEnabled === false) {
      return { success: true, accepted: 0, reason: 'disabled_or_paused' };
    }
    if (user.nearbyPausedUntil && user.nearbyPausedUntil > now) {
      return { success: true, accepted: 0, reason: 'disabled_or_paused' };
    }
    if (user.recordCrossedPaths === false) {
      return { success: true, accepted: 0, reason: 'crossed_paths_opt_out' };
    }

    const currentStatus = user.verificationStatus || 'unverified';
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentStatus !== 'verified' && !isDevBypass) {
      return { success: true, accepted: 0, reason: 'unverified' };
    }

    // Sort incoming samples by capturedAt ascending so downstream dedupe +
    // "latest sample wins" semantics are deterministic.
    const sortedSamples = [...args.samples].sort((a, b) => a.capturedAt - b.capturedAt);

    // Pre-fetch this user's most recent sample for dedupe.
    const mostRecentExisting = await ctx.db
      .query('locationSamples')
      .withIndex('by_user_capturedAt', (q) => q.eq('userId', userId))
      .order('desc')
      .first();
    let lastAcceptedAt = mostRecentExisting ? mostRecentExisting.capturedAt : 0;

    let accepted = 0;
    let droppedStale = 0;
    let droppedFuture = 0;
    let droppedDedupe = 0;
    let droppedInvalid = 0;
    let latestAcceptedSample: { lat: number; lng: number; capturedAt: number; accuracy?: number } | null = null;

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
      // Dedupe against last accepted sample for this user.
      if (raw.capturedAt - lastAcceptedAt < SAMPLE_DEDUPE_MIN_GAP_MS) {
        droppedDedupe++;
        continue;
      }

      const snapped = roundToGrid(raw.lat, raw.lng);
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

      if (BG_LOCATION_AUDIT_ENABLED) {
        console.log('[BG_LOCATION][sample_written]', {
          userId,
          source: raw.source,
          capturedAt: raw.capturedAt,
        });
      }
    }

    // Only continue to user-doc update + detection if at least one sample
    // was accepted. Otherwise the batch is effectively a no-op.
    if (!latestAcceptedSample) {
      return {
        success: true,
        accepted: 0,
        droppedStale,
        droppedFuture,
        droppedDedupe,
        droppedInvalid,
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

    return {
      success: true,
      accepted,
      droppedStale,
      droppedFuture,
      droppedDedupe,
      droppedInvalid,
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
    if (!peerUser.name || !peerUser.bio || !peerUser.dateOfBirth) continue;

    // Verification parity with recordLocation (DEV bypass respected).
    const peerStatus = peerUser.verificationStatus || 'unverified';
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (peerStatus !== 'verified' && !isDevBypass) continue;

    // Age / gender filters (bi-directional).
    const peerAge = calculateAge(peerUser.dateOfBirth);
    if (myAge < peerUser.minAge || myAge > peerUser.maxAge) continue;
    if (peerAge < viewer.minAge || peerAge > viewer.maxAge) continue;
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
      if (now - crossedPath.lastCrossedAt < NOTIFICATION_COOLDOWN_MS) {
        continue; // pair cooldown
      }
      await ctx.db.patch(crossedPath._id, {
        count: crossedPath.count + 1,
        lastCrossedAt: now,
        crossingLatitude: lat,
        crossingLongitude: lng,
      });
    } else {
      await ctx.db.insert('crossedPaths', {
        user1Id,
        user2Id,
        count: 1,
        lastCrossedAt: now,
      });
    }

    // History cooldown (same pattern as recordLocation).
    const existingHistory = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
      .order('desc')
      .first();
    if (existingHistory && now - existingHistory.createdAt < NOTIFICATION_COOLDOWN_MS) {
      continue;
    }

    const areaName = peerUser.city ? `Near ${peerUser.city}` : 'Nearby area';
    const approxLocation = roundToGrid(lat, lng);
    await ctx.db.insert('crossPathHistory', {
      user1Id,
      user2Id,
      areaName,
      crossedLatApprox: approxLocation.lat,
      crossedLngApprox: approxLocation.lng,
      reasonTags,
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
      now - currentCrossedPath.lastNotifiedAt >= NOTIFICATION_COOLDOWN_MS;
    if (!canNotify) continue;

    await ctx.db.patch(currentCrossedPath._id, { lastNotifiedAt: now });

    const reasonText = formatReasonForNotification(reasonTags[0] ?? 'common');
    const crossingCount = currentCrossedPath.count;
    let title: string;
    let body: string;
    if (crossingCount === 1) {
      title = 'Someone crossed your path';
      body = `${reasonText}`;
    } else if (crossingCount < 5) {
      title = 'Someone interesting crossed your path';
      body = `You've crossed paths ${crossingCount} times. ${reasonText}`;
    } else {
      title = 'You keep crossing paths with someone';
      body = `${crossingCount} times now! ${reasonText}. Maybe say hi?`;
    }
    const pairDedupeKey = makeCrossedPathsDedupeKey(user1Id, user2Id, now);

    for (const [recipient, other] of [
      [user1Id, user2Id],
      [user2Id, user1Id],
    ] as const) {
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
        (!existing || now - existing.createdAt >= NOTIFICATION_COOLDOWN_MS);
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
// getNearbyUsers — map markers with cellId + per-request randomized coord
// STABILITY FIX S1: Uses indexed query instead of full table scan
// STABILITY FIX S6: Pre-fetches blocks before loop (eliminates N+1)
//
// Phase-2.5 data-minimization contract:
//   - Response NEVER includes raw publishedLat/publishedLng/publishedAt or
//     numeric distance. Those are server-only signals used for filtering.
//   - Response includes cellId (coarse grid cell), displayLat/displayLng
//     (per-request random point inside that cell), distanceBucket
//     ('very_close' | 'nearby' | 'in_your_area'), and freshnessLabel
//     ('recent' | 'earlier' | 'stale').
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

    // Current user must be verified to see nearby users.
    // DEV-ONLY bypass (matches publishLocation / detectCrossedUsers). Engages
    // only when the Convex deployment env explicitly sets
    // EXPO_PUBLIC_DEMO_AUTH_MODE to "true". Production behavior is unchanged
    // because this env is NOT auto-propagated from .env.local to the Convex
    // deployment.
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';
    if (currentUser.verificationStatus !== 'verified' && !isDevBypass) return [];

    // Use current user's published location for distance checks
    // (they should have published when opening Nearby screen)
    const myLat = currentUser.publishedLat ?? currentUser.latitude;
    const myLng = currentUser.publishedLng ?? currentUser.longitude;
    if (!myLat || !myLng) return [];

    // Get current user's age for filtering
    const myAge = calculateAge(currentUser.dateOfBirth);

    // STABILITY FIX S1: Use indexed query for verified users only (production).
    // In DEV bypass: widen to all users so unverified demo peers render on map.
    // All downstream filters (isActive, incognito, nearbyEnabled, pause,
    // visibility mode, distance, age, blocks, swipes, freshness) still apply.
    const verifiedUsers = isDevBypass
      ? await ctx.db.query('users').collect()
      : await ctx.db
          .query('users')
          .withIndex('by_verification_status', (q) => q.eq('verificationStatus', 'verified'))
          .collect();

    // STABILITY FIX S6/C2: Pre-fetch blocks and swipes before loop
    // P1 EXCLUSION: Load full negative-relationship exclusion set in parallel
    // with swipes. Keep `blockedIds` as an alias so downstream uses are unchanged.
    const [exclusions, swipedUsersMap] = await Promise.all([
      loadDiscoveryExclusions(ctx, userId),
      prefetchSwipes(ctx, userId),
    ]);
    const blockedIds = exclusions.blockedUserIds;
    const unmatchedUserIds = exclusions.unmatchedUserIds;
    const viewerReportedIds = exclusions.viewerReportedIds;

    // First pass: collect candidate user IDs that pass basic filters
    const candidateUserIds: string[] = [];
    const candidateUsers: typeof verifiedUsers = [];

    for (const user of verifiedUsers) {
      if (user._id === userId) continue;
      if (!user.isActive) continue;

      // Incognito mode: Hidden users don't appear on map
      if (user.incognitoMode === true) continue;

      // Nearby visibility opt-out: Respect user preference
      if (user.nearbyEnabled === false) continue;

      // Nearby pause: User has temporarily hidden from Nearby
      if (user.nearbyPausedUntil && user.nearbyPausedUntil > now) continue;

      // Persistent eligibility model: Nearby visibility is NOT coupled to
      // lastActive / nearbyVisibilityMode freshness. A user remains visible
      // until explicit exclusions fire (pause/incognito/disabled/skip/block)
      // or a later coarse republish moves them out of range.

      // Basic info completeness
      if (!user.name || !user.bio || !user.dateOfBirth) continue;

      // P0 FIX: Require valid primary photo URL
      if (!user.primaryPhotoUrl) continue;

      // Must have published location (persistent: no freshness TTL — the last
      // coarse published position stays eligible until the next republish).
      if (!user.publishedLat || !user.publishedLng || !user.publishedAt) continue;

      // Phase-2 ghost cutoff: evict users whose last coarse publish is older
      // than GHOST_CUTOFF_MS (14 days). This is NOT a short TTL — active
      // users are unaffected. It only prunes abandoned accounts so the map
      // does not fill up with stale pins that will never move again.
      if (now - user.publishedAt > GHOST_CUTOFF_MS) continue;

      // Distance check — 0 to 1 km range (no minimum floor; co-located users eligible)
      const distance = calculateDistanceMeters(
        myLat,
        myLng,
        user.publishedLat,
        user.publishedLng,
      );
      if (distance < NEARBY_MIN_METERS || distance > NEARBY_MAX_METERS) continue;

      // Age filtering (both directions)
      const otherAge = calculateAge(user.dateOfBirth);
      if (myAge < user.minAge || myAge > user.maxAge) continue;
      if (otherAge < currentUser.minAge || otherAge > currentUser.maxAge) continue;

      // Gender/orientation preference match (both directions)
      if (!currentUser.lookingFor.includes(user.gender)) continue;
      if (!user.lookingFor.includes(currentUser.gender)) continue;

      // Block check (using pre-fetched set)
      if (blockedIds.has(user._id as string)) continue;
      // P1 EXCLUSION: hide unmatched pairs (bidirectional) and reported users
      // (one-way) from the Nearby map.
      if (unmatchedUserIds.has(user._id as string)) continue;
      if (viewerReportedIds.has(user._id as string)) continue;

      // Skip filter (using pre-fetched map)
      const existingSwipe = swipedUsersMap.get(user._id as string);
      if (existingSwipe) {
        if (existingSwipe.action !== 'pass') continue;
        if (existingSwipe.createdAt > now - 7 * 24 * 60 * 60 * 1000) continue;
      }

      candidateUserIds.push(user._id as string);
      candidateUsers.push(user);
    }

    // STABILITY FIX: Fetch photo counts only for candidates (not all users)
    const photoCountsMap = await prefetchPhotoCounts(ctx, candidateUserIds);

    // Second pass: filter by photo count and build results.
    // Phase-2.5 hardening + Phase-3 ranking & preview fields:
    //   - NO raw / stored coordinates leave the server (cellId + per-request
    //     randomized displayLatLng inside the cell only).
    //   - NO numeric distance (distanceBucket only).
    //   - freshnessLabel is three-tier: 'recent' | 'earlier' | 'stale'.
    //   - Phase-3: each result carries a lightweight `tagline` and up to
    //     three `sharedInterests` so the client can render a preview card
    //     without a second round-trip. No sensitive data leaves the server.
    //   - Phase-3: results are sorted by a simple score (freshness,
    //     completeness, compatibility, activity) with a small random
    //     tiebreak so the map does not look statically ordered.
    const viewerActivities = new Set(currentUser.activities ?? []);
    const viewerIntent = new Set(currentUser.relationshipIntent ?? []);

    const freshnessScore: Record<string, number> = { recent: 30, earlier: 10, stale: 0 };

    const results = [];
    const rankById = new Map<string, number>();

    for (let i = 0; i < candidateUsers.length; i++) {
      const user = candidateUsers[i];
      const photoCount = photoCountsMap.get(user._id as string) || 0;
      if (photoCount < 2) continue;

      const locationAge = now - user.publishedAt!;
      const freshness: 'solid' | 'faded' = locationAge <= SOLID_WINDOW_MS ? 'solid' : 'faded';
      const freshnessLabel: 'recent' | 'earlier' | 'stale' =
        locationAge <= NEARBY_RECENT_WINDOW_MS
          ? 'recent'
          : locationAge <= NEARBY_EARLIER_WINDOW_MS
          ? 'earlier'
          : 'stale';

      // Server-side distance (never returned).
      const realDistance = calculateDistanceMeters(
        myLat,
        myLng,
        user.publishedLat!,
        user.publishedLng!,
      );

      // Strong Privacy Mode: shift the cell, then re-snap.
      let cellLat = user.publishedLat!;
      let cellLng = user.publishedLng!;
      if (user.strongPrivacyMode === true) {
        const seed = simpleHash(String(user._id));
        const bearingRad = (seed % 360) * (Math.PI / 180);
        const distanceMeters = 200 + (seed % 201);
        const fuzzed = offsetCoords(cellLat, cellLng, distanceMeters, bearingRad);
        const resnapped = roundToGrid(fuzzed.lat, fuzzed.lng);
        cellLat = resnapped.lat;
        cellLng = resnapped.lng;
      }

      const display = makeDisplayLatLng(cellLat, cellLng);
      const cellId = makeCellId(cellLat, cellLng);

      const bucketingDistance = user.strongPrivacyMode === true
        ? calculateDistanceMeters(myLat, myLng, cellLat, cellLng)
        : realDistance;
      const bucket = bucketNearbyDistance(bucketingDistance);

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

      // Profile completeness (0..3): bio >=20 chars, >=3 photos, >=1 prompt.
      const completeness =
        ((user.bio && user.bio.length >= 20) ? 1 : 0) +
        (photoCount >= 3 ? 1 : 0) +
        (((user.profilePrompts ?? []).length >= 1) ? 1 : 0);

      // Activity signal: prefer recent `lastActive`, capped and coarse.
      const lastActive = typeof user.lastActive === 'number' ? user.lastActive : 0;
      const activityAge = lastActive > 0 ? now - lastActive : Infinity;
      const activityScore =
        activityAge <= 24 * 60 * 60 * 1000 ? 10 :
        activityAge <= 7 * 24 * 60 * 60 * 1000 ? 5 : 0;

      // Final score. Weights are intentionally small & simple — freshness
      // dominates, followed by compatibility, then completeness, then
      // activity. A small random epsilon keeps same-score users shuffled.
      const score =
        (freshnessScore[freshnessLabel] ?? 0)
        + shared.length * 7
        + completeness * 5
        + activityScore
        + (user.isVerified ? 5 : 0)
        + Math.random() * 4; // 0..4 jitter

      rankById.set(user._id as string, score);

      results.push({
        id: user._id,
        name: user.name,
        age: calculateAge(user.dateOfBirth),
        cellId,
        displayLat: display.lat,
        displayLng: display.lng,
        distanceBucket: user.hideDistance === true ? undefined : bucket.label,
        freshness,
        freshnessLabel,
        photoUrl: user.primaryPhotoUrl ?? null,
        isVerified: user.isVerified,
        strongPrivacyMode: user.strongPrivacyMode ?? false,
        hideDistance: user.hideDistance ?? false,
        // Phase-3 preview payload.
        tagline,
        sharedInterests: shared.length > 0 ? shared : undefined,
      });
    }

    // Phase-3 sort: verified first, then by descending score, then random.
    // Score already includes freshness weight and a small random epsilon.
    results.sort((a, b) => {
      if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
      const sa = rankById.get(a.id as string) ?? 0;
      const sb = rankById.get(b.id as string) ?? 0;
      return sb - sa;
    });

    return results;
  },
});

// ---------------------------------------------------------------------------
// getCrossPathHistory — crossed paths history list (30-day retention)
// Returns crossed paths with approximate location and reason tags.
// Filters out hidden entries for the requesting user.
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

    const all = [...asUser1, ...asUser2]
      .filter((entry) => {
        // Filter expired entries (4 weeks)
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
      })
      .sort((a, b) => b.createdAt - a.createdAt) // newest first
      .slice(0, MAX_HISTORY_ENTRIES);

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

    // Parallel fetch all primary photos
    const photosMap = new Map<string, string | null>();
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
      photosMap.set(id as string, photoFetches[i]?.url ?? null);
    });

    // Build results using pre-fetched data
    const results = [];
    for (const entry of all) {
      const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
      const otherUser = usersMap.get(otherUserId as string);
      if (!otherUser || !otherUser.isActive) continue;

      // P0 FIX: Privacy filtering - hide users who disabled/paused Nearby
      if (otherUser.nearbyEnabled === false) continue;
      if (otherUser.nearbyPausedUntil && otherUser.nearbyPausedUntil > now) continue;

      // P0 FIX: Require valid primary photo URL
      if (!otherUser.primaryPhotoUrl) continue;

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
        photoUrl: photosMap.get(otherUserId as string),
        initial: otherUser.name.charAt(0),
        isVerified: otherUser.isVerified,
      });
    }

    // Sort: crossing count (higher first), then recency
    results.sort((a, b) => {
      if (b.crossingCount !== a.crossingCount) return b.crossingCount - a.crossingCount;
      return b.createdAt - a.createdAt;
    });

    // [CROSSED_PATHS_AUDIT] ui — what the client-side list receives.
    console.log('[CROSSED_PATHS_AUDIT][ui]', {
      viewer: userId,
      entriesReturned: results.length,
      hasReasonOverlap: results.filter((r) => (r.reasonTags?.[0] ?? '') !== 'nearby').length,
      nearbyOnly: results.filter((r) => (r.reasonTags?.[0] ?? '') === 'nearby').length,
    });

    return results;
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

// P2 SECURITY: Uses authUserId + server-side resolution to prevent spoofing.
export const deleteCrossedPath = mutation({
  args: {
    authUserId: v.string(), // P2 SECURITY: Server-side auth instead of trusting client
    historyId: v.id('crossPathHistory'),
  },
  handler: async (ctx, args) => {
    const { authUserId, historyId } = args;

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
      if (otherUser.hideDistance === true) {
        distanceRange = null;
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
          name: otherUser.name,
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

    const allCrossedPaths = [...asUser1, ...asUser2];
    const count = allCrossedPaths.length;

    // Find the latest createdAt timestamp
    let latestCreatedAt: number | null = null;
    for (const path of allCrossedPaths) {
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
  // 1 degree latitude ≈ 111km, so 500m ≈ 0.0045 degrees
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

/**
 * Phase-2.5 privacy helper: per-request randomized display point inside the
 * originating grid cell. Math.random() is evaluated fresh for every result,
 * so two viewers (or the same viewer across two requests) never see the same
 * displayed coord for the same user. This removes the multi-observer /
 * logging inference vector: clients only ever see random points inside the
 * ~300m cell — not the stored grid coordinate, and never a GPS-precision
 * value.
 */
function makeDisplayLatLng(
  gridLat: number,
  gridLng: number,
): { lat: number; lng: number } {
  const bearingRad = Math.random() * 2 * Math.PI;
  const distanceMeters = Math.random() * CELL_JITTER_RADIUS_M;
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
