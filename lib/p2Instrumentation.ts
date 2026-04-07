/**
 * Phase-2 Messages & Truth or Dare Sentry Instrumentation
 *
 * Structured debug instrumentation for tracing real-time sync issues:
 * - Online status mismatch between devices
 * - Delayed delivery/read tick updates
 * - Updates only appearing after tab focus
 * - T/D invite not appearing instantly
 *
 * Categories:
 * - p2.presence: Presence/online status flow
 * - p2.messages: Message send/deliver/read flow
 * - p2.tod: Truth or Dare invite/game flow
 * - p2.auth: Auth/identity resolution flow
 *
 * USAGE:
 * import { P2 } from '@/lib/p2Instrumentation';
 * P2.presence.chatFocused(conversationId, userId);
 */

import { addBreadcrumb, captureMessage, Sentry } from './sentry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnlineStatus = 'online' | 'recently_active' | 'offline';
type TickState = 'pending' | 'sent' | 'delivered' | 'read';
type TodState = 'none' | 'pending' | 'active' | 'cooldown';

// ---------------------------------------------------------------------------
// Context Setters
// ---------------------------------------------------------------------------

/**
 * Set Phase-2 context tags for all subsequent events.
 * Call when entering Phase-2 chat or messages screen.
 */
export function setP2Context(context: {
  conversationId?: string;
  authUserId?: string;
  resolvedUserId?: string;
  otherUserId?: string;
  screen?: 'incognito-chat' | 'phase2-messages' | 'phase2-likes';
  sessionId?: string;
}): void {
  Sentry.setTag('phase', 'phase2');
  if (context.screen) Sentry.setTag('p2.screen', context.screen);
  if (context.conversationId) Sentry.setTag('p2.conversationId', context.conversationId.slice(-8));
  if (context.authUserId) Sentry.setTag('p2.authUserId', context.authUserId.slice(-8));
  if (context.resolvedUserId) Sentry.setTag('p2.resolvedUserId', context.resolvedUserId.slice(-8));
  if (context.otherUserId) Sentry.setTag('p2.otherUserId', context.otherUserId.slice(-8));
  if (context.sessionId) Sentry.setTag('p2.sessionId', context.sessionId.slice(-8));
}

/**
 * Clear Phase-2 context tags when leaving Phase-2 screens.
 */
export function clearP2Context(): void {
  Sentry.setTag('phase', null);
  Sentry.setTag('p2.screen', null);
  Sentry.setTag('p2.conversationId', null);
  Sentry.setTag('p2.authUserId', null);
  Sentry.setTag('p2.resolvedUserId', null);
  Sentry.setTag('p2.otherUserId', null);
  Sentry.setTag('p2.sessionId', null);
}

// ---------------------------------------------------------------------------
// Presence Instrumentation (p2.presence)
// ---------------------------------------------------------------------------

