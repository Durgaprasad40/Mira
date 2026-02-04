/**
 * demoHelpers — Pure helper functions for generating demo data.
 *
 * No store dependency: callers pass the result into demoStore actions.
 */
import { DemoProfile, DemoMatch, DemoLike } from '@/stores/demoStore';
import { DEMO_PROFILES } from '@/lib/demoData';

// ---------------------------------------------------------------------------
// Name / data pools (Indian names to match the app's theme)
// ---------------------------------------------------------------------------

const FEMALE_NAMES = [
  'Aadhya', 'Anvi', 'Bhavya', 'Charvi', 'Divya',
  'Esha', 'Fatima', 'Gauri', 'Hina', 'Ishita',
  'Jhanvi', 'Kiara', 'Lavanya', 'Manya', 'Navya',
  'Oviya', 'Pari', 'Radhika', 'Sanya', 'Tanvi',
  'Urvi', 'Vanya', 'Wafa', 'Yashika', 'Zoya',
];

const CITIES = ['Mumbai', 'Bangalore', 'Pune', 'Delhi', 'Hyderabad', 'Chennai', 'Kolkata', 'Jaipur'];

const BIOS = [
  'Coffee first, questions later. Looking for someone who gets that.',
  'Swipe right if you can beat me at board games.',
  'Part-time adventurer, full-time foodie.',
  'Looking for deep conversations and spontaneous road trips.',
  'Dog mom who believes laughter is the best therapy.',
  'Plant lady looking for her sunshine.',
  'Bookworm who also lifts. Brains and biceps.',
  'Chai over coffee, always. Come fight me.',
];

const RELATIONSHIP_INTENTS = [
  ['long_term'],
  ['figuring_out'],
  ['new_friends'],
  ['short_to_long'],
  ['open_to_anything'],
];

const ACTIVITIES_POOL = [
  'coffee', 'travel', 'foodie', 'gym_partner', 'movies',
  'concerts', 'photography', 'art_culture', 'nightlife', 'outdoors',
  'brunch', 'beach_pool', 'road_trip', 'gaming',
];

// Grab photo URLs from the existing demo profiles so images always resolve
const PHOTO_POOL: string[] = (DEMO_PROFILES as any[]).flatMap(
  (p) => (p.photos || []).map((ph: any) => ph.url),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

let _seq = 0;
function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}_${Date.now()}_${_seq}`;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

export function generateRandomProfile(): DemoProfile {
  const name = pick(FEMALE_NAMES);
  const age = 20 + Math.floor(Math.random() * 10); // 20-29
  const city = pick(CITIES);
  const photos = pickN(PHOTO_POOL, 2 + Math.floor(Math.random() * 3)).map((url) => ({ url }));

  return {
    _id: uid('demo_gen'),
    name,
    age,
    gender: 'female',
    bio: pick(BIOS),
    isVerified: Math.random() > 0.3,
    city,
    distance: +(Math.random() * 25 + 0.5).toFixed(1),
    latitude: 19.076 + (Math.random() - 0.5) * 0.1,
    longitude: 72.8777 + (Math.random() - 0.5) * 0.1,
    relationshipIntent: pick(RELATIONSHIP_INTENTS),
    activities: pickN(ACTIVITIES_POOL, 3),
    photos,
  };
}

export function generateMatch(profile: DemoProfile): DemoMatch {
  return {
    id: uid('match_gen'),
    conversationId: `demo_convo_${profile._id}`,
    otherUser: {
      id: profile._id,
      name: profile.name,
      photoUrl: profile.photos[0]?.url ?? '',
      lastActive: Date.now() - Math.floor(Math.random() * 3600000),
      isVerified: profile.isVerified,
    },
    lastMessage: null,
    unreadCount: 0,
    isPreMatch: false,
  };
}

export function generateLike(profile: DemoProfile): DemoLike {
  return {
    likeId: uid('like_gen'),
    userId: profile._id,
    action: 'like',
    message: null,
    createdAt: Date.now() - Math.floor(Math.random() * 7200000),
    name: profile.name,
    age: profile.age,
    photoUrl: profile.photos[0]?.url ?? '',
    isBlurred: Math.random() > 0.6,
  };
}

export function generateSuperLike(profile: DemoProfile): DemoLike {
  const messages = [
    'Love your travel photos!',
    'Your bio made me laugh!',
    'We have so much in common!',
    'Your smile is contagious!',
  ];
  return {
    likeId: uid('slike_gen'),
    userId: profile._id,
    action: 'super_like',
    message: pick(messages),
    createdAt: Date.now() - Math.floor(Math.random() * 7200000),
    name: profile.name,
    age: profile.age,
    photoUrl: profile.photos[0]?.url ?? '',
    isBlurred: false,
  };
}
