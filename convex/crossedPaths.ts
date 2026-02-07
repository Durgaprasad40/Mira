import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROXIMITY_METERS = 1000; // 1km fixed radius
const MIN_CROSSINGS_FOR_UNLOCK = 10;
const UNLOCK_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours
const LOCATION_UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Published location window (privacy: only update shared location once per 6 hours)
const PUBLISH_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// Marker visibility tiers (for map)
const SOLID_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 1–3 days → solid marker
const FADED_WINDOW_MS = 6 * 24 * 60 * 60 * 1000; // 3–6 days → faded marker
// >6 days → hidden

const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h per pair
const HISTORY_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_HISTORY_ENTRIES = 15;

// ---------------------------------------------------------------------------
// "Someone crossed you" alert constants
// ---------------------------------------------------------------------------

const CROSS_RADIUS_METERS = 1000;           // 1km
const CROSS_COOLDOWN_MS = 6 * 60 * 60 * 1000;   // 6 hours between alerts
const CROSS_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h per person (prevents same-person spam)
const CROSS_EVENT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (cleanup)

// ---------------------------------------------------------------------------
// publishLocation — updates published location (max once per 6 hours)
// Called when Nearby screen is opened. Others see publishedLat/Lng, not live GPS.
// ---------------------------------------------------------------------------

