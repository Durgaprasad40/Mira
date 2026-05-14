import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { softMaskText } from './softMask';
import { internal } from './_generated/api';
import { asUserId } from './id';
import { hashPassword, verifyPassword, encryptPassword, decryptPassword } from './cryptoUtils';
import { resolveUserIdByAuthId, validateSessionToken } from './helpers';
import { shouldCreatePhase2ChatRoomsNotification } from './phase2NotificationPrefs';
import {
  formatChatRoomContentPolicyError,
  validateChatRoomMessageContent,
} from './lib/chatRoomContentPolicy';
import {
  CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS,
} from './chatRoomDmRetention';
import {
  isUserAdultForPrivateRooms,
  requireChatRoomTermsAccepted,
  requirePrivateRoomAdult,
} from './lib/userPolicyGates';

// 24 hours in milliseconds
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PENALTY_DURATION_MS = 24 * 60 * 60 * 1000;
const ROOM_REPORT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEVERE_ROOM_REPORT_DM_BLOCK_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_TIMEOUT_WINDOW_MS = 60 * 60 * 1000;
const PRESENCE_ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const PRESENCE_RECENTLY_LEFT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const PRESENCE_STALE_CLEANUP_MS = 15 * 60 * 1000; // buffer beyond visible retention
const QUALIFYING_REPORTER_MIN_MEMBERSHIP_MS = 10 * 60 * 1000;
const TIMEOUT_2_REPORTS_MS = 3 * 60 * 1000;
const TIMEOUT_3_REPORTS_MS = 10 * 60 * 1000;
const TIMEOUT_4_REPORTS_MS = 30 * 60 * 1000;
const TIMEOUT_5_REPORTS_MS = 60 * 60 * 1000;
// Message retention constants
const MAX_MESSAGES_PER_ROOM = 1000; // Trigger cleanup when exceeded
const TARGET_AFTER_TRIM = 900;      // Target count after cleanup
const BATCH_DELETE_SIZE = 200;      // Delete in batches for efficiency

const SEVERE_CHAT_ROOM_REPORT_REASONS = new Set<string>([
  // UI reason ids
  'harassment_hate',
  'sexual_nudity',
  'threats',
  'selling_promotion',
  // Persisted schema reason ids
  'harassment',
  'hate_speech',
  'sexual_content',
  'nudity',
  'violent_threats',
  'selling',
]);

const ROOM_LIST_QUERY_LIMIT = 100;
const PRIVATE_ROOM_LIST_QUERY_LIMIT = 200;
const ROOM_MEMBER_LIST_LIMIT = 500;
const ROOM_MEMBER_COUNT_RECOMPUTE_LIMIT = 5000;
const ROOM_REPORT_LOOKUP_LIMIT = 500;
const USER_SAFETY_LOOKUP_LIMIT = 1000;
const USER_DM_THREAD_LOOKUP_LIMIT = 200;
const JOIN_CODE_LOOKUP_WINDOW_MS = 5 * 60 * 1000;
const JOIN_CODE_LOOKUP_MAX_ATTEMPTS = 12;
const JOIN_CODE_GENERIC_ERROR = 'Unable to join with this code.';

// Generate a random 6-character alphanumeric join code
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0, I/1 for clarity
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeJoinCode(value: string): string {
  return value.toUpperCase().trim();
}

async function enforceJoinCodeLookupThrottle(
  ctx: MutationCtx,
  userId: Id<'users'>,
  now = Date.now()
): Promise<void> {
  const windowStart = Math.floor(now / JOIN_CODE_LOOKUP_WINDOW_MS) * JOIN_CODE_LOOKUP_WINDOW_MS;
  const existing = await ctx.db
    .query('chatRoomJoinCodeLookups')
    .withIndex('by_user_window', (q) => q.eq('userId', userId).eq('windowStart', windowStart))
    .first();

  if (existing) {
    if (existing.attempts >= JOIN_CODE_LOOKUP_MAX_ATTEMPTS) {
      throw new Error('Too many join-code attempts. Please wait before trying again.');
    }
    await ctx.db.patch(existing._id, {
      attempts: existing.attempts + 1,
      lastAttemptAt: now,
    });
    return;
  }

  await ctx.db.insert('chatRoomJoinCodeLookups', {
    userId,
    windowStart,
    attempts: 1,
    lastAttemptAt: now,
  });
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
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateSessionToken(ctx, args.token.trim());
    if (!userId) {
      throw new Error('Unauthorized: authentication required');
    }
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
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    authUserId: v.optional(v.string()),
    sessionToken: v.string(),
  },
  handler: async (ctx, { storageId, roomId, messageId, authUserId, sessionToken }) => {
    await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });
    const message = await ctx.db.get(messageId);
    if (!message || message.roomId !== roomId || message.deletedAt) {
      throw new Error('Media not found');
    }
    const belongsToMessage =
      message.imageStorageId === storageId ||
      message.videoStorageId === storageId ||
      message.audioStorageId === storageId;
    if (!belongsToMessage) {
      throw new Error('Media not found');
    }
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
): Promise<number | null> {
  const members = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .take(ROOM_MEMBER_COUNT_RECOMPUTE_LIMIT + 1);
  if (members.length > ROOM_MEMBER_COUNT_RECOMPUTE_LIMIT) {
    return null;
  }
  return members.length;
}

async function patchMemberCountIfExact(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>
): Promise<void> {
  const actualMemberCount = await recomputeMemberCount(ctx, roomId);
  if (actualMemberCount === null) {
    return;
  }
  await ctx.db.patch(roomId, { memberCount: actualMemberCount });
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Delete room and all related data (messages, members, penalties)
// Used by closeRoom, resetMyPrivateRooms, deleteExpiredRoom, cleanupExpiredRooms
// ═══════════════════════════════════════════════════════════════════════════
async function deleteRoomFully(ctx: MutationCtx, roomId: Id<'chatRooms'>): Promise<void> {
  // P2-3: Every related-table fan-out is now bounded by `.take(CASCADE_BATCH)`
  // and looped until the table is drained. This keeps total docs read/written
  // per iteration well under Convex per-mutation limits (~4096 reads/~8192
  // writes) even for rooms with tens of thousands of messages/members.
  const CASCADE_BATCH = 200;

  // Delete all messages (drain in batches; each message has extra relation +
  // storage cleanup so keep the batch size conservative).
  while (true) {
    const messages = await ctx.db
      .query('chatRoomMessages')
      .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (messages.length === 0) break;
    for (const msg of messages) {
      await cleanupChatRoomMessageRelations(ctx, roomId, msg._id);
      await deleteChatRoomMessageStorage(ctx, msg);
      await ctx.db.delete(msg._id);
    }
    if (messages.length < CASCADE_BATCH) break;
  }

  // Delete all members
  while (true) {
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (members.length === 0) break;
    for (const member of members) {
      await ctx.db.delete(member._id);
    }
    if (members.length < CASCADE_BATCH) break;
  }

  // Delete all penalties
  while (true) {
    const penalties = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (penalties.length === 0) break;
    for (const penalty of penalties) {
      await ctx.db.delete(penalty._id);
    }
    if (penalties.length < CASCADE_BATCH) break;
  }

  // P0-4: Cascade remaining room-linked tables so private rooms leave no residue.
  // chatRoomProfiles is user-scoped (nickname persists across rooms) and
  // chatRoomHiddenDmConversations is keyed by conversationId, so both are
  // intentionally excluded.

  // Join requests for this room
  while (true) {
    const joinRequests = await ctx.db
      .query('chatRoomJoinRequests')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (joinRequests.length === 0) break;
    for (const req of joinRequests) {
      await ctx.db.delete(req._id);
    }
    if (joinRequests.length < CASCADE_BATCH) break;
  }

  // Bans for this room
  while (true) {
    const bans = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (bans.length === 0) break;
    for (const ban of bans) {
      await ctx.db.delete(ban._id);
    }
    if (bans.length < CASCADE_BATCH) break;
  }

  // Presence rows for this room
  while (true) {
    const presence = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (presence.length === 0) break;
    for (const row of presence) {
      await ctx.db.delete(row._id);
    }
    if (presence.length < CASCADE_BATCH) break;
  }

  // Per-user mutes scoped to this room
  while (true) {
    const perUserMutes = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (perUserMutes.length === 0) break;
    for (const row of perUserMutes) {
      await ctx.db.delete(row._id);
    }
    if (perUserMutes.length < CASCADE_BATCH) break;
  }

  // Password brute-force attempt records for this room
  while (true) {
    const passwordAttempts = await ctx.db
      .query('chatRoomPasswordAttempts')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId))
      .take(CASCADE_BATCH);
    if (passwordAttempts.length === 0) break;
    for (const row of passwordAttempts) {
      await ctx.db.delete(row._id);
    }
    if (passwordAttempts.length < CASCADE_BATCH) break;
  }

  // userRoomPrefs / userRoomReports are keyed by a string roomId. Delete
  // only the rows whose roomId matches this chat room's document id.
  const roomIdString = roomId as unknown as string;

  while (true) {
    const prefs = await ctx.db
      .query('userRoomPrefs')
      .withIndex('by_room', (q) => q.eq('roomId', roomIdString))
      .take(CASCADE_BATCH);
    if (prefs.length === 0) break;
    for (const row of prefs) {
      await ctx.db.delete(row._id);
    }
    if (prefs.length < CASCADE_BATCH) break;
  }

  while (true) {
    const reports = await ctx.db
      .query('userRoomReports')
      .withIndex('by_room', (q) => q.eq('roomId', roomIdString))
      .take(CASCADE_BATCH);
    if (reports.length === 0) break;
    for (const row of reports) {
      await ctx.db.delete(row._id);
    }
    if (reports.length < CASCADE_BATCH) break;
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

function isChatRoomVisualMediaType(type: string | undefined): type is 'image' | 'video' {
  return type === 'image' || type === 'video';
}

function getChatRoomVisualStorageId(message: {
  type?: string;
  imageStorageId?: Id<'_storage'>;
  videoStorageId?: Id<'_storage'>;
}): Id<'_storage'> | undefined {
  if (message.type === 'video') {
    return message.videoStorageId ?? message.imageStorageId;
  }
  if (message.type === 'image') {
    return message.imageStorageId;
  }
  return undefined;
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
      .take(500);

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
      .take(500);

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

  try {
    const mediaViews = await ctx.db
      .query('chatRoomMediaViews')
      .withIndex('by_message', (q) => q.eq('messageId', messageId))
      .take(500);

    for (const mediaView of mediaViews) {
      try {
        await ctx.db.delete(mediaView._id);
      } catch {
        // Best-effort cleanup: continue if already deleted concurrently.
      }
    }
  } catch {
    // Best-effort cleanup: continue even if media-view lookup fails.
  }
}

type ChatRoomSessionAuthArgs = {
  authUserId?: string;
  sessionToken?: string;
};

async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  args: ChatRoomSessionAuthArgs
): Promise<Id<'users'>> {
  const sessionToken = args.sessionToken?.trim();
  const claimedAuthUserId = args.authUserId?.trim();

  if (!sessionToken) {
    throw new Error('Unauthorized: authentication required');
  }

  const userId = await validateSessionToken(ctx, sessionToken);
  if (!userId) {
    throw new Error('Unauthorized: invalid session');
  }

  if (claimedAuthUserId) {
    const claimedUserId = await resolveUserIdByAuthId(ctx, claimedAuthUserId);
    if (!claimedUserId || claimedUserId !== userId) {
      throw new Error('Unauthorized: session does not match user');
    }
  }

  return userId;
}

async function getAuthenticatedUserOrNull(
  ctx: QueryCtx | MutationCtx,
  args: ChatRoomSessionAuthArgs
): Promise<Id<'users'> | null> {
  try {
    return await requireAuthenticatedUser(ctx, args);
  } catch {
    return null;
  }
}

function hasChatRoomPassword(room: Doc<'chatRooms'>): boolean {
  return !!room.passwordHash || !!room.passwordEncrypted;
}

function sanitizeChatRoomForClient(
  room: Doc<'chatRooms'>,
  options: {
    onlineCount?: number;
    includeLastMessage?: boolean;
    includeCreatedBy?: boolean;
    includeJoinCode?: boolean;
    role?: 'owner' | 'admin' | 'member';
    isMember?: boolean;
  } = {}
) {
  return {
    _id: room._id,
    name: room.name,
    slug: room.slug,
    category: room.category,
    isPublic: room.isPublic,
    discoverable: room.discoverable === true,
    memberCount: room.memberCount,
    onlineCount: options.onlineCount,
    lastMessageAt: room.lastMessageAt,
    ...(options.includeLastMessage ? { lastMessageText: room.lastMessageText } : {}),
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    ...(options.includeCreatedBy ? { createdBy: room.createdBy } : {}),
    hasPassword: hasChatRoomPassword(room),
    ...(options.includeJoinCode ? { joinCode: room.joinCode } : {}),
    ...(options.role ? { role: options.role } : {}),
    ...(options.isMember !== undefined ? { isMember: options.isMember } : {}),
  };
}

type ChatRoomReadAccess = {
  userId: Id<'users'>;
  room: Doc<'chatRooms'>;
  membership: Doc<'chatRoomMembers'> | null;
};

type ChatRoomSendAccess = {
  userId: Id<'users'>;
  room: Doc<'chatRooms'>;
  membership: Doc<'chatRoomMembers'>;
};

async function readGuard(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  userId: Id<'users'>
): Promise<ChatRoomReadAccess> {
  const room = await ctx.db.get(roomId);
  if (!room) {
    throw new Error('Room not found');
  }

  const now = Date.now();
  if (room.expiresAt && room.expiresAt <= now) {
    throw new Error('Room has expired');
  }

  if (!room.isPublic) {
    await requirePrivateRoomAdult(ctx, userId);
  }

  const ban = await ctx.db
    .query('chatRoomBans')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (ban) {
    throw new Error('Access denied: you are banned from this room');
  }

  const membership = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (membership?.isBanned) {
    throw new Error('Access denied: you are banned from this room');
  }
  if (!room.isPublic && !membership) {
    throw new Error('Access denied: you must join this room first');
  }

  return { userId, room, membership };
}

async function requireRoomReadAccess(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  auth: ChatRoomSessionAuthArgs
): Promise<ChatRoomReadAccess> {
  const userId = await requireAuthenticatedUser(ctx, auth);
  return readGuard(ctx, roomId, userId);
}

async function joinIfMissingPublic(
  ctx: MutationCtx,
  room: Doc<'chatRooms'>,
  userId: Id<'users'>
): Promise<Doc<'chatRoomMembers'>> {
  if (!room.isPublic) {
    throw new Error('Private rooms cannot be auto-joined');
  }

  const existing = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
    .first();
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const membershipId = await ctx.db.insert('chatRoomMembers', {
    roomId: room._id,
    userId,
    role: 'member',
    joinedAt: now,
  });

  const rows = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
    .take(10);
  const sortedRows = rows.sort((a, b) => a._creationTime - b._creationTime);
  const membership = sortedRows[0] ?? (await ctx.db.get(membershipId));
  for (const duplicate of sortedRows.slice(1)) {
    await ctx.db.delete(duplicate._id);
  }

  await patchMemberCountIfExact(ctx, room._id);

  if (!membership) {
    throw new Error('Failed to join public room');
  }
  return membership;
}

