import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { softMaskText } from './softMask';
import { internal } from './_generated/api';
import { asUserId } from './id';
import { hashPassword, verifyPassword, encryptPassword, decryptPassword } from './cryptoUtils';
import { resolveUserIdByAuthId } from './helpers';
import { shouldCreatePhase2ChatRoomsNotification } from './phase2NotificationPrefs';

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
import { Doc, Id } from './_generated/dataModel';
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
    await cleanupChatRoomMessageRelations(ctx, roomId, msg._id);
    await deleteChatRoomMessageStorage(ctx, msg);
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

  // P0-4: Cascade remaining room-linked tables so private rooms leave no residue.
  // chatRoomProfiles is user-scoped (nickname persists across rooms) and
  // chatRoomHiddenDmConversations is keyed by conversationId, so both are
  // intentionally excluded.

  // Join requests for this room
  const joinRequests = await ctx.db
    .query('chatRoomJoinRequests')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId))
    .collect();
  for (const req of joinRequests) {
    await ctx.db.delete(req._id);
  }

  // Bans for this room
  const bans = await ctx.db
    .query('chatRoomBans')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId))
    .collect();
  for (const ban of bans) {
    await ctx.db.delete(ban._id);
  }

  // Presence rows for this room
  const presence = await ctx.db
    .query('chatRoomPresence')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const row of presence) {
    await ctx.db.delete(row._id);
  }

  // Per-user mutes scoped to this room
  const perUserMutes = await ctx.db
    .query('chatRoomPerUserMutes')
    .withIndex('by_room_muter', (q) => q.eq('roomId', roomId))
    .collect();
  for (const row of perUserMutes) {
    await ctx.db.delete(row._id);
  }

  // Password brute-force attempt records for this room
  const passwordAttempts = await ctx.db
    .query('chatRoomPasswordAttempts')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId))
    .collect();
  for (const row of passwordAttempts) {
    await ctx.db.delete(row._id);
  }

  // userRoomPrefs / userRoomReports are keyed by a string roomId. Delete
  // only the rows whose roomId matches this chat room's document id.
  const roomIdString = roomId as unknown as string;

  const prefs = await ctx.db
    .query('userRoomPrefs')
    .withIndex('by_room', (q) => q.eq('roomId', roomIdString))
    .collect();
  for (const row of prefs) {
    await ctx.db.delete(row._id);
  }

  const reports = await ctx.db
    .query('userRoomReports')
    .withIndex('by_room', (q) => q.eq('roomId', roomIdString))
    .collect();
  for (const row of reports) {
    await ctx.db.delete(row._id);
  }

  // Delete the room itself
  await ctx.db.delete(roomId);
}

