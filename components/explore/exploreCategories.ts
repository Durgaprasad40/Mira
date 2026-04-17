import { isWithinAllowedDistance, NEAR_ME_DISTANCE_KM } from "@/lib/distanceRules";
import { normalizeRelationshipIntentValues } from "@/lib/discoveryNaming";

export type ExploreCategoryKind = "relationship" | "right_now" | "interest";

type DemoExploreProfile = {
  relationshipIntent?: readonly string[] | string | null;
  activities?: readonly string[] | null;
  distance?: number | null;
  isActiveNow?: boolean | null;
  wasActiveToday?: boolean | null;
  lastActive?: number | null;
  lastActiveAt?: number | null;
};

export type ExploreCategory = {
  id: string;
  label: string;
  title?: string;
  icon: string;
  color: string;
  kind: ExploreCategoryKind;
  // Demo-only mirror of backend category semantics. Live Explore data is filtered on the backend.
  demoPredicate: (profile: DemoExploreProfile) => boolean;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const getRelationshipIntentValues = (profile: DemoExploreProfile): string[] =>
  normalizeRelationshipIntentValues(profile.relationshipIntent);

const hasExactIntent = (profile: DemoExploreProfile, target: string): boolean =>
  getRelationshipIntentValues(profile).includes(target);

const hasExactActivity = (profile: DemoExploreProfile, target: string): boolean =>
  Array.isArray(profile?.activities) && profile.activities.includes(target);

const getLastActiveTimestamp = (profile: DemoExploreProfile): number | undefined =>
  typeof profile?.lastActive === "number"
    ? profile.lastActive
    : typeof profile?.lastActiveAt === "number"
      ? profile.lastActiveAt
      : undefined;

const minutesAgo = (ts?: number) =>
  ts ? (Date.now() - ts) / 60000 : Number.POSITIVE_INFINITY;

// ============================================
// TILE COLORS (vibrant gradients)
// ============================================
const TILE_COLORS = {
  coral: "#FF6B6B",
  orange: "#FF8C42",
  gold: "#FFD93D",
  lime: "#6BCB77",
  teal: "#4ECDC4",
  sky: "#45B7D1",
  blue: "#4D96FF",
  purple: "#9B5DE5",
  pink: "#F15BB5",
  rose: "#FF85A1",
  mint: "#00D9A5",
  amber: "#F9A826",
  indigo: "#6366F1",
  emerald: "#10B981",
};

// ============================================
// RELATIONSHIP CATEGORIES (9 canonical goals)
// IDs match the backend live Explore category set exactly
// ============================================
// RELATIONSHIP TILES - predicates use CURRENT 9 RELATIONSHIP CATEGORIES
// Category ID === relationshipIntent value (unified naming)
const RELATIONSHIP_TILES: ExploreCategory[] = [
  {
    id: "serious_vibes",
    label: "Serious Vibes",
    title: "Serious Vibes",
    icon: "💑",
    color: TILE_COLORS.pink,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "serious_vibes"),
  },
  {
    id: "keep_it_casual",
    label: "Keep It Casual",
    title: "Keep It Casual",
    icon: "🎉",
    color: TILE_COLORS.orange,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "keep_it_casual"),
  },
  {
    id: "exploring_vibes",
    label: "Exploring Vibes",
    title: "Exploring Vibes",
    icon: "🤔",
    color: TILE_COLORS.sky,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "exploring_vibes"),
  },
  {
    id: "see_where_it_goes",
    label: "See Where It Goes",
    title: "See Where It Goes",
    icon: "📈",
    color: TILE_COLORS.indigo,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "see_where_it_goes"),
  },
  {
    id: "open_to_vibes",
    label: "Open to Vibes",
    title: "Open to Vibes",
    icon: "📉",
    color: TILE_COLORS.purple,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "open_to_vibes"),
  },
  {
    id: "just_friends",
    label: "Just Friends",
    title: "Just Friends",
    icon: "👋",
    color: TILE_COLORS.teal,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "just_friends"),
  },
  {
    id: "open_to_anything",
    label: "Open to Anything",
    title: "Open to Anything",
    icon: "✨",
    color: TILE_COLORS.gold,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "open_to_anything"),
  },
  {
    id: "single_parent",
    label: "Single Parent",
    title: "Single Parent",
    icon: "👨‍👧",
    color: TILE_COLORS.rose,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "single_parent"),
  },
  {
    id: "new_to_dating",
    label: "New to Dating",
    title: "New to Dating",
    icon: "🌱",
    color: TILE_COLORS.mint,
    kind: "relationship",
    demoPredicate: (profile) => hasExactIntent(profile, "new_to_dating"),
  },
];

