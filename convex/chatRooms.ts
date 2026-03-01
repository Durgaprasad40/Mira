import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { softMaskText } from './softMask';
import { internal } from './_generated/api';

// 24 hours in milliseconds
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PENALTY_DURATION_MS = 24 * 60 * 60 * 1000;
// Message retention constants
const MAX_MESSAGES_PER_ROOM = 1000; // Trigger cleanup when exceeded
const TARGET_AFTER_TRIM = 900;      // Target count after cleanup
const BATCH_DELETE_SIZE = 200;      // Delete in batches for efficiency

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
// Phase-2: Filters out expired rooms (expiresAt < now)
export const listRooms = query({
  args: {
    category: v.optional(v.union(v.literal('language'), v.literal('general'))),
  },
  handler: async (ctx, { category }) => {
    const now = Date.now();
    let rooms;
    if (category) {
      rooms = await ctx.db
        .query('chatRooms')
        .withIndex('by_category', (q) => q.eq('category', category))
        .collect();
    } else {
      rooms = await ctx.db.query('chatRooms').collect();
    }
    // Phase-2: Filter out expired rooms
    rooms = rooms.filter((r) => !r.expiresAt || r.expiresAt > now);
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
// Phase-2: Returns null if room is expired
export const getRoom = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    // Phase-2: Check if room has expired
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      return null; // Treat expired room as not found
    }
    return room;
  },
});

// List messages for a room (with pagination)
export const listMessages = query({
  args: {
    roomId: v.id('chatRooms'),
    limit: v.optional(v.number()),
    before: v.optional(v.number()), // Cursor for pagination (load older messages)
  },
  handler: async (ctx, { roomId, limit = 50, before }) => {
    let query = ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId));

    // Filter for messages before the cursor (older messages)
    if (before) {
      query = query.filter((q) => q.lt(q.field('createdAt'), before));
    }

    // Filter out soft-deleted messages
    query = query.filter((q) =>
      q.or(
        q.eq(q.field('deletedAt'), undefined),
        q.eq(q.field('deletedAt'), null)
      )
    );

    const messages = await query.order('desc').take(limit + 1);
    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(0, limit) : messages;

    return {
      messages: result.reverse(), // return oldest-first for display
      hasMore,
    };
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
// Includes idempotency via clientId and rate limiting (10 messages/minute/user/room)
// Phase-2: Denies if user has active readOnly penalty
export const sendMessage = mutation({
  args: {
    roomId: v.id('chatRooms'),
    senderId: v.id('users'),
    text: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    mediaType: v.optional(v.union(v.literal('image'), v.literal('video'), v.literal('doodle'))), // For distinguishing media types
    clientId: v.optional(v.string()), // For deduplication
  },
  handler: async (ctx, { roomId, senderId, text, imageUrl, mediaType, clientId }) => {
    // 0. Phase-2: Check room exists and not expired
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      throw new Error('Room has expired');
    }

    // 1. Idempotency check via clientId
    if (clientId) {
      const existing = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_clientId', (q) =>
          q.eq('roomId', roomId).eq('clientId', clientId)
        )
        .first();
      if (existing) {
        return existing._id; // Return existing message ID (deduplicated)
      }
    }

    // 2. Verify membership
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', senderId)
      )
      .first();
    if (!membership) {
      throw new Error('Must join the room before sending messages');
    }

    // 2b. Phase-2: Check for active readOnly penalty
    const now = Date.now();
    const penalty = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', senderId)
      )
      .first();
    if (penalty && penalty.expiresAt > now) {
      throw new Error('You are in read-only mode for this room');
    }

    // 3. Rate limiting: max 10 messages per minute per user per room
    const oneMinuteAgo = now - 60000;
    const recentMessages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
      .filter((q) =>
        q.and(
          q.eq(q.field('senderId'), senderId),
          q.gt(q.field('createdAt'), oneMinuteAgo)
        )
      )
      .take(10);

    if (recentMessages.length >= 10) {
      throw new Error('Rate limit exceeded: max 10 messages per minute');
    }

    // Determine message type: use explicit mediaType if provided, otherwise infer from imageUrl
    const type = imageUrl ? (mediaType ?? 'image') : 'text';

    // Soft-mask sensitive words in text messages
    const maskedText = text ? softMaskText(text) : undefined;

    // 4. Insert message
    const messageId = await ctx.db.insert('chatRoomMessages', {
      roomId,
      senderId,
      type,
      text: maskedText,
      imageUrl: imageUrl ?? undefined,
      createdAt: now,
      clientId,
      status: 'sent',
    });

    // 5. Update room's last message info
    await ctx.db.patch(roomId, {
      lastMessageAt: now,
      lastMessageText: maskedText ?? (imageUrl ? '[Image]' : ''),
    });

    // 6. Update member's lastMessageAt for rate limiting tracking
    await ctx.db.patch(membership._id, { lastMessageAt: now });

    // 7. Auto-cleanup: Trim to TARGET_AFTER_TRIM (900) when exceeding MAX (1000)
    // RACE-SAFE: Query actual oldest messages to determine count and what to delete
    // Query up to MAX + buffer to detect if cleanup is needed
    const probeMessages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
      .order('asc')
      .take(MAX_MESSAGES_PER_ROOM + 1);

    const needsCleanup = probeMessages.length > MAX_MESSAGES_PER_ROOM;

    if (needsCleanup) {
      // Cleanup triggered: trim down to TARGET_AFTER_TRIM (900)
      // Use batch deletion loop to handle large overages efficiently
      let deletedCount = 0;
      let continueDeleting = true;

      while (continueDeleting) {
        // Fetch a batch of oldest messages
        const batch = await ctx.db
          .query('chatRoomMessages')
          .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
          .order('asc')
          .take(BATCH_DELETE_SIZE);

        // Stop if we've trimmed enough (remaining <= TARGET)
        // We need to know current count: fetch one more to check
        const checkCount = await ctx.db
          .query('chatRoomMessages')
          .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
          .order('asc')
          .take(TARGET_AFTER_TRIM + 1);

        if (checkCount.length <= TARGET_AFTER_TRIM) {
          // Already at or below target
          continueDeleting = false;
          break;
        }

        // Calculate how many to delete from this batch
        const currentCount = checkCount.length; // At least TARGET+1
        const toDelete = Math.min(batch.length, currentCount - TARGET_AFTER_TRIM);

        if (toDelete <= 0) {
          continueDeleting = false;
          break;
        }

        // Delete oldest messages from batch (never delete just-inserted message)
        for (let i = 0; i < toDelete && i < batch.length; i++) {
          const msg = batch[i];
          if (msg._id === messageId) continue; // Safety: never delete our new message
          await ctx.db.delete(msg._id);
          deletedCount++;
        }

        // Safety: prevent infinite loop if something goes wrong
        if (deletedCount > MAX_MESSAGES_PER_ROOM) {
          break;
        }
      }

      // Update room with target count
      await ctx.db.patch(roomId, { messageCount: TARGET_AFTER_TRIM });
    } else {
      // No cleanup needed, update messageCount to actual
      await ctx.db.patch(roomId, { messageCount: probeMessages.length });
    }

    return messageId;
  },
});