async function requireRoomSendAccess(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>,
  auth: ChatRoomSessionAuthArgs
): Promise<ChatRoomSendAccess> {
  const access = await requireRoomReadAccess(ctx, roomId, auth);
  let membership = access.membership;

  if (!membership && access.room.isPublic) {
    membership = await joinIfMissingPublic(ctx, access.room, access.userId);
  }
  if (!membership) {
    throw new Error('Access denied: you must join this room first');
  }

  const penalty = await getActiveChatRoomReadOnlyPenalty(ctx, roomId, access.userId, Date.now());
  if (penalty) {
    throw new Error('You are restricted from sending messages in this room');
  }

  return { ...access, membership };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY AUTHORIZATION HELPERS (Phase-2 Audit Fix)
// Read vs Send access separation:
// - Read Access: view room, messages, members (blocked by bans, not penalties)
// - Send Access: send messages/media (blocked by bans AND send-blocking penalties)
// ═══════════════════════════════════════════════════════════════════════════

// Penalty types that block sending (but allow reading). The current schema
// only persists `readOnly`; the extra values are kept for legacy/forward
// compatibility if older rows or a later schema expansion introduce them.
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

function canModerate(role: string | undefined | null): boolean {
  return getRoleLevel(role) >= ROLE_LEVEL.admin;
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
  if (!canModerate(actorRole)) return false;

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

async function getBidirectionalBlockedUserIds(
  ctx: QueryCtx | MutationCtx,
  viewerId: Id<'users'>
): Promise<Set<string>> {
  const [blockedByViewer, blockedViewer] = await Promise.all([
    ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q) => q.eq('blockerId', viewerId))
      .take(USER_SAFETY_LOOKUP_LIMIT),
    ctx.db
      .query('blocks')
      .withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerId))
      .take(USER_SAFETY_LOOKUP_LIMIT),
  ]);

  return new Set([
    ...blockedByViewer.map((row) => String(row.blockedUserId)),
    ...blockedViewer.map((row) => String(row.blockerId)),
  ]);
}

async function getRoomReportedUserHideAfterMap(
  ctx: QueryCtx | MutationCtx,
  reporterId: Id<'users'>,
  roomId: Id<'chatRooms'>
): Promise<Map<string, number>> {
  const hideAfterByUser = new Map<string, number>();
  let cursor: ChatRoomReportScanCursor | null = null;

  while (true) {
    const scanCursor: ChatRoomReportScanCursor | null = cursor;
    const reports: Doc<'chatRoomReports'>[] =
      scanCursor === null
        ? await ctx.db
            .query('chatRoomReports')
            .withIndex('by_room_reporter_created', (q) =>
              q.eq('roomId', roomId).eq('reporterId', reporterId)
            )
            .take(ROOM_REPORT_LOOKUP_LIMIT)
        : await ctx.db
            .query('chatRoomReports')
            .withIndex('by_room_reporter_created', (q) =>
              q
                .eq('roomId', roomId)
                .eq('reporterId', reporterId)
                .gte('createdAt', scanCursor.createdAt)
            )
            .filter((q) =>
              q.or(
                q.gt(q.field('createdAt'), scanCursor.createdAt),
                q.and(
                  q.eq(q.field('createdAt'), scanCursor.createdAt),
                  q.gt(q.field('_creationTime'), scanCursor.creationTime)
                )
              )
            )
            .take(ROOM_REPORT_LOOKUP_LIMIT);

    if (reports.length === 0) break;

    for (const report of reports) {
      const reportedId = String(report.reportedUserId);
      const previous = hideAfterByUser.get(reportedId);
      if (previous === undefined || report.createdAt < previous) {
        hideAfterByUser.set(reportedId, report.createdAt);
      }
    }

    const lastReport = reports[reports.length - 1];
    cursor = { createdAt: lastReport.createdAt, creationTime: lastReport._creationTime };
    if (reports.length < ROOM_REPORT_LOOKUP_LIMIT) break;
  }

  return hideAfterByUser;
}

