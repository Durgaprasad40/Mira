import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Send a reveal request
export const sendRequest = mutation({
  args: {
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // Check if a request already exists in this direction
    const existing = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', args.fromUserId).eq('toUserId', args.toUserId)
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
      fromUserId: args.fromUserId,
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
    responderId: v.id('users'),
    status: v.union(v.literal('accepted'), v.literal('declined')),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error('Request not found');
    if (request.toUserId !== args.responderId) {
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
    userId: v.id('users'),
    otherUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // Verify both directions are accepted
    const sentRequest = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', args.userId).eq('toUserId', args.otherUserId)
      )
      .first();

    const receivedRequest = await ctx.db
      .query('revealRequests')
      .withIndex('by_from_to', (q) =>
        q.eq('fromUserId', args.otherUserId).eq('toUserId', args.userId)
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