async function deleteChatRoomMessageStorage(
  ctx: MutationCtx,
  message: {
    imageStorageId?: Id<'_storage'>;
    videoStorageId?: Id<'_storage'>;
    audioStorageId?: Id<'_storage'>;
  }
): Promise<void> {
  const storageIds = [
    message.imageStorageId,
    message.videoStorageId,
    message.audioStorageId,
  ];

  for (const storageId of storageIds) {
    if (!storageId) continue;
    try {
      await ctx.storage.delete(storageId);
    } catch {
      // Best-effort cleanup: continue even if a blob was already removed or unavailable.
    }
    // P0-1: Also drop the ownership row so reused IDs don't leak claims.
    try {
      const ownership = await ctx.db
        .query('chatRoomMediaUploads')
        .withIndex('by_storage', (q) => q.eq('storageId', storageId))
        .first();
      if (ownership) {
        await ctx.db.delete(ownership._id);
      }
    } catch {
      // Best-effort cleanup: continue even if ownership row is already gone.
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P0-1 / P0-2: Chat Room media ownership + metadata validation helpers
// ═══════════════════════════════════════════════════════════════════════════

type ChatRoomMediaKind = 'image' | 'video' | 'audio' | 'doodle';

// Server-side media limits. Mirrors client limits in lib/uploadUtils.ts.
const CHAT_ROOM_MEDIA_LIMITS: Record<
  ChatRoomMediaKind,
  { maxBytes: number; contentTypePrefix: string }
> = {
  image: { maxBytes: 15 * 1024 * 1024, contentTypePrefix: 'image/' },
  video: { maxBytes: 100 * 1024 * 1024, contentTypePrefix: 'video/' },
  audio: { maxBytes: 20 * 1024 * 1024, contentTypePrefix: 'audio/' },
  doodle: { maxBytes: 5 * 1024 * 1024, contentTypePrefix: 'image/' },
};

/**
 * P0-1: Verify that the given storage blob belongs to `senderId`, or claim
 * first-time ownership for the sender. Throws if another user already owns it.
 *
 * Storage IDs issued by Convex are unguessable random strings, so an attacker
 * cannot practically race this claim against a legitimate uploader.
 */
async function verifyOrClaimChatRoomMediaOwnership(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  senderId: Id<'users'>,
  mediaKind: ChatRoomMediaKind
): Promise<void> {
  const existing = await ctx.db
    .query('chatRoomMediaUploads')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first();

  if (existing) {
    if (existing.uploaderUserId !== senderId) {
      throw new Error('Unauthorized: storage reference does not belong to sender');
    }
    return;
  }

  await ctx.db.insert('chatRoomMediaUploads', {
    storageId,
    uploaderUserId: senderId,
    mediaKind,
    createdAt: Date.now(),
  });
}

/**
 * P0-2: Validate the actual blob metadata (size + content-type) against the
 * declared media kind. Rejects mismatched or oversized uploads regardless of
 * what the client claimed via `mediaType`.
 */
async function validateChatRoomMediaMetadata(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  mediaKind: ChatRoomMediaKind
): Promise<void> {
  const meta = (await ctx.db.system.get(storageId)) as
    | { size?: number; contentType?: string }
    | null;

  if (!meta) {
    throw new Error('Invalid storage reference: metadata unavailable');
  }

  const limits = CHAT_ROOM_MEDIA_LIMITS[mediaKind];

  if (typeof meta.size === 'number' && meta.size > limits.maxBytes) {
    throw new Error(`Media exceeds size limit for ${mediaKind}`);
  }

  const contentType = typeof meta.contentType === 'string' ? meta.contentType : '';
  if (!contentType.toLowerCase().startsWith(limits.contentTypePrefix)) {
    throw new Error(`Media content type does not match declared ${mediaKind}`);
  }
}

async function cleanupChatRoomMessageRelations(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>,
  messageId: Id<'chatRoomMessages'>
): Promise<void> {
  try {
    const reactions = await ctx.db
      .query('chatRoomMessageReactions')
      .withIndex('by_room_message', (q) => q.eq('roomId', roomId).eq('messageId', messageId))
      .collect();

    for (const reaction of reactions) {
      try {
        await ctx.db.delete(reaction._id);
      } catch {
        // Best-effort cleanup: continue if already deleted concurrently.
      }
    }
  } catch {
    // Best-effort cleanup: continue even if reaction lookup fails.
  }

  try {
    const mentionNotifications = await ctx.db
      .query('chatRoomMentionNotifications')
      .withIndex('by_message', (q) => q.eq('messageId', messageId))
      .collect();

    for (const notification of mentionNotifications) {
      try {
        await ctx.db.delete(notification._id);
      } catch {
        // Best-effort cleanup: continue if already deleted concurrently.
      }
    }
  } catch {
    // Best-effort cleanup: continue even if notification lookup fails.
  }
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
  console.log('REQUIRE_AUTH_USER_START', { authUserId: authUserId?.slice(0, 20) });
  if (!authUserId || authUserId.trim().length === 0) {
    console.error('REQUIRE_AUTH_USER_FAIL', { reason: 'empty_authUserId' });
    throw new Error('Unauthorized: authentication required');
  }

  // Use the app's standard auth resolution pattern
  const userId = await resolveUserIdByAuthId(ctx, authUserId);
  console.log('REQUIRE_AUTH_USER_RESOLVED', { authUserId: authUserId.slice(0, 20), resolvedUserId: userId?.slice?.(0, 20) ?? 'NULL' });
  if (!userId) {
    console.error('REQUIRE_AUTH_USER_FAIL', { reason: 'user_not_found', authUserId: authUserId.slice(0, 20) });
    throw new Error(`Unauthorized: user not found for authId=${authUserId.slice(0, 12)}...`);
  }

  return userId;
}

/** D1: Block check for DM creation from chat rooms (same pattern as messages.ts). */
async function isBlockedBidirectional(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  const block1 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId1).eq('blockedUserId', userId2)
    )
    .first();
  if (block1) return true;

  const block2 = await ctx.db
    .query('blocks')
    .withIndex('by_blocker_blocked', (q) =>
      q.eq('blockerId', userId2).eq('blockedUserId', userId1)
    )
    .first();
  return !!block2;
}

/** Ensure a conversationParticipants row exists (repair path for getOrCreateDmThread). */
async function upsertConversationParticipant(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
  uid: Id<'users'>
): Promise<void> {
  const existing = await ctx.db
    .query('conversationParticipants')
    .withIndex('by_user_conversation', (q) =>
      q.eq('userId', uid).eq('conversationId', conversationId)
    )
    .first();
  if (!existing) {
    await ctx.db.insert('conversationParticipants', {
      conversationId,
      userId: uid,
      unreadCount: 0,
    });
  }
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
  let membership = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();

  // PUBLIC-ROOM-FIX: For public rooms, auto-create membership if not exists
  // This ensures consistent behavior between checkRoomAccess (which returns 'member' for public rooms)
  // and requireRoomReadAccess (which requires membership record)
  if (!membership && room.isPublic) {
    console.log('PUBLIC_ROOM_AUTO_JOIN', { roomId, userId: userId.slice(0, 12) });
    // Create membership for public room
    const membershipId = await (ctx as MutationCtx).db.insert('chatRoomMembers', {
      roomId,
      userId,
      role: 'member',
      joinedAt: Date.now(),
    });
    membership = await ctx.db.get(membershipId);
    // Update room member count
    await (ctx as MutationCtx).db.patch(roomId, {
      memberCount: (room.memberCount ?? 0) + 1,
    });
  }

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
    // ISSUE-2 FIX: Filter to only PUBLIC rooms for homepage general/language lists
    // Private rooms should only appear in getMyPrivateRooms query results
    rooms = rooms.filter((r) => r.isPublic === true);

    // BACKEND COUNT ONLY: Compute live online count from chatRoomPresence table.
    // This is the ONLY source of truth for "active users" count in the rooms list.
    const ONLINE_WINDOW_MS = 2 * 60 * 1000; // must align with presence expiry window
    const roomsWithLiveCounts = await Promise.all(
      rooms.map(async (room) => {
        const presenceRecords = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();
        const onlineCount = presenceRecords.filter((p) => now - p.lastHeartbeatAt < ONLINE_WINDOW_MS).length;
        return {
          ...room,
          onlineCount,
        };
      })
    );

    // Sort: rooms with recent messages first, then by name
    roomsWithLiveCounts.sort((a, b) => {
      const aTime = a.lastMessageAt ?? 0;
      const bTime = b.lastMessageAt ?? 0;
      if (bTime !== aTime) return bTime - aTime;
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
//
// CRITICAL: This query must never throw from the handler. Convex also validates `v.id()`
// BEFORE the handler — invalid id strings become "Server Error" with no handler logs.
// So we use `v.string()` for roomId and validate inside (same runtime shape as Id<'chatRooms'>).
//
// Logic aligns with checkRoomAccess:
// - Public rooms: readable without a chatRoomMembers row
// - Private rooms: membership + not banned, else null
export const getRoom = query({
  args: {
    roomId: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log('GET ROOM HIT', args);
    try {
      const { roomId: roomIdRaw, authUserId } = args;

      if (
        authUserId === undefined ||
        authUserId === null ||
        typeof authUserId !== 'string' ||
        authUserId.trim().length === 0
      ) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      if (
        roomIdRaw === undefined ||
        roomIdRaw === null ||
        typeof roomIdRaw !== 'string' ||
        roomIdRaw.trim().length === 0
      ) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      const roomId = roomIdRaw.trim() as Id<'chatRooms'>;

      let userId: Id<'users'> | null = null;
      try {
        userId = await resolveUserIdByAuthId(ctx, authUserId);
      } catch (err) {
        console.log('GET ROOM ERROR', err);
        console.log('GET ROOM RESULT', null);
        return null;
      }
      if (!userId) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      let room: Doc<'chatRooms'> | null = null;
      try {
        room = await ctx.db.get(roomId);
      } catch (err) {
        console.log('GET ROOM ERROR', err);
        console.log('GET ROOM RESULT', null);
        return null;
      }
      if (!room) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      const now = Date.now();
      const expiresAt = room.expiresAt;
      if (typeof expiresAt === 'number' && expiresAt <= now) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      const isPublic = room.isPublic === true;
      if (isPublic) {
        console.log('GET ROOM RESULT', room._id);
        return room;
      }

      let ban = null as Doc<'chatRoomBans'> | null;
      try {
        ban = await ctx.db
          .query('chatRoomBans')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch (err) {
        console.log('GET ROOM ERROR', err);
        console.log('GET ROOM RESULT', null);
        return null;
      }
      if (ban) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      let membership = null as Doc<'chatRoomMembers'> | null;
      try {
        membership = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch (err) {
        console.log('GET ROOM ERROR', err);
        console.log('GET ROOM RESULT', null);
        return null;
      }
      if (!membership) {
        console.log('GET ROOM RESULT', null);
        return null;
      }

      console.log('GET ROOM RESULT', room._id);
      return room;
    } catch (err) {
      console.error('getRoom crash', err);
      console.log('GET ROOM ERROR', err);
      console.log('GET ROOM RESULT', null);
      return null;
    }
  },
});

// List messages for a room (with pagination)
// Must align with checkRoomAccess / getRoom: public rooms do not require chatRoomMembers;
// private rooms require membership (and not banned). Never throw — return empty result.
export const listMessages = query({
  args: {
    roomId: v.string(),
    authUserId: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const empty = { messages: [] as Doc<'chatRoomMessages'>[], hasMore: false };
    console.log('LIST_MESSAGES HIT', args);
    console.log('LIST_MESSAGES STEP 1');

    const { roomId: roomIdRaw, authUserId, limit } = args;

    if (!roomIdRaw || typeof roomIdRaw !== 'string') {
      return empty;
    }
    if (!authUserId || authUserId.trim().length === 0) {
      return empty;
    }

    const roomId = roomIdRaw.trim() as Id<'chatRooms'>;

    console.log('LIST_MESSAGES STEP 2');
    let userId: Id<'users'> | null = null;
    try {
      userId = await resolveUserIdByAuthId(ctx, authUserId);
    } catch (err) {
      console.error('LIST_MESSAGES FAIL AT AUTH_USER_RESOLUTION', err);
      return empty;
    }
    if (!userId) {
      return empty;
    }

    console.log('LIST_MESSAGES STEP 3');
    let room: Doc<'chatRooms'> | null = null;
    try {
      room = await ctx.db.get(roomId);
    } catch (err) {
      console.error('LIST_MESSAGES FAIL AT ROOM_LOOKUP', err);
      return empty;
    }
    if (!room) {
      return empty;
    }

    const now = Date.now();
    try {
      if (room.expiresAt && room.expiresAt <= now) {
        return empty;
      }
    } catch (err) {
      console.error('LIST_MESSAGES FAIL AT EXPIRY_CHECK', err);
      return empty;
    }

    if (!room.isPublic) {
      let ban: Doc<'chatRoomBans'> | null = null;
      try {
        ban = await ctx.db
          .query('chatRoomBans')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch (err) {
        console.error('LIST_MESSAGES FAIL AT BAN_QUERY', err);
        return empty;
      }
      if (ban) {
        return empty;
      }

      let membership: Doc<'chatRoomMembers'> | null = null;
      try {
        membership = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch (err) {
        console.error('LIST_MESSAGES FAIL AT MEMBERSHIP_QUERY', err);
        return empty;
      }
      if (!membership) {
        return empty;
      }
    }

    let messages: Doc<'chatRoomMessages'>[] = [];
    try {
      const legacyExpiryCutoff = now - 24 * 60 * 60 * 1000;
      let q = ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created', (q) => q.eq('roomId', roomId));

      q = q.filter((qf) =>
        qf.and(
          qf.or(
            qf.eq(qf.field('deletedAt'), undefined),
            qf.eq(qf.field('deletedAt'), null)
          ),
          qf.or(
            qf.gt(qf.field('expiresAt'), now),
            qf.and(
              qf.or(
                qf.eq(qf.field('expiresAt'), undefined),
                qf.eq(qf.field('expiresAt'), null)
              ),
              qf.gt(qf.field('createdAt'), legacyExpiryCutoff)
            )
          )
        )
      );

      messages = await q.order('desc').take(limit + 1);
    } catch (err) {
      console.error('LIST_MESSAGES FAIL AT MESSAGES_QUERY', err);
      return empty;
    }

    let hasMore = false;
    let result: Doc<'chatRoomMessages'>[] = [];
    try {
      hasMore = messages.length > limit;
      result = hasMore ? messages.slice(0, limit) : messages;
      result = result.reverse();
    } catch (err) {
      console.error('LIST_MESSAGES FAIL AT RESULT_SHAPING', err);
      return empty;
    }

    // Chat Rooms identity: attach sender chat-room profile fields only.
    // BLOCKED: do NOT use users/userPrivateProfiles for name/photo/bio.
    try {
      const senderIds = Array.from(new Set(result.map((m) => String(m.senderId))));
      const profiles = await Promise.all(
        senderIds.map(async (sid) => {
          const uid = sid as Id<'users'>;
          const profile = await ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', uid))
            .first();
          return { sid, profile };
        })
      );
      const profileMap = new Map(
        profiles.map(({ sid, profile }) => [
          sid,
          {
            nickname: profile?.nickname ?? 'User',
            avatarUrl: profile?.avatarUrl ?? null,
            avatarVersion: profile?.updatedAt ?? 0,
            bio: profile?.bio ?? null,
          },
        ])
      );

      return {
        messages: result.map((m) => {
          const p = profileMap.get(String(m.senderId));
          return {
            ...m,
            senderNickname: p?.nickname ?? 'User',
            senderAvatarUrl: p?.avatarUrl ?? null,
            senderAvatarVersion: p?.avatarVersion ?? 0,
            // Keep senderGender from message row if present elsewhere; do not infer from profile.
          } as any;
        }),
        hasMore,
      };
    } catch (err) {
      console.error('LIST_MESSAGES FAIL AT SENDER_IDENTITY_ENRICH', err);
      return empty;
    }
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

function calculateAgeFromDob(dateOfBirth: string | undefined): number {
  if (!dateOfBirth) return 0;
  const birthDate = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export const listMembersWithProfiles = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    console.log('LIST_MEMBERS_HIT', { roomId, authUserId: authUserId?.slice?.(0, 20) });
    // SAFE-QUERY FIX: Return empty array instead of throwing to prevent UI crashes
    // Access check: auth + membership + not banned
    try {
      if (!authUserId || authUserId.trim().length === 0) {
        console.log('LIST_MEMBERS_FAIL', { reason: 'empty_authUserId' });
        return [];
      }
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      console.log('LIST_MEMBERS_RESOLVED', { authUserId: authUserId.slice(0, 20), resolvedUserId: userId?.slice?.(0, 20) ?? 'NULL' });
      if (!userId) {
        console.log('LIST_MEMBERS_FAIL', { reason: 'user_not_found' });
        return [];
      }
      const room = await ctx.db.get(roomId);
      if (!room) {
        return [];
      }
      const now = Date.now();
      if (room.expiresAt && room.expiresAt <= now) {
        return [];
      }
      // Check ban
      const ban = await ctx.db
        .query('chatRoomBans')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (ban) {
        return [];
      }
      // Check membership for private rooms
      if (!room.isPublic) {
        const membership = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
        if (!membership) {
          return [];
        }
      }
    } catch {
      return [];
    }

    const now = Date.now();

    // Limit to MAX_MEMBERS_TO_FETCH to prevent performance issues
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(MAX_MEMBERS_TO_FETCH);

    // Fetch chat-room profiles + users for age/gender ONLY.
    const membersWithProfiles = await Promise.all(
      members.map(async (member) => {
        const [chatProfile, user] = await Promise.all([
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', member.userId))
            .first(),
          ctx.db.get(member.userId),
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

        // CHATROOM_MEMBER_AGE_FIX: Ensure age is extracted from user details
        // Priority: calculated from user.dateOfBirth
        const dobAge = calculateAgeFromDob(user?.dateOfBirth);
        const finalAge = dobAge;

        // CHATROOM_MEMBER_AGE_BACKEND: Log age data sources
        console.log('CHATROOM_MEMBER_AGE_BACKEND', {
          memberId: String(member.userId).slice(0, 12),
          userDob: user?.dateOfBirth,
          dobAge,
          finalAge,
          gender: user?.gender ?? '',
        });

        return {
          id: member.userId,
          // Chat Rooms identity (canonical)
          displayName: chatProfile?.nickname ?? 'User',
          avatar: chatProfile?.avatarUrl ?? undefined,
          age: finalAge,
          gender: user?.gender ?? '',
          bio: chatProfile?.bio ?? undefined,
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
    const filtered = membersWithProfiles.filter((m): m is NonNullable<typeof m> => m !== null);

    // PRIVATE-ROOM-ACCESS-FIX: Instrumentation for member list count
    console.log('CHATROOM_MEMBER_LIST_COUNT', { roomId, count: filtered.length });

    return filtered;
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

    // Check room type for different leave behaviors
    const room = await ctx.db.get(roomId);
    if (!room) {
      // Room was ended/deleted - nothing to update, return safely
      console.log('PRIVATE_ROOM_LEAVE_SUCCESS', { roomId, userId: userId.slice(0, 12), note: 'room_already_deleted' });
      return;
    }

    const isPrivate = !room.isPublic;

    // PRESENCE HARD-DELETE: Always remove presence row immediately on leave,
    // for BOTH public and private rooms.
    const presenceRows = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .collect();
    for (const row of presenceRows) {
      await ctx.db.delete(row._id);
    }
    console.log('CHATROOM_BACKEND_LEAVE_DELETE', {
      roomId,
      userId: String(userId).slice(0, 12),
      deletedRows: presenceRows.length,
    });
    console.log('CHATROOM_BACKEND_PRESENCE_ROWS', {
      roomId,
      userId: String(userId).slice(0, 12),
      remainingRowsInRoom: (await ctx.db.query('chatRoomPresence').withIndex('by_room', (q) => q.eq('roomId', roomId)).collect()).length,
    });

    if (isPrivate) {
      console.log('PRIVATE_ROOM_LEAVE_TRIGGERED', { roomId, userId: userId.slice(0, 12) });

      // PRIVATE-ROOM-MEMBERSHIP-FIX: For private rooms, do NOT delete membership
      // "Leave Room" only exits the UI/presence, membership persists for re-entry without password
      // The membership record stays so isMember remains true for approved users
      // Presence system handles "currently in room" vs "left room" state

      // Just log success - no membership deletion for private rooms
      console.log('PRIVATE_ROOM_LEAVE_SUCCESS', {
        roomId,
        userId: userId.slice(0, 12),
        note: 'membership_preserved_for_reentry',
      });
      return;
    }

    // PUBLIC ROOMS: Delete membership (user can freely rejoin public rooms)
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .collect();

    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
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
    // SEND-FIX: senderId is now optional - we use resolved userId from authUserId
    // Frontend was passing authUserId as senderId which caused mismatch
    senderId: v.optional(v.id('users')),
    text: v.optional(v.string()),
    // CR-009 FIX: Accept either URL (demo mode/legacy) or storage ID (real upload)
    imageUrl: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.id('_storage')), // CR-009: For uploaded images
    audioStorageId: v.optional(v.id('_storage')), // CR-009: For uploaded audio
    mediaType: v.optional(v.union(v.literal('image'), v.literal('video'), v.literal('doodle'), v.literal('audio'))),
    clientId: v.optional(v.string()),
    replyToMessageId: v.optional(v.id('chatRoomMessages')),
    mentions: v.optional(
      v.array(
        v.object({
          userId: v.id('users'),
          nickname: v.string(),
          startIndex: v.number(),
          endIndex: v.number(),
        })
      )
    ),
  },
  handler: async (
    ctx,
    {
      roomId,
      authUserId,
      senderId: _senderIdLegacy, // SEND-FIX: Ignored - use resolved userId instead
      text,
      imageUrl,
      audioUrl,
      imageStorageId,
      audioStorageId,
      mediaType,
      clientId,
      replyToMessageId,
      mentions,
    }
  ) => {
    console.log('SEND_MESSAGE HIT', { roomId, authUserId, text: text?.slice(0, 50) });

    // 0. SECURITY: Require send access (auth + membership + not banned + no send-blocking penalty)
    let userId: Id<'users'>;
    let room: any;
    let membership: any;
    try {
      const access = await requireRoomSendAccess(ctx, roomId, authUserId);
      userId = access.userId;
      room = access.room;
      membership = access.membership;
    } catch (err: any) {
      console.error('SEND_MESSAGE FAIL AT ACCESS_CHECK', err?.message, { roomId, authUserId });
      throw err;
    }

    // SEND-FIX: Use resolved userId as senderId (removed mismatch check)
    // The authenticated user IS the sender - no need for separate senderId param
    const senderId = userId;

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
    const expiresAt = now + 24 * 60 * 60 * 1000;
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
      // P0-1 / P0-2: Verify ownership + validate blob metadata BEFORE resolving
      // URL so a mismatched or cross-user blob never reaches persistence.
      // `imageStorageId` is reused by the frontend for video uploads when
      // `mediaType === 'video'` — validate against the actual declared kind.
      const imageKind: ChatRoomMediaKind =
        mediaType === 'video'
          ? 'video'
          : mediaType === 'doodle'
            ? 'doodle'
            : 'image';
      await verifyOrClaimChatRoomMediaOwnership(ctx, imageStorageId, senderId, imageKind);
      await validateChatRoomMediaMetadata(ctx, imageStorageId, imageKind);

      const url = await ctx.storage.getUrl(imageStorageId);
      if (!url) {
        throw new Error('Invalid image storage reference');
      }
      resolvedImageUrl = url;
    }

    if (audioStorageId) {
      // P0-1 / P0-2: Same ownership + metadata guard for audio uploads.
      await verifyOrClaimChatRoomMediaOwnership(ctx, audioStorageId, senderId, 'audio');
      await validateChatRoomMediaMetadata(ctx, audioStorageId, 'audio');

      const url = await ctx.storage.getUrl(audioStorageId);
      if (!url) {
        throw new Error('Invalid audio storage reference');
      }
      resolvedAudioUrl = url;
    }

    // Determine message type: use explicit mediaType if provided, otherwise infer from media URLs
    const type = resolvedAudioUrl ? 'audio' : resolvedImageUrl ? (mediaType ?? 'image') : 'text';
    const persistedImageStorageId =
      type === 'image' || type === 'doodle' ? imageStorageId : undefined;
    const persistedVideoStorageId = type === 'video' ? imageStorageId : undefined;
    const persistedAudioStorageId = type === 'audio' ? audioStorageId : undefined;

    // Soft-mask sensitive words in text messages
    const maskedText = text ? softMaskText(text) : undefined;

    // Reply target (same room, not deleted)
    let replyToSenderNickname: string | undefined;
    let replyToSnippet: string | undefined;
    let replyToType:
      | 'text'
      | 'image'
      | 'video'
      | 'doodle'
      | 'audio'
      | 'system'
      | undefined;
    if (replyToMessageId) {
      const replyMsg = await ctx.db.get(replyToMessageId);
      if (!replyMsg || replyMsg.roomId !== roomId || replyMsg.deletedAt) {
        throw new Error('Invalid reply target');
      }
      const replySender = await ctx.db.get(replyMsg.senderId);
      const replyProfile = await ctx.db
        .query('chatRoomProfiles')
        .withIndex('by_userId', (q) => q.eq('userId', replyMsg.senderId))
        .first();
      replyToSenderNickname = replyProfile?.nickname ?? replySender?.name ?? 'User';
      if (replyMsg.type === 'text' && replyMsg.text) {
        replyToSnippet =
          replyMsg.text.length > 50 ? replyMsg.text.slice(0, 47) + '...' : replyMsg.text;
      } else if (replyMsg.type === 'image') {
        replyToSnippet = '📷 Photo';
      } else if (replyMsg.type === 'video') {
        replyToSnippet = '🎬 Video';
      } else if (replyMsg.type === 'doodle') {
        replyToSnippet = '🎨 Doodle';
      } else if (replyMsg.type === 'audio') {
        replyToSnippet = '🎤 Voice message';
      } else {
        replyToSnippet = 'Message';
      }
      replyToType = replyMsg.type;
    }

    // 4. Insert message with resolved URLs
    const messageId = await ctx.db.insert('chatRoomMessages', {
      roomId,
      senderId,
      type,
      text: maskedText,
      imageUrl: resolvedImageUrl ?? undefined,
      imageStorageId: persistedImageStorageId,
      videoStorageId: persistedVideoStorageId,
      audioUrl: resolvedAudioUrl ?? undefined,
      audioStorageId: persistedAudioStorageId,
      createdAt: now,
      expiresAt,
      clientId,
      status: 'sent',
      ...(replyToMessageId
        ? {
            replyToMessageId,
            replyToSenderNickname,
            replyToSnippet,
            replyToType,
          }
        : {}),
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    });

    // 4b. Mention inbox notifications (best-effort; never fails the send)
    if (mentions && mentions.length > 0) {
      const roomName = (room as { name?: string }).name ?? 'Chat';
      const previewBase =
        maskedText && maskedText.length > 0
          ? maskedText.length > 120
            ? maskedText.slice(0, 117) + '...'
            : maskedText
          : type === 'image'
            ? '📷 Photo'
            : type === 'video'
              ? '🎬 Video'
              : type === 'audio'
                ? '🎤 Voice message'
                : type === 'doodle'
                  ? '🎨 Doodle'
                  : 'Message';

      const deduped = new Set<string>();
      for (const men of mentions) {
        if (men.userId === senderId) continue;
        const uid = men.userId as string;
        if (deduped.has(uid)) continue;
        deduped.add(uid);
        const isMember = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', men.userId))
          .first();
        if (!isMember) continue;

        if (!(await shouldCreatePhase2ChatRoomsNotification(ctx, men.userId))) {
          continue;
        }

        try {
          await ctx.db.insert('chatRoomMentionNotifications', {
            mentionedUserId: men.userId,
            senderId,
            roomId,
            messageId,
            messagePreview: previewBase,
            roomName,
            createdAt: now,
          });
        } catch {
          // keep send success even if inbox row fails
        }
      }
    }

    // 5. Update room's last message info
    await ctx.db.patch(roomId, {
      lastMessageAt: now,
      lastMessageText: maskedText ?? (resolvedAudioUrl ? '[Audio]' : resolvedImageUrl ? '[Image]' : ''),
    });

    // 6. Update member's lastMessageAt for rate limiting tracking
    await ctx.db.patch(membership._id, { lastMessageAt: now });

    // 7. REWARD: Add +1 coin to sender's wallet for successful message send
    // This only fires for NEW messages (dedup returns early at line 670)
    // PRIVATE-ROOM-COIN-FIX: Skip coin reward for private room messages (zero coin effect)
    if (room.isPublic) {
      const senderUser = await ctx.db.get(senderId);
      if (senderUser) {
        const currentCoins = senderUser.walletCoins ?? 0;
        await ctx.db.patch(senderId, { walletCoins: currentCoins + 1 });
      }
    } else {
      console.log('PRIVATE_ROOM_NO_COIN_DEBIT_ON_MESSAGE', { roomId, senderId: senderId.slice(0, 12), isPublic: room.isPublic });
    }

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
          await cleanupChatRoomMessageRelations(ctx, roomId, msg._id);
          await deleteChatRoomMessageStorage(ctx, msg);
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

    // Instrumentation for private room message send (no coin effect)
    if (!room.isPublic) {
      console.log('PRIVATE_ROOM_MESSAGE_SEND', { roomId, messageId, senderId: senderId.slice(0, 12), coinEffect: 'none' });
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

    await cleanupChatRoomMessageRelations(ctx, roomId, messageId);
    await deleteChatRoomMessageStorage(ctx, message);

    // 10. Soft-delete by setting deletedAt timestamp
    await ctx.db.patch(messageId, { deletedAt: Date.now() });

    return { success: true };
  },
});

// CR-015: createRoom mutation REMOVED (was unused legacy code)
// Use createPrivateRoom for actual room creation (properly auth-hardened with coin cost)

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
    console.log('CREATE_PRIVATE_ROOM_START', { name, authUserId: authUserId?.slice(0, 20), isDemo, demoUserId: demoUserId?.slice(0, 20) });

    // 1. Auth guard - use app's custom session-based auth
    const authId = authUserId || demoUserId;
    if (!authId || authId.trim().length === 0) {
      console.log('CREATE_PRIVATE_ROOM_FAIL', { reason: 'no_auth_id' });
      throw new Error('Unauthorized: authentication required');
    }

    console.log('CREATE_PRIVATE_ROOM_RESOLVING_USER', { authId: authId.slice(0, 20) });
    const createdBy = await resolveUserIdByAuthId(ctx, authId);
    if (!createdBy) {
      console.log('CREATE_PRIVATE_ROOM_FAIL', { reason: 'user_not_found', authId: authId.slice(0, 20) });
      throw new Error('Unauthorized: user not found');
    }
    console.log('CREATE_PRIVATE_ROOM_USER_RESOLVED', { createdBy: createdBy.slice(0, 12) });

    // Check if demo user (for coin bypass)
    const isDemoUser = isDemo === true && !!demoUserId;

    // 2. Check wallet balance (skip for demo users)
    let currentCoins = 0;
    if (!isDemoUser) {
      console.log('CREATE_PRIVATE_ROOM_COIN_CHECK', { isDemoUser, createdBy: createdBy.slice(0, 12) });
      const user = await ctx.db.get(createdBy);
      if (!user) {
        console.log('CREATE_PRIVATE_ROOM_FAIL', { reason: 'user_lookup_failed', createdBy: createdBy.slice(0, 12) });
        throw new Error('User not found');
      }
      currentCoins = user.walletCoins ?? 0;
      console.log('CREATE_PRIVATE_ROOM_COINS', { currentCoins });
      if (currentCoins < 1) {
        console.log('CREATE_PRIVATE_ROOM_FAIL', { reason: 'insufficient_coins', currentCoins });
        throw new Error('Insufficient coins. You need at least 1 coin to create a private room.');
      }
    } else {
      console.log('CREATE_PRIVATE_ROOM_DEMO_USER_SKIP_COINS', { isDemoUser });
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
      console.log('PRIVATE_ROOM_COIN_DEBIT_ON_CREATE', { roomId, userId: createdBy.slice(0, 12), previousCoins: currentCoins, newCoins: currentCoins - 1 });
      await ctx.db.patch(createdBy, {
        walletCoins: currentCoins - 1,
      });
    }

    // 10. Schedule auto-deletion when room expires
    const expiresAt = now + ROOM_LIFETIME_MS;
    await ctx.scheduler.runAt(expiresAt, internal.chatRooms.deleteExpiredRoom, { roomId });

    console.log('CREATE_PRIVATE_ROOM_SUCCESS', { roomId, joinCode });
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

// Phase-2: Get private rooms where current user is owner or member
// Supports demo mode via optional isDemo/demoUserId args
export const getMyPrivateRooms = query({
  args: {
    authUserId: v.optional(v.string()), // Real mode: user's auth ID
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve userId (auth or demo)
    // AUTH FIX: Use authUserId for real mode, demoUserId for demo mode
    const authId = args.authUserId || args.demoUserId;
    if (!authId) {
      return [];
    }

    let userId: Id<'users'>;
    try {
      const resolved = await resolveUserIdByAuthId(ctx, authId);
      if (!resolved) return [];
      userId = resolved;
    } catch {
      return [];
    }

    const now = Date.now();
    const ONLINE_WINDOW_MS = 2 * 60 * 1000;

    // LEAVE-VS-END FIX: Private rooms should appear if user is:
    // 1. A current member, OR
    // 2. The creator (even if they left their own room)
    // This ensures "Leave Room" doesn't make created rooms disappear.

    // Get all memberships for this user
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const memberRoomIds = new Set(memberships.map((m) => m.roomId.toString()));

    // Also get rooms created by this user (even if no membership)
    const createdRooms = await ctx.db
      .query('chatRooms')
      .withIndex('by_creator', (q) => q.eq('createdBy', userId))
      .collect();

    // Build a map of roomId -> membership for role lookup
    const membershipByRoom = new Map(
      memberships.map((m) => [m.roomId.toString(), m])
    );

    // Combine: rooms from memberships + rooms created by user (deduplicated)
    const allRoomIds = new Set<string>();
    const roomsToProcess: { roomId: Id<'chatRooms'>; membership?: typeof memberships[0] }[] = [];

    // Add rooms from memberships
    for (const membership of memberships) {
      const roomIdStr = membership.roomId.toString();
      if (!allRoomIds.has(roomIdStr)) {
        allRoomIds.add(roomIdStr);
        roomsToProcess.push({ roomId: membership.roomId, membership });
      }
    }

    // Add created rooms (may not have membership if user left)
    for (const room of createdRooms) {
      const roomIdStr = room._id.toString();
      if (!allRoomIds.has(roomIdStr)) {
        allRoomIds.add(roomIdStr);
        roomsToProcess.push({
          roomId: room._id,
          membership: membershipByRoom.get(roomIdStr),
        });
      }
    }

    // Fetch room details
    const rooms = await Promise.all(
      roomsToProcess.map(async ({ roomId, membership }) => {
        const room = await ctx.db.get(roomId);
        if (!room) return null;
        // Filter out public rooms (only private)
        if (room.isPublic) return null;
        // Filter out expired rooms
        if (room.expiresAt && room.expiresAt <= now) return null;

        // BACKEND COUNT ONLY: Compute live online count from chatRoomPresence table.
        const presenceRecords = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();
        const onlineCount = presenceRecords.filter((p) => now - p.lastHeartbeatAt < ONLINE_WINDOW_MS).length;

        // Determine if current user is a member
        const isMember = memberRoomIds.has(room._id.toString());

        return {
          _id: room._id,
          name: room.name,
          slug: room.slug,
          category: room.category,
          isPublic: room.isPublic,
          onlineCount,
          lastMessageAt: room.lastMessageAt,
          lastMessageText: room.lastMessageText,
          createdAt: room.createdAt,
          expiresAt: room.expiresAt,
          joinCode: room.joinCode,
          createdBy: room.createdBy,
          role: membership?.role ?? (room.createdBy === userId ? 'owner' : 'member'),
          isMember, // Whether user currently has membership (for UI hints)
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

    // Instrumentation for private room end
    if (!room.isPublic) {
      console.log('PRIVATE_ROOM_END_TRIGGERED', { roomId, userId: userId.slice(0, 12), roomName: room.name });
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

// Internal: Cleanup expired chat room messages (called by cron job)
// Deletes only expired message rows in bounded batches.
export const cleanupExpiredChatRoomMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const BATCH = 200;
    const LEGACY_CUTOFF_MS = 24 * 60 * 60 * 1000;
    const legacyCutoff = now - LEGACY_CUTOFF_MS;

    const expiredMessages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_expires', (q) => q.lte('expiresAt', now))
      .take(BATCH);

    const deletedByRoom = new Map<string, number>();
    let deletedCount = 0;

    const processMessage = async (
      message: Doc<'chatRoomMessages'>
    ): Promise<void> => {
      try {
        await cleanupChatRoomMessageRelations(ctx, message.roomId, message._id);
        await deleteChatRoomMessageStorage(ctx, message);
        await ctx.db.delete(message._id);
        deletedCount++;
        const roomId = message.roomId as string;
        deletedByRoom.set(roomId, (deletedByRoom.get(roomId) ?? 0) + 1);
      } catch {
        // Message may already be gone from a concurrent cleanup path.
      }
    };

    for (const message of expiredMessages) {
      await processMessage(message);
    }

    // P0-3: Bounded legacy sweep.
    // Messages inserted before the retention fix have no `expiresAt` field, so
    // they will never match the `by_expires` range above. Here we pick up any
    // legacy rows older than 24h and apply the exact same full-cleanup path
    // (relations + storage + row delete + messageCount repair).
    const legacyBudget = BATCH - expiredMessages.length;
    if (legacyBudget > 0) {
      const legacyCandidates = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created')
        .filter((q) =>
          q.and(
            q.eq(q.field('expiresAt'), undefined),
            q.lte(q.field('createdAt'), legacyCutoff)
          )
        )
        .take(legacyBudget);

      for (const message of legacyCandidates) {
        await processMessage(message);
      }
    }

    for (const [roomId, roomDeletedCount] of deletedByRoom.entries()) {
      const room = await ctx.db.get(roomId as Id<'chatRooms'>);
      if (!room) {
        continue;
      }

      if (typeof room.messageCount === 'number') {
        await ctx.db.patch(room._id, {
          messageCount: Math.max(0, room.messageCount - roomDeletedCount),
        });
      }
    }

    return { deletedCount };
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

    // PRIVATE-ROOM-LIFETIME-FIX: Log room existence with lifetime info
    const now = Date.now();
    const remainingMs = room.expiresAt ? room.expiresAt - now : null;
    const remainingHours = remainingMs ? Math.round(remainingMs / (1000 * 60 * 60) * 10) / 10 : null;
    console.log('PRIVATE_ROOM_ROOM_EXISTS', {
      roomId,
      name: room.name,
      expiresAt: room.expiresAt,
      remainingHours,
      isExpired: room.expiresAt ? room.expiresAt <= now : false,
    });

    // Check if expired
    if (room.expiresAt && room.expiresAt <= now) {
      return { status: 'expired' as const };
    }

    // Check if banned/kicked
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      // PRIVATE-ROOM-ACCESS-FIX: Kicked user denied access
      console.log('PRIVATE_ROOM_KICKED_DENY', {
        roomId,
        userId: userId.slice(0, 12),
      });
      return { status: 'banned' as const };
    }

    // Check if member
    const membership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (membership) {
      // PRIVATE-ROOM-ACCESS-FIX: Approved member re-entry (no password needed)
      console.log('PRIVATE_ROOM_APPROVED_MEMBER_REENTRY', {
        roomId,
        userId: userId.slice(0, 12),
        role: membership.role ?? 'member',
      });
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

    // PRIVATE-ROOM-ACCESS-FIX: Return 'none' with room info for password modal decision
    // Also check if user is the room creator (owner bypass)
    const isCreator = room.createdBy === userId;
    const hasPassword = !!room.passwordHash || !!room.passwordEncrypted;

    console.log('PRIVATE_ROOM_ACCESS_CHECK', {
      roomId,
      userId: userId.slice(0, 12),
      status: 'none',
      isCreator,
      hasPassword,
    });

    // Owner bypass: creator always gets access (will auto-join on room load)
    if (isCreator) {
      console.log('PRIVATE_ROOM_OWNER_BYPASS', { roomId, userId: userId.slice(0, 12) });
      return { status: 'owner_bypass' as const, role: 'owner' as const, isCreator: true };
    }

    // First-time entrant: needs password if room has one
    if (hasPassword) {
      console.log('PRIVATE_ROOM_FIRST_TIME_PASSWORD_REQUIRED', { roomId, userId: userId.slice(0, 12) });
      return { status: 'none' as const, hasPassword: true };
    }

    // No password required - can join freely
    return { status: 'none' as const, hasPassword: false };
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
// CHAT ROOM PROFILE FUNCTIONS
// Separate identity for chat rooms (nickname-based, not real name)
// ═══════════════════════════════════════════════════════════════════════════

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
    if (!/^[a-zA-Z]/.test(trimmedNickname)) {
      throw new Error('Nickname must start with a letter');
    }
    if (/^\d+$/.test(trimmedNickname)) {
      throw new Error('Nickname cannot be purely numeric');
    }

    // Validate bio
    const trimmedBio = bio?.trim();
    if (trimmedBio && trimmedBio.length > 150) {
      throw new Error('Bio must be 150 characters or less');
    }

    // Validate avatarUrl - reject local file paths
    let validatedAvatarUrl = avatarUrl;
    if (avatarUrl) {
      const isLocalFile = avatarUrl.startsWith('file://') || avatarUrl.startsWith('content://');
      if (isLocalFile) {
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
 */
export const getChatRoomProfilesByUserIds = query({
  args: {
    userIds: v.array(v.id('users')),
    authUserId: v.string(),
  },
  handler: async (ctx, { userIds, authUserId }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return {};
    }
    const currentUserId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!currentUserId) {
      return {};
    }

    const profiles = await Promise.all(
      userIds.map(async (uid) => {
        const profile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', uid))
          .first();
        return { userId: uid, profile };
      })
    );

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
 * Canonical Chat Rooms identity for all users in a room.
 *
 * Product rules:
 * - name/photo/bio come ONLY from `chatRoomProfiles` (or placeholders)
 * - age/gender may come from main user/basic info (users table)
 * - NEVER use userPrivateProfiles or main profile name/photo/bio inside Chat Rooms identity.
 */
export const getRoomUserIdentities = query({
  args: {
    roomId: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const { roomId: roomIdRaw, authUserId } = args;

    if (!authUserId || authUserId.trim().length === 0) {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }
    if (!roomIdRaw || typeof roomIdRaw !== 'string') {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }

    const roomId = roomIdRaw.trim() as Id<'chatRooms'>;

    // Auth + access (aligns with getRoom/checkRoomAccess)
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }

    const room = await ctx.db.get(roomId);
    if (!room) {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }
    const now = Date.now();
    if (room.expiresAt && room.expiresAt <= now) {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }

    if (!room.isPublic) {
      const ban = await ctx.db
        .query('chatRoomBans')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (ban) {
        return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
      }

      const membership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (!membership) {
        return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
      }
    }

    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const memberUserIds = members.map((m) => m.userId);

    const [profiles, users] = await Promise.all([
      Promise.all(
        memberUserIds.map((uid) =>
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', uid))
            .first()
        )
      ),
      Promise.all(memberUserIds.map((uid) => ctx.db.get(uid))),
    ]);

    const byUserId: Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> = {};

    for (let i = 0; i < memberUserIds.length; i++) {
      const uid = memberUserIds[i];
      const profile = profiles[i];
      const user = users[i];

      // BLOCKED FALLBACKS: do NOT use user.name/user.bio/photos for chat-room identity.
      const nickname = profile?.nickname?.trim() || 'User';
      const avatarUrl = profile?.avatarUrl ?? null;
      const bio = profile?.bio ?? null;

      const age = calculateAgeFromDob(user?.dateOfBirth);
      const gender = user?.gender ?? undefined;

      byUserId[String(uid)] = { nickname, avatarUrl, bio, age: age > 0 ? age : undefined, gender };
    }

    return { selfUserId: String(userId), byUserId };
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
// UNREAD DM COUNTS BY ROOM
// Returns unread DM counts grouped by chat room for badge display
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get unread DM counts grouped by source room.
 * Used for Chat Rooms tab badges.
 * Accepts authUserId and resolves internally.
 */
export const getUnreadDmCountsByRoom = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Auth guard
    if (!authUserId || authUserId.trim().length === 0) {
      return { byRoomId: {}, totalUnread: 0, hasAnyUnread: false };
    }

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { byRoomId: {}, totalUnread: 0, hasAnyUnread: false };
    }

    // Get all participant rows for this user
    const participantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    if (participantRows.length === 0) {
      return { byRoomId: {}, totalUnread: 0, hasAnyUnread: false };
    }

    // Batch-fetch conversations
    const conversations = await Promise.all(
      participantRows.map((row) => ctx.db.get(row.conversationId))
    );

    // Build unread counts by room
    const byRoomId: Record<string, number> = {};
    let totalUnread = 0;

    for (let i = 0; i < conversations.length; i++) {
      const conversation = conversations[i];
      if (!conversation) continue;
      if (!conversation.sourceRoomId) continue;

      const roomIdStr = conversation.sourceRoomId as string;
      const unreadCount = participantRows[i].unreadCount || 0;

      if (unreadCount > 0) {
        byRoomId[roomIdStr] = (byRoomId[roomIdStr] || 0) + unreadCount;
        totalUnread += unreadCount;
      }
    }

    return {
      byRoomId,
      totalUnread,
      hasAnyUnread: totalUnread > 0,
    };
  },
});

/**
 * List DM threads originated from chat rooms (conversations with sourceRoomId).
 * Used by Chat Rooms room screen — Messages popover + unread badge.
 * Never throws: returns [] if auth cannot be resolved or on any per-thread error.
 */
export const getDmThreads = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return [];
    }

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return [];
    }

    const hiddenRows = await ctx.db
      .query('chatRoomHiddenDmConversations')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const hiddenConversationIds = new Set(hiddenRows.map((h) => h.conversationId as string));

    const participantRows = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    type ThreadRow = {
      id: string;
      peerId: string;
      peerName: string;
      peerAvatar?: string;
      peerGender?: 'male' | 'female' | 'other';
      lastMessage: string;
      lastMessageAt: number;
      unreadCount: number;
    };

    const threads: ThreadRow[] = [];

    for (const row of participantRows) {
      try {
        const conversation = await ctx.db.get(row.conversationId);
        if (!conversation) continue;
        if (!conversation.sourceRoomId) continue;
        if (hiddenConversationIds.has(conversation._id as string)) continue;

        const peerId = conversation.participants.find((p) => p !== userId);
        if (!peerId) continue;

        const peer = await ctx.db.get(peerId);
        if (!peer) continue;

        // CHATROOM_IDENTITY_NONCANONICAL_PATH_FOUND:
        // DMs are not allowed to use userPrivateProfiles for identity.
        // Use chat-room profile only for name/photo/bio, and main user gender for ring color.
        const chatProfile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', peerId))
          .first();

        const peerName = chatProfile?.nickname ?? 'User';
        const peerAvatar = chatProfile?.avatarUrl ?? undefined;
        const g = (peer.gender ?? 'other').toLowerCase();
        const peerGender: 'male' | 'female' | 'other' =
          g === 'male' || g === 'female' ? g : 'other';

        const lastMsg = await ctx.db
          .query('messages')
          .withIndex('by_conversation_created', (q) =>
            q.eq('conversationId', conversation._id)
          )
          .order('desc')
          .first();

        let lastMessage = '';
        if (lastMsg) {
          if (lastMsg.type === 'text') {
            lastMessage = lastMsg.content ?? '';
          } else if (lastMsg.type === 'image') {
            lastMessage = '📷 Photo';
          } else if (lastMsg.type === 'video') {
            lastMessage = '🎬 Video';
          } else if (lastMsg.type === 'voice') {
            lastMessage = '🎤 Voice message';
          } else {
            lastMessage = 'Message';
          }
        }

        const lastMessageAt =
          lastMsg?.createdAt ?? conversation.lastMessageAt ?? conversation.createdAt;

        threads.push({
          id: conversation._id as string,
          peerId: peerId as string,
          peerName,
          peerAvatar,
          peerGender,
          lastMessage,
          lastMessageAt,
          unreadCount: row.unreadCount ?? 0,
        });
      } catch {
        // Skip malformed thread; keep popover + screen alive
        continue;
      }
    }

    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return threads;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOM SCREEN: MENTIONS, REACTIONS, DM THREAD, PER-USER MUTES
// Safe defaults; queries never throw to the client for expected gaps.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * User's @mention inbox (cross-room). Empty when unauthenticated.
 */
export const getUserMentions = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { authUserId, limit }) => {
    try {
      if (!authUserId || authUserId.trim().length === 0) {
        return [];
      }
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return [];
      }
      const lim = Math.min(Math.max(limit ?? 50, 1), 100);
      const rows = await ctx.db
        .query('chatRoomMentionNotifications')
        .withIndex('by_mentioned_user_created', (q) => q.eq('mentionedUserId', userId))
        .order('desc')
        .take(lim);

      const out: Array<{
        id: string;
        senderUserId: string;
        senderNickname: string;
        roomId: string;
        roomName: string;
        messageId: string;
        messagePreview: string;
        createdAt: number;
        isRead: boolean;
        readAt?: number;
      }> = [];

      for (const row of rows) {
        try {
          const sender = await ctx.db.get(row.senderId);
          const profile = await ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', row.senderId))
            .first();
          const senderNickname = profile?.nickname ?? sender?.name ?? 'User';
          out.push({
            id: row._id as string,
            senderUserId: row.senderId as string,
            senderNickname,
            roomId: row.roomId as string,
            roomName: row.roomName,
            messageId: row.messageId as string,
            messagePreview: row.messagePreview,
            createdAt: row.createdAt,
            isRead: row.readAt !== undefined && row.readAt !== null,
            ...(row.readAt !== undefined && row.readAt !== null ? { readAt: row.readAt } : {}),
          });
        } catch {
          continue;
        }
      }
      return out;
    } catch {
      return [];
    }
  },
});

export const markMentionRead = mutation({
  args: {
    authUserId: v.string(),
    mentionId: v.id('chatRoomMentionNotifications'),
  },
  handler: async (ctx, { authUserId, mentionId }) => {
    try {
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return { success: false as const };
      }
      const row = await ctx.db.get(mentionId);
      if (!row || row.mentionedUserId !== userId) {
        return { success: false as const };
      }
      await ctx.db.patch(mentionId, { readAt: Date.now() });
      return { success: true as const };
    } catch {
      return { success: false as const };
    }
  },
});

export const markAllMentionsRead = mutation({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    try {
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return { success: false as const };
      }
      const rows = await ctx.db
        .query('chatRoomMentionNotifications')
        .withIndex('by_mentioned_user_created', (q) => q.eq('mentionedUserId', userId))
        .collect();
      const now = Date.now();
      for (const row of rows) {
        if (row.readAt === undefined || row.readAt === null) {
          await ctx.db.patch(row._id, { readAt: now });
        }
      }
      return { success: true as const };
    } catch {
      return { success: false as const };
    }
  },
});

/**
 * Aggregated emoji reactions for a batch of messages (Record<messageId, groups>).
 */
export const getReactionsForMessages = query({
  args: {
    roomId: v.id('chatRooms'),
    messageIds: v.array(v.id('chatRoomMessages')),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageIds, authUserId }) => {
    try {
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return {};
      }
      await requireRoomReadAccess(ctx, roomId, authUserId);
      const maxIds = messageIds.slice(0, 200);
      const result: Record<string, Array<{ emoji: string; count: number; userIds: string[] }>> = {};
      for (const mid of maxIds) {
        result[mid as string] = [];
      }
      for (const mid of maxIds) {
        try {
          const msg = await ctx.db.get(mid);
          if (!msg || msg.roomId !== roomId) {
            continue;
          }
          const reactions = await ctx.db
            .query('chatRoomMessageReactions')
            .withIndex('by_room_message', (q) =>
              q.eq('roomId', roomId).eq('messageId', mid)
            )
            .collect();
          const byEmoji = new Map<string, Set<string>>();
          for (const r of reactions) {
            if (!byEmoji.has(r.emoji)) {
              byEmoji.set(r.emoji, new Set());
            }
            byEmoji.get(r.emoji)!.add(r.userId as string);
          }
          const arr: Array<{ emoji: string; count: number; userIds: string[] }> = [];
          for (const [emoji, users] of byEmoji) {
            arr.push({
              emoji,
              count: users.size,
              userIds: Array.from(users),
            });
          }
          result[mid as string] = arr;
        } catch {
          result[mid as string] = [];
        }
      }
      return result;
    } catch {
      return {};
    }
  },
});

export const addReaction = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    emoji: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageId, emoji, authUserId }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);
    const msg = await ctx.db.get(messageId);
    if (!msg || msg.roomId !== roomId || msg.deletedAt) {
      throw new Error('Message not found');
    }
    const existingSame = await ctx.db
      .query('chatRoomMessageReactions')
      .withIndex('by_message_user', (q) => q.eq('messageId', messageId).eq('userId', userId))
      .collect();
    if (existingSame.some((r) => r.emoji === emoji)) {
      return { success: true as const };
    }
    await ctx.db.insert('chatRoomMessageReactions', {
      roomId,
      messageId,
      userId,
      emoji,
      createdAt: Date.now(),
    });
    return { success: true as const };
  },
});

export const removeReaction = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, messageId, authUserId }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);
    const msg = await ctx.db.get(messageId);
    if (!msg || msg.roomId !== roomId) {
      throw new Error('Message not found');
    }
    const rows = await ctx.db
      .query('chatRoomMessageReactions')
      .withIndex('by_message_user', (q) => q.eq('messageId', messageId).eq('userId', userId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { success: true as const };
  },
});

/**
 * Convex user IDs the current viewer has muted in this room (message visibility).
 */
export const getMutedUsersInRoom = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    try {
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return { mutedUserIds: [] as string[] };
      }
      const membership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (!membership) {
        return { mutedUserIds: [] as string[] };
      }
      const rows = await ctx.db
        .query('chatRoomPerUserMutes')
        .withIndex('by_room_muter', (q) => q.eq('roomId', roomId).eq('muterId', userId))
        .collect();
      return { mutedUserIds: rows.map((r) => r.targetUserId as string) };
    } catch {
      return { mutedUserIds: [] as string[] };
    }
  },
});