async function findRecentRoomUserReport(
  ctx: QueryCtx | MutationCtx,
  reporterId: Id<'users'>,
  reportedUserId: Id<'users'>,
  roomId: Id<'chatRooms'>,
  now: number
): Promise<Doc<'chatRoomReports'> | null> {
  const cutoff = now - ROOM_REPORT_DEDUP_WINDOW_MS;
  const recentReports = await ctx.db
    .query('chatRoomReports')
    .withIndex('by_reporter_reported_room_created', (q) =>
      q
        .eq('reporterId', reporterId)
        .eq('reportedUserId', reportedUserId)
        .eq('roomId', roomId)
        .gt('createdAt', cutoff)
    )
    .take(10);

  return (
    recentReports
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

async function findRecentRoomContentReport(
  ctx: QueryCtx | MutationCtx,
  reporterId: Id<'users'>,
  messageId: string,
  now: number
): Promise<Doc<'chatRoomReports'> | null> {
  const cutoff = now - ROOM_REPORT_DEDUP_WINDOW_MS;
  return await ctx.db
    .query('chatRoomReports')
    .withIndex('by_message_reporter_type_created', (q) =>
      q
        .eq('messageId', messageId)
        .eq('reporterId', reporterId)
        .eq('reportType', 'content')
        .gt('createdAt', cutoff)
    )
    .first();
}

type ChatRoomReportScanCursor = {
  createdAt: number;
  creationTime: number;
};

async function hasActiveSevereRoomReportBetweenUsers(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<'users'>,
  userId2: Id<'users'>,
  roomId: Id<'chatRooms'>,
  now: number
): Promise<boolean> {
  const cutoff = now - SEVERE_ROOM_REPORT_DM_BLOCK_MS;
  const hasOneWayReport = async (
    reporterId: Id<'users'>,
    reportedUserId: Id<'users'>
  ): Promise<boolean> => {
    let cursor: ChatRoomReportScanCursor | null = null;

    while (true) {
      const scanCursor: ChatRoomReportScanCursor | null = cursor;
      const reports: Doc<'chatRoomReports'>[] =
        scanCursor === null
          ? await ctx.db
              .query('chatRoomReports')
              .withIndex('by_reporter_reported_room_created', (q) =>
                q
                  .eq('reporterId', reporterId)
                  .eq('reportedUserId', reportedUserId)
                  .eq('roomId', roomId)
                  .gt('createdAt', cutoff)
              )
              .take(ROOM_REPORT_LOOKUP_LIMIT)
          : await ctx.db
              .query('chatRoomReports')
              .withIndex('by_reporter_reported_room_created', (q) =>
                q
                  .eq('reporterId', reporterId)
                  .eq('reportedUserId', reportedUserId)
                  .eq('roomId', roomId)
                  .gte('createdAt', scanCursor.createdAt)
              )
              .filter((q) =>
                q.or(
                  q.gt(q.field('createdAt'), scanCursor.createdAt),
                  q.and(
                    q.eq(q.field('createdAt'), scanCursor.createdAt),
                    q.gt(q.field('_creationTime'), scanCursor.creationTime)
                  )
                )
              )
              .take(ROOM_REPORT_LOOKUP_LIMIT);

      if (reports.some((report) => SEVERE_CHAT_ROOM_REPORT_REASONS.has(String(report.reason)))) {
        return true;
      }
      if (reports.length < ROOM_REPORT_LOOKUP_LIMIT) {
        return false;
      }
      const lastReport = reports[reports.length - 1];
      cursor = { createdAt: lastReport.createdAt, creationTime: lastReport._creationTime };
    }
  };

  return (
    (await hasOneWayReport(userId1, userId2)) ||
    (await hasOneWayReport(userId2, userId1))
  );
}

async function getActiveChatRoomReadOnlyPenalty(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  userId: Id<'users'>,
  now = Date.now()
): Promise<Doc<'chatRoomPenalties'> | null> {
  const penalties = await ctx.db
    .query('chatRoomPenalties')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .take(20);

  return (
    penalties
      .filter((penalty) => {
        const penaltyType = penalty.type as string;
        return (
          penalty.expiresAt > now &&
          SEND_BLOCKING_PENALTY_TYPES.includes(penaltyType as any)
        );
      })
      .sort((a, b) => b.expiresAt - a.expiresAt)[0] ?? null
  );
}

async function reporterHasQualifyingChatRoomPresence(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  reporterId: Id<'users'>,
  reportCreatedAt: number
): Promise<boolean> {
  const membership = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', reporterId))
    .first();

  if (
    membership?.joinedAt &&
    membership.joinedAt <= reportCreatedAt - QUALIFYING_REPORTER_MIN_MEMBERSHIP_MS
  ) {
    return true;
  }

  const priorMessage = await ctx.db
    .query('chatRoomMessages')
    .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
    .filter((q) =>
      q.and(
        q.eq(q.field('senderId'), reporterId),
        q.lt(q.field('createdAt'), reportCreatedAt)
      )
    )
    .first();

  return !!priorMessage;
}

async function countQualifyingUniqueReporters(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  reportedUserId: Id<'users'>,
  windowStart: number,
  now = Date.now()
): Promise<{
  uniqueReporterCount: number;
  weightedScore: number;
  reportIds: Id<'chatRoomReports'>[];
}> {
  const qualifyingByReporter = new Map<
    string,
    { reporterId: Id<'users'>; reportId: Id<'chatRoomReports'> }
  >();
  let cursor: ChatRoomReportScanCursor | null = null;

  while (true) {
    const scanCursor: ChatRoomReportScanCursor | null = cursor;
    const reports: Doc<'chatRoomReports'>[] =
      scanCursor === null
        ? await ctx.db
            .query('chatRoomReports')
            .withIndex('by_room_reported_created', (q) =>
              q
                .eq('roomId', roomId)
                .eq('reportedUserId', reportedUserId)
                .gte('createdAt', windowStart)
            )
            .take(ROOM_REPORT_LOOKUP_LIMIT)
        : await ctx.db
            .query('chatRoomReports')
            .withIndex('by_room_reported_created', (q) =>
              q
                .eq('roomId', roomId)
                .eq('reportedUserId', reportedUserId)
                .gte('createdAt', scanCursor.createdAt)
            )
            .filter((q) =>
              q.or(
                q.gt(q.field('createdAt'), scanCursor.createdAt),
                q.and(
                  q.eq(q.field('createdAt'), scanCursor.createdAt),
                  q.gt(q.field('_creationTime'), scanCursor.creationTime)
                )
              )
            )
            .take(ROOM_REPORT_LOOKUP_LIMIT);

    if (reports.length === 0) break;

    for (const report of reports) {
      if (report.reporterId === reportedUserId) continue;
      if (qualifyingByReporter.has(String(report.reporterId))) continue;

      const reporterPenalty = await getActiveChatRoomReadOnlyPenalty(
        ctx,
        roomId,
        report.reporterId,
        now
      );
      if (reporterPenalty) continue;

      const hasPresenceProof = await reporterHasQualifyingChatRoomPresence(
        ctx,
        roomId,
        report.reporterId,
        report.createdAt
      );
      if (!hasPresenceProof) continue;

      qualifyingByReporter.set(String(report.reporterId), {
        reporterId: report.reporterId,
        reportId: report._id,
      });
    }

    if (reports.length < ROOM_REPORT_LOOKUP_LIMIT) break;
    const lastReport = reports[reports.length - 1];
    cursor = { createdAt: lastReport.createdAt, creationTime: lastReport._creationTime };
  }

  const qualifying = Array.from(qualifyingByReporter.values());
  return {
    uniqueReporterCount: qualifying.length,
    // Severe report reason mapping is currently lossy across report entry
    // points, so MVP weighting stays 1:1 with unique qualifying reporters.
    weightedScore: qualifying.length,
    reportIds: qualifying.map((entry) => entry.reportId),
  };
}

async function writeChatRoomModerationLog(
  ctx: MutationCtx,
  args: {
    roomId: Id<'chatRooms'>;
    targetUserId: Id<'users'>;
    action: 'auto_timeout_applied' | 'admin_review_required';
    reason: string;
    durationMs?: number;
    expiresAt?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await ctx.db.insert('chatRoomModerationLog', {
    actor: 'system',
    actorRole: 'system',
    roomId: args.roomId,
    targetUserId: args.targetUserId,
    action: args.action,
    reason: args.reason,
    durationMs: args.durationMs,
    expiresAt: args.expiresAt,
    createdAt: Date.now(),
    metadata: args.metadata,
  });
}

async function applyChatRoomReadOnlyTimeout(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>,
  targetUserId: Id<'users'>,
  durationMs: number
): Promise<{
  changed: boolean;
  action: 'inserted' | 'extended' | 'unchanged';
  expiresAt: number;
}> {
  const now = Date.now();
  const expiresAt = now + durationMs;
  const activePenalty = await getActiveChatRoomReadOnlyPenalty(ctx, roomId, targetUserId, now);

  if (activePenalty && activePenalty.expiresAt - activePenalty.kickedAt >= durationMs) {
    return { changed: false, action: 'unchanged', expiresAt: activePenalty.expiresAt };
  }

  if (activePenalty) {
    await ctx.db.patch(activePenalty._id, {
      kickedAt: now,
      expiresAt,
    });
    return { changed: true, action: 'extended', expiresAt };
  }

  await ctx.db.insert('chatRoomPenalties', {
    roomId,
    userId: targetUserId,
    type: 'readOnly',
    kickedAt: now,
    expiresAt,
  });
  return { changed: true, action: 'inserted', expiresAt };
}

function getAutoTimeoutDurationMs(weightedScore: number): number | null {
  if (weightedScore >= 5) return TIMEOUT_5_REPORTS_MS;
  if (weightedScore >= 4) return TIMEOUT_4_REPORTS_MS;
  if (weightedScore >= 3) return TIMEOUT_3_REPORTS_MS;
  if (weightedScore >= 2) return TIMEOUT_2_REPORTS_MS;
  return null;
}

async function evaluateChatRoomAutoTimeoutAfterReport(
  ctx: MutationCtx,
  roomId: Id<'chatRooms'>,
  reportedUserId: Id<'users'>,
  newReportId: Id<'chatRoomReports'>,
  reason: string
): Promise<{
  actionApplied: boolean;
  timeoutUntil?: number;
}> {
  const now = Date.now();
  const windowStart = now - AUTO_TIMEOUT_WINDOW_MS;
  const counts = await countQualifyingUniqueReporters(
    ctx,
    roomId,
    reportedUserId,
    windowStart,
    now
  );
  const durationMs = getAutoTimeoutDurationMs(counts.weightedScore);

  if (!durationMs) {
    return {
      actionApplied: false,
    };
  }

  const penaltyResult = await applyChatRoomReadOnlyTimeout(
    ctx,
    roomId,
    reportedUserId,
    durationMs
  );

  if (!penaltyResult.changed) {
    return {
      actionApplied: false,
    };
  }

  const metadata = {
    uniqueReporterCount: counts.uniqueReporterCount,
    weightedScore: counts.weightedScore,
    reportIds: counts.reportIds,
    latestReportId: newReportId,
    timeoutAction: penaltyResult.action,
    severeWeighting: 'disabled_mapping_ambiguous',
  };

  await writeChatRoomModerationLog(ctx, {
    roomId,
    targetUserId: reportedUserId,
    action: 'auto_timeout_applied',
    reason,
    durationMs,
    expiresAt: penaltyResult.expiresAt,
    metadata,
  });

  if (counts.weightedScore >= 5) {
    await writeChatRoomModerationLog(ctx, {
      roomId,
      targetUserId: reportedUserId,
      action: 'admin_review_required',
      reason,
      durationMs,
      expiresAt: penaltyResult.expiresAt,
      metadata,
    });
  }

  return {
    actionApplied: true,
    timeoutUntil: penaltyResult.expiresAt,
  };
}

function chatRoomPrivateDmPairKey(
  userId: Id<'users'>,
  peerUserId: Id<'users'>
): string {
  return [userId as string, peerUserId as string].sort().join(':');
}

// Idempotent: ensures all default rooms exist
export const ensureDefaultRooms = internalMutation({
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
// Note: Returns empty array if no rooms exist; production clients never seed rooms.
// To seed rooms: use an internal/admin workflow that invokes seedDefaultRoomsInternal.
export const listRooms = query({
  args: {
    category: v.optional(v.union(v.literal('language'), v.literal('general'))),
    authUserId: v.optional(v.string()),
    sessionToken: v.string(),
  },
  handler: async (ctx, { category, authUserId, sessionToken }) => {
    const viewerId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!viewerId) {
      return [];
    }
    const now = Date.now();
    let rooms;
    if (category) {
      rooms = await ctx.db
        .query('chatRooms')
        .withIndex('by_category', (q) => q.eq('category', category))
        .take(ROOM_LIST_QUERY_LIMIT);
    } else {
      rooms = await ctx.db
        .query('chatRooms')
        .withIndex('by_public', (q) => q.eq('isPublic', true))
        .take(ROOM_LIST_QUERY_LIMIT);
    }
    // Phase-2: Filter out expired rooms
    rooms = rooms.filter((r) => !r.expiresAt || r.expiresAt > now);
    // ISSUE-2 FIX: Filter to only PUBLIC rooms for homepage general/language lists
    // Private rooms should only appear in getMyPrivateRooms query results
    rooms = rooms.filter((r) => r.isPublic === true);

    // BACKEND COUNT ONLY: Compute live online count from chatRoomPresence table.
    // This is the ONLY source of truth for "active users" count in the rooms list.
    // P2-1: Use `by_room_heartbeat` index + range + `.take(ONLINE_CAP)` so this
    // unauthenticated endpoint is O(rooms × ONLINE_CAP) instead of
    // O(rooms × total presence rows). Any room with more than ONLINE_CAP
    // online users is reported as exactly ONLINE_CAP — a safe upper-bound
    // display for the room-list preview.
    const ONLINE_CAP = 200;
    const onlineSince = now - PRESENCE_ONLINE_THRESHOLD_MS;
    const roomsWithLiveCounts = await Promise.all(
      rooms.map(async (room) => {
        const recent = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room_heartbeat', (q) =>
            q.eq('roomId', room._id).gte('lastHeartbeatAt', onlineSince)
          )
          .take(ONLINE_CAP);
        return {
          ...sanitizeChatRoomForClient(room, {
            onlineCount: recent.length,
            includeLastMessage: true,
          }),
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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { slug, authUserId, sessionToken }) => {
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
      return sanitizeChatRoomForClient(room);
    }

    // For private rooms, require read access (authUserId required)
    try {
      await requireRoomReadAccess(ctx, room._id, { authUserId, sessionToken });
      return sanitizeChatRoomForClient(room, {
        includeLastMessage: true,
        includeCreatedBy: true,
      });
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
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const { roomId: roomIdRaw, authUserId, sessionToken } = args;

      if (
        authUserId === undefined ||
        authUserId === null ||
        typeof authUserId !== 'string' ||
        authUserId.trim().length === 0
      ) {
        return null;
      }

      if (
        roomIdRaw === undefined ||
        roomIdRaw === null ||
        typeof roomIdRaw !== 'string' ||
        roomIdRaw.trim().length === 0
      ) {
        return null;
      }

      const roomId = roomIdRaw.trim() as Id<'chatRooms'>;

      const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
      if (!userId) {
        return null;
      }

      let room: Doc<'chatRooms'> | null = null;
      try {
        room = await ctx.db.get(roomId);
      } catch {
        return null;
      }
      if (!room) {
        return null;
      }

      const now = Date.now();
      const expiresAt = room.expiresAt;
      if (typeof expiresAt === 'number' && expiresAt <= now) {
        return null;
      }

      const isPublic = room.isPublic === true;
      if (isPublic) {
        return sanitizeChatRoomForClient(room, {
          includeLastMessage: true,
          includeCreatedBy: true,
        });
      }

      const viewer = await ctx.db.get(userId);
      if (!isUserAdultForPrivateRooms(viewer)) {
        return null;
      }

      let ban = null as Doc<'chatRoomBans'> | null;
      try {
        ban = await ctx.db
          .query('chatRoomBans')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch {
        return null;
      }
      if (ban) {
        return null;
      }

      let membership = null as Doc<'chatRoomMembers'> | null;
      try {
        membership = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch {
        return null;
      }
      if (!membership) {
        return null;
      }

      return sanitizeChatRoomForClient(room, {
        includeLastMessage: true,
        includeCreatedBy: true,
        includeJoinCode: membership.role === 'owner' || membership.role === 'admin',
        role: membership.role,
        isMember: true,
      });
    } catch {
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
    sessionToken: v.string(),
    limit: v.number(),
    // P2-2: Optional stable cursor for loading older messages.
    // Pair (createdAt, _creationTime) — `_creationTime` is guaranteed
    // unique + monotonic per table so it acts as a collision-free
    // tiebreaker for rows that share a `createdAt` millisecond.
    cursor: v.optional(
      v.object({
        createdAt: v.number(),
        creationTime: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const empty = {
      messages: [] as Doc<'chatRoomMessages'>[],
      hasMore: false,
      nextCursor: null as { createdAt: number; creationTime: number } | null,
    };
    const { roomId: roomIdRaw, authUserId, sessionToken, limit, cursor } = args;

    if (!roomIdRaw || typeof roomIdRaw !== 'string') {
      return empty;
    }
    if (!authUserId || authUserId.trim().length === 0) {
      return empty;
    }

    const roomId = roomIdRaw.trim() as Id<'chatRooms'>;

    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return empty;
    }

    let room: Doc<'chatRooms'> | null = null;
    try {
      room = await ctx.db.get(roomId);
    } catch {
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
    } catch {
      return empty;
    }

    if (!room.isPublic) {
      try {
        await requirePrivateRoomAdult(ctx, userId);
      } catch {
        return empty;
      }

      let ban: Doc<'chatRoomBans'> | null = null;
      try {
        ban = await ctx.db
          .query('chatRoomBans')
          .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
          .first();
      } catch {
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
      } catch {
        return empty;
      }
      if (!membership) {
        return empty;
      }
    }

    let blockedUserIds = new Set<string>();
    let reportedUserHideAfter = new Map<string, number>();
    try {
      [blockedUserIds, reportedUserHideAfter] = await Promise.all([
        getBidirectionalBlockedUserIds(ctx, userId),
        getRoomReportedUserHideAfterMap(ctx, userId, roomId),
      ]);
    } catch {
      return empty;
    }

    let messages: Doc<'chatRoomMessages'>[] = [];
    try {
      const legacyExpiryCutoff = now - 24 * 60 * 60 * 1000;
      let q = ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created', (q) => q.eq('roomId', roomId));

      q = q.filter((qf) => {
        // Base filter: non-deleted and not past 24h retention.
        const base = qf.and(
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
        );
        // P2-2: When a cursor is supplied, only return rows strictly
        // older than (createdAt, _creationTime). `_creationTime` is a
        // unique, monotonic per-table tiebreaker — two rows with the
        // same `createdAt` cannot share it, so pages never skip or
        // duplicate across calls.
        if (cursor) {
          return qf.and(
            base,
            qf.or(
              qf.lt(qf.field('createdAt'), cursor.createdAt),
              qf.and(
                qf.eq(qf.field('createdAt'), cursor.createdAt),
                qf.lt(qf.field('_creationTime'), cursor.creationTime)
              )
            )
          );
        }
        return base;
      });

      messages = await q.order('desc').take(limit + 1);
    } catch {
      return empty;
    }

    let hasMore = false;
    let result: Doc<'chatRoomMessages'>[] = [];
    try {
      hasMore = messages.length > limit;
      result = hasMore ? messages.slice(0, limit) : messages;
      result = result.reverse();
      result = result.filter((message) => {
        const senderId = String(message.senderId);
        if (senderId === String(userId)) return true;
        if (blockedUserIds.has(senderId)) return false;

        const hideAfter = reportedUserHideAfter.get(senderId);
        if (hideAfter !== undefined && message.createdAt >= hideAfter) {
          return false;
        }
        return true;
      });
    } catch {
      return empty;
    }

    // Chat Rooms identity: attach sender chat-room profile fields only.
    // BLOCKED: do NOT use users/userPrivateProfiles for name/photo/bio.
    // P2-4: Sender profile enrichment dedupes senderIds before fetching
    // so each unique sender is looked up exactly once per page, even if
    // they posted many messages in the returned slice.
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
      const visualMessages = result.filter(
        (m) => isChatRoomVisualMediaType(m.type) && !!getChatRoomVisualStorageId(m)
      );
      const visualViewRows = await Promise.all(
        visualMessages.map((m) =>
          ctx.db
            .query('chatRoomMediaViews')
            .withIndex('by_message_viewer', (q) =>
              q.eq('messageId', m._id).eq('viewerUserId', userId!)
            )
            .first()
        )
      );
      const visualViewByMessageId = new Map(
        visualMessages.map((m, idx) => [m._id as string, visualViewRows[idx]])
      );

      // P2-2: Emit the cursor of the oldest row in the returned page so
      // callers can request the next (older) page without any shared
      // state on the server. When there are no more rows, nextCursor
      // is null.
      const oldest = hasMore ? result[0] : null;
      const nextCursor = oldest
        ? {
            createdAt: oldest.createdAt,
            creationTime: oldest._creationTime,
          }
        : null;

      return {
        messages: result.map((m) => {
          const p = profileMap.get(String(m.senderId));
          const visualView = visualViewByMessageId.get(m._id as string);
          const isVisualMedia = isChatRoomVisualMediaType(m.type);
          const safeMessage = isVisualMedia ? { ...(m as any) } : m;
          if (isVisualMedia) {
            delete (safeMessage as any).imageUrl;
            delete (safeMessage as any).imageStorageId;
            delete (safeMessage as any).videoStorageId;
          }
          return {
            ...safeMessage,
            imageUrl: isVisualMedia ? undefined : m.imageUrl,
            hasVisualMedia: isVisualMedia && !!getChatRoomVisualStorageId(m),
            visualMediaConsumed: !!visualView,
            visualMediaViewedAt: visualView?.viewedAt,
            senderNickname: p?.nickname ?? 'User',
            senderAvatarUrl: p?.avatarUrl ?? null,
            senderAvatarVersion: p?.avatarVersion ?? 0,
            // Keep senderGender from message row if present elsewhere; do not infer from profile.
          } as any;
        }),
        hasMore,
        nextCursor,
      };
    } catch {
      return empty;
    }
  },
});

// List members of a room
// P2-6: Hard cap (500) so a large room can never return an unbounded
// member list. Callers that need paginated browsing use
// `listMembersWithProfiles` (capped at 50) or the mod-oriented
// `listMembersWithPenalties` view.
const LIST_MEMBERS_HARD_CAP = 500;
export const listMembers = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });

    return await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(LIST_MEMBERS_HARD_CAP);
  },
});

// List members of a room WITH profile data (for UI display)
// Returns displayName, avatar, age, gender for each member
// PERFORMANCE: Limited to 50 members to prevent slow queries in large rooms
// PRESENCE RULES:
//   - Online: lastActive within the shared presence online threshold
//   - Offline: lastActive between online and recently-left thresholds
//   - Hidden: lastActive older than the recently-left threshold (not returned)
const ONLINE_THRESHOLD_MS = PRESENCE_ONLINE_THRESHOLD_MS;
const VISIBILITY_MAX_AGE_MS = PRESENCE_RECENTLY_LEFT_THRESHOLD_MS;
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    // SAFE-QUERY FIX: Return empty array instead of throwing to prevent UI crashes
    // Access check: auth + membership + not banned
    try {
      if (!authUserId || authUserId.trim().length === 0) {
        return [];
      }
      const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
      if (!userId) {
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    // CR-010 FIX: Check if user is banned from this room BEFORE allowing join
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      throw new Error('Access denied: you are banned from this room');
    }

    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (existing) return existing._id;

    if (!room.isPublic) {
      await requireChatRoomTermsAccepted(ctx, userId);
      await requirePrivateRoomAdult(ctx, userId);
      throw new Error('Use password or invite flow to join this private room.');
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
    await patchMemberCountIfExact(ctx, roomId);

    return memberId;
  },
});

// Leave a room session.
// Public rooms remove membership; private rooms exit presence only and keep membership for re-entry.
// CR-011 FIX: Auth hardening - verify caller can only leave for themselves
export const leaveRoom = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(), // CR-011: Auth verification required
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    // Check room type for different leave behaviors
    const room = await ctx.db.get(roomId);
    if (!room) {
      return;
    }

    const isPrivate = !room.isPublic;

    // PRESENCE HARD-DELETE: Always remove presence row immediately on leave,
    // for BOTH public and private rooms.
    const presenceRows = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .take(10);
    for (const row of presenceRows) {
      await ctx.db.delete(row._id);
    }

    if (isPrivate) {
      // Private "leave" exits presence only; membership remains for password-less re-entry.
      return;
    }

    // PUBLIC ROOMS: Delete membership (user can freely rejoin public rooms)
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .take(10);

    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }

    // CONSISTENCY FIX B6: Always recompute memberCount from source of truth
    await patchMemberCountIfExact(ctx, roomId);
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
    sessionToken: v.string(),
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
      sessionToken,
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
    // 0. SECURITY: Require send access (auth + membership + not banned + no send-blocking penalty)
    let userId: Id<'users'>;
    let room: any;
    let membership: any;
    try {
      const access = await requireRoomSendAccess(ctx, roomId, { authUserId, sessionToken });
      userId = access.userId;
      room = access.room;
      membership = access.membership;
    } catch (err: any) {
      throw err;
    }

    // SEND-FIX: Use resolved userId as senderId (removed mismatch check)
    // The authenticated user IS the sender - no need for separate senderId param
    const senderId = userId;
    await requireChatRoomTermsAccepted(ctx, senderId);

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

    // Room safety: block scam/contact/unsafe content and repeated copy-paste
    // before persistence. This lives in the mutation so direct clients cannot
    // bypass it.
    const contentPolicyText = [
      text ?? '',
      ...(mentions ?? []).map((mention) => mention.nickname),
    ].join(' ');
    const contentPolicy = validateChatRoomMessageContent({
      text: contentPolicyText,
      context: 'room',
      recentMessages,
      mentions,
      allowMentions: true,
    });
    if (contentPolicy.ok === false) {
      throw new ConvexError({
        code: contentPolicy.code,
        category: contentPolicy.category,
        message: formatChatRoomContentPolicyError(contentPolicy),
      });
    }

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
      // P1: also reject replies to messages whose retention window has elapsed,
      // so new replies can't be anchored to rows the cleanup cron is about to
      // remove. Pre-retention rows (no expiresAt) remain reply-able until the
      // legacy sweep catches them.
      if (
        !replyMsg ||
        replyMsg.roomId !== roomId ||
        replyMsg.deletedAt ||
        (typeof replyMsg.expiresAt === 'number' && replyMsg.expiresAt <= now)
      ) {
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

    // Wallet rewards are ledger-backed and based on genuine engagement.
    // Random public room messages no longer earn coins.
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

    return messageId;
  },
});

export const openChatRoomVisualMedia = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, messageId, authUserId, sessionToken }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });

    const message = await ctx.db.get(messageId);
    if (!message || message.roomId !== roomId || !isChatRoomVisualMediaType(message.type)) {
      return { status: 'no_media' as const };
    }

    const now = Date.now();
    if (
      message.deletedAt ||
      (typeof message.expiresAt === 'number' && message.expiresAt <= now)
    ) {
      return { status: 'no_media' as const };
    }
    if (String(message.senderId) !== String(userId)) {
      if (await isBlockedBidirectional(ctx, userId, message.senderId)) {
        return { status: 'no_media' as const };
      }

      const reportHideAfter = await getRoomReportedUserHideAfterMap(ctx, userId, roomId);
      const hideAfter = reportHideAfter.get(String(message.senderId));
      if (hideAfter !== undefined && message.createdAt >= hideAfter) {
        return { status: 'no_media' as const };
      }
    }

    const existingView = await ctx.db
      .query('chatRoomMediaViews')
      .withIndex('by_message_viewer', (q) =>
        q.eq('messageId', messageId).eq('viewerUserId', userId)
      )
      .first();
    if (existingView) {
      return { status: 'already_viewed' as const };
    }

    const storageId = getChatRoomVisualStorageId(message);
    if (!storageId) {
      return { status: 'no_media' as const };
    }

    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      return { status: 'no_media' as const };
    }

    const viewedAt = Date.now();
    await ctx.db.insert('chatRoomMediaViews', {
      messageId,
      viewerUserId: userId,
      viewedAt,
    });

    return {
      status: 'ok' as const,
      url,
      mediaType: message.type,
      viewedAt,
    };
  },
});

