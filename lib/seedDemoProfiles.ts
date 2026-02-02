/**
 * Auto-generates 300 demo profiles so the swipe deck never runs out.
 * Each profile has: id, name, age, city, bio, photos, tags, etc.
 * Uses deterministic data (seeded by index) so profiles are stable across renders.
 */

import type { RelationshipIntent, ActivityFilter } from '@/types';

// ---------------------------------------------------------------------------
// Data pools — picked from to build realistic profiles
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Aanya', 'Aditi', 'Aisha', 'Akshara', 'Amara', 'Ananya', 'Anjali', 'Anvi',
  'Arya', 'Avni', 'Bhavna', 'Chaitra', 'Devi', 'Disha', 'Divya', 'Esha',
  'Fatima', 'Gauri', 'Hana', 'Hema', 'Ira', 'Ishani', 'Jaya', 'Juhi',
  'Kavya', 'Kira', 'Kriti', 'Lata', 'Lavanya', 'Leela', 'Mahi', 'Mansi',
  'Maya', 'Meera', 'Minal', 'Myra', 'Naina', 'Nandini', 'Neha', 'Nidhi',
  'Nisha', 'Pallavi', 'Pooja', 'Priya', 'Radhika', 'Rani', 'Rhea', 'Riya',
  'Saanvi', 'Sakshi', 'Sanya', 'Sara', 'Shreya', 'Simran', 'Sneha', 'Sonia',
  'Suhana', 'Swati', 'Tanvi', 'Tara', 'Uma', 'Vaani', 'Vani', 'Vidya',
  'Yasmin', 'Zara', 'Aadhira', 'Kiara', 'Pari', 'Trisha',
];

const CITIES = [
  'Mumbai', 'Mumbai', 'Mumbai', 'Pune', 'Bangalore', 'Delhi', 'Hyderabad',
  'Chennai', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Goa', 'Chandigarh', 'Lucknow',
];

const BIOS = [
  'Coffee addict and bookworm. Let\'s talk about your favorite read.',
  'Weekend hiker who also loves cozy movie nights at home.',
  'Foodie on a mission to try every street food stall in the city.',
  'Yoga in the mornings, live music in the evenings.',
  'Dog mom looking for someone who loves belly rubs (for the dog).',
  'Part-time artist, full-time daydreamer.',
  'Travel is my therapy. Currently planning trip #12.',
  'Can make a perfect chai. That\'s my whole personality.',
  'Startup life by day, Netflix by night.',
  'Gym > everything. But I\'ll skip leg day for brunch.',
  'Teacher who believes in lifelong learning and good company.',
  'Photographer chasing golden hour in every city.',
  'Dancing through life — literally, I take salsa classes.',
  'Software engineer who also writes poetry. Yes, both.',
  'Marine biologist who loves the ocean more than people. Prove me wrong.',
  'Aspiring chef. You\'ll be my taste tester.',
  'Music is my love language. Concerts > texting.',
  'Introvert with selective extrovert energy.',
  'Plant mom with 47 babies and counting.',
  'Runner training for my first marathon. Need a cheerleader.',
  'Architect by profession, explorer by heart.',
  'Film school grad who quotes movies in every conversation.',
  'Night owl who makes the best midnight snacks.',
  'Volunteer at the animal shelter on weekends.',
  'Fashion designer who thrifts more than shops.',
  'Loves rainy days, hot chocolate, and deep conversations.',
  'Science nerd who\'ll explain black holes on the first date.',
  'Pilot in training — literally reaching for the skies.',
  'Stand-up comedy fan. I\'ll make you laugh, I promise.',
  'Minimalist living, maximalist loving.',
];

const RELATIONSHIP_INTENTS: RelationshipIntent[] = [
  'long_term', 'short_term', 'new_friends', 'fwb', 'figuring_out', 'open_to_anything',
];

const ACTIVITY_TAGS: ActivityFilter[] = [
  'coffee', 'foodie', 'travel', 'gym_partner', 'movies', 'nightlife',
  'concerts', 'gaming', 'outdoors', 'art_culture', 'photography', 'beach_pool',
  'free_tonight', 'this_weekend', 'brunch', 'study_date', 'date_night',
];

