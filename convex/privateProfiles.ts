import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { isPrivateDataDeleted } from './privateDeletion';
import { resolveUserIdByAuthId, validateOwnership, validateSessionToken } from './helpers';
import { reserveActionSlots } from './actionRateLimits';
import {
  CURRENT_PHASE2_SETUP_VERSION,
  PHASE2_BOUNDARY_KEYS,
  PHASE2_DESIRE_TAG_KEYS,
  PHASE2_INTENT_KEYS,
  sanitizePhase2PromptAnswersForBackend,
} from './phase2Constants';
import { validateOwnedSafePrivatePhotoUrls } from './phase2PrivatePhotos';

const PHASE2_PRIVATE_BIO_MIN_LENGTH = 20;
const PHASE2_PRIVATE_BIO_MAX_LENGTH = 300;

// P3-DRIFT-01: Phase-2 nickname (displayName) validation — kept in sync with
// `lib/phase2Onboarding.ts > validateNickname`. Convex source files cannot
// import from the app code path, so the rules are mirrored here. If you change
// either side, update the other.
//
// Mirrored constants (must stay byte-identical with lib/phase2Onboarding.ts):
//   - PHASE2_DISPLAY_NAME_MIN_LENGTH      ↔ PHASE2_NICKNAME_MIN_LENGTH
//   - PHASE2_DISPLAY_NAME_MAX_LENGTH      ↔ PHASE2_NICKNAME_MAX_LENGTH
//   - PHASE2_DISPLAY_NAME_MAX_DIGIT_RUN   ↔ PHASE2_NICKNAME_MAX_DIGIT_RUN
//   - PHASE2_DISPLAY_NAME_BLOCKED_LONG_TOKENS  ↔ PHASE2_NICKNAME_BLOCKED_LONG_TOKENS
//   - PHASE2_DISPLAY_NAME_BLOCKED_SHORT_TOKENS ↔ PHASE2_NICKNAME_BLOCKED_SHORT_TOKENS
//
// Drift consequence: if the backend list is stricter, the UI will accept a
// nickname that the save mutation then rejects with a HANDLE_TOKEN error.
// If the backend is looser, a hostile actor could bypass UI filtering by
// posting the mutation directly. The backend is the source of truth — UI
// rules exist for fast feedback only.
const PHASE2_DISPLAY_NAME_MIN_LENGTH = 3;
const PHASE2_DISPLAY_NAME_MAX_LENGTH = 20;
const PHASE2_DISPLAY_NAME_MAX_DIGIT_RUN = 3;
const PHASE2_DISPLAY_NAME_BLOCKED_LONG_TOKENS: readonly string[] = [
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
const PHASE2_DISPLAY_NAME_BLOCKED_SHORT_TOKENS: readonly string[] = [
  'ig', 'fb', 'tg', 'wa',
];

type PhaseDisplayNameValidationCode =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'BAD_CHARSET'
  | 'DIGIT_RUN'
  | 'HANDLE_TOKEN';

/**
 * Backend Phase-2 display-name validator — SOURCE OF TRUTH.
 *
 * P3-F6 DRIFT WARNING — this is the authoritative validator. Every
 * Phase-2 mutation that accepts a display name (saveOnboardingPhotos,
 * updateDisplayNameByAuthId, and any future writer) MUST route through
 * this function before persisting.
 *
 * A friendlier mirror lives at `validateNickname` in
 * `lib/phase2Onboarding.ts` and is used for live UI feedback only.
 * The frontend copy is UX-only and CANNOT be trusted at the trust
 * boundary — even if the UI accepts a value, this function may still
 * reject it.
 *
 * If you change any rule here (length bounds, charset, digit-run cap,
 * long/short blocked-token lists), you MUST update the frontend mirror
 * in the same change, otherwise users will see a "valid" input that
 * then fails to save.
 */
function validatePhase2DisplayName(
  raw: string,
): { ok: true; trimmed: string } | { ok: false; code: PhaseDisplayNameValidationCode } {
  const trimmed = raw.trim();
  if (trimmed.length < PHASE2_DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, code: 'TOO_SHORT' };
  }
  if (trimmed.length > PHASE2_DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, code: 'TOO_LONG' };
  }
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
    return { ok: false, code: 'BAD_CHARSET' };
  }
  if (new RegExp(`\\d{${PHASE2_DISPLAY_NAME_MAX_DIGIT_RUN + 1},}`).test(trimmed)) {
    return { ok: false, code: 'DIGIT_RUN' };
  }

  const lower = trimmed.toLowerCase();
  for (const token of PHASE2_DISPLAY_NAME_BLOCKED_LONG_TOKENS) {
    if (lower.includes(token)) {
      return { ok: false, code: 'HANDLE_TOKEN' };
    }
  }
  for (const token of PHASE2_DISPLAY_NAME_BLOCKED_SHORT_TOKENS) {
    if (lower === token) {
      return { ok: false, code: 'HANDLE_TOKEN' };
    }
    if (new RegExp(`^${token}\\d`).test(lower)) {
      return { ok: false, code: 'HANDLE_TOKEN' };
    }
    if (new RegExp(`\\d${token}`).test(lower)) {
      return { ok: false, code: 'HANDLE_TOKEN' };
    }
  }

  return { ok: true, trimmed };
}
const PHASE2_HEIGHT_MIN = 120;
const PHASE2_HEIGHT_MAX = 230;
const PHASE2_WEIGHT_MIN = 30;
const PHASE2_WEIGHT_MAX = 250;

const PHASE2_INTENT_KEY_SET = new Set<string>(PHASE2_INTENT_KEYS);
const PHASE2_DESIRE_TAG_KEY_SET = new Set<string>(PHASE2_DESIRE_TAG_KEYS);
const PHASE2_BOUNDARY_KEY_SET = new Set<string>(PHASE2_BOUNDARY_KEYS);
const PHASE2_SMOKING_VALUES = new Set<string>([
  'never',
  'sometimes',
  'often',
  'trying_to_quit',
  // Backward-compatible existing app values.
  'regularly',
]);
const PHASE2_DRINKING_VALUES = new Set<string>([
  'never',
  'socially',
  'often',
  // Backward-compatible existing app values.
  'regularly',
  'sober',
]);
const PHASE2_EDUCATION_VALUES = new Set<string>([
  'high_school',
  'college',
  'grad_school',
  'phd',
  'other',
  // Backward-compatible existing app values.
  'some_college',
  'trade_school',
  'bachelors',
  'masters',
  'doctorate',
]);
const PHASE2_RELIGION_VALUES = new Set<string>([
  'hindu',
  'muslim',
  'christian',
  'sikh',
  'buddhist',
  'jain',
  'none',
  'other',
  // Backward-compatible existing app values.
  'jewish',
  'atheist',
  'agnostic',
  'spiritual',
  'prefer_not_to_say',
]);

function calculateAgeFromDOB(dob: string | undefined | null): number {
  // Mirror Phase-1 backend behavior: accept any parsable date string (ISO or YYYY-MM-DD).
  if (!dob) return 0;
  const today = new Date();
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 && age < 120 ? age : 0;
}

function ageFromUser(user: any): number {
  // SECURITY (P0-2): Canonical source of truth = users.dateOfBirth (Phase-1).
  // calculateAgeFromDOB returns 0 when DOB is missing, unparseable, or
  // out-of-range. Callers gating adult content (e.g. `derivedAge >= 18`)
  // therefore safely evaluate to `false` for any missing/invalid DOB —
  // never silently treat absent DOB as 18+. Do not introduce a fallback
  // that returns a non-zero default; that would defeat the gate.
  const dob = user?.dateOfBirth;
  return calculateAgeFromDOB(typeof dob === 'string' ? dob : null);
}

function sanitizePrivateBio(
  privateBio: string | undefined,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (privateBio === undefined) {
    return { ok: true };
  }

  const trimmed = privateBio.trim();
  if (
    trimmed.length < PHASE2_PRIVATE_BIO_MIN_LENGTH ||
    trimmed.length > PHASE2_PRIVATE_BIO_MAX_LENGTH
  ) {
    return {
      ok: false,
      error: `private_bio must be ${PHASE2_PRIVATE_BIO_MIN_LENGTH}-${PHASE2_PRIVATE_BIO_MAX_LENGTH} characters`,
    };
  }

  return { ok: true, value: trimmed };
}

