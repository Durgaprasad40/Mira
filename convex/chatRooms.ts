import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { softMaskText } from './softMask';
import { internal } from './_generated/api';
import { asUserId } from './id';
import { hashPassword, verifyPassword, encryptPassword, decryptPassword } from './cryptoUtils';
import { resolveUserIdByAuthId } from './helpers';
import { tryEarnCoinInRoom } from './coinEarning';

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

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA UPLOAD: Generate pre-signed upload URL for chat room media
// CR-009 FIX: Enables cloud storage upload for images/audio/video
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a pre-signed upload URL for chat room media.
 * Called by frontend before uploading image/audio/video files.
 * Returns a short-lived URL that can be used with HTTP POST to upload.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Get public URL for a storage ID.
 * Used to resolve storage IDs to URLs after upload.
 */
export const getStorageUrl = query({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { storageId }) => {
    const url = await ctx.storage.getUrl(storageId);
    return { url };
  },
});

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
  args: DemoArgs & { authUserId?: string }
): Promise<Id<'users'>> {
  // SECURITY FIX: Use app's custom session-based auth pattern
  // Convex-native auth (ctx.auth.getUserIdentity) is not configured in this app
  const authId = args.authUserId || args.demoUserId;

  if (!authId || authId.trim().length === 0) {
    throw new Error('Unauthorized: authentication required');
  }

  const userId = await resolveUserIdByAuthId(ctx, authId);
  if (!userId) {
    throw new Error('Unauthorized: user not found');
  }

  return userId;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY AUTHORIZATION HELPERS (Phase-2 Audit Fix)
// Read vs Send access separation:
// - Read Access: view room, messages, members (blocked by bans, not penalties)
// - Send Access: send messages/media (blocked by bans AND send-blocking penalties)
// ═══════════════════════════════════════════════════════════════════════════

// Penalty types that block sending (but allow reading)
const SEND_BLOCKING_PENALTY_TYPES = ['readOnly', 'muted', 'send_blocked'] as const;

// ═══════════════════════════════════════════════════════════════════════════
// ROLE SYSTEM: Permission hierarchy and helpers
// Role levels: owner (3) > admin (2) > member (1)
// ═══════════════════════════════════════════════════════════════════════════

type MemberRole = 'owner' | 'admin' | 'member';

// BACKWARD COMPAT: 'mod' is legacy alias for 'admin' (existing DB records may have 'mod')
// Migration to 'admin' can happen later; this ensures existing mods retain permissions
const ROLE_LEVEL: Record<string, number> = {
  owner: 3,
  admin: 2,
  mod: 2,     // Legacy alias for admin - DO NOT REMOVE until migration complete
  member: 1,
};

/**
 * Get numeric role level for comparison.
 * Treats undefined/null as 'member' for backward compatibility.
 */
function getRoleLevel(role: string | undefined | null): number {
  if (!role) return ROLE_LEVEL.member;
  return ROLE_LEVEL[role as MemberRole] ?? ROLE_LEVEL.member;
}

/**
 * Check if actor can kick target based on role hierarchy.
 * - Owners can kick anyone except themselves
 * - Admins can kick members only (not other admins or owners)
 * - Members cannot kick anyone
 */
function canKickUser(actorRole: string | undefined, targetRole: string | undefined): boolean {
  const actorLevel = getRoleLevel(actorRole);
  const targetLevel = getRoleLevel(targetRole);

  // Must be at least admin to kick
  if (actorLevel < ROLE_LEVEL.admin) return false;

  // Owner can kick anyone (except themselves, checked separately)
  if (actorLevel === ROLE_LEVEL.owner) return true;

  // Admin can only kick members (lower level)
  return actorLevel > targetLevel;
}

/**
 * Check if actor can delete target's message based on role hierarchy.
 * - Owners can delete any message
 * - Admins can delete member messages (not owner messages)
 * - Members can only delete their own messages
 */
function canDeleteMessage(actorRole: string | undefined, messageOwnerRole: string | undefined, isOwnMessage: boolean): boolean {
  // Anyone can delete their own messages
  if (isOwnMessage) return true;

  const actorLevel = getRoleLevel(actorRole);
  const ownerLevel = getRoleLevel(messageOwnerRole);

  // Must be at least admin to delete others' messages
  if (actorLevel < ROLE_LEVEL.admin) return false;

  // Owner can delete any message
  if (actorLevel === ROLE_LEVEL.owner) return true;

  // Admin can delete messages from lower roles only
  return actorLevel > ownerLevel;
}

/**
 * Check if actor can promote/demote target.
 * Only owners can promote/demote.
 */
function canManageRoles(actorRole: string | undefined): boolean {
  return getRoleLevel(actorRole) === ROLE_LEVEL.owner;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM ADMIN: Moderation authority for public/system rooms
// Public rooms are platform-owned (no createdBy), moderated by platform admins.
// Private rooms are creator-owned, moderated by owner/admin hierarchy.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a room is platform-owned (public room without a creator).
 * Platform-owned rooms are moderated by platform admins, not room owners.
 */
function isPlatformOwnedRoom(room: { isPublic: boolean; createdBy?: Id<'users'> | null }): boolean {
  return room.isPublic === true && !room.createdBy;
}

/**
 * Check if actor can kick target in a specific room context.
 * - Private rooms: Uses role hierarchy (owner > admin > member)
 * - Public/platform rooms: Platform admins (user.isAdmin) can kick anyone
 */
function canKickInRoom(
  actorRole: string | undefined,
  targetRole: string | undefined,
  isPlatformAdmin: boolean,
  isPlatformRoom: boolean
): boolean {
  // Platform admins can kick anyone in platform-owned rooms
  if (isPlatformRoom && isPlatformAdmin) {
    return true;
  }

  // Otherwise use standard role hierarchy
  return canKickUser(actorRole, targetRole);
}

/**
 * Check if actor can delete target's message in a specific room context.
 * - Private rooms: Uses role hierarchy (owner > admin > member)
 * - Public/platform rooms: Platform admins (user.isAdmin) can delete any message
 */
function canDeleteInRoom(
  actorRole: string | undefined,
  messageOwnerRole: string | undefined,
  isOwnMessage: boolean,
  isPlatformAdmin: boolean,
  isPlatformRoom: boolean
): boolean {
  // Anyone can delete their own messages
  if (isOwnMessage) return true;

  // Platform admins can delete any message in platform-owned rooms
  if (isPlatformRoom && isPlatformAdmin) {
    return true;
  }

  // Otherwise use standard role hierarchy
  return canDeleteMessage(actorRole, messageOwnerRole, isOwnMessage);
}

/**
 * Requires authenticated user identity.
 * Uses the app's custom session-based auth pattern (resolveUserIdByAuthId).
 *
 * @param ctx - Convex query/mutation context
 * @param authUserId - Auth identifier from frontend (validated server-side)
 * @returns The resolved Convex userId
 * @throws Error if authUserId is invalid or user not found
 */
async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  authUserId: string | undefined
): Promise<Id<'users'>> {
  if (!authUserId || authUserId.trim().length === 0) {
    throw new Error('Unauthorized: authentication required');
  }

  // Use the app's standard auth resolution pattern
  const userId = await resolveUserIdByAuthId(ctx, authUserId);
  if (!userId) {
    throw new Error('Unauthorized: user not found');
  }

  return userId;
}

/**
 * Requires valid room membership for READ access.
 *
 * Checks (in order):
 * 1. Authenticated user (via resolveUserIdByAuthId)
 * 2. Room exists
 * 3. Room not expired
 * 4. User is NOT banned (chatRoomBans)
 * 5. User IS a current member (chatRoomMembers)
 *
 * Does NOT check penalties - penalties only block sending, not reading.
 *
 * @param ctx - Convex query/mutation context
 * @param roomId - Room to check access for
 * @param authUserId - Auth identifier from frontend (validated server-side)
 * @returns { userId, room, membership } if authorized
 * @throws Error if not authorized
 */
async function requireRoomReadAccess(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  authUserId: string | undefined
): Promise<{ userId: Id<'users'>; room: any; membership: any }> {
  // 1. Require authenticated user (uses resolveUserIdByAuthId)
  const userId = await requireAuthenticatedUser(ctx, authUserId);

  // 2. Check room exists
  const room = await ctx.db.get(roomId);
  if (!room) {
    throw new Error('Room not found');
  }

  // 3. Check room is not expired
  const now = Date.now();
  if (room.expiresAt && room.expiresAt <= now) {
    throw new Error('Room has expired');
  }

  // 4. Check user is not banned from this room
  const ban = await ctx.db
    .query('chatRoomBans')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (ban) {
    throw new Error('Access denied: you are banned from this room');
  }

  // 5. Check user has active membership
  const membership = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (!membership) {
    throw new Error('Access denied: you must join this room first');
  }

  return { userId, room, membership };
}

/**
 * Requires valid room membership for SEND access.
 *
 * Checks:
 * 1. All of requireRoomReadAccess
 * 2. User has no active send-blocking penalty (readOnly, muted, send_blocked)
 *
 * @param ctx - Convex query/mutation context
 * @param roomId - Room to check access for
 * @param authUserId - Auth identifier from frontend (validated server-side)
 * @returns { userId, room, membership } if authorized
 * @throws Error if not authorized
 */
async function requireRoomSendAccess(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  authUserId: string | undefined
): Promise<{ userId: Id<'users'>; room: any; membership: any }> {
  // 1. Check read access first (auth, room exists, not expired, not banned, is member)
  const { userId, room, membership } = await requireRoomReadAccess(ctx, roomId, authUserId);

  // 2. Check user has no active send-blocking penalty
  const now = Date.now();
  const penalty = await ctx.db
    .query('chatRoomPenalties')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();

  if (penalty && penalty.expiresAt > now) {
    // Only block if penalty type is a send-blocking type
    const penaltyType = penalty.type as string;
    if (SEND_BLOCKING_PENALTY_TYPES.includes(penaltyType as any)) {
      throw new Error('You are restricted from sending messages in this room');
    }
  }

  return { userId, room, membership };
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
    return { seededCount };
  },
});

