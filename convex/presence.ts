/**
 * PRESENCE - User presence tracking
 *
 * Simple presence mutations for updating user's active status.
 * FIX: Frontend calls markActive/markBackground with { token }
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { validateSessionToken } from "./helpers";

async function upsertPresence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  userId: string,
  appState: "foreground" | "background",
  now: number,
) {
  const existing = await ctx.db
    .query("presence")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      lastSeenAt: now,
      appState,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("presence", {
    userId,
    lastSeenAt: now,
    appState,
    updatedAt: now,
  });
}

/**
 * Mark user as active (foreground heartbeat).
 * Updates user's lastActive timestamp.
 */
export const markActive = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // Resolve session token to userId
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      // Silent failure - don't throw, just return
      return { success: false };
    }

    // Update lastActive timestamp
    const now = Date.now();
    await ctx.db.patch(userId, {
      lastActive: now,
    });
    await upsertPresence(ctx, userId, "foreground", now);

    return { success: true };
  },
});

/**
 * Mark user as in background state.
 * Updates user's lastActive timestamp (same as active for now).
 * Could be extended to track background/foreground state if needed.
 */
export const markBackground = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // Resolve session token to userId
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      // Silent failure - don't throw, just return
      return { success: false };
    }

    // Update lastActive timestamp (could add background-specific logic later)
    const now = Date.now();
    await ctx.db.patch(userId, {
      lastActive: now,
    });
    await upsertPresence(ctx, userId, "background", now);

    return { success: true };
  },
});
