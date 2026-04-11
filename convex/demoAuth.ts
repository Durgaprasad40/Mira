/**
 * Demo Auth Backend - Convex mutations and queries for demo auth mode
 *
 * Provides stable demo user identity for local/dev testing.
 * Works with lib/demoAuth.ts frontend counterpart.
 *
 * FEATURES:
 * - Creates/retrieves stable demo user
 * - Demo user is pre-verified (email + face)
 * - Demo sessions are always valid
 * - Onboarding progress is persisted
 *
 * SAFETY:
 * - Only active when IS_DEV_MODE is true (NODE_ENV !== "production")
 * - Production builds will reject all demo auth operations
 *
 * REMOVAL:
 * - Delete this file
 * - Remove imports from convex/_generated/api.ts (auto-regenerated)
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// =============================================================================
// DEV MODE CHECK
// =============================================================================
// IMPORTANT: In Convex, NODE_ENV is NOT reliable for dev/prod detection.
// Convex runs all code in a production-like environment.
// Use the IS_DEV_DEPLOYMENT env var set via `npx convex env set IS_DEV_DEPLOYMENT true`
// This must be set on dev deployments only, NOT on production deployments.
// =============================================================================
const IS_DEV_MODE = process.env.IS_DEV_DEPLOYMENT === "true";

// Demo token prefix for identification
const DEMO_TOKEN_PREFIX = "demo_";

// Demo session expiry (30 days, same as real sessions)
const DEMO_SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Check if a token is a demo token.
 */
function isDemoToken(token: string): boolean {
  return token.startsWith(DEMO_TOKEN_PREFIX);
}

/**
 * Generate a stable demo token based on the demo user ID.
 * This ensures the same user always gets the same token.
 */