function validateEnumKeys(
  keys: string[] | undefined,
  allowedKeys: Set<string>,
  fieldName: string,
): { ok: true } | { ok: false; error: string } {
  if (!keys) {
    return { ok: true };
  }

  const hasUnknownKey = keys.some((key) => !allowedKeys.has(key));
  if (hasUnknownKey) {
    return { ok: false, error: `invalid_${fieldName}` };
  }

  return { ok: true };
}

function sanitizeEnumKeysForSave(
  keys: string[] | undefined,
  allowedKeys: Set<string>,
): string[] | undefined {
  if (keys === undefined) {
    return undefined;
  }

  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const key of keys) {
    if (!allowedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    sanitized.push(key);
  }
  return sanitized;
}

function sanitizePrivateIntentKeysForSave(
  keys: string[] | undefined,
  legacyPrivateIntentKey?: string | null,
): string[] | undefined {
  const sanitizedKeys = sanitizeEnumKeysForSave(keys, PHASE2_INTENT_KEY_SET);
  if (sanitizedKeys !== undefined) {
    return sanitizedKeys;
  }

  if (legacyPrivateIntentKey === undefined || legacyPrivateIntentKey === null) {
    return undefined;
  }

  return PHASE2_INTENT_KEY_SET.has(legacyPrivateIntentKey)
    ? [legacyPrivateIntentKey]
    : [];
}

function sanitizePrivateDesireTagKeysForSave(keys: string[] | undefined): string[] | undefined {
  return sanitizeEnumKeysForSave(keys, PHASE2_DESIRE_TAG_KEY_SET);
}

// P2-1: Notification-preference rate-limit constants removed. Limiting now
// flows through the canonical `reserveActionSlots` infrastructure (see the
// `phase2_private_notification_prefs` action key inside
// `setPhase2NotificationPreferences`), so the ad-hoc audit-log-count window
// is no longer used or referenced anywhere.

function normalizeNotificationCategorySettings(
  categories:
    | {
        deepConnect?: boolean;
        privateMessages?: boolean;
        chatRooms?: boolean;
        truthOrDare?: boolean;
      }
    | undefined,
) {
  return {
    deepConnect: categories?.deepConnect,
    privateMessages: categories?.privateMessages,
    chatRooms: categories?.chatRooms,
    truthOrDare: categories?.truthOrDare,
  };
}

function notificationCategorySettingsEqual(
  left:
    | {
        deepConnect?: boolean;
        privateMessages?: boolean;
        chatRooms?: boolean;
        truthOrDare?: boolean;
      }
    | undefined,
  right:
    | {
        deepConnect?: boolean;
        privateMessages?: boolean;
        chatRooms?: boolean;
        truthOrDare?: boolean;
      }
    | undefined,
) {
  const normalizedLeft = normalizeNotificationCategorySettings(left);
  const normalizedRight = normalizeNotificationCategorySettings(right);
  return (
    normalizedLeft.deepConnect === normalizedRight.deepConnect &&
    normalizedLeft.privateMessages === normalizedRight.privateMessages &&
    normalizedLeft.chatRooms === normalizedRight.chatRooms &&
    normalizedLeft.truthOrDare === normalizedRight.truthOrDare
  );
}

function validateOptionalRangeNumber(
  value: number | null | undefined,
  min: number,
  max: number,
  fieldName: string,
): { ok: true } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (!Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `invalid_${fieldName}` };
  }

  return { ok: true };
}

function validateOptionalEnumValue(
  value: string | null | undefined,
  allowedValues: Set<string>,
  fieldName: string,
): { ok: true } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (!allowedValues.has(value)) {
    return { ok: false, error: `invalid_${fieldName}` };
  }

  return { ok: true };
}

function validateLifestyleFields(args: {
  height?: number | null;
  weight?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  education?: string | null;
  religion?: string | null;
}): { ok: true } | { ok: false; error: string } {
  const heightValidation = validateOptionalRangeNumber(
    args.height,
    PHASE2_HEIGHT_MIN,
    PHASE2_HEIGHT_MAX,
    'height',
  );
  if (!heightValidation.ok) return heightValidation;

  const weightValidation = validateOptionalRangeNumber(
    args.weight,
    PHASE2_WEIGHT_MIN,
    PHASE2_WEIGHT_MAX,
    'weight',
  );
  if (!weightValidation.ok) return weightValidation;

  const smokingValidation = validateOptionalEnumValue(
    args.smoking,
    PHASE2_SMOKING_VALUES,
    'smoking',
  );
  if (!smokingValidation.ok) return smokingValidation;

  const drinkingValidation = validateOptionalEnumValue(
    args.drinking,
    PHASE2_DRINKING_VALUES,
    'drinking',
  );
  if (!drinkingValidation.ok) return drinkingValidation;

  const educationValidation = validateOptionalEnumValue(
    args.education,
    PHASE2_EDUCATION_VALUES,
    'education',
  );
  if (!educationValidation.ok) return educationValidation;

  const religionValidation = validateOptionalEnumValue(
    args.religion,
    PHASE2_RELIGION_VALUES,
    'religion',
  );
  if (!religionValidation.ok) return religionValidation;

  return { ok: true };
}

export const debugAgeSourcesByAuthUserId = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return { success: false as const, error: 'user_not_found' as const };
    }
    const user = await ctx.db.get(userId);
    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    return {
      success: true as const,
      userId,
      userDateOfBirth: (user as any)?.dateOfBirth ?? null,
      derivedAgeFromDob: ageFromUser(user),
      privateProfileAge: (profile as any)?.age ?? null,
      hasPrivateProfile: Boolean(profile),
    };
  },
});

export const backfillPrivateProfileAgeByAuthUserId = internalMutation({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      return { success: false as const, error: 'user_not_found' as const };
    }
    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false as const, error: 'user_not_found' as const };
    }
    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    if (!profile) {
      return { success: false as const, error: 'profile_not_found' as const };
    }

    const nextAge = ageFromUser(user);
    if (!nextAge || nextAge <= 0) {
      return { success: false as const, error: 'missing_or_invalid_dob' as const };
    }

    await ctx.db.patch(profile._id, { age: nextAge, updatedAt: Date.now() });
    return {
      success: true as const,
      userDateOfBirth: (user as any)?.dateOfBirth ?? null,
      previousAge: (profile as any)?.age ?? null,
      nextAge,
    };
  },
});

// P2-DEAD-01..05: The following five mutations/queries were removed in the
// Deep Connect P2 batch after grep confirmed zero callers (frontend + backend):
//   - getByUserId         (replaced by `getByAuthUserId` which uses the
//                          custom session-token auth path)
//   - upsert              (replaced by `upsertByAuthId`)
//   - updateFields        (replaced by `updateFieldsByAuthId`)
//   - updateBlurredPhotos (no live callers; photo updates now flow through
//                          `updateFieldsByAuthId` + `saveOnboardingPhotos`)
//   - deleteProfile       (no live callers; deletion is centralized in
//                          `convex/privateDeletion.ts` via the pending-state
//                          state machine)
// Each removed function used the legacy `ctx.auth.getUserIdentity()` pattern.
// Mira migrated to custom session tokens (`validateSessionToken`); leaving
// these mutations alive meant a divergent auth path with no consumers, which
// is a maintenance hazard and a latent backdoor risk if a future caller is
// added without realizing it bypasses the session-token flow.