// Create a new chat room
// Phase-2: Sets expiresAt to createdAt + 24h (private rooms only)
export const createRoom = mutation({
  args: {
    name: v.string(),
    createdBy: v.id('users'),
    category: v.optional(v.union(v.literal('language'), v.literal('general'))),
    isDemoRoom: v.optional(v.boolean()),
  },
  handler: async (ctx, { name, createdBy, category, isDemoRoom }) => {
    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if slug already exists
    const existing = await ctx.db
      .query('chatRooms')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();

    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;
    const now = Date.now();

    // Phase-2: All user-created rooms are private and expire after 24h
    const roomId = await ctx.db.insert('chatRooms', {
      name,
      slug: finalSlug,
      category: category ?? 'general',
      isPublic: false, // Phase-2: Private rooms only
      createdAt: now,
      memberCount: 1,
      createdBy,
      isDemoRoom,
      expiresAt: now + ROOM_LIFETIME_MS, // Phase-2: 24h expiration
    });

    // Auto-join creator as owner
    await ctx.db.insert('chatRoomMembers', {
      roomId,
      userId: createdBy,
      joinedAt: now,
      role: 'owner',
    });

    return roomId;
  },
});

// Report a message in a chat room
export const reportMessage = mutation({
  args: {
    messageId: v.id('chatRoomMessages'),
    reporterId: v.id('users'),
    reason: v.string(),
  },
  handler: async (ctx, { messageId, reporterId, reason }) => {
    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    // Store report in existing reports table
    await ctx.db.insert('reports', {
      reporterId,
      reportedUserId: message.senderId,
      reason: 'harassment', // Map to existing enum
      description: `Chat room message report: ${reason}`,
      status: 'pending',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Get rooms where user is a member
// Phase-2: Filters out expired rooms
export const getRoomsForUser = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    // Get all memberships for this user
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    // Fetch room details for each membership
    const rooms = await Promise.all(
      memberships.map(async (membership) => {
        const room = await ctx.db.get(membership.roomId);
        if (!room) return null;
        // Phase-2: Filter out expired rooms
        if (room.expiresAt && room.expiresAt <= now) return null;
        return {
          ...room,
          role: membership.role,
          joinedAt: membership.joinedAt,
        };
      })
    );

    // Filter nulls and sort by lastMessageAt
    return rooms
      .filter((room): room is NonNullable<typeof room> => room !== null)
      .sort((a, b) => {
        const aTime = a.lastMessageAt ?? 0;
        const bTime = b.lastMessageAt ?? 0;
        if (bTime !== aTime) return bTime - aTime;
        return a.name.localeCompare(b.name);
      });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2: Penalty Query Functions
// ═══════════════════════════════════════════════════════════════════════════

// Get user's penalty status in a room
export const getUserPenalty = query({
  args: {
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
  },
  handler: async (ctx, { roomId, userId }) => {
    const penalty = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', userId)
      )
      .first();

    if (!penalty) return null;

    const now = Date.now();
    if (penalty.expiresAt <= now) {
      return null; // Penalty expired
    }

    return {
      type: penalty.type,
      expiresAt: penalty.expiresAt,
      remainingMs: penalty.expiresAt - now,
    };
  },
});

// Check if user has any active readOnly penalty (for blocking DMs from Chat Rooms)
export const hasAnyActivePenalty = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const penalties = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    return penalties.some((p) => p.expiresAt > now);
  },
});

// List members with penalty status
export const listMembersWithPenalties = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    const now = Date.now();
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    // Get all penalties for this room using by_room index
    const penalties = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const penaltyMap = new Map(
      penalties
        .filter((p) => p.expiresAt > now)
        .map((p) => [p.userId, p])
    );

    return members.map((m) => ({
      ...m,
      penalty: penaltyMap.get(m.userId)
        ? { type: 'readOnly' as const, expiresAt: penaltyMap.get(m.userId)!.expiresAt }
        : null,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2: Room Lifecycle Mutations
// ═══════════════════════════════════════════════════════════════════════════

// Close room (creator only) - deletes room and all messages
// Does NOT allow closing permanent/global rooms (those without expiresAt)
export const closeRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
  },
  handler: async (ctx, { roomId, userId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Prevent closing permanent/global rooms (no expiresAt means permanent)
    if (!room.expiresAt) {
      throw new Error('Cannot close permanent rooms');
    }

    // Only creator can close the room
    if (room.createdBy !== userId) {
      throw new Error('Only the room creator can close this room');
    }

    // Delete all messages (using by_room_created index, query by roomId only)
    const messages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
      .collect();

    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    // Delete all members
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    for (const member of members) {
      await ctx.db.delete(member._id);
    }

    // Delete all penalties for this room
    const penalties = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    for (const penalty of penalties) {
      await ctx.db.delete(penalty._id);
    }

    // Delete the room
    await ctx.db.delete(roomId);

    return { success: true };
  },
});

// Kick user from room (creates readOnly penalty for 24h)
// Only room creator/owner can kick
export const kickUser = mutation({
  args: {
    roomId: v.id('chatRooms'),
    kickerId: v.id('users'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, { roomId, kickerId, targetUserId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Check if kicker is the owner
    const kickerMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', kickerId)
      )
      .first();

    if (!kickerMembership || kickerMembership.role !== 'owner') {
      throw new Error('Only room owner can kick users');
    }

    // Cannot kick yourself
    if (kickerId === targetUserId) {
      throw new Error('Cannot kick yourself');
    }

    const now = Date.now();

    // Create or update penalty record
    const existingPenalty = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', targetUserId)
      )
      .first();

    if (existingPenalty) {
      // Update existing penalty with new expiration
      await ctx.db.patch(existingPenalty._id, {
        kickedAt: now,
        expiresAt: now + PENALTY_DURATION_MS,
      });
    } else {
      // Create new penalty
      await ctx.db.insert('chatRoomPenalties', {
        roomId,
        userId: targetUserId,
        type: 'readOnly',
        kickedAt: now,
        expiresAt: now + PENALTY_DURATION_MS,
      });
    }

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2: Internal Cleanup Functions (called by cron)
// ═══════════════════════════════════════════════════════════════════════════

// Internal: Cleanup expired rooms (called by cron job)
// Only deletes rooms with expiresAt set (private rooms), never permanent rooms
export const cleanupExpiredRooms = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find expired rooms (those with expiresAt <= now)
    const expiredRooms = await ctx.db
      .query('chatRooms')
      .withIndex('by_expires')
      .filter((q) =>
        q.and(
          q.neq(q.field('expiresAt'), undefined),
          q.lte(q.field('expiresAt'), now)
        )
      )
      .take(50); // Process in batches

    for (const room of expiredRooms) {
      // Delete messages (using by_room_created index)
      const messages = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created', (q) => q.eq('roomId', room._id))
        .collect();

      for (const msg of messages) {
        await ctx.db.delete(msg._id);
      }

      // Delete members
      const members = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room', (q) => q.eq('roomId', room._id))
        .collect();

      for (const member of members) {
        await ctx.db.delete(member._id);
      }

      // Delete penalties
      const penalties = await ctx.db
        .query('chatRoomPenalties')
        .withIndex('by_room', (q) => q.eq('roomId', room._id))
        .collect();

      for (const penalty of penalties) {
        await ctx.db.delete(penalty._id);
      }

      // Delete the room
      await ctx.db.delete(room._id);
    }

    return { deletedCount: expiredRooms.length };
  },
});

// Internal: Cleanup expired penalties (called by cron job)
export const cleanupExpiredPenalties = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all expired penalties
    const expiredPenalties = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_expires')
      .filter((q) => q.lte(q.field('expiresAt'), now))
      .take(100); // Process in batches

    for (const penalty of expiredPenalties) {
      await ctx.db.delete(penalty._id);
    }

    return { deletedCount: expiredPenalties.length };
  },
});
