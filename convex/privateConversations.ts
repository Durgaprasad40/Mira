/**
 * Phase-2 Private Conversations Query Layer
 *
 * STRICT ISOLATION: This file handles ALL Phase-2 conversation queries.
 * Phase-2 ONLY reads from: privateConversations, privateConversationParticipants, privateMessages
 * Phase-2 NEVER reads from Phase-1 tables: conversations, conversationParticipants, messages
 *
 * Created to fix P0-003: No query functions exist for Phase-2 conversation data
 */

import { v } from 'convex/values';
import { query, mutation, internalMutation, internalQuery, MutationCtx, QueryCtx } from './_generated/server';
import { Doc, Id } from './_generated/dataModel';
import { validateSessionToken, resolveUserIdByAuthId, getPhase2DisplayName } from './helpers';
import { shouldCreatePhase2PrivateMessagesNotification } from './phase2NotificationPrefs';
import { markPrivateMessageNotificationsForConversation } from './privateNotifications';
import { softMaskText } from './softMask';
import { awardWalletCoins } from './wallet';
import { filterOwnedSafePrivatePhotoUrls } from './phase2PrivatePhotos';

// P1-001: Generate upload URL for secure media (photos/videos)
// Used by incognito-chat.tsx to upload protected media to Convex storage

// Message types that count toward unread badges (excludes system messages)
const COUNTABLE_MESSAGE_TYPES = ['text', 'image', 'video', 'voice'];
const EXPIRED_SECURE_MEDIA_VISIBLE_GRACE_MS = 60 * 1000;
const PRIVATE_PROTECTED_MEDIA_TIMERS = new Set([0, 30, 60]);
const MAX_PRIVATE_CONVERSATION_LIST_LIMIT = 80;
const MAX_PRIVATE_CONVERSATION_SCAN_LIMIT = 200;

type PrivateMessageMediaKind = 'image' | 'video' | 'audio';

const PRIVATE_MESSAGE_MEDIA_LIMITS: Record<
  PrivateMessageMediaKind,
  { maxBytes: number; contentTypePrefix: string }
> = {
  image: { maxBytes: 15 * 1024 * 1024, contentTypePrefix: 'image/' },
  video: { maxBytes: 100 * 1024 * 1024, contentTypePrefix: 'video/' },
  audio: { maxBytes: 20 * 1024 * 1024, contentTypePrefix: 'audio/' },
};

type PrivateSecureMediaVisibilityFields = {
  isProtected?: boolean;
  isExpired?: boolean;
  timerEndsAt?: number;
  expiredAt?: number;
};

type PrivateSecureMediaModeFields = {
  protectedMediaTimer?: number;
  viewOnce?: boolean;
};

function isPrivateSecureMediaViewOnce(
  message: PrivateSecureMediaModeFields
): boolean {
  // New Phase-2 rows persist an explicit boolean. Legacy Phase-2 secure
  // photos/videos were timer-0 and one-time before this field existed.
  return (
    message.viewOnce === true ||
    (message.viewOnce === undefined && (message.protectedMediaTimer ?? 0) === 0)
  );
}

function getPrivateSecureMediaExpiredAt(
  message: PrivateSecureMediaVisibilityFields,
  nowMs: number
): number | null {
  if (!message.isProtected) return null;
  if (typeof message.expiredAt === 'number') return message.expiredAt;
  if (
    typeof message.timerEndsAt === 'number' &&
    (message.isExpired === true || message.timerEndsAt <= nowMs)
  ) {
    return message.timerEndsAt;
  }
  return null;
}

function shouldHideExpiredPrivateSecureMedia(
  message: PrivateSecureMediaVisibilityFields,
  nowMs: number
): boolean {
  const expiredAt = getPrivateSecureMediaExpiredAt(message, nowMs);
  return (
    typeof expiredAt === 'number' &&
    nowMs - expiredAt >= EXPIRED_SECURE_MEDIA_VISIBLE_GRACE_MS
  );
}

function isLegacyTruthDareConnectionIntroMessage(message: {
  type?: string;
  content?: string;
  systemSubtype?: string;
}): boolean {
  if (typeof message.content !== 'string') return false;
  const content = message.content.replace(/\s+/g, ' ').trim();
  const hasTruthDareMarker =
    message.systemSubtype === 'truthdare' ||
    /^\[SYSTEM:{1,2}truthdare\]/i.test(content);
  const isSystemLike = message.type === 'system' || hasTruthDareMarker;
  if (!isSystemLike) return false;

  return (
    /T&D connection accepted/i.test(content) ||
    (/connection accepted/i.test(content) &&
      /say hi/i.test(content) &&
      /(T&D|truth\s*\/?\s*dare|truthdare)/i.test(content))
  );
}

function isLegacyTruthDareSpinTranscriptMessage(message: {
  type?: string;
  content?: string;
  systemSubtype?: string;
}): boolean {
  if (typeof message.content !== 'string') return false;
  const content = message.content.replace(/\s+/g, ' ').trim();
  const hasTruthDareMarker =
    message.systemSubtype === 'truthdare' ||
    message.systemSubtype === 'tod_perm' ||
    message.systemSubtype === 'tod_temp' ||
    /^\[SYSTEM:{1,2}(truthdare|tod_perm|tod_temp)\]/i.test(content);
  const isSystemLike = message.type === 'system' || hasTruthDareMarker;
  if (!isSystemLike) return false;

  return /\bspun the bottle$/i.test(content) || /^Bottle landed on\b/i.test(content);
}

function shouldHidePrivateTruthDareSystemMessage(message: {
  type?: string;
  content?: string;
  systemSubtype?: string;
}): boolean {
  return (
    isLegacyTruthDareConnectionIntroMessage(message) ||
    isLegacyTruthDareSpinTranscriptMessage(message)
  );
}

function isPrivateVisualMediaType(type: string | undefined): type is 'image' | 'video' {
  return type === 'image' || type === 'video';
}

async function verifyOrClaimPrivateMessageMediaOwnership(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  senderId: Id<'users'>,
  mediaKind: PrivateMessageMediaKind
): Promise<void> {
  const existing = await ctx.db
    .query('privateMessageMediaUploads')
    .withIndex('by_storage', (q) => q.eq('storageId', storageId))
    .first();

  if (existing) {
    if (existing.uploaderUserId !== senderId) {
      throw new Error('Unauthorized: storage reference does not belong to sender');
    }
    if (existing.mediaKind !== mediaKind) {
      throw new Error('Media storage kind does not match message type');
    }
    return;
  }

  await ctx.db.insert('privateMessageMediaUploads', {
    storageId,
    uploaderUserId: senderId,
    mediaKind,
    createdAt: Date.now(),
  });
}

async function validatePrivateMessageMediaMetadata(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  mediaKind: PrivateMessageMediaKind
): Promise<void> {
  const meta = (await ctx.db.system.get(storageId)) as
    | { size?: number; contentType?: string }
    | null;

  if (!meta) {
    throw new Error('Invalid storage reference: metadata unavailable');
  }

  const limits = PRIVATE_MESSAGE_MEDIA_LIMITS[mediaKind];
  if (typeof meta.size === 'number' && meta.size > limits.maxBytes) {
    throw new Error(`Media exceeds size limit for ${mediaKind}`);
  }

  const contentType = typeof meta.contentType === 'string' ? meta.contentType : '';
  if (!contentType.toLowerCase().startsWith(limits.contentTypePrefix)) {
    throw new Error(`Media content type does not match declared ${mediaKind}`);
  }
}

function getPrivateConversationPreviewContent(
  message: (PrivateSecureMediaVisibilityFields & { content?: string }) | null,
  nowMs: number
): string | null {
  if (!message) return null;
  if (getPrivateSecureMediaExpiredAt(message, nowMs) !== null) {
    return 'Secure media expired';
  }
  return message.content || null;
}

function isUnavailableUser(user: Doc<'users'> | null | undefined): boolean {
  return (
    !user ||
    user.deletedAt !== undefined ||
    user.isActive === false ||
    user.isBanned === true
  );
}

async function requirePrivateConversationActor(
  ctx: QueryCtx | MutationCtx,
  token: string,
  authUserId?: string,
): Promise<Id<'users'>> {
  const userId = await validateSessionToken(ctx, token.trim());
  if (!userId) {
    throw new Error('UNAUTHORIZED');
  }

  const authHint = authUserId?.trim();
  if (authHint) {
    const assertedUserId = await resolveUserIdByAuthId(ctx, authHint);
    if (!assertedUserId || assertedUserId !== userId) {
      throw new Error('UNAUTHORIZED');
    }
  }

  return userId;
}

