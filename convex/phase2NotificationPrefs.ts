/**
 * Phase-2 in-app notification preference checks (userPrivateProfiles only).
 * Does not read or write users table — keeps Phase-1 and Phase-2 settings isolated.
 */
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

/**
 * Whether to create Deep Connect–related Phase-2 notification rows (`phase2_match`, `phase2_like`)
 * for this user. Matches Phase-2 Notifications UI: unset fields default to enabled.
 */
export async function shouldCreatePhase2DeepConnectNotification(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<boolean> {
  const profile = await ctx.db
    .query('userPrivateProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();

  if (!profile) {
    return true;
  }

  if (profile.notificationsEnabled === false) {
    return false;
  }

  if (profile.notificationCategories?.deepConnect === false) {
    return false;
  }

  return true;
}

/**
 * Whether to create Phase-2 private-chat in-app notification rows (`phase2_private_message`)
 * for this user (recipient). Unset fields default to enabled.
 */
export async function shouldCreatePhase2PrivateMessagesNotification(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<boolean> {
  const profile = await ctx.db
    .query('userPrivateProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();

  if (!profile) {
    return true;
  }

  if (profile.notificationsEnabled === false) {
    return false;
  }

  if (profile.notificationCategories?.privateMessages === false) {
    return false;
  }

  return true;
}

/**
 * Whether to create Chat Rooms mention inbox rows (`chatRoomMentionNotifications`) for this user.
 * Unset fields default to enabled.
 */
export async function shouldCreatePhase2ChatRoomsNotification(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<boolean> {
  const profile = await ctx.db
    .query('userPrivateProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first();

  if (!profile) {
    return true;
  }

  if (profile.notificationsEnabled === false) {
    return false;
  }

  if (profile.notificationCategories?.chatRooms === false) {
    return false;
  }

  return true;
}
