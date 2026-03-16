import { FeatureAccess, SubscriptionPlan, IAPProduct, RelationshipIntent, ActivityFilter, ConfessionTopic, ConfessionMood } from '@/types';

// App Colors
export const COLORS = {
  primary: '#FF6B6B',
  primaryDark: '#E55A5A',
  primaryLight: '#FF8A8A',
  secondary: '#4ECDC4',
  secondaryDark: '#3DBDB5',
  background: '#FFFFFF',
  backgroundDark: '#F5F5F5',
  text: '#333333',
  textLight: '#666666',
  textMuted: '#999999',
  border: '#E0E0E0',
  success: '#4CAF50',
  warning: '#FFC107',
  error: '#F44336',
  superLike: '#2196F3',
  like: '#FF6B6B',
  pass: '#9E9E9E',
  gold: '#FFD700',
  platinum: '#E5E4E2',
  overlay: 'rgba(0, 0, 0, 0.5)',
  white: '#FFFFFF',
  black: '#000000',
};

// Swipe Configuration
export const SWIPE_CONFIG = {
  SWIPE_THRESHOLD_X: 0.3, // 30% of screen width
  SWIPE_THRESHOLD_Y: 0.2, // 20% of screen height
  SWIPE_VELOCITY_X: 0.7, // horizontal velocity threshold
  SWIPE_VELOCITY_Y: 0.7, // vertical velocity threshold
  ROTATION_ANGLE: 15, // degrees
  ANIMATION_DURATION: 300, // ms
  HAPTIC_ENABLED: true,
};

// Validation Rules
export const VALIDATION = {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 20,
  FIRST_NAME_MIN_LENGTH: 1,
  FIRST_NAME_MAX_LENGTH: 20,
  LAST_NAME_MIN_LENGTH: 1,
  LAST_NAME_MAX_LENGTH: 20,
  BIO_MIN_LENGTH: 20,
  BIO_MAX_LENGTH: 500,
  MIN_AGE: 18,
  MAX_AGE: 100,
  MIN_PHOTO_SIZE: 400, // px
  MAX_PHOTOS: 6,
  MIN_PHOTOS: 1,
  MIN_DISTANCE: 1,
  MAX_DISTANCE: 100,
  PASSWORD_MIN_LENGTH: 8,
  OTP_LENGTH: 6,
};

// Feature Access by User Type
export const FEATURE_ACCESS: Record<string, FeatureAccess> = {
  // Women get full free access
  female_free: {
    swipesPerDay: 'unlimited',
    superLikesPerWeek: 'unlimited',
    messagesPerWeek: 'unlimited',
    boostsPerMonth: 'unlimited',
    canRewind: true,
    canSeeWhoLikedYou: true,
    incognitoAccess: 'full',
    customMessageLength: 'unlimited',
    templateCount: 50,
  },

  // Men - Free (first week)
  male_free_trial: {
    swipesPerDay: 50,
    superLikesPerWeek: 1,
    messagesPerWeek: 5,
    boostsPerMonth: 0,
    canRewind: false,
    canSeeWhoLikedYou: false,
    incognitoAccess: 'limited',
    customMessageLength: 0,
    templateCount: 10,
  },

  // Men - Free (after trial)
  male_free: {
    swipesPerDay: 50,
    superLikesPerWeek: 0,
    messagesPerWeek: 0,
    boostsPerMonth: 0,
    canRewind: false,
    canSeeWhoLikedYou: false,
    incognitoAccess: 'limited',
    customMessageLength: 0,
    templateCount: 10,
  },

  // Men - Basic
  male_basic: {
    swipesPerDay: 'unlimited',
    superLikesPerWeek: 5,
    messagesPerWeek: 10,
    boostsPerMonth: 2,
    canRewind: true,
    canSeeWhoLikedYou: true,
    incognitoAccess: 'partial',
    customMessageLength: 150,
    templateCount: 25,
  },

  // Men - Premium
  male_premium: {
    swipesPerDay: 'unlimited',
    superLikesPerWeek: 'unlimited',
    messagesPerWeek: 'unlimited',
    boostsPerMonth: 'unlimited',
    canRewind: true,
    canSeeWhoLikedYou: true,
    incognitoAccess: 'full',
    customMessageLength: 'unlimited',
    templateCount: 50,
  },
};