async function usersShareActivePrivateConversation(
  ctx: QueryCtx | MutationCtx,
  viewerId: Id<'users'>,
  targetUserId: Id<'users'>,
): Promise<boolean> {
  if (viewerId === targetUserId) return true;

  const participations = await ctx.db
    .query('privateConversationParticipants')
    .withIndex('by_user', (q) => q.eq('userId', viewerId))
    .collect();

  for (const participation of participations) {
    if (participation.isHidden === true) continue;
    const conversation = await ctx.db.get(participation.conversationId);
    if (!conversation) continue;
    if (
      conversation.participants.includes(viewerId) &&
      conversation.participants.includes(targetUserId)
    ) {
      return true;
    }
  }

  return false;
}

function buildClosedPrivateConversationPayload(
  conversation: Doc<'privateConversations'>,
  otherParticipantId: Id<'users'> | null
) {
  return {
    id: conversation._id,
    matchId: conversation.matchId,
    participantId: otherParticipantId,
    participantName: 'Conversation closed',
    participantPhotoUrl: null,
    participantLastActive: 0,
    participantIntentKey: null,
    unreadCount: 0,
    connectionSource: conversation.connectionSource || 'desire_match',
    createdAt: conversation.createdAt,
    isBlocked: false,
    isPhotoBlurred: false,
    photoAccessStatus: 'none' as const,
    canViewClearPhoto: false,
    participantDeleted: true,
    terminalState: 'user_removed' as const,
  };
}

// Helper: Check if either user has blocked the other (shared across phases)
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

// Helper: Compute unread count from privateMessages (source of truth)
async function computeUnreadCountFromPrivateMessages(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'privateConversations'>,
  userId: Id<'users'>
): Promise<number> {
  const unreadMessages = await ctx.db
    .query('privateMessages')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
    .filter((q) =>
      q.and(
        q.neq(q.field('senderId'), userId),
        q.eq(q.field('readAt'), undefined)
      )
    )
    .collect();

  return unreadMessages.filter((m) => COUNTABLE_MESSAGE_TYPES.includes(m.type)).length;
}

// P2-001 FIX: Batch-fetch presence for multiple users to avoid N+1 queries
async function batchFetchPresence(
  ctx: QueryCtx | MutationCtx,
  userIds: Id<'users'>[]
): Promise<Map<string, number>> {
  const presenceMap = new Map<string, number>();
  if (userIds.length === 0) return presenceMap;

  // Fetch all presence records in parallel (more efficient than sequential)
  const presenceRecords = await Promise.all(
    userIds.map((userId) =>
      ctx.db
        .query('privateUserPresence')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first()
    )
  );

  // Build the map
  userIds.forEach((userId, idx) => {
    const presence = presenceRecords[idx];
    presenceMap.set(userId as string, presence?.lastActiveAt ?? 0);
  });

  return presenceMap;
}

// ═══════════════════════════════════════════════════════════════════════════
// Query A: Get User's Phase-2 Conversations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all Phase-2 conversations for the authenticated user.
 *
 * Returns conversations with:
 * - Other participant's profile info (name initial, photo, age)
 * - Last message preview
 * - Unread count
 * - Connection source (desire_match, desire_super_like, tod, room)
 *
 * Identity is resolved from Mira's custom session token. authUserId is an assertion hint only.
 */