/**
 * Update specific fields on private profile by auth user ID.
 * Uses the same auth-safe pattern as upsertByAuthId (no ctx.auth.getUserIdentity).
 * Used by Phase-2 profile for photo sync and field updates.
 *
 * E5 DENY-LIST — DO NOT add the following fields here:
 *   - notificationsEnabled
 *   - notificationCategories
 *   - pushNotificationsEnabled
 *
 * Notification-preference writes MUST go through `setPhase2NotificationPreferences`
 * (see convex/notificationPreferences.* / privateProfiles.setPhase2NotificationPreferences).
 * That dedicated mutation:
 *   - writes an audit-log entry (compliance trail for safety-relevant prefs),
 *   - applies a tighter rate-limit / throttle,
 *   - performs notification-category whitelist validation.
 *
 * Adding any of those keys to this generic field updater would silently
 * bypass all three controls. If you have a legitimate need to bulk-update
 * notification preferences from a new code path, route it through the
 * dedicated mutation instead — do NOT widen this arg list.
 */
export const updateFieldsByAuthId = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    // Photos
    privatePhotoUrls: v.optional(v.array(v.string())),
    photoBlurSlots: v.optional(v.array(v.boolean())),
    photoBlurEnabled: v.optional(v.boolean()),
    // Profile details
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    hobbies: v.optional(v.array(v.string())),
    // Other optional fields
    privateBio: v.optional(v.string()),
    privateIntentKeys: v.optional(v.array(v.string())),
    privateIntentKey: v.optional(v.union(v.string(), v.null())),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    isPrivateEnabled: v.optional(v.boolean()),
    // Phase-2 Onboarding Step 3: Prompt answers
    promptAnswers: v.optional(v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    }))),
    // Phase-2 Preference Strength (ranking signal)
    preferenceStrength: v.optional(v.object({
      smoking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      drinking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      intent: v.union(v.literal('not_important'), v.literal('prefer_similar'), v.literal('important'), v.literal('must_match_exactly')),
    })),
    // Phase-2 Privacy
    hideFromDeepConnect: v.optional(v.boolean()),
    hideAge: v.optional(v.boolean()),
    hideDistance: v.optional(v.boolean()),
    disableReadReceipts: v.optional(v.boolean()),
    // Phase-2 Safety
    safeMode: v.optional(v.boolean()),
    // Phase-2 Photo & Media Privacy
    defaultPhotoVisibility: v.optional(
      v.union(v.literal('public'), v.literal('blurred'), v.literal('private'))
    ),
    allowUnblurRequests: v.optional(v.boolean()),
    defaultSecureMediaTimer: v.optional(
      v.union(v.literal(0), v.literal(10), v.literal(30))
    ),
    defaultSecureMediaViewingMode: v.optional(
      v.union(v.literal('tap'), v.literal('hold'))
    ),
  },
  handler: async (ctx, args) => {
    const bioValidation = sanitizePrivateBio(args.privateBio);
    if (!bioValidation.ok) {
      return { success: false, error: bioValidation.error };
    }

    const promptValidation = sanitizePhase2PromptAnswersForBackend(args.promptAnswers);
    if (!promptValidation.ok) {
      return { success: false, error: promptValidation.error };
    }
    if (promptValidation.value) {
      const seenPromptIds = new Set<string>();
      for (const prompt of promptValidation.value) {
        if (seenPromptIds.has(prompt.promptId)) {
          return { success: false, error: 'duplicate_prompt_id' as const };
        }
        seenPromptIds.add(prompt.promptId);
      }
    }

    const lifestyleValidation = validateLifestyleFields(args);
    if (!lifestyleValidation.ok) {
      return { success: false, error: lifestyleValidation.error };
    }

    const privateIntentKeys = sanitizePrivateIntentKeysForSave(
      args.privateIntentKeys,
      args.privateIntentKey,
    );
    const privateDesireTagKeys = sanitizePrivateDesireTagKeysForSave(args.privateDesireTagKeys);

    const intentValidation = validateEnumKeys(
      privateIntentKeys,
      PHASE2_INTENT_KEY_SET,
      'private_intent_keys',
    );
    if (!intentValidation.ok) {
      return { success: false, error: intentValidation.error };
    }

    const desireValidation = validateEnumKeys(
      privateDesireTagKeys,
      PHASE2_DESIRE_TAG_KEY_SET,
      'private_desire_tag_keys',
    );
    if (!desireValidation.ok) {
      return { success: false, error: desireValidation.error };
    }

    const boundaryValidation = validateEnumKeys(
      args.privateBoundaries,
      PHASE2_BOUNDARY_KEY_SET,
      'private_boundaries',
    );
    if (!boundaryValidation.ok) {
      return { success: false, error: boundaryValidation.error };
    }

    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P1: rate-limit generic private-profile field updates. Higher ceiling
    // than nickname/photos because legitimate "edit profile" sessions can
    // touch many fields in a short window; still capped at 30/hr + 200/day
    // to bound moderation surface.
    const fieldsLimit = await reserveActionSlots(ctx, userId, 'phase2_private_profile_update_fields', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 30 },
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 200 },
    ]);
    if (!fieldsLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        retryAfterMs: fieldsLimit.retryAfterMs,
      };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      return { success: false, error: 'profile_not_found' };
    }

    // Build clean updates (only defined, non-null values).
    // The userPrivateProfiles table schema declares optional fields as
    // v.optional(v.<type>) — null is NOT a valid stored value. The arg
    // validator above accepts null so older clients don't crash at the
    // mutation boundary, but we MUST strip nulls before patching or the
    // database will reject the write. Stripping null also preserves
    // any existing valid value: a missing key in patch leaves the
    // current row value untouched.
    //
    // P3-F2 ALLOWLIST CONTRACT — read before adding any field below:
    //   The `args` v.object schema above is the ONLY field allowlist for
    //   this mutation. The destructure below intentionally pulls out
    //   `token`, `authUserId`, and the legacy `privateIntentKey` alias
    //   and forwards `...updates` straight into the patch. Convex's arg
    //   validator guarantees `updates` cannot contain unvalidated keys —
    //   that guarantee is the WHOLE security model of this destructure.
    //
    //   Do NOT change this rest object to widen its inputs:
    //     - never accept `v.any()` or unvalidated record types in args
    //     - never spread `args` directly without removing
    //       `{ token, authUserId, privateIntentKey }`
    //     - never read from `ctx.request` to add extra keys
    //
    //   To ADD a new field:
    //     1. Add an explicit v.<type>(...) entry in the args object.
    //     2. Add a sanitizer / enum-validator in the validation block
    //        above (mirror sanitizePrivateIntentKeysForSave / validateEnumKeys).
    //     3. Review whether the new field needs its own rate-limit
    //        (notification prefs already have one — see the E5 doc-block
    //        above this mutation).
    //     4. Confirm the field is NOT on the E5 deny-list
    //        (notificationsEnabled / notificationCategories /
    //        pushNotificationsEnabled).
    const { authUserId, token, privateIntentKey: _legacyPrivateIntentKey, ...updates } = args;
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) continue;
      cleanUpdates[key] = value;
    }
    if (args.privatePhotoUrls !== undefined) {
      const photoValidation = await validateOwnedSafePrivatePhotoUrls(
        ctx,
        userId,
        args.privatePhotoUrls,
        { requireMinimum: true },
      );
      if (!photoValidation.ok) {
        return { success: false, error: photoValidation.error };
      }
      cleanUpdates.privatePhotoUrls = photoValidation.urls;
    }
    if (privateIntentKeys !== undefined) {
      cleanUpdates.privateIntentKeys = privateIntentKeys;
    }
    if (privateDesireTagKeys !== undefined) {
      cleanUpdates.privateDesireTagKeys = privateDesireTagKeys;
    }

    if (bioValidation.value !== undefined) {
      cleanUpdates.privateBio = bioValidation.value;
    }
    if (promptValidation.value !== undefined) {
      cleanUpdates.promptAnswers = promptValidation.value;
    }

    // Self-heal: opportunistically fix age if invalid
    const needsAgeFix =
      typeof existing.age !== 'number' ||
      existing.age <= 0 ||
      existing.age >= 120;

    if (needsAgeFix) {
      const user = await ctx.db.get(userId);
      const fixedAge = ageFromUser(user);
      if (fixedAge > 0) {
        cleanUpdates.age = fixedAge;
      }
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    return { success: true };
  },
});