export const toggleMuteUserInRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId }) => {
    const userId = await requireAuthenticatedUser(ctx, authUserId);
    if (userId === targetUserId) {
      throw new Error('Cannot mute yourself');
    }
    await requireRoomReadAccess(ctx, roomId, authUserId);
    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', targetUserId)
      )
      .first();
    if (!targetMembership) {
      throw new Error('User is not in this room');
    }
    const rows = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter', (q) => q.eq('roomId', roomId).eq('muterId', userId))
      .collect();
    const existing = rows.find((r) => r.targetUserId === targetUserId);
    if (existing) {
      await ctx.db.delete(existing._id);
      return { success: true as const, muted: false as const };
    }
    await ctx.db.insert('chatRoomPerUserMutes', {
      roomId,
      muterId: userId,
      targetUserId,
      createdAt: Date.now(),
    });
    return { success: true as const, muted: true as const };
  },
});

/**
 * Create or return a DM conversation (Phase-1 `conversations` table) tied to a chat room when given.
 */
export const getOrCreateDmThread = mutation({
  args: {
    authUserId: v.string(),
    peerUserId: v.id('users'),
    sourceRoomId: v.optional(v.id('chatRooms')),
  },
  handler: async (ctx, { authUserId, peerUserId, sourceRoomId }) => {
    const userId = await requireAuthenticatedUser(ctx, authUserId);
    if (userId === peerUserId) {
      throw new Error('Invalid recipient');
    }
    const peer = await ctx.db.get(peerUserId);
    if (!peer) {
      throw new Error('User not found');
    }
    if (await isBlockedBidirectional(ctx, userId, peerUserId)) {
      throw new Error('Cannot start conversation');
    }

    if (sourceRoomId) {
      const r = await ctx.db.get(sourceRoomId);
      if (!r || (r.expiresAt && r.expiresAt <= Date.now())) {
        throw new Error('Room not found');
      }
      const m1 = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', sourceRoomId).eq('userId', userId))
        .first();
      const m2 = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', sourceRoomId).eq('userId', peerUserId))
        .first();
      if (!m1 || !m2) {
        throw new Error('Both users must be in this room');
      }
    }

    const sortedParticipants: [Id<'users'>, Id<'users'>] =
      (userId as string) < (peerUserId as string)
        ? [userId, peerUserId]
        : [peerUserId, userId];

    let found: Id<'conversations'> | null = null;

    if (sourceRoomId) {
      const candidates = await ctx.db
        .query('conversations')
        .withIndex('by_source_room', (q) => q.eq('sourceRoomId', sourceRoomId))
        .collect();
      for (const c of candidates) {
        if (c.participants.length !== 2) continue;
        if (!c.participants.includes(userId) || !c.participants.includes(peerUserId)) {
          continue;
        }
        found = c._id;
        break;
      }
    } else {
      const mine = await ctx.db
        .query('conversationParticipants')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect();
      for (const row of mine) {
        const c = await ctx.db.get(row.conversationId);
        if (!c || c.participants.length !== 2) continue;
        if (!c.participants.includes(peerUserId)) continue;
        found = c._id;
        break;
      }
    }

    const now = Date.now();

    if (!found) {
      const conversationId = await ctx.db.insert('conversations', {
        participants: sortedParticipants,
        isPreMatch: false,
        connectionSource: 'room',
        ...(sourceRoomId ? { sourceRoomId } : {}),
        createdAt: now,
        lastMessageAt: now,
      });

      await ctx.db.insert('conversationParticipants', {
        conversationId,
        userId,
        unreadCount: 0,
      });
      await ctx.db.insert('conversationParticipants', {
        conversationId,
        userId: peerUserId,
        unreadCount: 0,
      });

      return { threadId: conversationId };
    }

    await upsertConversationParticipant(ctx, found, userId);
    await upsertConversationParticipant(ctx, found, peerUserId);

    return { threadId: found };
  },
});

