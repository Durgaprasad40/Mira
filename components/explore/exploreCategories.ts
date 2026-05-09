import { isWithinAllowedDistance, EXPLORE_NEARBY_RADIUS_KM } from "@/lib/distanceRules";
import { isFreeTonightActive } from "@/lib/freeTonight";
import {
  FRONTEND_RELATIONSHIP_INTENT_IDS,
  normalizeRelationshipIntentValues,
} from "@/lib/discoveryNaming";

export type ExploreCategory = {
  id: string;
  label: string;
  title?: string;
  tagLabel?: string;
  icon: string;
  color: string;
  predicate: (p: ExploreProfileLike) => boolean;
};

export type ExploreProfileLike = {
  relationshipIntent?: readonly string[] | string | null;
  distance?: number | null;
  isOnline?: boolean | null;
  lastActive?: number | null;
  activities?: readonly string[] | null;
  freeTonightExpiresAt?: number | null;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const KNOWN_INTENTS = new Set([
  "serious_vibes", "keep_it_casual", "exploring_vibes", "see_where_it_goes",
  "open_to_vibes", "just_friends", "open_to_anything", "single_parent", "new_to_dating",
]);

const getIntents = (p: ExploreProfileLike): string[] => {
  const raw = p?.relationshipIntent ?? null;
  const out: string[] = [];

  if (typeof raw === "string" && KNOWN_INTENTS.has(raw)) {
    out.push(raw);
  } else if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string" && KNOWN_INTENTS.has(v)) out.push(v);
    }
  }

  return out;
};

const hasIntent = (p: ExploreProfileLike, ...targets: string[]): boolean => {
  const intents = getIntents(p);
  return targets.some((t) => intents.includes(t));
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
    label: "Serious Intentions",
    title: "Serious Intentions",
    tagLabel: "Looking for something serious",
    icon: "💑",
    color: TILE_COLORS.pink,
    predicate: (p) => hasIntent(p, "serious_vibes"),
  },
  {
    id: "keep_it_casual",
    label: "Keep It Casual",
    title: "Keep It Casual",
    tagLabel: "Looking for casual",
    icon: "🎉",
    color: TILE_COLORS.orange,
    predicate: (p) => hasIntent(p, "keep_it_casual"),
  },
  {
    id: "exploring_vibes",
    label: "Still Exploring",
    title: "Still Exploring",
    tagLabel: "Still figuring it out",
    icon: "🤔",
    color: TILE_COLORS.sky,
    predicate: (p) => hasIntent(p, "exploring_vibes"),
  },
  {
    id: "see_where_it_goes",
    label: "See Where It Goes",
    title: "See Where It Goes",
    tagLabel: "Open to more",
    icon: "📈",
    color: TILE_COLORS.indigo,
    predicate: (p) => hasIntent(p, "see_where_it_goes"),
  },
  {
    id: "open_to_vibes",
    label: "Open-Minded",
    title: "Open-Minded",
    tagLabel: "Flexible on commitment",
    icon: "📉",
    color: TILE_COLORS.purple,
    predicate: (p) => hasIntent(p, "open_to_vibes"),
  },
  {
    id: "just_friends",
    label: "Just Friends",
    title: "Just Friends",
    tagLabel: "Looking for friends",
    icon: "👋",
    color: TILE_COLORS.teal,
    predicate: (p) => hasIntent(p, "just_friends"),
  },
  {
    id: "open_to_anything",
    label: "Open to Anything",
    title: "Open to Anything",
    tagLabel: "Open to anything",
    icon: "✨",
    color: TILE_COLORS.gold,
    predicate: (p) => hasIntent(p, "open_to_anything"),
  },
  {
    id: "single_parent",
    label: "Single Parent",
    title: "Single Parent",
    tagLabel: "Single parent",
    icon: "👨‍👧",
    color: TILE_COLORS.rose,
    predicate: (p) => hasIntent(p, "single_parent"),
  },
  {
    id: "new_to_dating",
    label: "New to Dating",
    title: "New to Dating",
    tagLabel: "New to dating",
    icon: "🌱",
    color: TILE_COLORS.mint,
    predicate: (p) => hasIntent(p, "new_to_dating"),
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
    tagLabel: "Close to you",
    icon: "📍",
    color: TILE_COLORS.emerald,
    predicate: (p) => typeof p?.distance === "number" && isWithinAllowedDistance(p, EXPLORE_NEARBY_RADIUS_KM),
  },
  {
    id: "online_now",
    label: "Online Now",
    title: "Online Now",
    tagLabel: "Online now",
    icon: "🟢",
    color: TILE_COLORS.mint,
    predicate: (p) => p?.isOnline === true || minutesAgo(p?.lastActive ?? undefined) <= 10,
  },
  {
    id: "active_today",
    label: "Active Today",
    title: "Active Today",
    tagLabel: "Active today",
    icon: "📱",
    color: TILE_COLORS.blue,
    predicate: (p) => minutesAgo(p?.lastActive ?? undefined) <= 24 * 60,
  },
  {
    id: "free_tonight",
    label: "Free Tonight",
    title: "Free Tonight",
    tagLabel: "Free tonight",
    icon: "🌙",
    color: TILE_COLORS.indigo,
    predicate: (p) => isFreeTonightActive(p?.activities, p?.freeTonightExpiresAt),
  },
];