// List rooms, optionally filtered by category, sorted by most recent activity
// Phase-2: Filters out expired rooms (expiresAt < now)
// Note: Returns empty array if no rooms exist - UI handles with FALLBACK_PUBLIC_ROOMS
// To seed rooms: run `npx convex run chatRooms:ensureDefaultRooms` or use seedDefaultRoomsInternal cron
//
// LIVE PRESENCE: Returns activeUserCount (real-time presence) instead of memberCount for display.
// Users are counted as ACTIVE if their lastHeartbeatAt is within PRESENCE_ONLINE_THRESHOLD_MS.
// memberCount is still computed for backwards compatibility but activeUserCount is primary.
export const listRooms = query({
  args: {
    category: v.optional(v.union(v.literal('language'), v.literal('general'))),
  },
  handler: async (ctx, { category }) => {
    const now = Date.now();
    const onlineThreshold = now - PRESENCE_ONLINE_THRESHOLD_MS;

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
    // ISSUE-2 FIX: Filter to only PUBLIC rooms for homepage general/language lists
    // Private rooms should only appear in getMyPrivateRooms query results
    rooms = rooms.filter((r) => r.isPublic === true);

    // LIVE PRESENCE: Compute activeUserCount from chatRoomPresence table
    // This shows REAL-TIME active users, not total membership
    // DUPLICATE-FIX: Count DISTINCT userIds only (same user on multiple devices = 1)
    const roomsWithLiveCounts = await Promise.all(
      rooms.map(async (room) => {
        // Get all presence records for this room
        const presenceRecords = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();

        // Count only ACTIVE users (heartbeat within threshold)
        // DUPLICATE-FIX: Use Set to count distinct userIds
        const activeUserIds = new Set(
          presenceRecords
            .filter((p) => p.lastHeartbeatAt >= onlineThreshold)
            .map((p) => p.userId.toString())
        );
        const activeUserCount = activeUserIds.size;

        // Keep memberCount for backwards compatibility (access control uses this)
        const members = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();

        return {
          ...room,
          activeUserCount,           // LIVE: Real-time presence count
          memberCount: members.length, // Legacy: Total membership (for access control)
        };
      })
    );

    // SORTING: Sort by activeUserCount DESC (most active first), then alphabetical ASC
    // General rooms (Global, India) are pinned: Global first, then India, then by activeUserCount
    roomsWithLiveCounts.sort((a, b) => {
      // Pin Global first within general category
      if (a.slug === 'global' && b.slug !== 'global') return -1;
      if (b.slug === 'global' && a.slug !== 'global') return 1;
      // Pin India second within general category
      if (a.slug === 'india' && b.slug !== 'india' && b.slug !== 'global') return -1;
      if (b.slug === 'india' && a.slug !== 'india' && a.slug !== 'global') return 1;

      // Primary sort: activeUserCount DESC (higher count first)
      if (b.activeUserCount !== a.activeUserCount) {
        return b.activeUserCount - a.activeUserCount;
      }
      // Tie-breaker: alphabetical ASC
      return a.name.localeCompare(b.name);
    });
    return roomsWithLiveCounts;
  },
});

// Get a single room by slug
// SECURITY: Public rooms return minimal public info; private rooms require membership
export const getRoomBySlug = query({
  args: {
    slug: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { slug, authUserId }) => {
    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();

    if (!room) return null;

    // Check if room is expired
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      return null;
    }

    // For public rooms, return minimal public info without auth
    if (room.isPublic) {
      return {
        _id: room._id,
        name: room.name,
        slug: room.slug,
        category: room.category,
        isPublic: room.isPublic,
        memberCount: room.memberCount,
        lastMessageAt: room.lastMessageAt,
      };
    }

    // For private rooms, require read access (authUserId required)
    try {
      await requireRoomReadAccess(ctx, room._id, authUserId);
      return room;
    } catch {
      // User doesn't have access to this private room
      return null;
    }
  },
});

// Get a single room by ID
// Phase-2: Returns null if room is expired
export const getRoom = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    const { room } = await requireRoomReadAccess(ctx, roomId, authUserId);
    return room;
  },
});

// List messages for a room (with pagination)
// CHAT ROOM IDENTITY: Includes sender chat room profile (nickname, avatar) for each message
export const listMessages = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
    limit: v.optional(v.number()),
    before: v.optional(v.number()), // Cursor for pagination (load older messages)
  },
  handler: async (ctx, { roomId, authUserId, limit = 50, before }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, authUserId);

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

    // CHAT ROOM IDENTITY: Batch fetch sender profiles for all messages
    // PHOTO-URL-FIX: Also fetch user record and primary photos for fallback chain
    const senderIds = [...new Set(result.map((m) => m.senderId))];
    const senderProfiles = await Promise.all(
      senderIds.map(async (senderId) => {
        const [profile, user, primaryPhoto] = await Promise.all([
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', senderId))
            .first(),
          ctx.db.get(senderId),
          ctx.db
            .query('photos')
            .withIndex('by_user', (q) => q.eq('userId', senderId))
            .filter((q) => q.eq(q.field('isPrimary'), true))
            .first(),
        ]);
        return { senderId, profile, user, primaryPhoto };
      })
    );
    // PHOTO-URL-FIX: Batch-resolve primary photo URLs via storage (URLs can expire)
    const photosToResolve = senderProfiles.filter(
      ({ profile, primaryPhoto }) => !profile?.avatarUrl && primaryPhoto?.storageId
    );
    const resolvedPhotoUrls = await Promise.all(
      photosToResolve.map(({ primaryPhoto }) => ctx.storage.getUrl(primaryPhoto!.storageId))
    );
    const resolvedUrlMap = new Map(
      photosToResolve.map(({ senderId }, i) => [senderId.toString(), resolvedPhotoUrls[i]])
    );

    const profileMap = new Map(
      senderProfiles.map(({ senderId, profile, user, primaryPhoto }) => {
        // Avatar resolution chain: chatRoomProfile -> primary photo (storage) -> null
        const chatRoomAvatarUrl = profile?.avatarUrl;
        const isLocalFileAvatar = chatRoomAvatarUrl?.startsWith('file://') || chatRoomAvatarUrl?.startsWith('content://');

        // Use chatRoomProfile avatar if it's a valid https URL, otherwise fallback to primary photo
        let avatarUrl: string | null = null;
        if (chatRoomAvatarUrl && !isLocalFileAvatar) {
          avatarUrl = chatRoomAvatarUrl;
        } else {
          // Fallback: check resolved primary photo URL
          const resolvedUrl = resolvedUrlMap.get(senderId.toString());
          if (resolvedUrl) {
            avatarUrl = resolvedUrl;
          }
        }

        return [
          senderId.toString(),
          {
            nickname: profile?.nickname ?? 'Anonymous',
            avatarUrl,
            // CACHE-BUST-FIX: Include profile updatedAt for image cache invalidation
            avatarVersion: profile?.updatedAt ?? 0,
            // AVATAR-BORDER-FIX: Include gender for consistent avatar border color
            gender: user?.gender as 'male' | 'female' | 'other' | undefined,
          },
        ];
      })
    );

    // Enrich messages with sender profile data
    const enrichedMessages = result.map((msg) => {
      const senderProfile = profileMap.get(msg.senderId.toString());
      return {
        ...msg,
        // CHAT ROOM IDENTITY: Use nickname/avatar from chatRoomProfiles (NOT main profile)
        senderNickname: senderProfile?.nickname ?? 'Anonymous',
        senderAvatarUrl: senderProfile?.avatarUrl ?? null,
        // CACHE-BUST-FIX: Include version for image cache invalidation
        senderAvatarVersion: senderProfile?.avatarVersion ?? 0,
        // AVATAR-BORDER-FIX: Include gender for consistent avatar border color
        senderGender: senderProfile?.gender ?? null,
      };
    });

    return {
      messages: enrichedMessages.reverse(), // return oldest-first for display
      hasMore,
    };
  },
});

// List members of a room
export const listMembers = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, authUserId);

    return await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();
  },
});

// List members of a room WITH profile data (for UI display)
// Returns displayName, avatar, age, gender for each member
// PERFORMANCE: Limited to 50 members to prevent slow queries in large rooms
// PRESENCE RULES:
//   - Online: lastActive within 2 minutes
//   - Offline: lastActive between 2 min and 3 hours
//   - Hidden: lastActive older than 3 hours (not returned)
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes = Online
const VISIBILITY_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours = max visibility window
const MAX_MEMBERS_TO_FETCH = 50;

