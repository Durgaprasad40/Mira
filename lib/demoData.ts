// Demo data for testing the app without Convex backend

export const DEMO_USER = {
  _id: 'demo_user_1',
  name: 'You',
  email: 'demo@mira.app',
  gender: 'male',
  dateOfBirth: '1995-01-15',
  bio: 'This is demo mode! Set up Convex to use real data.',
  isVerified: true,
  city: 'Mumbai',
  subscriptionTier: 'premium',
  lookingFor: ['female'],
  relationshipIntent: ['long_term'],
  activities: ['coffee', 'movies'],
  minAge: 18,
  maxAge: 35,
  maxDistance: 50,
  likesRemaining: 50,
  superLikesRemaining: 5,
  messagesRemaining: 10,
  photos: [
    { url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400' }
  ],
};

export const DEMO_PROFILES = [
  {
    _id: 'demo_profile_1',
    name: 'Priya',
    age: 25,
    gender: 'female',
    bio: 'Love traveling and trying new cuisines! Looking for someone to explore the city with.',
    isVerified: true,
    city: 'Mumbai',
    distance: 5,
    relationshipIntent: ['long_term'],
    activities: ['coffee', 'travel', 'foodie'],
    photos: [
      { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400' },
      { url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400' },
    ],
  },
  {
    _id: 'demo_profile_2',
    name: 'Ananya',
    age: 23,
    gender: 'female',
    bio: 'Software engineer by day, dancer by night. Let\'s grab coffee!',
    isVerified: true,
    city: 'Bangalore',
    distance: 12,
    relationshipIntent: ['figuring_out'],
    activities: ['coffee', 'concerts', 'gym_partner'],
    photos: [
      { url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400' },
    ],
  },
  {
    _id: 'demo_profile_3',
    name: 'Meera',
    age: 27,
    gender: 'female',
    bio: 'Book lover, coffee addict, and amateur photographer. Looking for meaningful connections.',
    isVerified: false,
    city: 'Delhi',
    distance: 8,
    relationshipIntent: ['long_term', 'short_to_long'],
    activities: ['coffee', 'art_culture', 'photography'],
    photos: [
      { url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400' },
      { url: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400' },
    ],
  },
  {
    _id: 'demo_profile_4',
    name: 'Aisha',
    age: 24,
    gender: 'female',
    bio: 'Fitness enthusiast and food blogger. Swipe right if you love dogs!',
    isVerified: true,
    city: 'Mumbai',
    distance: 3,
    relationshipIntent: ['new_friends', 'open_to_anything'],
    activities: ['gym_partner', 'foodie', 'outdoors'],
    photos: [
      { url: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400' },
    ],
  },
  {
    _id: 'demo_profile_5',
    name: 'Kavya',
    age: 26,
    gender: 'female',
    bio: 'Marketing professional who loves weekend getaways. Looking for my travel partner!',
    isVerified: true,
    city: 'Pune',
    distance: 15,
    relationshipIntent: ['long_term'],
    activities: ['travel', 'road_trip', 'beach_pool'],
    photos: [
      { url: 'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400' },
      { url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400' },
    ],
  },
];

export const DEMO_MATCHES = [
  {
    id: 'match_1',
    otherUser: {
      id: 'demo_profile_1',
      name: 'Priya',
      photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',
      lastActive: Date.now() - 1000 * 60 * 5,
      isVerified: true,
    },
    lastMessage: {
      content: 'Hey! How are you?',
      type: 'text',
      senderId: 'demo_profile_1',
      createdAt: Date.now() - 1000 * 60 * 30,
    },
    unreadCount: 1,
    isPreMatch: false,
  },
  {
    id: 'match_2',
    otherUser: {
      id: 'demo_profile_3',
      name: 'Meera',
      photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
      lastActive: Date.now() - 1000 * 60 * 60,
      isVerified: false,
    },
    lastMessage: null,
    unreadCount: 0,
    isPreMatch: false,
  },
];

export const DEMO_LIKES = [
  {
    likeId: 'like_1',
    userId: 'demo_profile_4',
    action: 'like',
    message: null,
    createdAt: Date.now() - 1000 * 60 * 60 * 2,
    name: 'Aisha',
    age: 24,
    photoUrl: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400',
    isBlurred: false,
  },
  {
    likeId: 'like_2',
    userId: 'demo_profile_5',
    action: 'super_like',
    message: 'Love your travel photos!',
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
    name: 'Kavya',
    age: 26,
    photoUrl: 'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400',
    isBlurred: false,
  },
];

export const isDemoMode = () => {
  return process.env.EXPO_PUBLIC_DEMO_MODE === 'true' ||
    process.env.EXPO_PUBLIC_CONVEX_URL?.includes('placeholder');
};
