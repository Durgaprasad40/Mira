/**
 * usePresence Hook (P0 Unified Presence System)
 *
 * SINGLE SOURCE OF TRUTH for user presence (Online Now / Active Today / Offline).
 *
 * ARCHITECTURE:
 * - Calls markActive() mutation on app foreground and every 30s while active
 * - Calls markBackground() when app goes to background
 * - Calls markInactive() when app terminates (best effort)
 * - Uses reactive query getUserPresence() for real-time status
 *
 * THRESHOLDS (standardized):
 * - Online Now: lastSeenAt within 10 minutes AND appState = 'foreground'
 * - Active Today: lastSeenAt within 24 hours
 * - Offline: lastSeenAt > 24 hours ago OR appState = 'inactive'
 *
 * USAGE:
 * - Call usePresenceHeartbeat() from root _layout.tsx to start heartbeat
 * - Call useUserPresence(userId) to get reactive presence for a specific user
 * - Call useBatchPresence(userIds) to get presence for multiple users
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEBUG_PRESENCE } from '@/lib/debugFlags';

// =============================================================================
// CONSTANTS (match backend)
// =============================================================================

/** Heartbeat interval: 30 seconds (as specified in backend) */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** Throttle: Don't send heartbeats more often than every 20 seconds */
const HEARTBEAT_THROTTLE_MS = 20 * 1000;

// =============================================================================
// TYPES
// =============================================================================

export type PresenceStatus = 'online' | 'active_today' | 'offline';

export interface PresenceInfo {
  status: PresenceStatus;
  lastSeenAt: number;
  appState: 'foreground' | 'background' | 'inactive';
  label: string;
}

// =============================================================================
// PRESENCE HEARTBEAT HOOK (Global)
// =============================================================================

/**
 * Start presence heartbeat for the current user.
 * Call this ONCE from root _layout.tsx.
 *
 * This hook:
 * - Sends markActive() on foreground and every 30s
 * - Sends markBackground() when app goes to background
 * - Automatically handles auth state changes
 */
export function usePresenceHeartbeat() {
  const { userId, token } = useAuthStore();

  const markActiveMutation = useMutation(api.presence.markActive);
  const markBackgroundMutation = useMutation(api.presence.markBackground);
  const markInactiveMutation = useMutation(api.presence.markInactive);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const currentAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Send heartbeat (markActive)
  const sendHeartbeat = useCallback(async () => {
    if (isDemoMode || !userId || !token) return;

    const now = Date.now();
    // Throttle heartbeats
    if (now - lastHeartbeatRef.current < HEARTBEAT_THROTTLE_MS) {
      return;
    }

    try {
      lastHeartbeatRef.current = now;
      await markActiveMutation({ token });

      if (__DEV__ && DEBUG_PRESENCE) {
        console.log(`[PRESENCE] markActive: ${userId.slice(-6)}`);
      }
    } catch (err) {
      // Silent failure - don't break app
      if (__DEV__ && DEBUG_PRESENCE) {
        console.warn('[PRESENCE] markActive failed:', String(err).slice(0, 50));
      }
    }
  }, [userId, token, markActiveMutation]);

  // Mark as background
  const markBackground = useCallback(async () => {
    if (isDemoMode || !userId || !token) return;

    try {
      await markBackgroundMutation({ token });

      if (__DEV__ && DEBUG_PRESENCE) {
        console.log(`[PRESENCE] markBackground: ${userId.slice(-6)}`);
      }
    } catch (err) {
      // Silent failure
      if (__DEV__ && DEBUG_PRESENCE) {
        console.warn('[PRESENCE] markBackground failed:', String(err).slice(0, 50));
      }
    }
  }, [userId, token, markBackgroundMutation]);

  // Mark as inactive (on logout or app terminate)
  const markInactive = useCallback(async () => {
    if (isDemoMode || !userId || !token) return;

    try {
      await markInactiveMutation({ token });

      if (__DEV__ && DEBUG_PRESENCE) {
        console.log(`[PRESENCE] markInactive: ${userId.slice(-6)}`);
      }
    } catch (err) {
      // Silent failure - best effort on terminate
    }
  }, [userId, token, markInactiveMutation]);

  // Handle app state changes
  useEffect(() => {
    if (isDemoMode || !userId) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const prevAppState = currentAppStateRef.current;
      currentAppStateRef.current = nextAppState;

      if (nextAppState === 'active') {
        // App came to foreground
        if (__DEV__ && DEBUG_PRESENCE) {
          console.log('[PRESENCE] app → foreground');
        }
        sendHeartbeat();
      } else if (nextAppState === 'background' && prevAppState === 'active') {
        // App went to background
        if (__DEV__ && DEBUG_PRESENCE) {
          console.log('[PRESENCE] app → background');
        }
        markBackground();
      } else if (nextAppState === 'inactive') {
        // App is terminating or transitioning
        // markInactive is best-effort here
        markInactive();
      }
    };

    // Subscribe to app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial heartbeat on mount
    if (AppState.currentState === 'active') {
      sendHeartbeat();
    }

    // Start heartbeat interval
    heartbeatIntervalRef.current = setInterval(() => {
      if (AppState.currentState === 'active') {
        sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      subscription.remove();
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [userId, sendHeartbeat, markBackground, markInactive]);

  // Return markInactive for explicit logout scenarios
  return { markInactive };
}

// =============================================================================
// PRESENCE QUERY HOOKS (Per-user / Batch)
// =============================================================================

/**
 * Get reactive presence status for a single user.
 * Use this in profile views, chat headers, etc.
 *
 * @param userId - The user ID to get presence for
 * @returns PresenceInfo or undefined if loading
 */
export function useUserPresence(userId: Id<'users'> | null | undefined): PresenceInfo | undefined {
  const presence = useQuery(
    api.presence.getUserPresence,
    userId ? { userId } : 'skip'
  );

  return presence;
}

/**
 * Get reactive presence status for multiple users.
 * Use this in Discover cards, Messages list, etc.
 *
 * @param userIds - Array of user IDs to get presence for
 * @returns Record mapping userId to PresenceInfo
 */
export function useBatchPresence(
  userIds: Id<'users'>[] | null | undefined
): Record<string, PresenceInfo> | undefined {
  const presence = useQuery(
    api.presence.getBatchPresence,
    userIds && userIds.length > 0 ? { userIds } : 'skip'
  );

  return presence;
}

// =============================================================================
// PRESENCE DISPLAY HELPERS
// =============================================================================

/**
 * Get human-readable presence label with formatting.
 */
export function getPresenceLabel(presence: PresenceInfo | undefined): string {
  if (!presence) return '';
  return presence.label;
}

/**
 * Get presence indicator color.
 */
export function getPresenceColor(status: PresenceStatus): string {
  switch (status) {
    case 'online':
      return '#22c55e'; // Green
    case 'active_today':
      return '#f59e0b'; // Amber
    case 'offline':
      return '#9ca3af'; // Gray
    default:
      return '#9ca3af';
  }
}

/**
 * Check if user should show online indicator dot.
 */
export function shouldShowOnlineIndicator(presence: PresenceInfo | undefined): boolean {
  return presence?.status === 'online';
}