export const publishLocation = mutation({
  args: {
    userId: v.id('users'),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, latitude, longitude } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) return { success: false, reason: 'user_not_found' };

    // Check if published location is still within the 6-hour window
    if (user.publishedAt && now - user.publishedAt < PUBLISH_WINDOW_MS) {
      return {
        success: true,
        published: false,
        reason: 'within_window',
        nextPublishAt: user.publishedAt + PUBLISH_WINDOW_MS,
      };
    }

    // Publish new location
    await ctx.db.patch(userId, {
      publishedLat: latitude,
      publishedLng: longitude,
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

    // 2) Enforce cooldown — check most recent crossedEvent for this user
    const lastEvent = await ctx.db
      .query('crossedEvents')
      .withIndex('by_user_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .first();

    if (lastEvent && now - lastEvent.createdAt < CROSS_COOLDOWN_MS) {
      return { triggered: false, reason: 'cooldown' };
    }

    // 3) Find nearby users using PUBLISHED coords only
    const allUsers = await ctx.db.query('users').collect();

    // Get blocks for current user (both directions)
    const blocksOut = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
      .collect();
    const blocksIn = await ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
      .collect();
    const blockedIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    const candidates: Id<'users'>[] = [];

    for (const user of allUsers) {
      // Skip self
      if (user._id === userId) continue;
      // Skip inactive
      if (!user.isActive) continue;
      // Skip blocked
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

      // Within 1km?
      if (distance <= CROSS_RADIUS_METERS) {
        candidates.push(user._id);
      }
    }

    // 4) Dedupe — filter out people we've already alerted about recently
    const validCandidates: Id<'users'>[] = [];

    for (const otherUserId of candidates) {
      const existingEvent = await ctx.db
        .query('crossedEvents')
        .withIndex('by_user_other', (q) =>
          q.eq('userId', userId).eq('otherUserId', otherUserId),
        )
        .first();

      // If no existing event, or existing event is older than dedupe window, allow
      if (!existingEvent || now - existingEvent.createdAt >= CROSS_DEDUPE_WINDOW_MS) {
        validCandidates.push(otherUserId);
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

export const cleanupExpiredCrossedEvents = mutation({
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
// ---------------------------------------------------------------------------

export const recordLocation = mutation({
  args: {
    userId: v.id('users'),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, latitude, longitude } = args;
    const now = Date.now();

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return { success: false };

    // 30-minute gate: skip update if too recent
    if (
      currentUser.lastLocationUpdatedAt &&
      now - currentUser.lastLocationUpdatedAt < LOCATION_UPDATE_INTERVAL_MS
    ) {
      return { success: true, nearbyCount: 0, skipped: true };
    }

    // Save location + timestamp
    await ctx.db.patch(userId, {
      latitude,
      longitude,
      lastActive: now,
      lastLocationUpdatedAt: now,
    });

    // 9-6: Skip crossed-path computation if current user is not verified
    const currentStatus = currentUser.verificationStatus || 'unverified';
    if (currentStatus !== 'verified') {
      return { success: true, nearbyCount: 0, skipped: true, reason: 'unverified' };
    }

    // Find nearby users (within 1km, location updated within 6 days)
    const allUsers = await ctx.db.query('users').collect();
    const nearbyUsers = [];

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive) continue;
      if (!user.latitude || !user.longitude) continue;

      // 9-6: Skip unverified users in crossed paths
      const userStatus = user.verificationStatus || 'unverified';
      if (userStatus !== 'verified') continue;

      const userLocationUpdatedAt = user.lastLocationUpdatedAt ?? user.lastActive;
      if (now - userLocationUpdatedAt > FADED_WINDOW_MS) continue;

      const distance = calculateDistanceMeters(
        latitude,
        longitude,
        user.latitude,
        user.longitude,
      );

      if (distance <= PROXIMITY_METERS) {
        nearbyUsers.push(user);
      }
    }

    // Record crossed paths + history
    for (const nearbyUser of nearbyUsers) {
      // Check preferences match
      if (!currentUser.lookingFor.includes(nearbyUser.gender)) continue;
      if (!nearbyUser.lookingFor.includes(currentUser.gender)) continue;

      // Check if blocked (either direction)
      const blocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', userId).eq('blockedUserId', nearbyUser._id),
        )
        .first();
      if (blocked) continue;

      const reverseBlocked = await ctx.db
        .query('blocks')
        .withIndex('by_blocker_blocked', (q) =>
          q.eq('blockerId', nearbyUser._id).eq('blockedUserId', userId),
        )
        .first();
      if (reverseBlocked) continue;

      // Order user IDs for consistent lookup
      const user1Id = userId < nearbyUser._id ? userId : nearbyUser._id;
      const user2Id = userId < nearbyUser._id ? nearbyUser._id : userId;

      // --- Crossed paths record (for unlock logic) ---
      let crossedPath = await ctx.db
        .query('crossedPaths')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .first();

      if (crossedPath) {
        // 24-hour cooldown per pair
        if (now - crossedPath.lastCrossedAt < NOTIFICATION_COOLDOWN_MS) continue;

        const newCount = crossedPath.count + 1;
        const updates: Record<string, unknown> = {
          count: newCount,
          lastCrossedAt: now,
        };

        // Unlock threshold
        if (newCount >= MIN_CROSSINGS_FOR_UNLOCK && !crossedPath.unlockExpiresAt) {
          updates.unlockExpiresAt = now + UNLOCK_DURATION_MS;

          await ctx.db.insert('notifications', {
            userId: user1Id,
            type: 'crossed_paths' as const,
            title: 'Crossed Paths Milestone!',
            body: `You've crossed paths ${newCount} times! Enjoy 48 hours of free messaging.`,
            data: { userId: user2Id as string },
            createdAt: now,
          });

          await ctx.db.insert('notifications', {
            userId: user2Id,
            type: 'crossed_paths' as const,
            title: 'Crossed Paths Milestone!',
            body: `You've crossed paths ${newCount} times! Enjoy 48 hours of free messaging.`,
            data: { userId: user1Id as string },
            createdAt: now,
          });
        }

        await ctx.db.patch(crossedPath._id, updates);
      } else {
        await ctx.db.insert('crossedPaths', {
          user1Id,
          user2Id,
          count: 1,
          lastCrossedAt: now,
        });
      }

      // --- Cross-path history entry ---
      // Check 24h duplicate control for same pair
      const existingHistory = await ctx.db
        .query('crossPathHistory')
        .withIndex('by_users', (q) =>
          q.eq('user1Id', user1Id).eq('user2Id', user2Id),
        )
        .order('desc')
        .first();

      if (existingHistory && now - existingHistory.createdAt < NOTIFICATION_COOLDOWN_MS) {
        // Already have a recent history entry for this pair — skip
        continue;
      }

      // Derive area name from city or generic label
      const areaName = nearbyUser.city
        ? `Near ${nearbyUser.city}`
        : 'Nearby area';

      await ctx.db.insert('crossPathHistory', {
        user1Id,
        user2Id,
        areaName,
        createdAt: now,
        expiresAt: now + HISTORY_EXPIRY_MS,
      });

      // Enforce max 15 entries per user — trim oldest
      await trimHistoryForUser(ctx, userId);
    }

    return { success: true, nearbyCount: nearbyUsers.length };
  },
});

// ---------------------------------------------------------------------------
// getNearbyUsers — map markers with jittered coords & freshness
// ---------------------------------------------------------------------------

export const getNearbyUsers = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const now = Date.now();

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return [];

    // Use current user's published location for distance checks
    // (they should have published when opening Nearby screen)
    const myLat = currentUser.publishedLat ?? currentUser.latitude;
    const myLng = currentUser.publishedLng ?? currentUser.longitude;
    if (!myLat || !myLng) return [];

    const allUsers = await ctx.db.query('users').collect();
    const results = [];

    // Get blocks for current user (both directions)
    const blocksOut = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', userId))
      .collect();
    const blocksIn = await ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', userId))
      .collect();
    const blockedIds = new Set([
      ...blocksOut.map((b) => b.blockedUserId as string),
      ...blocksIn.map((b) => b.blockerId as string),
    ]);

    for (const user of allUsers) {
      if (user._id === userId) continue;
      if (!user.isActive) continue;

      // 8A: Filter out unverified/rejected users from Nearby map
      const verificationStatus = user.verificationStatus || 'unverified';
      if (verificationStatus !== 'verified') continue;

      // Use other user's PUBLISHED location (privacy: not their live GPS)
      // If they haven't published, they don't appear on the map
      if (!user.publishedLat || !user.publishedLng || !user.publishedAt) continue;

      // Freshness based on publishedAt (when they last shared their location)
      const age = now - user.publishedAt;

      // Hidden: published location is stale (>6 days old)
      if (age > FADED_WINDOW_MS) continue;

      // Distance check — 1km using published locations
      const distance = calculateDistanceMeters(
        myLat,
        myLng,
        user.publishedLat,
        user.publishedLng,
      );
      if (distance > PROXIMITY_METERS) continue;

      // Preference match
      if (!currentUser.lookingFor.includes(user.gender)) continue;
      if (!user.lookingFor.includes(currentUser.gender)) continue;

      // Block check
      if (blockedIds.has(user._id as string)) continue;

      // Freshness: solid (1-3 days) or faded (3-6 days)
      const freshness: 'solid' | 'faded' = age <= SOLID_WINDOW_MS ? 'solid' : 'faded';

      // Get primary photo
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      // Return raw published coordinates — client applies fuzz + anti-zoom shifting
      // hideDistance controls fuzz radius: true = 200-400m, false = 20-100m
      results.push({
        id: user._id,
        name: user.name,
        age: calculateAge(user.dateOfBirth),
        publishedLat: user.publishedLat!,
        publishedLng: user.publishedLng!,
        freshness,
        photoUrl: photo?.url ?? null,
        isVerified: user.isVerified,
        hideDistance: user.hideDistance ?? false,
      });
    }

    return results;
  },
});

// ---------------------------------------------------------------------------
// getCrossPathHistory — memory-based history list (max 15, 14-day expiry)
// ---------------------------------------------------------------------------

export const getCrossPathHistory = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const now = Date.now();

    const asUser1 = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .collect();

    const asUser2 = await ctx.db
      .query('crossPathHistory')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .collect();

    const all = [...asUser1, ...asUser2]
      .filter((entry) => entry.expiresAt > now) // filter expired
      .sort((a, b) => b.createdAt - a.createdAt) // newest first
      .slice(0, MAX_HISTORY_ENTRIES);

    const results = [];
    for (const entry of all) {
      const otherUserId = entry.user1Id === userId ? entry.user2Id : entry.user1Id;
      const otherUser = await ctx.db.get(otherUserId);
      if (!otherUser || !otherUser.isActive) continue;

      // Get blurred photo (primary photo, will be blurred client-side)
      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', otherUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      results.push({
        id: entry._id,
        otherUserId,
        areaName: entry.areaName,
        createdAt: entry.createdAt,
        photoUrl: photo?.url ?? null,
        initial: otherUser.name.charAt(0),
      });
    }

    return results;
  },
});

