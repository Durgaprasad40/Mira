/**
 * Phase-2 Safety Support Backend
 *
 * Handles support request creation, thread messaging, and retrieval
 * for the Safety + Trust features. Supports text, image, video, and audio messages.
 */
import { v } from 'convex/values';
import { mutation, query, QueryCtx } from './_generated/server';
import { resolveUserIdByAuthId } from './helpers';
import { Id } from './_generated/dataModel';

/**
 * PHASE-2 IDENTITY FIX: Get Phase-2 nickname for display.
 * Never exposes real name in Phase-2 contexts.
 */
async function getPhase2DisplayName(ctx: QueryCtx, userId: Id<'users'>): Promise<string> {
  const privateProfile = await ctx.db
    .query('userPrivateProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();
  return privateProfile?.displayName || 'Anonymous';
}

// Category type for type safety
const SUPPORT_CATEGORY = v.union(
  v.literal('scam_extortion'),
  v.literal('non_consensual_sharing'),
  v.literal('physical_safety'),
  v.literal('harassment_stalking'),
  v.literal('other_safety')
);

/**
 * Create a new support request (escalation ticket).
 * Auth-safe: uses authUserId parameter.
 */
export const createSupportRequest = mutation({
  args: {
    authUserId: v.string(),
    category: SUPPORT_CATEGORY,
    description: v.string(),
    relatedUserId: v.optional(v.id('users')),
    relatedReportId: v.optional(v.id('reports')),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found' };
    }

    const now = Date.now();

    // Rate limiting: max 5 requests per 24 hours
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const recentRequests = await ctx.db
      .query('supportRequests')
      .withIndex('by_user', (q: any) => q.eq('userId', resolvedUserId))
      .filter((q: any) => q.gte(q.field('createdAt'), oneDayAgo))
      .collect();

    if (recentRequests.length >= 5) {
      return {
        success: false,
        error: 'rate_limited',
        message: 'Maximum 5 support requests per 24 hours',
      };
    }

    // Create the support request
    const requestId = await ctx.db.insert('supportRequests', {
      userId: resolvedUserId as any,
      category: args.category,
      description: args.description,
      status: 'submitted',
      relatedUserId: args.relatedUserId,
      relatedReportId: args.relatedReportId,
      createdAt: now,
    });

    // Capture conversation snapshot if relatedUserId is present
    if (args.relatedUserId) {
      await captureConversationSnapshot(ctx, requestId, resolvedUserId, args.relatedUserId);
    }

    return {
      success: true,
      requestId,
    };
  },
});

/**
 * Internal helper to capture last 20 messages between requester and related user.
 * This is for moderation context only - never exposed to users.
 */
async function captureConversationSnapshot(
  ctx: any,
  supportRequestId: Id<'supportRequests'>,
  requesterId: Id<'users'>,
  relatedUserId: Id<'users'>
) {
  try {
    // Find conversation between the two users
    const allConversations = await ctx.db
      .query('conversations')
      .collect();

    // Find conversation where both users are participants
    const conversation = allConversations.find((conv: any) =>
      conv.participants.includes(requesterId) && conv.participants.includes(relatedUserId)
    );

    if (!conversation) {
      // No conversation exists between these users
      return;
    }

    // Fetch last 20 messages from this conversation
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation_created', (q: any) => q.eq('conversationId', conversation._id))
      .order('desc')
      .take(20);

    if (messages.length === 0) {
      return;
    }

    // Reverse to get oldest → newest order
    const reversedMessages = messages.reverse();

    // Insert snapshot records
    for (const msg of reversedMessages) {
      await ctx.db.insert('supportConversationSnapshots', {
        supportRequestId,
        senderUserId: msg.senderId,
        messageText: msg.content || undefined,
        attachmentType: msg.type !== 'text' ? msg.type : undefined,
        createdAt: msg.createdAt,
      });
    }
  } catch (error) {
    // Silently fail - snapshot is supplementary, should not block support request creation
    console.error('[captureConversationSnapshot] Error:', error);
  }
}

/**
 * Get support requests submitted by the current user.
 * Auth-safe: uses authUserId parameter.
 */
