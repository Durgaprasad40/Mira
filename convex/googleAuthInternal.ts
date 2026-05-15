import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_DISTANCE_KM,
  DEFAULT_MIN_AGE,
} from "../lib/discoveryDefaults";

// =============================================================================
// linkOrCreateGoogleSession — internal mutation.
//
// Called ONLY from `googleAuth.signInWithGoogleIdToken` AFTER the Google ID
// token has been verified server-side. This mutation does NOT verify anything;
// it MUST NOT be exposed as a public mutation. Convex's `internalMutation`
// keyword ensures it is only callable via `ctx.runMutation(internal.…)`.
//
// Responsibilities:
//   1. Find an existing user by Google `externalId`, OR
//   2. Find by Google-verified `email` and link the Google identity, OR
//   3. Create a placeholder user (onboarding fills the profile).
//   4. Insert a Mira `sessions` row using the same 64-char token format and
//      30-day TTL as every other session-creating path in this codebase.
// =============================================================================

// Same 64-char alphanumeric session-token format as `convex/auth.ts`.
function generateSessionToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const linkOrCreateGoogleSession = internalMutation({
  args: {
    externalId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { externalId, email, name }) => {
    const now = Date.now();

    // 1) Find by Google externalId (account already linked).
    let user = await ctx.db
      .query("users")
      .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
      .first();

    let isNewUser = false;

    if (user) {
      await ctx.db.patch(user._id, {
        lastActive: now,
        ...(user.emailVerified !== true
          ? { emailVerified: true, emailVerifiedAt: now }
          : {}),
      });
    } else {
      // 2) Find by email and link Google identity to that user.
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();

      if (byEmail) {
        await ctx.db.patch(byEmail._id, {
          externalId,
          authProvider: "google",
          emailVerified: true,
          emailVerifiedAt: now,
          lastActive: now,
        });
        user = byEmail;
      }
    }

    if (!user) {
      // 3) Create a new placeholder user. Onboarding fills the real profile.
      // Field set mirrors `getOrCreateUserByIdentity` in convex/auth.ts so we
      // stay schema-compatible and inherit the same free-tier defaults.
      const newUserId = await ctx.db.insert("users", {
        email,
        externalId,
        authProvider: "google",
        name: name || "",
        dateOfBirth: "",
        gender: "other",
        bio: "",
        isVerified: false,
        emailVerified: true,
        emailVerifiedAt: now,
        lookingFor: [],
        relationshipIntent: [],
        activities: [],
        minAge: DEFAULT_MIN_AGE,
        maxAge: DEFAULT_MAX_AGE,
        maxDistance: DEFAULT_MAX_DISTANCE_KM,
        subscriptionTier: "free",
        incognitoMode: false,
        likesRemaining: 10,
        superLikesRemaining: 1,
        messagesRemaining: 10,
        rewindsRemaining: 1,
        boostsRemaining: 0,
        likesResetAt: now,
        superLikesResetAt: now,
        messagesResetAt: now,
        lastActive: now,
        createdAt: now,
        notificationsEnabled: true,
        onboardingCompleted: false,
        isActive: true,
        isBanned: false,
      });
      const created = await ctx.db.get(newUserId);
      if (!created) {
        throw new Error("Failed to create user");
      }
      user = created;
      isNewUser = true;
    }

    // Posture matches `auth.validateSession`: refuse to mint a session for a
    // deactivated or banned account.
    if (user.isActive === false || user.isBanned === true) {
      throw new Error("Account is not active");
    }

    const token = generateSessionToken();
    await ctx.db.insert("sessions", {
      userId: user._id,
      token,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    });

    return {
      success: true as const,
      userId: user._id,
      token,
      isNewUser,
      onboardingCompleted: user.onboardingCompleted === true,
    };
  },
});
