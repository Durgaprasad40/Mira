import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
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
const CHAT_CONTENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DM_THREAD_INACTIVITY_MS = 60 * 60 * 1000;
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

function getChatContentExpiry(createdAt: number): number {
  return createdAt + CHAT_CONTENT_RETENTION_MS;
}

function isRoomMessageExpired(
  message: Pick<Doc<'chatRoomMessages'>, 'createdAt' | 'expiresAt'>,
  now: number
): boolean {
  return (message.expiresAt ?? getChatContentExpiry(message.createdAt)) <= now;
}

function isDmMessageExpired(
  message: Pick<Doc<'chatRoomDmMessages'>, 'createdAt'>,
  now: number
): boolean {
  return getChatContentExpiry(message.createdAt) <= now;
}

function isDmThreadInactive(lastMessageAt: number, now: number): boolean {
  return lastMessageAt <= now - DM_THREAD_INACTIVITY_MS;
}

function getRoomMessagePreview(
  message: Pick<Doc<'chatRoomMessages'>, 'type' | 'text' | 'imageUrl' | 'audioUrl'>
): string | undefined {
  if (message.text && message.text.trim().length > 0) {
    return message.text;
  }
  if (message.type === 'audio' || message.audioUrl) {
    return '[Audio]';
  }
  if (message.type === 'video') {
    return '[Video]';
  }
  if (message.type === 'doodle') {
    return '[Doodle]';
  }
  if (message.type === 'image' || message.imageUrl) {
    return '[Image]';
  }
  return undefined;
}

function getDmMessagePreview(
  message: Pick<Doc<'chatRoomDmMessages'>, 'type' | 'text'>
): string {
  if (message.type === 'text') {
    return message.text?.trim().slice(0, 50) ?? '';
  }
  return `[${message.type.charAt(0).toUpperCase() + message.type.slice(1)}]`;
}

function getRetainedRoomSummaryFields(
  room: Pick<Doc<'chatRooms'>, 'lastMessageAt' | 'lastMessageText' | 'messageCount'>,
  now: number
) {
  const hasRetainedLastMessage =
    room.lastMessageAt !== undefined && room.lastMessageAt > now - CHAT_CONTENT_RETENTION_MS;

  return {
    lastMessageAt: hasRetainedLastMessage ? room.lastMessageAt : undefined,
    lastMessageText: hasRetainedLastMessage ? room.lastMessageText : undefined,
    messageCount: hasRetainedLastMessage ? room.messageCount : 0,
  };
}

async function deleteStorageIfPresent(
  ctx: MutationCtx,
  storageId: Id<'_storage'> | undefined
): Promise<number> {
  if (!storageId) {
    return 0;
  }

  try {
    await ctx.storage.delete(storageId);
    return 1;
  } catch (error) {
    console.warn('[chatRooms] Storage delete failed', storageId, error);
    return 0;
  }
}

async function deleteRoomMessageWithCleanup(
  ctx: MutationCtx,
  message: Doc<'chatRoomMessages'>
): Promise<{ deletedStorage: number }> {
  const [reactions, mentions] = await Promise.all([
    ctx.db
      .query('chatRoomReactions')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect(),
    ctx.db
      .query('chatRoomMentions')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect(),
  ]);

  for (const reaction of reactions) {
    await ctx.db.delete(reaction._id);
  }

  for (const mention of mentions) {
    await ctx.db.delete(mention._id);
  }

  const deletedStorage = await deleteStorageIfPresent(ctx, message.mediaStorageId);
  await ctx.db.delete(message._id);

  return { deletedStorage };
}

async function syncRoomMessageSummary(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>
): Promise<void> {
  const room = await ctx.db.get(roomId);
  if (!room) {
    return;
  }

  const now = Date.now();
  const retainedMessages = await ctx.db
    .query('chatRoomMessages')
    .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
    .filter((q) =>
      q.and(
        q.or(
          q.eq(q.field('deletedAt'), undefined),
          q.eq(q.field('deletedAt'), null)
        ),
        q.gt(q.field('createdAt'), now - CHAT_CONTENT_RETENTION_MS)
      )
    )
    .order('desc')
    .collect();

  const latestMessage = retainedMessages[0];
  await ctx.db.patch(roomId, {
    messageCount: retainedMessages.length,
    lastMessageAt: latestMessage?.createdAt,
    lastMessageText: latestMessage ? getRoomMessagePreview(latestMessage) : undefined,
  });
}

async function deleteDmThreadWithCleanup(
  ctx: MutationCtx,
  threadId: Id<'chatRoomDmThreads'>
): Promise<{ deletedThread: boolean; deletedMessages: number; deletedStorage: number }> {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    return { deletedThread: false, deletedMessages: 0, deletedStorage: 0 };
  }

  const messages = await ctx.db
    .query('chatRoomDmMessages')
    .withIndex('by_thread', (q) => q.eq('threadId', threadId))
    .collect();

  let deletedMessages = 0;
  let deletedStorage = 0;

  for (const message of messages) {
    deletedStorage += await deleteStorageIfPresent(ctx, message.mediaStorageId);
    await ctx.db.delete(message._id);
    deletedMessages++;
  }

  await ctx.db.delete(threadId);
  return { deletedThread: true, deletedMessages, deletedStorage };
}

async function syncDmThreadSummary(
  ctx: MutationCtx,
  threadId: Id<'chatRoomDmThreads'>
): Promise<void> {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    return;
  }

  const now = Date.now();
  const latestRetainedMessages = await ctx.db
    .query('chatRoomDmMessages')
    .withIndex('by_thread_created', (q) => q.eq('threadId', threadId))
    .filter((q) => q.gt(q.field('createdAt'), now - CHAT_CONTENT_RETENTION_MS))
    .order('desc')
    .take(1);

  const latestMessage = latestRetainedMessages[0];
  if (!latestMessage) {
    await ctx.db.delete(threadId);
    return;
  }

  await ctx.db.patch(threadId, {
    lastMessageAt: latestMessage.createdAt,
    lastMessagePreview: getDmMessagePreview(latestMessage),
  });
}

async function isDmThreadUnavailable(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<'chatRoomDmThreads'>,
  now: number
): Promise<boolean> {
  if (isDmThreadInactive(thread.lastMessageAt, now)) {
    return true;
  }

  if (!thread.sourceRoomId) {
    return false;
  }

  const room = await ctx.db.get(thread.sourceRoomId);
  return !room || (!!room.expiresAt && room.expiresAt <= now);
}

function getDmThreadPeerId(
  thread: Doc<'chatRoomDmThreads'>,
  userId: Id<'users'>
): Id<'users'> {
  return thread.participant1Id === userId
    ? thread.participant2Id
    : thread.participant1Id;
}

async function hasRetainedIncomingDmMessage(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<'chatRoomDmThreads'>,
  peerId: Id<'users'>,
  retentionCutoff: number
): Promise<boolean> {
  const incomingMessage = await ctx.db
    .query('chatRoomDmMessages')
    .withIndex('by_thread_created', (q) => q.eq('threadId', threadId))
    .filter((q) =>
      q.and(
        q.eq(q.field('senderId'), peerId),
        q.gt(q.field('createdAt'), retentionCutoff)
      )
    )
    .order('desc')
    .first();

  return incomingMessage !== null;
}

