// User Types
export type Gender = 'male' | 'female' | 'non_binary' | 'other';

export type RelationshipIntent =
  | 'long_term'
  | 'short_term'
  | 'fwb'
  | 'figuring_out'
  | 'short_to_long'
  | 'long_to_short'
  | 'new_friends'
  | 'open_to_anything';

export type ActivityFilter =
  | 'coffee'
  | 'date_night'
  | 'sports'
  | 'movies'
  | 'free_tonight'
  | 'foodie'
  | 'gym_partner'
  | 'concerts'
  | 'travel'
  | 'outdoors'
  | 'art_culture'
  | 'gaming'
  | 'nightlife'
  | 'brunch'
  | 'study_date'
  | 'this_weekend'
  | 'beach_pool'
  | 'road_trip'
  | 'photography'
  | 'volunteering';

export type SubscriptionTier = 'free' | 'basic' | 'premium';

export type SmokingStatus = 'never' | 'sometimes' | 'regularly' | 'trying_to_quit';
export type DrinkingStatus = 'never' | 'socially' | 'regularly' | 'sober';
export type KidsStatus = 'have_and_want_more' | 'have_and_dont_want_more' | 'dont_have_and_want' | 'dont_have_and_dont_want' | 'not_sure';
export type EducationLevel = 'high_school' | 'some_college' | 'bachelors' | 'masters' | 'doctorate' | 'trade_school' | 'other';
export type Religion = 'christian' | 'muslim' | 'hindu' | 'buddhist' | 'jewish' | 'sikh' | 'atheist' | 'agnostic' | 'spiritual' | 'other' | 'prefer_not_to_say';

export type SortOption = 'recommended' | 'distance' | 'age' | 'recently_active' | 'newest';

export type SwipeAction = 'like' | 'pass' | 'super_like';

export type MessageType = 'text' | 'image' | 'template' | 'dare';

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
  type: 'match' | 'message' | 'super_like' | 'crossed_paths' | 'subscription' | 'weekly_refresh';
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
  type: 'boost' | 'super_likes' | 'messages';
  quantity: number;
  price: number;
  duration?: number; // hours for boost
}

// Feature access based on user type
export type VisibilityMode = 'full' | 'partial' | 'limited';

export interface FeatureAccess {
  swipesPerDay: number | 'unlimited';
  superLikesPerWeek: number | 'unlimited';
  messagesPerWeek: number | 'unlimited';
  boostsPerMonth: number | 'unlimited';
  canRewind: boolean;
  canSeeWhoLikedYou: boolean;
  incognitoAccess: VisibilityMode;
  customMessageLength: number | 'unlimited';
  templateCount: number;
}

// Onboarding Step
export type OnboardingStep =
  | 'welcome'
  | 'email_phone'
  | 'otp'
  | 'password'
  | 'basic_info'
  | 'photo_upload'
  | 'face_verification'
  | 'additional_photos'
  | 'bio'
  | 'profile_details'
  | 'preferences'
  | 'permissions'
  | 'review'
  | 'tutorial';

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
  minAge: number;
  maxAge: number;
  maxDistance: number;
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
  sortBy: SortOption;
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
