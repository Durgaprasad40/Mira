/**
 * P0-001: Content moderation filter for Truth & Dare prompts.
 * Server-side version of lib/contentFilter.ts for Convex functions.
 *
 * Categories filtered:
 * - Explicit pornographic keywords
 * - Solicitation (money for sex)
 * - Non-consensual content
 * - Underage signals
 */

// Explicit porn keywords (partial match)
const EXPLICIT_PATTERNS: RegExp[] = [
  /\bp[o0]rn/i,
  /\bxxx\b/i,
  /\bnude[s]?\b/i,
  /\bnaked\b/i,
  /\bsex\s*tape/i,
  /\bsext(ing)?\b/i,
  /\bd[i1]ck\s*pic/i,
  /\bn[u0]de?\s*pic/i,
  /\bstrip\s*(show|tease|club)/i,
  /\bescort\b/i,
  /\bprostitut/i,
  /\bcam\s*girl/i,
  /\bcam\s*boy/i,
  /\bonlyfans/i,
  /\bfansly/i,
  /\bnsfw/i,
  /\bgangbang/i,
  /\borgy\b/i,
  /\banal\s*(sex|play)/i,
  /\bblowjob/i,
  /\bhandjob/i,
  /\bcunnilingus/i,
  /\bfellatio/i,
  /\bdominatrix/i,
  /\bbdsm/i,
  /\bbondage/i,
  /\bfetish\b/i,
  /\bhentai/i,
  /\bgenitals?\b/i,
];

// Solicitation patterns (money for sex)
const SOLICITATION_PATTERNS: RegExp[] = [
  /\b(pay|paid)\s*(for|me)\s*(sex|meet|hookup)/i,
  /\b(cash|money|venmo|cashapp|paypal|zelle)\s*.{0,20}(meet|sex|hookup|date)/i,
  /\b(sex|hookup|meet)\s*.{0,20}(cash|money|venmo|cashapp|paypal|zelle)/i,
  /\bsugar\s*(daddy|mommy|mama|baby)/i,
  /\bfinancial\s*arrangement/i,
  /\bppm\b/i,
  /\bescort\s*service/i,
  /\bfull\s*service/i,
  /\bgfe\b/i,
  /\bhappy\s*ending/i,
  /\b(buy|sell)\s*content/i,
  /\brates?\s*:?\s*\$?\d/i,
];

// Non-consensual content
const NON_CONSENSUAL_PATTERNS: RegExp[] = [
  /\brape\b/i,
  /\bforce(d)?\s*(sex|her|him|them)/i,
  /\bdrug(ged)?\s*(her|him|them|and)/i,
  /\bspiked?\s*(drink|her|him)/i,
  /\bblackmail/i,
  /\brevenge\s*porn/i,
  /\bnon.?consensual/i,
  /\bwithout\s*(her|his|their)\s*consent/i,
];

// Underage signals
const UNDERAGE_PATTERNS: RegExp[] = [
  /\bi'?m\s*(1[0-7]|[1-9])\s*(years?\s*old|yo|yrs)/i,
  /\b(1[0-7]|[1-9])\s*(years?\s*old|yo|yrs)\b/i,
  /\bunder\s*18/i,
  /\bunder\s*age/i,
  /\bunderage/i,
  /\bminor\b/i,
  /\bschool\s*(girl|boy)/i,
  /\bjail\s*bait/i,
  /\bloli\b/i,
  /\bshota\b/i,
  /\bpedoph/i,
  /\bchild\s*(porn|sex)/i,
];

export type ContentCategory = 'explicit' | 'solicitation' | 'non_consensual' | 'underage';

export interface ContentFilterResult {
  isClean: boolean;
  flaggedCategories: ContentCategory[];
}

/**
 * Checks text content against moderation filters.
 * Returns whether the content is clean and which categories were flagged.
 */
export function filterContent(text: string): ContentFilterResult {
  if (!text || text.trim().length === 0) {
    return { isClean: true, flaggedCategories: [] };
  }

  const flaggedCategories: ContentCategory[] = [];

  const checkPatterns = (patterns: RegExp[], category: ContentCategory) => {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        if (!flaggedCategories.includes(category)) {
          flaggedCategories.push(category);
        }
        break; // One match per category is enough
      }
    }
  };

  checkPatterns(EXPLICIT_PATTERNS, 'explicit');
  checkPatterns(SOLICITATION_PATTERNS, 'solicitation');
  checkPatterns(NON_CONSENSUAL_PATTERNS, 'non_consensual');
  checkPatterns(UNDERAGE_PATTERNS, 'underage');

  return {
    isClean: flaggedCategories.length === 0,
    flaggedCategories,
  };
}

/**
 * Quick boolean check — returns true if content passes all filters.
 */
export function isContentClean(text: string): boolean {
  return filterContent(text).isClean;
}