export const listMembersWithProfiles = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, authUserId);

    const now = Date.now();

    // Limit to MAX_MEMBERS_TO_FETCH to prevent performance issues
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(MAX_MEMBERS_TO_FETCH);

    // CHAT ROOM IDENTITY: Use chatRoomProfiles for display (separate from main profile)
    // Fallback to user record for age/gender, and to primary photo for avatar
    const membersWithProfiles = await Promise.all(
      members.map(async (member) => {
        const [chatRoomProfile, user, primaryPhoto] = await Promise.all([
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', member.userId))
            .first(),
          ctx.db.get(member.userId),
          // AVATAR-FIX: Query primary photo as fallback when chatRoomProfile has no avatar
          ctx.db
            .query('photos')
            .withIndex('by_user', (q) => q.eq('userId', member.userId))
            .filter((q) => q.eq(q.field('isPrimary'), true))
            .first(),
        ]);

        // Determine "recently active" status from users.lastActive
        // Use joinedAt as fallback for users who just joined but have no lastActive yet
        const lastActive = user?.lastActive ?? member.joinedAt;
        const timeSinceActive = now - lastActive;

        // PRESENCE-FILTER FIX: Skip members older than 3 hours (not visible anywhere)
        if (timeSinceActive > VISIBILITY_MAX_AGE_MS) {
          return null;
        }

        const isOnline = timeSinceActive <= ONLINE_THRESHOLD_MS;

        // Calculate age from DOB
        let age = 0;
        if (user?.dateOfBirth) {
          const birthDate = new Date(user.dateOfBirth);
          const today = new Date();
          age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
        }

        // Avatar resolution chain: chatRoomProfile -> primary photo (storage) -> undefined
        const chatRoomAvatarUrl = chatRoomProfile?.avatarUrl;
        const isLocalFileAvatar = chatRoomAvatarUrl?.startsWith('file://') || chatRoomAvatarUrl?.startsWith('content://');

        // Use chatRoomProfile avatar if it's a valid https URL, otherwise fallback to primary photo
        let resolvedAvatarUrl: string | undefined = undefined;
        if (chatRoomAvatarUrl && !isLocalFileAvatar) {
          resolvedAvatarUrl = chatRoomAvatarUrl;
        } else if (primaryPhoto?.storageId) {
          // Fallback: resolve primary photo from storage
          const photoUrl = await ctx.storage.getUrl(primaryPhoto.storageId);
          if (photoUrl) {
            resolvedAvatarUrl = photoUrl;
          }
        }

        return {
          id: member.userId,
          // CHAT ROOM IDENTITY: Use nickname from chatRoomProfiles (NOT main profile)
          displayName: chatRoomProfile?.nickname ?? 'Anonymous',
          // PHOTO-URL-FIX: Full fallback chain for avatar
          avatar: resolvedAvatarUrl,
          // CACHE-BUST-FIX: Include version for image cache invalidation
          avatarVersion: chatRoomProfile?.updatedAt ?? 0,
          // Age/gender from user record (not exposing main profile name/photo)
          age,
          gender: user?.gender ?? '',
          bio: chatRoomProfile?.bio ?? undefined,
          joinedAt: member.joinedAt,
          role: member.role ?? 'member',
          // PRESENCE STATUS: Online if within 2 min, Offline if within 3 hours
          isOnline,
          // For "last seen" display in panel
          lastActive,
        };
      })
    );

    // PRESENCE-FILTER FIX: Remove null entries (members older than 3 hours)
    return membersWithProfiles.filter((m): m is NonNullable<typeof m> => m !== null);
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
// CR-010 FIX: Auth hardening - verify caller identity and check bans before joining
export const joinRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(), // CR-010: Auth verification required
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // CR-010 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // CR-010 FIX: Check if user is banned from this room BEFORE allowing join
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      throw new Error('Access denied: you are banned from this room');
    }

    const now = Date.now();

    // MEMBER-STRIP FIX: Always update lastActive so user appears online in room
    await ctx.db.patch(userId, { lastActive: now });

    // Check if already a member (idempotent)
    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (existing) return existing._id;

    const memberId = await ctx.db.insert('chatRoomMembers', {
      roomId,
      userId,
      joinedAt: now,
      role: 'member', // ROLE SYSTEM: Default role for public room joins
    });

    // CONSISTENCY FIX B6: Recompute memberCount from source of truth
    const actualMemberCount = await recomputeMemberCount(ctx, roomId);
    await ctx.db.patch(roomId, { memberCount: actualMemberCount });

    return memberId;
  },
});

// Leave a room
// Safety: Deletes ALL matching membership rows (handles duplicates) and is fully idempotent
// CR-011 FIX: Auth hardening - verify caller can only leave for themselves
export const leaveRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(), // CR-011: Auth verification required
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // CR-011 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Collect ALL matching membership rows (handles edge case of duplicates)
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .collect();

    // Delete ALL matching rows (idempotent - OK if none exist)
    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }

    // RACE CONDITION FIX: Room may have been deleted by closeRoom before we get here
    const room = await ctx.db.get(roomId);
    if (!room) {
      // Room was ended/deleted - nothing to update, return safely
      return;
    }

    // CONSISTENCY FIX B6: Always recompute memberCount from source of truth
    const actualMemberCount = await recomputeMemberCount(ctx, roomId);
    await ctx.db.patch(roomId, { memberCount: actualMemberCount });
  },
});

// Send a message to a room (must be a member)
// Includes idempotency via clientId and rate limiting (10 messages/minute/user/room)
// SECURITY: Requires send access (auth + membership + not banned + no send-blocking penalty)
// CR-009 FIX: Accepts storage IDs for media and resolves to URLs server-side
export const sendMessage = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
    senderId: v.id('users'),
    text: v.optional(v.string()),
    // CR-009 FIX: Accept either URL (demo mode/legacy) or storage ID (real upload)
    imageUrl: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.id('_storage')), // CR-009: For uploaded images
    audioStorageId: v.optional(v.id('_storage')), // CR-009: For uploaded audio
    mediaType: v.optional(v.union(v.literal('image'), v.literal('video'), v.literal('doodle'), v.literal('audio'))),
    clientId: v.optional(v.string()),
    // @mention tagging support
    mentions: v.optional(v.array(v.object({
      userId: v.id('users'),
      nickname: v.string(),
      startIndex: v.number(),
      endIndex: v.number(),
    }))),
    // Reply-to-message support
    replyToMessageId: v.optional(v.id('chatRoomMessages')),
  },
  handler: async (ctx, { roomId, authUserId, senderId, text, imageUrl, audioUrl, imageStorageId, audioStorageId, mediaType, clientId, mentions, replyToMessageId }) => {
    // 0. SECURITY: Require send access (auth + membership + not banned + no send-blocking penalty)
    const { userId, room, membership } = await requireRoomSendAccess(ctx, roomId, authUserId);

    // SECURITY: Verify authenticated user matches senderId parameter
    if (userId !== senderId) {
      throw new Error('Unauthorized: cannot send messages as another user');
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

    // 2. Rate limiting: max 10 messages per minute per user per room
    const now = Date.now();
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

    // CR-009 FIX: Resolve storage IDs to URLs (for real uploads)
    // Priority: storageId > direct URL (storageId is preferred for real mode)
    let resolvedImageUrl = imageUrl;
    let resolvedAudioUrl = audioUrl;

    if (imageStorageId) {
      const url = await ctx.storage.getUrl(imageStorageId);
      if (!url) {
        throw new Error('Invalid image storage reference');
      }
      resolvedImageUrl = url;
    }

    if (audioStorageId) {
      const url = await ctx.storage.getUrl(audioStorageId);
      if (!url) {
        throw new Error('Invalid audio storage reference');
      }
      resolvedAudioUrl = url;
    }

    // Determine message type: use explicit mediaType if provided, otherwise infer from media URLs
    const type = resolvedAudioUrl ? 'audio' : resolvedImageUrl ? (mediaType ?? 'image') : 'text';

    // Soft-mask sensitive words in text messages
    const maskedText = text ? softMaskText(text) : undefined;

    // 4. Validate and filter mentions (max 3 per message, must be room members, no self-mention)
    let validatedMentions: typeof mentions = undefined;
    if (mentions && mentions.length > 0) {
      // Anti-spam: max 3 mentions per message
      const limitedMentions = mentions.slice(0, 3);

      // Validate each mentioned user is a room member
      const validMentions = [];
      for (const mention of limitedMentions) {
        // Skip self-mentions
        if (mention.userId === senderId) continue;

        // Check if user is a room member
        const memberCheck = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) =>
            q.eq('roomId', roomId).eq('userId', mention.userId)
          )
          .first();

        if (memberCheck) {
          validMentions.push(mention);
        }
      }
      validatedMentions = validMentions.length > 0 ? validMentions : undefined;
    }

    // 5. Validate and resolve reply-to-message data
    let replyData: {
      replyToMessageId: typeof replyToMessageId;
      replyToSenderNickname: string | undefined;
      replyToSnippet: string | undefined;
      replyToType: 'text' | 'image' | 'video' | 'doodle' | 'audio' | undefined;
    } = {
      replyToMessageId: undefined,
      replyToSenderNickname: undefined,
      replyToSnippet: undefined,
      replyToType: undefined,
    };

    if (replyToMessageId) {
      // Fetch the original message
      const originalMessage = await ctx.db.get(replyToMessageId);

      // Validate: message exists, is in same room, and not deleted
      if (originalMessage && originalMessage.roomId === roomId && !originalMessage.deletedAt) {
        // Get original sender's chat-room nickname
        const originalSenderProfile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', originalMessage.senderId))
          .first();
        const originalNickname = originalSenderProfile?.nickname ?? 'Anonymous';

        // FLATTEN-REPLY: Create snippet from ONLY the message's OWN text (max 100 chars)
        // or media label. Never include nested replyToSnippet content.
        // This ensures single-level reply preview (no stacking of quote bars)
        let snippet: string | undefined;
        if (originalMessage.text) {
          // Use only originalMessage.text, NOT originalMessage.replyToSnippet
          snippet = originalMessage.text.length > 100
            ? originalMessage.text.slice(0, 97) + '...'
            : originalMessage.text;
        } else if (originalMessage.type === 'image') {
          snippet = 'Photo';
        } else if (originalMessage.type === 'video') {
          snippet = 'Video';
        } else if (originalMessage.type === 'doodle') {
          snippet = 'Doodle';
        } else if (originalMessage.type === 'audio') {
          snippet = 'Voice message';
        }

        replyData = {
          replyToMessageId,
          replyToSenderNickname: originalNickname,
          replyToSnippet: snippet,
          replyToType: originalMessage.type === 'system' ? undefined : originalMessage.type,
        };
      }
      // If message doesn't exist or is deleted, we silently ignore the reply
      // (message still sends, just without reply attachment)
    }

    // 6. Insert message with resolved URLs, mentions, and reply data
    const messageId = await ctx.db.insert('chatRoomMessages', {
      roomId,
      senderId,
      type,
      text: maskedText,
      imageUrl: resolvedImageUrl ?? undefined,
      audioUrl: resolvedAudioUrl ?? undefined,
      createdAt: now,
      clientId,
      status: 'sent',
      mentions: validatedMentions,
      // Reply-to fields
      replyToMessageId: replyData.replyToMessageId,
      replyToSenderNickname: replyData.replyToSenderNickname,
      replyToSnippet: replyData.replyToSnippet,
      replyToType: replyData.replyToType,
    });

    // 5. Update room's last message info
    await ctx.db.patch(roomId, {
      lastMessageAt: now,
      lastMessageText: maskedText ?? (resolvedAudioUrl ? '[Audio]' : resolvedImageUrl ? '[Image]' : ''),
    });

    // 6. Update member's lastMessageAt for rate limiting tracking
    await ctx.db.patch(membership._id, { lastMessageAt: now });

    // 7. ANTI-SPAM COIN REWARD: Interaction-based coin earning
    // When this message is sent, we check if another user sent recently:
    // - If yes, PREVIOUS sender gets coin (their message got engagement)
    // - Current sender ALSO gets coin (for participating in interaction)
    // Rules enforced:
    // - No coins in private rooms
    // - 90-second interaction window (must reply within 90s to trigger coins)
    // - 12-second cooldown per user (global)
    // - Max 20 coins/hour per user per room
    // - Max 5 coins/hour per user-pair (anti-farming)
    // - Spam messages don't earn
    await tryEarnCoinInRoom({
      ctx,
      senderId,
      roomId,
      messageText: maskedText,
      isPublicRoom: room.isPublic,
    });

    // 8. DETERMINISTIC RETENTION: Delete exactly (newCount - 900) oldest when >= 1000
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

    // Record Phase-2 activity for ranking freshness (throttled to 1 update/hour)
    await ctx.runMutation(internal.phase2Ranking.recordPhase2Activity, {});

    // 9. Send notifications and create mention records for @mentions
    if (validatedMentions && validatedMentions.length > 0) {
      // Get sender's chat room profile for notification
      const senderProfile = await ctx.db
        .query('chatRoomProfiles')
        .withIndex('by_userId', (q) => q.eq('userId', senderId))
        .first();
      const senderNickname = senderProfile?.nickname ?? 'Someone';

      // Create message preview for mention inbox (max 100 chars)
      const messagePreview = maskedText
        ? (maskedText.length > 100 ? maskedText.slice(0, 97) + '...' : maskedText)
        : (resolvedAudioUrl ? '[Voice message]' : resolvedImageUrl ? '[Photo]' : '');

      // Create notification and mention record for each mentioned user
      for (const mention of validatedMentions) {
        // Dedupe key: one active mention notification per room per user
        const dedupeKey = `chatroom_mention:${roomId}:${mention.userId}`;

        // Check for existing notification with same dedupe key
        const existingNotif = await ctx.db
          .query('notifications')
          .withIndex('by_user_dedupe', (q) =>
            q.eq('userId', mention.userId).eq('dedupeKey', dedupeKey)
          )
          .first();

        const notificationBody = `${senderNickname} mentioned you in ${room.name}`;

        if (existingNotif) {
          // Update existing notification
          await ctx.db.patch(existingNotif._id, {
            body: notificationBody,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
          });
        } else {
          // Create new notification
          await ctx.db.insert('notifications', {
            userId: mention.userId,
            type: 'message',
            title: 'You were mentioned',
            body: notificationBody,
            data: { roomId: roomId as string },
            dedupeKey,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
          });
        }

        // Create mention record for dedicated mention inbox
        // Each mention creates a unique record (no dedupe - user can be mentioned multiple times)
        const mentionRecordId = await ctx.db.insert('chatRoomMentions', {
          mentionedUserId: mention.userId,
          senderUserId: senderId,
          senderNickname,
          roomId,
          roomName: room.name,
          messageId,
          messagePreview,
          createdAt: now,
        });
      }
    }

    return messageId;
  },
});

