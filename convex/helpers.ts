import { Id, Doc } from "./_generated/dataModel";
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
 * Pick the primary user from a list of candidates (earliest createdAt).
 * Used for deduplication when multiple users have the same demoUserId.
 */
function pickPrimaryUser(users: Doc<"users">[]): Doc<"users"> {
  if (users.length === 1) return users[0];

  // Sort by createdAt (or _creationTime as fallback), ascending
  return users.sort((a, b) => {
    const aTime = a.createdAt ?? a._creationTime;
    const bTime = b.createdAt ?? b._creationTime;
    return aTime - bTime;
  })[0];
}

/**
 * IDENTITY MAPPING (READ-ONLY): Resolve authUserId to Convex user ID.
 *
 * USE THIS IN QUERIES - does NOT create users, only looks up existing records.
 * If multiple users exist with the same demoUserId (race condition), returns the primary (earliest).
 *
 * Flow:
 * 1. If authUserId looks like a Convex Id, try direct lookup
 * 2. Otherwise, look up by demoUserId field (handles duplicates by picking earliest)
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
  // Fetch up to 10 matches to handle potential duplicates from race conditions
  const matchingUsers = await ctx.db
    .query("users")
    .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", authUserId))
    .take(10);

  if (matchingUsers.length === 0) {
    return null;
  }

  // If multiple matches, pick the primary (earliest createdAt)
  // NOTE: Queries are read-only, so we cannot patch duplicates here
  const primary = pickPrimaryUser(matchingUsers);
  return primary._id;
}

/**
 * IDENTITY MAPPING (WRITE): Ensure Convex user record exists for authUserId.
 *
 * USE THIS IN MUTATIONS ONLY - creates user if not found.
 * Handles race conditions by soft-disabling duplicates (sets isActive=false, duplicateOf=primary._id).
 *
 * Flow:
 * 1. Query all users with matching demoUserId
 * 2. If found: pick primary (earliest), soft-disable duplicates, return primary._id
 * 3. If not found: insert new user, then re-query to handle race, return primary._id
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

  // FAST PATH: Try to use authUserId directly as a Convex ID
  try {
    const convexId = authUserId as Id<"users">;
    const existingUser = await ctx.db.get(convexId);
    if (existingUser) {
      return convexId;
    }
  } catch (error) {
    // Not a valid Convex ID format - fall through to demoUserId lookup
  }

  // Query all users with matching demoUserId
  const matchingUsers = await ctx.db
    .query("users")
    .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", authUserId))
    .take(10);

  // If users exist, pick primary and soft-disable duplicates
  if (matchingUsers.length > 0) {
    const primary = pickPrimaryUser(matchingUsers);

    // Soft-disable duplicates (if any)
    if (matchingUsers.length > 1) {
      console.warn(`[DEDUP] Found duplicate users for demoUserId: ${authUserId}`, {
        primary: primary._id,
        dupCount: matchingUsers.length - 1,
      });

      for (const user of matchingUsers) {
        if (user._id !== primary._id && !user.duplicateOf) {
          await ctx.db.patch(user._id, {
            isActive: false,
            duplicateOf: primary._id,
          });
        }
      }
    }

    return primary._id;
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

  // RACE CONDITION HANDLING: Re-query after insert to detect concurrent inserts
  const postInsertUsers = await ctx.db
    .query("users")
    .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", authUserId))
    .take(10);

  if (postInsertUsers.length > 1) {
    // Race detected: pick primary and soft-disable others
    const primary = pickPrimaryUser(postInsertUsers);

    console.warn(`[DEDUP] Race condition detected for demoUserId: ${authUserId}`, {
      primary: primary._id,
      dupCount: postInsertUsers.length - 1,
    });

    for (const user of postInsertUsers) {
      if (user._id !== primary._id && !user.duplicateOf) {
        await ctx.db.patch(user._id, {
          isActive: false,
          duplicateOf: primary._id,
        });
      }
    }

    return primary._id;
  }

  console.log(`[ensureUserByAuthId] Created user: ${newUserId} for authUserId: ${authUserId}`);
  return newUserId;
}