async function getDmThreadInboxContext(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<'chatRoomDmThreads'>,
  userId: Id<'users'>,
  now: number
): Promise<{ visible: false } | { visible: true; peerId: Id<'users'> }> {
  const isParticipant =
    thread.participant1Id === userId || thread.participant2Id === userId;
  if (!isParticipant) {
    return { visible: false };
  }

  if (await isDmThreadUnavailable(ctx, thread, now)) {
    return { visible: false };
  }

  const peerId = getDmThreadPeerId(thread, userId);
  if (await isBlockedBidirectional(ctx, userId, peerId)) {
    return { visible: false };
  }

  const hiddenAt =
    thread.participant1Id === userId ? thread.hiddenByP1At : thread.hiddenByP2At;
  if (hiddenAt && hiddenAt >= thread.lastMessageAt) {
    return { visible: false };
  }

  const retentionCutoff = now - CHAT_CONTENT_RETENTION_MS;
  const hasIncoming = await hasRetainedIncomingDmMessage(
    ctx,
    thread._id,
    peerId,
    retentionCutoff
  );

  if (!hasIncoming) {
    return { visible: false };
  }

  return { visible: true, peerId };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Delete room and all related data (messages, members, penalties, DMs)
// Used by closeRoom, resetMyPrivateRooms, deleteExpiredRoom, cleanupExpiredRooms
// ═══════════════════════════════════════════════════════════════════════════
async function deleteRoomFully(ctx: MutationCtx, roomId: Id<'chatRooms'>): Promise<void> {
  const roomIdStr = roomId.toString();

  const messages = await ctx.db
    .query('chatRoomMessages')
    .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
    .collect();
  for (const msg of messages) {
    await deleteRoomMessageWithCleanup(ctx, msg);
  }

  const dmThreads = await ctx.db
    .query('chatRoomDmThreads')
    .withIndex('by_source_room', (q) => q.eq('sourceRoomId', roomId))
    .collect();
  for (const thread of dmThreads) {
    await deleteDmThreadWithCleanup(ctx, thread._id);
  }

  const presenceRows = await ctx.db
    .query('chatRoomPresence')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const presence of presenceRows) {
    await ctx.db.delete(presence._id);
  }

  const members = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const member of members) {
    await ctx.db.delete(member._id);
  }

  const penalties = await ctx.db
    .query('chatRoomPenalties')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const penalty of penalties) {
    await ctx.db.delete(penalty._id);
  }

  const bans = await ctx.db
    .query('chatRoomBans')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const ban of bans) {
    await ctx.db.delete(ban._id);
  }

  const joinRequests = await ctx.db
    .query('chatRoomJoinRequests')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const request of joinRequests) {
    await ctx.db.delete(request._id);
  }

  const passwordAttempts = await ctx.db
    .query('chatRoomPasswordAttempts')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const attempt of passwordAttempts) {
    await ctx.db.delete(attempt._id);
  }

  const mutedUsers = await ctx.db
    .query('chatRoomMutedUsers')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
  for (const mutedUser of mutedUsers) {
    await ctx.db.delete(mutedUser._id);
  }

  const strikes = await ctx.db
    .query('chatRoomUserStrikes')
    .withIndex('by_room', (q) => q.eq('roomId', roomIdStr))
    .collect();
  for (const strike of strikes) {
    await ctx.db.delete(strike._id);
  }

  const roomPrefs = await ctx.db
    .query('userRoomPrefs')
    .withIndex('by_room', (q) => q.eq('roomId', roomIdStr))
    .collect();
  for (const pref of roomPrefs) {
    await ctx.db.delete(pref._id);
  }

  const roomReports = await ctx.db
    .query('userRoomReports')
    .withIndex('by_room', (q) => q.eq('roomId', roomIdStr))
    .collect();
  for (const report of roomReports) {
    await ctx.db.delete(report._id);
  }

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

async function isBlockedBidirectional(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>
): Promise<boolean> {
  const [block1, block2] = await Promise.all([
    ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', userId1).eq('blockedUserId', userId2)
      )
      .first(),
    ctx.db
      .query('blocks')
      .withIndex('by_blocker_blocked', (q) =>
        q.eq('blockerId', userId2).eq('blockedUserId', userId1)
      )
      .first(),
  ]);

  return !!block1 || !!block2;
}

type RoomAccessStatus =
  | 'unauthenticated'
  | 'not_found'
  | 'expired'
  | 'banned'
  | 'suspended'
  | 'member'
  | 'public_joinable'
  | 'password_required'
  | 'private_room';

async function getRoomAccessState(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  authUserId: string | undefined
): Promise<{
  status: RoomAccessStatus;
  userId?: Id<'users'>;
  room?: any;
  membership?: any;
  role?: string;
  remainingMinutes?: number;
}> {
  if (!authUserId || authUserId.trim().length === 0) {
    return { status: 'unauthenticated' };
  }

  const userId = await resolveUserIdByAuthId(ctx, authUserId);
  if (!userId) {
    return { status: 'unauthenticated' };
  }

  const room = await ctx.db.get(roomId);
  if (!room) {
    return { status: 'not_found', userId };
  }

  const now = Date.now();
  if (room.expiresAt && room.expiresAt <= now) {
    return { status: 'expired', userId, room };
  }

  const ban = await ctx.db
    .query('chatRoomBans')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (ban) {
    return { status: 'banned', userId, room };
  }

  const roomIdStr = roomId as string;
  const strike = await ctx.db
    .query('chatRoomUserStrikes')
    .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
    .first();
  if (strike && strike.suspendedUntil && strike.suspendedUntil > now) {
    return {
      status: 'suspended',
      userId,
      room,
      remainingMinutes: Math.ceil((strike.suspendedUntil - now) / 60000),
    };
  }

  const membership = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (membership) {
    return {
      status: 'member',
      userId,
      room,
      membership,
      role: membership.role ?? 'member',
    };
  }

  if (room.isPublic) {
    return { status: 'public_joinable', userId, room };
  }

  if (room.passwordHash) {
    return { status: 'password_required', userId, room };
  }

  return { status: 'private_room', userId, room };
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
  const access = await getRoomAccessState(ctx, roomId, authUserId);
  if (!access.userId) {
    throw new Error('Unauthorized: authentication required');
  }
  if (!access.room || access.status === 'not_found') {
    throw new Error('Room not found');
  }
  if (access.status === 'expired') {
    throw new Error('Room has expired');
  }
  if (access.status === 'banned') {
    throw new Error('Access denied: you are banned from this room');
  }
  if (access.status === 'suspended') {
    const remainingMinutes = access.remainingMinutes ?? 1;
    throw new Error(`SUSPENDED:${remainingMinutes}:You are suspended from this room for ${remainingMinutes} more minute${remainingMinutes !== 1 ? 's' : ''}.`);
  }
  if (access.status !== 'member' || !access.membership) {
    throw new Error('Access denied: you must join this room first');
  }

  return { userId: access.userId, room: access.room, membership: access.membership };
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

  // 3. REPORT ENFORCEMENT: Check user is not suspended from reports
  // Uses roomId string for strike lookup (since strikes use string roomId)
  const roomIdStr = roomId as string;
  const strike = await ctx.db
    .query('chatRoomUserStrikes')
    .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
    .first();

  if (strike && strike.suspendedUntil && strike.suspendedUntil > now) {
    const remainingMinutes = Math.ceil((strike.suspendedUntil - now) / 60000);
    throw new Error(`You are suspended from this room for ${remainingMinutes} more minute${remainingMinutes !== 1 ? 's' : ''}`);
  }

  return { userId, room, membership };
}

