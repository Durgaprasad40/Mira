// Security & Verification Types
export type VerificationStatus = 'unverified' | 'pending_verification' | 'verified';
export type EnforcementLevel = 'none' | 'gentle_reminder' | 'reduced_reach' | 'security_only';
export type BehaviorFlagType =
  | 'rapid_swiping'
  | 'mass_messaging'
  | 'rapid_account_creation'
  | 'reported_by_multiple'
  | 'nsfw_photo_uploaded'
  | 'suspicious_profile'
  | 'manual_flag';
export type BehaviorFlagSeverity = 'low' | 'medium' | 'high';

// User Types
export type Gender = "male" | "female" | "non_binary";

export type Orientation = "straight" | "gay" | "lesbian" | "bisexual" | "prefer_not_to_say";

export type RelationshipIntent =
  | "long_term"
  | "short_term"
  | "fwb"
  | "figuring_out"
  | "short_to_long"
  | "long_to_short"
  | "new_friends"
  | "open_to_anything"
  | "single_parent"
  | "just_18";

export type ActivityFilter =
  // Original 20 (backward compatible)
  | "coffee"
  | "date_night"
  | "sports"
  | "movies"
  | "free_tonight"
  | "foodie"
  | "gym_partner"
  | "concerts"
  | "travel"
  | "outdoors"
  | "art_culture"
  | "gaming"
  | "nightlife"
  | "brunch"
  | "study_date"
  | "this_weekend"
  | "beach_pool"
  | "road_trip"
  | "photography"
  | "volunteering"
  // New interests (100 additional)
  | "tea_lover"
  | "cafe_hopping"
  | "late_night_talks"
  | "morning_walks"
  | "street_food"
  | "home_cooking"
  | "baking"
  | "dessert_lover"
  | "trying_new_restaurants"
  | "healthy_eating"
  | "vegan_life"
  | "food_photography"
  | "solo_travel"
  | "weekend_getaways"
  | "long_drives"
  | "city_exploring"
  | "backpacking"
  | "beach_vibes"
  | "mountain_views"
  | "cultural_travel"
  | "nature_walks"
  | "sunset_views"
  | "hiking"
  | "camping"
  | "stargazing"
  | "gardening"
  | "beach_walks"
  | "gym"
  | "home_workouts"
  | "yoga"
  | "running"
  | "cycling"
  | "meditation"
  | "pilates"
  | "fitness_challenges"
  | "wellness_lifestyle"
  | "music_lover"
  | "live_concerts"
  | "singing"
  | "playing_guitar"
  | "playing_piano"
  | "indie_music"
  | "bollywood_music"
  | "hip_hop"
  | "podcasts"
  | "audiobooks"
  | "binge_watching"
  | "web_series"
  | "rom_coms"
  | "thrillers"
  | "documentaries"
  | "anime"
  | "k_dramas"
  | "film_photography"
  | "mobile_games"
  | "console_gaming"
  | "board_games"
  | "card_games"
  | "puzzle_games"
  | "chess"
  | "trivia_nights"
  | "escape_rooms"
  | "arcade_games"
  | "drawing"
  | "painting"
  | "digital_art"
  | "writing"
  | "journaling"
  | "video_editing"
  | "diy_projects"
  | "crafting"
  | "reading"
  | "personal_growth"
  | "psychology"
  | "philosophy"
  | "self_improvement"
  | "learning_new_skills"
  | "online_courses"
  | "public_speaking"
  | "mindfulness"
  | "productivity"
  | "tech_enthusiast"
  | "startups"
  | "ai_future_tech"
  | "coding"
  | "app_exploring"
  | "gadget_reviews"
  | "digital_minimalism"
  | "remote_work"
  | "side_hustles"
  | "financial_planning"
  | "community_service"
  | "environmental_care"
  | "sustainability"
  | "plant_parenting"
  | "kindness_culture";

export type SubscriptionTier = "free" | "basic" | "premium";

export type SmokingStatus =
  | "never"
  | "sometimes"
  | "regularly"
  | "trying_to_quit";
export type DrinkingStatus = "never" | "socially" | "regularly" | "sober";
export type KidsStatus =
  | "have_and_want_more"
  | "have_and_dont_want_more"
  | "dont_have_and_want"
  | "dont_have_and_dont_want"
  | "not_sure";
export type EducationLevel =
  | "high_school"
  | "some_college"
  | "bachelors"
  | "masters"
  | "doctorate"
  | "trade_school"
  | "other";
