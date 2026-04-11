import { Id } from './_generated/dataModel';
import { MutationCtx, QueryCtx } from './_generated/server';

const COUNTABLE_MESSAGE_TYPES = new Set([
  'text',
  'image',
  'video',
  'voice',
  'template',
  'dare',
]);

export async function getUnreadCount(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'conversations'>,
  userId: Id<'users'>
): Promise<number> {
  const unreadMessages = await ctx.db
    .query('messages')
    .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
    .filter((q) =>
      q.and(
        q.neq(q.field('senderId'), userId),
        q.eq(q.field('readAt'), undefined)
      )
    )
    .collect();

  return unreadMessages.filter((message) => COUNTABLE_MESSAGE_TYPES.has(message.type)).length;
}