// Delete a message (soft-delete via deletedAt timestamp)
// ROLE SYSTEM: Private rooms use owner/admin hierarchy; public rooms allow platform admins
export const deleteMessage = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageId, authUserId }) => {
    // 1. Verify auth
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // 2. Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      // Already deleted - idempotent
      return { success: true };
    }

    // 3. Verify message belongs to this room
    if (message.roomId !== roomId) {
      throw new Error('Unauthorized: message does not belong to this room');
    }

    // 4. Get the room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // 5. Get actor's user record (for platform admin check)
    const actorUser = await ctx.db.get(userId);
    if (!actorUser) {
      throw new Error('User not found');
    }
    const isPlatformAdmin = actorUser.isAdmin === true;
    const isPlatformRoom = isPlatformOwnedRoom(room);

    // 6. Get actor's membership and role
    const actorMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (!actorMembership) {
      throw new Error('You are not a member of this room');
    }

    // 7. Check if this is the user's own message
    const isOwnMessage = message.senderId === userId;

    // 8. Get message sender's role (for permission check)
    let messageOwnerRole: string | undefined = 'member';
    if (!isOwnMessage) {
      const senderMembership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', message.senderId))
        .first();
      messageOwnerRole = senderMembership?.role;
    }

    // 9. ROLE SYSTEM: Check permission using role hierarchy + platform admin for public rooms
    if (!canDeleteInRoom(actorMembership.role, messageOwnerRole, isOwnMessage, isPlatformAdmin, isPlatformRoom)) {
      throw new Error('Unauthorized: you do not have permission to delete this message');
    }

    // 10. Soft-delete by setting deletedAt timestamp
    await ctx.db.patch(messageId, { deletedAt: Date.now() });

    return { success: true };
  },
});

// CR-015: createRoom mutation REMOVED (was unused legacy code)
// Use createPrivateRoom for actual room creation (properly auth-hardened with coin cost)

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE REACTIONS (👍 ❤️ 😂 😮 🔥 👎)
// ═══════════════════════════════════════════════════════════════════════════

// Valid emoji reactions
const VALID_REACTIONS = ['👍', '❤️', '😂', '😮', '🔥', '👎'];

// Add a reaction to a message
export const addReaction = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    emoji: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageId, emoji, authUserId }) => {
    // 1. Validate emoji
    if (!VALID_REACTIONS.includes(emoji)) {
      throw new Error('Invalid reaction emoji');
    }

    // 2. Auth + resolve user
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // 3. Check room access
    await requireRoomReadAccess(ctx, roomId, authUserId);

    // 4. Verify message exists in this room
    const message = await ctx.db.get(messageId);
    if (!message || message.roomId !== roomId || message.deletedAt) {
      throw new Error('Message not found');
    }

    // 5. Check if user already reacted with any emoji to this message
    const existingReaction = await ctx.db
      .query('chatRoomReactions')
      .withIndex('by_message_user', (q) => q.eq('messageId', messageId).eq('userId', userId))
      .first();

    if (existingReaction) {
      // If same emoji, do nothing (idempotent)
      if (existingReaction.emoji === emoji) {
        return { success: true, reactionId: existingReaction._id };
      }
      // If different emoji, remove old and add new
      await ctx.db.delete(existingReaction._id);
    }

    // 6. Add reaction
    const reactionId = await ctx.db.insert('chatRoomReactions', {
      messageId,
      roomId,
      userId,
      emoji,
      createdAt: Date.now(),
    });

    return { success: true, reactionId };
  },
});

// Remove a reaction from a message
export const removeReaction = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageId, authUserId }) => {
    // 1. Auth + resolve user
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // 2. Check room access
    await requireRoomReadAccess(ctx, roomId, authUserId);

    // 3. Find and remove user's reaction
    const existingReaction = await ctx.db
      .query('chatRoomReactions')
      .withIndex('by_message_user', (q) => q.eq('messageId', messageId).eq('userId', userId))
      .first();

    if (existingReaction) {
      await ctx.db.delete(existingReaction._id);
    }

    return { success: true };
  },
});

// Get reactions for messages in a room (batched for efficiency)
export const getReactionsForMessages = query({
  args: {
    roomId: v.id('chatRooms'),
    messageIds: v.array(v.id('chatRoomMessages')),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageIds, authUserId }) => {
    // 1. Auth + room access
    await requireRoomReadAccess(ctx, roomId, authUserId);

    // 2. Get all reactions for the specified messages
    const reactions: Record<string, { emoji: string; count: number; userIds: string[] }[]> = {};

    for (const messageId of messageIds) {
      const messageReactions = await ctx.db
        .query('chatRoomReactions')
        .withIndex('by_message', (q) => q.eq('messageId', messageId))
        .collect();

      // Group by emoji
      const emojiGroups: Record<string, string[]> = {};
      for (const reaction of messageReactions) {
        if (!emojiGroups[reaction.emoji]) {
          emojiGroups[reaction.emoji] = [];
        }
        emojiGroups[reaction.emoji].push(reaction.userId);
      }

      // Convert to array format
      reactions[messageId] = Object.entries(emojiGroups).map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
      }));
    }

    return reactions;
  },
});

// Phase-2: Create a private room with optional password protection (costs 1 coin)
export const createPrivateRoom = mutation({
  args: {
    name: v.string(),
    password: v.optional(v.string()),
    authUserId: v.string(),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, { name, password, authUserId, isDemo, demoUserId }) => {
    // 1. Auth guard - use app's custom session-based auth
    const authId = authUserId || demoUserId;
    if (!authId || authId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }

    const createdBy = await resolveUserIdByAuthId(ctx, authId);
    if (!createdBy) {
      throw new Error('Unauthorized: user not found');
    }

    // Check if demo user (for coin bypass)
    const isDemoUser = isDemo === true && !!demoUserId;

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
    authUserId: v.string(),
  },
  handler: async (ctx, { joinCode, authUserId }) => {
    // 1. Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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

    // 6. Join as member
    await ctx.db.insert('chatRoomMembers', {
      roomId: room._id,
      userId,
      joinedAt: now,
      role: 'member',
    });

    // M-003 FIX: Recompute memberCount from source of truth (consistent with joinRoom)
    const actualMemberCount = await recomputeMemberCount(ctx, room._id);
    await ctx.db.patch(room._id, { memberCount: actualMemberCount });

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

    // MEMBER-COUNT-SYNC FIX: Compute live member count from chatRoomMembers table
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect();

    return {
      _id: room._id,
      name: room.name,
      memberCount: members.length,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
    };
  },
});