export const setPhase2NotificationPreferences = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    notificationsEnabled: v.optional(v.boolean()),
    notificationCategories: v.optional(v.object({
      deepConnect: v.optional(v.boolean()),
      privateMessages: v.optional(v.boolean()),
      chatRooms: v.optional(v.boolean()),
      truthOrDare: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P2-1: Canonical reserveActionSlots rate limit on notification-pref
    // writes. Replaces the previous audit-log-count window so we (a) match
    // every other Phase-2 mutation, (b) do not depend on audit-log table
    // scans to throttle, and (c) cap the audit-log + userPrivateProfiles
    // write storm a hostile loop could otherwise produce. Tight caps
    // reflect that this surface fronts a small handful of toggles —
    // legitimate users edit prefs a few times per minute at most.
    const notifPrefsLimit = await reserveActionSlots(
      ctx,
      userId,
      'phase2_private_notification_prefs',
      [
        { kind: 'minute', windowMs: 60_000, max: 10 },
        { kind: 'hour', windowMs: 60 * 60_000, max: 60 },
      ],
    );
    if (!notifPrefsLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        windowKind: notifPrefsLimit.windowKind,
        retryAfterMs: notifPrefsLimit.retryAfterMs,
      };
    }

    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return { success: false as const, error: 'deletion_pending' as const };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      return { success: false as const, error: 'profile_not_found' as const };
    }

    const now = Date.now();

    const changedFields: string[] = [];
    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    const patch: Record<string, unknown> = {};

    if (
      args.notificationsEnabled !== undefined &&
      args.notificationsEnabled !== existing.notificationsEnabled
    ) {
      changedFields.push('notificationsEnabled');
      previousValues.notificationsEnabled = existing.notificationsEnabled;
      newValues.notificationsEnabled = args.notificationsEnabled;
      patch.notificationsEnabled = args.notificationsEnabled;
    }

    if (args.notificationCategories !== undefined) {
      const nextNotificationCategories = {
        ...(existing.notificationCategories ?? {}),
        ...args.notificationCategories,
      };

      if (
        !notificationCategorySettingsEqual(
          existing.notificationCategories,
          nextNotificationCategories,
        )
      ) {
        changedFields.push('notificationCategories');
        previousValues.notificationCategories = normalizeNotificationCategorySettings(
          existing.notificationCategories,
        );
        newValues.notificationCategories = normalizeNotificationCategorySettings(
          nextNotificationCategories,
        );
        patch.notificationCategories = nextNotificationCategories;
      }
    }

    if (changedFields.length === 0) {
      return { success: true as const };
    }

    patch.updatedAt = now;
    await ctx.db.patch(existing._id, patch);

    await ctx.db.insert('userPrivateProfileAuditLog', {
      userId,
      changedFields,
      previousValues,
      newValues,
      changedAt: now,
      source: 'user',
    });

    return { success: true as const };
  },
});

/**
 * Update Phase-2 nickname (displayName) with server-side edit limit enforcement.
 *
 * Rules:
 * - Total allowed changes = 3
 * - Missing count is treated as 0 (backward compatible)
 */
export const updateDisplayNameByAuthId = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const validation = validatePhase2DisplayName(args.displayName);
    if (!validation.ok) {
      return { success: false, error: 'INVALID_DISPLAY_NAME' as const, code: validation.code };
    }
    const trimmed = validation.trimmed;

    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P1: short-window throttle on nickname changes. The lifetime cap of
    // 3 nickname edits is enforced below (currentCount >= 3 branch) and
    // is NOT replaced — this limiter prevents rapid-fire mutation loops
    // that could otherwise burn quota before the count check fires.
    const displayNameLimit = await reserveActionSlots(ctx, userId, 'phase2_private_display_name_update', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 5 },
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 10 },
    ]);
    if (!displayNameLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        retryAfterMs: displayNameLimit.retryAfterMs,
      };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return { success: false, error: 'deletion_pending' as const };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      // P2-3: Skeleton-profile insert. The user has only chosen a nickname and
      // has NOT completed Phase-2 setup (no bio, no photos, no intents). We
      // defensively set BOTH `isPrivateEnabled: false` AND
      // `isSetupComplete: false` so the row cannot surface in discovery,
      // swipes, truth-or-dare, or any other Phase-2 reader even if a future
      // reader forgets to check `isSetupComplete`. The user must complete the
      // setup flow (which calls `setupPrivateProfile` / `enablePrivateProfile`)
      // to flip both flags to `true`.
      const now = Date.now();
      const user = await ctx.db.get(userId);
      // SECURITY (P0-2): adult-confirmation is derived strictly from the
      // Phase-1 users.dateOfBirth via ageFromUser (which returns 0 when DOB
      // is missing/invalid). It is NEVER taken from a separate Phase-2
      // "consent" toggle and NEVER trusted from the client. If DOB is absent
      // or under 18, `adultAgeConfirmed` is `false` and the timestamp is
      // omitted — the row will not pass any 18+ gate downstream.
      const derivedAge = ageFromUser(user);
      const adultAgeConfirmed = derivedAge >= 18;

      // P2-7 SKELETON-DRIFT FIX: A non-empty trimmed nickname IS one
      // nickname write, so count it. Mirrors `saveOnboardingPhotos`
      // (line further below) which already starts at 1 when a nickname is
      // present in the skeleton insert. Previously this path started at 0
      // — giving users an effective 4-edit budget (insert + 3 patches)
      // instead of the documented 3-edit lifetime cap.
      const skeletonDisplayNameEditCount = 1;
      const profileId = await ctx.db.insert('userPrivateProfiles', {
        userId,
        displayName: trimmed,
        displayNameEditCount: skeletonDisplayNameEditCount,
        lastDisplayNameEditedAt: now,
        phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
        age: derivedAge,
        gender: user?.gender || '',
        privateBio: '',
        privateIntentKeys: [],
        privatePhotoUrls: [],
        city: user?.city || '',
        // P2-3: skeleton row stays disabled until full setup completes.
        isPrivateEnabled: false,
        // P0-2: server-derived from Phase-1 DOB (see comment above).
        ageConfirmed18Plus: adultAgeConfirmed,
        ...(adultAgeConfirmed ? { ageConfirmedAt: now } : {}),
        privatePhotosBlurred: [],
        privatePhotoBlurLevel: 0,
        privateDesireTagKeys: [],
        privateBoundaries: [],
        revealPolicy: 'mutual_only',
        isSetupComplete: false,
        hobbies: user?.activities || [],
        isVerified: user?.isVerified || false,
        promptAnswers: [],
        createdAt: now,
        updatedAt: now,
      });

      // P2-2: Audit-log row for the initial nickname write on a skeleton
      // insert. Mirrors the audit pattern used by
      // `setPhase2NotificationPreferences`. previousValues.displayName is
      // recorded as null (no prior nickname existed) so moderation tooling
      // can distinguish first-set from rename.
      await ctx.db.insert('userPrivateProfileAuditLog', {
        userId,
        changedFields: ['displayName'],
        previousValues: { displayName: null },
        newValues: { displayName: trimmed },
        changedAt: now,
        source: 'user',
      });

      return {
        success: true as const,
        profileId,
        displayNameEditCount: skeletonDisplayNameEditCount,
      };
    }

    const currentCount = (existing as any).displayNameEditCount ?? 0;
    if (currentCount >= 3) {
      return { success: false, error: 'Nickname change limit reached' as const };
    }

    const previousDisplayName = (existing as any).displayName ?? null;
    const patchNow = Date.now();
    await ctx.db.patch(existing._id, {
      displayName: trimmed,
      displayNameEditCount: currentCount + 1,
      lastDisplayNameEditedAt: patchNow,
      updatedAt: patchNow,
    });

    // P2-2: Audit-log row for nickname renames on an existing profile.
    // Captures previous + next + edit-count snapshot so abuse moderation
    // can observe identity-rotation patterns. Insert is unconditional
    // because we only reach this branch on a confirmed change AND the
    // 3-edit lifetime cap above has already been enforced — the audit
    // log cannot be flooded beyond that lifetime budget plus the
    // short-window rate limit declared at the top of this mutation.
    await ctx.db.insert('userPrivateProfileAuditLog', {
      userId,
      changedFields: ['displayName'],
      previousValues: {
        displayName: previousDisplayName,
        displayNameEditCount: currentCount,
      },
      newValues: {
        displayName: trimmed,
        displayNameEditCount: currentCount + 1,
      },
      changedAt: patchNow,
      source: 'user',
    });

    return { success: true as const, displayNameEditCount: currentCount + 1 };
  },
});

