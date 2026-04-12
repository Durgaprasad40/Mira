export const FRONTEND_RELATIONSHIP_INTENT_IDS = [
  "serious_vibes",
  "keep_it_casual",
  "exploring_vibes",
  "see_where_it_goes",
  "open_to_vibes",
  "just_friends",
  "open_to_anything",
  "single_parent",
  "new_to_dating",
] as const;

export type FrontendRelationshipIntentId =
  (typeof FRONTEND_RELATIONSHIP_INTENT_IDS)[number];

export const FRONTEND_RELATIONSHIP_INTENT_COMPATIBILITY = {
  serious_vibes: ["serious_vibes", "see_where_it_goes"],
  keep_it_casual: ["keep_it_casual", "open_to_vibes"],
  exploring_vibes: ["exploring_vibes", "open_to_anything"],
  see_where_it_goes: ["see_where_it_goes", "serious_vibes", "keep_it_casual"],
  open_to_vibes: ["open_to_vibes", "keep_it_casual"],
  just_friends: ["just_friends", "open_to_anything"],
  open_to_anything: ["open_to_anything", "exploring_vibes", "just_friends"],
  single_parent: ["single_parent"],
  new_to_dating: ["new_to_dating"],
} as const satisfies Record<
  FrontendRelationshipIntentId,
  readonly FrontendRelationshipIntentId[]
>;

export const FRONTEND_EXPLORE_CATEGORY_IDS = [
  ...FRONTEND_RELATIONSHIP_INTENT_IDS,
  "nearby",
] as const;

export type FrontendExploreCategoryId =
  (typeof FRONTEND_EXPLORE_CATEGORY_IDS)[number];

const FRONTEND_RELATIONSHIP_INTENT_SET = new Set<string>(
  FRONTEND_RELATIONSHIP_INTENT_IDS,
);

const FRONTEND_EXPLORE_CATEGORY_SET = new Set<string>(
  FRONTEND_EXPLORE_CATEGORY_IDS,
);

const LEGACY_RELATIONSHIP_INTENT_ALIASES: Record<
  string,
  FrontendRelationshipIntentId[]
> = {
  serious_vibes: ["serious_vibes"],
  keep_it_casual: ["keep_it_casual"],
  exploring_vibes: ["exploring_vibes"],
  see_where_it_goes: ["see_where_it_goes"],
  open_to_vibes: ["open_to_vibes"],
  just_friends: ["just_friends"],
  open_to_anything: ["open_to_anything"],
  single_parent: ["single_parent"],
  new_to_dating: ["new_to_dating"],

  long_term: ["serious_vibes"],
  long_term_partner: ["serious_vibes"],
  short_term: ["keep_it_casual"],
  short_term_fun: ["keep_it_casual"],
  fwb: ["keep_it_casual"],
  figuring_out: ["exploring_vibes"],
  short_to_long: ["see_where_it_goes"],
  short_term_open_to_long: ["see_where_it_goes"],
  long_to_short: ["open_to_vibes"],
  long_term_open_to_short: ["serious_vibes", "open_to_vibes"],
  new_friends: ["just_friends"],
  just_18: ["new_to_dating"],
};

const LEGACY_EXPLORE_CATEGORY_ALIASES: Record<string, FrontendExploreCategoryId> =
  {
    serious_vibes: "serious_vibes",
    keep_it_casual: "keep_it_casual",
    exploring_vibes: "exploring_vibes",
    see_where_it_goes: "see_where_it_goes",
    open_to_vibes: "open_to_vibes",
    just_friends: "just_friends",
    open_to_anything: "open_to_anything",
    single_parent: "single_parent",
    new_to_dating: "new_to_dating",
    nearby: "nearby",

    long_term: "serious_vibes",
    short_term: "keep_it_casual",
    figuring_out: "exploring_vibes",
    short_to_long: "see_where_it_goes",
    long_to_short: "open_to_vibes",
    new_friends: "just_friends",
    just_18: "new_to_dating",
    near_me: "nearby",
  };

export function isFrontendRelationshipIntentId(
  value: string | undefined | null,
): value is FrontendRelationshipIntentId {
  return typeof value === "string" && FRONTEND_RELATIONSHIP_INTENT_SET.has(value);
}

export function isFrontendExploreCategoryId(
  value: string | undefined | null,
): value is FrontendExploreCategoryId {
  return typeof value === "string" && FRONTEND_EXPLORE_CATEGORY_SET.has(value);
}

export function normalizeRelationshipIntentValues(
  values: readonly string[] | string | undefined | null,
): FrontendRelationshipIntentId[] {
  const source = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? [values]
      : [];

  const normalized: FrontendRelationshipIntentId[] = [];
  const seen = new Set<FrontendRelationshipIntentId>();

  for (const rawValue of source) {
    if (typeof rawValue !== "string") continue;
    const mapped = LEGACY_RELATIONSHIP_INTENT_ALIASES[rawValue] ?? [];
    for (const value of mapped) {
      if (seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
  }

  return normalized;
}

export function normalizeExploreCategoryId(
  value: string | undefined | null,
): FrontendExploreCategoryId | undefined {
  if (typeof value !== "string") return undefined;
  return LEGACY_EXPLORE_CATEGORY_ALIASES[value];
}