export const presence = {
  /**
   * Chat screen focused - presence heartbeat should start
   */
  chatFocused(conversationId: string, userId: string): void {
    addBreadcrumb('Chat focused', 'p2.presence', {
      conversationId: conversationId?.slice(-8),
      userId: userId?.slice(-8),
      timestamp: Date.now(),
    });
    if (__DEV__) console.log('[P2_PRESENCE] Chat focused:', conversationId?.slice(-8));
  },

  /**
   * Heartbeat interval started
   */
  heartbeatStarted(userId: string, intervalMs: number): void {
    addBreadcrumb('Heartbeat started', 'p2.presence', {
      userId: userId?.slice(-8),
      intervalMs,
    });
  },

  /**
   * Heartbeat tick fired
   */
  heartbeatTick(userId: string): void {
    addBreadcrumb('Heartbeat tick', 'p2.presence', {
      userId: userId?.slice(-8),
      timestamp: Date.now(),
    });
  },

  /**
   * Heartbeat stopped (chat unfocused)
   */
  heartbeatStopped(userId: string): void {
    addBreadcrumb('Heartbeat stopped', 'p2.presence', {
      userId: userId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_PRESENCE] Heartbeat stopped');
  },

  /**
   * Presence mutation requested
   */
  mutationRequested(userId: string): void {
    addBreadcrumb('Presence mutation requested', 'p2.presence', {
      userId: userId?.slice(-8),
    });
  },

  /**
   * Presence mutation succeeded
   */
  mutationSuccess(userId: string): void {
    addBreadcrumb('Presence mutation success', 'p2.presence', {
      userId: userId?.slice(-8),
    });
  },

  /**
   * Presence mutation failed
   */
  mutationFailed(userId: string, error: string): void {
    addBreadcrumb('Presence mutation failed', 'p2.presence', {
      userId: userId?.slice(-8),
      error,
    });
  },

  /**
   * Presence query result received
   */
  queryResult(otherUserId: string, lastActiveAt: number): void {
    addBreadcrumb('Presence query result', 'p2.presence', {
      otherUserId: otherUserId?.slice(-8),
      lastActiveAt,
      ageMs: lastActiveAt ? Date.now() - lastActiveAt : null,
    });
  },

  /**
   * Derived online status calculated
   */
  statusDerived(otherUserId: string, status: OnlineStatus, lastActiveAt: number): void {
    addBreadcrumb('Status derived', 'p2.presence', {
      otherUserId: otherUserId?.slice(-8),
      status,
      lastActiveAt,
      ageMs: lastActiveAt ? Date.now() - lastActiveAt : null,
    });
    if (__DEV__) console.log('[P2_PRESENCE_STATUS]', otherUserId?.slice(-8), '→', status);
  },

  /**
   * ANOMALY: Presence mismatch detected
   */
  mismatchDetected(details: {
    conversationId: string;
    expectedStatus: OnlineStatus;
    actualStatus: OnlineStatus;
    lastActiveAt: number;
    source: string;
  }): void {
    addBreadcrumb('Presence mismatch detected', 'p2.presence', details);
    captureMessage('P2 Presence Mismatch', 'warning');
  },
};

// ---------------------------------------------------------------------------
// Messages Instrumentation (p2.messages)
// ---------------------------------------------------------------------------

export const messages = {
  /**
   * Send message button pressed
   */
  sendPressed(conversationId: string, messageType: string): void {
    addBreadcrumb('Send pressed', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      messageType,
    });
  },

  /**
   * Backend send mutation requested
   */
  sendRequested(conversationId: string, messageType: string): void {
    addBreadcrumb('Send requested', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      messageType,
      timestamp: Date.now(),
    });
    if (__DEV__) console.log('[P2_MSG_SEND_REQ]', conversationId?.slice(-8), messageType);
  },

  /**
   * Backend send mutation succeeded
   */
  sendSuccess(conversationId: string, messageId: string): void {
    addBreadcrumb('Send success', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      messageId: messageId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_MSG_SEND_OK]', messageId?.slice(-8));
  },

  /**
   * Backend send mutation failed
   */
  sendFailed(conversationId: string, error: string): void {
    addBreadcrumb('Send failed', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      error,
    });
  },

  /**
   * Mark delivered mutation requested
   */
  deliverRequested(conversationId: string): void {
    addBreadcrumb('Deliver requested', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      timestamp: Date.now(),
    });
  },

  /**
   * Mark delivered mutation succeeded
   */
  deliverSuccess(conversationId: string, count: number): void {
    addBreadcrumb('Deliver success', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      count,
    });
    if (__DEV__) console.log('[P2_MSG_DELIVER_OK] Marked', count, 'delivered');
  },

  /**
   * Mark read mutation requested
   */
  readRequested(conversationId: string): void {
    addBreadcrumb('Read requested', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      timestamp: Date.now(),
    });
  },

  /**
   * Mark read mutation succeeded
   */
  readSuccess(conversationId: string, count: number): void {
    addBreadcrumb('Read success', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      count,
    });
    if (__DEV__) console.log('[P2_MSG_READ_OK] Marked', count, 'read');
  },

  /**
   * Conversation list synced (query result)
   */
  listSynced(conversationCount: number): void {
    addBreadcrumb('List synced', 'p2.messages', {
      conversationCount,
      timestamp: Date.now(),
    });
  },

  /**
   * Thread messages synced (query result)
   */
  threadSynced(conversationId: string, messageCount: number): void {
    addBreadcrumb('Thread synced', 'p2.messages', {
      conversationId: conversationId?.slice(-8),
      messageCount,
    });
  },

  /**
   * Unread badge updated
   */
  unreadBadgeUpdated(totalUnread: number): void {
    addBreadcrumb('Unread badge updated', 'p2.messages', {
      totalUnread,
    });
  },

  /**
   * Tick state transition observed
   */
  tickTransition(messageId: string, fromState: TickState, toState: TickState): void {
    addBreadcrumb('Tick transition', 'p2.messages', {
      messageId: messageId?.slice(-8),
      fromState,
      toState,
    });
    if (__DEV__) console.log('[P2_MSG_TICK]', messageId?.slice(-8), fromState, '→', toState);
  },

  /**
   * ANOMALY: Delivery delay detected
   */
  deliveryDelayDetected(details: {
    conversationId: string;
    messageId: string;
    sentAt: number;
    delayMs: number;
  }): void {
    addBreadcrumb('Delivery delay detected', 'p2.messages', details);
    captureMessage('P2 Delivery Delay', 'warning');
  },

  /**
   * ANOMALY: Read not updating after recipient opened chat
   */
  readNotUpdating(details: {
    conversationId: string;
    messageId: string;
    openedAt: number;
    currentTime: number;
  }): void {
    addBreadcrumb('Read not updating', 'p2.messages', details);
    captureMessage('P2 Read Update Delay', 'warning');
  },

  /**
   * ANOMALY: List only updates on tab focus
   */
  listOnlyOnFocus(details: {
    lastSyncTime: number;
    focusTime: number;
    missedMessages: number;
  }): void {
    addBreadcrumb('List only on focus', 'p2.messages', details);
    captureMessage('P2 List Sync Only On Focus', 'warning');
  },
};

