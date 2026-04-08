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

  // EMERGENCY FALLBACK: Try to find user by ID prefix match
  // This handles cases where frontend has a truncated ID (data corruption issue)
  // TODO: Remove this once the root cause of ID truncation is fixed
  if (authUserId.length >= 8 && authUserId.length < 32) {
    console.warn(`[resolveUserIdByAuthId] Attempting prefix match for truncated ID: ${authUserId}`);
    const allUsers = await ctx.db.query("users").take(100);
    const matchingUser = allUsers.find(u => (u._id as string).startsWith(authUserId));
    if (matchingUser) {
      console.log(`[resolveUserIdByAuthId] Found user by prefix match: ${matchingUser.name} (${matchingUser._id})`);
      return matchingUser._id;
    }
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
 * @param ctx - Convex mutation context
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
 * Strict current-user resolution from a validated session token.
 *
 * IMPORTANT:
 * - Uses ONLY the session token as the source of truth
 * - Intended for security-sensitive self-service flows (Profile, Support, Verification)
 * - Does NOT accept raw user IDs, auth IDs, demo IDs, or prefix matches
 */
export async function requireAuthenticatedSessionUser(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<Doc<"users">> {
  if (!token || token.trim().length === 0) {
    throw new Error("Unauthorized: authentication required");
  }

  const userId = await validateSessionToken(ctx, token);
  if (!userId) {
    throw new Error("Unauthorized: invalid or expired session");
  }

  const user = await ctx.db.get(userId);
  if (!user || !user.isActive || user.deletedAt || user.isBanned) {
    throw new Error("Unauthorized: invalid user");
  }

  return user;
}

/**
 * Strict admin resolution from a validated session token.
 */
export async function requireAdminSessionUser(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<Doc<"users">> {
  const user = await requireAuthenticatedSessionUser(ctx, token);
  if (!user.isAdmin) {
    throw new Error("Unauthorized: admin access required");
  }
  return user;
}

/**
 * Strict session-based user resolution for live Phase-1 Messages paths.
 *
 * IMPORTANT:
 * - Uses ONLY the validated session token as the source of truth
 * - Does NOT accept Convex user IDs, authUserIds, demoUserIds, or prefix matches
 * - Intended for security-sensitive message and protected-media access
 */
export async function requireLiveMessageSessionUser(
  ctx: QueryCtx | MutationCtx,
  token: string
): Promise<Id<"users">> {
  const user = await requireAuthenticatedSessionUser(ctx, token);
  return user._id;
}

// =============================================================================
// PAIR ELIGIBILITY CHECK - ONE PAIR, ONE CONNECTION PER PHASE
// =============================================================================
// This is a CORE backend rule enforced globally.
// If two users have EVER had a relationship in a phase, they are PERMANENTLY
// INELIGIBLE for ANY new connection in that same phase.
//
// "Pair history" includes: matches, conversations, messages, likes, blocks,
// confession connects, or any other prior interaction.
// =============================================================================

export type Phase = 'phase1' | 'phase2';

/**
 * Normalize a user pair to a consistent order for lookups.
 * Returns [smaller, larger] based on string comparison.
 */
export function normalizePair(
  userA: Id<"users">,
  userB: Id<"users">
): [Id<"users">, Id<"users">] {
  const a = userA as string;
  const b = userB as string;
  return a < b ? [userA, userB] : [userB, userA];
}

/**
 * Check if a pair of users is eligible for a new connection in a given phase.
 *
 * CORRECTED LOGIC:
 * - Likes/swipes do NOT block eligibility (only matches do)
 * - Blocks are phase-specific (Phase-1 blocks only affect Phase-1)
 * - Backend is the source of truth
 *
 * Returns FALSE if ANY of the following exists for the pair:
 * - Previous match (active or inactive)
 * - Conversation created
 * - Block records (Phase-1 only - no Phase-2 blocks table exists)
 * - Confession connect records (Phase-1 only)
 *
 * Phase 1 tables: blocks, matches, conversations, confessionCommentConnects
 * Phase 2 tables: privateMatches, privateConversations
 *
 * @param ctx - Convex query or mutation context
 * @param userA - First user ID
 * @param userB - Second user ID
 * @param phase - 'phase1' or 'phase2'
 * @returns true if eligible, false if pair has prior history
 */
export async function isPairEligibleForPhase(
  ctx: QueryCtx | MutationCtx,
  userA: Id<"users">,
  userB: Id<"users">,
  phase: Phase
): Promise<boolean> {
  // Same user check
  if (userA === userB) return false;

  if (phase === 'phase1') {
    return isPairEligibleForPhase1(ctx, userA, userB);
  } else {
    return isPairEligibleForPhase2(ctx, userA, userB);
  }
}

/**
 * Phase-1 specific eligibility check.
 * Checks: blocks, matches, conversations, confessionCommentConnects
 * NOTE: Likes/swipes do NOT block eligibility - only completed connections do
 */
async function isPairEligibleForPhase1(
  ctx: QueryCtx | MutationCtx,
  userA: Id<"users">,
  userB: Id<"users">
): Promise<boolean> {
  const db = ctx.db as any;
  // Check Phase-1 blocks (bidirectional)
  const blockCheck1 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) => q.eq('blockerId', userA).eq('blockedUserId', userB))
    .first();
  if (blockCheck1) return false;

  const blockCheck2 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) => q.eq('blockerId', userB).eq('blockedUserId', userA))
    .first();
  if (blockCheck2) return false;

  // Check matches (either direction, any status - active or inactive)
  const match1 = await ctx.db
    .query('matches')
    .withIndex('by_users', (q) => q.eq('user1Id', userA).eq('user2Id', userB))
    .first();
  if (match1) return false;

  const match2 = await ctx.db
    .query('matches')
    .withIndex('by_users', (q) => q.eq('user1Id', userB).eq('user2Id', userA))
    .first();
  if (match2) return false;

  // NOTE: Likes are intentionally NOT checked here
  // A single-sided like should not prevent future connection attempts

  // Check confession comment connects (either direction)
  const confessionConnect1 = await db
    .query('confessionCommentConnects')
    .withIndex('by_from_user', (q: any) => q.eq('fromUserId', userA))
    .filter((q: any) => q.eq(q.field('toUserId'), userB))
    .first();
  if (confessionConnect1) return false;

  const confessionConnect2 = await db
    .query('confessionCommentConnects')
    .withIndex('by_from_user', (q: any) => q.eq('fromUserId', userB))
    .filter((q: any) => q.eq(q.field('toUserId'), userA))
    .first();
  if (confessionConnect2) return false;

  // Check conversations (check if both users are participants)
  const conversationsWithUserA = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_user', (q) => q.eq('userId', userA))
    .take(100);

  for (const cp of conversationsWithUserA) {
    const otherParticipant = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_conversation', (q) => q.eq('conversationId', cp.conversationId))
      .filter((q) => q.eq(q.field('userId'), userB))
      .first();
    if (otherParticipant) return false;
  }

  // Pair is eligible
  return true;
}