export const getUserPrivateConversations = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { token, authUserId, limit }) => {
    const userId = await requirePrivateConversationActor(ctx, token, authUserId);
    const requestedLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.max(1, Math.min(Math.floor(limit), MAX_PRIVATE_CONVERSATION_LIST_LIMIT))
        : MAX_PRIVATE_CONVERSATION_LIST_LIMIT;
    const scanLimit = Math.min(
      MAX_PRIVATE_CONVERSATION_SCAN_LIMIT,
      Math.max(requestedLimit * 3, requestedLimit),
    );

    // Get a bounded recent participation window for this user (Phase-2 table).
    // Full cursor pagination can use a denormalized participant lastMessageAt index later.
    const allParticipations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .take(scanLimit);

    // LEAVE CONVERSATION FIX: Exclude conversations user has left/hidden
    const participations = allParticipations.filter((p) => p.isHidden !== true);

    if (participations.length === 0) {
      return [];
    }

    // P2-001 FIX: Pre-fetch all conversations to collect other participant IDs
    const conversationIds = participations.map((p) => p.conversationId);
    const conversations = await Promise.all(conversationIds.map((id) => ctx.db.get(id)));

    // Collect all other participant IDs for batch presence fetch
    const otherParticipantIds: Id<'users'>[] = [];
    conversations.forEach((conversation) => {
      if (conversation) {
        const otherId = conversation.participants.find((pid) => pid !== userId);
        if (otherId) {
          otherParticipantIds.push(otherId);
        }
      }
    });

    // P2-001 FIX: Batch-fetch presence for all participants in ONE query
    const presenceMap = await batchFetchPresence(ctx, otherParticipantIds);
    const nowMs = Date.now();

    // Fetch conversation details and other participant info
    const results = await Promise.all(
      participations.map(async (p, idx) => {
        const conversation = conversations[idx];
        if (!conversation) return null;

        // Find the other participant
        const otherParticipantId = conversation.participants.find(
          (pid) => pid !== userId
        );
        if (!otherParticipantId) return null;

        // Check if blocked (skip blocked conversations)
        if (await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
          return null;
        }

        // Get other participant's user record
        const otherUser = await ctx.db.get(otherParticipantId);
        if (!otherUser || isUnavailableUser(otherUser)) return null;

        // Get other participant's Phase-2 private profile for display name
        const otherPrivateProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
          .first();

        // Calculate age from DOB
        let otherAge: number | null = null;
        if (otherUser.dateOfBirth) {
          const birthDate = new Date(otherUser.dateOfBirth);
          const today = new Date();
          otherAge = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            otherAge--;
          }
        }

        // Get last visible message. Expired Phase-2 secure media stays visible
        // for a short grace window, then disappears from previews without
        // deleting the shared message row.
        const lastMessageCandidates = await ctx.db
          .query('privateMessages')
          .withIndex('by_conversation_created', (q) => q.eq('conversationId', p.conversationId))
          .order('desc')
          .take(25);
        const lastMessage =
          lastMessageCandidates.find(
            (m) =>
              !shouldHidePrivateTruthDareSystemMessage(m) &&
              (!m.isProtected ||
                (!m.isExpired && getPrivateSecureMediaExpiredAt(m, nowMs) === null))
          ) ?? null;

        const lastRealMessage = await ctx.db
          .query('privateMessages')
          .withIndex('by_conversation_created', (q) => q.eq('conversationId', p.conversationId))
          .filter((q) =>
            q.or(
              q.eq(q.field('type'), 'text'),
              q.eq(q.field('type'), 'image'),
              q.eq(q.field('type'), 'video'),
              q.eq(q.field('type'), 'voice')
            )
          )
          .order('desc')
          .first();

        // PHASE-2 ISOLATION: Use ONLY Phase-2 private photos
        // NO fallback to Phase-1 photos table or primaryPhotoUrl
        // If no Phase-2 photo exists, return null (UI will show placeholder)
        const safePrivatePhotoUrls = otherPrivateProfile
          ? await filterOwnedSafePrivatePhotoUrls(
              ctx,
              otherParticipantId,
              otherPrivateProfile.privatePhotoUrls ?? [],
            )
          : [];
        const photoUrl = safePrivatePhotoUrls[0] ?? null;

        // PHASE-2 PRIVACY FIX: ALWAYS use handle from users table, never stored displayName
        // Stored displayName may contain old full names from before the fix
        // Phase-2 must NEVER expose first name or last name
        // ANON-LOADING-FIX: emit null (not the literal string "Anonymous") when
        // both displayName and handle are missing. The client must render a
        // loading placeholder; "Anonymous" is reserved for intentional
        // anonymous product modes only.
        const displayName =
          otherPrivateProfile?.displayName ||
          otherUser?.handle ||
          null;

        // Compute unread count from source of truth (privateMessages table)
        // P2-002 FIX: Use denormalized unreadCount from participant record (avoids race condition)
        // The unreadCount is atomically updated by sendPrivateMessage and markPrivateMessagesRead
        const unreadCount = p.unreadCount;

        // ═══════════════════════════════════════════════════════════════════════════
        // PHOTO ACCESS CONTROL: Check if other user has blur enabled and access status
        // ═══════════════════════════════════════════════════════════════════════════
        const hasBlurredPhotos = (otherPrivateProfile?.privatePhotosBlurred?.length ?? 0) > 0;
        const hasBlurLevel = (otherPrivateProfile?.privatePhotoBlurLevel ?? 0) > 0;
        const isPhotoBlurred = hasBlurredPhotos || hasBlurLevel;

        // Check photo access request status
        let photoAccessStatus: 'none' | 'pending' | 'approved' | 'declined' = 'none';
        let canViewClearPhoto = !isPhotoBlurred; // If not blurred, can always view clear

        if (isPhotoBlurred) {
          const accessRequest = await ctx.db
            .query('privatePhotoAccessRequests')
            .withIndex('by_owner_viewer', (q) =>
              q.eq('ownerUserId', otherParticipantId).eq('viewerUserId', userId)
            )
            .first();

          if (accessRequest) {
            photoAccessStatus = accessRequest.status;
            canViewClearPhoto = accessRequest.status === 'approved';
          }
        }

        // P2-001 FIX: Use batch-fetched presence instead of N+1 query
        const participantLastActive = presenceMap.get(otherParticipantId as string) ?? 0;
        const lastMessageExpiredAt = lastMessage
          ? getPrivateSecureMediaExpiredAt(lastMessage, nowMs)
          : null;

        return {
          id: conversation._id,
          conversationId: conversation._id,
          matchId: conversation.matchId,
          participantId: otherParticipantId,
          participantName: displayName,
          participantAge: otherAge,
          participantPhotoUrl: photoUrl,
          // P2-001 FIX: Use pre-fetched presence (no N+1 query)
          participantLastActive,
          // P1-004 FIX: Include first privateIntentKey for intent label lookup
          // Backend stores array (multi-select), we take the first/primary one for display
          participantIntentKey: otherPrivateProfile?.privateIntentKeys?.[0] ?? null,
          lastMessage: getPrivateConversationPreviewContent(lastMessage, nowMs),
          lastMessageAt: lastMessage?.createdAt || conversation.createdAt,
          lastMessageSenderId: lastMessage?.senderId || null,
          lastMessageType: lastMessage?.type || null,
          lastMessageIsProtected: lastMessage?.isProtected === true && lastMessageExpiredAt === null,
          hasRealMessages: !!lastRealMessage,
          unreadCount,
          connectionSource: conversation.connectionSource || 'desire_match',
          createdAt: conversation.createdAt,
          // PHOTO ACCESS: New fields for privacy feature
          isPhotoBlurred,
          photoAccessStatus,
          canViewClearPhoto,
        };
      })
    );

    // Filter nulls and sort by last activity (most recent first)
    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .slice(0, requestedLimit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query B: Get Messages for a Phase-2 Conversation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get messages for a Phase-2 conversation.
 *
 * Identity is resolved from Mira's custom session token. authUserId is an assertion hint only.
 */
export const getPrivateMessages = query({
  args: {
    conversationId: v.id('privateConversations'),
    token: v.string(),
    authUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
    before: v.optional(v.number()), // For pagination: get messages before this timestamp
  },
  handler: async (ctx, { conversationId, token, authUserId, limit = 50, before }) => {
    const userId = await requirePrivateConversationActor(ctx, token, authUserId);

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return [];
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return [];
    }

    // Phase-2 privacy: sender-view-only masking for read receipts (1:1 only)
    let hideReadReceiptsFromViewer = false;
    if (conversation.participants.length === 2) {
      const otherIdForPrivacy = conversation.participants.find((pid) => pid !== userId) ?? null;
      if (otherIdForPrivacy) {
        const otherPrivateProfile = await ctx.db
          .query('userPrivateProfiles')
          .withIndex('by_user', (q) => q.eq('userId', otherIdForPrivacy))
          .first();
        hideReadReceiptsFromViewer = otherPrivateProfile?.disableReadReceipts === true;
      }
    }

    // P0-SAFETY: Block check - blocked users cannot read message history
    const otherParticipantId = conversation.participants.find((pid) => pid !== userId);
    if (!otherParticipantId) {
      return [];
    }
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      return []; // Fail closed - return empty, do not leak message history
    }
    const otherUser = await ctx.db.get(otherParticipantId);
    if (isUnavailableUser(otherUser)) {
      return [];
    }

    // Build query
    let messagesQuery = ctx.db
      .query('privateMessages')
      .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId));

    if (before) {
      messagesQuery = messagesQuery.filter((q) => q.lt(q.field('createdAt'), before));
    }

    // Fetch latest messages (desc order), then reverse for chronological display
    const messages = await messagesQuery.order('desc').take(limit);

    // PHASE-2 SECURE-MEDIA EXPIRY GATE: backend-derived expiry used to redact
    // playable URLs even when the frontend hasn't yet flipped `isExpired`.
    // Mirrors Phase-1 `getMediaUrl` which returns `{ url: null, isExpired: true }`
    // once the deadline passes. Belt-and-braces with the cron sweep below.
    const nowMs = Date.now();
    const visibleMessages = messages.filter(
      (m) =>
        !shouldHidePrivateTruthDareSystemMessage(m) &&
        !shouldHideExpiredPrivateSecureMedia(m, nowMs)
    );

    // P0-003: Batch-fetch audio URLs for voice messages (Phase-1 parity)
    const audioStorageIds = visibleMessages.filter((m) => m.audioStorageId).map((m) => m.audioStorageId!);
    const audioUrls = await Promise.all(
      audioStorageIds.map((id) => ctx.storage.getUrl(id))
    );
    const audioUrlMap = new Map(audioStorageIds.map((id, i) => [id as string, audioUrls[i]]));

    const visualMessages = visibleMessages.filter(
      (m) => isPrivateVisualMediaType(m.type) && !!m.imageStorageId
    );
    const visualViewRows = await Promise.all(
      visualMessages.map((m) =>
        ctx.db
          .query('privateMessageMediaViews')
          .withIndex('by_message_viewer', (q) =>
            q.eq('messageId', m._id).eq('viewerUserId', userId)
          )
          .first()
      )
    );
    const visualViewByMessageId = new Map(
      visualMessages.map((m, idx) => [m._id as string, visualViewRows[idx]])
    );

    // Return in chronological order with media URLs resolved
    return visibleMessages.reverse().map((m) => {
      const shouldHideReadAt =
        hideReadReceiptsFromViewer === true && m.senderId === userId;
      // Base message fields
      const baseMessage = {
        id: m._id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        // P2-TOD-CHAT-EVENTS: surface the system subtype so the client can
        // distinguish permanent vs transient T/D event chips.
        systemSubtype: m.systemSubtype,
        deliveredAt: m.deliveredAt,
        readAt: shouldHideReadAt ? undefined : m.readAt,
        createdAt: m.createdAt,
      };

      // Voice messages: include audio URL
      if (m.type === 'voice' && m.audioStorageId) {
        return {
          ...baseMessage,
          audioUrl: audioUrlMap.get(m.audioStorageId as string) ?? null,
          audioDurationMs: m.audioDurationMs,
        };
      }

      // Phase-2 visual media is protected by backend rule. List queries expose
      // only metadata; playable photo/video URLs are returned exclusively by
      // openPrivateSecureMedia.
      // Keep this branch even after the cleanup cron clears imageStorageId so
      // expired secure media renders as an expired card during its grace window
      // instead of falling through as a plain "Secure photo/video" message.
      if (isPrivateVisualMediaType(m.type)) {
        // PHASE-2 SECURE-MEDIA EXPIRY GATE: derive expiry from `isExpired`
        // (frontend-flipped) OR from `timerEndsAt <= now` (deadline elapsed
        // even if the client never round-tripped). When expired, never expose
        // the playable storage URL — the client will render the "Expired"
        // state via Phase2ProtectedMediaBubble (`isExpired` branch).
        const timerEnded =
          typeof m.timerEndsAt === 'number' && m.timerEndsAt <= nowMs;
        const expiredAt = getPrivateSecureMediaExpiredAt(m, nowMs);
        const viewerView = visualViewByMessageId.get(m._id as string);
        const viewerConsumed = !!viewerView || !!m.viewedAt;
        const isViewOnce = isPrivateSecureMediaViewOnce(m);
        const derivedExpired =
          !!m.isExpired || expiredAt !== null || timerEnded || (isViewOnce && viewerConsumed);
        return {
          ...baseMessage,
          isProtected: true,
          imageUrl: null,
          protectedMediaTimer: m.protectedMediaTimer ?? 0,
          viewOnce: isViewOnce,
          protectedMediaViewingMode: m.protectedMediaViewingMode ?? 'tap',
          protectedMediaIsMirrored: m.protectedMediaIsMirrored,
          viewedAt: viewerView?.viewedAt ?? m.viewedAt,
          timerEndsAt: m.timerEndsAt,
          isExpired: derivedExpired,
          expiredAt: expiredAt ?? m.expiredAt,
        };
      }

      // Regular messages
      return baseMessage;
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation C: Mark Phase-2 Messages as Read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark all unread messages in a Phase-2 conversation as read.
 *
 * Security: Uses token-based auth, verifies user is participant
 */
export const markPrivateMessagesRead = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, args) => {
    const { token, conversationId } = args;
    const now = Date.now();

    // Validate session and get current user
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      throw new Error('Not authorized');
    }

    // P0-SAFETY: Block check - blocked users cannot mark messages as read
    const otherParticipantId = conversation.participants.find((pid) => pid !== userId);
    if (!otherParticipantId) {
      return { success: true, markedCount: 0 };
    }
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      throw new Error('Access denied');
    }
    {
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) {
        return { success: true, markedCount: 0 };
      }
    }

    // Get all unread messages sent by others
    const unreadMessages = await ctx.db
      .query('privateMessages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('readAt'), undefined)
        )
      )
      .collect();

    // Mark each message as read
    for (const message of unreadMessages) {
      await ctx.db.patch(message._id, { readAt: now });
    }

    // Update participant's unread count to 0
    const participantRecord = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (participantRecord && participantRecord.unreadCount > 0) {
      await ctx.db.patch(participantRecord._id, { unreadCount: 0 });
    }

    // Clear Phase-2 private-message inbox row in privateNotifications table
    await markPrivateMessageNotificationsForConversation(ctx, userId, conversationId as string);

    return { success: true, markedCount: unreadMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation D: Send a Phase-2 Message
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a message in a Phase-2 conversation.
 *
 * Security: Uses token-based auth, verifies user is participant, rate limits
 */
export const sendPrivateMessage = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('voice'), v.literal('system')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    // P1-001: Protected media fields for secure photos/videos
    isProtected: v.optional(v.boolean()),
    protectedMediaTimer: v.optional(v.number()),
    viewOnce: v.optional(v.boolean()),
    protectedMediaViewingMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    protectedMediaIsMirrored: v.optional(v.boolean()),
    clientMessageId: v.optional(v.string()), // Idempotency key
  },
  handler: async (ctx, args) => {
    const {
      token, conversationId, type, content, imageStorageId, audioStorageId, audioDurationMs,
      isProtected, protectedMediaTimer, viewOnce, protectedMediaViewingMode, protectedMediaIsMirrored,
      clientMessageId
    } = args;
    const now = Date.now();

    // Validate session and get current user
    const senderId = await validateSessionToken(ctx, token);
    if (!senderId) {
      throw new Error('Unauthorized: invalid or expired session');
    }

    // Message length limit
    if (content.length > 5000) {
      throw new Error('Message too long');
    }

    // Idempotency check: prevent duplicate messages on retry
    if (clientMessageId) {
      const existing = await ctx.db
        .query('privateMessages')
        .withIndex('by_conversation_clientMessageId', (q) =>
          q.eq('conversationId', conversationId).eq('clientMessageId', clientMessageId)
        )
        .first();
      if (existing) {
        return { success: true, messageId: existing._id, duplicate: true };
      }
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(senderId)) {
      throw new Error('Not authorized');
    }

    // Check if blocked
    const recipientId = conversation.participants.find((id) => id !== senderId);
    if (recipientId && await isBlockedBidirectional(ctx, senderId, recipientId)) {
      throw new Error('Cannot send message');
    }
    if (!recipientId) {
      throw new Error('Conversation closed');
    }

    const recipient = await ctx.db.get(recipientId);
    if (isUnavailableUser(recipient)) {
      throw new Error('Conversation closed');
    }

    // Rate limiting: 10 messages per minute per sender per conversation
    // T/D SYSTEM MESSAGES: Skip rate limiting for system messages (game events)
    if (type !== 'system') {
      const oneMinuteAgo = now - 60000;
      const recentMessages = await ctx.db
        .query('privateMessages')
        .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId))
        .filter((q) =>
          q.and(
            q.eq(q.field('senderId'), senderId),
            q.gt(q.field('createdAt'), oneMinuteAgo)
          )
        )
        .take(10);
      if (recentMessages.length >= 10) {
        throw new Error('You are sending messages too quickly');
      }
    }

    // Verify sender exists and is active
    const sender = await ctx.db.get(senderId);
    if (isUnavailableUser(sender)) {
      throw new Error('Sender not found or inactive');
    }

    // P0-002: Soft-mask sensitive words in text messages (Phase-1 parity)
    const maskedContent = type === 'text' ? softMaskText(content) : content;

    const isVisualMedia = isPrivateVisualMediaType(type);
    if (isVisualMedia) {
      if (!imageStorageId) {
        throw new Error('Visual media messages require a storage reference');
      }
      await verifyOrClaimPrivateMessageMediaOwnership(ctx, imageStorageId, senderId, type);
      await validatePrivateMessageMediaMetadata(ctx, imageStorageId, type);
    } else if (imageStorageId) {
      throw new Error('Image storage reference is only valid for photo/video messages');
    }

    if (audioStorageId) {
      if (type !== 'voice') {
        throw new Error('Audio storage reference is only valid for voice messages');
      }
      await verifyOrClaimPrivateMessageMediaOwnership(ctx, audioStorageId, senderId, 'audio');
      await validatePrivateMessageMediaMetadata(ctx, audioStorageId, 'audio');
    }

    if (
      protectedMediaTimer !== undefined &&
      !PRIVATE_PROTECTED_MEDIA_TIMERS.has(protectedMediaTimer)
    ) {
      throw new Error('Invalid protected media timer');
    }

    const normalizedViewOnce = isVisualMedia ? viewOnce === true : viewOnce;
    const normalizedIsProtected = isVisualMedia ? true : isProtected;
    const normalizedProtectedMediaTimer = isVisualMedia
      ? normalizedViewOnce
        ? 0
        : protectedMediaTimer ?? 0
      : protectedMediaTimer;
    const normalizedProtectedMediaViewingMode =
      isVisualMedia ? 'tap' : protectedMediaViewingMode;
    const normalizedProtectedMediaIsMirrored =
      isVisualMedia ? !!protectedMediaIsMirrored : protectedMediaIsMirrored;

    // Insert message into privateMessages table
    // Phase-2 visual media is always protected. Audio stays replayable.
    const messageId = await ctx.db.insert('privateMessages', {
      conversationId,
      senderId,
      type,
      content: maskedContent,
      imageStorageId,
      audioStorageId,
      audioDurationMs,
      isProtected: normalizedIsProtected,
      protectedMediaTimer: normalizedProtectedMediaTimer,
      viewOnce: normalizedViewOnce,
      protectedMediaViewingMode: normalizedProtectedMediaViewingMode,
      protectedMediaIsMirrored: normalizedProtectedMediaIsMirrored,
      createdAt: now,
      clientMessageId,
    });

    const isRealUserMessage =
      COUNTABLE_MESSAGE_TYPES.includes(type) &&
      (type !== 'text' || maskedContent.trim().length > 0);

    if (recipientId && isRealUserMessage && !conversation.firstMutualReplyAt) {
      const previousPeerMessage = await ctx.db
        .query('privateMessages')
        .withIndex('by_conversation_created', (q) => q.eq('conversationId', conversationId))
        .filter((q) =>
          q.and(
            q.eq(q.field('senderId'), recipientId),
            q.lt(q.field('createdAt'), now),
            q.or(
              q.eq(q.field('type'), 'text'),
              q.eq(q.field('type'), 'image'),
              q.eq(q.field('type'), 'video'),
              q.eq(q.field('type'), 'voice')
            )
          )
        )
        .first();

      if (previousPeerMessage) {
        await awardWalletCoins(ctx, {
          userId: senderId,
          delta: 1,
          reason: 'p2_mutual_reply',
          sourceType: 'privateConversation',
          sourceId: conversationId as string,
          peerUserId: recipientId,
          dedupeKey: `p2_mutual_reply:${conversationId}:${senderId}`,
          createdAt: now,
        });
        await awardWalletCoins(ctx, {
          userId: recipientId,
          delta: 1,
          reason: 'p2_mutual_reply',
          sourceType: 'privateConversation',
          sourceId: conversationId as string,
          peerUserId: senderId,
          dedupeKey: `p2_mutual_reply:${conversationId}:${recipientId}`,
          createdAt: now,
        });
        await ctx.db.patch(conversationId, { firstMutualReplyAt: now });
      }
    }

    // Update conversation's lastMessageAt
    await ctx.db.patch(conversationId, { lastMessageAt: now });

    // Update recipient's unread count
    if (recipientId) {
      const recipientParticipant = await ctx.db
        .query('privateConversationParticipants')
        .withIndex('by_user_conversation', (q) =>
          q.eq('userId', recipientId).eq('conversationId', conversationId)
        )
        .first();

      if (recipientParticipant) {
        await ctx.db.patch(recipientParticipant._id, {
          unreadCount: recipientParticipant.unreadCount + 1,
        });
      }
    }

    // Phase-2 in-app notification (recipient only).
    // STRICT ISOLATION: Phase-2 rows live in `privateNotifications` only.
    if (recipientId && type !== 'system') {
      if (await shouldCreatePhase2PrivateMessagesNotification(ctx, recipientId)) {
        const dedupeKey = `phase2_message:${conversationId}:unread`;
        const existingNotif = await ctx.db
          .query('privateNotifications')
          .withIndex('by_user_dedupe', (q) =>
            q.eq('userId', recipientId).eq('dedupeKey', dedupeKey)
          )
          .first();

        const notificationBody = 'You have a new message';
        // ANON-LOADING-FIX: getPhase2DisplayName may now return null when the
        // sender's private profile is missing. Use a graceful generic label so
        // notification text never reads "null sent you a message" or leaks the
        // intentional-mode-only word "Anonymous".
        const senderLabel = (await getPhase2DisplayName(ctx, senderId)) ?? 'Someone';

        if (existingNotif) {
          await ctx.db.patch(existingNotif._id, {
            title: `${senderLabel} sent you a message`,
            body: notificationBody,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
            readAt: undefined,
          });
        } else {
          await ctx.db.insert('privateNotifications', {
            userId: recipientId,
            type: 'phase2_private_message',
            title: `${senderLabel} sent you a message`,
            body: notificationBody,
            data: {
              privateConversationId: conversationId as string,
              otherUserId: senderId as string,
            },
            phase: 'phase2',
            dedupeKey,
            createdAt: now,
            expiresAt: now + 24 * 60 * 60 * 1000,
          });
        }
      }
    }

    return { success: true, messageId, duplicate: false };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query E: Get Single Conversation Details
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get details of a single Phase-2 conversation.
 *
 * Identity is resolved from Mira's custom session token. authUserId is an assertion hint only.
 */
