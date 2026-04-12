import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';

// Send a reveal request
export const sendRequest = mutation({
  args: {
    // REVEAL-P0-001 FIX: Removed fromUserId - now derived from server auth
    toUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // REVEAL-P0-001 FIX: Derive sender identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, error: 'Unauthorized: authentication required' };
    }
    const fromUserId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!fromUserId) {
      return { success: false, error: 'Unauthorized: user not found' };
    }

    // Check if a request already exists in this direction
    const existing = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', fromUserId).eq('toUserId', args.toUserId)
      )
      .first();

    if (existing) {
      if (existing.status === 'pending') {
        return { success: false, error: 'Request already pending' };
      }
      if (existing.status === 'accepted') {
        return { success: false, error: 'Already revealed' };
      }
      // If declined, allow re-request by updating
      await ctx.db.patch(existing._id, {
        status: 'pending',
        respondedAt: undefined,
        createdAt: Date.now(),
      });
      return { success: true, requestId: existing._id };
    }

    const requestId = await ctx.db.insert('revealRequests', {
      fromUserId: fromUserId,
      toUserId: args.toUserId,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true, requestId };
  },
});

// Respond to a reveal request
export const respondToRequest = mutation({
  args: {
    requestId: v.id('revealRequests'),
    // REVEAL-P0-002 FIX: Removed responderId - now derived from server auth
    status: v.union(v.literal('accepted'), v.literal('declined')),
  },
  handler: async (ctx, args) => {
    // REVEAL-P0-002 FIX: Derive responder identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    const responderId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!responderId) {
      throw new Error('Unauthorized: user not found');
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error('Request not found');
    if (request.toUserId !== responderId) {
      throw new Error('Not authorized to respond to this request');
    }
    if (request.status !== 'pending') {
      throw new Error('Request already responded to');
    }

    await ctx.db.patch(args.requestId, {
      status: args.status,
      respondedAt: Date.now(),
    });

    return { success: true };
  },
});

// Get reveal status between two users
export const getRevealStatus = query({
  args: {
    userId: v.id('users'),
    otherUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // Check request from me to them
    const sentRequest = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', args.userId).eq('toUserId', args.otherUserId)
      )
      .first();

    // Check request from them to me
    const receivedRequest = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', args.otherUserId).eq('toUserId', args.userId)
      )
      .first();

    // Mutual accepted = both directions accepted
    if (sentRequest?.status === 'accepted' && receivedRequest?.status === 'accepted') {
      return { status: 'mutual_accepted' as const, sentRequest, receivedRequest };
    }

    if (sentRequest?.status === 'pending') {
      return { status: 'pending_sent' as const, sentRequest, receivedRequest };
    }

    if (receivedRequest?.status === 'pending') {
      return { status: 'pending_received' as const, sentRequest, receivedRequest };
    }

    if (sentRequest?.status === 'declined' || receivedRequest?.status === 'declined') {
      return { status: 'declined' as const, sentRequest, receivedRequest };
    }

    return { status: 'none' as const, sentRequest: null, receivedRequest: null };
  },
});

// Get pending reveal requests received by a user
export const getPendingReceived = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query('revealRequests')
      .withIndex('by_to_user', (q) => q.eq('toUserId', args.userId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect();
    return requests;
  },
});

// Get mutual reveal photos — ONLY returns Face 1 photos if both directions accepted
export const getMutualRevealPhotos = query({
  args: {
    // REVEAL-P0-003 FIX: Removed userId - now derived from server auth
    otherUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // REVEAL-P0-003 FIX: Derive caller identity from server auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { revealed: false, photos: [] };
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      return { revealed: false, photos: [] };
    }

    // Verify both directions are accepted
    const sentRequest = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', userId).eq('toUserId', args.otherUserId)
      )
      .first();

    const receivedRequest = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', args.otherUserId).eq('toUserId', userId)
      )
      .first();

    if (sentRequest?.status !== 'accepted' || receivedRequest?.status !== 'accepted') {
      return { revealed: false, photos: [] };
    }

    // Fetch the other user's Face 1 photos
    const photos = await ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', args.otherUserId))
      .collect();

    return {
      revealed: true,
      photos: photos.sort((a, b) => a.order - b.order).map((p) => ({
        url: p.url,
        isPrimary: p.isPrimary,
      })),
    };
  },
});