export const getMySupportRequests = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', requests: [] };
    }

    // Get all support requests for this user
    const requests = await ctx.db
      .query('supportRequests')
      .withIndex('by_user', (q: any) => q.eq('userId', resolvedUserId))
      .order('desc')
      .collect();

    // Fetch related user info for each request
    const safeRequests = await Promise.all(
      requests.map(async (req) => {
        let relatedUser = null;
        if (req.relatedUserId) {
          const user = await ctx.db.get(req.relatedUserId);
          if (user) {
            // Get primary photo
            const photo = await ctx.db
              .query('photos')
              .withIndex('by_user', (q: any) => q.eq('userId', req.relatedUserId))
              .filter((q: any) => q.eq(q.field('isPrimary'), true))
              .first();
            // PHASE-2 IDENTITY FIX: Use Phase-2 nickname, never real name
            const nickname = await getPhase2DisplayName(ctx, user._id);
            relatedUser = {
              userId: user._id,
              displayName: nickname,
              photoUrl: photo?.url || user.primaryPhotoUrl || null,
            };
          }
        }
        return {
          requestId: req._id,
          category: req.category,
          status: req.status,
          createdAt: req.createdAt,
          updatedAt: req.updatedAt,
          resolvedAt: req.resolvedAt,
          lastMessageAt: req.lastMessageAt,
          relatedUser,
        };
      })
    );

    return {
      success: true,
      requests: safeRequests,
    };
  },
});

/**
 * Get a single support request by ID.
 * Only returns if the user owns this request.
 * Auth-safe: validates ownership.
 */
export const getSupportRequestById = query({
  args: {
    authUserId: v.string(),
    requestId: v.id('supportRequests'),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', request: null };
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) {
      return { success: false, error: 'not_found', request: null };
    }

    // Ownership check - only owner can view their case
    if (request.userId !== resolvedUserId) {
      return { success: false, error: 'not_authorized', request: null };
    }

    // Fetch related user info if present
    let relatedUser = null;
    if (request.relatedUserId) {
      const user = await ctx.db.get(request.relatedUserId);
      if (user) {
        const photo = await ctx.db
          .query('photos')
          .withIndex('by_user', (q: any) => q.eq('userId', request.relatedUserId))
          .filter((q: any) => q.eq(q.field('isPrimary'), true))
          .first();
        // PHASE-2 IDENTITY FIX: Use Phase-2 nickname, never real name
        const nickname = await getPhase2DisplayName(ctx, user._id);
        relatedUser = {
          userId: user._id,
          displayName: nickname,
          photoUrl: photo?.url || user.primaryPhotoUrl || null,
        };
      }
    }

    return {
      success: true,
      request: {
        requestId: request._id,
        category: request.category,
        description: request.description,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        resolvedAt: request.resolvedAt,
        lastMessageAt: request.lastMessageAt,
        relatedUser,
      },
    };
  },
});

/**
 * Get messages for a support request thread.
 * Only returns if the user owns this request.
 * Auth-safe: validates ownership.
 */
export const getSupportMessages = query({
  args: {
    authUserId: v.string(),
    requestId: v.id('supportRequests'),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', messages: [] };
    }

    // Check ownership
    const request = await ctx.db.get(args.requestId);
    if (!request || request.userId !== resolvedUserId) {
      return { success: false, error: 'not_authorized', messages: [] };
    }

    // Get all messages for this request
    const messages = await ctx.db
      .query('supportMessages')
      .withIndex('by_request_created', (q: any) => q.eq('supportRequestId', args.requestId))
      .order('asc')
      .collect();

    // Resolve attachment URLs
    const messagesWithUrls = await Promise.all(
      messages.map(async (msg) => {
        let attachmentUrl: string | null = null;
        if (msg.attachmentStorageId) {
          attachmentUrl = await ctx.storage.getUrl(msg.attachmentStorageId);
        }
        return {
          messageId: msg._id,
          senderType: msg.senderType,
          text: msg.text,
          attachmentType: msg.attachmentType,
          attachmentUrl,
          createdAt: msg.createdAt,
        };
      })
    );

    return {
      success: true,
      messages: messagesWithUrls,
    };
  },
});

/**
 * Send a message in a support request thread.
 * Only the owner can send messages in their thread.
 * Auth-safe: validates ownership.
 */
export const sendSupportMessage = mutation({
  args: {
    authUserId: v.string(),
    requestId: v.id('supportRequests'),
    text: v.optional(v.string()),
    attachmentType: v.optional(
      v.union(v.literal('image'), v.literal('video'), v.literal('audio'))
    ),
    attachmentStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found' };
    }

    // Check ownership
    const request = await ctx.db.get(args.requestId);
    if (!request || request.userId !== resolvedUserId) {
      return { success: false, error: 'not_authorized' };
    }

    // Validate: must have text or attachment
    if (!args.text?.trim() && !args.attachmentStorageId) {
      return { success: false, error: 'empty_message' };
    }

    const now = Date.now();

    // Insert message
    const messageId = await ctx.db.insert('supportMessages', {
      supportRequestId: args.requestId,
      senderType: 'user',
      senderUserId: resolvedUserId,
      text: args.text?.trim() || undefined,
      attachmentType: args.attachmentType,
      attachmentStorageId: args.attachmentStorageId,
      createdAt: now,
    });

    // Update lastMessageAt on the request
    await ctx.db.patch(args.requestId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      messageId,
    };
  },
});