/**
 * Phase-2 specific eligibility check.
 * Checks: privateMatches, privateConversations
 * NOTE: No Phase-2 blocks table exists - blocks are Phase-1 only
 * NOTE: privateLikes do NOT block eligibility - only completed connections do
 */
async function isPairEligibleForPhase2(
  ctx: QueryCtx | MutationCtx,
  userA: Id<"users">,
  userB: Id<"users">
): Promise<boolean> {
  const db = ctx.db as any;
  // NOTE: No blocks check for Phase-2 - blocks table is Phase-1 only

  // Check private matches (either direction, any status)
  const privateMatch1 = await db
    .query('privateMatches')
    .withIndex('by_users', (q: any) => q.eq('user1Id', userA).eq('user2Id', userB))
    .first();
  if (privateMatch1) return false;

  const privateMatch2 = await db
    .query('privateMatches')
    .withIndex('by_users', (q: any) => q.eq('user1Id', userB).eq('user2Id', userA))
    .first();
  if (privateMatch2) return false;

  // NOTE: privateLikes are intentionally NOT checked here
  // A single-sided like should not prevent future connection attempts

  // Check private conversations (through participants)
  const privateConvsWithUserA = await db
    .query('privateConversationParticipants')
    .withIndex('by_user', (q: any) => q.eq('userId', userA))
    .take(100);

  for (const cp of privateConvsWithUserA) {
    const otherParticipant = await db
      .query('privateConversationParticipants')
      .withIndex('by_conversation', (q: any) => q.eq('conversationId', cp.conversationId))
      .filter((q: any) => q.eq(q.field('userId'), userB))
      .first();
    if (otherParticipant) return false;
  }

  // P1-004 FIX: Check TOD (Truth or Dare) connections
  // TOD creates Phase-1 conversations, but a connected TOD request means users
  // have already interacted - should not reconnect in Phase-2 either
  // Note: todConnectRequests uses string IDs, not Id<"users">
  const userAStr = userA as string;
  const userBStr = userB as string;

  const todConnectAToB = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_from_to', (q) => q.eq('fromUserId', userAStr).eq('toUserId', userBStr))
    .filter((q) => q.eq(q.field('status'), 'connected'))
    .first();
  if (todConnectAToB) return false;

  const todConnectBToA = await ctx.db
    .query('todConnectRequests')
    .withIndex('by_from_to', (q) => q.eq('fromUserId', userBStr).eq('toUserId', userAStr))
    .filter((q) => q.eq(q.field('status'), 'connected'))
    .first();
  if (todConnectBToA) return false;

  // Pair is eligible
  return true;
}
