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
    lgbtqSelf: v.optional(v.array(v.union(
      v.literal('gay'),
      v.literal('lesbian'),
      v.literal('bisexual'),
      v.literal('transgender'),
      v.literal('prefer_not_to_say')
    ))), // LGBTQ identity (optional, max 2)
    // Legacy compatibility: older user docs stored dating preference here.
    // Active onboarding uses onboardingDraft.preferences.lgbtqPreference instead.
    lgbtqPreference: v.optional(v.array(v.union(
      v.literal('gay'),
      v.literal('lesbian'),
      v.literal('bisexual'),
      v.literal('transgender'),
      v.literal('prefer_not_to_say')
    ))),

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

    // STABILITY FIX: C-10 - Denormalized primary photo URL to avoid N+1 queries
    primaryPhotoUrl: v.optional(v.string()),

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
      // Legacy compatibility: older user docs stored label-style slugs, now normalized to canonical values.
      v.literal('serious_vibes'),
      v.literal('keep_it_casual'),
      v.literal('exploring_vibes'),
      v.literal('see_where_it_goes'),
      v.literal('open_to_vibes'),
      v.literal('just_friends'),
      v.literal('new_to_dating'),
      // UI-only legacy compatibility: older top-level user rows may still carry these values.
      v.literal('single_parent'),
      v.literal('just_18'),
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
    orientation: v.optional(v.union(
      v.literal('straight'),
      v.literal('gay'),
      v.literal('lesbian'),
      v.literal('bisexual'),
      v.literal('prefer_not_to_say'),
      v.null()
    )),
    sortBy: v.optional(v.union(
      v.literal('recommended'),
      v.literal('newest'),
      v.literal('distance'),
      v.literal('age'),
      v.literal('recently_active')
    )),
    // Legacy compatibility: older discover assignment experiments stored category metadata here.
    // Active app logic no longer reads or writes these fields.
    assignedDiscoverCategory: v.optional(v.string()),
    discoverCategoryAssignedAt: v.optional(v.number()),

    // Subscription
    subscriptionTier: v.union(v.literal('free'), v.literal('basic'), v.literal('premium')),
    subscriptionExpiresAt: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),

    // Incognito Mode
    incognitoMode: v.boolean(),

    // Discovery Pause
    isDiscoveryPaused: v.optional(v.boolean()),
    discoveryPausedUntil: v.optional(v.number()),

    // Chat Rooms: Preferred room (auto-opens on tab entry)
    preferredChatRoomId: v.optional(v.id('chatRooms')),

    // Usage Stats
    likesRemaining: v.number(),
    superLikesRemaining: v.number(),
    messagesRemaining: v.number(),
    rewindsRemaining: v.number(),
    boostsRemaining: v.number(),

    // Wallet (coins for private room creation, etc.)
    walletCoins: v.optional(v.number()),

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
    crossedPathsEnabled: v.optional(v.boolean()),     // participate in crossed paths detection (default true)
    nearbyPausedUntil: v.optional(v.number()),        // pause nearby visibility until timestamp
    nearbyVisibilityMode: v.optional(v.union(         // time-based visibility mode
      v.literal('always'),          // Always visible (default)
      v.literal('app_open'),        // Only while using app
      v.literal('recent')           // Visible for 30 min after app use
    )),
    createdAt: v.number(),

    // Profile Prompts (icebreakers)
    profilePrompts: v.optional(v.array(v.object({
      // Legacy compatibility: older prompt entries persisted section metadata.
      section: v.optional(v.union(
        v.literal('builder'),
        v.literal('performer'),
        v.literal('seeker'),
        v.literal('grounded')
      )),
      question: v.string(),
      answer: v.string(),
    }))),

    // Onboarding
    onboardingCompleted: v.boolean(),
    onboardingStep: v.optional(v.string()),

    // Phase-2 Onboarding (Private Mode)
    // Once true, user never sees Phase-2 onboarding again
    phase2OnboardingCompleted: v.optional(v.boolean()),
    phase2OnboardingCompletedAt: v.optional(v.number()),

    // Private Mode Welcome/Guidelines Confirmation (18+ consent gate)
    // Once true, user skips the consent screen on subsequent visits
    privateWelcomeConfirmed: v.optional(v.boolean()),
    privateWelcomeConfirmedAt: v.optional(v.number()),

    // Onboarding Draft (persistent storage for incomplete onboarding)
    onboardingDraft: v.optional(v.object({
      // Basic Info
      basicInfo: v.optional(v.object({
        name: v.optional(v.string()),
        handle: v.optional(v.string()),
        dateOfBirth: v.optional(v.string()),
        gender: v.optional(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other'))),
      })),
      // Profile Details
      profileDetails: v.optional(v.object({
        height: v.optional(v.number()),
        weight: v.optional(v.number()),
        jobTitle: v.optional(v.string()),
        company: v.optional(v.string()),
        school: v.optional(v.string()),
        education: v.optional(v.union(
          v.literal('high_school'),
          v.literal('some_college'),
          v.literal('bachelors'),
          v.literal('masters'),
          v.literal('doctorate'),
          v.literal('trade_school'),
          v.literal('other')
        )),
        bio: v.optional(v.string()),
        profilePrompts: v.optional(v.array(v.object({
          section: v.optional(v.union(
            v.literal('builder'),
            v.literal('performer'),
            v.literal('seeker'),
            v.literal('grounded')
          )),
          question: v.string(),
          answer: v.string(),
        }))),
        displayPhotoVariant: v.optional(v.union(
          v.literal('original'),
          v.literal('blurred'),
          v.literal('cartoon')
        )),
        // New Prompt System V2
        seedQuestions: v.optional(v.object({
          identityAnchor: v.optional(v.union(
            v.literal('builder'), v.literal('performer'), v.literal('seeker'), v.literal('grounded')
          )),
          socialBattery: v.optional(v.union(
            v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.literal(5)
          )),
          valueTrigger: v.optional(v.union(
            v.literal('thoughtful_questions'), v.literal('kind_to_staff'), v.literal('great_humor'), v.literal('on_time')
          )),
        })),
        sectionPrompts: v.optional(v.object({
          builder: v.optional(v.array(v.object({ question: v.string(), answer: v.string() }))),
          performer: v.optional(v.array(v.object({ question: v.string(), answer: v.string() }))),
          seeker: v.optional(v.array(v.object({ question: v.string(), answer: v.string() }))),
          grounded: v.optional(v.array(v.object({ question: v.string(), answer: v.string() }))),
        })),
      })),
      // Lifestyle
      lifestyle: v.optional(v.object({
        smoking: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('trying_to_quit'))),
        drinking: v.optional(v.union(v.literal('never'), v.literal('socially'), v.literal('regularly'), v.literal('sober'))),
        exercise: v.optional(v.union(v.literal('never'), v.literal('sometimes'), v.literal('regularly'), v.literal('daily'))),
        pets: v.optional(v.array(v.union(
          v.literal('dog'), v.literal('cat'), v.literal('bird'), v.literal('fish'), v.literal('rabbit'),
          v.literal('hamster'), v.literal('guinea_pig'), v.literal('turtle'), v.literal('parrot'), v.literal('pigeon'),
          v.literal('chicken'), v.literal('duck'), v.literal('goat'), v.literal('cow'), v.literal('horse'),
          v.literal('snake'), v.literal('lizard'), v.literal('frog'), v.literal('other'), v.literal('none'),
          v.literal('want_pets'), v.literal('allergic')
        ))),
        insect: v.optional(v.union(v.literal('mosquito'), v.literal('bee'), v.literal('butterfly'), v.literal('ant'), v.literal('cockroach'))),
        kids: v.optional(v.union(
          v.literal('have_and_want_more'),
          v.literal('have_and_dont_want_more'),
          v.literal('dont_have_and_want'),
          v.literal('dont_have_and_dont_want'),
          v.literal('not_sure')
        )),
        religion: v.optional(v.union(
          v.literal('christian'), v.literal('muslim'), v.literal('hindu'), v.literal('buddhist'),
          v.literal('jewish'), v.literal('sikh'), v.literal('atheist'), v.literal('agnostic'),
          v.literal('spiritual'), v.literal('other'), v.literal('prefer_not_to_say')
        )),
      })),
      // Life Rhythm (new matching signals)
      lifeRhythm: v.optional(v.object({
        city: v.optional(v.string()),
        socialRhythm: v.optional(v.union(
          v.literal('quiet_homebody'), v.literal('small_group'), v.literal('balanced_mix'),
          v.literal('very_social'), v.literal('party_nightlife')
        )),
        sleepSchedule: v.optional(v.union(
          v.literal('early_bird'), v.literal('slightly_early'), v.literal('flexible'),
          v.literal('night_owl'), v.literal('very_late_night')
        )),
        travelStyle: v.optional(v.union(
          v.literal('love_frequent'), v.literal('few_trips_yearly'), v.literal('occasional'),
          v.literal('prefer_local'), v.literal('special_reasons')
        )),
        workStyle: v.optional(v.union(
          v.literal('very_career'), v.literal('ambitious_balanced'), v.literal('balanced_lifestyle'),
          v.literal('flexible_creative'), v.literal('still_exploring')
        )),
        coreValues: v.optional(v.array(v.union(
          v.literal('kindness'), v.literal('humor'), v.literal('loyalty'), v.literal('intelligence'),
          v.literal('ambition'), v.literal('curiosity'), v.literal('emotional_maturity'), v.literal('honesty'),
          v.literal('independence'), v.literal('creativity'), v.literal('stability'), v.literal('adventure'),
          v.literal('discipline'), v.literal('generosity'), v.literal('open_mindedness')
        ))),
      })),
      // Preferences
      preferences: v.optional(v.object({
        lookingFor: v.optional(v.array(v.union(v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other')))),
        // LEGACY COMPAT: includes 'bisexual' (meaningful data) and 'prefer_not_to_say' (run migration to remove).
        lgbtqPreference: v.optional(v.array(v.union(
          v.literal('male'), v.literal('female'), v.literal('non_binary'), v.literal('lesbian'), v.literal('other'), v.literal('transgender'), v.literal('bisexual'), v.literal('prefer_not_to_say')
        ))),
        relationshipIntent: v.optional(v.array(v.union(
          // Legacy compatibility: older drafts stored label-style slugs that are now normalized to canonical values.
          v.literal('serious_vibes'),
          v.literal('keep_it_casual'),
          v.literal('exploring_vibes'),
          v.literal('see_where_it_goes'),
          v.literal('open_to_vibes'),
          v.literal('just_friends'),
          v.literal('new_to_dating'),
          // UI-only legacy compatibility: onboarding previously allowed these extra intent chips.
          v.literal('single_parent'),
          v.literal('just_18'),
          v.literal('long_term'), v.literal('short_term'), v.literal('fwb'), v.literal('figuring_out'),
          v.literal('short_to_long'), v.literal('long_to_short'), v.literal('new_friends'), v.literal('open_to_anything')
        ))),
        activities: v.optional(v.array(v.union(
          // Original 20 activities
          v.literal('coffee'), v.literal('date_night'), v.literal('sports'), v.literal('movies'), v.literal('free_tonight'),
          v.literal('foodie'), v.literal('gym_partner'), v.literal('concerts'), v.literal('travel'), v.literal('outdoors'),
          v.literal('art_culture'), v.literal('gaming'), v.literal('nightlife'), v.literal('brunch'), v.literal('study_date'),
          v.literal('this_weekend'), v.literal('beach_pool'), v.literal('road_trip'), v.literal('photography'), v.literal('volunteering'),
          // Additional 50 activities (matching frontend ACTIVITY_FILTERS)
          v.literal('late_night_talks'), v.literal('street_food'), v.literal('home_cooking'), v.literal('baking'), v.literal('healthy_eating'),
          v.literal('weekend_getaways'), v.literal('long_drives'), v.literal('city_exploring'), v.literal('beach_vibes'), v.literal('mountain_views'),
          v.literal('nature_walks'), v.literal('sunset_views'), v.literal('hiking'), v.literal('camping'), v.literal('stargazing'),
          v.literal('gardening'), v.literal('gym'), v.literal('yoga'), v.literal('running'), v.literal('cycling'),
          v.literal('meditation'), v.literal('pilates'), v.literal('music_lover'), v.literal('live_concerts'), v.literal('singing'),
          v.literal('podcasts'), v.literal('binge_watching'), v.literal('thrillers'), v.literal('documentaries'), v.literal('anime'),
          v.literal('k_dramas'), v.literal('board_games'), v.literal('chess'), v.literal('escape_rooms'), v.literal('drawing'),
          v.literal('painting'), v.literal('writing'), v.literal('journaling'), v.literal('diy_projects'), v.literal('reading'),
          v.literal('personal_growth'), v.literal('learning_new_skills'), v.literal('mindfulness'), v.literal('tech_enthusiast'), v.literal('startups'),
          v.literal('coding'), v.literal('community_service'), v.literal('sustainability'), v.literal('plant_parenting')
        ))),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        maxDistance: v.optional(v.number()),
      })),
      // Progress tracking
      progress: v.optional(v.object({
        lastStepKey: v.optional(v.string()),
        lastUpdatedAt: v.optional(v.number()),
      })),
    })),

    // 8C: Consent timestamp (required before permissions/photo upload)
    consentAcceptedAt: v.optional(v.number()),

    // Privacy
    showLastSeen: v.optional(v.boolean()),
    hideFromDiscover: v.optional(v.boolean()),      // true = don't appear in Phase-1 Discover (persistent)
    hideDistance: v.optional(v.boolean()),         // true = don't show distance info to others
    hideAge: v.optional(v.boolean()),              // true = don't show age on profile
    disableReadReceipts: v.optional(v.boolean()), // true = others can't see when user read messages
    strongPrivacyMode: v.optional(v.boolean()),    // true = larger fuzz on Nearby map (200-400m vs 50-150m)

    // Photo Blur (user-controlled privacy)
    photoBlurred: v.optional(v.boolean()),       // true = photo shown blurred in Discover/profile

    // Daily nudge tracking
    lastNudgeAt: v.optional(v.number()),         // timestamp of last profile-completion nudge

    // Push Notifications
    pushToken: v.optional(v.string()),
    notificationsEnabled: v.boolean(),
    emailNotificationsEnabled: v.optional(v.boolean()), // Email notification preference
    // Notification type preferences
    notifyNewMatches: v.optional(v.boolean()),
    notifyNewMessages: v.optional(v.boolean()),
    notifyLikesAndSuperLikes: v.optional(v.boolean()),
    notifyProfileViews: v.optional(v.boolean()),

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
    // Trust counters (Step 5): denormalized counts for ranking penalties at scale
    reportCount: v.optional(v.number()),
    blockCount: v.optional(v.number()),

    // Admin access (set manually for authorized users)
    isAdmin: v.optional(v.boolean()),

    // Demo mode: identifier for demo users (e.g. "demo_manmohan_gmain_com")
    demoUserId: v.optional(v.string()),

    // Universal auth identity key (preferred over demoUserId for new lookups)
    authUserId: v.optional(v.string()),

    // Duplicate user detection: points to the primary user if this is a duplicate
    // Set when race condition creates multiple users with same demoUserId
    duplicateOf: v.optional(v.id('users')),
  })
    .index('by_email', ['email'])
    .index('by_phone', ['phone'])
    .index('by_handle', ['handle'])
    .index('by_external_id', ['externalId'])
    .index('by_gender', ['gender'])
    .index('by_last_active', ['lastActive'])
    .index('by_boosted', ['boostedUntil'])
    .index('by_verification_status', ['verificationStatus'])
    .index('by_demo_user_id', ['demoUserId'])
    .index('by_auth_user_id', ['authUserId']),

  // Photos table
  photos: defineTable({
    userId: v.id('users'),
    storageId: v.id('_storage'),
    url: v.string(),
    order: v.number(),
    isPrimary: v.boolean(),
    hasFace: v.boolean(),
    isBlurred: v.optional(v.boolean()), // legacy stored flag; active blur contract now uses variantType/displayPrimaryPhotoVariant/user.photoBlurred
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
    // Lifecycle tracking: when the recipient first opened/viewed this like
    // Unopened likes stay indefinitely; opened likes expire after 24h if no action
    firstOpenedAt: v.optional(v.number()),
  })
    .index('by_from_user', ['fromUserId'])
    .index('by_from_user_createdAt', ['fromUserId', 'createdAt'])
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
    // Track how this match was created for UI organization
    // 'super_like' matches appear in Super Likes section, 'like' in New Matches
    matchSource: v.optional(v.union(v.literal('like'), v.literal('super_like'))),
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
    // PRIVACY FIX: Track which participant should be shown anonymously in confession chats
    // When set, this user's real identity (name, photo) should NOT be exposed to the other participant
    anonymousParticipantId: v.optional(v.id('users')),
    // Phase-2: Room this DM originated from (for per-room unread badge)
    sourceRoomId: v.optional(v.id('chatRooms')),
    // Connection source for Phase-2 T&D/Room/Desire handoffs
    connectionSource: v.optional(v.union(
      v.literal('match'),
      v.literal('confession'),
      v.literal('tod'),
      v.literal('room'),
      v.literal('desire')
    )),
  })
    .index('by_match', ['matchId'])
    .index('by_confession', ['confessionId'])
    .index('by_last_message', ['lastMessageAt'])
    .index('by_source_room', ['sourceRoomId'])
    .index('by_connection_source', ['connectionSource']),

  // C1/C2/C3-REPAIR: Conversation participants junction table
  // Enables efficient user-scoped conversation queries + denormalized unread counts
  conversationParticipants: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    unreadCount: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_conversation', ['conversationId'])
    .index('by_user_conversation', ['userId', 'conversationId']),

  // Messages table
  messages: defineTable({
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('template'), v.literal('dare'), v.literal('system'), v.literal('voice')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    mediaId: v.optional(v.id('media')),
    templateId: v.optional(v.string()),
    // Voice message fields
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-2 PRIVATE CONVERSATIONS (Deep Connect)
  // Isolated from Phase-1 tables for strict privacy separation
  // ═══════════════════════════════════════════════════════════════════════════

  privateConversations: defineTable({
    participants: v.array(v.id('users')),
    connectionSource: v.optional(v.union(
      v.literal('tod'),
      v.literal('room'),
      v.literal('desire'),
      v.literal('desire_match'),
      v.literal('desire_super_like'),
      v.literal('friend')
    )),
    matchId: v.optional(v.string()),
    isPreMatch: v.optional(v.boolean()),
    lastMessageAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_connection_source', ['connectionSource'])
    .index('by_last_message', ['lastMessageAt']),

  privateConversationParticipants: defineTable({
    conversationId: v.id('privateConversations'),
    userId: v.id('users'),
    unreadCount: v.number(),
    isHidden: v.optional(v.boolean()),
  })
    .index('by_user', ['userId'])
    .index('by_conversation', ['conversationId'])
    .index('by_user_conversation', ['userId', 'conversationId']),

  privateMessages: defineTable({
    conversationId: v.id('privateConversations'),
    senderId: v.id('users'),
    type: v.union(
      v.literal('text'),
      v.literal('image'),
      v.literal('video'),
      v.literal('voice'),
      v.literal('system')
    ),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    isProtected: v.optional(v.boolean()),
    protectedMediaTimer: v.optional(v.number()),
    protectedMediaViewingMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    protectedMediaIsMirrored: v.optional(v.boolean()),
    viewedAt: v.optional(v.number()),
    timerEndsAt: v.optional(v.number()),
    isExpired: v.optional(v.boolean()),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
    clientMessageId: v.optional(v.string()),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_created', ['conversationId', 'createdAt'])
    .index('by_conversation_clientMessageId', ['conversationId', 'clientMessageId']),

  privateTypingStatus: defineTable({
    conversationId: v.id('privateConversations'),
    userId: v.id('users'),
    isTyping: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_user_conversation', ['userId', 'conversationId']),

  privateUserPresence: defineTable({
    userId: v.id('users'),
    lastActiveAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId']),

  privatePhotoAccessRequests: defineTable({
    ownerUserId: v.id('users'),
    viewerUserId: v.id('users'),
    status: v.union(v.literal('pending'), v.literal('approved'), v.literal('declined')),
    requestSource: v.union(v.literal('phase2_messages'), v.literal('phase2_profile')),
    conversationId: v.optional(v.id('privateConversations')),
    createdAt: v.number(),
    updatedAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index('by_owner_viewer', ['ownerUserId', 'viewerUserId'])
    .index('by_owner_status', ['ownerUserId', 'status']),

  // Phase-2 Likes table (Deep Connect swipes)
  // STRICT ISOLATION: Separate from Phase-1 'likes' table
  privateLikes: defineTable({
    fromUserId: v.id('users'),
    toUserId: v.id('users'),
    action: v.union(v.literal('like'), v.literal('pass'), v.literal('super_like')),
    message: v.optional(v.string()), // For super_like messages
    createdAt: v.number(),
  })
    .index('by_from_to', ['fromUserId', 'toUserId'])
    .index('by_from_user', ['fromUserId'])
    .index('by_to_user', ['toUserId']),

  // Phase-2 Matches table (Deep Connect matches)
  // STRICT ISOLATION: Separate from Phase-1 'matches' table
  privateMatches: defineTable({
    user1Id: v.id('users'), // Sorted pair: user1Id < user2Id
    user2Id: v.id('users'),
    matchedAt: v.number(),
    isActive: v.boolean(),
    matchSource: v.union(v.literal('like'), v.literal('super_like')),
  })
    .index('by_users', ['user1Id', 'user2Id'])
    .index('by_user1', ['user1Id'])
    .index('by_user2', ['user2Id']),

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
    // EXPIRY-SYNC-FIX: Track global expiry for both sender and receiver
    expiredAt: v.optional(v.number()),
    // HOLD-TAP-FIX: Store the viewing mode (tap-to-view vs hold-to-view)
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    // VIDEO-MIRROR-FIX: Store mirrored flag for front-camera videos
    isMirrored: v.optional(v.boolean()),
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
      v.literal('like'),
      v.literal('super_like'),
      v.literal('crossed_paths'),
      v.literal('subscription'),
      v.literal('weekly_refresh'),
      v.literal('profile_nudge'),
      // Phase-2 notification types (isolated from Phase-1)
      v.literal('phase2_match'),
      v.literal('phase2_like'),
      v.literal('phase2_private_message')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      pairKey: v.optional(v.string()), // Deterministic crossed paths pair key
      likeType: v.optional(v.union(v.literal('like'), v.literal('super_like'))), // Type of like received
      // Phase-2 specific fields
      phase: v.optional(v.string()), // 'phase2' to distinguish P2 notifications
      otherUserId: v.optional(v.string()), // For P2 likes - who sent the like
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
      // Original reasons
      v.literal('fake_profile'),
      v.literal('inappropriate_photos'),
      v.literal('harassment'),
      v.literal('spam'),
      v.literal('underage'),
      v.literal('other'),
      // Chat room reasons
      v.literal('hate_speech'),
      v.literal('sexual_content'),
      v.literal('nudity'),
      v.literal('violent_threats'),
      v.literal('impersonation'),
      v.literal('selling')
    ),
    description: v.optional(v.string()),
    evidence: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          type: v.union(v.literal('photo'), v.literal('video')),
        }),
      ),
    ),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved')),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    // Optional: chat room context for in-room reports
    roomId: v.optional(v.string()),
  })
    .index('by_reported_user', ['reportedUserId'])
    .index('by_reporter', ['reporterId'])
    .index('by_status', ['status'])
    .index('by_room', ['roomId']),

  // Blocks table
  blocks: defineTable({
    blockerId: v.id('users'),
    blockedUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_blocker', ['blockerId'])
    .index('by_blocked', ['blockedUserId'])
    .index('by_blocker_blocked', ['blockerId', 'blockedUserId']),

  // Support requests table (Phase-2 Safety escalation)
  supportRequests: defineTable({
    userId: v.id('users'),
    category: v.union(
      v.literal('scam_extortion'),
      v.literal('non_consensual_sharing'),
      v.literal('physical_safety'),
      v.literal('harassment_stalking'),
      v.literal('other_safety')
    ),
    description: v.string(),
    status: v.union(
      v.literal('submitted'),
      v.literal('in_review'),
      v.literal('resolved'),
      v.literal('closed')
    ),
    // Optional context
    relatedUserId: v.optional(v.id('users')),
    relatedReportId: v.optional(v.id('reports')),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    // Latest message timestamp for sorting (updated on each message)
    lastMessageAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_status', ['status']),

  // Support messages table (Phase-2 Safety thread messages)
  supportMessages: defineTable({
    supportRequestId: v.id('supportRequests'),
    senderType: v.union(v.literal('user'), v.literal('admin')),
    senderUserId: v.optional(v.id('users')), // For user messages; admin may be null
    text: v.optional(v.string()),
    attachmentType: v.optional(
      v.union(v.literal('image'), v.literal('video'), v.literal('audio'))
    ),
    attachmentStorageId: v.optional(v.id('_storage')),
    createdAt: v.number(),
  })
    .index('by_support_request', ['supportRequestId'])
    .index('by_request_created', ['supportRequestId', 'createdAt']),

  // Support conversation snapshots (captures last 20 messages for moderation context)
  supportConversationSnapshots: defineTable({
    supportRequestId: v.id('supportRequests'),
    senderUserId: v.id('users'),
    messageText: v.optional(v.string()),
    attachmentType: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_support_request', ['supportRequestId']),

  // Phase-1 general support (Help & FAQ / Contact Support) — distinct from Phase-2 safety `supportRequests`
  supportTickets: defineTable({
    userId: v.id('users'),
    category: v.union(
      v.literal('payment'),
      v.literal('subscription'),
      v.literal('account'),
      v.literal('bug'),
      v.literal('safety'),
      v.literal('verification'),
      v.literal('other'),
    ),
    message: v.string(),
    status: v.union(
      v.literal('open'),
      v.literal('in_review'),
      v.literal('replied'),
      v.literal('closed'),
    ),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          type: v.union(v.literal('photo'), v.literal('video')),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_created', ['userId', 'createdAt']),

  supportTicketMessages: defineTable({
    ticketId: v.id('supportTickets'),
    senderType: v.union(v.literal('user'), v.literal('admin')),
    senderName: v.optional(v.string()),
    message: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          type: v.union(v.literal('photo'), v.literal('video')),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index('by_ticket', ['ticketId'])
    .index('by_ticket_created', ['ticketId', 'createdAt']),

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
    // Legacy compatibility: older Phase-2 profile docs stored a per-slot blur array.
    // Active backend flows use privatePhotosBlurred/privatePhotoBlurLevel instead.
    photoBlurSlots: v.optional(v.array(v.boolean())),
    /** When true, per-photo blur controls are available; does not imply any slot is blurred. */
    photoBlurEnabled: v.optional(v.boolean()),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateIntentKeys: v.array(v.string()),
    privateDesireTagKeys: v.array(v.string()),
    privateBoundaries: v.array(v.string()),
    privateBio: v.optional(v.string()),
    displayName: v.string(),
    // Nickname edit limit (Phase-2)
    // Optional for backward compatibility; treat missing as 0 in code.
    displayNameEditCount: v.optional(v.number()),
    lastDisplayNameEditedAt: v.optional(v.number()),
    age: v.number(),
    city: v.optional(v.string()),
    gender: v.string(),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.boolean(),
    // Phase-1 imported fields (read-only after import, stored in Phase-2 for isolation)
    hobbies: v.optional(v.array(v.string())),
    isVerified: v.optional(v.boolean()),
    // Phase-2 profile details (editable)
    height: v.optional(v.number()),
    weight: v.optional(v.number()),
    smoking: v.optional(v.string()),
    drinking: v.optional(v.string()),
    education: v.optional(v.string()),
    religion: v.optional(v.string()),
    // Phase-2 Onboarding Step 3: Prompt answers
    promptAnswers: v.optional(v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    }))),
    // Phase-2 Preference Strength (ranking signal)
    preferenceStrength: v.optional(v.object({
      smoking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      drinking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      intent: v.union(v.literal('not_important'), v.literal('prefer_similar'), v.literal('important'), v.literal('must_match_exactly')),
    })),
    // Phase-2 Privacy (Deep Connect visibility & messaging)
    hideFromDeepConnect: v.optional(v.boolean()),
    hideAge: v.optional(v.boolean()),
    hideDistance: v.optional(v.boolean()),
    disableReadReceipts: v.optional(v.boolean()),
    // Phase-2 Safety
    safeMode: v.optional(v.boolean()),
    // Phase-2 Notifications (per-category toggles)
    notificationsEnabled: v.optional(v.boolean()),
    notificationCategories: v.optional(v.object({
      deepConnect: v.optional(v.boolean()),
      privateMessages: v.optional(v.boolean()),
      chatRooms: v.optional(v.boolean()),
      truthOrDare: v.optional(v.boolean()),
    })),
    // Phase-2 Photo & Media Privacy (defaults align with privateProfileStore)
    defaultPhotoVisibility: v.optional(
      v.union(v.literal('public'), v.literal('blurred'), v.literal('private'))
    ),
    allowUnblurRequests: v.optional(v.boolean()),
    defaultSecureMediaTimer: v.optional(
      v.union(v.literal(0), v.literal(10), v.literal(30))
    ),
    defaultSecureMediaViewingMode: v.optional(
      v.union(v.literal('tap'), v.literal('hold'))
    ),
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
    // Reaction and report counts for prompt-level interactions
    totalReactionCount: v.optional(v.number()), // total reactions on this prompt
    reportCount: v.optional(v.number()), // for hiding prompts with 5+ reports
    // Owner profile snapshot (immutable at creation time)
    isAnonymous: v.optional(v.boolean()), // true = hide photo/name, show only age+gender
    photoBlurMode: v.optional(v.union(v.literal('none'), v.literal('blur'))), // 'blur' = show blurred photo
    ownerName: v.optional(v.string()),
    ownerPhotoUrl: v.optional(v.string()),
    ownerAge: v.optional(v.number()),
    ownerGender: v.optional(v.string()),
  })
    .index('by_trending', ['isTrending'])
    .index('by_type', ['type'])
    .index('by_owner', ['ownerUserId']),

  // Truth & Dare Answers (one per user per prompt)
  todAnswers: defineTable({
    promptId: v.string(),
    userId: v.string(),
    // Type indicates primary content: 'text' if text-only, media type if has media
    type: v.union(v.literal('text'), v.literal('photo'), v.literal('video'), v.literal('voice')),
    text: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    mediaStorageId: v.optional(v.id('_storage')),
    mediaMime: v.optional(v.string()), // MIME type for media
    durationSec: v.optional(v.number()),
    likeCount: v.number(), // legacy, kept for compatibility
    createdAt: v.number(),
    editedAt: v.optional(v.number()), // timestamp when answer was last edited
    visibility: v.optional(v.union(v.literal('owner_only'), v.literal('public'))),
    isDemo: v.optional(v.boolean()),
    // Identity mode: anonymous (default), no_photo, profile
    identityMode: v.optional(v.union(v.literal('anonymous'), v.literal('no_photo'), v.literal('profile'))),
    isAnonymous: v.optional(v.boolean()), // legacy, derived from identityMode
    userGender: v.optional(v.string()),
    profileVisibility: v.optional(v.union(v.literal('blurred'), v.literal('clear'))),
    // Author identity snapshot (stored at creation/edit time)
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    photoBlurMode: v.optional(v.union(v.literal('none'), v.literal('blur'))),
    // Reaction and report counts (denormalized for ranking)
    totalReactionCount: v.optional(v.number()), // total emoji reactions
    reportCount: v.optional(v.number()), // unique reporters
    // One-time view gating fields (for both owner_only and public visibility)
    viewMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    viewDurationSec: v.optional(v.number()), // 1-60 seconds for one-time view
    // Secure media lifecycle: set when media is first claimed for viewing
    mediaViewedAt: v.optional(v.number()),
    // Secure media: set when prompt owner completes viewing (triggers deletion for ALL)
    promptOwnerViewedAt: v.optional(v.number()),
    // Camera metadata: true if captured from front camera (for mirroring correction)
    isFrontCamera: v.optional(v.boolean()),
  })
    .index('by_prompt', ['promptId'])
    .index('by_user', ['userId'])
    .index('by_prompt_user', ['promptId', 'userId']),

  // Truth & Dare per-user view tracking (for one-time gating before owner views)
  todAnswerViews: defineTable({
    answerId: v.string(),
    viewerUserId: v.string(),
    viewedAt: v.number(),
  })
    .index('by_answer', ['answerId'])
    .index('by_answer_viewer', ['answerId', 'viewerUserId']),

  // Truth & Dare Answer Likes (legacy, kept for migration)
  todAnswerLikes: defineTable({
    answerId: v.string(),
    likedByUserId: v.string(),
    createdAt: v.number(),
  })
    .index('by_answer', ['answerId'])
    .index('by_user', ['likedByUserId'])
    .index('by_answer_user', ['answerId', 'likedByUserId']),

  // Truth & Dare Answer Reactions (emoji reactions - one per user per answer)
  todAnswerReactions: defineTable({
    answerId: v.string(),
    userId: v.string(),
    emoji: v.string(), // any emoji: "😂", "🔥", "❤️", "😮", "👏"
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_answer', ['answerId'])
    .index('by_user', ['userId'])
    .index('by_answer_user', ['answerId', 'userId']),

  // Truth & Dare Answer Reports (for hiding answers with 5+ reports)
  todAnswerReports: defineTable({
    answerId: v.string(),
    reporterId: v.string(),
    // Structured report reason (required for new reports)
    reasonCode: v.optional(v.union(
      v.literal('harassment'),
      v.literal('sexual'),
      v.literal('spam'),
      v.literal('hate'),
      v.literal('violence'),
      v.literal('other')
    )),
    // Optional additional details (renamed from reason for clarity)
    reasonText: v.optional(v.string()),
    // Legacy field for backwards compatibility with old reports
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_answer', ['answerId'])
    .index('by_reporter', ['reporterId'])
    .index('by_answer_reporter', ['answerId', 'reporterId']),

  // Truth & Dare Prompt Reactions (for reacting to prompts themselves)
  todPromptReactions: defineTable({
    promptId: v.string(),
    userId: v.string(),
    emoji: v.string(), // any emoji: "😂", "🔥", "❤️", "😮", "👏"
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_prompt', ['promptId'])
    .index('by_user', ['userId'])
    .index('by_prompt_user', ['promptId', 'userId']),

  // Truth & Dare Prompt Reports (for hiding prompts with 5+ reports)
  todPromptReports: defineTable({
    promptId: v.string(),
    reporterId: v.string(),
    reasonCode: v.optional(v.union(
      v.literal('harassment'),
      v.literal('sexual'),
      v.literal('spam'),
      v.literal('hate'),
      v.literal('violence'),
      v.literal('other')
    )),
    reasonText: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_prompt', ['promptId'])
    .index('by_reporter', ['reporterId'])
    .index('by_prompt_reporter', ['promptId', 'reporterId']),

  // Truth & Dare Rate Limiting (tracks user action counts per day)
  todRateLimits: defineTable({
    userId: v.string(),
    actionType: v.union(
      v.literal('prompt'), // legacy prompt-creation rate limit action
      v.literal('connect'), // legacy connect-request rate limit action
      v.literal('answer'),
      v.literal('reaction'),
      v.literal('prompt_reaction'), // reactions on prompts
      v.literal('report'),
      v.literal('prompt_report'), // reports on prompts
      v.literal('claim_media') // active secure-media claim rate limit action
    ),
    windowStart: v.number(), // Start of the rate limit window (day start)
    count: v.number(), // Actions in this window
  })
    .index('by_user_action', ['userId', 'actionType']),

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

  // Truth & Dare Private Media (one-time view photo/video responses)
  todPrivateMedia: defineTable({
    promptId: v.string(),
    fromUserId: v.string(), // responder who sent the media
    toUserId: v.string(), // prompt owner (only person who can view)
    mediaType: v.union(v.literal('photo'), v.literal('video')),
    storageId: v.optional(v.id('_storage')), // cleared after deletion
    viewMode: v.union(v.literal('tap'), v.literal('hold')), // how owner views: tap once or hold to view
    durationSec: v.number(), // view timer in seconds (1-60, default 20)
    status: v.union(
      v.literal('pending'),  // not yet viewed
      v.literal('viewing'),  // currently being viewed (timer running)
      v.literal('expired'),  // timer ended, media deleted
      v.literal('deleted')   // manually deleted or cleaned up
    ),
    createdAt: v.number(),
    viewedAt: v.optional(v.number()), // when owner started viewing
    expiresAt: v.optional(v.number()), // viewedAt + durationSec*1000
    connectStatus: v.union(
      v.literal('none'),
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('rejected')
    ),
    // Responder profile info (cached for display after media deletion)
    responderName: v.optional(v.string()),
    responderAge: v.optional(v.number()),
    responderGender: v.optional(v.string()),
    responderPhotoUrl: v.optional(v.string()),
  })
    .index('by_prompt', ['promptId'])
    .index('by_to_user', ['toUserId'])
    .index('by_from_user', ['fromUserId'])
    .index('by_prompt_from', ['promptId', 'fromUserId'])
    .index('by_status', ['status'])
    .index('by_expires', ['expiresAt']),

  // Confessions table
  confessions: defineTable({
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    authorVisibility: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur'), v.literal('blur_photo'))), // canonical visibility field; isAnonymous is a legacy mirror for compatibility
    mood: v.union(v.literal('romantic'), v.literal('spicy'), v.literal('emotional'), v.literal('funny')),
    visibility: v.literal('global'),
    imageUrl: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    replyCount: v.number(),
    reactionCount: v.number(),
    voiceReplyCount: v.optional(v.number()),
    lastEngagementAt: v.optional(v.number()), // legacy ranking/engagement metadata
    rankingScore: v.optional(v.number()), // legacy ranking/engagement metadata
    recentEngagementWindowStart: v.optional(v.number()), // legacy ranking/engagement metadata
    recentReactionCount: v.optional(v.number()), // legacy ranking/engagement metadata
    recentReplyCount: v.optional(v.number()), // legacy ranking/engagement metadata
    reportCount: v.optional(v.number()), // legacy moderation metadata
    uniqueCommenters: v.optional(v.number()), // legacy ranking/engagement metadata
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // 24h after createdAt; undefined = never expires (legacy)
    taggedUserId: v.optional(v.id('users')), // User being confessed to (must be someone current user has liked)
    // Soft delete support
    isDeleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_created', ['createdAt'])
    .index('by_user', ['userId'])
    .index('by_expires', ['expiresAt'])
    .index('by_tagged_user', ['taggedUserId']),

  // Confession Reports table (for moderation)
  confessionReports: defineTable({
    confessionId: v.id('confessions'),
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    reason: v.union(
      v.literal('spam'),
      v.literal('harassment'),
      v.literal('hate'),
      v.literal('sexual'),
      v.literal('other')
    ),
    description: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('actioned')),
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_confession_reporter', ['confessionId', 'reporterId'])
    .index('by_reporter', ['reporterId'])
    .index('by_status', ['status']),

  // Confession Replies table
  confessionReplies: defineTable({
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    identityMode: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur'))), // legacy reply identity flag; current Phase-1 thread UI still consumes isAnonymous for replies
    hasActiveConnectRequest: v.optional(v.boolean()), // legacy flag ignored by current Confessions UI/backend contract
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    parentReplyId: v.optional(v.id('confessionReplies')), // For reply-to-reply (OP responding to anonymous reply)
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
    messageCount: v.optional(v.number()), // Denormalized count for efficient 1000-cap enforcement
    createdBy: v.optional(v.id('users')), // Room creator
    isDemoRoom: v.optional(v.boolean()), // Demo mode flag
    // Phase-2: 24h room lifecycle
    expiresAt: v.optional(v.number()), // createdAt + 24h; undefined for legacy public rooms
    // Phase-2: Private rooms with join code
    joinCode: v.optional(v.string()), // 6-char alphanumeric code for private rooms
    // Phase-2: Password protection for private rooms
    passwordHash: v.optional(v.string()), // SHA-256 hash for verification
    passwordEncrypted: v.optional(v.string()), // AES-256-GCM encrypted password (owner can view)
  })
    .index('by_slug', ['slug'])
    .index('by_last_message', ['lastMessageAt'])
    .index('by_category', ['category'])
    .index('by_expires', ['expiresAt'])
    .index('by_join_code', ['joinCode'])
    .index('by_public', ['isPublic'])
    .index('by_creator', ['createdBy']), // LEAVE-VS-END FIX: Index for finding rooms by creator

  // Chat Room Members table
  chatRoomMembers: defineTable({
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    joinedAt: v.number(),
    // Role hierarchy: owner > admin > member
    // - owner: full control (delete room, kick anyone, delete any msg, promote/demote)
    // - admin: moderate (kick members, delete member msgs)
    // - member: basic (send messages, view room)
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
    lastMessageAt: v.optional(v.number()), // For rate limiting
    isBanned: v.optional(v.boolean()), // For banning users from room
    passwordVerified: v.optional(v.boolean()), // For password-protected rooms
  })
    .index('by_room', ['roomId'])
    .index('by_user', ['userId'])
    .index('by_room_user', ['roomId', 'userId']),

  // Chat Room Messages table
  chatRoomMessages: defineTable({
    roomId: v.id('chatRooms'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('doodle'), v.literal('system'), v.literal('audio')),
    text: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    audioUrl: v.optional(v.string()), // For audio/voice messages
    createdAt: v.number(),
    clientId: v.optional(v.string()), // For deduplication
    status: v.optional(v.union(v.literal('pending'), v.literal('sent'), v.literal('failed'))), // Message status
    deletedAt: v.optional(v.number()), // Soft delete
    expiresAt: v.optional(v.float64()), // For ephemeral/expiring messages
    // Reply threading (optional)
    replyToMessageId: v.optional(v.id('chatRoomMessages')),
    replyToSenderNickname: v.optional(v.string()),
    replyToSnippet: v.optional(v.string()),
    replyToType: v.optional(
      v.union(
        v.literal('text'),
        v.literal('image'),
        v.literal('video'),
        v.literal('doodle'),
        v.literal('audio'),
        v.literal('system')
      )
    ),
    // @mention metadata stored on the message (for listMessages)
    mentions: v.optional(
      v.array(
        v.object({
          userId: v.id('users'),
          nickname: v.string(),
          startIndex: v.number(),
          endIndex: v.number(),
        })
      )
    ),
  })
    .index('by_room', ['roomId'])
    .index('by_room_created', ['roomId', 'createdAt'])
    .index('by_room_clientId', ['roomId', 'clientId']), // For idempotency check

  // Emoji reactions on chat room messages (Phase-2)
  chatRoomMessageReactions: defineTable({
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    userId: v.id('users'),
    emoji: v.string(),
    createdAt: v.number(),
  })
    .index('by_room_message', ['roomId', 'messageId'])
    .index('by_message_user', ['messageId', 'userId']),

  // @mention inbox notifications (who was mentioned in which room/message)
  chatRoomMentionNotifications: defineTable({
    mentionedUserId: v.id('users'),
    senderId: v.id('users'),
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    messagePreview: v.string(),
    roomName: v.string(),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  }).index('by_mentioned_user_created', ['mentionedUserId', 'createdAt']),

  // Per-room mute of another member's messages (viewer-specific)
  chatRoomPerUserMutes: defineTable({
    roomId: v.id('chatRooms'),
    muterId: v.id('users'),
    targetUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_room_muter', ['roomId', 'muterId'])
    .index('by_room_target', ['roomId', 'targetUserId']),

  // DM threads hidden from inbox (per user; conversation id)
  chatRoomHiddenDmConversations: defineTable({
    userId: v.id('users'),
    conversationId: v.id('conversations'),
    hiddenAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_conversation', ['userId', 'conversationId']),

  // Chat Room Penalties table (Phase-2: kicked users read-only for 24h)
  chatRoomPenalties: defineTable({
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    type: v.literal('readOnly'), // Only readOnly for now; extensible later
    kickedAt: v.number(),
    expiresAt: v.number(), // kickedAt + 24h
  })
    .index('by_room', ['roomId']) // For listing all penalties in a room
    .index('by_room_user', ['roomId', 'userId']) // For single-user penalty lookup
    .index('by_user', ['userId'])
    .index('by_expires', ['expiresAt']),

  // Chat Room Join Requests table (Phase-2: password + admin approval)
  chatRoomJoinRequests: defineTable({
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    status: v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected')),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_room_status', ['roomId', 'status'])
    .index('by_room_user', ['roomId', 'userId'])
    .index('by_user_status', ['userId', 'status']),

  // Chat Room Bans table (Phase-2: kicked/banned users cannot rejoin)
  chatRoomBans: defineTable({
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    bannedAt: v.number(),
    bannedBy: v.id('users'), // owner who banned
  })
    .index('by_room_user', ['roomId', 'userId'])
    .index('by_user', ['userId']),

  // Chat Room Password Attempts table (tracks failed password attempts)
  // 5-attempt system: 3 immediate, then cooldowns, then blocked
  chatRoomPasswordAttempts: defineTable({
    roomId: v.id('chatRooms'),
    authUserId: v.string(), // auth ID (not user ID, since user may not be in DB yet)
    stage: v.number(), // 1=initial (3 attempts), 2=cooldown1 (1 attempt), 3=cooldown2 (1 attempt), 4=blocked
    attempts: v.number(), // attempts within current stage
    lastAttemptAt: v.number(),
    cooldownUntil: v.optional(v.number()), // if in cooldown, when it ends
    blocked: v.boolean(), // true if permanently blocked for this room
  })
    .index('by_room_user', ['roomId', 'authUserId']),

  // Chat Room Profiles (separate identity for chat rooms)
  chatRoomProfiles: defineTable({
    userId: v.id('users'),
    nickname: v.string(),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId']),

  // Chat Room Presence (online status in rooms)
  chatRoomPresence: defineTable({
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    lastHeartbeatAt: v.number(),
    joinedAt: v.number(),
  })
    .index('by_room', ['roomId'])
    .index('by_user', ['userId'])
    .index('by_room_user', ['roomId', 'userId']),

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

  // Private Profile Deletion States (30-day soft delete)
  privateDeletionStates: defineTable({
    userId: v.id('users'),
    status: v.union(v.literal('active'), v.literal('pending_deletion')),
    deletedAt: v.optional(v.number()),
    recoverUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_status', ['status'])
    .index('by_recoverUntil', ['recoverUntil']),

  // System Configuration (key-value store for global settings)
  systemConfig: defineTable({
    key: v.string(),  // e.g., "resetEpoch", "maintenanceMode", etc.
    value: v.any(),   // Flexible value (number, string, boolean, object)
    updatedAt: v.number(),
  })
    .index('by_key', ['key']),

  // User Room Preferences (muting chat rooms)
  userRoomPrefs: defineTable({
    userId: v.id('users'),
    roomId: v.string(),  // Can be chat room ID or conversation ID
    muted: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_room', ['userId', 'roomId']),

  // User Room Reports (track which rooms user has reported)
  userRoomReports: defineTable({
    userId: v.id('users'),
    roomId: v.string(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_room', ['userId', 'roomId']),

  // User Game Limits (track game-specific limits like bottle spin skips)
  userGameLimits: defineTable({
    userId: v.id('users'),
    game: v.literal('bottleSpin'),
    convoId: v.string(),
    windowKey: v.string(),  // Time window key (e.g., "2024-01-15" for daily limits)
    skipCount: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_game_convo', ['userId', 'game', 'convoId', 'windowKey']),

  // Bottle Spin Game Sessions (invite + active game tracking)
  bottleSpinSessions: defineTable({
    conversationId: v.string(),
    inviterId: v.string(),           // User who sent the invite
    inviteeId: v.string(),           // User who received the invite
    status: v.union(
      v.literal('pending'),          // Invite sent, waiting for response
      v.literal('active'),           // Invite accepted, game in progress
      v.literal('rejected'),         // Invite rejected
      v.literal('ended'),            // Game ended
      v.literal('expired')           // Pending invite timed out
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),  // When invite was accepted/rejected
    endedAt: v.optional(v.number()),      // When game was ended
    endedReason: v.optional(v.string()),  // Legacy reason metadata from older Bottle Spin sessions
    cooldownUntil: v.optional(v.number()), // Cooldown end time (1 hour after rejection/end)
    // Turn tracking for real-time sync across devices
    // NOTE: Using role-based turn tracking to avoid ID format mismatch issues
    currentTurnUserId: v.optional(v.string()), // Legacy - kept for compatibility
    spinTurnRole: v.optional(v.union(
      v.literal('inviter'),
      v.literal('invitee')
    )), // Legacy turn-role metadata from older Bottle Spin sessions
    lastSelectedRole: v.optional(v.union(
      v.literal('inviter'),
      v.literal('invitee')
    )), // Legacy spin history metadata from older Bottle Spin sessions
    consecutiveSelectedCount: v.optional(v.number()), // Legacy anti-repeat counter from older Bottle Spin sessions
    currentTurnRole: v.optional(v.union(
      v.literal('inviter'),          // Inviter's turn to choose
      v.literal('invitee')           // Invitee's turn to choose
    )),
    turnPhase: v.optional(v.union(
      v.literal('idle'),             // Waiting for spin
      v.literal('spinning'),         // Spin animation in progress
      v.literal('choosing'),         // Current turn user choosing Truth/Dare/Skip
      v.literal('complete')          // Choice made, can spin again
    )),
    lastSpinResult: v.optional(v.string()), // 'truth' | 'dare' | 'skip' | null
  })
    .index('by_conversation', ['conversationId'])
    .index('by_inviter', ['inviterId'])
    .index('by_invitee', ['inviteeId']),

  // H-1: Track pending uploads to prevent orphaned storage blobs
  // Records created after upload, deleted when addPhoto succeeds or cleanup runs
  pendingUploads: defineTable({
    storageId: v.id('_storage'),
    userId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_storage', ['storageId'])
    .index('by_user', ['userId'])
    .index('by_createdAt', ['createdAt']),

  // B2-FIX: Track failed storage deletions for retry
  // Records created when ctx.storage.delete fails after DB photo deletion
  // Cron job retries these periodically to clean up orphaned storage blobs
  failedStorageDeletions: defineTable({
    storageId: v.id('_storage'),
    failedAt: v.number(),
    retryCount: v.number(),
    lastError: v.optional(v.string()),
  })
    .index('by_failedAt', ['failedAt'])
    .index('by_storageId', ['storageId']),

  // ─────────────────────────────────────────────────────────────────────────
  // Phase-2 Ranking System Tables
  // ─────────────────────────────────────────────────────────────────────────

  // Phase-2 Ranking Metrics (per-user ranking signals for Deep Connect)
  phase2RankingMetrics: defineTable({
    userId: v.id('users'),
    phase2OnboardedAt: v.number(),      // When Phase-2 onboarding completed
    lastPhase2ActiveAt: v.number(),     // Last activity in Phase-2 (TD, chat, Deep Connect)
    totalImpressions: v.number(),       // Total times shown to any viewer
    lastShownAt: v.number(),            // Timestamp of last impression
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId']),

  // Phase-2 Viewer Impressions (per-viewer repetition suppression)
  phase2ViewerImpressions: defineTable({
    viewerId: v.id('users'),            // Who was viewing
    viewedUserId: v.id('users'),        // Who was shown
    lastSeenAt: v.number(),             // When they were last shown
    seenCount: v.number(),              // How many times shown to this viewer
  })
    .index('by_viewer', ['viewerId'])
    .index('by_pair', ['viewerId', 'viewedUserId']),
});
