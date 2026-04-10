/**
 * UNIFIED PRESENCE SYSTEM (P0)
 *
 * Single source of truth for user online/active status.
 *
 * THRESHOLDS (standardized across all UI):
 * - Online Now: lastSeenAt within 10 minutes AND appState = 'foreground'
 * - Active Today: lastSeenAt within 24 hours
 * - Offline: lastSeenAt > 24 hours ago OR appState = 'inactive'
 *
 * ARCHITECTURE:
 * - presence table stores per-user (optionally per-device) presence state
 * - Client calls markActive() on foreground heartbeat (every 30s)
 * - Client calls markBackground() when app goes to background
 * - Cron job calls expireIfStale() to mark inactive users
 * - getUserPresence() returns computed status based on timestamp + appState
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { requireAuthenticatedSessionUser, validateSessionToken } from "./helpers";

// =============================================================================
// CONSTANTS
// =============================================================================

/** User is "Online Now" if lastSeenAt is within this threshold (10 minutes) */
export const ONLINE_NOW_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** User is "Active Today" if lastSeenAt is within this threshold (24 hours) */
export const ACTIVE_TODAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Heartbeat interval (client should call markActive at this rate) */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

/** Stale threshold - mark as inactive if no heartbeat for this long */
export const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

// =============================================================================
// TYPES
// =============================================================================

export type PresenceStatus = "online" | "active_today" | "offline";

export interface PresenceInfo {
  status: PresenceStatus;
  lastSeenAt: number;
  appState: "foreground" | "background" | "inactive";
  /** Human-readable label for UI */
  label: string;
  /** True when presence is intentionally hidden by user privacy settings */
  isHidden?: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Compute presence status from timestamp and app state.
 * This is the SINGLE SOURCE OF TRUTH for presence computation.
 */
export function computePresenceStatus(
  lastSeenAt: number,
  appState: "foreground" | "background" | "inactive",
  now: number = Date.now()
): PresenceInfo {
  const timeSinceActive = now - lastSeenAt;

  // Online Now: Recent activity AND in foreground
  if (timeSinceActive <= ONLINE_NOW_THRESHOLD_MS && appState === "foreground") {
    return {
      status: "online",
      lastSeenAt,
      appState,
      label: "Online now",
    };
  }

  // Active Today: Within 24 hours (regardless of app state)
  if (timeSinceActive <= ACTIVE_TODAY_THRESHOLD_MS) {
    return {
      status: "active_today",
      lastSeenAt,
      appState,
      label: "Active today",
    };
  }

  // Offline: More than 24 hours ago
  return {
    status: "offline",
    lastSeenAt,
    appState,
    label: "Offline",
  };
}

function hiddenPresenceInfo(): PresenceInfo {
  return {
    status: "offline",
    lastSeenAt: 0,
    appState: "inactive",
    label: "",
    isHidden: true,
  };
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Mark user as active in foreground.
 * Call this on app foreground and every 30 seconds while app is active.
 */
export const markActive = mutation({
  args: {
    token: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = user._id;
    const now = Date.now();

    // Find existing presence record for this user
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        appState: "foreground",
        deviceId: args.deviceId,
        updatedAt: now,
      });
    } else {
      // Create new presence record
      await ctx.db.insert("presence", {
        userId,
        deviceId: args.deviceId,
        lastSeenAt: now,
        appState: "foreground",
        createdAt: now,
        updatedAt: now,
      });
    }

    // BACKWARDS COMPATIBILITY: Also update users.lastActive for existing queries
    await ctx.db.patch(userId, {
      lastActive: now,
    });

    return { success: true, lastSeenAt: now };
  },
});

/**
 * Mark user as in background (app not visible but running).
 * Call this when AppState changes to 'background'.
 */