/** Hide a DM thread from the inbox list (per user; does not delete messages). */
export const hideDmThread = mutation({
  args: {
    authUserId: v.string(),
    threadId: v.id('conversations'),
  },
  handler: async (ctx, { authUserId, threadId }) => {
    try {
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return { success: false as const };
      }
      const conv = await ctx.db.get(threadId);
      if (!conv || !conv.participants.includes(userId)) {
        return { success: false as const };
      }
      const existing = await ctx.db
        .query('chatRoomHiddenDmConversations')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', userId).eq('conversationId', threadId)
        )
        .first();
      if (existing) {
        return { success: true as const };
      }
      await ctx.db.insert('chatRoomHiddenDmConversations', {
        userId,
        conversationId: threadId,
        hiddenAt: Date.now(),
      });
      return { success: true as const };
    } catch {
      return { success: false as const };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PASSWORD-PROTECTED ROOM ENTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Password attempt limits and cooldowns.
 * Stage 1: 3 immediate attempts
 * Stage 2: 3-minute cooldown, then 1 attempt
 * Stage 3: 2-minute cooldown, then 1 final attempt
 * Stage 4: Permanently blocked
 */
const PASSWORD_STAGE_CONFIG = {
  1: { maxAttempts: 3, cooldownMs: 0 },
  2: { maxAttempts: 1, cooldownMs: 3 * 60 * 1000 }, // 3 minutes
  3: { maxAttempts: 1, cooldownMs: 2 * 60 * 1000 }, // 2 minutes
  4: { maxAttempts: 0, cooldownMs: 0 }, // blocked
} as const;

/**
 * Get current password attempt state for a user and room.
 * Used by PasswordEntryModal to display attempt status.
 */
export const getPasswordAttemptState = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Validate auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { stage: 1, attemptsRemaining: 3, blocked: false, cooldown: false };
    }

    // Look up existing attempt record
    const attemptRecord = await ctx.db
      .query('chatRoomPasswordAttempts')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('authUserId', authUserId))
      .first();

    if (!attemptRecord) {
      // No attempts yet - Stage 1, 3 attempts available
      return { stage: 1, attemptsRemaining: 3, blocked: false, cooldown: false };
    }

    // Check if blocked
    if (attemptRecord.blocked) {
      return { stage: 4, attemptsRemaining: 0, blocked: true, cooldown: false };
    }

    const now = Date.now();
    const stage = attemptRecord.stage;
    const stageConfig = PASSWORD_STAGE_CONFIG[stage as keyof typeof PASSWORD_STAGE_CONFIG];

    // Check if in cooldown
    if (attemptRecord.cooldownUntil && attemptRecord.cooldownUntil > now) {
      return {
        stage,
        attemptsRemaining: 0,
        blocked: false,
        cooldown: true,
        cooldownRemainingMs: attemptRecord.cooldownUntil - now,
      };
    }

    // Calculate remaining attempts
    const attemptsUsed = attemptRecord.attempts;
    const attemptsRemaining = Math.max(0, stageConfig.maxAttempts - attemptsUsed);

    return {
      stage,
      attemptsRemaining,
      blocked: false,
      cooldown: false,
    };
  },
});