// Query to get effective userId (for client-side owner detection)
export const getEffectiveUserId = query({
  args: {
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      if (args.authUserId) {
        const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
        return { userId: userId ?? null };
      }
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

        // Keep memberCount for backwards compatibility (access control uses this)
        const members = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();
        const memberIds = new Set(members.map((member) => member.userId.toString()));
        const activeUserCount = Array.from(activeUserIds).filter((userId) => memberIds.has(userId)).length;
        const retainedSummary = getRetainedRoomSummaryFields(room, now);

        return {
          ...room,
          activeUserCount,           // LIVE: Real-time presence count
          memberCount: members.length, // Legacy: Total membership (for access control)
          lastMessageAt: retainedSummary.lastMessageAt,
          lastMessageText: retainedSummary.lastMessageText,
          messageCount: retainedSummary.messageCount,
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
      const retainedSummary = getRetainedRoomSummaryFields(room, Date.now());
      return {
        _id: room._id,
        name: room.name,
        slug: room.slug,
        category: room.category,
        isPublic: room.isPublic,
        memberCount: room.memberCount,
        lastMessageAt: retainedSummary.lastMessageAt,
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
    const retainedSummary = getRetainedRoomSummaryFields(room, Date.now());
    return {
      ...room,
      lastMessageAt: retainedSummary.lastMessageAt,
      lastMessageText: retainedSummary.lastMessageText,
      messageCount: retainedSummary.messageCount,
    };
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
    const retentionCutoff = Date.now() - CHAT_CONTENT_RETENTION_MS;

    let query = ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId));

    // Filter for messages before the cursor (older messages)
    if (before) {
      query = query.filter((q) => q.lt(q.field('createdAt'), before));
    }

    // Filter out soft-deleted messages
    query = query.filter((q) =>
      q.and(
        q.or(
          q.eq(q.field('deletedAt'), undefined),
          q.eq(q.field('deletedAt'), null)
        ),
        q.gt(q.field('createdAt'), retentionCutoff)
      )
    );

    const messages = await query.order('desc').take(limit + 1);
    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(0, limit) : messages;

    // CHAT ROOM IDENTITY: Batch fetch sender profiles for all messages.
    // Deliberately do not fall back to main-profile photo/gender here.
    const senderIds = [...new Set(result.map((m) => m.senderId))];
    const senderProfiles = await Promise.all(
      senderIds.map(async (senderId) => {
        const [profile] = await Promise.all([
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', senderId))
            .first(),
        ]);
        return { senderId, profile };
      })
    );

    const profileMap = new Map(
      senderProfiles.map(({ senderId, profile }) => {
        const chatRoomAvatarUrl = profile?.avatarUrl;
        const isLocalFileAvatar = chatRoomAvatarUrl?.startsWith('file://') || chatRoomAvatarUrl?.startsWith('content://');
        const avatarUrl = chatRoomAvatarUrl && !isLocalFileAvatar ? chatRoomAvatarUrl : null;

        return [
          senderId.toString(),
          {
            nickname: profile?.nickname ?? 'Anonymous',
            avatarUrl,
            // CACHE-BUST-FIX: Include profile updatedAt for image cache invalidation
            avatarVersion: profile?.updatedAt ?? 0,
            gender: undefined as 'male' | 'female' | 'other' | undefined,
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

// List all current room members with chat-room profile data.
// Presence/online state is intentionally not derived here; use the room presence
// queries for active/recently-left state so membership truth stays separate.
export const listMembersWithProfiles = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, authUserId);

    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect();

    const membersWithProfiles = await Promise.all(
      members.map(async (member) => {
        const [chatRoomProfile, user] = await Promise.all([
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', member.userId))
            .first(),
          ctx.db.get(member.userId),
        ]);

        const chatRoomAvatarUrl = chatRoomProfile?.avatarUrl;
        const isLocalFileAvatar = chatRoomAvatarUrl?.startsWith('file://') || chatRoomAvatarUrl?.startsWith('content://');
        const resolvedAvatarUrl = chatRoomAvatarUrl && !isLocalFileAvatar ? chatRoomAvatarUrl : undefined;

        return {
          id: member.userId,
          // CHAT ROOM IDENTITY: Use nickname from chatRoomProfiles (NOT main profile)
          displayName: chatRoomProfile?.nickname ?? 'Anonymous',
          avatar: resolvedAvatarUrl,
          // CACHE-BUST-FIX: Include version for image cache invalidation
          avatarVersion: chatRoomProfile?.updatedAt ?? 0,
          age: undefined,
          gender: undefined,
          bio: chatRoomProfile?.bio ?? undefined,
          joinedAt: member.joinedAt,
          role: member.role ?? 'member',
          // TRUST SIGNAL: Verification status for member trust badges
          isVerified: user?.isVerified ?? false,
        };
      })
    );

    membersWithProfiles.sort((a, b) => {
      const nameCompare = a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: 'base',
      });
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.id.toString().localeCompare(b.id.toString());
    });

    return membersWithProfiles;
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
    const access = await getRoomAccessState(ctx, roomId, authUserId);
    const userId = access.userId;
    const room = access.room;
    if (!userId) {
      throw new Error('Unauthorized: authentication required');
    }
    if (!room || access.status === 'not_found') {
      throw new Error('Room not found');
    }
    if (access.status === 'expired') {
      throw new Error('This room has expired.');
    }
    if (access.status === 'banned') {
      throw new Error('Access denied: you are banned from this room');
    }
    if (access.status === 'suspended') {
      const remainingMinutes = access.remainingMinutes ?? 1;
      throw new Error(`SUSPENDED:${remainingMinutes}:You are suspended from this room for ${remainingMinutes} more minute${remainingMinutes !== 1 ? 's' : ''}.`);
    }
    if (access.status === 'member' && access.membership) {
      return access.membership._id;
    }
    if (!room.isPublic) {
      if (room.passwordHash) {
        throw new Error('This private room requires a password.');
      }
      throw new Error('Private rooms must be joined with an invite code.');
    }

    const now = Date.now();

    // MEMBER-STRIP FIX: Always update lastActive so user appears online in room
    await ctx.db.patch(userId, { lastActive: now });

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

// Password attempt limit constants
const STAGE_1_MAX_ATTEMPTS = 3;  // Initial 3 attempts
const STAGE_2_COOLDOWN_MS = 3 * 60 * 1000;  // 3 minutes
const STAGE_3_COOLDOWN_MS = 2 * 60 * 1000;  // 2 minutes

// Join a password-protected room (validates password before creating membership)
// LOCKED-ROOM-FIX: This mutation enforces password validation + 5-attempt limit
// Attempt model:
//   Stage 1: 3 immediate attempts
//   Stage 2: 3-min cooldown, then 1 attempt
//   Stage 3: 2-min cooldown, then 1 final attempt
//   Stage 4: permanently blocked
export const joinRoomWithPassword = mutation({
  args: {
    roomId: v.id('chatRooms'),
    password: v.optional(v.string()), // Required if room has password
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, password, authUserId }) => {
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

    const now = Date.now();

    // 3. Check if room is expired
    if (room.expiresAt && room.expiresAt <= now) {
      throw new Error('This room has expired.');
    }

    // 4. Check if banned
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      throw new Error('You are banned from this room.');
    }

    // 4b. REPORT ENFORCEMENT: Check if user is suspended from this room
    const roomIdStr = roomId as string;
    const strike = await ctx.db
      .query('chatRoomUserStrikes')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
      .first();

    if (strike && strike.suspendedUntil && strike.suspendedUntil > now) {
      const remainingMinutes = Math.ceil((strike.suspendedUntil - now) / 60000);
      throw new Error(`SUSPENDED:${remainingMinutes}:You are suspended from this room for ${remainingMinutes} more minute${remainingMinutes !== 1 ? 's' : ''}.`);
    }

    // 5. Check if already a member (idempotent)
    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (existing) {
      return { success: true, alreadyMember: true };
    }

    if (room.isPublic) {
      throw new Error('Public rooms must be joined directly.');
    }

    // Password entry is only valid after a successful invite-code lookup.
    let attemptRecord = await ctx.db
      .query('chatRoomPasswordAttempts')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (!room.passwordHash) {
      throw new Error('This room does not use a password.');
    }

    if (!attemptRecord?.authorized) {
      throw new Error('Use an invite code before entering this room password.');
    }

    // Check if permanently blocked (stage 4)
    if (attemptRecord!.blocked || attemptRecord!.stage === 4) {
      return {
        success: false,
        blocked: true,
        message: 'You have reached the maximum number of attempts for this room.',
      };
    }

    // Check if in cooldown
    if (attemptRecord!.cooldownUntil && attemptRecord!.cooldownUntil > now) {
      const remainingMs = attemptRecord!.cooldownUntil - now;
      return {
        success: false,
        cooldown: true,
        cooldownRemainingMs: remainingMs,
        message: 'Too many incorrect attempts. Please wait before trying again.',
      };
    }

    // Check if password was provided
    if (!password || password.trim().length === 0) {
      return {
        success: false,
        message: 'Password required',
        stage: attemptRecord!.stage,
        attemptsRemaining: getAttemptsRemaining(attemptRecord!.stage, attemptRecord!.attemptsInStage),
      };
    }

    // Validate password
    const passwordValid = await verifyPassword(password, room.passwordHash);

    if (passwordValid) {
      // SUCCESS: Password correct - mark as authorized and create membership
      await ctx.db.patch(attemptRecord!._id, {
        stage: 0,
        attemptsInStage: 0,
        blocked: false,
        authorized: true,
        cooldownUntil: undefined,
        lastAttemptAt: now,
      });

      await ctx.db.insert('chatRoomMembers', {
        roomId,
        userId,
        joinedAt: now,
        role: 'member',
      });
      await ctx.db.patch(userId, { lastActive: now });
      const actualMemberCount = await recomputeMemberCount(ctx, roomId);
      await ctx.db.patch(roomId, { memberCount: actualMemberCount });

      return { success: true, alreadyMember: false };
    }

    // WRONG PASSWORD: Update attempt state
    const currentStage = attemptRecord!.stage;
    const currentAttempts = attemptRecord!.attemptsInStage + 1;

    let newStage = currentStage;
    let newAttempts = currentAttempts;
    let newCooldownUntil: number | undefined;
    let blocked = false;

    if (currentStage === 1) {
      // Stage 1: 3 immediate attempts
      if (currentAttempts >= STAGE_1_MAX_ATTEMPTS) {
        // Move to stage 2 with cooldown
        newStage = 2;
        newAttempts = 0;
        newCooldownUntil = now + STAGE_2_COOLDOWN_MS;
      }
    } else if (currentStage === 2) {
      // Stage 2: 1 attempt after 3-min cooldown
      // Move to stage 3 with cooldown
      newStage = 3;
      newAttempts = 0;
      newCooldownUntil = now + STAGE_3_COOLDOWN_MS;
    } else if (currentStage === 3) {
      // Stage 3: 1 final attempt after 2-min cooldown
      // Move to stage 4 (permanently blocked)
      newStage = 4;
      newAttempts = 0;
      blocked = true;
    }

    // Update attempt record
    await ctx.db.patch(attemptRecord!._id, {
      stage: newStage,
      attemptsInStage: newAttempts,
      cooldownUntil: newCooldownUntil,
      blocked,
      lastAttemptAt: now,
    });

    // Return appropriate response
    if (blocked) {
      return {
        success: false,
        blocked: true,
        message: 'You have reached the maximum number of attempts for this room.',
      };
    }

    if (newCooldownUntil) {
      return {
        success: false,
        cooldown: true,
        cooldownRemainingMs: newCooldownUntil - now,
        message: 'Too many incorrect attempts. Please wait before trying again.',
      };
    }

    return {
      success: false,
      message: 'Incorrect password',
      stage: newStage,
      attemptsRemaining: getAttemptsRemaining(newStage, newAttempts),
    };
  },
});

// Helper to calculate remaining attempts for a stage
function getAttemptsRemaining(stage: number, attemptsUsed: number): number {
  if (stage === 1) {
    return Math.max(0, STAGE_1_MAX_ATTEMPTS - attemptsUsed);
  }
  // Stages 2 and 3 have exactly 1 attempt each
  return attemptsUsed === 0 ? 1 : 0;
}

// Query to get password attempt state (for UI rendering)
export const getPasswordAttemptState = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return { stage: 1, attemptsRemaining: 3, blocked: false };
    }

    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { stage: 1, attemptsRemaining: 3, blocked: false };
    }

    const attemptRecord = await ctx.db
      .query('chatRoomPasswordAttempts')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();

    if (!attemptRecord) {
      return { stage: 1, attemptsRemaining: 3, blocked: false };
    }

    const now = Date.now();

    // Check if blocked
    if (attemptRecord.blocked || attemptRecord.stage === 4) {
      return {
        stage: 4,
        attemptsRemaining: 0,
        blocked: true,
      };
    }

    // Check if in cooldown
    if (attemptRecord.cooldownUntil && attemptRecord.cooldownUntil > now) {
      return {
        stage: attemptRecord.stage,
        attemptsRemaining: 0,
        blocked: false,
        cooldown: true,
        cooldownRemainingMs: attemptRecord.cooldownUntil - now,
      };
    }

    return {
      stage: attemptRecord.stage,
      attemptsRemaining: getAttemptsRemaining(attemptRecord.stage, attemptRecord.attemptsInStage),
      blocked: false,
    };
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

    // Clear any lingering presence rows for this user in this room.
    const presenceRows = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .collect();
    for (const presence of presenceRows) {
      await ctx.db.delete(presence._id);
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
      mediaStorageId: imageStorageId ?? audioStorageId ?? undefined,
      createdAt: now,
      clientId,
      status: 'sent',
      expiresAt: getChatContentExpiry(now),
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
      lastMessageText: getRoomMessagePreview({
        type,
        text: maskedText,
        imageUrl: resolvedImageUrl ?? undefined,
        audioUrl: resolvedAudioUrl ?? undefined,
      }),
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
          await deleteRoomMessageWithCleanup(ctx, msg);
          deleted++;
        } catch {
          // Silently ignore if already deleted by concurrent request
        }
      }

      await syncRoomMessageSummary(ctx, roomId);
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

    if (messageIds.length === 0) {
      return {};
    }

    const uniqueMessageIds = Array.from(
      new Map(messageIds.map((messageId) => [messageId.toString(), messageId])).values()
    );
    const requestedMessageIds = new Set(uniqueMessageIds.map((messageId) => messageId.toString()));

    // Use exact message lookups for the normal room window to avoid scanning the
    // room's entire reaction set. Fall back to the room-wide scan only after the
    // client has intentionally loaded a much larger history slice.
    const reactionRows =
      uniqueMessageIds.length <= 60
        ? (
            await Promise.all(
              uniqueMessageIds.map((messageId) =>
                ctx.db
                  .query('chatRoomReactions')
                  .withIndex('by_message', (q) => q.eq('messageId', messageId))
                  .collect()
              )
            )
          )
            .flat()
            .filter((reaction) => reaction.roomId === roomId)
        : await ctx.db
            .query('chatRoomReactions')
            .withIndex('by_room', (q) => q.eq('roomId', roomId))
            .collect();

    const reactions: Record<string, { emoji: string; count: number; userIds: string[] }[]> = {};
    for (const messageId of requestedMessageIds) {
      reactions[messageId] = [];
    }

    const emojiGroupsByMessage = new Map<string, Map<string, string[]>>();
    for (const reaction of reactionRows) {
      const messageId = reaction.messageId.toString();
      if (!requestedMessageIds.has(messageId)) {
        continue;
      }

      let emojiGroups = emojiGroupsByMessage.get(messageId);
      if (!emojiGroups) {
        emojiGroups = new Map<string, string[]>();
        emojiGroupsByMessage.set(messageId, emojiGroups);
      }

      const userIds = emojiGroups.get(reaction.emoji) ?? [];
      userIds.push(reaction.userId.toString());
      emojiGroups.set(reaction.emoji, userIds);
    }

    for (const [messageId, emojiGroups] of emojiGroupsByMessage.entries()) {
      reactions[messageId] = Array.from(emojiGroups.entries()).map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
      }));
    }

    return reactions;
  },
});