// Delete a message (soft-delete via deletedAt timestamp)
// ROLE SYSTEM: Private rooms use owner/admin hierarchy; public rooms allow platform admins
export const deleteMessage = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, messageId, authUserId, sessionToken }) => {
    // 1. Verify auth
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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

    // Track whether this call is actually transitioning the message from
    // visible → deleted. If the row was already soft-deleted we must NOT
    // decrement again or touch `lastMessageAt` — idempotent re-calls happen
    // e.g. on client retry.
    const wasAlreadyDeleted = Boolean(message.deletedAt);

    // 10. Soft-delete by setting deletedAt timestamp
    const deletedAt = Date.now();
    await ctx.db.patch(messageId, { deletedAt });

    if (!wasAlreadyDeleted) {
      // P2-22: Keep `room.messageCount` in sync with visible messages so the
      // trim-on-send threshold and other size-aware logic don't operate on
      // inflated counts. Decrement with a floor at zero.
      const currentCount = typeof room.messageCount === 'number'
        ? room.messageCount
        : 0;
      const nextCount = Math.max(0, currentCount - 1);
      await ctx.db.patch(roomId, { messageCount: nextCount });

      // P2-23: If the deleted message was the newest visible message in the
      // room, the room preview (`lastMessageAt`/`lastMessageText`) is now
      // stale. Recompute from the newest surviving non-deleted message; if
      // none remain, clear the preview fields safely.
      if (
        typeof room.lastMessageAt === 'number' &&
        room.lastMessageAt === message.createdAt
      ) {
        const surviving = await ctx.db
          .query('chatRoomMessages')
          .withIndex('by_room_created', (q) => q.eq('roomId', roomId))
          .order('desc')
          .take(20);
        const newest = surviving.find(
          (m) => m._id !== messageId && !m.deletedAt
        );
        if (newest) {
          const newestPreview =
            newest.text ??
            (newest.audioStorageId || newest.audioUrl
              ? '[Audio]'
              : newest.imageStorageId || newest.imageUrl
              ? '[Image]'
              : newest.videoStorageId
              ? '[Video]'
              : '');
          await ctx.db.patch(roomId, {
            lastMessageAt: newest.createdAt,
            lastMessageText: newestPreview,
          });
        } else {
          // No surviving visible messages; clear preview fields.
          await ctx.db.patch(roomId, {
            lastMessageAt: undefined,
            lastMessageText: undefined,
          });
        }
      }
    }

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
    sessionToken: v.string(),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, { name, password, authUserId, sessionToken, isDemo, demoUserId }) => {
    // 1. Auth guard - session token is the source of truth for room ownership.
    const sessionAuth = { authUserId, sessionToken };
    const createdBy = await requireAuthenticatedUser(ctx, sessionAuth);

    const creator = await ctx.db.get(createdBy);
    if (!creator) {
      throw new Error('User not found');
    }

    if (isDemo === true && demoUserId) {
      const demoResolved = await resolveUserIdByAuthId(ctx, demoUserId);
      if (demoResolved !== createdBy) {
        throw new Error('Unauthorized: demo session mismatch');
      }
    }

    // Check if demo user (for coin bypass)
    const isDemoUser = isDemo === true && creator.isDemo === true;
    if (!isDemoUser) {
      await requireChatRoomTermsAccepted(ctx, createdBy);
      await requirePrivateRoomAdult(ctx, createdBy);
    }

    // 2. Check wallet balance (skip for demo users)
    let currentCoins = 0;
    if (!isDemoUser) {
      currentCoins = creator.walletCoins ?? 0;
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
      discoverable: true,
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
    sessionToken: v.string(),
    roomId: v.optional(v.id('chatRooms')),
  },
  handler: async (ctx, { joinCode, authUserId, sessionToken, roomId }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
    const now = Date.now();
    await enforceJoinCodeLookupThrottle(ctx, userId, now);

    // 2. Normalize code to uppercase
    const normalizedCode = normalizeJoinCode(joinCode);

    // 3. Find room by join code
    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_join_code', (q) => q.eq('joinCode', normalizedCode))
      .first();

    if (!room) {
      throw new Error(JOIN_CODE_GENERIC_ERROR);
    }
    if (roomId && room._id !== roomId) {
      throw new Error(JOIN_CODE_GENERIC_ERROR);
    }
    if (!room.isPublic) {
      await requireChatRoomTermsAccepted(ctx, userId);
      await requirePrivateRoomAdult(ctx, userId);
    }

    // 4. Check if room is expired
    if (room.expiresAt && room.expiresAt <= now) {
      throw new Error(JOIN_CODE_GENERIC_ERROR);
    }

    // 5. P1: Reject banned users BEFORE (re)creating membership. joinRoom and
    // requestJoinPrivateRoom already check chatRoomBans; joinRoomByCode did
    // not, which let banned users rejoin by obtaining the 6-char code.
    const existingBan = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
      .first();
    if (existingBan) {
      throw new Error('You are banned from this room.');
    }

    // 6. Check if already a member
    const existing = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
      .first();
    if (existing) {
      return { roomId: room._id, alreadyMember: true };
    }

    // 7. Join as member
    await ctx.db.insert('chatRoomMembers', {
      roomId: room._id,
      userId,
      joinedAt: now,
      role: 'member',
    });

    // M-003 FIX: Recompute memberCount from source of truth (consistent with joinRoom)
    await patchMemberCountIfExact(ctx, room._id);

    return { roomId: room._id, alreadyMember: false };
  },
});

// Phase-2: Get room by join code (for preview before joining)
export const getRoomByJoinCode = mutation({
  args: {
    joinCode: v.string(),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { joinCode, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
    const now = Date.now();
    await enforceJoinCodeLookupThrottle(ctx, userId, now);

    const normalizedCode = normalizeJoinCode(joinCode);
    if (!/^[A-Z2-9]{6}$/.test(normalizedCode)) {
      return null;
    }

    const room = await ctx.db
      .query('chatRooms')
      .withIndex('by_join_code', (q) => q.eq('joinCode', normalizedCode))
      .first();

    if (!room) return null;

    // Check if expired
    if (room.expiresAt && room.expiresAt <= now) {
      return null;
    }

    return {
      _id: room._id,
      name: room.name,
      memberCount: room.memberCount,
      expiresAt: room.expiresAt,
      hasPassword: hasChatRoomPassword(room),
    };
  },
});

// Phase-2: Get private rooms where current user is owner or member
// Supports demo mode via optional isDemo/demoUserId args
export const getMyPrivateRooms = query({
  args: {
    authUserId: v.optional(v.string()), // Real mode: user's auth ID
    sessionToken: v.optional(v.string()),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedUserOrNull(ctx, {
      authUserId: args.authUserId ?? args.demoUserId,
      sessionToken: args.sessionToken,
    });
    if (!userId) {
      return [];
    }

    const now = Date.now();

    // LEAVE-VS-END FIX: Private rooms should appear if user is:
    // 1. A current member, OR
    // 2. The creator (even if they left their own room)
    // This ensures "Leave Room" doesn't make created rooms disappear.

    // Get all memberships for this user
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(PRIVATE_ROOM_LIST_QUERY_LIMIT);

    const memberRoomIds = new Set(memberships.map((m) => m.roomId.toString()));

    // Also get rooms created by this user (even if no membership)
    const createdRooms = await ctx.db
      .query('chatRooms')
      .withIndex('by_creator', (q) => q.eq('createdBy', userId))
      .take(PRIVATE_ROOM_LIST_QUERY_LIMIT);

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
        // P2-1 adjacent: Use the (roomId, lastHeartbeatAt) range index so
        // we read only currently-online rows instead of collecting every
        // presence row the room has ever seen and filtering in memory.
        const onlineThreshold = now - PRESENCE_ONLINE_THRESHOLD_MS;
        const presenceRecords = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room_heartbeat', (q) =>
            q.eq('roomId', room._id).gte('lastHeartbeatAt', onlineThreshold)
          )
          .take(200);
        const onlineCount = presenceRecords.length;

        // Determine if current user is a member
        const isMember = memberRoomIds.has(room._id.toString());
        const role = membership?.role ?? (room.createdBy === userId ? 'owner' : 'member');

        return {
          ...sanitizeChatRoomForClient(room, {
            onlineCount,
            includeLastMessage: true,
            includeCreatedBy: true,
            includeJoinCode: role === 'owner' || role === 'admin',
            role,
            isMember,
          }),
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

// Phase-2: Discover unexpired private rooms the caller can newly join.
// Kept separate from getMyPrivateRooms so owned/joined private room behavior
// remains unchanged.
export const getDiscoverablePrivateRooms = query({
  args: {
    authUserId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, sessionToken }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return [];
    }

    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return [];
    }

    const now = Date.now();
    const onlineThreshold = now - PRESENCE_ONLINE_THRESHOLD_MS;

    const privateRooms = await ctx.db
      .query('chatRooms')
      .withIndex('by_public', (q) => q.eq('isPublic', false))
      .take(PRIVATE_ROOM_LIST_QUERY_LIMIT);

    const discoverableRooms = await Promise.all(
      privateRooms.map(async (room) => {
        if (room.expiresAt && room.expiresAt <= now) return null;
        if (room.discoverable !== true) return null;
        if (!room.createdBy || room.createdBy === userId) return null;

        const membership = await ctx.db
          .query('chatRoomMembers')
          .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
          .first();
        if (membership) return null;

        const ban = await ctx.db
          .query('chatRoomBans')
          .withIndex('by_room_user', (q) => q.eq('roomId', room._id).eq('userId', userId))
          .first();
        if (ban) return null;

        const creator = await ctx.db.get(room.createdBy);
        if (!creator || !creator.isActive || creator.isBanned) return null;
        if (await isBlockedBidirectional(ctx, userId, room.createdBy)) return null;

        const presenceRecords = await ctx.db
          .query('chatRoomPresence')
          .withIndex('by_room_heartbeat', (q) =>
            q.eq('roomId', room._id).gte('lastHeartbeatAt', onlineThreshold)
          )
          .take(200);

        return sanitizeChatRoomForClient(room, {
          onlineCount: presenceRecords.length,
          includeCreatedBy: true,
          isMember: false,
        });
      })
    );

    const rooms = discoverableRooms
      .filter((room): room is NonNullable<typeof room> => room !== null)
      .sort((a, b) => {
        const aTime = a.lastMessageAt ?? 0;
        const bTime = b.lastMessageAt ?? 0;
        if (bTime !== aTime) return bTime - aTime;
        return a.name.localeCompare(b.name);
      });

    return rooms;
  },
});

// Report a message in a chat room
// CR-012 FIX: Auth hardening - derive reporterId from auth, don't trust client
export const reportMessage = mutation({
  args: {
    messageId: v.id('chatRoomMessages'),
    authUserId: v.string(), // CR-012: Auth verification required
    sessionToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { messageId, authUserId, sessionToken, reason }) => {
    // CR-012 FIX: Derive reporterId from authenticated user
    const reporterId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    // Prevent self-reports
    if (reporterId === message.senderId) {
      throw new Error('Cannot report your own message');
    }

    const now = Date.now();
    const roomId = message.roomId;
    await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });
    const existingRecentReport = await findRecentRoomUserReport(
      ctx,
      reporterId,
      message.senderId,
      roomId,
      now
    );
    if (existingRecentReport) {
      return {
        success: true,
        duplicate: true,
        message: 'You already reported this user recently.',
      };
    }

    const reportId = await ctx.db.insert('chatRoomReports', {
      reporterId,
      reportedUserId: message.senderId,
      reason: 'harassment', // Map to existing enum
      description: `Chat room message report: ${reason}`,
      status: 'pending',
      createdAt: now,
      roomId,
      messageId: String(messageId),
      reportType: 'content',
    });

    const autoTimeout = await evaluateChatRoomAutoTimeoutAfterReport(
      ctx,
      roomId,
      message.senderId,
      reportId,
      reason
    );

    if (autoTimeout.actionApplied) {
      return {
        success: true,
        duplicate: false,
        actionApplied: true,
        timeoutUntil: autoTimeout.timeoutUntil,
      };
    }
    return { success: true, duplicate: false, actionApplied: false };
  },
});

