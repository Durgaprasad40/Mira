import { MutationCtx, QueryCtx, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

/**
 * Admin action types for audit logging.
 */
export type AdminAction =
  | "verify_approve"
  | "verify_reject"
  | "set_admin"
  | "deactivate"
  | "reactivate"
  | "soft_delete";

/**
 * Parameters for logging an admin action.
 */
interface LogAdminActionParams {
  adminUserId: Id<"users">;
  action: AdminAction;
  targetUserId?: Id<"users">;
  conversationId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log an admin action to the audit trail.
 *
 * IMPORTANT: This function never throws. Logging failures are silently
 * caught to ensure they never block primary mutations.
 *
 * @param ctx - Mutation context
 * @param params - Log parameters
 */
export async function logAdminAction(
  ctx: MutationCtx,
  params: LogAdminActionParams
): Promise<void> {
  try {
    await ctx.db.insert("adminLogs", {
      adminUserId: params.adminUserId,
      action: params.action,
      targetUserId: params.targetUserId,
      conversationId: params.conversationId,
      reason: params.reason,
      metadata: params.metadata,
      createdAt: Date.now(),
    });
  } catch (error) {
    // Never throw - logging must not break primary flow
    if (process.env.NODE_ENV !== "production") {
      console.warn("[AdminLog] Failed to write audit log:", error);
    }
  }
}

/**
 * Validate admin access from session token.
 * Returns the admin user if valid, throws if unauthorized.
 */
async function requireAdmin(ctx: QueryCtx, token: string) {
  const now = Date.now();

  // Look up session by token
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();

  if (!session || session.expiresAt < now) {
    throw new Error("Unauthorized: Invalid or expired session");
  }

  // Get user and verify admin status
  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive || user.isBanned) {
    throw new Error("Unauthorized: Invalid user");
  }

  // Check if session was revoked
  if (user.sessionsRevokedAt && session.createdAt < user.sessionsRevokedAt) {
    throw new Error("Unauthorized: Session revoked");
  }

  // Verify admin privilege
  if (!user.isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  return user;
}

// Allowlist of valid action types for filtering
const ALLOWED_ACTIONS: readonly string[] = [
  "verify_approve",
  "verify_reject",
  "set_admin",
  "deactivate",
  "reactivate",
  "soft_delete",
] as const;

/**
 * Get admin logs for the audit trail.
 * Requires admin access via valid session token.
 */
export const getAdminLogs = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    action: v.optional(v.string()),
    adminUserId: v.optional(v.id("users")),
    targetUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { token, adminUserId, targetUserId } = args;

    // Hard cap: default 50, max 100
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

    // Validate action filter against allowlist (ignore invalid values)
    const action = args.action && ALLOWED_ACTIONS.includes(args.action)
      ? args.action
      : undefined;

    // Admin gate: verify session token belongs to an admin
    await requireAdmin(ctx, token);

    let logs;

    // Use appropriate index based on filters
    if (adminUserId) {
      // Filter by admin who performed the action
      logs = await ctx.db
        .query("adminLogs")
        .withIndex("by_admin_createdAt", (q) => q.eq("adminUserId", adminUserId))
        .order("desc")
        .take(limit);
    } else if (targetUserId) {
      // Filter by target user
      logs = await ctx.db
        .query("adminLogs")
        .withIndex("by_target_createdAt", (q) => q.eq("targetUserId", targetUserId))
        .order("desc")
        .take(limit);
    } else if (action) {
      // Filter by action type (validated against allowlist)
      logs = await ctx.db
        .query("adminLogs")
        .withIndex("by_action_createdAt", (q) => q.eq("action", action))
        .order("desc")
        .take(limit);
    } else {
      // No filter - get newest logs using by_createdAt index
      logs = await ctx.db
        .query("adminLogs")
        .withIndex("by_createdAt")
        .order("desc")
        .take(limit);
    }

    // Map to safe output format (no extra PII)
    return logs.map((log) => ({
      id: log._id,
      createdAt: log.createdAt,
      action: log.action,
      adminUserId: log.adminUserId,
      targetUserId: log.targetUserId,
      reason: log.reason,
      metadata: log.metadata,
    }));
  },
});
