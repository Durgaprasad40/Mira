/**
 * Phase-2 Private Photo Access Request System
 *
 * Allows users to request access to view another user's private profile photos.
 * Requests are auth-bound, one-to-one, and limited to real Phase-2 matches.
 *
 * Flow:
 * 1. Viewer requests access to owner's blurred photo
 * 2. Owner approves or declines
 * 3. If approved, viewer can see clear photo
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { getPhase2DisplayName, requireAuthenticatedUserId } from './helpers';

function getSortedUserPair(
  userA: Id<'users'>,
  userB: Id<'users'>
): [Id<'users'>, Id<'users'>] {
  return userA < userB ? [userA, userB] : [userB, userA];
}

async function hasActivePhase2Match(
  ctx: any,
  userA: Id<'users'>,
  userB: Id<'users'>
): Promise<boolean> {
  const [user1Id, user2Id] = getSortedUserPair(userA, userB);
  const match = await ctx.db
    .query('privateMatches')
    .withIndex('by_users', (q: any) => q.eq('user1Id', user1Id).eq('user2Id', user2Id))
    .first();
  return match?.isActive === true;
}

async function validateConversationParticipants(
  ctx: any,
  conversationId: Id<'privateConversations'>,
  userA: Id<'users'>,
  userB: Id<'users'>
) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    return { ok: false, error: 'conversation_not_found' as const };
  }

  if (!conversation.participants.includes(userA) || !conversation.participants.includes(userB)) {
    return { ok: false, error: 'not_participant' as const };
  }

  return { ok: true as const };
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST ACCESS: Viewer requests to see owner's blurred photo
// ═══════════════════════════════════════════════════════════════════════════
export const requestPrivatePhotoAccess = mutation({
  args: {
    ownerUserId: v.id('users'), // The photo owner
    conversationId: v.optional(v.id('privateConversations')),
  },
  handler: async (ctx, args) => {
    const { ownerUserId, conversationId } = args;
    const now = Date.now();

    let viewerId: Id<'users'>;
    try {
      viewerId = await requireAuthenticatedUserId(ctx);
    } catch {
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

    // Must be a real matched Phase-2 pair before requests are allowed.
    const hasMatch = await hasActivePhase2Match(ctx, viewerId, ownerUserId);
    if (!hasMatch) {
      return { success: false, error: 'not_matched' };
    }

    if (conversationId) {
      const conversationValidation = await validateConversationParticipants(
        ctx,
        conversationId,
        viewerId,
        ownerUserId
      );
      if (!conversationValidation.ok) {
        return { success: false, error: conversationValidation.error };
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
      requestSource: conversationId ? 'phase2_messages' : 'phase2_profile',
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
    requestId: v.id('privatePhotoAccessRequests'),
    approve: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { requestId, approve } = args;
    const now = Date.now();

    let ownerId: Id<'users'>;
    try {
      ownerId = await requireAuthenticatedUserId(ctx);
    } catch {
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
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { ownerUserId } = args;

    let viewerId: Id<'users'>;
    try {
      viewerId = await requireAuthenticatedUserId(ctx);
    } catch {
      return { status: 'none', canViewClear: false, canRequest: false };
    }

    // Self always can view own photo
    if (viewerId === ownerUserId) {
      return { status: 'self', canViewClear: true, canRequest: false };
    }

    const hasMatch = await hasActivePhase2Match(ctx, viewerId, ownerUserId);
    if (!hasMatch) {
      return { status: 'none', canViewClear: false, canRequest: false };
    }

    // Check for existing request
    const request = await ctx.db
      .query('privatePhotoAccessRequests')
      .withIndex('by_owner_viewer', (q: any) =>
        q.eq('ownerUserId', ownerUserId).eq('viewerUserId', viewerId)
      )
      .first();

    if (!request) {
      return { status: 'none', canViewClear: false, canRequest: true };
    }

    return {
      status: request.status,
      canViewClear: request.status === 'approved',
      canRequest: true,
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
  args: {},
  handler: async (ctx) => {
    let ownerId: Id<'users'>;
    try {
      ownerId = await requireAuthenticatedUserId(ctx);
    } catch {
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
        const viewerName = await getPhase2DisplayName(ctx, request.viewerUserId);

        return {
          requestId: request._id,
          viewerUserId: request.viewerUserId,
          viewerName,
          viewerPhotoUrl: null,
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

    const hasBlurredPhotos = profile.privatePhotosBlurred?.length > 0;
    const hasBlurLevel = (profile.privatePhotoBlurLevel ?? 0) > 0;
    const hasBlurSlots = Array.isArray(profile.photoBlurSlots) && profile.photoBlurSlots.some(Boolean);
    const hasPhotos =
      (Array.isArray((profile as any).privatePhotoStorageIds) && (profile as any).privatePhotoStorageIds.length > 0) ||
      (Array.isArray((profile as any).privatePhotoUrls) && (profile as any).privatePhotoUrls.length > 0);

    return {
      isBlurred: hasBlurredPhotos || hasBlurLevel || hasBlurSlots,
      hasPhoto: hasPhotos,
      blurLevel: profile.privatePhotoBlurLevel ?? 0,
    };
  },
});
