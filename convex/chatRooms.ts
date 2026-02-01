import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const DEFAULT_ROOMS = [
  { name: 'Global', slug: 'global', category: 'general' as const },
  { name: 'India', slug: 'india', category: 'general' as const },
  { name: 'Hindi', slug: 'hindi', category: 'language' as const },
  { name: 'Telugu', slug: 'telugu', category: 'language' as const },
  { name: 'Tamil', slug: 'tamil', category: 'language' as const },
  { name: 'Malayalam', slug: 'malayalam', category: 'language' as const },
  { name: 'Kannada', slug: 'kannada', category: 'language' as const },
  { name: 'Marathi', slug: 'marathi', category: 'language' as const },
  { name: 'Bengali', slug: 'bengali', category: 'language' as const },
  { name: 'Gujarati', slug: 'gujarati', category: 'language' as const },
  { name: 'Punjabi', slug: 'punjabi', category: 'language' as const },
  { name: 'Urdu', slug: 'urdu', category: 'language' as const },
  { name: 'English', slug: 'english', category: 'language' as const },
];

// Idempotent: ensures all default rooms exist
export const ensureDefaultRooms = mutation({
  args: {},
  handler: async (ctx) => {
    for (const room of DEFAULT_ROOMS) {
      const existing = await ctx.db
        .query('chatRooms')
        .withIndex('by_slug', (q) => q.eq('slug', room.slug))
        .first();
      if (!existing) {
        await ctx.db.insert('chatRooms', {
          name: room.name,
          slug: room.slug,
          category: room.category,
          isPublic: true,
          createdAt: Date.now(),
          memberCount: 0,
        });
      }
    }
  },
});

// List rooms, optionally filtered by category, sorted by most recent activity
export const listRooms = query({
  args: {
    category: v.optional(v.union(v.literal('language'), v.literal('general'))),
  },
  handler: async (ctx, { category }) => {
    let rooms;
    if (category) {
      rooms = await ctx.db
        .query('chatRooms')
        .withIndex('by_category', (q) => q.eq('category', category))
        .collect();
    } else {
      rooms = await ctx.db.query('chatRooms').collect();
    }
    // Sort: rooms with recent messages first, then by name
    rooms.sort((a, b) => {
      const aTime = a.lastMessageAt ?? 0;
      const bTime = b.lastMessageAt ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    });
    return rooms;
  },
});

// Get a single room by slug
export const getRoomBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query('chatRooms')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();
  },
});

// Get a single room by ID
export const getRoom = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    return await ctx.db.get(roomId);
  },
});

// List messages for a room (newest first, with limit)
export const listMessages = query({
  args: {
    roomId: v.id('chatRooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, limit }) => {
    const messages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
      .order('desc')
      .take(limit ?? 50);
    return messages.reverse(); // return oldest-first for display
  },
});

// List members of a room
export const listMembers = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    return await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();
  },
});

// Check if a user is a member of a room
export const isMember = query({
  args: {
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
  },
  handler: async (ctx, { roomId, userId }) => {
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    return !!membership;
  },
});

// Join a room
export const joinRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
  },
  handler: async (ctx, { roomId, userId }) => {
    // Check if already a member
    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (existing) return existing._id;

    const memberId = await ctx.db.insert('chatRoomMembers', {
      roomId,
      userId,
      joinedAt: Date.now(),
    });

    // Increment member count
    const room = await ctx.db.get(roomId);
    if (room) {
      await ctx.db.patch(roomId, { memberCount: room.memberCount + 1 });
    }

    return memberId;
  },
});

// Leave a room
export const leaveRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
  },
  handler: async (ctx, { roomId, userId }) => {
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (!membership) return;

    await ctx.db.delete(membership._id);

    const room = await ctx.db.get(roomId);
    if (room) {
      await ctx.db.patch(roomId, {
        memberCount: Math.max(0, room.memberCount - 1),
      });
    }
  },
});

// Send a message to a room (must be a member)
export const sendMessage = mutation({
  args: {
    roomId: v.id('chatRooms'),
    senderId: v.id('users'),
    text: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, senderId, text, imageUrl }) => {
    // Verify membership
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', senderId))
      .first();
    if (!membership) {
      throw new Error('Must join the room before sending messages');
    }

    const type = imageUrl ? 'image' : 'text';
    const now = Date.now();

    const messageId = await ctx.db.insert('chatRoomMessages', {
      roomId,
      senderId,
      type,
      text: text ?? undefined,
      imageUrl: imageUrl ?? undefined,
      createdAt: now,
    });

    // Update room's last message info
    await ctx.db.patch(roomId, {
      lastMessageAt: now,
      lastMessageText: text ?? (imageUrl ? '[Image]' : ''),
    });

    return messageId;
  },
});
