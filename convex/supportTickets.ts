/**
 * Support Tickets Backend
 *
 * Handles user support inquiries with backend persistence.
 * Tickets are visible in Convex dashboard for admin review.
 * Supports optional attachments: up to 5 photos OR 1 video.
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Category type for validation
const categoryValidator = v.union(
  v.literal('payment'),
  v.literal('subscription'),
  v.literal('account'),
  v.literal('bug'),
  v.literal('safety'),
  v.literal('verification'),
  v.literal('other')
);

// Attachment type for validation
const attachmentValidator = v.object({
  storageId: v.id('_storage'),
  type: v.union(v.literal('photo'), v.literal('video')),
});

// Attachment limits
const MAX_PHOTOS = 5;
const MAX_VIDEOS = 1;

/**
 * Generate upload URL for support ticket attachments.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Submit a new support ticket
 *
 * Creates a ticket with status='open' for admin review.
 * Supports optional attachments: up to 5 photos OR 1 video (not both).
 */
export const submitSupportTicket = mutation({
  args: {
    userId: v.id('users'),
    category: categoryValidator,
    message: v.string(),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  handler: async (ctx, args) => {
    const { userId, category, message, attachments } = args;

    // Validate message is not empty
    if (!message.trim()) {
      throw new Error('Message cannot be empty');
    }

    // Validate message length (max 2000 characters)
    if (message.length > 2000) {
      throw new Error('Message must be 2000 characters or less');
    }

    // Validate attachments if provided
    if (attachments && attachments.length > 0) {
      const photos = attachments.filter((a) => a.type === 'photo');
      const videos = attachments.filter((a) => a.type === 'video');

      // Cannot mix photos and videos
      if (photos.length > 0 && videos.length > 0) {
        throw new Error('Cannot attach both photos and videos. Choose one type.');
      }

      // Max 5 photos
      if (photos.length > MAX_PHOTOS) {
        throw new Error(`Maximum ${MAX_PHOTOS} photos allowed`);
      }

      // Max 1 video
      if (videos.length > MAX_VIDEOS) {
        throw new Error(`Maximum ${MAX_VIDEOS} video allowed`);
      }
    }

    const now = Date.now();

    const ticketId = await ctx.db.insert('supportTickets', {
      userId,
      category,
      message: message.trim(),
      status: 'open',
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      createdAt: now,
      updatedAt: now,
    });

    console.log(
      `[SUPPORT] Ticket created: ${ticketId} by user ${userId} with ${attachments?.length ?? 0} attachments`
    );

    return { ticketId, success: true };
  },
});

/**
 * Get all tickets for a specific user
 *
 * Returns tickets sorted by createdAt descending (newest first).
 */
export const getUserTickets = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const tickets = await ctx.db
      .query('supportTickets')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect();

    return tickets;
  },
});

/**
 * Get all tickets (admin view)
 *
 * Returns all tickets sorted by createdAt descending.
 * Can filter by status.
 */
export const getAllTickets = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('open'),
        v.literal('in_review'),
        v.literal('replied'),
        v.literal('closed')
      )
    ),
  },
  handler: async (ctx, args) => {
    // Branch query logic to avoid type reassignment issues
    if (args.status) {
      return await ctx.db
        .query('supportTickets')
        .withIndex('by_status', (q) => q.eq('status', args.status!))
        .order('desc')
        .collect();
    }

    return await ctx.db
      .query('supportTickets')
      .withIndex('by_created')
      .order('desc')
      .collect();
  },
});

/**
 * Update ticket status (admin action)
 *
 * Allows admins to change status and add reply.
 */
