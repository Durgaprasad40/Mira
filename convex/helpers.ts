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
 * Supports:
 * - Regular session tokens (rows in `sessions` table)
 * - Demo auth tokens (`demo_<userId>`) from `convex/demoAuth.ts` — these are NOT
 *   inserted into `sessions`; same contract as `photos.ts` validateSessionToken.
 *
 * @param ctx - Convex query or mutation context
 * @param token - Session or demo token from the client auth store
 * @returns userId if valid, null if invalid/expired/revoked
 */
export async function validateSessionToken(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<Id<"users"> | null> {
  const now = Date.now();

  // Demo auth (EXPO_PUBLIC_DEMO_AUTH_MODE): token is demo_<users._id>, no sessions row
  if (token.startsWith('demo_')) {
    const userIdPart = token.substring(5);
    try {
      const user = await ctx.db.get(userIdPart as Id<'users'>);
      if (user && user.isActive && !user.deletedAt && !user.isBanned) {
        return user._id;
      }
    } catch {
      // Not a valid Convex id string — try legacy lookups below
    }

    const usersByDemo = await ctx.db
      .query('users')
      .withIndex('by_demo_user_id', (q) => q.eq('demoUserId', userIdPart))
      .first();
    if (usersByDemo && usersByDemo.isActive && !usersByDemo.deletedAt && !usersByDemo.isBanned) {
      return usersByDemo._id;
    }

    const usersByAuth = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', userIdPart))
      .first();
    if (usersByAuth && usersByAuth.isActive && !usersByAuth.deletedAt && !usersByAuth.isBanned) {
      return usersByAuth._id;
    }

    return null;
  }

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
 * Enforce that the caller owns the requested `authUserId`.
 *
 * Mirrors the `logout` mutation's ownership-validation pattern so any mutation
 * that mutates user-owned state can reject spoofed `authUserId` inputs.
 *
 * Checks performed:
 *  1. `token` must be a non-empty string
 *  2. `authUserId` must resolve to a real Convex user (requested user)
 *  3. `token` must be valid per `validateSessionToken` (owner user)
 *  4. `tokenOwnerId === requestedUserId`
 *  5. If `ctx.auth` has an identity, its subject must also resolve to the
 *     same Convex user (defense-in-depth, matches logout)
 *
 * @param ctx - Convex query or mutation context (requires `ctx.auth` + `ctx.db`)
 * @param token - Session or demo token from the client auth store
 * @param authUserId - Auth ID the client claims to be acting as
 * @returns Verified Convex userId if all checks pass
 * @throws Error('Unauthorized: ...') on any validation failure
 */
export async function validateOwnership(
  ctx: QueryCtx | MutationCtx,
  token: string,
  authUserId: string,
): Promise<Id<'users'>> {
  const trimmed = (token ?? '').trim();
  if (!trimmed) {
    throw new Error('Unauthorized: Missing session token');
  }

  const requestedUserId = await resolveUserIdByAuthId(ctx, authUserId);
  if (!requestedUserId) {
    throw new Error('Unauthorized: Invalid caller');
  }

  const tokenOwnerId = await validateSessionToken(ctx, trimmed);
  if (!tokenOwnerId) {
    throw new Error('Unauthorized: Invalid or expired session');
  }

  if (tokenOwnerId !== requestedUserId) {
    throw new Error('Unauthorized: Session ownership mismatch');
  }

  const identity = await ctx.auth.getUserIdentity();
  if (identity?.subject) {
    const callerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!callerUserId || callerUserId !== tokenOwnerId) {
      throw new Error('Unauthorized: Session does not belong to caller');
    }
  }

  return tokenOwnerId;
}

/**
 * Get Phase-2 display name for a user.
 *
 * Phase-2 privacy rules:
 * - Use displayName from userPrivateProfiles table (NOT the real name from users table)
 * - This prevents leaking real names into Phase-2/private surfaces
 * - Returns null if no private profile / displayName exists; callers must
 *   present a loading placeholder rather than the literal word "Anonymous",
 *   which is reserved for intentional anonymous product modes.
 *
 * @param ctx - Convex query or mutation context
 * @param userId - The Convex user ID
 * @returns Phase-2 display name (from private profile) or null when unknown
 */
export async function getPhase2DisplayName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<string | null> {
  // Look up private profile for Phase-2 display name
  const privateProfile = await ctx.db
    .query('userPrivateProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();

  if (privateProfile?.displayName) {
    return privateProfile.displayName;
  }

  // Unknown — never leak the real name; never wire-emit the string "Anonymous"
  // for a missing-data state. Callers render a placeholder.
  return null;
}

/**
 * P1-009: Check whether two Phase-2 users have mutually revealed photos.
 *
 * A reveal is recorded in `privateReveals` when the pair matches in Deep Connect.
 * For backward compatibility with any pre-existing matches that predate the
 * reveal table, we also treat a live match as implicit reveal.
 *
 * Uses the sorted-pair key (smaller ID first) — same convention as privateMatches.
 *
 * Returns true ONLY for that exact pair. Never exposes photos globally.
 */
export async function isRevealed(
  ctx: QueryCtx | MutationCtx,
  viewerId: Id<"users">,
  otherUserId: Id<"users">
): Promise<boolean> {
  if (!viewerId || !otherUserId || viewerId === otherUserId) return false;

  const userAId = viewerId < otherUserId ? viewerId : otherUserId;
  const userBId = viewerId < otherUserId ? otherUserId : viewerId;

  // Primary: look up explicit reveal record for this pair.
  const reveal = await ctx.db
    .query('privateReveals')
    .withIndex('by_pair', (q) => q.eq('userAId', userAId).eq('userBId', userBId))
    .first();
  if (reveal) return true;

  // Fallback: any pre-existing match implies reveal for that pair.
  const match = await ctx.db
    .query('privateMatches')
    .withIndex('by_users', (q) => q.eq('user1Id', userAId).eq('user2Id', userBId))
    .first();
  return !!match;
}
