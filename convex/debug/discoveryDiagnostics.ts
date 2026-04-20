/**
 * Discovery Diagnostics (READ-ONLY)
 *
 * Temporary per-pair diagnostic query used to investigate why a specific
 * (viewer, candidate) pair is visible on one discovery surface but not
 * another. For a given pair it independently re-runs every hard filter that
 * each production surface enforces, and returns a structured breakdown of
 * PASS / FAIL reasons per surface.
 *
 * This module is ADDITIVE and READ-ONLY:
 *   - it never writes to the DB
 *   - it does not import or mutate existing queries
 *   - it does not change schema, indexes, or public API
 *   - it does not alter any surface's behavior
 *
 * The filter logic here mirrors the production code paths exactly:
 *   - Nearby           → convex/crossedPaths.ts :: getNearbyUsers
 *   - Discover         → convex/discover.ts     :: getDiscoverProfiles
 *   - Explore          → convex/discover.ts     :: buildExploreCandidates
 *                                                + assignExploreCategory
 *   - Deep Connect     → convex/privateDiscover.ts :: getProfiles
 *   - Shared relations → convex/discoveryExclusions.ts :: loadDiscoveryExclusions
 *
 * If any production filter changes, this file must be re-verified against
 * the source before its results can be trusted. It is intended for
 * short-lived debugging only and should be removed once the investigation
 * is complete.
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { loadDiscoveryExclusions } from '../discoveryExclusions';

// ---------------------------------------------------------------------------
// Constants mirrored from production (intentionally duplicated to keep this
// diagnostic file fully self-contained and read-only).
// ---------------------------------------------------------------------------

const NEARBY_MIN_METERS = 0;
const NEARBY_MAX_METERS = 1000;
const GHOST_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000;
const PASS_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const ONLINE_NOW_MS = 10 * 60 * 1000;
const ACTIVE_TODAY_MS = 24 * 60 * 60 * 1000;

// 24-category exclusive Explore priority list (mirrors EXPLORE_ASSIGNMENT_PRIORITY
// in convex/discover.ts). See that file for the canonical definition.
const EXPLORE_ASSIGNMENT_PRIORITY: readonly string[] = [
  // A. Interests
  'coffee_date',
  'sports',
  'nature_lovers',
  'binge_watchers',
  'foodie',
  'travel',
  'art_culture',
  'gaming',
  'fitness',
  'music',
  'nightlife',
  'brunch',
  // B. Free tonight
  'free_tonight',
  // C. Relationship intent
  'serious_vibes',
  'keep_it_casual',
  'exploring_vibes',
  'see_where_it_goes',
  'open_to_vibes',
  'just_friends',
  'open_to_anything',
  'single_parent',
  'new_to_dating',
  // D. Right Now (residual)
  'nearby',
  'online_now',
  'active_today',
];

// ---------------------------------------------------------------------------
// Local helpers (pure, do not touch DB)
// ---------------------------------------------------------------------------

function calculateAge(dateOfBirth?: string | null): number {
  if (!dateOfBirth) return 0;
  const birth = new Date(dateOfBirth);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return Math.round(distanceMeters(lat1, lng1, lat2, lng2) / 1000);
}

function isUserPaused(user: {
  isDiscoveryPaused?: boolean;
  discoveryPausedUntil?: number;
}): boolean {
  return (
    user.isDiscoveryPaused === true &&
    typeof user.discoveryPausedUntil === 'number' &&
    (user.discoveryPausedUntil as number) > Date.now()
  );
}

function isEffectivelyHiddenFromDiscover(user: {
  hideFromDiscover?: boolean;
  isDiscoveryPaused?: boolean;
  discoveryPausedUntil?: number;
}): boolean {
  return user.hideFromDiscover === true || isUserPaused(user);
}

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
    return viewerGender === 'male'
      ? candidateGender === 'female'
      : candidateGender === 'male';
  }
  if (viewerOrientation === 'gay') {
    return candidateGender === viewerGender;
  }
  if (viewerOrientation === 'lesbian') {
    return viewerGender === 'female' && candidateGender === 'female';
  }
  return true;
}

// Mirrors matchesExploreCategory in convex/discover.ts.
function exploreCandidateMatchesCategory(
  candidate: {
    activities: string[];
    relationshipIntent: string[];
    distanceKm?: number;
    isActiveNow: boolean;
    wasActiveToday: boolean;
  },
  categoryId: string,
): boolean {
  const acts = candidate.activities;
  const intents = candidate.relationshipIntent;
  const intentHas = (k: string) => intents.includes(k);
  switch (categoryId) {
    case 'serious_vibes': return intentHas('serious_vibes');
    case 'keep_it_casual': return intentHas('keep_it_casual');
    case 'exploring_vibes': return intentHas('exploring_vibes');
    case 'see_where_it_goes': return intentHas('see_where_it_goes');
    case 'open_to_vibes': return intentHas('open_to_vibes');
    case 'just_friends': return intentHas('just_friends');
    case 'open_to_anything': return intentHas('open_to_anything');
    case 'single_parent': return intentHas('single_parent');
    case 'new_to_dating': return intentHas('new_to_dating');
    case 'nearby':
      return typeof candidate.distanceKm === 'number' && candidate.distanceKm <= 5;
    case 'online_now': return candidate.isActiveNow === true;
    case 'active_today': return candidate.wasActiveToday === true;
    case 'free_tonight': return acts.includes('free_tonight');
    case 'coffee_date': return acts.includes('coffee');
    case 'sports': return acts.includes('sports');
    case 'nature_lovers': return acts.includes('outdoors');
    case 'binge_watchers': return acts.includes('movies');
    case 'foodie': return acts.includes('foodie');
    case 'travel': return acts.includes('travel');
    case 'art_culture': return acts.includes('art_culture');
    case 'gaming': return acts.includes('gaming');
    case 'fitness':
      return acts.includes('gym_partner') || acts.includes('gym');
    case 'music':
      return acts.includes('concerts') || acts.includes('music_lover');
    case 'nightlife': return acts.includes('nightlife');
    case 'brunch': return acts.includes('brunch');
    default: return false;
  }
}

function assignExploreCategory(candidate: {
  activities: string[];
  relationshipIntent: string[];
  distanceKm?: number;
  isActiveNow: boolean;
  wasActiveToday: boolean;
}): string | null {
  for (const id of EXPLORE_ASSIGNMENT_PRIORITY) {
    if (exploreCandidateMatchesCategory(candidate, id)) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Diagnostic query
// ---------------------------------------------------------------------------

export const getDiscoveryDiagnostics = query({
  args: {
    viewerUserId: v.id('users'),
    candidateUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const viewer = await ctx.db.get(args.viewerUserId);
    const candidate = await ctx.db.get(args.candidateUserId);

    if (!viewer || !candidate) {
      return {
        ok: false,
        error: !viewer ? 'viewer_not_found' : 'candidate_not_found',
        viewerUserId: args.viewerUserId,
        candidateUserId: args.candidateUserId,
        nearby: { eligible: false, reasons: ['user(s) not found'] },
        discover: { eligible: false, reasons: ['user(s) not found'] },
        explore: { eligible: false, reasons: ['user(s) not found'] },
        deepConnect: { eligible: false, reasons: ['user(s) not found'] },
      };
    }

    // Load shared negative-relationship exclusions (blocks / unmatched /
    // viewer-reported) once and reuse across all four surfaces.
    const exclusions = await loadDiscoveryExclusions(ctx, args.viewerUserId);
    const candidateIdStr = args.candidateUserId as unknown as string;

    const isBlocked = exclusions.blockedUserIds.has(candidateIdStr);
    const isUnmatched = exclusions.unmatchedUserIds.has(candidateIdStr);
    const isViewerReported = exclusions.viewerReportedIds.has(candidateIdStr);

    // Viewer's swipes on this specific candidate.
    const mySwipes = await ctx.db
      .query('likes')
      .withIndex('by_from_user', (q) => q.eq('fromUserId', args.viewerUserId))
      .collect();
    const swipeOnCandidate = mySwipes.find(
      (s) => (s.toUserId as unknown as string) === candidateIdStr,
    );
    const hasActiveSwipe = !!swipeOnCandidate &&
      !(swipeOnCandidate.action === 'pass' &&
        swipeOnCandidate.createdAt < now - PASS_EXPIRY_MS);

    // Any match row (active OR inactive) between the pair.
    const matchesU1 = await ctx.db
      .query('matches')
      .withIndex('by_user1', (q) => q.eq('user1Id', args.viewerUserId))
      .collect();
    const matchesU2 = await ctx.db
      .query('matches')
      .withIndex('by_user2', (q) => q.eq('user2Id', args.viewerUserId))
      .collect();
    const matchRow =
      matchesU1.find((m) => (m.user2Id as unknown as string) === candidateIdStr) ||
      matchesU2.find((m) => (m.user1Id as unknown as string) === candidateIdStr) ||
      null;

    // Existing conversation partner?
    const myParticipations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', args.viewerUserId))
      .collect();
    let conversationExists = false;
    for (const p of myParticipations) {
      const conv = await ctx.db.get(p.conversationId);
      if (!conv) continue;
      if ((conv.participants as string[]).includes(candidateIdStr)) {
        conversationExists = true;
        break;
      }
    }

    // Candidate's photos (once — reused by Nearby photo-count + Discover/Explore
    // safePublicPhotos gate).
    const candidatePhotos = await ctx.db
      .query('photos')
      .withIndex('by_user_order', (q) => q.eq('userId', args.candidateUserId))
      .collect();
    const photoCount = candidatePhotos.length;
    const safePublicPhotos = candidatePhotos.filter(
      (p) => !p.isNsfw && p.photoType !== 'verification_reference',
    );

    // -----------------------------------------------------------------------
    // NEARBY
    // -----------------------------------------------------------------------
    const nearbyReasons: string[] = [];
    const isDevBypass = process.env.EXPO_PUBLIC_DEMO_AUTH_MODE === 'true';

    if (viewer.verificationStatus !== 'verified' && !isDevBypass) {
      nearbyReasons.push('viewer not verified (Nearby requires verified viewer unless DEMO_AUTH_MODE)');
    }
    const myNearbyLat = (viewer as any).publishedLat ?? viewer.latitude;
    const myNearbyLng = (viewer as any).publishedLng ?? viewer.longitude;
    if (!myNearbyLat || !myNearbyLng) {
      nearbyReasons.push('viewer missing published/latest coordinates');
    }
    if ((candidate as any)._id === viewer._id) {
      nearbyReasons.push('viewer and candidate are the same user');
    }
    if (!candidate.isActive) nearbyReasons.push('candidate !isActive');
    if ((candidate as any).incognitoMode === true) {
      nearbyReasons.push('candidate incognitoMode=true (Nearby hides incognito)');
    }
    if ((candidate as any).nearbyEnabled === false) {
      nearbyReasons.push('candidate nearbyEnabled=false');
    }
    if ((candidate as any).nearbyPausedUntil && (candidate as any).nearbyPausedUntil > now) {
      nearbyReasons.push('candidate nearbyPausedUntil in the future');
    }
    if (!candidate.name) nearbyReasons.push('candidate missing name');
    if (!candidate.bio) nearbyReasons.push('candidate missing bio');
    if (!candidate.dateOfBirth) nearbyReasons.push('candidate missing dateOfBirth');
    if (!(candidate as any).primaryPhotoUrl) {
      nearbyReasons.push('candidate missing primaryPhotoUrl');
    }
    const candPubLat = (candidate as any).publishedLat;
    const candPubLng = (candidate as any).publishedLng;
    const candPubAt = (candidate as any).publishedAt;
    if (!candPubLat || !candPubLng || !candPubAt) {
      nearbyReasons.push('candidate missing publishedLat/Lng/At');
    } else if (now - candPubAt > GHOST_CUTOFF_MS) {
      nearbyReasons.push(
        `candidate published location stale (>${Math.floor(GHOST_CUTOFF_MS / 86400000)} days; age=${Math.floor((now - candPubAt) / 86400000)}d)`,
      );
    } else if (myNearbyLat && myNearbyLng) {
      const d = distanceMeters(myNearbyLat, myNearbyLng, candPubLat, candPubLng);
      if (d < NEARBY_MIN_METERS || d > NEARBY_MAX_METERS) {
        nearbyReasons.push(
          `outside Nearby range (distance=${Math.round(d)}m; allowed ${NEARBY_MIN_METERS}-${NEARBY_MAX_METERS}m)`,
        );
      }
    }
    const myAge = calculateAge(viewer.dateOfBirth);
    const candAge = calculateAge(candidate.dateOfBirth);
    if (myAge && candidate.minAge != null && myAge < candidate.minAge) {
      nearbyReasons.push(`viewer age ${myAge} below candidate.minAge ${candidate.minAge}`);
    }
    if (myAge && candidate.maxAge != null && myAge > candidate.maxAge) {
      nearbyReasons.push(`viewer age ${myAge} above candidate.maxAge ${candidate.maxAge}`);
    }
    if (candAge && viewer.minAge != null && candAge < viewer.minAge) {
      nearbyReasons.push(`candidate age ${candAge} below viewer.minAge ${viewer.minAge}`);
    }
    if (candAge && viewer.maxAge != null && candAge > viewer.maxAge) {
      nearbyReasons.push(`candidate age ${candAge} above viewer.maxAge ${viewer.maxAge}`);
    }
    if (!(viewer.lookingFor ?? []).includes(candidate.gender as any)) {
      nearbyReasons.push(`viewer.lookingFor does not include candidate.gender='${candidate.gender}'`);
    }
    if (!(candidate.lookingFor ?? []).includes(viewer.gender as any)) {
      nearbyReasons.push(`candidate.lookingFor does not include viewer.gender='${viewer.gender}'`);
    }
    if (isBlocked) nearbyReasons.push('blocked (either direction)');
    if (isUnmatched) nearbyReasons.push('unmatched pair (either direction)');
    if (isViewerReported) nearbyReasons.push('viewer reported candidate');
    if (swipeOnCandidate) {
      if (swipeOnCandidate.action !== 'pass') {
        nearbyReasons.push(`prior swipe exists (action=${swipeOnCandidate.action})`);
      } else if (swipeOnCandidate.createdAt > now - PASS_EXPIRY_MS) {
        nearbyReasons.push(`recent pass (<7d) excludes from Nearby`);
      }
    }
    if (photoCount < 2) {
      nearbyReasons.push(`candidate photos count ${photoCount} < 2 (Nearby requires ≥2)`);
    }

    // -----------------------------------------------------------------------
    // DISCOVER
    // -----------------------------------------------------------------------
    const discoverReasons: string[] = [];

    if (isEffectivelyHiddenFromDiscover(viewer as any)) {
      discoverReasons.push('VIEWER hideFromDiscover=true OR viewer is isDiscoveryPaused');
    }
    if (!candidate.isActive) discoverReasons.push('candidate !isActive');
    if ((candidate as any).isBanned) discoverReasons.push('candidate isBanned=true');
    if (isEffectivelyHiddenFromDiscover(candidate as any)) {
      discoverReasons.push('candidate hideFromDiscover=true OR isDiscoveryPaused active');
    }
    if (candidate.verificationStatus !== 'verified') {
      discoverReasons.push(`candidate verificationStatus='${candidate.verificationStatus || 'unverified'}' (Discover requires 'verified')`);
    }
    if ((candidate as any).incognitoMode === true) {
      const canSeeIncognito =
        viewer.gender === 'female' || (viewer as any).subscriptionTier === 'premium';
      if (!canSeeIncognito) {
        discoverReasons.push('candidate incognitoMode=true and viewer is not female/premium');
      }
    }
    if (!orientationAllowsCandidateGender({
      viewerGender: viewer.gender,
      viewerOrientation: (viewer as any).orientation ?? undefined,
      candidateGender: candidate.gender,
    })) {
      discoverReasons.push(
        `orientation mismatch (viewer ${viewer.gender}/${(viewer as any).orientation ?? 'n/a'} ↔ candidate ${candidate.gender})`,
      );
    }
    if (!(viewer.lookingFor ?? []).includes(candidate.gender as any)) {
      discoverReasons.push(`viewer.lookingFor does not include candidate.gender='${candidate.gender}'`);
    }
    if (!(candidate.lookingFor ?? []).includes(viewer.gender as any)) {
      discoverReasons.push(`candidate.lookingFor does not include viewer.gender='${viewer.gender}'`);
    }
    if (candAge && (candAge < viewer.minAge || candAge > viewer.maxAge)) {
      discoverReasons.push(`candidate age ${candAge} outside viewer's ${viewer.minAge}-${viewer.maxAge}`);
    }
    if (myAge && (myAge < candidate.minAge || myAge > candidate.maxAge)) {
      discoverReasons.push(`viewer age ${myAge} outside candidate's ${candidate.minAge}-${candidate.maxAge}`);
    }
    if (
      typeof viewer.latitude === 'number' &&
      typeof viewer.longitude === 'number' &&
      typeof candidate.latitude === 'number' &&
      typeof candidate.longitude === 'number'
    ) {
      const dKm = distanceKm(
        viewer.latitude,
        viewer.longitude,
        candidate.latitude,
        candidate.longitude,
      );
      const maxD = (viewer as any).maxDistance;
      if (typeof maxD === 'number' && dKm > maxD) {
        discoverReasons.push(`distance ${dKm}km > viewer.maxDistance ${maxD}km`);
      }
    }
    if (hasActiveSwipe) discoverReasons.push('prior swipe/like exists (not expired)');
    if (matchRow) {
      discoverReasons.push(
        `prior match row exists (active=${(matchRow as any).isActive !== false}, u1Unmatched=${!!(matchRow as any).user1UnmatchedAt}, u2Unmatched=${!!(matchRow as any).user2UnmatchedAt})`,
      );
    }
    if (isBlocked) discoverReasons.push('blocked (either direction)');
    if (isViewerReported) discoverReasons.push('viewer reported candidate');
    // Note: conversation-partner exclusion was removed from production Discover.
    // `pair.conversationExists` is still surfaced above for visibility.
    if ((candidate as any).verificationEnforcementLevel === 'security_only') {
      discoverReasons.push("candidate verificationEnforcementLevel='security_only'");
    }
    if ((candidate as any).verificationEnforcementLevel === 'reduced_reach') {
      discoverReasons.push(
        "candidate verificationEnforcementLevel='reduced_reach' (may be rotated-out on a given day — non-deterministic)",
      );
    }
    if (safePublicPhotos.length === 0) {
      discoverReasons.push(
        `no safe public photos (all ${photoCount} photos are NSFW or verification_reference)`,
      );
    }

    // -----------------------------------------------------------------------
    // EXPLORE
    // -----------------------------------------------------------------------
    const exploreReasons: string[] = [];

    if (isEffectivelyHiddenFromDiscover(viewer as any) ||
        !viewer.isActive || (viewer as any).isBanned) {
      exploreReasons.push('viewer unavailable for Explore (inactive/banned/hidden/paused)');
    }
    if (!candidate.isActive) exploreReasons.push('candidate !isActive');
    if ((candidate as any).isBanned) exploreReasons.push('candidate isBanned=true');
    if (isEffectivelyHiddenFromDiscover(candidate as any)) {
      exploreReasons.push('candidate hideFromDiscover=true OR isDiscoveryPaused active');
    }
    if ((candidate as any).verificationEnforcementLevel === 'security_only') {
      exploreReasons.push("candidate verificationEnforcementLevel='security_only'");
    }
    if (hasActiveSwipe) exploreReasons.push('prior swipe/like exists (not expired)');
    if (matchRow) exploreReasons.push('prior match row exists (active or inactive)');
    if (isBlocked) exploreReasons.push('blocked (either direction)');
    if (isViewerReported) exploreReasons.push('viewer reported candidate');
    // Note: conversation-partner exclusion was removed from production Explore.
    if ((candidate as any).incognitoMode === true) {
      const canSeeIncognito =
        viewer.gender === 'female' || (viewer as any).subscriptionTier === 'premium';
      if (!canSeeIncognito) {
        exploreReasons.push('candidate incognitoMode=true and viewer is not female/premium');
      }
    }
    // Explore fetches via viewer.lookingFor gender buckets → candidate.gender
    // must be in viewer.lookingFor for Explore to surface it at all.
    if (!(viewer.lookingFor ?? []).includes(candidate.gender as any)) {
      exploreReasons.push(
        `viewer.lookingFor does not include candidate.gender='${candidate.gender}' (Explore fetches gender buckets from viewer.lookingFor)`,
      );
    }
    // Inside buildExploreCandidates: candidate.lookingFor.includes(viewer.gender)
    if (!(candidate.lookingFor ?? []).includes(viewer.gender as any)) {
      exploreReasons.push(
        `candidate.lookingFor does not include viewer.gender='${viewer.gender}'`,
      );
    }
    if (candAge && (candAge < viewer.minAge || candAge > viewer.maxAge)) {
      exploreReasons.push(`candidate age ${candAge} outside viewer's ${viewer.minAge}-${viewer.maxAge}`);
    }
    if (myAge > 0 && (myAge < candidate.minAge || myAge > candidate.maxAge)) {
      exploreReasons.push(`viewer age ${myAge} outside candidate's ${candidate.minAge}-${candidate.maxAge}`);
    }
    // Distance gate (uses viewer.maxDistance, viewer lat/lng vs candidate
    // publishedLat/Lng then fallback to candidate lat/lng).
    if (typeof viewer.latitude === 'number' && typeof viewer.longitude === 'number') {
      const cLat = (candidate as any).publishedLat ?? candidate.latitude;
      const cLng = (candidate as any).publishedLng ?? candidate.longitude;
      if (typeof cLat === 'number' && typeof cLng === 'number') {
        const dKm = distanceKm(viewer.latitude, viewer.longitude, cLat, cLng);
        const maxD = (viewer as any).maxDistance;
        if (typeof maxD === 'number' && dKm > maxD) {
          exploreReasons.push(`distance ${dKm}km > viewer.maxDistance ${maxD}km`);
        }
      }
    }
    // Explore photo rule: primaryPhotoUrl OR displayPrimaryPhotoUrl.
    const hasExplorePrimary =
      !!((candidate as any).primaryPhotoUrl || (candidate as any).displayPrimaryPhotoUrl);
    if (!hasExplorePrimary) {
      exploreReasons.push('candidate missing primaryPhotoUrl and displayPrimaryPhotoUrl');
    }

    // Exclusive category assignment — if null, candidate is NEVER shown on
    // any Explore tile (even without an active categoryId filter the UI
    // groups by category).
    const candDistKm =
      typeof viewer.latitude === 'number' &&
      typeof viewer.longitude === 'number' &&
      typeof ((candidate as any).publishedLat ?? candidate.latitude) === 'number' &&
      typeof ((candidate as any).publishedLng ?? candidate.longitude) === 'number'
        ? distanceKm(
            viewer.latitude,
            viewer.longitude,
            (candidate as any).publishedLat ?? (candidate.latitude as number),
            (candidate as any).publishedLng ?? (candidate.longitude as number),
          )
        : undefined;
    const lastActive =
      typeof (candidate as any).lastActive === 'number'
        ? ((candidate as any).lastActive as number)
        : 0;
    const exploreCandidateShape = {
      activities: Array.isArray(candidate.activities)
        ? (candidate.activities as string[])
        : [],
      relationshipIntent: Array.isArray(candidate.relationshipIntent)
        ? (candidate.relationshipIntent as string[])
        : [],
      distanceKm: candDistKm,
      isActiveNow: lastActive > 0 && now - lastActive <= ONLINE_NOW_MS,
      wasActiveToday: lastActive > 0 && now - lastActive <= ACTIVE_TODAY_MS,
    };
    const assignedCategory = assignExploreCategory(exploreCandidateShape);
    if (!assignedCategory) {
      exploreReasons.push(
        'no Explore category assignable (candidate has no matching activity, no listed relationshipIntent, no free_tonight flag, and no nearby/online/active-today signal)',
      );
    }

    // -----------------------------------------------------------------------
    // DEEP CONNECT
    // -----------------------------------------------------------------------
    const deepConnectReasons: string[] = [];

    const candidatePrivate = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.candidateUserId))
      .first();

    if (!candidatePrivate) {
      deepConnectReasons.push('candidate has no userPrivateProfiles row');
    } else {
      if ((candidatePrivate as any).isPrivateEnabled !== true) {
        deepConnectReasons.push('candidate isPrivateEnabled !== true');
      }
      if ((candidatePrivate as any).isSetupComplete !== true) {
        deepConnectReasons.push('candidate isSetupComplete !== true (Phase-2 onboarding incomplete)');
      }
      if ((candidatePrivate as any).hideFromDeepConnect === true) {
        deepConnectReasons.push('candidate hideFromDeepConnect=true');
      }
    }
    if (!candidate.isActive) {
      deepConnectReasons.push('candidate owner user !isActive');
    }
    if (isBlocked) deepConnectReasons.push('blocked (either direction)');
    if (isUnmatched) deepConnectReasons.push('unmatched pair (either direction)');
    // Note: conversation-partner exclusion was removed from production Deep Connect.
    // pending deletion on candidate
    const deletionState = await ctx.db
      .query('privateDeletionStates')
      .withIndex('by_userId', (q) => q.eq('userId', args.candidateUserId))
      .first();
    if (deletionState && (deletionState as any).status === 'pending_deletion') {
      deepConnectReasons.push('candidate has privateDeletionStates.status=pending_deletion');
    }

    // -----------------------------------------------------------------------
    // Final structured result
    // -----------------------------------------------------------------------
    return {
      ok: true,
      at: now,
      viewerUserId: args.viewerUserId,
      candidateUserId: args.candidateUserId,
      viewer: {
        isActive: viewer.isActive,
        gender: viewer.gender,
        orientation: (viewer as any).orientation,
        verificationStatus: viewer.verificationStatus,
        hideFromDiscover: (viewer as any).hideFromDiscover,
        isDiscoveryPaused: (viewer as any).isDiscoveryPaused,
        discoveryPausedUntil: (viewer as any).discoveryPausedUntil,
        maxDistance: (viewer as any).maxDistance,
        minAge: viewer.minAge,
        maxAge: viewer.maxAge,
        lookingFor: viewer.lookingFor,
        age: myAge,
      },
      candidate: {
        isActive: candidate.isActive,
        isBanned: (candidate as any).isBanned,
        gender: candidate.gender,
        verificationStatus: candidate.verificationStatus,
        verificationEnforcementLevel: (candidate as any).verificationEnforcementLevel,
        hideFromDiscover: (candidate as any).hideFromDiscover,
        isDiscoveryPaused: (candidate as any).isDiscoveryPaused,
        discoveryPausedUntil: (candidate as any).discoveryPausedUntil,
        nearbyEnabled: (candidate as any).nearbyEnabled,
        nearbyPausedUntil: (candidate as any).nearbyPausedUntil,
        incognitoMode: (candidate as any).incognitoMode,
        primaryPhotoUrl: (candidate as any).primaryPhotoUrl,
        displayPrimaryPhotoUrl: (candidate as any).displayPrimaryPhotoUrl,
        publishedAt: (candidate as any).publishedAt,
        publishedAtAgeDays:
          typeof (candidate as any).publishedAt === 'number'
            ? Math.floor((now - (candidate as any).publishedAt) / 86400000)
            : null,
        minAge: candidate.minAge,
        maxAge: candidate.maxAge,
        lookingFor: candidate.lookingFor,
        activities: candidate.activities,
        relationshipIntent: candidate.relationshipIntent,
        age: candAge,
        photoCount,
        safePublicPhotoCount: safePublicPhotos.length,
        exploreCategory: assignedCategory,
      },
      pair: {
        isBlocked,
        isUnmatched,
        isViewerReported,
        hasActiveSwipe,
        hasMatchRow: !!matchRow,
        matchIsActive: matchRow ? (matchRow as any).isActive !== false : null,
        conversationExists,
      },
      nearby: {
        eligible: nearbyReasons.length === 0,
        reasons: nearbyReasons,
      },
      discover: {
        eligible: discoverReasons.length === 0,
        reasons: discoverReasons,
      },
      explore: {
        eligible: exploreReasons.length === 0,
        reasons: exploreReasons,
      },
      deepConnect: {
        eligible: deepConnectReasons.length === 0,
        reasons: deepConnectReasons,
      },
    };
  },
});