export const updateTicketStatus = mutation({
  args: {
    ticketId: v.id('supportTickets'),
    status: v.union(
      v.literal('open'),
      v.literal('in_review'),
      v.literal('replied'),
      v.literal('closed')
    ),
    adminReply: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { ticketId, status, adminReply } = args;

    const ticket = await ctx.db.get(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    const updates: {
      status: typeof status;
      updatedAt: number;
      adminReply?: string;
    } = {
      status,
      updatedAt: Date.now(),
    };

    if (adminReply !== undefined) {
      updates.adminReply = adminReply;
    }

    await ctx.db.patch(ticketId, updates);

    return { success: true };
  },
});

// ============================================================================
// CONVERSATION SYSTEM
// ============================================================================

/**
 * Get a single ticket by ID
 */
export const getTicketById = query({
  args: {
    ticketId: v.id('supportTickets'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.ticketId);
  },
});

/**
 * Get all messages for a ticket (conversation thread)
 * Returns messages sorted by createdAt ascending (oldest first)
 */
export const getTicketMessages = query({
  args: {
    ticketId: v.id('supportTickets'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('supportTicketMessages')
      .withIndex('by_ticket', (q) => q.eq('ticketId', args.ticketId))
      .collect();

    // Sort by createdAt ascending (oldest first for conversation view)
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/**
 * Get ticket with full thread (for admin inspection)
 */
export const getTicketWithThread = query({
  args: {
    ticketId: v.id('supportTickets'),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket) return null;

    const messages = await ctx.db
      .query('supportTicketMessages')
      .withIndex('by_ticket', (q) => q.eq('ticketId', args.ticketId))
      .collect();

    return {
      ticket,
      messages: messages.sort((a, b) => a.createdAt - b.createdAt),
      messageCount: messages.length,
    };
  },
});

/**
 * Get user tickets with last message preview
 */
export const getUserTicketsWithPreview = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const tickets = await ctx.db
      .query('supportTickets')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect();

    // For each ticket, get the last message (if any)
    const ticketsWithPreview = await Promise.all(
      tickets.map(async (ticket) => {
        const messages = await ctx.db
          .query('supportTicketMessages')
          .withIndex('by_ticket', (q) => q.eq('ticketId', ticket._id))
          .collect();

        const sortedMessages = messages.sort((a, b) => b.createdAt - a.createdAt);
        const lastMessage = sortedMessages[0];
        const hasAdminReply = messages.some((m) => m.senderType === 'admin');

        return {
          ...ticket,
          lastMessage: lastMessage
            ? {
                message: lastMessage.message,
                senderType: lastMessage.senderType,
                createdAt: lastMessage.createdAt,
              }
            : null,
          messageCount: messages.length,
          hasAdminReply,
        };
      })
    );

    return ticketsWithPreview;
  },
});

/**
 * Add a user reply to a ticket
 */
export const addUserMessage = mutation({
  args: {
    ticketId: v.id('supportTickets'),
    userId: v.id('users'),
    message: v.string(),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  handler: async (ctx, args) => {
    const { ticketId, userId, message, attachments } = args;

    // Get ticket
    const ticket = await ctx.db.get(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Check ticket belongs to user
    if (ticket.userId !== userId) {
      throw new Error('Not authorized to reply to this ticket');
    }

    // Check ticket is not closed
    if (ticket.status === 'closed') {
      throw new Error('Cannot reply to a closed ticket');
    }

    // Validate message
    if (!message.trim()) {
      throw new Error('Message cannot be empty');
    }

    if (message.length > 2000) {
      throw new Error('Message must be 2000 characters or less');
    }

    // Validate attachments
    if (attachments && attachments.length > 0) {
      const photos = attachments.filter((a) => a.type === 'photo');
      const videos = attachments.filter((a) => a.type === 'video');

      if (photos.length > 0 && videos.length > 0) {
        throw new Error('Cannot attach both photos and videos');
      }
      if (photos.length > MAX_PHOTOS) {
        throw new Error(`Maximum ${MAX_PHOTOS} photos allowed`);
      }
      if (videos.length > MAX_VIDEOS) {
        throw new Error(`Maximum ${MAX_VIDEOS} video allowed`);
      }
    }

    const now = Date.now();

    // Create message
    const messageId = await ctx.db.insert('supportTicketMessages', {
      ticketId,
      senderType: 'user',
      senderUserId: userId,
      message: message.trim(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      createdAt: now,
    });

    // Update ticket status: if was 'replied' (admin replied), change to 'in_review'
    // Otherwise keep current status
    const newStatus = ticket.status === 'replied' ? 'in_review' : ticket.status;

    await ctx.db.patch(ticketId, {
      updatedAt: now,
      status: newStatus,
    });

    console.log(`[SUPPORT] User message added to ticket ${ticketId}`);

    return { messageId, success: true };
  },
});

/**
 * Add an admin reply to a ticket
 */
export const addAdminMessage = mutation({
  args: {
    ticketId: v.id('supportTickets'),
    message: v.string(),
    adminName: v.optional(v.string()),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  handler: async (ctx, args) => {
    const { ticketId, message, adminName, attachments } = args;

    // Get ticket
    const ticket = await ctx.db.get(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Validate message
    if (!message.trim()) {
      throw new Error('Message cannot be empty');
    }

    if (message.length > 2000) {
      throw new Error('Message must be 2000 characters or less');
    }

    // Validate attachments
    if (attachments && attachments.length > 0) {
      const photos = attachments.filter((a) => a.type === 'photo');
      const videos = attachments.filter((a) => a.type === 'video');

      if (photos.length > 0 && videos.length > 0) {
        throw new Error('Cannot attach both photos and videos');
      }
      if (photos.length > MAX_PHOTOS) {
        throw new Error(`Maximum ${MAX_PHOTOS} photos allowed`);
      }
      if (videos.length > MAX_VIDEOS) {
        throw new Error(`Maximum ${MAX_VIDEOS} video allowed`);
      }
    }

    const now = Date.now();

    // Create message
    const messageId = await ctx.db.insert('supportTicketMessages', {
      ticketId,
      senderType: 'admin',
      senderName: adminName || 'Support Team',
      message: message.trim(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      createdAt: now,
    });

    // Update ticket status to 'replied'
    await ctx.db.patch(ticketId, {
      updatedAt: now,
      status: 'replied',
    });

    console.log(`[SUPPORT] Admin message added to ticket ${ticketId}`);

    return { messageId, success: true };
  },
});

/**
 * Close a ticket
 */
export const closeTicket = mutation({
  args: {
    ticketId: v.id('supportTickets'),
    userId: v.optional(v.id('users')), // If provided, verify ownership
  },
  handler: async (ctx, args) => {
    const { ticketId, userId } = args;

    const ticket = await ctx.db.get(ticketId);
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // If userId provided, verify ownership (user closing their own ticket)
    if (userId && ticket.userId !== userId) {
      throw new Error('Not authorized to close this ticket');
    }

    await ctx.db.patch(ticketId, {
      status: 'closed',
      updatedAt: Date.now(),
    });

    console.log(`[SUPPORT] Ticket ${ticketId} closed`);

    return { success: true };
  },
});

// ============================================================================
// P0-3 FIX: USER REPORTS (SAFETY TICKETS)
// ============================================================================

/**
 * Get user's submitted safety reports (person reports)
 *
 * Returns tickets where category='safety', which includes person reports
 * submitted via the Report Person flow. These are identified by the
 * "[Deep Connect Report]" prefix in the message.
 */
export const getUserSafetyReports = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    // Get all safety category tickets for this user
    const tickets = await ctx.db
      .query('supportTickets')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect();

    // Filter to only safety category (reports)
    const safetyReports = tickets.filter((t) => t.category === 'safety');

    // Transform to report format expected by UI
    return safetyReports.map((ticket) => {
      // Extract reported user info from message if present
      // Format: "[Deep Connect Report] Reason: harassment\nReported User: username\nUser ID: xxx\n\nDetails: ..."
      let reportedUserName = 'Unknown User';
      let reason = 'safety';

      const reasonMatch = ticket.message.match(/Reason:\s*(\w+)/i);
      if (reasonMatch) {
        reason = reasonMatch[1];
      }

      const userNameMatch = ticket.message.match(/Reported User:\s*([^\n]+)/i);
      if (userNameMatch) {
        reportedUserName = userNameMatch[1].trim();
      }

      return {
        _id: ticket._id,
        reportedUserName,
        reason,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        hasAdminReply: !!ticket.adminReply,
      };
    });
  },
});