// Get rooms where authenticated user is a member
// Phase-2: Filters out expired rooms
// SECURITY: Only returns caller's own room memberships (no arbitrary userId lookup)
export const getRoomsForUser = query({
  args: {
    authUserId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, sessionToken }) => {
    // SECURITY: Require authenticated user - only return caller's own rooms
    // Return empty array if not authenticated (graceful degradation)
    if (!authUserId || authUserId.trim().length === 0) {
      return [];
    }
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return [];
    }
    const now = Date.now();

    // Get all memberships for authenticated user
    const memberships = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(PRIVATE_ROOM_LIST_QUERY_LIMIT);

    // Fetch room details for each membership
    const rooms = await Promise.all(
      memberships.map(async (membership) => {
        const room = await ctx.db.get(membership.roomId);
        if (!room) return null;
        // Phase-2: Filter out expired rooms
        if (room.expiresAt && room.expiresAt <= now) return null;
        return {
          ...sanitizeChatRoomForClient(room, {
            includeLastMessage: true,
            includeCreatedBy: true,
            includeJoinCode: membership.role === 'owner' || membership.role === 'admin',
            role: membership.role,
            isMember: true,
          }),
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    // SECURITY: Require authenticated user (but NOT full read access,
    // since penalized users should still be able to check their penalty status)
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    // Check room exists and is not expired
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      throw new Error('Room has expired');
    }

    const now = Date.now();
    const penalty = await getActiveChatRoomReadOnlyPenalty(ctx, roomId, userId, now);

    if (!penalty) return null;

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
      .take(50);

    return penalties.some((p) => p.expiresAt > now);
  },
});

// List members with penalty status
export const listMembersWithPenalties = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    // SECURITY: Require read access (auth + membership + not banned)
    await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });

    const now = Date.now();
    const members = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(ROOM_MEMBER_LIST_LIMIT);

    // Get all penalties for this room using by_room index
    const penalties = await ctx.db
      .query('chatRoomPenalties')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .take(ROOM_MEMBER_LIST_LIMIT);

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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    authUserId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUser(ctx, {
      authUserId: args.authUserId ?? args.demoUserId,
      sessionToken: args.sessionToken,
    });

    // P2-10: Use the `by_creator` index to fetch only this user's rooms
    // instead of scanning every chat room in the database and filtering
    // in memory. Private-ness is still checked by the `joinCode` field.
    const myRooms = await ctx.db
      .query('chatRooms')
      .withIndex('by_creator', (q) => q.eq('createdBy', userId))
      .take(PRIVATE_ROOM_LIST_QUERY_LIMIT);
    const myPrivateRooms = myRooms.filter((room) => !!room.joinCode);

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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
    const canModerateResult = isPlatformRoom
      ? isPlatformAdmin
      : canModerate(role);

    return { role, canModerate: canModerateResult };
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
    // P2-12: Loop batches under a soft time budget and self-reschedule if
    // the queue still has work. `deleteRoomFully` itself does a bounded
    // cascade (see P2-3), so we keep BATCH small to stay well under the
    // per-mutation Convex limits.
    const startedAt = Date.now();
    const BATCH = 20;
    const TIME_BUDGET_MS = 20_000;

    let deletedCount = 0;
    let hitTimeBudget = false;

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    while (true) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const now = Date.now();
      const expiredRooms = await ctx.db
        .query('chatRooms')
        .withIndex('by_expires')
        .filter((q) =>
          q.and(
            q.neq(q.field('expiresAt'), undefined),
            q.lte(q.field('expiresAt'), now)
          )
        )
        .take(BATCH);
      if (expiredRooms.length === 0) break;
      for (const room of expiredRooms) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        await deleteRoomFully(ctx, room._id);
        deletedCount++;
      }
      if (hitTimeBudget) break;
      if (expiredRooms.length < BATCH) break;
    }

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupExpiredRooms,
        {}
      );
    }

    return { deletedCount };
  },
});

// Internal: Cleanup expired chat room messages (called by cron job)
// Deletes only expired message rows in bounded batches.
//
// P2-11: This handler now loops batches of `BATCH` rows at a time under a
// soft time budget. A single cron run keeps draining expired + legacy
// rows until either (a) both queries return empty, or (b) the time budget
// is exhausted. If the budget runs out with work remaining, the handler
// self-schedules a follow-up run immediately so cleanup catches up on a
// backlog instead of falling behind one BATCH every 5 minutes.
export const cleanupExpiredChatRoomMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const BATCH = 200;
    const TIME_BUDGET_MS = 20_000;
    const LEGACY_CUTOFF_MS = 24 * 60 * 60 * 1000;

    const deletedByRoom = new Map<string, number>();
    let deletedCount = 0;
    let hitTimeBudget = false;

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

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    // Drain expired messages first, then fall through to the legacy sweep.
    // Each iteration re-queries so rows deleted above don't reappear.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const now = Date.now();
      const expiredBatch = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_expires', (q) => q.lte('expiresAt', now))
        .take(BATCH);
      if (expiredBatch.length === 0) {
        break;
      }
      for (const message of expiredBatch) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        await processMessage(message);
      }
      if (hitTimeBudget) {
        break;
      }
      if (expiredBatch.length < BATCH) {
        // No more expired rows (partial batch); fall through to legacy.
        break;
      }
    }

    // P0-3: Bounded legacy sweep.
    // Messages inserted before the retention fix have no `expiresAt` field, so
    // they will never match the `by_expires` range above. Here we pick up any
    // legacy rows older than 24h and apply the exact same full-cleanup path
    // (relations + storage + row delete + messageCount repair).
    // eslint-disable-next-line no-constant-condition
    while (!hitTimeBudget) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const legacyCutoff = Date.now() - LEGACY_CUTOFF_MS;
      const legacyBatch = await ctx.db
        .query('chatRoomMessages')
        .withIndex('by_room_created')
        .filter((q) =>
          q.and(
            q.eq(q.field('expiresAt'), undefined),
            q.lte(q.field('createdAt'), legacyCutoff)
          )
        )
        .take(BATCH);
      if (legacyBatch.length === 0) {
        break;
      }
      for (const message of legacyBatch) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        await processMessage(message);
      }
      if (hitTimeBudget) {
        break;
      }
      if (legacyBatch.length < BATCH) {
        break;
      }
    }

    // P1 / P2-24: Recompute messageCount from source of truth per
    // affected room. The previous `messageCount - roomDeletedCount`
    // subtraction drifted any time a prior run (or a manual delete
    // path) failed to update the counter in lock-step, since the base
    // value is already potentially stale. A recount over the surviving
    // rows keeps the counter converged.
    //
    // P2-24: Skip the recount when we hit the time budget — we're
    // going to self-reschedule anyway, and doing the recount now would
    // re-collect every surviving row in every affected room just to
    // have the follow-up run redo the same work after it finishes
    // draining the backlog. Running the recount only on the final
    // (fully drained) pass removes that redundant full-table scan per
    // room per tick without changing convergence guarantees.
    if (!hitTimeBudget) {
      for (const roomId of deletedByRoom.keys()) {
        const typedRoomId = roomId as Id<'chatRooms'>;
        const room = await ctx.db.get(typedRoomId);
        if (!room) {
          continue;
        }

        if (typeof room.messageCount !== 'number') {
          continue;
        }

        const survivingMessages = await ctx.db
          .query('chatRoomMessages')
          .withIndex('by_room_created', (q) => q.eq('roomId', typedRoomId))
          .take(MAX_MESSAGES_PER_ROOM + 1);
        const actualCount = survivingMessages.filter((m) => !m.deletedAt).length;

        if (actualCount !== room.messageCount) {
          await ctx.db.patch(typedRoomId, { messageCount: actualCount });
        }
      }
    }

    // P2-11: If the time budget was exhausted before we drained the queue,
    // self-schedule an immediate follow-up run so a backlog does not fall
    // behind one BATCH per cron tick. The cron itself still runs every 5m
    // as a safety net.
    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupExpiredChatRoomMessages,
        {}
      );
    }

    return { deletedCount };
  },
});

// Internal: Cleanup expired penalties (called by cron job)
export const cleanupExpiredPenalties = internalMutation({
  args: {},
  handler: async (ctx) => {
    // P2-13: Loop bounded batches under a soft time budget and
    // self-reschedule if work remains.
    const startedAt = Date.now();
    const BATCH = 200;
    const TIME_BUDGET_MS = 20_000;

    let deletedCount = 0;
    let hitTimeBudget = false;

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    while (true) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const now = Date.now();
      const expiredPenalties = await ctx.db
        .query('chatRoomPenalties')
        .withIndex('by_expires')
        .filter((q) => q.lte(q.field('expiresAt'), now))
        .take(BATCH);
      if (expiredPenalties.length === 0) break;
      for (const penalty of expiredPenalties) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        try {
          await ctx.db.delete(penalty._id);
          deletedCount++;
        } catch {
          // Already gone — ignore.
        }
      }
      if (hitTimeBudget) break;
      if (expiredPenalties.length < BATCH) break;
    }

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupExpiredPenalties,
        {}
      );
    }

    return { deletedCount };
  },
});

// P2-14: Internal — Cleanup stale chatRoomPresence rows.
// Clients send presence heartbeats every ~30s with a short online window.
// Rows whose last heartbeat is older than the stale cutoff represent
// abandoned sessions (tab close, network drop, app kill) and are pure
// storage bloat that also skews any future presence queries. We batch-delete
// under a soft time budget and self-schedule if a backlog remains.
export const cleanupStalePresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const BATCH = 500;
    const TIME_BUDGET_MS = 20_000;
    const cutoff = startedAt - PRESENCE_STALE_CLEANUP_MS;

    let deletedCount = 0;
    let hitTimeBudget = false;

    while (true) {
      if (Date.now() - startedAt >= TIME_BUDGET_MS) {
        hitTimeBudget = true;
        break;
      }
      const stale = await ctx.db
        .query('chatRoomPresence')
        .withIndex('by_heartbeat', (q) => q.lt('lastHeartbeatAt', cutoff))
        .take(BATCH);
      if (stale.length === 0) break;
      for (const row of stale) {
        if (Date.now() - startedAt >= TIME_BUDGET_MS) {
          hitTimeBudget = true;
          break;
        }
        try {
          await ctx.db.delete(row._id);
          deletedCount++;
        } catch {
          // Already gone — ignore.
        }
      }
      if (hitTimeBudget) break;
      if (stale.length < BATCH) break;
    }

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupStalePresence,
        {}
      );
    }

    return { deletedCount };
  },
});

// P2-15: Internal — Cleanup orphan chatRoomMediaUploads ownership rows.
// Normal flow: upload creates an ownership row → sendMessage attaches it to
// a chatRoomMessage → message expires at 24h → expiry cleanup calls
// `deleteChatRoomMessageStorage` which best-effort deletes the blob AND the
// ownership row. If that cascade ever fails (or sendMessage never completes
// after upload), the ownership row + blob can linger forever. We enforce a
// safety TTL: rows older than MESSAGE_RETENTION + GRACE are guaranteed to be
// orphans (no live message can still reference them under the 24h retention
// policy), so we best-effort delete the blob and then the ownership row.
export const cleanupOrphanChatRoomMediaUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const BATCH = 100;
    const TIME_BUDGET_MS = 20_000;
    // 24h retention + 24h grace so a just-expired message's cleanup has time
    // to complete before we assume it's truly orphaned.
    const ORPHAN_CUTOFF_MS = 48 * 60 * 60 * 1000;
    const cutoff = startedAt - ORPHAN_CUTOFF_MS;

    let deletedCount = 0;
    let hitTimeBudget = false;

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    while (true) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      // Oldest rows first. Since every old row in scope gets deleted
      // unconditionally (past cutoff ⇒ orphan), no "kept" rows accumulate
      // at the head across iterations.
      const rows = await ctx.db
        .query('chatRoomMediaUploads')
        .order('asc')
        .take(BATCH);
      if (rows.length === 0) break;
      if (rows[0].createdAt >= cutoff) break;
      for (const row of rows) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        if (row.createdAt >= cutoff) {
          // Remainder of batch is within retention grace; stop inner loop.
          break;
        }
        try {
          await ctx.storage.delete(row.storageId);
        } catch {
          // Best-effort: blob may already be gone.
        }
        try {
          await ctx.db.delete(row._id);
          deletedCount++;
        } catch {
          // Already gone — ignore.
        }
      }
      if (hitTimeBudget) break;
      if (rows.length < BATCH) break;
    }

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupOrphanChatRoomMediaUploads,
        {}
      );
    }

    return { deletedCount };
  },
});

// P2-25: Internal — Orphan sweeper for chatRoomMessageReactions and
// chatRoomMentionNotifications. `cleanupChatRoomMessageRelations` already
// cascades these when a message is deleted, but that path is best-effort.
// This sweeper runs at a low cadence (daily) as a safety net.
//
// Strategy: rows whose `_creationTime` is older than MESSAGE_RETENTION +
// GRACE are guaranteed to have had their parent message deleted under the
// 24h retention policy. So any surviving row past that cutoff is orphan —
// delete unconditionally. This lets us drain the old portion of each table
// without needing a secondary time-based index.
export const cleanupOrphanReactionsAndMentions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const BATCH = 200;
    const TIME_BUDGET_MS = 20_000;
    const ORPHAN_CUTOFF_MS = 48 * 60 * 60 * 1000;
    const cutoff = startedAt - ORPHAN_CUTOFF_MS;

    let deletedReactions = 0;
    let deletedMentions = 0;
    let hitTimeBudget = false;

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    // Drain orphan reactions.
    while (true) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const rows = await ctx.db
        .query('chatRoomMessageReactions')
        .order('asc')
        .take(BATCH);
      if (rows.length === 0) break;
      if (rows[0]._creationTime >= cutoff) break;
      for (const row of rows) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        if (row._creationTime >= cutoff) break;
        try {
          await ctx.db.delete(row._id);
          deletedReactions++;
        } catch {
          // Already gone — ignore.
        }
      }
      if (hitTimeBudget) break;
      if (rows.length < BATCH) break;
    }

    // Drain orphan mentions.
    while (!hitTimeBudget) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const rows = await ctx.db
        .query('chatRoomMentionNotifications')
        .order('asc')
        .take(BATCH);
      if (rows.length === 0) break;
      if (rows[0]._creationTime >= cutoff) break;
      for (const row of rows) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        if (row._creationTime >= cutoff) break;
        try {
          await ctx.db.delete(row._id);
          deletedMentions++;
        } catch {
          // Already gone — ignore.
        }
      }
      if (hitTimeBudget) break;
      if (rows.length < BATCH) break;
    }

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupOrphanReactionsAndMentions,
        {}
      );
    }

    return { deletedReactions, deletedMentions };
  },
});

// P2-16: Internal — TTL sweep for chatRoomJoinRequests.
// Removes resolved (approved/rejected) rows older than RESOLVED_TTL_MS and
// very old still-pending rows older than PENDING_TTL_MS so the table does
// not accumulate forever. Uses the `by_status` index so rows are iterated
// in _creationTime order within each status, letting us early-exit the
// batch as soon as we see a row that is still within TTL.
export const cleanupStaleJoinRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const BATCH = 200;
    const TIME_BUDGET_MS = 20_000;
    const RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const PENDING_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

    const resolvedCutoff = startedAt - RESOLVED_TTL_MS;
    const pendingCutoff = startedAt - PENDING_TTL_MS;

    let deletedCount = 0;
    let hitTimeBudget = false;

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    const drainStatus = async (
      status: 'approved' | 'rejected' | 'pending',
      cutoffMs: number
    ): Promise<void> => {
      while (!hitTimeBudget) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          return;
        }
        const rows = await ctx.db
          .query('chatRoomJoinRequests')
          .withIndex('by_status', (q) => q.eq('status', status))
          .order('asc')
          .take(BATCH);
        if (rows.length === 0) return;
        // Rows are sorted by _creationTime within the status equality. Use
        // the row's updatedAt/createdAt as the "age" anchor so resolved
        // requests whose status was flipped recently aren't swept too early.
        const ageOf = (r: (typeof rows)[number]): number =>
          r.updatedAt ?? r.createdAt;
        if (ageOf(rows[0]) >= cutoffMs) return;
        let deletedAny = false;
        for (const row of rows) {
          if (budgetExhausted()) {
            hitTimeBudget = true;
            return;
          }
          if (ageOf(row) >= cutoffMs) {
            // We've reached young rows; stop inner loop. Note: since we
            // sort by _creationTime (not updatedAt), a resolved row whose
            // updatedAt is recent could appear before older-resolved rows.
            // Skip such rows instead of breaking so we don't get stuck.
            continue;
          }
          try {
            await ctx.db.delete(row._id);
            deletedCount++;
            deletedAny = true;
          } catch {
            // Already gone — ignore.
          }
        }
        if (!deletedAny) {
          // Every row in this batch was kept (all within TTL window). To
          // avoid infinite looping on a head of "young-looking" rows, stop.
          return;
        }
        if (rows.length < BATCH) return;
      }
    };

    await drainStatus('approved', resolvedCutoff);
    if (!hitTimeBudget) await drainStatus('rejected', resolvedCutoff);
    if (!hitTimeBudget) await drainStatus('pending', pendingCutoff);

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupStaleJoinRequests,
        {}
      );
    }

    return { deletedCount };
  },
});