/**
 * Manual one-shot sync: copy selected Phase-1 fields into Phase-2 private profile.
 *
 * IMPORTANT:
 * - This is NOT automatic; it must be explicitly invoked by the client.
 * - Only syncs inherited "details" fields; does not touch nickname, photos, prompts, bio, intents, age, or gender.
 */
export const syncFromMainProfile = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P1-2: Rate-limit the manual Phase-1 → Phase-2 import. This is a
    // user-initiated "Import from main profile" action; nobody legitimately
    // needs it more than a couple of times per minute. Tight caps prevent a
    // loop from repeatedly reading the Phase-1 users row and patching the
    // Phase-2 row (each call also bumps `updatedAt`, which is the discovery
    // ranking signal). Owner-only via validateOwnership above.
    const syncLimit = await reserveActionSlots(
      ctx,
      userId,
      'phase2_private_profile_sync_main',
      [
        { kind: 'minute', windowMs: 60_000, max: 2 },
        { kind: 'hour', windowMs: 60 * 60_000, max: 10 },
      ],
    );
    if (!syncLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        windowKind: syncLimit.windowKind,
        retryAfterMs: syncLimit.retryAfterMs,
      };
    }

    // Phase-1 user record (source of truth for this manual sync)
    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false, error: 'user_not_found' as const };
    }

    // Phase-2 private profile (target)
    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();
    if (!existing) {
      return { success: false, error: 'profile_not_found' as const };
    }

    // Build patch object - NEVER write null (schema only accepts undefined)
    // Hobbies are guarded the same as lifestyle fields: only write when Phase-1
    // actually has a non-empty array, otherwise we'd silently clear Phase-2.
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    // P2-6: Replace per-field `(user as any).X` casts with a single
    // tightly-scoped `Record<string, unknown>` view of the Phase-1 user
    // row, then guard each access with an explicit typeof / Array.isArray
    // check. The schema does not type these optional fields, so we cannot
    // remove the cast entirely — but we narrow it to one expression and
    // keep every downstream read fully type-checked.
    const userRecord = user as unknown as Record<string, unknown>;
    const rawHeight = userRecord.height;
    const rawWeight = userRecord.weight;
    const rawSmoking = userRecord.smoking;
    const rawDrinking = userRecord.drinking;
    const rawEducation = userRecord.education;
    const rawReligion = userRecord.religion;
    const rawActivities = userRecord.activities;

    const appliedFields = {
      height: false,
      weight: false,
      smoking: false,
      drinking: false,
      education: false,
      religion: false,
      hobbies: false,
    };

    let phase1Height: number | undefined;
    let phase1Weight: number | undefined;
    let phase1Smoking: string | undefined;
    let phase1Drinking: string | undefined;
    let phase1Education: string | undefined;
    let phase1Religion: string | undefined;
    let phase1Activities: string[] | undefined;

    if (typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0) {
      patch.height = rawHeight;
      appliedFields.height = true;
      phase1Height = rawHeight;
    }
    if (typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight > 0) {
      patch.weight = rawWeight;
      appliedFields.weight = true;
      phase1Weight = rawWeight;
    }
    if (typeof rawSmoking === 'string' && rawSmoking.length > 0) {
      patch.smoking = rawSmoking;
      appliedFields.smoking = true;
      phase1Smoking = rawSmoking;
    }
    if (typeof rawDrinking === 'string' && rawDrinking.length > 0) {
      patch.drinking = rawDrinking;
      appliedFields.drinking = true;
      phase1Drinking = rawDrinking;
    }
    if (typeof rawEducation === 'string' && rawEducation.length > 0) {
      patch.education = rawEducation;
      appliedFields.education = true;
      phase1Education = rawEducation;
    }
    if (typeof rawReligion === 'string' && rawReligion.length > 0) {
      patch.religion = rawReligion;
      appliedFields.religion = true;
      phase1Religion = rawReligion;
    }
    if (
      Array.isArray(rawActivities) &&
      rawActivities.length > 0 &&
      rawActivities.every((entry): entry is string => typeof entry === 'string')
    ) {
      patch.hobbies = rawActivities;
      appliedFields.hobbies = true;
      phase1Activities = rawActivities;
    }

    const availableInPhase1 =
      appliedFields.height ||
      appliedFields.weight ||
      appliedFields.smoking ||
      appliedFields.drinking ||
      appliedFields.education ||
      appliedFields.religion ||
      appliedFields.hobbies;

    // Snapshot of canonicalized Phase-1 values the client can use to update
    // local state without re-querying. Only fields that were applied are
    // included; the rest are explicitly undefined so the client can tell
    // them apart from "value happens to be falsy in Phase-1".
    const phase1Snapshot = {
      height: phase1Height,
      weight: phase1Weight,
      smoking: phase1Smoking,
      drinking: phase1Drinking,
      education: phase1Education,
      religion: phase1Religion,
      hobbies: phase1Activities,
    };

    if (availableInPhase1) {
      await ctx.db.patch(existing._id, patch);
    }

    return {
      success: true as const,
      appliedFields,
      availableInPhase1,
      phase1Snapshot,
    };
  },
});

/**
 * Migration/backfill: Fix userPrivateProfiles rows with missing/invalid age by recomputing from users.dateOfBirth.
 *
 * - Scans userPrivateProfiles
 * - If age is 0/invalid and user has DOB, patches age
 * - Returns counts for reporting
 */
export const backfillPrivateProfileAges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('userPrivateProfiles').collect();
    let scanned = 0;
    let fixed = 0;
    let skippedNoDob = 0;
    let skippedNoUser = 0;

    for (const p of profiles) {
      scanned++;
      const currentAge = (p as any).age;
      const isInvalid = typeof currentAge !== 'number' || !Number.isFinite(currentAge) || currentAge <= 0 || currentAge >= 120;
      if (!isInvalid) continue;

      const user = await ctx.db.get((p as any).userId);
      if (!user) {
        skippedNoUser++;
        continue;
      }
      const nextAge = ageFromUser(user);
      if (!nextAge || nextAge <= 0) {
        skippedNoDob++;
        continue;
      }
      await ctx.db.patch(p._id, { age: nextAge, updatedAt: Date.now() });
      fixed++;
    }

    return { success: true as const, scanned, fixed, skippedNoDob, skippedNoUser };
  },
});

/**
 * Save onboarding photos for Phase-2 Step 2.
 * Creates a skeleton profile if none exists, updates photos if it does.
 * Used specifically during Phase-2 onboarding before full profile is complete.
 */
