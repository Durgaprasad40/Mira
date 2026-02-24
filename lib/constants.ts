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
export const RELATIONSHIP_INTENTS: { value: RelationshipIntent; label: string; emoji: string }[] = [
  { value: 'long_term', label: 'Serious Vibes', emoji: '💑' },
  { value: 'short_term', label: "Keepin' It Casual", emoji: '🎉' },
  { value: 'figuring_out', label: 'Exploring Vibes', emoji: '🤔' },
  { value: 'short_to_long', label: 'See Where It Goes', emoji: '📈' },
  { value: 'long_to_short', label: 'Open to Vibes', emoji: '📉' },
  { value: 'new_friends', label: 'Just Friends', emoji: '👋' },
  { value: 'open_to_anything', label: 'Open to Anything', emoji: '✨' },
  { value: 'single_parent', label: 'Single Parent', emoji: '' },
  { value: 'just_18', label: 'Just 18', emoji: '' },
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
  { value: 'bachelors', label: "Bachelor's" },
  { value: 'masters', label: "Master's" },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'trade_school', label: 'Trade School' },
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

// Profile Prompt Questions
export const PROFILE_PROMPT_QUESTIONS = [
  { id: 'perfect_day', text: 'My perfect first date would be...' },
  { id: 'fun_fact', text: 'A fun fact about me...' },
  { id: 'dealbreaker', text: 'My biggest dealbreaker is...' },
  { id: 'superpower', text: 'If I had a superpower it would be...' },
  { id: 'love_language', text: 'My love language is...' },
  { id: 'bucket_list', text: 'Top of my bucket list...' },
];

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

// Incognito Mode Colors
export const INCOGNITO_COLORS = {
  background: '#1A1A2E',
  surface: '#16213E',
  accent: '#0F3460',
  text: '#E0E0E0',
  textLight: '#9E9E9E',
  primary: '#E94560',
};