export type Religion =
  | "christian"
  | "muslim"
  | "hindu"
  | "buddhist"
  | "jewish"
  | "sikh"
  | "atheist"
  | "agnostic"
  | "spiritual"
  | "other"
  | "prefer_not_to_say";
export type ExerciseStatus = "never" | "sometimes" | "regularly" | "daily";
export type PetType =
  | "dog"
  | "cat"
  | "bird"
  | "fish"
  | "rabbit"
  | "hamster"
  | "guinea_pig"
  | "turtle"
  | "parrot"
  | "pigeon"
  | "chicken"
  | "duck"
  | "goat"
  | "cow"
  | "horse"
  | "snake"
  | "lizard"
  | "frog"
  | "other"
  | "none"
  | "want_pets"
  | "allergic";

export type InsectType =
  | "mosquito"
  | "bee"
  | "butterfly"
  | "ant"
  | "cockroach";

export type SortOption =
  | "recommended"
  | "distance"
  | "age"
  | "recently_active"
  | "newest";

export type SwipeAction = "like" | "pass" | "super_like" | "text";

export type MessageType = "text" | "image" | "template" | "dare" | "voice";

// User Profile
export interface UserProfile {
  id: string;
  email?: string;
  phone?: string;
  name: string;
  dateOfBirth: string;
  gender: Gender;
  bio: string;
  height?: number; // in cm
  smoking?: SmokingStatus;
  drinking?: DrinkingStatus;
  kids?: KidsStatus;
  education?: EducationLevel;
  religion?: Religion;
  jobTitle?: string;
  company?: string;
  school?: string;
  isVerified: boolean;
  verificationStatus?: VerificationStatus;
  verificationPhotoUrl?: string;
  lastActive: number;
  createdAt: number;

  // Location
  latitude?: number;
  longitude?: number;
  city?: string;

  // Preferences
  lookingFor: Gender[];
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
  minAge: number;
  maxAge: number;
  maxDistance: number; // in miles

  // Subscription
  subscriptionTier: SubscriptionTier;
  subscriptionExpiresAt?: number;
  trialEndsAt?: number;

  // Incognito
  incognitoMode: boolean;

  // Stats
  likesRemaining: number;
  superLikesRemaining: number;
  messagesRemaining: number;
  rewindsRemaining: number;
  boostsRemaining: number;

  // Reset timestamps
  likesResetAt: number;
  superLikesResetAt: number;
  messagesResetAt: number;
}

// Photo
export interface Photo {
  id: string;
  userId: string;
  url: string;
  order: number;
  isPrimary: boolean;
  hasFace: boolean;
  isNsfw: boolean;
  createdAt: number;
}

// Match
export interface Match {
  id: string;
  user1Id: string;
  user2Id: string;
  matchedAt: number;
  user1UnmatchedAt?: number;
  user2UnmatchedAt?: number;
  crossedPathsCount?: number;
}

// Like
export interface Like {
  id: string;
  fromUserId: string;
  toUserId: string;
  action: SwipeAction;
  message?: string;
  createdAt: number;
}

// Message
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string;
  imageUrl?: string;
  templateId?: string;
  readAt?: number;
  createdAt: number;
  // Voice message fields
  audioUri?: string;
  durationMs?: number;
}

// Conversation
export interface Conversation {
  id: string;
  matchId?: string;
  participants: string[];
  lastMessageAt?: number;
  isPreMatch: boolean;
  createdAt: number;
}

// Notification
export interface Notification {
  id: string;
  userId: string;
  type:
    | "match"
    | "message"
    | "super_like"
    | "crossed_paths"
    | "subscription"
    | "weekly_refresh";
  title: string;
  body: string;
  data?: Record<string, string>;
  readAt?: number;
  createdAt: number;
}

// Crossed Path
export interface CrossedPath {
  id: string;
  user1Id: string;
  user2Id: string;
  count: number;
  lastCrossedAt: number;
  location?: string;
  unlockExpiresAt?: number; // When the free messaging expires
}

// Dare (Truth or Dare feature)
export interface Dare {
  id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  isAccepted?: boolean;
  respondedAt?: number;
  createdAt: number;
}

// Subscription Pricing
export interface SubscriptionPlan {
  id: string;
  tier: SubscriptionTier;
  duration: 1 | 3 | 12; // months
  price: number; // in INR
  pricePerMonth: number;
}

// In-app Purchase
export interface IAPProduct {
  id: string;
  type: "boost" | "super_likes" | "messages";
  quantity: number;
  price: number;
  duration?: number; // hours for boost
}

