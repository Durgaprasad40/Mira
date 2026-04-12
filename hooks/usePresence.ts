/**
 * usePresence Hook
 *
 * The dedicated Convex `presence.*` module no longer exists in this checkout.
 * Presence is now derived from `users.lastActive`, which is still updated by
 * existing auth, messaging, and chat flows.
 */
import { useCallback, useMemo } from 'react';
import { useQueries, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import { DEBUG_PRESENCE } from '@/lib/debugFlags';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Kept for compatibility with existing callers/docs. */
export const HEARTBEAT_INTERVAL_MS = 15 * 1000;
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const ACTIVE_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;

// =============================================================================
// TYPES
// =============================================================================

export type PresenceStatus = 'online' | 'active_today' | 'offline';

export interface PresenceInfo {
  status: PresenceStatus;
  lastSeenAt: number;
  appState: 'foreground' | 'background' | 'inactive';
  label: string;
  isHidden?: boolean;
}

interface PresenceQueryOptions {
  respectPrivacy?: boolean;
}

function derivePresenceInfo(
  lastSeenAt: number | undefined,
  respectPrivacy?: boolean
): PresenceInfo | undefined {
  if (!lastSeenAt || !Number.isFinite(lastSeenAt)) {
    return respectPrivacy
      ? {
          status: 'offline',
          lastSeenAt: 0,
          appState: 'inactive',
          label: '',
          isHidden: true,
        }
      : undefined;
  }

  const now = Date.now();
  const delta = Math.max(0, now - lastSeenAt);

  if (delta <= ONLINE_WINDOW_MS) {
    return {
      status: 'online',
      lastSeenAt,
      appState: 'foreground',
      label: 'Online now',
    };
  }

  if (delta <= ACTIVE_TODAY_WINDOW_MS) {
    return {
      status: 'active_today',
      lastSeenAt,
      appState: 'background',
      label: 'Active today',
    };
  }

  return {
    status: 'offline',
    lastSeenAt,
    appState: 'inactive',
    label: '',
  };
}

function useCurrentViewerId(): Id<'users'> | undefined {
  const { userId } = useAuthStore();
  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );

  return currentUser?._id as Id<'users'> | undefined;
}

// =============================================================================
// PRESENCE HEARTBEAT HOOK (Global)
// =============================================================================

/**
 * Start presence heartbeat for the current user.
 * Call this ONCE from root _layout.tsx.
 *
 * The dedicated backend heartbeat endpoints were removed from the current
 * backend contract. Keep this hook as a safe no-op so existing callers do not
 * crash while presence continues to be derived from `users.lastActive`.
 */
export function usePresenceHeartbeat() {
  const { userId } = useAuthStore();

  const markInactive = useCallback(async () => {
    if (__DEV__ && DEBUG_PRESENCE && userId) {
      console.log(`[PRESENCE] heartbeat noop: ${userId.slice(-6)}`);
    }
  }, [userId]);

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
export function useUserPresence(
  userId: Id<'users'> | null | undefined,
  options: PresenceQueryOptions = {}
): PresenceInfo | undefined {
  const viewerId = useCurrentViewerId();
  const profile = useQuery(
    api.users.getUserById,
    userId && viewerId
      ? { userId, viewerId }
      : 'skip'
  );

  return useMemo(
    () => derivePresenceInfo(profile?.lastActive, options.respectPrivacy),
    [profile?.lastActive, options.respectPrivacy]
  );
}

/**
 * Get reactive presence status for multiple users.
 * Use this in Discover cards, Messages list, etc.
 *
 * @param userIds - Array of user IDs to get presence for
 * @returns Record mapping userId to PresenceInfo
 */
export function useBatchPresence(
  userIds: Id<'users'>[] | null | undefined,
  options: PresenceQueryOptions = {}
): Record<string, PresenceInfo> | undefined {
  const viewerId = useCurrentViewerId();

  const uniqueUserIds = useMemo(
    () => Array.from(new Set((userIds ?? []).map((id) => id as string))),
    [userIds]
  );

  const queries = useMemo(() => {
    if (!viewerId || uniqueUserIds.length === 0) {
      return {};
    }

    return Object.fromEntries(
      uniqueUserIds.map((id) => [
        id,
        {
          query: api.users.getUserById,
          args: {
            userId: id as Id<'users'>,
            viewerId,
          },
        },
      ])
    );
  }, [viewerId, uniqueUserIds]);

  const profiles = useQueries(queries);

  return useMemo(() => {
    if (!viewerId || !userIds || userIds.length === 0) {
      return undefined;
    }

    const presenceByUserId: Record<string, PresenceInfo> = {};

    for (const userId of userIds) {
      const result = profiles[userId as string];
      if (!result || result instanceof Error) {
        continue;
      }

      const presence = derivePresenceInfo(result.lastActive, options.respectPrivacy);
      if (presence) {
        presenceByUserId[userId as string] = presence;
      }
    }

    return presenceByUserId;
  }, [viewerId, userIds, profiles, options.respectPrivacy]);
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