export const getPrivateConversation = query({
  args: {
    conversationId: v.id('privateConversations'),
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, token, authUserId }) => {
    const userId = await requirePrivateConversationActor(ctx, token, authUserId);

    // Get conversation
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return null;
    }

    // SECURITY: Verify user is participant (IDOR prevention)
    const isParticipant = conversation.participants.includes(userId);
    if (!isParticipant) {
      return null;
    }

    // LEAVE CONVERSATION FIX: Check if user has hidden this conversation
    const userParticipation = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (userParticipation?.isHidden === true) {
      return null;
    }

    // Get other participant info
    const otherParticipantId = conversation.participants.find((pid) => pid !== userId);
    if (!otherParticipantId) {
      return buildClosedPrivateConversationPayload(conversation, null);
    }

    // Check block status
    const isBlocked = await isBlockedBidirectional(ctx, userId, otherParticipantId);

    const otherUser = await ctx.db.get(otherParticipantId);
    if (isUnavailableUser(otherUser)) {
      return buildClosedPrivateConversationPayload(
        conversation,
        otherParticipantId
      );
    }

    const otherPrivateProfile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
      .first();

    // Get participant record for unread count
    const participantRecord = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    const safePrivatePhotoUrls = otherPrivateProfile
      ? await filterOwnedSafePrivatePhotoUrls(
          ctx,
          otherParticipantId,
          otherPrivateProfile.privatePhotoUrls ?? [],
        )
      : [];
    const photoUrl = safePrivatePhotoUrls[0] ?? null;

    // PHASE-2 PRIVACY FIX: ALWAYS use handle from users table, never stored displayName
    // Stored displayName may contain old full names from before the fix
    // Phase-2 must NEVER expose first name or last name
    // ANON-LOADING-FIX: emit null (not the literal string "Anonymous") when
    // both displayName and handle are missing. The client must render a
    // loading placeholder; "Anonymous" is reserved for intentional
    // anonymous product modes only.
    const displayName =
      otherPrivateProfile?.displayName ||
      otherUser?.handle ||
      null;

    // ═══════════════════════════════════════════════════════════════════════════
    // PHOTO ACCESS CONTROL: Check if other user has blur enabled and access status
    // ═══════════════════════════════════════════════════════════════════════════
    const hasBlurredPhotos = (otherPrivateProfile?.privatePhotosBlurred?.length ?? 0) > 0;
    const hasBlurLevel = (otherPrivateProfile?.privatePhotoBlurLevel ?? 0) > 0;
    const isPhotoBlurred = hasBlurredPhotos || hasBlurLevel;

    // Check photo access request status
    let photoAccessStatus: 'none' | 'pending' | 'approved' | 'declined' = 'none';
    let canViewClearPhoto = !isPhotoBlurred; // If not blurred, can always view clear

    if (isPhotoBlurred) {
      const accessRequest = await ctx.db
        .query('privatePhotoAccessRequests')
        .withIndex('by_owner_viewer', (q) =>
          q.eq('ownerUserId', otherParticipantId).eq('viewerUserId', userId)
        )
        .first();

      if (accessRequest) {
        photoAccessStatus = accessRequest.status;
        canViewClearPhoto = accessRequest.status === 'approved';
      }
    }

    // P2_PRESENCE_FIX: Read from privateUserPresence table (NOT users.lastActive)
    // This ensures symmetric presence display between messages list and chat header
    const otherUserPresence = await ctx.db
      .query('privateUserPresence')
      .withIndex('by_user', (q) => q.eq('userId', otherParticipantId))
      .first();
    const participantLastActive = otherUserPresence?.lastActiveAt ?? 0;

    return {
      id: conversation._id,
      matchId: conversation.matchId,
      participantId: otherParticipantId,
      participantName: displayName,
      participantPhotoUrl: photoUrl,
      // P2_PRESENCE_FIX: Read from privateUserPresence table for correct online status
      participantLastActive,
      // P1-004 FIX: Include first privateIntentKey for intent label lookup
      // Backend stores array (multi-select), we take the first/primary one for display
      participantIntentKey: otherPrivateProfile?.privateIntentKeys?.[0] ?? null,
      unreadCount: participantRecord?.unreadCount || 0,
      connectionSource: conversation.connectionSource || 'desire_match',
      createdAt: conversation.createdAt,
      isBlocked,
      // PHOTO ACCESS: New fields for privacy feature
      isPhotoBlurred,
      photoAccessStatus,
      canViewClearPhoto,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Query F: Get Total Unread Count (for badge)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get total unread message count across all Phase-2 conversations.
 * Used for notification badges.
 *
 * Identity is resolved from Mira's custom session token. authUserId is an assertion hint only.
 */
export const getTotalUnreadCount = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requirePrivateConversationActor(ctx, token, authUserId);

    const participations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    let totalUnreadCount = 0;
    for (const participation of participations) {
      if (participation.isHidden === true || participation.unreadCount <= 0) {
        continue;
      }
      const conversation = await ctx.db.get(participation.conversationId);
      if (!conversation || !conversation.participants.includes(userId)) {
        continue;
      }
      const otherParticipantId = conversation.participants.find(
        (pid) => pid !== userId
      );
      if (!otherParticipantId) continue;
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) continue;
      if (await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
        continue;
      }
      totalUnreadCount += participation.unreadCount;
    }

    return totalUnreadCount;
  },
});

