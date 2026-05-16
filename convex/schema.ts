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
    isDemo: v.optional(v.boolean()), // True only for Convex-backed demo-auth users

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

    // Phase-2 scale: coarse geographic cell identifier derived from the
    // grid-snapped latitude/longitude. Maintained by every server-side
    // location writer (publishLocation, recordLocation, updateLocation)
    // so recordLocation's candidate lookup can use `by_verification_cell`
    // instead of scanning every verified user. Optional because legacy
    // rows are populated by a paginated backfill mutation. Readers must
    // tolerate `undefined` so reading code never crashes mid-backfill.
    // Cell size is fixed at 0.02° per axis (~2.2km lat, ~1.1–2.2km lng
    // depending on latitude), comfortably wider than the 1km crossed-path
    // radius across all 9 viewer+neighbor cells.
    nearbyCell5: v.optional(v.string()),

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
    // Activities accepted by the user table. Mirrors the 70-value frontend
    // ACTIVITY_FILTERS list in lib/constants.ts so onboarding /
    // updateProfile / completeOnboarding can persist any UI-selectable
    // activity (e.g. 'diy_projects'). Keep this list in sync with
    // convex/users.ts updateProfile + completeOnboarding validators.
    activities: v.array(v.union(
      // Original 20 activities
      v.literal('coffee'), v.literal('date_night'), v.literal('sports'), v.literal('movies'), v.literal('free_tonight'),
      v.literal('foodie'), v.literal('gym_partner'), v.literal('concerts'), v.literal('travel'), v.literal('outdoors'),
      v.literal('art_culture'), v.literal('gaming'), v.literal('nightlife'), v.literal('brunch'), v.literal('study_date'),
      v.literal('this_weekend'), v.literal('beach_pool'), v.literal('road_trip'), v.literal('photography'), v.literal('volunteering'),
      // Additional 49 activities (matching frontend ACTIVITY_FILTERS)
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
    )),
    freeTonightExpiresAt: v.optional(v.number()),
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
    nearbyEnabled: v.optional(v.boolean()),           // user opt-in toggle (default true) — gates map visibility
    crossedPathsEnabled: v.optional(v.boolean()),     // LEGACY: superseded by recordCrossedPaths in Phase-2; kept for back-compat and migrations only, no longer read
    recordCrossedPaths: v.optional(v.boolean()),      // Legacy: now follows nearbyEnabled; retained for back-compat/migrations
    // Server-side Nearby / Crossed Paths consent. A user is treated as
    // un-consented (and all location writes are dropped) unless both fields
    // are present and nearbyConsentVersion matches the current
    // NEARBY_CONSENT_VERSION constant in convex/crossedPaths.ts.
    nearbyConsentAt: v.optional(v.number()),
    nearbyConsentVersion: v.optional(v.string()),
    // Fix 3 — Impossible Travel / GPS spoof protection (server-only).
    // Backend tracking for impossible-travel rejects. None of these are
    // exposed to clients. `locationLastRejectAt` is also used as a short
    // dedupe window so a flood of rejects within a few seconds counts as one.
    // `locationRejectWindowStartedAt` + `locationRejectCount` define a 24h
    // sliding window — once 3 rejects accumulate inside the same window the
    // user is flagged via `locationSpoofSuspect` (+ `locationSpoofSuspectAt`).
    locationLastRejectAt: v.optional(v.number()),
    locationRejectCount: v.optional(v.number()),
    locationRejectWindowStartedAt: v.optional(v.number()),
    locationSpoofSuspect: v.optional(v.boolean()),
    locationSpoofSuspectAt: v.optional(v.number()),
    // ACTIVE (Phase 1 background restore): iOS Significant Location Change
    // opt-in. Default OFF (undefined). Server-side guarantees:
    //   * Only honored when bgCrossedPathsEnabled feature flag is true
    //   * Only honored when backgroundLocationConsentAt +
    //     backgroundLocationConsentVersion (matching the current
    //     BG_LOCATION_CONSENT_VERSION) are present on the user doc
    // Toggling true via updateNearbySettings is rejected unless the
    // background consent fields below are set. recordLocationBatch enforces
    // backgroundLocationEnabled === true for source='slc' samples so a
    // stale or spoofed client cannot write SLC batches without explicit
    // user opt-in. Phase 1 backend foundation only — the iOS native
    // background plumbing is added in a later phase.
    backgroundLocationEnabled: v.optional(v.boolean()),
    // ACTIVE (Phase 1 background restore): Android Discovery Mode fields.
    // Time-bounded background window (default 4h, max 8h) so Android
    // never tracks 24/7. recordLocationBatch enforces:
    //   discoveryModeEnabled === true AND discoveryModeExpiresAt > now
    // for source='bg' samples; expired windows are rejected. All three
    // are also gated server-side by bgCrossedPathsEnabled feature flag +
    // backgroundLocationConsent presence. discoveryModeStartedAt is
    // diagnostic-only. Phase 1 backend foundation only — the Android
    // native foreground service / TaskManager wiring lands in a later phase.
    discoveryModeEnabled: v.optional(v.boolean()),
    discoveryModeExpiresAt: v.optional(v.number()),
    discoveryModeStartedAt: v.optional(v.number()),
    // ACTIVE (Phase 1 background restore): Background-Crossed-Paths
    // explicit-opt-in disclosure consent. Separate from nearbyConsentAt
    // (which only covers foreground crossed-paths). A user who has
    // accepted nearbyConsent but NOT this background-specific consent
    // cannot enable backgroundLocationEnabled, cannot enable
    // discoveryModeEnabled, and cannot have any background sample
    // (source='slc' or source='bg') accepted by recordLocationBatch.
    //
    // Both fields must be present and backgroundLocationConsentVersion
    // must equal the current BG_LOCATION_CONSENT_VERSION constant in
    // convex/users.ts, otherwise the consent is treated as not given.
    // Bumping that constant invalidates all old consents and forces a
    // fresh re-acceptance — same pattern as nearbyConsentVersion.
    backgroundLocationConsentAt: v.optional(v.number()),
    backgroundLocationConsentVersion: v.optional(v.string()),
    // Ops-only kill switch for Phase-3 background crossed-path batch writes.
    // This does not affect foreground Nearby / recordLocation behavior.
    bgCrossedPathsOpsDisabled: v.optional(v.boolean()),
    nearbyPausedUntil: v.optional(v.number()),        // pause nearby visibility until timestamp
    nearbyVisibilityMode: v.optional(v.union(         // DEPRECATED (Phase-1 removed UI, Phase-2 stops reading it); kept to preserve existing data, no live code-path depends on it
      v.literal('always'),
      v.literal('app_open'),
      v.literal('recent')
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
        freeTonightExpiresAt: v.optional(v.number()),
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
    termsAcceptedAt: v.optional(v.number()),
    communityGuidelinesAcceptedAt: v.optional(v.number()),

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
    // P1-2: Denormalized "shadow ban from Discover" flag. Set true when an
    // automated high-severity behaviorFlag is created (e.g. >=10 reports in
    // 1h, or repeated reports crossing the high-severity threshold). Filtered
    // out by `getDiscoverProfiles` so the user no longer surfaces in Phase-1
    // Discover. Cleared by moderators (out of P1 scope; manual DB action).
    discoverShadowBanned: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()), // Soft delete timestamp (account deletion)
    deletionFinalizedAt: v.optional(v.number()), // When the 30-day soft-delete window was finalized

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
    // Verification retry/cooldown counters (additive; future enforcement only — not enforced today)
    selfieFailedCount: v.optional(v.number()),              // Cumulative failed selfie attempts in current window
    selfieFailedSince: v.optional(v.number()),              // Window-start timestamp for selfieFailedCount
    selfieCooldownUntil: v.optional(v.number()),            // Selfie retry cooldown deadline (ms epoch)
    referencePhotoReplaceCount: v.optional(v.number()),     // Reference-photo replacements in current rolling window
    referencePhotoReplaceSince: v.optional(v.number()),     // Window-start timestamp for referencePhotoReplaceCount
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
    .index('by_auth_user_id', ['authUserId'])
    .index('by_deleted_at', ['deletedAt'])
    // Phase-2 scale: bounded geo-cell candidate lookup for recordLocation.
    // Lets the crossed-path detector fetch only verified users in the
    // viewer's cell + 8 neighbors instead of scanning every verified user.
    // Guarded server-side by RECORD_LOCATION_GEO_INDEX_ENABLED.
    .index('by_verification_cell', ['verificationStatus', 'nearbyCell5']),

  // Wallet ledger: auditable balance changes for engagement rewards and spend events.
  walletLedger: defineTable({
    userId: v.id('users'),
    delta: v.number(),
    reason: v.string(),
    sourceType: v.string(),
    sourceId: v.optional(v.string()),
    peerUserId: v.optional(v.id('users')),
    roomId: v.optional(v.id('chatRooms')),
    dayKey: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_user_createdAt', ['userId', 'createdAt'])
    .index('by_dedupeKey', ['dedupeKey'])
    .index('by_user_day', ['userId', 'dayKey']),

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
    moderationStatus: v.optional(v.union(
      v.literal('pending'),
      v.literal('clean'),
      v.literal('flagged')
    )),
    moderationCheckedAt: v.optional(v.number()),
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
    source: v.optional(v.union(
      v.literal('discover'),
      v.literal('vibes'),
      v.literal('profile'),
      v.literal('messages'),
      v.literal('match'),
      v.literal('chat'),
      v.literal('unknown'),
    )),
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
    // 'super_like' matches appear in Super Likes section, 'like'/'confession' in New Matches
    matchSource: v.optional(v.union(v.literal('like'), v.literal('super_like'), v.literal('confession'))),
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
    firstMutualReplyAt: v.optional(v.number()),
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
    .index('by_conversation_deliveredAt', ['conversationId', 'deliveredAt'])
    .index('by_conversation_readAt', ['conversationId', 'readAt'])
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
    firstMutualReplyAt: v.optional(v.number()),
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
    // P2-TOD-CHAT-EVENTS: Optional system message subtype used to discriminate
    // in-chat T/D notifications ('tod_perm' = permanent event chip,
    // 'tod_temp' = transient chip that hides 5min after viewer reads it).
    // Mirrors the Phase-1 `messages.systemSubtype` field.
    systemSubtype: v.optional(v.string()),
    // Optional deterministic key for idempotent system event inserts.
    systemEventKey: v.optional(v.string()),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    isProtected: v.optional(v.boolean()),
    protectedMediaTimer: v.optional(v.number()),
    viewOnce: v.optional(v.boolean()),
    protectedMediaViewingMode: v.optional(v.union(v.literal('tap'), v.literal('hold'))),
    protectedMediaIsMirrored: v.optional(v.boolean()),
    viewedAt: v.optional(v.number()),
    timerEndsAt: v.optional(v.number()),
    isExpired: v.optional(v.boolean()),
    expiredAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
    clientMessageId: v.optional(v.string()),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_created', ['conversationId', 'createdAt'])
    .index('by_conversation_system_event', ['conversationId', 'systemEventKey'])
    .index('by_conversation_clientMessageId', ['conversationId', 'clientMessageId'])
    // P1-002: Bounded protected-media expiry sweep. Allows the cron to query
    // only rows that need redaction (isProtected=true and either flagged
    // expired or timer elapsed) instead of full-table .collect().
    .index('by_protected_expiry', ['isProtected', 'isExpired', 'timerEndsAt']),

  privateMessageMediaUploads: defineTable({
    storageId: v.id('_storage'),
    uploaderUserId: v.id('users'),
    mediaKind: v.union(v.literal('image'), v.literal('video'), v.literal('audio')),
    createdAt: v.number(),
  })
    .index('by_storage', ['storageId'])
    .index('by_uploader', ['uploaderUserId']),

  privateMessageMediaViews: defineTable({
    messageId: v.id('privateMessages'),
    viewerUserId: v.id('users'),
    viewedAt: v.number(),
  })
    .index('by_message', ['messageId'])
    .index('by_message_viewer', ['messageId', 'viewerUserId']),

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
    .index('by_to_user', ['toUserId'])
    .index('by_from_action_createdAt', ['fromUserId', 'action', 'createdAt'])
    .index('by_to_action_createdAt', ['toUserId', 'action', 'createdAt']),

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

  // Phase-2 Reveals table (Deep Connect mutual photo unblur)
  // Created when a pair matches; used to short-circuit blur for that pair only.
  // Sorted pair: userAId < userBId (same convention as privateMatches).
  privateReveals: defineTable({
    userAId: v.id('users'),
    userBId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_pair', ['userAId', 'userBId'])
    .index('by_userA', ['userAId'])
    .index('by_userB', ['userBId']),

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
    .index('by_owner', ['ownerId'])
    // P1-FIX (D3): Bounded `cleanupExpiredMedia` cron uses this index to
    // pull only already-marked-expired media rows in batches instead of
    // `.collect()`-ing the whole table.
    .index('by_expired_at', ['expiredAt']),

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
    .index('by_recipient', ['recipientId'])
    // P1-FIX (D3): Bounded `cleanupExpiredMedia` cron uses this index to
    // pull only permissions whose timer has elapsed in batches instead of
    // `.collect()`-ing the whole table.
    .index('by_expires_at', ['expiresAt']),

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

  // Phase-1 Notifications table (dating/discover/messages)
  // STRICT ISOLATION: This table is ONLY for Phase-1 notifications.
  // Phase-2 notifications live in `privateNotifications` (separate physical table).
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
      // Phase-1 confession surface: tagged-confession bell item that deep-links
      // to /(main)/confession-thread. Payload uses data.confessionId.
      v.literal('tagged_confession'),
      v.literal('confession_reply'),
      v.literal('confession_reaction'),
      v.literal('confession_connect_requested'),
      v.literal('confession_connect_accepted'),
      v.literal('confession_connect_rejected'),
      // Legacy Phase-2 literals retained for backwards compatibility with
      // existing rows; new writes MUST go to `privateNotifications`.
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
      // Tagged-confession deep-link payload. confessionId is the only field
      // required to open the thread; fromUserId is recorded for moderation
      // / future allowlist checks but is never rendered in notification text.
      confessionId: v.optional(v.string()),
      connectId: v.optional(v.string()),
      fromUserId: v.optional(v.string()),
      source: v.optional(v.string()),
      // Legacy fields retained for backwards compatibility
      phase: v.optional(v.string()),
      otherUserId: v.optional(v.string()),
    })),
    // Strict phase tag for server-side filtering. New rows MUST set 'phase1'.
    // Optional only because legacy rows were written without it.
    phase: v.optional(v.literal('phase1')),
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

  // Phase-2 Notifications table (incognito/private/desire-land)
  // STRICT ISOLATION: This table is ONLY for Phase-2 notifications.
  // Phase-1 notifications live in `notifications` (separate physical table).
  // The two tables are intentionally never read together by any query.
  privateNotifications: defineTable({
    userId: v.id('users'),
    type: v.union(
      v.literal('phase2_match'),
      v.literal('phase2_like'),
      v.literal('phase2_private_message'),
      v.literal('phase2_deep_connect'),
      // I-002 RESERVED/DEPRECATED — `phase2_chat_room` is intentionally kept
      // in the schema enum so any historical rows (if they exist) remain
      // type-valid, but it has NO writer anywhere in the codebase. Product
      // decision: Chat Room one-on-one DMs stay bounded inside Chat Rooms;
      // they do NOT produce out-of-room notifications, do NOT contribute to
      // the Phase-2 Messages badge, and do NOT route into Phase-2 Messages.
      // Do NOT add a writer for this type. Do NOT add push routing. If you
      // need to remove this literal in a future cleanup, audit
      // `privateNotifications` for any legacy rows first.
      v.literal('phase2_chat_room')
    ),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.object({
      matchId: v.optional(v.string()),
      conversationId: v.optional(v.string()),
      privateConversationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      otherUserId: v.optional(v.string()),
      chatRoomId: v.optional(v.string()),
      threadId: v.optional(v.string()),
      source: v.optional(v.string()),
      action: v.optional(v.string()),
      likeId: v.optional(v.string()),
    })),
    // Strict phase tag — every Phase-2 row MUST be 'phase2'.
    phase: v.literal('phase2'),
    // Deduplication key (same semantics as Phase-1)
    dedupeKey: v.optional(v.string()),
    readAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_unread', ['userId', 'readAt'])
    .index('by_user_dedupe', ['userId', 'dedupeKey'])
    .index('by_expires', ['expiresAt']),

  // Crossed Paths table
  crossedPaths: defineTable({
    user1Id: v.id('users'),
    user2Id: v.id('users'),
    count: v.number(),
    lastCrossedAt: v.number(),
    lastLocation: v.optional(v.string()),
    unlockExpiresAt: v.optional(v.number()),
    // Legacy fields: store approximate/grid-snapped crossing coordinates only.
    // These hold the LATEST crossing location and may be overwritten on
    // repeat crossings. They MUST NOT be used as the marker source — use
    // the immutable firstCrossing* fields below instead.
    // Public queries must never return these fields or raw user lat/lng.
    crossingLatitude: v.optional(v.number()),
    crossingLongitude: v.optional(v.number()),
    // STABILITY FIX (Crossed Paths): Immutable first-crossing point. Set on
    // the very first crossing for a pair (or lazily back-filled on the next
    // crossing for legacy rows that pre-date these fields) and NEVER patched
    // afterwards. Repeat crossings only update count + lastCrossedAt; the
    // marker location is anchored to firstCrossingLatitude/Longitude so it
    // never moves once a pair has crossed paths.
    // Optional for backward compatibility with rows written before this fix.
    firstCrossedAt: v.optional(v.number()),
    firstCrossingLatitude: v.optional(v.number()),
    firstCrossingLongitude: v.optional(v.number()),
    // BUGFIX #28: Track last notification time to prevent duplicate notifications
    lastNotifiedAt: v.optional(v.number()),
    // Pair-level viewer dismissals. If set, that viewer no longer sees this
    // pair in Nearby/crossed paths and no longer receives pair notifications.
    dismissedByUser1At: v.optional(v.number()),
    dismissedByUser2At: v.optional(v.number()),
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
    // Approximate crossing location (rounded to ~300m grid for privacy)
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

  // Fix 7 — Daily distinct crossed-profile cap.
  // Private backend-only tracking for the daily cap on newly surfaced
  // Nearby/Crossed Paths profiles. Not exposed to clients.
  crossedPathDailyShown: defineTable({
    viewerId: v.id('users'),
    dateKey: v.string(),                    // ISO date "YYYY-MM-DD" (UTC slice)
    pairKey: v.string(),                    // ordered "user1Id:user2Id"
    targetUserId: v.id('users'),
    firstShownAt: v.number(),
    lastShownAt: v.number(),
    expiresAt: v.optional(v.number()),       // TTL sweep; optional for legacy rows
    // True when the pair already had a crossedPaths row at the time we surfaced
    // it — those don't consume daily-new slots.
    wasExistingCrossedPath: v.optional(v.boolean()),
  })
    .index('by_viewer_date', ['viewerId', 'dateKey'])
    .index('by_viewer_date_pair', ['viewerId', 'dateKey', 'pairKey'])
    .index('by_date_key', ['dateKey'])
    .index('by_expires', ['expiresAt']),

  // Phase-1 Background Crossed Paths: short-lived ring-buffer of location
  // samples (foreground, background, SLC). Used by recordLocationBatch +
  // time-windowed crossed-path detection. Not exposed to any client query.
  // TTL: 6 hours (cron sweeps expired rows).
  locationSamples: defineTable({
    userId: v.id('users'),
    lat: v.number(),           // snapped to privacy grid before write
    lng: v.number(),           // snapped to privacy grid before write
    capturedAt: v.number(),    // client-reported capture timestamp (ms)
    source: v.union(           // which wake path produced this sample
      v.literal('fg'),
      v.literal('bg'),
      v.literal('slc'),
    ),
    accuracy: v.optional(v.number()), // meters, if known
    expiresAt: v.number(),     // capturedAt + 6h for TTL sweep
  })
    .index('by_user_capturedAt', ['userId', 'capturedAt'])
    .index('by_capturedAt', ['capturedAt'])
    .index('by_expires', ['expiresAt']),

  // Phase 1 Background Crossed Paths — server-side audit log of every
  // recordLocationBatch call. Captures both accepted and rejected calls
  // along with the gate that fired. Used for support + Play Store /
  // App Store compliance evidence ("we have a tamper-proof record of
  // every background sample we accepted or refused").
  //
  // Never exposed to clients. Cleaned up by an hourly cron after 30 days.
  bgLocationAuditLog: defineTable({
    userId: v.id('users'),
    at: v.number(),                       // server timestamp (ms)
    sampleCount: v.number(),              // count in the incoming batch
    accepted: v.number(),                 // count actually written
    dropped: v.number(),                  // sampleCount - accepted
    sources: v.array(v.string()),         // distinct source codes in batch
    outcome: v.union(                     // top-level outcome
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('partial'),
    ),
    reason: v.optional(v.string()),       // gate code (e.g. 'consent_required',
                                          // 'rate_limited', 'feature_disabled')
    deviceHash: v.optional(v.string()),   // optional client-provided salted hash
    expiresAt: v.number(),                // at + 30 days for TTL sweep
  })
    .index('by_user_at', ['userId', 'at'])
    .index('by_expires', ['expiresAt']),

  // Phase 1 Background Crossed Paths — sliding-window rate limiter for
  // recordLocationBatch. One row per (userId, deviceHash, windowKind).
  // windowKind=='10min' tracks the short-window quota (default 30
  // samples / 10 minutes). windowKind=='daily' tracks the long-window
  // quota (default 200 samples / 24 hours). Counters are reset by
  // comparing windowStartedAt against now during the rate-limit check.
  //
  // deviceHash is optional — if a client doesn't supply one, the row
  // collapses to per-user and is keyed by deviceHash='__unknown__'.
  locationBatchRateLimit: defineTable({
    userId: v.id('users'),
    deviceHash: v.string(),               // '__unknown__' when client did not provide
    windowKind: v.union(
      v.literal('10min'),
      v.literal('daily'),
    ),
    windowStartedAt: v.number(),          // ms; reset when stale
    count: v.number(),                    // samples (not batches) accepted into the window
    updatedAt: v.number(),
  })
    .index('by_user_device_window', ['userId', 'deviceHash', 'windowKind']),

  // Generic per-user action rate-limit counters.
  // Used by report flows, swipe velocity guards, pre-match text caps,
  // and per-recipient Discover-notification caps. Each row holds a fixed
  // window counter for one (userId, action, windowKind) tuple. Windows
  // reset by replacing windowStartedAt + count (see reserveActionSlots
  // in convex/actionRateLimits.ts).
  actionRateLimits: defineTable({
    userId: v.id('users'),
    action: v.string(),
    windowKind: v.string(),
    windowStartedAt: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user_action_window', ['userId', 'action', 'windowKind']),

  // Phase 1 Background Crossed Paths — server-side feature flag table.
  // Single source of truth for kill-switching the entire background
  // pipeline. The only flag currently consumed is bgCrossedPathsEnabled;
  // when missing or value !== true the recordLocationBatch handler,
  // startDiscoveryMode, and stopDiscoveryMode all early-return.
  //
  // Read by isBgCrossedPathsEnabled() helper inside crossedPaths.ts.
  // Write-side is admin-only — there is no public mutation that flips
  // this flag.
  featureFlags: defineTable({
    name: v.string(),                     // e.g. 'bgCrossedPathsEnabled'
    value: v.boolean(),                   // false = killed
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),    // operator id / note
  })
    .index('by_name', ['name']),

  // Privacy Zones
  // User-owned private areas such as Home, Work, Hostel, College, or Gym.
  // Crossed Paths / Nearby location writes must skip samples inside the
  // current user's own zones. These coordinates are only returned to the
  // owning user through crossedPaths privacy-zone APIs.
  privacyZones: defineTable({
    userId: v.id('users'),
    label: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    radiusMeters: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId']),

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
    messageId: v.optional(v.string()),
    reportType: v.optional(v.union(v.literal('user'), v.literal('content'))),
    // P1-6: Origin surface for the report (where the user filed it from,
    // including Product "Vibes" / repo "Explore").
    // Optional for back-compat with existing rows that pre-date this field.
    source: v.optional(v.union(
      v.literal('discover'),
      v.literal('vibes'),
      v.literal('profile'),
      v.literal('chat'),
      v.literal('media'),
      v.literal('confession'),
      v.literal('unknown'),
    )),
  })
    .index('by_reported_user', ['reportedUserId'])
    .index('by_reporter', ['reporterId'])
    .index('by_reporter_reported_created', ['reporterId', 'reportedUserId', 'createdAt'])
    .index('by_status', ['status'])
    .index('by_room', ['roomId'])
    .index('by_message', ['messageId']),

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
      v.literal('app_or_account'),
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
    // Optional attachments uploaded with the initial request (mirrors Phase-1 supportTickets shape)
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          type: v.union(v.literal('photo'), v.literal('video')),
        }),
      ),
    ),
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
  // P2-FIX: `expiresAt` lets cleanup target rows by explicit expiry instead
  // of deriving the cutoff from `updatedAt`. New rows always set it; legacy
  // rows without `expiresAt` are still swept by the existing `by_updatedAt`
  // path in `cleanupStaleTypingStatus`.
  typingStatus: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    isTyping: v.boolean(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_user_conversation', ['userId', 'conversationId'])
    .index('by_updatedAt', ['updatedAt'])
    .index('by_expires_at', ['expiresAt']),

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
    phase2SetupVersion: v.optional(v.number()),
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
    .index('by_enabled', ['isPrivateEnabled'])
    // P1-1: Phase-2 deck pagination support. Lets privateDiscover.getProfiles
    // fetch a bounded, recency-ordered candidate slice instead of collect()ing
    // the entire enabled-private-profile table per request.
    .index('by_enabled_updatedAt', ['isPrivateEnabled', 'updatedAt']),

  userPrivateProfileAuditLog: defineTable({
    userId: v.id('users'),
    changedFields: v.array(v.string()),
    previousValues: v.optional(v.any()),
    newValues: v.optional(v.any()),
    changedAt: v.number(),
    source: v.literal('user'),
  })
    .index('by_user_changedAt', ['userId', 'changedAt']),

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
    uniqueReportCount: v.optional(v.number()),
    moderationStatus: v.optional(v.union(
      v.literal('normal'),
      v.literal('under_review'),
      v.literal('hidden_by_reports')
    )),
    moderationStatusAt: v.optional(v.number()),
    hiddenByReportsAt: v.optional(v.number()),
    // Owner profile snapshot (immutable at creation time)
    isAnonymous: v.optional(v.boolean()), // true = hide photo/name, show only age+gender
    photoBlurMode: v.optional(v.union(v.literal('none'), v.literal('blur'))), // 'blur' = show blurred photo
    ownerName: v.optional(v.string()),
    ownerPhotoUrl: v.optional(v.string()),
    ownerAge: v.optional(v.number()),
    ownerGender: v.optional(v.string()),
    // Owner-attached prompt media (optional). Media follows prompt visibility:
    // if a viewer can see the prompt text, they can see the media. No separate
    // one-time-view gating in this pass (no todPromptViews).
    mediaKind: v.optional(v.union(v.literal('photo'), v.literal('video'), v.literal('voice'))),
    mediaStorageId: v.optional(v.id('_storage')),
    mediaUrl: v.optional(v.string()),
    mediaMime: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    isFrontCamera: v.optional(v.boolean()),
  })
    .index('by_trending', ['isTrending'])
    .index('by_type', ['type'])
    .index('by_type_created', ['type', 'createdAt'])
    .index('by_owner', ['ownerUserId'])
    .index('by_created', ['createdAt'])
    .index('by_expires', ['expiresAt'])
    .index('by_moderation_status', ['moderationStatus']),

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
    fileSize: v.optional(v.number()),
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
    uniqueReportCount: v.optional(v.number()),
    moderationStatus: v.optional(v.union(
      v.literal('normal'),
      v.literal('under_review'),
      v.literal('hidden_by_reports')
    )),
    moderationStatusAt: v.optional(v.number()),
    hiddenByReportsAt: v.optional(v.number()),
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
    .index('by_prompt_user', ['promptId', 'userId'])
    .index('by_moderation_status', ['moderationStatus']),

  // Truth & Dare per-user view tracking (for one-time gating before owner views)
  todAnswerViews: defineTable({
    answerId: v.string(),
    viewerUserId: v.string(),
    viewedAt: v.number(),
  })
    .index('by_answer', ['answerId'])
    .index('by_answer_viewer', ['answerId', 'viewerUserId']),

  // Truth & Dare prompt-owner media one-time view tracking.
  // - Used ONLY for prompt-owner photo/video media (NOT voice).
  // - One row per (promptId, viewerUserId). Owner self-views are NEVER recorded.
  // - Powers two product behaviors:
  //   1. Non-owner photo/video media is one-time-view per viewer.
  //   2. Prompt owner sees a unique-viewer count ("X views").
  //
  // Intentionally separate from `todAnswerViews` so prompt-owner media
  // (one-time per non-owner) does not get conflated with answer media
  // (replayable; existence of a row never blocks playback there).
  todPromptMediaViews: defineTable({
    promptId: v.string(),
    viewerUserId: v.string(),
    ownerUserId: v.string(),
    mediaKind: v.union(v.literal('photo'), v.literal('video')),
    viewedAt: v.number(),
  })
    .index('by_prompt', ['promptId'])
    .index('by_prompt_viewer', ['promptId', 'viewerUserId']),

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
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other'),
      v.literal('harassment'),
      v.literal('sexual'),
      v.literal('spam'),
      v.literal('hate'),
      v.literal('violence'),
      v.literal('privacy'),
      v.literal('scam')
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
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other'),
      v.literal('harassment'),
      v.literal('sexual'),
      v.literal('spam'),
      v.literal('hate'),
      v.literal('violence'),
      v.literal('privacy'),
      v.literal('scam')
    )),
    reasonText: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_prompt', ['promptId'])
    .index('by_reporter', ['reporterId'])
    .index('by_prompt_reporter', ['promptId', 'reporterId']),

  // Truth & Dare durable per-(prompt, responder) media upload-attempt counter.
  // - One row per (promptId, userId). Created on first media upload attempt.
  // - `attemptCount` is monotonic. NEVER decremented or deleted on answer
  //   delete/recreate/remove-media so the 2-upload-attempt cap survives
  //   refresh, retry, reinstall, multi-device, and deleteMyAnswer.
  // - Used by `createOrEditAnswer` (TOD-MEDIA-1 fix).
  todAnswerUploadAttempts: defineTable({
    promptId: v.string(),
    userId: v.string(),
    attemptCount: v.number(),
    firstAttemptAt: v.number(),
    lastAttemptAt: v.number(),
  })
    .index('by_prompt_user', ['promptId', 'userId']),

  // Truth & Dare durable per-(prompt, responder) V1 private-media upload-attempt counter.
  // - Mirror of `todAnswerUploadAttempts` but scoped to the legacy
  //   `todPrivateMedia` path (TOD-MEDIA-3 fix).
  // - Survives pending-row deletion in `submitPrivateMediaResponse`.
  todPrivateMediaAttempts: defineTable({
    promptId: v.string(),
    fromUserId: v.string(),
    attemptCount: v.number(),
    firstAttemptAt: v.number(),
    lastAttemptAt: v.number(),
  })
    .index('by_prompt_from', ['promptId', 'fromUserId']),

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
      v.literal('claim_media'), // active secure-media claim rate limit action
      v.literal('media_upload') // upload URL generation / media finalization guard
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
    fileSize: v.optional(v.number()),
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
    authorVisibility: v.optional(v.union(v.literal('anonymous'), v.literal('open'), v.literal('blur'), v.literal('blur_photo'))), // legacy visibility flag; isAnonymous is the active source of truth
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
    uniqueReportCount: v.optional(v.number()),
    moderationStatus: v.optional(v.union(
      v.literal('normal'),
      v.literal('under_review'),
      v.literal('hidden_by_reports')
    )),
    moderationStatusAt: v.optional(v.number()),
    hiddenByReportsAt: v.optional(v.number()),
    uniqueCommenters: v.optional(v.number()), // legacy ranking/engagement metadata
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // 24h after createdAt; undefined = never expires (legacy)
    taggedUserId: v.optional(v.id('users')), // User being confessed to (must be someone current user has liked)
    taggedUserName: v.optional(v.string()), // Denormalised display name of tagged user; backend-resolved at create time. Bounded length.
    // Soft delete support
    isDeleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_created', ['createdAt'])
    .index('by_user', ['userId'])
    .index('by_expires', ['expiresAt'])
    .index('by_tagged_user', ['taggedUserId'])
    .index('by_moderation_status', ['moderationStatus']),

  // Confession Reports table (for moderation)
  confessionReports: defineTable({
    confessionId: v.id('confessions'),
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    reason: v.union(
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other'),
      v.literal('spam'),
      v.literal('harassment'),
      v.literal('hate'),
      v.literal('sexual')
    ),
    description: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('actioned')),
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_reporter', ['reporterId'])
    .index('by_status', ['status']),

  // Confession Reply Reports table (for moderation of individual comments)
  confessionReplyReports: defineTable({
    replyId: v.id('confessionReplies'),
    confessionId: v.id('confessions'),
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    // Moderation snapshot retained even if the source reply row is later
    // deleted as part of confession cleanup.
    replyContentSnapshot: v.optional(v.string()),
    replyAuthorIdSnapshot: v.optional(v.id('users')),
    replyTypeSnapshot: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    replyVoiceUrlSnapshot: v.optional(v.string()),
    replyVoiceDurationSecSnapshot: v.optional(v.number()),
    parentReplyIdSnapshot: v.optional(v.id('confessionReplies')),
    replyCreatedAtSnapshot: v.optional(v.number()),
    reason: v.union(
      v.literal('sexual_content'),
      v.literal('threats_violence'),
      v.literal('targeting_someone'),
      v.literal('private_information'),
      v.literal('scam_promotion'),
      v.literal('other'),
      v.literal('spam'),
      v.literal('harassment'),
      v.literal('hate'),
      v.literal('sexual')
    ),
    description: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('actioned')),
    createdAt: v.number(),
  })
    .index('by_reply', ['replyId'])
    .index('by_reporter', ['reporterId'])
    .index('by_status', ['status']),

  // Confession Replies table
  confessionReplies: defineTable({
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    text: v.string(),
    isAnonymous: v.boolean(),
    // Canonical reply identity mode. New rows write 'anonymous' | 'blur_photo' | 'open'.
    // Legacy 'blur' literal kept in the union so historical rows still validate; serializer
    // normalizes 'blur' -> 'blur_photo' on read.
    identityMode: v.optional(v.union(
      v.literal('anonymous'),
      v.literal('open'),
      v.literal('blur'),
      v.literal('blur_photo')
    )),
    hasActiveConnectRequest: v.optional(v.boolean()), // legacy flag ignored by current Confessions UI/backend contract
    type: v.optional(v.union(v.literal('text'), v.literal('voice'))),
    voiceUrl: v.optional(v.string()),
    voiceDurationSec: v.optional(v.number()),
    parentReplyId: v.optional(v.id('confessionReplies')), // OP-only reply to a comment
    // Author display snapshot (omitted for anonymous mode). Mirrors the snapshotting pattern
    // used by the confessions table so the thread can render Anonymous / Blurred photo / Open.
    authorName: v.optional(v.string()),
    authorPhotoUrl: v.optional(v.string()),
    authorAge: v.optional(v.number()),
    authorGender: v.optional(v.string()),
    editedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_user', ['userId'])
    .index('by_confession_user', ['confessionId', 'userId']),

  // Confession Reactions table (Phase-1 Confess allowed emoji only — one emoji per user per confession)
  confessionReactions: defineTable({
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    type: v.string(), // validated by convex/confessions.ts allow-list
    createdAt: v.number(),
  })
    .index('by_confession', ['confessionId'])
    .index('by_user', ['userId'])
    .index('by_confession_user', ['confessionId', 'userId']),

  // Confession reaction toggle rate-limit events
  confessionReactionRateEvents: defineTable({
    confessionId: v.id('confessions'),
    userId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_confession_user_created', ['confessionId', 'userId', 'createdAt'])
    .index('by_confession', ['confessionId']),

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

  // Backend-authoritative Confess Connect / Reject state. `conversationId` is
  // set after both sides connect and the Phase-1 conversation is promoted.
  confessionConnects: defineTable({
    confessionId: v.id('confessions'),
    fromUserId: v.id('users'), // tagged user / requester
    toUserId: v.id('users'),   // confession author / owner
    status: v.union(
      v.literal('pending'),
      v.literal('mutual'),
      v.literal('rejected_by_from'),
      v.literal('rejected_by_to'),
      v.literal('cancelled_by_from'),
      v.literal('expired')
    ),
    conversationId: v.optional(v.id('conversations')),
    createdAt: v.number(),
    updatedAt: v.number(),
    respondedAt: v.optional(v.number()),
    expiresAt: v.number(),
    seenByOwnerAt: v.optional(v.number()),
  })
    .index('by_confession', ['confessionId'])
    .index('by_from_to', ['fromUserId', 'toUserId'])
    .index('by_to_status', ['toUserId', 'status'])
    .index('by_from_status', ['fromUserId', 'status'])
    .index('by_expires', ['expiresAt'])
    .index('by_status_expires', ['status', 'expiresAt']),

  // Confession-tag profile-view grants.
  // Records that a viewer was given permission to open a tagged user's
  // profile via the @mention chip on a specific confession. The grant is
  // (viewer, confession, profileUser)-specific; it does NOT permit opening
  // arbitrary profiles, and it is consumed at click time after passing all
  // safety checks (block / report / deletion / expiry / mention-id match).
  // Existence of a grant does NOT bypass any other safety gate; the grant
  // only opts the viewer out of Super Like / Stand Out / skip-style action
  // flows that other entry points (Discover, etc.) may apply, and only when
  // the consuming surface explicitly checks `source=confess_tag` plus the
  // grant.
  confessionTagProfileViews: defineTable({
    viewerId: v.id('users'),
    profileUserId: v.id('users'),
    confessionId: v.id('confessions'),
    createdAt: v.number(),
    // 24h cap so a tagged confession can't seed a permanent bypass.
    expiresAt: v.number(),
    // Set when the viewer actually navigates; idempotent within (viewer,
    // confession) so the chip can be re-tapped during the grant window.
    consumedAt: v.optional(v.number()),
  })
    .index('by_viewer_confession', ['viewerId', 'confessionId'])
    .index('by_viewer', ['viewerId'])
    .index('by_confession', ['confessionId'])
    .index('by_expires', ['expiresAt']),

  // Chat Rooms table (group chat rooms in Private section)
  chatRooms: defineTable({
    name: v.string(),
    slug: v.string(),
    category: v.union(v.literal('language'), v.literal('general')),
    isPublic: v.boolean(),
    discoverable: v.optional(v.boolean()),
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
    imageStorageId: v.optional(v.id('_storage')),
    videoStorageId: v.optional(v.id('_storage')),
    audioUrl: v.optional(v.string()), // For audio/voice messages
    audioStorageId: v.optional(v.id('_storage')),
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
    .index('by_room_clientId', ['roomId', 'clientId']) // For idempotency check
    .index('by_expires', ['expiresAt'])
    .index('by_room_expires', ['roomId', 'expiresAt']),

  chatRoomMediaViews: defineTable({
    messageId: v.id('chatRoomMessages'),
    viewerUserId: v.id('users'),
    viewedAt: v.number(),
  })
    .index('by_message', ['messageId'])
    .index('by_message_viewer', ['messageId', 'viewerUserId']),

  // Emoji reactions on chat room messages (Phase-2)
  chatRoomMessageReactions: defineTable({
    roomId: v.id('chatRooms'),
    messageId: v.id('chatRoomMessages'),
    userId: v.id('users'),
    emoji: v.string(),
    createdAt: v.number(),
  })
    .index('by_room_message', ['roomId', 'messageId'])
    .index('by_message_user', ['messageId', 'userId'])
    // P2-18/P2-19: precise lookup for (message, user, emoji) used by
    // removeReaction (targeted delete) and addReaction (post-insert dedupe).
    .index('by_message_user_emoji', ['messageId', 'userId', 'emoji']),

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
  })
    .index('by_mentioned_user_created', ['mentionedUserId', 'createdAt'])
    .index('by_mentioned_user_readAt', ['mentionedUserId', 'readAt'])
    .index('by_message', ['messageId']),

  // Per-room mute of another member's messages (viewer-specific)
  chatRoomPerUserMutes: defineTable({
    roomId: v.id('chatRooms'),
    muterId: v.id('users'),
    targetUserId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_room_muter', ['roomId', 'muterId'])
    .index('by_room_target', ['roomId', 'targetUserId'])
    // P2-20: precise lookup for (room, muter, target) used by
    // toggleMuteUserInRoom's post-insert dedupe.
    .index('by_room_muter_target', ['roomId', 'muterId', 'targetUserId']),

  // DM threads hidden from inbox (per user; conversation id)
  chatRoomHiddenDmConversations: defineTable({
    userId: v.id('users'),
    conversationId: v.id('conversations'),
    hiddenAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_conversation', ['userId', 'conversationId']),

  chatRoomPrivateConversations: defineTable({
    roomId: v.id('chatRooms'),
    pairKey: v.string(),
    participants: v.array(v.id('users')),
    user1Id: v.id('users'),
    user2Id: v.id('users'),
    createdAt: v.number(),
    lastMessageAt: v.optional(v.number()),
    lastMessageText: v.optional(v.string()),
  })
    .index('by_room_pair', ['roomId', 'pairKey'])
    .index('by_room', ['roomId'])
    .index('by_user1', ['user1Id'])
    .index('by_user2', ['user2Id'])
    .index('by_last_message', ['lastMessageAt']),

  chatRoomPrivateMessages: defineTable({
    conversationId: v.id('chatRoomPrivateConversations'),
    roomId: v.id('chatRooms'),
    senderId: v.id('users'),
    type: v.union(v.literal('text'), v.literal('image'), v.literal('video'), v.literal('voice'), v.literal('system')),
    content: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    audioStorageId: v.optional(v.id('_storage')),
    audioDurationMs: v.optional(v.number()),
    clientMessageId: v.optional(v.string()),
    readAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_conversation_created', ['conversationId', 'createdAt'])
    .index('by_conversation_readAt', ['conversationId', 'readAt'])
    .index('by_conversation_clientMessageId', ['conversationId', 'clientMessageId'])
    .index('by_room', ['roomId']),

  chatRoomPrivateTyping: defineTable({
    conversationId: v.id('chatRoomPrivateConversations'),
    roomId: v.id('chatRooms'),
    userId: v.id('users'),
    isTyping: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_user_conversation', ['userId', 'conversationId'])
    .index('by_updatedAt', ['updatedAt']),

  chatRoomPrivateConversationHides: defineTable({
    userId: v.id('users'),
    conversationId: v.id('chatRoomPrivateConversations'),
    hiddenAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_conversation', ['userId', 'conversationId']),

  chatRoomReports: defineTable({
    reporterId: v.id('users'),
    reportedUserId: v.id('users'),
    roomId: v.id('chatRooms'),
    reason: v.union(
      v.literal('fake_profile'),
      v.literal('inappropriate_photos'),
      v.literal('harassment'),
      v.literal('spam'),
      v.literal('underage'),
      v.literal('other'),
      v.literal('hate_speech'),
      v.literal('sexual_content'),
      v.literal('nudity'),
      v.literal('violent_threats'),
      v.literal('impersonation'),
      v.literal('selling')
    ),
    description: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved')),
    createdAt: v.number(),
    messageId: v.optional(v.string()),
    reportType: v.optional(v.union(v.literal('user'), v.literal('content'))),
  })
    .index('by_room', ['roomId'])
    .index('by_reporter', ['reporterId'])
    .index('by_reported_user', ['reportedUserId'])
    .index('by_reporter_reported_room_created', ['reporterId', 'reportedUserId', 'roomId', 'createdAt'])
    .index('by_message', ['messageId'])
    .index('by_room_reporter_created', ['roomId', 'reporterId', 'createdAt'])
    .index('by_room_reported_created', ['roomId', 'reportedUserId', 'createdAt'])
    .index('by_message_reporter_type_created', ['messageId', 'reporterId', 'reportType', 'createdAt']),

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

  // Chat Room Moderation Log (system/admin audit trail for room safety actions)
  //
  // P3-2: The original schema accepted only `actor === 'system'` rows
  // (auto-timeouts and review-required flags raised by the auto-moderation
  // pipeline). The union below is widened additively to also capture
  // human-driven moderation events (room admins and self-service reporters)
  // so promote / demote / kickAndBan / mute toggles / report submissions
  // are durable for post-incident review. Existing system-actor rows
  // remain valid under the widened unions; no migration is needed.
  chatRoomModerationLog: defineTable({
    actor: v.union(v.literal('system'), v.literal('user')),
    actorRole: v.union(
      v.literal('system'),
      v.literal('admin'),
      v.literal('user')
    ),
    // P3-2: For non-system actors this is the moderator / reporter user id.
    // System rows leave this undefined.
    actorUserId: v.optional(v.id('users')),
    roomId: v.id('chatRooms'),
    targetUserId: v.id('users'),
    action: v.union(
      // Existing system actions:
      v.literal('auto_timeout_applied'),
      v.literal('admin_review_required'),
      // P3-2 — admin (room creator) actions:
      v.literal('admin_promoted'),
      v.literal('admin_demoted'),
      v.literal('admin_kicked_banned'),
      v.literal('admin_muted_user'),
      v.literal('admin_unmuted_user'),
      v.literal('admin_closed_room'),
      // P3-2 — self-service actions:
      v.literal('user_muted_room'),
      v.literal('user_unmuted_room'),
      v.literal('user_reported_user'),
      v.literal('user_reported_message')
    ),
    reason: v.string(),
    durationMs: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_room_created', ['roomId', 'createdAt'])
    .index('by_target_created', ['targetUserId', 'createdAt'])
    .index('by_action_created', ['action', 'createdAt'])
    // P3-2: list a single moderator's actions in chronological order.
    .index('by_actor_created', ['actorUserId', 'createdAt']),

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
    .index('by_user_status', ['userId', 'status'])
    // P2-16: Range-scan rows by status for TTL cleanup (rows are implicitly
    // ordered by _creationTime within a status equality).
    .index('by_status', ['status']),

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
    .index('by_room_user', ['roomId', 'authUserId'])
    // P2-17: Range-scan rows by lastAttemptAt for TTL cleanup.
    .index('by_last_attempt', ['lastAttemptAt']),

  // Chat Room join-code lookup throttle.
  // Kept user-scoped so a known/guessed private room code cannot be brute-forced
  // through the preview endpoint without a valid session.
  chatRoomJoinCodeLookups: defineTable({
    userId: v.id('users'),
    windowStart: v.number(),
    attempts: v.number(),
    lastAttemptAt: v.number(),
  })
    .index('by_user_window', ['userId', 'windowStart'])
    .index('by_last_attempt', ['lastAttemptAt']),

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
    .index('by_room_user', ['roomId', 'userId'])
    // P2-1: Range queries for online-count and P2-14 stale-presence cleanup.
    .index('by_room_heartbeat', ['roomId', 'lastHeartbeatAt'])
    .index('by_heartbeat', ['lastHeartbeatAt']),

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
    .index('by_user_room', ['userId', 'roomId'])
    // P0-4: Needed by deleteRoomFully to cascade room-scoped prefs
    .index('by_room', ['roomId']),

  // User Room Reports (track which rooms user has reported)
  userRoomReports: defineTable({
    userId: v.id('users'),
    roomId: v.string(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_room', ['userId', 'roomId'])
    // P0-4: Needed by deleteRoomFully to cascade room-scoped reports
    .index('by_room', ['roomId']),

  // P0-1: Chat Room media upload ownership.
  // Binds an uploaded storage blob to the user who first references it in a
  // chat-room message. sendMessage consults this table before accepting any
  // imageStorageId/videoStorageId/audioStorageId so a user cannot attach
  // another user's storage blob.
  chatRoomMediaUploads: defineTable({
    storageId: v.id('_storage'),
    uploaderUserId: v.id('users'),
    mediaKind: v.union(
      v.literal('image'),
      v.literal('video'),
      v.literal('audio'),
      v.literal('doodle')
    ),
    createdAt: v.number(),
  })
    .index('by_storage', ['storageId'])
    .index('by_uploader', ['uploaderUserId']),

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
    // TD-LIFECYCLE: Manual-start + inactivity timeout tracking (restored from c471732)
    acceptedAt: v.optional(v.number()),    // When invitee accepted (separate from respondedAt for legacy compat)
    gameStartedAt: v.optional(v.number()), // Set by startBottleSpinGame when inviter manually starts
    lastActionAt: v.optional(v.number()),  // Updated on every spin/turn for inactivity timeout
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
    .index('by_conversation_createdAt', ['conversationId', 'createdAt'])
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
    .index('by_viewer_lastSeenAt', ['viewerId', 'lastSeenAt'])
    .index('by_pair', ['viewerId', 'viewedUserId']),

  phase2ImpressionRateLimits: defineTable({
    viewerId: v.id('users'),
    windowStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index('by_viewer', ['viewerId']),

  // Vibes / Explore Category Viewer Impressions (per-viewer, per-category
  // repetition suppression). Mirrors phase2ViewerImpressions in spirit but
  // scopes suppression by (viewerId, viewedUserId, categoryId) so that
  // re-entering an Explore category or paginating does not immediately
  // re-show the same profiles. Suppression window is 4 hours and is applied
  // as "push to back" ordering inside getExploreCategoryProfiles — never as
  // a hard exclusion (deck availability is preserved). Hard safety/privacy
  // filters (self, blocked, reported, hidden/paused, banned/inactive,
  // underage, privacy-hidden, unsafe photos, non-reciprocal demographic
  // constraints) remain enforced upstream in buildExploreCandidates and are
  // not affected by this table.
  exploreViewerImpressions: defineTable({
    viewerId: v.id('users'),       // Who was viewing
    viewedUserId: v.id('users'),   // Who was shown
    categoryId: v.string(),        // Explore/Vibes category id (e.g. 'nearby')
    source: v.optional(v.literal('vibes')),
    lastSeenAt: v.number(),        // When last shown to this viewer in this category
    seenCount: v.number(),         // How many times shown to this viewer in this category
  })
    // Suppression read path: by viewer + category + lastSeenAt cutoff.
    .index('by_viewer_category_lastSeenAt', ['viewerId', 'categoryId', 'lastSeenAt'])
    // Upsert path: locate existing (viewer, viewed, category) row.
    .index('by_pair_category', ['viewerId', 'viewedUserId', 'categoryId']),

  // P1-9: Phase-1 Discover impression recording.
  // Records (viewerId, viewedUserId) pairs that surfaced in the Discover deck
  // so the backend can dedupe / suppress / measure later. Mirrors
  // exploreViewerImpressions but without the categoryId scope (Discover is a
  // single feed). Hard safety filters (block, report, banned, hidden) remain
  // enforced upstream by getDiscoverProfiles — this table is metric-only.
  phase1ViewerImpressions: defineTable({
    viewerId: v.id('users'),
    viewedUserId: v.id('users'),
    lastSeenAt: v.number(),
    seenCount: v.number(),
  })
    .index('by_viewer', ['viewerId'])
    .index('by_viewer_lastSeenAt', ['viewerId', 'lastSeenAt'])
    .index('by_pair', ['viewerId', 'viewedUserId']),
});
