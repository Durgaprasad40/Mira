/**
 * Private Photo Access Module
 *
 * Handles the photo access request flow between matched users:
 * - Check if photo is blurred for owner
 * - Check viewer's access status to owner's photos
 * - Request access to view unblurred photos
 *
 * P2-001: Auth pattern hardening — Phase-2 callsites pass `token` plus an
 * optional `authUserId` hint and the server resolves the actor exclusively
 * from the session token via the local `requirePhotoAccessActor` helper.
 * `authUserId` is only used as a paranoid cross-check (when provided) to
 * reject swapped token/authUserId pairs — it is never trusted on its own.
 * The legacy `ctx.auth.getUserIdentity()` + `resolveUserIdByAuthId` flow
 * trusted Convex JWT identity alone, which is not consistent with the
 * rest of the Phase-2 private surface (privateConversations, etc.).
 * Keeping all request/approve/decline business logic byte-identical —
 * only the auth plumbing changes.
 */
import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';

/**
 * P2-001: Local actor-resolver — mirrors the `requirePrivateConversationActor`
 * pattern in `convex/privateConversations.ts`. We deliberately duplicate this
 * (instead of importing) so this module does not couple to the conversation
 * module's internals. Behavior is byte-identical:
 *   1. session token MUST resolve to a userId
 *   2. if the optional `authUserId` hint is provided, it MUST resolve back
 *      to the same userId (rejects swapped token/authUserId pairs)
 *   3. throws 'UNAUTHORIZED' on any mismatch
 */
async function requirePhotoAccessActor(
  ctx: QueryCtx | MutationCtx,
  token: string,
  authUserId: string | undefined,
): Promise<Id<'users'>> {
  const userId = await validateSessionToken(ctx, token.trim());
  if (!userId) throw new Error('UNAUTHORIZED');
  const authHint = authUserId?.trim();
  if (authHint) {
    const assertedUserId = await resolveUserIdByAuthId(ctx, authHint);
    if (!assertedUserId || String(assertedUserId) !== String(userId)) {
      throw new Error('UNAUTHORIZED');
    }
  }
  return userId;
}

/**
 * Check if the profile owner has blurred photos enabled.
 * Used to determine if blur UI should be shown.
 *
 * Note: This query intentionally has NO auth — the "is photo blur on"
 * signal is needed by viewers before they have any session context
 * (and the field itself does not leak private content; it only says
 * whether the owner has chosen to gate their photos).
 */
export const isPhotoBlurredForOwner = query({
  args: {
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, { ownerUserId }) => {
    // Get the user to check their photoBlurred setting
    const owner = await ctx.db.get(ownerUserId);
    if (!owner) {
      return { isBlurred: false };
    }

    // Check user's photoBlurred field
    const isBlurred = owner.photoBlurred === true;

    return { isBlurred };
  },
});

/**
 * Get the current viewer's access status to the owner's private photos.
 * Returns whether viewer can see clear photos and the request status.
 */
export const getPrivatePhotoAccessStatus = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, { token, authUserId, ownerUserId }) => {
    // P2-001: resolve the viewer via the standard Phase-2 actor pattern.
    // Queries on the private surface degrade gracefully on auth failure
    // so the UI shows the blurred state + a "sign in to request"
    // affordance instead of an error toast.
    let viewerUserId: Id<'users'>;
    try {
      viewerUserId = await requirePhotoAccessActor(ctx, token, authUserId);
    } catch {
      return {
        canViewClear: false,
        status: 'none' as const,
        canRequest: false,
      };
    }

    // Self-viewing - always can see clear
    if (String(viewerUserId) === String(ownerUserId)) {
      return {
        canViewClear: true,
        status: 'self' as const,
        canRequest: false,
      };
    }

    // Check if owner has photo blur enabled
    const owner = await ctx.db.get(ownerUserId);
    if (!owner || !owner.photoBlurred) {
      // No blur enabled - everyone can see clear
      return {
        canViewClear: true,
        status: 'none' as const,
        canRequest: false,
      };
    }

    // Check for existing access request
    const accessRequest = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_viewer', (q) =>
        q.eq('ownerUserId', ownerUserId).eq('viewerUserId', viewerUserId)
      )
      .first();

    if (!accessRequest) {
      // No request exists - viewer cannot see clear, can request
      return {
        canViewClear: false,
        status: 'none' as const,
        canRequest: true,
      };
    }

    // Check request status
    if (accessRequest.status === 'approved') {
      return {
        canViewClear: true,
        status: 'approved' as const,
        canRequest: false,
      };
    }

    if (accessRequest.status === 'pending') {
      return {
        canViewClear: false,
        status: 'pending' as const,
        canRequest: false,
      };
    }

    if (accessRequest.status === 'declined') {
      return {
        canViewClear: false,
        status: 'declined' as const,
        canRequest: false, // Cannot re-request after decline
      };
    }

    // Fallback
    return {
      canViewClear: false,
      status: 'none' as const,
      canRequest: true,
    };
  },
});