function generateDemoToken(demoUserId: string): string {
  return `${DEMO_TOKEN_PREFIX}${demoUserId}`;
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Login or create a demo user.
 *
 * In demo mode:
 * - Creates user if doesn't exist
 * - Reuses existing user if found
 * - Always succeeds (no password validation)
 * - User is pre-verified (email + face)
 */
export const loginOrCreateDemoUser = mutation({
  args: {
    email: v.string(),
    demoUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { email, demoUserId } = args;
    const now = Date.now();

    // SAFETY: Only allow in dev mode
    if (!IS_DEV_MODE) {
      console.error("[DEMO_AUTH] REJECTED - not in dev mode");
      return {
        success: false,
        message: "Demo auth is not available in production",
        userId: "",
        token: "",
        onboardingCompleted: false,
        isNewUser: false,
      };
    }

    console.log(`[DEMO_AUTH] loginOrCreateDemoUser: email=${email}, demoUserId=${demoUserId}`);

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if demo user already exists (by demoUserId or authUserId)
    let existingUser = await ctx.db
      .query("users")
      .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", demoUserId))
      .first();

    if (!existingUser) {
      // Also check by authUserId
      existingUser = await ctx.db
        .query("users")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", demoUserId))
        .first();
    }

    let userId: Id<"users">;
    let isNewUser = false;

    if (existingUser) {
      // Existing demo user found
      userId = existingUser._id;
      console.log(`[DEMO_AUTH] Found existing demo user: ${userId}`);

      // Update last active - DO NOT force verification status
      // Face verification should be completed by user via the face-verification screen
      await ctx.db.patch(userId, {
        lastActive: now,
        // Ensure demo user is always active and not banned
        isActive: true,
        isBanned: false,
        // Ensure email verification (but NOT face verification - let user complete step)
        emailVerified: true,
        emailVerifiedAt: existingUser.emailVerifiedAt || now,
        // DO NOT set faceVerificationStatus/isVerified here - preserve user's actual status
        // DEMO MODE: Ensure consent is set for photo upload
        consentAcceptedAt: existingUser.consentAcceptedAt || now,
      });
    } else {
      // Create new demo user with pre-verified status
      isNewUser = true;
      console.log(`[DEMO_AUTH] Creating new demo user for: ${normalizedEmail}`);

      userId = await ctx.db.insert("users", {
        // Identity fields
        // NOTE: Demo users are identified by demoUserId/authUserId fields, NOT by authProvider
        // authProvider is "email" since demo auth uses email input
        demoUserId: demoUserId,
        authUserId: demoUserId,
        email: normalizedEmail,
        authProvider: "email",

        // Basic info (will be filled during onboarding)
        name: "",
        dateOfBirth: "",
        gender: "other",
        bio: "",

        // DEMO MODE: Email pre-verified, but face verification NOT pre-done
        // User must go through face-verification screen and tap "Demo Approve"
        // This ensures the onboarding step is visible and actionable
        emailVerified: true,
        emailVerifiedAt: now,
        isVerified: false, // Will be set to true after face verification
        faceVerificationStatus: "unverified", // User must complete face verification step
        verificationStatus: "unverified",

        // DEMO MODE: Pre-accept consent for photo upload
        // This is required by photos.ts before allowing photo uploads
        consentAcceptedAt: now,

        // Preferences (defaults)
        lookingFor: ["female", "male"],
        relationshipIntent: [],
        activities: [],
        minAge: 18,
        maxAge: 50,
        maxDistance: 50,

        // Subscription (free tier with generous limits for testing)
        subscriptionTier: "free",
        incognitoMode: false,
        likesRemaining: 999,
        superLikesRemaining: 99,
        messagesRemaining: 999,
        rewindsRemaining: 99,
        boostsRemaining: 99,
        likesResetAt: now + 365 * 24 * 60 * 60 * 1000, // 1 year
        superLikesResetAt: now + 365 * 24 * 60 * 60 * 1000,
        messagesResetAt: now + 365 * 24 * 60 * 60 * 1000,

        // State
        lastActive: now,
        notificationsEnabled: true,
        isActive: true,
        isBanned: false,
        onboardingCompleted: false,
        createdAt: now,
      });

      console.log(`[DEMO_AUTH] Created demo user: ${userId}`);
    }

    // Generate stable demo token
    const token = generateDemoToken(demoUserId);

    // Check if demo session already exists
    let existingSession = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (existingSession) {
      // Update existing session
      await ctx.db.patch(existingSession._id, {
        expiresAt: now + DEMO_SESSION_EXPIRY_MS,
        lastActiveAt: now,
      });
      console.log(`[DEMO_AUTH] Updated existing demo session`);
    } else {
      // Create new demo session
      await ctx.db.insert("sessions", {
        userId,
        token,
        expiresAt: now + DEMO_SESSION_EXPIRY_MS,
        createdAt: now,
      });
      console.log(`[DEMO_AUTH] Created demo session`);
    }

    // Get current onboarding status
    const user = await ctx.db.get(userId);
    const onboardingCompleted = user?.onboardingCompleted ?? false;

    return {
      success: true,
      userId: userId as string,
      token,
      onboardingCompleted,
      isNewUser,
    };
  },
});

/**
 * Update demo user's basic info during onboarding.
 * Same as regular updateBasicInfo but works with demo token.
 */
export const updateDemoUserBasicInfo = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    gender: v.optional(
      v.union(
        v.literal("male"),
        v.literal("female"),
        v.literal("non_binary"),
        v.literal("other")
      )
    ),
    handle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!IS_DEV_MODE) {
      return { success: false, message: "Demo auth not available" };
    }

    if (!isDemoToken(args.token)) {
      return { success: false, message: "Not a demo token" };
    }

    // Find session by token
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { success: false, message: "Session not found" };
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return { success: false, message: "User not found" };
    }

    // Update user fields
    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.dateOfBirth !== undefined) updates.dateOfBirth = args.dateOfBirth;
    if (args.gender !== undefined) updates.gender = args.gender;
    // Handle is normalized to lowercase for uniqueness (consistent with production auth)
    // Display formatting should happen in the UI layer (capitalize first letter, etc.)
    if (args.handle !== undefined) updates.handle = args.handle.toLowerCase().trim();

    await ctx.db.patch(session.userId, updates);

    return { success: true };
  },
});

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Validate a demo session.
 * Demo sessions are always valid as long as:
 * - IS_DEV_MODE is true
 * - Token is a demo token
 * - Session exists in database
 */
export const validateDemoSession = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // SAFETY: Only allow in dev mode
    if (!IS_DEV_MODE) {
      return { valid: false, userId: null, onboardingCompleted: false };
    }

    if (!isDemoToken(token)) {
      return { valid: false, userId: null, onboardingCompleted: false };
    }

    // Find session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!session) {
      console.log("[DEMO_AUTH] validateDemoSession: session not found");
      return { valid: false, userId: null, onboardingCompleted: false };
    }

    // Get user
    const user = await ctx.db.get(session.userId);
    if (!user) {
      console.log("[DEMO_AUTH] validateDemoSession: user not found");
      return { valid: false, userId: null, onboardingCompleted: false };
    }

    return {
      valid: true,
      userId: session.userId as string,
      onboardingCompleted: user.onboardingCompleted ?? false,
    };
  },
});

/**
 * Get demo user's onboarding status.
 * Returns the same structure as users.getOnboardingStatus.
 */
