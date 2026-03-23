import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============================================================================
// DEV-ONLY: Reset utilities for development and testing
//
// SECURITY GATES (both required):
// 1. DEV_RESET_ENABLED env var must be "true"
// 2. DEV_RESET_TOKEN env var must match the provided token
//
// WARNING: These functions permanently delete data. Only use in development.
// ============================================================================

/**
 * Validate that dev reset is enabled and token is correct.
 * Throws "Unauthorized" if either check fails.
 */
function validateAccess(providedToken: string): void {
  // Gate 1: Check if dev reset is enabled
  const isEnabled = process.env.DEV_RESET_ENABLED;
  if (isEnabled !== "true") {
    throw new Error("Unauthorized: DEV_RESET_ENABLED is not set to 'true'");
  }

  // Gate 2: Validate token
  const expectedToken = process.env.DEV_RESET_TOKEN;
  if (!expectedToken) {
    throw new Error("Unauthorized: DEV_RESET_TOKEN not configured");
  }

  if (providedToken !== expectedToken) {
    throw new Error("Unauthorized: Invalid token");
  }
}

/**
 * Delete test users by email addresses.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DELETES:
 * - User record from `users` table
 * - All sessions associated with that user from `sessions` table
 *
 * USAGE:
 * npx convex run devReset:deleteUsersByEmail '{"token":"YOUR_TOKEN","emails":["test@example.com"]}'
 */
export const deleteUsersByEmail = mutation({
  args: {
    token: v.string(),
    emails: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const { emails } = args;
    const results: Array<{
      email: string;
      found: boolean;
      userId?: string;
      sessionsDeleted?: number;
      error?: string;
    }> = [];

    for (const email of emails) {
      try {
        const normalizedEmail = email.trim().toLowerCase();

        // Try to find user with normalized (lowercase) email first
        let user = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
          .unique();

        // Fallback: try exact original email if normalized didn't match
        if (!user && normalizedEmail !== email.trim()) {
          user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email.trim()))
            .unique();
        }

        if (!user) {
          results.push({
            email,
            found: false,
          });
          continue;
        }

        // Delete all sessions for this user
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        for (const session of sessions) {
          await ctx.db.delete(session._id);
        }

        // Delete the user
        await ctx.db.delete(user._id);

        results.push({
          email,
          found: true,
          userId: user._id,
          sessionsDeleted: sessions.length,
        });
      } catch (error: any) {
        results.push({
          email,
          found: false,
          error: error.message || "Unknown error",
        });
      }
    }

    return {
      success: true,
      message: `Processed ${emails.length} email(s)`,
      results,
    };
  },
});

/**
 * Delete a user by their Convex user ID.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DELETES:
 * - All sessions associated with that user from `sessions` table
 * - User record from `users` table
 *
 * USAGE:
 * npx convex run devReset:deleteUserById '{"token":"YOUR_TOKEN","userId":"abc123..."}'
 */
export const deleteUserById = mutation({
  args: {
    token: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const { userId } = args;

    try {
      // Cast string to Id<"users">
      const userIdTyped = userId as Id<"users">;

      // Check if user exists
      const user = await ctx.db.get(userIdTyped);
      if (!user) {
        return {
          success: false,
          error: "User not found",
          userId,
          sessionsDeleted: 0,
        };
      }

      // Delete all sessions for this user
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", userIdTyped))
        .collect();

      for (const session of sessions) {
        await ctx.db.delete(session._id);
      }

      // Delete the user
      await ctx.db.delete(userIdTyped);

      return {
        success: true,
        userId,
        sessionsDeleted: sessions.length,
      };
    } catch (error: any) {
      return {
        success: false,
        userId,
        sessionsDeleted: 0,
        error: error.message || "Unknown error",
      };
    }
  },
});

/**
 * List all users (DEV only) - useful for debugging.
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 */
export const listAllUsers = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const users = await ctx.db.query("users").collect();

    return users.map((u) => ({
      id: u._id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      onboardingCompleted: u.onboardingCompleted,
      _creationTime: u._creationTime,
    }));
  },
});

// ============================================================================
// PHASE-2 ONBOARDING DEBUG UTILITIES
// ============================================================================