// Phase-2: Get ALL private rooms (visible to all users)
// Access control (join code/password) restricts ENTRY, not VISIBILITY
// Supports demo mode via optional isDemo/demoUserId args
export const getMyPrivateRooms = query({
  args: {
    authUserId: v.optional(v.string()), // Real mode: user's auth ID
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve userId (auth or demo) - needed for membership status
    const authId = args.authUserId || args.demoUserId;
    let userId: Id<'users'> | null = null;

    if (authId) {
      try {
        userId = await resolveUserIdByAuthId(ctx, authId);
      } catch {
        // User resolution failed - continue without membership info
      }
    }

    const now = Date.now();

    // VISIBILITY-FIX: Fetch ALL private rooms (not just user's memberships/created)
    // All users can SEE all private rooms; access control restricts ENTRY
    const allPrivateRooms = await ctx.db
      .query('chatRooms')
      .filter((q) => q.eq(q.field('isPublic'), false))
      .collect();

    // Get user's memberships (if logged in) for isMember/role flags
    let memberRoomIds = new Set<string>();
    let membershipByRoom = new Map<string, { role: string }>();

    if (userId) {
      const memberships = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();

      memberRoomIds = new Set(memberships.map((m) => m.roomId.toString()));
      membershipByRoom = new Map(
        memberships.map((m) => [m.roomId.toString(), { role: m.role }])
      );
    }

    // Process all private rooms
    const rooms = await Promise.all(
      allPrivateRooms.map(async (room) => {
        // Filter out expired rooms
        if (room.expiresAt && room.expiresAt <= now) return null;

        // LIVE PRESENCE: Compute activeUserCount from chatRoomPresence table
        const onlineThreshold = now - PRESENCE_ONLINE_THRESHOLD_MS;
        const presenceRecords = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();
        const activeUserIds = new Set(
          presenceRecords
            .filter((p) => p.lastHeartbeatAt >= onlineThreshold)
            .map((p) => p.userId.toString())
        );
        const activeUserCount = activeUserIds.size;

        // Get member count
        const roomMembers = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();

        // Determine membership status for current user
        const roomIdStr = room._id.toString();
        const isMember = memberRoomIds.has(roomIdStr);
        const membership = membershipByRoom.get(roomIdStr);
        const isCreator = userId && room.createdBy === userId;

        return {
          _id: room._id,
          name: room.name,
          slug: room.slug,
          category: room.category,
          isPublic: room.isPublic,
          activeUserCount,
          memberCount: roomMembers.length,
          lastMessageAt: room.lastMessageAt,
          lastMessageText: room.lastMessageText,
          createdAt: room.createdAt,
          expiresAt: room.expiresAt,
          joinCode: room.joinCode,
          createdBy: room.createdBy,
          hasPassword: !!room.passwordHash, // Indicate if password required
          role: membership?.role ?? (isCreator ? 'owner' : 'none'),
          isMember, // Whether user currently has membership (for UI/access)
        };
      })
    );

    // Filter nulls and sort by lastMessageAt
    const result = rooms
      .filter((room): room is NonNullable<typeof room> => room !== null)
      .sort((a, b) => {
        const aTime = a.lastMessageAt ?? 0;
        const bTime = b.lastMessageAt ?? 0;
        if (bTime !== aTime) return bTime - aTime;
        return a.name.localeCompare(b.name);
      });

    return result;
  },
});

// Report a message in a chat room
// CR-012 FIX: Auth hardening - derive reporterId from auth, don't trust client
export const reportMessage = mutation({
  args: {
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(), // CR-012: Auth verification required
    reason: v.string(),
  },
  handler: async (ctx, { messageId, authUserId, reason }) => {
    // CR-012 FIX: Derive reporterId from authenticated user
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const reporterId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!reporterId) {
      throw new Error('Unauthorized: user not found');
    }

    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    // Prevent self-reports
    if (reporterId === message.senderId) {
      throw new Error('Cannot report your own message');
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

// Get rooms where authenticated user is a member
// Phase-2: Filters out expired rooms
// SECURITY: Only returns caller's own room memberships (no arbitrary userId lookup)
export const getRoomsForUser = query({
  args: {
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId }) => {
    // SECURITY: Require authenticated user - only return caller's own rooms
    // Return empty array if not authenticated (graceful degradation)
    if (!authUserId || authUserId.trim().length === 0) {
      return [];
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }
    const now = Date.now();

    // Get all memberships for authenticated user
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

// Get authenticated user's own penalty status in a room
// SECURITY: Only returns caller's own penalty, not arbitrary user lookup
export const getUserPenalty = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require authenticated user (but NOT full read access,
    // since penalized users should still be able to check their penalty status)
    const userId = await requireAuthenticatedUser(ctx, authUserId);

    // Check room exists and is not expired
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      throw new Error('Room has expired');
    }

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

// Check if authenticated user has any active readOnly penalty (for blocking DMs from Chat Rooms)
// CR-P1-002 FIX: Server-side auth only - user can only check their own penalty status
export const hasAnyActivePenalty = query({
  args: {},
  handler: async (ctx) => {
    // CR-P1-002 FIX: Resolve userId from server-side auth, not client-supplied
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      return false; // Safe default - not authenticated
    }
    const userId = await resolveUserIdByAuthId(ctx, identity.subject);
    if (!userId) {
      return false; // Safe default - user not found
    }

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
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, authUserId);

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
// CR-016 FIX: Auth hardening - verify caller identity, don't trust client userId
export const closeRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(), // CR-016: Auth verification required
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // CR-016 FIX: Verify caller identity via session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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

// CR-013: kickUser mutation REMOVED (was unused legacy code)
// Use kickAndBanMember for actual kick+ban functionality (properly auth-hardened)

// ═══════════════════════════════════════════════════════════════════════════
// ROLE SYSTEM: Promote/Demote member mutations
// ═══════════════════════════════════════════════════════════════════════════

// Promote a member to admin (owner only)
export const promoteMember = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    // 1. Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // 2. Get room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // 3. Cannot promote yourself
    if (userId === targetUserId) {
      throw new Error('Cannot change your own role');
    }

    // 4. Get actor's membership and verify owner
    const actorMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (!actorMembership || !canManageRoles(actorMembership.role)) {
      throw new Error('Only room owner can promote members');
    }

    // 5. Get target membership
    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();

    if (!targetMembership) {
      throw new Error('Target user is not a member of this room');
    }

    // 6. Check current role
    if (targetMembership.role === 'owner') {
      throw new Error('Cannot change owner role');
    }
    if (targetMembership.role === 'admin') {
      throw new Error('User is already an admin');
    }

    // 7. Promote to admin
    await ctx.db.patch(targetMembership._id, { role: 'admin' });

    return { success: true, newRole: 'admin' };
  },
});

// Demote an admin to member (owner only)
export const demoteMember = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    // 1. Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // 2. Get room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // 3. Cannot demote yourself
    if (userId === targetUserId) {
      throw new Error('Cannot change your own role');
    }

    // 4. Get actor's membership and verify owner
    const actorMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (!actorMembership || !canManageRoles(actorMembership.role)) {
      throw new Error('Only room owner can demote admins');
    }

    // 5. Get target membership
    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();

    if (!targetMembership) {
      throw new Error('Target user is not a member of this room');
    }

    // 6. Check current role
    if (targetMembership.role === 'owner') {
      throw new Error('Cannot change owner role');
    }
    if (targetMembership.role === 'member') {
      throw new Error('User is already a member');
    }

    // 7. Demote to member
    await ctx.db.patch(targetMembership._id, { role: 'member' });

    return { success: true, newRole: 'member' };
  },
});

// Get member's role in a room (for UI display)
// Returns membership role + platform admin info for public room moderation UI
export const getMemberRole = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      return { role: null, canModerate: false };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { role: null, canModerate: false };
    }

    // Get room to check if platform-owned
    const room = await ctx.db.get(roomId);
    const isPlatformRoom = room ? isPlatformOwnedRoom(room) : false;

    // Get user to check platform admin status
    const user = await ctx.db.get(userId);
    const isPlatformAdmin = user?.isAdmin === true;

    // Get membership role
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    const role = membership?.role ?? null;

    // canModerate = true if user can delete others' messages / kick users
    // - In platform rooms: platform admins can moderate
    // - In private rooms: owners and admins can moderate (using getRoleLevel for backward compat with 'mod')
    const canModerate = isPlatformRoom
      ? isPlatformAdmin
      : getRoleLevel(role) >= ROLE_LEVEL.admin;

    return { role, canModerate };
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

// REMOVED: getVisiblePrivateRooms
// Security fix: This function exposed all private room names/slugs without authentication.
// Use getMyPrivateRooms for authenticated access to user's own private rooms,
// or joinRoomByCode/getRoomByJoinCode for code-based discovery.

// Check user's access status for a private room
export const checkRoomAccess = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom auth pattern
    if (!authUserId || authUserId.trim().length === 0) {
      return { status: 'unauthenticated' as const };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
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
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, password, authUserId }) => {
    // 1. Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return [];
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
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
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return 0;
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
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
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    // 1. Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    // 1. Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    // 1. Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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
// AUTH-FIX: Uses custom session-based auth pattern (authUserId required for non-demo mode)
// Supports demo mode via optional isDemo/demoUserId args
export const getRoomPassword = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()), // AUTH-FIX: Added for non-demo mode
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { roomId, authUserId, isDemo, demoUserId } = args;

    // AUTH-FIX: Use custom session-based auth pattern
    // In demo mode: use demoUserId; in real mode: use authUserId
    const authId = isDemo ? demoUserId : authUserId;
    if (!authId || authId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }

    const userId = await resolveUserIdByAuthId(ctx, authId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Get room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // SECURITY: Check if owner (password only visible to room creator)
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
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return false;
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
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
// SECURITY: Requires read access (auth + membership + not banned)
export const getRoomInfo = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access
    const { room } = await requireRoomReadAccess(ctx, roomId, authUserId);

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
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { muted: false };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
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
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, muted, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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

// ═══════════════════════════════════════════════════════════════════════════
// USER MUTING (Per-Room, Per-User)
// Muting a user hides their messages only for the muting user, only in that room.
// Does NOT affect membership, moderation, or other users' views.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all muted user IDs for the current user in a specific room.
 * Returns an array of user IDs that should have their messages hidden.
 */
export const getMutedUsersInRoom = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      return { mutedUserIds: [] };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { mutedUserIds: [] };
    }

    // Get all muted users for this user in this room
    const mutedEntries = await ctx.db
      .query('chatRoomMutedUsers')
      .withIndex('by_muter_room', (q) => q.eq('muterId', userId).eq('roomId', roomId))
      .collect();

    // Return array of muted user IDs as strings for frontend
    return {
      mutedUserIds: mutedEntries.map((entry) => entry.mutedUserId.toString()),
    };
  },
});

/**
 * Toggle mute status for a user in a room.
 * If currently muted, unmutes. If not muted, mutes.
 * Returns the new mute status.
 */