// Subscription Plans (for men only)
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  // Basic Tier
  { id: 'basic_1_month', tier: 'basic', duration: 1, price: 100, pricePerMonth: 100 },
  { id: 'basic_3_months', tier: 'basic', duration: 3, price: 500, pricePerMonth: 167 },
  { id: 'basic_12_months', tier: 'basic', duration: 12, price: 1000, pricePerMonth: 83 },

  // Premium Tier
  { id: 'premium_1_month', tier: 'premium', duration: 1, price: 200, pricePerMonth: 200 },
  { id: 'premium_3_months', tier: 'premium', duration: 3, price: 500, pricePerMonth: 167 },
  { id: 'premium_12_months', tier: 'premium', duration: 12, price: 1500, pricePerMonth: 125 },
];

// In-App Purchase Products
export const IAP_PRODUCTS: IAPProduct[] = [
  // Boosts
  { id: 'boost_1hr', type: 'boost', quantity: 1, price: 50, duration: 1 },
  { id: 'boost_4hr', type: 'boost', quantity: 1, price: 100, duration: 4 },
  { id: 'boost_24hr', type: 'boost', quantity: 1, price: 200, duration: 24 },

  // Super Likes
  { id: 'super_likes_5', type: 'super_likes', quantity: 5, price: 100 },
  { id: 'super_likes_10', type: 'super_likes', quantity: 10, price: 180 },
  { id: 'super_likes_25', type: 'super_likes', quantity: 25, price: 400 },

  // Messages
  { id: 'messages_10', type: 'messages', quantity: 10, price: 100 },
  { id: 'messages_25', type: 'messages', quantity: 25, price: 200 },
  { id: 'messages_50', type: 'messages', quantity: 50, price: 350 },
];

// Relationship Intent Options (Phase-1 ONLY — store-safe labels, no overlap with Phase-2)
// CANONICAL LIST: 9 Relationship Goals used across Explore, Sort By, Filters
export const RELATIONSHIP_INTENTS: { value: RelationshipIntent; label: string; emoji: string }[] = [
  { value: 'long_term', label: 'Serious Vibes', emoji: '💑' },
  { value: 'short_term', label: 'Keep It Casual', emoji: '🎉' },
  { value: 'figuring_out', label: 'Exploring Vibes', emoji: '🤔' },
  { value: 'short_to_long', label: 'See Where It Goes', emoji: '📈' },
  { value: 'long_to_short', label: 'Open to Vibes', emoji: '📉' },
  { value: 'new_friends', label: 'Just Friends', emoji: '👋' },
  { value: 'open_to_anything', label: 'Open to Anything', emoji: '✨' },
  { value: 'single_parent', label: 'Single Parent', emoji: '👨‍👧' },
  { value: 'just_18', label: 'New to Dating', emoji: '🌱' },
];