/**
 * List all users with their Phase-2 onboarding status (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * RETURNS for each user:
 * - userId, authId, name, phone, email
 * - phase2OnboardingCompleted flag
 * - privateProfile exists (boolean)
 * - privateProfileId (if exists)
 * - timestamps
 *
 * USAGE:
 * npx convex run devReset:listUsersWithPhase2Status '{"token":"YOUR_TOKEN"}'
 */
export const listUsersWithPhase2Status = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const users = await ctx.db.query("users").collect();

    const results = await Promise.all(
      users.map(async (user) => {
        // Check if privateProfile exists for this user
        const privateProfile = await ctx.db
          .query("userPrivateProfiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first();

        return {
          userId: user._id,
          authUserId: user.authUserId || null,
          name: user.name || null,
          phone: user.phone || null,
          email: user.email || null,
          phase2OnboardingCompleted: user.phase2OnboardingCompleted || false,
          phase2OnboardingCompletedAt: user.phase2OnboardingCompletedAt || null,
          hasPrivateProfile: !!privateProfile,
          privateProfileId: privateProfile?._id || null,
          privateProfileCreatedAt: privateProfile?.createdAt || null,
          privateProfileUpdatedAt: privateProfile?.updatedAt || null,
          userCreatedAt: user._creationTime,
        };
      })
    );

    // Sort: users with Phase-2 completed first, then by creation time desc
    results.sort((a, b) => {
      if (a.phase2OnboardingCompleted !== b.phase2OnboardingCompleted) {
        return a.phase2OnboardingCompleted ? -1 : 1;
      }
      return (b.userCreatedAt || 0) - (a.userCreatedAt || 0);
    });

    return {
      total: results.length,
      phase2Completed: results.filter((r) => r.phase2OnboardingCompleted).length,
      withPrivateProfile: results.filter((r) => r.hasPrivateProfile).length,
      users: results,
    };
  },
});

/**
 * Reset Phase-2 onboarding for a specific user (DEV only).
 *
 * SECURITY: Requires DEV_RESET_ENABLED="true" AND valid DEV_RESET_TOKEN.
 *
 * WHAT IT DOES:
 * - Sets users.phase2OnboardingCompleted = false
 * - Sets users.phase2OnboardingCompletedAt = null
 * - Deletes the userPrivateProfiles record if it exists
 *
 * WARNING: This allows the user to go through Phase-2 onboarding again.
 *
 * USAGE:
 * npx convex run devReset:resetPhase2ForUser '{"token":"YOUR_TOKEN","userId":"abc123..."}'
 */
export const resetPhase2ForUser = mutation({
  args: {
    token: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // SECURITY GATE
    validateAccess(args.token);

    const { userId } = args;

    try {
      // Cast string to Id<"users">
      const userIdTyped = userId as Id<"users">;

      // Check if user exists
      const user = await ctx.db.get(userIdTyped);
      if (!user) {
        return {
          success: false,
          error: "User not found",
          userId,
        };
      }

      // 1. Reset Phase-2 flags on user record
      await ctx.db.patch(userIdTyped, {
        phase2OnboardingCompleted: false,
        phase2OnboardingCompletedAt: undefined,
      });

      // 2. Delete privateProfile if exists
      const privateProfile = await ctx.db
        .query("userPrivateProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userIdTyped))
        .first();

      let privateProfileDeleted = false;
      if (privateProfile) {
        // Delete any blurred photos from storage first
        if (privateProfile.privatePhotosBlurred) {
          for (const storageId of privateProfile.privatePhotosBlurred) {
            try {
              await ctx.storage.delete(storageId);
            } catch {
              // Storage item may already be deleted
            }
          }
        }
        await ctx.db.delete(privateProfile._id);
        privateProfileDeleted = true;
      }

      return {
        success: true,
        userId,
        userName: user.name || "Unknown",
        phase2FlagReset: true,
        privateProfileDeleted,
        privateProfileId: privateProfile?._id || null,
      };
    } catch (error: any) {
      return {
        success: false,
        userId,
        error: error.message || "Unknown error",
      };
    }
  },
});
