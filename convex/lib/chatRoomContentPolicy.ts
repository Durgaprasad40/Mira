import {
  validateChatRoomMessageLinks,
  type ChatRoomLinkBlockCategory,
} from './chatRoomLinkPolicy';

export type ChatRoomMessageContext = 'room' | 'dm';

export type ChatRoomContentPolicyCode =
  | 'LINK_BLOCKED'
  | 'CONTACT_BLOCKED'
  | 'PAYMENT_BLOCKED'
  | 'EXPLICIT_BLOCKED'
  | 'SAFETY_BLOCKED'
  | 'SPAM_BLOCKED'
  | 'MENTION_FLOOD';

export type ChatRoomContentPolicyResult =
  | { ok: true }
  | { ok: false; code: ChatRoomContentPolicyCode; category?: string };

export type ChatRoomRecentMessageForPolicy = {
  text?: string;
  content?: string;
  mentions?: unknown[];
};

type ChatRoomMentionForPolicy = {
  userId?: unknown;
  nickname?: string;
};

type ValidateChatRoomMessageContentArgs = {
  text: string;
  context: ChatRoomMessageContext;
  recentMessages?: ChatRoomRecentMessageForPolicy[];
  mentions?: ChatRoomMentionForPolicy[];
  allowMentions?: boolean;
};

const OK_RESULT: ChatRoomContentPolicyResult = { ok: true };

const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF\u2060]/g;
const NBSP = /\u00A0/g;
const BRACKETED_DOT = /\s*(?:\(\s*\.\s*\)|\[\s*\.\s*\]|\{\s*\.\s*\})\s*/g;
const DOT_WORD = /\s*(?:\[|\(|\{)?\s*\bd[o0]t\b\s*(?:\]|\)|\})?\s*/gi;
const DIRECT_EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const TEXT_MENTION = /(?:^|\s)@[a-z0-9_][a-z0-9_.-]{0,31}\b/gi;
const SOCIAL_APP = '(?:instagram|insta|ig|facebook|fb|snapchat|snap|telegram|tele|whatsapp|wa|signal|discord)';

function blocked(code: ChatRoomContentPolicyCode, category?: string): ChatRoomContentPolicyResult {
  return category ? { ok: false, code, category } : { ok: false, code };
}

function isBlockedLinkPolicy(
  result: ReturnType<typeof validateChatRoomMessageLinks>
): result is Extract<ReturnType<typeof validateChatRoomMessageLinks>, { ok: false }> {
  return result.ok === false;
}

export function normalizeForScan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(NBSP, ' ')
    .toLowerCase()
    .replace(BRACKETED_DOT, '.')
    .replace(DOT_WORD, '.')
    .replace(/\bi\s*[\s.]\s*g\b/g, 'ig')
    .replace(/\binsta\s+gram\b/g, 'instagram')
    .replace(/\bwhats\s+app\b/g, 'whatsapp')
    .replace(/\btele\s+gram\b/g, 'telegram')
    .replace(/\bface\s+book\b/g, 'facebook')
    .replace(/\bsnap\s+chat\b/g, 'snapchat')
    .replace(/\bdis\s+cord\b/g, 'discord')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForEmailScan(text: string): string {
  return normalizeForScan(text)
    .replace(/\s*(?:\[|\(|\{)?\s*at\s*(?:\]|\)|\})?\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*@\s*/g, '@');
}

function getMessageText(message: ChatRoomRecentMessageForPolicy): string {
  return typeof message.text === 'string'
    ? message.text
    : typeof message.content === 'string'
      ? message.content
      : '';
}

function countTextMentions(text: string): number {
  TEXT_MENTION.lastIndex = 0;
  return [...text.matchAll(TEXT_MENTION)].length;
}

function getMentionCount(message: ChatRoomRecentMessageForPolicy): number {
  if (Array.isArray(message.mentions)) return message.mentions.length;
  return countTextMentions(getMessageText(message));
}

function mapLinkPolicyCategory(category: ChatRoomLinkBlockCategory): ChatRoomContentPolicyResult {
  if (category === 'payment') return blocked('PAYMENT_BLOCKED', 'payment');
  if (category === 'crypto') return blocked('PAYMENT_BLOCKED', 'crypto');
  if (category === 'phone') return blocked('CONTACT_BLOCKED', 'phone');
  return blocked('LINK_BLOCKED', category);
}

