/**
 * Nearby Diagnostics (READ-ONLY)
 *
 * Dev-only per-pair diagnostic query for Phase-1 Nearby / crossed-paths.
 * This file never writes data and does not change production behavior.
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { loadDiscoveryExclusions } from '../discoveryExclusions';

// Mirrored from convex/crossedPaths.ts for diagnostics only.
const CROSSED_MIN_METERS = 0;
const CROSSED_MAX_METERS = 1000;
const FOREGROUND_FRESHNESS_MS = 12 * 60 * 60 * 1000;
const GHOST_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000;

type Direction = 'viewer_to_candidate' | 'candidate_to_viewer';

interface GateResult {
  ok: boolean;
  reason?: string;
}

function calculateAge(dateOfBirth?: string | null): number {
  if (!dateOfBirth) return 0;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusM = 6371000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationAgeMs(timestamp: number | undefined, now: number): number | null {
  return typeof timestamp === 'number' ? Math.max(0, now - timestamp) : null;
}

function locationAgeMinutes(timestamp: number | undefined, now: number): number | null {
  const age = locationAgeMs(timestamp, now);
  return age === null ? null : Math.round(age / 60000);
}

function hasNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function orderedPair(userA: Id<'users'>, userB: Id<'users'>) {
  return userA < userB
    ? { user1Id: userA, user2Id: userB }
    : { user1Id: userB, user2Id: userA };
}

async function getPhotoCount(ctx: any, userId: Id<'users'>): Promise<number> {
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_user_order', (q: any) => q.eq('userId', userId))
    .filter((q: any) => q.neq(q.field('photoType'), 'verification_reference'))
    .collect();
  return photos.length;
}

function summarizeUser(
  user: Doc<'users'>,
  photoCount: number,
) {
  return {
    _id: user._id,
    name: user.name ?? null,
    displayName: user.name ?? null,
    verificationStatus: user.verificationStatus ?? 'unverified',
    isActive: user.isActive,
    nearbyEnabled: user.nearbyEnabled ?? null,
    nearbyPausedUntil: user.nearbyPausedUntil ?? null,
    incognitoMode: user.incognitoMode ?? null,
    recordCrossedPaths: user.recordCrossedPaths ?? null,
    hasLatitude: hasNumber(user.latitude),
    hasLongitude: hasNumber(user.longitude),
    lastLocationUpdatedAt: user.lastLocationUpdatedAt ?? null,
    hasPublishedLat: hasNumber(user.publishedLat),
    hasPublishedLng: hasNumber(user.publishedLng),
    publishedAt: user.publishedAt ?? null,
    profile: {
      hasName: Boolean(user.name),
      hasBio: Boolean(user.bio),
      hasDateOfBirth: Boolean(user.dateOfBirth),
      photoCount,
      hasEnoughPhotos: photoCount >= 2,
    },
  };
}

function buildLocationFreshness(user: Doc<'users'>, now: number) {
  const rawAgeMs = locationAgeMs(user.lastLocationUpdatedAt, now);
  const publishedAgeMs = locationAgeMs(user.publishedAt, now);

  return {
    rawLocationAgeMs: rawAgeMs,
    rawLocationAgeMinutes: locationAgeMinutes(user.lastLocationUpdatedAt, now),
    rawStaleForRecordLocation:
      rawAgeMs === null ? true : rawAgeMs > FOREGROUND_FRESHNESS_MS,
    publishedLocationAgeMs: publishedAgeMs,
    publishedLocationAgeMinutes: locationAgeMinutes(user.publishedAt, now),
    publishedStaleForForegroundDetection:
      publishedAgeMs === null ? true : publishedAgeMs > FOREGROUND_FRESHNESS_MS,
    publishedStaleForNearbyLegacyWindow:
      publishedAgeMs === null ? true : publishedAgeMs > GHOST_CUTOFF_MS,
  };
}

function distanceReport(viewer: Doc<'users'>, candidate: Doc<'users'>) {
  const hasRaw =
    hasNumber(viewer.latitude) &&
    hasNumber(viewer.longitude) &&
    hasNumber(candidate.latitude) &&
    hasNumber(candidate.longitude);
  const rawDistanceM = hasRaw
    ? Math.round(distanceMeters(
        viewer.latitude!,
        viewer.longitude!,
        candidate.latitude!,
        candidate.longitude!,
      ))
    : null;

  const hasPublished =
    hasNumber(viewer.publishedLat) &&
    hasNumber(viewer.publishedLng) &&
    hasNumber(candidate.publishedLat) &&
    hasNumber(candidate.publishedLng);
  const publishedDistanceM = hasPublished
    ? Math.round(distanceMeters(
        viewer.publishedLat!,
        viewer.publishedLng!,
        candidate.publishedLat!,
        candidate.publishedLng!,
      ))
    : null;

  return {
    rawDistanceM,
    rawWithinCrossedPathRange:
      rawDistanceM !== null &&
      rawDistanceM >= CROSSED_MIN_METERS &&
      rawDistanceM <= CROSSED_MAX_METERS,
    publishedDistanceM,
    publishedWithinCrossedPathRange:
      publishedDistanceM !== null &&
      publishedDistanceM >= CROSSED_MIN_METERS &&
      publishedDistanceM <= CROSSED_MAX_METERS,
    crossedPathRangeM: {
      min: CROSSED_MIN_METERS,
      max: CROSSED_MAX_METERS,
    },
  };
}

function buildDirectionGates(args: {
  actor: Doc<'users'>;
  other: Doc<'users'>;
  actorPhotoCount: number;
  otherPhotoCount: number;
  actorReportedOther: boolean;
  blockedEitherDirection: boolean;
  unmatchedEitherDirection: boolean;
  rawDistanceM: number | null;
  now: number;
}) {
  const {
    actor,
    other,
    actorPhotoCount,
    otherPhotoCount,
    actorReportedOther,
    blockedEitherDirection,
    unmatchedEitherDirection,
    rawDistanceM,
    now,
  } = args;

  const actorAge = calculateAge(actor.dateOfBirth);
  const otherAge = calculateAge(other.dateOfBirth);
  const otherRawAgeMs = locationAgeMs(other.lastLocationUpdatedAt, now);

  const gates: Record<string, GateResult> = {
    verified: {
      ok: actor.verificationStatus === 'verified' && other.verificationStatus === 'verified',
      reason:
        actor.verificationStatus !== 'verified'
          ? `actor verificationStatus=${actor.verificationStatus ?? 'unverified'}`
          : other.verificationStatus !== 'verified'
            ? `other verificationStatus=${other.verificationStatus ?? 'unverified'}`
            : undefined,
    },
    active: {
      ok: actor.isActive === true && other.isActive === true,
      reason:
        actor.isActive !== true
          ? 'actor isActive is not true'
          : other.isActive !== true
            ? 'other isActive is not true'
            : undefined,
    },
    nearbyEnabled: {
      ok: actor.nearbyEnabled !== false && other.nearbyEnabled !== false,
      reason:
        actor.nearbyEnabled === false
          ? 'actor nearbyEnabled=false'
          : other.nearbyEnabled === false
            ? 'other nearbyEnabled=false'
            : undefined,
    },
    notPaused: {
      ok:
        !(actor.nearbyPausedUntil && actor.nearbyPausedUntil > now) &&
        !(other.nearbyPausedUntil && other.nearbyPausedUntil > now),
      reason:
        actor.nearbyPausedUntil && actor.nearbyPausedUntil > now
          ? 'actor nearbyPausedUntil is in the future'
          : other.nearbyPausedUntil && other.nearbyPausedUntil > now
            ? 'other nearbyPausedUntil is in the future'
            : undefined,
    },
    notIncognito: {
      ok: actor.incognitoMode !== true && other.incognitoMode !== true,
      reason:
        actor.incognitoMode === true
          ? 'actor incognitoMode=true'
          : other.incognitoMode === true
            ? 'other incognitoMode=true'
            : undefined,
    },
    recordCrossedPathsEnabled: {
      ok: actor.recordCrossedPaths !== false && other.recordCrossedPaths !== false,
      reason:
        actor.recordCrossedPaths === false
          ? 'actor recordCrossedPaths=false'
          : other.recordCrossedPaths === false
            ? 'other recordCrossedPaths=false'
            : undefined,
    },
    rawLocationPresent: {
      ok:
        hasNumber(actor.latitude) &&
        hasNumber(actor.longitude) &&
        hasNumber(other.latitude) &&
        hasNumber(other.longitude),
      reason:
        !hasNumber(actor.latitude) || !hasNumber(actor.longitude)
          ? 'actor missing raw latitude/longitude'
          : !hasNumber(other.latitude) || !hasNumber(other.longitude)
            ? 'other missing raw latitude/longitude'
            : undefined,
    },
    rawLocationFresh: {
      ok: otherRawAgeMs !== null && otherRawAgeMs <= FOREGROUND_FRESHNESS_MS,
      reason:
        otherRawAgeMs === null
          ? 'other missing lastLocationUpdatedAt'
          : otherRawAgeMs > FOREGROUND_FRESHNESS_MS
            ? 'other raw location stale for recordLocation'
            : undefined,
    },
    profileComplete: {
      ok: Boolean(actor.name && actor.bio && actor.dateOfBirth && other.name && other.bio && other.dateOfBirth),
      reason:
        !actor.name || !actor.bio || !actor.dateOfBirth
          ? 'actor missing name/bio/dateOfBirth'
          : !other.name || !other.bio || !other.dateOfBirth
            ? 'other missing name/bio/dateOfBirth'
            : undefined,
    },
    enoughPhotos: {
      ok: actorPhotoCount >= 2 && otherPhotoCount >= 2,
      reason:
        actorPhotoCount < 2
          ? `actor photoCount=${actorPhotoCount}`
          : otherPhotoCount < 2
            ? `other photoCount=${otherPhotoCount}`
            : undefined,
    },
    mutualAgeRange: {
      ok:
        actorAge >= (other.minAge ?? 0) &&
        actorAge <= (other.maxAge ?? 200) &&
        otherAge >= (actor.minAge ?? 0) &&
        otherAge <= (actor.maxAge ?? 200),
      reason:
        actorAge < (other.minAge ?? 0) || actorAge > (other.maxAge ?? 200)
          ? `actor age ${actorAge} outside other range ${other.minAge}-${other.maxAge}`
          : otherAge < (actor.minAge ?? 0) || otherAge > (actor.maxAge ?? 200)
            ? `other age ${otherAge} outside actor range ${actor.minAge}-${actor.maxAge}`
            : undefined,
    },
    mutualLookingFor: {
      ok:
        (actor.lookingFor ?? []).includes(other.gender as any) &&
        (other.lookingFor ?? []).includes(actor.gender as any),
      reason:
        !(actor.lookingFor ?? []).includes(other.gender as any)
          ? `actor.lookingFor does not include other.gender=${other.gender}`
          : !(other.lookingFor ?? []).includes(actor.gender as any)
            ? `other.lookingFor does not include actor.gender=${actor.gender}`
            : undefined,
    },
    notBlockedEitherDirection: {
      ok: !blockedEitherDirection,
      reason: blockedEitherDirection ? 'blocked either direction' : undefined,
    },
    notReported: {
      ok: !actorReportedOther,
      reason: actorReportedOther ? 'actor reported other' : undefined,
    },
    notUnmatched: {
      ok: !unmatchedEitherDirection,
      reason: unmatchedEitherDirection ? 'unmatched pair' : undefined,
    },
    withinDistanceRange: {
      ok:
        rawDistanceM !== null &&
        rawDistanceM >= CROSSED_MIN_METERS &&
        rawDistanceM <= CROSSED_MAX_METERS,
      reason:
        rawDistanceM === null
          ? 'raw distance unavailable'
          : `raw distance ${rawDistanceM}m outside ${CROSSED_MIN_METERS}-${CROSSED_MAX_METERS}m`,
    },
  };

  const firstFailingGate = Object.entries(gates).find(([, gate]) => !gate.ok);

  return {
    gates,
    firstFailingGate: firstFailingGate
      ? {
          key: firstFailingGate[0],
          reason: firstFailingGate[1].reason ?? 'failed',
        }
      : null,
  };
}

function visibleHistoryForViewer(
  entry: Doc<'crossPathHistory'>,
  viewerUserId: Id<'users'>,
  now: number,
) {
  if (entry.expiresAt <= now) return false;
  if (entry.user1Id === viewerUserId && entry.hiddenByUser1) return false;
  if (entry.user2Id === viewerUserId && entry.hiddenByUser2) return false;
  return true;
}

function diagnosisFrom(args: {
  viewerFirstFail: { key: string; reason: string } | null;
  candidateFirstFail: { key: string; reason: string } | null;
  activeHistoryExists: boolean;
  viewerCanSeeHistory: boolean;
  candidateCanSeeHistory: boolean;
  crossedPathExists: boolean;
}) {
  const {
    viewerFirstFail,
    candidateFirstFail,
    activeHistoryExists,
    viewerCanSeeHistory,
    candidateCanSeeHistory,
    crossedPathExists,
  } = args;

  if (viewerFirstFail?.key === 'rawLocationPresent' || candidateFirstFail?.key === 'rawLocationPresent') {
    return 'raw latitude/longitude missing for at least one side before recordLocation can write crossPathHistory';
  }
  if (viewerFirstFail?.key === 'rawLocationFresh' || candidateFirstFail?.key === 'rawLocationFresh') {
    return 'raw location stale for at least one candidate side before recordLocation can write crossPathHistory';
  }
  if (!activeHistoryExists) {
    return crossedPathExists
      ? 'crossedPaths pair exists but no active crossPathHistory row is available for Nearby map inclusion'
      : 'no crossedPaths or active crossPathHistory pair row exists yet';
  }
  if (!viewerCanSeeHistory || !candidateCanSeeHistory) {
    return 'active crossPathHistory exists but is hidden from at least one viewer';
  }
  if (viewerFirstFail) return `viewer cannot see candidate: ${viewerFirstFail.key} (${viewerFirstFail.reason})`;
  if (candidateFirstFail) return `candidate cannot see viewer: ${candidateFirstFail.key} (${candidateFirstFail.reason})`;
  return 'no failing gate found in read-only diagnostics';
}

export const getNearbyDiagnostics = query({
  args: {
    viewerUserId: v.id('users'),
    candidateUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const [viewer, candidate] = await Promise.all([
      ctx.db.get(args.viewerUserId),
      ctx.db.get(args.candidateUserId),
    ]);

    if (!viewer || !candidate) {
      return {
        ok: false,
        error: !viewer ? 'viewer_not_found' : 'candidate_not_found',
        viewerUserId: args.viewerUserId,
        candidateUserId: args.candidateUserId,
      };
    }

    const [
      viewerPhotoCount,
      candidatePhotoCount,
      viewerExclusions,
      candidateExclusions,
    ] = await Promise.all([
      getPhotoCount(ctx, args.viewerUserId),
      getPhotoCount(ctx, args.candidateUserId),
      loadDiscoveryExclusions(ctx, args.viewerUserId),
      loadDiscoveryExclusions(ctx, args.candidateUserId),
    ]);

    const distance = distanceReport(viewer, candidate);
    const pair = orderedPair(args.viewerUserId, args.candidateUserId);
    const [crossedPath, historyRows, viewerNotifications, candidateNotifications] =
      await Promise.all([
        ctx.db
          .query('crossedPaths')
          .withIndex('by_users', (q: any) =>
            q.eq('user1Id', pair.user1Id).eq('user2Id', pair.user2Id),
          )
          .first(),
        ctx.db
          .query('crossPathHistory')
          .withIndex('by_users', (q: any) =>
            q.eq('user1Id', pair.user1Id).eq('user2Id', pair.user2Id),
          )
          .collect(),
        ctx.db
          .query('notifications')
          .withIndex('by_user', (q: any) => q.eq('userId', args.viewerUserId))
          .collect(),
        ctx.db
          .query('notifications')
          .withIndex('by_user', (q: any) => q.eq('userId', args.candidateUserId))
          .collect(),
      ]);

    const viewerToCandidateBlocked = viewerExclusions.blockedUserIds.has(args.candidateUserId as string);
    const candidateToViewerBlocked = candidateExclusions.blockedUserIds.has(args.viewerUserId as string);
    const viewerToCandidateUnmatched = viewerExclusions.unmatchedUserIds.has(args.candidateUserId as string);
    const candidateToViewerUnmatched = candidateExclusions.unmatchedUserIds.has(args.viewerUserId as string);
    const viewerReportedCandidate = viewerExclusions.viewerReportedIds.has(args.candidateUserId as string);
    const candidateReportedViewer = candidateExclusions.viewerReportedIds.has(args.viewerUserId as string);

    const viewerToCandidate = buildDirectionGates({
      actor: viewer,
      other: candidate,
      actorPhotoCount: viewerPhotoCount,
      otherPhotoCount: candidatePhotoCount,
      actorReportedOther: viewerReportedCandidate,
      blockedEitherDirection: viewerToCandidateBlocked,
      unmatchedEitherDirection: viewerToCandidateUnmatched,
      rawDistanceM: distance.rawDistanceM,
      now,
    });

    const candidateToViewer = buildDirectionGates({
      actor: candidate,
      other: viewer,
      actorPhotoCount: candidatePhotoCount,
      otherPhotoCount: viewerPhotoCount,
      actorReportedOther: candidateReportedViewer,
      blockedEitherDirection: candidateToViewerBlocked,
      unmatchedEitherDirection: candidateToViewerUnmatched,
      rawDistanceM: distance.rawDistanceM,
      now,
    });

    const activeHistoryRows = historyRows.filter((entry) => entry.expiresAt > now);
    const expiredHistoryRows = historyRows.filter((entry) => entry.expiresAt <= now);
    const viewerCanSeeHistory = activeHistoryRows.some((entry) =>
      visibleHistoryForViewer(entry, args.viewerUserId, now),
    );
    const candidateCanSeeHistory = activeHistoryRows.some((entry) =>
      visibleHistoryForViewer(entry, args.candidateUserId, now),
    );

    const notificationFor = (
      rows: Doc<'notifications'>[],
      otherUserId: Id<'users'>,
    ) =>
      rows.some((notification) => {
        if (notification.type !== 'crossed_paths') return false;
        const data = notification.data ?? {};
        return (
          data.userId === (otherUserId as string) ||
          (typeof data.pairKey === 'string' &&
            data.pairKey.includes(args.viewerUserId as string) &&
            data.pairKey.includes(args.candidateUserId as string))
        );
      });

    const canViewerSeeCandidate =
      !viewerToCandidate.firstFailingGate && viewerCanSeeHistory;
    const canCandidateSeeViewer =
      !candidateToViewer.firstFailingGate && candidateCanSeeHistory;

    return {
      ok: true,
      at: now,
      constants: {
        crossedMinMeters: CROSSED_MIN_METERS,
        crossedMaxMeters: CROSSED_MAX_METERS,
        foregroundFreshnessMs: FOREGROUND_FRESHNESS_MS,
        ghostCutoffMs: GHOST_CUTOFF_MS,
      },
      viewer: summarizeUser(viewer, viewerPhotoCount),
      candidate: summarizeUser(candidate, candidatePhotoCount),
      locationFreshness: {
        viewer: buildLocationFreshness(viewer, now),
        candidate: buildLocationFreshness(candidate, now),
      },
      distance,
      eligibility: {
        viewerToCandidate,
        candidateToViewer,
      },
      existingRecords: {
        pair,
        crossedPaths: {
          exists: Boolean(crossedPath),
          count: crossedPath?.count ?? null,
          lastCrossedAt: crossedPath?.lastCrossedAt ?? null,
          dismissedByViewer:
            crossedPath?.user1Id === args.viewerUserId
              ? crossedPath?.dismissedByUser1At ?? null
              : crossedPath?.dismissedByUser2At ?? null,
          dismissedByCandidate:
            crossedPath?.user1Id === args.candidateUserId
              ? crossedPath?.dismissedByUser1At ?? null
              : crossedPath?.dismissedByUser2At ?? null,
        },
        crossPathHistory: {
          activeRowExists: activeHistoryRows.length > 0,
          activeRowCount: activeHistoryRows.length,
          expiredRowExists: expiredHistoryRows.length > 0,
          expiredRowCount: expiredHistoryRows.length,
          viewerCanSeeActiveRow: viewerCanSeeHistory,
          candidateCanSeeActiveRow: candidateCanSeeHistory,
          latestActiveCreatedAt:
            activeHistoryRows.sort((a, b) => b.createdAt - a.createdAt)[0]?.createdAt ?? null,
        },
        notifications: {
          viewerCrossedPathsNotificationExists: notificationFor(
            viewerNotifications,
            args.candidateUserId,
          ),
          candidateCrossedPathsNotificationExists: notificationFor(
            candidateNotifications,
            args.viewerUserId,
          ),
        },
      },
      finalDiagnosis: {
        canViewerSeeCandidate,
        canCandidateSeeViewer,
        firstFailingGateForViewer: canViewerSeeCandidate
          ? null
          : viewerToCandidate.firstFailingGate ?? {
              key: 'activeCrossPathHistory',
              reason: viewerCanSeeHistory
                ? 'active row exists but another map inclusion gate failed'
                : 'no visible active crossPathHistory row for viewer',
            },
        firstFailingGateForCandidate: canCandidateSeeViewer
          ? null
          : candidateToViewer.firstFailingGate ?? {
              key: 'activeCrossPathHistory',
              reason: candidateCanSeeHistory
                ? 'active row exists but another map inclusion gate failed'
                : 'no visible active crossPathHistory row for candidate',
            },
        likelyRootCause: diagnosisFrom({
          viewerFirstFail: viewerToCandidate.firstFailingGate,
          candidateFirstFail: candidateToViewer.firstFailingGate,
          activeHistoryExists: activeHistoryRows.length > 0,
          viewerCanSeeHistory,
          candidateCanSeeHistory,
          crossedPathExists: Boolean(crossedPath),
        }),
      },
    };
  },
});
