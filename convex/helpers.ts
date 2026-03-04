import { Id } from "./_generated/dataModel";
import { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Convert Id<"users"> to string for legacy Phase-2 tables.
 * Convex IDs are strings internally; this is a type-safe wrapper.
 */
export function userIdToString(userId: Id<"users">): string {
  return userId as string;
}

/**
 * Convert string to Id<"users"> for Convex mutations.
 * Caller guarantees this string came from auth/user context.
 */
export function stringToUserId(userId: string): Id<"users"> {
  return userId as Id<"users">;
}

/**
 * IDENTITY MAPPING (READ-ONLY): Resolve authUserId to Convex user ID.
 *
 * USE THIS IN QUERIES - does NOT create users, only looks up existing records.
 *
 * Flow:
 * 1. If authUserId looks like a Convex Id, try direct lookup
 * 2. Otherwise, look up by demoUserId field
 * 3. Return Id<"users"> if found, null if not found
 *
 * @param ctx - Convex query or mutation context
 * @param authUserId - The auth identifier string (can be demo ID, Convex ID, or external ID)
 * @returns Id<"users"> | null - The Convex user ID if found, null otherwise
 */
export async function resolveUserIdByAuthId(
  ctx: QueryCtx | MutationCtx,
  authUserId: string
): Promise<Id<"users"> | null> {
  if (!authUserId || authUserId.trim().length === 0) {
    return null;
  }

  // FAST PATH: Try to use authUserId directly as a Convex ID
  try {
    const convexId = authUserId as Id<"users">;
    const existingUser = await ctx.db.get(convexId);
    if (existingUser) {
      return convexId;
    }
  } catch (error) {
    // Not a valid Convex ID format - fall through to string lookup
  }

  // DEMO/EXTERNAL ID PATH: Look up by demoUserId field
  const existingByDemoId = await ctx.db
    .query("users")
    .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", authUserId))
    .first();

  if (existingByDemoId) {
    return existingByDemoId._id;
  }

  // Not found
  return null;
}

/**
 * IDENTITY MAPPING (WRITE): Ensure Convex user record exists for authUserId.
 *
 * USE THIS IN MUTATIONS ONLY - creates user if not found.
 *
 * Flow:
 * 1. Try resolveUserIdByAuthId first
 * 2. If not found, create new user record with placeholder data
 * 3. Return Id<"users">
 *
 * This enables seamless transition from demo mode to production mode:
 * - Demo users get real Convex records created on first use
 * - Their photos persist in Convex backend even if they started in demo mode
 *
 * @param ctx - Convex MUTATION context (must support insert)
 * @param authUserId - The auth identifier string (can be demo ID, Convex ID, or external ID)
 * @returns Id<"users"> - The Convex user ID (existing or newly created)
 * @throws Error if authUserId is empty
 */
export async function ensureUserByAuthId(
  ctx: MutationCtx,
  authUserId: string
): Promise<Id<"users">> {
  if (!authUserId || authUserId.trim().length === 0) {
    throw new Error("authUserId cannot be empty");
  }

  // Try to resolve existing user first
  const existingUserId = await resolveUserIdByAuthId(ctx, authUserId);
  if (existingUserId) {
    return existingUserId;
  }

  // USER DOESN'T EXIST: Create new user with placeholder data
  console.log(`[ensureUserByAuthId] Creating new user for authUserId: ${authUserId}`);

  const now = Date.now();

  const newUserId = await ctx.db.insert("users", {
    demoUserId: authUserId,
    authProvider: "email", // Default placeholder
    name: "",
    dateOfBirth: "",
    gender: "other",
    bio: "",
    isVerified: false,
    emailVerified: false,
    lookingFor: ["male"], // Default placeholder
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
    notificationsEnabled: true,
    isActive: true,
    isBanned: false,
    onboardingCompleted: false,
    createdAt: now,
  });

  console.log(`[ensureUserByAuthId] Created user: ${newUserId} for authUserId: ${authUserId}`);

  return newUserId;
}