export const markBackground = mutation({
  args: {
    token: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = user._id;
    const now = Date.now();

    // Find existing presence record
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        appState: "background",
        deviceId: args.deviceId,
        updatedAt: now,
      });
    } else {
      // Create record in background state
      await ctx.db.insert("presence", {
        userId,
        deviceId: args.deviceId,
        lastSeenAt: now,
        appState: "background",
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Mark user as inactive (app closed or disconnected).
 * Call this when app is terminating or on explicit logout.
 */
export const markInactive = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);
    const userId = user._id;
    const now = Date.now();

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        appState: "inactive",
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Internal mutation: Expire stale presence records.
 * Called by cron job to mark users as inactive if no recent heartbeat.
 */
export const expireIfStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = now - STALE_THRESHOLD_MS;

    // Find all foreground users who haven't had a heartbeat recently
    const staleRecords = await ctx.db
      .query("presence")
      .withIndex("by_appState", (q) => q.eq("appState", "foreground"))
      .collect();

    let expiredCount = 0;
    for (const record of staleRecords) {
      if (record.lastSeenAt < staleThreshold) {
        await ctx.db.patch(record._id, {
          appState: "inactive",
          updatedAt: now,
        });
        expiredCount++;
      }
    }

    // Also expire background users after longer threshold (5 minutes)
    const backgroundStaleThreshold = now - 5 * 60 * 1000;
    const backgroundRecords = await ctx.db
      .query("presence")
      .withIndex("by_appState", (q) => q.eq("appState", "background"))
      .collect();

    for (const record of backgroundRecords) {
      if (record.lastSeenAt < backgroundStaleThreshold) {
        await ctx.db.patch(record._id, {
          appState: "inactive",
          updatedAt: now,
        });
        expiredCount++;
      }
    }

    return { expiredCount };
  },
});

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get presence status for a single user.
 * This is the SINGLE SOURCE OF TRUTH query for presence.
 */
export const getUserPresence = query({
  args: {
    userId: v.id("users"),
    respectPrivacy: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<PresenceInfo> => {
    if (args.respectPrivacy) {
      const privacyUser = await ctx.db.get(args.userId);
      if (privacyUser?.showLastSeen === false) {
        return hiddenPresenceInfo();
      }
    }

    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (!presence) {
      // No presence record - check users.lastActive for backwards compatibility
      const user = await ctx.db.get(args.userId);
      if (user?.lastActive) {
        return computePresenceStatus(user.lastActive, "inactive");
      }

      // Truly unknown - return offline
      return {
        status: "offline",
        lastSeenAt: 0,
        appState: "inactive",
        label: "Offline",
      };
    }

    return computePresenceStatus(presence.lastSeenAt, presence.appState);
  },
});

/**
 * Get presence status for multiple users (batch query for lists).
 * Efficient for Discover, Messages list, etc.
 */
export const getBatchPresence = query({
  args: {
    userIds: v.array(v.id("users")),
    respectPrivacy: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Record<string, PresenceInfo>> => {
    const result: Record<string, PresenceInfo> = {};

    // Batch query all presence records
    const presenceRecords = await Promise.all(
      args.userIds.map((userId) =>
        ctx.db
          .query("presence")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .first()
      )
    );

    const privacyUsers = args.respectPrivacy
      ? await Promise.all(args.userIds.map((userId) => ctx.db.get(userId)))
      : [];
    const privacyMap = new Map<string, Doc<"users"> | null>();
    args.userIds.forEach((userId, index) => {
      privacyMap.set(userId, privacyUsers[index] ?? null);
    });

    // For users without presence records, fall back to users.lastActive
    const usersWithoutPresence: Id<"users">[] = [];
    args.userIds.forEach((userId, index) => {
      if (!presenceRecords[index]) {
        usersWithoutPresence.push(userId);
      }
    });

    // Batch fetch users for fallback
    const fallbackUsers = await Promise.all(
      usersWithoutPresence.map((userId) => ctx.db.get(userId))
    );
    const fallbackMap = new Map<string, Doc<"users"> | null>();
    usersWithoutPresence.forEach((userId, index) => {
      fallbackMap.set(userId, fallbackUsers[index]);
    });

    // Build result map
    args.userIds.forEach((userId, index) => {
      const privacyUser = privacyMap.get(userId);
      if (args.respectPrivacy && privacyUser?.showLastSeen === false) {
        result[userId] = hiddenPresenceInfo();
        return;
      }

      const presence = presenceRecords[index];
      if (presence) {
        result[userId] = computePresenceStatus(
          presence.lastSeenAt,
          presence.appState
        );
      } else {
        const user = fallbackMap.get(userId);
        if (user?.lastActive) {
          result[userId] = computePresenceStatus(user.lastActive, "inactive");
        } else {
          result[userId] = {
            status: "offline",
            lastSeenAt: 0,
            appState: "inactive",
            label: "Offline",
          };
        }
      }
    });

    return result;
  },
});

/**
 * Get count of online users (for dashboard/analytics).
 */
export const getOnlineCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const now = Date.now();
    const threshold = now - ONLINE_NOW_THRESHOLD_MS;

    // Count foreground users with recent activity
    const onlineRecords = await ctx.db
      .query("presence")
      .withIndex("by_appState", (q) => q.eq("appState", "foreground"))
      .collect();

    return onlineRecords.filter((r) => r.lastSeenAt >= threshold).length;
  },
});
