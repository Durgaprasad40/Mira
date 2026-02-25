import { isWithinAllowedDistance, NEAR_ME_DISTANCE_KM } from "@/lib/distanceRules";

export type ExploreCategory = {
  id: string;
  label: string;
  title?: string;
  icon: string;
  color: string;
  kind: "relationship" | "interest";
  predicate: (p: any) => boolean;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const KNOWN_INTENTS = new Set([
  "long_term", "long_term_partner", "long_term_open_to_short",
  "short_term_open_to_long", "short_term_fun", "short_term",
  "new_friends", "figuring_out", "non_monogamy", "leading_to_marriage",
  "fwb", "short_to_long", "open_to_anything", "single_parent", "just_18",
]);

const getIntents = (p: any): string[] => {
  const raw =
    p?.relationshipIntent ??
    p?.relationshipGoal ??
    p?.lookingFor ??
    p?.intent ??
    null;

  const out: string[] = [];

  if (typeof raw === "string" && KNOWN_INTENTS.has(raw)) {
    out.push(raw);
  } else if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string" && KNOWN_INTENTS.has(v)) out.push(v);
    }
  }

  if (out.length > 0) return out;

  // Fallback: derive from tags
  const tags: string[] = Array.isArray(p?.tags) ? p.tags : [];
  for (const t of tags) {
    if (KNOWN_INTENTS.has(t)) out.push(t);
  }

  return out;
};

const hasIntent = (p: any, ...targets: string[]): boolean => {
  const intents = getIntents(p);
  return targets.some((t) => intents.includes(t));
};

const hasActivity = (p: any, ...targets: string[]): boolean => {
  const activities: string[] = Array.isArray(p?.activities) ? p.activities : [];
  const tags: string[] = Array.isArray(p?.tags) ? p.tags : [];
  const combined = [...activities, ...tags];
  return targets.some((t) => combined.includes(t));
};

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
// Matches RELATIONSHIP_INTENTS in constants.ts
// ============================================
const RELATIONSHIP_TILES: ExploreCategory[] = [
  {
    id: "long_term",
    label: "Serious Vibes",
    title: "Serious Vibes",
    icon: "💑",
    color: TILE_COLORS.pink,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "long_term", "long_term_partner", "long_term_open_to_short"),
  },
  {
    id: "short_term",
    label: "Keep It Casual",
    title: "Keep It Casual",
    icon: "🎉",
    color: TILE_COLORS.orange,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "short_term_fun", "short_term", "fwb"),
  },
  {
    id: "figuring_out",
    label: "Exploring Vibes",
    title: "Exploring Vibes",
    icon: "🤔",
    color: TILE_COLORS.sky,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "figuring_out"),
  },
  {
    id: "short_to_long",
    label: "See Where It Goes",
    title: "See Where It Goes",
    icon: "📈",
    color: TILE_COLORS.indigo,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "short_term_open_to_long", "short_to_long"),
  },
  {
    id: "long_to_short",
    label: "Open to Vibes",
    title: "Open to Vibes",
    icon: "📉",
    color: TILE_COLORS.purple,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "long_to_short", "long_term_open_to_short"),
  },
  {
    id: "new_friends",
    label: "Just Friends",
    title: "Just Friends",
    icon: "👋",
    color: TILE_COLORS.teal,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "new_friends"),
  },
  {
    id: "open_to_anything",
    label: "Open to Anything",
    title: "Open to Anything",
    icon: "✨",
    color: TILE_COLORS.gold,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "open_to_anything"),
  },
  {
    id: "single_parent",
    label: "Single Parent",
    title: "Single Parent",
    icon: "👨‍👧",
    color: TILE_COLORS.rose,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "single_parent"),
  },
  {
    id: "just_18",
    label: "New to Dating",
    title: "New to Dating",
    icon: "🌱",
    color: TILE_COLORS.lime,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "just_18"),
  },
];

// ============================================
// RIGHT NOW CATEGORIES (4 activity signals)
// These are Explore-only signals, not Relationship Goals
// ============================================
const RIGHT_NOW_TILES: ExploreCategory[] = [
  {
    id: "near_me",
    label: "Near Me",
    title: "Near Me",
    icon: "📍",
    color: TILE_COLORS.emerald,
    kind: "relationship",
    predicate: (p) => typeof p?.distance === "number" && isWithinAllowedDistance(p, NEAR_ME_DISTANCE_KM),
  },
  {
    id: "online_now",
    label: "Online Now",
    title: "Online Now",
    icon: "🟢",
    color: TILE_COLORS.mint,
    kind: "relationship",
    predicate: (p) => p?.isOnline === true || minutesAgo(p?.lastActive ?? p?.lastActiveAt) <= 10,
  },
  {
    id: "active_today",
    label: "Active Today",
    title: "Active Today",
    icon: "📱",
    color: TILE_COLORS.blue,
    kind: "relationship",
    predicate: (p) => minutesAgo(p?.lastActive ?? p?.lastActiveAt) <= 24 * 60,
  },
  {
    id: "free_tonight",
    label: "Free Tonight",
    title: "Free Tonight",
    icon: "🌙",
    color: TILE_COLORS.indigo,
    kind: "relationship",
    predicate: (p) => p?.freeTonight === true,
  },
];

// ============================================
// INTEREST CATEGORIES (7 tiles)
// ============================================
const INTEREST_TILES: ExploreCategory[] = [
  {
    id: "coffee_date",
    label: "Coffee Date",
    title: "Coffee Date",
    icon: "☕",
    color: TILE_COLORS.amber,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("coffee") || p?.activities?.includes("coffee"),
  },
  {
    id: "nature_lovers",
    label: "Nature Lovers",
    title: "Nature Lovers",
    icon: "🌿",
    color: TILE_COLORS.emerald,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("outdoors") || p?.activities?.includes("outdoors"),
  },
  {
    id: "binge_watchers",
    label: "Binge Watchers",
    title: "Binge Watchers",
    icon: "🎬",
    color: TILE_COLORS.coral,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("movies") || p?.activities?.includes("movies"),
  },
  {
    id: "travel",
    label: "Travel",
    title: "Travel",
    icon: "✈️",
    color: TILE_COLORS.sky,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("travel") || p?.activities?.includes("travel"),
  },
  {
    id: "gaming",
    label: "Gaming",
    title: "Gaming",
    icon: "🎮",
    color: TILE_COLORS.purple,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("gaming") || p?.activities?.includes("gaming"),
  },
  {
    id: "fitness",
    label: "Fitness",
    title: "Fitness",
    icon: "💪",
    color: TILE_COLORS.lime,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("gym") || p?.tags?.includes("fitness") ||
      p?.activities?.includes("gym") || p?.activities?.includes("fitness"),
  },
  {
    id: "music",
    label: "Music",
    title: "Music",
    icon: "🎵",
    color: TILE_COLORS.pink,
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("music") || p?.activities?.includes("music"),
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

// Separate exports for easy access
export const RELATIONSHIP_CATEGORIES = RELATIONSHIP_TILES;
export const RIGHT_NOW_CATEGORIES = RIGHT_NOW_TILES;
export const INTEREST_CATEGORIES = INTEREST_TILES;

// ============================================
// COUNT HELPER FUNCTION
// ============================================
export function countProfilesPerCategory(
  category: ExploreCategory,
  profiles: any[]
): number {
  if (!profiles || !Array.isArray(profiles)) return 0;
  return profiles.filter(category.predicate).length;
}
