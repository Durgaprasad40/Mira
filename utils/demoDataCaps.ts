/**
 * demoDataCaps — Caps for demo mode persisted data to prevent slow hydration.
 *
 * Demo stores can grow unbounded (conversations, messages, notifications, crossedPaths).
 * This module provides cap enforcement functions to run AFTER rehydration completes,
 * trimming old data without blocking first paint.
 *
 * SAFETY:
 * - Only affects demo mode data
 * - Never deletes user profile data
 * - Runs post-hydration, non-blocking
 * - Logs when caps are applied
 */

import { log } from './logger';

// ---------------------------------------------------------------------------
// Cap Constants
// ---------------------------------------------------------------------------

/** Maximum conversations to keep (most recent by last message time) */
export const MAX_CONVERSATIONS = 20;

/** Maximum messages per conversation */
export const MAX_MESSAGES_PER_CONVERSATION = 100;

/** Maximum total messages across all conversations */
export const MAX_TOTAL_MESSAGES = 200;

/** Maximum notifications to keep */
export const MAX_NOTIFICATIONS = 100;

/** Maximum crossed paths entries */
export const MAX_CROSSED_PATHS = 100;

/** Maximum swiped profile IDs to track */
export const MAX_SWIPED_PROFILES = 200;

// ---------------------------------------------------------------------------
// Cap Enforcement Functions
// ---------------------------------------------------------------------------

/**
 * Cap conversations and messages in demoDmStore.
 * Returns trimmed data if changes were made, null otherwise.
 */
export function capDmStoreData(
  conversations: Record<string, Array<{ _id: string; createdAt: number }>>,
  meta: Record<string, { otherUser?: { lastActive?: number } }>
): {
  conversations: Record<string, Array<{ _id: string; createdAt: number }>>;
  trimmed: { conversationsRemoved: number; messagesRemoved: number };
} | null {
  const convoIds = Object.keys(conversations);
  if (convoIds.length === 0) return null;

  let conversationsRemoved = 0;
  let messagesRemoved = 0;
  const newConversations: Record<string, Array<{ _id: string; createdAt: number }>> = {};

  // Sort conversations by last message time (or meta lastActive)
  const sortedConvoIds = convoIds.sort((a, b) => {
    const msgsA = conversations[a] ?? [];
    const msgsB = conversations[b] ?? [];
    const lastA = msgsA.length > 0 ? msgsA[msgsA.length - 1].createdAt : (meta[a]?.otherUser?.lastActive ?? 0);
    const lastB = msgsB.length > 0 ? msgsB[msgsB.length - 1].createdAt : (meta[b]?.otherUser?.lastActive ?? 0);
    return lastB - lastA; // Most recent first
  });

  // Keep only MAX_CONVERSATIONS
  const keptConvoIds = sortedConvoIds.slice(0, MAX_CONVERSATIONS);
  conversationsRemoved = sortedConvoIds.length - keptConvoIds.length;

  // Track total messages for global cap
  let totalMessages = 0;

  for (const convoId of keptConvoIds) {
    const msgs = conversations[convoId] ?? [];

    // Cap messages per conversation
    let keptMsgs = msgs;
    if (msgs.length > MAX_MESSAGES_PER_CONVERSATION) {
      // Keep most recent messages
      keptMsgs = msgs.slice(-MAX_MESSAGES_PER_CONVERSATION);
      messagesRemoved += msgs.length - keptMsgs.length;
    }

    // Check global cap
    if (totalMessages + keptMsgs.length > MAX_TOTAL_MESSAGES) {
      const allowed = Math.max(0, MAX_TOTAL_MESSAGES - totalMessages);
      if (allowed > 0) {
        messagesRemoved += keptMsgs.length - allowed;
        keptMsgs = keptMsgs.slice(-allowed);
      } else {
        messagesRemoved += keptMsgs.length;
        keptMsgs = [];
      }
    }

    totalMessages += keptMsgs.length;
    newConversations[convoId] = keptMsgs;
  }

  // Count messages in removed conversations
  for (const convoId of sortedConvoIds.slice(MAX_CONVERSATIONS)) {
    messagesRemoved += (conversations[convoId]?.length ?? 0);
  }

  if (conversationsRemoved === 0 && messagesRemoved === 0) {
    return null;
  }

  return {
    conversations: newConversations,
    trimmed: { conversationsRemoved, messagesRemoved },
  };
}

