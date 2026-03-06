import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { softMaskText } from './softMask';
import { internal } from './_generated/api';
import { asUserId } from './id';
import { hashPassword, verifyPassword, encryptPassword, decryptPassword } from './cryptoUtils';

// 24 hours in milliseconds
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PENALTY_DURATION_MS = 24 * 60 * 60 * 1000;
// Message retention constants
const MAX_MESSAGES_PER_ROOM = 1000; // Trigger cleanup when exceeded
const TARGET_AFTER_TRIM = 900;      // Target count after cleanup
const BATCH_DELETE_SIZE = 200;      // Delete in batches for efficiency

// Generate a random 6-character alphanumeric join code
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0, I/1 for clarity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

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

// ═══════════════════════════════════════════════════════════════════════════
// DEMO MODE HELPER: Resolve userId from auth or demo args
// ═══════════════════════════════════════════════════════════════════════════
import { Id } from './_generated/dataModel';
import { QueryCtx, MutationCtx } from './_generated/server';
import { api } from './_generated/api';

// ═══════════════════════════════════════════════════════════════════════════
// CONSISTENCY FIX B6: Helper to recompute memberCount from source of truth
// This prevents race conditions from stale read-modify-write patterns
// ═══════════════════════════════════════════════════════════════════════════
async function recomputeMemberCount(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>
): Promise<number> {
  const members = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  return members.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Delete room and all related data (messages, members, penalties)
// Used by closeRoom, resetMyPrivateRooms, deleteExpiredRoom, cleanupExpiredRooms
// ═══════════════════════════════════════════════════════════════════════════
async function deleteRoomFully(ctx: MutationCtx, roomId: Id<'chatRooms'>): Promise<void> {
  // Delete all messages
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

  // Delete all penalties
  const penalties = await ctx.db
    .query('chatRoomPenalties')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const penalty of penalties) {
    await ctx.db.delete(penalty._id);
  }

  // Delete the room itself
  await ctx.db.delete(roomId);
}

type DemoArgs = {
  isDemo?: boolean;
  demoUserId?: string;
};

async function resolveUserId(
  ctx: QueryCtx | MutationCtx,
  args: DemoArgs
): Promise<Id<'users'>> {
  // SECURITY FIX A1: Always require authenticated identity
  // Demo mode is permanently disabled - never trust client-provided isDemo flag
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const userId = asUserId(identity.subject);
    if (userId) return userId;
  }

  // SECURITY: Reject all unauthenticated requests
  // Demo mode fallback removed - was a security bypass vector
  throw new Error('Unauthorized: authentication required');
}

// Query to get effective userId (for client-side owner detection)
export const getEffectiveUserId = query({
  args: {
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const userId = await resolveUserId(ctx, args);
      return { userId };
    } catch {
      return { userId: null };
    }
  },
});

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

// Internal mutation: seeds default rooms (called by listRooms auto-seed)
// Idempotent: safe to run multiple times, no duplicates
export const seedDefaultRoomsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    let seededCount = 0;
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
        seededCount++;
      }
    }
    if (process.env.NODE_ENV === 'development') {
      console.log('[CHAT_ROOMS] Auto-seed completed:', { seededCount, total: DEFAULT_ROOMS.length });
    }
    return { seededCount };
  },
});