/**
 * Generate upload URL for support message attachments.
 * Uses Convex storage.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Get storage URL for an attachment.
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

/**
 * Get selectable users for support case creation.
 * Aggregates: blocked users, reported users, and recent DM contacts.
 * Returns minimal safe data only.
 * Auth-safe: uses authUserId parameter.
 */
export const getSelectableUsersForSupportCase = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', users: [] };
    }

    // Collect user IDs from multiple sources with their source type
    const userSourceMap = new Map<string, { sourceType: string; timestamp: number }>();

    // 1. Get blocked users
    const blocks = await ctx.db
      .query('blocks')
      .withIndex('by_blocker', (q: any) => q.eq('blockerId', resolvedUserId))
      .collect();

    for (const block of blocks) {
      const existing = userSourceMap.get(block.blockedUserId as string);
      if (!existing || block.createdAt > existing.timestamp) {
        userSourceMap.set(block.blockedUserId as string, {
          sourceType: 'blocked',
          timestamp: block.createdAt,
        });
      }
    }

    // 2. Get reported users (last 90 days)
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const reports = await ctx.db
      .query('reports')
      .withIndex('by_reporter', (q: any) => q.eq('reporterId', resolvedUserId))
      .filter((q: any) => q.gte(q.field('createdAt'), ninetyDaysAgo))
      .collect();

    for (const report of reports) {
      const existing = userSourceMap.get(report.reportedUserId as string);
      if (!existing || report.createdAt > existing.timestamp) {
        userSourceMap.set(report.reportedUserId as string, {
          sourceType: 'reported',
          timestamp: report.createdAt,
        });
      }
    }

    // 3. Get recent DM conversation participants (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const conversations = await ctx.db
      .query('conversations')
      .withIndex('by_last_message')
      .filter((q: any) => q.gte(q.field('lastMessageAt'), thirtyDaysAgo))
      .collect();

    for (const conv of conversations) {
      if (!conv.participants.includes(resolvedUserId)) continue;
      const otherUserId = conv.participants.find((p: any) => p !== resolvedUserId);
      if (!otherUserId) continue;

      const existing = userSourceMap.get(otherUserId as string);
      const convTimestamp = conv.lastMessageAt || conv.createdAt;
      // Only set as 'recent_chat' if not already blocked/reported
      if (!existing) {
        userSourceMap.set(otherUserId as string, {
          sourceType: 'recent_chat',
          timestamp: convTimestamp,
        });
      }
    }

    // Fetch user details for all collected user IDs
    const userIds = Array.from(userSourceMap.keys());
    const users = await Promise.all(
      userIds.map(async (userIdStr) => {
        const typedUserId = userIdStr as Id<'users'>;
        const user = await ctx.db.get(typedUserId);
        if (!user || !user.isActive || user.isBanned) return null;

        // Get primary photo
        const photo = await ctx.db
          .query('photos')
          .withIndex('by_user', (q: any) => q.eq('userId', typedUserId))
          .filter((q: any) => q.eq(q.field('isPrimary'), true))
          .first();

        // PHASE-2 IDENTITY FIX: Use Phase-2 nickname, never real name
        const nickname = await getPhase2DisplayName(ctx, user._id);
        const sourceInfo = userSourceMap.get(userIdStr)!;
        return {
          userId: user._id,
          displayName: nickname,
          photoUrl: photo?.url || user.primaryPhotoUrl || null,
          sourceType: sourceInfo.sourceType,
          lastInteractionAt: sourceInfo.timestamp,
        };
      })
    );

    // Filter nulls and sort by most recent interaction
    const validUsers = users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .sort((a, b) => b.lastInteractionAt - a.lastInteractionAt)
      .slice(0, 50); // Limit to 50 users

    return {
      success: true,
      users: validUsers,
    };
  },
});

/**
 * Get safe minimal user info for display.
 * Returns only name and photo - no sensitive data.
 */
export const getSafeUserInfo = query({
  args: {
    authUserId: v.string(),
    targetUserId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const resolvedUserId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!resolvedUserId) {
      return { success: false, error: 'user_not_found', user: null };
    }

    const user = await ctx.db.get(args.targetUserId);
    if (!user) {
      return { success: false, error: 'target_not_found', user: null };
    }

    // Get primary photo
    const photo = await ctx.db
      .query('photos')
      .withIndex('by_user', (q: any) => q.eq('userId', args.targetUserId))
      .filter((q: any) => q.eq(q.field('isPrimary'), true))
      .first();

    // PHASE-2 IDENTITY FIX: Use Phase-2 nickname, never real name
    const nickname = await getPhase2DisplayName(ctx, user._id);
    return {
      success: true,
      user: {
        userId: user._id,
        displayName: nickname,
        photoUrl: photo?.url || user.primaryPhotoUrl || null,
      },
    };
  },
});
