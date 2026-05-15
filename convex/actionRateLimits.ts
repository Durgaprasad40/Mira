/**
 * Generic per-user action rate limiter.
 *
 * Mirrors the Crossed-Paths `reserveBgRateLimitSlots()` pattern but is
 * action-keyed (not device-keyed) so it can guard report flows, swipe
 * velocity, pre-match text caps, and per-recipient Discover-notification
 * caps.
 *
 * Backed by the `actionRateLimits` table — one row per
 * (userId, action, windowKind) tuple. Uses fixed (not sliding) windows;
 * windows reset by replacing windowStartedAt + count when stale.
 *
 * Anti-abuse properties:
 *   - All checks happen BEFORE the original write so quota cost is bounded.
 *   - On rate-limit denial NO write is made to the counter table.
 *   - On accept counters are patched in-place; row count stays bounded
 *     at one row per (user, action, windowKind).
 *   - Failures inside the limiter never leak which window denied the
 *     caller beyond a coarse `windowKind` reason string.
 */

import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export type RateLimitWindow = {
  /** Stable string key — one row will be allocated per (user, action, kind). */
  kind: string;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum number of accepted slots per window. */
  max: number;
};

export type RateLimitResult =
  | { accept: true }
  | { accept: false; reason: string; windowKind: string; retryAfterMs: number };

/**
 * Pre-flight rate-limit check + reservation.
 *
 * Iterates each window in order. For each window:
 *   1. Loads (or creates) the (userId, action, windowKind) row.
 *   2. Resets the row if the window is stale (now - windowStartedAt > windowMs).
 *   3. Returns `{accept: false}` if count + 1 would exceed max.
 *
 * If every window has headroom, persists the incremented counters and
 * returns `{accept: true}`.
 *
 * IMPORTANT: pass the windows in order from MOST permissive to LEAST
 * permissive — the first denial wins. The order does not affect
 * correctness but it does affect which `windowKind` string surfaces
 * in logs.
 */
export async function reserveActionSlots(
  ctx: MutationCtx,
  userId: Id<'users'>,
  action: string,
  windows: RateLimitWindow[],
): Promise<RateLimitResult> {
  if (windows.length === 0) return { accept: true };

  const now = Date.now();

  // Phase 1: load all rows + decide whether to accept (no writes yet).
  type LoadedWindow = {
    spec: RateLimitWindow;
    row: { _id: Id<'actionRateLimits'>; windowStartedAt: number; count: number } | null;
    nextStartedAt: number;
    nextCount: number;
  };

  const loaded: LoadedWindow[] = [];
  for (const spec of windows) {
    const row = await ctx.db
      .query('actionRateLimits')
      .withIndex('by_user_action_window', (q) =>
        q.eq('userId', userId).eq('action', action).eq('windowKind', spec.kind),
      )
      .first();

    let startedAt = row?.windowStartedAt ?? now;
    let count = row?.count ?? 0;
    if (now - startedAt > spec.windowMs) {
      startedAt = now;
      count = 0;
    }

    if (count + 1 > spec.max) {
      const retryAfterMs = Math.max(0, spec.windowMs - (now - startedAt));
      return {
        accept: false,
        reason: `rate_limited_${spec.kind}`,
        windowKind: spec.kind,
        retryAfterMs,
      };
    }

    loaded.push({ spec, row, nextStartedAt: startedAt, nextCount: count + 1 });
  }

  // Phase 2: persist new counters (only after every window accepted).
  for (const lw of loaded) {
    const patch = {
      windowStartedAt: lw.nextStartedAt,
      count: lw.nextCount,
      updatedAt: now,
    };
    if (lw.row) {
      await ctx.db.patch(lw.row._id, patch);
    } else {
      await ctx.db.insert('actionRateLimits', {
        userId,
        action,
        windowKind: lw.spec.kind,
        ...patch,
      });
    }
  }

  return { accept: true };
}