// List rooms, optionally filtered by category, sorted by most recent activity
// Phase-2: Filters out expired rooms (expiresAt < now)
// Note: Returns empty array if no rooms exist - UI handles with FALLBACK_PUBLIC_ROOMS
// To seed rooms: run `npx convex run chatRooms:ensureDefaultRooms` or use seedDefaultRoomsInternal cron
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

    // CONSISTENCY FIX B6: Recompute memberCount from source of truth
    const actualMemberCount = await recomputeMemberCount(ctx, roomId);
    await ctx.db.patch(roomId, { memberCount: actualMemberCount });

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

    // CONSISTENCY FIX B6: Recompute memberCount from source of truth
    const actualMemberCount = await recomputeMemberCount(ctx, roomId);
    await ctx.db.patch(roomId, { memberCount: actualMemberCount });
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
    audioUrl: v.optional(v.string()), // For audio messages
    mediaType: v.optional(v.union(v.literal('image'), v.literal('video'), v.literal('doodle'), v.literal('audio'))), // For distinguishing media types
    clientId: v.optional(v.string()), // For deduplication
  },
  handler: async (ctx, { roomId, senderId, text, imageUrl, audioUrl, mediaType, clientId }) => {
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

    // Determine message type: use explicit mediaType if provided, otherwise infer from media URLs
    const type = audioUrl ? 'audio' : imageUrl ? (mediaType ?? 'image') : 'text';

    // Soft-mask sensitive words in text messages
    const maskedText = text ? softMaskText(text) : undefined;

    // 4. Insert message
    const messageId = await ctx.db.insert('chatRoomMessages', {
      roomId,
      senderId,
      type,
      text: maskedText,
      imageUrl: imageUrl ?? undefined,
      audioUrl: audioUrl ?? undefined,
      createdAt: now,
      clientId,
      status: 'sent',
    });

    // 5. Update room's last message info
    await ctx.db.patch(roomId, {
      lastMessageAt: now,
      lastMessageText: maskedText ?? (audioUrl ? '[Audio]' : imageUrl ? '[Image]' : ''),
    });

    // 6. Update member's lastMessageAt for rate limiting tracking
    await ctx.db.patch(membership._id, { lastMessageAt: now });

    // 7. DETERMINISTIC RETENTION: Delete exactly (newCount - 900) oldest when >= 1000
    // Uses room.messageCount as primary counter for efficiency
    const newCount = (room.messageCount ?? 0) + 1;

    if (newCount < MAX_MESSAGES_PER_ROOM) {
      // Below threshold: just update counter
      await ctx.db.patch(roomId, { messageCount: newCount });
    } else {
      // At or above 1000: delete exactly (newCount - 900) oldest messages
      const deleteCount = newCount - TARGET_AFTER_TRIM;

      // DEV logging for retention verification
      if (process.env.NODE_ENV === 'development') {
        console.log('[RETENTION]', { roomId, newCount, deleteCount, targetFinal: TARGET_AFTER_TRIM });
      }

      // Fetch oldest messages to delete (fetch extra to handle edge case where new msg is oldest)
      const oldestMessages = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
        .order('asc')
        .take(deleteCount + 1); // +1 buffer in case new message appears in oldest

      // Delete exactly deleteCount messages, never the just-inserted one
      let deleted = 0;
      for (const msg of oldestMessages) {
        if (deleted >= deleteCount) break;
        if (msg._id === messageId) continue; // Safety: never delete new message
        try {
          await ctx.db.delete(msg._id);
          deleted++;
        } catch {
          // Silently ignore if already deleted by concurrent request
        }
      }

      // Set room messageCount to exactly 900
      await ctx.db.patch(roomId, { messageCount: TARGET_AFTER_TRIM });
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

// Phase-2: Create a private room with optional password protection (costs 1 coin)
export const createPrivateRoom = mutation({
  args: {
    name: v.string(),
    password: v.optional(v.string()),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, { name, password, isDemo, demoUserId }) => {
    // 1. Auth guard - allow demo mode bypass
    const identity = await ctx.auth.getUserIdentity();
    let createdBy: ReturnType<typeof asUserId>;
    let isDemoUser = false;

    if (identity) {
      // Real authenticated user
      const realId = asUserId(identity.subject);
      if (!realId) {
        throw new Error('Invalid user identity');
      }
      createdBy = realId;
    } else if (isDemo === true && demoUserId && demoUserId.length > 0) {
      // Demo mode - require existing demo user in users table
      isDemoUser = true;
      const demoUser = await ctx.db
        .query('users')
        .withIndex('by_demo_user_id', (q) => q.eq('demoUserId', demoUserId))
        .unique();

      if (!demoUser) {
        throw new Error('Demo user not seeded: missing users row for demoUserId=' + demoUserId);
      }
      createdBy = demoUser._id;
    } else {
      throw new Error('Unauthorized');
    }

    // 2. Check wallet balance (skip for demo users)
    let currentCoins = 0;
    if (!isDemoUser) {
      const user = await ctx.db.get(createdBy);
      if (!user) {
        throw new Error('User not found');
      }
      currentCoins = user.walletCoins ?? 0;
      if (currentCoins < 1) {
        throw new Error('Insufficient coins. You need at least 1 coin to create a private room.');
      }
    }

    // 4. Generate unique join code (max 10 retries)
    let joinCode = generateJoinCode();
    let retries = 0;
    const MAX_RETRIES = 10;
    while (retries < MAX_RETRIES) {
      const codeExists = await ctx.db
        .query('chatRooms')
        .withIndex('by_join_code', (q) => q.eq('joinCode', joinCode))
        .first();
      if (!codeExists) break;
      joinCode = generateJoinCode();
      retries++;
    }
    if (retries >= MAX_RETRIES) {
      throw new Error('Failed to generate unique join code. Please try again.');
    }

    // 5. Hash and encrypt password (only if provided)
    let passwordHash: string | undefined;
    let passwordEncrypted: string | undefined;
    if (password && password.length > 0) {
      passwordHash = await hashPassword(password);
      passwordEncrypted = await encryptPassword(password);
    }

    // 6. Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const existing = await ctx.db
      .query('chatRooms')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const now = Date.now();

    // 7. Insert private room with optional password and 24h expiration
    const roomId = await ctx.db.insert('chatRooms', {
      name,
      slug: finalSlug,
      category: 'general',
      isPublic: false,
      createdAt: now,
      memberCount: 1,
      createdBy,
      expiresAt: now + ROOM_LIFETIME_MS,
      joinCode,
      ...(passwordHash && { passwordHash }),
      ...(passwordEncrypted && { passwordEncrypted }),
    });

    // 8. Add creator as owner
    await ctx.db.insert('chatRoomMembers', {
      roomId,
      userId: createdBy,
      joinedAt: now,
      role: 'owner',
    });

    // 9. Deduct 1 coin AFTER successful room creation (skip for demo users)
    if (!isDemoUser) {
      await ctx.db.patch(createdBy, {
        walletCoins: currentCoins - 1,
      });
    }

    // 10. Schedule auto-deletion when room expires
    const expiresAt = now + ROOM_LIFETIME_MS;
    await ctx.scheduler.runAt(expiresAt, internal.chatRooms.deleteExpiredRoom, { roomId });

    return { roomId, joinCode };
  },
});

// Phase-2: Join a room by join code
export const joinRoomByCode = mutation({
  args: {
    joinCode: v.string(),
  },
  handler: async (ctx, { joinCode }) => {
    // 1. Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // 2. Normalize code to uppercase
    const normalizedCode = joinCode.toUpperCase().trim();

    // 3. Find room by join code
    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_join_code', (q) => q.eq('joinCode', normalizedCode))
      .first();

    if (!room) {
      throw new Error('Invalid join code. Room not found.');
    }

    // 4. Check if room is expired
    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      throw new Error('This room has expired.');
    }

    // 5. Check if already a member
    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
      .first();
    if (existing) {
      return { roomId: room._id, alreadyMember: true };
    }

    // 6. Join as member (skip memberCount update to avoid race)
    await ctx.db.insert('chatRoomMembers', {
      roomId: room._id,
      userId,
      joinedAt: now,
      role: 'member',
    });

    return { roomId: room._id, alreadyMember: false };
  },
});

// Phase-2: Get room by join code (for preview before joining)
export const getRoomByJoinCode = query({
  args: { joinCode: v.string() },
  handler: async (ctx, { joinCode }) => {
    const normalizedCode = joinCode.toUpperCase().trim();
    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_join_code', (q) => q.eq('joinCode', normalizedCode))
      .first();

    if (!room) return null;

    // Check if expired
    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      return null;
    }

    return {
      _id: room._id,
      name: room.name,
      memberCount: room.memberCount,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
    };
  },
});