export const toggleMuteUserInRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Cannot mute yourself
    if (userId === targetUserId) {
      throw new Error('Cannot mute yourself');
    }

    // Check if already muted
    const existing = await ctx.db
      .query('chatRoomMutedUsers')
      .withIndex('by_muter_room_target', (q) =>
        q.eq('muterId', userId).eq('roomId', roomId).eq('mutedUserId', targetUserId)
      )
      .first();

    if (existing) {
      // Currently muted → unmute (delete the record)
      await ctx.db.delete(existing._id);
      return { muted: false };
    } else {
      // Not muted → mute (create the record)
      await ctx.db.insert('chatRoomMutedUsers', {
        roomId,
        muterId: userId,
        mutedUserId: targetUserId,
        mutedAt: Date.now(),
      });
      return { muted: true };
    }
  },
});

/**
 * Set mute status for a user in a room (explicit mute/unmute).
 * Use this when you know the desired state instead of toggling.
 */
export const setMuteUserInRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    muted: v.boolean(),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, muted, authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Cannot mute yourself
    if (userId === targetUserId) {
      throw new Error('Cannot mute yourself');
    }

    // Check if already muted
    const existing = await ctx.db
      .query('chatRoomMutedUsers')
      .withIndex('by_muter_room_target', (q) =>
        q.eq('muterId', userId).eq('roomId', roomId).eq('mutedUserId', targetUserId)
      )
      .first();

    if (muted) {
      // Want to mute
      if (!existing) {
        await ctx.db.insert('chatRoomMutedUsers', {
          roomId,
          muterId: userId,
          mutedUserId: targetUserId,
          mutedAt: Date.now(),
        });
      }
      // If already exists, do nothing (idempotent)
    } else {
      // Want to unmute
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      // If doesn't exist, do nothing (idempotent)
    }

    return { muted };
  },
});

// Check if user has reported a room
export const hasReportedRoom = query({
  args: {
    roomId: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { reported: false };
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
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
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Auth guard - use app's custom session-based auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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

// Submit a detailed report for a user in a chat room
// SECURITY: Reporter identity is derived from authenticated session, not client input
export const submitChatRoomReport = mutation({
  args: {
    authUserId: v.string(),
    reportedUserId: v.string(),
    roomId: v.optional(v.string()),
    reason: v.union(
      // Original reasons
      v.literal('fake_profile'),
      v.literal('inappropriate_photos'),
      v.literal('harassment'),
      v.literal('spam'),
      v.literal('underage'),
      v.literal('other'),
      // Chat room reasons
      v.literal('hate_speech'),
      v.literal('sexual_content'),
      v.literal('nudity'),
      v.literal('violent_threats'),
      v.literal('impersonation'),
      v.literal('selling')
    ),
    details: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, reportedUserId, roomId, reason, details }) => {
    // 1. SECURITY: Authenticate the reporter
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const reporterId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!reporterId) {
      throw new Error('Unauthorized: user not found');
    }

    // 2. Resolve reported user ID
    const reportedId = await resolveUserIdByAuthId(ctx, reportedUserId);
    if (!reportedId) {
      throw new Error('Reported user not found');
    }

    // 3. Prevent self-reports
    if (reporterId === reportedId) {
      throw new Error('Cannot report yourself');
    }

    // 4. Create the report record in the reports table
    const reportId = await ctx.db.insert('reports', {
      reporterId,
      reportedUserId: reportedId,
      reason,
      description: details ?? undefined,
      status: 'pending',
      createdAt: Date.now(),
      roomId: roomId ?? undefined,
    });

    // 5. Also mark the room as reported (for quick lookups)
    if (roomId) {
      const existingRoomReport = await ctx.db
        .query('userRoomReports')
        .withIndex('by_user_room', (q) => q.eq('userId', reporterId).eq('roomId', roomId))
        .first();

      if (!existingRoomReport) {
        await ctx.db.insert('userRoomReports', {
          userId: reporterId,
          roomId,
          createdAt: Date.now(),
        });
      }
    }

    return { success: true, reportId };
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
      relationshipIntent: ['exploring_vibes'],
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

// ═══════════════════════════════════════════════════════════════════════════
// GET USER WALLET COINS
// Returns the current user's wallet coin balance for real-time UI display.
// The balance is updated atomically when messages are sent (see sendMessage).
// ═══════════════════════════════════════════════════════════════════════════
export const getUserWalletCoins = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { walletCoins: 0 };
    }
    const user = await ctx.db.get(userId);
    return { walletCoins: user?.walletCoins ?? 0 };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: Diagnose room membership data by slug (INTERNAL ONLY)
// Run via: npx convex run chatRooms:diagnoseRoomBySlug '{"slug":"bengali"}'
// SECURITY: internalQuery - not accessible from client API
// ═══════════════════════════════════════════════════════════════════════════
export const diagnoseRoomBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();

    if (!room) {
      return { error: `Room not found: ${slug}`, room: null, members: [] };
    }

    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect();

    const membersWithDetails = await Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return {
          odabirnemId: member._id.toString(),
          odabirnemUserId: member.userId.toString(),
          joinedAt: member.joinedAt,
          role: member.role,
          userName: user?.name ?? 'UNKNOWN',
        };
      })
    );

    return {
      room: {
        id: room._id.toString(),
        name: room.name,
        slug: room.slug,
        memberCount: room.memberCount,
        isPublic: room.isPublic,
      },
      members: membersWithDetails,
      actualMemberCount: members.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: Clear all memberships for a room by slug (for stale data cleanup)
// Run via: npx convex run chatRooms:clearRoomMemberships '{"slug":"bengali"}'
// ═══════════════════════════════════════════════════════════════════════════
export const clearRoomMemberships = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();

    if (!room) {
      return { error: `Room not found: ${slug}`, deletedCount: 0 };
    }

    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect();

    for (const member of members) {
      await ctx.db.delete(member._id);
    }

    await ctx.db.patch(room._id, { memberCount: 0 });

    return {
      roomId: room._id.toString(),
      roomName: room.name,
      deletedCount: members.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CHAT ROOM PROFILES (Separate Identity System)
// ═══════════════════════════════════════════════════════════════════════════
// Each user has ONE chat room identity (global across all rooms, not per room).
// This is COMPLETELY SEPARATE from main profile (name, photo, bio).
// Backend userId remains the true identity internally for moderation/bans/reports.

/**
 * Get the current user's chat room profile.
 * Returns null if profile doesn't exist (user needs to create one).
 */
export const getChatRoomProfile = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      return null;
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return null;
    }

    // Get profile
    const profile = await ctx.db
      .query('chatRoomProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    if (!profile) {
      return null;
    }

    return {
      id: profile._id,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl ?? null,
      // CACHE-BUST-FIX: Include version for image cache invalidation
      avatarVersion: profile.updatedAt,
      bio: profile.bio ?? null,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  },
});

/**
 * Create or update the current user's chat room profile.
 * Upsert behavior: creates if not exists, updates if exists.
 */
export const createOrUpdateChatRoomProfile = mutation({
  args: {
    authUserId: v.string(),
    nickname: v.string(),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, nickname, avatarUrl, bio }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Validate nickname
    const trimmedNickname = nickname.trim();
    if (trimmedNickname.length === 0) {
      throw new Error('Nickname is required');
    }
    if (trimmedNickname.length > 30) {
      throw new Error('Nickname must be 30 characters or less');
    }
    if (trimmedNickname.length < 2) {
      throw new Error('Nickname must be at least 2 characters');
    }
    // PROFILE-SETUP-FIX: Username validation - must start with letter
    if (!/^[a-zA-Z]/.test(trimmedNickname)) {
      throw new Error('Nickname must start with a letter');
    }
    // Prevent purely numeric nicknames
    if (/^\d+$/.test(trimmedNickname)) {
      throw new Error('Nickname cannot be purely numeric');
    }

    // Validate bio
    const trimmedBio = bio?.trim();
    if (trimmedBio && trimmedBio.length > 150) {
      throw new Error('Bio must be 150 characters or less');
    }

    // AVATAR-UPLOAD-FIX: Validate avatarUrl is a cloud URL, not a local file path
    // Reject file:// URLs which only work on the originating device
    let validatedAvatarUrl = avatarUrl;
    if (avatarUrl) {
      const isLocalFile = avatarUrl.startsWith('file://') || avatarUrl.startsWith('content://');

      if (isLocalFile) {
        // Don't save local file paths - they won't work on other devices
        validatedAvatarUrl = undefined;
      }
    }

    const now = Date.now();

    // Check if profile exists
    const existingProfile = await ctx.db
      .query('chatRoomProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    if (existingProfile) {
      // Update existing profile
      const finalAvatarUrl = validatedAvatarUrl ?? existingProfile.avatarUrl;
      await ctx.db.patch(existingProfile._id, {
        nickname: trimmedNickname,
        avatarUrl: finalAvatarUrl,
        bio: trimmedBio ?? existingProfile.bio,
        updatedAt: now,
      });

      return {
        id: existingProfile._id,
        nickname: trimmedNickname,
        avatarUrl: finalAvatarUrl ?? null,
        bio: trimmedBio ?? existingProfile.bio ?? null,
        created: false,
      };
    } else {
      // Create new profile
      const profileId = await ctx.db.insert('chatRoomProfiles', {
        userId,
        nickname: trimmedNickname,
        avatarUrl: validatedAvatarUrl,
        bio: trimmedBio,
        createdAt: now,
        updatedAt: now,
      });

      return {
        id: profileId,
        nickname: trimmedNickname,
        avatarUrl: validatedAvatarUrl ?? null,
        bio: trimmedBio ?? null,
        created: true,
      };
    }
  },
});

/**
 * Get chat room profiles for multiple users at once.
 * Used for efficient batch fetching when displaying messages/members.
 * Returns a map of stringified-userId → chatRoomProfile.
 */
export const getChatRoomProfilesByUserIds = query({
  args: {
    userIds: v.array(v.id('users')),
    authUserId: v.string(),
  },
  handler: async (ctx, { userIds, authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      return {};
    }
    const currentUserId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!currentUserId) {
      return {};
    }

    // Fetch all profiles in parallel
    const profiles = await Promise.all(
      userIds.map(async (uid) => {
        const profile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', uid))
          .first();
        return { userId: uid, profile };
      })
    );

    // Build map
    const profileMap: Record<string, {
      nickname: string;
      avatarUrl: string | null;
      bio: string | null;
    }> = {};

    for (const { userId, profile } of profiles) {
      if (profile) {
        profileMap[userId.toString()] = {
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl ?? null,
          bio: profile.bio ?? null,
        };
      }
    }

    return profileMap;
  },
});