export const saveOnboardingPhotos = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    privatePhotoUrls: v.array(v.string()),
    displayName: v.optional(v.string()),
    // Phase-1 imported fields to persist into Phase-2 on initial skeleton creation only
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P1: rate-limit photo-save attempts so the expensive owned-photo
    // validation and skeleton insert cannot be hammered. Placed AFTER
    // ownership and BEFORE deletion-state / photo validation / DB writes.
    const photosSaveLimit = await reserveActionSlots(ctx, userId, 'phase2_onboarding_photos_save', [
      { kind: '1hour', windowMs: 60 * 60 * 1000, max: 10 },
      { kind: '1day', windowMs: 24 * 60 * 60 * 1000, max: 30 },
    ]);
    if (!photosSaveLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        retryAfterMs: photosSaveLimit.retryAfterMs,
      };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();
    const photoValidation = await validateOwnedSafePrivatePhotoUrls(
      ctx,
      userId,
      args.privatePhotoUrls,
      { requireMinimum: true },
    );
    if (!photoValidation.ok) {
      return { success: false, error: photoValidation.error };
    }

    if (existing) {
      // Build patch object starting with photos
      const patch: Record<string, unknown> = {
        privatePhotoUrls: photoValidation.urls,
        updatedAt: now,
      };

      // P3-F1: Only patch phase2SetupVersion when the row's version is
      // actually stale. Previously this was written on every photo save,
      // which caused (a) unnecessary write churn during normal re-uploads
      // and (b) noisy updatedAt-driven cache invalidation on the schema
      // version column. We still update `updatedAt` (callers rely on it
      // to refetch photos) so the only behavior change is: rows whose
      // phase2SetupVersion already equals CURRENT_PHASE2_SETUP_VERSION
      // skip the redundant write.
      if (existing.phase2SetupVersion !== CURRENT_PHASE2_SETUP_VERSION) {
        patch.phase2SetupVersion = CURRENT_PHASE2_SETUP_VERSION;
      }

      // Self-heal: fix age if invalid
      const needsAgeFix =
        typeof existing.age !== 'number' ||
        existing.age <= 0 ||
        existing.age >= 120;

      if (needsAgeFix) {
        const user = await ctx.db.get(userId);
        const fixedAge = ageFromUser(user);
        if (fixedAge > 0) {
          patch.age = fixedAge;
        }
      }

      await ctx.db.patch(existing._id, patch);
      return { success: true, profileId: existing._id };
    }

    // Create skeleton profile for onboarding (will be completed in later steps)
    // Get user data to populate required fields with defaults
    const user = await ctx.db.get(userId);
    const derivedAge = ageFromUser(user);
    const rawDisplayName = typeof args.displayName === 'string' ? args.displayName : '';
    const displayNameValidation = validatePhase2DisplayName(rawDisplayName);
    if (!displayNameValidation.ok) {
      return {
        success: false,
        error: 'display_name_required' as const,
        code: displayNameValidation.code,
      };
    }
    const trimmedDisplayName = displayNameValidation.trimmed;
    // P1-D3: backend derives 18+ status from Phase-1 DOB. Mirrors the
    // pattern used by updateDisplayNameByAuthId's skeleton path so both
    // skeleton creation sites stay in sync.
    const adultAgeConfirmed = derivedAge >= 18;
    const profileId = await ctx.db.insert('userPrivateProfiles', {
      userId,
      displayName: trimmedDisplayName || '',
      // P1-D1: a non-empty trimmed nickname IS one nickname write, so count it.
      // Empty-string skeletons keep count 0 so the first real edit can land.
      displayNameEditCount: trimmedDisplayName ? 1 : 0,
      lastDisplayNameEditedAt: now,
      phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
      // Canonical identity field: backend source of truth only
      age: derivedAge,
      gender: user?.gender || '',
      privateBio: '',
      privateIntentKeys: [],
      privatePhotoUrls: photoValidation.urls,
      city: user?.city || '',
      // P1-D2: skeleton row is incomplete (no bio, no intents, no prompts).
      // Keep it disabled for discovery until setupPrivateProfile /
      // setPhase2OnboardingCompleted flips both isPrivateEnabled and
      // isSetupComplete together.
      isPrivateEnabled: false,
      // P1-D3: derived from Phase-1 DOB, never hardcoded.
      ageConfirmed18Plus: adultAgeConfirmed,
      ...(adultAgeConfirmed ? { ageConfirmedAt: now } : {}),
      privatePhotosBlurred: [],
      privatePhotoBlurLevel: 0,
      privateDesireTagKeys: [],
      privateBoundaries: [],
      revealPolicy: 'mutual_only',
      isSetupComplete: false,
      hobbies: user?.activities || [],
      isVerified: user?.isVerified || false,
      promptAnswers: [],
      // Phase-1 import: only set during skeleton creation (do not overwrite later Phase-2 edits)
      // NOTE: userPrivateProfiles schema stores these as optional (undefined) rather than null.
      height: args.height ?? undefined,
      weight: args.weight ?? undefined,
      smoking: args.smoking ?? undefined,
      drinking: args.drinking ?? undefined,
      education: args.education ?? undefined,
      religion: args.religion ?? undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { success: true, profileId };
  },
});

/**
 * Get private profile by auth user ID (string).
 * Resolves auth ID to Convex user ID internally.
 * Used by Phase-2 Profile tab to load backend data.
 *
 * NOTE: This app uses custom session-based auth (not Convex auth integration).
 * Ownership is verified by resolving the provided authUserId to a valid user.
 * The frontend only sends the user's own ID from authStore (populated after login).
 */
export const getByAuthUserId = query({
  args: {
    token: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // Verify the user exists (ownership check via ID resolution)
    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return null;
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!profile) {
      return null;
    }

    // Always expose privateIntentKeys to clients (schema-required; normalize if ever missing in a row)
    const privateIntentKeys = profile.privateIntentKeys ?? [];

    // E2: Replace `{ ...profile }` spread with an EXPLICIT projection.
    //
    // Rationale:
    //   - A spread auto-exposes every new column added to the schema,
    //     including server-trust-only flags (e.g. ageConfirmed18Plus,
    //     ageConfirmedAt) and any future moderation / fraud fields.
    //   - Enumerate ONLY the fields the frontend actually consumes
    //     (see app/(main)/phase2-onboarding/*, (private)/* and
    //     stores/privateProfileStore.hydrateFromConvex).
    //
    // DO NOT add the following without explicit security review:
    //   - ageConfirmed18Plus, ageConfirmedAt  (server trust only)
    //   - privatePhotosBlurred, privatePhotoBlurLevel  (no consumer)
    //   - lastDisplayNameEditedAt, phase2SetupVersion  (no consumer)
    //   - revealPolicy                              (no consumer)
    //   - createdAt                                 (no consumer)
    //
    // Adding new fields requires (a) confirmed frontend consumer AND
    // (b) confirmation the field is safe to expose to the owner client.
    return {
      _id: profile._id,
      updatedAt: profile.updatedAt,
      displayName: profile.displayName,
      displayNameEditCount: profile.displayNameEditCount,
      age: profile.age,
      gender: profile.gender,
      city: profile.city,
      privateBio: profile.privateBio,
      privateIntentKeys,
      privateDesireTagKeys: profile.privateDesireTagKeys,
      privateBoundaries: profile.privateBoundaries,
      privatePhotoUrls: profile.privatePhotoUrls,
      photoBlurEnabled: profile.photoBlurEnabled,
      photoBlurSlots: profile.photoBlurSlots,
      promptAnswers: profile.promptAnswers,
      hobbies: profile.hobbies,
      isSetupComplete: profile.isSetupComplete,
      isPrivateEnabled: profile.isPrivateEnabled,
      isVerified: profile.isVerified,
      height: profile.height,
      weight: profile.weight,
      smoking: profile.smoking,
      drinking: profile.drinking,
      education: profile.education,
      religion: profile.religion,
      preferenceStrength: profile.preferenceStrength,
      hideFromDeepConnect: profile.hideFromDeepConnect,
      hideAge: profile.hideAge,
      hideDistance: profile.hideDistance,
      disableReadReceipts: profile.disableReadReceipts,
      safeMode: profile.safeMode,
      notificationsEnabled: profile.notificationsEnabled,
      notificationCategories: profile.notificationCategories,
      defaultPhotoVisibility: profile.defaultPhotoVisibility,
      allowUnblurRequests: profile.allowUnblurRequests,
      defaultSecureMediaTimer: profile.defaultSecureMediaTimer,
      defaultSecureMediaViewingMode: profile.defaultSecureMediaViewingMode,
    };
  },
});

/**
 * Self-healing version of getByAuthUserId.
 * On every call, checks if profile.age is invalid and auto-corrects from users.dateOfBirth.
 * This ensures existing broken profiles (age=0) automatically heal without manual backfill.
 *
 * IMPORTANT: This is a mutation (not a query) because it writes to the database.
 * Frontend should use useMutation and call this on profile load for self-healing.
 *
 * SCALE (P0-3): The frontend (`private-profile.tsx`) gates this to AT MOST
 * ONE call per screen lifecycle via `hasHealedRef`. To defend against a
 * malfunctioning or hostile client that bypasses that gate, the actual
 * write path (the `ctx.db.patch` heal step) is rate-limited per user.
 * Read-only profiles (healthy `age`) cost nothing extra and never write.
 * Denied heal calls still return the corrected age in the response so the
 * UI does not regress; the row simply heals on a later, non-throttled call.
 */