export const getPrivateUnreadConversationCount = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requirePrivateConversationActor(ctx, token, authUserId);

    const participations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    const unreadParticipations = participations.filter(
      (p) => p.isHidden !== true && p.unreadCount > 0
    );

    const countedConversationIds = new Set<string>();
    let unreadConversationCount = 0;

    for (const participation of unreadParticipations) {
      const conversationId = participation.conversationId as string;
      if (countedConversationIds.has(conversationId)) continue;

      const conversation = await ctx.db.get(participation.conversationId);
      if (!conversation) continue;
      if (!conversation.participants.includes(userId)) continue;

      const otherParticipantId = conversation.participants.find((pid) => pid !== userId);
      if (!otherParticipantId) continue;
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) continue;
      if (await isBlockedBidirectional(ctx, userId, otherParticipantId)) continue;

      const realUnreadCount = await computeUnreadCountFromPrivateMessages(
        ctx,
        participation.conversationId,
        userId
      );
      if (realUnreadCount > 0) {
        unreadConversationCount += 1;
        countedConversationIds.add(conversationId);
      }
    }

    return unreadConversationCount;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation G: Mark Phase-2 Messages as Delivered (per conversation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark all undelivered incoming messages in a Phase-2 conversation as delivered.
 * Called when user opens a conversation.
 *
 * MESSAGE-TICKS-FIX: Follows Phase-1 pattern exactly
 * Security: Uses token-based auth, verifies user is participant
 */
export const markPrivateMessagesDelivered = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, args) => {
    const { token, conversationId } = args;
    const now = Date.now();

    // Validate session and get current user
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, count: 0 };
    }

    // Get conversation and verify user is participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return { success: false, count: 0 };
    }

    // SECURITY: Verify user is part of this conversation (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return { success: false, count: 0 };
    }

    // P0-SAFETY: Block check - blocked users cannot mark messages as delivered
    const otherParticipantId = conversation.participants.find((pid) => pid !== userId);
    if (!otherParticipantId) {
      return { success: true, count: 0 };
    }
    if (otherParticipantId && await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
      return { success: false, count: 0 };
    }
    {
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) {
        return { success: true, count: 0 };
      }
    }

    // Get all messages from OTHER user that are not yet delivered
    const undeliveredMessages = await ctx.db
      .query('privateMessages')
      .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
      .filter((q) =>
        q.and(
          q.neq(q.field('senderId'), userId),
          q.eq(q.field('deliveredAt'), undefined)
        )
      )
      .collect();

    // Mark each message as delivered
    for (const message of undeliveredMessages) {
      await ctx.db.patch(message._id, { deliveredAt: now });
    }

    return { success: true, count: undeliveredMessages.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation H: Mark ALL Phase-2 Messages as Delivered (bulk)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark ALL incoming messages as delivered across all Phase-2 conversations.
 * Called when Messages list loads (before opening any conversation).
 *
 * DELIVERED-TICK-FIX: Ensures "delivered" state is set when message reaches device,
 * not when conversation is opened. Follows Phase-1 pattern exactly.
 *
 * authUserId is an assertion hint; token remains the identity source.
 */
export const markAllPrivateMessagesDelivered = mutation({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { token, authUserId } = args;
    const now = Date.now();

    const userId = await requirePrivateConversationActor(ctx, token, authUserId);

    // Get all conversations this user is part of
    const participations = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    let totalMarked = 0;

    // Mark all undelivered messages in each conversation
    for (const participation of participations) {
      if (participation.isHidden === true) continue;
      const conversation = await ctx.db.get(participation.conversationId);
      if (!conversation || !conversation.participants.includes(userId)) {
        continue;
      }
      const otherParticipantId = conversation.participants.find(
        (pid) => pid !== userId
      );
      if (!otherParticipantId) continue;
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) continue;
      if (await isBlockedBidirectional(ctx, userId, otherParticipantId)) {
        continue;
      }

      const undeliveredMessages = await ctx.db
        .query('privateMessages')
        .withIndex('by_conversation', (q) => q.eq('conversationId', participation.conversationId))
        .filter((q) =>
          q.and(
            q.neq(q.field('senderId'), userId),
            q.eq(q.field('deliveredAt'), undefined)
          )
        )
        .collect();

      for (const message of undeliveredMessages) {
        await ctx.db.patch(message._id, { deliveredAt: now });
        totalMarked++;
      }
    }

    return { success: true, count: totalMarked };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// P0-001: Delete Private Message
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete a private message.
 * Matches Phase-1 deleteMessage behavior exactly:
 * - Only the sender can delete their own message
 * - User must be a participant in the conversation
 * - Deletes associated storage (images, audio)
 * - Hard deletes the message record
 */
export const deletePrivateMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, args) => {
    const { token, messageId } = args;

    // Validate session token and get user ID
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid session');
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      // Message already deleted or doesn't exist
      return { success: true, alreadyDeleted: true };
    }

    // Verify sender owns this message
    if (message.senderId !== userId) {
      throw new Error('Unauthorized: you can only delete your own messages');
    }

    // Verify user is part of the conversation
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Unauthorized: conversation not found or access denied');
    }

    // Delete any associated storage (images, voice, etc.)
    if (message.imageStorageId) {
      try {
        await ctx.storage.delete(message.imageStorageId);
      } catch (e) {
        // Storage may already be deleted, continue
        console.warn('[deletePrivateMessage] Failed to delete image storage:', e);
      }
    }
    if (message.audioStorageId) {
      try {
        await ctx.storage.delete(message.audioStorageId);
      } catch (e) {
        console.warn('[deletePrivateMessage] Failed to delete audio storage:', e);
      }
    }

    // Hard delete the message
    await ctx.db.delete(messageId);

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPIRED MEDIA CLEANUP: System cleanup mutation for expired secure media
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cleanup expired private media messages.
 * This is a SYSTEM cleanup operation (not user-initiated deletion).
 *
 * Rules:
 * - Either participant can trigger cleanup (not restricted to sender)
 * - Message must be expired (isExpired === true)
 * - Timer must have ended (timerEndsAt <= now)
 *
 * This is separate from deletePrivateMessage which is for user-initiated deletion.
 */
export const cleanupExpiredPrivateMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, args) => {
    const { token, messageId } = args;

    // Validate session token and get user ID
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid session');
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      // Message already deleted or doesn't exist - success (idempotent)
      return { success: true, alreadyDeleted: true };
    }

    // Verify user is a PARTICIPANT in the conversation (not necessarily sender)
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new Error('Unauthorized: conversation not found or access denied');
    }

    // Verify message is eligible for cleanup:
    // 1. Must be protected media
    // 2. Must be expired
    // 3. Timer must have ended
    if (!message.isProtected) {
      throw new Error('Invalid: only protected media can be cleaned up');
    }
    if (!message.isExpired) {
      throw new Error('Invalid: message is not expired');
    }
    if (message.timerEndsAt && message.timerEndsAt > Date.now()) {
      throw new Error('Invalid: timer has not ended yet');
    }

    // Delete any associated storage (images, videos)
    if (message.imageStorageId) {
      try {
        await ctx.storage.delete(message.imageStorageId);
      } catch (e) {
        // Storage may already be deleted, continue
        console.warn('[cleanupExpiredPrivateMessage] Failed to delete storage:', e);
      }
    }

    // Hard delete the message
    await ctx.db.delete(messageId);

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// P1-001: Generate Upload URL for Phase-2 Secure Media
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a presigned upload URL for Phase-2 secure media.
 * Used by incognito-chat.tsx to upload protected photos/videos to Convex storage.
 *
 * Security: Requires valid session token
 */
export const generateSecureMediaUploadUrl = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      throw new Error('Unauthorized: invalid session');
    }

    // Generate upload URL
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return uploadUrl;
  },
});

export const openPrivateSecureMedia = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, { token, messageId }) => {
    const viewerUserId = await validateSessionToken(ctx, token);
    if (!viewerUserId) {
      return { status: 'unauthorized' as const };
    }

    const message = await ctx.db.get(messageId);
    if (!message || !isPrivateVisualMediaType(message.type)) {
      return { status: 'no_media' as const };
    }

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(viewerUserId)) {
      return { status: 'not_authorized' as const };
    }

    if (message.senderId === viewerUserId) {
      return { status: 'not_authorized' as const };
    }

    const recipientIds = conversation.participants.filter((id) => id !== message.senderId);
    if (!recipientIds.includes(viewerUserId)) {
      return { status: 'not_authorized' as const };
    }

    const otherParticipantId = conversation.participants.find((id) => id !== viewerUserId);
    if (
      otherParticipantId &&
      await isBlockedBidirectional(ctx, viewerUserId, otherParticipantId)
    ) {
      return { status: 'not_authorized' as const };
    }
    if (otherParticipantId) {
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) {
        return { status: 'not_authorized' as const };
      }
    }

    if (!message.imageStorageId) {
      return { status: 'no_media' as const };
    }

    const isViewOnce = isPrivateSecureMediaViewOnce(message);
    const protectedMediaTimer = isViewOnce
      ? 0
      : message.protectedMediaTimer ?? 0;
    const timerEnded =
      typeof message.timerEndsAt === 'number' && message.timerEndsAt <= Date.now();
    if (message.isExpired || timerEnded) {
      return { status: 'no_media' as const };
    }

    const existingView = await ctx.db
      .query('privateMessageMediaViews')
      .withIndex('by_message_viewer', (q) =>
        q.eq('messageId', messageId).eq('viewerUserId', viewerUserId)
      )
      .first();
    if (isViewOnce && (existingView || message.viewedAt)) {
      return { status: 'already_viewed' as const };
    }

    const url = await ctx.storage.getUrl(message.imageStorageId);
    if (!url) {
      return { status: 'no_media' as const };
    }

    return {
      status: 'ok' as const,
      url,
      mediaType: message.type,
      viewedAt: existingView?.viewedAt ?? message.viewedAt,
      timerEndsAt: message.timerEndsAt,
      protectedMediaTimer,
      viewOnce: isViewOnce,
      protectedMediaViewingMode: (message.protectedMediaViewingMode ?? 'tap') as 'tap' | 'hold',
      protectedMediaIsMirrored: !!message.protectedMediaIsMirrored,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LEAVE CONVERSATION: Hide conversation for current user only
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Leave (hide) a Phase-2 conversation.
 *
 * This hides the conversation from the current user's view only.
 * The other participant can still see the conversation normally.
 * This is NOT a delete - the conversation and messages remain intact.
 *
 * Behavior:
 * - Sets isHidden=true on the user's participation record
 * - Conversation won't appear in getUserPrivateConversations for this user
 * - Other user's view is unaffected
 * - Idempotent: calling multiple times is safe
 */
export const leavePrivateConversation = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
  },
  handler: async (ctx, { token, conversationId }) => {
    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the conversation to verify it exists
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) {
      return { success: false, error: 'conversation_not_found' };
    }

    // SECURITY: Verify user is a participant (IDOR prevention)
    if (!conversation.participants.includes(userId)) {
      return { success: false, error: 'not_participant' };
    }

    // Find the user's participation record
    const participation = await ctx.db
      .query('privateConversationParticipants')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (!participation) {
      // Participation record doesn't exist - shouldn't happen but handle gracefully
      return { success: false, error: 'participation_not_found' };
    }

    // Mark as hidden (idempotent - safe to call multiple times)
    await ctx.db.patch(participation._id, {
      isHidden: true,
    });

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-1 PARITY: Mark Phase-2 Secure Media as Viewed
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a Phase-2 secure media message as viewed.
 * Sets viewedAt and timerEndsAt on first view.
 *
 * Phase-1 parity: Follows protectedMedia.markViewed pattern exactly
 */
