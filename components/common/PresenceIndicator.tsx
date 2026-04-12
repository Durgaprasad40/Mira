/**
 * PresenceIndicator Component (P0 Unified Presence System)
 *
 * Displays user presence status with consistent styling across the app.
 *
 * USAGE:
 * 1. With reactive presence query (recommended):
 *    <PresenceIndicator userId={userId} />
 *
 * 2. With legacy lastActive timestamp (backwards compatibility):
 *    <PresenceIndicator lastActive={user.lastActive} />
 *
 * DISPLAY VARIANTS:
 * - 'dot': Small colored dot (default, for avatars)
 * - 'badge': Text badge with background (for cards)
 * - 'text': Plain text label (for profiles)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Id } from '@/convex/_generated/dataModel';
import { useUserPresence, PresenceStatus, getPresenceColor } from '@/hooks/usePresence';

// Thresholds (must match convex/presence.ts)
const ONLINE_NOW_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVE_TODAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface PresenceIndicatorProps {
  /** User ID for reactive presence query */
  userId?: Id<'users'> | null;
  /** Legacy: lastActive timestamp (fallback if userId not provided) */
  lastActive?: number;
  /** Display variant */
  variant?: 'dot' | 'badge' | 'text';
  /** Size for dot variant (default: 8) */
  dotSize?: number;
  /** Show "Active today" status (default: true) */
  showActiveToday?: boolean;
  /** Custom style for the container */
  style?: object;
}

/**
 * Compute presence status from a lastActive timestamp.
 * Used for backwards compatibility when userId is not available.
 */
function computeStatusFromTimestamp(lastActive: number): {
  status: PresenceStatus;
  label: string;
} {
  const now = Date.now();
  const timeSince = now - lastActive;

  if (timeSince <= ONLINE_NOW_THRESHOLD_MS) {
    return { status: 'online', label: 'Online now' };
  }
  if (timeSince <= ACTIVE_TODAY_THRESHOLD_MS) {
    return { status: 'active_today', label: 'Active today' };
  }
  return { status: 'offline', label: '' };
}

export function PresenceIndicator({
  userId,
  lastActive,
  variant = 'dot',
  dotSize = 8,
  showActiveToday = true,
  style,
}: PresenceIndicatorProps) {
  // Use reactive presence query if userId is provided
  const reactivePresence = useUserPresence(userId);

  // Compute final presence status
  const presence = useMemo(() => {
    // Prefer reactive presence from query
    if (reactivePresence) {
      return {
        status: reactivePresence.status,
        label: reactivePresence.label,
      };
    }

    // Fallback to legacy lastActive computation
    if (lastActive && lastActive > 0) {
      return computeStatusFromTimestamp(lastActive);
    }

    // Unknown/offline
    return { status: 'offline' as PresenceStatus, label: '' };
  }, [reactivePresence, lastActive]);

  // Don't show anything for offline users (unless badge variant)
  if (presence.status === 'offline') {
    return null;
  }

  // Don't show "Active today" if disabled
  if (presence.status === 'active_today' && !showActiveToday) {
    return null;
  }

  const color = getPresenceColor(presence.status);

  // Dot variant (for avatars)
  if (variant === 'dot') {
    return (
      <View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
          },
          style,
        ]}
      />
    );
  }

  // Badge variant (for cards)
  if (variant === 'badge') {
    return (
      <View style={[styles.badge, { backgroundColor: color + '20' }, style]}>
        <View style={[styles.badgeDot, { backgroundColor: color }]} />
        <Text style={[styles.badgeText, { color }]}>{presence.label}</Text>
      </View>
    );
  }

  // Text variant (for profiles)
  return (
    <Text style={[styles.text, { color }, style]}>{presence.label}</Text>
  );
}

/**
 * Simple hook to get presence status for inline use.
 * Returns { status, label, color } or null if offline.
 */
export function usePresenceDisplay(
  userId?: Id<'users'> | null,
  lastActive?: number
): { status: PresenceStatus; label: string; color: string } | null {
  const reactivePresence = useUserPresence(userId);

  return useMemo(() => {
    let status: PresenceStatus;
    let label: string;

    if (reactivePresence) {
      status = reactivePresence.status;
      label = reactivePresence.label;
    } else if (lastActive && lastActive > 0) {
      const computed = computeStatusFromTimestamp(lastActive);
      status = computed.status;
      label = computed.label;
    } else {
      return null;
    }

    if (status === 'offline') {
      return null;
    }

    return {
      status,
      label,
      color: getPresenceColor(status),
    };
  }, [reactivePresence, lastActive]);
}

const styles = StyleSheet.create({
  dot: {
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
  },
});

export default PresenceIndicator;
