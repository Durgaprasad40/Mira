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
 * Used for deduplication when multiple users have the same authUserId/demoUserId.
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
 * If multiple users exist with the same authUserId (race condition), returns the primary (earliest).
 *
 * Flow:
 * 1. If authUserId looks like a Convex Id, try direct lookup
 * 2. Query by authUserId field (preferred, new index)
 * 3. Fallback: Query by demoUserId field (legacy compatibility)
 * 4. Return Id<"users"> if found, null if not found
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
    // Not a valid Convex ID format - fall through to field lookup
  }

  // PRIMARY PATH: Query by authUserId field (new dedicated index)
  const byAuthUserId = await ctx.db
    .query("users")
    .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
    .take(10);

  if (byAuthUserId.length > 0) {
    const primary = pickPrimaryUser(byAuthUserId);
    return primary._id;
  }

  // FALLBACK PATH: Query by demoUserId field (legacy compatibility)
  const byDemoUserId = await ctx.db
    .query("users")
    .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", authUserId))
    .take(10);

  if (byDemoUserId.length > 0) {
    const primary = pickPrimaryUser(byDemoUserId);
    return primary._id;
  }

  // Not found
  return null;
}

/**
 * IDENTITY MAPPING (WRITE): Ensure Convex user record exists for authUserId.
 *
 * USE THIS IN MUTATIONS ONLY - creates user if not found.
 * Handles race conditions by soft-disabling duplicates (sets isActive=false, duplicateOf=primary._id).
 * Ensures primary user has authUserId field set (migrates legacy demoUserId-only records).
 *
 * Flow:
 * 1. Try Convex ID fast path
 * 2. Query by authUserId; if found, pick primary, soft-disable duplicates, ensure authUserId set
 * 3. Fallback: Query by demoUserId (legacy); if found, migrate authUserId, soft-disable duplicates
 * 4. If none found: insert new user with BOTH demoUserId and authUserId set
 * 5. Post-insert: re-query by authUserId for race handling
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
    // Not a valid Convex ID format - fall through to field lookup
  }

  // PRIMARY PATH: Query by authUserId field
  const byAuthUserId = await ctx.db
    .query("users")
    .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
    .take(10);

  if (byAuthUserId.length > 0) {
    const primary = pickPrimaryUser(byAuthUserId);

    // Soft-disable duplicates (if any)
    if (byAuthUserId.length > 1) {
      console.warn(`[DEDUP] Found duplicate users for authUserId: ${authUserId}`, {
        primary: primary._id,
        dupCount: byAuthUserId.length - 1,
      });

      for (const user of byAuthUserId) {
        if (user._id !== primary._id && !user.duplicateOf) {
          await ctx.db.patch(user._id, {
            isActive: false,
            duplicateOf: primary._id,
          });
        }
      }
    }

    // Ensure primary has authUserId set (should already be set, but defensive)
    if (!primary.authUserId) {
      await ctx.db.patch(primary._id, { authUserId });
    }

    return primary._id;
  }

  // FALLBACK PATH: Query by demoUserId field (legacy compatibility)
  const byDemoUserId = await ctx.db
    .query("users")
    .withIndex("by_demo_user_id", (q) => q.eq("demoUserId", authUserId))
    .take(10);

  if (byDemoUserId.length > 0) {
    const primary = pickPrimaryUser(byDemoUserId);

    // Migrate: ensure primary has authUserId set
    if (!primary.authUserId) {
      await ctx.db.patch(primary._id, { authUserId });
      console.log(`[MIGRATE] Set authUserId on legacy user: ${primary._id}`);
    }

    // Soft-disable duplicates (if any)
    if (byDemoUserId.length > 1) {
      console.warn(`[DEDUP] Found duplicate users for demoUserId: ${authUserId}`, {
        primary: primary._id,
        dupCount: byDemoUserId.length - 1,
      });

      for (const user of byDemoUserId) {
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
  // Set BOTH demoUserId (legacy compatibility) and authUserId (new)
  console.log(`[ensureUserByAuthId] Creating new user for authUserId: ${authUserId}`);

  const now = Date.now();

  const newUserId = await ctx.db.insert("users", {
    demoUserId: authUserId,  // Legacy field (backward compatibility)
    authUserId: authUserId,  // New dedicated field
    authProvider: "email",   // Default placeholder
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

  // RACE CONDITION HANDLING: Re-query by authUserId after insert
  const postInsertUsers = await ctx.db
    .query("users")
    .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
    .take(10);

  if (postInsertUsers.length > 1) {
    // Race detected: pick primary and soft-disable others
    const primary = pickPrimaryUser(postInsertUsers);

    console.warn(`[DEDUP] Race condition detected for authUserId: ${authUserId}`, {
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

/**
 * Validate session token and return the authenticated user ID.
 * Uses session table to verify token is valid, not expired, and not revoked.
 *
 * @param ctx - Convex query or mutation context
 * @param token - Session token to validate
 * @returns userId if valid, null if invalid/expired/revoked
 */
