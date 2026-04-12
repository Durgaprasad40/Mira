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

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const KNOWN_INTENTS = new Set([
  "serious_vibes", "keep_it_casual", "exploring_vibes", "see_where_it_goes",
  "open_to_vibes", "just_friends", "open_to_anything", "single_parent", "new_to_dating",
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
    predicate: (p) => hasIntent(p, "serious_vibes", "see_where_it_goes"),
  },
  {
    id: "keep_it_casual",
    label: "Keep It Casual",
    title: "Keep It Casual",
    icon: "🎉",
    color: TILE_COLORS.orange,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "keep_it_casual", "open_to_vibes"),
  },
  {
    id: "exploring_vibes",
    label: "Exploring Vibes",
    title: "Exploring Vibes",
    icon: "🤔",
    color: TILE_COLORS.sky,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "exploring_vibes", "open_to_anything"),
  },
  {
    id: "see_where_it_goes",
    label: "See Where It Goes",
    title: "See Where It Goes",
    icon: "📈",
    color: TILE_COLORS.indigo,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "see_where_it_goes", "serious_vibes"),
  },
  {
    id: "open_to_vibes",
    label: "Open to Vibes",
    title: "Open to Vibes",
    icon: "📉",
    color: TILE_COLORS.purple,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "open_to_vibes", "keep_it_casual"),
  },
  {
    id: "just_friends",
    label: "Just Friends",
    title: "Just Friends",
    icon: "👋",
    color: TILE_COLORS.teal,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "just_friends", "open_to_anything"),
  },
  {
    id: "open_to_anything",
    label: "Open to Anything",
    title: "Open to Anything",
    icon: "✨",
    color: TILE_COLORS.gold,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "open_to_anything", "exploring_vibes"),
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
    id: "new_to_dating",
    label: "New to Dating",
    title: "New to Dating",
    icon: "🌱",
    color: TILE_COLORS.mint,
    kind: "relationship",
    predicate: (p) => hasIntent(p, "new_to_dating"),
  },
];

// ============================================
// RIGHT NOW CATEGORIES
// Live Explore currently supports only the backend-backed nearby tile.
// ============================================
const RIGHT_NOW_TILES: ExploreCategory[] = [
  {
    id: "nearby",
    label: "Nearby",
    title: "Nearby",
    icon: "📍",
    color: TILE_COLORS.emerald,
    kind: "relationship",
    predicate: (p) => typeof p?.distance === "number" && isWithinAllowedDistance(p, NEAR_ME_DISTANCE_KM),
  },
];

// ============================================
// INTEREST CATEGORIES
// Hidden for now until the backend has a truthful live category source.
// ============================================
const INTEREST_TILES: ExploreCategory[] = [];

// ============================================
// COMBINED EXPORT (all categories)
// ============================================
export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  ...RELATIONSHIP_TILES,
  ...RIGHT_NOW_TILES,
  ...INTEREST_TILES,
];

// Live Explore currently exposes only backend-backed categories.
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
