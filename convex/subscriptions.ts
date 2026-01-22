import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

// Get user's subscription status
export const getSubscriptionStatus = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const now = Date.now();

    // Check if subscription is still active
    let isSubscribed = false;
    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt > now) {
      isSubscribed = true;
    }

    // Check trial status
    let isInTrial = false;
    let trialDaysRemaining = 0;
    if (user.trialEndsAt) {
      if (user.trialEndsAt > now) {
        isInTrial = true;
        trialDaysRemaining = Math.ceil((user.trialEndsAt - now) / (24 * 60 * 60 * 1000));
      }
    }

    // Get active subscription record
    const activeSubscription = await ctx.db
      .query('subscriptionRecords')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('isActive'), true),
          q.gt(q.field('expiresAt'), now)
        )
      )
      .first();

    return {
      tier: user.subscriptionTier,
      isSubscribed,
      expiresAt: user.subscriptionExpiresAt,
      isInTrial,
      trialEndsAt: user.trialEndsAt,
      trialDaysRemaining,
      activeSubscription: activeSubscription
        ? {
            planId: activeSubscription.planId,
            startsAt: activeSubscription.startsAt,
            expiresAt: activeSubscription.expiresAt,
          }
        : null,
      // Current limits
      likesRemaining: user.likesRemaining,
      superLikesRemaining: user.superLikesRemaining,
      messagesRemaining: user.messagesRemaining,
      rewindsRemaining: user.rewindsRemaining,
      boostsRemaining: user.boostsRemaining,
      // Reset times
      likesResetAt: user.likesResetAt,
      superLikesResetAt: user.superLikesResetAt,
      messagesResetAt: user.messagesResetAt,
    };
  },
});

// Purchase subscription
export const purchaseSubscription = mutation({
  args: {
    userId: v.id('users'),
    planId: v.string(),
    tier: v.union(v.literal('basic'), v.literal('premium')),
    duration: v.number(),
    price: v.number(),
    currency: v.string(),
    paymentProvider: v.union(v.literal('razorpay'), v.literal('apple'), v.literal('google'), v.literal('revenuecat')),
    transactionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, planId, tier, duration, price, currency, paymentProvider, transactionId } = args;
    const now = Date.now();

    // Verify transaction doesn't already exist
    const existingTransaction = await ctx.db
      .query('subscriptionRecords')
      .withIndex('by_transaction', (q) => q.eq('transactionId', transactionId))
      .first();

    if (existingTransaction) {
      throw new Error('Transaction already processed');
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // Calculate expiry
    const durationMs = duration * 30 * 24 * 60 * 60 * 1000; // Approximate month
    const startsAt = now;
    let expiresAt = now + durationMs;

    // If already subscribed, extend from current expiry
    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt > now) {
      expiresAt = user.subscriptionExpiresAt + durationMs;
    }

    // Create subscription record
    await ctx.db.insert('subscriptionRecords', {
      userId,
      planId,
      tier,
      duration,
      price,
      currency,
      paymentProvider,
      transactionId,
      startsAt,
      expiresAt,
      isActive: true,
      createdAt: now,
    });

    // Update user subscription
    const updates: Record<string, unknown> = {
      subscriptionTier: tier,
      subscriptionExpiresAt: expiresAt,
    };

    // Grant features based on tier
    if (tier === 'basic') {
      updates.superLikesRemaining = 5;
      updates.messagesRemaining = 10;
      updates.rewindsRemaining = 999999;
      updates.boostsRemaining = 2;
    } else if (tier === 'premium') {
      updates.likesRemaining = 999999;
      updates.superLikesRemaining = 999999;
      updates.messagesRemaining = 999999;
      updates.rewindsRemaining = 999999;
      updates.boostsRemaining = 999999;
    }

    await ctx.db.patch(userId, updates);

    return { success: true, expiresAt };
  },
});

