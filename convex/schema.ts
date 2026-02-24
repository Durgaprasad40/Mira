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
    handle: v.optional(v.string()), // Unique user ID / nickname (e.g., @johndoe)
    dateOfBirth: v.string(),
    gender: v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other')),

    // Profile
    bio: v.string(),
    height: v.optional(v.number()),
    weight: v.optional(v.number()),
    smoking: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('trying_to_quit'))),
    drinking: v.optional(v.union(v.literal('never'), v.literal('socially'), v.literal('regularly'), v.literal('sober'))),
    exercise: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('daily'))),
    pets: v.optional(v.array(v.union(
      v.literal('dog'),
      v.literal('cat'),
      v.literal('bird'),
      v.literal('fish'),
      v.literal('rabbit'),
      v.literal('hamster'),
      v.literal('guinea_pig'),
      v.literal('turtle'),
      v.literal('parrot'),
      v.literal('pigeon'),
      v.literal('chicken'),
      v.literal('duck'),
      v.literal('goat'),
      v.literal('cow'),
      v.literal('horse'),
      v.literal('snake'),
      v.literal('lizard'),
      v.literal('frog'),
      v.literal('other'),
      v.literal('none'),
      v.literal('want_pets'),
      v.literal('allergic')
    ))),
    insect: v.optional(v.union(
      v.literal('mosquito'),
      v.literal('bee'),
      v.literal('butterfly'),
      v.literal('ant'),
      v.literal('cockroach')
    )),
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
    verificationPhotoId: v.optional(v.id('_storage')), // Legacy - use verificationReferencePhotoId
    verificationCompletedAt: v.optional(v.number()),

    // "Verified Face Required, Privacy After" Policy
    // The user must upload a clear face photo for verification (stored privately)
    // After verification, they can blur/cartoon/replace the display photo
    verificationReferencePhotoId: v.optional(v.id('_storage')), // Private face photo used for matching
    verificationReferencePhotoUrl: v.optional(v.string()),      // URL for the private reference photo
    displayPrimaryPhotoId: v.optional(v.id('_storage')),        // What's shown publicly on profile
    displayPrimaryPhotoUrl: v.optional(v.string()),             // URL for the display photo
    displayPrimaryPhotoVariant: v.optional(v.union(
      v.literal('original'),   // Unmodified original photo
      v.literal('blurred'),    // Photo with face blur applied
      v.literal('cartoon')     // AI-generated cartoon/avatar version
    )),

    // Location (live device location - private)
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    city: v.optional(v.string()),

    // Published location (shared with others, updated max once per 6 hours)
    publishedLat: v.optional(v.number()),
    publishedLng: v.optional(v.number()),
    publishedAt: v.optional(v.number()),

    // Preferences
    lookingFor: v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other'))),
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

    // Discovery Pause
    isDiscoveryPaused: v.optional(v.boolean()),
    discoveryPausedUntil: v.optional(v.number()),

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
    lastLocationUpdatedAt: v.optional(v.number()),   // timestamp of last location save (30-min gate)
    nearbyEnabled: v.optional(v.boolean()),           // user opt-in toggle (default true)
    createdAt: v.number(),

    // Profile Prompts (icebreakers)
    profilePrompts: v.optional(v.array(v.object({
      question: v.string(),
      answer: v.string(),
    }))),

    // Onboarding
    onboardingCompleted: v.boolean(),
    onboardingStep: v.optional(v.string()),

    // 8C: Consent timestamp (required before permissions/photo upload)
    consentAcceptedAt: v.optional(v.number()),

    // Privacy
    showLastSeen: v.optional(v.boolean()),
    hideDistance: v.optional(v.boolean()),        // true = larger fuzz on Nearby map (200-400m vs 20-100m)

    // Photo Blur (user-controlled privacy)
    photoBlurred: v.optional(v.boolean()),       // true = photo shown blurred in Discover/profile

    // Daily nudge tracking
    lastNudgeAt: v.optional(v.number()),         // timestamp of last profile-completion nudge

    // Push Notifications
    pushToken: v.optional(v.string()),
    notificationsEnabled: v.boolean(),

    // Account Status
    isActive: v.boolean(),
    isBanned: v.boolean(),
    banReason: v.optional(v.string()),
    deletedAt: v.optional(v.number()), // Soft delete timestamp (account deletion)

    // 3A1-4: Login rate limiting
    loginAttempts: v.optional(v.number()),
    lastLoginAttemptAt: v.optional(v.number()),

    // 3A2: Password hash versioning (1=legacy, 2=scrypt)
    hashVersion: v.optional(v.number()),

    // Security & Verification
    // 8A: Expanded photo verification states
    verificationStatus: v.optional(v.union(
      v.literal('unverified'),
      v.literal('pending_verification'), // Legacy: maps to pending_auto
      v.literal('pending_auto'),          // Auto-verification in progress
      v.literal('pending_manual'),        // Needs human review
      v.literal('verified'),
      v.literal('rejected')
    )),
    // 8A: Reason for verification failure/pending
    photoVerificationReason: v.optional(v.union(
      v.literal('no_face_detected'),
      v.literal('multiple_faces'),
      v.literal('blurry'),
      v.literal('suspected_fake'),
      v.literal('nsfw_content'),
      v.literal('low_quality'),
      v.literal('manual_review_required'),
      v.literal('face_mismatch')
    )),
    // Face verification score from AWS Rekognition (0-100)
    faceMatchScore: v.optional(v.number()),
    // When face verification was attempted
    faceVerificationAttemptedAt: v.optional(v.number()),
    // Storage ID of the selfie used for verification
    faceVerificationSelfieId: v.optional(v.id('_storage')),
    // Clean face verification status (replaces complex verificationStatus for face matching)
    faceVerificationStatus: v.optional(v.union(
      v.literal('unverified'),  // Not yet verified
      v.literal('pending'),     // Verification in progress or needs manual review
      v.literal('verified'),    // Face verified successfully
      v.literal('failed')       // Face verification failed
    )),
    emailVerified: v.optional(v.boolean()),
    emailVerifiedAt: v.optional(v.number()),
    // 8B: Email verification token (stored as hash for security)
    emailVerificationTokenHash: v.optional(v.string()),
    emailVerificationExpiresAt: v.optional(v.number()),
    // 8B: Session revocation timestamp - all sessions created before this are invalid
    sessionsRevokedAt: v.optional(v.number()),
    trustScore: v.optional(v.number()),
    trustScoreUpdatedAt: v.optional(v.number()),
    primaryDeviceFingerprintId: v.optional(v.id('deviceFingerprints')),
    verificationReminderDismissedAt: v.optional(v.number()),
    verificationEnforcementLevel: v.optional(v.union(v.literal('none'), v.literal('gentle_reminder'), v.literal('reduced_reach'), v.literal('security_only'))),
    profileQualityScore: v.optional(v.number()),

    // Admin access (set manually for authorized users)
    isAdmin: v.optional(v.boolean()),
  })
    .index('by_email', ['email'])
    .index('by_phone', ['phone'])
    .index('by_handle', ['handle'])
    .index('by_external_id', ['externalId'])
    .index('by_gender', ['gender'])
    .index('by_last_active', ['lastActive'])
    .index('by_boosted', ['boostedUntil'])
    .index('by_verification_status', ['verificationStatus']),

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
    // Photo purpose for "Verified Face Required, Privacy After" policy
    photoType: v.optional(v.union(
      v.literal('verification_reference'), // Private photo used for face verification
      v.literal('display'),                 // Shown publicly on profile
      v.literal('gallery')                  // Additional gallery photos
    )),
    // If this is a derived photo (blurred/cartoon version), link to original
    derivedFromPhotoId: v.optional(v.id('photos')),
    // Variant type if this is a derived photo
    variantType: v.optional(v.union(
      v.literal('blurred'),
      v.literal('cartoon')
    )),
  })
    .index('by_user', ['userId'])
    .index('by_user_order', ['userId', 'order'])
    .index('by_user_type', ['userId', 'photoType']),

  // Likes table
  likes: defineTable({
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like'), v.literal('text')),
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
    confessionId: v.optional(v.id('confessions')), // For confession-based threads (tagged user liked)
    participants: v.array(v.id('users')),
    isPreMatch: v.boolean(),
    lastMessageAt: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // Only set for confession-based threads (24h after creation)
  })
    .index('by_match', ['matchId'])
    .index('by_confession', ['confessionId'])
    .index('by_last_message', ['lastMessageAt']),

  // Messages table
  messages: defineTable({
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('template'), v.literal('dare'), v.literal('system')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    mediaId: v.optional(v.id('media')),
    templateId: v.optional(v.string()),
    systemSubtype: v.optional(v.union(
      v.literal('screenshot_taken'),
      v.literal('screenshot_attempted'),
      v.literal('access_requested'),
      v.literal('permission_granted'),
      v.literal('permission_revoked'),
      v.literal('expired')
    )),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
    // BUGFIX #3: Client-provided idempotency key to prevent double-decrement on retry
    clientMessageId: v.optional(v.string()),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_created', ['conversationId', 'createdAt'])
    // BUGFIX #3: Index for idempotency lookup by clientMessageId
    .index('by_conversation_clientMessageId', ['conversationId', 'clientMessageId']),

  // Protected Media table (private storage references — never expose URLs)
  media: defineTable({
    chatId: v.id('conversations'),
    ownerId: v.id('users'),
    objectKey: v.id('_storage'),
    mediaType: v.union(v.literal('image'), v.literal('video')),
    createdAt: v.number(),
    timerSeconds: v.optional(v.number()),
    viewOnce: v.boolean(),
    watermarkEnabled: v.boolean(),
    deletedAt: v.optional(v.number()),
  })
    .index('by_chat', ['chatId'])
    .index('by_owner', ['ownerId']),

  // Media Permissions table (per-recipient access control)
  mediaPermissions: defineTable({
    mediaId: v.id('media'),
    senderId: v.id('users'),
    recipientId: v.id('users'),
    canView: v.boolean(),
    canScreenshot: v.boolean(),
    allowedUntil: v.optional(v.number()),
    revoked: v.boolean(),
    openedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    viewCount: v.number(),
    lastViewedAt: v.optional(v.number()),
  })
    .index('by_media_recipient', ['mediaId', 'recipientId'])
    .index('by_recipient', ['recipientId']),

  // Security Events table (audit log for protected media)
  securityEvents: defineTable({
    chatId: v.id('conversations'),
    mediaId: v.optional(v.id('media')),
    actorId: v.id('users'),
    type: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index('by_chat', ['chatId', 'createdAt'])
    .index('by_media', ['mediaId']),

  // Media Reports table
  mediaReports: defineTable({
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    mediaId: v.optional(v.id('media')),
    chatId: v.id('conversations'),
    reason: v.union(
      v.literal('inappropriate_content'),
      v.literal('non_consensual'),
      v.literal('screenshot_abuse'),
      v.literal('harassment'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved')),
    createdAt: v.number(),
  })
    .index('by_reporter', ['reporterId'])
    .index('by_reported_user', ['reportedUserId'])
    .index('by_status', ['status']),

  // Notifications table
  notifications: defineTable({
    userId: v.id('users'),
    type: v.union(
      v.literal('match'),
      v.literal('message'),
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh'),
      v.literal('profile_nudge')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
    })),
    // 4-1: Deduplication key — same key = same logical event (upsert instead of insert)
    dedupeKey: v.optional(v.string()),
    readAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    // 4-2: Expiry timestamp for cleanup (24h after creation)
    expiresAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_unread', ['userId', 'readAt'])
    // 4-1: Lookup by userId+dedupeKey for upsert
    .index('by_user_dedupe', ['userId', 'dedupeKey'])
    // 4-2: Cleanup index for expired notifications
    .index('by_expires', ['expiresAt']),

  // Crossed Paths table
  crossedPaths: defineTable({
    user1Id: v.id('users'),
    user2Id: v.id('users'),
    count: v.number(),
    lastCrossedAt: v.number(),
    lastLocation: v.optional(v.string()),
    unlockExpiresAt: v.optional(v.number()),
    crossingLatitude: v.optional(v.number()),
    crossingLongitude: v.optional(v.number()),
    // BUGFIX #28: Track last notification time to prevent duplicate notifications
    lastNotifiedAt: v.optional(v.number()),
  })
    .index('by_user1', ['user1Id'])
    .index('by_user2', ['user2Id'])
    .index('by_users', ['user1Id', 'user2Id']),

  // Cross-Path History table (memory-based, privacy-first)
  // Stores CROSSED PATHS with compatibility gate (at least one common element)
  crossPathHistory: defineTable({
    user1Id: v.id('users'),           // ordered pair (user1Id < user2Id)
    user2Id: v.id('users'),
    areaName: v.string(),             // e.g. "Near Banjara Hills"
    // Approximate crossing location (rounded to ~500m grid for privacy)
    crossedLatApprox: v.optional(v.number()),
    crossedLngApprox: v.optional(v.number()),
    // Reason tags for notification: "interest:coffee", "lookingFor:long_term"
    reasonTags: v.optional(v.array(v.string())),
    // Hidden by each user (manual hide/delete)
    hiddenByUser1: v.optional(v.boolean()),
    hiddenByUser2: v.optional(v.boolean()),
    createdAt: v.number(),
    expiresAt: v.number(),            // auto-expire after 30 days
    lastNotifiedAt: v.optional(v.number()), // 24h cooldown tracking
  })
    .index('by_user1', ['user1Id'])
    .index('by_user2', ['user2Id'])
    .index('by_users', ['user1Id', 'user2Id'])
    .index('by_expires', ['expiresAt']),

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
    lastAttemptAt: v.optional(v.number()), // 3A1-3: for lockout timing
    createdAt: v.number(),
  })
    .index('by_identifier', ['identifier'])
    .index('by_identifier_code', ['identifier', 'code']),

  // Phone OTP table (secure, hashed codes)
  phoneOtps: defineTable({
    phone: v.string(),
    codeHash: v.string(),           // SHA-256 hashed OTP code with pepper
    expiresAt: v.number(),          // TTL: 5 minutes
    attempts: v.number(),           // Max 5 attempts
    createdAt: v.number(),
    lastSentAt: v.number(),         // Rate limiting: min 30s between sends
    windowStart: v.number(),        // Rate window start timestamp
    sendCount: v.number(),          // OTPs sent in current window
  })
    .index('by_phone', ['phone']),

  // Sessions table (auth sessions for identity-bound login)
  sessions: defineTable({
    userId: v.id('users'),
    token: v.string(),
    deviceInfo: v.optional(v.string()),
    ipAddress: v.optional(v.string()),      // For security audit
    userAgent: v.optional(v.string()),      // For device identification
    lastActiveAt: v.optional(v.number()),   // Last activity timestamp
    revokedAt: v.optional(v.number()),      // Per-session revocation (logout)
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_token', ['token']),

  // Typing status table (ephemeral)
  typingStatus: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    isTyping: v.boolean(),
    updatedAt: v.number(),
  }).index('by_conversation', ['conversationId']).index('by_user_conversation', ['userId', 'conversationId']),

  // Nudges table (smart notifications)
  nudges: defineTable({
    userId: v.id('users'),
    type: v.union(v.literal('crossed_paths'), v.literal('match_relevance'), v.literal('conversation_nudge'), v.literal('weekly_refresh')),
    title: v.string(),
    body: v.string(),
    navigateTo: v.optional(v.string()),
    dismissed: v.boolean(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index('by_user', ['userId']).index('by_user_active', ['userId', 'dismissed']),

  // Survey Responses table
  surveyResponses: defineTable({
    userId: v.id('users'),
    questionId: v.string(),
    questionText: v.string(),
    response: v.string(),
    createdAt: v.number(),
  }).index('by_user', ['userId']).index('by_question', ['questionId']),

  // Verification Sessions table
  verificationSessions: defineTable({
    userId: v.id('users'),
    selfieStorageId: v.id('_storage'),
    status: v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'), v.literal('expired')),
    rejectionReason: v.optional(v.string()),
    selfieMetadata: v.optional(v.object({
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      format: v.optional(v.string()),
    })),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_status', ['status'])
    .index('by_user_status', ['userId', 'status']),

  // Device Fingerprints table
  deviceFingerprints: defineTable({
    userId: v.id('users'),
    deviceId: v.string(),
    platform: v.string(),
    osVersion: v.string(),
    appVersion: v.string(),
    installId: v.string(),
    deviceModel: v.optional(v.string()),
    isMultiAccountFlagged: v.boolean(),
    linkedUserIds: v.optional(v.array(v.id('users'))),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_device_id', ['deviceId'])
    .index('by_install_id', ['installId']),

  // Behavior Flags table
  behaviorFlags: defineTable({
    userId: v.id('users'),
    flagType: v.union(
      v.literal('rapid_swiping'),
      v.literal('mass_messaging'),
      v.literal('rapid_account_creation'),
      v.literal('reported_by_multiple'),
      v.literal('nsfw_photo_uploaded'),
      v.literal('suspicious_profile'),
      v.literal('manual_flag')
    ),
    severity: v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
    description: v.optional(v.string()),
    resolution: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_type', ['flagType'])
    .index('by_user_type', ['userId', 'flagType']),

  // Moderation Queue table (flagged UGC items for review)
  moderationQueue: defineTable({
    reporterId: v.optional(v.id('users')), // undefined if auto-flagged by system
    reportedUserId: v.id('users'),
    contentType: v.union(
      v.literal('message'), v.literal('bio'), v.literal('room_title'),
      v.literal('tod_prompt'), v.literal('desire_bio'), v.literal('profile_photo'),
    ),
    contentId: v.optional(v.string()), // messageId, roomId, storageId, etc.
    contentText: v.optional(v.string()),
    flagCategories: v.array(v.string()), // e.g. ['explicit', 'solicitation']
    isAutoFlagged: v.boolean(),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved'), v.literal('dismissed')),
    reviewedAt: v.optional(v.number()),
    reviewerNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_reported_user', ['reportedUserId'])
    .index('by_content_type', ['contentType']),

  // User Strikes table (tracks moderation violations and auto-action thresholds)
  userStrikes: defineTable({
    userId: v.id('users'),
    reason: v.string(), // e.g. 'explicit, solicitation'
    severity: v.union(v.literal('low'), v.literal('medium'), v.literal('high'), v.literal('critical')),
    createdAt: v.number(),
  })
    .index('by_user', ['userId']),

  // Private Profiles table (Face 2 / Private Mode)
  // NOTE: Phase-2 profile is stored SEPARATELY from Phase-1.
  // Only minimal data is imported from Phase-1 during setup (name, age, hobbies, photos, verification).
  // After setup, Phase-2 screens read ONLY from this table, not Phase-1 data.
  userPrivateProfiles: defineTable({
    userId: v.id('users'),
    isPrivateEnabled: v.boolean(),
    ageConfirmed18Plus: v.boolean(),
    ageConfirmedAt: v.optional(v.number()),
    privatePhotosBlurred: v.array(v.id('_storage')),
    privatePhotoUrls: v.array(v.string()),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateIntentKeys: v.array(v.string()),
    privateDesireTagKeys: v.array(v.string()),
    privateBoundaries: v.array(v.string()),
    privateBio: v.optional(v.string()),
    displayName: v.string(),
    age: v.number(),
    city: v.optional(v.string()),
    gender: v.string(),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.boolean(),
    // Phase-1 imported fields (read-only after import, stored in Phase-2 for isolation)
    hobbies: v.optional(v.array(v.string())),
    isVerified: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_enabled', ['isPrivateEnabled']),

  // Reveal Requests table (mutual photo reveal for Private Mode)
  revealRequests: defineTable({
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    status: v.union(v.literal('pending'), v.literal('accepted'), v.literal('declined')),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_from_user', ['fromUserId'])
    .index('by_to_user', ['toUserId'])
    .index('by_from_to', ['fromUserId', 'toUserId']),

  // Truth & Dare Prompts (trending system)
  todPrompts: defineTable({
    type: v.union(v.literal('truth'), v.literal('dare')),
    text: v.string(),
    isTrending: v.boolean(),
    ownerUserId: v.string(), // prompt creator (or 'system')
    answerCount: v.number(),
    activeCount: v.number(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index('by_trending', ['isTrending'])
    .index('by_type', ['type'])
    .index('by_owner', ['ownerUserId']),

  // Truth & Dare Answers (one per user per prompt)
  todAnswers: defineTable({
    promptId: v.string(),
    userId: v.string(),
    type: v.union(v.literal('text'), v.literal('photo'), v.literal('video'), v.literal('voice')),
    text: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    mediaStorageId: v.optional(v.id('_storage')),
    durationSec: v.optional(v.number()),
    likeCount: v.number(),
    createdAt: v.number(),
    visibility: v.optional(v.union(v.literal('owner_only'), v.literal('public'))),
    isDemo: v.optional(v.boolean()),
    isAnonymous: v.optional(v.boolean()),
    userGender: v.optional(v.string()),
    profileVisibility: v.optional(v.union(v.literal('blurred'), v.literal('clear'))),
  })
    .index('by_prompt', ['promptId'])
    .index('by_user', ['userId'])
    .index('by_prompt_user', ['promptId', 'userId']),

  // Truth & Dare Answer Likes
  todAnswerLikes: defineTable({
    answerId: v.string(),
    likedByUserId: v.string(),
    createdAt: v.number(),
  })
    .index('by_answer', ['answerId'])
    .index('by_user', ['likedByUserId'])
    .index('by_answer_user', ['answerId', 'likedByUserId']),

  // Truth & Dare Connect Requests (triggered when someone likes an answer)
  todConnectRequests: defineTable({
    promptId: v.string(),
    answerId: v.string(),
    fromUserId: v.string(), // liker
    toUserId: v.string(), // prompt owner
    status: v.union(v.literal('pending'), v.literal('connected'), v.literal('removed')),
    createdAt: v.number(),
  })
    .index('by_to_user', ['toUserId'])
    .index('by_from_to', ['fromUserId', 'toUserId'])
    .index('by_prompt', ['promptId']),

  // Confessions table
  confessions: defineTable({
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    replyCount: v.number(),
    reactionCount: v.number(),
    voiceReplyCount: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // 24h after createdAt; undefined = never expires (legacy)
    taggedUserId: v.optional(v.id('users')), // User being confessed to (must be someone current user has liked)
  })
    .index('by_created', ['createdAt'])
    .index('by_user', ['userId'])
    .index('by_expires', ['expiresAt'])
    .index('by_tagged_user', ['taggedUserId']),

  // Confession Replies table
  confessionReplies: defineTable({
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_user', ['userId']),

  // Confession Reactions table (free emoji — one emoji per user per confession)
  confessionReactions: defineTable({
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    type: v.string(), // any emoji string
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_user', ['userId'])
    .index('by_confession_user', ['confessionId', 'userId']),

  // Confession Reports table
  confessionReports: defineTable({
    confessionId: v.id('confessions'),
    reporterId: v.id('users'),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_reporter', ['reporterId']),

  // Confession Notifications table (for tagged confessions)
  confessionNotifications: defineTable({
    userId: v.id('users'),              // receiver (tagged user)
    confessionId: v.id('confessions'),
    fromUserId: v.id('users'),          // poster
    type: v.literal('TAGGED_CONFESSION'),
    seen: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_user_seen', ['userId', 'seen'])
    .index('by_user_created', ['userId', 'createdAt'])
    .index('by_confession', ['confessionId']),

  // Chat Rooms table (group chat rooms in Private section)
  chatRooms: defineTable({
    name: v.string(),
    slug: v.string(),
    category: v.union(v.literal('language'), v.literal('general')),
    isPublic: v.boolean(),
    createdAt: v.number(),
    lastMessageAt: v.optional(v.number()),
    lastMessageText: v.optional(v.string()),
    memberCount: v.number(),
    createdBy: v.optional(v.id('users')), // Room creator
    isDemoRoom: v.optional(v.boolean()), // Demo mode flag
  })
    .index('by_slug', ['slug'])
    .index('by_last_message', ['lastMessageAt'])
    .index('by_category', ['category']),

  // Chat Room Members table
  chatRoomMembers: defineTable({
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    joinedAt: v.number(),
    role: v.optional(v.union(v.literal('owner'), v.literal('mod'), v.literal('member'))), // Member role
    lastMessageAt: v.optional(v.number()), // For rate limiting
  })
    .index('by_room', ['roomId'])
    .index('by_user', ['userId'])
    .index('by_room_user', ['roomId', 'userId']),

  // Chat Room Messages table
  chatRoomMessages: defineTable({
    roomId: v.id('chatRooms'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('system')),
    text: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
    clientId: v.optional(v.string()), // For deduplication
    status: v.optional(v.union(v.literal('pending'), v.literal('sent'), v.literal('failed'))), // Message status
    deletedAt: v.optional(v.number()), // Soft delete
  })
    .index('by_room', ['roomId'])
    .index('by_room_created', ['roomId', 'createdAt'])
    .index('by_room_clientId', ['roomId', 'clientId']), // For idempotency check

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

  // Crossed Events table (privacy-safe "Someone crossed you" alerts)
  // otherUserId is stored ONLY for dedupe — NEVER exposed to client/UI
  crossedEvents: defineTable({
    userId: v.id('users'),           // receiver (me)
    otherUserId: v.id('users'),      // stored only for dedupe; NEVER shown to user
    createdAt: v.number(),
    expiresAt: v.number(),           // cleanup window (7 days)
  })
    .index('by_user_other', ['userId', 'otherUserId'])
    .index('by_user_createdAt', ['userId', 'createdAt'])
    .index('by_expires', ['expiresAt']),

  // Chat Truth-or-Dare Games table (mandatory in-chat T&D game)
  chatTodGames: defineTable({
    conversationId: v.string(),
    participant1Id: v.string(),
    participant2Id: v.string(),
    chooserUserId: v.union(v.string(), v.null()),
    responderUserId: v.union(v.string(), v.null()),
    promptType: v.union(v.literal('truth'), v.literal('dare'), v.null()),
    promptText: v.union(v.string(), v.null()),
    participant1Skips: v.number(),
    participant2Skips: v.number(),
    currentRound: v.number(),
    roundPhase: v.union(
      v.literal('idle'),
      v.literal('spinning'),
      v.literal('choosing'),
      v.literal('writing'),
      v.literal('answering'),
      v.literal('round_complete'),
      v.literal('unlocked')
    ),
    isMandatoryComplete: v.boolean(),
    lastAnswerType: v.union(
      v.literal('text'),
      v.literal('voice'),
      v.literal('photo'),
      v.literal('video'),
      v.null()
    ),
    lastAnswerText: v.union(v.string(), v.null()),
    lastAnswerMediaUri: v.union(v.string(), v.null()),
    lastAnswerDurationSec: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_participant1', ['participant1Id'])
    .index('by_participant2', ['participant2Id']),

  // Admin Logs table (audit trail for moderation/admin actions)
  adminLogs: defineTable({
    adminUserId: v.id('users'),
    action: v.string(),  // "verify_approve", "verify_reject", "set_admin", "deactivate", "reactivate"
    targetUserId: v.optional(v.id('users')),
    conversationId: v.optional(v.string()),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()),  // small JSON: { oldStatus, newStatus, etc }
    createdAt: v.number(),
  })
    .index('by_admin_createdAt', ['adminUserId', 'createdAt'])
    .index('by_target_createdAt', ['targetUserId', 'createdAt'])
    .index('by_action_createdAt', ['action', 'createdAt'])
    .index('by_createdAt', ['createdAt']),  // For "latest logs" without filters
});