// Phase-2: Get private rooms where current user is owner or member
// Supports demo mode via optional isDemo/demoUserId args
export const getMyPrivateRooms = query({
  args: {
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve userId (auth or demo)
    let userId: Id<'users'>;
    try {
      userId = await resolveUserId(ctx, args);
    } catch {
      return [];
    }

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
        // Filter out public rooms (only private)
        if (room.isPublic) return null;
        // Filter out expired rooms
        if (room.expiresAt && room.expiresAt <= now) return null;
        return {
          _id: room._id,
          name: room.name,
          slug: room.slug,
          category: room.category,
          isPublic: room.isPublic,
          memberCount: room.memberCount,
          lastMessageAt: room.lastMessageAt,
          lastMessageText: room.lastMessageText,
          createdAt: room.createdAt,
          expiresAt: room.expiresAt,
          joinCode: room.joinCode,
          createdBy: room.createdBy,
          role: membership.role,
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

// Close/End room (creator only) - deletes room and all messages
// Does NOT allow closing permanent/global rooms (those without expiresAt)
// Supports demo mode via optional isDemo/demoUserId args
export const closeRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    userId: v.optional(v.id('users')), // Legacy: kept for backward compat
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { roomId } = args;

    // Resolve userId: use provided userId OR resolve via auth/demo
    let userId: Id<'users'>;
    if (args.userId) {
      userId = args.userId;
    } else {
      userId = await resolveUserId(ctx, args);
    }

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

    // Delete room and all related data
    await deleteRoomFully(ctx, roomId);

    return { success: true };
  },
});

// Reset/delete all private rooms created by user (demo mode support)
export const resetMyPrivateRooms = mutation({
  args: {
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve userId (auth or demo)
    const userId = await resolveUserId(ctx, args);

    // Find all private rooms created by this user (has joinCode = private)
    const allRooms = await ctx.db.query('chatRooms').collect();
    const myPrivateRooms = allRooms.filter(
      (room) => room.joinCode && room.createdBy === userId
    );

    let deletedCount = 0;

    for (const room of myPrivateRooms) {
      await deleteRoomFully(ctx, room._id);
      deletedCount++;
    }

    return { deletedRooms: deletedCount };
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
// PHASE-2: Internal Cleanup Functions (called by cron or scheduler)
// ═══════════════════════════════════════════════════════════════════════════

// Internal: Delete a specific expired room (called by scheduler when room expires)
// This is scheduled at room creation time for precise expiration
export const deleteExpiredRoom = internalMutation({
  args: {
    roomId: v.id('chatRooms'),
  },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);

    // Room already deleted or doesn't exist
    if (!room) {
      return { deleted: false, reason: 'not_found' };
    }

    // Don't delete permanent rooms (no expiresAt)
    if (!room.expiresAt) {
      return { deleted: false, reason: 'permanent' };
    }

    // Don't delete if not yet expired (safety check)
    if (room.expiresAt > Date.now()) {
      return { deleted: false, reason: 'not_expired' };
    }

    // Delete the room and all related data
    await deleteRoomFully(ctx, roomId);

    return { deleted: true };
  },
});

// Internal: Cleanup expired rooms (called by cron job as safety net)
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
      await deleteRoomFully(ctx, room._id);
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

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2: Private Rooms - Password + Admin Approval
// ═══════════════════════════════════════════════════════════════════════════

// Get all visible private rooms (for listing to everyone)
// Returns basic info only - no password data
export const getVisiblePrivateRooms = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all non-expired private rooms
    const privateRooms = await ctx.db
      .query('chatRooms')
      .withIndex('by_public', (q) => q.eq('isPublic', false))
      .collect();

    // Filter out expired rooms and map to safe response
    return privateRooms
      .filter((room) => !room.expiresAt || room.expiresAt > now)
      .map((room) => ({
        _id: room._id,
        name: room.name,
        slug: room.slug,
        memberCount: room.memberCount,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt,
        // Don't expose: passwordHash, passwordEncrypted, joinCode
      }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  },
});

// Check user's access status for a private room
export const checkRoomAccess = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { status: 'unauthenticated' as const };
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return { status: 'unauthenticated' as const };
    }

    const room = await ctx.db.get(roomId);
    if (!room) {
      return { status: 'not_found' as const };
    }

    // Public rooms: always accessible
    if (room.isPublic) {
      return { status: 'member' as const, role: 'member' as const };
    }

    // Check if expired
    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      return { status: 'expired' as const };
    }

    // Check if banned
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      return { status: 'banned' as const };
    }

    // Check if member
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (membership) {
      return { status: 'member' as const, role: membership.role ?? 'member' };
    }

    // Check join request status
    const request = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (request) {
      if (request.status === 'pending') {
        return { status: 'pending' as const };
      }
      if (request.status === 'rejected') {
        return { status: 'rejected' as const };
      }
      // approved but not member - shouldn't happen, but handle it
      if (request.status === 'approved') {
        return { status: 'approved_pending_entry' as const };
      }
    }

    // Not a member, no request
    return { status: 'none' as const };
  },
});

