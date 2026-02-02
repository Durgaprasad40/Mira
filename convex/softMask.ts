/**
 * Soft-mask sexual/explicit words for Face 1 messages.
 *
 * Rules:
 *  - Case-insensitive, whole-word matching only
 *  - First and last letter kept, middle replaced with *
 *  - Original casing preserved for kept letters
 *  - Only stored/displayed text is masked — no blocking, no errors
 */

// Curated word list — keep intentionally small
const MASKED_WORDS: string[] = [
  'sex',
  'porn',
  'nude',
  'nudes',
  'fuck',
  'fucking',
  'blowjob',
  'handjob',
  'orgasm',
  'dick',
  'pussy',
  'boobs',
  'penis',
  'vagina',
  'anal',
  'cum',
  'horny',
];

/**
 * Mask a single word: keep first + last char, replace middle with asterisks.
 * Words with 3 or fewer chars: keep first, mask middle, keep last.
 */
function maskWord(word: string): string {
  if (word.length <= 2) return word;
  const first = word[0];
  const last = word[word.length - 1];
  const middle = '*'.repeat(word.length - 2);
  return first + middle + last;
}

// Build regex once — matches whole words only, case-insensitive
const pattern = new RegExp(
  '\\b(' + MASKED_WORDS.join('|') + ')\\b',
  'gi',
);

/**
 * Apply soft masking to a message string.
 * Returns the masked version — safe to store directly.
 */
export function softMaskText(text: string): string {
  return text.replace(pattern, (match) => maskWord(match));
}