export const markPrivateSecureMediaViewed = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, { token, messageId }) => {
    const now = Date.now();

    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      return { success: false, error: 'message_not_found' };
    }

    // Verify user is a participant in the conversation
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false, error: 'not_authorized' };
    }
    const otherParticipantId = conversation.participants.find((id) => id !== userId);
    if (otherParticipantId) {
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) {
        return { success: false, error: 'conversation_closed' };
      }
    }

    if (!isPrivateVisualMediaType(message.type)) {
      return { success: false, error: 'not_visual_media' };
    }

    if (message.senderId === userId) {
      return { success: false, error: 'not_authorized' };
    }

    const existingView = await ctx.db
      .query('privateMessageMediaViews')
      .withIndex('by_message_viewer', (q) =>
        q.eq('messageId', messageId).eq('viewerUserId', userId)
      )
      .first();

    const isViewOnce = isPrivateSecureMediaViewOnce(message);
    const protectedMediaTimer = isViewOnce
      ? 0
      : message.protectedMediaTimer ?? 0;
    if (!PRIVATE_PROTECTED_MEDIA_TIMERS.has(protectedMediaTimer)) {
      return { success: false, error: 'invalid_timer' };
    }

    const timerEnded =
      typeof message.timerEndsAt === 'number' && message.timerEndsAt <= now;
    if (message.isExpired || timerEnded) {
      return {
        success: false,
        error: 'expired',
        viewedAt: existingView?.viewedAt ?? message.viewedAt,
        timerEndsAt: message.timerEndsAt,
      };
    }

    // Skip if already viewed (idempotent), but preserve/repair a timed
    // deadline so reopen resumes the same countdown instead of resetting.
    if (existingView || message.viewedAt) {
      let timerEndsAt = message.timerEndsAt;
      const patch: { viewedAt?: number; timerEndsAt?: number } = {};

      if (!message.viewedAt) {
        patch.viewedAt = existingView?.viewedAt ?? now;
      }
      if (protectedMediaTimer > 0 && !timerEndsAt) {
        timerEndsAt = now + protectedMediaTimer * 1000;
        patch.timerEndsAt = timerEndsAt;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(messageId, patch);
      }

      return {
        success: true,
        alreadyViewed: true,
        viewedAt: existingView?.viewedAt ?? message.viewedAt ?? patch.viewedAt,
        timerEndsAt,
      };
    }

    await ctx.db.insert('privateMessageMediaViews', {
      messageId,
      viewerUserId: userId,
      viewedAt: now,
    });

    const timerEndsAt =
      protectedMediaTimer > 0 ? now + protectedMediaTimer * 1000 : undefined;
    await ctx.db.patch(messageId, {
      viewedAt: now,
      ...(timerEndsAt ? { timerEndsAt } : {}),
    });

    return { success: true, viewedAt: now, timerEndsAt };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-1 PARITY: Mark Phase-2 Secure Media as Expired
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a Phase-2 secure media message as expired.
 * Called when timer runs out or view-once photo is closed.
 *
 * Phase-1 parity: Follows protectedMedia.markExpired pattern exactly
 */
export const markPrivateSecureMediaExpired = mutation({
  args: {
    token: v.string(),
    messageId: v.id('privateMessages'),
  },
  handler: async (ctx, { token, messageId }) => {
    const now = Date.now();

    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return { success: false, error: 'unauthorized' };
    }

    // Get the message
    const message = await ctx.db.get(messageId);
    if (!message) {
      return { success: false, error: 'message_not_found' };
    }

    // Verify user is a participant in the conversation
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false, error: 'not_authorized' };
    }
    const otherParticipantId = conversation.participants.find((id) => id !== userId);
    if (otherParticipantId) {
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) {
        return { success: false, error: 'conversation_closed' };
      }
    }

    // Skip if already expired (idempotent)
    if (message.isExpired) {
      if (!message.expiredAt) {
        await ctx.db.patch(messageId, {
          expiredAt: message.timerEndsAt ?? now,
        });
      }
      return { success: true, alreadyExpired: true };
    }

    // Update the message
    await ctx.db.patch(messageId, {
      isExpired: true,
      expiredAt: message.timerEndsAt ?? now,
    });

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-2 PARITY: Backend cron sweep for expired secure media
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal cron-driven sweep that enforces Phase-2 secure-media expiry on the
 * backend (i.e. independent of any frontend timer). Mirrors the Phase-1
 * `protectedMedia.cleanupExpiredMedia` cron but operates STRICTLY on Phase-2
 * tables: only `privateMessages` rows are read/patched, and only their own
 * `imageStorageId` blob is deleted from storage. Phase-1 tables (`media`,
 * `mediaPermissions`) are NEVER touched here.
 *
 * Eligibility (per row):
 *   - `isProtected === true`
 *   - `imageStorageId` still set (i.e. not already redacted)
 *   - either `isExpired === true` (frontend already flipped) OR
 *     `timerEndsAt !== undefined && timerEndsAt <= now` (deadline elapsed).
 *
 * Action:
 *   - delete the storage blob (best-effort; cron will retry next minute)
 *   - patch the message: clear `imageStorageId`, set `isExpired = true`.
 *
 * The message row itself is intentionally retained so the chat history stays
 * chronologically consistent and the recipient sees the "Expired" placeholder
 * card; user-initiated removal still flows through the existing
 * `cleanupExpiredPrivateMessage` (which hard-deletes the row).
 *
 * Wired from `convex/crons.ts` at 1-minute interval, satisfying the
 * "within ~1 minute after expiry" cleanup expectation for Phase-2.
 */
