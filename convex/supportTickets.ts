/**
 * Phase-1 general support (Help & FAQ / Contact Support).
 * Session-token auth; separate from Phase-2 safety escalation in `support.ts`.
 */
import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { validateSessionToken } from './helpers';

const PHASE1_CATEGORY = v.union(
  v.literal('payment'),
  v.literal('subscription'),
  v.literal('account'),
  v.literal('bug'),
  v.literal('safety'),
  v.literal('verification'),
  v.literal('other'),
);

const ATTACHMENT = v.object({
  storageId: v.id('_storage'),
  type: v.union(v.literal('photo'), v.literal('video')),
});

const MAX_TICKETS_PER_24H = 10;

type SupportTicketAttachmentWithUrl = {
  storageId: Id<'_storage'>;
  type: 'photo' | 'video';
  url: string | null;
};

async function enrichAttachmentList(
  ctx: QueryCtx | MutationCtx,
  attachments:
    | { storageId: Id<'_storage'>; type: 'photo' | 'video' }[]
    | undefined,
): Promise<SupportTicketAttachmentWithUrl[] | undefined> {
  if (!attachments?.length) return undefined;
  const out: SupportTicketAttachmentWithUrl[] = [];
  for (const a of attachments) {
    const url = await ctx.storage.getUrl(a.storageId);
    out.push({ storageId: a.storageId, type: a.type, url: url ?? null });
  }
  return out;
}

async function requireTicketOwner(
  ctx: QueryCtx | MutationCtx,
  token: string,
  ticketId: Id<'supportTickets'>,
): Promise<{ userId: Id<'users'>; ticket: Doc<'supportTickets'> } | null> {
  const userId = await validateSessionToken(ctx, token);
  if (!userId) return null;
  const ticket = await ctx.db.get(ticketId);
  if (!ticket || ticket.userId !== userId) return null;
  return { userId, ticket };
}

/** Convex file upload handoff for Phase-1 support attachments. */
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

export const submitSupportTicket = mutation({
  args: {
    token: v.string(),
    category: PHASE1_CATEGORY,
    message: v.string(),
    attachments: v.optional(v.array(ATTACHMENT)),
  },
  handler: async (ctx, args) => {
    const userId = await validateSessionToken(ctx, args.token);
    if (!userId) {
      throw new Error(
        'Session invalid or expired. Please sign in again, then try submitting your request.',
      );
    }

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const recent = await ctx.db
      .query('supportTickets')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .filter((q) => q.gte(q.field('createdAt'), oneDayAgo))
      .collect();

    if (recent.length >= MAX_TICKETS_PER_24H) {
      throw new Error('Too many support requests. Please try again tomorrow.');
    }

    const trimmed = args.message.trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty');
    }

    const ticketId = await ctx.db.insert('supportTickets', {
      userId,
      category: args.category,
      message: trimmed,
      status: 'open',
      attachments: args.attachments,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    });

    return { success: true as const, ticketId };
  },
});

export const getUserTicketsWithPreview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await validateSessionToken(ctx, token);
    if (!userId) {
      return [];
    }

    const tickets = await ctx.db
      .query('supportTickets')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();

    const out: {
      _id: Id<'supportTickets'>;
      category: string;
      status: string;
      message: string;
      createdAt: number;
      updatedAt: number;
      lastMessage: {
        message: string;
        senderType: 'user' | 'admin';
        createdAt: number;
      } | null;
      messageCount: number;
      hasAdminReply: boolean;
      hasAttachments: boolean;
      listPreviewUrl: string | null;
      firstAttachmentType: 'photo' | 'video' | null;
    }[] = [];

    for (const t of tickets) {
      const messages = await ctx.db
        .query('supportTicketMessages')
        .withIndex('by_ticket_created', (q) => q.eq('ticketId', t._id))
        .order('asc')
        .collect();

      const lastThread = messages.length > 0 ? messages[messages.length - 1] : null;
      const lastMessage = lastThread
        ? {
            message: lastThread.message,
            senderType: lastThread.senderType as 'user' | 'admin',
            createdAt: lastThread.createdAt,
          }
        : null;

      const hasAdminReply = messages.some((m) => m.senderType === 'admin');

      let firstAtt: { storageId: Id<'_storage'>; type: 'photo' | 'video' } | null = null;
      if (t.attachments?.[0]) {
        firstAtt = t.attachments[0];
      } else {
        for (const m of messages) {
          if (m.attachments?.[0]) {
            firstAtt = m.attachments[0];
            break;
          }
        }
      }

      const hasAttachments = !!firstAtt;
      let listPreviewUrl: string | null = null;
      let firstAttachmentType: 'photo' | 'video' | null = null;
      if (firstAtt) {
        listPreviewUrl = (await ctx.storage.getUrl(firstAtt.storageId)) ?? null;
        firstAttachmentType = firstAtt.type;
      }

      out.push({
        _id: t._id,
        category: t.category,
        status: t.status,
        message: t.message,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        lastMessage,
        messageCount: messages.length,
        hasAdminReply,
        hasAttachments,
        listPreviewUrl,
        firstAttachmentType,
      });
    }

    return out;
  },
});

export const getTicketById = query({
  args: {
    token: v.string(),
    ticketId: v.id('supportTickets'),
  },
  handler: async (ctx, { token, ticketId }) => {
    const auth = await requireTicketOwner(ctx, token, ticketId);
    if (!auth) {
      return null;
    }
    const { ticket } = auth;
    const attachments = await enrichAttachmentList(ctx, ticket.attachments);
    return {
      _id: ticket._id,
      category: ticket.category,
      status: ticket.status,
      message: ticket.message,
      attachments,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  },
});

export const getTicketMessages = query({
  args: {
    token: v.string(),
    ticketId: v.id('supportTickets'),
  },
  handler: async (ctx, { token, ticketId }) => {
    const auth = await requireTicketOwner(ctx, token, ticketId);
    if (!auth) {
      return [];
    }

    const messages = await ctx.db
      .query('supportTicketMessages')
      .withIndex('by_ticket_created', (q) => q.eq('ticketId', ticketId))
      .order('asc')
      .collect();

    const result = [];
    for (const m of messages) {
      const attachments = await enrichAttachmentList(ctx, m.attachments);
      result.push({
        _id: m._id,
        senderType: m.senderType,
        senderName: m.senderName,
        message: m.message,
        attachments,
        createdAt: m.createdAt,
      });
    }
    return result;
  },
});

export const addUserMessage = mutation({
  args: {
    token: v.string(),
    ticketId: v.id('supportTickets'),
    message: v.string(),
    attachments: v.optional(v.array(ATTACHMENT)),
  },
  handler: async (ctx, args) => {
    const auth = await requireTicketOwner(ctx, args.token, args.ticketId);
    if (!auth) {
      throw new Error(
        'Session invalid or expired, or this request was not found. Please sign in again.',
      );
    }
    const { ticket } = auth;

    if (ticket.status === 'closed') {
      throw new Error('This support request is closed');
    }

    const trimmed = args.message.trim();
    const hasAtt = !!args.attachments?.length;
    if (!trimmed && !hasAtt) {
      throw new Error('Message cannot be empty');
    }

    const now = Date.now();

    await ctx.db.insert('supportTicketMessages', {
      ticketId: args.ticketId,
      senderType: 'user',
      message: trimmed || '(attachment)',
      attachments: args.attachments,
      createdAt: now,
    });

    await ctx.db.patch(args.ticketId, {
      updatedAt: now,
      lastMessageAt: now,
      status: ticket.status === 'open' ? 'in_review' : ticket.status,
    });

    return { success: true as const };
  },
});