// P2-17: Internal — TTL sweep for chatRoomPasswordAttempts.
// Failed-attempt rows (including blocked) persist until an admin clears
// them. This sweeper ages them out after STALE_TTL_MS so the table does
// not accumulate forever. Uses the new `by_last_attempt` index for a
// bounded range query.
export const cleanupStalePasswordAttempts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const BATCH = 200;
    const TIME_BUDGET_MS = 20_000;
    // 7-day TTL — long enough that legitimately-blocked users have cycled
    // through normal attempt patterns, but short enough to bound growth.
    const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = startedAt - STALE_TTL_MS;

    let deletedCount = 0;
    let hitTimeBudget = false;

    const budgetExhausted = (): boolean =>
      Date.now() - startedAt >= TIME_BUDGET_MS;

    while (true) {
      if (budgetExhausted()) {
        hitTimeBudget = true;
        break;
      }
      const rows = await ctx.db
        .query('chatRoomPasswordAttempts')
        .withIndex('by_last_attempt', (q) => q.lt('lastAttemptAt', cutoff))
        .take(BATCH);
      if (rows.length === 0) break;
      for (const row of rows) {
        if (budgetExhausted()) {
          hitTimeBudget = true;
          break;
        }
        try {
          await ctx.db.delete(row._id);
          deletedCount++;
        } catch {
          // Already gone — ignore.
        }
      }
      if (hitTimeBudget) break;
      if (rows.length < BATCH) break;
    }

    if (hitTimeBudget) {
      await ctx.scheduler.runAfter(
        0,
        internal.chatRooms.cleanupStalePasswordAttempts,
        {}
      );
    }

    return { deletedCount };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2: Private Rooms - Password-only runtime
// ═══════════════════════════════════════════════════════════════════════════

// Private room access remains gated here. Discovery is handled separately by
// getDiscoverablePrivateRooms, which returns card-safe fields only.
// The join-request approval helpers below are retained as internal future
// scaffolding only; the shipping frontend uses joinRoomWithPassword directly.

// Check user's access status for a private room
export const checkRoomAccess = query({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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

    const now = Date.now();
    // Check if expired
    if (room.expiresAt && room.expiresAt <= now) {
      return { status: 'expired' as const };
    }

    const user = await ctx.db.get(userId);
    if (!isUserAdultForPrivateRooms(user)) {
      return { status: 'age_restricted' as const };
    }

    // Check if banned/kicked
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

    // PRIVATE-ROOM-ACCESS-FIX: Return 'none' with room info for password modal decision
    // Also check if user is the room creator (owner bypass)
    const isCreator = room.createdBy === userId;
    const hasPassword = !!room.passwordHash || !!room.passwordEncrypted;

    // Owner bypass: creator always gets access (will auto-join on room load)
    if (isCreator) {
      return { status: 'owner_bypass' as const, role: 'owner' as const, isCreator: true };
    }

    // First-time entrant: needs password if room has one
    if (hasPassword) {
      return { status: 'none' as const, hasPassword: true };
    }

    // No password required - can join freely
    return { status: 'none' as const, hasPassword: false };
  },
});

// Future-only approval request helper (not part of the public password-only runtime).
export const requestJoinPrivateRoom = internalMutation({
  args: {
    roomId: v.id('chatRooms'),
    password: v.string(),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, password, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    // 2. Get room
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // 3. Check if public room (no password needed)
    if (room.isPublic) {
      throw new Error('This is a public room. No password required.');
    }
    await requireChatRoomTermsAccepted(ctx, userId);
    await requirePrivateRoomAdult(ctx, userId);

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
        await patchMemberCountIfExact(ctx, roomId);
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

// Future-only approval request helper (not part of the public password-only runtime).
export const listJoinRequests = internalQuery({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
      .take(100);

    // P2-9: Dedupe userIds before fetching — the `by_room_user` uniqueness
    // invariant means the typical case is 1 request per user, but the
    // dedupe keeps the read count bounded to unique requesters even if
    // a legacy duplicate slipped in.
    const uniqueUserIds: Id<'users'>[] = Array.from(
      new Set(requests.map((r) => String(r.userId)))
    ).map((s) => s as Id<'users'>);
    const uniqueUsers = await Promise.all(
      uniqueUserIds.map((uid) => ctx.db.get(uid))
    );
    const userById = new Map<string, Doc<'users'> | null>();
    uniqueUserIds.forEach((uid, i) => {
      userById.set(String(uid), uniqueUsers[i]);
    });

    const requestsWithUsers = requests.map((req) => {
      const user = userById.get(String(req.userId)) ?? null;
      return {
        _id: req._id,
        userId: req.userId,
        createdAt: req.createdAt,
        userName: user?.name ?? 'Unknown',
        userAvatar: user?.displayPrimaryPhotoUrl ?? null,
      };
    });

    return requestsWithUsers;
  },
});

// Future-only approval request helper (not part of the public password-only runtime).
export const getPendingRequestCount = internalQuery({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
      .take(100);

    return requests.length;
  },
});

// Future-only approval request helper (not part of the public password-only runtime).
export const approveJoinRequest = internalMutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    await requireChatRoomTermsAccepted(ctx, targetUserId);
    await requirePrivateRoomAdult(ctx, targetUserId);

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
      await patchMemberCountIfExact(ctx, roomId);
    }

    return { success: true };
  },
});

// Future-only approval request helper (not part of the public password-only runtime).
export const rejectJoinRequest = internalMutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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

// Kick and ban a member (owner/admin hierarchy)
export const kickAndBanMember = mutation({
  args: {
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.isPublic) {
      throw new Error('Kick is only allowed in private rooms');
    }

    if (targetUserId === userId) {
      throw new Error('Cannot kick yourself');
    }

    const actorMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (!actorMembership) {
      throw new Error('Only room moderators can kick members');
    }

    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .first();
    if (!targetMembership) {
      throw new Error('Target user is not a member of this room');
    }

    const actor = await ctx.db.get(userId);
    if (
      !canKickInRoom(
        actorMembership.role,
        targetMembership.role,
        actor?.isAdmin === true,
        isPlatformOwnedRoom(room)
      )
    ) {
      throw new Error('You do not have permission to kick this member');
    }

    const now = Date.now();

    // 4. Remove from members
    await ctx.db.delete(targetMembership._id);
    await patchMemberCountIfExact(ctx, roomId);

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

    const presenceRows = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', targetUserId))
      .take(10);
    for (const row of presenceRows) {
      await ctx.db.delete(row._id);
    }

    const mutesByTargetUser = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter', (q) => q.eq('roomId', roomId).eq('muterId', targetUserId))
      .take(500);
    const mutesTargetingUser = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_target', (q) => q.eq('roomId', roomId).eq('targetUserId', targetUserId))
      .take(500);
    const muteIds = new Set([
      ...mutesByTargetUser.map((mute) => mute._id),
      ...mutesTargetingUser.map((mute) => mute._id),
    ]);
    for (const muteId of muteIds) {
      await ctx.db.delete(muteId);
    }

    const removedMessageText = 'A member was removed by a room moderator.';
    await ctx.db.insert('chatRoomMessages', {
      roomId,
      senderId: userId,
      type: 'system',
      text: removedMessageText,
      createdAt: now,
    });
    await ctx.db.patch(roomId, {
      lastMessageAt: now,
      lastMessageText: removedMessageText,
    });

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
    sessionToken: v.optional(v.string()),
    isDemo: v.optional(v.boolean()),
    demoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { roomId, authUserId, sessionToken, isDemo, demoUserId } = args;

    const userId = await requireAuthenticatedUser(ctx, {
      authUserId: isDemo ? (demoUserId ?? authUserId) : authUserId,
      sessionToken,
    });
    if (isDemo === true && demoUserId) {
      const demoResolved = await resolveUserIdByAuthId(ctx, demoUserId);
      if (demoResolved !== userId) {
        throw new Error('Unauthorized: demo session mismatch');
      }
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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    // SECURITY: Require read access
    const { room } = await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });

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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, muted, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    sessionToken: v.string(),
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
    messageId: v.optional(v.string()),
    reportType: v.optional(v.union(v.literal('user'), v.literal('content'))),
  },
  handler: async (ctx, { authUserId, sessionToken, reportedUserId, roomId, reason, details, messageId, reportType }) => {
    // 1. SECURITY: Authenticate the reporter
    const reporterId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
    const roomDocId = roomId ? ctx.db.normalizeId('chatRooms', roomId) : null;
    if (!roomDocId) {
      throw new Error('Room not found');
    }
    await requireRoomReadAccess(ctx, roomDocId, { authUserId, sessionToken });

    const effectiveReportType = reportType ?? 'user';
    let reportedId = await resolveUserIdByAuthId(ctx, reportedUserId);
    let effectiveMessageId: string | undefined;

    if (effectiveReportType === 'content') {
      if (!messageId) {
        throw new Error('Message not found');
      }
      const normalizedMessageId = ctx.db.normalizeId('chatRoomMessages', messageId);
      if (!normalizedMessageId) {
        throw new Error('Message not found');
      }
      const message = await ctx.db.get(normalizedMessageId);
      if (!message || message.deletedAt) {
        throw new Error('Message not found');
      }
      if (message.roomId !== roomDocId) {
        throw new Error('Message not found');
      }
      reportedId = message.senderId;
      effectiveMessageId = String(message._id);
    }

    // 2. Resolve reported user ID
    if (!reportedId) {
      throw new Error('Reported user not found');
    }

    // 3. Prevent self-reports
    if (reporterId === reportedId) {
      throw new Error('Cannot report yourself');
    }

    // 4. Dedup same reporter → reported user → room reports for 24h.
    const now = Date.now();
    if (effectiveReportType === 'content' && effectiveMessageId) {
      const existingRecentReport = await findRecentRoomContentReport(
        ctx,
        reporterId,
        effectiveMessageId,
        now
      );
      if (existingRecentReport) {
        return {
          success: true,
          duplicate: true,
          message: 'You already reported this message recently.',
        };
      }
    } else {
      const existingRecentReport = await findRecentRoomUserReport(
        ctx,
        reporterId,
        reportedId,
        roomDocId,
        now
      );
      if (existingRecentReport) {
        return {
          success: true,
          duplicate: true,
          message: 'You already reported this user recently.',
        };
      }
    }

    const reportId = await ctx.db.insert('chatRoomReports', {
      reporterId,
      reportedUserId: reportedId,
      reason,
      description: details ?? undefined,
      status: 'pending',
      createdAt: now,
      roomId: roomDocId,
      messageId: effectiveMessageId,
      reportType: effectiveReportType,
    });

    // 6. Also mark the room as reported (for quick lookups)
    const roomIdString = String(roomDocId);
    const existingRoomReport = await ctx.db
      .query('userRoomReports')
      .withIndex('by_user_room', (q) => q.eq('userId', reporterId).eq('roomId', roomIdString))
      .first();

    if (!existingRoomReport) {
      await ctx.db.insert('userRoomReports', {
        userId: reporterId,
        roomId: roomIdString,
        createdAt: Date.now(),
      });
    }

    let autoTimeout:
      | Awaited<ReturnType<typeof evaluateChatRoomAutoTimeoutAfterReport>>
      | undefined;
    const room = await ctx.db.get(roomDocId);
    if (room) {
      autoTimeout = await evaluateChatRoomAutoTimeoutAfterReport(
        ctx,
        roomDocId,
        reportedId,
        reportId,
        reason
      );
    }

    if (autoTimeout?.actionApplied) {
      return {
        success: true,
        duplicate: false,
        actionApplied: true,
        timeoutUntil: autoTimeout.timeoutUntil,
      };
    }
    return { success: true, duplicate: false, actionApplied: false };
  },
});

// Internal-only demo seed helper; not available as a public client mutation.
export const seedDemoUser = internalMutation({
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
// The balance is updated through wallet ledger helpers for auditable engagement rewards.
// ═══════════════════════════════════════════════════════════════════════════
export const getUserWalletCoins = query({
  args: {
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
      .take(ROOM_MEMBER_LIST_LIMIT);

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
      .take(ROOM_MEMBER_LIST_LIMIT);

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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, sessionToken }) => {
    // Auth guard
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
    sessionToken: v.string(),
    nickname: v.string(),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, { authUserId, sessionToken, nickname, avatarUrl, bio }) => {
    // Auth guard
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

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
    sessionToken: v.string(),
  },
  handler: async (ctx, { userIds, authUserId, sessionToken }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return {};
    }
    const currentUserId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { roomId: roomIdRaw, authUserId, sessionToken } = args;

    if (!authUserId || authUserId.trim().length === 0) {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }
    if (!roomIdRaw || typeof roomIdRaw !== 'string') {
      return { selfUserId: null as string | null, byUserId: {} as Record<string, { nickname: string; avatarUrl: string | null; bio: string | null; age?: number; gender?: string }> };
    }

    const roomId = roomIdRaw.trim() as Id<'chatRooms'>;

    // Auth + access (aligns with getRoom/checkRoomAccess)
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
      .take(ROOM_MEMBER_LIST_LIMIT);

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
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const sessionToken = token.trim();
    if (!sessionToken) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await validateSessionToken(ctx, sessionToken);
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
    token: v.string(),
  },
  handler: async (ctx, { storageId, token }) => {
    const userId = await validateSessionToken(ctx, token.trim());
    if (!userId) {
      throw new Error('Unauthorized: authentication required');
    }
    return await ctx.storage.getUrl(storageId);
  },
});

function getChatRoomPrivateConversationLastActivityAt(
  conversation: Doc<'chatRoomPrivateConversations'>
): number {
  return conversation.lastMessageAt ?? conversation.createdAt;
}

function isChatRoomPrivateConversationExpired(
  conversation: Doc<'chatRoomPrivateConversations'> | null | undefined,
  now = Date.now()
): boolean {
  if (!conversation) return false;
  return getChatRoomPrivateConversationLastActivityAt(conversation) + CHAT_ROOM_PRIVATE_DM_INACTIVITY_MS <= now;
}