// Feature access based on user type
export type VisibilityMode = "full" | "partial" | "limited";

export interface FeatureAccess {
  swipesPerDay: number | "unlimited";
  superLikesPerWeek: number | "unlimited";
  messagesPerWeek: number | "unlimited";
  boostsPerMonth: number | "unlimited";
  canRewind: boolean;
  canSeeWhoLikedYou: boolean;
  incognitoAccess: VisibilityMode;
  customMessageLength: number | "unlimited";
  templateCount: number;
}

// Incognito Types
export type DesireCategory =
  | "romantic"
  | "adventurous"
  | "intellectual"
  | "social"
  | "creative"
  | "spiritual";

export type TodResponseType = "text" | "video" | "audio" | "picture";

export type TodResponseStatus = "pending" | "correct" | "declined";

export type ConnectionSource = "tod" | "room" | "desire" | "friend";

export type BodyStructure = "slim" | "athletic" | "average" | "curvy" | "muscular" | "plus_size";

export interface IncognitoProfile {
  id: string;
  username: string;
  age: number;
  gender: Gender;
  /** @deprecated Use photos[] instead for multi-photo support */
  photoUrl: string;
  /** Multiple profile photos for Phase-2 carousel (blurred in UI) */
  photos?: string[];
  desires: string[];
  desireCategories: DesireCategory[];
  distance: number;
  city: string;
  bio: string;
  isOnline: boolean;
  /** @deprecated Use privateIntentKeys[] instead for multi-select (1-5) */
  privateIntentKey?: PrivateIntentKey;
  /** Phase-2 intent keys - multi-select (1-5 items) */
  privateIntentKeys?: PrivateIntentKey[];
  interests: string[];
  hobbies: string[];
  faceUnblurred: boolean;
  height?: number;
  weight?: number;
  bodyStructure?: BodyStructure;
  ethnicity?: string;
  hairColor?: string;
  eyeColor?: string;
  tattoos?: boolean;
  piercings?: boolean;
  smoking?: SmokingStatus;
  drinking?: DrinkingStatus;
}

export interface TruthOrDarePost {
  id: string;
  authorId: string;
  authorName: string;
  authorAge: number;
  authorPhotoUrl: string;
  type: "truth" | "dare";
  content: string;
  responseCount: number;
  createdAt: number;
  isAnonymous: boolean;
}

export interface TodResponse {
  id: string;
  postId: string;
  responderId: string;
  responderName: string;
  responderPhotoUrl: string;
  responseType: TodResponseType;
  content: string;
  mediaUrl?: string;
  status: TodResponseStatus;
  createdAt: number;
}

export type TodUserState = "answered" | "skipped" | "could_not_answer";

// Truth & Dare Trending System Types
export type TodAnswerType = "text" | "photo" | "video" | "voice";
export type TodConnectStatus = "pending" | "connected" | "removed";

export type TodMediaVisibility = "owner_only" | "public";
export type TodProfileVisibility = "blurred" | "clear";

export interface TodPrompt {
  id: string;
  type: "truth" | "dare";
  text: string;
  isTrending: boolean;
  ownerUserId: string;
  ownerName?: string;
  ownerPhotoUrl?: string;
  ownerAge?: number;
  ownerGender?: string;
  answerCount: number;
  activeCount: number;
  createdAt: number;
  expiresAt?: number;
}

export interface TodAnswer {
  id: string;
  promptId: string;
  userId: string;
  userName?: string;
  userPhotoUrl?: string;
  userGender?: string;
  type: TodAnswerType;
  text?: string;
  mediaUrl?: string;
  durationSec?: number;
  likeCount: number;
  createdAt: number;
  isLikedByMe?: boolean;
  visibility?: TodMediaVisibility;
  isDemo?: boolean;
  isAnonymous?: boolean;
  profileVisibility?: TodProfileVisibility;
}

export interface TodConnectRequest {
  id: string;
  promptId: string;
  answerId: string;
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  status: TodConnectStatus;
  createdAt: number;
}

export type ProfileViewState = "viewed" | "could_not_open";

export interface IncognitoChatRoom {
  id: string;
  name: string;
  language: string;
  memberCount: number;
  onlineCount: number;
  latestMessage?: string;
  icon: string;
  color: string;
}

export interface IncognitoConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAge: number;
  participantPhotoUrl: string;
  lastMessage: string;
  lastMessageAt: number;
  unreadCount: number;
  connectionSource: ConnectionSource;
  /** Match origin for Desire Land matches: 'super_like' shows blue ring in New Matches row */
  matchSource?: 'super_like' | 'normal';
}

