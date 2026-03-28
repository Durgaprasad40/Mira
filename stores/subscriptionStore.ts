/**
 * subscriptionStore — In-memory store for subscription tier and feature limits.
 *
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 */
import { create } from 'zustand';
import { SubscriptionTier, FeatureAccess } from '@/types';
import { isDemoMode } from '@/config/demo';

interface SubscriptionState {
  tier: SubscriptionTier;
  expiresAt: number | null;
  trialEndsAt: number | null;
  isInTrial: boolean;
  isPremium: boolean;

  // Feature access
  likesRemaining: number;
  superLikesRemaining: number;
  messagesRemaining: number;
  rewindsRemaining: number;
  boostsRemaining: number;

  // Reset timestamps
  likesResetAt: number;
  superLikesResetAt: number;
  messagesResetAt: number;

  // Actions
  setSubscription: (tier: SubscriptionTier, expiresAt?: number) => void;
  startTrial: (endsAt: number) => void;
  setLimits: (limits: Partial<{
    likesRemaining: number;
    superLikesRemaining: number;
    messagesRemaining: number;
    rewindsRemaining: number;
    boostsRemaining: number;
  }>) => void;
  decrementLike: () => void;
  decrementSuperLike: () => void;
  decrementMessage: () => void;
  decrementRewind: () => void;
  decrementBoost: () => void;
  resetLimits: () => void;
  getFeatureAccess: (gender: 'male' | 'female' | 'non_binary' | 'other') => FeatureAccess;
}

const FREE_MALE_LIMITS = {
  likesRemaining: 50,
  superLikesRemaining: 1,
  messagesRemaining: 5,
  rewindsRemaining: 0,
  boostsRemaining: 0,
};

const BASIC_MALE_LIMITS = {
  likesRemaining: -1, // unlimited
  superLikesRemaining: 5,
  messagesRemaining: 10,
  rewindsRemaining: 3,
  boostsRemaining: 2,
};

const PREMIUM_MALE_LIMITS = {
  likesRemaining: -1, // unlimited
  superLikesRemaining: -1, // unlimited
  messagesRemaining: -1, // unlimited
  rewindsRemaining: -1, // unlimited
  boostsRemaining: -1, // unlimited
};