async function getChatRoomProfileIdentity(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<{ name: string; avatar?: string; gender?: 'male' | 'female' | 'other' }> {
  const [profile, user] = await Promise.all([
    ctx.db
      .query('chatRoomProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first(),
    ctx.db.get(userId),
  ]);
  const genderValue = (user?.gender ?? 'other').toLowerCase();
  return {
    name: profile?.nickname?.trim() || 'User',
    avatar: profile?.avatarUrl ?? undefined,
    gender: genderValue === 'male' || genderValue === 'female' ? genderValue : 'other',
  };
}

async function requireRoomMemberForPrivateDm(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<'chatRooms'>,
  userId: Id<'users'>
): Promise<Doc<'chatRoomMembers'>> {
  const ban = await ctx.db
    .query('chatRoomBans')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (ban) {
    throw new Error('Access denied');
  }
  const membership = await ctx.db
    .query('chatRoomMembers')
    .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
    .first();
  if (!membership || membership.isBanned) {
    throw new Error('Both users must be in this room');
  }
  return membership;
}

async function requireChatRoomPrivateConversationAccess(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'chatRoomPrivateConversations'>,
  token: string
): Promise<{
  userId: Id<'users'>;
  peerUserId: Id<'users'>;
  conversation: Doc<'chatRoomPrivateConversations'>;
  room: Doc<'chatRooms'>;
}> {
  const userId = await validateSessionToken(ctx, token.trim());
  if (!userId) {
    throw new Error('Unauthorized: authentication required');
  }
  const conversation = await ctx.db.get(conversationId);
  if (!conversation || !conversation.participants.includes(userId)) {
    throw new Error('Conversation not found');
  }
  if (isChatRoomPrivateConversationExpired(conversation)) {
    throw new Error('This chat expired');
  }
  const room = await ctx.db.get(conversation.roomId);
  if (!room || (room.expiresAt && room.expiresAt <= Date.now())) {
    throw new Error('Room not found');
  }
  if (!room.isPublic) {
    await requirePrivateRoomAdult(ctx, userId);
  }
  await requireRoomMemberForPrivateDm(ctx, conversation.roomId, userId);
  const peerUserId = conversation.participants.find((participantId) => participantId !== userId);
  if (!peerUserId) {
    throw new Error('Conversation not found');
  }
  return { userId, peerUserId, conversation, room };
}

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
    sessionToken: v.string(),
  },
  handler: async (ctx, { authUserId, sessionToken }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return { byRoomId: {}, totalUnread: 0, hasAnyUnread: false };
    }

    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return { byRoomId: {}, totalUnread: 0, hasAnyUnread: false };
    }

    const now = Date.now();
    const [asUser1, asUser2] = await Promise.all([
      ctx.db
        .query('chatRoomPrivateConversations')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .take(USER_DM_THREAD_LOOKUP_LIMIT),
      ctx.db
        .query('chatRoomPrivateConversations')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .take(USER_DM_THREAD_LOOKUP_LIMIT),
    ]);
    const byRoomId: Record<string, number> = {};
    let totalUnread = 0;

    for (const conversation of [...asUser1, ...asUser2]) {
      if (isChatRoomPrivateConversationExpired(conversation, now)) continue;
      const unreadMessages = await ctx.db
        .query('chatRoomPrivateMessages')
        .withIndex('by_conversation_readAt', (q) =>
          q.eq('conversationId', conversation._id).eq('readAt', undefined)
        )
        .filter((q) => q.neq(q.field('senderId'), userId))
        .take(100);
      const unreadCount = unreadMessages.length;
      if (unreadCount > 0) {
        const roomIdStr = conversation.roomId as string;
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
 * List DM threads from the dedicated room-scoped Chat Room DM table.
 * Used by Chat Rooms room screen — Messages popover + unread badge.
 * Never throws: returns [] if auth cannot be resolved or on any per-thread error.
 */
export const getDmThreads = query({
  args: {
    authUserId: v.string(),
    sessionToken: v.string(),
    roomId: v.optional(v.id('chatRooms')),
  },
  handler: async (ctx, { authUserId, sessionToken, roomId }) => {
    const now = Date.now();
    if (!authUserId || authUserId.trim().length === 0) {
      return [];
    }

    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return [];
    }

    const hiddenRows = await ctx.db
      .query('chatRoomPrivateConversationHides')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(USER_DM_THREAD_LOOKUP_LIMIT);
    const hiddenAtByConversationId = new Map<string, number>(
      hiddenRows.map((h) => [h.conversationId as string, h.hiddenAt])
    );

    const [asUser1, asUser2] = await Promise.all([
      ctx.db
        .query('chatRoomPrivateConversations')
        .withIndex('by_user1', (q) => q.eq('user1Id', userId))
        .take(USER_DM_THREAD_LOOKUP_LIMIT),
      ctx.db
        .query('chatRoomPrivateConversations')
        .withIndex('by_user2', (q) => q.eq('user2Id', userId))
        .take(USER_DM_THREAD_LOOKUP_LIMIT),
    ]);

    type ThreadRow = {
      id: string;
      roomId: string;
      peerId: string;
      peerName: string;
      peerAvatar?: string;
      peerGender?: 'male' | 'female' | 'other';
      lastMessage: string;
      lastMessageAt: number;
      unreadCount: number;
    };

    const threads: ThreadRow[] = [];

    for (const conversation of [...asUser1, ...asUser2]) {
      try {
        if (roomId && conversation.roomId !== roomId) continue;
        if (isChatRoomPrivateConversationExpired(conversation, now)) continue;

        const lastMsg = await ctx.db
          .query('chatRoomPrivateMessages')
          .withIndex('by_conversation_created', (q) =>
            q.eq('conversationId', conversation._id)
          )
          .order('desc')
          .first();

        const lastMessageAt =
          lastMsg?.createdAt ??
          conversation.lastMessageAt ??
          conversation.createdAt ??
          conversation._creationTime;
        const hiddenAt = hiddenAtByConversationId.get(conversation._id as string);
        if (hiddenAt !== undefined && hiddenAt >= lastMessageAt) continue;

        const peerId = conversation.participants.find((p) => p !== userId);
        if (!peerId) continue;
        const peerIdentity = await getChatRoomProfileIdentity(ctx, peerId);

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

        const unreadMessages = await ctx.db
          .query('chatRoomPrivateMessages')
          .withIndex('by_conversation_readAt', (q) =>
            q.eq('conversationId', conversation._id).eq('readAt', undefined)
          )
          .filter((q) => q.neq(q.field('senderId'), userId))
          .take(100);

        threads.push({
          id: conversation._id as string,
          roomId: conversation.roomId as string,
          peerId: peerId as string,
          peerName: peerIdentity.name,
          peerAvatar: peerIdentity.avatar,
          peerGender: peerIdentity.gender,
          lastMessage,
          lastMessageAt,
          unreadCount: unreadMessages.length,
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
    sessionToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { authUserId, sessionToken, limit }) => {
    try {
      if (!authUserId || authUserId.trim().length === 0) {
        return [];
      }
      const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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

export const getUnreadMentionCount = query({
  args: {
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { authUserId, sessionToken }) => {
    if (!authUserId || authUserId.trim().length === 0) {
      return { totalUnread: 0, perRoom: {} as Record<string, number> };
    }

    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return { totalUnread: 0, perRoom: {} as Record<string, number> };
    }

    const rows = await ctx.db
      .query('chatRoomMentionNotifications')
      .withIndex('by_mentioned_user_readAt', (q) =>
        q.eq('mentionedUserId', userId).eq('readAt', undefined)
      )
      .take(500);

    const perRoom: Record<string, number> = {};
    let totalUnread = 0;
    for (const row of rows) {
      if (row.readAt != null) continue;
      const roomId = row.roomId as string;
      perRoom[roomId] = (perRoom[roomId] ?? 0) + 1;
      totalUnread += 1;
    }

    return {
      totalUnread,
      perRoom,
    };
  },
});

export const markMentionRead = mutation({
  args: {
    authUserId: v.string(),
    sessionToken: v.string(),
    mentionId: v.id('chatRoomMentionNotifications'),
  },
  handler: async (ctx, { authUserId, sessionToken, mentionId }) => {
    try {
      const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
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
  args: { authUserId: v.string(), sessionToken: v.string() },
  handler: async (ctx, { authUserId, sessionToken }) => {
    try {
      const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
      const rows = await ctx.db
        .query('chatRoomMentionNotifications')
        .withIndex('by_mentioned_user_created', (q) => q.eq('mentionedUserId', userId))
        .take(500);
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, messageIds, authUserId, sessionToken }) => {
    try {
      const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
      if (!userId) {
        return {};
      }
      await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });
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
            .take(500);
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, messageId, emoji, authUserId, sessionToken }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });
    const msg = await ctx.db.get(messageId);
    if (!msg || msg.roomId !== roomId || msg.deletedAt) {
      throw new Error('Message not found');
    }
    // P2-7 / P2-19: Pre-check is the common path's only index read. Use
    // `.first()` so the common "no prior reaction" case never pays the
    // cost of collecting rows, and the common "already reacted" case
    // returns immediately after a single row read. The post-insert
    // dedupe below still collapses any duplicates that a parallel
    // handler may have produced, so correctness is unchanged.
    const existingFirst = await ctx.db
      .query('chatRoomMessageReactions')
      .withIndex('by_message_user_emoji', (q) =>
        q.eq('messageId', messageId).eq('userId', userId).eq('emoji', emoji)
      )
      .first();
    if (existingFirst) {
      return { success: true as const };
    }
    await ctx.db.insert('chatRoomMessageReactions', {
      roomId,
      messageId,
      userId,
      emoji,
      createdAt: Date.now(),
    });
    // P2-19: Post-insert re-check to collapse any row inserted concurrently
    // by a parallel handler. Keep the earliest row; delete the rest.
    const afterInsert = await ctx.db
      .query('chatRoomMessageReactions')
      .withIndex('by_message_user_emoji', (q) =>
        q.eq('messageId', messageId).eq('userId', userId).eq('emoji', emoji)
      )
      .take(20);
    if (afterInsert.length > 1) {
      const [keep, ...extras] = afterInsert.sort(
        (a, b) => a._creationTime - b._creationTime
      );
      for (const extra of extras) {
        if (extra._id !== keep._id) {
          await ctx.db.delete(extra._id);
        }
      }
    }
    return { success: true as const };
  },
});

export const removeReaction = mutation({
  args: {
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    // P2-18: Explicitly target a single emoji rather than deleting every
    // reaction the user placed on this message.
    emoji: v.string(),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, messageId, emoji, authUserId, sessionToken }) => {
    const { userId } = await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });
    const msg = await ctx.db.get(messageId);
    if (!msg || msg.roomId !== roomId) {
      throw new Error('Message not found');
    }
    // P2-18: delete ONLY rows whose emoji matches — not every reaction this
    // user has on the message.
    const rows = await ctx.db
      .query('chatRoomMessageReactions')
      .withIndex('by_message_user_emoji', (q) =>
        q.eq('messageId', messageId).eq('userId', userId).eq('emoji', emoji)
      )
      .take(20);
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    try {
      const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
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
        .take(500);
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, targetUserId, authUserId, sessionToken }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
    if (userId === targetUserId) {
      throw new Error('Cannot mute yourself');
    }
    await requireRoomReadAccess(ctx, roomId, { authUserId, sessionToken });
    const targetMembership = await ctx.db
      .query('chatRoomMembers')
      .withIndex('by_room_user', (q) =>
        q.eq('roomId', roomId).eq('userId', targetUserId)
      )
      .first();
    if (!targetMembership) {
      throw new Error('User is not in this room');
    }
    // P2-20: Use the (roomId, muterId, targetUserId) composite index to
    // scope the lookup to the exact tuple instead of scanning all mutes by
    // this muter.
    const existingRows = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter_target', (q) =>
        q
          .eq('roomId', roomId)
          .eq('muterId', userId)
          .eq('targetUserId', targetUserId)
      )
      .take(20);
    if (existingRows.length > 0) {
      // Toggle OFF: delete every matching row (also collapses any duplicates
      // left by a prior race).
      for (const row of existingRows) {
        await ctx.db.delete(row._id);
      }
      return { success: true as const, muted: false as const };
    }
    await ctx.db.insert('chatRoomPerUserMutes', {
      roomId,
      muterId: userId,
      targetUserId,
      createdAt: Date.now(),
    });
    // P2-20: Post-insert dedupe — if a parallel toggle also inserted for
    // the same tuple, keep the earliest row and delete the rest so the
    // table converges to exactly one mute row per (room, muter, target).
    const afterInsert = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter_target', (q) =>
        q
          .eq('roomId', roomId)
          .eq('muterId', userId)
          .eq('targetUserId', targetUserId)
      )
      .take(20);
    if (afterInsert.length > 1) {
      const [keep, ...extras] = afterInsert.sort(
        (a, b) => a._creationTime - b._creationTime
      );
      for (const extra of extras) {
        if (extra._id !== keep._id) {
          await ctx.db.delete(extra._id);
        }
      }
    }
    return { success: true as const, muted: true as const };
  },
});

/** Create or return a room-scoped private conversation in dedicated Chat Room DM tables. */
export const getOrCreateDmThread = mutation({
  args: {
    authUserId: v.string(),
    sessionToken: v.string(),
    peerUserId: v.id('users'),
    roomId: v.id('chatRooms'),
  },
  handler: async (ctx, { authUserId, sessionToken, peerUserId, roomId }) => {
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
    await requireChatRoomTermsAccepted(ctx, userId);
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

    const now = Date.now();
    const room = await ctx.db.get(roomId);
    if (!room || (room.expiresAt && room.expiresAt <= now)) {
      throw new Error('Room not found');
    }
    if (!room.isPublic) {
      await requirePrivateRoomAdult(ctx, userId);
    }
    await requireRoomMemberForPrivateDm(ctx, roomId, userId);
    await requireRoomMemberForPrivateDm(ctx, roomId, peerUserId);
    if (
      await hasActiveSevereRoomReportBetweenUsers(ctx, userId, peerUserId, roomId, now)
    ) {
      throw new Error('Cannot start conversation');
    }

    const sortedParticipants: [Id<'users'>, Id<'users'>] =
      (userId as string) < (peerUserId as string)
        ? [userId, peerUserId]
        : [peerUserId, userId];
    const pairKey = chatRoomPrivateDmPairKey(userId, peerUserId);

    const existingRows = await ctx.db
      .query('chatRoomPrivateConversations')
      .withIndex('by_room_pair', (q) => q.eq('roomId', roomId).eq('pairKey', pairKey))
      .take(20);
    const activeRows = existingRows
      .filter((conversation) => !isChatRoomPrivateConversationExpired(conversation, now))
      .sort((a, b) => getChatRoomPrivateConversationLastActivityAt(b) - getChatRoomPrivateConversationLastActivityAt(a));

    if (activeRows[0]) {
      return { threadId: activeRows[0]._id };
    }

    const conversationId = await ctx.db.insert('chatRoomPrivateConversations', {
      roomId,
      pairKey,
      participants: sortedParticipants,
      user1Id: sortedParticipants[0],
      user2Id: sortedParticipants[1],
      createdAt: now,
      lastMessageAt: now,
    });

    return { threadId: conversationId };
  },
});

/** Hide a DM thread from the inbox list (per user; does not delete messages). */
export const hideDmThread = mutation({
  args: {
    authUserId: v.string(),
    sessionToken: v.string(),
    threadId: v.id('chatRoomPrivateConversations'),
  },
  handler: async (ctx, { authUserId, sessionToken, threadId }) => {
    try {
      const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });
      const conv = await ctx.db.get(threadId);
      if (!conv || !conv.participants.includes(userId)) {
        return { success: false as const };
      }
      const now = Date.now();
      const existing = await ctx.db
        .query('chatRoomPrivateConversationHides')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', userId).eq('conversationId', threadId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { hiddenAt: now });
      } else {
        await ctx.db.insert('chatRoomPrivateConversationHides', {
          userId,
          conversationId: threadId,
          hiddenAt: now,
        });
      }

      return { success: true as const };
    } catch {
      return { success: false as const };
    }
  },
});