export const cleanupExpiredPrivateProtectedMedia = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const messages = await ctx.db.query('privateMessages').collect();

    let scannedCount = 0;
    let redactedCount = 0;
    let storageDeletedCount = 0;
    let storageDeleteFailures = 0;

    for (const m of messages) {
      if (!m.isProtected) continue;
      if (!m.imageStorageId) continue; // already redacted in a previous sweep
      scannedCount += 1;

      const timerEnded =
        typeof m.timerEndsAt === 'number' && m.timerEndsAt <= now;
      const eligible = !!m.isExpired || timerEnded;
      if (!eligible) continue;

      // Best-effort storage deletion; mirrors Phase-1 finalizeExpiredMedia.
      try {
        await ctx.storage.delete(m.imageStorageId);
        storageDeletedCount += 1;
      } catch (e) {
        storageDeleteFailures += 1;
        console.warn(
          '[cleanupExpiredPrivateProtectedMedia] storage.delete failed',
          {
            messageId: (m._id as string)?.slice(-8),
            error: String((e as any)?.message ?? e),
          }
        );
      }

      // Redact the message: clear blob reference and mark expired so the
      // query never resolves a URL for this row again.
      await ctx.db.patch(m._id, {
        imageStorageId: undefined,
        isExpired: true,
        expiredAt: m.expiredAt ?? (timerEnded ? m.timerEndsAt : now),
      });
      redactedCount += 1;
    }

    return {
      success: true,
      scannedCount,
      redactedCount,
      storageDeletedCount,
      storageDeleteFailures,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE: Update user's lastActive timestamp (ISOLATED TABLE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update user's presence (lastActive timestamp).
 * Called on:
 * - App open
 * - Chat open
 * - Message send
 * - Periodic heartbeat (every 15s)
 *
 * CRITICAL: Uses ISOLATED privateUserPresence table, NOT users table.
 * This maintains strict Phase-2 isolation.
 */
export const updatePresence = mutation({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { token, authUserId }) => {
    const userId = await requirePrivateConversationActor(ctx, token, authUserId);
    const user = await ctx.db.get(userId);
    if (isUnavailableUser(user)) {
      return { success: false, error: 'user_unavailable' };
    }

    const now = Date.now();

    // Check if presence record exists
    const existing = await ctx.db
      .query('privateUserPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        lastActiveAt: now,
        updatedAt: now,
      });
    } else {
      // Create new presence record
      await ctx.db.insert('privateUserPresence', {
        userId,
        lastActiveAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Get presence for a user (used by conversations query).
 * Returns lastActiveAt from privateUserPresence table.
 */
export const getPresence = query({
  args: {
    token: v.string(),
    authUserId: v.optional(v.string()),
    userId: v.id('users'),
  },
  handler: async (ctx, { token, authUserId, userId }) => {
    const viewerId = await requirePrivateConversationActor(ctx, token, authUserId);
    if (!(await usersShareActivePrivateConversation(ctx, viewerId, userId))) {
      return 0;
    }

    const user = await ctx.db.get(userId);
    if (isUnavailableUser(user)) {
      return 0;
    }

    const presence = await ctx.db
      .query('privateUserPresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    return presence?.lastActiveAt ?? 0;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// P1-004 FIX: Phase-2 Typing Indicators
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set typing status for a user in a Phase-2 conversation.
 * Called when user starts/stops typing.
 * Uses upsert pattern to avoid creating duplicate rows.
 */
export const setPrivateTypingStatus = mutation({
  args: {
    token: v.string(),
    conversationId: v.id('privateConversations'),
    isTyping: v.boolean(),
  },
  handler: async (ctx, { token, conversationId, isTyping }) => {
    const now = Date.now();

    // Validate session
    const userId = await validateSessionToken(ctx, token);
    if (!userId) return { success: false };

    // Verify user is participant (IDOR prevention)
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { success: false };
    }
    const otherParticipantId = conversation.participants.find((id) => id !== userId);
    if (otherParticipantId) {
      const otherUser = await ctx.db.get(otherParticipantId);
      if (isUnavailableUser(otherUser)) {
        return { success: false };
      }
    }

    // Upsert typing status
    const existing = await ctx.db
      .query('privateTypingStatus')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', userId).eq('conversationId', conversationId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { isTyping, updatedAt: now });
    } else {
      await ctx.db.insert('privateTypingStatus', {
        conversationId,
        userId,
        isTyping,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Get typing status for the other participant in a Phase-2 conversation.
 * Returns isTyping: true if the other user is actively typing (updated within last 5s).
 */
export const getPrivateTypingStatus = query({
  args: {
    conversationId: v.id('privateConversations'),
    token: v.string(),
    authUserId: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, token, authUserId }) => {
    const now = Date.now();
    const TYPING_TIMEOUT = 5000; // 5 seconds

    const userId = await requirePrivateConversationActor(ctx, token, authUserId);

    // Get conversation to find the other participant
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return { isTyping: false };
    }

    // Find the other participant
    const otherUserId = conversation.participants.find((id) => id !== userId);
    if (!otherUserId) return { isTyping: false };
    const otherUser = await ctx.db.get(otherUserId);
    if (isUnavailableUser(otherUser)) return { isTyping: false };

    // Get other user's typing status
    const typingStatus = await ctx.db
      .query('privateTypingStatus')
      .withIndex('by_user_conversation', (q) =>
        q.eq('userId', otherUserId).eq('conversationId', conversationId)
      )
      .first();

    if (!typingStatus) return { isTyping: false };

    // Check if typing status is stale (older than 5 seconds)
    const isStale = now - typingStatus.updatedAt > TYPING_TIMEOUT;
    return {
      isTyping: typingStatus.isTyping && !isStale,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL EXPORT: Full Phase-2 message dataset for forensic audit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Export all Phase-2 private messages with conversation and participant context.
 *
 * This is intentionally an internal query so it is not exposed to the client API.
 * It is meant for developer/admin use via the Convex CLI when preparing
 * forensic datasets or offline audits.
 */
export const exportAllPhase2Messages = internalQuery({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db.query('privateMessages').collect();

    const sortedMessages = [...messages].sort((a, b) => {
      const createdDiff = a.createdAt - b.createdAt;
      if (createdDiff !== 0) return createdDiff;
      return String(a._id).localeCompare(String(b._id));
    });

    const conversationIds = Array.from(
      new Set(sortedMessages.map((message) => String(message.conversationId)))
    ) as Id<'privateConversations'>[];

    const conversations = await Promise.all(
      conversationIds.map((conversationId) => ctx.db.get(conversationId))
    );
    const conversationMap = new Map(
      conversations
        .filter((conversation): conversation is NonNullable<typeof conversation> => conversation !== null)
        .map((conversation) => [String(conversation._id), conversation])
    );

    const userIds = Array.from(
      new Set(
        conversations
          .flatMap((conversation) => conversation?.participants ?? [])
          .map((userId) => String(userId))
      )
    ) as Id<'users'>[];

    const users = await Promise.all(userIds.map((userId) => ctx.db.get(userId)));
    const userMap = new Map(
      users
        .filter((user): user is NonNullable<typeof user> => user !== null)
        .map((user) => [String(user._id), user])
    );

    const rows = sortedMessages.map((message) => {
      const conversation = conversationMap.get(String(message.conversationId)) ?? null;
      const participantIds = conversation?.participants ?? [];
      const receiverId =
        participantIds.find((participantId) => participantId !== message.senderId) ?? null;

      const sender = userMap.get(String(message.senderId)) ?? null;
      const receiver = receiverId ? userMap.get(String(receiverId)) ?? null : null;

      const derivedStatus =
        message.readAt != null
          ? 'read'
          : message.deliveredAt != null
            ? 'delivered'
            : 'sent';

      return {
        message_id: String(message._id),
        conversation_id: String(message.conversationId),
        sender_id: String(message.senderId),
        sender_auth_user_id: sender?.authUserId ?? null,
        sender_handle: sender?.handle ?? null,
        receiver_id: receiverId ? String(receiverId) : null,
        receiver_auth_user_id: receiver?.authUserId ?? null,
        receiver_handle: receiver?.handle ?? null,
        participant_1_id: participantIds[0] ? String(participantIds[0]) : null,
        participant_2_id: participantIds[1] ? String(participantIds[1]) : null,
        conversation_participants: participantIds.map((participantId) => String(participantId)),
        connection_source: conversation?.connectionSource ?? null,
        conversation_match_id: conversation?.matchId ?? null,
        conversation_is_pre_match: conversation?.isPreMatch ?? null,
        conversation_created_at_ms: conversation?.createdAt ?? null,
        conversation_created_at_iso:
          conversation?.createdAt != null ? new Date(conversation.createdAt).toISOString() : null,
        timestamp_ms: message.createdAt,
        timestamp_iso: new Date(message.createdAt).toISOString(),
        message_type: message.type,
        message_content: message.content,
        status: derivedStatus,
        delivered_at_ms: message.deliveredAt ?? null,
        delivered_at_iso:
          message.deliveredAt != null ? new Date(message.deliveredAt).toISOString() : null,
        read_at_ms: message.readAt ?? null,
        read_at_iso: message.readAt != null ? new Date(message.readAt).toISOString() : null,
        viewed_at_ms: message.viewedAt ?? null,
        viewed_at_iso: message.viewedAt != null ? new Date(message.viewedAt).toISOString() : null,
        timer_ends_at_ms: message.timerEndsAt ?? null,
        timer_ends_at_iso:
          message.timerEndsAt != null ? new Date(message.timerEndsAt).toISOString() : null,
        image_storage_id: message.imageStorageId ? String(message.imageStorageId) : null,
        audio_storage_id: message.audioStorageId ? String(message.audioStorageId) : null,
        audio_duration_ms: message.audioDurationMs ?? null,
        is_protected: message.isProtected ?? false,
        protected_media_timer: message.protectedMediaTimer ?? null,
        protected_media_viewing_mode: message.protectedMediaViewingMode ?? null,
        protected_media_is_mirrored: message.protectedMediaIsMirrored ?? null,
        is_expired: message.isExpired ?? false,
        client_message_id: message.clientMessageId ?? null,
        metadata_json: JSON.stringify({
          imageStorageId: message.imageStorageId ? String(message.imageStorageId) : null,
          audioStorageId: message.audioStorageId ? String(message.audioStorageId) : null,
          audioDurationMs: message.audioDurationMs ?? null,
          isProtected: message.isProtected ?? false,
          protectedMediaTimer: message.protectedMediaTimer ?? null,
          protectedMediaViewingMode: message.protectedMediaViewingMode ?? null,
          protectedMediaIsMirrored: message.protectedMediaIsMirrored ?? null,
          viewedAt: message.viewedAt ?? null,
          timerEndsAt: message.timerEndsAt ?? null,
          isExpired: message.isExpired ?? false,
          deliveredAt: message.deliveredAt ?? null,
          readAt: message.readAt ?? null,
          clientMessageId: message.clientMessageId ?? null,
          conversationConnectionSource: conversation?.connectionSource ?? null,
          conversationMatchId: conversation?.matchId ?? null,
          conversationIsPreMatch: conversation?.isPreMatch ?? null,
        }),
      };
    });

    return {
      exportedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows,
    };
  },
});
