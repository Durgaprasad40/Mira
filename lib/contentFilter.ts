/**
 * Content moderation filter for user-generated content.
 * Used for messages, bios, room titles, T&D prompts, and Desire Bio.
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
  /\bppm\b/i, // "pay per meet"
  /\bescort\s*service/i,
  /\bfull\s*service/i,
  /\bgfe\b/i, // "girlfriend experience" in solicitation context
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

export interface ContentFilterResult {
  isClean: boolean;
  flaggedCategories: ('explicit' | 'solicitation' | 'non_consensual' | 'underage')[];
  flaggedPatterns: string[];
}

/**
 * Checks text content against moderation filters.
 * Returns whether the content is clean and which categories were flagged.
 */
export function filterContent(text: string): ContentFilterResult {
  if (!text || text.trim().length === 0) {
    return { isClean: true, flaggedCategories: [], flaggedPatterns: [] };
  }

  const flaggedCategories: ContentFilterResult['flaggedCategories'] = [];
  const flaggedPatterns: string[] = [];

  const checkPatterns = (
    patterns: RegExp[],
    category: ContentFilterResult['flaggedCategories'][number],
  ) => {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        if (!flaggedCategories.includes(category)) {
          flaggedCategories.push(category);
        }
        flaggedPatterns.push(pattern.source);
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
    flaggedPatterns,
  };
}

/**
 * Quick boolean check — returns true if content passes all filters.
 */
export function isContentClean(text: string): boolean {
  return filterContent(text).isClean;
}

/**
 * Returns a user-facing error message for flagged content.
 */
export function getFilterMessage(result: ContentFilterResult): string {
  if (result.isClean) return '';

  if (result.flaggedCategories.includes('underage')) {
    return 'This content has been flagged for containing underage references. This is strictly prohibited.';
  }
  if (result.flaggedCategories.includes('non_consensual')) {
    return 'This content has been flagged for containing non-consensual references. This is strictly prohibited.';
  }
  if (result.flaggedCategories.includes('solicitation')) {
    return 'This content appears to contain solicitation. Paid meetups and services are not allowed.';
  }
  if (result.flaggedCategories.includes('explicit')) {
    return 'This content contains explicit material that is not allowed. Please keep conversations respectful.';
  }

  return 'This content was flagged by our moderation system. Please revise.';
}

/**
 * Filters room names — stricter filter that also blocks suggestive room names.
 */
const ROOM_NAME_BLOCKED: RegExp[] = [
  ...EXPLICIT_PATTERNS,
  ...SOLICITATION_PATTERNS,
  /\b18\+/i,
  /\badult/i,
  /\bsexy/i,
  /\bhot\s*(girls?|guys?|singles?)/i,
  /\bnaughty/i,
  /\bwild\s*(night|chat)/i,
  /\bafter\s*dark/i,
  /\bmidnight\s*(fun|meet)/i,
];

export function isRoomNameAllowed(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  for (const pattern of ROOM_NAME_BLOCKED) {
    if (pattern.test(name)) return false;
  }
  return true;
}

// ── D2: Content masking / hiding per store compliance rules ──

/** All explicit patterns combined (for masking) */
const ALL_MASK_PATTERNS: RegExp[] = [
  ...EXPLICIT_PATTERNS,
  ...SOLICITATION_PATTERNS,
  ...NON_CONSENSUAL_PATTERNS,
  ...UNDERAGE_PATTERNS,
];

/**
 * D2 — Private chat: mask explicit words with "****".
 * Returns { masked, wasMasked }.
 */
export function maskExplicitWords(text: string): { masked: string; wasMasked: boolean } {
  if (!text || text.trim().length === 0) return { masked: text, wasMasked: false };

  let masked = text;
  let wasMasked = false;

  for (const pattern of ALL_MASK_PATTERNS) {
    // Create a global version to replace all occurrences
    const globalPattern = new RegExp(pattern.source, 'gi');
    if (globalPattern.test(masked)) {
      wasMasked = true;
      masked = masked.replace(new RegExp(pattern.source, 'gi'), '****');
    }
  }

  return { masked, wasMasked };
}

/**
 * D2 — Public surfaces (profile cards, explore previews, room lists):
 * If text contains explicit content, return placeholder instead.
 */
export const PUBLIC_SURFACE_PLACEHOLDER = 'Private preferences available after match';

export function textForPublicSurface(text: string): string {
  if (!text || text.trim().length === 0) return '';
  const result = filterContent(text);
  if (!result.isClean) return PUBLIC_SURFACE_PLACEHOLDER;
  return text;
}

/**
 * D2 — Notice shown when message text is masked in private chat.
 */
export const MASKED_CONTENT_NOTICE = 'Some text hidden due to community guidelines';

/**
 * D3 — Generic notification text for Face 2 messages.
 * Never show actual message content in push notifications.
 */
export const PRIVATE_NOTIFICATION_TEXT = 'You have a new message';
