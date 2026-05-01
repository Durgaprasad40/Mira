/**
 * Private Photo Access Module
 *
 * Handles the photo access request flow between matched users:
 * - Check if photo is blurred for owner
 * - Check viewer's access status to owner's photos
 * - Request access to view unblurred photos
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';
import { Id } from './_generated/dataModel';

/**
 * Check if the profile owner has blurred photos enabled.
 * Used to determine if blur UI should be shown.
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
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, { ownerUserId }) => {
    // Get current user from auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        canViewClear: false,
        status: 'none' as const,
        canRequest: false,
      };
    }

    // Resolve viewer's user ID
    const viewerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!viewerUserId) {
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
    ownerUserId: v.id('users'),
  },
  handler: async (ctx, { ownerUserId }) => {
    // Get current user from auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, error: 'Unauthorized' };
    }

    // Resolve viewer's user ID
    const viewerUserId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!viewerUserId) {
      return { success: false, error: 'User not found' };
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
    requestId: v.id('privatePhotoAccessRequests'),
    response: v.union(v.literal('approved'), v.literal('declined')),
  },
  handler: async (ctx, { requestId, response }) => {
    // Get current user from auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, error: 'Unauthorized' };
    }

    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      return { success: false, error: 'User not found' };
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
  args: {},
  handler: async (ctx) => {
    // Get current user from auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { requests: [] };
    }

    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
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