/**
 * Cap notifications array.
 * Returns trimmed array if changes were made, null otherwise.
 */
export function capNotifications<T extends { createdAt?: number }>(
  notifications: T[]
): { notifications: T[]; removed: number } | null {
  if (notifications.length <= MAX_NOTIFICATIONS) {
    return null;
  }

  // Sort by createdAt descending (most recent first)
  const sorted = [...notifications].sort((a, b) =>
    (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );

  const kept = sorted.slice(0, MAX_NOTIFICATIONS);
  const removed = notifications.length - kept.length;

  return { notifications: kept, removed };
}

/**
 * Cap crossed paths array.
 * Returns trimmed array if changes were made, null otherwise.
 */
export function capCrossedPaths<T extends { crossedAt?: number }>(
  crossedPaths: T[]
): { crossedPaths: T[]; removed: number } | null {
  if (crossedPaths.length <= MAX_CROSSED_PATHS) {
    return null;
  }

  // Sort by crossedAt descending (most recent first)
  const sorted = [...crossedPaths].sort((a, b) =>
    (b.crossedAt ?? 0) - (a.crossedAt ?? 0)
  );

  const kept = sorted.slice(0, MAX_CROSSED_PATHS);
  const removed = crossedPaths.length - kept.length;

  return { crossedPaths: kept, removed };
}

/**
 * Cap swiped profile IDs.
 * Returns trimmed array if changes were made, null otherwise.
 */
export function capSwipedProfileIds(
  swipedProfileIds: string[]
): { swipedProfileIds: string[]; removed: number } | null {
  if (swipedProfileIds.length <= MAX_SWIPED_PROFILES) {
    return null;
  }

  // Keep most recent (assume array is in order of swiping)
  const kept = swipedProfileIds.slice(-MAX_SWIPED_PROFILES);
  const removed = swipedProfileIds.length - kept.length;

  return { swipedProfileIds: kept, removed };
}

/**
 * Apply all demo data caps.
 * Call this after hydration completes (non-blocking).
 * Logs a summary if any caps were applied.
 */
export function applyDemoDataCaps(): void {
  // Import stores lazily to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useDemoDmStore } = require('@/stores/demoDmStore') as {
    useDemoDmStore: { getState: () => any; setState: (state: any) => void };
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useDemoStore } = require('@/stores/demoStore') as {
    useDemoStore: { getState: () => any; setState: (state: any) => void };
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useDemoNotifStore } = require('@/hooks/useNotifications') as {
    useDemoNotifStore: { getState: () => any; setState: (state: any) => void };
  };

  const summary: string[] = [];

  // Cap DM store
  const dmState = useDemoDmStore.getState();
  const dmResult = capDmStoreData(dmState.conversations, dmState.meta);
  if (dmResult) {
    useDemoDmStore.setState({ conversations: dmResult.conversations });
    summary.push(`DM: -${dmResult.trimmed.conversationsRemoved} convos, -${dmResult.trimmed.messagesRemoved} msgs`);
  }

  // Cap notifications
  const notifState = useDemoNotifStore.getState();
  if (notifState.notifications) {
    const notifResult = capNotifications(notifState.notifications);
    if (notifResult) {
      useDemoNotifStore.setState({ notifications: notifResult.notifications });
      summary.push(`Notifs: -${notifResult.removed}`);
    }
  }

  // Cap crossed paths and swiped profiles
  const demoState = useDemoStore.getState();

  const crossedResult = capCrossedPaths(demoState.crossedPaths);
  if (crossedResult) {
    useDemoStore.setState({ crossedPaths: crossedResult.crossedPaths });
    summary.push(`CrossedPaths: -${crossedResult.removed}`);
  }

  const swipedResult = capSwipedProfileIds(demoState.swipedProfileIds || []);
  if (swipedResult) {
    useDemoStore.setState({ swipedProfileIds: swipedResult.swipedProfileIds });
    summary.push(`Swiped: -${swipedResult.removed}`);
  }

  // Log summary if any caps were applied
  if (summary.length > 0) {
    log.info('[DEMO_CAPS]', 'Data capped to improve startup', { changes: summary.join('; ') });
  }
}