// Room creation rate limit: 3 rooms per 24 hours
const MAX_ROOMS_PER_24H = 3;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

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

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      throw new Error('Room name must be at least 2 characters');
    }
    if (trimmedName.length > 50) {
      throw new Error('Room name must be 50 characters or less');
    }

    const trimmedPassword = password?.trim();
    if (!trimmedPassword) {
      throw new Error('Password is required for private rooms.');
    }
    if (trimmedPassword.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    if (trimmedPassword.length > 32) {
      throw new Error('Password must be 32 characters or less');
    }

    // Check if demo user (for coin bypass and rate limit bypass)
    const isDemoUser = isDemo === true && !!demoUserId;

    // 2. RATE LIMIT: Check rooms created in last 24 hours (skip for demo users)
    if (!isDemoUser) {
      const now = Date.now();
      const windowStart = now - RATE_LIMIT_WINDOW_MS;

      // Query rooms created by this user in the last 24 hours
      const recentRooms = await ctx.db
        .query('chatRooms')
        .withIndex('by_creator', (q) => q.eq('createdBy', createdBy))
        .filter((q) => q.gte(q.field('createdAt'), windowStart))
        .collect();

      if (recentRooms.length >= MAX_ROOMS_PER_24H) {
        throw new Error("You've reached your room creation limit (3 rooms per 24 hours). Try again later.");
      }
    }

    // 3. Check wallet balance (skip for demo users)
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
    passwordHash = await hashPassword(trimmedPassword);
    passwordEncrypted = await encryptPassword(trimmedPassword);

    // 6. Generate slug from name
    const slug = trimmedName
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
      name: trimmedName,
      slug: finalSlug,
      category: 'general',
      isPublic: false,
      createdAt: now,
      memberCount: 1,
      createdBy,
      expiresAt: now + ROOM_LIFETIME_MS,
      joinCode,
      passwordHash,
      passwordEncrypted,
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

    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
      .first();
    if (ban) {
      throw new Error('You are banned from this room.');
    }

    // 4b. REPORT ENFORCEMENT: Check if user is suspended from this room
    const roomIdStr = room._id as string;
    const strike = await ctx.db
      .query('chatRoomUserStrikes')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
      .first();

    if (strike && strike.suspendedUntil && strike.suspendedUntil > now) {
      const remainingMinutes = Math.ceil((strike.suspendedUntil - now) / 60000);
      throw new Error(`SUSPENDED:${remainingMinutes}:You are suspended from this room for ${remainingMinutes} more minute${remainingMinutes !== 1 ? 's' : ''}.`);
    }

    // 5. Check if already a member
    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
      .first();
    if (existing) {
      return { roomId: room._id, roomName: room.name, alreadyMember: true, requiresPassword: false };
    }

    if (room.passwordHash) {
      const existingAttempt = await ctx.db
        .query('chatRoomPasswordAttempts')
        .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
        .first();

      if (existingAttempt) {
        await ctx.db.patch(existingAttempt._id, {
          authorized: true,
          lastAttemptAt: now,
        });
      } else {
        await ctx.db.insert('chatRoomPasswordAttempts', {
          roomId: room._id,
          userId,
          stage: 1,
          attemptsInStage: 0,
          blocked: false,
          lastAttemptAt: now,
          createdAt: now,
          authorized: true,
        });
      }

      return {
        roomId: room._id,
        roomName: room.name,
        alreadyMember: false,
        requiresPassword: true,
      };
    }

    // 6. Join as member
    await ctx.db.insert('chatRoomMembers', {
      roomId: room._id,
      userId,
      joinedAt: now,
      role: 'member',
    });
    await ctx.db.patch(userId, { lastActive: now });

    // M-003 FIX: Recompute memberCount from source of truth (consistent with joinRoom)
    const actualMemberCount = await recomputeMemberCount(ctx, room._id);
    await ctx.db.patch(room._id, { memberCount: actualMemberCount });

    return { roomId: room._id, roomName: room.name, alreadyMember: false, requiresPassword: false };
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

// Phase-2: Get private rooms the current user already belongs to.
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
        return [];
      }
    }

    if (!userId) {
      return [];
    }

    const now = Date.now();

    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const membershipByRoom = new Map(
      memberships.map((membership) => [membership.roomId.toString(), membership])
    );

    const accessibleRoomIds = [...new Set(memberships.map((membership) => membership.roomId))];
    if (accessibleRoomIds.length === 0) {
      return [];
    }

    const allPrivateRooms = await Promise.all(
      accessibleRoomIds.map((roomId) => ctx.db.get(roomId))
    );

    // Process all private rooms
    const rooms = await Promise.all(
      allPrivateRooms.map(async (room) => {
        if (!room || room.isPublic) return null;

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

        // Get member count
        const roomMembers = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room', (q) => q.eq('roomId', room._id))
          .collect();
        const memberIds = new Set(roomMembers.map((member) => member.userId.toString()));
        const activeUserCount = Array.from(activeUserIds).filter((activeUserId) => memberIds.has(activeUserId)).length;

        // Determine membership status for current user
        const roomIdStr = room._id.toString();
        const membership = membershipByRoom.get(roomIdStr);
        if (!membership) return null;
        const retainedSummary = getRetainedRoomSummaryFields(room, now);

        return {
          _id: room._id,
          name: room.name,
          slug: room.slug,
          category: room.category,
          isPublic: room.isPublic,
          activeUserCount,
          memberCount: roomMembers.length,
          lastMessageAt: retainedSummary.lastMessageAt,
          lastMessageText: retainedSummary.lastMessageText,
          createdAt: room.createdAt,
          expiresAt: room.expiresAt,
          createdBy: room.createdBy,
          hasPassword: !!room.passwordHash, // Indicate if password required
          role: membership.role ?? 'member',
          isMember: true,
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
        const retainedSummary = getRetainedRoomSummaryFields(room, now);
        return {
          ...room,
          lastMessageAt: retainedSummary.lastMessageAt,
          lastMessageText: retainedSummary.lastMessageText,
          messageCount: retainedSummary.messageCount,
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

// Internal: Cleanup chat content older than 24 hours.
// Deletes room messages, DM messages, and uploaded media blobs.
export const cleanupExpiredChatContent = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffTime = now - CHAT_CONTENT_RETENTION_MS;

    const expiredRoomMessages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_created', (q) => q.lte('createdAt', cutoffTime))
      .take(BATCH_DELETE_SIZE);

    const affectedRoomIds = new Set<Id<'chatRooms'>>();
    let deletedRoomMessages = 0;
    let deletedRoomStorage = 0;

    for (const message of expiredRoomMessages) {
      if (!isRoomMessageExpired(message, now)) {
        continue;
      }
      affectedRoomIds.add(message.roomId);
      const result = await deleteRoomMessageWithCleanup(ctx, message);
      deletedRoomMessages++;
      deletedRoomStorage += result.deletedStorage;
    }

    for (const roomId of affectedRoomIds) {
      await syncRoomMessageSummary(ctx, roomId);
    }

    const expiredDmMessages = await ctx.db
      .query('chatRoomDmMessages')
      .withIndex('by_created', (q) => q.lte('createdAt', cutoffTime))
      .take(BATCH_DELETE_SIZE);

    const affectedThreadIds = new Set<Id<'chatRoomDmThreads'>>();
    let deletedDmMessages = 0;
    let deletedDmStorage = 0;

    for (const message of expiredDmMessages) {
      if (!isDmMessageExpired(message, now)) {
        continue;
      }
      affectedThreadIds.add(message.threadId);
      deletedDmStorage += await deleteStorageIfPresent(ctx, message.mediaStorageId);
      await ctx.db.delete(message._id);
      deletedDmMessages++;
    }

    for (const threadId of affectedThreadIds) {
      await syncDmThreadSummary(ctx, threadId);
    }

    return {
      deletedRoomMessages,
      deletedRoomStorage,
      deletedDmMessages,
      deletedDmStorage,
    };
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
    const access = await getRoomAccessState(ctx, roomId, authUserId);
    if (access.status === 'member') {
      return { status: 'member' as const, role: access.role ?? 'member' };
    }
    if (access.status === 'public_joinable') {
      return { status: 'public_joinable' as const };
    }
    if (access.status === 'password_required') {
      return { status: 'password_required' as const };
    }
    if (access.status === 'private_room') {
      return { status: 'private_room' as const };
    }
    if (access.status === 'suspended') {
      return { status: 'suspended' as const, remainingMinutes: access.remainingMinutes ?? 1 };
    }
    if (access.status === 'unauthenticated') {
      return { status: 'unauthenticated' as const };
    }
    if (access.status === 'not_found') {
      return { status: 'not_found' as const };
    }
    if (access.status === 'expired') {
      return { status: 'expired' as const };
    }
    if (access.status === 'banned') {
      return { status: 'banned' as const };
    }
    return { status: 'not_found' as const };
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
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);
    const roomIdStr = roomId.toString();

    // Look up preference
    const pref = await ctx.db
      .query('userRoomPrefs')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
      .first();

    return { muted: pref?.muted ?? false };
  },
});

// Set user's room muted status
export const setUserRoomMuted = mutation({
  args: {
    roomId: v.id('chatRooms'),
    muted: v.boolean(),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, muted, authUserId }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);
    const now = Date.now();
    const roomIdStr = roomId.toString();

    // Check if preference exists
    const existing = await ctx.db
      .query('userRoomPrefs')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
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
        roomId: roomIdStr,
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
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);

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
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);

    // Cannot mute yourself
    if (userId === targetUserId) {
      throw new Error('Cannot mute yourself');
    }

    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!targetMembership) {
      throw new Error('User is not available in this room');
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
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);

    // Cannot mute yourself
    if (userId === targetUserId) {
      throw new Error('Cannot mute yourself');
    }

    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!targetMembership) {
      throw new Error('User is not available in this room');
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
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);
    const roomIdStr = roomId.toString();

    // Look up report
    const report = await ctx.db
      .query('userRoomReports')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
      .first();

    return { reported: !!report };
  },
});