function detectEmail(text: string): ChatRoomContentPolicyResult {
  if (DIRECT_EMAIL.test(text) || DIRECT_EMAIL.test(normalizeForEmailScan(text))) {
    return blocked('CONTACT_BLOCKED', 'email');
  }
  return OK_RESULT;
}

function detectContactMigration(normalized: string): ChatRoomContentPolicyResult {
  const patterns = [
    new RegExp(`\\b(?:move|switch|come|go)\\s+(?:to|on|over\\s+to)\\b.{0,30}\\b${SOCIAL_APP}\\b`, 'i'),
    new RegExp(`\\b(?:text|message|msg|dm|add|find|follow|contact|ping|reach|hit|hmu|connect)\\s+(?:me\\s+)?(?:on|at|in|via)?\\s*.{0,20}\\b${SOCIAL_APP}\\b`, 'i'),
    new RegExp(`\\b(?:my|mine)\\s+${SOCIAL_APP}\\s+(?:is|id|handle|user|username)\\b`, 'i'),
    new RegExp(`\\b${SOCIAL_APP}\\s+(?:me|id|handle|user|username|dm)\\b`, 'i'),
  ];

  return patterns.some((pattern) => pattern.test(normalized))
    ? blocked('CONTACT_BLOCKED', 'handle')
    : OK_RESULT;
}

function detectPaymentOrScam(normalized: string): ChatRoomContentPolicyResult {
  if (
    /\b(?:gpay|googlepay|google\s*pay|paytm|phonepe|bhim|cred|mobikwik)\b/i.test(normalized) ||
    /(?:^|[^\w.-])[\w.-]{2,256}@(okaxis|oksbi|okhdfcbank|okicici|ybl|ibl|axl|paytm|upi)\b/i.test(normalized)
  ) {
    return blocked('PAYMENT_BLOCKED', 'upi');
  }

  if (
    /\b(?:ifsc|iban|swift|wire\s*transfer|account\s*number|routing\s*number|sort\s*code)\b/i.test(
      normalized
    )
  ) {
    return blocked('PAYMENT_BLOCKED', 'bank');
  }

  if (
    /\b(?:bitcoin|btc|ethereum|eth|usdt|usdc|trc20|bep20|tron|binance|coinbase|metamask|trust\s*wallet|wallet\s*address|seed\s*phrase)\b/i.test(
      normalized
    ) ||
    /\b0x[a-f0-9]{40}\b/i.test(normalized)
  ) {
    return blocked('PAYMENT_BLOCKED', 'crypto');
  }

  if (/\b(?:forex|trading\s*signals?|mt5|meta\s*trader)\b/i.test(normalized)) {
    return blocked('PAYMENT_BLOCKED', 'forex');
  }

  if (
    /\bguaranteed\s+returns?\b/i.test(normalized) ||
    /\bpassive\s+income\b/i.test(normalized) ||
    /\bdeposit\b.{0,40}\b(?:returns?|profit|trading|forex|platform)\b/i.test(normalized) ||
    /\binvest(?:ment|ing)?\b.{0,40}\b(?:guaranteed|returns?|profit|trading|forex|platform|deposit)\b/i.test(normalized)
  ) {
    return blocked('PAYMENT_BLOCKED', 'investment');
  }

  return OK_RESULT;
}