// ---------------------------------------------------------------------------
// Truth or Dare Instrumentation (p2.tod)
// ---------------------------------------------------------------------------

export const tod = {
  /**
   * Invite button pressed
   */
  invitePressed(conversationId: string, inviterId: string, inviteeId: string): void {
    addBreadcrumb('Invite pressed', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      inviterId: inviterId?.slice(-8),
      inviteeId: inviteeId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_TD_INVITE_PRESSED]', inviterId?.slice(-8), '→', inviteeId?.slice(-8));
  },

  /**
   * Invite mutation requested
   */
  inviteRequested(conversationId: string): void {
    addBreadcrumb('Invite requested', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      timestamp: Date.now(),
    });
  },

  /**
   * Invite mutation succeeded
   */
  inviteSuccess(conversationId: string): void {
    addBreadcrumb('Invite success', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_TD_INVITE_OK]');
  },

  /**
   * Invite mutation failed
   */
  inviteFailed(conversationId: string, error: string, status?: string): void {
    addBreadcrumb('Invite failed', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      error,
      status,
    });
  },

  /**
   * Invite query result received
   */
  queryResult(conversationId: string, state: TodState, sessionId?: string, inviterId?: string, inviteeId?: string): void {
    addBreadcrumb('Query result', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      state,
      sessionId: sessionId?.slice(-8),
      inviterId: inviterId?.slice(-8),
      inviteeId: inviteeId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_TD_QUERY]', conversationId?.slice(-8), '→', state);
  },

  /**
   * Invite card rendered
   */
  inviteRendered(conversationId: string, inviterId: string, inviteeId: string, isInvitee: boolean): void {
    addBreadcrumb('Invite rendered', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      inviterId: inviterId?.slice(-8),
      inviteeId: inviteeId?.slice(-8),
      isInvitee,
    });
    if (__DEV__) console.log('[P2_TD_INVITE_RENDER] isInvitee:', isInvitee);
  },

  /**
   * Invite accepted
   */
  inviteAccepted(conversationId: string, accepterId: string): void {
    addBreadcrumb('Invite accepted', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      accepterId: accepterId?.slice(-8),
    });
  },

  /**
   * Invite rejected
   */
  inviteRejected(conversationId: string, rejecterId: string): void {
    addBreadcrumb('Invite rejected', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      rejecterId: rejecterId?.slice(-8),
    });
  },

  /**
   * Game session became active
   */
  gameActive(conversationId: string, sessionId: string): void {
    addBreadcrumb('Game active', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      sessionId: sessionId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_TD_GAME_ACTIVE]', sessionId?.slice(-8));
  },

  /**
   * Game ended
   */
  gameEnded(conversationId: string, sessionId: string): void {
    addBreadcrumb('Game ended', 'p2.tod', {
      conversationId: conversationId?.slice(-8),
      sessionId: sessionId?.slice(-8),
    });
    if (__DEV__) console.log('[P2_TD_GAME_ENDED]', sessionId?.slice(-8));
  },

  /**
   * ANOMALY: Invite send success but not appearing on other device
   */
  inviteSyncFailure(details: {
    conversationId: string;
    inviterId: string;
    inviteeId: string;
    sendTime: number;
    queryState: TodState;
  }): void {
    addBreadcrumb('Invite sync failure', 'p2.tod', details);
    captureMessage('P2 TD Invite Sync Failure', 'warning');
  },

  /**
   * ANOMALY: Expired invite still rendered
   */
  expiredInviteRendered(details: {
    conversationId: string;
    sessionId: string;
    createdAt: number;
    expiredMs: number;
  }): void {
    addBreadcrumb('Expired invite rendered', 'p2.tod', details);
    captureMessage('P2 TD Expired Invite Rendered', 'warning');
  },
};