/**
 * Generate upload URL for chat room avatar.
 */
export const generateChatRoomAvatarUploadUrl = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Get storage URL for a chat room avatar.
 * AVATAR-UPLOAD-FIX: Changed to mutation so it can be called imperatively from frontend
 */
export const getChatRoomAvatarUrl = mutation({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOM-SPECIFIC PRESENCE SYSTEM
// Real-time presence tracking per room (not global)
// States: ONLINE_IN_ROOM (heartbeat within 15s), RECENTLY_LEFT (within 10min), NOT_SHOWN
// ═══════════════════════════════════════════════════════════════════════════

// Presence timing constants
// Heartbeat: 12s, Online threshold: 35s (safe buffer for network jitter/app pauses)
// This prevents flickering: user stays online if heartbeat is within 35s
const PRESENCE_HEARTBEAT_INTERVAL_MS = 12 * 1000;     // 12 seconds between heartbeats
const PRESENCE_ONLINE_THRESHOLD_MS = 35 * 1000;       // 35 seconds = still online (prevents flicker)
const PRESENCE_RECENTLY_LEFT_MS = 10 * 60 * 1000;     // 10 minutes = recently left window

/**
 * Update room-specific presence heartbeat.
 * Called every 10-15 seconds while user is viewing a room.
 * ROOM SWITCHING SAFETY: Clears presence from other rooms to prevent double-online.
 */
export const heartbeatPresence = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Resolve real user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) return { success: false };

    // Verify room exists
    const room = await ctx.db.get(roomId);
    if (!room) return { success: false };

    const now = Date.now();

    // ROOM SWITCHING SAFETY: Clear presence from ALL other rooms for this user
    // This prevents double-online when user switches rooms directly
    const allUserPresence = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    for (const presence of allUserPresence) {
      if (presence.roomId !== roomId) {
        // Delete presence from other room
        await ctx.db.delete(presence._id);
      }
    }

    // Check for existing presence record in this room
    const existing = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (existing) {
      // Update existing heartbeat
      await ctx.db.patch(existing._id, { lastHeartbeatAt: now });
    } else {
      // Create new presence record
      await ctx.db.insert('chatRoomPresence', {
        roomId,
        userId,
        lastHeartbeatAt: now,
        joinedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Clear room presence when user navigates away.
 * Called when user leaves room screen.
 */
export const clearRoomPresence = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) return { success: false };

    // Find and delete presence record
    const presence = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (presence) {
      await ctx.db.delete(presence._id);
    }

    return { success: true };
  },
});

/**
 * Get room presence with user profiles.
 * Returns two sections: ONLINE (heartbeat within 20s) and RECENTLY_LEFT (within 10min).
 * Used by member list UI.
 */
export const getRoomPresenceWithProfiles = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access
    await requireRoomReadAccess(ctx, roomId, authUserId);

    const now = Date.now();
    const onlineThreshold = now - PRESENCE_ONLINE_THRESHOLD_MS;
    const recentlyLeftThreshold = now - PRESENCE_RECENTLY_LEFT_MS;

    // Get all presence records for this room
    const presenceRecords = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    // Separate into online vs recently-left
    const onlinePresence: typeof presenceRecords = [];
    const recentlyLeftPresence: typeof presenceRecords = [];

    for (const p of presenceRecords) {
      if (p.lastHeartbeatAt >= onlineThreshold) {
        onlinePresence.push(p);
      } else if (p.lastHeartbeatAt >= recentlyLeftThreshold) {
        recentlyLeftPresence.push(p);
      }
      // Older than 10 min = not shown
    }

    // Helper to enrich with profile data
    const enrichPresence = async (presence: typeof presenceRecords[0]) => {
      const [chatRoomProfile, user, member, primaryPhoto] = await Promise.all([
        ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', presence.userId))
          .first(),
        ctx.db.get(presence.userId),
        ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', presence.userId))
          .first(),
        // AVATAR-FIX: Query primary photo as fallback when chatRoomProfile has no avatar
        ctx.db
          .query('photos')
          .withIndex('by_user', (q) => q.eq('userId', presence.userId))
          .filter((q) => q.eq(q.field('isPrimary'), true))
          .first(),
      ]);

      // Calculate age from DOB
      let age = 0;
      if (user?.dateOfBirth) {
        const birthDate = new Date(user.dateOfBirth);
        const today = new Date();
        age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
      }

      // Avatar resolution chain: chatRoomProfile -> primary photo (storage) -> undefined
      const chatRoomAvatarUrl = chatRoomProfile?.avatarUrl;
      const isLocalFileAvatar = chatRoomAvatarUrl?.startsWith('file://') || chatRoomAvatarUrl?.startsWith('content://');

      // Use chatRoomProfile avatar if it's a valid https URL, otherwise fallback to primary photo
      let resolvedAvatarUrl: string | undefined = undefined;
      if (chatRoomAvatarUrl && !isLocalFileAvatar) {
        resolvedAvatarUrl = chatRoomAvatarUrl;
      } else if (primaryPhoto?.storageId) {
        // Fallback: resolve primary photo from storage
        const photoUrl = await ctx.storage.getUrl(primaryPhoto.storageId);
        if (photoUrl) {
          resolvedAvatarUrl = photoUrl;
        }
      }

      return {
        id: presence.userId,
        displayName: chatRoomProfile?.nickname ?? 'Anonymous',
        // PHOTO-URL-FIX: Full fallback chain for avatar
        avatar: resolvedAvatarUrl,
        // CACHE-BUST-FIX: Include version for image cache invalidation
        avatarVersion: chatRoomProfile?.updatedAt ?? 0,
        age,
        gender: (user?.gender ?? '') as 'male' | 'female' | 'other' | '',
        bio: chatRoomProfile?.bio ?? undefined,
        role: member?.role ?? 'member',
        lastHeartbeatAt: presence.lastHeartbeatAt,
        joinedAt: presence.joinedAt,
      };
    };

    // Enrich all presence records with profiles
    const [online, recentlyLeft] = await Promise.all([
      Promise.all(onlinePresence.map(enrichPresence)),
      Promise.all(recentlyLeftPresence.map(enrichPresence)),
    ]);

    // Sort: online by most recent heartbeat, recently-left by most recent
    online.sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);
    recentlyLeft.sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);

    return {
      onlineCount: online.length,
      online,
      recentlyLeft,
    };
  },
});

/**
 * Get real-time online count for room header.
 * Only counts users with heartbeat within 20 seconds.
 * Excludes recently-left users.
 */
export const getRoomOnlineCount = query({
  args: {
    roomId: v.id('chatRooms'),
  },
  handler: async (ctx, { roomId }) => {
    const now = Date.now();
    const onlineThreshold = now - PRESENCE_ONLINE_THRESHOLD_MS;

    // Count presence records with recent heartbeat
    const presenceRecords = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const onlineCount = presenceRecords.filter(
      (p) => p.lastHeartbeatAt >= onlineThreshold
    ).length;

    return { onlineCount };
  },
});

/**
 * Cleanup stale presence records older than 10 minutes.
 * Called by scheduled job to prevent database bloat.
 */
export const cleanupStalePresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const staleThreshold = now - PRESENCE_RECENTLY_LEFT_MS;

    // Find and delete stale presence records (in batches)
    const staleRecords = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_heartbeat')
      .filter((q) => q.lt(q.field('lastHeartbeatAt'), staleThreshold))
      .take(100);

    for (const record of staleRecords) {
      await ctx.db.delete(record._id);
    }

    return { deleted: staleRecords.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CHAT ROOM DM (Private Messages Between Users)
// Real-time 1:1 messaging initiated from Chat Rooms
// Uses canonical Convex IDs to prevent participant ID mismatch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize participant IDs to consistent order.
 * Always returns [smaller, larger] based on string comparison.
 * This ensures the same thread is found regardless of who initiates.
 */
function normalizeParticipants(
  userA: Id<'users'>,
  userB: Id<'users'>
): [Id<'users'>, Id<'users'>] {
  const a = userA as string;
  const b = userB as string;
  return a < b ? [userA, userB] : [userB, userA];
}

/**
 * Get or create a DM thread between two users.
 * Uses normalized participant order for consistent lookup.
 *
 * DM-ID-FIX: Accepts authUserId strings and resolves to canonical Convex IDs
 * to prevent participant ID mismatch between presence data and DM threads.
 */
export const getOrCreateDmThread = mutation({
  args: {
    authUserId: v.string(),              // Current user's auth ID
    peerUserId: v.string(),              // Peer's ID (from presence data - should be canonical)
    sourceRoomId: v.optional(v.id('chatRooms')), // Optional: room where DM was initiated
  },
  handler: async (ctx, { authUserId, peerUserId, sourceRoomId }) => {
    // DM-ID-FIX: Resolve authUserId to canonical Convex ID
    const currentUserId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!currentUserId) {
      throw new Error('Unauthorized: user not found');
    }

    // DM-ID-FIX: Peer ID should already be canonical (from presence query)
    // but resolve it to be safe (handles any format)
    const peerId = await resolveUserIdByAuthId(ctx, peerUserId);
    if (!peerId) {
      throw new Error('Peer user not found');
    }

    // Prevent self-DM
    if (currentUserId === peerId) {
      throw new Error('Cannot start DM with yourself');
    }

    // Normalize participant order for consistent lookup
    const [participant1Id, participant2Id] = normalizeParticipants(currentUserId, peerId);

    // Look for existing thread
    const existing = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participants', (q) =>
        q.eq('participant1Id', participant1Id).eq('participant2Id', participant2Id)
      )
      .first();

    if (existing) {
      return { threadId: existing._id, isNew: false };
    }

    // Create new thread
    const now = Date.now();
    const threadId = await ctx.db.insert('chatRoomDmThreads', {
      participant1Id,
      participant2Id,
      sourceRoomId,
      lastMessageAt: now,
      createdAt: now,
    });

    return { threadId, isNew: true };
  },
});

/**
 * Send a message in a DM thread.
 * Updates thread metadata (lastMessageAt, preview).
 */
