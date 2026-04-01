/**
 * Phase-2 Private Photo Access Request System
 *
 * Allows users to request access to view another user's blurred profile photo
 * in the Phase-2 Messages context only. Access is granted one-to-one.
 *
 * Flow:
 * 1. Viewer requests access to owner's blurred photo
 * 2. Owner approves or declines
 * 3. If approved, viewer can see clear photo
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Helper to resolve auth ID to Convex user ID
async function resolveUserIdByAuthId(
  ctx: any,
  authUserId: string
): Promise<Id<'users'> | null> {
  // If it's already a valid Convex ID, try to use it directly
  if (authUserId.includes(':')) {
    // It's likely an auth token format, not a user ID
    return null;
  }

  // Try to find user by ID directly
  try {
    const user = await ctx.db.get(authUserId as Id<'users'>);
    if (user) return authUserId as Id<'users'>;
  } catch {
    // Not a valid ID format
  }

  // Try to find by externalId (for auth providers)
  const userByExternal = await ctx.db
    .query('users')
    .filter((q: any) => q.eq(q.field('externalId'), authUserId))
    .first();
  if (userByExternal) return userByExternal._id;

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST ACCESS: Viewer requests to see owner's blurred photo
// ═══════════════════════════════════════════════════════════════════════════
export const requestPrivatePhotoAccess = mutation({
  args: {
    authUserId: v.string(), // The viewer (requester)
    ownerUserId: v.id('users'), // The photo owner
    conversationId: v.optional(v.id('privateConversations')),
  },
  handler: async (ctx, args) => {
    const { authUserId, ownerUserId, conversationId } = args;
    const now = Date.now();

    // Resolve viewer ID
    const viewerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!viewerId) {
      return { success: false, error: 'unauthorized' };
    }

    // Prevent self-request
    if (viewerId === ownerUserId) {
      return { success: false, error: 'cannot_request_own_photo' };
    }

    // Check if viewer is blocked by owner
    const blocked = await ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q: any) => q.eq('blockerId', ownerUserId).eq('blockedUserId', viewerId))
      .first();
    if (blocked) {
      return { success: false, error: 'blocked' };
    }

    // Check if they have a valid Phase-2 conversation (must be matched)
    if (conversationId) {
      const conversation = await ctx.db.get(conversationId);
      if (!conversation) {
        return { success: false, error: 'conversation_not_found' };
      }
      // Verify both users are participants
      if (!conversation.participants.includes(viewerId) ||
          !conversation.participants.includes(ownerUserId)) {
        return { success: false, error: 'not_participant' };
      }
    }

    // Check for existing request
    const existingRequest = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_viewer', (q: any) =>
        q.eq('ownerUserId', ownerUserId).eq('viewerUserId', viewerId)
      )
      .first();

    if (existingRequest) {
      // If pending, don't create duplicate
      if (existingRequest.status === 'pending') {
        return { success: true, status: 'already_pending', requestId: existingRequest._id };
      }
      // If approved, no need to request again
      if (existingRequest.status === 'approved') {
        return { success: true, status: 'already_approved', requestId: existingRequest._id };
      }
      // If declined, allow new request (update existing)
      await ctx.db.patch(existingRequest._id, {
        status: 'pending',
        updatedAt: now,
        respondedAt: undefined,
      });
      return { success: true, status: 'request_renewed', requestId: existingRequest._id };
    }

    // Create new request
    const requestId = await ctx.db.insert('privatePhotoAccessRequests', {
      ownerUserId,
      viewerUserId: viewerId,
      status: 'pending',
      requestSource: 'phase2_messages',
      conversationId,
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, status: 'request_created', requestId };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RESPOND TO REQUEST: Owner approves or declines
// ═══════════════════════════════════════════════════════════════════════════
export const respondPrivatePhotoAccessRequest = mutation({
  args: {
    authUserId: v.string(), // The owner (responder)
    requestId: v.id('privatePhotoAccessRequests'),
    approve: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { authUserId, requestId, approve } = args;
    const now = Date.now();

    // Resolve owner ID
    const ownerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!ownerId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the request
    const request = await ctx.db.get(requestId);
    if (!request) {
      return { success: false, error: 'request_not_found' };
    }

    // Verify responder is the owner
    if (request.ownerUserId !== ownerId) {
      return { success: false, error: 'not_owner' };
    }

    // Update request status
    await ctx.db.patch(requestId, {
      status: approve ? 'approved' : 'declined',
      updatedAt: now,
      respondedAt: now,
    });

    return { success: true, status: approve ? 'approved' : 'declined' };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GET ACCESS STATUS: Check if viewer can see owner's photo
// ═══════════════════════════════════════════════════════════════════════════
export const getPrivatePhotoAccessStatus = query({
  args: {
    authUserId: v.string(),
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { authUserId, ownerUserId } = args;

    // Resolve viewer ID
    const viewerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!viewerId) {
      return { status: 'none', canViewClear: false };
    }

    // Self always can view own photo
    if (viewerId === ownerUserId) {
      return { status: 'self', canViewClear: true };
    }

    // Check for existing request
    const request = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_viewer', (q: any) =>
        q.eq('ownerUserId', ownerUserId).eq('viewerUserId', viewerId)
      )
      .first();

    if (!request) {
      return { status: 'none', canViewClear: false };
    }

    return {
      status: request.status,
      canViewClear: request.status === 'approved',
      requestId: request._id,
      requestedAt: request.createdAt,
      respondedAt: request.respondedAt,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GET PENDING REQUESTS: Owner sees all pending requests to their photo
// ═══════════════════════════════════════════════════════════════════════════
export const getPendingPhotoAccessRequests = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { authUserId } = args;

    // Resolve owner ID
    const ownerId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!ownerId) {
      return [];
    }

    // Get all pending requests where this user is the owner
    const requests = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_status', (q: any) =>
        q.eq('ownerUserId', ownerId).eq('status', 'pending')
      )
      .collect();

    // Enrich with viewer info
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const viewer = await ctx.db.get(request.viewerUserId);
        const viewerProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q: any) => q.eq('userId', request.viewerUserId))
          .first();

        return {
          requestId: request._id,
          viewerUserId: request.viewerUserId,
          viewerName: viewerProfile?.displayName ?? viewer?.name ?? 'Unknown',
          viewerPhotoUrl: viewerProfile?.privatePhotoUrls?.[0] ?? null,
          conversationId: request.conversationId,
          createdAt: request.createdAt,
        };
      })
    );

    return enrichedRequests;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CHECK IF PHOTO IS BLURRED: Helper to determine if owner has blurred photo
// ═══════════════════════════════════════════════════════════════════════════
export const isPhotoBlurredForOwner = query({
  args: {
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { ownerUserId } = args;

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q: any) => q.eq('userId', ownerUserId))
      .first();

    if (!profile) {
      return { isBlurred: false, hasPhoto: false };
    }

    // Check if user has blurred photos or blur level set
    const hasBlurredPhotos = profile.privatePhotosBlurred?.length > 0;
    const hasBlurLevel = (profile.privatePhotoBlurLevel ?? 0) > 0;
    const hasPhotos = profile.privatePhotoUrls?.length > 0;

    return {
      isBlurred: hasBlurredPhotos || hasBlurLevel,
      hasPhoto: hasPhotos,
      blurLevel: profile.privatePhotoBlurLevel ?? 0,
    };
  },
});
