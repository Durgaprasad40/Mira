/**
 * DEMO AUTH - Demo user authentication for demo mode
 *
 * Provides demo auth functions for local/dev testing.
 * Uses the same user creation pattern as convex/helpers.ts ensureUserByAuthId.
 *
 * Functions:
 * - loginOrCreateDemoUser: Create/login demo user
 * - validateDemoSession: Validate demo token
 * - getDemoOnboardingStatus: Get onboarding status
 * - ensureDemoUserConsent: Ensure consent is set
 */
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

/** Normalize email for demo-auth identity (index lookups). */
function normalizeDemoEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Deterministic per-email demo auth key (replaces single global stable id).
 * Keeps `by_auth_user_id` / `by_demo_user_id` unique per registered email.
 */
function deriveDemoAuthIdForEmail(normalizedEmail: string): string {
  let h = 5381;
  for (let i = 0; i < normalizedEmail.length; i++) {
    h = ((h << 5) + h) ^ normalizedEmail.charCodeAt(i);
  }
  const hex = (h >>> 0).toString(16);
  return `demo_auth_${hex}_${normalizedEmail.length}`;
}

/**
 * Find user by email for demo auth (normalized + legacy casing + legacy stable row).
 */
async function findDemoUserByEmail(
  ctx: MutationCtx,
  rawEmail: string,
): Promise<Doc<"users"> | null> {
  const normalized = normalizeDemoEmail(rawEmail);
  if (!normalized.includes("@")) {
    return null;
  }

  let user: Doc<"users"> | null = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", normalized))
    .first();

  if (!user) {
    const trimmed = rawEmail.trim();
    user = await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", trimmed))
      .first();
  }

  if (!user) {
    const legacy = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q: any) => q.eq("authUserId", "demo_user_stable_001"))
      .first();
    if (
      legacy &&
      legacy.email &&
      normalizeDemoEmail(legacy.email) === normalized
    ) {
      user = legacy;
    }
  }

  return user;
}

/**
 * Demo auth: login (existing email only) OR register (new email only).
 * - mode "login": NEVER creates a user; fails if no account for this email.
 * - mode "register": NEVER logs in; fails if email already exists; creates user.
 *
 * Called from lib/demoAuth.ts — replaces global stable demoUserId for identity.
 */
export const loginOrCreateDemoUser = mutation({
  args: {
    email: v.string(),
    mode: v.union(v.literal("login"), v.literal("register")),
  },
  handler: async (ctx, args) => {
    const rawEmail = args.email;
    const normalized = normalizeDemoEmail(rawEmail);
    const now = Date.now();

    if (!normalized.includes("@")) {
      return {
        success: false,
        message: "Please enter a valid email address.",
        code: "INVALID_EMAIL" as const,
        userId: "",
        token: "",
        onboardingCompleted: false,
        isNewUser: false,
      };
    }

    const existing = await findDemoUserByEmail(ctx, rawEmail);

    if (args.mode === "login") {
      if (!existing) {
        return {
          success: false,
          message:
            "No account found for this email. Create an account first or check the address.",
          code: "NO_ACCOUNT" as const,
          userId: "",
          token: "",
          onboardingCompleted: false,
          isNewUser: false,
        };
      }

      if (!existing.isActive || existing.isBanned || existing.deletedAt) {
        return {
          success: false,
          message: "This account cannot be used. Please contact support.",
          code: "ACCOUNT_BLOCKED" as const,
          userId: "",
          token: "",
          onboardingCompleted: false,
          isNewUser: false,
        };
      }

      await ctx.db.patch(existing._id, { lastActive: now });
      const token = `demo_${existing._id}`;
      return {
        success: true,
        message: "",
        code: undefined,
        userId: existing._id,
        token,
        onboardingCompleted: existing.onboardingCompleted ?? false,
        isNewUser: false,
      };
    }

    // register
    if (existing) {
      return {
        success: false,
        message:
          "An account with this email already exists. Sign in with “I already have an account”.",
        code: "EMAIL_EXISTS" as const,
        userId: "",
        token: "",
        onboardingCompleted: false,
        isNewUser: false,
      };
    }

    const authKey = deriveDemoAuthIdForEmail(normalized);

    const userId = await ctx.db.insert("users", {
      demoUserId: authKey,
      authUserId: authKey,
      authProvider: "email",
      email: normalized,

      name: "Demo User",
      dateOfBirth: "1995-01-15",
      gender: "male",
      bio: "Demo account for testing Mira features.",

      isVerified: true,
      emailVerified: true,

      lookingFor: ["female"],
      relationshipIntent: [],
      activities: [],
      minAge: 18,
      maxAge: 50,
      maxDistance: 50,

      subscriptionTier: "free",
      trialEndsAt: undefined,

      incognitoMode: false,

      likesRemaining: 50,
      superLikesRemaining: 1,
      messagesRemaining: 5,
      rewindsRemaining: 0,
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

    const user = await ctx.db.get(userId);
    if (!user) {
      return {
        success: false,
        message: "Failed to create demo user",
        code: "CREATE_FAILED" as const,
        userId: "",
        token: "",
        onboardingCompleted: false,
        isNewUser: false,
      };
    }

    const token = `demo_${user._id}`;
    return {
      success: true,
      message: "",
      code: undefined,
      userId: user._id,
      token,
      onboardingCompleted: user.onboardingCompleted ?? false,
      isNewUser: true,
    };
  },
});

/**
 * Helper to get user from demo token.
 * Returns null if token is invalid or user not found.
 */
async function getUserFromDemoToken(
  ctx: { db: { query: (table: "users") => any } },
  token: string
): Promise<Doc<"users"> | null> {
  // Demo tokens have format: demo_<userId>
  if (!token.startsWith("demo_")) {
    return null;
  }

  // Extract userId from token (everything after "demo_")
  const userId = token.substring(5);

  // Look up user by authUserId (the demo user ID stored in authUserId field)
  // Since we store demoUserId in authUserId, and tokens are demo_<convexId>,
  // we need to get the user directly by their _id
  try {
    // Query by the demoUserId to find the user
    const users = await ctx.db
      .query("users")
      .withIndex("by_demo_user_id", (q: any) => q.eq("demoUserId", userId))
      .take(1);

    if (users.length > 0) {
      return users[0];
    }

    // Also try by authUserId
    const usersByAuth = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q: any) => q.eq("authUserId", userId))
      .take(1);

    if (usersByAuth.length > 0) {
      return usersByAuth[0];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate a demo session token.
 * Called from lib/demoAuth.ts validateDemoSession().
 */
export const validateDemoSession = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // Demo tokens have format: demo_<userId>
    if (!token.startsWith("demo_")) {
      return {
        valid: false,
        userId: null,
        onboardingCompleted: false,
      };
    }

    // Extract the Convex ID portion (after "demo_")
    const convexIdPart = token.substring(5);

    // Query by authUserId (demo users have authUserId set)
    const users = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", convexIdPart))
      .take(1);

    // Also check by demoUserId
    let user = users.length > 0 ? users[0] : null;
    if (!user) {
      const usersByDemo = await ctx.db
        .query("users")
        .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", convexIdPart))
        .take(1);
      user = usersByDemo.length > 0 ? usersByDemo[0] : null;
    }

    if (!user) {
      return {
        valid: false,
        userId: null,
        onboardingCompleted: false,
      };
    }

    return {
      valid: true,
      userId: user._id,
      onboardingCompleted: user.onboardingCompleted ?? false,
    };
  },
});