// ============================================
// COMBINED EXPORT (all categories)
// ============================================
export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  ...RELATIONSHIP_TILES,
  ...RIGHT_NOW_TILES,
];

export const RELATIONSHIP_CATEGORIES = RELATIONSHIP_TILES;
export const RIGHT_NOW_CATEGORIES = RIGHT_NOW_TILES;

const EXPLORE_CATEGORY_BY_ID = new Map(EXPLORE_CATEGORIES.map((category) => [category.id, category]));

const RELATIONSHIP_CATEGORY_IDS = new Set<string>(FRONTEND_RELATIONSHIP_INTENT_IDS);

export function getMutualRelationshipCategory(
  viewerRelationshipIntent: readonly string[] | string | undefined | null,
  candidateRelationshipIntent: readonly string[] | string | undefined | null,
): string | null {
  const viewerGoals = new Set<string>(normalizeRelationshipIntentValues(viewerRelationshipIntent));
  if (viewerGoals.size === 0) return null;

  const candidateGoals = new Set<string>(normalizeRelationshipIntentValues(candidateRelationshipIntent));
  if (candidateGoals.size === 0) return null;

  for (const categoryId of FRONTEND_RELATIONSHIP_INTENT_IDS) {
    if (viewerGoals.has(categoryId) && candidateGoals.has(categoryId)) {
      return categoryId;
    }
  }

  return null;
}

export function profileMatchesExploreCategory(
  category: ExploreCategory,
  profile: ExploreProfileLike,
  viewerRelationshipIntent: readonly string[] | string | undefined | null,
): boolean {
  if (RELATIONSHIP_CATEGORY_IDS.has(category.id)) {
    return getMutualRelationshipCategory(
      viewerRelationshipIntent,
      profile?.relationshipIntent,
    ) === category.id;
  }

  return category.predicate(profile);
}

export function countDemoProfilesPerExploreCategory(
  profiles: ExploreProfileLike[],
  viewerRelationshipIntent: readonly string[] | string | undefined | null,
): Record<string, number> {
  const counts = Object.fromEntries(EXPLORE_CATEGORIES.map((category) => [category.id, 0]));

  for (const profile of profiles) {
    for (const category of EXPLORE_CATEGORIES) {
      if (profileMatchesExploreCategory(category, profile, viewerRelationshipIntent)) {
        counts[category.id] += 1;
      }
    }
  }

  return counts;
}

export function getExploreCategoryTagLabel(categoryId: string | null | undefined): string | undefined {
  if (!categoryId) return undefined;
  return EXPLORE_CATEGORY_BY_ID.get(categoryId)?.tagLabel;
}