// Mark a room as reported (idempotent)
export const markReportedRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
  },
  handler: async (ctx, { roomId, authUserId }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, authUserId);
    const roomIdStr = roomId.toString();

    // Check if already reported
    const existing = await ctx.db
      .query('userRoomReports')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomIdStr))
      .first();

    if (existing) {
      // Already reported - idempotent
      return { success: true, alreadyReported: true };
    }

    // Create new report record
    await ctx.db.insert('userRoomReports', {
      userId,
      roomId: roomIdStr,
      createdAt: Date.now(),
    });

    return { success: true, alreadyReported: false };
  },
});

// Submit a detailed report for a user in a chat room
// SECURITY: Reporter identity is derived from authenticated session, not client input
// ESCALATION POLICY:
// - 1st unique report: recorded only (no automatic punishment)
// - 2nd+ unique reports: escalating suspensions
// - 3rd enforced stage+: moderation flag is raised
export const submitChatRoomReport = mutation({
  args: {
    authUserId: v.string(),
    reportedUserId: v.string(),
    roomId: v.optional(v.string()),
    reason: v.union(
      // Final 7 report categories (exact product spec)
      v.literal('spam'),                    // Spam
      v.literal('harassment_hate'),         // Harassment / Hate Speech
      v.literal('sexual_nudity'),           // Sexual Content / Nudity
      v.literal('threats'),                 // Threats
      v.literal('impersonation'),           // Impersonation
      v.literal('fake_profile'),            // Fake Profile
      v.literal('selling_promotion')        // Selling / Promotion
    ),
    details: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, reportedUserId, roomId, reason, details }) => {
    const now = Date.now();

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

    if (!roomId) {
      throw new Error('Room context is required for chat room reports');
    }

    const roomIdTyped = roomId as Id<'chatRooms'>;
    await requireRoomReadAccess(ctx, roomIdTyped, authUserId);

    const [reportedMembership, reportedPresence, reportedMessages] = await Promise.all([
      ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomIdTyped).eq('userId', reportedId))
        .first(),
      ctx.db
        .query('chatRoomPresence')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomIdTyped).eq('userId', reportedId))
        .first(),
      ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created', (q) => q.eq('roomId', roomIdTyped))
        .filter((q) => q.eq(q.field('senderId'), reportedId))
        .take(1),
    ]);

    const hasRoomContext =
      !!reportedMembership || !!reportedPresence || reportedMessages.length > 0;
    if (!hasRoomContext) {
      throw new Error('You can only report people who were actually in this room');
    }

    // 4. Create the report record in the reports table
    const reportId = await ctx.db.insert('reports', {
      reporterId,
      reportedUserId: reportedId,
      reason,
      description: details ?? undefined,
      status: 'pending',
      createdAt: now,
      roomId,
    });

    // 5. Also mark the room as reported (for quick lookups)
    const existingRoomReport = await ctx.db
      .query('userRoomReports')
      .withIndex('by_user_room', (q) => q.eq('userId', reporterId).eq('roomId', roomId))
      .first();

    if (!existingRoomReport) {
      await ctx.db.insert('userRoomReports', {
        userId: reporterId,
        roomId,
        createdAt: now,
      });
    }

    // 6. ESCALATION: Record first, enforce only after multiple unique reporters
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    const getEscalationMinutes = (stage: number): number => {
      switch (stage) {
        case 1: return 5;
        case 2: return 30;
        case 3: return 180;
        case 4: return 360;
        default: return 720;
      }
    };

    const existingStrike = await ctx.db
      .query('chatRoomUserStrikes')
      .withIndex('by_user_room', (q) => q.eq('userId', reportedId).eq('roomId', roomId))
      .first();

    if (existingStrike) {
      const alreadyReported = existingStrike.uniqueReporters.some((r) => r === reporterId);
      if (!alreadyReported) {
        const lastReport = existingStrike.lastReportAt ?? existingStrike.updatedAt;
        const shouldResetEscalation = now - lastReport >= FOURTEEN_DAYS_MS;
        const currentStage = shouldResetEscalation ? 0 : (existingStrike.escalationStage ?? 0);
        const newUniqueReporters = [...existingStrike.uniqueReporters, reporterId];
        const shouldEnforce = newUniqueReporters.length >= 2;
        const newEscalationStage = shouldEnforce ? currentStage + 1 : currentStage;
        const suspensionMinutes = shouldEnforce ? getEscalationMinutes(newEscalationStage) : 0;
        const suspendedUntil = shouldEnforce ? now + (suspensionMinutes * 60 * 1000) : undefined;
        const shouldFlagForModeration = shouldEnforce && newEscalationStage >= 3;

        await ctx.db.patch(existingStrike._id, {
          totalReportCount: existingStrike.totalReportCount + 1,
          uniqueReporters: newUniqueReporters,
          escalationStage: newEscalationStage,
          lastReportAt: now,
          suspensionCount: shouldEnforce
            ? existingStrike.suspensionCount + 1
            : existingStrike.suspensionCount,
          suspendedUntil,
          lastSuspendedAt: shouldEnforce ? now : existingStrike.lastSuspendedAt,
          moderationFlag: shouldFlagForModeration || existingStrike.moderationFlag,
          moderationFlaggedAt: shouldFlagForModeration && !existingStrike.moderationFlag
            ? now
            : existingStrike.moderationFlaggedAt,
          updatedAt: now,
        });

        if (shouldEnforce) {
          const membership = await ctx.db
            .query('chatRoomMembers')
            .withIndex('by_room_user', (q) => q.eq('roomId', roomIdTyped).eq('userId', reportedId))
            .first();
          if (membership) {
            await ctx.db.delete(membership._id);
            const actualMemberCount = await recomputeMemberCount(ctx, roomIdTyped);
            await ctx.db.patch(roomIdTyped, { memberCount: actualMemberCount });
          }
        }
      }
    } else {
      await ctx.db.insert('chatRoomUserStrikes', {
        userId: reportedId,
        roomId,
        totalReportCount: 1,
        uniqueReporters: [reporterId],
        escalationStage: 0,
        lastReportAt: now,
        suspensionCount: 0,
        moderationFlag: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, reportId };
  },
});