export const useSubscriptionStore = create<SubscriptionState>()((set, get) => ({
  tier: 'free',
  expiresAt: null,
  trialEndsAt: null,
  isInTrial: false,
  isPremium: false,

  likesRemaining: 50,
  superLikesRemaining: 1,
  messagesRemaining: 5,
  rewindsRemaining: 0,
  boostsRemaining: 0,

  likesResetAt: Date.now() + 24 * 60 * 60 * 1000,
  superLikesResetAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  messagesResetAt: Date.now() + 7 * 24 * 60 * 60 * 1000,

  setSubscription: (tier, expiresAt) => set({
    tier,
    expiresAt: expiresAt || null,
    isInTrial: false,
    isPremium: tier === 'premium',
  }),

  startTrial: (endsAt) => set({
    isInTrial: true,
    trialEndsAt: endsAt,
    ...FREE_MALE_LIMITS,
  }),

  setLimits: (limits) => set((state) => ({
    ...state,
    ...limits,
  })),

  decrementLike: () => {
    // P0-004 FIX: Demo bypass only in __DEV__ builds
    if (__DEV__ && isDemoMode) return;
    set((state) => ({
      likesRemaining: state.likesRemaining > 0 ? state.likesRemaining - 1 : 0,
    }));
  },

  decrementSuperLike: () => {
    // P0-004 FIX: Demo bypass only in __DEV__ builds
    if (__DEV__ && isDemoMode) return;
    set((state) => ({
      superLikesRemaining: state.superLikesRemaining > 0 ? state.superLikesRemaining - 1 : 0,
    }));
  },

  decrementMessage: () => {
    // P0-004 FIX: Demo bypass only in __DEV__ builds
    if (__DEV__ && isDemoMode) return;
    set((state) => ({
      messagesRemaining: state.messagesRemaining > 0 ? state.messagesRemaining - 1 : 0,
    }));
  },

  decrementRewind: () => {
    // P0-004 FIX: Demo bypass only in __DEV__ builds
    if (__DEV__ && isDemoMode) return;
    set((state) => ({
      rewindsRemaining: state.rewindsRemaining > 0 ? state.rewindsRemaining - 1 : 0,
    }));
  },

  decrementBoost: () => {
    // P0-004 FIX: Demo bypass only in __DEV__ builds
    if (__DEV__ && isDemoMode) return;
    set((state) => ({
      boostsRemaining: state.boostsRemaining > 0 ? state.boostsRemaining - 1 : 0,
    }));
  },

  resetLimits: () => {
    const { tier } = get();
    const now = Date.now();

    if (tier === 'free') {
      set({
        ...FREE_MALE_LIMITS,
        likesResetAt: now + 24 * 60 * 60 * 1000,
        superLikesResetAt: now + 7 * 24 * 60 * 60 * 1000,
        messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      });
    } else if (tier === 'basic') {
      set({
        ...BASIC_MALE_LIMITS,
        likesResetAt: now + 24 * 60 * 60 * 1000,
        superLikesResetAt: now + 7 * 24 * 60 * 60 * 1000,
        messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      });
    } else {
      set({
        ...PREMIUM_MALE_LIMITS,
        likesResetAt: now + 24 * 60 * 60 * 1000,
        superLikesResetAt: now + 7 * 24 * 60 * 60 * 1000,
        messagesResetAt: now + 7 * 24 * 60 * 60 * 1000,
      });
    }
  },

  getFeatureAccess: (gender) => {
    const { tier } = get();

    // P0-004 FIX: Demo bypass only in __DEV__ builds - production cannot access this
    if (__DEV__ && isDemoMode) {
      return {
        swipesPerDay: 'unlimited',
        superLikesPerWeek: 'unlimited',
        messagesPerWeek: 'unlimited',
        boostsPerMonth: 'unlimited',
        canRewind: true,
        canSeeWhoLikedYou: true,
        incognitoAccess: 'full',
        customMessageLength: 'unlimited',
        templateCount: 50,
      };
    }

    // Women get unlimited everything
    if (gender === 'female') {
      return {
        swipesPerDay: 'unlimited',
        superLikesPerWeek: 'unlimited',
        messagesPerWeek: 'unlimited',
        boostsPerMonth: 'unlimited',
        canRewind: true,
        canSeeWhoLikedYou: true,
        incognitoAccess: 'full',
        customMessageLength: 'unlimited',
        templateCount: 50,
      };
    }

    // Men - based on tier
    if (tier === 'premium') {
      return {
        swipesPerDay: 'unlimited',
        superLikesPerWeek: 'unlimited',
        messagesPerWeek: 'unlimited',
        boostsPerMonth: 'unlimited',
        canRewind: true,
        canSeeWhoLikedYou: true,
        incognitoAccess: 'full',
        customMessageLength: 'unlimited',
        templateCount: 50,
      };
    } else if (tier === 'basic') {
      return {
        swipesPerDay: 'unlimited',
        superLikesPerWeek: 5,
        messagesPerWeek: 10,
        boostsPerMonth: 2,
        canRewind: true,
        canSeeWhoLikedYou: true,
        incognitoAccess: 'partial',
        customMessageLength: 150,
        templateCount: 25,
      };
    } else {
      return {
        swipesPerDay: 50,
        superLikesPerWeek: 1,
        messagesPerWeek: 5,
        boostsPerMonth: 0,
        canRewind: false,
        canSeeWhoLikedYou: false,
        incognitoAccess: 'limited',
        customMessageLength: 100,
        templateCount: 10,
      };
    }
  },
}));