export const getAndHealByAuthUserId = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return null;
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!profile) {
      return null;
    }

    // Self-heal: check if age is invalid and fix it
    const needsAgeFix =
      typeof profile.age !== 'number' ||
      profile.age <= 0 ||
      profile.age >= 120;

    let returnProfile = profile;

    if (needsAgeFix) {
      const fixedAge = ageFromUser(user);
      if (fixedAge > 0) {
        // P0-3: Rate-limit the heal WRITE path. Healthy profiles never reach
        // this branch. A buggy/hostile loop against an unhealed profile is
        // capped at 5 writes/minute and 30 writes/hour per user. The legit
        // path (one heal per screen lifecycle, then `age` becomes valid and
        // this branch is skipped forever) is unaffected.
        const healLimit = await reserveActionSlots(
          ctx,
          userId,
          'phase2_private_profile_heal',
          [
            { kind: 'minute', windowMs: 60_000, max: 5 },
            { kind: 'hour', windowMs: 60 * 60_000, max: 30 },
          ],
        );
        if (healLimit.accept) {
          await ctx.db.patch(profile._id, {
            age: fixedAge,
            updatedAt: Date.now(),
          });
        }
        // Return corrected value to the caller even if the persist was
        // throttled — the UI shows the right age, and the row will heal
        // on a later, non-throttled call.
        returnProfile = { ...profile, age: fixedAge };
      }
    }

    // Normalize privateIntentKeys
    const privateIntentKeys = returnProfile.privateIntentKeys ?? [];

    // P3-PROJ-01: Explicit projection. Mirrors `getByAuthUserId` field-for-field
    // so future schema additions (moderation flags, fraud signals,
    // server-trust-only state like ageConfirmed18Plus/ageConfirmedAt, etc.)
    // do NOT auto-leak via a `...returnProfile` spread if this function is
    // ever re-used in a non-self context. Self-read today (validateOwnership
    // above), but the projection is defense-in-depth. If you add a field to
    // the `userPrivateProfiles` schema that the owner client must read, mirror
    // the addition in BOTH this list AND `getByAuthUserId`'s projection.
    return {
      _id: returnProfile._id,
      updatedAt: returnProfile.updatedAt,
      displayName: returnProfile.displayName,
      displayNameEditCount: returnProfile.displayNameEditCount,
      age: returnProfile.age,
      gender: returnProfile.gender,
      city: returnProfile.city,
      privateBio: returnProfile.privateBio,
      privateIntentKeys,
      privateDesireTagKeys: returnProfile.privateDesireTagKeys,
      privateBoundaries: returnProfile.privateBoundaries,
      privatePhotoUrls: returnProfile.privatePhotoUrls,
      photoBlurEnabled: returnProfile.photoBlurEnabled,
      photoBlurSlots: returnProfile.photoBlurSlots,
      promptAnswers: returnProfile.promptAnswers,
      hobbies: returnProfile.hobbies,
      isSetupComplete: returnProfile.isSetupComplete,
      isPrivateEnabled: returnProfile.isPrivateEnabled,
      isVerified: returnProfile.isVerified,
      height: returnProfile.height,
      weight: returnProfile.weight,
      smoking: returnProfile.smoking,
      drinking: returnProfile.drinking,
      education: returnProfile.education,
      religion: returnProfile.religion,
      preferenceStrength: returnProfile.preferenceStrength,
      hideFromDeepConnect: returnProfile.hideFromDeepConnect,
      hideAge: returnProfile.hideAge,
      hideDistance: returnProfile.hideDistance,
      disableReadReceipts: returnProfile.disableReadReceipts,
      safeMode: returnProfile.safeMode,
      notificationsEnabled: returnProfile.notificationsEnabled,
      notificationCategories: returnProfile.notificationCategories,
      defaultPhotoVisibility: returnProfile.defaultPhotoVisibility,
      allowUnblurRequests: returnProfile.allowUnblurRequests,
      defaultSecureMediaTimer: returnProfile.defaultSecureMediaTimer,
      defaultSecureMediaViewingMode: returnProfile.defaultSecureMediaViewingMode,
    };
  },
});

/**
 * Upsert private profile by auth user ID.
 * Called from Phase-2 onboarding completion to persist profile to Convex.
 * IMPORTANT: Only stores backend URLs, not local file URIs.
 *
 * SECURITY (P0-1): Trust flags — `isVerified`, `ageConfirmed18Plus`, and
 * `ageConfirmedAt` — must NEVER be accepted from the client. They are
 * derived server-side from the authenticated Phase-1 `users` row (verification
 * state, dateOfBirth). Any future field that gates moderation, age, identity,
 * or eligibility MUST follow the same pattern: server-derived only.
 */