// Activity Filter Options (70 interests for onboarding)
export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string; emoji: string }[] = [
  // Original 20 (backward compatible - DO NOT CHANGE labels)
  { value: 'coffee', label: 'Coffee', emoji: '☕' },
  { value: 'date_night', label: 'Date Night', emoji: '🌙' },
  { value: 'sports', label: 'Sports', emoji: '⚽' },
  { value: 'movies', label: 'Movies', emoji: '🎬' },
  { value: 'free_tonight', label: 'Free Tonight', emoji: '🌟' },
  { value: 'foodie', label: 'Foodie', emoji: '🍕' },
  { value: 'gym_partner', label: 'Gym Partner', emoji: '💪' },
  { value: 'concerts', label: 'Concerts', emoji: '🎵' },
  { value: 'travel', label: 'Travel', emoji: '✈️' },
  { value: 'outdoors', label: 'Outdoors', emoji: '🏕️' },
  { value: 'art_culture', label: 'Art & Culture', emoji: '🎨' },
  { value: 'gaming', label: 'Gaming', emoji: '🎮' },
  { value: 'nightlife', label: 'Nightlife', emoji: '🍸' },
  { value: 'brunch', label: 'Brunch', emoji: '🥂' },
  { value: 'study_date', label: 'Study Date', emoji: '📚' },
  { value: 'this_weekend', label: 'This Weekend', emoji: '📅' },
  { value: 'beach_pool', label: 'Beach/Pool', emoji: '🏖️' },
  { value: 'road_trip', label: 'Road Trip', emoji: '🚗' },
  { value: 'photography', label: 'Photography', emoji: '📸' },
  { value: 'volunteering', label: 'Volunteering', emoji: '❤️' },
  // Additional 50 interests (curated for broad appeal)
  { value: 'late_night_talks', label: 'Late Night Talks', emoji: '🌃' },
  { value: 'street_food', label: 'Street Food', emoji: '🍜' },
  { value: 'home_cooking', label: 'Home Cooking', emoji: '👨‍🍳' },
  { value: 'baking', label: 'Baking', emoji: '🧁' },
  { value: 'healthy_eating', label: 'Healthy Eating', emoji: '🥗' },
  { value: 'weekend_getaways', label: 'Weekend Getaways', emoji: '🏨' },
  { value: 'long_drives', label: 'Long Drives', emoji: '🚙' },
  { value: 'city_exploring', label: 'City Exploring', emoji: '🏙️' },
  { value: 'beach_vibes', label: 'Beach Vibes', emoji: '🏖️' },
  { value: 'mountain_views', label: 'Mountain Views', emoji: '⛰️' },
  { value: 'nature_walks', label: 'Nature Walks', emoji: '🌳' },
  { value: 'sunset_views', label: 'Sunset Views', emoji: '🌅' },
  { value: 'hiking', label: 'Hiking', emoji: '🥾' },
  { value: 'camping', label: 'Camping', emoji: '⛺' },
  { value: 'stargazing', label: 'Stargazing', emoji: '🌟' },
  { value: 'gardening', label: 'Gardening', emoji: '🌻' },
  { value: 'gym', label: 'Gym', emoji: '🏋️' },
  { value: 'yoga', label: 'Yoga', emoji: '🧘' },
  { value: 'running', label: 'Running', emoji: '🏃' },
  { value: 'cycling', label: 'Cycling', emoji: '🚴' },
  { value: 'meditation', label: 'Meditation', emoji: '🧘‍♀️' },
  { value: 'pilates', label: 'Pilates', emoji: '🤸' },
  { value: 'music_lover', label: 'Music Lover', emoji: '🎶' },
  { value: 'live_concerts', label: 'Live Concerts', emoji: '🎤' },
  { value: 'singing', label: 'Singing', emoji: '🎙️' },
  { value: 'podcasts', label: 'Podcasts', emoji: '🎙️' },
  { value: 'binge_watching', label: 'Binge Watching', emoji: '📺' },
  { value: 'thrillers', label: 'Thrillers', emoji: '😱' },
  { value: 'documentaries', label: 'Documentaries', emoji: '🎥' },
  { value: 'anime', label: 'Anime', emoji: '🎌' },
  { value: 'k_dramas', label: 'K-Dramas', emoji: '🇰🇷' },
  { value: 'board_games', label: 'Board Games', emoji: '🎲' },
  { value: 'chess', label: 'Chess', emoji: '♟️' },
  { value: 'escape_rooms', label: 'Escape Rooms', emoji: '🔐' },
  { value: 'drawing', label: 'Drawing', emoji: '✏️' },
  { value: 'painting', label: 'Painting', emoji: '🖼️' },
  { value: 'writing', label: 'Writing', emoji: '✍️' },
  { value: 'journaling', label: 'Journaling', emoji: '📓' },
  { value: 'diy_projects', label: 'DIY Projects', emoji: '🔨' },
  { value: 'reading', label: 'Reading', emoji: '📚' },
  { value: 'personal_growth', label: 'Personal Growth', emoji: '🌱' },
  { value: 'learning_new_skills', label: 'Learning New Skills', emoji: '🎓' },
  { value: 'mindfulness', label: 'Mindfulness', emoji: '🧘' },
  { value: 'tech_enthusiast', label: 'Tech Enthusiast', emoji: '🔧' },
  { value: 'startups', label: 'Startups', emoji: '🚀' },
  { value: 'coding', label: 'Coding', emoji: '💻' },
  { value: 'community_service', label: 'Community Service', emoji: '🤝' },
  { value: 'sustainability', label: 'Sustainability', emoji: '♻️' },
  { value: 'plant_parenting', label: 'Plant Parenting', emoji: '🪴' },
];