/**
 * Request access to view owner's unblurred photos.
 * Creates a pending request that the owner can approve/decline.
 */
export const requestPrivatePhotoAccess = mutation({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, { token, authUserId, ownerUserId }) => {
    // P2-001: Standard Phase-2 actor resolution. Mutations actually
    // create rows so we surface the auth failure to the caller via
    // success:false rather than throwing — matches existing photo-
    // access error-shape contract.
    let viewerUserId: Id<'users'>;
    try {
      viewerUserId = await requirePhotoAccessActor(ctx, token, authUserId);
    } catch {
      return { success: false, error: 'Unauthorized' };
    }

    // Cannot request access to own photos
    if (String(viewerUserId) === String(ownerUserId)) {
      return { success: false, error: 'Cannot request access to own photos' };
    }

    // Check if owner exists
    const owner = await ctx.db.get(ownerUserId);
    if (!owner) {
      return { success: false, error: 'User not found' };
    }

    // Check for existing request
    const existingRequest = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_viewer', (q) =>
        q.eq('ownerUserId', ownerUserId).eq('viewerUserId', viewerUserId)
      )
      .first();

    if (existingRequest) {
      if (existingRequest.status === 'approved') {
        return { success: true, status: 'already_approved' };
      }
      if (existingRequest.status === 'pending') {
        return { success: true, status: 'already_pending' };
      }
      if (existingRequest.status === 'declined') {
        return { success: false, error: 'Request was previously declined' };
      }
    }

    // Create new request
    const now = Date.now();
    await ctx.db.insert('privatePhotoAccessRequests', {
      ownerUserId,
      viewerUserId,
      status: 'pending',
      requestSource: 'phase2_profile',
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, status: 'requested' };
  },
});

/**
 * Respond to a photo access request (owner approving/declining).
 */
export const respondToPhotoAccessRequest = mutation({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
    requestId: v.id('privatePhotoAccessRequests'),
    response: v.union(v.literal('approved'), v.literal('declined')),
  },
  handler: async (ctx, { token, authUserId, requestId, response }) => {
    // P2-001: same standard actor resolution as requestPrivatePhotoAccess.
    let userId: Id<'users'>;
    try {
      userId = await requirePhotoAccessActor(ctx, token, authUserId);
    } catch {
      return { success: false, error: 'Unauthorized' };
    }

    // Get the request
    const request = await ctx.db.get(requestId);
    if (!request) {
      return { success: false, error: 'Request not found' };
    }

    // Verify ownership
    if (String(request.ownerUserId) !== String(userId)) {
      return { success: false, error: 'Unauthorized: not the owner of this request' };
    }

    // Update the request
    const now = Date.now();
    await ctx.db.patch(requestId, {
      status: response,
      updatedAt: now,
      respondedAt: now,
    });

    return { success: true, status: response };
  },
});

/**
 * Get pending photo access requests for the current user (as owner).
 */
export const getPendingPhotoAccessRequests = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    // P2-001: query-side soft validation — return an empty result for
    // unauthenticated callers so the UI can render a benign empty
    // state instead of an error toast.
    let userId: Id<'users'>;
    try {
      userId = await requirePhotoAccessActor(ctx, token, authUserId);
    } catch {
      return { requests: [] };
    }

    // Get pending requests where user is the owner
    const requests = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_viewer', (q) => q.eq('ownerUserId', userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect();

    // Enrich with viewer info (from userPrivateProfiles table)
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const viewerProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', request.viewerUserId))
          .first();
        return {
          _id: request._id,
          viewerUserId: String(request.viewerUserId),
          // ANON-LOADING-FIX: emit null (not "Anonymous") when displayName is
          // missing. Client renders a graceful placeholder; "Anonymous" is
          // reserved for intentional anonymous product modes.
          viewerName: viewerProfile?.displayName || null,
          viewerAvatar: viewerProfile?.privatePhotoUrls?.[0] || undefined,
          createdAt: request.createdAt,
        };
      })
    );

    return { requests: enrichedRequests };
  },
});
