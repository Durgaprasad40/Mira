import { Id } from './_generated/dataModel';
import { MutationCtx, QueryCtx } from './_generated/server';

type Phase1NotificationType = 'message' | 'match' | 'like' | 'super_like';

export async function shouldCreateNotification(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  type: Phase1NotificationType
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user) {
    return false;
  }

  if (user.notificationsEnabled === false) {
    return false;
  }

  switch (type) {
    case 'message':
      return user.notifyNewMessages !== false;
    case 'match':
      return user.notifyNewMatches !== false;
    case 'like':
    case 'super_like':
      return user.notifyLikesAndSuperLikes !== false;
    default:
      return true;
  }
}