// Profile Detail Options
export const SMOKING_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'regularly', label: 'Regularly' },
  { value: 'trying_to_quit', label: 'Trying to quit' },
];

export const DRINKING_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'socially', label: 'Socially' },
  { value: 'regularly', label: 'Regularly' },
  { value: 'sober', label: 'Sober' },
];

export const KIDS_OPTIONS = [
  { value: 'have_and_want_more', label: 'Have & want more' },
  { value: 'have_and_dont_want_more', label: "Have & don't want more" },
  { value: 'dont_have_and_want', label: "Don't have & want" },
  { value: 'dont_have_and_dont_want', label: "Don't have & don't want" },
  { value: 'not_sure', label: 'Not sure yet' },
];

export const EDUCATION_OPTIONS = [
  { value: 'high_school', label: 'High School' },
  { value: 'some_college', label: 'Some College' },
  { value: 'associate', label: 'Associate Degree' },
  { value: 'bachelors', label: "Bachelor's Degree" },
  { value: 'masters', label: "Master's Degree" },
  { value: 'doctorate', label: 'Doctorate / PhD' },
  { value: 'trade_school', label: 'Trade School' },
  { value: 'professional', label: 'Professional Degree (MD, JD, CA, etc.)' },
  { value: 'diploma', label: 'Diploma / Polytechnic' },
  { value: 'other', label: 'Other' },
];

export const RELIGION_OPTIONS = [
  { value: 'christian', label: 'Christian' },
  { value: 'muslim', label: 'Muslim' },
  { value: 'hindu', label: 'Hindu' },
  { value: 'buddhist', label: 'Buddhist' },
  { value: 'jewish', label: 'Jewish' },
  { value: 'sikh', label: 'Sikh' },
  { value: 'atheist', label: 'Atheist' },
  { value: 'agnostic', label: 'Agnostic' },
  { value: 'spiritual', label: 'Spiritual' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const EXERCISE_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'sometimes', label: 'Sometimes (1-2x/week)' },
  { value: 'regularly', label: 'Regularly (3-4x/week)' },
  { value: 'daily', label: 'Daily (5+ times/week)' },
];

export const PETS_OPTIONS = [
  { value: 'dog', label: 'Dog(s)', emoji: '🐕' },
  { value: 'cat', label: 'Cat(s)', emoji: '🐈' },
  { value: 'bird', label: 'Bird(s)', emoji: '🐦' },
  { value: 'fish', label: 'Fish', emoji: '🐟' },
  { value: 'rabbit', label: 'Rabbit', emoji: '🐇' },
  { value: 'hamster', label: 'Hamster', emoji: '🐹' },
  { value: 'guinea_pig', label: 'Guinea pig', emoji: '🐹' },
  { value: 'turtle', label: 'Turtle', emoji: '🐢' },
  { value: 'parrot', label: 'Parrot', emoji: '🦜' },
  { value: 'pigeon', label: 'Pigeon', emoji: '🐦' },
  { value: 'chicken', label: 'Chicken', emoji: '🐔' },
  { value: 'duck', label: 'Duck', emoji: '🦆' },
  { value: 'goat', label: 'Goat', emoji: '🐐' },
  { value: 'cow', label: 'Cow', emoji: '🐄' },
  { value: 'horse', label: 'Horse', emoji: '🐴' },
  { value: 'snake', label: 'Snake', emoji: '🐍' },
  { value: 'lizard', label: 'Lizard', emoji: '🦎' },
  { value: 'frog', label: 'Frog', emoji: '🐸' },
  { value: 'other', label: 'Other pets', emoji: '🐾' },
  { value: 'none', label: 'No pets', emoji: '🚫' },
  { value: 'want_pets', label: 'Want pets', emoji: '💭' },
  { value: 'allergic', label: 'Allergic to pets', emoji: '🤧' },
];