// ---------------------------------------------------------------------------
// Auth Instrumentation (p2.auth)
// ---------------------------------------------------------------------------

export const auth = {
  /**
   * Auth user ID available from store
   */
  authUserIdAvailable(authUserId: string): void {
    addBreadcrumb('Auth user ID available', 'p2.auth', {
      authUserId: authUserId?.slice(-8),
    });
  },

  /**
   * Fallback identity resolution used
   */
  fallbackUsed(authUserId: string, source: string): void {
    addBreadcrumb('Fallback used', 'p2.auth', {
      authUserId: authUserId?.slice(-8),
      source,
    });
    if (__DEV__) console.log('[P2_AUTH_FALLBACK]', source, authUserId?.slice(-8));
    captureMessage('P2 Auth Fallback Used', 'info');
  },

  /**
   * User ID resolved successfully
   */
  userIdResolved(authUserId: string, resolvedUserId: string): void {
    addBreadcrumb('User ID resolved', 'p2.auth', {
      authUserId: authUserId?.slice(-8),
      resolvedUserId: resolvedUserId?.slice(-8),
    });
  },

  /**
   * User ID resolution failed
   */
  userIdResolutionFailed(authUserId: string, error: string): void {
    addBreadcrumb('User ID resolution failed', 'p2.auth', {
      authUserId: authUserId?.slice(-8),
      error,
    });
    captureMessage('P2 Auth Resolution Failed', 'error');
  },

  /**
   * Conversation participant IDs
   */
  participantIds(conversationId: string, currentUserId: string, otherUserId: string): void {
    addBreadcrumb('Participant IDs', 'p2.auth', {
      conversationId: conversationId?.slice(-8),
      currentUserId: currentUserId?.slice(-8),
      otherUserId: otherUserId?.slice(-8),
    });
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const P2 = {
  setContext: setP2Context,
  clearContext: clearP2Context,
  presence,
  messages,
  tod,
  auth,
};

export default P2;
