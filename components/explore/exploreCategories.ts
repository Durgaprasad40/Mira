export type ExploreCategory = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  kind: "intent" | "availability" | "distance" | "interest";
  predicate: (p: any) => boolean;
};

/**
 * Normalise intent from whichever field the profile carries.
 * Returns the first recognised intent string, or null.
 *
 * Handles both string ("long_term") and array (["long_term","short_term"])
 * shapes, plus a tags-based fallback.
 */
const KNOWN_INTENTS = new Set([
  "long_term", "long_term_partner", "long_term_open_to_short",
  "short_term_open_to_long", "short_term_fun", "short_term",
  "new_friends", "figuring_out", "non_monogamy", "leading_to_marriage",
  "fwb", "short_to_long", "open_to_anything",
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

const minutesAgo = (ts?: number) =>
  ts ? (Date.now() - ts) / 60000 : Number.POSITIVE_INFINITY;

export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  // Intent
  {
    id: "serious_dater",
    title: "Serious Dater",
    kind: "intent",
    predicate: (p) => {
      const bioOk = !!p?.bio && p.bio.trim().length >= 5;
      const photosOk = Array.isArray(p?.photos) && p.photos.length >= 2;
      return (
        hasIntent(p, "long_term", "long_term_partner", "long_term_open_to_short") &&
        (bioOk || photosOk)
      );
    },
  },
  {
    id: "long_term_partner",
    title: "Long-Term Partner",
    kind: "intent",
    predicate: (p) => hasIntent(p, "long_term", "long_term_partner"),
  },
  {
    id: "long_term_open_to_short",
    title: "Long-Term, open to Short",
    kind: "intent",
    predicate: (p) => hasIntent(p, "long_term_open_to_short"),
  },
  {
    id: "short_term_open_to_long",
    title: "Short-Term, open to Long",
    kind: "intent",
    predicate: (p) => hasIntent(p, "short_term_open_to_long", "short_to_long"),
  },
  {
    id: "short_term_fun",
    title: "Short-Term Fun",
    kind: "intent",
    predicate: (p) => hasIntent(p, "short_term_fun", "short_term", "fwb"),
  },
  {
    id: "new_friends",
    title: "New Friends",
    kind: "intent",
    predicate: (p) => hasIntent(p, "new_friends", "open_to_anything"),
  },
  {
    id: "figuring_out",
    title: "Still Figuring It Out",
    kind: "intent",
    predicate: (p) => hasIntent(p, "figuring_out"),
  },
  {
    id: "non_monogamy",
    title: "Non-Monogamy",
    kind: "intent",
    predicate: (p) => hasIntent(p, "non_monogamy"),
  },
  {
    id: "leading_to_marriage",
    title: "Leading to Marriage",
    kind: "intent",
    predicate: (p) => hasIntent(p, "leading_to_marriage"),
  },

  // Availability
  {
    id: "online_now",
    title: "Online Now",
    kind: "availability",
    predicate: (p) => p?.isOnline === true || minutesAgo(p?.lastActive ?? p?.lastActiveAt) <= 10,
  },
  {
    id: "active_today",
    title: "Active Today",
    kind: "availability",
    predicate: (p) => minutesAgo(p?.lastActive ?? p?.lastActiveAt) <= 24 * 60,
  },
  {
    id: "free_tonight",
    title: "Free Tonight",
    kind: "availability",
    predicate: (p) => p?.freeTonight === true,
  },

  // Distance
  {
    id: "near_me",
    title: "Near Me",
    kind: "distance",
    predicate: (p) => typeof p?.distance === "number" && p.distance <= 5,
  },

  // Interests
  {
    id: "coffee_date",
    title: "Coffee Date",
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("coffee") || p?.activities?.includes("coffee"),
  },
  {
    id: "nature_lovers",
    title: "Nature Lovers",
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("outdoors") || p?.activities?.includes("outdoors"),
  },
  {
    id: "binge_watchers",
    title: "Binge Watchers",
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("movies") || p?.activities?.includes("movies"),
  },
  {
    id: "travel",
    title: "Travel",
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("travel") || p?.activities?.includes("travel"),
  },
  {
    id: "gaming",
    title: "Gaming",
    kind: "interest",
    predicate: (p) =>
      p?.tags?.includes("gaming") || p?.activities?.includes("gaming"),
  },
];