export const INSECT_OPTIONS = [
  { value: 'mosquito', label: 'Mosquito', emoji: '🦟' },
  { value: 'bee', label: 'Bee', emoji: '🐝' },
  { value: 'butterfly', label: 'Butterfly', emoji: '🦋' },
  { value: 'ant', label: 'Ant', emoji: '🐜' },
  { value: 'cockroach', label: 'Cockroach', emoji: '🪳' },
];

// Gender Options (required, min 1, max 2)
export const GENDER_OPTIONS = [
  { value: 'male', label: 'Man' },
  { value: 'female', label: 'Woman' },
  { value: 'non_binary', label: 'Non-binary' },
];

// Orientation Options (optional, single-select)
export const ORIENTATION_OPTIONS = [
  { value: 'straight', label: 'Straight' },
  { value: 'gay', label: 'Gay' },
  { value: 'lesbian', label: 'Lesbian' },
  { value: 'bisexual', label: 'Bisexual' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

// Sort Options
export const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'distance', label: 'Distance' },
  { value: 'age', label: 'Age' },
  { value: 'recently_active', label: 'Recently Active' },
  { value: 'newest', label: 'Newest' },
];

// Trial Duration
export const TRIAL_DURATION_DAYS = 7;

// Crossed Paths Config
export const CROSSED_PATHS = {
  MIN_CROSSINGS_FOR_UNLOCK: 10,
  UNLOCK_DURATION_HOURS: 48,
  PROXIMITY_METERS: 100,
};

// Message Templates
export const MESSAGE_TEMPLATES = [
  { id: 'coffee', text: "Hey {name}! I noticed you like coffee. Want to grab a cup sometime? ☕" },
  { id: 'travel', text: "Hi {name}! Your travel pics are amazing. What's your favorite destination? ✈️" },
  { id: 'music', text: "Hey {name}! I see you're into music. What are you listening to lately? 🎵" },
  { id: 'foodie', text: "Hi {name}! Fellow foodie here. Any restaurant recommendations? 🍕" },
  { id: 'fitness', text: "Hey {name}! Love your active lifestyle. What's your favorite workout? 💪" },
  { id: 'movies', text: "Hi {name}! Seen any good movies lately? I'm always looking for recommendations 🎬" },
  { id: 'hiking', text: "Hey {name}! Your outdoor pics are great. Know any good hiking trails? 🏕️" },
  { id: 'pets', text: "Hi {name}! Your pet is adorable! What's their name? 🐾" },
  { id: 'simple_hi', text: "Hey {name}! Your profile caught my attention. How's your day going? 😊" },
  { id: 'weekend', text: "Hi {name}! Got any exciting plans for the weekend? ✨" },
];

// Micro Survey Questions (shown periodically during swiping)
export const MICRO_SURVEY_QUESTIONS = [
  { id: 'app_experience', text: 'How are you finding Mira so far?', options: ['Love it', 'It\'s okay', 'Needs improvement'] },
  { id: 'match_quality', text: 'How relevant are the profiles you see?', options: ['Very relevant', 'Somewhat', 'Not really'] },
  { id: 'feature_request', text: 'What would you most like to see next?', options: ['Video profiles', 'Better filters', 'Group activities', 'Events'] },
  { id: 'usage_frequency', text: 'How often do you open Mira?', options: ['Daily', 'Few times a week', 'Weekly', 'Rarely'] },
];

