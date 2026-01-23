import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Users table
  users: defineTable({
    // Auth
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    authProvider: v.optional(v.union(v.literal('email'), v.literal('phone'), v.literal('google'), v.literal('apple'), v.literal('facebook'))),
    externalId: v.optional(v.string()), // For social auth

    // Basic Info
    name: v.string(),
    dateOfBirth: v.string(),
    gender: v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('other')),

    // Profile
    bio: v.string(),
    height: v.optional(v.number()),
    weight: v.optional(v.number()),
    smoking: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('trying_to_quit'))),
    drinking: v.optional(v.union(v.literal('never'), v.literal('socially'), v.literal('regularly'), v.literal('sober'))),
    exercise: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('daily'))),
    pets: v.optional(v.array(v.union(v.literal('dog'), v.literal('cat'), v.literal('bird'), v.literal('other'), v.literal('none'), v.literal('want_pets'), v.literal('allergic')))),
    kids: v.optional(v.union(
      v.literal('have_and_want_more'),
      v.literal('have_and_dont_want_more'),
      v.literal('dont_have_and_want'),
      v.literal('dont_have_and_dont_want'),
      v.literal('not_sure')
    )),
    education: v.optional(v.union(
      v.literal('high_school'),
      v.literal('some_college'),
      v.literal('bachelors'),
      v.literal('masters'),
      v.literal('doctorate'),
      v.literal('trade_school'),
      v.literal('other')
    )),
    religion: v.optional(v.union(
      v.literal('christian'),
      v.literal('muslim'),
      v.literal('hindu'),
      v.literal('buddhist'),
      v.literal('jewish'),
      v.literal('sikh'),
      v.literal('atheist'),
      v.literal('agnostic'),
      v.literal('spiritual'),
      v.literal('other'),
      v.literal('prefer_not_to_say')
    )),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    school: v.optional(v.string()),

    // Verification
    isVerified: v.boolean(),
    verificationPhotoId: v.optional(v.id('_storage')),
    verificationCompletedAt: v.optional(v.number()),

    // Location
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    city: v.optional(v.string()),

    // Preferences
    lookingFor: v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('other'))),
    relationshipIntent: v.array(v.union(
      v.literal('long_term'),
      v.literal('short_term'),
      v.literal('fwb'),
      v.literal('figuring_out'),
      v.literal('short_to_long'),
      v.literal('long_to_short'),
      v.literal('new_friends'),
      v.literal('open_to_anything')
    )),
    activities: v.array(v.union(
      v.literal('coffee'),
      v.literal('date_night'),
      v.literal('sports'),
      v.literal('movies'),
      v.literal('free_tonight'),
      v.literal('foodie'),
      v.literal('gym_partner'),
      v.literal('concerts'),
      v.literal('travel'),
      v.literal('outdoors'),
      v.literal('art_culture'),
      v.literal('gaming'),
      v.literal('nightlife'),
      v.literal('brunch'),
      v.literal('study_date'),
      v.literal('this_weekend'),
      v.literal('beach_pool'),
      v.literal('road_trip'),
      v.literal('photography'),
      v.literal('volunteering')
    )),
    minAge: v.number(),
    maxAge: v.number(),
    maxDistance: v.number(),

    // Subscription
    subscriptionTier: v.union(v.literal('free'), v.literal('basic'), v.literal('premium')),
    subscriptionExpiresAt: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),

    // Incognito Mode
    incognitoMode: v.boolean(),

    // Usage Stats
    likesRemaining: v.number(),
    superLikesRemaining: v.number(),
    messagesRemaining: v.number(),
    rewindsRemaining: v.number(),
    boostsRemaining: v.number(),

    // Reset Timestamps
    likesResetAt: v.number(),
    superLikesResetAt: v.number(),
    messagesResetAt: v.number(),

    // Boost
    boostedUntil: v.optional(v.number()),

    // Activity
    lastActive: v.number(),
    createdAt: v.number(),

    // Onboarding
    onboardingCompleted: v.boolean(),
    onboardingStep: v.optional(v.string()),

    // Push Notifications
    pushToken: v.optional(v.string()),
    notificationsEnabled: v.boolean(),

    // Account Status
    isActive: v.boolean(),
    isBanned: v.boolean(),
    banReason: v.optional(v.string()),
  })
    .index('by_email', ['email'])
    .index('by_phone', ['phone'])
    .index('by_external_id', ['externalId'])
    .index('by_gender', ['gender'])
    .index('by_last_active', ['lastActive'])
    .index('by_boosted', ['boostedUntil']),

  // Photos table
  photos: defineTable({
    userId: v.id('users'),
    storageId: v.id('_storage'),
    url: v.string(),
    order: v.number(),
    isPrimary: v.boolean(),
    hasFace: v.boolean(),
    isNsfw: v.boolean(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_order', ['userId', 'order']),

  // Likes table
  likes: defineTable({
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like')),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_from_user', ['fromUserId'])
    .index('by_to_user', ['toUserId'])
    .index('by_from_to', ['fromUserId', 'toUserId'])
    .index('by_to_from', ['toUserId', 'fromUserId']),

  // Matches table
  matches: defineTable({
    user1Id: v.id('users'),
    user2Id: v.id('users'),
    matchedAt: v.number(),
    user1UnmatchedAt: v.optional(v.number()),
    user2UnmatchedAt: v.optional(v.number()),
    crossedPathsCount: v.optional(v.number()),
    isActive: v.boolean(),
  })
    .index('by_user1', ['user1Id'])
    .index('by_user2', ['user2Id'])
    .index('by_users', ['user1Id', 'user2Id']),

  // Conversations table
  conversations: defineTable({
    matchId: v.optional(v.id('matches')),
    participants: v.array(v.id('users')),
    isPreMatch: v.boolean(),
    lastMessageAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_match', ['matchId'])
    .index('by_last_message', ['lastMessageAt']),

  // Messages table
  messages: defineTable({
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('template'), v.literal('dare')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    templateId: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_created', ['conversationId', 'createdAt']),

  // Notifications table
  notifications: defineTable({
    userId: v.id('users'),
    type: v.union(
      v.literal('match'),
      v.literal('message'),
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
    })),
    readAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_unread', ['userId', 'readAt']),

  // Crossed Paths table
  crossedPaths: defineTable({
    user1Id: v.id('users'),
    user2Id: v.id('users'),
    count: v.number(),
    lastCrossedAt: v.number(),
    lastLocation: v.optional(v.string()),
    unlockExpiresAt: v.optional(v.number()),
  })
    .index('by_user1', ['user1Id'])
    .index('by_user2', ['user2Id'])
    .index('by_users', ['user1Id', 'user2Id']),

  // Dares table (Truth or Dare feature)
  dares: defineTable({
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    content: v.string(),
    isAccepted: v.optional(v.boolean()),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_from_user', ['fromUserId'])
    .index('by_to_user', ['toUserId']),

  // Subscriptions table (purchase records)
  subscriptionRecords: defineTable({
    userId: v.id('users'),
    planId: v.string(),
    tier: v.union(v.literal('basic'), v.literal('premium')),
    duration: v.number(),
    price: v.number(),
    currency: v.string(),
    paymentProvider: v.union(v.literal('razorpay'), v.literal('apple'), v.literal('google'), v.literal('revenuecat')),
    transactionId: v.string(),
    startsAt: v.number(),
    expiresAt: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_transaction', ['transactionId']),

  // In-App Purchases table
  purchases: defineTable({
    userId: v.id('users'),
    productId: v.string(),
    productType: v.union(v.literal('boost'), v.literal('super_likes'), v.literal('messages')),
    quantity: v.number(),
    price: v.number(),
    currency: v.string(),
    paymentProvider: v.union(v.literal('razorpay'), v.literal('apple'), v.literal('google')),
    transactionId: v.string(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_transaction', ['transactionId']),

  // Reports table
  reports: defineTable({
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    reason: v.union(
      v.literal('fake_profile'),
      v.literal('inappropriate_photos'),
      v.literal('harassment'),
      v.literal('spam'),
      v.literal('underage'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved')),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_reported_user', ['reportedUserId'])
    .index('by_status', ['status']),

  // Blocks table
  blocks: defineTable({
    blockerId: v.id('users'),
    blockedUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_blocker', ['blockerId'])
    .index('by_blocked', ['blockedUserId'])
    .index('by_blocker_blocked', ['blockerId', 'blockedUserId']),

  // OTP table for verification
  otpCodes: defineTable({
    identifier: v.string(), // email or phone
    code: v.string(),
    type: v.union(v.literal('email'), v.literal('phone')),
    expiresAt: v.number(),
    verifiedAt: v.optional(v.number()),
    attempts: v.number(),
    createdAt: v.number(),
  })
    .index('by_identifier', ['identifier'])
    .index('by_identifier_code', ['identifier', 'code']),

  // Sessions table
  sessions: defineTable({
    userId: v.id('users'),
    token: v.string(),
    deviceInfo: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_token', ['token']),

  // Filter Presets table
  filterPresets: defineTable({
    userId: v.id('users'),
    name: v.string(),
    filters: v.object({
      relationshipIntents: v.optional(v.array(v.string())),
      activities: v.optional(v.array(v.string())),
      timeFilters: v.optional(v.array(v.string())),
      ageMin: v.optional(v.number()),
      ageMax: v.optional(v.number()),
      maxDistance: v.optional(v.number()),
    }),
    createdAt: v.number(),
  })
    .index('by_user', ['userId']),
});