// ============================================
// RIGHT NOW CATEGORIES (4 activity signals)
// IDs match the backend live Explore category set exactly.
// ============================================
const RIGHT_NOW_TILES: ExploreCategory[] = [
  {
    id: "nearby",
    label: "Nearby",
    title: "Nearby",
    icon: "📍",
    color: TILE_COLORS.emerald,
    kind: "right_now",
    demoPredicate: (profile) => typeof profile?.distance === "number" && isWithinAllowedDistance(profile, NEAR_ME_DISTANCE_KM),
  },
  {
    id: "online_now",
    label: "Online Now",
    title: "Online Now",
    icon: "🟢",
    color: TILE_COLORS.mint,
    kind: "right_now",
    demoPredicate: (profile) =>
      profile?.isActiveNow === true || minutesAgo(getLastActiveTimestamp(profile)) <= 10,
  },
  {
    id: "active_today",
    label: "Active Today",
    title: "Active Today",
    icon: "📱",
    color: TILE_COLORS.blue,
    kind: "right_now",
    demoPredicate: (profile) =>
      profile?.wasActiveToday === true || minutesAgo(getLastActiveTimestamp(profile)) <= 24 * 60,
  },
  {
    id: "free_tonight",
    label: "Free Tonight",
    title: "Free Tonight",
    icon: "🌙",
    color: TILE_COLORS.indigo,
    kind: "right_now",
    demoPredicate: (profile) => hasExactActivity(profile, "free_tonight"),
  },
];

// ============================================
// INTEREST CATEGORIES (12 tiles)
// IDs match the backend live Explore category set exactly.
// ============================================
const INTEREST_TILES: ExploreCategory[] = [
  {
    id: "coffee_date",
    label: "Coffee",
    title: "Coffee",
    icon: "☕",
    color: TILE_COLORS.amber,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "coffee"),
  },
  {
    id: "sports",
    label: "Sports",
    title: "Sports",
    icon: "⚽",
    color: TILE_COLORS.blue,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "sports"),
  },
  {
    id: "nature_lovers",
    label: "Outdoors",
    title: "Outdoors",
    icon: "🌿",
    color: TILE_COLORS.emerald,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "outdoors"),
  },
  {
    id: "binge_watchers",
    label: "Movies",
    title: "Movies",
    icon: "🎬",
    color: TILE_COLORS.coral,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "movies"),
  },
  {
    id: "foodie",
    label: "Foodie",
    title: "Foodie",
    icon: "🍕",
    color: TILE_COLORS.orange,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "foodie"),
  },
  {
    id: "travel",
    label: "Travel",
    title: "Travel",
    icon: "✈️",
    color: TILE_COLORS.sky,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "travel"),
  },
  {
    id: "art_culture",
    label: "Art & Culture",
    title: "Art & Culture",
    icon: "🎨",
    color: TILE_COLORS.rose,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "art_culture"),
  },
  {
    id: "gaming",
    label: "Gaming",
    title: "Gaming",
    icon: "🎮",
    color: TILE_COLORS.purple,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "gaming"),
  },
  {
    id: "fitness",
    label: "Fitness",
    title: "Fitness",
    icon: "💪",
    color: TILE_COLORS.lime,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "gym_partner"),
  },
  {
    id: "music",
    label: "Concerts",
    title: "Concerts",
    icon: "🎵",
    color: TILE_COLORS.pink,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "concerts"),
  },
  {
    id: "nightlife",
    label: "Nightlife",
    title: "Nightlife",
    icon: "🍸",
    color: TILE_COLORS.indigo,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "nightlife"),
  },
  {
    id: "brunch",
    label: "Brunch",
    title: "Brunch",
    icon: "🥂",
    color: TILE_COLORS.gold,
    kind: "interest",
    demoPredicate: (profile) => hasExactActivity(profile, "brunch"),
  },
];

// ============================================
// COMBINED EXPORT (all categories)
// ============================================
export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  ...RELATIONSHIP_TILES,
  ...RIGHT_NOW_TILES,
  ...INTEREST_TILES,
];

export const RELATIONSHIP_CATEGORIES = RELATIONSHIP_TILES;
export const RIGHT_NOW_CATEGORIES = RIGHT_NOW_TILES;
export const INTEREST_CATEGORIES = INTEREST_TILES;