export async function validateSessionToken(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<Id<"users"> | null> {
  const now = Date.now();

  const session = await ctx.db
    .query('sessions')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();

  if (!session) return null;
  if (session.expiresAt < now) return null;
  if (session.revokedAt) return null;

  const user = await ctx.db.get(session.userId);
  if (!user) return null;
  if (!user.isActive) return null;
  if (user.deletedAt) return null;
  // APP-P1-004 FIX: Deny session for banned users
  if (user.isBanned) return null;

  // Check mass session revocation
  if (user.sessionsRevokedAt && session.createdAt < user.sessionsRevokedAt) {
    return null;
  }

  return session.userId;
}

/**
 * Resolve the currently authenticated user from a trusted server-side identity.
 * Accepts either:
 * - a validated session token (primary path for this app), or
 * - Convex auth identity subject (fallback for future auth integrations)
 *
 * If authUserId is also provided, it must resolve to the same user or the
 * request is rejected.
 */
export async function resolveTrustedUserId(
  ctx: QueryCtx | MutationCtx,
  {
    token,
    authUserId,
  }: {
    token?: string | null;
    authUserId?: string | null;
  }
): Promise<Id<"users"> | null> {
  let trustedUserId: Id<"users"> | null = null;

  const trimmedToken = token?.trim();
  if (trimmedToken) {
    trustedUserId = await validateSessionToken(ctx, trimmedToken);
  } else {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      trustedUserId = await resolveUserIdByAuthId(ctx, identity.subject);
    }
  }

  if (!trustedUserId) {
    return null;
  }

  const trimmedAuthUserId = authUserId?.trim();
  if (!trimmedAuthUserId) {
    return trustedUserId;
  }

  const claimedUserId = await resolveUserIdByAuthId(ctx, trimmedAuthUserId);
  if (!claimedUserId || claimedUserId !== trustedUserId) {
    return null;
  }

  return trustedUserId;
}

/**
 * Resolve the current user from trusted auth and fail closed when missing.
 * Explore and other client-callable reads should use this instead of
 * trusting caller-supplied IDs.
 */
export async function getTrustedUserId(
  ctx: QueryCtx | MutationCtx,
  auth: {
    token?: string | null;
    authUserId?: string | null;
  },
  errorMessage = 'Unauthorized: authentication required'
): Promise<Id<'users'>> {
  const userId = await resolveTrustedUserId(ctx, auth);
  if (!userId) {
    throw new Error(errorMessage);
  }

  return userId;
}

/**
 * Backward-compatible Convex-auth helper for callers that rely on
 * authenticated identity rather than app session tokens.
 */
export async function requireAuthenticatedUserId(
  ctx: QueryCtx | MutationCtx,
  errorMessage = 'Unauthorized: authentication required'
): Promise<Id<'users'>> {
  const identity = await ctx.auth.getUserIdentity();
  const authUserId = identity?.subject?.trim();

  if (!authUserId) {
    throw new Error(errorMessage);
  }

  const userId = await resolveUserIdByAuthId(ctx, authUserId);
  if (!userId) {
    throw new Error(errorMessage);
  }

  const user = await ctx.db.get(userId);
  if (!user || !user.isActive || !!user.deletedAt || !!user.isBanned) {
    throw new Error(errorMessage);
  }

  return userId;
}

/**
 * Resolve the authenticated session user from a validated session token.
 * Shared by endpoints that need the full user document after auth.
 */
export async function requireAuthenticatedSessionUser(
  ctx: QueryCtx | MutationCtx,
  token: string,
  errorMessage = 'Unauthorized: invalid or expired session'
): Promise<Doc<'users'>> {
  const userId = await validateSessionToken(ctx, token);
  if (!userId) {
    throw new Error(errorMessage);
  }

  const user = await ctx.db.get(userId);
  if (!user || !user.isActive || !!user.deletedAt || !!user.isBanned) {
    throw new Error(errorMessage);
  }

  return user;
}