export interface IncognitoMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: number;
  isRead: boolean;
  // Protected media fields (secure photos for Phase-2)
  isProtected?: boolean;
  protectedMedia?: {
    localUri: string;
    mediaType?: 'photo' | 'video'; // For secure video support
    timer: number;
    expiresDurationMs?: number; // Total expiry duration in ms (for continuous playback resume)
    viewingMode: 'tap' | 'hold';
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
  };
  viewedAt?: number;
  timerEndsAt?: number;
  isExpired?: boolean;
  /** Timestamp when message expired (for auto-delete countdown) */
  expiredAt?: number;
  /** Timestamp when message should be auto-deleted */
  deleteAt?: number;
  // Voice message fields
  type?: 'text' | 'voice';
  audioUri?: string;
  durationMs?: number;
}

// Private Mode Types (Face 2 only — 20 categories)
export type PrivateIntentKey =
  | 'fling'
  | 'non_committal'
  | 'short_term'
  | 'situationship'
  | 'no_labels'
  | 'go_with_the_flow'
  | 'weekend_thing'
  | 'chemistry_first'
  | 'connection_first'
  | 'private_thing'
  | 'friends_plus'
  | 'fwb'
  | 'trusted_connection'
  | 'intimate'
  | 'open_minded'
  | 'late_night'
  | 'casual_vibes'
  | 'undefined'
  | 'mutual_interest'
  | 'off_record';

export type PrivateDesireTag =
  | 'spontaneous'
  | 'deep_conversations'
  | 'physical_chemistry'
  | 'emotional_connection'
  | 'no_strings'
  | 'travel_partner'
  | 'late_night_talks'
  | 'adventure_seeker'
  | 'romantic_gestures'
  | 'humor_wit'
  | 'intellectual_match'
  | 'creative_energy'
  | 'fitness_partner'
  | 'open_minded'
  | 'slow_burn'
  | 'confident_energy'
  | 'mystery'
  | 'eye_contact'
  | 'respectful_flirting'
  | 'mutual_attraction';

export type PrivateBoundary =
  | 'respect_consent'
  | 'no_pressure'
  | 'safe_space'
  | 'clear_communication'
  | 'no_unsolicited_content'
  | 'mutual_respect'
  | 'right_to_withdraw'
  | 'privacy_protected'
  | 'no_sharing_screenshots'
  | 'meet_when_ready';

export type RevealRequestStatus = 'none' | 'pending_sent' | 'pending_received' | 'mutual_accepted' | 'declined';

export interface PrivateProfileData {
  userId: string;
  isPrivateEnabled: boolean;
  ageConfirmed18Plus: boolean;
  ageConfirmedAt?: number;
  privatePhotosBlurred: string[];
  privatePhotoUrls: string[];
  privateIntentKeys: PrivateIntentKey[];
  privateDesireTagKeys: PrivateDesireTag[];
  privateBoundaries: PrivateBoundary[];
  privateBio?: string;
  displayName: string;
  age: number;
  city?: string;
  gender: string;
  revealPolicy: 'mutual_only' | 'request_based';
  isSetupComplete: boolean;
  // Phase-1 imported fields (read-only after import)
  hobbies?: string[];
  isVerified?: boolean;
}

export interface RevealRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'declined';
  respondedAt?: number;
  createdAt: number;
}

// Confession Types
export type ConfessionMood = 'romantic' | 'spicy' | 'emotional' | 'funny';
export type ConfessionTopic = 'heartbreak' | 'crush' | 'funny' | 'late_night' | 'college' | 'office' | 'spicy';
export type ConfessionReactionType = string; // free emoji — any emoji string
export type ConfessionVisibility = 'global';
export type ConfessionSortBy = 'trending' | 'latest';
export type ConfessionReplyType = 'text' | 'voice';

export type ConfessionRevealPolicy = 'never' | 'allow_later';
export type TimedRevealOption = 'never' | '24h' | '48h';

export interface Confession {
  id: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  mood: ConfessionMood;
  topic?: ConfessionTopic;
  reactions?: Record<string, number>;
  topEmojis?: { emoji: string; count: number }[];
  replyPreviews?: { text: string; isAnonymous: boolean; type: string; createdAt: number }[];
  targetUserId?: string;
  targetUserName?: string; // Name of tagged user (for display)
  visibility: ConfessionVisibility;
  replyCount: number;
  reactionCount: number;
  voiceReplyCount?: number;
  authorName?: string;
  authorPhotoUrl?: string;
  createdAt: number;
  revealPolicy: ConfessionRevealPolicy;
  timedReveal?: TimedRevealOption;
  timedRevealAt?: number | null;
  timedRevealCancelled?: boolean;
  trendingScore?: number;
}