const PROMPT_QUESTIONS = [
  'My ideal first date is...',
  'A green flag for me is...',
  'I\'m happiest when...',
  'My Sunday morning looks like...',
  'I geek out about...',
  'The way to my heart is...',
  'My most controversial opinion is...',
  'I\'m looking for someone who...',
];

const PROMPT_ANSWERS = [
  'A sunset walk followed by street food at a local market',
  'Someone who remembers the small things I mention',
  'Exploring a new city with no itinerary at all',
  'Lazy brunch with a good playlist and nowhere to be',
  'Space documentaries and obscure historical facts',
  'Good conversation, homemade food, and spontaneous plans',
  'Pineapple absolutely belongs on pizza',
  'Can hold a conversation and make me laugh',
  'Cooking a new recipe while dancing in the kitchen',
  'Trying a hole-in-the-wall restaurant nobody knows about',
  'Deep talks on a rooftop under the stars',
  'Someone who texts back within the hour (not days)',
];

// Unsplash photo URLs — diverse female portraits at 400px width
const PHOTO_URLS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400',
  'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400',
  'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400',
  'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400',
  'https://images.unsplash.com/photo-1506956191951-7a88da4435e5?w=400',
  'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=400',
  'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400',
  'https://images.unsplash.com/photo-1506956191951-7a88da4435e5?w=400',
];

// ---------------------------------------------------------------------------
// Deterministic helpers (seeded by index)
// ---------------------------------------------------------------------------

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function pickN<T>(arr: T[], seed: number, count: number): T[] {
  const result: T[] = [];
  const seen = new Set<number>();
  let s = seed;
  while (result.length < count && seen.size < arr.length) {
    const idx = s % arr.length;
    if (!seen.has(idx)) {
      seen.add(idx);
      result.push(arr[idx]);
    }
    s = (s * 31 + 7) & 0x7fffffff;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const GENERATED_COUNT = 300;

export interface GeneratedProfile {
  _id: string;
  name: string;
  age: number;
  gender: 'female';
  bio: string;
  isVerified: boolean;
  city: string;
  distance: number;
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
  profilePrompts: { question: string; answer: string }[];
  photos: { url: string }[];
}

let _cache: GeneratedProfile[] | null = null;

/**
 * Returns 300 deterministically generated demo profiles.
 * Cached after first call so it's free on subsequent accesses.
 */
export function seedDemoProfiles(): GeneratedProfile[] {
  if (_cache) return _cache;

  const profiles: GeneratedProfile[] = [];
  for (let i = 0; i < GENERATED_COUNT; i++) {
    const seed = i * 97 + 13;
    const name = pick(FIRST_NAMES, seed);
    const age = 20 + (seed % 12); // 20-31
    const city = pick(CITIES, seed + 3);
    const bio = pick(BIOS, seed + 7);
    const verified = (seed % 3) !== 0; // ~67% verified
    const distance = 1 + (seed % 25); // 1-25 km

    const intents = pickN(RELATIONSHIP_INTENTS, seed + 11, 1 + (seed % 2));
    const activities = pickN(ACTIVITY_TAGS, seed + 17, 2 + (seed % 3));

    // 1-3 profile prompts
    const promptCount = 1 + (seed % 3);
    const prompts: { question: string; answer: string }[] = [];
    for (let j = 0; j < promptCount; j++) {
      prompts.push({
        question: pick(PROMPT_QUESTIONS, seed + j * 5),
        answer: pick(PROMPT_ANSWERS, seed + j * 7 + 3),
      });
    }

    // 1-4 photos
    const photoCount = 1 + (seed % 4);
    const photos = pickN(PHOTO_URLS, seed + 23, photoCount).map((url) => ({ url }));

    profiles.push({
      _id: `gen_profile_${i}`,
      name,
      age,
      gender: 'female',
      bio,
      isVerified: verified,
      city,
      distance,
      relationshipIntent: intents as RelationshipIntent[],
      activities: activities as ActivityFilter[],
      profilePrompts: prompts,
      photos,
    });
  }

  _cache = profiles;
  return profiles;
}