// ---------------------------------------------------------------------------
// cleanupExpiredHistory — call periodically to purge old entries
// ---------------------------------------------------------------------------

export const cleanupExpiredHistory = mutation({
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
// getCrossedPaths — existing unlock-based list
// ---------------------------------------------------------------------------

export const getCrossedPaths = query({
  args: {
    userId: v.id('users'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, limit = 50 } = args;
    const now = Date.now();

    const asUser1 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user1', (q) => q.eq('user1Id', userId))
      .take(limit);

    const asUser2 = await ctx.db
      .query('crossedPaths')
      .withIndex('by_user2', (q) => q.eq('user2Id', userId))
      .take(limit);

    const allCrossedPaths = [...asUser1, ...asUser2];

    allCrossedPaths.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastCrossedAt - a.lastCrossedAt;
    });

    const result = [];
    for (const cp of allCrossedPaths.slice(0, limit)) {
      const otherUserId = cp.user1Id === userId ? cp.user2Id : cp.user1Id;
      const otherUser = await ctx.db.get(otherUserId);

      if (!otherUser || !otherUser.isActive) continue;

      const photo = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', otherUserId))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      const isUnlocked = cp.unlockExpiresAt && cp.unlockExpiresAt > now;
      const unlockTimeRemaining = isUnlocked ? cp.unlockExpiresAt! - now : 0;

      result.push({
        id: cp._id,
        count: cp.count,
        lastCrossedAt: cp.lastCrossedAt,
        isUnlocked,
        unlockExpiresAt: cp.unlockExpiresAt,
        unlockTimeRemaining,
        progressToUnlock: Math.min(cp.count / MIN_CROSSINGS_FOR_UNLOCK, 1),
        user: {
          id: otherUserId,
          name: otherUser.name,
          age: calculateAge(otherUser.dateOfBirth),
          photoUrl: photo?.url,
          isVerified: otherUser.isVerified,
        },
      });
    }

    return result;
  },
});

// ---------------------------------------------------------------------------
// checkCrossedPathsUnlock
// ---------------------------------------------------------------------------

export const checkCrossedPathsUnlock = query({
  args: {
    user1Id: v.id('users'),
    user2Id: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { user1Id, user2Id } = args;
    const now = Date.now();

    const orderedUser1 = user1Id < user2Id ? user1Id : user2Id;
    const orderedUser2 = user1Id < user2Id ? user2Id : user1Id;

    const crossedPath = await ctx.db
      .query('crossedPaths')
      .withIndex('by_users', (q) =>
        q.eq('user1Id', orderedUser1).eq('user2Id', orderedUser2),
      )
      .first();

    if (!crossedPath) return { isUnlocked: false, count: 0 };

    const isUnlocked = crossedPath.unlockExpiresAt && crossedPath.unlockExpiresAt > now;

    return {
      isUnlocked,
      count: crossedPath.count,
      unlockExpiresAt: crossedPath.unlockExpiresAt,
      unlockTimeRemaining: isUnlocked ? crossedPath.unlockExpiresAt! - now : 0,
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