// Check if a user is currently suspended from a chat room
// Returns suspension status, remaining time, and escalation info
export const getUserSuspensionStatus = query({
  args: {
    authUserId: v.string(),
    roomId: v.string(),
  },
  handler: async (ctx, { authUserId, roomId }) => {
    // Default response: not suspended
    const notSuspended = {
      isSuspended: false,
      suspendedUntil: null as number | null,
      remainingMs: 0,
      totalReports: 0,
      escalationStage: 0,
      moderationFlag: false,
    };

    if (!authUserId || authUserId.trim().length === 0) {
      return notSuspended;
    }

    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return notSuspended;
    }

    // Look up strike record
    const strike = await ctx.db
      .query('chatRoomUserStrikes')
      .withIndex('by_user_room', (q) => q.eq('userId', userId).eq('roomId', roomId))
      .first();

    if (!strike) {
      return notSuspended;
    }

    const now = Date.now();
    const isSuspended = strike.suspendedUntil !== undefined && strike.suspendedUntil > now;
    const remainingMs = isSuspended ? Math.max(0, (strike.suspendedUntil ?? 0) - now) : 0;

    return {
      isSuspended,
      suspendedUntil: strike.suspendedUntil ?? null,
      remainingMs,
      totalReports: strike.totalReportCount,
      escalationStage: strike.escalationStage ?? strike.totalReportCount,
      moderationFlag: strike.moderationFlag,
    };
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
// PRESENCE RULES:
//   - User becomes ONLINE only when entering a room (not app open, not tab switch)
//   - Online threshold: 2 minutes of inactivity → offline
//   - Heartbeat every 15s keeps user online while active in Phase-2
//   - Tab switching within Phase-2 does NOT mark offline (heartbeat continues)
const PRESENCE_HEARTBEAT_INTERVAL_MS = 15 * 1000;     // 15 seconds between heartbeats
const PRESENCE_ONLINE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 minutes = still online (user requested)
const PRESENCE_RECENTLY_LEFT_MS = 10 * 60 * 1000;     // 10 minutes = recently left window (for "last seen")

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
    let userId: Id<'users'>;
    try {
      ({ userId } = await requireRoomReadAccess(ctx, roomId, authUserId));
    } catch {
      return { success: false };
    }

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

      // ─────────────────────────────────────────────────────────────────────────
      // SYSTEM JOIN EVENT: Insert "X joined the room" message for group rooms
      // Only for first presence (not reconnects), deduplicated by checking recent join messages
      // ─────────────────────────────────────────────────────────────────────────

      // Deduplication: Check if there's a recent join message for this user (within 10 minutes)
      const TEN_MINUTES_AGO = now - (10 * 60 * 1000);
      const recentMessages = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created', (q) => q.eq('roomId', roomId).gte('createdAt', TEN_MINUTES_AGO))
        .filter((q) =>
          q.and(
            q.eq(q.field('type'), 'system'),
            q.eq(q.field('systemEventType'), 'join'),
            q.eq(q.field('senderId'), userId)
          )
        )
        .first();

      // Only insert if no recent join message exists
      if (!recentMessages) {
        // Get user's chat room nickname
        const chatRoomProfile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
          .first();
        const nickname = chatRoomProfile?.nickname ?? 'Anonymous';

        // Insert system join message
        await ctx.db.insert('chatRoomMessages', {
          roomId,
          senderId: userId,
          type: 'system',
          systemEventType: 'join',
          systemUserName: nickname,
          text: `${nickname} joined the room`,
          createdAt: now,
        });
      }
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
 * Get room presence grouped into ONLINE and RECENTLY_LEFT sections.
 * Profile enrichment is intentionally done on the client using
 * `listMembersWithProfiles`, so this query only returns presence truth.
 */
export const getRoomPresence = query({
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

    const [presenceRecords, roomMembers] = await Promise.all([
      ctx.db
        .query('chatRoomPresence')
        .withIndex('by_room', (q) => q.eq('roomId', roomId))
        .collect(),
      ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room', (q) => q.eq('roomId', roomId))
        .collect(),
    ]);
    const memberByUserId = new Map(roomMembers.map((member) => [member.userId.toString(), member]));

    // Separate into online vs recently-left
    const onlinePresence: typeof presenceRecords = [];
    const recentlyLeftPresence: typeof presenceRecords = [];

    for (const p of presenceRecords) {
      if (!memberByUserId.has(p.userId.toString())) continue;
      if (p.lastHeartbeatAt >= onlineThreshold) {
        onlinePresence.push(p);
      } else if (p.lastHeartbeatAt >= recentlyLeftThreshold) {
        recentlyLeftPresence.push(p);
      }
      // Older than 10 min = not shown
    }

    const online = onlinePresence.map((presence) => ({
      id: presence.userId,
      lastHeartbeatAt: presence.lastHeartbeatAt,
      joinedAt: presence.joinedAt,
    }));
    const recentlyLeft = recentlyLeftPresence.map((presence) => ({
      id: presence.userId,
      lastHeartbeatAt: presence.lastHeartbeatAt,
      joinedAt: presence.joinedAt,
    }));

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
    const now = Date.now();
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

    if (await isBlockedBidirectional(ctx, currentUserId, peerId)) {
      throw new Error('Private chat is unavailable because one of you has blocked the other.');
    }

    if (sourceRoomId) {
      await requireRoomReadAccess(ctx, sourceRoomId, authUserId);

      const peerMembership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', sourceRoomId).eq('userId', peerId))
        .first();
      if (!peerMembership) {
        throw new Error('This user is no longer available for private chat from this room.');
      }
    }

    // MUTE-SAFETY-FIX: Check if peer has muted the current user
    // If muted, block DM creation for safety
    if (sourceRoomId) {
      const muteRecord = await ctx.db
        .query('chatRoomMutedUsers')
        .withIndex('by_muter_room_target', (q) =>
          q.eq('muterId', peerId).eq('roomId', sourceRoomId).eq('mutedUserId', currentUserId)
        )
        .first();

      if (muteRecord) {
        throw new Error('This user is not accepting private messages.');
      }
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
      if (await isDmThreadUnavailable(ctx, existing, now)) {
        await deleteDmThreadWithCleanup(ctx, existing._id);
      } else {
        return { threadId: existing._id, isNew: false };
      }
    }

    // Create new thread
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
      v.literal('audio'),
      v.literal('doodle')
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

    const now = Date.now();
    if (await isDmThreadUnavailable(ctx, thread, now)) {
      await deleteDmThreadWithCleanup(ctx, threadId);
      throw new Error('This private chat expired. Start a new chat from the room.');
    }

    const isParticipant =
      thread.participant1Id === senderId || thread.participant2Id === senderId;
    if (!isParticipant) {
      throw new Error('Not a participant in this thread');
    }

    // MUTE-SAFETY-FIX: Check if recipient has muted the sender
    // Determine recipient (peer) ID
    const recipientId = thread.participant1Id === senderId
      ? thread.participant2Id
      : thread.participant1Id;

    if (await isBlockedBidirectional(ctx, senderId, recipientId)) {
      throw new Error('Private chat is unavailable because one of you has blocked the other.');
    }

    // Check mute status in the source room (if available)
    if (thread.sourceRoomId) {
      const muteRecord = await ctx.db
        .query('chatRoomMutedUsers')
        .withIndex('by_muter_room_target', (q) =>
          q.eq('muterId', recipientId).eq('roomId', thread.sourceRoomId!).eq('mutedUserId', senderId)
        )
        .first();

      if (muteRecord) {
        throw new Error('This user is not accepting private messages.');
      }
    }

    // Validate message content
    const messageType = type ?? 'text';
    if (messageType === 'text' && (!text || text.trim().length === 0)) {
      throw new Error('Text message cannot be empty');
    }

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
    const now = Date.now();
    const retentionCutoff = now - CHAT_CONTENT_RETENTION_MS;

    const [threadsAsP1, threadsAsP2] = await Promise.all([
      ctx.db
        .query('chatRoomDmThreads')
        .withIndex('by_participant1_last_message', (q) => q.eq('participant1Id', userId))
        .order('desc')
        .collect(),
      ctx.db
        .query('chatRoomDmThreads')
        .withIndex('by_participant2_last_message', (q) => q.eq('participant2Id', userId))
        .order('desc')
        .collect(),
    ]);

    // Combine and dedupe
    const allThreads = [...threadsAsP1, ...threadsAsP2];
    const uniqueThreads = Array.from(
      new Map(allThreads.map((t) => [t._id, t])).values()
    );

    // Sort by lastMessageAt descending
    uniqueThreads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    const visibleThreads: Array<{
      thread: (typeof uniqueThreads)[number];
      peerId: Id<'users'>;
    }> = [];

    for (const thread of uniqueThreads) {
      const visibility = await getDmThreadInboxContext(ctx, thread, userId, now);
      if (!visibility.visible) {
        continue;
      }

      visibleThreads.push({
        thread,
        peerId: visibility.peerId,
      });

      // Stop once we have enough visible threads
      if (visibleThreads.length >= limit) {
        break;
      }
    }

    // Enrich with peer profile info
    const enriched = await Promise.all(
      visibleThreads.map(async ({ thread, peerId }) => {
        // Get chat room profile for peer (nickname, avatar)
        const chatRoomProfile = await ctx.db
          .query('chatRoomProfiles')
          .withIndex('by_userId', (q) => q.eq('userId', peerId))
          .first();

        // Count unread messages (messages from peer that haven't been read)
        const unreadMessages = await ctx.db
          .query('chatRoomDmMessages')
          .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
          .filter((q) =>
            q.and(
              q.eq(q.field('senderId'), peerId),
              q.eq(q.field('readAt'), undefined),
              q.gt(q.field('createdAt'), retentionCutoff)
            )
          )
          .collect();

        return {
          id: thread._id,
          peerId: peerId,
          peerName: chatRoomProfile?.nickname ?? 'Anonymous',
          peerAvatar: chatRoomProfile?.avatarUrl,
          peerAge: undefined,
          peerGender: undefined,
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

/**
 * Get messages in a DM thread.
 * Returns messages in chronological order.
 * Marks unread messages as read.
 */
export const getDmMessages = query({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { authUserId, threadId, paginationOpts }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return {
        page: [],
        isDone: true,
        continueCursor: paginationOpts.cursor ?? '',
        pageStatus: null,
      };
    }
    const now = Date.now();
    const retentionCutoff = now - CHAT_CONTENT_RETENTION_MS;

    // Verify thread exists and user is participant
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return {
        page: [],
        isDone: true,
        continueCursor: paginationOpts.cursor ?? '',
        pageStatus: null,
      };
    }
    if (await isDmThreadUnavailable(ctx, thread, now)) {
      return {
        page: [],
        isDone: true,
        continueCursor: paginationOpts.cursor ?? '',
        pageStatus: null,
      };
    }

    const isParticipant =
      thread.participant1Id === userId || thread.participant2Id === userId;
    if (!isParticipant) {
      return {
        page: [],
        isDone: true,
        continueCursor: paginationOpts.cursor ?? '',
        pageStatus: null,
      };
    }

    const peerId =
      thread.participant1Id === userId
        ? thread.participant2Id
        : thread.participant1Id;
    if (await isBlockedBidirectional(ctx, userId, peerId)) {
      return {
        page: [],
        isDone: true,
        continueCursor: paginationOpts.cursor ?? '',
        pageStatus: null,
      };
    }

    const pageResult = await ctx.db
      .query('chatRoomDmMessages')
      .withIndex('by_thread_created', (q) => q.eq('threadId', threadId))
      .filter((q) => q.gt(q.field('createdAt'), retentionCutoff))
      .order('desc')
      .paginate(paginationOpts);

    const messageDocs = [...pageResult.page].reverse();
    const senderIds = Array.from(new Set(messageDocs.map((msg) => msg.senderId.toString())));
    const senderProfiles = new Map<string, Doc<'chatRoomProfiles'> | null>(
      await Promise.all(
        senderIds.map(async (senderId) => {
          const profile = await ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', senderId as Id<'users'>))
            .first();
          return [senderId, profile] as const;
        })
      )
    );

    const enriched = messageDocs.map((msg) => {
      const senderProfile = senderProfiles.get(msg.senderId.toString()) ?? null;
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
    });

    return {
      ...pageResult,
      page: enriched,
    };
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
    const now = Date.now();
    const retentionCutoff = now - CHAT_CONTENT_RETENTION_MS;

    // Verify thread exists and user is participant
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { marked: 0 };
    }
    if (await isDmThreadUnavailable(ctx, thread, now)) {
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

    if (await isBlockedBidirectional(ctx, userId, peerId)) {
      return { marked: 0 };
    }

    // Find unread messages from peer
    const unreadMessages = await ctx.db
      .query('chatRoomDmMessages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .filter((q) =>
        q.and(
          q.eq(q.field('senderId'), peerId),
          q.eq(q.field('readAt'), undefined),
          q.gt(q.field('createdAt'), retentionCutoff)
        )
      )
      .collect();

    // Mark as read
    for (const msg of unreadMessages) {
      await ctx.db.patch(msg._id, { readAt: now });
    }

    return { marked: unreadMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HIDE DM THREAD (UI-level hide, data persists)
// HIDE-VS-DELETE-FIX: X button hides thread from list without deleting data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hide a DM thread from the user's private list.
 * This is a UI-level action - messages and thread data persist.
 * Thread reappears if new message arrives (lastMessageAt > hiddenAt).
 */
export const hideDmThread = mutation({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
  },
  handler: async (ctx, { authUserId, threadId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Get thread
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { success: false, error: 'Thread not found' };
    }

    // Verify user is participant
    const isP1 = thread.participant1Id === userId;
    const isP2 = thread.participant2Id === userId;
    if (!isP1 && !isP2) {
      throw new Error('Unauthorized: user is not a participant in this thread');
    }

    // Set hidden timestamp for the caller
    const now = Date.now();
    if (isP1) {
      await ctx.db.patch(threadId, { hiddenByP1At: now });
    } else {
      await ctx.db.patch(threadId, { hiddenByP2At: now });
    }

    return { success: true };
  },
});

/**
 * Unhide a DM thread (make it visible again in private list).
 * Called automatically when new message arrives, or manually if needed.
 */
export const unhideDmThread = mutation({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
  },
  handler: async (ctx, { authUserId, threadId }) => {
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { success: false, error: 'Thread not found' };
    }

    const isP1 = thread.participant1Id === userId;
    const isP2 = thread.participant2Id === userId;
    if (!isP1 && !isP2) {
      throw new Error('Unauthorized: user is not a participant');
    }

    // Clear hidden flag for the caller
    if (isP1) {
      await ctx.db.patch(threadId, { hiddenByP1At: undefined });
    } else {
      await ctx.db.patch(threadId, { hiddenByP2At: undefined });
    }

    return { success: true };
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
    const now = Date.now();

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

    const visibleMentions = [];
    for (const mention of mentions) {
      const message = await ctx.db.get(mention.messageId);
      if (!message) continue;
      if (message.deletedAt) continue;
      if (isRoomMessageExpired(message, now)) continue;
      visibleMentions.push({
        id: mention._id,
        senderUserId: mention.senderUserId,
        senderNickname: mention.senderNickname,
        roomId: mention.roomId,
        roomName: mention.roomName,
        messageId: mention.messageId,
        messagePreview: mention.messagePreview,
        createdAt: mention.createdAt,
        isRead: mention.readAt !== undefined,
        readAt: mention.readAt,
      });
    }

    return visibleMentions;
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

// ═══════════════════════════════════════════════════════════════════════════
// DM THREAD DELETE CONSISTENCY
// When a DM thread is deleted, all related content must be cleaned up:
// - All messages in the thread
// - All media storage blobs (images, videos, audio, doodles)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete a DM thread and all its messages with full storage cleanup
 * This ensures delete consistency - no orphaned messages or media
 */
export const deleteDmThread = mutation({
  args: {
    authUserId: v.string(),
    threadId: v.id('chatRoomDmThreads'),
  },
  handler: async (ctx, { authUserId, threadId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Verify thread exists and user is participant
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { success: false, error: 'Thread not found', deletedMessages: 0, deletedStorage: 0 };
    }

    const isParticipant =
      thread.participant1Id === userId || thread.participant2Id === userId;
    if (!isParticipant) {
      throw new Error('Unauthorized: user is not a participant in this thread');
    }

    const result = await deleteDmThreadWithCleanup(ctx, threadId);

    return {
      success: true,
      deletedMessages: result.deletedMessages,
      deletedStorage: result.deletedStorage,
    };
  },
});

/**
 * Cleanup orphaned DM messages (messages without valid thread)
 * This is a maintenance function to ensure data consistency
 */
export const cleanupOrphanedDmMessages = mutation({
  args: {},
  handler: async (ctx) => {
    // Get all DM messages
    const allMessages = await ctx.db.query('chatRoomDmMessages').collect();

    let deletedMessages = 0;
    let deletedStorage = 0;

    for (const message of allMessages) {
      // Check if thread still exists
      const thread = await ctx.db.get(message.threadId);
      if (!thread) {
        // Thread is gone - clean up orphaned message
        if (message.mediaStorageId) {
          try {
            await ctx.storage.delete(message.mediaStorageId);
            deletedStorage++;
          } catch (error) {
            console.warn('[cleanupOrphanedDmMessages] Storage delete failed:', message.mediaStorageId);
          }
        }
        await ctx.db.delete(message._id);
        deletedMessages++;
      }
    }

    return {
      deletedMessages,
      deletedStorage,
      message: `Cleaned up ${deletedMessages} orphaned DM messages and ${deletedStorage} storage blobs`,
    };
  },
});

/**
 * Delete all DM threads and messages for a user (account cleanup)
 * Used when user deletes their account or chat room profile
 */
export const deleteAllUserDmThreads = mutation({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
    }

    // Find all threads where user is participant1
    const threadsAsP1 = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participant1', (q) => q.eq('participant1Id', userId))
      .collect();

    // Find all threads where user is participant2
    const threadsAsP2 = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participant2', (q) => q.eq('participant2Id', userId))
      .collect();

    const allThreads = [...threadsAsP1, ...threadsAsP2];

    let deletedThreads = 0;
    let deletedMessages = 0;
    let deletedStorage = 0;

    for (const thread of allThreads) {
      const result = await deleteDmThreadWithCleanup(ctx, thread._id);
      if (result.deletedThread) {
        deletedThreads++;
      }
      deletedMessages += result.deletedMessages;
      deletedStorage += result.deletedStorage;
    }

    return {
      success: true,
      deletedThreads,
      deletedMessages,
      deletedStorage,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UNREAD DM COUNTS BY ROOM
// Groups unread DM message counts by their source room for badges
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get unread DM message counts grouped by source room.
 * Used for:
 * 1. Room-level badges in Chat Rooms list
 * 2. Tab-level badge (binary: has any unread or not)
 *
 * Returns:
 * - byRoomId: Record<string, number> - unread count per room
 * - hasAnyUnread: boolean - true if any room has unread
 * - totalRoomsWithUnread: number - count of rooms with unread (for tab badge)
 */
export const getUnreadDmCountsByRoom = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, { authUserId }) => {
    // Resolve user ID
    const userId = await resolveUserIdByAuthId(ctx, authUserId);
    if (!userId) {
      return { byRoomId: {}, hasAnyUnread: false, totalRoomsWithUnread: 0 };
    }
    const now = Date.now();
    const retentionCutoff = now - CHAT_CONTENT_RETENTION_MS;

    // Get all DM threads where user is participant
    const threadsAsP1 = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participant1', (q) => q.eq('participant1Id', userId))
      .collect();

    const threadsAsP2 = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_participant2', (q) => q.eq('participant2Id', userId))
      .collect();

    // Combine and dedupe
    const allThreads = [...threadsAsP1, ...threadsAsP2];
    const uniqueThreads = Array.from(
      new Map(allThreads.map((t) => [t._id, t])).values()
    );

    // Count unread messages per room
    const unreadByRoom: Record<string, number> = {};

    for (const thread of uniqueThreads) {
      const visibility = await getDmThreadInboxContext(ctx, thread, userId, now);
      if (!visibility.visible) continue;

      // Skip threads without sourceRoomId (shouldn't happen, but safety check)
      if (!thread.sourceRoomId) continue;

      const peerId = visibility.peerId;

      // P0-004 FIX: Use optimized index to query only unread messages
      // Old query was O(n) per thread (fetched ALL messages, filtered in JS)
      // New query only fetches unread messages, then filters by sender
      const unreadMessages = await ctx.db
        .query('chatRoomDmMessages')
        .withIndex('by_thread_read_status', (q) =>
          q.eq('threadId', thread._id).eq('readAt', undefined)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field('senderId'), peerId),
            q.gt(q.field('createdAt'), retentionCutoff)
          )
        )
        .collect();

      if (unreadMessages.length > 0) {
        const roomIdStr = thread.sourceRoomId.toString();
        unreadByRoom[roomIdStr] = (unreadByRoom[roomIdStr] || 0) + unreadMessages.length;
      }
    }

    const roomsWithUnread = Object.keys(unreadByRoom).length;

    return {
      byRoomId: unreadByRoom,
      hasAnyUnread: roomsWithUnread > 0,
      totalRoomsWithUnread: roomsWithUnread,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INACTIVITY CLEANUP: Delete DM threads inactive for 1 hour
// HIDE-VS-DELETE-FIX: Threads are auto-deleted after 1 hour of no messages
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cleanup DM threads that have been inactive for 1 hour.
 * Should be called periodically by a scheduled job (cron).
 *
 * A thread is inactive if: now - lastMessageAt >= 1 hour
 */
export const cleanupInactiveDmThreads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffTime = now - DM_THREAD_INACTIVITY_MS;

    // Find all threads where lastMessageAt is older than 1 hour
    const inactiveThreads = await ctx.db
      .query('chatRoomDmThreads')
      .withIndex('by_last_message')
      .filter((q) => q.lte(q.field('lastMessageAt'), cutoffTime))
      .take(BATCH_DELETE_SIZE);

    let deletedThreads = 0;
    let deletedMessages = 0;
    let deletedStorage = 0;

    for (const thread of inactiveThreads) {
      const result = await deleteDmThreadWithCleanup(ctx, thread._id);
      if (result.deletedThread) {
        deletedThreads++;
      }
      deletedMessages += result.deletedMessages;
      deletedStorage += result.deletedStorage;
    }

    return {
      deletedThreads,
      deletedMessages,
      deletedStorage,
    };
  },
});