function detectUnsafeContent(normalized: string): ChatRoomContentPolicyResult {
  const safetyPatterns: Array<[RegExp, string]> = [
    [/\bi'?m\s*(?:1[0-7]|[1-9])\s*(?:years?\s*old|yo|yrs?)\b/i, 'underage'],
    [/\b(?:1[0-7]|[1-9])\s*(?:years?\s*old|yo|yrs?)\b/i, 'underage'],
    [/\b(?:under\s*18|under\s*age|underage|school\s*(?:girl|boy)|jail\s*bait|loli|shota|pedoph|child\s*(?:porn|sex))\b/i, 'underage'],
    [/\b(?:i'?m|im|am)\s+(?:a\s+)?minor\b/i, 'underage'],
    [/\bminor\b.{0,20}\b(?:sex|nude|hookup|date|meet)\b/i, 'underage'],
    [/\b(?:sex|nude|hookup|date|meet)\b.{0,20}\bminor\b/i, 'underage'],
    [/\b(?:rape|forced?\s*(?:sex|her|him|them)|drugged?\s*(?:her|him|them|and)|spiked?\s*(?:drink|her|him)|blackmail|revenge\s*porn|non.?consensual|without\s*(?:her|his|their)\s*consent)\b/i, 'non_consensual'],
    [/\b(?:kill\s+yourself|kys|i\s+will\s+kill\s+you|death\s+threat)\b/i, 'threat'],
  ];

  for (const [pattern, category] of safetyPatterns) {
    if (pattern.test(normalized)) {
      return blocked('SAFETY_BLOCKED', category);
    }
  }

  const explicitPatterns: Array<[RegExp, string]> = [
    [/\b(?:porn|xxx|nudes?|naked|sex\s*tape|sexting?|dick\s*pic|nude?\s*pic|onlyfans|fansly|nsfw|gangbang|orgy|anal\s*(?:sex|play)|blowjob|handjob|cunnilingus|fellatio|dominatrix|bdsm|bondage|hentai|genitals?)\b/i, 'explicit'],
    [/\b(?:escort|prostitut|cam\s*(?:girl|boy)|strip\s*(?:show|tease|club)|sugar\s*(?:daddy|mommy|mama|baby)|financial\s*arrangement|ppm|escort\s*service|full\s*service|gfe|happy\s*ending|buy\s*content|sell\s*content)\b/i, 'solicitation'],
    [/\b(?:pay|paid)\s*(?:for|me)\s*(?:sex|meet|hookup)\b/i, 'solicitation'],
    [/\b(?:cash|money|venmo|cashapp|paypal|zelle)\b.{0,20}\b(?:meet|sex|hookup|date)\b/i, 'solicitation'],
    [/\b(?:sex|hookup|meet)\b.{0,20}\b(?:cash|money|venmo|cashapp|paypal|zelle)\b/i, 'solicitation'],
  ];

  for (const [pattern, category] of explicitPatterns) {
    if (pattern.test(normalized)) {
      return blocked('EXPLICIT_BLOCKED', category);
    }
  }

  return OK_RESULT;
}

function detectRepeatedCopyPaste(
  normalized: string,
  recentMessages: ChatRoomRecentMessageForPolicy[] | undefined
): ChatRoomContentPolicyResult {
  if (!recentMessages || normalized.length < 3) return OK_RESULT;
  const repeatCount = recentMessages.filter((message) => normalizeForScan(getMessageText(message)) === normalized).length;
  return repeatCount >= 2 ? blocked('SPAM_BLOCKED') : OK_RESULT;
}

function detectMentionFlood(
  text: string,
  mentions: ChatRoomMentionForPolicy[] | undefined,
  recentMessages: ChatRoomRecentMessageForPolicy[] | undefined
): ChatRoomContentPolicyResult {
  const parsedMentionCount = Array.isArray(mentions) ? mentions.length : 0;
  const currentMentionCount = Math.max(parsedMentionCount, countTextMentions(text));
  if (currentMentionCount > 5) return blocked('MENTION_FLOOD');

  if (currentMentionCount > 0 && recentMessages) {
    const recentMentionCount = recentMessages.reduce((sum, message) => sum + getMentionCount(message), 0);
    if (recentMentionCount + currentMentionCount > 10) {
      return blocked('MENTION_FLOOD');
    }
  }

  return OK_RESULT;
}

export function validateChatRoomMessageContent({
  text,
  context,
  recentMessages,
  mentions,
  allowMentions = context === 'room',
}: ValidateChatRoomMessageContentArgs): ChatRoomContentPolicyResult {
  if (!text.trim()) {
    return OK_RESULT;
  }

  const normalized = normalizeForScan(text);

  const email = detectEmail(text);
  if (!email.ok) return email;

  const payment = detectPaymentOrScam(normalized);
  if (!payment.ok) return payment;

  const linkPolicy = validateChatRoomMessageLinks(text);
  if (isBlockedLinkPolicy(linkPolicy)) {
    return mapLinkPolicyCategory(linkPolicy.category);
  }

  const contact = detectContactMigration(normalized);
  if (!contact.ok) return contact;

  const unsafe = detectUnsafeContent(normalized);
  if (!unsafe.ok) return unsafe;

  const spam = detectRepeatedCopyPaste(normalized, recentMessages);
  if (!spam.ok) return spam;

  if (allowMentions) {
    const mentionFlood = detectMentionFlood(text, mentions, recentMessages);
    if (!mentionFlood.ok) return mentionFlood;
  }

  return OK_RESULT;
}

export function formatChatRoomContentPolicyError(result: ChatRoomContentPolicyResult): string {
  if (result.ok === false) {
    return result.category ? `${result.code}:${result.category}` : result.code;
  }
  return '';
}
