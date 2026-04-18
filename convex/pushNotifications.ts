import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalQuery } from './_generated/server';

export const getPushRecipient = internalQuery({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user?.pushToken) {
      return null;
    }

    return { pushToken: user.pushToken };
  },
});

export const send = internalAction({
  args: {
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    data: v.any(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    const recipient = await ctx.runQuery(internal.pushNotifications.getPushRecipient, {
      userId: args.userId,
    });
    if (!recipient?.pushToken) {
      return;
    }

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: recipient.pushToken,
        title: args.title,
        body: args.body,
        data: args.data,
      }),
    });
  },
});