// Request to join a private room (requires correct password)
export const requestJoinPrivateRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    password: v.string(),
  },
  handler: async (ctx, { roomId, password }) => {
    // 1. Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // 2. Get room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // 3. Check if public room (no password needed)
    if (room.isPublic) {
      throw new Error('This is a public room. No password required.');
    }

    // 4. Check if expired
    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      throw new Error('This room has expired.');
    }

    // 5. Check if banned
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      throw new Error('You are banned from this room.');
    }

    // 6. Check if already a member
    const existingMember = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (existingMember) {
      return { status: 'member' as const };
    }

    // 7. Verify password
    if (!room.passwordHash) {
      throw new Error('Room has no password configured.');
    }
    const passwordValid = await verifyPassword(password, room.passwordHash);
    if (!passwordValid) {
      throw new Error('Incorrect password.');
    }

    // 8. Check existing request
    const existingRequest = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return { status: 'pending' as const };
      }
      if (existingRequest.status === 'rejected') {
        throw new Error('Your request was rejected by the room owner.');
      }
      if (existingRequest.status === 'approved') {
        // Approved but not member yet - add them now
        await ctx.db.insert('chatRoomMembers', {
          roomId,
          userId,
          joinedAt: now,
          role: 'member',
        });
        // CONSISTENCY FIX B6: Recompute memberCount from source of truth
        const actualMemberCount = await recomputeMemberCount(ctx, roomId);
        await ctx.db.patch(roomId, { memberCount: actualMemberCount });
        return { status: 'member' as const };
      }
    }

    // 9. Create new pending request
    await ctx.db.insert('chatRoomJoinRequests', {
      roomId,
      userId,
      status: 'pending',
      createdAt: now,
    });

    return { status: 'pending' as const };
  },
});