/**
 * Join a password-protected room with password verification.
 * Implements staged attempt limits with cooldowns.
 */
export const joinRoomWithPassword = mutation({
  args: {
    roomId: v.id('chatRooms'),
    password: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, password, authUserId }) => {
    // Validate auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }

    // Get the room
    const room = await ctx.db.get(roomId);
    if (!room) {
      return { success: false, message: 'Room not found' };
    }

    // Check if room is expired
    if (room.expiresAt && room.expiresAt < Date.now()) {
      return { success: false, message: 'This room has expired' };
    }

    // Check if room requires password
    if (!room.passwordEncrypted) {
      // No password required - just check if user can join
      return { success: false, message: 'This room does not require a password' };
    }

    // Get or create attempt record
    let attemptRecord = await ctx.db
      .query('chatRoomPasswordAttempts')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('authUserId', authUserId))
      .first();

    const now = Date.now();

    // Initialize record if doesn't exist
    if (!attemptRecord) {
      const newRecordId = await ctx.db.insert('chatRoomPasswordAttempts', {
        roomId,
        authUserId,
        stage: 1,
        attempts: 0,
        lastAttemptAt: now,
        blocked: false,
      });
      attemptRecord = await ctx.db.get(newRecordId);
      if (!attemptRecord) {
        return { success: false, message: 'Failed to create attempt record' };
      }
    }

    // Check if permanently blocked
    if (attemptRecord.blocked) {
      return {
        success: false,
        blocked: true,
        message: 'Maximum attempts reached. You cannot join this room.',
      };
    }

    // Check if in cooldown
    if (attemptRecord.cooldownUntil && attemptRecord.cooldownUntil > now) {
      return {
        success: false,
        cooldown: true,
        cooldownRemainingMs: attemptRecord.cooldownUntil - now,
        message: 'Too many attempts. Please wait before trying again.',
      };
    }

    // Verify password
    const storedPassword = await decryptPassword(room.passwordEncrypted);
    const isCorrect = password === storedPassword;

    if (isCorrect) {
      // Password correct - join the room
      const userId = await resolveUserIdByAuthId(ctx, authUserId);
      if (!userId) {
        return { success: false, message: 'User not found' };
      }

      // Check if user is banned
      const membership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();

      if (membership?.isBanned) {
        return { success: false, message: 'You are not allowed to join this room' };
      }

      // Add or update membership
      if (membership) {
        await ctx.db.patch(membership._id, {
          passwordVerified: true,
          joinedAt: now,
        });
      } else {
        await ctx.db.insert('chatRoomMembers', {
          roomId,
          userId,
          role: 'member',
          joinedAt: now,
          isBanned: false,
          passwordVerified: true,
        });
        // Increment member count
        await ctx.db.patch(roomId, { memberCount: (room.memberCount || 0) + 1 });
      }

      // Clear attempt record on success
      await ctx.db.delete(attemptRecord._id);

      return { success: true };
    }

    // Password incorrect - update attempt record
    const stage = attemptRecord.stage;
    const stageConfig = PASSWORD_STAGE_CONFIG[stage as keyof typeof PASSWORD_STAGE_CONFIG];
    const newAttempts = attemptRecord.attempts + 1;

    // Check if exhausted attempts in current stage
    if (newAttempts >= stageConfig.maxAttempts) {
      // Move to next stage
      const nextStage = stage + 1;

      if (nextStage > 3) {
        // Stage 4 - permanently blocked
        await ctx.db.patch(attemptRecord._id, {
          stage: 4,
          attempts: newAttempts,
          lastAttemptAt: now,
          blocked: true,
        });
        return {
          success: false,
          blocked: true,
          message: 'Maximum attempts reached. You cannot join this room.',
        };
      }

      // Enter cooldown for next stage
      const nextStageConfig = PASSWORD_STAGE_CONFIG[nextStage as keyof typeof PASSWORD_STAGE_CONFIG];
      const cooldownUntil = now + nextStageConfig.cooldownMs;

      await ctx.db.patch(attemptRecord._id, {
        stage: nextStage,
        attempts: 0,
        lastAttemptAt: now,
        cooldownUntil,
      });

      return {
        success: false,
        cooldown: true,
        cooldownRemainingMs: nextStageConfig.cooldownMs,
        stage: nextStage,
        attemptsRemaining: 0,
        message: 'Too many attempts. Please wait before trying again.',
      };
    }

    // Still have attempts remaining in current stage
    await ctx.db.patch(attemptRecord._id, {
      attempts: newAttempts,
      lastAttemptAt: now,
    });

    const attemptsRemaining = stageConfig.maxAttempts - newAttempts;

    return {
      success: false,
      attemptsRemaining,
      stage,
      message: 'Incorrect password',
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOM PRESENCE / HEARTBEAT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Presence thresholds (milliseconds).
 * - ONLINE_THRESHOLD: User is online if heartbeat within this window
 * - RECENTLY_LEFT_THRESHOLD: User is "recently left" if heartbeat within this window (but > ONLINE)
 */
const PRESENCE_ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const PRESENCE_RECENTLY_LEFT_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Send heartbeat to mark user as active in a room.
 * Creates or updates presence record.
 */
export const heartbeatPresence = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Validate auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { success: false };
    }

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { success: false };
    }

    // Verify room exists
    const room = await ctx.db.get(roomId);
    if (!room) {
      return { success: false };
    }

    const now = Date.now();

    // SINGLE-ROOM PRESENCE: ensure user exists in only one room at a time.
    // Delete any other presence rows for this user in other rooms.
    const otherPresence = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    let deletedOther = 0;
    for (const row of otherPresence) {
      if (row.roomId !== roomId) {
        await ctx.db.delete(row._id);
        deletedOther++;
      }
    }

    // Find existing presence record
    const existing = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (existing) {
      // Update heartbeat
      await ctx.db.patch(existing._id, {
        lastHeartbeatAt: now,
      });
    } else {
      // Create new presence record
      await ctx.db.insert('chatRoomPresence', {
        roomId,
        userId,
        lastHeartbeatAt: now,
        joinedAt: now,
      });
    }

    console.log('CHATROOM_BACKEND_ONLINE_COUNT', {
      roomId,
      userId: String(userId).slice(0, 12),
      deletedOtherRooms: deletedOther,
    });

    return { success: true };
  },
});