export interface ConfessionReply {
  id: string;
  confessionId: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  type?: ConfessionReplyType;
  voiceUrl?: string;
  voiceDurationSec?: number;
  createdAt: number;
}

export interface ConfessionReaction {
  id: string;
  confessionId: string;
  userId: string;
  type: string; // emoji string
  createdAt: number;
}

export type MutualRevealStatus = 'none' | 'initiator_agreed' | 'responder_agreed' | 'both_agreed' | 'declined';

export interface ConfessionChat {
  id: string;
  confessionId: string;
  initiatorId: string;
  responderId: string;
  messages: ConfessionChatMessage[];
  isRevealed: boolean;
  createdAt: number;
  expiresAt: number;
  /** Mutual reveal: tracks which sides have agreed */
  mutualRevealStatus: MutualRevealStatus;
  /** Who declined (if any) — reveal is then permanently blocked */
  declinedBy?: string;
}

export interface ConfessionChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: number;
}

export interface SecretCrush {
  id: string;
  fromUserId: string;
  toUserId: string;
  confessionText: string;
  isRevealed: boolean;
  createdAt: number;
  expiresAt: number;
}

// Discover Notification Types
export type DiscoverNotificationType = 'crossed_paths' | 'new_matches' | 'message_reply' | 'interest_match' | 'weekly_refresh';

export interface DiscoverNotification {
  id: string;
  type: DiscoverNotificationType;
  message: string;
  navigateTo?: string;
  createdAt: number;
  seen?: boolean;
}

// Discovery Feed Types
export type FeedItemType = 'crossed_paths' | 'activity_highlight' | 'nearby_interest' | 'unread_messages';

export interface DiscoveryFeedItem {
  id: string;
  type: FeedItemType;
  icon: string;
  message: string;
  navigateTo?: string;
}

// AI Coaching Types
export type CoachingSuggestionType = 'icebreaker' | 'rephrase' | 'follow_up';

export interface CoachingSuggestion {
  id: string;
  type: CoachingSuggestionType;
  text: string;
  label: string;
}

export interface CoachingContext {
  recipientName: string;
  recipientActivities?: string[];
  recipientPrompts?: { question: string; answer: string }[];
  sharedActivities?: string[];
  messageCount: number;
  lastMessageFromMe: boolean;
  lastMessageText?: string;
  currentDraftText?: string;
}

// Onboarding Step
export type OnboardingStep =
  | "welcome"
  | "email_phone"
  | "otp"
  | "password"
  | "basic_info"
  | "consent"
  | "photo_upload"
  | "face_verification"
  | "display_privacy"  // Privacy options after verification
  | "additional_photos"
  | "bio"
  | "prompts"
  | "profile_details"
  | "preferences"
  | "permissions"
  | "review"
  | "tutorial";

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Swipe Card Props
export interface SwipeCardProps {
  user: UserProfile;
  photos: Photo[];
  distance?: number;
  onSwipe: (action: SwipeAction, message?: string) => void;
}

// Filter State
export interface FilterState {
  gender: Gender[];
  orientation: Orientation | null;
  minAge: number;
  maxAge: number;
  maxDistance: number;
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
  sortBy: SortOption;
  /** Phase-2 (Face-2) intents — multi-select (1-5), empty means no preference */
  privateIntentKeys: string[];
}

// Auth State
export interface AuthState {
  isAuthenticated: boolean;
  userId?: string;
  token?: string;
  isLoading: boolean;
  error?: string;
}

// Profile (alias for swipe cards)
export interface Profile {
  _id: string;
  user: UserProfile;
  photos: Photo[];
  distance?: number;
}

// Onboarding State
export interface OnboardingState {
  currentStep: OnboardingStep;
  email?: string;
  phone?: string;
  name?: string;
  dateOfBirth?: string;
  gender?: Gender;
  photos: string[];
  bio?: string;
  height?: number;
  smoking?: SmokingStatus;
  drinking?: DrinkingStatus;
  kids?: KidsStatus;
  education?: EducationLevel;
  religion?: Religion;
  lookingFor: Gender[];
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
  minAge: number;
  maxAge: number;
  maxDistance: number;
}
