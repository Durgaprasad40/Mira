import { RELATIONSHIP_INTENTS } from '@/lib/constants';

export type IntentCompat = 'match' | 'partial' | 'mismatch';

/**
 * Compute relationship-intent compatibility between two users.
 */
export function computeIntentCompat(
  myIntents: string[],
  theirIntents: string[],
): { compat: IntentCompat; theirPrimaryLabel: string; theirPrimaryEmoji: string } {
  const theirPrimary = theirIntents[0] || 'exploring_vibes';
  const found = RELATIONSHIP_INTENTS.find((r) => r.value === theirPrimary);
  const theirPrimaryLabel = found?.label || 'Exploring Vibes';
  const theirPrimaryEmoji = found?.emoji || '🤔';

  if (!myIntents.length || !theirIntents.length) {
    return { compat: 'partial', theirPrimaryLabel, theirPrimaryEmoji };
  }

  const overlap = myIntents.filter((i) => theirIntents.includes(i));
  if (overlap.length > 0) {
    return { compat: 'match', theirPrimaryLabel, theirPrimaryEmoji };
  }

  // Check for near-matches using CURRENT 9 RELATIONSHIP CATEGORIES
  const compatible: Record<string, string[]> = {
    serious_vibes: ['see_where_it_goes', 'open_to_anything'],
    keep_it_casual: ['open_to_vibes', 'open_to_anything'],
    exploring_vibes: ['open_to_anything', 'new_to_dating'],
    see_where_it_goes: ['serious_vibes', 'open_to_anything'],
    open_to_vibes: ['keep_it_casual', 'open_to_anything'],
    just_friends: ['open_to_anything'],
    open_to_anything: ['serious_vibes', 'keep_it_casual', 'exploring_vibes', 'just_friends'],
    single_parent: ['serious_vibes', 'exploring_vibes', 'open_to_anything'],
    new_to_dating: ['exploring_vibes', 'open_to_anything'],
  };

  for (const mine of myIntents) {
    const compat = compatible[mine] || [];
    if (theirIntents.some((t) => compat.includes(t))) {
      return { compat: 'partial', theirPrimaryLabel, theirPrimaryEmoji };
    }
  }

  return { compat: 'mismatch', theirPrimaryLabel, theirPrimaryEmoji };
}

export function getIntentCompatColor(compat: IntentCompat): string {
  switch (compat) {
    case 'match': return '#4CAF50';
    case 'partial': return '#FF9800';
    case 'mismatch': return '#F44336';
  }
}

export function getIntentMismatchWarning(compat: IntentCompat): string | null {
  switch (compat) {
    case 'mismatch': return 'Different relationship goals';
    case 'partial': return 'Partially aligned goals';
    default: return null;
  }
}