/**
 * Get demo user's onboarding status.
 * Called from lib/demoAuth.ts getDemoOnboardingStatus().
 *
 * CRITICAL: Must return SAME structure as users.getOnboardingStatus for hydration to work!
 */
export const getDemoOnboardingStatus = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // Demo tokens have format: demo_<userId>
    if (!token.startsWith("demo_")) {
      return null;
    }

    // Extract the Convex ID portion
    const convexIdPart = token.substring(5);

    // Try direct lookup by _id first (token format is demo_<user._id>)
    let user: Doc<"users"> | null = null;
    try {
      user = await ctx.db.get(convexIdPart as Id<"users">);
    } catch {
      // Not a valid Convex ID format, try field lookups
    }

    // Fallback: Query by authUserId or demoUserId
    if (!user) {
      const usersByAuth = await ctx.db
        .query("users")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", convexIdPart))
        .first();
      user = usersByAuth;
    }
    if (!user) {
      const usersByDemo = await ctx.db
        .query("users")
        .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", convexIdPart))
        .first();
      user = usersByDemo;
    }

    if (!user) {
      return null;
    }

    // Count normal profile photos (exclude verification_reference)
    const normalPhotos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', user!._id))
      .filter((q) => q.neq(q.field('photoType'), 'verification_reference'))
      .collect();

    // Get basic info (same structure as getOnboardingStatus)
    const basicInfo = {
      name: user.name || user.onboardingDraft?.basicInfo?.name || null,
      nickname: user.handle || user.onboardingDraft?.basicInfo?.handle || null,
      dateOfBirth: user.dateOfBirth || user.onboardingDraft?.basicInfo?.dateOfBirth || null,
      gender: user.gender || user.onboardingDraft?.basicInfo?.gender || null,
    };

    // Calculate effective photo count
    const effectivePhotoCount = normalPhotos.length + (user.verificationReferencePhotoId ? 1 : 0);

    // Return SAME structure as users.getOnboardingStatus for hydration compatibility
    return {
      // Basic info
      basicInfo,
      basicInfoComplete: !!(basicInfo.name && basicInfo.dateOfBirth && basicInfo.gender),

      // Verification status
      referencePhotoExists: !!user.verificationReferencePhotoId,
      verificationReferencePhotoId: user.verificationReferencePhotoId || null,
      verificationReferencePhotoUrl: user.verificationReferencePhotoUrl || null,
      faceVerificationStatus: user.faceVerificationStatus || 'unverified',
      faceVerificationPassed: user.faceVerificationStatus === 'verified',
      faceVerificationPending: user.faceVerificationStatus === 'pending',

      // Photos
      normalPhotoCount: normalPhotos.length,
      hasMinPhotos: effectivePhotoCount >= 2,

      // Onboarding state
      onboardingCompleted: user.onboardingCompleted || false,
      onboardingDraft: user.onboardingDraft || null,

      // Phase-2 state
      phase2OnboardingCompleted: user.phase2OnboardingCompleted || false,
      privateWelcomeConfirmed: user.privateWelcomeConfirmed || false,
    };
  },
});