// List pending join requests for a room (owner only)
export const listJoinRequests = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return [];
    }

    // Check if owner
    const room = await ctx.db.get(roomId);
    if (!room || room.createdBy !== userId) {
      return [];
    }

    // Get pending requests
    const requests = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_status', (q) => q.eq('roomId', roomId).eq('status', 'pending'))
      .collect();

    // Fetch user info for each request
    const requestsWithUsers = await Promise.all(
      requests.map(async (req) => {
        const user = await ctx.db.get(req.userId);
        return {
          _id: req._id,
          userId: req.userId,
          createdAt: req.createdAt,
          userName: user?.name ?? 'Unknown',
          userAvatar: user?.displayPrimaryPhotoUrl ?? null,
        };
      })
    );

    return requestsWithUsers;
  },
});

// Get count of pending requests (owner only, for badge)
export const getPendingRequestCount = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return 0;
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return 0;
    }

    // Check if owner
    const room = await ctx.db.get(roomId);
    if (!room || room.createdBy !== userId) {
      return 0;
    }

    const requests = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_status', (q) => q.eq('roomId', roomId).eq('status', 'pending'))
      .collect();

    return requests.length;
  },
});

// Approve a join request (owner only)
export const approveJoinRequest = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, { roomId, targetUserId }) => {
    // 1. Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // 2. Check if owner
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.createdBy !== userId) {
      throw new Error('Only room owner can approve requests');
    }

    // 3. Check if target is banned
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (ban) {
      throw new Error('User is banned from this room');
    }

    // 4. Find and update request
    const request = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!request) {
      throw new Error('Join request not found');
    }

    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: 'approved',
      updatedAt: now,
    });

    // 5. Add to members if not already
    const existingMember = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!existingMember) {
      await ctx.db.insert('chatRoomMembers', {
        roomId,
        userId: targetUserId,
        joinedAt: now,
        role: 'member',
      });
      // CONSISTENCY FIX B6: Recompute memberCount from source of truth
      const actualMemberCount = await recomputeMemberCount(ctx, roomId);
      await ctx.db.patch(roomId, { memberCount: actualMemberCount });
    }

    return { success: true };
  },
});