/**
 * Get presence state for a room.
 * Returns online users and recently left users.
 */
export const getRoomPresence = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // Validate auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { online: [], recentlyLeft: [] };
    }

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { online: [], recentlyLeft: [] };
    }

    // Get all presence records for this room
    const presenceRecords = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const now = Date.now();

    // Partition into online and recently left
    const online: Array<{
      id: string;
      displayName: string;
      avatar: string | undefined;
      age: number;
      gender: string;
      bio: string | undefined;
      role: 'owner' | 'admin' | 'member';
      lastHeartbeatAt: number;
      joinedAt: number;
    }> = [];

    const recentlyLeft: typeof online = [];

    // Get room members for role info
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const memberRoleMap = new Map<string, 'owner' | 'admin' | 'member'>();
    for (const m of members) {
      memberRoleMap.set(String(m.userId), m.role);
    }

    // Chat Rooms identity: fetch chat-room profiles + users for age/gender ONLY.
    const userIds = presenceRecords.map((p) => p.userId);
    const [chatProfiles, users] = await Promise.all([
      Promise.all(
        userIds.map((id) =>
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', id))
            .first()
        )
      ),
      Promise.all(userIds.map((id) => ctx.db.get(id))),
    ]);

    for (let i = 0; i < presenceRecords.length; i++) {
      const record = presenceRecords[i];
        const chatProfile = chatProfiles[i];
      const user = users[i];

      const timeSinceHeartbeat = now - record.lastHeartbeatAt;
      const role = memberRoleMap.get(String(record.userId)) || 'member';

      // CHATROOM_MEMBER_AGE_FIX: Extract age from profile or calculate from user.dateOfBirth
      const dobAge = calculateAgeFromDob(user?.dateOfBirth);
        const finalAge = dobAge;

      const presenceUser = {
        id: String(record.userId),
          // Chat Rooms identity (canonical)
          displayName: chatProfile?.nickname ?? 'User',
          avatar: chatProfile?.avatarUrl ?? undefined,
        age: finalAge,
          gender: user?.gender ?? '',
          bio: chatProfile?.bio ?? undefined,
        role,
        lastHeartbeatAt: record.lastHeartbeatAt,
        joinedAt: record.joinedAt,
      };

      if (timeSinceHeartbeat <= PRESENCE_ONLINE_THRESHOLD_MS) {
        online.push(presenceUser);
      } else if (timeSinceHeartbeat <= PRESENCE_RECENTLY_LEFT_THRESHOLD_MS) {
        recentlyLeft.push(presenceUser);
      }
      // If > RECENTLY_LEFT_THRESHOLD, don't include (too old)
    }

    return { online, recentlyLeft };
  },
});
