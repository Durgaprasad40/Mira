/**
 * Discovery Exclusions (shared helper)
 *
 * Centralises the "negative-relationship" exclusion sets used by the
 * Phase-1 discovery surfaces (Nearby, Discover, Explore).
 *
 * Rule:
 *   If two users have any negative relationship state — blocked, unmatched,
 *   or reported — they MUST NOT appear to each other in Nearby/Discover/Explore.
 *
 * Semantics (matching existing product behavior):
 *   - blockedUserIds:    bidirectional (either party blocked the other)
 *   - unmatchedUserIds:  bidirectional (either party unmatched the pair; the
 *                        `matches` row persists with `userXUnmatchedAt` set
 *                        and/or `isActive:false`)
 *   - viewerReportedIds: one-way (only the reporter stops seeing the reportee;
 *                        matches the existing Discover/Explore contract)
 *
 * This module is READ-ONLY and additive. It does NOT mutate state and does
 * NOT alter existing block/report/unmatch write paths.
 *
 * Confess surfaces intentionally do NOT use this helper — they filter via
 * `confessionReports` only.
 */

import { Doc, Id } from './_generated/dataModel';

export interface DiscoveryExclusions {
  /** Bidirectional: users the viewer has blocked OR who have blocked the viewer */
  blockedUserIds: Set<string>;
  /** Bidirectional: users the viewer has ever unmatched (or been unmatched by) */
  unmatchedUserIds: Set<string>;
  /** One-way: users the viewer has reported (reporter-only hide) */
  viewerReportedIds: Set<string>;
}

/**
 * Load the full negative-relationship exclusion set for a viewer in one pass.
 * Uses existing indexes only; no schema changes required.
 */
export async function loadDiscoveryExclusions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: Id<'users'>
): Promise<DiscoveryExclusions> {
  const [blocksOut, blocksIn, matchesAsUser1, matchesAsUser2, myReports] =
    await Promise.all([
      ctx.db
        .query('blocks')
        .withIndex('by_blocker', (q: any) => q.eq('blockerId', userId))
        .collect(),
      ctx.db
        .query('blocks')
        .withIndex('by_blocked', (q: any) => q.eq('blockedUserId', userId))
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user1', (q: any) => q.eq('user1Id', userId))
        .collect(),
      ctx.db
        .query('matches')
        .withIndex('by_user2', (q: any) => q.eq('user2Id', userId))
        .collect(),
      ctx.db
        .query('reports')
        .withIndex('by_reporter', (q: any) => q.eq('reporterId', userId))
        .collect(),
    ]);

  const blockedUserIds = new Set<string>();
  for (const b of blocksOut as Doc<'blocks'>[]) {
    blockedUserIds.add(b.blockedUserId as string);
  }
  for (const b of blocksIn as Doc<'blocks'>[]) {
    blockedUserIds.add(b.blockerId as string);
  }

  // A pair is "unmatched" if either side has an unmatched timestamp OR the
  // match row is marked inactive. We treat any such pair as permanently
  // excluded from future Phase-1 discovery — bidirectional by construction.
  const unmatchedUserIds = new Set<string>();
  for (const m of matchesAsUser1 as Doc<'matches'>[]) {
    if (
      (m as any).user1UnmatchedAt != null ||
      (m as any).user2UnmatchedAt != null ||
      (m as any).isActive === false
    ) {
      unmatchedUserIds.add(m.user2Id as string);
    }
  }
  for (const m of matchesAsUser2 as Doc<'matches'>[]) {
    if (
      (m as any).user1UnmatchedAt != null ||
      (m as any).user2UnmatchedAt != null ||
      (m as any).isActive === false
    ) {
      unmatchedUserIds.add(m.user1Id as string);
    }
  }

  const viewerReportedIds = new Set<string>();
  for (const r of myReports as Doc<'reports'>[]) {
    viewerReportedIds.add(r.reportedUserId as string);
  }

  return { blockedUserIds, unmatchedUserIds, viewerReportedIds };
}

/**
 * Convenience: returns true if the candidate must be hidden from the viewer
 * on Phase-1 discovery surfaces (Nearby/Discover/Explore).
 */
export function isDiscoveryExcluded(
  exclusions: DiscoveryExclusions,
  candidateUserId: string
): boolean {
  return (
    exclusions.blockedUserIds.has(candidateUserId) ||
    exclusions.unmatchedUserIds.has(candidateUserId) ||
    exclusions.viewerReportedIds.has(candidateUserId)
  );
}