export const getRoomDmMessages = query({
  args: {
    token: v.string(),
    threadId: v.id('chatRoomPrivateConversations'),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, { token, threadId, paginationOpts }) => {
    try {
      let access;
      try {
        access = await requireChatRoomPrivateConversationAccess(ctx, threadId, token);
      } catch (error) {
        if (error instanceof Error && error.message === 'This chat expired') {
          return { page: [], isDone: true, continueCursor: null, expired: true as const };
        }
        return { page: [], isDone: true, continueCursor: null };
      }
      const { userId } = access;
      const numItems = Math.min(Math.max(paginationOpts.numItems, 1), 100);
      let q = ctx.db
        .query('chatRoomPrivateMessages')
        .withIndex('by_conversation_created', (q) => q.eq('conversationId', threadId))
        .order('desc');

      if (paginationOpts.cursor) {
        try {
          const parsed = JSON.parse(paginationOpts.cursor) as { before: number };
          q = q.filter((qf) => qf.lt(qf.field('createdAt'), parsed.before));
        } catch {
          return { page: [], isDone: true, continueCursor: null };
        }
      }

      const batch = await q.take(numItems + 1);
      const hasMore = batch.length > numItems;
      const slice = hasMore ? batch.slice(0, numItems) : batch;
      const orderedMessages = slice.slice().reverse();
      const senderIds = Array.from(new Set(orderedMessages.map((message) => message.senderId)));
      const identities = await Promise.all(
        senderIds.map((senderId) => getChatRoomProfileIdentity(ctx, senderId))
      );
      const identityByUserId = new Map(
        senderIds.map((senderId, index) => [senderId as string, identities[index]])
      );
      const storageIds = Array.from(new Set(
        orderedMessages.flatMap((message) => {
          if ((message.type === 'image' || message.type === 'video') && message.imageStorageId) {
            return [message.imageStorageId];
          }
          if (message.type === 'voice' && message.audioStorageId) {
            return [message.audioStorageId];
          }
          return [];
        })
      ));
      const urls = await Promise.all(storageIds.map((storageId) => ctx.storage.getUrl(storageId)));
      const urlByStorageId = new Map(
        storageIds.map((storageId, index) => [storageId as string, urls[index] ?? undefined])
      );

      const page = orderedMessages
        .filter((message) => !message.deletedAt)
        .map((message) => {
          const identity = identityByUserId.get(message.senderId as string);
          let mediaUrl: string | undefined;
          if ((message.type === 'image' || message.type === 'video') && message.imageStorageId) {
            mediaUrl = urlByStorageId.get(message.imageStorageId as string);
          } else if (message.type === 'voice' && message.audioStorageId) {
            mediaUrl = urlByStorageId.get(message.audioStorageId as string);
          }
          return {
            id: message._id as string,
            threadId: threadId as string,
            senderId: message.senderId as string,
            senderName: identity?.name ?? 'User',
            senderAvatar: identity?.avatar,
            text: message.type === 'text' ? message.content : undefined,
            type: message.type === 'voice' ? 'audio' : message.type,
            mediaUrl,
            readAt: message.readAt,
            createdAt: message.createdAt,
            isMe: message.senderId === userId,
          };
        });

      const oldest = slice.length > 0 ? slice[slice.length - 1] : null;
      return {
        page,
        isDone: !hasMore,
        continueCursor: hasMore && oldest ? JSON.stringify({ before: oldest.createdAt }) : null,
      };
    } catch {
      return { page: [], isDone: true, continueCursor: null };
    }
  },
});

export const markRoomDmRead = mutation({
  args: {
    conversationId: v.id('chatRoomPrivateConversations'),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    try {
      const { userId } = await requireChatRoomPrivateConversationAccess(ctx, conversationId, token);
      const now = Date.now();
      const unreadMessages = await ctx.db
        .query('chatRoomPrivateMessages')
        .withIndex('by_conversation_readAt', (q) =>
          q.eq('conversationId', conversationId).eq('readAt', undefined)
        )
        .filter((q) => q.neq(q.field('senderId'), userId))
        .take(100);
      for (const message of unreadMessages) {
        await ctx.db.patch(message._id, { readAt: now });
      }
      return { success: true as const, count: unreadMessages.length };
    } catch {
      return { success: true as const, count: 0 };
    }
  },
});

export const sendRoomDmMessage = mutation({
  args: {
    conversationId: v.id('chatRoomPrivateConversations'),
    token: v.string(),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('voice')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { conversationId, token, type, imageStorageId, audioStorageId, audioDurationMs, clientMessageId } = args;
    const content = type === 'text' ? args.content.trim() : args.content;
    const now = Date.now();
    const { userId, peerUserId, conversation } = await requireChatRoomPrivateConversationAccess(
      ctx,
      conversationId,
      token
    );
    await requireRoomMemberForPrivateDm(ctx, conversation.roomId, peerUserId);
    await requireChatRoomTermsAccepted(ctx, userId);
    if (await isBlockedBidirectional(ctx, userId, peerUserId)) {
      throw new Error('Cannot send message');
    }
    if (await hasActiveSevereRoomReportBetweenUsers(ctx, userId, peerUserId, conversation.roomId, now)) {
      throw new Error('Cannot send message');
    }
    const mutedByRecipient = await ctx.db
      .query('chatRoomPerUserMutes')
      .withIndex('by_room_muter_target', (q) =>
        q
          .eq('roomId', conversation.roomId)
          .eq('muterId', peerUserId)
          .eq('targetUserId', userId)
      )
      .first();
    if (mutedByRecipient) {
      throw new Error("You can't message this user right now.");
    }
    const penalty = await getActiveChatRoomReadOnlyPenalty(ctx, conversation.roomId, userId, now);
    if (penalty) {
      throw new Error('You are restricted from sending messages in this room');
    }

    if (clientMessageId) {
      const existing = await ctx.db
        .query('chatRoomPrivateMessages')
        .withIndex('by_conversation_clientMessageId', (q) =>
          q.eq('conversationId', conversationId).eq('clientMessageId', clientMessageId)
        )
        .first();
      if (existing) {
        return { success: true as const, messageId: existing._id, duplicate: true as const };
      }
    }

    const recentMessages = await ctx.db
      .query('chatRoomPrivateMessages')
      .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.eq(q.field('senderId'), userId),
          q.gt(q.field('createdAt'), now - 60_000)
        )
      )
      .take(10);
    const contentPolicy = validateChatRoomMessageContent({
      text: content,
      context: 'dm',
      recentMessages,
      allowMentions: false,
    });
    if (contentPolicy.ok === false) {
      throw new ConvexError({
        code: contentPolicy.code,
        category: contentPolicy.category,
        message: formatChatRoomContentPolicyError(contentPolicy),
      });
    }
    if (recentMessages.length >= 10) {
      throw new Error('Rate limit exceeded: max 10 messages per minute');
    }

    if (type === 'text' && !content) {
      throw new Error('Message cannot be empty');
    }
    if ((type === 'image' || type === 'video') && !imageStorageId) {
      throw new Error('Media attachment required');
    }
    if (type === 'voice' && !audioStorageId) {
      throw new Error('Audio attachment required');
    }
    if (imageStorageId) {
      await verifyOrClaimChatRoomMediaOwnership(ctx, imageStorageId, userId, type === 'video' ? 'video' : 'image');
      await validateChatRoomMediaMetadata(ctx, imageStorageId, type === 'video' ? 'video' : 'image');
    }
    if (audioStorageId) {
      await verifyOrClaimChatRoomMediaOwnership(ctx, audioStorageId, userId, 'audio');
      await validateChatRoomMediaMetadata(ctx, audioStorageId, 'audio');
    }

    const maskedContent = type === 'text' ? softMaskText(content) : '';
    const messageId = await ctx.db.insert('chatRoomPrivateMessages', {
      conversationId,
      roomId: conversation.roomId,
      senderId: userId,
      type,
      content: maskedContent,
      imageStorageId,
      audioStorageId,
      audioDurationMs,
      clientMessageId,
      createdAt: now,
    });

    const lastMessageText =
      type === 'text'
        ? maskedContent
        : type === 'image'
          ? 'Photo'
          : type === 'video'
            ? 'Video'
            : 'Voice message';
    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      lastMessageText,
    });

    const hiddenRow = await ctx.db
      .query('chatRoomPrivateConversationHides')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', peerUserId).eq('conversationId', conversationId)
      )
      .first();
    if (hiddenRow) {
      await ctx.db.delete(hiddenRow._id);
    }

    return { success: true as const, messageId };
  },
});

export const setRoomDmTypingStatus = mutation({
  args: {
    conversationId: v.id('chatRoomPrivateConversations'),
    token: v.string(),
    isTyping: v.boolean(),
  },
  handler: async (ctx, { conversationId, token, isTyping }) => {
    try {
      const { userId, conversation } = await requireChatRoomPrivateConversationAccess(ctx, conversationId, token);
      const existing = await ctx.db
        .query('chatRoomPrivateTyping')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', userId).eq('conversationId', conversationId)
        )
        .first();
      if (!isTyping) {
        if (existing) await ctx.db.delete(existing._id);
        return { success: true as const };
      }
      const now = Date.now();
      if (existing) {
        await ctx.db.patch(existing._id, { isTyping, updatedAt: now });
      } else {
        await ctx.db.insert('chatRoomPrivateTyping', {
          conversationId,
          roomId: conversation.roomId,
          userId,
          isTyping,
          updatedAt: now,
        });
      }
      return { success: true as const };
    } catch {
      return { success: false as const };
    }
  },
});

export const getRoomDmTypingStatus = query({
  args: {
    conversationId: v.id('chatRoomPrivateConversations'),
    token: v.string(),
  },
  handler: async (ctx, { conversationId, token }) => {
    try {
      const { peerUserId } = await requireChatRoomPrivateConversationAccess(ctx, conversationId, token);
      const typing = await ctx.db
        .query('chatRoomPrivateTyping')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', peerUserId).eq('conversationId', conversationId)
        )
        .first();
      if (!typing) return { isTyping: false };
      return { isTyping: typing.isTyping && Date.now() - typing.updatedAt <= 5000 };
    } catch {
      return { isTyping: false };
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    // Validate auth
    if (!authUserId || authUserId.trim().length === 0) {
      return { stage: 1, attemptsRemaining: 3, blocked: false, cooldown: false };
    }
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, password, authUserId, sessionToken }) => {
    // Validate auth
    if (!authUserId || authUserId.trim().length === 0) {
      throw new Error('Unauthorized: authentication required');
    }
    const userId = await requireAuthenticatedUser(ctx, { authUserId, sessionToken });

    // Get the room
    const room = await ctx.db.get(roomId);
    if (!room) {
      return { success: false, message: 'Room not found' };
    }

    // Check if room is expired (use <= to match every other expiry check)
    if (room.expiresAt && room.expiresAt <= Date.now()) {
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
      try {
        await requireChatRoomTermsAccepted(ctx, userId);
        await requirePrivateRoomAdult(ctx, userId);
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'AGE_RESTRICTED_PRIVATE_ROOM',
        };
      }

      // P1: Check chatRoomBans table (source of truth), not the legacy
      // `isBanned` flag on chatRoomMembers. Bans created via kickAndBanMember
      // only write to chatRoomBans, so checking isBanned allowed banned users
      // to rejoin via the password flow.
      const ban = await ctx.db
        .query('chatRoomBans')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (ban) {
        return { success: false, message: 'You are not allowed to join this room' };
      }

      const membership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();

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
        // P1: Recompute memberCount from source of truth to avoid lost
        // updates from concurrent joins racing on a stale read of `room`.
        await patchMemberCountIfExact(ctx, roomId);
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
/**
 * Send heartbeat to mark user as active in a room.
 * Creates or updates presence record.
 */
export const heartbeatPresence = mutation({
  args: {
    roomId: v.id('chatRooms'),
    authUserId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return { success: false };
    }

    // Verify room exists
    const room = await ctx.db.get(roomId);
    if (!room) {
      return { success: false };
    }
    if (room.expiresAt && room.expiresAt <= Date.now()) {
      return { success: false };
    }

    const now = Date.now();

    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      const bannedPresenceRows = await ctx.db
        .query('chatRoomPresence')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .take(10);
      for (const row of bannedPresenceRows) {
        await ctx.db.delete(row._id);
      }
      return { success: false };
    }

    if (!room.isPublic) {
      const membership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (!membership || membership.isBanned) {
        return { success: false };
      }
    }

    // SINGLE-ROOM PRESENCE: ensure user exists in only one room at a time.
    // Delete any other presence rows for this user in other rooms.
    const otherPresence = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(10);
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
      // P2-26: Server-side heartbeat throttle. If the last write is
      // within HEARTBEAT_THROTTLE_MS, skip the patch — the "online"
      // window (PRESENCE_ONLINE_THRESHOLD_MS = 3 min) is far larger
      // than the throttle, so presence semantics are unchanged; we
      // just stop amplifying chatty clients into redundant writes.
      const HEARTBEAT_THROTTLE_MS = 10_000;
      if (now - existing.lastHeartbeatAt < HEARTBEAT_THROTTLE_MS) {
        return { success: true };
      }
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
    sessionToken: v.string(),
  },
  handler: async (ctx, { roomId, authUserId, sessionToken }) => {
    const userId = await getAuthenticatedUserOrNull(ctx, { authUserId, sessionToken });
    if (!userId) {
      return { online: [], recentlyLeft: [] };
    }

    const now = Date.now();
    const room = await ctx.db.get(roomId);
    if (!room || (room.expiresAt && room.expiresAt <= now)) {
      return { online: [], recentlyLeft: [] };
    }
    const ban = await ctx.db
      .query('chatRoomBans')
      .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
      .first();
    if (ban) {
      return { online: [], recentlyLeft: [] };
    }
    if (!room.isPublic) {
      const membership = await ctx.db
        .query('chatRoomMembers')
        .withIndex('by_room_user', (q) => q.eq('roomId', roomId).eq('userId', userId))
        .first();
      if (!membership || membership.isBanned) {
        return { online: [], recentlyLeft: [] };
      }
    }

    // P2-5: Bound the read to the "recently-left" window (anything older
    // is dropped by the UI anyway), indexed by (roomId, lastHeartbeatAt),
    // and hard-cap at PRESENCE_FETCH_CAP so the query never fans out to
    // an unbounded number of rows. The cap is well above typical room
    // size and only activates as a safety net in abusive scenarios.
    const PRESENCE_FETCH_CAP = 200;
    const visibleThreshold = now - PRESENCE_RECENTLY_LEFT_THRESHOLD_MS;
    const presenceRecords = await ctx.db
      .query('chatRoomPresence')
      .withIndex('by_room_heartbeat', (q) =>
        q.eq('roomId', roomId).gte('lastHeartbeatAt', visibleThreshold)
      )
      .order('desc')
      .take(PRESENCE_FETCH_CAP);

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
      .take(ROOM_MEMBER_LIST_LIMIT);

    const memberRoleMap = new Map<string, 'owner' | 'admin' | 'member'>();
    for (const m of members) {
      memberRoleMap.set(String(m.userId), m.role);
    }

    // P2-5: Dedupe userIds across presence rows before fetching so each
    // unique user is read at most once even if a row-collapse race left
    // behind duplicate presence rows. Profile + user reads are issued
    // in parallel and reused via a lookup map.
    const uniqueUserIds: Id<'users'>[] = Array.from(
      new Set(presenceRecords.map((p) => String(p.userId)))
    ).map((s) => s as Id<'users'>);
    const [uniqueChatProfiles, uniqueUsers] = await Promise.all([
      Promise.all(
        uniqueUserIds.map((id) =>
          ctx.db
            .query('chatRoomProfiles')
            .withIndex('by_userId', (q) => q.eq('userId', id))
            .first()
        )
      ),
      Promise.all(uniqueUserIds.map((id) => ctx.db.get(id))),
    ]);
    const chatProfileByUser = new Map<
      string,
      Doc<'chatRoomProfiles'> | null
    >();
    const userByUser = new Map<string, Doc<'users'> | null>();
    uniqueUserIds.forEach((uid, i) => {
      chatProfileByUser.set(String(uid), uniqueChatProfiles[i]);
      userByUser.set(String(uid), uniqueUsers[i]);
    });

    for (let i = 0; i < presenceRecords.length; i++) {
      const record = presenceRecords[i];
      const chatProfile = chatProfileByUser.get(String(record.userId)) ?? null;
      const user = userByUser.get(String(record.userId)) ?? null;

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