// Profile Prompt Questions (LEGACY - kept for backward compatibility)
export const PROFILE_PROMPT_QUESTIONS = [
  { id: 'perfect_day', text: 'My perfect first date would be...' },
  { id: 'fun_fact', text: 'A fun fact about me...' },
  { id: 'dealbreaker', text: 'My biggest dealbreaker is...' },
  { id: 'superpower', text: 'If I had a superpower it would be...' },
  { id: 'love_language', text: 'My love language is...' },
  { id: 'bucket_list', text: 'Top of my bucket list...' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// NEW PROMPT SYSTEM (Phase-1 Onboarding - 2-Page Structure)
// ═══════════════════════════════════════════════════════════════════════════════

// Page 1: Seed Questions (3 required questions)
// ─────────────────────────────────────────────

// Q1: Identity Anchor - "Which one sounds most like you?"
export type IdentityAnchorValue = 'builder' | 'performer' | 'seeker' | 'grounded';
export const IDENTITY_ANCHOR_PROMPT = 'Which one sounds most like you?';
export const IDENTITY_ANCHOR_OPTIONS: { value: IdentityAnchorValue; label: string; subtitle: string }[] = [
  { value: 'builder', label: 'I like building things', subtitle: 'Projects, ideas, fixing stuff' },
  { value: 'performer', label: 'I enjoy performing or expressing myself', subtitle: 'Music, style, creativity' },
  { value: 'seeker', label: 'I love exploring new things', subtitle: 'Travel, learning, adventures' },
  { value: 'grounded', label: 'I enjoy a calm, simple life', subtitle: 'Comfort, food, relaxing' },
];

// Q2: Social Battery - slider from Relieved to Restless
// "Your plans got cancelled on Friday night. How do you feel?"
export type SocialBatteryValue = 1 | 2 | 3 | 4 | 5;
export const SOCIAL_BATTERY_PROMPT = 'Your plans got cancelled on Friday night. How do you feel?';
export const SOCIAL_BATTERY_LEFT_LABEL = 'Relieved';
export const SOCIAL_BATTERY_RIGHT_LABEL = 'Restless';

// Q3: Value Trigger - "On a first date, what tells you someone is a good person?"
export type ValueTriggerValue = 'thoughtful_questions' | 'kind_to_staff' | 'great_humor' | 'on_time';
export const VALUE_TRIGGER_PROMPT = 'On a first date, what tells you someone is a good person?';
export const VALUE_TRIGGER_OPTIONS: { value: ValueTriggerValue; label: string }[] = [
  { value: 'thoughtful_questions', label: 'They ask thoughtful questions' },
  { value: 'kind_to_staff', label: 'They are kind to staff' },
  { value: 'great_humor', label: 'They have great humor' },
  { value: 'on_time', label: 'They show up on time' },
];

// Seed Questions data structure
export interface SeedQuestions {
  identityAnchor: IdentityAnchorValue | null;
  socialBattery: SocialBatteryValue | null;
  valueTrigger: ValueTriggerValue | null;
}

// Page 2: Section Prompts (4 sections, min 1 answer per section)
// ─────────────────────────────────────────────────────────────

// Section 1: Builder/Alchemist
export const BUILDER_PROMPTS = [
  { id: 'builder_1', text: 'What is something broken in the world or your city that you wish you could fix?' },
  { id: 'builder_2', text: 'What is one thing you own that you are very protective of?' },
  { id: 'builder_3', text: "Would you rather build something used by many people or something that deeply changes one person's life?" },
  { id: 'builder_4', text: 'What is the last thing you stayed up late learning about because you were curious?' },
];

// Section 2: Performer/Artist
export const PERFORMER_PROMPTS = [
  { id: 'performer_1', text: 'If you had to perform something on stage, what would you choose?' },
  { id: 'performer_2', text: 'Is your room more of a creative mess or very neat and minimal?' },
  { id: 'performer_3', text: 'Do you create music or art to discover new feelings or to express feelings you already have?' },
  { id: 'performer_4', text: 'What famous movie, song, or artwork do you think is overrated?' },
];

// Section 3: Seeker/Explorer
export const SEEKER_PROMPTS = [
  { id: 'seeker_1', text: "Would you rather explore a new country where you don't know the language or visit your favorite city again in luxury?" },
  { id: 'seeker_2', text: 'What big question about life or the universe do you often think about?' },
  { id: 'seeker_3', text: 'What is the most unusual thing you brought back from a trip just because it had a good story?' },
  { id: 'seeker_4', text: 'When you travel, do you plan everything or just go with the flow?' },
];

// Section 4: Grounded/Zen
export const GROUNDED_PROMPTS = [
  { id: 'grounded_1', text: 'What daily routine do you never skip?' },
  { id: 'grounded_2', text: 'What food always makes you feel better on a bad day?' },
  { id: 'grounded_3', text: 'Do you prefer hanging out with a big group or spending time with one close friend?' },
  { id: 'grounded_4', text: 'How do you relax without using your phone or a screen?' },
];

// Combined section prompts for easy iteration
export const SECTION_PROMPTS = {
  builder: BUILDER_PROMPTS,
  performer: PERFORMER_PROMPTS,
  seeker: SEEKER_PROMPTS,
  grounded: GROUNDED_PROMPTS,
} as const;

export type PromptSectionKey = keyof typeof SECTION_PROMPTS;

export const SECTION_LABELS: Record<PromptSectionKey, { title: string; emoji: string; description: string }> = {
  builder: { title: 'Builder/Alchemist', emoji: '🔧', description: 'Creative & project-oriented' },
  performer: { title: 'Performer/Artist', emoji: '🎭', description: 'Expression & entertainment' },
  seeker: { title: 'Seeker/Explorer', emoji: '🧭', description: 'Adventure & discovery' },
  grounded: { title: 'Grounded/Zen', emoji: '🧘', description: 'Values & inner peace' },
};

// Section prompts data structure
export interface SectionPromptAnswer {
  question: string;
  answer: string;
}

export interface SectionPrompts {
  builder: SectionPromptAnswer[];
  performer: SectionPromptAnswer[];
  seeker: SectionPromptAnswer[];
  grounded: SectionPromptAnswer[];
}

// Combined prompts data structure for storage
export interface ProfilePromptsV2 {
  seedQuestions: SeedQuestions;
  sectionPrompts: SectionPrompts;
}

// Constants for validation
export const PROMPT_ANSWER_MIN_LENGTH = 20; // Minimum characters per prompt answer
export const PROMPT_ANSWER_MAX_LENGTH = 200;
export const MIN_ANSWERS_PER_SECTION = 1;

// Confession Topics Config
export const CONFESSION_TOPICS: Record<ConfessionTopic, { emoji: string; label: string; color: string; bg: string }> = {
  heartbreak: { emoji: '\uD83D\uDC94', label: 'Heartbreak', color: '#E91E63', bg: 'rgba(233,30,99,0.12)' },
  crush: { emoji: '\uD83D\uDE0D', label: 'Crush', color: '#FF4081', bg: 'rgba(255,64,129,0.12)' },
  funny: { emoji: '\uD83D\uDE02', label: 'Funny', color: '#FF9800', bg: 'rgba(255,152,0,0.12)' },
  late_night: { emoji: '\uD83C\uDF19', label: 'Late Night', color: '#7C4DFF', bg: 'rgba(124,77,255,0.12)' },
  college: { emoji: '\uD83C\uDF93', label: 'College', color: '#2196F3', bg: 'rgba(33,150,243,0.12)' },
  office: { emoji: '\uD83D\uDCBC', label: 'Office', color: '#607D8B', bg: 'rgba(96,125,139,0.12)' },
  spicy: { emoji: '\uD83D\uDD25', label: 'Spicy', color: '#FF5722', bg: 'rgba(255,87,34,0.12)' },
};


// Backward compat: map old mood to new topic
export const MOOD_TO_TOPIC: Record<ConfessionMood, ConfessionTopic> = {
  romantic: 'crush',
  spicy: 'spicy',
  emotional: 'heartbreak',
  funny: 'funny',
};

// ═══════════════════════════════════════════════════════════════════════════════
// LIFE RHYTHM (Phase-1 Onboarding - New Matching Signals)
// ═══════════════════════════════════════════════════════════════════════════════

// Social Rhythm - "What kind of social energy feels most natural to you?"
export type SocialRhythmValue = 'quiet_homebody' | 'small_group' | 'balanced_mix' | 'very_social' | 'party_nightlife';
export const SOCIAL_RHYTHM_PROMPT = 'What kind of social energy feels most natural to you?';
export const SOCIAL_RHYTHM_OPTIONS: { value: SocialRhythmValue; label: string }[] = [
  { value: 'quiet_homebody', label: 'Quiet homebody' },
  { value: 'small_group', label: 'Small group hangouts' },
  { value: 'balanced_mix', label: 'Balanced mix' },
  { value: 'very_social', label: 'Very social' },
  { value: 'party_nightlife', label: 'Party / nightlife energy' },
];

// Sleep Schedule - "What does your natural sleep schedule look like?"
export type SleepScheduleValue = 'early_bird' | 'slightly_early' | 'flexible' | 'night_owl' | 'very_late_night';
export const SLEEP_SCHEDULE_PROMPT = 'What does your natural sleep schedule look like?';
export const SLEEP_SCHEDULE_OPTIONS: { value: SleepScheduleValue; label: string }[] = [
  { value: 'early_bird', label: 'Early bird' },
  { value: 'slightly_early', label: 'Slightly early' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'night_owl', label: 'Night owl' },
  { value: 'very_late_night', label: 'Very late night person' },
];

// Travel Style - "How do you usually feel about travel?" (Optional)
export type TravelStyleValue = 'love_frequent' | 'few_trips_yearly' | 'occasional' | 'prefer_local' | 'special_reasons';
export const TRAVEL_STYLE_PROMPT = 'How do you usually feel about travel?';
export const TRAVEL_STYLE_OPTIONS: { value: TravelStyleValue; label: string }[] = [
  { value: 'love_frequent', label: 'Love frequent travel' },
  { value: 'few_trips_yearly', label: 'A few trips per year' },
  { value: 'occasional', label: 'Occasional trips' },
  { value: 'prefer_local', label: 'Prefer staying local' },
  { value: 'special_reasons', label: 'Only travel for special reasons' },
];

// Work Style - "Which work-life balance fits you right now?" (Optional)
export type WorkStyleValue = 'very_career' | 'ambitious_balanced' | 'balanced_lifestyle' | 'flexible_creative' | 'still_exploring';
export const WORK_STYLE_PROMPT = 'Which work-life balance fits you right now?';
export const WORK_STYLE_OPTIONS: { value: WorkStyleValue; label: string }[] = [
  { value: 'very_career', label: 'Very career focused' },
  { value: 'ambitious_balanced', label: 'Ambitious but balanced' },
  { value: 'balanced_lifestyle', label: 'Balanced lifestyle' },
  { value: 'flexible_creative', label: 'Flexible / creative work' },
  { value: 'still_exploring', label: 'Still exploring' },
];

// Core Values - "Which qualities matter most to you in people?" (Multi-select, 1-3)
export type CoreValueValue =
  | 'kindness' | 'humor' | 'loyalty' | 'intelligence' | 'ambition'
  | 'curiosity' | 'emotional_maturity' | 'honesty' | 'independence' | 'creativity'
  | 'stability' | 'adventure' | 'discipline' | 'generosity' | 'open_mindedness';
export const CORE_VALUES_PROMPT = 'Which qualities matter most to you in people?';
export const CORE_VALUES_OPTIONS: { value: CoreValueValue; label: string }[] = [
  { value: 'kindness', label: 'Kindness' },
  { value: 'humor', label: 'Humor' },
  { value: 'loyalty', label: 'Loyalty' },
  { value: 'intelligence', label: 'Intelligence' },
  { value: 'ambition', label: 'Ambition' },
  { value: 'curiosity', label: 'Curiosity' },
  { value: 'emotional_maturity', label: 'Emotional maturity' },
  { value: 'honesty', label: 'Honesty' },
  { value: 'independence', label: 'Independence' },
  { value: 'creativity', label: 'Creativity' },
  { value: 'stability', label: 'Stability' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'discipline', label: 'Discipline' },
  { value: 'generosity', label: 'Generosity' },
  { value: 'open_mindedness', label: 'Open-mindedness' },
];

// Life Rhythm data structure for storage
export interface LifeRhythm {
  city: string | null;
  socialRhythm: SocialRhythmValue | null;
  sleepSchedule: SleepScheduleValue | null;
  travelStyle: TravelStyleValue | null;
  workStyle: WorkStyleValue | null;
  coreValues: CoreValueValue[];
}

// ═══════════════════════════════════════════════════════════════════════════════

// Incognito Mode Colors
export const INCOGNITO_COLORS = {
  background: '#1A1A2E',
  surface: '#16213E',
  accent: '#0F3460',
  text: '#E0E0E0',
  textLight: '#9E9E9E',
  primary: '#E94560',
  border: '#2D3748',
};