// Reject a join request (owner only)
export const rejectJoinRequest = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, { roomId, targetUserId }) => {
    // 1. Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // 2. Check if owner
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.createdBy !== userId) {
      throw new Error('Only room owner can reject requests');
    }

    // 3. Find and update request
    const request = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!request) {
      throw new Error('Join request not found');
    }

    await ctx.db.patch(request._id, {
      status: 'rejected',
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Kick and ban a member (owner only)
export const kickAndBanMember = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, { roomId, targetUserId }) => {
    // 1. Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // 2. Check if owner
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.createdBy !== userId) {
      throw new Error('Only room owner can kick members');
    }

    // 3. Cannot kick yourself
    if (targetUserId === userId) {
      throw new Error('Cannot kick yourself');
    }

    const now = Date.now();

    // 4. Remove from members
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (membership) {
      await ctx.db.delete(membership._id);
      // CONSISTENCY FIX B6: Recompute memberCount from source of truth
      const actualMemberCount = await recomputeMemberCount(ctx, roomId);
      await ctx.db.patch(roomId, { memberCount: actualMemberCount });
    }

    // 5. Add to bans
    const existingBan = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!existingBan) {
      await ctx.db.insert('chatRoomBans', {
        roomId,
        userId: targetUserId,
        bannedAt: now,
        bannedBy: userId,
      });
    }

    // 6. Update any existing request to rejected
    const request = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (request) {
      await ctx.db.patch(request._id, {
        status: 'rejected',
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Get room password (owner only, returns decrypted)
// Supports demo mode via optional isDemo/demoUserId args
export const getRoomPassword = query({
  args: {
    roomId: v.id('chatRooms'),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { roomId } = args;

    // Resolve userId (auth or demo)
    const userId = await resolveUserId(ctx, args);

    // Get room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Check if owner
    if (room.createdBy !== userId) {
      throw new Error('Only room owner can view password');
    }

    // Decrypt and return password
    if (!room.passwordEncrypted) {
      return { password: null };
    }

    const password = await decryptPassword(room.passwordEncrypted);
    return { password };
  },
});

// Check if user is room owner (for UI gating)
export const isRoomOwner = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return false;
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return false;
    }

    const room = await ctx.db.get(roomId);
    if (!room) {
      return false;
    }

    return room.createdBy === userId;
  },
});

