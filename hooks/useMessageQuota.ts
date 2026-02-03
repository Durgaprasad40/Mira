import { useMemo } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { isDemoMode } from '@/config/demo';

interface MessageQuota {
  remaining: number;
  total: number;
  isUnlimited: boolean;
  resetAt: number;
  canSend: boolean;
  timeUntilReset: string;
}

export function useMessageQuota(): MessageQuota {
  const {
    messagesRemaining,
    messagesResetAt,
    tier,
  } = useSubscriptionStore();

  return useMemo(() => {
    // Demo mode — unlimited messages, no restrictions
    if (isDemoMode) {
      return {
        remaining: -1,
        total: -1,
        isUnlimited: true,
        resetAt: 0,
        canSend: true,
        timeUntilReset: '',
      };
    }

    const now = Date.now();
    const timeUntilResetMs = Math.max(0, messagesResetAt - now);

    // Calculate human-readable time
    const hours = Math.floor(timeUntilResetMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    let timeUntilReset = '';
    if (days > 0) {
      timeUntilReset = `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      timeUntilReset = `${hours}h`;
    } else {
      const minutes = Math.floor(timeUntilResetMs / (1000 * 60));
      timeUntilReset = `${minutes}m`;
    }

    const isUnlimited = messagesRemaining === -1 || tier === 'premium';

    // Determine total based on tier
    let total = 5; // free
    if (tier === 'basic') total = 10;
    if (tier === 'premium') total = -1; // unlimited

    return {
      remaining: isUnlimited ? -1 : messagesRemaining,
      total,
      isUnlimited,
      resetAt: messagesResetAt,
      canSend: isUnlimited || messagesRemaining > 0,
      timeUntilReset,
    };
  }, [messagesRemaining, messagesResetAt, tier]);
}
