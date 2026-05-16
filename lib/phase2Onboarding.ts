import type { Phase1ProfileData } from '@/stores/privateProfileStore';

export type Phase2OnboardingStep =
  | 'index'
  | 'select-photos'
  | 'profile-edit'
  | 'prompts'
  | 'profile-setup'
  | 'complete';

export const PHASE2_ONBOARDING_ROUTE_MAP: Record<Exclude<Phase2OnboardingStep, 'complete'>, string> = {
  index: '/(main)/phase2-onboarding',
  'select-photos': '/(main)/phase2-onboarding/select-photos',
  'profile-edit': '/(main)/phase2-onboarding/profile-edit',
  prompts: '/(main)/phase2-onboarding/prompts',
  'profile-setup': '/(main)/phase2-onboarding/profile-setup',
};

export const PHASE2_ONBOARDING_STEP_ORDER: Record<Exclude<Phase2OnboardingStep, 'complete'>, number> = {
  index: 1,
  'select-photos': 2,
  'profile-edit': 3,
  prompts: 4,
  'profile-setup': 5,
};

export const PHASE2_NICKNAME_MIN_LENGTH = 3;
export const PHASE2_NICKNAME_MAX_LENGTH = 20;
export const PHASE2_NICKNAME_MAX_DIGIT_RUN = 3; // max consecutive digits allowed

// Long blocked tokens — substring match (case-insensitive) is enough because
// these strings are unlikely to appear inside normal names.
export const PHASE2_NICKNAME_BLOCKED_LONG_TOKENS: readonly string[] = [
  'instagram', 'insta',
  'facebook',
  'telegram', 'tele',
  'snapchat', 'snap',
  'whatsapp', 'whtsapp', 'wapp',
  'twitter',
  'tiktok', 'tikt',
  'discord', 'dscrd',
  'youtube',
  'phone', 'mobile', 'number', 'contact',
  'email', 'gmail', 'yahoo', 'outlook',
  'http', 'https', 'www',
  'onlyfans',
];

// Short blocked tokens — boundary-aware. We only block when the token is the
// entire nickname, sits at the start followed by a digit, or is preceded by a
// digit. This avoids false-positives on common names that happen to contain
// these letter pairs (e.g. "Iggy", "Coraline", "Indra", "Awan").
export const PHASE2_NICKNAME_BLOCKED_SHORT_TOKENS: readonly string[] = [
  'ig', // Instagram
  'fb', // Facebook
  'tg', // Telegram
  'wa', // WhatsApp
];

export type NicknameValidationCode =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'BAD_CHARSET'
  | 'DIGIT_RUN'
  | 'HANDLE_TOKEN';

export type NicknameValidationResult =
  | { ok: true }
  | { ok: false; code: NicknameValidationCode; message: string };

export const PHASE2_NICKNAME_ERROR_MESSAGES: Record<NicknameValidationCode, string> = {
  TOO_SHORT: 'A bit longer — at least 3 characters.',
  TOO_LONG: 'Keep it under 20 characters.',
  BAD_CHARSET: 'Letters and numbers only — no spaces or symbols.',
  DIGIT_RUN: 'Avoid long number runs (max 3 in a row).',
  HANDLE_TOKEN: 'Looks like a handle or contact — try a nickname instead.',
};

export const sanitizeNickname = (value: string): string => value.replace(/[^a-zA-Z0-9]/g, '');

/**
 * Validate a Phase-2 private-mode nickname.
 *
 * Rules (in priority order — only the first failing rule is returned):
 *  1. Length 3..20 (after trim).
 *  2. Alphanumeric only (no spaces, no @, no dots, no symbols).
 *  3. No 4-or-more consecutive digits (so "Durga123" passes, "Durga1234" fails).
 *  4. No blocked long-token substrings (case-insensitive): instagram, facebook,
 *     telegram, snapchat, whatsapp, phone, number, contact, email, gmail,
 *     http, www, onlyfans, etc.
 *  5. No blocked short tokens (ig/fb/tg/wa) when boundary-aware (entire string,
 *     start + digit, or preceded by digit).
 *
 * Returns `{ ok: true }` when valid, otherwise an `{ ok: false, code, message }`
 * object with a friendly single-line user-facing message.
 *
 * P3-DRIFT-01 / P3-F6 DRIFT WARNING — this validator is UX-ONLY.
 *   The authoritative source of truth lives in the backend:
 *     `validatePhase2DisplayName` in `convex/privateProfiles.ts`.
 *   If you change any rule here (length bounds, charset, digit-run cap,
 *   long/short blocked-token lists), you MUST mirror the change in the
 *   backend or a request that the UI accepted will be rejected at save
 *   time (or worse, vice-versa). The rule constants and token lists are
 *   intentionally duplicated rather than shared to keep `lib/*` free of
 *   `convex/*` imports — a code-review check, not a build-time check.
 *
 *   Backend mirror (grep `P3-DRIFT-01` in convex/privateProfiles.ts):
 *     PHASE2_NICKNAME_MIN_LENGTH      ↔ PHASE2_DISPLAY_NAME_MIN_LENGTH
 *     PHASE2_NICKNAME_MAX_LENGTH      ↔ PHASE2_DISPLAY_NAME_MAX_LENGTH
 *     PHASE2_NICKNAME_MAX_DIGIT_RUN   ↔ PHASE2_DISPLAY_NAME_MAX_DIGIT_RUN
 *     PHASE2_NICKNAME_BLOCKED_LONG_TOKENS  ↔ PHASE2_DISPLAY_NAME_BLOCKED_LONG_TOKENS
 *     PHASE2_NICKNAME_BLOCKED_SHORT_TOKENS ↔ PHASE2_DISPLAY_NAME_BLOCKED_SHORT_TOKENS
 */