// Get room info including whether it's private (for UI)
export const getRoomInfo = query({
  args: { roomId: v.id('chatRooms') },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) {
      return null;
    }

    return {
      _id: room._id,
      name: room.name,
      slug: room.slug,
      isPublic: room.isPublic,
      memberCount: room.memberCount,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      createdBy: room.createdBy,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USER ROOM PREFERENCES: Muting + Reports (Convex-backed persistence)
// ═══════════════════════════════════════════════════════════════════════════

// Get user's room preference (muted status)
export const getUserRoomPref = query({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { muted: false };
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return { muted: false };
    }

    // Look up preference
    const pref = await ctx.db
      .query('userRoomPrefs')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomId))
      .first();

    return { muted: pref?.muted ?? false };
  },
});

// Set user's room muted status
export const setUserRoomMuted = mutation({
  args: {
    roomId: v.string(),
    muted: v.boolean(),
  },
  handler: async (ctx, { roomId, muted }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    const now = Date.now();

    // Check if preference exists
    const existing = await ctx.db
      .query('userRoomPrefs')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomId))
      .first();

    if (existing) {
      // Update existing preference
      await ctx.db.patch(existing._id, {
        muted,
        updatedAt: now,
      });
    } else {
      // Create new preference
      await ctx.db.insert('userRoomPrefs', {
        userId,
        roomId,
        muted,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Check if user has reported a room
export const hasReportedRoom = query({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { reported: false };
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      return { reported: false };
    }

    // Look up report
    const report = await ctx.db
      .query('userRoomReports')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomId))
      .first();

    return { reported: !!report };
  },
});

// Mark a room as reported (idempotent)
export const markReportedRoom = mutation({
  args: {
    roomId: v.string(),
  },
  handler: async (ctx, { roomId }) => {
    // Auth guard
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }
    const userId = asUserId(identity.subject);
    if (!userId) {
      throw new Error('Invalid user identity');
    }

    // Check if already reported
    const existing = await ctx.db
      .query('userRoomReports')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomId))
      .first();

    if (existing) {
      // Already reported - idempotent
      return { success: true, alreadyReported: true };
    }

    // Create new report record
    await ctx.db.insert('userRoomReports', {
      userId,
      roomId,
      createdAt: Date.now(),
    });

    return { success: true, alreadyReported: false };
  },
});

// Seed demo user for testing (run once via: npx convex run chatRooms:seedDemoUser)
export const seedDemoUser = mutation({
  args: {},
  handler: async (ctx) => {
    const demoUserId = 'demo_manmohan_gmain_com';

    // Check if already exists
    const existing = await ctx.db
      .query('users')
      .withIndex('by_demo_user_id', (q) => q.eq('demoUserId', demoUserId))
      .unique();

    if (existing) {
      return { status: 'already_exists', id: existing._id };
    }

    const now = Date.now();
    const id = await ctx.db.insert('users', {
      name: 'Demo User',
      dateOfBirth: '1990-01-01',
      gender: 'other',
      bio: 'Demo user for testing',
      isVerified: false,
      demoUserId: demoUserId,
      lookingFor: ['other'],
      relationshipIntent: ['figuring_out'],
      activities: [],
      minAge: 18,
      maxAge: 99,
      maxDistance: 100,
      subscriptionTier: 'free',
      incognitoMode: false,
      likesRemaining: 100,
      superLikesRemaining: 5,
      messagesRemaining: 100,
      rewindsRemaining: 5,
      boostsRemaining: 1,
      walletCoins: 100,
      likesResetAt: now,
      superLikesResetAt: now,
      messagesResetAt: now,
      lastActive: now,
      createdAt: now,
      onboardingCompleted: true,
      notificationsEnabled: false,
      isActive: true,
      isBanned: false,
    });

    return { status: 'created', id };
  },
});
