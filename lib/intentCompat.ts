import { RELATIONSHIP_INTENTS } from '@/lib/constants';

export type IntentCompat = 'match' | 'partial' | 'mismatch';

/**
 * Compute relationship-intent compatibility between two users.
 */
export function computeIntentCompat(
  myIntents: string[],
  theirIntents: string[],
): { compat: IntentCompat; theirPrimaryLabel: string; theirPrimaryEmoji: string } {
  const theirPrimary = theirIntents[0] || 'figuring_out';
  const found = RELATIONSHIP_INTENTS.find((r) => r.value === theirPrimary);
  const theirPrimaryLabel = found?.label || 'Figuring out';
  const theirPrimaryEmoji = found?.emoji || '🤔';

  if (!myIntents.length || !theirIntents.length) {
    return { compat: 'partial', theirPrimaryLabel, theirPrimaryEmoji };
  }

  const overlap = myIntents.filter((i) => theirIntents.includes(i));
  if (overlap.length > 0) {
    return { compat: 'match', theirPrimaryLabel, theirPrimaryEmoji };
  }

  // Check for near-matches (e.g. short_to_long ↔ long_term)
  const compatible: Record<string, string[]> = {
    long_term: ['short_to_long', 'open_to_anything'],
    short_term: ['long_to_short', 'open_to_anything', 'fwb'],
    fwb: ['short_term', 'open_to_anything'],
    short_to_long: ['long_term', 'open_to_anything'],
    long_to_short: ['short_term', 'open_to_anything'],
    open_to_anything: ['long_term', 'short_term', 'fwb', 'new_friends', 'figuring_out'],
    figuring_out: ['open_to_anything'],
    new_friends: ['open_to_anything', 'new_friends'],
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
