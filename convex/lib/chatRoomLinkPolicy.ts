export type ChatRoomLinkBlockCategory =
  | 'external_url'
  | 'generic'
  | 'telegram'
  | 'whatsapp'
  | 'social'
  | 'payment'
  | 'crypto'
  | 'shortener'
  | 'phone'
  | 'obfuscated';

export type ChatRoomLinkPolicyResult =
  | { ok: true }
  | { ok: false; code: 'LINK_BLOCKED'; category: ChatRoomLinkBlockCategory };

const OK_RESULT: ChatRoomLinkPolicyResult = { ok: true };

const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF\u2060]/g;
const NBSP = /\u00A0/g;
const DOT_WORD = /\s*(?:\[|\(|\{)?\s*\bd[o0]t\b\s*(?:\]|\)|\})?\s*/gi;
const SPACED_DOT = /\b[a-z0-9]\s+\.\s*[a-z0-9]|\b[a-z0-9]\s*\.\s+[a-z0-9]/i;
// Group 1 = host, group 2 = optional path/query/fragment.
const COMMON_DOMAIN =
  /\b((?:[a-z0-9-]+\.)+(?:com|in|co|app|xyz|net|org|io|me|gg|be))(?::\d{2,5})?([/?#][^\s]*)?/gi;
// Group 1 = host, group 2 = path/query/fragment (may be empty).
const URL_SCHEME = /\bhttps?:\/\/([^\s/?#]+)([^\s]*)/gi;
// Group 1 = host (without leading www.), group 2 = path/query/fragment.
const WWW_HOST = /\bwww\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)([^\s]*)/gi;
const PHONE_CANDIDATE = /(?:^|[^\d])(\+?\d[\d\s().-]{8,}\d)(?=$|[^\d])/g;

const ALLOWED_MIRA_HOSTS = new Set([
  'mira.app',
  'www.mira.app',
  'support.mira.app',
  'policies.mira.app',
]);

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);
const WHATSAPP_HOSTS = new Set(['wa.me', 'whatsapp.com', 'chat.whatsapp.com', 'api.whatsapp.com']);
const SOCIAL_HOSTS = new Set([
  'instagram.com',
  'facebook.com',
  'fb.com',
  'fb.me',
  'snapchat.com',
  'snap.com',
  'discord.gg',
  'discord.com',
  'signal.org',
  'signal.me',
]);
const PAYMENT_HOSTS = new Set(['paytm.me']);
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'cutt.ly',
  'is.gd',
  'ow.ly',
  'rebrand.ly',
  'lnkd.in',
]);

// YouTube allowlist: only the canonical hosts are eligible. Subdomain abuse like
// `evil.youtube.com` or `youtube.com.evil.com` will not match because the lookup is
// an exact-host match against `cleanHost(host)`.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

function blocked(category: ChatRoomLinkBlockCategory): ChatRoomLinkPolicyResult {
  return { ok: false, code: 'LINK_BLOCKED', category };
}

function normalizeForScan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(NBSP, ' ')
    .toLowerCase()
    .trim()
    .replace(DOT_WORD, '.')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*:\s*/g, ':');
}

function hasDotObfuscation(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(ZERO_WIDTH_CHARS, '').toLowerCase();
  DOT_WORD.lastIndex = 0;
  return DOT_WORD.test(normalized) || SPACED_DOT.test(normalized);
}

function cleanHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9.-]+$/, '')
    .replace(/\.$/, '');
}

function withoutWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

function isAllowedMiraHost(host: string): boolean {
  const cleaned = cleanHost(host);
  return ALLOWED_MIRA_HOSTS.has(cleaned) || ALLOWED_MIRA_HOSTS.has(withoutWww(cleaned));
}

function hostMatches(host: string, blockedHosts: Set<string>): boolean {
  const cleaned = withoutWww(cleanHost(host));
  for (const blockedHost of blockedHosts) {
    if (cleaned === blockedHost || cleaned.endsWith(`.${blockedHost}`)) {
      return true;
    }
  }
  return false;
}

interface UrlMatch {
  host: string;
  path: string;
}

function collectUrls(text: string): UrlMatch[] {
  const urls: UrlMatch[] = [];
  for (const match of text.matchAll(URL_SCHEME)) {
    urls.push({ host: cleanHost(match[1] ?? ''), path: match[2] ?? '' });
  }
  for (const match of text.matchAll(WWW_HOST)) {
    urls.push({ host: cleanHost(`www.${match[1] ?? ''}`), path: match[2] ?? '' });
  }
  for (const match of text.matchAll(COMMON_DOMAIN)) {
    urls.push({ host: cleanHost(match[1] ?? ''), path: match[2] ?? '' });
  }
  return urls.filter((u) => u.host);
}

function collectHosts(text: string): string[] {
  return collectUrls(text).map((u) => u.host);
}

function containsHost(text: string, hosts: Set<string>): boolean {
  return collectHosts(text).some((host) => hostMatches(host, hosts));
}