// Purchase in-app product (boost, super likes, messages)
export const purchaseProduct = mutation({
  args: {
    userId: v.id('users'),
    productId: v.string(),
    productType: v.union(v.literal('boost'), v.literal('super_likes'), v.literal('messages')),
    quantity: v.number(),
    price: v.number(),
    currency: v.string(),
    paymentProvider: v.union(v.literal('razorpay'), v.literal('apple'), v.literal('google')),
    transactionId: v.string(),
    boostDuration: v.optional(v.number()), // Hours for boost
  },
  handler: async (ctx, args) => {
    const { userId, productId, productType, quantity, price, currency, paymentProvider, transactionId, boostDuration } = args;
    const now = Date.now();

    // Verify transaction doesn't exist
    const existingTransaction = await ctx.db
      .query('purchases')
      .withIndex('by_transaction', (q) => q.eq('transactionId', transactionId))
      .first();

    if (existingTransaction) {
      throw new Error('Transaction already processed');
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // Record purchase
    await ctx.db.insert('purchases', {
      userId,
      productId,
      productType,
      quantity,
      price,
      currency,
      paymentProvider,
      transactionId,
      createdAt: now,
    });

    // Apply product
    switch (productType) {
      case 'boost':
        const boostHours = boostDuration || 1;
        const boostedUntil = now + boostHours * 60 * 60 * 1000;
        await ctx.db.patch(userId, { boostedUntil });
        return { success: true, boostedUntil };

      case 'super_likes':
        await ctx.db.patch(userId, {
          superLikesRemaining: user.superLikesRemaining + quantity,
        });
        return { success: true, newBalance: user.superLikesRemaining + quantity };

      case 'messages':
        await ctx.db.patch(userId, {
          messagesRemaining: user.messagesRemaining + quantity,
        });
        return { success: true, newBalance: user.messagesRemaining + quantity };

      default:
        throw new Error('Invalid product type');
    }
  },
});

// Activate boost
export const activateBoost = mutation({
  args: {
    userId: v.id('users'),
    durationHours: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, durationHours } = args;
    const now = Date.now();

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('User not found');

    // Check if user has boosts available
    if (user.boostsRemaining <= 0) {
      throw new Error('No boosts remaining');
    }

    const boostedUntil = now + durationHours * 60 * 60 * 1000;

    await ctx.db.patch(userId, {
      boostedUntil,
      boostsRemaining: user.boostsRemaining - 1,
    });

    return { success: true, boostedUntil };
  },
});

// Cancel subscription (marks as cancelled but keeps active until expiry)
export const cancelSubscription = mutation({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    const now = Date.now();

    // Find active subscription
    const activeSubscription = await ctx.db
      .query('subscriptionRecords')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(
          q.eq(q.field('isActive'), true),
          q.gt(q.field('expiresAt'), now)
        )
      )
      .first();

    if (!activeSubscription) {
      throw new Error('No active subscription');
    }

    // Mark as cancelled (will still be active until expiresAt)
    await ctx.db.patch(activeSubscription._id, {
      isActive: false,
    });

    // Note: User keeps subscription benefits until expiresAt
    // A scheduled job should downgrade them when subscription expires

    return { success: true, expiresAt: activeSubscription.expiresAt };
  },
});

// Check and update expired subscriptions (should be called by a cron job)
export const checkExpiredSubscriptions = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find users with expired subscriptions
    const users = await ctx.db.query('users').collect();

    let updatedCount = 0;
    for (const user of users) {
      if (
        user.subscriptionTier !== 'free' &&
        user.subscriptionExpiresAt &&
        user.subscriptionExpiresAt < now
      ) {
        // Downgrade to free tier
        await ctx.db.patch(user._id, {
          subscriptionTier: 'free',
          // Reset to free tier limits
          likesRemaining: 50,
          superLikesRemaining: 0,
          messagesRemaining: 0,
          rewindsRemaining: 0,
          boostsRemaining: 0,
        });
        updatedCount++;
      }
    }

    return { updatedCount };
  },
});

// Get purchase history
export const getPurchaseHistory = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query('subscriptionRecords')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(20);

    const purchases = await ctx.db
      .query('purchases')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(20);

    return {
      subscriptions,
      purchases,
    };
  },
});

// Restore purchases (for app store restore)
export const restorePurchases = mutation({
  args: {
    userId: v.id('users'),
    transactionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, transactionIds } = args;
    const now = Date.now();

    let restoredSubscription = null;

    for (const transactionId of transactionIds) {
      // Check if this is a subscription
      const subscription = await ctx.db
        .query('subscriptionRecords')
        .withIndex('by_transaction', (q) => q.eq('transactionId', transactionId))
        .first();

      if (subscription && subscription.expiresAt > now) {
        // Restore this subscription
        await ctx.db.patch(userId, {
          subscriptionTier: subscription.tier,
          subscriptionExpiresAt: subscription.expiresAt,
        });
        restoredSubscription = subscription;
        break; // Only restore one subscription
      }
    }

    return {
      success: true,
      restoredSubscription,
    };
  },
});