export const getDemoOnboardingStatus = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;

    // SAFETY: Only allow in dev mode
    if (!IS_DEV_MODE) {
      return null;
    }

    if (!isDemoToken(token)) {
      return null;
    }

    // Find session
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!session) {
      return null;
    }

    const userId = session.userId;
    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Count normal profile photos (exclude verification_reference)
    const normalPhotos = await ctx.db
      .query("photos")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.neq(q.field("photoType"), "verification_reference"))
      .collect();

    // Get basic info
    const basicInfo = {
      name: user.name || user.onboardingDraft?.basicInfo?.name || null,
      nickname: user.handle || user.onboardingDraft?.basicInfo?.handle || null,
      dateOfBirth:
        user.dateOfBirth || user.onboardingDraft?.basicInfo?.dateOfBirth || null,
      gender: user.gender || user.onboardingDraft?.basicInfo?.gender || null,
    };

    // Count photos for status (reference photo + normal photos)
    const effectivePhotoCount =
      normalPhotos.length + (user.verificationReferencePhotoId ? 1 : 0);

    // Use ACTUAL user status - don't fake verification status
    // This ensures face-verification screen is shown when user hasn't verified
    const actualFaceStatus = user.faceVerificationStatus || "unverified";
    const actualFaceVerificationPassed = actualFaceStatus === "verified";
    const actualFaceVerificationPending = actualFaceStatus === "pending";

    const status = {
      // Basic info
      basicInfo,
      basicInfoComplete: !!(
        basicInfo.name &&
        basicInfo.dateOfBirth &&
        basicInfo.gender
      ),

      // Reference photo and face verification - use ACTUAL values
      referencePhotoExists: !!user.verificationReferencePhotoId,
      verificationReferencePhotoId: user.verificationReferencePhotoId || null,
      verificationReferencePhotoUrl: user.verificationReferencePhotoUrl || null,
      faceVerificationStatus: actualFaceStatus as "unverified" | "pending" | "verified" | "failed",
      faceVerificationPassed: actualFaceVerificationPassed,
      faceVerificationPending: actualFaceVerificationPending,

      // Photos
      normalPhotoCount: normalPhotos.length,
      // Minimum 2 photos required (reference + 1 additional)
      hasMinPhotos: effectivePhotoCount >= 2,

      // Onboarding state
      onboardingCompleted: user.onboardingCompleted ?? false,
      onboardingStep: user.onboardingStep || "basic_info",
      onboardingDraft: user.onboardingDraft || null,
    };

    return status;
  },
});

/**
 * Skip face verification for demo user.
 * Sets the user as verified without requiring actual verification.
 */
export const skipDemoFaceVerification = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    if (!IS_DEV_MODE) {
      return { success: false, message: "Demo auth not available" };
    }

    if (!isDemoToken(args.token)) {
      return { success: false, message: "Not a demo token" };
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { success: false, message: "Session not found" };
    }

    await ctx.db.patch(session.userId, {
      faceVerificationStatus: "verified",
      isVerified: true,
      verificationStatus: "verified",
    });

    console.log("[DEMO_AUTH] Skipped face verification for user:", session.userId);

    return { success: true };
  },
});

/**
 * Set demo reference photo.
 * Legacy helper retained for compatibility.
 * IMPORTANT: Do NOT overwrite an existing uploaded reference photo.
 * This mutation only marks verification as complete.
 */
export const setDemoReferencePhoto = mutation({
  args: {
    token: v.string(),
    photoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!IS_DEV_MODE) {
      return { success: false, message: "Demo auth not available" };
    }

    if (!isDemoToken(args.token)) {
      return { success: false, message: "Not a demo token" };
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { success: false, message: "Session not found" };
    }

    await ctx.db.patch(session.userId, {
      faceVerificationStatus: "verified",
      isVerified: true,
      verificationStatus: "verified",
    });

    console.log("[DEMO_AUTH] Preserved existing reference photo for user:", session.userId);

    return { success: true, photoId: null };
  },
});

/**
 * Ensure demo user has consent set.
 * This MUST be called before any photo upload operation.
 *
 * ROOT CAUSE FIX: When app resumes with existing demo session, validateDemoSession (query)
 * cannot update consentAcceptedAt. This mutation ensures consent is set before upload.
 */
export const ensureDemoUserConsent = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    if (!IS_DEV_MODE) {
      return { success: false, message: "Demo auth not available" };
    }

    if (!isDemoToken(args.token)) {
      return { success: false, message: "Not a demo token" };
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session) {
      return { success: false, message: "Session not found" };
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return { success: false, message: "User not found" };
    }

    // Set consent if not already set
    if (!user.consentAcceptedAt) {
      const now = Date.now();
      await ctx.db.patch(session.userId, {
        consentAcceptedAt: now,
      });
      console.log("[DEMO_AUTH] ensureDemoUserConsent: Set consent for user:", session.userId);
    } else {
      console.log("[DEMO_AUTH] ensureDemoUserConsent: Consent already set for user:", session.userId);
    }

    return { success: true };
  },
});