function splitPathQuery(path: string): { pathname: string; query: string } {
  const hashIdx = path.indexOf('#');
  const noHash = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
  const qIdx = noHash.indexOf('?');
  if (qIdx < 0) {
    return { pathname: noHash || '/', query: '' };
  }
  return { pathname: noHash.slice(0, qIdx) || '/', query: noHash.slice(qIdx + 1) };
}

function decodeQueryValue(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, '%20'));
  } catch {
    return raw;
  }
}

function extractQueryParam(query: string, name: string): string | null {
  if (!query) return null;
  for (const part of query.split('&')) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const key = part.slice(0, eqIdx);
    if (key === name) {
      return decodeQueryValue(part.slice(eqIdx + 1));
    }
  }
  return null;
}

function isAllowedYouTubeUrl(host: string, path: string): boolean {
  const cleaned = cleanHost(host);
  if (!YOUTUBE_HOSTS.has(cleaned)) return false;

  const { pathname, query } = splitPathQuery(path || '/');

  if (cleaned === 'youtu.be') {
    // youtu.be/<videoId> only — no nested paths, no redirect endpoints.
    const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!trimmed || trimmed.includes('/')) return false;
    return YOUTUBE_VIDEO_ID.test(trimmed);
  }

  if (cleaned === 'youtube-nocookie.com' || cleaned === 'www.youtube-nocookie.com') {
    const embedMatch = /^\/embed\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
    return !!embedMatch && YOUTUBE_VIDEO_ID.test(embedMatch[1]);
  }

  // youtube.com / www.youtube.com / m.youtube.com
  if (pathname === '/watch' || pathname === '/watch/') {
    const v = extractQueryParam(query, 'v');
    return !!v && YOUTUBE_VIDEO_ID.test(v);
  }

  const shortsMatch = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  if (shortsMatch) return YOUTUBE_VIDEO_ID.test(shortsMatch[1]);

  const liveMatch = /^\/live\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  if (liveMatch) return YOUTUBE_VIDEO_ID.test(liveMatch[1]);

  // Anything else (/, /redirect, /channel, /@user, /community, /post, /comments, etc.) is blocked.
  return false;
}

function isAllowedExternalUrl(url: UrlMatch): boolean {
  return isAllowedMiraHost(url.host) || isAllowedYouTubeUrl(url.host, url.path);
}

function containsBlockedExternalUrl(text: string): boolean {
  return collectUrls(text).some((u) => !isAllowedExternalUrl(u));
}

function containsRawUrlPrefix(text: string): boolean {
  return /\bhttps?:\/\//i.test(text) || /\bwww\./i.test(text);
}

function containsPaymentHandle(text: string): boolean {
  return (
    /\bupi:\/\//i.test(text) ||
    /\b(?:gpay|googlepay|google\s+pay|phonepe|paytm)\b/i.test(text) ||
    /(?:^|[^\w.-])[\w.-]{2,256}@(okaxis|ybl|paytm|upi)\b/i.test(text)
  );
}

function containsCryptoPattern(text: string): boolean {
  return (
    /\b(?:bitcoin|ethereum):[^\s]*/i.test(text) ||
    /\b0x[a-f0-9]{40}\b/i.test(text) ||
    /\b(?:crypto|usdt|btc|eth|binance|coinbase|metamask|trust\s*wallet|wallet\s*address|seed\s*phrase)\b/i.test(
      text
    )
  );
}

function containsPhoneNumber(text: string): boolean {
  PHONE_CANDIDATE.lastIndex = 0;
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const digits = (match[1] ?? '').replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) return true;
  }
  return false;
}

export function validateChatRoomMessageLinks(text: string): ChatRoomLinkPolicyResult {
  if (!text.trim()) return OK_RESULT;

  const normalized = normalizeForScan(text);
  const hadDotObfuscation = hasDotObfuscation(text);

  if (/\btg:\/\//i.test(normalized) || containsHost(normalized, TELEGRAM_HOSTS)) {
    return blocked('telegram');
  }

  if (/\bwhatsapp:\/\//i.test(normalized) || containsHost(normalized, WHATSAPP_HOSTS)) {
    return blocked('whatsapp');
  }

  if (containsHost(normalized, SOCIAL_HOSTS)) {
    return blocked('social');
  }

  if (containsHost(normalized, PAYMENT_HOSTS) || containsPaymentHandle(normalized)) {
    return blocked('payment');
  }

  if (containsCryptoPattern(normalized)) {
    return blocked('crypto');
  }

  if (containsHost(normalized, SHORTENER_HOSTS)) {
    return blocked('shortener');
  }

  if (containsPhoneNumber(normalized)) {
    return blocked('phone');
  }

  if (containsBlockedExternalUrl(normalized)) {
    return blocked(hadDotObfuscation ? 'obfuscated' : 'generic');
  }

  if (containsRawUrlPrefix(normalized)) {
    const urls = collectUrls(normalized);
    if (urls.length === 0 || urls.some((u) => !isAllowedExternalUrl(u))) {
      return blocked('generic');
    }
  }

  return OK_RESULT;
}