export const sendDmMessage = mutation({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
    text: v.optional(v.string()),
    type: v.optional(v.union(
      v.literal('text'),
      v.literal('image'),
      v.literal('video'),
      v.literal('audio')
    )),
    mediaStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, { authUserId, threadId, text, type, mediaStorageId }) => {
    // Resolve user ID
    const senderId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!senderId) {
      throw new Error('Unauthorized: user not found');
    }

    // Verify thread exists and user is participant
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }

    const isParticipant =
      thread.participant1Id === senderId || thread.participant2Id === senderId;
    if (!isParticipant) {
      throw new Error('Not a participant in this thread');
    }

    // Validate message content
    const messageType = type ?? 'text';
    if (messageType === 'text' && (!text || text.trim().length === 0)) {
      throw new Error('Text message cannot be empty');
    }

    const now = Date.now();

    // Resolve media URL if storage ID provided
    let mediaUrl: string | undefined;
    if (mediaStorageId) {
      mediaUrl = await ctx.storage.getUrl(mediaStorageId) ?? undefined;
    }

    // Insert message
    const messageId = await ctx.db.insert('chatRoomDmMessages', {
      threadId,
      senderId,
      text: text?.trim(),
      type: messageType,
      mediaStorageId,
      mediaUrl,
      createdAt: now,
    });

    // Update thread metadata
    const preview = messageType === 'text'
      ? (text?.trim().slice(0, 50) ?? '')
      : `[${messageType.charAt(0).toUpperCase() + messageType.slice(1)}]`;

    await ctx.db.patch(threadId, {
      lastMessageAt: now,
      lastMessagePreview: preview,
    });

    return { messageId };
  },
});

/**
 * Get DM threads for a user (inbox).
 * Returns threads sorted by most recent activity.
 * Includes peer profile info for display.
 *
 * DM-INBOX-FILTER: Only returns threads where the current user has received
 * at least one incoming message. Outgoing-only threads are hidden from inbox
 * but remain accessible in the full DM thread view.
 */
export const getDmThreads = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { authUserId, limit = 50 }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }

    // Get threads where user is participant1
    const threadsAsP1 = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participant1', (q) => q.eq('participant1Id', userId))
      .take(limit * 2); // Fetch extra to account for filtered threads

    // Get threads where user is participant2
    const threadsAsP2 = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participant2', (q) => q.eq('participant2Id', userId))
      .take(limit * 2);

    // Combine and dedupe
    const allThreads = [...threadsAsP1, ...threadsAsP2];
    const uniqueThreads = Array.from(
      new Map(allThreads.map((t) => [t._id, t])).values()
    );

    // Sort by lastMessageAt descending
    uniqueThreads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    // DM-INBOX-FILTER: Filter threads to only include those with at least one incoming message
    // An incoming message is one where the sender is NOT the current user
    const threadsWithIncoming: typeof uniqueThreads = [];

    for (const thread of uniqueThreads) {
      // Check if there's at least one message from the peer (incoming)
      const peerId =
        thread.participant1Id === userId
          ? thread.participant2Id
          : thread.participant1Id;

      const incomingMessage = await ctx.db
        .query('chatRoomDmMessages')
        .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
        .filter((q) => q.eq(q.field('senderId'), peerId))
        .first();

      const hasIncoming = incomingMessage !== null;

      if (hasIncoming) {
        threadsWithIncoming.push(thread);
      }

      // Stop once we have enough visible threads
      if (threadsWithIncoming.length >= limit) {
        break;
      }
    }

    // Enrich with peer profile info
    const enriched = await Promise.all(
      threadsWithIncoming.map(async (thread) => {
        // Determine peer ID
        const peerId =
          thread.participant1Id === userId
            ? thread.participant2Id
            : thread.participant1Id;

        // Get chat room profile for peer (nickname, avatar)
        const [chatRoomProfile, user] = await Promise.all([
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', peerId))
            .first(),
          ctx.db.get(peerId),
        ]);

        // Count unread messages (messages from peer that haven't been read)
        const unreadMessages = await ctx.db
          .query('chatRoomDmMessages')
          .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
          .filter((q) =>
            q.and(
              q.eq(q.field('senderId'), peerId),
              q.eq(q.field('readAt'), undefined)
            )
          )
          .collect();

        return {
          id: thread._id,
          peerId: peerId,
          peerName: chatRoomProfile?.nickname ?? 'Anonymous',
          peerAvatar: chatRoomProfile?.avatarUrl,
          peerAge: user?.dateOfBirth ? calculateAge(user.dateOfBirth) : undefined,
          peerGender: user?.gender,
          lastMessage: thread.lastMessagePreview ?? '',
          lastMessageAt: thread.lastMessageAt,
          unreadCount: unreadMessages.length,
          createdAt: thread.createdAt,
        };
      })
    );

    return enriched;
  },
});

// Helper to calculate age from DOB string
function calculateAge(dob: string): number {
  try {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch {
    return 0;
  }
}

/**
 * Get messages in a DM thread.
 * Returns messages in chronological order.
 * Marks unread messages as read.
 */
export const getDmMessages = query({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()), // createdAt timestamp for pagination
  },
  handler: async (ctx, { authUserId, threadId, limit = 100, cursor }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { messages: [], hasMore: false };
    }

    // Verify thread exists and user is participant
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { messages: [], hasMore: false };
    }

    const isParticipant =
      thread.participant1Id === userId || thread.participant2Id === userId;
    if (!isParticipant) {
      return { messages: [], hasMore: false };
    }

    // Get messages (with optional cursor for pagination)
    let query = ctx.db
      .query('chatRoomDmMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId));

    if (cursor) {
      query = query.filter((q) => q.gt(q.field('createdAt'), cursor));
    }

    const messages = await query.take(limit + 1);

    // Check if there are more messages
    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(0, limit) : messages;

    // Get sender profiles for display
    const enriched = await Promise.all(
      result.map(async (msg) => {
        const senderProfile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', msg.senderId))
          .first();

        return {
          id: msg._id,
          threadId: msg.threadId,
          senderId: msg.senderId,
          senderName: senderProfile?.nickname ?? 'Anonymous',
          senderAvatar: senderProfile?.avatarUrl,
          text: msg.text,
          type: msg.type ?? 'text',
          mediaUrl: msg.mediaUrl,
          readAt: msg.readAt,
          createdAt: msg.createdAt,
          isMe: msg.senderId === userId,
        };
      })
    );

    return { messages: enriched, hasMore };
  },
});

/**
 * Mark DM messages as read.
 * Called when user opens/views a DM thread.
 */
export const markDmMessagesRead = mutation({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
  },
  handler: async (ctx, { authUserId, threadId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { marked: 0 };
    }

    // Verify thread exists and user is participant
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { marked: 0 };
    }

    const isParticipant =
      thread.participant1Id === userId || thread.participant2Id === userId;
    if (!isParticipant) {
      return { marked: 0 };
    }

    // Get peer ID
    const peerId =
      thread.participant1Id === userId
        ? thread.participant2Id
        : thread.participant1Id;

    // Find unread messages from peer
    const unreadMessages = await ctx.db
      .query('chatRoomDmMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .filter((q) =>
        q.and(
          q.eq(q.field('senderId'), peerId),
          q.eq(q.field('readAt'), undefined)
        )
      )
      .collect();

    // Mark as read
    const now = Date.now();
    for (const msg of unreadMessages) {
      await ctx.db.patch(msg._id, { readAt: now });
    }

    return { marked: unreadMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MENTION INBOX FUNCTIONS
// Queries and mutations for the @mention notification system
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the user's mention inbox (list of times they were @mentioned)
 * Returns mentions ordered by newest first, with pagination support
 */
export const getUserMentions = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()), // createdAt cursor for pagination
  },
  handler: async (ctx, { authUserId, limit = 50, cursor }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }

    // Query mentions for this user, newest first
    let mentionsQuery = ctx.db
      .query('chatRoomMentions')
      .withIndex('by_mentioned_user', (q) => q.eq('mentionedUserId', userId))
      .order('desc');

    // Apply cursor if provided (for pagination)
    if (cursor) {
      mentionsQuery = mentionsQuery.filter((q) => q.lt(q.field('createdAt'), cursor));
    }

    const mentions = await mentionsQuery.take(limit);

    // Return formatted mention items
    return mentions.map((m) => ({
      id: m._id,
      senderUserId: m.senderUserId,
      senderNickname: m.senderNickname,
      roomId: m.roomId,
      roomName: m.roomName,
      messageId: m.messageId,
      messagePreview: m.messagePreview,
      createdAt: m.createdAt,
      isRead: m.readAt !== undefined,
      readAt: m.readAt,
    }));
  },
});

/**
 * Get count of unread mentions for the user (for badge display)
 */
export const getUnreadMentionCount = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return 0;
    }

    // Count mentions where readAt is undefined
    const unreadMentions = await ctx.db
      .query('chatRoomMentions')
      .withIndex('by_mentioned_unread', (q) =>
        q.eq('mentionedUserId', userId).eq('readAt', undefined)
      )
      .collect();

    return unreadMentions.length;
  },
});

/**
 * Mark a single mention as read
 */
export const markMentionRead = mutation({
  args: {
    authUserId: v.string(),
    mentionId: v.id('chatRoomMentions'),
  },
  handler: async (ctx, { authUserId, mentionId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Get the mention
    const mention = await ctx.db.get(mentionId);
    if (!mention) {
      return { success: false, error: 'Mention not found' };
    }

    // Verify ownership
    if (mention.mentionedUserId !== userId) {
      throw new Error('Unauthorized: cannot mark another user\'s mention as read');
    }

    // Already read?
    if (mention.readAt !== undefined) {
      return { success: true, alreadyRead: true };
    }

    // Mark as read
    const now = Date.now();
    await ctx.db.patch(mentionId, { readAt: now });

    return { success: true };
  },
});

/**
 * Mark all mentions as read for a user
 */
export const markAllMentionsRead = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Get all unread mentions for this user
    const unreadMentions = await ctx.db
      .query('chatRoomMentions')
      .withIndex('by_mentioned_unread', (q) =>
        q.eq('mentionedUserId', userId).eq('readAt', undefined)
      )
      .collect();

    // Mark each as read
    const now = Date.now();
    for (const mention of unreadMentions) {
      await ctx.db.patch(mention._id, { readAt: now });
    }

    return { success: true, markedCount: unreadMentions.length };
  },
});