export function validateNickname(value: string): NicknameValidationResult {
  const trimmed = value.trim();

  if (trimmed.length < PHASE2_NICKNAME_MIN_LENGTH) {
    return { ok: false, code: 'TOO_SHORT', message: PHASE2_NICKNAME_ERROR_MESSAGES.TOO_SHORT };
  }
  if (trimmed.length > PHASE2_NICKNAME_MAX_LENGTH) {
    return { ok: false, code: 'TOO_LONG', message: PHASE2_NICKNAME_ERROR_MESSAGES.TOO_LONG };
  }
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return { ok: false, code: 'BAD_CHARSET', message: PHASE2_NICKNAME_ERROR_MESSAGES.BAD_CHARSET };
  }
  // Reject 4+ consecutive digits.
  if (new RegExp(`\\d{${PHASE2_NICKNAME_MAX_DIGIT_RUN + 1},}`).test(trimmed)) {
    return { ok: false, code: 'DIGIT_RUN', message: PHASE2_NICKNAME_ERROR_MESSAGES.DIGIT_RUN };
  }

  const lower = trimmed.toLowerCase();

  for (const token of PHASE2_NICKNAME_BLOCKED_LONG_TOKENS) {
    if (lower.includes(token)) {
      return { ok: false, code: 'HANDLE_TOKEN', message: PHASE2_NICKNAME_ERROR_MESSAGES.HANDLE_TOKEN };
    }
  }

  for (const token of PHASE2_NICKNAME_BLOCKED_SHORT_TOKENS) {
    if (lower === token) {
      return { ok: false, code: 'HANDLE_TOKEN', message: PHASE2_NICKNAME_ERROR_MESSAGES.HANDLE_TOKEN };
    }
    // token at start of string immediately followed by a digit (e.g. "ig123")
    if (new RegExp(`^${token}\\d`).test(lower)) {
      return { ok: false, code: 'HANDLE_TOKEN', message: PHASE2_NICKNAME_ERROR_MESSAGES.HANDLE_TOKEN };
    }
    // token preceded by a digit anywhere (e.g. "123ig", "abc123ig")
    if (new RegExp(`\\d${token}`).test(lower)) {
      return { ok: false, code: 'HANDLE_TOKEN', message: PHASE2_NICKNAME_ERROR_MESSAGES.HANDLE_TOKEN };
    }
  }

  return { ok: true };
}

/** Boolean wrapper kept for callers that don't need the error message. */
export const isValidNickname = (value: string): boolean => validateNickname(value).ok;

type Phase1Photo = {
  order?: number | null;
  url?: string | null;
};

export type Phase1UserForImport = {
  name?: string | null;
  handle?: string | null;
  photos?: Phase1Photo[] | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  city?: string | null;
  activities?: string[] | null;
  isVerified?: boolean | null;
  height?: number | null;
  weight?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  education?: string | null;
  religion?: string | null;
};

export function buildPhase1ImportData(currentUser: Phase1UserForImport): Phase1ProfileData {
  const sortedPhotos = Array.isArray(currentUser.photos)
    ? [...currentUser.photos]
        .filter((photo): photo is { order?: number | null; url: string } => typeof photo?.url === 'string' && photo.url.length > 0)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  return {
    name: currentUser.name || '',
    handle: currentUser.handle || '',
    photos: sortedPhotos.map((photo) => ({ url: photo.url })),
    dateOfBirth: currentUser.dateOfBirth || '',
    gender: currentUser.gender || '',
    city: currentUser.city || '',
    activities: currentUser.activities || [],
    isVerified: currentUser.isVerified || false,
    height: currentUser.height ?? null,
    weight: currentUser.weight ?? null,
    smoking: currentUser.smoking ?? null,
    drinking: currentUser.drinking ?? null,
    education: currentUser.education ?? null,
    religion: currentUser.religion ?? null,
  };
}