export const upsertByAuthId = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    // NOTE: Do NOT allow displayName updates here (nickname limit is enforced in updateDisplayNameByAuthId).
    // Keep displayName in args for backward compatibility of callers, but do not patch it on existing profiles.
    displayName: v.string(),
    gender: v.string(),
    privateBio: v.optional(v.string()),
    privateIntentKeys: v.array(v.string()),
    privateIntentKey: v.optional(v.union(v.string(), v.null())),
    privatePhotoUrls: v.array(v.string()),
    city: v.optional(v.string()),
    // Optional fields with defaults
    isPrivateEnabled: v.optional(v.boolean()),
    // SECURITY (P0-1): `ageConfirmed18Plus`, `ageConfirmedAt`, and `isVerified`
    // are intentionally NOT client args. They are derived server-side below
    // from the authenticated Phase-1 users row. Do not re-add them here.
    privatePhotosBlurred: v.optional(v.array(v.id('_storage'))),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.optional(v.boolean()),
    hobbies: v.optional(v.array(v.string())),
    // Profile details (imported from Phase-1)
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    // Phase-2 Onboarding Step 3: Prompt answers
    promptAnswers: v.optional(v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    }))),
    // Phase-2 Preference Strength (ranking signal)
    preferenceStrength: v.optional(v.object({
      smoking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      drinking: v.union(v.literal('not_important'), v.literal('slight_preference'), v.literal('important'), v.literal('deal_breaker')),
      intent: v.union(v.literal('not_important'), v.literal('prefer_similar'), v.literal('important'), v.literal('must_match_exactly')),
    })),
  },
  handler: async (ctx, args) => {
    const bioValidation = sanitizePrivateBio(args.privateBio);
    if (!bioValidation.ok) {
      return { success: false, error: bioValidation.error };
    }
    if (!bioValidation.value || bioValidation.value.trim().length === 0) {
      return { success: false, error: 'invalid_bio_required' as const };
    }

    const promptValidation = sanitizePhase2PromptAnswersForBackend(args.promptAnswers);
    if (!promptValidation.ok) {
      return { success: false, error: promptValidation.error };
    }

    const lifestyleValidation = validateLifestyleFields(args);
    if (!lifestyleValidation.ok) {
      return { success: false, error: lifestyleValidation.error };
    }

    const privateIntentKeys = sanitizePrivateIntentKeysForSave(
      args.privateIntentKeys,
      args.privateIntentKey,
    ) ?? [];
    const privateDesireTagKeys = sanitizePrivateDesireTagKeysForSave(
      args.privateDesireTagKeys,
    ) ?? [];

    const intentValidation = validateEnumKeys(
      privateIntentKeys,
      PHASE2_INTENT_KEY_SET,
      'private_intent_keys',
    );
    if (!intentValidation.ok) {
      return { success: false, error: intentValidation.error };
    }

    const desireValidation = validateEnumKeys(
      privateDesireTagKeys,
      PHASE2_DESIRE_TAG_KEY_SET,
      'private_desire_tag_keys',
    );
    if (!desireValidation.ok) {
      return { success: false, error: desireValidation.error };
    }

    const boundaryValidation = validateEnumKeys(
      args.privateBoundaries,
      PHASE2_BOUNDARY_KEY_SET,
      'private_boundaries',
    );
    if (!boundaryValidation.ok) {
      return { success: false, error: boundaryValidation.error };
    }

    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P2-5: Rate-limit the onboarding-completion upsert. Legit clients call
    // this once at the end of onboarding; rare re-runs after sync are fine
    // but a loop must not be able to repeatedly re-validate every owned
    // photo URL or re-run the trust-flag derivation. Caps are deliberately
    // tight — well above realistic legitimate retry but far below abuse.
    const upsertLimit = await reserveActionSlots(
      ctx,
      userId,
      'phase2_private_profile_upsert',
      [
        { kind: 'minute', windowMs: 60_000, max: 5 },
        { kind: 'hour', windowMs: 60 * 60_000, max: 20 },
      ],
    );
    if (!upsertLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        windowKind: upsertLimit.windowKind,
        retryAfterMs: upsertLimit.retryAfterMs,
      };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return { success: false, error: 'user_not_found' };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      return { success: false, error: 'deletion_pending' };
    }
    const photoValidation = await validateOwnedSafePrivatePhotoUrls(
      ctx,
      userId,
      args.privatePhotoUrls,
      { requireMinimum: true },
    );
    if (!photoValidation.ok) {
      return { success: false, error: photoValidation.error };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    // SECURITY (P0-1): Derive trust flags server-side from the authenticated
    // Phase-1 users row. NEVER trust the client for these values.
    //   - ageConfirmed18Plus: true iff backend-computed age >= 18.
    //   - ageConfirmedAt: timestamp set only when 18+ is confirmed; otherwise
    //     preserved from existing row (or omitted on fresh insert).
    //   - isVerified: mirrors the Phase-1 users.isVerified flag, which is the
    //     single source of truth for verification status.
    const derivedAge = ageFromUser(user);
    const adultAgeConfirmed = derivedAge >= 18;
    const derivedAgeConfirmedAt = adultAgeConfirmed
      ? (existing?.ageConfirmedAt ?? now)
      : existing?.ageConfirmedAt;
    const derivedIsVerified = user?.isVerified === true;

    // Build profile data with defaults
    const profileData = {
      userId,
      displayName: args.displayName,
      // Canonical identity fields: backend source of truth only
      age: derivedAge,
      gender: user?.gender || args.gender,
      privateBio: bioValidation.value,
      privateIntentKeys,
      privatePhotoUrls: photoValidation.urls,
      city: args.city || '',
      isPrivateEnabled: args.isPrivateEnabled ?? true,
      ageConfirmed18Plus: adultAgeConfirmed,
      privatePhotosBlurred: args.privatePhotosBlurred ?? [],
      privatePhotoBlurLevel: args.privatePhotoBlurLevel ?? 0,
      privateDesireTagKeys,
      privateBoundaries: args.privateBoundaries ?? [],
      revealPolicy: args.revealPolicy ?? 'mutual_only',
      // Completion is canonical-only: clients may keep sending legacy
      // isSetupComplete, but this mutation can only preserve a previously
      // completed row. New completion must go through users.setPhase2OnboardingCompleted.
      isSetupComplete: existing?.isSetupComplete === true,
      hobbies: args.hobbies ?? [],
      isVerified: derivedIsVerified,
      // Phase-2 Onboarding Step 3: Prompt answers
      promptAnswers: promptValidation.value ?? [],
      ...(derivedAgeConfirmedAt !== undefined
        ? { ageConfirmedAt: derivedAgeConfirmedAt }
        : {}),
    };

    // Profile details (imported from Phase-1) - only include if defined
    // Schema uses v.optional(), not v.union with null, so we omit undefined/null values
    if (args.height !== undefined && args.height !== null) {
      (profileData as any).height = args.height;
    }
    if (args.weight !== undefined && args.weight !== null) {
      (profileData as any).weight = args.weight;
    }
    if (args.smoking !== undefined && args.smoking !== null) {
      (profileData as any).smoking = args.smoking;
    }
    if (args.drinking !== undefined && args.drinking !== null) {
      (profileData as any).drinking = args.drinking;
    }
    if (args.education !== undefined && args.education !== null) {
      (profileData as any).education = args.education;
    }
    if (args.religion !== undefined && args.religion !== null) {
      (profileData as any).religion = args.religion;
    }

    // Preference Strength - only include if provided (fully complete object)
    if (args.preferenceStrength) {
      (profileData as any).preferenceStrength = args.preferenceStrength;
    }

    if (existing) {
      // SAFETY: Prevent bypassing nickname limit via upsert.
      // Preserve existing displayName and related nickname-limit fields.
      const { displayName: _ignoreDisplayName, ...rest } = profileData as any;
      await ctx.db.patch(existing._id, {
        ...rest,
        updatedAt: now,
      });
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...profileData,
      displayNameEditCount: 0,
      lastDisplayNameEditedAt: now,
      phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    return { success: true, profileId };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO BLUR SLOTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update photo blur settings for user's private profile.
 * Pass only the fields you want to change. At least one of photoBlurSlots or photoBlurEnabled must be provided.
 */
export const updatePhotoBlurSlots = mutation({
  args: {
    token: v.string(),
    authUserId: v.string(),
    photoBlurSlots: v.optional(v.array(v.boolean())),
    photoBlurEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.photoBlurSlots === undefined && args.photoBlurEnabled === undefined) {
      throw new Error('photoBlurSlots or photoBlurEnabled required');
    }

    const userId = await validateOwnership(ctx, args.token, args.authUserId);

    // P1-1: Rate-limit the blur-slot mutation so it cannot be used as a
    // write-amplification vector. Every call bumps `updatedAt` on
    // userPrivateProfiles, which is the discovery / Crossed-Paths ranking
    // signal — a tight loop here would let one user keep re-floating to the
    // top of every reader's feed. Owner-only (validateOwnership above), so
    // the limit is per-account and does not throttle global discovery.
    const blurLimit = await reserveActionSlots(
      ctx,
      userId,
      'phase2_private_profile_blur_update',
      [
        { kind: 'minute', windowMs: 60_000, max: 20 },
        { kind: 'hour', windowMs: 60 * 60_000, max: 100 },
        { kind: 'day', windowMs: 24 * 60 * 60_000, max: 300 },
      ],
    );
    if (!blurLimit.accept) {
      return {
        success: false as const,
        error: 'rate_limited' as const,
        windowKind: blurLimit.windowKind,
        retryAfterMs: blurLimit.retryAfterMs,
      };
    }

    // Find existing profile
    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    if (existing) {
      const patch: Record<string, unknown> = { updatedAt: now };
      if (args.photoBlurSlots !== undefined) {
        // P2-1: Reconcile incoming blur-slot array against the canonical
        // private-photo count so a desync (slow client, photo deleted in
        // another tab) cannot persist a slots array longer than the photos
        // it controls. Truncate excess; pad missing trailing slots with
        // `false` (unblurred) so the array length always matches.
        const photoCount = Array.isArray(existing.privatePhotoUrls)
          ? existing.privatePhotoUrls.length
          : 0;
        const incoming = args.photoBlurSlots;
        let reconciled: boolean[];
        if (incoming.length === photoCount) {
          reconciled = incoming;
        } else if (incoming.length > photoCount) {
          reconciled = incoming.slice(0, photoCount);
        } else {
          reconciled = incoming.concat(
            new Array(photoCount - incoming.length).fill(false),
          );
        }
        patch.photoBlurSlots = reconciled;
      }
      if (args.photoBlurEnabled !== undefined) {
        patch.photoBlurEnabled = args.photoBlurEnabled;
      }
      await ctx.db.patch(existing._id, patch);
      return { success: true };
    }

    // No profile exists yet - this shouldn't happen in normal flow
    // but we handle it gracefully
    throw new Error('Private profile not found. Please complete profile setup first.');
  },
});