/**
 * Ensure demo user has consent set for photo uploads.
 * Called from lib/demoAuth.ts ensureDemoUserConsent().
 *
 * CRITICAL: Must write consentAcceptedAt field which is checked by
 * photos:uploadVerificationReferencePhoto (line 777: if (!user.consentAcceptedAt))
 */
export const ensureDemoUserConsent = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // Demo tokens have format: demo_<userId> where userId is the Convex document _id
    if (!token.startsWith("demo_")) {
      console.log("[DEMO_AUTH] ensureDemoUserConsent: Invalid token format (not demo_)");
      return { success: false };
    }

    // Extract the Convex document ID from token
    const convexIdPart = token.substring(5);
    let userId: Id<"users"> | null = null;

    // Direct lookup by _id (token contains user._id, not authUserId/demoUserId)
    try {
      const user = await ctx.db.get(convexIdPart as Id<"users">);
      if (user) {
        userId = user._id;
      }
    } catch (error) {
      // Not a valid Convex ID format - fall through to field lookup
    }

    // Fallback: try by authUserId/demoUserId in case of old tokens
    if (!userId) {
      console.log("[DEMO_AUTH] ensureDemoUserConsent: User not found by _id, trying fallback");
      const usersByAuth = await ctx.db
        .query("users")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", convexIdPart))
        .take(1);
      if (usersByAuth.length > 0) {
        userId = usersByAuth[0]._id;
      } else {
        const usersByDemo = await ctx.db
          .query("users")
          .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", convexIdPart))
          .take(1);
        if (usersByDemo.length > 0) {
          userId = usersByDemo[0]._id;
        }
      }
    }

    if (!userId) {
      console.log("[DEMO_AUTH] ensureDemoUserConsent: User not found by any method");
      return { success: false };
    }

    // CRITICAL FIX: Actually write consentAcceptedAt if not already set
    // This is the field checked by photos:uploadVerificationReferencePhoto
    const user = await ctx.db.get(userId);
    if (!user) {
      console.log("[DEMO_AUTH] ensureDemoUserConsent: User disappeared after lookup");
      return { success: false };
    }

    if (!user.consentAcceptedAt) {
      const now = Date.now();
      await ctx.db.patch(userId, { consentAcceptedAt: now });
      console.log(`[DEMO_AUTH] ensureDemoUserConsent: Set consentAcceptedAt=${now} for user=${userId}`);
    } else {
      console.log(`[DEMO_AUTH] ensureDemoUserConsent: consentAcceptedAt already set for user=${userId}`);
    }

    return { success: true };
  },
});

/**
 * Update demo user's basic info after registration.
 * Called from app/(onboarding)/basic-info.tsx during demo registration.
 */
export const updateDemoUserBasicInfo = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    dateOfBirth: v.string(),
    gender: v.union(
      v.literal("male"),
      v.literal("female"),
      v.literal("non_binary"),
      v.literal("lesbian"),
      v.literal("other")
    ),
    handle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, name, dateOfBirth, gender, handle } = args;

    // Demo tokens have format: demo_<userId>
    if (!token.startsWith("demo_")) {
      return { success: false, message: "Invalid demo token" };
    }

    // Extract the Convex ID portion (this is the actual user _id)
    const convexIdPart = token.substring(5);

    // Try to get the user directly by _id first
    let user: Doc<"users"> | null = null;
    try {
      const maybeUser = await ctx.db.get(convexIdPart as Id<"users">);
      if (maybeUser && "name" in maybeUser) {
        user = maybeUser as Doc<"users">;
      }
    } catch {
      // Not a valid ID format, try other lookups
    }

    // Fallback: Query by authUserId
    if (!user) {
      const users = await ctx.db
        .query("users")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", convexIdPart))
        .take(1);
      user = users.length > 0 ? users[0] : null;
    }

    // Fallback: Query by demoUserId
    if (!user) {
      const usersByDemo = await ctx.db
        .query("users")
        .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", convexIdPart))
        .take(1);
      user = usersByDemo.length > 0 ? usersByDemo[0] : null;
    }

    if (!user) {
      return { success: false, message: "Demo user not found" };
    }

    // Update the user's basic info
    await ctx.db.patch(user._id, {
      name,
      dateOfBirth,
      gender,
      handle: handle || undefined,
      lastActive: Date.now(),
    });

    return { success: true };
  },
});
